// store.ts
// ------------------------------------------------------------------
// Depots de donnees de Blackout, au-dessus de SqlExecutor.
// Aucune crypto ici : uniquement de la persistance typee.
// ------------------------------------------------------------------

import type { SqlExecutor, SqlValue } from './sql';
import { migrate } from './sql';

export interface IdentityRow {
  identityRecord: string;
  publicKey: string;
  registrationId: number;
  localAddress: string;
}

export interface ContactRow {
  id: string;
  displayName: string;
  identityKey: string;
  verified: boolean;
  sessionRecord: string | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderContactId: string | null;
  kind: 'text' | 'photo';
  body: string;
  sentAt: number;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
}

/** Un point de position. Jamais historise : seule la derniere vaut. */
export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Precision en metres telle que rapportee par le GPS. */
  accuracyM?: number;
  measuredAt: number;
}

export interface LocalPreKeyRecords {
  signedPreKeyRecord: string;
  kyberPreKeyRecord: string;
  preKeyRecords: string[];
}

export class BlackoutStore {
  constructor(private db: SqlExecutor) {}

  static async open(db: SqlExecutor): Promise<BlackoutStore> {
    await migrate(db);
    return new BlackoutStore(db);
  }

  // --- identite ---

  async getIdentity(): Promise<IdentityRow | null> {
    const { rows } = await this.db.execute('SELECT * FROM identity WHERE id = 1');
    if (!rows[0]) return null;
    return {
      identityRecord: String(rows[0].identity_record),
      publicKey: String(rows[0].public_key),
      registrationId: Number(rows[0].registration_id),
      localAddress: String(rows[0].local_address),
    };
  }

  async saveIdentity(row: IdentityRow): Promise<void> {
    await this.db.execute(
      'INSERT INTO identity (id, identity_record, public_key, registration_id, local_address) VALUES (1, ?, ?, ?, ?)',
      [row.identityRecord, row.publicKey, row.registrationId, row.localAddress],
    );
  }

  // --- prekeys ---

