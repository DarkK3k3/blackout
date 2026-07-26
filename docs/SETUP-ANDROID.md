# Installer Blackout sur Android

Beaucoup plus simple qu'iOS : pas de compte payant, pas de revue, pas de
délai. On produit un APK signé et on l'installe directement.

## Produire l'APK

```bash
cd blackout/app
```

```bash
eas build --platform android --profile preview
```

À la fin, EAS affiche un lien de téléchargement (et un QR code à scanner
directement depuis le téléphone). Le fichier `.apk` fait ~60-80 Mo.

La **clé de signature** est générée et conservée par EAS au premier build.
Elle est réutilisée automatiquement ensuite — c'est important : Android
refuse de mettre à jour une app signée par une clé différente. Pour en
garder une copie de secours :

```bash
eas credentials
```

(→ Android → Keystore → Download). Range-la en lieu sûr : la perdre
obligerait tes amis à désinstaller/réinstaller en perdant leurs messages.

## Installer sur le téléphone

1. Ouvre le lien de téléchargement dans le navigateur du téléphone.
2. Android affiche « Pour votre sécurité, votre téléphone n'est pas autorisé
   à installer des applications inconnues provenant de cette source ».
   Touche **Paramètres** → active **Autoriser depuis cette source** pour le
   navigateur (ou le gestionnaire de fichiers).
3. Reviens en arrière, touche **Installer**.
4. Play Protect peut afficher « Application non sécurisée ? » — c'est le
   message standard pour toute app hors Play Store. Touche
   **Installer quand même** / **Plus de détails → Installer quand même**.

Sur certaines surcouches (Xiaomi/MIUI, Samsung), le chemin exact des
réglages diffère un peu, mais la logique est la même : autoriser les
« sources inconnues » pour l'app qui fait l'installation.

## Mettre à jour

Relance la même commande de build, renvoie le lien : l'installation d'un
APK plus récent **écrase** l'ancien en conservant les données (base
chiffrée, clés, historique), tant que la clé de signature est la même.

## Permissions demandées

| Permission | Pourquoi |
|---|---|
| `CAMERA` | Scanner les QR d'ajout de contact et de vérification |
| `INTERNET` | Joindre le serveur relais |
| Bluetooth (à venir avec le mesh) | Relayer les messages sans internet |

## Version pour tester en développement

Si tu veux itérer vite sur l'app sans refaire un build complet à chaque
changement de code JavaScript :

```bash
eas build --platform android --profile development
```

Puis lance le serveur de développement :

```bash
npx expo start --dev-client
```

L'app installée se connecte à ton PC et recharge le code à chaque
modification. Les changements de code **natif** (Kotlin/Swift, nouvelles
dépendances natives) nécessitent en revanche un nouveau build.
