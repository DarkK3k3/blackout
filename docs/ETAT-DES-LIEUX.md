# État des lieux — point de reprise

Document de passation, à lire en premier au début d'une nouvelle
conversation. Il dit **où on en est, ce qui reste, et ce qu'il ne faut
surtout pas refaire**. Mis à jour le 2026-07-28.

Arbre de travail propre, `main` poussé sur `DarkK3k3/blackout`.
**98 tests verts côté app** (`npx tsc --noEmit && npx jest` dans `app/`)
et **37 côté relais Cloudflare** (`node --test` dans `relay-worker/`).

Relais en production : `https://blackout-relay.trzoskikevin.workers.dev`

---

## 1. Ce qui fonctionne, validé sur le téléphone de Kevin

- Chiffrement bout en bout via **libsignal officiel** 0.99.1 (X3DH/PQXDH
  + Double Ratchet), module natif `app/modules/blackout-signal/`.
- Ajout de contact par **QR** et par **code tapé** (Crockford base32).
- Conversations texte dans les deux sens, en temps réel, sans redémarrer
  l'app après un ajout de contact.
- **Code de vérification mensuel** identique des deux côtés, empreinte
  stable d'un mois sur l'autre.
- Stockage local **SQLCipher** (clé en Keychain), réglages modifiables
  sans recompiler.
- **Partage de position chiffré** (ponctuel ou pendant une durée bornée,
  8 h max), carte façon Life360.
- **Notifications locales** à la réception (nom de l'expéditeur, jamais
  le contenu).
- Zones de sécurité (Dynamic Island) et clavier : réglés, validés par
  Kevin — *« Clavier c'est parfait »*.
- Chaîne de **sideload iOS gratuit** : GitHub Actions produit un IPA non
  signé (~19 Mo), Sideloadly l'installe avec un Apple ID gratuit.

Compte Apple (précisé le 2026-07-28) : Kevin a **un compte développeur
gratuit**, associé à son Apple ID, sans abonnement payé. C'est ce qui
permet le sideload actuel. Ce qu'un compte gratuit ne permet pas, et
qu'il ne faut donc pas lui promettre : TestFlight, les notifications
push (APNs), les App Groups, et une signature qui dure plus de 7 jours.

## 2. Le point ouvert immédiat : la carte

Retour de Kevin le 2026-07-28 : *« carte mieux mais on peut encore
améliorer, la rendre un peu plus fun, glitché, pourquoi avec des infos
sur le trafic routier etc… avoir des infos intéressantes quoi »*.

Ce que la carte fait déjà : plein écran, pastilles aux initiales,
cercles de précision, bandeau « X te voit / ARRETER », bouton « TOUT
VOIR », bande de cartes-contacts qui glisse (distance à vol d'oiseau,
ancienneté, ECRIRE / OUBLIER).

**Fait le 2026-07-28**, tout sans la moindre fuite (chaque information
se calcule sur le téléphone, à partir de positions déjà reçues) :
- **trafic routier** — bouton TRAFIC, `showsTraffic` sur `MapView` : la
  couche vient des tuiles de la carte, aucune coordonnée d'ami n'est
  envoyée pour l'obtenir ;
- **vitesse, cap et état** (« A PIED », « EN VOITURE »…) déduits de deux
  relevés successifs, avec deux garde-fous : sous 5 s d'écart le bruit
  du GPS ferait courir un immobile, au-delà d'un quart d'heure une
  moyenne ne dit plus rien du présent ;
- **fraîcheur** (DIRECT / RECENT / ANCIEN / PERIME) et pastille estompée
  quand la position est périmée — une position vieille de trois heures
  affichée comme les autres est un mensonge par omission ;
- **habillage DedSec** : lignes de balayage, équerres de visée aux
  angles, résolution glitch du nom à chaque nouvelle position.

Le suivi du déplacement vit **en mémoire vive uniquement**
(`suivreMouvements`, fonction pure) : rien n'est historisé sur le
disque, donc rien de plus à effacer en cas de vol du téléphone.

Restent en attente, et **à trancher avec Kevin car elles coûtent en vie
privée** :
- **batterie de l'autre téléphone** : demande `expo-battery` (module
  natif de plus) et un champ de plus dans le payload chiffré — invisible
  du relais, mais impose de reconstruire les deux téléphones ;
- **adresse lisible** (« 12 rue X, Lyon ») : le géocodage inverse envoie
  les coordonnées d'un ami chez Apple ou Google ;
- **itinéraire** vers la personne : même problème.

