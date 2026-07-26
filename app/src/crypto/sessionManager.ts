// sessionManager.ts
// ------------------------------------------------------------------
// Chef d'orchestre : relie le pont libsignal (SignalBridge) et la
// persistance (BlackoutStore). C'est la SEULE couche autorisee a
// toucher aux records de session.
//
// Modele d'ajout de contact (out-of-band, sans serveur d'annuaire) :
// le QR d'invitation contient l'identite publique + le bundle
// X3DH/PQXDH de l'invitant. Celui qui scanne etablit la session
// immediatement et peut ecrire le premier message meme si l'invitant
// est ensuite hors-ligne. La confiance vient du scan physique (et du
// code de verification mensuel ensuite), jamais du relais.
// ------------------------------------------------------------------

import type { SignalBridge, PreKeyBundleJson } from './signalBridge.types';
import { CIPHERTEXT_PREKEY, makePreKeyBundle } from './signalBridge.types';
import type { BlackoutStore, IdentityRow } from '../storage/store';

/** Contenu du QR d'invitation (uniquement du PUBLIC + adresses). */
export interface InvitePayload {
  v: 1;
  displayName: string;
  address: string; // uuid de l'appareil invitant
  identityKey: string;
  registrationId: number;
  bundle: PreKeyBundleJson;
}

export interface Envelope {
  type: number; // CIPHERTEXT_PREKEY | CIPHERTEXT_WHISPER
  body: string; // base64
}

const SIGNED_PREKEY_ID = 1;
const KYBER_PREKEY_ID = 1;
const ONE_TIME_START_ID = 100;
const ONE_TIME_BATCH = 20;

