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

## 2026-07-28 — Relais permanent sur Cloudflare Workers

Le relais sur le PC derrière un tunnel Cloudflare est tombé une
douzaine de fois, et son adresse changeait à chaque relance. Portage
dans `relay-worker/`.

- **Protocole identique au caractère près.** Contrainte volontaire : on
  ne peut pas mettre à jour les téléphones d'un claquement de doigts
  (chaque réinstallation coûte un cycle de signature de 7 jours). Seule
  l'adresse change, dans les réglages. Les tests HTTP vérifient les
  codes de statut un par un pour cette raison.
- **Un seul Durable Object** pour tout le relais. L'app ouvre une seule
  WebSocket et s'y abonne à toutes ses boîtes ; or une socket ne peut
  être rattachée qu'à un objet. Un objet par boîte imposerait une
  dizaine de connexions par téléphone et une refonte du client.
- **SQLite obligatoire** : c'est le seul backend de Durable Object
  disponible sur le plan gratuit (`new_sqlite_classes`).
- **Blobs découpés en morceaux de 600 000 caractères** : SQLite refuse
  toute ligne de plus de 2 Mo, ce que dépasserait une photo chiffrée.
- **WebSockets en hibernation** (`ctx.acceptWebSocket`) : sans cela
  l'objet resterait chargé tant qu'un téléphone est connecté et
  brûlerait le quota gratuit. Corollaire à ne jamais oublier : toute
  variable d'instance disparaît au réveil, l'état d'abonnement est donc
  rangé dans la socket (`serializeAttachment`), jamais dans une `Map`.
- **Colonne `seq`** pour l'ordre des messages : trier sur l'horodatage
  seul rendait arbitraire l'ordre de messages déposés dans la même
  milliseconde. Défaut trouvé par un test avant toute mise en ligne.
- **Découpage testable** : `store.js` et `http.js` n'utilisent aucune
  API Cloudflare et tournent tels quels sous Node (30 tests). Les 7
  tests WebSocket tournent contre le vrai moteur Cloudflare lancé en
  local par `wrangler dev`, et le test de bout en bout de l'app (deux
  instances libsignal complètes) a été rejoué à travers lui.

## 2026-07-28 — Position partagée en arrière-plan

Kevin : « c'est dommage que ça ne peut pas fonctionner en arrière-plan ».
Contrairement aux notifications push, **iOS l'autorise réellement**, et
la différence est de fond : une notification push transiterait par les
serveurs d'Apple, alors qu'ici le système réveille NOTRE code, qui
chiffre lui-même et poste sur NOTRE relais. Aucun tiers n'apprend quoi
que ce soit — et aucun compte développeur payant n'est requis
(`UIBackgroundModes` est une clé Info.plist, pas un entitlement).

- **`expo-task-manager` + `Location.startLocationUpdatesAsync`**. La
  tâche est définie dans `src/ui/backgroundLocation.ts`, importée depuis
  `index.ts` **au niveau du module** : quand iOS démarre l'app en
  arrière-plan, aucune vue n'est montée, donc rien ne peut la définir
  depuis un composant.
- **Instance de module** (`src/state/instance.ts`) : l'application ne
  peut plus vivre uniquement dans un contexte React. Les appels
  concurrents partagent la même promesse de création — sinon deux
  instances ouvriraient deux fois la base et feraient avancer deux
  copies de la même session.
- **Verrou d'envoi par contact** (`src/state/verrou.ts`) : chiffrer FAIT
  AVANCER le ratchet, et deux envois partis du même état produiraient un
  message définitivement indéchiffrable. Le risque était théorique tant
  qu'on n'envoyait que depuis un écran ouvert ; il devient réel quand
  iOS peut réveiller la tâche pendant que l'app tourne. **Honnêteté sur
  la preuve** : le test d'intégration à envois simultanés passe aussi
  bien avec qu'*sans* le verrou (vérifié en le désactivant) —
  l'ordonnancement de Node ne déclenche pas la course. La garantie
  repose donc sur le verrou lui-même, testé isolément (7 tests), pas sur
  ce test-là, qui n'est qu'un garde-fou.
