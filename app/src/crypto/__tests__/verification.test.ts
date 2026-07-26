// Prouve que le port TypeScript reproduit BIT A BIT le prototype
// libsodium : les vecteurs de reference sont generes par
// tools/gen-verification-vectors.js a partir de verification.js.

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { pairFingerprint, monthlyVerificationCode, currentYearMonth } from '../verification';
import vectorsFile from './verification.vectors.json';

const { months, vectors } = vectorsFile as {
  months: string[];
  vectors: {
    aPublicHex: string;
    bPublicHex: string;
    fingerprintHex: string;
    fingerprintSwappedHex: string;
    codes: Record<string, string>;
  }[];
};

describe('pairFingerprint', () => {
  it.each(vectors.map((v, i) => [i, v] as const))(
    'vecteur %i : identique au prototype libsodium',
    (_i, v) => {
      const fp = pairFingerprint(hexToBytes(v.aPublicHex), hexToBytes(v.bPublicHex));
      expect(bytesToHex(fp)).toBe(v.fingerprintHex);
    },
  );

  it('est symetrique : (A,B) et (B,A) donnent la meme empreinte', () => {
    for (const v of vectors) {
      const fp = pairFingerprint(hexToBytes(v.aPublicHex), hexToBytes(v.bPublicHex));
      const fpSwapped = pairFingerprint(hexToBytes(v.bPublicHex), hexToBytes(v.aPublicHex));
      expect(bytesToHex(fp)).toBe(bytesToHex(fpSwapped));
      expect(bytesToHex(fpSwapped)).toBe(v.fingerprintSwappedHex);
    }
  });
});

describe('monthlyVerificationCode', () => {
  it.each(vectors.map((v, i) => [i, v] as const))(
    'vecteur %i : memes codes que le prototype pour chaque mois',
    (_i, v) => {
      const fp = hexToBytes(v.fingerprintHex);
      for (const month of months) {
        expect(monthlyVerificationCode(fp, month)).toBe(v.codes[month]);
      }
    },
  );

  it('change chaque mois mais reste deterministe', () => {
    const fp = hexToBytes(vectors[0].fingerprintHex);
    const codesSeen = new Set(months.map((m) => monthlyVerificationCode(fp, m)));
    expect(codesSeen.size).toBe(months.length); // tous differents
    expect(monthlyVerificationCode(fp, '2026-07')).toBe(monthlyVerificationCode(fp, '2026-07'));
  });

  it('est un calcul pur : recalculable sans effet de bord', () => {
    const fp = hexToBytes(vectors[0].fingerprintHex);
    const before = bytesToHex(fp);
    for (let i = 0; i < 100; i++) monthlyVerificationCode(fp, '2026-07');
    expect(bytesToHex(fp)).toBe(before); // l'empreinte n'a pas ete mutee
  });

  it('rejette un format de mois invalide', () => {
    const fp = hexToBytes(vectors[0].fingerprintHex);
    expect(() => monthlyVerificationCode(fp, '2026-7')).toThrow();
    expect(() => monthlyVerificationCode(fp, 'juillet')).toThrow();
  });
});

describe('currentYearMonth', () => {
  it('formate en AAAA-MM avec zero devant', () => {
    expect(currentYearMonth(new Date(2026, 6, 25))).toBe('2026-07');
    expect(currentYearMonth(new Date(2030, 10, 3))).toBe('2030-11');
  });
});
