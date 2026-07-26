// runtime.ts — couche d'adaptation aux differences d'environnement.
// ------------------------------------------------------------------
// LECON APPRISE A LA DURE : Hermes (le moteur JS de React Native) ne
// fournit PAS les memes objets globaux que Node. `crypto`, `btoa`,
// `atob`, `TextEncoder`… peuvent etre absents. Un code qui marche en
// test sous Node peut donc planter au demarrage sur telephone — c'est
// exactement ce qui est arrive avec `crypto.getRandomValues`.
//
// Regle : AUCUN autre fichier de src/ n'utilise ces objets globaux
// directement. Tout passe par ici, et un test (platform.test.ts)
// verifie que la regle est respectee.
//
// Le polyfill react-native-get-random-values installe
// `global.crypto.getRandomValues` sur l'appareil (SecRandomCopyBytes
// sur iOS, SecureRandom sur Android). Sous Node, l'objet existe deja.
// ------------------------------------------------------------------

/** Octets aleatoires cryptographiquement surs. */
export function randomBytes(length: number): Uint8Array {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof cryptoObj?.getRandomValues !== 'function') {
    // Ne JAMAIS retomber sur Math.random ici : ces octets servent a
    // generer des cles et des identifiants. Mieux vaut refuser.
    throw new Error(
      "crypto.getRandomValues indisponible — le polyfill react-native-get-random-values n'est pas charge",
    );
  }
  return cryptoObj.getRandomValues(new Uint8Array(length));
}

/** Identifiant aleatoire en hexadecimal (16 octets par defaut). */
export function randomId(bytes = 16): string {
  return Array.from(randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** UUID v4 conforme (variante RFC 4122). */
export function uuidV4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ------------------------------------------------------------- base64

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Implementation pure JS, utilisee quand btoa/atob sont absents. */
function encodeBase64Fallback(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function decodeBase64Fallback(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const c2 = clean[i + 2] ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const c3 = clean[i + 3] ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 >= 0) out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, o);
}

export function toBase64(bytes: Uint8Array): string {
  const btoaFn = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (typeof btoaFn === 'function') {
    let bin = '';
    // Par blocs : eviter un depassement de pile sur les gros contenus (photos)
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoaFn(bin);
  }
  return encodeBase64Fallback(bytes);
}

export function fromBase64(b64: string): Uint8Array {
  const atobFn = (globalThis as { atob?: (s: string) => string }).atob;
  if (typeof atobFn === 'function') {
    const bin = atobFn(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return decodeBase64Fallback(b64);
}

// --------------------------------------------------------------- utf8

function utf8EncodeFallback(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return new Uint8Array(out);
}

function utf8DecodeFallback(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    let code: number;
    if (b0 < 0x80) code = b0;
    else if ((b0 & 0xe0) === 0xc0) code = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if ((b0 & 0xf0) === 0xe0)
      code = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else
      code =
        ((b0 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);

    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

export function utf8Encode(str: string): Uint8Array {
  const Enc = (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder;
  return Enc ? new Enc().encode(str) : utf8EncodeFallback(str);
}

export function utf8Decode(bytes: Uint8Array): string {
  const Dec = (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder;
  return Dec ? new Dec().decode(bytes) : utf8DecodeFallback(bytes);
}

/** Exportes pour que les tests puissent exercer AUSSI le chemin de secours. */
export const __fallbacks = {
  encodeBase64Fallback,
  decodeBase64Fallback,
  utf8EncodeFallback,
  utf8DecodeFallback,
};
