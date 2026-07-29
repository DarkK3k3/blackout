// rencontre.ts — ce que deux telephones se disent quand ils se croisent.
//
// Trois messages, pas un de plus. Le protocole est volontairement
// minuscule : il tourne sur une radio lente, entre deux appareils qui
// peuvent se perdre de vue a tout moment.
//
//   RESUME    « voila les identifiants que je porte »
//   DEMANDE   « donne-moi ceux-la, je ne les ai pas »
//   PAQUETS   « les voila »
//
// Aucune identification, aucune poignee de main, aucun secret partage :
// deux inconnus peuvent s'entraider sans rien s'apprendre. La securite
// ne repose pas sur la confiance envers le porteur — elle repose sur le
// fait que le contenu est deja chiffre de bout en bout.
//
// Un echange qui s'interrompt n'a aucune consequence : la prochaine
// rencontre reprendra ou on en etait.

import { type PaquetMesh, estPaquetValide } from './paquet';
import type { Sacoche } from './sacoche';

export type MessageRencontre =
  | { type: 'resume'; ids: string[] }
  | { type: 'demande'; ids: string[] }
  | { type: 'paquets'; paquets: PaquetMesh[] };

/** Plafonds : un voisin ne doit pas pouvoir nous noyer en une fois. */
export const IDS_MAX = 500;
export const PAQUETS_PAR_ENVOI_MAX = 20;

export function estMessageValide(valeur: unknown): valeur is MessageRencontre {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const m = valeur as Record<string, unknown>;
  if (m.type === 'resume' || m.type === 'demande') {
    return (
      Array.isArray(m.ids) &&
      m.ids.length <= IDS_MAX &&
      m.ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
    );
  }
  if (m.type === 'paquets') {
    return (
      Array.isArray(m.paquets) &&
      m.paquets.length <= PAQUETS_PAR_ENVOI_MAX &&
      m.paquets.every((p) => estPaquetValide(p))
    );
  }
  return false;
}

/** Premier mot d'une rencontre : ce que je porte. */
export function ouvrir(sacoche: Sacoche, maintenant = Date.now()): MessageRencontre {
  return { type: 'resume', ids: sacoche.resume(maintenant).slice(0, IDS_MAX) };
}

/**
 * Traite un message d'un voisin et rend la reponse a lui envoyer
 * (ou `null` s'il n'y a rien a repondre).
 *
 * Fonction sans etat propre : tout vit dans la sacoche. C'est ce qui
 * rend le protocole testable sans radio, et rejouable a l'identique.
 */
export function repondre(
  sacoche: Sacoche,
  message: unknown,
  maintenant = Date.now(),
): MessageRencontre | null {
  if (!estMessageValide(message)) return null;

  if (message.type === 'resume') {
    // Deux choses a faire : demander ce qui me manque, et lui proposer
    // ce qu'il n'a pas. On commence par demander — c'est ce qui
    // rapproche MES messages de leur destinataire.
    const manquants = sacoche.manquants(message.ids);
    if (manquants.length > 0) {
      return { type: 'demande', ids: manquants.slice(0, IDS_MAX) };
    }
    const aRemettre = sacoche.aRemettre(message.ids, maintenant);
    if (aRemettre.length === 0) return null;
    return { type: 'paquets', paquets: aRemettre.slice(0, PAQUETS_PAR_ENVOI_MAX) };
  }

  if (message.type === 'demande') {
    const demandes = new Set(message.ids);
    const paquets = sacoche
      .aRemettre([], maintenant)
      .filter((p) => demandes.has(p.id))
      .slice(0, PAQUETS_PAR_ENVOI_MAX);
    if (paquets.length === 0) return null;
    return { type: 'paquets', paquets };
  }

  // type === 'paquets'
  let ranges = 0;
  for (const paquet of message.paquets) {
    if (sacoche.ranger(paquet, maintenant)) ranges += 1;
  }
  // On repond par notre propre resume : l'echange devient symetrique
  // sans avoir a distinguer qui a commence.
  return ranges > 0 ? ouvrir(sacoche, maintenant) : null;
}
