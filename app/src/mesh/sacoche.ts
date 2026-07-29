// sacoche.ts — ce que mon telephone porte pour les autres.
//
// Le mesh fonctionne en « stockage et transport » : quand deux
// telephones se croisent, ils s'echangent ce qu'ils portent. Un message
// peut donc arriver a destination via quelqu'un qui passait par la,
// meme si l'expediteur et le destinataire ne se sont jamais vus
// directement — et meme sans aucune connexion internet.
//
// LES LIMITES SONT DES CHOIX
// --------------------------
// Une sacoche sans borne serait un moyen simple de remplir le telephone
// de quelqu'un. Elle est donc plafonnee en nombre de paquets, et chaque
// paquet expire. Quand elle deborde, on jette les PLUS ANCIENS : ils
// ont deja eu le plus d'occasions d'etre remis.

import { type PaquetMesh, estExpire, pourTransmission } from './paquet';

export const CAPACITE_PAR_DEFAUT = 200;

export class Sacoche {
  private readonly paquets = new Map<string, PaquetMesh>();
  /**
   * Identifiants deja vus, y compris ceux qu'on a remis ou jetes.
   *
   * Sans cette memoire, un paquet remis puis recroise reviendrait dans
   * la sacoche et repartirait en boucle dans le voisinage.
   */
  private readonly dejaVus = new Set<string>();

  constructor(private readonly capacite = CAPACITE_PAR_DEFAUT) {}

  get taille(): number {
    return this.paquets.size;
  }

  /**
   * Range un paquet. Rend `false` s'il etait deja connu — c'est ce qui
   * empeche un meme message de circuler indefiniment entre deux
   * appareils qui se le repassent.
   */
  ranger(paquet: PaquetMesh, maintenant = Date.now()): boolean {
    if (this.dejaVus.has(paquet.id)) return false;
    if (estExpire(paquet, maintenant)) return false;

    this.dejaVus.add(paquet.id);
    this.paquets.set(paquet.id, paquet);
    this.faireDeLaPlace();
    return true;
  }

  /** Identifiants portes, a annoncer a un voisin. */
  resume(maintenant = Date.now()): string[] {
    this.purger(maintenant);
    return [...this.paquets.keys()];
  }

  /**
   * Ce que le voisin porte et que je n'ai pas.
   *
   * On compare aux identifiants DEJA VUS, pas seulement a ce qu'on
   * porte : redemander un paquet qu'on a deja remis serait du trafic
   * pur perdu.
   */
  manquants(resumeDuVoisin: string[]): string[] {
    return resumeDuVoisin.filter((id) => !this.dejaVus.has(id));
  }

  /**
   * Paquets a remettre a un voisin, sauts deja decrementes.
   *
   * `saufIds` evite de renvoyer au voisin ce qu'il porte deja.
   */
  aRemettre(saufIds: string[] = [], maintenant = Date.now()): PaquetMesh[] {
    this.purger(maintenant);
    const connus = new Set(saufIds);
    const sortie: PaquetMesh[] = [];
    for (const paquet of this.paquets.values()) {
      if (connus.has(paquet.id)) continue;
      const suivant = pourTransmission(paquet);
      // Un paquet a bout de sauts reste dans MA sacoche (il peut encore
      // etre remis a son destinataire si je le croise), mais je ne le
      // fais plus voyager.
      if (suivant) sortie.push(suivant);
    }
    return sortie;
  }

  /** Paquets destines a l'une de MES boites : a dechiffrer et remettre. */
  pourMoi(mesQueueIds: string[], maintenant = Date.now()): PaquetMesh[] {
    this.purger(maintenant);
    const miennes = new Set(mesQueueIds);
    return [...this.paquets.values()].filter((p) => miennes.has(p.queueId));
  }

  /** Retire un paquet remis avec succes. Il reste « deja vu ». */
  retirer(id: string): void {
    this.paquets.delete(id);
  }

  purger(maintenant = Date.now()): number {
    let jetes = 0;
    for (const [id, paquet] of this.paquets) {
      if (estExpire(paquet, maintenant)) {
        this.paquets.delete(id);
        jetes += 1;
      }
    }
    return jetes;
  }

  private faireDeLaPlace(): void {
    while (this.paquets.size > this.capacite) {
      // Map conserve l'ordre d'insertion : la premiere cle est la plus
      // anciennement rangee.
      const plusAncien = this.paquets.keys().next();
      if (plusAncien.done) return;
      this.paquets.delete(plusAncien.value);
    }
  }
}
