# Blackout — serveur relais

Petit serveur store-and-forward sur le modèle des **simplex queues** :

- Une *queue* = une boîte aux lettres **unidirectionnelle** créée par le
  **destinataire**. Il garde le `readToken` et transmet `queueId` +
  `writeToken` à UN expéditeur, via QR code, jamais via le serveur.
- Le serveur ne voit que des **blobs opaques déjà chiffrés de bout en bout**
  par l'app. Pas de comptes, pas d'identifiants, pas d'annuaire, pas de logs
  d'accès. Les tokens sont stockés **hachés** (SHA-256) : le vol du fichier
  de données ne permet ni de lire, ni d'écrire, ni de savoir qui parle à qui.
- Une conversation à deux = deux queues indépendantes (une par sens).
  Un groupe de N personnes = fan-out : l'expéditeur dépose une copie chiffrée
  par membre, chacune dans la queue du membre concerné.
- Les messages sont supprimés à l'ack du destinataire, ou après 30 jours (TTL).

## Lancer

```bash
npm install
npm start            # PORT=8787, DATA_FILE=./data/relay-data.json par défaut
```

```bash
npm test             # tests d'intégration (HTTP + WebSocket + persistance)
```

## API

| Méthode | Route | Auth (Bearer) | Rôle |
|---|---|---|---|
| POST | `/v1/queues` | — | créer une queue → `{queueId, readToken, writeToken}` |
| POST | `/v1/queues/:id/messages` | writeToken | déposer un blob chiffré (`{blob}`, base64, ≤ 8 Mo) |
| GET | `/v1/queues/:id/messages` | readToken | relever les messages en attente |
| DELETE | `/v1/queues/:id/messages/:msgId` | readToken | ack → suppression définitive |
| DELETE | `/v1/queues/:id` | readToken | détruire la queue (rupture de contact) |
| GET | `/healthz` | — | supervision |

WebSocket : connexion sur `/v1/ws`, puis sur la socket :
`{"type":"subscribe","queueId":"…","token":"<readToken>"}` — le token passe
dans un message WS, **jamais dans l'URL** (les URLs finissent dans des logs).
Le serveur pousse alors le backlog puis chaque nouveau message en temps réel ;
le client acquitte avec `{"type":"ack","queueId":"…","token":"…","id":"…"}`.

## Déploiement gratuit — option A : ton PC Windows + tunnel Cloudflare (le plus rapide)

Aucun matériel, aucune inscription : le relais tourne sur ton PC et un
tunnel Cloudflare lui donne une adresse publique, sans ouvrir le moindre
port sur ta box.

Dans un terminal, lancer le relais :

```bash
cd blackout/relay-server && node src/server.js
```

