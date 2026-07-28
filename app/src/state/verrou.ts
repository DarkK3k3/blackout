// verrou.ts — serialise les operations qui touchent au ratchet.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Chiffrer un message avec le Double Ratchet n'est pas une lecture :
// l'operation FAIT AVANCER l'etat de la session, qui est ensuite
// reecrit en base. Deux envois simultanes vers le meme contact liraient
// donc le meme etat de depart, produiraient chacun leur message, et le
// second ecraserait l'etat du premier. Resultat cote destinataire : un
// message indechiffrable, definitivement.
//
// Le risque etait theorique tant que l'app n'envoyait que depuis un
// ecran ouvert. Il devient reel avec le partage de position en arriere-
// plan : iOS peut reveiller la tache pendant que l'app tourne deja.
//
// Le verrou est PAR CONTACT : deux conversations differentes ont des
// sessions differentes et peuvent avancer en parallele sans danger.

export class VerrouParCle {
  /** Derniere operation en cours pour chaque cle. */
  private readonly files = new Map<string, Promise<unknown>>();

  /**
   * Execute `tache` apres que toutes les taches deja demandees pour
   * cette cle sont terminees. Rend le resultat (ou l'erreur) de `tache`.
   */
  executer<T>(cle: string, tache: () => Promise<T>): Promise<T> {
    const precedente = this.files.get(cle) ?? Promise.resolve();
    // `then(tache, tache)` et non `.then(tache)` : l'echec d'un envoi ne
    // doit pas bloquer a jamais tous les suivants vers ce contact.
    const courante = precedente.then(tache, tache);

    // Ce qu'on memorise ne doit jamais rejeter, sinon la chaine
    // propagerait un rejet non gere a chaque operation suivante.
    const suivie = courante.then(
      () => undefined,
      () => undefined,
    );
    this.files.set(cle, suivie);

    void suivie.then(() => {
      // Rien n'a ete empile depuis : l'entree ne sert plus a rien.
      if (this.files.get(cle) === suivie) this.files.delete(cle);
    });

    return courante;
  }

  /** Nombre de cles ayant encore une operation en cours (diagnostic, tests). */
  get enCours(): number {
    return this.files.size;
  }
}
