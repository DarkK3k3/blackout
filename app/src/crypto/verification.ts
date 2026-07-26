// verification.ts
// ------------------------------------------------------------------
// Code de verification mensuel — port fidele de verification.js du
// prototype, verifie bit a bit par des vecteurs generes avec
// libsodium (voir __tests__/verification.vectors.json).
//
// INVARIANT NON NEGOCIABLE : tout ce fichier est un calcul PUR en
// lecture seule sur les cles publiques d'IDENTITE + le mois courant.
// Il ne doit jamais importer quoi que ce soit de la couche session /
// ratchet (libsignal), ne declenche aucune renegociation de cles, et
// peut etre recalcule a volonte sans effet de bord.
//
// Primitives : BLAKE2b via @noble/hashes (pur TS, tourne sous Hermes),
// strictement equivalentes a crypto_generichash /
// crypto_kdf_derive_from_key de libsodium :
//   - crypto_generichash(32, m)            = BLAKE2b-256(m)
//   - crypto_kdf_derive_from_key(32, id, ctx, k)
//       = BLAKE2b-256(key=k, salt=LE64(id)||0*8, personal=ctx||0*8)
// ------------------------------------------------------------------

import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * Empreinte stable du COUPLE de correspondants : hash des deux cles
 * publiques d'identite, triees avant concatenation pour que les deux
 * cotes calculent exactement la meme valeur, peu importe qui est
 * "moi" et qui est "l'autre".
 */
export function pairFingerprint(
  myIdentityPublicKey: Uint8Array,
  theirIdentityPublicKey: Uint8Array,
): Uint8Array {
  const a = bytesToHex(myIdentityPublicKey);
  const b = bytesToHex(theirIdentityPublicKey);
  const sorted = [a, b].sort();
  const combined = hexToBytes(sorted[0] + sorted[1]);
  return blake2b(combined, { dkLen: 32 });
}

/**
 * Reproduction exacte de crypto_kdf_derive_from_key de libsodium :
 * BLAKE2b avec la cle maitresse comme `key`, le subkey_id encode en
 * little-endian 64 bits dans le `salt` (16 octets, padde de zeros),
 * et le contexte de 8 caracteres dans `personalization` (idem).
 */
function kdfDeriveFromKey(
  subkeyLen: number,
  subkeyId: bigint,
  context: string,
  masterKey: Uint8Array,
): Uint8Array {
  if (context.length !== 8) throw new Error('le contexte KDF doit faire exactement 8 caracteres');

  const salt = new Uint8Array(16);
  new DataView(salt.buffer).setBigUint64(0, subkeyId, true); // little-endian

  const personalization = new Uint8Array(16);
  for (let i = 0; i < 8; i++) personalization[i] = context.charCodeAt(i);

  return blake2b(new Uint8Array(0), {
    dkLen: subkeyLen,
    key: masterKey,
    salt,
    personalization,
  });
}

/**
 * Derive le code de verification d'un mois donne (format "AAAA-MM").
 * Meme derivation que le prototype : subkey_id = AAAAMM, contexte
 * "verifcod", puis 8 chiffres decimaux groupes "1234-5678".
 */
export function monthlyVerificationCode(fingerprint: Uint8Array, yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error(`mois invalide : "${yearMonth}" (attendu AAAA-MM)`);

  const subkeyId = BigInt(yearMonth.replace('-', ''));
  const subkey = kdfDeriveFromKey(32, subkeyId, 'verifcod', fingerprint);

  let code = '';
  for (let i = 0; i < 8; i++) code += String(subkey[i] % 10);
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Mois courant au format "AAAA-MM", en temps local de l'appareil. */
export function currentYearMonth(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
