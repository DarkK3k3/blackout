# Installer Blackout sur iPhone

Deux chemins possibles. **TestFlight est le plus simple** ; AltStore PAL est
documenté plus bas comme solution de repli, mais il n'est pas plus facile.

Dans les deux cas il faut un **compte Apple Developer Program à 99 $/an**.
Il n'y a pas d'échappatoire : Apple exige un certificat de développeur pour
qu'une app tierce démarre sur un iPhone. (L'option gratuite « compte Apple
personnel » existe mais l'app expire au bout de **7 jours** et impose un Mac
avec Xcode — inutilisable pour un usage réel.)

Tu n'as **pas** besoin de Mac : EAS compile dans le cloud.

---

## Chemin A — TestFlight (recommandé)

### Ce que tu dois faire toi-même (Claude ne peut pas : ce sont des actions liées à ton compte Apple)

1. **Créer le compte développeur** sur https://developer.apple.com/programs/
   (99 $/an, vérification d'identité, compter 24-48 h).
2. **Créer l'app dans App Store Connect** : https://appstoreconnect.apple.com
   → Mes apps → « + » → Nouvelle app.
   - Plateforme : iOS
   - Nom : `Blackout` (s'il est pris, mets `Blackout Mesh` — le nom affiché
     n'a pas d'importance technique)
   - Langue principale : Français
   - **Bundle ID : `com.kevsvod.blackout`** — exactement celui-ci, il est déjà
     configuré dans le projet. **Ne le change jamais** : le lien d'invitation
     TestFlight y est attaché.
   - SKU : `blackout` (identifiant interne libre)

### Ce que la machine fait ensuite

```bash
cd blackout/app
```

Connexion à Apple (une seule fois — EAS crée les certificats et provisioning
profiles automatiquement) :

```bash
eas credentials
```

Build et envoi automatique vers TestFlight :

```bash
eas build --platform ios --profile production --auto-submit
```

Compter ~20-30 min. EAS demande ton identifiant Apple, gère les certificats,
compile, puis téléverse sur App Store Connect.

Le numéro de build est incrémenté automatiquement à chaque fois
(`"autoIncrement": true` dans `eas.json`) : tu ne t'en occupes jamais.

### Inviter tes amis

Dans App Store Connect → ton app → TestFlight :

1. Onglet **Testeurs internes** (jusqu'à 100 personnes, **pas de revue Apple**,
   disponible immédiatement) — c'est ce que tu veux pour un petit groupe.
   Ajoute chaque ami comme utilisateur du compte (Utilisateurs et accès →
   inviter par email → rôle « Testeur »), puis ajoute-le au groupe de test.
2. Ils reçoivent un email, installent l'app **TestFlight** depuis l'App Store,
   et Blackout apparaît dedans.

> Les **testeurs externes** (jusqu'à 10 000) demandent eux une revue Apple de
> quelques jours. Pour 5-10 amis, reste en interne.

### Renouveler avant l'expiration (90 jours)

Chaque build TestFlight expire au bout de **90 jours**. Pour repartir pour 90 jours :

```bash
eas build --platform ios --profile production --auto-submit
```

C'est tout — même commande, rien à refaire à la main. Mets-toi un rappel
tous les ~80 jours.

### Fastlane (seulement si tu as un jour un Mac)

`fastlane/Fastfile` est fourni et fait la même chose (incrément du build
number + upload) depuis un Mac avec Xcode. Il n'est **pas** nécessaire avec
EAS ; il est là si tu veux un jour te passer du cloud.

---

## Chemin B — AltStore PAL (marketplace alternatif UE)

Depuis le Digital Markets Act, l'UE autorise les marketplaces alternatifs sur
iOS. AltStore PAL en est un.

**Ce n'est pas plus simple que TestFlight** :

- Il faut **quand même** un compte Apple Developer Program (99 $/an).
- Il faut en plus une **lettre de crédit d'un million d'euros** délivrée par
  une institution financière pour devenir « marketplace », ou passer par
  AltStore PAL comme distributeur tiers — ce qui implique de leur soumettre
  l'app et de payer leurs frais.
- L'app doit être **notarisée par Apple** (analyse automatisée, moins stricte
  qu'une revue App Store, mais c'est une étape de plus).
- Seuls les appareils **physiquement dans l'UE** peuvent installer depuis un
  marketplace alternatif.

**Verdict** : garde-le en tête si TestFlight te pose un jour problème
(refus de notarisation, compte suspendu), mais commence par TestFlight.

---

## Permissions déclarées (et pourquoi)

Elles sont dans `app/app.json` et se retrouvent dans `Info.plist` :

| Clé | Utilisation réelle dans l'app |
|---|---|
| `NSCameraUsageDescription` | Scanner les QR d'ajout de contact et de vérification |
| `NSPhotoLibraryUsageDescription` | Joindre une photo à une conversation chiffrée |
| `NSBluetoothAlwaysUsageDescription` | Mode mesh BLE de secours (sans internet) |

La revue Apple d'un build TestFlight vérifie surtout que ces déclarations
correspondent à ce que l'app fait vraiment — c'est le cas ici.

## Bluetooth en arrière-plan sur iOS : à savoir

CoreBluetooth **limite fortement** le Bluetooth en arrière-plan : le scan est
ralenti, filtré par UUID de service, et iOS peut suspendre l'app à tout moment.
Blackout n'essaie donc **pas** de promettre un mesh fiable en tâche de fond sur
iOS : le mode mesh est prévu **app ouverte au premier plan**. Sur Android, un
service de premier plan avec notification persistante permet de tenir plus
longtemps.
