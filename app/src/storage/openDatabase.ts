// openDatabase.ts — point d'entree stockage cote APPAREIL.
// (Les tests Jest utilisent testutils/nodeSqlExecutor.ts a la place.)

import { BlackoutStore } from './store';
import { createOpSqliteExecutor } from './adapters/opSqliteExecutor';
import { getOrCreateDbKey } from './adapters/dbKey';

let storePromise: Promise<BlackoutStore> | null = null;

/** Ouvre (ou reutilise) la base chiffree de l'app. */
export function openBlackoutStore(): Promise<BlackoutStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const key = await getOrCreateDbKey();
      const executor = createOpSqliteExecutor('blackout.db', key);
      return BlackoutStore.open(executor);
    })();
  }
  return storePromise;
}
