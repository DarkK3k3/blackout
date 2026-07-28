# Blackout

Messagerie chiffrée de bout en bout, pour un petit groupe d'amis.
Pas de compte, pas de numéro de téléphone, pas de cloud : chaque
installation génère ses clés localement, et on se connecte en scannant
un QR code.

```
blackout/
├── app/                    application React Native (iOS + Android)
│   ├── src/crypto/         sessions libsignal + code de vérification mensuel
│   ├── src/storage/        base locale chiffrée (SQLCipher)
│   ├── src/transport/      client du serveur relais
│   ├── src/state/          couche d'intégration (ce que l'UI appelle)
│   ├── src/ui/             thème DedSec, composants, écrans
│   └── modules/blackout-signal/   module natif Kotlin + Swift → libsignal officiel
├── relay-worker/           relais en ligne : Cloudflare Workers + Durable Objects
├── relay-server/           même relais en Node.js (tests d'intégration, repli local)
├── crypto-prototype/       prototype pédagogique d'origine (référence)
├── tools/                  génération des vecteurs de test
└── docs/                   installation, sécurité, décisions techniques
```

## Démarrage rapide

```bash
cd blackout/app && npm install && npm test
```

```bash
cd blackout/relay-server && npm install && npm test
```

## Documentation

| Fichier | Contenu |
|---|---|
| [docs/ETAT-DES-LIEUX.md](docs/ETAT-DES-LIEUX.md) | **À lire en premier** : où en est le projet, ce qui reste, ce qu'il ne faut pas refaire |
| [docs/SETUP-RELAIS.md](docs/SETUP-RELAIS.md) | Mettre le relais en ligne sur Cloudflare, gratuitement et pour de bon |
| [docs/SETUP-IOS.md](docs/SETUP-IOS.md) | TestFlight pas à pas, ce que tu dois faire côté Apple, variante AltStore PAL |
| [docs/SETUP-ANDROID.md](docs/SETUP-ANDROID.md) | Build APK signé et installation manuelle |
| [docs/SECURITY.md](docs/SECURITY.md) | Modèle de menace : ce qui est protégé, ce qui ne l'est pas |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Journal des choix techniques et de leurs raisons |
| [relay-server/README.md](relay-server/README.md) | API du relais + déploiement gratuit (Oracle / Raspberry Pi) |

## Comment ça marche, en cinq lignes

1. À l'installation, l'app génère une paire de clés d'identité X25519 et un
   lot de « prekeys », gardées dans une base chiffrée sur le téléphone.
2. Pour ajouter quelqu'un : il montre un QR contenant ses clés publiques et
   l'adresse d'une boîte aux lettres ; tu le scannes.
3. À partir de là, `libsignal` (le protocole de Signal) chiffre chaque
   message avec une clé unique, renouvelée en permanence.
4. Les messages transitent par un petit serveur relais qui ne voit que des
   blobs chiffrés adressés à des boîtes anonymes.
5. Chaque mois, un code de vérification se régénère pour confirmer que
   personne ne s'intercale — sans jamais interrompre les conversations.

## Configuration avant le premier build

L'adresse de ton serveur relais et ton nom affiché se règlent dans
`app/src/config.ts`, ou par variables d'environnement :

```bash
EXPO_PUBLIC_RELAY_URL=https://relay.ton-domaine.tld EXPO_PUBLIC_DISPLAY_NAME=Kevin eas build --platform android --profile preview
```

## État du projet

| Brique | État |
|---|---|
| Code de vérification mensuel | fait, prouvé identique au prototype par vecteurs de test |
| Sessions libsignal (X3DH/PQXDH + Double Ratchet) | fait, module natif Kotlin + Swift, testé avec les bindings officiels |
| Stockage local chiffré (SQLCipher + Keychain/Keystore) | fait |
| Serveur relais + client | fait, testé de bout en bout |
| Interface (chats, conversation, QR, vérification) | fait |
| Photos dans les conversations | à faire |
| Groupes (fan-out) | moteur prêt et testé, écrans à faire |
| Mesh Bluetooth de secours | à faire |

Tout ce qui est marqué « fait » est couvert par des tests automatisés qui
tournent avec `npm test`.
