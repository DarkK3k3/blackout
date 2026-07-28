// nodeSql.js — fait passer `node:sqlite` pour le SQL d'un Durable Object.
//
// Cloudflare expose `ctx.storage.sql.exec(requete, ...parametres)` qui
// rend un curseur muni de `toArray()`. Node expose `prepare().all()`.
// Vingt lignes suffisent a combler l'ecart, et le store teste est alors
// exactement celui qui tournera en production — pas une reimplementation.

import { DatabaseSync } from 'node:sqlite';

export function createNodeSql() {
  const db = new DatabaseSync(':memory:');
  return {
    exec(query, ...bindings) {
      // Le schema arrive en un bloc de plusieurs instructions, sans
      // parametres : `prepare()` n'en accepte qu'une a la fois.
      const instructions = query.split(';').filter((s) => s.trim().length > 0);
      if (bindings.length === 0 && instructions.length > 1) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const statement = db.prepare(query);
      if (/^\s*SELECT/i.test(query)) {
        const rows = statement.all(...bindings);
        return { toArray: () => rows };
      }
      statement.run(...bindings);
      return { toArray: () => [] };
    },
    close: () => db.close(),
  };
}
