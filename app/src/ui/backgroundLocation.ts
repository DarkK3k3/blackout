// backgroundLocation.ts — partage de position quand l'app est fermee.
//
// CE QUI CHANGE PAR RAPPORT AUX NOTIFICATIONS
// -------------------------------------------
// Les notifications push sont impossibles ici : elles passeraient par
// les serveurs d'Apple, qui apprendraient qui recoit quoi et quand.
// La position en arriere-plan, elle, ne fait intervenir personne : iOS
// reveille NOTRE code, qui chiffre lui-meme et poste sur NOTRE relais.
// Aucun tiers n'apprend quoi que ce soit. C'est pour ca que l'un est
// exclu et l'autre non.
//
// COMMENT IOS S'Y PREND
// ---------------------
// Quand une position arrive et que l'app n'est plus a l'ecran, le
// systeme demarre le bundle JavaScript, appelle la tache ci-dessous,
// puis arrete tout. Aucune vue n'est montee : la tache ne peut donc
// s'appuyer sur aucun etat React. Elle passe par `obtenirBlackout()`,
// qui ouvre la base chiffree (la cle est lisible en arriere-plan grace
// a AFTER_FIRST_UNLOCK, choisi des le depart pour ce cas).
//
// CE QUE CA COUTE, ET QUI DOIT LE SAVOIR
// --------------------------------------
// - l'autorisation demandee devient « Toujours », plus « Quand l'app
//   est ouverte » ;
// - iOS rappelle periodiquement a l'utilisateur que l'app suit sa
//   position, avec une carte des relevés ;
// - la batterie s'use davantage. D'ou `distanceInterval` : on ne
//   demande une position que tous les 80 metres parcourus, pas toutes
//   les N secondes. Quelqu'un d'immobile ne consomme rien.
//
// La tache s'arrete d'elle-meme des qu'aucun partage n'est ouvert :
// `broadcastLocation` ne diffuse qu'aux partages encore valides, et on
// coupe le suivi quand il n'en reste aucun.

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { obtenirBlackout } from '../state/instance';

export const TACHE_POSITION = 'blackout-partage-position';

interface DonneesTache {
  locations?: Location.LocationObject[];
}

// defineTask DOIT etre appele au niveau du module, avant tout rendu :
// quand l'app est demarree en arriere-plan, il n'y a pas de composant
// pour le faire.
TaskManager.defineTask<DonneesTache>(TACHE_POSITION, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  // La derniere position est la seule qui compte : on ne diffuse pas
  // une trace, on dit ou on est maintenant.
  const derniere = data.locations[data.locations.length - 1];

  try {
    const app = await obtenirBlackout();
    const envoyes = await app.broadcastLocation({
      latitude: derniere.coords.latitude,
      longitude: derniere.coords.longitude,
      accuracyM: derniere.coords.accuracy ?? undefined,
      measuredAt: derniere.timestamp,
    });
    // Plus aucun partage ouvert : inutile de continuer a consommer la
    // batterie. Le suivi redemarrera au prochain partage.
    if (envoyes === 0) await arreterSuiviArrierePlan();
  } catch {
    // Une erreur en arriere-plan ne doit jamais faire tomber l'app :
    // la position suivante retentera.
  }
});

/** L'autorisation « Toujours » est-elle accordee ? */
export async function autorisationArrierePlan(): Promise<boolean> {
  const { granted } = await Location.getBackgroundPermissionsAsync();
  return granted;
}

/**
 * Demande l'autorisation « Toujours ». iOS exige que l'autorisation
 * « quand l'app est ouverte » soit deja accordee.
 */
export async function demanderAutorisationArrierePlan(): Promise<boolean> {
  const avant = await Location.getForegroundPermissionsAsync();
  if (!avant.granted) {
    const demande = await Location.requestForegroundPermissionsAsync();
    if (!demande.granted) return false;
  }
  const { granted } = await Location.requestBackgroundPermissionsAsync();
  return granted;
}

/** Le suivi tourne-t-il ? */
export async function suiviArrierePlanActif(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TACHE_POSITION).catch(() => false);
}

/**
 * Demarre le suivi. Sans autorisation « Toujours », rend `false` : le
 * partage continue alors de fonctionner, mais seulement app ouverte.
 */
export async function demarrerSuiviArrierePlan(): Promise<boolean> {
  if (!(await autorisationArrierePlan())) return false;
  if (await suiviArrierePlanActif()) return true;

  await Location.startLocationUpdatesAsync(TACHE_POSITION, {
    // Precision "balanced" : une centaine de metres suffit pour dire ou
    // on est, et coute bien moins cher que le GPS a pleine puissance.
    accuracy: Location.Accuracy.Balanced,
    // Rien n'est emis tant qu'on n'a pas bouge de 80 m : quelqu'un
    // d'immobile ne consomme ni batterie ni forfait.
    distanceInterval: 80,
    timeInterval: 60_000,
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.Other,
    // L'indicateur bleu reste visible : l'utilisateur doit voir que sa
    // position part, ce n'est pas negociable dans une app comme celle-ci.
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Blackout partage ta position',
      notificationBody: 'Partage en cours, chiffre de bout en bout.',
      notificationColor: '#FF3B1F',
    },
  });
  return true;
}

/** Coupe le suivi. Sans effet s'il ne tourne pas. */
export async function arreterSuiviArrierePlan(): Promise<void> {
  if (await suiviArrierePlanActif()) {
    await Location.stopLocationUpdatesAsync(TACHE_POSITION).catch(() => undefined);
  }
}

/**
 * Aligne le suivi sur la realite des partages : actif s'il en reste au
 * moins un, coupe sinon. Appele au demarrage et a chaque changement.
 */
export async function synchroniserSuivi(partagesOuverts: number): Promise<void> {
  if (partagesOuverts > 0) {
    await demarrerSuiviArrierePlan();
  } else {
    await arreterSuiviArrierePlan();
  }
}
