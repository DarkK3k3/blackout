// notifications.ts — alertes LOCALES a la reception d'un message.
//
// POURQUOI PAS DE NOTIFICATIONS PUSH
// ----------------------------------
// Une notification push passe par les serveurs d'Apple. Meme sans
// contenu, elle leur revelerait qui recoit un message et quand —
// exactement la metadonnee que ce projet s'attache a ne pas produire.
// Et pour afficher un apercu, il faudrait leur confier le texte, ou
// installer une extension de dechiffrement : deux compromis qu'on
// refuse ici.
//
// On declenche donc des notifications LOCALES, generees par le
// telephone lui-meme au moment ou il dechiffre un message. Contrepartie
// assumee : elles n'arrivent que si l'app tourne (au premier plan ou
// brievement en arriere-plan). C'est le prix de l'absence de tiers.
//
// L'apercu du message n'est JAMAIS affiche : on annonce l'expediteur,
// pas le contenu. Une notification s'affiche sur ecran verrouille.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let pretes = false;

/** Demande l'autorisation une seule fois, sans bloquer si elle est refusee. */
export async function preparerNotifications(): Promise<boolean> {
  if (pretes) return true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  const actuelle = await Notifications.getPermissionsAsync();
  const accordee = actuelle.granted
    ? true
    : (await Notifications.requestPermissionsAsync()).granted;

  if (accordee && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    });
  }

  pretes = accordee;
  return accordee;
}

/**
 * Annonce un message recu, SANS son contenu.
 *
 * Le texte d'un message chiffre n'a rien a faire dans le centre de
 * notifications, qui est lisible sur un ecran verrouille par quiconque
 * tient le telephone.
 */
export async function notifierMessage(expediteur: string, conversationId: string): Promise<void> {
  if (!pretes) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: expediteur,
      body: 'Nouveau message chiffre',
      data: { conversationId },
      sound: true,
    },
    trigger: null, // immediat
  });
}

/** Annonce une position recue. Meme principe : pas de coordonnees. */
export async function notifierPosition(expediteur: string, conversationId: string): Promise<void> {
  if (!pretes) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: expediteur,
      body: 'A partage sa position',
      data: { conversationId },
    },
    trigger: null,
  });
}

/** Efface le compteur sur l'icone quand l'utilisateur revient dans l'app. */
export async function effacerBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => {});
}