- **Batterie** : `distanceInterval: 80` plutôt qu'un intervalle de temps
  — quelqu'un d'immobile ne consomme rien. Précision `Balanced`, pas
  `BestForNavigation`. Le suivi démarre au premier partage et s'arrête
  au dernier ; la tâche se coupe elle-même quand `broadcastLocation`
  n'a plus aucun destinataire.
- **`showsBackgroundLocationIndicator: true`** : l'indicateur reste
  visible. Dans une app comme celle-ci, masquer le fait que la position
  part serait indéfendable.
- **L'écran le dit** : si un partage est ouvert sans l'autorisation
  « Toujours », un bandeau prévient que la position se figera à la
  sortie de l'app. Croire qu'on partage alors qu'on ne partage plus est
  pire que ne pas partager.

## 2026-07-29 — Mesh : le cœur, et le choix de la radio

Le mesh est **un transport de plus**, pas une nouvelle sécurité : il
transporte exactement le blob déjà chiffré par libsignal. Un téléphone
qui relaie ne peut pas plus lire le message qu'un serveur ne le
pourrait. Il voit l'identifiant de la boîte de destination — inévitable,
et c'est déjà ce que voit le relais. **Aucune métadonnée nouvelle n'est
créée**, et le paquet ne porte aucun expéditeur.

Écrit et testé (27 tests, `app/src/mesh/`) :
- `paquet.ts` — TTL en sauts (6 max), expiration 24 h, et validation
  stricte de tout ce qui arrive par la radio, y compris le refus d'un
  compteur de sauts gonflé (un voisin malveillant ferait tourner son
  paquet indéfiniment) ;
- `sacoche.ts` — stockage-et-transport : mémoire des identifiants
  **déjà vus** (sans elle, un paquet remis puis recroisé repartirait en
  boucle), capacité plafonnée, éviction des plus anciens ;
- `trames.ts` — découpage/réassemblage pour une radio à petits blocs,
  avec plafond d'assemblages en cours et expiration : sans ça, envoyer
  des débuts de messages jamais terminés remplirait la mémoire ;
- `rencontre.ts` — trois messages (RESUME / DEMANDE / PAQUETS), sans
  identification ni poignée de main : deux inconnus s'entraident sans
  rien s'apprendre.

Le scénario central est couvert par un test : Alice et Bob ne se
croisent jamais, Charlie croise les deux, le message arrive.

**Radio : react-native-ble-plx est écarté.** Il ne sait qu'être
*central* — il ne peut pas annoncer. Or un mesh iPhone↔iPhone exige que
chaque appareil soit à la fois central et périphérique. Deux options
restent : écrire un module natif CoreBluetooth complet (long, et le
Bluetooth en arrière-plan sur iOS est très restreint), ou utiliser
**MultipeerConnectivity**, le framework d'Apple prévu exactement pour
ça, qui gère découverte et transfert sur Bluetooth *et* Wi-Fi direct.
Kevin n'ayant que des iPhones, MultipeerConnectivity est retenu pour la
première version ; Android suivra via BLE/Nearby si le besoin apparaît.

**Pas encore fait** : le module natif de radio. Il ne peut pas être
validé sans deux appareils, et la règle du projet interdit de livrer du
code non testé.

## Points ouverts

- [ ] Compte Expo (EAS) à créer par Kevin — indispensable pour builder
      (Claude ne peut pas créer de comptes). `npm i -g eas-cli && eas login`.
- [ ] Optionnel : installer JDK 17 + Android SDK localement pour des builds
      Android rapides sans quota EAS (~3 Go).
- [ ] Checksum `LIBSIGNAL_FFI_PREBUILD_CHECKSUM` de la version retenue à
      relever dans le Podfile de Signal-iOS au moment de figer la version.
