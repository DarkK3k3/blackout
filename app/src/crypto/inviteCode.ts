// inviteCode.ts
// ------------------------------------------------------------------
// Format du code d'invitation.
//
// POURQUOI LES CLES NE SONT PLUS DANS LE QR
// -----------------------------------------
// Le bundle X3DH/PQXDH pese ~3 Ko, dont 2 Ko rien que pour la cle
// post-quantique Kyber. Un QR code plafonne a 2953 octets : impossible
// a encoder (l'app plantait a l'affichage).
//
// Le bundle est donc depose sur le relais, et le code ne transporte
// qu'une REFERENCE + l'EMPREINTE du contenu.
//
// LE RELAIS NE DEVIENT PAS UNE AUTORITE DE CONFIANCE
// --------------------------------------------------
// C'est le point non negociable. Le scanneur telecharge le bundle,
// recalcule son empreinte, et REFUSE si elle ne correspond pas a celle
// lue sur le QR. Un relais qui substituerait un bundle (pour s'inserer
// dans la conversation) serait detecte a coup sur : il devrait trouver
// un second contenu ayant la meme empreinte BLAKE2b tronquee a 128
// bits, ce qui est hors de portee.
//
// La confiance vient donc toujours du canal physique — le QR affiche a
// l'ecran, ou le code lu a voix haute — jamais du serveur.
// ------------------------------------------------------------------

import { blake2b } from '@noble/hashes/blake2.js';
import { utf8Encode } from '../platform/runtime';

/** Empreinte tronquee a 128 bits : suffisant contre une seconde preimage. */
const FINGERPRINT_BYTES = 16;

/** Alphabet base32 sans caracteres ambigus (ni 0/O, ni 1/I/L). */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export interface InviteReference {
  /** Adresse du relais ou recuperer le bundle. */
  serverUrl: string;
  inviteId: string;
  /** Empreinte du bundle, en base32. */
  fingerprint: string;
}

/** Empreinte du contenu exact de l'invitation. */
export function inviteFingerprint(payloadJson: string): string {
  const digest = blake2b(utf8Encode(payloadJson), { dkLen: FINGERPRINT_BYTES });
  return toBase32(digest);
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Contenu du QR : compact, mais autoportant — il inclut l'adresse du
 * relais, pour que quelqu'un qui n'a rien configure puisse quand meme
 * scanner et rejoindre.
 */
export function encodeInviteQr(ref: InviteReference): string {
  return `blackout:1:${ref.serverUrl}|${ref.inviteId}|${ref.fingerprint}`;
}

export function decodeInviteQr(text: string): InviteReference {
  const trimmed = text.trim();
  if (!trimmed.startsWith('blackout:1:')) {
    throw new Error("ce QR code n'est pas une invitation Blackout");
  }
  const [serverUrl, inviteId, fingerprint] = trimmed.slice('blackout:1:'.length).split('|');
  if (!serverUrl || !inviteId || !fingerprint) {
    throw new Error('invitation illisible (format incomplet)');
  }
  return { serverUrl, inviteId, fingerprint };
}

/**
 * Version lisible a voix haute, pour quand le scan est impossible.
 * Suppose que les deux personnes utilisent DEJA le meme relais —
 * l'adresse n'y figure pas, seulement la reference et l'empreinte.
 */
export function toSpokenCode(ref: InviteReference): string {
  const compact = `${ref.inviteId.replace(/[^A-Za-z0-9]/g, '')}${ref.fingerprint}`.toUpperCase();
  return (compact.match(/.{1,5}/g) ?? []).join('-');
}

export function fromSpokenCode(code: string, serverUrl: string): InviteReference {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // L'empreinte occupe les 26 derniers caracteres (128 bits en base32).
  const FP_LEN = Math.ceil((FINGERPRINT_BYTES * 8) / 5);
  if (clean.length <= FP_LEN) throw new Error('code trop court');
  return {
    serverUrl,
    inviteId: clean.slice(0, clean.length - FP_LEN),
    fingerprint: clean.slice(clean.length - FP_LEN),
  };
}
