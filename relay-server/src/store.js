// store.js
// ------------------------------------------------------------------
// Stockage des queues, modele "simplex queue" (inspire de SimpleX) :
//
//  - Une queue = une boite aux lettres UNIDIRECTIONNELLE creee par le
//    DESTINATAIRE. Le destinataire garde le readToken, transmet
//    l'adresse (queueId + writeToken) a UN expediteur via QR code.
//  - Le serveur ne stocke que des blobs opaques (deja chiffres de
//    bout en bout par l'app). Il ne connait ni identite, ni contact,
//    ni contenu : juste "des octets en attente dans la boite X".
//  - Deux personnes qui discutent = deux queues independantes (une
//    par sens), sans lien exploitable entre elles cote serveur.
//
// Confidentialite :
//  - Les tokens ne sont JAMAIS stockes en clair : on ne garde que
//    leur hash SHA-256. Un vol du fichier de persistance ne permet
//    donc ni de lire (les blobs sont chiffres E2E) ni d'ecrire.
//  - Aucun timestamp de creation de queue conserve au-dela du
//    necessaire (TTL), aucun compteur par IP, aucun log d'acces.
// ------------------------------------------------------------------

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const DEFAULT_MAX_MESSAGES_PER_QUEUE = 1000;

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tokenMatches(candidate, storedHashHex) {
  const a = Buffer.from(hashToken(candidate), 'hex');
  const b = Buffer.from(storedHashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Depot d'invitations.
 *
 * Le bundle de prekeys (dont la cle post-quantique Kyber) pese ~3 Ko :
 * trop pour tenir dans un QR code, qui plafonne a 2953 octets. On le
 * depose donc ici, et le QR ne transporte qu'une reference courte
 * accompagnee de l'EMPREINTE du contenu.
 *
 * Le relais ne devient PAS une autorite de confiance pour autant : le
 * scanneur verifie que ce qu'il telecharge correspond a l'empreinte
 * lue sur le QR. Un relais malveillant qui substituerait un bundle
 * serait detecte immediatement.
 *
 * Le contenu est public (cles publiques et signatures) : pas d'auth en
 * lecture. Duree de vie courte, taille bornee.
 */
/**
 * Alphabet des identifiants d'invitation : majuscules et chiffres, sans
 * les caracteres qu'on confond a l'oral ou a l'ecrit (0/O, 1/I/L).
 *
 * Ce choix n'est pas cosmetique : le code d'invitation doit pouvoir
 * etre DICTE puis retape. Un identifiant en base64 (sensible a la
 * casse, avec des tirets et underscores) ne survit pas a ce
 * passage — les caracteres sont perdus a la normalisation.
 */
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const INVITE_ID_LENGTH = 16; // ~78 bits, largement assez

function randomInviteId() {
  const bytes = randomBytes(INVITE_ID_LENGTH);
  let out = '';
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return out;
}

export class InviteStore {
  constructor(opts = {}) {
    this.ttlMs = opts.inviteTtlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 jours
    this.maxBytes = opts.maxInviteBytes ?? 16 * 1024;
    /** @type {Map<string, {blob: string, createdAt: number}>} */
    this.invites = new Map();
  }

  put(blob) {
    if (typeof blob !== 'string' || blob.length === 0) return { status: 'bad_request' };
    if (Buffer.byteLength(blob, 'utf8') > this.maxBytes) return { status: 'too_large' };
    this._purgeExpired();
    const inviteId = randomInviteId();
    this.invites.set(inviteId, { blob, createdAt: Date.now() });
    return { status: 'ok', inviteId };
  }

  get(inviteId) {
    this._purgeExpired();
    const entry = this.invites.get(inviteId);
    if (!entry) return { status: 'not_found' };
    return { status: 'ok', blob: entry.blob };
  }

  _purgeExpired() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.invites) {
      if (entry.createdAt < cutoff) this.invites.delete(id);
    }
  }
}

