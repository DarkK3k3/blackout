// Le mesh transporte des messages entre inconnus, sans internet.
//
// Deux proprietes valent d'etre verrouillees par des tests :
//   - un message finit par arriver, meme en passant par quelqu'un ;
//   - rien de ce qui arrive par la radio n'est pris pour argent
//     comptant, parce que ca vient d'un appareil inconnu.

import { creerPaquet, pourTransmission, estPaquetValide, estExpire, SAUTS_MAX } from '../paquet';
import { Sacoche } from '../sacoche';
import { decouper, Reassembleur, estTrameValide, MORCEAUX_MAX } from '../trames';
import { ouvrir, repondre, estMessageValide, PAQUETS_PAR_ENVOI_MAX } from '../rencontre';

describe('paquet', () => {
  it('perd un saut a chaque transmission, puis s arrete', () => {
    let paquet = creerPaquet('boite-de-bob', 'blob-chiffre', { sauts: 3 });
    paquet = pourTransmission(paquet)!;
    expect(paquet.sauts).toBe(2);
    paquet = pourTransmission(paquet)!;
    expect(paquet.sauts).toBe(1);
    // A un saut restant, il ne repart plus : il tournerait sans fin.
    expect(pourTransmission(paquet)).toBeNull();
  });

  it('expire', () => {
    const paquet = creerPaquet('boite', 'blob', { creeLe: 0 });
    expect(estExpire(paquet, 1000)).toBe(false);
    expect(estExpire(paquet, 25 * 60 * 60 * 1000)).toBe(true);
  });

  it('refuse un paquet mal forme venu de la radio', () => {
    const bon = creerPaquet('boite', 'blob');
    expect(estPaquetValide(bon)).toBe(true);

    expect(estPaquetValide(null)).toBe(false);
    expect(estPaquetValide('texte')).toBe(false);
    expect(estPaquetValide({ ...bon, id: '' })).toBe(false);
    expect(estPaquetValide({ ...bon, blob: '' })).toBe(false);
    expect(estPaquetValide({ ...bon, queueId: undefined })).toBe(false);
    expect(estPaquetValide({ ...bon, sauts: 0 })).toBe(false);
    expect(estPaquetValide({ ...bon, sauts: 1.5 })).toBe(false);
    expect(estPaquetValide({ ...bon, creeLe: 'hier' })).toBe(false);
  });

  it('refuse un nombre de sauts gonfle', () => {
    // Un voisin malveillant annoncerait un compteur enorme pour faire
    // tourner son paquet indefiniment dans le voisinage.
    const bon = creerPaquet('boite', 'blob');
    expect(estPaquetValide({ ...bon, sauts: SAUTS_MAX + 1 })).toBe(false);
    expect(estPaquetValide({ ...bon, sauts: 1e9 })).toBe(false);
  });

  it('refuse un blob demesure', () => {
    const enorme = creerPaquet('boite', 'x'.repeat(70_000));
    expect(estPaquetValide(enorme)).toBe(false);
  });
});

