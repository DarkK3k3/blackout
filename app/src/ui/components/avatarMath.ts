// avatarMath.ts — l'empreinte visuelle d'une cle d'identite.
//
// POURQUOI CE N'EST PAS QU'UNE DECORATION
// ---------------------------------------
// Le motif est calcule A PARTIR de la cle publique du contact. Il n'est
// donc pas choisi, pas modifiable, pas usurpable : deux cles
// differentes donnent deux motifs differents.
//
// Consequence utile : si la cle d'un contact change — parce qu'il a
// reinstalle, ou parce que quelqu'un tente de se faire passer pour lui
// — SON AVATAR CHANGE. L'anomalie devient visible du coin de l'oeil,
// sans ouvrir le moindre menu. C'est de la verification passive, en
// complement du code mensuel, pas a sa place.
//
// Le calcul est PUR et local : rien n'est demande a personne.

import { blake2b } from '@noble/hashes/blake2.js';
import { utf8Encode } from '../../platform/runtime';

/** Cotes de la grille. Impair : il y a une colonne centrale. */
export const COTE = 5;

export interface MotifAvatar {
  /** Cases allumees, en ligne par ligne (COTE × COTE). */
  cases: boolean[];
  /** Couleur du motif, tiree elle aussi de la cle. */
  couleur: string;
  /** Le meme condense, en hexadecimal court, pour l'afficher au besoin. */
  empreinteCourte: string;
}

/**
 * Palette DedSec. Volontairement restreinte et sombre : un avatar ne
 * doit pas hurler plus fort qu'un indicateur de securite.
 */
export const PALETTE = [
  '#FF3B1F', // ember
  '#00E5FF', // cyan
  '#FF2BD6', // magenta
  '#FFB300', // ambre
  '#7C4DFF', // violet
  '#00E676', // vert
] as const;

/**
 * Calcule le motif d'une cle d'identite.
 *
 * La grille est SYMETRIQUE par rapport a son axe vertical : un visage
 * se reconnait mieux qu'un bruit, et la memoire visuelle est justement
 * ce sur quoi on compte pour reperer un changement.
 */
export function motifDepuisCle(cleIdentite: string): MotifAvatar {
  const condense = blake2b(utf8Encode(cleIdentite || 'inconnu'), { dkLen: 32 });

  const moitie = Math.ceil(COTE / 2);
  const cases: boolean[] = new Array(COTE * COTE).fill(false);

  for (let ligne = 0; ligne < COTE; ligne += 1) {
    for (let colonne = 0; colonne < moitie; colonne += 1) {
      // Un bit distinct par case de la moitie gauche.
      const rang = ligne * moitie + colonne;
      const allumee = (condense[rang % condense.length] >> rang % 8 & 1) === 1;
      cases[ligne * COTE + colonne] = allumee;
      // Miroir : la colonne centrale se recopie sur elle-meme.
      cases[ligne * COTE + (COTE - 1 - colonne)] = allumee;
    }
  }

  const couleur = PALETTE[condense[condense.length - 1] % PALETTE.length];

  let empreinteCourte = '';
  for (let i = 0; i < 4; i += 1) empreinteCourte += condense[i].toString(16).padStart(2, '0');

  return { cases, couleur, empreinteCourte };
}
