// Le code d'invitation doit survivre a un aller-retour humain :
// affiche, lu a voix haute, retape avec des approximations.
//
// Ce fichier existe a cause d'un bug qui a echappe aux tests
// fonctionnels : l'alphabet base32 ne comptait que 31 caracteres au
// lieu de 32. Les groupes de 5 bits valant 31 produisaient
// `undefined`, corrompant environ un code sur deux — de facon
// aleatoire, donc invisible sur un ou deux essais.
//
// Lecon : une propriete probabiliste se teste en masse, pas sur un cas.

import {
  inviteFingerprint,
  encodeInviteQr,
  decodeInviteQr,
  toSpokenCode,
  fromSpokenCode,
} from '../inviteCode';

const SERVER = 'https://relais.exemple.fr';

describe('empreinte', () => {
  it('utilise un alphabet de 32 caracteres, sans trou', () => {
    // 200 empreintes = des milliers de groupes de 5 bits : si une
    // valeur n'avait pas de caractere, ca sortirait ici.
    for (let i = 0; i < 200; i++) {
      const fp = inviteFingerprint(`contenu numero ${i}`);
      expect(fp).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
      expect(fp).not.toContain('undefined');
      expect(fp).toHaveLength(26); // 128 bits en base32
    }
  });

  it('change des qu un seul octet du contenu change', () => {
    const a = inviteFingerprint('{"cle":"AAAA"}');
    const b = inviteFingerprint('{"cle":"AAAB"}');
    expect(a).not.toBe(b);
  });

  it('est stable pour un meme contenu', () => {
    expect(inviteFingerprint('meme contenu')).toBe(inviteFingerprint('meme contenu'));
  });
});

describe('aller-retour du code', () => {
  /** Reference realiste : identifiant de 16 caracteres + empreinte. */
  function makeRef(seed: number) {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let inviteId = '';
    for (let i = 0; i < 16; i++) inviteId += alphabet[(seed * 7 + i * 13) % 32];
    return { serverUrl: SERVER, inviteId, fingerprint: inviteFingerprint(`bundle ${seed}`) };
  }

  it('QR : encode puis decode a l identique (300 cas)', () => {
    for (let i = 0; i < 300; i++) {
      const ref = makeRef(i);
      expect(decodeInviteQr(encodeInviteQr(ref))).toEqual(ref);
    }
  });

  it('code dicte : survit a 300 allers-retours', () => {
    for (let i = 0; i < 300; i++) {
      const ref = makeRef(i);
      const retour = fromSpokenCode(toSpokenCode(ref), SERVER);
      expect(retour.inviteId).toBe(ref.inviteId);
      expect(retour.fingerprint).toBe(ref.fingerprint);
    }
  });

  it('tolere une saisie humaine approximative', () => {
    const ref = makeRef(42);
    const propre = toSpokenCode(ref);
    const variantes = [
      propre.toLowerCase(),
      propre.replace(/-/g, ''),
      propre.replace(/-/g, ' '),
      ` ${propre.toLowerCase()} `,
      propre.split('').join(' '),
    ];
    for (const saisie of variantes) {
      const retour = fromSpokenCode(saisie, SERVER);
      expect(retour.inviteId).toBe(ref.inviteId);
      expect(retour.fingerprint).toBe(ref.fingerprint);
    }
  });

  it('corrige les confusions classiques O/0 et I,L/1', () => {
    const ref = makeRef(7);
    const propre = toSpokenCode(ref);
    // Quelqu'un qui retape entend « zero » et tape la lettre O
    const malRetape = propre.replace(/0/g, 'O').replace(/1/g, 'I');
    const retour = fromSpokenCode(malRetape, SERVER);
    expect(retour.inviteId).toBe(ref.inviteId);
    expect(retour.fingerprint).toBe(ref.fingerprint);
  });

  it('reste dictable : moins de 60 caracteres', () => {
    expect(toSpokenCode(makeRef(1)).length).toBeLessThan(60);
  });
});

describe('rejets', () => {
  it('refuse ce qui n est pas une invitation', () => {
    expect(() => decodeInviteQr('https://exemple.fr')).toThrow(/invitation Blackout/);
    expect(() => decodeInviteQr('blackout:1:seulement-un-champ')).toThrow(/illisible/);
    expect(() => fromSpokenCode('TROP-COURT', SERVER)).toThrow(/trop court/);
  });
});
