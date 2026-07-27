// config.ts — valeurs par DEFAUT de l'installation.
//
// Elles ne servent qu'au tout premier lancement : l'adresse du relais
// et le nom affiche se reglent ensuite dans l'ecran Reglages de l'app
// (bouton ⌘), et ce qui y est enregistre prime toujours sur ce fichier.
// Changer de relais n'oblige donc jamais a recompiler.

/**
 * Lit une variable d'environnement en traitant la chaine vide comme
 * ABSENTE.
 *
 * Ce detail compte : la compilation automatique transmet une variable
 * vide quand aucune adresse n'est fournie. Avec `??`, une chaine vide
 * est une valeur valide — l'app serait partie avec une adresse de
 * relais vide, et aucun message ne serait passe.
 */
function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

// ATTENTION : l'adresse ci-dessous est un tunnel de TEST, qui change a
// chaque redemarrage. Elle n'est la que pour depanner au premier
// lancement — voir relay-server/README.md pour une adresse stable.
export const RELAY_URL = envOr(
  process.env.EXPO_PUBLIC_RELAY_URL,
  'https://marcus-feeding-computed-patches.trycloudflare.com',
);

export const MY_DISPLAY_NAME = envOr(process.env.EXPO_PUBLIC_DISPLAY_NAME, 'Kevin');
