// retour.ts — le vocabulaire tactile de Blackout.
//
// L'app doit se SENTIR, pas seulement se voir. Un retour haptique bien
// dose fait plus pour l'impression de machine reactive que n'importe
// quelle animation : c'est physique, immediat, et ca marche meme quand
// l'ecran est a peine regarde.
//
// Regle : un vocabulaire FERME et cohérent, pas une vibration par
// bouton. Chaque intensite veut dire quelque chose de precis, et la
// meme chose partout dans l'app.
//
//   toucher   -> selection, onglet, bouton neutre       (leger)
//   envoi     -> un message part                        (moyen)
//   reception -> un message chiffre vient d'arriver     (double bref)
//   succes    -> verification confirmee, contact ajoute (succes)
//   echec     -> envoi impossible, code errone          (erreur)
//   alerte    -> partage de position ouvert ou ferme    (lourd)
//
// Tout est silencieux en cas d'indisponibilite : un simulateur, un
// appareil sans moteur haptique ou un module absent ne doivent JAMAIS
// faire echouer une action utile.

import * as Haptics from 'expo-haptics';

export type Retour = 'toucher' | 'envoi' | 'reception' | 'succes' | 'echec' | 'alerte';

let actif = true;

/** Coupe tous les retours (reglage utilisateur, tests). */
export function definirRetourActif(valeur: boolean): void {
  actif = valeur;
}

export function retourActif(): boolean {
  return actif;
}

/**
 * Joue un retour tactile. Ne rejette jamais : un echec haptique n'est
 * pas une erreur applicative.
 */
export async function vibrer(retour: Retour): Promise<void> {
  if (!actif) return;
  try {
    switch (retour) {
      case 'toucher':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'envoi':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case 'reception':
        // Deux impulsions breves : on reconnait « quelque chose est
        // arrive » sans regarder l'ecran.
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await new Promise((r) => setTimeout(r, 90));
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'succes':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case 'echec':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      case 'alerte':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        return;
    }
  } catch {
    // Simulateur, appareil sans moteur haptique, module indisponible :
    // on continue sans bruit.
  }
}

/** Version « tire et oublie », pour les gestionnaires d'evenements. */
export function vibrerVite(retour: Retour): void {
  void vibrer(retour);
}
