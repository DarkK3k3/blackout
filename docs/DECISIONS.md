# Décisions techniques — Blackout

Journal des choix structurants et de leurs raisons. Mis à jour au fil du projet.

## 2026-07-25 — Contexte de départ

- Machine de dev : Windows 11, Node 24, **pas de JDK, pas d'Android SDK, pas de Mac**.
  → Tout build natif (Android ET iOS) passe par **EAS Build** (cloud Expo),
  ou nécessite d'installer localement JDK + Android SDK (~3 Go) pour l'Android.
- Prototype pédagogique validé (`crypto-prototype/`, `node demo.js` : OK).

## Choix actés avec Kevin

| Sujet | Décision | Raison |
|---|---|---|
| Framework | Expo SDK 57 (prebuild) + TypeScript | EAS Build compile iOS sans Mac ; modules natifs via Expo Modules API |
| Crypto messages | libsignal officiel via module natif maison | Bindings Node officiels incompatibles RN/Hermes ; les wrappers communautaires sont moins audités ; on bridge les libs officielles Swift + Kotlin |
| Groupes (5–10) | Fan-out pairwise en v1 | Simple, robuste ; Sender Keys = complexité injustifiée à cette échelle, surtout avec le BLE mesh |
| Relais | Oracle Cloud Always Free (plan B : Raspberry Pi + Cloudflare Tunnel) | Seule offre gratuite 24h/24 sans endormissement (WebSockets stables) |
| Nom de travail | « Blackout » | Renommable avant le 1er upload TestFlight (le bundle ID ne doit plus changer ensuite) |

## Intégration libsignal — faits vérifiés (juillet 2026)

- **Android** : `org.signal:libsignal-android` est sur **Maven Central**
  (version courante : 0.86.5). Dépendance Gradle directe dans le module
  Expo local, rien d'exotique.
- **iOS** : `LibSignalClient.podspec` à la racine de
  https://github.com/signalapp/libsignal. Le podspec **télécharge des
  binaires précompilés** depuis `build-artifacts.signal.org` (pas de
  compilation Rust) ; il exige la variable d'environnement
  `LIBSIGNAL_FFI_PREBUILD_CHECKSUM` (valeur publiée par Signal pour chaque
  version, visible dans le Podfile de Signal-iOS). À passer dans `eas.json`
  (`build.<profil>.env`). Cible iOS 15+.
- **Version à figer** : utiliser le MÊME numéro de version libsignal des
  deux côtés (ex. 0.86.5 Android ↔ tag v0.86.5 du podspec) pour garantir
  l'interopérabilité du format de messages.