  async saveSignedPreKey(id: number, record: string): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO signed_prekeys (id, record) VALUES (?, ?)', [id, record]);
  }

  async saveKyberPreKey(id: number, record: string): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO kyber_prekeys (id, record) VALUES (?, ?)', [id, record]);
  }

  async saveOneTimePreKeys(entries: { id: number; record: string }[]): Promise<void> {
    for (const e of entries) {
      await this.db.execute('INSERT OR REPLACE INTO one_time_prekeys (id, record, used) VALUES (?, ?, 0)', [e.id, e.record]);
    }
  }

  /** Records locaux necessaires pour dechiffrer un message PREKEY entrant. */
  async getLocalPreKeyRecords(): Promise<LocalPreKeyRecords> {
    const spk = await this.db.execute('SELECT record FROM signed_prekeys ORDER BY id DESC LIMIT 1');
    const kyber = await this.db.execute('SELECT record FROM kyber_prekeys ORDER BY id DESC LIMIT 1');
    const otp = await this.db.execute('SELECT record FROM one_time_prekeys WHERE used = 0');
    if (!spk.rows[0] || !kyber.rows[0]) throw new Error('prekeys locales absentes — identite non initialisee ?');
    return {
      signedPreKeyRecord: String(spk.rows[0].record),
      kyberPreKeyRecord: String(kyber.rows[0].record),
      preKeyRecords: otp.rows.map((r) => String(r.record)),
    };
  }

  /**
   * Reserve la prochaine one-time prekey pour un QR d'invitation.
   * La marque aussitot reservee, sinon toutes les invitations
   * distribueraient la MEME prekey — ce qui contredirait la promesse
   * « usage unique » et affaiblirait la confidentialite persistante du
   * tout premier message.
   */
  async takeOneTimePreKeyForInvite(): Promise<{ id: number; record: string } | null> {
    const { rows } = await this.db.execute(
      'SELECT id, record FROM one_time_prekeys WHERE used = 0 AND reserved = 0 ORDER BY id LIMIT 1',
    );
    if (!rows[0]) return null;
    const id = Number(rows[0].id);
    await this.db.execute('UPDATE one_time_prekeys SET reserved = 1 WHERE id = ?', [id]);
    return { id, record: String(rows[0].record) };
  }

  async markOneTimePreKeyUsed(id: number): Promise<void> {
    await this.db.execute('UPDATE one_time_prekeys SET used = 1 WHERE id = ?', [id]);
  }

  async countUnusedOneTimePreKeys(): Promise<number> {
    const { rows } = await this.db.execute('SELECT COUNT(*) AS n FROM one_time_prekeys WHERE used = 0');
    return Number(rows[0].n);
  }

  // --- contacts ---

  async addContact(c: { id: string; displayName: string; identityKey: string }): Promise<void> {
    await this.db.execute(
      'INSERT INTO contacts (id, display_name, identity_key, verified, session_record, created_at) VALUES (?, ?, ?, 0, NULL, ?)',
      [c.id, c.displayName, c.identityKey, Date.now()],
    );
    await this.db.execute(
      "INSERT INTO conversations (id, kind, title, created_at) VALUES (?, 'direct', ?, ?)",
      [c.id, c.displayName, Date.now()],
    );
  }

  async getContact(id: string): Promise<ContactRow | null> {
    const { rows } = await this.db.execute('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!rows[0]) return null;
    return {
      id: String(rows[0].id),
      displayName: String(rows[0].display_name),
      identityKey: String(rows[0].identity_key),
      verified: Boolean(rows[0].verified),
      sessionRecord: rows[0].session_record === null ? null : String(rows[0].session_record),
    };
  }

  async listContacts(): Promise<ContactRow[]> {
    const { rows } = await this.db.execute('SELECT * FROM contacts ORDER BY display_name');
    return rows.map((r) => ({
      id: String(r.id),
      displayName: String(r.display_name),
      identityKey: String(r.identity_key),
      verified: Boolean(r.verified),
      sessionRecord: r.session_record === null ? null : String(r.session_record),
    }));
  }

  async saveSession(contactId: string, sessionRecord: string): Promise<void> {
    await this.db.execute('UPDATE contacts SET session_record = ? WHERE id = ?', [sessionRecord, contactId]);
  }

  /**
   * Complete la fiche d'un contact cree a la reception d'un premier
   * message (TOFU) : nom affiche + cle d'identite PINNEE, extraits du
   * "hello" dechiffre. La verification QR/code mensuel vient ensuite.
   */
  async updateContactProfile(contactId: string, displayName: string, identityKey: string): Promise<void> {
    await this.db.execute(
      'UPDATE contacts SET display_name = ?, identity_key = ? WHERE id = ?',
      [displayName, identityKey, contactId],
    );
    await this.db.execute('UPDATE conversations SET title = ? WHERE id = ?', [displayName, contactId]);
  }

  async setContactVerified(contactId: string, verified: boolean): Promise<void> {
    await this.db.execute('UPDATE contacts SET verified = ? WHERE id = ?', [verified ? 1 : 0, contactId]);
  }

  // --- messages ---

  async saveMessage(m: MessageRow): Promise<void> {
    await this.db.execute(
      'INSERT INTO messages (id, conversation_id, sender_contact_id, kind, body, sent_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [m.id, m.conversationId, m.senderContactId, m.kind, m.body, m.sentAt, m.status],
    );
  }

  async listMessages(conversationId: string, limit = 100): Promise<MessageRow[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT ?',
      [conversationId, limit],
    );
    return rows.reverse().map((r) => ({
      id: String(r.id),
      conversationId: String(r.conversation_id),
      senderContactId: r.sender_contact_id === null ? null : String(r.sender_contact_id),
      kind: String(r.kind) as MessageRow['kind'],
      body: String(r.body),
      sentAt: Number(r.sent_at),
      status: String(r.status) as MessageRow['status'],
    }));
  }

  async setMessageStatus(id: string, status: MessageRow['status']): Promise<void> {
    await this.db.execute('UPDATE messages SET status = ? WHERE id = ?', [status, id]);
  }

  // --- queues (transport relais) ---

  async saveQueues(contactId: string, q: {
    serverUrl: string;
    inQueueId: string;
    inReadToken: string;
    outQueueId?: string;
    outWriteToken?: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO queues (contact_id, server_url, in_queue_id, in_read_token, out_queue_id, out_write_token)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [contactId, q.serverUrl, q.inQueueId, q.inReadToken, q.outQueueId ?? null, q.outWriteToken ?? null],
    );
    // La boite d'entree est aussi enregistree cote inboxes, deja
    // rattachee : c'est elle qu'on ecoutera au demarrage.
    await this.db.execute(
      'INSERT OR REPLACE INTO inboxes (queue_id, read_token, server_url, contact_id) VALUES (?, ?, ?, ?)',
      [q.inQueueId, q.inReadToken, q.serverUrl, contactId],
    );
  }

  // --- positions ---

  /** Derniere position connue d'un contact. Ecrase la precedente : pas d'historique. */
  async saveLocation(contactId: string, loc: LocationFix): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO locations (contact_id, latitude, longitude, accuracy_m, measured_at)
       VALUES (?, ?, ?, ?, ?)`,
      [contactId, loc.latitude, loc.longitude, loc.accuracyM ?? null, loc.measuredAt],
    );
  }

  async listLocations(): Promise<(LocationFix & { contactId: string })[]> {
    const { rows } = await this.db.execute('SELECT * FROM locations');
    return rows.map((r) => ({
      contactId: String(r.contact_id),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      accuracyM: r.accuracy_m === null ? undefined : Number(r.accuracy_m),
      measuredAt: Number(r.measured_at),
    }));
  }

  async forgetLocation(contactId: string): Promise<void> {
    await this.db.execute('DELETE FROM locations WHERE contact_id = ?', [contactId]);
  }

  /** Echeance de MON partage vers ce contact (millisecondes epoch). */
  async setSharingUntil(contactId: string, until: number): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO location_sharing (contact_id, sharing_until) VALUES (?, ?)',
      [contactId, until],
    );
  }

  async stopSharing(contactId: string): Promise<void> {
    await this.db.execute('DELETE FROM location_sharing WHERE contact_id = ?', [contactId]);
  }

  /** Contacts vers qui je partage ENCORE (les echeances passees sont ignorees). */
  async listActiveSharing(now = Date.now()): Promise<{ contactId: string; until: number }[]> {
    const { rows } = await this.db.execute(
      'SELECT contact_id, sharing_until FROM location_sharing WHERE sharing_until > ?',
      [now],
    );
    return rows.map((r) => ({ contactId: String(r.contact_id), until: Number(r.sharing_until) }));
  }

  // --- reglages ---

  async getSetting(key: string): Promise<string | null> {
    const { rows } = await this.db.execute('SELECT value FROM settings WHERE key = ?', [key]);
    return rows[0] ? String(rows[0].value) : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  // --- boites d'entree ---

  /** Boite creee pour un QR d'invitation, pas encore utilisee. */
  async savePendingInbox(queueId: string, readToken: string, serverUrl: string): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO inboxes (queue_id, read_token, server_url, contact_id) VALUES (?, ?, ?, NULL)',
      [queueId, readToken, serverUrl],
    );
  }

  async findContactByInQueue(queueId: string): Promise<string | null> {
    const { rows } = await this.db.execute('SELECT contact_id FROM inboxes WHERE queue_id = ?', [queueId]);
    const value = rows[0]?.contact_id;
    return value === null || value === undefined ? null : String(value);
  }

  async attachInboxToContact(queueId: string, contactId: string): Promise<void> {
    await this.db.execute('UPDATE inboxes SET contact_id = ? WHERE queue_id = ?', [contactId, queueId]);
  }

  async getPendingInboxToken(queueId: string): Promise<string | null> {
    const { rows } = await this.db.execute('SELECT read_token FROM inboxes WHERE queue_id = ?', [queueId]);
    return rows[0] ? String(rows[0].read_token) : null;
  }

  /** Toutes les boites a ecouter (rattachees ou en attente). */
  async listInboxes(): Promise<{ queueId: string; readToken: string; serverUrl: string }[]> {
    const { rows } = await this.db.execute('SELECT queue_id, read_token, server_url FROM inboxes');
    return rows.map((r) => ({
      queueId: String(r.queue_id),
      readToken: String(r.read_token),
      serverUrl: String(r.server_url),
    }));
  }

  async getQueues(contactId: string) {
    const { rows } = await this.db.execute('SELECT * FROM queues WHERE contact_id = ?', [contactId]);
    if (!rows[0]) return null;
    return {
      serverUrl: String(rows[0].server_url),
      inQueueId: String(rows[0].in_queue_id),
      inReadToken: String(rows[0].in_read_token),
      outQueueId: rows[0].out_queue_id === null ? null : String(rows[0].out_queue_id),
      outWriteToken: rows[0].out_write_token === null ? null : String(rows[0].out_write_token),
    };
  }

  /** Acces brut pour les cas non couverts (a eviter hors tests). */
  get raw(): SqlExecutor {
    return this.db;
  }
}

export type { SqlExecutor, SqlValue };
