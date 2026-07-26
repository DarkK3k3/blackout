// sql.ts
// ------------------------------------------------------------------
// Abstraction SQL minimale de Blackout.
//
// Deux implementations :
//  - sur l'appareil : op-sqlite compile avec SQLCipher (base chiffree
//    au repos, cle dans Keychain/Keystore) — adapters/opSqlite.ts
//  - dans Jest     : node:sqlite en memoire — testutils/nodeSqlExecutor.ts
//
// Toute la logique metier (schema, repos, session manager) est ecrite
// contre cette interface, donc testee localement avec la meme SQL que
// celle qui tournera sur telephone.
// ------------------------------------------------------------------

export type SqlValue = string | number | null;

export interface SqlExecutor {
  execute(sql: string, params?: SqlValue[]): Promise<{ rows: Record<string, SqlValue>[] }>;
}

const MIGRATIONS: string[] = [
  // v1 — schema initial
  `
  CREATE TABLE identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    identity_record TEXT NOT NULL,     -- record prive libsignal (b64)
    public_key TEXT NOT NULL,          -- cle publique d'identite (b64)
    registration_id INTEGER NOT NULL,
    local_address TEXT NOT NULL        -- uuid stable de cet appareil
  );

  CREATE TABLE contacts (
    id TEXT PRIMARY KEY,               -- uuid attribue au contact
    display_name TEXT NOT NULL,
    identity_key TEXT NOT NULL,        -- cle publique PINNEE au scan du QR
    verified INTEGER NOT NULL DEFAULT 0,
    session_record TEXT,               -- etat Double Ratchet (b64), mis a jour a chaque message
    created_at INTEGER NOT NULL
  );

  CREATE TABLE signed_prekeys (
    id INTEGER PRIMARY KEY,
    record TEXT NOT NULL
  );

  CREATE TABLE kyber_prekeys (
    id INTEGER PRIMARY KEY,
    record TEXT NOT NULL
  );

  CREATE TABLE one_time_prekeys (
    id INTEGER PRIMARY KEY,
    record TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0    -- consommee apres un premier message entrant
  );

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,               -- = contact_id pour un chat direct
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
    title TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE group_members (
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (conversation_id, contact_id)
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_contact_id TEXT,            -- NULL = envoye par moi
    kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'photo')),
    body TEXT NOT NULL,                -- en clair ICI seulement : la base entiere est chiffree (SQLCipher)
    sent_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed'))
  );
  CREATE INDEX idx_messages_conv ON messages (conversation_id, sent_at);

  CREATE TABLE queues (
    contact_id TEXT PRIMARY KEY,
    server_url TEXT NOT NULL,
    in_queue_id TEXT NOT NULL,         -- ma boite : j'en garde le readToken
    in_read_token TEXT NOT NULL,
    out_queue_id TEXT,                 -- sa boite : je n'ai que le writeToken
    out_write_token TEXT
  );
  `,
  // v2 — boites d'entree dissociees des contacts.
  // Une boite peut exister AVANT de connaitre son correspondant : on
  // en cree une par QR d'invitation, elle est rattachee au contact
  // quand quelqu'un s'en sert. Une boite = un correspondant unique.
  `
  CREATE TABLE inboxes (
    queue_id TEXT PRIMARY KEY,
    read_token TEXT NOT NULL,
    server_url TEXT NOT NULL,
    contact_id TEXT                     -- NULL = en attente d'un premier expediteur
  );
  CREATE INDEX idx_inboxes_contact ON inboxes (contact_id);
  `,
  // v3 — reglages modifiables dans l'app.
  // L'adresse du relais etait figee a la compilation : en changer
  // imposait un rebuild complet et une reinstallation. Elle vit
  // desormais ici, donc modifiable depuis l'ecran Reglages.
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v4 — distinguer « distribuee » de « consommee ».
  //
  // Une prekey a usage unique est REERVEE des qu'elle part dans un QR,
  // pour que l'invitation suivante en prenne une autre. Elle n'est
  // CONSOMMEE (used) qu'a la reception du premier message : jusque-la
  // son record doit rester disponible pour dechiffrer.
  `
  ALTER TABLE one_time_prekeys ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0;
  `,
];

/** Applique les migrations manquantes (user_version de SQLite). */
export async function migrate(db: SqlExecutor): Promise<void> {
  const { rows } = await db.execute('PRAGMA user_version');
  const current = Number(rows[0]?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    for (const stmt of MIGRATIONS[v].split(';')) {
      if (stmt.trim()) await db.execute(stmt);
    }
    await db.execute(`PRAGMA user_version = ${v + 1}`);
  }
}
