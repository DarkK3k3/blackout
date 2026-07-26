// nodeSqlExecutor.ts — TESTS UNIQUEMENT
// SqlExecutor au-dessus du SQLite integre de Node (node:sqlite).
// Meme dialecte que op-sqlite/SQLCipher sur l'appareil, sans le
// chiffrement au repos (qui est le role de SQLCipher, pas du SQL).

import { DatabaseSync } from 'node:sqlite';
import type { SqlExecutor, SqlValue } from '../sql';

export function createNodeSqlExecutor(path = ':memory:'): SqlExecutor & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const trimmed = sql.trim();
      if (/^(SELECT|PRAGMA)/i.test(trimmed) && !/^PRAGMA\s+\w+\s*=/i.test(trimmed)) {
        const rows = db.prepare(trimmed).all(...params) as Record<string, SqlValue>[];
        return { rows: rows.map((r) => ({ ...r })) };
      }
      if (params.length === 0) {
        db.exec(trimmed);
      } else {
        db.prepare(trimmed).run(...params);
      }
      return { rows: [] };
    },
    close: () => db.close(),
  };
}
