// config.ts — reglages de l'installation.
//
// RELAY_URL : adresse de TON serveur relais (voir relay-server/README.md).
// Il ne voit que des blobs chiffres, mais choisis-le quand meme :
// c'est lui qui sait quand tes appareils sont en ligne.
//
// MY_DISPLAY_NAME : le nom montre a tes contacts. Il ne quitte jamais
// tes conversations chiffrees (il voyage dans le "hello", chiffre).

// ATTENTION : l'URL "trycloudflare.com" ci-dessous est un tunnel de TEST.
// Elle change a chaque redemarrage de cloudflared. Pour une adresse
// stable, voir relay-server/README.md (tunnel nomme, ou portage vers
// Cloudflare Workers).
export const RELAY_URL =
  process.env.EXPO_PUBLIC_RELAY_URL ?? 'https://subsection-ebook-condos-shine.trycloudflare.com';

export const MY_DISPLAY_NAME = process.env.EXPO_PUBLIC_DISPLAY_NAME ?? 'Kevin';
