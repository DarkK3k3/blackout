// blackout.ts — couche d'integration : relie stockage, sessions et
// transport, et expose a l'UI des operations de haut niveau.
//
// Regle : l'UI ne voit JAMAIS un record de session, une cle ou un
// ciphertext. Elle demande "envoie ce texte a ce contact" et recoit
// des messages en clair, deja dechiffres et deja persistes.

import type { BlackoutStore, LocationFix } from '../storage/store';
import { VerrouParCle } from './verrou';
import { SessionManager, type InvitePayload, type Envelope } from '../crypto/sessionManager';
import type { SignalBridge } from '../crypto/signalBridge.types';
import { RelayClient } from '../transport/relayClient';
import {
  encodeInviteQr,
  decodeInviteQr,
  inviteFingerprint,
  toSpokenCode,
  fromSpokenCode,
  type InviteReference,
} from '../crypto/inviteCode';
import { pairFingerprint, monthlyVerificationCode, currentYearMonth } from '../crypto/verification';
import type { ChatSummary } from '../ui/screens/ChatListScreen';
import type { ChatMessage } from '../ui/screens/ConversationScreen';
import { randomId, utf8Encode, utf8Decode, fromBase64 } from '../platform/runtime';

/** Charge utile du QR d'invitation : bundle crypto + boite de reponse. */
export interface InviteQr extends InvitePayload {
  inbox: { serverUrl: string; queueId: string; writeToken: string };
}

/** Contenu applicatif d'un message, chiffre avant d'atteindre le relais. */
interface MessagePayload {
  text?: string;
  photo?: string; // data URI, chiffree comme le reste
  /**
   * Position, chiffree exactement comme un message : le relais ne voit
   * qu'un blob. Aucune nouvelle cryptographie n'est introduite ici —
   * c'est la meme session libsignal que le texte.
   */
  location?: {
    latitude: number;
    longitude: number;
    accuracyM?: number;
    measuredAt: number;
    /** Echeance du partage en cours, pour que le destinataire sache quand ca s'arrete. */
    sharingUntil?: number;
    /** true = l'expediteur vient d'arreter son partage. */
    stopped?: boolean;
  };
  /** Present uniquement sur le tout premier message d'une relation. */
  hello?: {
    address: string;
    displayName: string;
    identityKey: string;
    inbox: { serverUrl: string; queueId: string; writeToken: string };
  };
}

// Aleatoire et encodages : via platform/runtime, jamais via les objets
// globaux — Hermes n'a ni `crypto`, ni `TextEncoder` garanti.
const newId = () => randomId(12);
const encode = utf8Encode;
const decode = utf8Decode;

export class Blackout {
  readonly sessions: SessionManager;
  private relay: RelayClient;
  private stopSubscription: (() => void) | null = null;
  private listeners: {
    onActivity: (conversationId: string) => void;
    onStatus?: (s: 'connected' | 'disconnected') => void;
  } | null = null;
  /** Serialise les envois par contact : voir `send`. */
  private readonly verrouEnvoi = new VerrouParCle();

  /**
   * La base ouverte, pour les ecrans qui la manipulent directement
   * (reglages). Expose en lecture seule : personne ne doit en ouvrir
   * une seconde.
   */
  get storeOuvert(): BlackoutStore {
    return this.store;
  }

  constructor(
    private store: BlackoutStore,
    bridge: SignalBridge,
    private serverUrl: string,
    private myDisplayName: string,
  ) {
    this.sessions = new SessionManager(bridge, store);
    this.relay = new RelayClient(serverUrl);
  }

  /**
   * Reglages enregistres (adresse du relais, nom affiche). Ils priment
   * sur les valeurs de compilation : changer de relais ne doit jamais
   * imposer de recompiler l'app.
   */
  static async loadSettings(
    store: BlackoutStore,
    defaults: { relayUrl: string; displayName: string },
  ): Promise<{ relayUrl: string; displayName: string }> {
    return {
      relayUrl: (await store.getSetting('relayUrl')) ?? defaults.relayUrl,
      displayName: (await store.getSetting('displayName')) ?? defaults.displayName,
    };
  }