export class QueueStore {
  /**
   * @param {{ dataFile?: string|null, messageTtlMs?: number, maxMessagesPerQueue?: number }} [opts]
   *   dataFile : chemin d'un snapshot JSON pour survivre aux redemarrages
   *   (null = purement en memoire, utile pour les tests).
   */
  constructor(opts = {}) {
    this.dataFile = opts.dataFile ?? null;
    this.messageTtlMs = opts.messageTtlMs ?? DEFAULT_MESSAGE_TTL_MS;
    this.maxMessagesPerQueue = opts.maxMessagesPerQueue ?? DEFAULT_MAX_MESSAGES_PER_QUEUE;
    /** @type {Map<string, {readTokenHash: string, writeTokenHash: string, messages: {id: string, blob: string, postedAt: number}[]}>} */
    this.queues = new Map();
    this._saveTimer = null;
    if (this.dataFile) this._load();
  }

  createQueue() {
    const queueId = randomBytes(16).toString('hex');
    const readToken = randomBytes(24).toString('base64url');
    const writeToken = randomBytes(24).toString('base64url');
    this.queues.set(queueId, {
      readTokenHash: hashToken(readToken),
      writeTokenHash: hashToken(writeToken),
      messages: [],
    });
    this._scheduleSave();
    // Les tokens en clair ne sont retournes qu'ici, une seule fois.
    return { queueId, readToken, writeToken };
  }

  /** @returns {'ok'|'not_found'|'forbidden'|'full'} */
  post(queueId, writeToken, blob, id = randomBytes(12).toString('hex')) {
    const q = this.queues.get(queueId);
    if (!q) return { status: 'not_found' };
    if (!tokenMatches(writeToken, q.writeTokenHash)) return { status: 'forbidden' };
    if (q.messages.length >= this.maxMessagesPerQueue) return { status: 'full' };
    const message = { id, blob, postedAt: Date.now() };
    q.messages.push(message);
    this._scheduleSave();
    return { status: 'ok', message };
  }

  /** Liste les messages en attente (sans les supprimer : ack explicite). */
  fetch(queueId, readToken) {
    const q = this.queues.get(queueId);
    if (!q) return { status: 'not_found' };
    if (!tokenMatches(readToken, q.readTokenHash)) return { status: 'forbidden' };
    this._purgeExpired(q);
    return { status: 'ok', messages: q.messages };
  }

  /** Ack : le destinataire confirme la reception -> suppression definitive. */
  ack(queueId, readToken, messageId) {
    const q = this.queues.get(queueId);
    if (!q) return { status: 'not_found' };
    if (!tokenMatches(readToken, q.readTokenHash)) return { status: 'forbidden' };
    const before = q.messages.length;
    q.messages = q.messages.filter((m) => m.id !== messageId);
    if (q.messages.length !== before) this._scheduleSave();
    return { status: 'ok' };
  }

  /** Le destinataire peut detruire sa queue (rupture de contact). */
  deleteQueue(queueId, readToken) {
    const q = this.queues.get(queueId);
    if (!q) return { status: 'not_found' };
    if (!tokenMatches(readToken, q.readTokenHash)) return { status: 'forbidden' };
    this.queues.delete(queueId);
    this._scheduleSave();
    return { status: 'ok' };
  }

  /** Verifie un readToken sans toucher aux messages (auth WebSocket). */
  canRead(queueId, readToken) {
    const q = this.queues.get(queueId);
    return Boolean(q && tokenMatches(readToken, q.readTokenHash));
  }

  purgeAllExpired() {
    for (const [queueId, q] of this.queues) {
      this._purgeExpired(q);
      // Une queue vide n'est pas supprimee : elle reste une boite valide.
      void queueId;
    }
  }

  _purgeExpired(q) {
    const cutoff = Date.now() - this.messageTtlMs;
    const before = q.messages.length;
    q.messages = q.messages.filter((m) => m.postedAt >= cutoff);
    if (q.messages.length !== before) this._scheduleSave();
  }

  // --- persistance snapshot (debounce, ecriture atomique) ---

  _load() {
    if (!existsSync(this.dataFile)) return;
    const raw = JSON.parse(readFileSync(this.dataFile, 'utf8'));
    for (const [queueId, q] of Object.entries(raw.queues ?? {})) {
      this.queues.set(queueId, q);
    }
  }

  _scheduleSave() {
    if (!this.dataFile || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, 500);
    this._saveTimer.unref?.();
  }

  saveNow() {
    if (!this.dataFile) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    mkdirSync(dirname(this.dataFile), { recursive: true });
    const tmp = `${this.dataFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ queues: Object.fromEntries(this.queues) }));
    renameSync(tmp, this.dataFile);
  }
}
