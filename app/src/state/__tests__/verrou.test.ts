// Le verrou protege l'etat du ratchet. Une faute ici ne se verrait pas
// tout de suite : elle produirait, un jour, un message indechiffrable
// chez le destinataire. D'ou des tests sur l'entrelacement lui-meme.

import { VerrouParCle } from '../verrou';

/** Tache qui note son entree et sa sortie dans un journal commun. */
function tacheTracee(journal: string[], nom: string, ms = 0) {
  return async () => {
    journal.push(`${nom}:debut`);
    await new Promise((r) => setTimeout(r, ms));
    journal.push(`${nom}:fin`);
    return nom;
  };
}

describe('VerrouParCle', () => {
  it("n'entrelace jamais deux taches de la meme cle", async () => {
    const verrou = new VerrouParCle();
    const journal: string[] = [];

    // La premiere est LENTE : sans verrou, la seconde commencerait
    // avant qu'elle ait fini, et les deux se marcheraient dessus.
    await Promise.all([
      verrou.executer('bob', tacheTracee(journal, 'a', 30)),
      verrou.executer('bob', tacheTracee(journal, 'b', 0)),
    ]);

    expect(journal).toEqual(['a:debut', 'a:fin', 'b:debut', 'b:fin']);
  });

  it('laisse deux cles differentes avancer en parallele', async () => {
    // Deux conversations ont des sessions distinctes : les serialiser
    // entre elles ralentirait sans rien proteger.
    const verrou = new VerrouParCle();
    const journal: string[] = [];

    await Promise.all([
      verrou.executer('bob', tacheTracee(journal, 'bob', 20)),
      verrou.executer('alice', tacheTracee(journal, 'alice', 0)),
    ]);

    expect(journal.indexOf('alice:fin')).toBeLessThan(journal.indexOf('bob:fin'));
  });

  it('rend le resultat de chaque tache a son appelant', async () => {
    const verrou = new VerrouParCle();
    const resultats = await Promise.all([
      verrou.executer('bob', async () => 1),
      verrou.executer('bob', async () => 2),
      verrou.executer('bob', async () => 3),
    ]);
    expect(resultats).toEqual([1, 2, 3]);
  });

  it("l'echec d'une tache ne bloque pas les suivantes", async () => {
    // Un envoi peut echouer : reseau coupe, relais injoignable. Si cela
    // gelait la file, le contact deviendrait injoignable pour toujours.
    const verrou = new VerrouParCle();
    const journal: string[] = [];

    const echec = verrou.executer('bob', async () => {
      throw new Error('reseau coupe');
    });
    const apres = verrou.executer('bob', tacheTracee(journal, 'suivante'));

    await expect(echec).rejects.toThrow('reseau coupe');
    await expect(apres).resolves.toBe('suivante');
    expect(journal).toEqual(['suivante:debut', 'suivante:fin']);
  });

  it("l'echec d'une tache ne produit pas de rejet non gere", async () => {
    // Regression : memoriser la promesse rejetee telle quelle faisait
    // remonter un "unhandled rejection" a chaque operation suivante.
    const verrou = new VerrouParCle();
    const rejets: unknown[] = [];
    const capter = (raison: unknown) => rejets.push(raison);
    process.on('unhandledRejection', capter);

    await verrou.executer('bob', async () => {
      throw new Error('boum');
    }).catch(() => undefined);
    await verrou.executer('bob', async () => 'ok');
    await new Promise((r) => setTimeout(r, 20));

    process.off('unhandledRejection', capter);
    expect(rejets).toEqual([]);
  });

  it('libere sa memoire quand tout est termine', async () => {
    // Le verrou vit aussi longtemps que l'app : une entree conservee
    // par contact et par envoi finirait par peser.
    const verrou = new VerrouParCle();
    await verrou.executer('bob', async () => 'ok');
    await verrou.executer('alice', async () => 'ok');
    await new Promise((r) => setTimeout(r, 10));
    expect(verrou.enCours).toBe(0);
  });

  it('respecte l ordre de demande, pas l ordre de duree', async () => {
    const verrou = new VerrouParCle();
    const journal: string[] = [];
    await Promise.all([
      verrou.executer('bob', tacheTracee(journal, 'premiere', 25)),
      verrou.executer('bob', tacheTracee(journal, 'deuxieme', 15)),
      verrou.executer('bob', tacheTracee(journal, 'troisieme', 0)),
    ]);
    expect(journal).toEqual([
      'premiere:debut',
      'premiere:fin',
      'deuxieme:debut',
      'deuxieme:fin',
      'troisieme:debut',
      'troisieme:fin',
    ]);
  });
});
