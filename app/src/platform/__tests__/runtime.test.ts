// Verifie la couche d'adaptation ET la regle qui va avec :
// aucun fichier de src/ (hors platform/) ne doit dependre d'un objet
// global absent de Hermes. C'est ce genre de dependance qui a fait
// planter l'app au demarrage avec « Cannot read property
// 'getRandomValues' of undefined », sans qu'aucun test ne le voie —
// puisque Node, lui, fournit ces objets.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  randomBytes,
  randomId,
  uuidV4,
  toBase64,
  fromBase64,
  utf8Encode,
  utf8Decode,
  __fallbacks,
} from '../runtime';

describe('aleatoire', () => {
  it('produit la bonne longueur et ne se repete pas', () => {
    expect(randomBytes(32)).toHaveLength(32);
    const a = randomId();
    const b = randomId();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('genere des UUID v4 valides', () => {
    for (let i = 0; i < 20; i++) {
      expect(uuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('refuse de deviner si getRandomValues est absent', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      // Plutot que de retomber sur Math.random (catastrophique pour des
      // cles), la fonction doit echouer bruyamment.
      expect(() => randomBytes(16)).toThrow(/getRandomValues/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});

describe('base64 et utf8 — les deux chemins doivent coincider', () => {
  const cas = [
    '',
    'a',
    'ab',
    'abc',
    'Salut Bob !',
    'accents : éàçùôî',
    'emoji : 🔒🛰️👾',
    'CJK : 日本語のテキスト',
    'mixte 🔐 accentué ' + 'x'.repeat(300),
  ];

  it.each(cas)('aller-retour base64 identique a Buffer : %s', (texte) => {
    const bytes = Buffer.from(texte, 'utf8');
    const attendu = bytes.toString('base64');

    expect(toBase64(new Uint8Array(bytes))).toBe(attendu);
    expect(__fallbacks.encodeBase64Fallback(new Uint8Array(bytes))).toBe(attendu);

    expect(Buffer.from(fromBase64(attendu)).toString('utf8')).toBe(texte);
    expect(Buffer.from(__fallbacks.decodeBase64Fallback(attendu)).toString('utf8')).toBe(texte);
  });

  it.each(cas)('aller-retour utf8 identique a Buffer : %s', (texte) => {
    const attendu = new Uint8Array(Buffer.from(texte, 'utf8'));

    expect(Array.from(utf8Encode(texte))).toEqual(Array.from(attendu));
    expect(Array.from(__fallbacks.utf8EncodeFallback(texte))).toEqual(Array.from(attendu));

    expect(utf8Decode(attendu)).toBe(texte);
    expect(__fallbacks.utf8DecodeFallback(attendu)).toBe(texte);
  });

  it('gere des octets binaires quelconques', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const b64 = toBase64(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString('base64'));
    expect(Array.from(fromBase64(b64))).toEqual(Array.from(bytes));
    expect(Array.from(__fallbacks.decodeBase64Fallback(__fallbacks.encodeBase64Fallback(bytes)))).toEqual(
      Array.from(bytes),
    );
  });
});

describe('garde-fou : pas de globaux hasardeux hors de platform/', () => {
  const SRC = join(__dirname, '..', '..');
  const INTERDITS = [
    { motif: /\bglobalThis\.crypto\b|(?<!\.)\bcrypto\.getRandomValues\b/, nom: 'crypto.getRandomValues' },
    { motif: /\bglobalThis\.(btoa|atob)\b|(?<![.\w])(btoa|atob)\s*\(/, nom: 'btoa/atob' },
    { motif: /\bnew\s+Text(Encoder|Decoder)\b/, nom: 'TextEncoder/TextDecoder' },
  ];

  function fichiersSource(dir: string): string[] {
    const out: string[] = [];
    for (const entree of readdirSync(dir)) {
      const chemin = join(dir, entree);
      if (statSync(chemin).isDirectory()) {
        // On exclut platform/ (c'est SA raison d'etre) et les tests
        // + testutils, qui tournent uniquement sous Node.
        if (entree === 'platform' || entree === '__tests__' || entree === 'testutils') continue;
        out.push(...fichiersSource(chemin));
      } else if (/\.tsx?$/.test(entree)) {
        out.push(chemin);
      }
    }
    return out;
  }

  it('aucun fichier applicatif ne suppose un global absent de Hermes', () => {
    const coupables: string[] = [];
    for (const fichier of fichiersSource(SRC)) {
      const contenu = readFileSync(fichier, 'utf8');
      for (const { motif, nom } of INTERDITS) {
        if (motif.test(contenu)) {
          coupables.push(`${fichier.replace(SRC, 'src')} utilise ${nom}`);
        }
      }
    }
    expect(coupables).toEqual([]);
  });
});