describe('sacoche', () => {
  it('ne range pas deux fois le meme paquet', () => {
    const sacoche = new Sacoche();
    const paquet = creerPaquet('boite', 'blob');
    expect(sacoche.ranger(paquet)).toBe(true);
    expect(sacoche.ranger(paquet)).toBe(false);
    expect(sacoche.taille).toBe(1);
  });

  it('ne reprend pas un paquet deja remis', () => {
    // Sinon un message remis puis recroise repartirait en boucle.
    const sacoche = new Sacoche();
    const paquet = creerPaquet('boite', 'blob');
    sacoche.ranger(paquet);
    sacoche.retirer(paquet.id);
    expect(sacoche.taille).toBe(0);
    expect(sacoche.ranger(paquet)).toBe(false);
  });

  it('jette les plus anciens quand elle deborde', () => {
    const sacoche = new Sacoche(3);
    const paquets = [0, 1, 2, 3, 4].map((i) => creerPaquet('boite', `blob-${i}`, { id: `p${i}` }));
    for (const p of paquets) sacoche.ranger(p);
    expect(sacoche.taille).toBe(3);
    expect(sacoche.resume()).toEqual(['p2', 'p3', 'p4']);
  });

  it('oublie les paquets expires', () => {
    const HEURE = 60 * 60 * 1000;
    const sacoche = new Sacoche();
    // Chaque paquet est range a SON heure : sans quoi le second serait
    // deja perime au moment ou on le range.
    sacoche.ranger(creerPaquet('boite', 'vieux', { creeLe: 0 }), 0);
    sacoche.ranger(creerPaquet('boite', 'recent', { creeLe: 24 * HEURE }), 24 * HEURE);
    // A 25 h : le premier a passe 25 h en sacoche, le second seulement 1 h.
    expect(sacoche.resume(25 * HEURE)).toHaveLength(1);
  });

  it('refuse de ranger un paquet deja expire', () => {
    const sacoche = new Sacoche();
    expect(sacoche.ranger(creerPaquet('boite', 'perime', { creeLe: 0 }), 25 * 60 * 60 * 1000)).toBe(false);
  });

  it('ne redemande pas ce qu elle connait deja', () => {
    const sacoche = new Sacoche();
    const porte = creerPaquet('boite', 'blob', { id: 'connu' });
    sacoche.ranger(porte);
    expect(sacoche.manquants(['connu', 'nouveau'])).toEqual(['nouveau']);
  });

  it('ne renvoie pas au voisin ce qu il porte deja', () => {
    const sacoche = new Sacoche();
    sacoche.ranger(creerPaquet('boite', 'a', { id: 'a' }));
    sacoche.ranger(creerPaquet('boite', 'b', { id: 'b' }));
    expect(sacoche.aRemettre(['a']).map((p) => p.id)).toEqual(['b']);
  });

  it('garde pour elle un paquet a bout de sauts, sans le faire voyager', () => {
    // Il peut encore etre remis a son destinataire en main propre.
    const sacoche = new Sacoche();
    sacoche.ranger(creerPaquet('ma-boite', 'blob', { id: 'fini', sauts: 1 }));
    expect(sacoche.aRemettre()).toHaveLength(0);
    expect(sacoche.pourMoi(['ma-boite'])).toHaveLength(1);
  });

  it('reconnait ce qui m est destine', () => {
    const sacoche = new Sacoche();
    sacoche.ranger(creerPaquet('ma-boite', 'pour-moi'));
    sacoche.ranger(creerPaquet('boite-d-un-autre', 'de-passage'));
    const miens = sacoche.pourMoi(['ma-boite']);
    expect(miens).toHaveLength(1);
    expect(miens[0].blob).toBe('pour-moi');
  });
});

describe('decoupage et reassemblage', () => {
  it('recolle un texte a l identique', () => {
    const texte = JSON.stringify({ blob: 'A'.repeat(5000), queueId: 'boite' });
    const trames = decouper('msg-1', texte, 180);
    expect(trames.length).toBeGreaterThan(20);

    const reassembleur = new Reassembleur();
    let resultat: string | null = null;
    for (const trame of trames) resultat = reassembleur.accepter(trame) ?? resultat;
    expect(resultat).toBe(texte);
  });

  it('recolle meme si les trames arrivent dans le desordre', () => {
    const texte = 'abcdefghijklmnopqrstuvwxyz';
    const trames = decouper('msg', texte, 5).reverse();
    const reassembleur = new Reassembleur();
    let resultat: string | null = null;
    for (const trame of trames) resultat = reassembleur.accepter(trame) ?? resultat;
    expect(resultat).toBe(texte);
  });

  it('ignore les trames en double', () => {
    const trames = decouper('msg', 'bonjour', 3);
    const reassembleur = new Reassembleur();
    reassembleur.accepter(trames[0]);
    expect(reassembleur.accepter(trames[0])).toBeNull();
    reassembleur.accepter(trames[1]);
    expect(reassembleur.accepter(trames[2])).toBe('bonjour');
  });

  it('refuse les trames mal formees', () => {
    expect(estTrameValide({ m: 'a', i: 0, n: 1, d: 'x' })).toBe(true);
    expect(estTrameValide({ m: 'a', i: 5, n: 2, d: 'x' })).toBe(false); // hors bornes
    expect(estTrameValide({ m: 'a', i: -1, n: 2, d: 'x' })).toBe(false);
    expect(estTrameValide({ m: '', i: 0, n: 1, d: 'x' })).toBe(false);
    expect(estTrameValide({ m: 'a', i: 0, n: MORCEAUX_MAX + 1, d: 'x' })).toBe(false);
    expect(estTrameValide(null)).toBe(false);
  });

  it("ignore un voisin qui change le total en cours de route", () => {
    const reassembleur = new Reassembleur();
    reassembleur.accepter({ m: 'x', i: 0, n: 3, d: 'aa' });
    expect(reassembleur.accepter({ m: 'x', i: 1, n: 9, d: 'bb' })).toBeNull();
  });

  it('ne se laisse pas remplir par des messages jamais termines', () => {
    // Sinon il suffirait d'envoyer des debuts de messages pour occuper
    // la memoire du telephone.
    const reassembleur = new Reassembleur(4);
    for (let i = 0; i < 50; i += 1) {
      reassembleur.accepter({ m: `abandonne-${i}`, i: 0, n: 10, d: 'x' });
    }
    expect(reassembleur.enAttente).toBeLessThanOrEqual(4);
  });

  it('jette les assemblages restes incomplets trop longtemps', () => {
    const reassembleur = new Reassembleur(32, 1000);
    reassembleur.accepter({ m: 'lent', i: 0, n: 2, d: 'a' }, 0);
    expect(reassembleur.enAttente).toBe(1);
    reassembleur.purger(5000);
    expect(reassembleur.enAttente).toBe(0);
  });
});