- Il existe des wrappers communautaires (`react-native-libsignal-client`,
  `expo-libsignal-client`) — non retenus (maintenance irrégulière, surface
  d'audit supplémentaire), mais leur architecture valide l'approche ci-dessous.

## Architecture du module natif : « cœur fonctionnel, état côté JS »

Le natif n'a **aucun état persistant**. Chaque fonction reçoit les records
sérialisés (session, identité, prekeys — des `Uint8Array` opaques produits
par libsignal), exécute l'opération via les stores in-memory de libsignal,
et **retourne les records mis à jour** avec le résultat. La persistance de
ces records appartient à la couche JS, dans SQLCipher.

Pourquoi :
- une seule source de vérité (la DB chiffrée), pas de double état natif/JS ;
- le natif reste petit, sans SQL, donc plus facile à auditer ;
- testable de bout en bout depuis Jest (on mocke le module natif avec les
  bindings Node officiels `@signalapp/libsignal-client`, même cœur Rust —
  les tests d'interop tournent sur la machine de dev sans émulateur).

Les clés privées ne quittent jamais l'appareil : les records restent dans
SQLCipher local ; seuls transitent sur le réseau les bundles PUBLICS de
prekeys et les ciphertexts.

## Vérification mensuelle

Port TS pur (`app/src/crypto/verification.ts`, BLAKE2b via @noble/hashes),
prouvé bit à bit contre le prototype libsodium par vecteurs générés
(`tools/gen-verification-vectors.js`, 17 tests Jest verts). Totalement
découplé de la couche session — invariant à préserver à jamais.

## 2026-07-26 — Couche crypto et stockage construites

- **Module natif `modules/blackout-signal/`** : Kotlin (libsignal-android
  0.99.1 via le repo maven de Signal + `extraMavenRepos` d'expo-build-properties)
  et Swift (LibSignalClient v0.99.1 injecte dans le Podfile par
  `plugins/withLibsignalPod.js`). Toutes les signatures d'API verifiees
  contre les sources du tag v0.99.1. Android exige le core library
  desugaring → `plugins/withDesugaring.js`.
- **Tests d'interop** : la couche session est testee en Jest avec les
  bindings Node officiels (`@signalapp/libsignal-client` 0.99.1, meme
  coeur Rust) via `testutils/nodeSignalBridge.ts`. Shim Jest
  `jest/node-gyp-build.js` requis (Babel casse `import.meta.dirname`).
- **Stockage** : logique ecrite contre `SqlExecutor` (src/storage/sql.ts).
  Appareil = op-sqlite compile SQLCipher (`"op-sqlite": {"sqlcipher": true}`
  dans package.json) + cle 256 bits dans Keychain/Keystore via
  expo-secure-store (AFTER_FIRST_UNLOCK). Tests = node:sqlite en memoire.
  Garde-fou runtime : refus de demarrer si `isSQLCipher()` est faux.
- **Modele d'invitation** : le QR contient identite publique + bundle
  X3DH/PQXDH + (plus tard) l'adresse de queue relais. Pas de serveur
  d'annuaire ; une one-time prekey consommee par invitation affichee.
- **26 tests verts** (vecteurs de verification, interop session,
  e2e invitation→conversation persistee, hors-ordre, fan-out groupe).

## 2026-07-26 (suite) — Builds et transport

- **Build EAS Android n°3 : SUCCÈS** (APK). Échec n°1 : repo maven Signal
  invisible au niveau projet → `extraMavenRepos`. Échec n°2 : libsignal-android
  exige le core library desugaring → `plugins/withDesugaring.js`.
- **Protocole, découverte importante** : depuis libsignal ~0.99, les adresses
  (locale/distante, nos uuid) sont LIÉES cryptographiquement à la session.
  Conséquence : le destinataire d'un premier message (PREKEY) doit connaître
  l'adresse de l'expéditeur AVANT de déchiffrer → l'enveloppe du premier
  message porte `from` (uuid pseudonyme aléatoire) en clair. Les messages
  suivants (WHISPER) n'en portent pas : la queue identifie le contact.
  Fuite acceptée et documentée : le relais voit un uuid aléatoire une fois
  par nouvelle relation, jamais une identité.
- **RelayClient** (`src/transport/relayClient.ts`) : fetch + WebSocket
  globaux (mêmes APIs sous RN et Node), reconnexion avec backoff, livraison
  "au moins une fois" avec ack après persistance. Testé contre le vrai
  serveur relais en sous-processus, dont un scénario complet à deux
  téléphones E2EE via le relais (le serveur ne voit que des blobs).
- **Jest en 2 projets** : "expo" (préset jest-expo) pour le code RN, "node"
  (env node pur) pour l'intégration réseau — le polyfill fetch d'Expo ne
  fonctionne pas hors RN. Voir `app/jest/` (shims node-gyp-build et
  import.meta).

## 2026-07-26 — Les DEUX plateformes compilent avec libsignal

- **Android : build EAS OK** (APK).
- **iOS : build EAS simulateur OK** après correction du link. Le podspec
  officiel `LibSignalClient` ne lie `libsignal_ffi.a` (cœur Rust
  précompilé) que sur son propre target — suffisant avec des frameworks
  dynamiques (config de Signal-iOS), insuffisant en **pods statiques**
  (config React Native/Expo) où c'est le binaire de l'app qui doit lier.
  Correctif dans `modules/blackout-signal/ios/BlackoutSignal.podspec` :
  `user_target_xcconfig` propage `OTHER_LDFLAGS` vers le target de l'app
  (chemin du .a extrait sous `$(OBJROOT)/Pods.build/libsignal_ffi/…`) et
  reprend les conditions `CARGO_BUILD_TARGET` du podspec officiel.
  `EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64` (workers EAS arm64 ;
  évite en prime un bug de link SwiftUICore x86_64 des Xcode récents).

## 2026-07-26 — UI et application assemblée

- **Thème** (`src/ui/theme/tokens.ts`) : fond neutre très sombre, trio néon
  utilisé avec parcimonie (ember = action, cyan = chiffrement, magenta =
  mesh/expéditeur), Anton pour les titres et Space Mono **uniquement** pour
  les données techniques, cadres à coins coupés en SVG, glitch borné à
  ~0,3 s au déchiffrement (test dédié : il se résout toujours sur le vrai
  texte).
- **Écrans présentationnels** (props in / callbacks out) + conteneurs dans
  `navigation.tsx` : testables sans modules natifs, 12 tests de rendu.
- **Pièges caméra** : `react-native-vision-camera` 5.1.1 n'a **aucun**
  plugin de config (le déclarer dans `app.json` fait charger le paquet
  lui-même et casse `expo prebuild`) ; permissions Android déclarées à la
  main. Son API a changé en v5 (Nitro) : `useObjectOutput` +
  `isScannedCode`, `useCodeScanner` n'existe plus.
- **Build Android complet : OK** (APK avec op-sqlite/SQLCipher,
  vision-camera/Nitro, svg, navigation, polices).
- **Corrigé avant livraison** : sans relais joignable, l'écran d'ajout de
  contact tournait indéfiniment (promesse sans `.catch`). Il affiche
  désormais « RELAIS INJOIGNABLE » avec la marche à suivre.

## 2026-07-28 — Ergonomie : zones de sécurité, clavier, carte, notifications

- **Zones de sécurité** : aucune n'était utilisée, les marges étaient
  écrites en dur (24 pt là où une Dynamic Island en réserve 59) — d'où
  le titre masqué. Composant `src/ui/components/Screen.tsx` basé sur
  `useSafeAreaInsets`. Les tests de rendu montent désormais les écrans
  dans un `SafeAreaProvider` aux **métriques d'un iPhone à Dynamic
  Island** (top 59, bottom 34) : le cas fautif est celui qu'on teste.
- **Clavier qui masquait la saisie** : cause réelle = **deux en-têtes
  superposés** (celui de la navigation + le nôtre), qui faussaient le
  calcul de décalage. `headerShown: false` sur l'écran Conversation,
  `keyboardVerticalOffset={0}`, et bouton retour rajouté dans notre
  en-tête (le supprimer aurait piégé l'utilisateur dans la conversation).
  Validé par Kevin.
- **Carte** : réécrite façon Life360 (plein écran, pastilles à
  initiales, cercles de précision, bande de cartes-contacts). Les
  calculs sont sortis dans `mapMath.ts` — react-native-maps ne se
  charge pas sous Jest, et une distance fausse ne plante pas, elle
  ment : elle est testée contre des repères réels (Paris–Marseille,
  Paris–Londres, passage du méridien). Retour de Kevin : « mieux mais on
  peut mieux faire » — précisions à obtenir, pistes listées dans
  `ETAT-DES-LIEUX.md`.
- **Notifications LOCALES et non push** : une notification push
  transiterait par les serveurs d'Apple et leur révélerait qui reçoit un
  message et quand — exactement la métadonnée que le projet s'attache à
  ne pas produire. Contrepartie assumée : elles n'arrivent que si l'app
  tourne. Le contenu du message n'est jamais affiché (le centre de
  notifications se lit sur écran verrouillé) : on annonce l'expéditeur.
- **Live Activities (Dynamic Island animé)** : possible, mais c'est une
  extension native séparée, coûteuse à faire vivre sur une app
  sideloadée sans compte développeur payant. Reporté après le relais et
  le mesh.

## Points ouverts

- [ ] Compte Expo (EAS) à créer par Kevin — indispensable pour builder
      (Claude ne peut pas créer de comptes). `npm i -g eas-cli && eas login`.
- [ ] Optionnel : installer JDK 17 + Android SDK localement pour des builds
      Android rapides sans quota EAS (~3 Go).
- [ ] Checksum `LIBSIGNAL_FFI_PREBUILD_CHECKSUM` de la version retenue à
      relever dans le Podfile de Signal-iOS au moment de figer la version.
