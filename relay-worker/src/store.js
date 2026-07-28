// store.js — les queues et les invitations, stockees en SQL.
//
// C'est le portage du store du relais Node (relay-server/src/store.js)
// vers une base SQLite. Le modele ne change pas d'un iota :
//
//  - une queue = une boite aux lettres UNIDIRECTIONNELLE creee par le
//    destinataire, qui garde le readToken et confie (queueId +
//    writeToken) a UN expediteur ;
//  - le serveur ne stocke que des blobs opaques, deja chiffres de bout
//    en bout par l'app ;
//  - les tokens ne sont jamais stockes en clair, seulement leur
//    empreinte SHA-256.
//
// Volontairement ecrit sans AUCUNE API propre a Cloudflare : le code
// recoit un objet `sql` qui expose `exec(requete, ...parametres)`. Sur
// Cloudflare c'est `ctx.storage.sql` ; dans les tests c'est `node:sqlite`
// derriere un adaptateur de vingt lignes. La logique testee est donc
// exactement celle qui tourne en production.

const DEFAULT_MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const DEFAULT_MAX_MESSAGES_PER_QUEUE = 1000;
const DEFAULT_MAX_INVITE_BYTES = 16 * 1024;

// SQLite dans un Durable Object refuse toute ligne de plus de 2 Mo.
// Un message texte en fait quelques centaines d'octets, mais une photo
// chiffree peut peser plusieurs Mo : les blobs sont donc decoupes en
// morceaux ranges dans une table a part, puis recolles a la lecture.
// 600 000 caracteres laissent une marge confortable sous la limite.
export const CHUNK_CHARS = 600_000;

// Meme alphabet Crockford que le client (app/src/crypto/inviteCode.ts) :
// 32 caracteres exactement, sans I, L, O ni U — un code d'invitation
// doit pouvoir etre dicte a l'oral puis retape sans ambiguite.
const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const INVITE_ID_LENGTH = 16; // ~80 bits