describe('rencontre entre deux telephones', () => {
  /** Fait dialoguer deux sacoches jusqu'a ce qu'elles n'aient plus rien a se dire. */
  function echanger(a: Sacoche, b: Sacoche, toursMax = 10): number {
    let message: unknown = ouvrir(a);
    let tours = 0;
    let versB = true;
    while (message && tours < toursMax) {
      const reponse = repondre(versB ? b : a, message);
      message = reponse;
      versB = !versB;
      tours += 1;
    }
    return tours;
  }

  it('transmet un message a un voisin', () => {
    const alice = new Sacoche();
    const bob = new Sacoche();
    alice.ranger(creerPaquet('boite-de-bob', 'message-chiffre', { id: 'p1' }));

    echanger(alice, bob);

    expect(bob.pourMoi(['boite-de-bob'])).toHaveLength(1);
    expect(bob.pourMoi(['boite-de-bob'])[0].blob).toBe('message-chiffre');
  });

  it('fait voyager un message par un porteur intermediaire', () => {
    // LE scenario du mesh : Alice et Bob ne se croisent jamais, mais
    // Charlie croise les deux. Sans internet, le message arrive quand
    // meme.
    const alice = new Sacoche();
    const charlie = new Sacoche();
    const bob = new Sacoche();
    alice.ranger(creerPaquet('boite-de-bob', 'a-bientot', { id: 'p1' }));

    echanger(alice, charlie); // Alice croise Charlie
    expect(charlie.taille).toBe(1);

    echanger(charlie, bob); // plus tard, Charlie croise Bob

    const recus = bob.pourMoi(['boite-de-bob']);
    expect(recus).toHaveLength(1);
    expect(recus[0].blob).toBe('a-bientot');
    // Deux sauts consommes sur les six.
    expect(recus[0].sauts).toBe(SAUTS_MAX - 2);
  });

  it('ne fait pas circuler indefiniment le meme paquet', () => {
    const alice = new Sacoche();
    const bob = new Sacoche();
    alice.ranger(creerPaquet('boite', 'blob', { id: 'p1' }));

    echanger(alice, bob);
    const toursSuivants = echanger(alice, bob);

    // La seconde rencontre s'arrete tout de suite : plus rien a dire.
    expect(toursSuivants).toBeLessThanOrEqual(2);
    expect(bob.taille).toBe(1);
  });

  it('ignore un message de rencontre mal forme', () => {
    const sacoche = new Sacoche();
    expect(repondre(sacoche, null)).toBeNull();
    expect(repondre(sacoche, { type: 'inconnu' })).toBeNull();
    expect(repondre(sacoche, { type: 'resume', ids: 'pas-un-tableau' })).toBeNull();
    expect(repondre(sacoche, { type: 'paquets', paquets: [{ id: 'incomplet' }] })).toBeNull();
    expect(sacoche.taille).toBe(0);
  });

  it('refuse un deluge de paquets en un seul envoi', () => {
    const paquets = Array.from({ length: PAQUETS_PAR_ENVOI_MAX + 1 }, (_, i) =>
      creerPaquet('boite', `blob-${i}`, { id: `p${i}` }),
    );
    expect(estMessageValide({ type: 'paquets', paquets })).toBe(false);
  });

  it("n'expose aucun expediteur dans ce qui circule", () => {
    // Un porteur ne doit pas pouvoir dire de qui vient ce qu'il
    // transporte.
    const paquet = creerPaquet('boite-de-bob', 'blob-chiffre');
    expect(Object.keys(paquet).sort()).toEqual(['blob', 'creeLe', 'id', 'queueId', 'sauts']);
  });
});
