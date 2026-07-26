// blackout.ts — couche d'integration : relie stockage, sessions et
// transport, et expose a l'UI des operations de haut niveau.
//
// Regle : l'UI ne voit JAMAIS un record de session, une cle ou un
// ciphertext. Elle demande "envoie ce texte a ce contact" et recoit
// des messages en clair, deja dechiffres et deja persistes.

import type { BlackoutStore } from '../storage/store';
import { SessionManager, type InvitePayload, type Envelope } from '../crypto/sessionManager';
import type { SignalBridge } from '../crypto/signalBridge.types';
import { RelayClient } from '../transport/relayClient';
import { pairFingerprint, monthlyVerificationCode, currentYearMonth } from '../crypto/verification';
import type { ChatSummary } from '../ui/screens/ChatListScreen';
import type { ChatMessage } from '../ui/screens/ConversationScreen';

/** Charge utile du QR d'invitation : bundle crypto + boite de reponse. */
export interface InviteQr extends InvitePayload {
  inbox: { serverUrl: string; queueId: string; writeToken: string };
}

/** Contenu applicatif d'un message, chiffre avant d'atteindre le relais. */
interface MessagePayload {
  text?: string;
  photo?: string; // data URI, chiffree comme le reste
  /** Present uniquement sur le tout premier message d'une relation. */
  hello?: {
    address: string;
    displayName: string;
    identityKey: string;
    inbox: { serverUrl: string; queueId: string; writeToken: string };
  };
}

function newId(): string {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

export class Blackout {
  readonly sessions: SessionManager;
  private relay: RelayClient;
  private stopSubscription: (() => void) | null = null;

  constructor(
    private store: BlackoutStore,
    bridge: SignalBridge,
    private serverUrl: string,
    private myDisplayName: string,
  ) {
    this.sessions = new SessionManager(bridge, store);
    this.relay = new RelayClient(serverUrl);
  }

  async init(): Promise<void> {
    await this.sessions.ensureIdentity();
  }

  // ------------------------------------------------------------ contacts

  /** Genere le QR d'invitation : bundle X3DH + une boite de reponse dediee. */
  async createInviteQr(): Promise<{ payload: InviteQr; encoded: string }> {
    const invite = await this.sessions.createInvite(this.myDisplayName);
    const inbox = await this.relay.createQueue();
    const payload: InviteQr = {
      ...invite,
      inbox: { serverUrl: this.serverUrl, queueId: inbox.queueId, writeToken: inbox.writeToken },
    };
    // La boite est enregistree sans contact : elle sera rattachee au
    // premier expediteur qui s'en sert (une boite = un correspondant).
    await this.store.savePendingInbox(inbox.queueId, inbox.readToken, this.serverUrl);
    return { payload, encoded: JSON.stringify(payload) };
  }

  /** Cote scanneur : cree le contact, la session, et repond par un hello. */
  async acceptInviteQr(encoded: string): Promise<string> {
    let invite: InviteQr;
    try {
      invite = JSON.parse(encoded);
    } catch {
      throw new Error('QR code illisible');
    }
    if (invite.v !== 1 || !invite.bundle || !invite.inbox) throw new Error("Ce QR n'est pas une invitation Blackout");

    const contactId = await this.sessions.addContactFromInvite(invite);
    const myInbox = await this.relay.createQueue();
    await this.store.saveQueues(contactId, {
      serverUrl: this.serverUrl,
      inQueueId: myInbox.queueId,
      inReadToken: myInbox.readToken,
      outQueueId: invite.inbox.queueId,
      outWriteToken: invite.inbox.writeToken,
    });

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

  private async send(contactId: string, payload: MessagePayload): Promise<void> {
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

function b64(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
