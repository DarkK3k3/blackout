// Calculs affiches sur la carte, isoles du composant.
//
// Ils vivent a part parce que le composant importe react-native-maps,
// un module natif impossible a charger en test. Une distance fausse ne
// provoque aucune erreur : elle ment, simplement. Elle merite donc
// d'etre verifiee sur des reperes reels.

/** Distance a vol d'oiseau (haversine), en metres. */
export function distanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distance lisible. Volontairement arrondie : afficher « 487 m »
 * suggere une precision que le GPS n'a pas.
 */
export function distanceLisible(metres: number): string {
  if (metres < 950) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 100_000) return `${(metres / 1000).toFixed(1).replace('.0', '')} km`;
  return `${Math.round(metres / 1000)} km`;
}

/** Initiales affichees dans la pastille d'un contact. */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[1][0]).toUpperCase();
}

/** « il y a 3 min », « il y a 2 h »… */
export function ageLisible(ms: number, maintenant = Date.now()): string {
  const minutes = Math.floor((maintenant - ms) / 60_000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `il y a ${Math.floor(heures / 24)} j`;
}

// --- mouvement ---
//
// Rien de tout ceci ne sort du telephone : la vitesse et le cap sont
// DEDUITS de deux positions deja recues et dechiffrees. Aucun service
// tiers n'est interroge, aucune coordonnee d'ami n'est envoyee nulle
// part. C'est le critere qui a decide de ce qu'on affiche ou non.

export interface Trace {
  latitude: number;
  longitude: number;
  measuredAt: number;
}

/**
 * Vitesse moyenne entre deux relevés, en km/h. `null` quand le calcul
 * n'aurait pas de sens.
 *
 * Deux garde-fous : sous quelques secondes d'ecart, le bruit du GPS
 * (plusieurs metres) dominerait et afficherait des vitesses fantaisistes
 * pour quelqu'un d'immobile ; au-dela d'un quart d'heure, une moyenne
 * ne raconte plus rien du present.
 */
export function vitesseKmh(precedent: Trace, actuel: Trace): number | null {
  const secondes = (actuel.measuredAt - precedent.measuredAt) / 1000;
  if (secondes < 5 || secondes > 15 * 60) return null;
  return (distanceM(precedent, actuel) / secondes) * 3.6;
}

/**
 * Traduit une vitesse en etat lisible. Volontairement prudent : on
 * annonce un mode de deplacement PLAUSIBLE, jamais une certitude.
 */
export function etatDeplacement(kmh: number | null): string | null {
  if (kmh === null) return null;
  if (kmh < 2) return 'A L ARRET';
  if (kmh < 7) return 'A PIED';
  if (kmh < 25) return 'A VELO';
  if (kmh < 130) return 'EN VOITURE';
  return 'TRES VITE';
}

/** Cap suivi entre deux relevés, en degres depuis le nord (0–360). */
export function capDegres(precedent: Trace, actuel: Trace): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLon = rad(actuel.longitude - precedent.longitude);
  const y = Math.sin(dLon) * Math.cos(rad(actuel.latitude));
  const x =
    Math.cos(rad(precedent.latitude)) * Math.sin(rad(actuel.latitude)) -
    Math.sin(rad(precedent.latitude)) * Math.cos(rad(actuel.latitude)) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Point cardinal correspondant a un cap. */
export function pointCardinal(degres: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const normalise = ((degres % 360) + 360) % 360;
  return points[Math.round(normalise / 45) % 8];
}

/**
 * Fraicheur d'une position, pour l'indicateur d'etat.
 *
 * Une position perimee affichee comme les autres est un mensonge par
 * omission : on regarde une carte pour savoir ou quelqu'un est
 * MAINTENANT.
 */
export function fraicheur(measuredAt: number, maintenant = Date.now()): 'DIRECT' | 'RECENT' | 'ANCIEN' | 'PERIME' {
  const minutes = (maintenant - measuredAt) / 60_000;
  if (minutes < 2) return 'DIRECT';
  if (minutes < 15) return 'RECENT';
  if (minutes < 120) return 'ANCIEN';
  return 'PERIME';
}

export interface Mouvement {
  vitesseKmh: number | null;
  capDeg: number | null;
}

export interface SuiviContact {
  derniere: Trace;
  mouvement: Mouvement;
}

/**
 * Suit le deplacement des contacts d'un rafraichissement a l'autre.
 *
 * Fonction PURE : elle recoit le suivi precedent et rend le suivant,
 * sans rien modifier. Le suivi ne vit qu'en memoire, le temps que
 * l'ecran reste ouvert — aucune position n'est historisee sur le
 * disque, et donc rien de plus a effacer en cas de vol du telephone.
 *
 * Subtilite qui justifie de garder le mouvement dans le suivi : l'ecran
 * se rafraichit bien plus souvent que les positions n'arrivent. Sans
 * memoire du dernier calcul, la vitesse s'afficherait une fraction de
 * seconde puis disparaitrait au rafraichissement suivant.
 */
export function suivreMouvements(
  precedent: Record<string, SuiviContact>,
  fixes: (Trace & { contactId: string })[],
): Record<string, SuiviContact> {
  const suivant: Record<string, SuiviContact> = {};
  for (const fix of fixes) {
    const trace: Trace = {
      latitude: fix.latitude,
      longitude: fix.longitude,
      measuredAt: fix.measuredAt,
    };
    const avant = precedent[fix.contactId];

    if (!avant) {
      // Premiere position connue : rien a comparer, donc rien a affirmer.
      suivant[fix.contactId] = { derniere: trace, mouvement: { vitesseKmh: null, capDeg: null } };
    } else if (avant.derniere.measuredAt === trace.measuredAt) {
      suivant[fix.contactId] = avant; // meme releve : on garde le calcul precedent
    } else {
      suivant[fix.contactId] = {
        derniere: trace,
        mouvement: {
          vitesseKmh: vitesseKmh(avant.derniere, trace),
          capDeg: capDegres(avant.derniere, trace),
        },
      };
    }
  }
  // Les contacts absents des fixes (partage ferme, position oubliee)
  // ne sont pas repris : leur trace disparait avec eux.
  return suivant;
}

/** Temps restant d'un partage, jamais negatif. */
export function resteLisible(until: number, maintenant = Date.now()): string {
  const minutes = Math.max(0, Math.round((until - maintenant) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${String(minutes % 60).padStart(2, '0')}`;
}
