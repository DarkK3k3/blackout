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

import type { SignalBridge, PreKeyBundleJson, PreKeyPublics } from './signalBridge.types';
import { CIPHERTEXT_PREKEY, makePreKeyBundle } from './signalBridge.types';
import type { BlackoutStore, IdentityRow } from '../storage/store';
import { uuidV4, toBase64, fromBase64 } from '../platform/runtime';

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

const ONE_TIME_BATCH = 20;
/** Espacement des identifiants entre deux lots, pour eviter les collisions. */
const ONE_TIME_ID_STRIDE = 1000;
const PREKEY_PUBLICS_KEY = 'preKeyPublics';
const PREKEY_BATCH_KEY = 'preKeyBatch';

// L'aleatoire et les encodages passent par platform/runtime : Hermes ne
// fournit ni `crypto`, ni `btoa`/`atob`, contrairement a Node.
const uuid = uuidV4;

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

    await this.generatePreKeyBatch(identity, 1);
    return identity;
  }

  /** Cache en memoire du lot courant. Voir ensurePreKeyPublics(). */
  private generatedPublics: PreKeyPublics | null = null;

  /**
   * Genere un lot de prekeys, range les records prives en base et
   * PERSISTE les parties publiques.
   *
   * Ces publics sont indispensables pour fabriquer un QR d'invitation.
   * Ils n'etaient auparavant gardes qu'en memoire vive : au premier
   * lancement tout marchait, mais apres chaque redemarrage de l'app
   * l'ajout de contact devenait impossible.
   */
  private async generatePreKeyBatch(identity: IdentityRow, batchNumber: number): Promise<PreKeyPublics> {
    const batch = await this.bridge.generatePreKeys(
      identity.identityRecord,
      batchNumber,
      batchNumber * ONE_TIME_ID_STRIDE,
      ONE_TIME_BATCH,
      batchNumber,
    );
    await this.store.saveSignedPreKey(batch.signedPreKey.id, batch.signedPreKey.record);
    await this.store.saveKyberPreKey(batch.kyberPreKey.id, batch.kyberPreKey.record);
    await this.store.saveOneTimePreKeys(batch.preKeys.map((p) => ({ id: p.id, record: p.record })));

    // On ne persiste QUE le public : les parties privees vivent deja
    // dans leurs tables dediees.
    const publics: PreKeyPublics = {
      signedPreKey: {
        id: batch.signedPreKey.id,
        publicKey: batch.signedPreKey.publicKey,
        signature: batch.signedPreKey.signature,
      },
      preKeys: batch.preKeys.map((p) => ({ id: p.id, publicKey: p.publicKey })),
      kyberPreKey: {
        id: batch.kyberPreKey.id,
        publicKey: batch.kyberPreKey.publicKey,
        signature: batch.kyberPreKey.signature,
      },
    };
    await this.store.setSetting(PREKEY_PUBLICS_KEY, JSON.stringify(publics));
    await this.store.setSetting(PREKEY_BATCH_KEY, String(batchNumber));
    this.generatedPublics = publics;
    return publics;
  }

  /**
   * Retrouve les publics du lot courant : memoire vive, sinon base,
   * sinon nouveau lot. Un nouveau lot ne change PAS l'identite : les
   * conversations en cours ne sont pas affectees.
   */
  private async ensurePreKeyPublics(identity: IdentityRow): Promise<PreKeyPublics> {
    if (this.generatedPublics) return this.generatedPublics;

    const stored = await this.store.getSetting(PREKEY_PUBLICS_KEY);
    if (stored) {
      this.generatedPublics = JSON.parse(stored) as PreKeyPublics;
      return this.generatedPublics;
    }

    const previous = Number((await this.store.getSetting(PREKEY_BATCH_KEY)) ?? '0');
    return this.generatePreKeyBatch(identity, previous + 1);
  }

  /**
   * Construit le contenu d'un QR d'invitation. Consomme une one-time
   * prekey : chaque invitation affichee est a usage unique.
   */
  async createInvite(displayName: string): Promise<InvitePayload> {
    const identity = await this.ensureIdentity();
    let publics = await this.ensurePreKeyPublics(identity);

    let oneTime = await this.store.takeOneTimePreKeyForInvite();
    if (!oneTime) {
      // Lot epuise : on en genere un nouveau plutot que de rediffuser
      // une prekey deja distribuee.
      const previous = Number((await this.store.getSetting(PREKEY_BATCH_KEY)) ?? '0');
      publics = await this.generatePreKeyBatch(identity, previous + 1);
      oneTime = await this.store.takeOneTimePreKeyForInvite();
    }
    const index = oneTime ? publics.preKeys.findIndex((p) => p.id === oneTime.id) : null;

    const bundle = makePreKeyBundle(
      identity.publicKey,
      identity.registrationId,
      1,
      publics,
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

const toB64 = toBase64;
const fromB64 = fromBase64;