Dans un second terminal, ouvrir le tunnel (télécharger d'abord
`cloudflared-windows-amd64.exe` depuis
https://github.com/cloudflare/cloudflared/releases/latest) :

```bash
./cloudflared.exe tunnel --url http://localhost:8787
```

Il affiche une URL en `https://….trycloudflare.com`. Vérifier qu'elle
répond, puis la mettre dans `app/src/config.ts` :

```bash
cd blackout/app && BLACKOUT_RELAY_URL=https://ton-url.trycloudflare.com npm run test:relay
```

Ce test fait dialoguer deux instances complètes de l'app à travers le
relais : s'il passe, l'app saura lui parler.

**Limites** : l'URL change à chaque redémarrage du tunnel, et les messages
ne circulent que quand le PC est allumé. Parfait pour tester, insuffisant
pour un usage quotidien — d'où l'option B.

## Déploiement gratuit — option B : Cloudflare Workers (permanent, sans matériel)

Gratuit, allumé 24h/24, rien à administrer. Voir la tâche de portage en
cours : le relais est réécrit pour Durable Objects (une boîte = un objet,
stockage SQLite gratuit, WebSockets avec hibernation).

## Déploiement gratuit — option C : un vieux téléphone **Android** (impossible sur iPhone)

Un vieux téléphone est un serveur parfait pour ce relais : il consomme 2-3 W,
a une batterie de secours intégrée, et il est chez toi — personne d'autre n'y
touche. Le relais est du Node.js sans dépendance native, il tourne tel quel.

**Il faut** : le vieux téléphone (Android 7+), un chargeur, le WiFi de la
maison, et un compte Cloudflare gratuit.

### 1. Installer Termux

**Ne prends pas Termux sur le Play Store** — cette version est abandonnée et
cassée. Télécharge l'APK depuis GitHub :
https://github.com/termux/termux-app/releases → `termux-app_v0.11x...universal.apk`

### 2. Préparer l'environnement

Dans Termux :

```bash
pkg update && pkg upgrade -y && pkg install nodejs git -y
```

Empêcher Android de tuer le serveur quand l'écran s'éteint :

```bash
termux-wake-lock
```

Va aussi dans les réglages Android → Applications → Termux → Batterie →
**Sans restriction** (le nom varie selon la marque : « Non optimisé »,
« Autoriser l'activité en arrière-plan »…).

### 3. Récupérer et lancer le relais

Le projet n'est pas encore sur GitHub, donc le plus simple est de copier le
dossier `relay-server` sur le téléphone (câble USB, ou envoie-le-toi par
Drive/mail dans le dossier `Download`). Ensuite, dans Termux :

```bash
termux-setup-storage
```

(Android demande l'autorisation d'accès aux fichiers — accepte.)

```bash
cp -r ~/storage/downloads/relay-server ~/ && cd ~/relay-server && npm install --omit=dev
```

> Si un jour tu mets le projet sur GitHub, ça devient simplement
> `git clone <URL> && cd blackout/relay-server && npm install --omit=dev`.

```bash
PORT=8787 DATA_FILE=$HOME/blackout-data/relay.json node src/server.js
```

Tu dois voir `relais blackout en ecoute sur :8787`.

### 4. Ouvrir le tunnel Cloudflare

Le téléphone n'a pas d'adresse publique : le tunnel s'en charge, sans ouvrir
le moindre port sur ta box. `cloudflared` est un binaire Go statique, il
tourne directement dans Termux. Dans un **second onglet** Termux (glisse
depuis le bord gauche → « New session ») :

```bash
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 && chmod +x cloudflared
```

```bash
./cloudflared tunnel --url http://localhost:8787
```

Il affiche une URL du type `https://xxx-yyy-zzz.trycloudflare.com` — c'est
l'adresse de ton relais, à mettre dans `app/src/config.ts`.

> Cette URL gratuite **change à chaque redémarrage** du tunnel. Pour une
> adresse stable, crée un tunnel nommé avec un compte Cloudflare gratuit
> (`cloudflared tunnel login` puis `cloudflared tunnel create blackout`) et
> associe-lui un sous-domaine. À faire une fois le premier test concluant.

### 5. Vérifier que ça marche

Depuis n'importe quel navigateur :

```
https://ton-url.trycloudflare.com/healthz
```

Tu dois voir `{"ok":true}`. Si oui, le relais est joignable depuis Internet.

### Limites honnêtes de cette solution

- Si ta connexion Internet tombe, le relais est injoignable. Les messages
  restent en attente sur les téléphones et repartent au retour.
- Android peut quand même tuer Termux après plusieurs jours ; si le relais
  ne répond plus, relance les deux commandes. (`termux-wake-lock` + batterie
  sans restriction rendent ça rare.)
- Laisse le téléphone branché en permanence : une batterie maintenue à 100 %
  vieillit, mais un vieux téléphone dédié à ça, on s'en moque.

## Déploiement gratuit — option B : Oracle Cloud « Always Free »

Oracle **refuse beaucoup d'inscriptions** sans donner de raison (carte
bancaire, région, adresse email jugées suspectes). Si ça t'arrive, n'insiste
pas : passe par l'option A ci-dessus.

La seule offre réellement gratuite ET allumée 24h/24 (VM ARM Ampere,
jusqu'à 4 OCPU / 24 Go — surdimensionné pour ce relais).

1. Créer un compte sur oracle.com/cloud/free (carte demandée pour
   vérification, jamais débitée sur les ressources Always Free).
2. Créer une instance **VM.Standard.A1.Flex** (Ubuntu 24.04, 1 OCPU / 6 Go
   suffisent largement).
3. Ouvrir le port 443 dans la *Security List* du VCN **et** dans le pare-feu
   de la VM (`sudo ufw allow 443/tcp` ou iptables selon l'image).
4. Installer Node 20+ puis le relais :

   ```bash
   sudo apt update && sudo apt install -y nodejs npm caddy
   git clone <ton-repo> && cd blackout/relay-server && npm install --omit=dev
   ```

5. Service systemd (`/etc/systemd/system/blackout-relay.service`) :

   ```ini
   [Unit]
   Description=Blackout relay
   After=network.target

   [Service]
   WorkingDirectory=/home/ubuntu/blackout/relay-server
   Environment=PORT=8787
   Environment=DATA_FILE=/home/ubuntu/blackout-data/relay-data.json
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl enable --now blackout-relay
   ```

6. TLS obligatoire (les tokens transitent en Bearer) : Caddy fait tout,
   certificat Let's Encrypt inclus. `/etc/caddy/Caddyfile` :

   ```
   relay.ton-domaine.tld {
       reverse_proxy 127.0.0.1:8787
   }
   ```

   Un sous-domaine gratuit (duckdns.org, ou un domaine à ~2 €/an) suffit.

## Déploiement gratuit — option C : Raspberry Pi ou vieux PC (si tu en récupères un un jour)

Le serveur est **physiquement chez toi** — cohérent avec l'esprit du projet.
Pas d'ouverture de port sur ta box, pas d'IP publique exposée :

```bash
# sur le Pi / PC (Node 20+ requis)
npm install --omit=dev && PORT=8787 node src/server.js

# tunnel Cloudflare (gratuit, TLS inclus)
cloudflared tunnel --url http://localhost:8787          # test rapide
# ou en permanent : cloudflared tunnel create blackout + config DNS
```

Limite : si ta connexion tombe, le relais est injoignable (les messages
repartiront des files d'attente locales des téléphones à son retour —
et le mode BLE mesh de l'app couvre le cas "tout le monde est au même endroit").

## À éviter

Render/Railway/Fly « gratuits » : soit le service s'endort après quelques
minutes d'inactivité (les WebSockets tombent, la livraison temps réel meurt),
soit l'offre n'est plus réellement gratuite depuis 2024.

## Ce que ce serveur ne peut PAS faire, par construction

- Lire un message : il ne reçoit que du texte chiffré par libsignal côté app.
- Savoir qui parle à qui : il ne voit que des IDs de queues aléatoires,
  sans lien entre eux ni avec une identité.
- Être utilisé pour usurper un contact : l'authenticité des correspondants
  repose sur la vérification out-of-band (QR code + code mensuel), jamais
  sur la confiance dans le relais.
