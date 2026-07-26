// opSqliteExecutor.ts — implementation APPAREIL de SqlExecutor.
// op-sqlite est compile avec SQLCipher (cf. "op-sqlite": {"sqlcipher": true}
// dans package.json) : toute la base est chiffree au repos avec une cle
// generee aleatoirement et gardee dans le Keychain/Keystore (dbKey.ts).
// Rien de cette base n'est lisible en cas de vol du telephone.

import { open, isSQLCipher } from '@op-engineering/op-sqlite';
import type { SqlExecutor, SqlValue } from '../sql';

export function createOpSqliteExecutor(dbName: string, encryptionKey: string): SqlExecutor & { close(): void } {
  if (!isSQLCipher()) {
    // Garde-fou : refuse de tourner si le binaire n'a pas ete compile
    // avec SQLCipher (une base en clair violerait le modele de menace).
    throw new Error('op-sqlite compile SANS SQLCipher — verifier package.json > "op-sqlite": {"sqlcipher": true}');
  }
  const db = open({ name: dbName, encryptionKey });
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const result = await db.execute(sql, params);
      return { rows: (result.rows ?? []) as Record<string, SqlValue>[] };
    },
    close: () => db.close(),
  };
}
