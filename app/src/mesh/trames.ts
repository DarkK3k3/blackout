// trames.ts — decouper pour passer par la radio, puis recoller.
//
// Le Bluetooth ne transporte que de petits blocs (souvent moins de
// 200 octets utiles par notification). Un message chiffre, lui, fait
// facilement plusieurs kilo-octets. Il faut donc le decouper a
// l'emission et le reassembler a la reception.
//
// TOUT CE QUI ARRIVE ICI VIENT D'UN APPAREIL INCONNU
// --------------------------------------------------
// Le reassemblage est un endroit classique de mauvaises surprises : on
// y accepte des morceaux venus de nulle part, et on les garde en
// memoire en attendant la suite. Trois garde-fous, donc :
//   - un nombre de morceaux borne, annonce d'avance ;
//   - un plafond d'assemblages en cours (sinon on remplit la memoire
//     du telephone en envoyant des debuts de messages jamais finis) ;
//   - une expiration : un assemblage incomplet finit par etre jete.

export interface Trame {
  /** Identifiant de l'assemblage auquel appartient ce morceau. */
  m: string;
  /** Numero du morceau, a partir de 0. */
  i: number;
  /** Nombre total de morceaux. */
  n: number;
  /** Le morceau lui-meme. */
  d: string;
}

export const MORCEAUX_MAX = 512;
export const ASSEMBLAGES_MAX = 32;
export const EXPIRATION_ASSEMBLAGE_MS = 60_000;

/** Decoupe un texte en trames d'au plus `tailleUtile` caracteres. */
export function decouper(id: string, texte: string, tailleUtile: number): Trame[] {
  if (tailleUtile <= 0) throw new Error('taille de trame invalide');
  const nombre = Math.max(1, Math.ceil(texte.length / tailleUtile));
  if (nombre > MORCEAUX_MAX) throw new Error('message trop grand pour le mesh');

  const trames: Trame[] = [];
  for (let i = 0; i < nombre; i += 1) {
    trames.push({ m: id, i, n: nombre, d: texte.slice(i * tailleUtile, (i + 1) * tailleUtile) });
  }
  return trames;
}

export function estTrameValide(valeur: unknown): valeur is Trame {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const t = valeur as Record<string, unknown>;
  return (
    typeof t.m === 'string' &&
    t.m.length > 0 &&
    t.m.length <= 64 &&
    typeof t.n === 'number' &&
    Number.isInteger(t.n) &&
    t.n > 0 &&
    t.n <= MORCEAUX_MAX &&
    typeof t.i === 'number' &&
    Number.isInteger(t.i) &&
    t.i >= 0 &&
    t.i < t.n &&
    typeof t.d === 'string'
  );
}

interface Assemblage {
  morceaux: (string | undefined)[];
  recus: number;
  n: number;
  debut: number;
}

/**
 * Reassemble les trames recues. Rend le texte complet des qu'un
 * assemblage est termine, `null` sinon.
 */
export class Reassembleur {
  private readonly enCours = new Map<string, Assemblage>();

  constructor(
    private readonly max = ASSEMBLAGES_MAX,
    private readonly expiration = EXPIRATION_ASSEMBLAGE_MS,
  ) {}

  get enAttente(): number {
    return this.enCours.size;
  }

  accepter(valeur: unknown, maintenant = Date.now()): string | null {
    if (!estTrameValide(valeur)) return null;
    this.purger(maintenant);

    let assemblage = this.enCours.get(valeur.m);
    if (!assemblage) {
      if (this.enCours.size >= this.max) {
        // On sacrifie le plus ancien plutot que de refuser le nouveau :
        // sinon un seul assemblage abandonne bloquerait la place.
        const plusAncien = this.enCours.keys().next();
        if (!plusAncien.done) this.enCours.delete(plusAncien.value);
      }
      assemblage = { morceaux: new Array(valeur.n), recus: 0, n: valeur.n, debut: maintenant };
      this.enCours.set(valeur.m, assemblage);
    }

    // Un voisin qui changerait le total en cours de route corromprait
    // l'assemblage : on ignore la trame incoherente.
    if (assemblage.n !== valeur.n) return null;
    // Trame en double : frequent en radio, sans consequence.
    if (assemblage.morceaux[valeur.i] !== undefined) return null;

    assemblage.morceaux[valeur.i] = valeur.d;
    assemblage.recus += 1;
    if (assemblage.recus < assemblage.n) return null;

    this.enCours.delete(valeur.m);
    return assemblage.morceaux.join('');
  }

  purger(maintenant = Date.now()): number {
    let jetes = 0;
    for (const [id, assemblage] of this.enCours) {
      if (maintenant - assemblage.debut >= this.expiration) {
        this.enCours.delete(id);
        jetes += 1;
      }
    }
    return jetes;
  }
}
