// opSqliteExecutor.ts — implementation APPAREIL de SqlExecutor.
// op-sqlite est compile avec SQLCipher (cf. "op-sqlite": {"sqlcipher": true}
// dans package.json) : toute la base est chiffree au repos.
//
// POURQUOI ON POSE LA CLE NOUS-MEMES, EN FORME BRUTE
// --------------------------------------------------
// L'option `encryptionKey` d'op-sqlite passe la valeur a SQLCipher comme
// une PHRASE DE PASSE. SQLCipher la fait alors passer par PBKDF2
// (256 000 iterations de HMAC-SHA512) pour en tirer une cle. Sur iOS 26,
// ce chemin plantait l'app : segfault dans `sqlcipher_openssl_kdf`, au
// moment de la premiere ecriture (rapport de crash du 2026-07-26).
//
// On utilise donc la forme BRUTE de SQLCipher : `PRAGMA key = "x'<hex>'"`,
// qui prend directement une cle de 256 bits et court-circuite PBKDF2.
//
// Ce n'est pas un contournement au rabais, c'est le bon choix ici :
// PBKDF2 existe pour etirer un mot de passe humain, faible en entropie.
// Notre cle vient du generateur aleatoire du systeme (32 octets pleins)
// et vit dans le Keychain : l'etirer n'apporte STRICTEMENT rien en
// securite. SQLCipher chiffre toujours en AES-256, la seule difference
// est qu'on ne derive plus une cle a partir d'une cle.

import { open, isSQLCipher } from '@op-engineering/op-sqlite';
import type { SqlExecutor, SqlValue } from '../sql';

export async function createOpSqliteExecutor(
  dbName: string,
  hexKey: string,
): Promise<SqlExecutor & { close(): void }> {
  if (!isSQLCipher()) {
    // Garde-fou : refuser de tourner si le binaire n'a pas ete compile
    // avec SQLCipher — une base en clair violerait le modele de menace.
    throw new Error(
      'op-sqlite compile SANS SQLCipher — verifier package.json > "op-sqlite": {"sqlcipher": true}',
    );
  }
  if (!/^[0-9a-f]{64}$/.test(hexKey)) {
    throw new Error('cle de base invalide : 64 caracteres hexadecimaux attendus (256 bits)');
  }

  const db = open({ name: dbName });

  // La cle DOIT etre posee avant toute autre instruction.
  await db.execute(`PRAGMA key = "x'${hexKey}'"`);

  // Verification immediate : si la cle est mauvaise (ou la base
  // corrompue), cette lecture echoue avec "file is not a database".
  // Mieux vaut le savoir ici que trois ecrans plus loin.
  try {
    await db.execute('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    db.close();
    throw new Error(
      `base locale illisible avec la cle du trousseau (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const result = await db.execute(sql, params);
      return { rows: (result.rows ?? []) as Record<string, SqlValue>[] };
    },
    close: () => db.close(),
  };
}