Fichiers concernés : `app/src/ui/screens/MapScreen.tsx` (présentation
pure) et `app/src/ui/screens/mapMath.ts` (calculs purs, testés contre
des distances réelles — react-native-maps ne se charge pas dans Jest,
d'où la séparation : **garder les calculs hors du composant**).

## 3. Ce qui reste, dans l'ordre convenu avec Kevin

0. ~~Relais permanent~~ **FAIT le 2026-07-28** : en ligne sur
   `https://blackout-relay.trzoskikevin.workers.dev`, vérifié par les 7
   tests WebSocket et le test bout en bout de l'app. Reste à Kevin à
   coller l'adresse dans les réglages de ses deux téléphones.
1. **Peaufiner la carte** (voir ci-dessus).
2. **Notifications quand l'app est fermée.** Kevin le regrette
   explicitement. État des lieux honnête : les notifications *push*
   exigent APNs, donc un compte développeur Apple **payant** (99 €/an) —
   son compte gratuit ne les autorise pas. Et même payantes, elles
   révéleraient à Apple qui reçoit un message et quand. La seule voie
   sans compromis est `BGTaskScheduler` (relève périodique en tâche de
   fond, `expo-background-task`) : ça fonctionne avec un compte gratuit,
   mais iOS décide seul du moment — compter des dizaines de minutes de
   retard, pas des secondes. À proposer comme un mieux, jamais comme
   l'équivalent d'une notification instantanée.
3. **Mesh Bluetooth** (tâche #8). Contrainte connue : sur iOS,
   CoreBluetooth en arrière-plan est très restreint — le mesh ne
   marchera qu'app ouverte. À dire à Kevin avant de coder.
4. **Photos dans les conversations** (le stockage et le transport sont
   prêts, l'écran ne l'est pas).
5. **Écrans de groupe** (le moteur fan-out pairwise est déjà écrit et
   testé, il manque l'interface).
6. **Animations Dynamic Island** (Live Activities) — demandé comme un
   « ce serait top », pas comme un besoin. C'est une **extension native
   séparée** ; sur une app installée sans compte développeur payant,
   c'est une vraie complication. À garder pour la fin.

## 4. Pièges à ne jamais réintroduire

- **Hermes n'est pas Node.** Pas de `crypto.getRandomValues`, pas de
  `btoa`/`atob`, pas de `TextEncoder` garanti. Tout passe par
  `app/src/platform/runtime.ts` ; un test de garde scanne `src/` et
  échoue si un fichier applicatif retouche ces globaux. Aucun test Node
  ne peut voir ce genre de bug — seul le téléphone le révèle.
- **BoringSSL vs OpenSSL** : libsignal embarque BoringSSL, op-sqlite
  embarquait OpenSSL → mêmes noms de symboles, structures différentes,
  SIGSEGV. Réglé en compilant SQLCipher avec **CommonCrypto**
  (`plugins/withSqlcipherCommonCrypto.js`, vérifié en CI).
- **Ne jamais figer l'URL du relais à la compilation** : elle est dans
  les réglages. Sinon chaque changement d'adresse coûte un rebuild de
  12 min, une réinstallation, et un cycle de signature de 7 jours brûlé.
- **Ne jamais faire confiance à une coche verte de CI** sans vérifier la
  taille de l'artefact : un `xcodebuild | tail` avait renvoyé le code de
  sortie de `tail` et produit un IPA de 308 octets « réussi ». D'où
  `set -o pipefail` + garde-fous de taille dans le workflow.
- **Le QR ne doit plus jamais contenir les clés** : la clé Kyber seule
  fait 2092 caractères, on dépassait la capacité d'un QR. Il porte une
  référence + une empreinte BLAKE2b-128 qui interdit la substitution.
- **Alphabet Crockford = exactement 32 caractères** (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`).
  Un alphabet à 31 caractères avait corrompu la moitié des codes.
- `??` ne se déclenche pas sur une chaîne vide — utiliser `envOr()`.

## 5. Contraintes de Kevin, non négociables

- Jamais de cryptographie maison pour les messages : toujours libsignal.
- Aucune clé privée ne quitte l'appareil, sous aucun prétexte.
- Le relais ne doit jamais pouvoir déchiffrer, ni savoir durablement qui
  parle à qui.
- Toute mise en relation passe par une vérification hors-bande (QR).
- Le stockage local reste chiffré même téléphone volé.
- **Jamais de code livré non testé** : vérifier que ça compile et tourne
  avant de passer à la suite. Ne pas annoncer un test réussi sans avoir
  vu le compte de tests (un `tail -4` m'avait masqué la sortie ; et une
  fois j'ai dit « je relance la compilation » sans l'avoir fait — Kevin
  l'a repéré).
- Kevin est débutant : expliquer simplement, donner des commandes prêtes
  à copier, et poser une question plutôt que deviner.

## 6. Commandes utiles

```bash
cd blackout/app && npx tsc --noEmit && npx jest
```

```bash
cd blackout/relay-worker && npm test
```

Relais Cloudflare en local (vrai moteur, rien n'est envoyé en ligne) :

```bash
cd blackout/relay-worker && npm run dev
```

Mise en ligne (après `npx wrangler login`) :

```bash
cd blackout/relay-worker && npx wrangler deploy
```

Ancien relais Node, toujours utilisable en repli :

```bash
cd blackout/relay-server && node src/server.js
```

Test de fumée contre un vrai relais (dans `app/`) :

```bash
BLACKOUT_RELAY_URL=<url> npm run test:relay
```

Un push sur `main` déclenche la construction de l'IPA non signé
(`.github/workflows/ios-unsigned-ipa.yml`), à récupérer dans les
artefacts du run GitHub Actions.