  static async saveSettings(
    store: BlackoutStore,
    values: { relayUrl: string; displayName: string },
  ): Promise<void> {
    await store.setSetting('relayUrl', values.relayUrl.trim().replace(/\/+$/, ''));
    await store.setSetting('displayName', values.displayName.trim());
  }

  /** Verifie qu'une adresse repond comme un relais Blackout. */
  static async testRelay(url: string): Promise<void> {
    const clean = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(clean)) throw new Error("l'adresse doit commencer par https://");
    const res = await fetch(`${clean}/healthz`);
    if (!res.ok) throw new Error(`le serveur repond ${res.status}`);
    const body = await res.json();
    if (body?.ok !== true) throw new Error("ce serveur ne repond pas comme un relais Blackout");
  }

  async init(): Promise<void> {
    await this.sessions.ensureIdentity();
  }

  // ------------------------------------------------------------ contacts

  /**
   * Prepare une invitation.
   *
   * Le bundle (~3 Ko a cause de la cle post-quantique) ne tient PAS
   * dans un QR code : il est depose sur le relais, et le QR ne porte
   * qu'une reference + l'empreinte du contenu. Le scanneur verifiera
   * cette empreinte, donc le relais ne peut rien substituer.
   */
  async createInviteQr(): Promise<{
    payload: InviteQr;
    encoded: string;
    spokenCode: string;
    reference: InviteReference;
  }> {
    const invite = await this.sessions.createInvite(this.myDisplayName);
    const inbox = await this.relay.createQueue();
    const payload: InviteQr = {
      ...invite,
      inbox: { serverUrl: this.serverUrl, queueId: inbox.queueId, writeToken: inbox.writeToken },
    };
    // La boite est enregistree sans contact : elle sera rattachee au
    // premier expediteur qui s'en sert (une boite = un correspondant).
    await this.store.savePendingInbox(inbox.queueId, inbox.readToken, this.serverUrl);
    // Nouvelle boite : sans reabonnement, rien n'y serait recu avant le
    // prochain demarrage de l'application.
    await this.subscribeToAllInboxes();

    const json = JSON.stringify(payload);
    const inviteId = await this.relay.putInvite(json);
    const reference: InviteReference = {
      serverUrl: this.serverUrl,
      inviteId,
      fingerprint: inviteFingerprint(json),
    };
    return {
      payload,
      encoded: encodeInviteQr(reference),
      spokenCode: toSpokenCode(reference),
      reference,
    };
  }

  /**
   * Cote scanneur : recupere le bundle, VERIFIE son empreinte, puis
   * cree le contact, la session, et repond par un hello.
   */
  async acceptInviteQr(encoded: string): Promise<string> {
    return this.acceptInviteReference(decodeInviteQr(encoded));
  }

  /**
   * Meme chose a partir du code DICTE. Celui-ci ne contient pas
   * l'adresse du relais (trop longue a lire a voix haute) : on utilise
   * celle configuree, donc les deux personnes doivent partager le meme
   * relais — ce qui est le cas dans un groupe d'amis.
   */
  async acceptSpokenCode(code: string): Promise<string> {
    return this.acceptInviteReference(fromSpokenCode(code, this.serverUrl));
  }

  private async acceptInviteReference(reference: InviteReference): Promise<string> {
    const json = await RelayClient.getInvite(reference.serverUrl, reference.inviteId);

    // Verification anti-substitution : sans elle, un relais malveillant
    // pourrait glisser SON bundle et lire toute la conversation.
    if (inviteFingerprint(json) !== reference.fingerprint) {
      throw new Error(
        "empreinte invalide : le contenu recu ne correspond pas au QR scanne. Ne poursuis pas.",
      );
    }

    let invite: InviteQr;
    try {
      invite = JSON.parse(json);
    } catch {
      throw new Error('invitation illisible');
    }
    if (invite.v !== 1 || !invite.bundle || !invite.inbox) throw new Error("Ce n'est pas une invitation Blackout");

    const contactId = await this.sessions.addContactFromInvite(invite);
    const myInbox = await this.relay.createQueue();
    await this.store.saveQueues(contactId, {
      serverUrl: this.serverUrl,
      inQueueId: myInbox.queueId,
      inReadToken: myInbox.readToken,
      outQueueId: invite.inbox.queueId,
      outWriteToken: invite.inbox.writeToken,
    });
    await this.subscribeToAllInboxes();

    const identity = await this.store.getIdentity();
    await this.send(contactId, {
      text: `${this.myDisplayName} a rejoint la conversation.`,
      hello: {
        address: identity!.localAddress,
        displayName: this.myDisplayName,
        identityKey: identity!.publicKey,
        inbox: { serverUrl: this.serverUrl, queueId: myInbox.queueId, writeToken: myInbox.writeToken },
      },
    });
    return contactId;
  }

  // ------------------------------------------------------------ messages

  async sendText(contactId: string, text: string): Promise<void> {
    await this.send(contactId, { text });
  }

  /**
   * Envoi serialise par contact.
   *
   * Chiffrer FAIT AVANCER la session : deux envois simultanes vers le
   * meme contact partiraient du meme etat et le second ecraserait le
   * premier en base, rendant un message definitivement indechiffrable.
   * Le cas est devenu reel avec le partage de position en arriere-plan,
   * qu'iOS peut declencher pendant que l'app tourne deja.
   */
  private send(contactId: string, payload: MessagePayload): Promise<void> {
    return this.verrouEnvoi.executer(contactId, () => this._envoyer(contactId, payload));
  }

  private async _envoyer(contactId: string, payload: MessagePayload): Promise<void> {
    const queues = await this.store.getQueues(contactId);
    if (!queues?.outQueueId || !queues.outWriteToken) throw new Error('aucune boite de sortie pour ce contact');

    const identity = await this.store.getIdentity();
    const messageId = newId();
    // Persiste AVANT l'envoi : si le reseau tombe, le message reste
    // visible en "pending" et sera reessaye.
    if (payload.text) {
      await this.store.saveMessage({
        id: messageId,
        conversationId: contactId,
        senderContactId: null,
        kind: 'text',
        body: payload.text,
        sentAt: Date.now(),
        status: 'pending',
      });
    }

    const envelope = await this.sessions.encryptTo(contactId, encode(JSON.stringify(payload)));
    // Le premier message (PREKEY) porte l'adresse pseudonyme de
    // l'expediteur : libsignal lie les adresses a la session, le
    // destinataire en a besoin AVANT de pouvoir dechiffrer.
    const wire = JSON.stringify({ ...envelope, from: identity!.localAddress });
    await this.relay.post(queues.outQueueId, queues.outWriteToken, wire);
    if (payload.text) await this.store.setMessageStatus(messageId, 'sent');
  }

  /**
   * Traite un blob recu : dechiffre, cree/complete le contact si c'est
   * un premier contact, persiste le message. Retourne l'id de la
   * conversation touchee (ou null si le message n'etait pas exploitable).
   */
  async handleIncoming(queueId: string, blob: string): Promise<string | null> {
    const wire = JSON.parse(blob) as Envelope & { from?: string };
    let contactId = await this.store.findContactByInQueue(queueId);

    if (!contactId) {
      // Premier message sur une boite en attente : l'expediteur se
      // presente via `from`, on cree la fiche provisoire.
      if (!wire.from) return null;
      contactId = wire.from;
      if (!(await this.store.getContact(contactId))) {
        await this.store.addContact({ id: contactId, displayName: 'Inconnu', identityKey: '' });
      }
      await this.store.attachInboxToContact(queueId, contactId);
    }

    const plaintext = JSON.parse(decode(await this.sessions.decryptFrom(contactId, wire))) as MessagePayload;

    if (plaintext.hello) {
      // TOFU : on epingle la cle d'identite annoncee. La verification
      // out-of-band (code mensuel) reste a faire par l'utilisateur.
      await this.store.updateContactProfile(contactId, plaintext.hello.displayName, plaintext.hello.identityKey);
      const existing = await this.store.getQueues(contactId);
      await this.store.saveQueues(contactId, {
        serverUrl: plaintext.hello.inbox.serverUrl,
        inQueueId: existing?.inQueueId ?? queueId,
        inReadToken: existing?.inReadToken ?? (await this.store.getPendingInboxToken(queueId)) ?? '',
        outQueueId: plaintext.hello.inbox.queueId,
        outWriteToken: plaintext.hello.inbox.writeToken,
      });
    }

    if (plaintext.location) {
      const loc = plaintext.location;
      if (loc.stopped) {
        // Le contact a ferme son partage : on oublie sa position au
        // lieu de laisser un point perime sur la carte.
        await this.store.forgetLocation(contactId);
      } else {
        await this.store.saveLocation(contactId, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracyM: loc.accuracyM,
          measuredAt: loc.measuredAt,
        });
      }
    }

    if (plaintext.text) {
      await this.store.saveMessage({
        id: newId(),
        conversationId: contactId,
        senderContactId: contactId,
        kind: 'text',
        body: plaintext.text,
        sentAt: Date.now(),
        status: 'delivered',
      });
    }
    return contactId;
  }

  /** Ecoute toutes mes boites ; ack apres persistance locale. */
  async startListening(
    onActivity: (conversationId: string) => void,
    onStatus?: (s: 'connected' | 'disconnected') => void,
  ): Promise<void> {
    // Memorises pour pouvoir se reabonner quand une boite apparait.
    this.listeners = { onActivity, onStatus };
    await this.subscribeToAllInboxes();
  }

  /**
   * (Re)prend l'ecoute de TOUTES les boites connues.
   *
   * Indispensable apres la creation d'une boite : l'abonnement ne
   * couvrait que les boites existant au demarrage, si bien qu'un
   * contact fraichement ajoute ne recevait rien jusqu'au redemarrage
   * de l'application.
   */
  private async subscribeToAllInboxes(): Promise<void> {
    if (!this.listeners) return; // l'ecoute n'a pas encore ete demandee
    const { onActivity, onStatus } = this.listeners;
    const inboxes = await this.store.listInboxes();
    this.stopSubscription?.();
    this.stopSubscription = this.relay.subscribe(
      inboxes.map((i) => ({ queueId: i.queueId, readToken: i.readToken })),
      async (message, ack) => {
        try {
          const conversationId = await this.handleIncoming(message.queueId, message.blob);
          await ack(); // seulement APRES persistance : livraison au moins une fois
          if (conversationId) onActivity(conversationId);
        } catch {
          // message illisible (rejeu, corruption) : on n'acke pas,
          // il expirera par TTL cote relais.
        }
      },
      onStatus,
    );
  }

  stopListening(): void {
    this.stopSubscription?.();
    this.stopSubscription = null;
  }

  // --------------------------------------------------------- localisation
  //
  // Principes, volontairement restrictifs :
  //  - jamais de partage silencieux : chaque envoi est declenche par
  //    l'utilisateur ou par un partage qu'il a explicitement ouvert ;
  //  - jamais de partage illimite : toute session a une echeance, et
  //    elle s'arrete d'elle-meme ;
  //  - jamais d'historique : seule la derniere position est gardee ;
  //  - la position est chiffree comme un message ordinaire — le relais
  //    n'en voit rien. C'est toute la difference avec les applications
  //    de localisation familiale grand public, ou le serveur voit tout.

  /** Duree maximale d'un partage. Au-dela, il faut le relancer sciemment. */
  static readonly MAX_SHARING_MINUTES = 8 * 60;

  /** Envoi ponctuel : « voila ou je suis, maintenant ». */
  async sendLocationOnce(contactId: string, fix: Omit<LocationFix, 'measuredAt'> & { measuredAt?: number }): Promise<void> {
    await this.send(contactId, {
      location: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM,
        measuredAt: fix.measuredAt ?? Date.now(),
      },
    });
  }

  /**
   * Ouvre un partage continu, borne dans le temps. Retourne l'echeance.
   * Refuse toute duree nulle, negative ou superieure au maximum.
   */
  async startSharingLocation(contactId: string, minutes: number): Promise<number> {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error('duree de partage invalide');
    }
    const capped = Math.min(minutes, Blackout.MAX_SHARING_MINUTES);
    const until = Date.now() + capped * 60_000;
    await this.store.setSharingUntil(contactId, until);
    return until;
  }

  /** Ferme le partage et previent le contact, pour que son ecran soit juste. */
  async stopSharingLocation(contactId: string): Promise<void> {
    await this.store.stopSharing(contactId);
    await this.send(contactId, {
      location: { latitude: 0, longitude: 0, measuredAt: Date.now(), stopped: true },
    }).catch(() => {
      // Le contact sera de toute facon fixe par l'echeance : ne pas
      // faire echouer l'arret local si le reseau est coupe.
    });
  }

  /** Contacts vers qui un partage est encore ouvert. */
  async activeSharing(now = Date.now()): Promise<{ contactId: string; until: number }[]> {
    return this.store.listActiveSharing(now);
  }

  /**
   * Diffuse une position a tous les partages encore ouverts. Appelee
   * periodiquement par l'app tant qu'au moins un partage est actif.
   * Les partages expires sont ignores — donc s'arretent d'eux-memes.
   */
  async broadcastLocation(fix: Omit<LocationFix, 'measuredAt'> & { measuredAt?: number }): Promise<number> {
    const actifs = await this.store.listActiveSharing();
    let envoyes = 0;
    for (const { contactId, until } of actifs) {
      try {
        await this.send(contactId, {
          location: {
            latitude: fix.latitude,
            longitude: fix.longitude,
            accuracyM: fix.accuracyM,
            measuredAt: fix.measuredAt ?? Date.now(),
            sharingUntil: until,
          },
        });
        envoyes++;
      } catch {
        // Un contact injoignable ne doit pas bloquer les autres.
      }
    }
    return envoyes;
  }

  /** Dernieres positions connues des contacts, pour la carte. */
  async knownLocations(): Promise<
    { contactId: string; displayName: string; verified: boolean; fix: LocationFix }[]
  > {
    const [positions, contacts] = await Promise.all([
      this.store.listLocations(),
      this.store.listContacts(),
    ]);
    return positions.flatMap((p) => {
      const contact = contacts.find((c) => c.id === p.contactId);
      if (!contact) return [];
      return [
        {
          contactId: p.contactId,
          displayName: contact.displayName,
          verified: contact.verified,
          fix: {
            latitude: p.latitude,
            longitude: p.longitude,
            accuracyM: p.accuracyM,
            measuredAt: p.measuredAt,
          },
        },
      ];
    });
  }

  /** Oublie la derniere position connue d'un contact. */
  async forgetLocation(contactId: string): Promise<void> {
    await this.store.forgetLocation(contactId);
  }

  // ------------------------------------------------------------ lectures

  async listChats(): Promise<ChatSummary[]> {
    const contacts = await this.store.listContacts();
    const chats: ChatSummary[] = [];
    for (const c of contacts) {
      const messages = await this.store.listMessages(c.id, 1);
      const last = messages[messages.length - 1];
      chats.push({
        id: c.id,
        title: c.displayName,
        kind: 'direct',
        lastMessage: last?.body ?? null,
        lastAt: last?.sentAt ?? null,
        verified: c.verified,
        // Sert a dessiner l'empreinte visuelle du contact : elle change
        // si la cle change, donc une usurpation se voit.
        identityKey: c.identityKey,
      });
    }
    return chats.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  }

  async listMessages(contactId: string): Promise<ChatMessage[]> {
    const rows = await this.store.listMessages(contactId);
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      mine: r.senderContactId === null,
      sentAt: r.sentAt,
      status: r.status,
    }));
  }

  /** Code de verification du mois — calcul pur, aucun effet de bord. */
  async verificationFor(contactId: string, now = new Date()) {
    const identity = await this.store.getIdentity();
    const contact = await this.store.getContact(contactId);
    if (!identity || !contact?.identityKey) throw new Error('identites incompletes pour la verification');

    const fingerprint = pairFingerprint(b64(identity.publicKey), b64(contact.identityKey));
    const yearMonth = currentYearMonth(now);
    return {
      code: monthlyVerificationCode(fingerprint, yearMonth),
      yearMonth,
      fingerprintHex: Array.from(fingerprint, (x) => x.toString(16).padStart(2, '0')).join(''),
      verified: contact.verified,
    };
  }

  async markVerified(contactId: string): Promise<void> {
    await this.store.setContactVerified(contactId, true);
  }
}

const b64 = fromBase64;
