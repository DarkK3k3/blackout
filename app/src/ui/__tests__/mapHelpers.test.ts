// Les calculs affiches sur la carte : une distance fausse ne "plante"
// pas, elle ment. D'ou ces tests sur des reperes verifiables.

import {
  distanceM,
  distanceLisible,
  initiales,
  ageLisible,
  resteLisible,
  vitesseKmh,
  etatDeplacement,
  capDegres,
  pointCardinal,
  fraicheur,
  suivreMouvements,
} from '../screens/mapMath';

describe('distance', () => {
  const PARIS = { latitude: 48.8566, longitude: 2.3522 };
  const MARSEILLE = { latitude: 43.2965, longitude: 5.3698 };
  const LONDRES = { latitude: 51.5074, longitude: -0.1278 };

  it('retrouve des distances reelles connues', () => {
    // Paris–Marseille : environ 660 km a vol d'oiseau
    expect(distanceM(PARIS, MARSEILLE) / 1000).toBeGreaterThan(640);
    expect(distanceM(PARIS, MARSEILLE) / 1000).toBeLessThan(680);
    // Paris–Londres : environ 344 km
    expect(distanceM(PARIS, LONDRES) / 1000).toBeGreaterThan(330);
    expect(distanceM(PARIS, LONDRES) / 1000).toBeLessThan(360);
  });

  it('est nulle pour un meme point et symetrique', () => {
    expect(distanceM(PARIS, PARIS)).toBeCloseTo(0, 5);
    expect(distanceM(PARIS, MARSEILLE)).toBeCloseTo(distanceM(MARSEILLE, PARIS), 5);
  });

  it('reste juste sur de tres courtes distances', () => {
    // 0,001 degre de latitude = environ 111 m
    const proche = { latitude: PARIS.latitude + 0.001, longitude: PARIS.longitude };
    const d = distanceM(PARIS, proche);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });

  it('gere le passage du meridien de Greenwich', () => {
    const a = { latitude: 51.5, longitude: -0.05 };
    const b = { latitude: 51.5, longitude: 0.05 };
    expect(distanceM(a, b)).toBeGreaterThan(6000);
    expect(distanceM(a, b)).toBeLessThan(8000);
  });
});

describe('affichage des distances', () => {
  it('arrondit sans donner une fausse impression de precision', () => {
    expect(distanceLisible(23)).toBe('20 m');
    expect(distanceLisible(487)).toBe('490 m');
    expect(distanceLisible(1500)).toBe('1.5 km');
    expect(distanceLisible(12000)).toBe('12 km');
    expect(distanceLisible(660000)).toBe('660 km');
  });
});

describe('vitesse deduite de deux positions', () => {
  const DEPART = { latitude: 48.8566, longitude: 2.3522, measuredAt: 0 };

  /** Un point situe a `metres` au nord du depart. */
  const auNord = (metres: number, measuredAt: number) => ({
    latitude: DEPART.latitude + metres / 111_320,
    longitude: DEPART.longitude,
    measuredAt,
  });

  it('retrouve une vitesse connue', () => {
    // 1000 m en 60 s = 60 km/h
    const v = vitesseKmh(DEPART, auNord(1000, 60_000));
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(58);
    expect(v!).toBeLessThan(62);
  });

  it('refuse de conclure sur un ecart de temps trop court', () => {
    // Deux relevés a 3 s d'ecart : le bruit du GPS (quelques metres)
    // ferait apparaitre une vitesse pour quelqu'un d'immobile.
    expect(vitesseKmh(DEPART, auNord(8, 3_000))).toBeNull();
  });

  it('refuse de conclure sur un ecart de temps trop long', () => {
    // Une heure plus tard, une moyenne ne dit plus rien du present.
    expect(vitesseKmh(DEPART, auNord(30_000, 3_600_000))).toBeNull();
  });

  it('rend zero pour quelqu un qui n a pas bouge', () => {
    expect(vitesseKmh(DEPART, { ...DEPART, measuredAt: 60_000 })).toBeCloseTo(0, 5);
  });
});

describe('etat de deplacement', () => {
  it('traduit une vitesse en mode plausible', () => {
    expect(etatDeplacement(0)).toBe('A L ARRET');
    expect(etatDeplacement(1.5)).toBe('A L ARRET');
    expect(etatDeplacement(5)).toBe('A PIED');
    expect(etatDeplacement(18)).toBe('A VELO');
    expect(etatDeplacement(90)).toBe('EN VOITURE');
    expect(etatDeplacement(400)).toBe('TRES VITE');
  });

  it("n'invente rien quand la vitesse est inconnue", () => {
    expect(etatDeplacement(null)).toBeNull();
  });
});

