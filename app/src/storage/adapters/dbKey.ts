// dbKey.ts — gestion de la passphrase SQLCipher.
// Generee aleatoirement au premier lancement (256 bits), stockee dans
// le Keychain iOS / Android Keystore via expo-secure-store. Elle ne
// quitte jamais l'appareil et n'est jamais derivee de quoi que ce soit
// de devinable. AFTER_FIRST_UNLOCK : la base peut etre rouverte en
// arriere-plan apres un premier deverrouillage post-redemarrage.

import * as SecureStore from 'expo-secure-store';

const DB_KEY_NAME = 'blackout.dbkey.v1';

export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_NAME, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  if (existing) return existing;

  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  await SecureStore.setItemAsync(DB_KEY_NAME, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return key;
}
