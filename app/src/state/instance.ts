// instance.ts — l'unique Blackout du processus.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Jusqu'ici l'application etait construite dans un composant React.
// Ca ne suffit plus : quand iOS reveille l'app en arriere-plan pour
// livrer une position, il demarre le bundle JavaScript, execute la
// tache, et s'arrete — AUCUNE vue n'est montee. Le contexte React
// n'existe pas dans ce scenario.
//
// L'instance vit donc ici, au niveau du module, accessible aussi bien
// par l'interface que par la tache de fond. Un seul exemplaire, donc
// une seule base ouverte et une seule session par contact : c'est ce
// qui evite deux etats de ratchet concurrents.

import { Blackout } from './blackout';
import { openBlackoutStore } from '../storage/openDatabase';
import { nativeSignalBridge } from '../../modules/blackout-signal';
import { RELAY_URL, MY_DISPLAY_NAME } from '../config';

let instance: Blackout | null = null;
let enCoursDeCreation: Promise<Blackout> | null = null;

/**
 * Rend l'instance, en la creant au premier appel.
 *
 * Les appels concurrents (l'interface qui demarre pendant qu'une tache
 * de fond se reveille) partagent la MEME promesse : sans cela, deux
 * instances ouvriraient deux fois la base et feraient avancer deux
 * copies de la meme session.
 */
export function obtenirBlackout(): Promise<Blackout> {
  if (instance) return Promise.resolve(instance);
  if (enCoursDeCreation) return enCoursDeCreation;

  enCoursDeCreation = (async () => {
    const store = await openBlackoutStore();
    // Les reglages enregistres priment sur les valeurs de compilation :
    // changer de relais ne doit jamais imposer de recompiler.
    const settings = await Blackout.loadSettings(store, {
      relayUrl: RELAY_URL,
      displayName: MY_DISPLAY_NAME,
    });
    const app = new Blackout(store, nativeSignalBridge, settings.relayUrl, settings.displayName);
    await app.init();
    instance = app;
    return app;
  })();

  // En cas d'echec (base illisible, par exemple), on ne garde pas une
  // promesse rejetee en cache : le prochain essai doit pouvoir aboutir.
  enCoursDeCreation.catch(() => {
    enCoursDeCreation = null;
  });

  return enCoursDeCreation;
}

/** Instance deja construite, ou null. Ne declenche aucune ouverture. */
export function blackoutDejaOuvert(): Blackout | null {
  return instance;
}

/** Uniquement pour les tests : repart d'un etat vierge. */
export function reinitialiserInstance(): void {
  instance = null;
  enCoursDeCreation = null;
}