function uuid(): string {
  // uuid v4 via crypto.getRandomValues (dispo sous Hermes et Node 20+)
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class SessionManager {
  constructor(
    private bridge: SignalBridge,
    private store: BlackoutStore,
  ) {}

  /**
   * Cree l'identite au premier lancement (et son lot initial de
   * prekeys). Idempotent : ne fait rien si l'identite existe.
   */
  async ensureIdentity(): Promise<IdentityRow> {
    const existing = await this.store.getIdentity();
    if (existing) return existing;

    const generated = await this.bridge.generateIdentityKeyPair();
    const identity: IdentityRow = {
      identityRecord: generated.identityRecord,
      publicKey: generated.publicKey,
      registrationId: generated.registrationId,
      localAddress: uuid(),
    };
    await this.store.saveIdentity(identity);

    const preKeys = await this.bridge.generatePreKeys(
      identity.identityRecord, SIGNED_PREKEY_ID, ONE_TIME_START_ID, ONE_TIME_BATCH, KYBER_PREKEY_ID,
    );
    await this.store.saveSignedPreKey(preKeys.signedPreKey.id, preKeys.signedPreKey.record);
    await this.store.saveKyberPreKey(preKeys.kyberPreKey.id, preKeys.kyberPreKey.record);
    await this.store.saveOneTimePreKeys(preKeys.preKeys.map((p) => ({ id: p.id, record: p.record })));

    // On garde les publics sous la main pour construire les invitations
    this.generatedPublics = preKeys;
    return identity;
  }

  /** Cache des publics du lot courant (reconstruit au besoin). */
  private generatedPublics: Awaited<ReturnType<SignalBridge['generatePreKeys']>> | null = null;

  /**
   * Construit le contenu d'un QR d'invitation. Consomme une one-time
   * prekey : chaque invitation affichee est a usage unique.
   */
  async createInvite(displayName: string): Promise<InvitePayload> {
    const identity = await this.ensureIdentity();
    if (!this.generatedPublics) {
      throw new Error('publics de prekeys indisponibles — regenerer un lot (rotation a venir)');
    }
    const oneTime = await this.store.takeOneTimePreKeyForInvite();
    const index = oneTime
      ? this.generatedPublics.preKeys.findIndex((p) => p.id === oneTime.id)
      : null;

    const bundle = makePreKeyBundle(
      identity.publicKey,
      identity.registrationId,
      1,
      this.generatedPublics,
      index === -1 ? null : index,
    );
    return {
      v: 1,
      displayName,
      address: identity.localAddress,
      identityKey: identity.publicKey,
      registrationId: identity.registrationId,
      bundle,
    };
  }

  /**
   * Cote scanneur : enregistre le contact (identite PINNEE ici, au
   * moment du scan physique) et etablit la session via son bundle.
   * Retourne l'id du contact cree.
   */
  async addContactFromInvite(invite: InvitePayload): Promise<string> {
    const identity = await this.ensureIdentity();
    const contactId = invite.address;
    await this.store.addContact({
      id: contactId,
      displayName: invite.displayName,
      identityKey: invite.identityKey,
    });
    const { session } = await this.bridge.processPreKeyBundle(
      identity.identityRecord,
      identity.registrationId,
      identity.localAddress,
      invite.address,
      invite.bundle,
    );
    await this.store.saveSession(contactId, session);
    return contactId;
  }

  /**
   * Cote invitant : enregistre le contact qui vient de nous ecrire
   * pour la premiere fois (ses infos publiques arrivent dans le
   * premier message dechiffre, couche protocole).
   */
  async addContactFromFirstContact(info: { address: string; displayName: string; identityKey: string }): Promise<string> {
    await this.store.addContact({
      id: info.address,
      displayName: info.displayName,
      identityKey: info.identityKey,
    });
    return info.address;
  }

  /** Chiffre pour un contact. Persiste l'etat de session mis a jour. */
  async encryptTo(contactId: string, plaintext: Uint8Array): Promise<Envelope> {
    const identity = await this.requireIdentity();
    const contact = await this.requireContact(contactId);
    if (!contact.sessionRecord) throw new Error(`pas de session avec ${contactId}`);

    const result = await this.bridge.encrypt(
      identity.identityRecord,
      identity.registrationId,
      identity.localAddress,
      contactId,
      contact.sessionRecord,
      toB64(plaintext),
    );
    await this.store.saveSession(contactId, result.session);
    return { type: result.type, body: result.body };
  }

  /** Dechiffre depuis un contact. Persiste session + prekeys consommees. */
  async decryptFrom(contactId: string, envelope: Envelope): Promise<Uint8Array> {
    const identity = await this.requireIdentity();
    const contact = await this.requireContact(contactId);

    if (envelope.type === CIPHERTEXT_PREKEY) {
      const localPreKeys = await this.store.getLocalPreKeyRecords();
      const result = await this.bridge.decryptPreKey(
        identity.identityRecord,
        identity.registrationId,
        identity.localAddress,
        contactId,
        contact.sessionRecord,
        envelope.body,
        localPreKeys,
      );
      await this.store.saveSession(contactId, result.session);
      if (result.usedPreKeyId !== null) {
        await this.store.markOneTimePreKeyUsed(result.usedPreKeyId);
      }
      return fromB64(result.plaintext);
    }

    if (!contact.sessionRecord) throw new Error(`message WHISPER sans session avec ${contactId}`);
    const result = await this.bridge.decryptWhisper(
      identity.identityRecord,
      identity.registrationId,
      identity.localAddress,
      contactId,
      contact.sessionRecord,
      envelope.body,
    );
    await this.store.saveSession(contactId, result.session);
    return fromB64(result.plaintext);
  }

  private async requireIdentity(): Promise<IdentityRow> {
    const identity = await this.store.getIdentity();
    if (!identity) throw new Error('identite non initialisee');
    return identity;
  }

  private async requireContact(contactId: string) {
    const contact = await this.store.getContact(contactId);
    if (!contact) throw new Error(`contact inconnu : ${contactId}`);
    return contact;
  }
}

// Conversions base64 sans dependre de Buffer (Hermes ne l'a pas).
function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return globalThis.btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
