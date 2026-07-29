// paquet.ts — ce qui circule de telephone a telephone, sans internet.
//
// LE PRINCIPE
// -----------
// Le mesh n'est qu'un TRANSPORT de plus. Il transporte exactement le
// meme blob que celui qu'on aurait poste sur le relais : deja chiffre
// de bout en bout par libsignal. Un telephone qui relaie ne peut donc
// pas plus lire le message qu'un serveur ne le pourrait — il rend
// service sans rien apprendre.
//
// CE QU'UN RELAYEUR VOIT QUAND MEME
// ---------------------------------
// L'identifiant de la boite aux lettres de destination. C'est
// inevitable : sans lui, personne ne saurait a qui remettre le paquet.
// Cet identifiant est un nombre aleatoire, sans lien avec une identite,
// et c'est exactement ce que voit deja le relais. Aucune metadonnee
// nouvelle n'est creee par le mesh.
//
// Le paquet ne porte AUCUN expediteur : un porteur ne peut donc pas
// dire de qui vient ce qu'il transporte, ni depuis combien de sauts.

import { randomId } from '../platform/runtime';

/** Au-dela, un paquet a assez voyage : on evite qu'il tourne sans fin. */
export const SAUTS_MAX = 6;

/** Duree de vie d'un paquet en attente de remise, en millisecondes. */
export const DUREE_VIE_MS = 24 * 60 * 60 * 1000;

export interface PaquetMesh {
  /** Identifiant unique : sert a ne pas retransmettre deux fois. */
  id: string;
  /** Boite de destination, telle qu'elle serait sur le relais. */
  queueId: string;
  /** Le blob chiffre, opaque pour tout porteur. */
  blob: string;
  /** Sauts restants. Decremente a chaque transmission. */
  sauts: number;
  /** Date de creation, pour l'expiration. */
  creeLe: number;
}

/** Fabrique un paquet a partir d'un message pret a partir. */
export function creerPaquet(
  queueId: string,
  blob: string,
  options: { sauts?: number; creeLe?: number; id?: string } = {},
): PaquetMesh {
  return {
    id: options.id ?? randomId(12),
    queueId,
    blob,
    sauts: options.sauts ?? SAUTS_MAX,
    creeLe: options.creeLe ?? Date.now(),
  };
}

/**
 * Prepare un paquet pour la transmission au voisin suivant.
 *
 * Rend `null` quand le paquet a epuise ses sauts : le laisser circuler
 * plus longtemps saturerait le mesh sans rapprocher personne.
 */
export function pourTransmission(paquet: PaquetMesh): PaquetMesh | null {
  if (paquet.sauts <= 1) return null;
  return { ...paquet, sauts: paquet.sauts - 1 };
}

export function estExpire(paquet: PaquetMesh, maintenant = Date.now(), dureeVie = DUREE_VIE_MS): boolean {
  return maintenant - paquet.creeLe >= dureeVie;
}

/**
 * Verifie qu'un objet recu par la radio est bien un paquet.
 *
 * Tout ce qui arrive par le mesh vient d'un appareil inconnu : rien ne
 * doit etre pris pour argent comptant. Un paquet mal forme est ignore,
 * il ne doit jamais faire tomber l'application.
 */
export function estPaquetValide(valeur: unknown, tailleBlobMax = 64 * 1024): valeur is PaquetMesh {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const p = valeur as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    p.id.length <= 64 &&
    typeof p.queueId === 'string' &&
    p.queueId.length > 0 &&
    p.queueId.length <= 128 &&
    typeof p.blob === 'string' &&
    p.blob.length > 0 &&
    p.blob.length <= tailleBlobMax &&
    typeof p.sauts === 'number' &&
    Number.isInteger(p.sauts) &&
    p.sauts > 0 &&
    // Un voisin malveillant pourrait annoncer un nombre de sauts
    // enorme pour faire tourner son paquet indefiniment.
    p.sauts <= SAUTS_MAX &&
    typeof p.creeLe === 'number' &&
    Number.isFinite(p.creeLe)
  );
}