const SCHEMA = `
CREATE TABLE IF NOT EXISTS queues (
  id TEXT PRIMARY KEY,
  read_hash TEXT NOT NULL,
  write_hash TEXT NOT NULL
);
-- La colonne seq n'est pas decorative : plusieurs messages peuvent etre deposes
-- dans la MEME milliseconde, et trier sur l'horodatage seul les rend
-- alors dans un ordre arbitraire (defaut constate en test). SQLite
-- attribue a cette colonne des valeurs strictement croissantes, ce qui
-- restitue l'ordre de depot exact.
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  queue_id TEXT NOT NULL,
  posted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  part TEXT NOT NULL,
  PRIMARY KEY (message_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_messages_queue ON messages (queue_id, seq);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

// --- petits utilitaires portables (Workers ET Node) ---

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/**
 * Comparaison a temps constant.
 *
 * On compare des empreintes, pas des secrets ; mais sortir de la boucle
 * au premier caractere different renseignerait quand meme un attaquant
 * sur sa progression. Le cout d'une boucle complete est nul ici.
 */
function equalsConstantTime(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomInviteId() {
  const bytes = randomBytes(INVITE_ID_LENGTH);
  let out = '';
  // 256 n'est pas un multiple de 32 ? Si : 32 divise 256, donc le modulo
  // ne biaise pas la distribution.
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return out;
}

function utf8Length(s) {
  return new TextEncoder().encode(s).length;
}

export class RelayStore {
  /**
   * @param {{exec: (q: string, ...p: any[]) => {toArray: () => any[]}}} sql
   */
  constructor(sql, opts = {}) {
    this.sql = sql;
    this.messageTtlMs = opts.messageTtlMs ?? DEFAULT_MESSAGE_TTL_MS;
    this.inviteTtlMs = opts.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
    this.maxMessagesPerQueue = opts.maxMessagesPerQueue ?? DEFAULT_MAX_MESSAGES_PER_QUEUE;
    this.maxInviteBytes = opts.maxInviteBytes ?? DEFAULT_MAX_INVITE_BYTES;
    this.sql.exec(SCHEMA);
  }

  // --- queues ---

  async createQueue() {
    const queueId = toHex(randomBytes(16));
    const readToken = toBase64Url(randomBytes(24));
    const writeToken = toBase64Url(randomBytes(24));
    this.sql.exec(
      'INSERT INTO queues (id, read_hash, write_hash) VALUES (?, ?, ?)',
      queueId,
      await hashToken(readToken),
      await hashToken(writeToken),
    );
    // Les tokens en clair ne sont retournes qu'ici, une seule fois.
    return { queueId, readToken, writeToken };
  }

  async _authorize(queueId, token, column) {
    const rows = this.sql.exec('SELECT read_hash, write_hash FROM queues WHERE id = ?', queueId).toArray();
    if (rows.length === 0) return 'not_found';
    const expected = column === 'read' ? rows[0].read_hash : rows[0].write_hash;
    return equalsConstantTime(await hashToken(token), expected) ? 'ok' : 'forbidden';
  }

  async post(queueId, writeToken, blob, id = toHex(randomBytes(12))) {
    const auth = await this._authorize(queueId, writeToken, 'write');
    if (auth !== 'ok') return { status: auth };

    const count = this.sql
      .exec('SELECT COUNT(*) AS n FROM messages WHERE queue_id = ?', queueId)
      .toArray()[0].n;
    if (count >= this.maxMessagesPerQueue) return { status: 'full' };

    const postedAt = Date.now();
    this.sql.exec('INSERT INTO messages (id, queue_id, posted_at) VALUES (?, ?, ?)', id, queueId, postedAt);
    for (let seq = 0, offset = 0; offset < blob.length; seq += 1, offset += CHUNK_CHARS) {
      this.sql.exec(
        'INSERT INTO chunks (message_id, seq, part) VALUES (?, ?, ?)',
        id,
        seq,
        blob.slice(offset, offset + CHUNK_CHARS),
      );
    }
    return { status: 'ok', message: { id, blob, postedAt } };
  }

  /** Liste les messages en attente SANS les supprimer : l'ack est explicite. */
  async fetch(queueId, readToken) {
    const auth = await this._authorize(queueId, readToken, 'read');
    if (auth !== 'ok') return { status: auth };
    this._purgeExpiredMessages();

    const rows = this.sql
      .exec('SELECT id, posted_at FROM messages WHERE queue_id = ? ORDER BY seq', queueId)
      .toArray();
    const messages = rows.map((r) => ({
      id: r.id,
      blob: this._readBlob(r.id),
      postedAt: r.posted_at,
    }));
    return { status: 'ok', messages };
  }

  _readBlob(messageId) {
    const parts = this.sql
      .exec('SELECT part FROM chunks WHERE message_id = ? ORDER BY seq', messageId)
      .toArray();
    return parts.map((p) => p.part).join('');
  }

  /** Ack : le destinataire confirme la reception -> suppression definitive. */
  async ack(queueId, readToken, messageId) {
    const auth = await this._authorize(queueId, readToken, 'read');
    if (auth !== 'ok') return { status: auth };
    this.sql.exec('DELETE FROM chunks WHERE message_id = ?', messageId);
    this.sql.exec('DELETE FROM messages WHERE id = ? AND queue_id = ?', messageId, queueId);
    return { status: 'ok' };
  }

  /** Le destinataire peut detruire sa boite (rupture de contact). */
  async deleteQueue(queueId, readToken) {
    const auth = await this._authorize(queueId, readToken, 'read');
    if (auth !== 'ok') return { status: auth };
    this.sql.exec(
      'DELETE FROM chunks WHERE message_id IN (SELECT id FROM messages WHERE queue_id = ?)',
      queueId,
    );
    this.sql.exec('DELETE FROM messages WHERE queue_id = ?', queueId);
    this.sql.exec('DELETE FROM queues WHERE id = ?', queueId);
    return { status: 'ok' };
  }

  /** Verifie un readToken sans toucher aux messages (authentification WebSocket). */
  async canRead(queueId, readToken) {
    return (await this._authorize(queueId, readToken, 'read')) === 'ok';
  }

  // --- invitations (contenu PUBLIC, verifie par empreinte cote client) ---

  async putInvite(blob) {
    if (typeof blob !== 'string' || blob.length === 0) return { status: 'bad_request' };
    if (utf8Length(blob) > this.maxInviteBytes) return { status: 'too_large' };
    this._purgeExpiredInvites();
    const inviteId = randomInviteId();
    this.sql.exec('INSERT INTO invites (id, blob, created_at) VALUES (?, ?, ?)', inviteId, blob, Date.now());
    return { status: 'ok', inviteId };
  }

  async getInvite(inviteId) {
    this._purgeExpiredInvites();
    const rows = this.sql.exec('SELECT blob FROM invites WHERE id = ?', inviteId).toArray();
    if (rows.length === 0) return { status: 'not_found' };
    return { status: 'ok', blob: rows[0].blob };
  }

  // --- expiration ---

  purgeExpired() {
    this._purgeExpiredMessages();
    this._purgeExpiredInvites();
  }

  _purgeExpiredMessages() {
    const cutoff = Date.now() - this.messageTtlMs;
    this.sql.exec(
      'DELETE FROM chunks WHERE message_id IN (SELECT id FROM messages WHERE posted_at < ?)',
      cutoff,
    );
    this.sql.exec('DELETE FROM messages WHERE posted_at < ?', cutoff);
  }

  _purgeExpiredInvites() {
    this.sql.exec('DELETE FROM invites WHERE created_at < ?', Date.now() - this.inviteTtlMs);
  }
}