describe('cap et point cardinal', () => {
  const PARIS = { latitude: 48.8566, longitude: 2.3522, measuredAt: 0 };

  it('trouve les quatre directions principales', () => {
    const nord = { latitude: 49.8566, longitude: 2.3522, measuredAt: 1 };
    const sud = { latitude: 47.8566, longitude: 2.3522, measuredAt: 1 };
    const est = { latitude: 48.8566, longitude: 3.3522, measuredAt: 1 };
    const ouest = { latitude: 48.8566, longitude: 1.3522, measuredAt: 1 };

    expect(capDegres(PARIS, nord)).toBeCloseTo(0, 1);
    expect(capDegres(PARIS, sud)).toBeCloseTo(180, 1);
    expect(capDegres(PARIS, est)).toBeGreaterThan(85);
    expect(capDegres(PARIS, est)).toBeLessThan(95);
    expect(capDegres(PARIS, ouest)).toBeGreaterThan(265);
    expect(capDegres(PARIS, ouest)).toBeLessThan(275);
  });

  it('rend toujours un cap entre 0 et 360', () => {
    const cap = capDegres(PARIS, { latitude: 47.0, longitude: 1.0, measuredAt: 1 });
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(cap).toBeLessThan(360);
  });

  it('nomme le point cardinal, y compris au passage par le nord', () => {
    expect(pointCardinal(0)).toBe('N');
    expect(pointCardinal(45)).toBe('NE');
    expect(pointCardinal(90)).toBe('E');
    expect(pointCardinal(180)).toBe('S');
    expect(pointCardinal(225)).toBe('SO');
    expect(pointCardinal(359)).toBe('N'); // et non un index hors tableau
    expect(pointCardinal(360)).toBe('N');
    expect(pointCardinal(-90)).toBe('O');
  });
});

describe('suivi du mouvement entre deux rafraichissements', () => {
  const contact = (measuredAt: number, metresAuNord = 0) => ({
    contactId: 'bob',
    latitude: 48.8566 + metresAuNord / 111_320,
    longitude: 2.3522,
    measuredAt,
  });

  it("n'affirme rien sur une premiere position", () => {
    const suivi = suivreMouvements({}, [contact(0)]);
    expect(suivi.bob.mouvement).toEqual({ vitesseKmh: null, capDeg: null });
  });

  it('calcule le mouvement a la position suivante', () => {
    const premier = suivreMouvements({}, [contact(0)]);
    const second = suivreMouvements(premier, [contact(60_000, 1000)]);
    expect(second.bob.mouvement.vitesseKmh!).toBeGreaterThan(58);
    expect(second.bob.mouvement.vitesseKmh!).toBeLessThan(62);
    expect(second.bob.mouvement.capDeg!).toBeCloseTo(0, 0); // plein nord
  });

  it('conserve le calcul quand l ecran se rafraichit sans nouvelle position', () => {
    // Regression : l'ecran se rafraichit bien plus souvent que les
    // positions n'arrivent. Sans memoire, la vitesse clignoterait puis
    // disparaitrait.
    const premier = suivreMouvements({}, [contact(0)]);
    const second = suivreMouvements(premier, [contact(60_000, 1000)]);
    const troisieme = suivreMouvements(second, [contact(60_000, 1000)]);
    expect(troisieme.bob.mouvement).toEqual(second.bob.mouvement);
  });

  it('oublie un contact qui ne partage plus', () => {
    const premier = suivreMouvements({}, [contact(0)]);
    const apres = suivreMouvements(premier, []);
    expect(apres.bob).toBeUndefined();
  });

  it('ne modifie pas le suivi qu on lui donne', () => {
    const premier = suivreMouvements({}, [contact(0)]);
    const copie = JSON.parse(JSON.stringify(premier));
    suivreMouvements(premier, [contact(60_000, 1000)]);
    expect(premier).toEqual(copie);
  });
});

describe('fraicheur d une position', () => {
  const MAINTENANT = 1_000_000_000;
  const ilYA = (minutes: number) => MAINTENANT - minutes * 60_000;

  it('distingue le direct du perime', () => {
    expect(fraicheur(ilYA(0), MAINTENANT)).toBe('DIRECT');
    expect(fraicheur(ilYA(1), MAINTENANT)).toBe('DIRECT');
    expect(fraicheur(ilYA(10), MAINTENANT)).toBe('RECENT');
    expect(fraicheur(ilYA(60), MAINTENANT)).toBe('ANCIEN');
    expect(fraicheur(ilYA(300), MAINTENANT)).toBe('PERIME');
  });

  it('ne se laisse pas surprendre par une horloge en avance', () => {
    // Le telephone d'en face peut avoir quelques secondes d'avance :
    // ca doit rester "DIRECT", pas basculer dans un etat absurde.
    expect(fraicheur(MAINTENANT + 30_000, MAINTENANT)).toBe('DIRECT');
  });
});

describe('initiales', () => {
  it('gere un prenom seul, un nom complet, et les cas limites', () => {
    expect(initiales('Kevin')).toBe('KE');
    expect(initiales('Kevin Trzoski')).toBe('KT');
    expect(initiales('  jean  pierre  dupont ')).toBe('JP');
    expect(initiales('')).toBe('?');
    expect(initiales('   ')).toBe('?');
    expect(initiales('é')).toBe('É');
  });
});
