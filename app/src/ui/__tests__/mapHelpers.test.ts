// Les calculs affiches sur la carte : une distance fausse ne "plante"
// pas, elle ment. D'ou ces tests sur des reperes verifiables.

import { distanceM, distanceLisible, initiales, ageLisible, resteLisible } from '../screens/mapMath';

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
