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

/** Temps restant d'un partage, jamais negatif. */
export function resteLisible(until: number, maintenant = Date.now()): string {
  const minutes = Math.max(0, Math.round((until - maintenant) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${String(minutes % 60).padStart(2, '0')}`;
}
