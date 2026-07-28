# Mettre le relais en ligne (Cloudflare)

> **C'est fait.** Depuis le 2026-07-28, le relais tourne à l'adresse
> **`https://blackout-relay.trzoskikevin.workers.dev`**, vérifiée par
> les 7 tests WebSocket et par le test de bout en bout de l'app (deux
> instances libsignal complètes). Cette page reste utile pour
> comprendre ce qui a été fait, redéployer, ou repartir de zéro.

Objectif : que le relais tourne **24 h/24, à une adresse qui ne change
plus**, sans ton PC allumé et sans rien payer.

Aujourd'hui le relais tourne sur ton ordinateur derrière un tunnel
Cloudflare. Deux défauts, que tu as vécus : il tombe quand le tunnel se
coupe, et son adresse change à chaque relance — donc il faut la
retaper dans les réglages des deux téléphones.

Après cette page, l'adresse ressemblera à
`https://blackout-relay.<ton-sous-domaine>.workers.dev` et ne bougera
plus jamais.

---

## Le nom dans l'adresse

Cloudflare avait déjà attribué au compte le sous-domaine
**`trzoskikevin`** (dérivé de l'adresse mail d'inscription) avant qu'on
puisse en choisir un. L'adresse du relais contient donc ce mot.

Ça vaut d'être dit clairement : **quiconque voit cette adresse apprend
ce nom**. Elle ne figure nulle part publiquement — seulement dans les
réglages des téléphones du groupe — mais si ça te gêne, elle se change
depuis le tableau de bord Cloudflare (Workers & Pages → paramètres du
sous-domaine). Attention : changer le sous-domaine **casse l'ancienne
adresse**, il faut donc la remettre à jour dans l'app sur chaque
téléphone.

## Refaire la manipulation depuis zéro

### 1. Un compte Cloudflare gratuit

Sur https://dash.cloudflare.com/sign-up : une adresse mail, un mot de
passe, la confirmation par mail. **Aucune carte bancaire n'est
demandée.** Tu n'as pas besoin d'acheter de nom de domaine.

### 2. Relier ton ordinateur à ce compte

```bash
cd blackout/relay-worker && npm install
```

```bash
npx wrangler login
```

Ton navigateur s'ouvre et te demande d'autoriser Wrangler. Tu acceptes,
et tu peux refermer l'onglet.

### 3. Mettre en ligne

```bash
npx wrangler deploy
```

À la fin, la commande affiche l'adresse. Elle ressemble à :

```
https://blackout-relay.kevin-1234.workers.dev
```

**Note-la** : c'est elle qu'on met dans l'app.

### 4. Vérifier que ça répond

```bash
curl https://blackout-relay.TON-SOUS-DOMAINE.workers.dev/healthz
```

Réponse attendue : `{"ok":true}`.

### 5. Le dire à l'app, sur les deux téléphones

Écran d'accueil → l'icône en haut à droite → coller l'adresse →
**TESTER** → enregistrer. **Aucune réinstallation** : le protocole n'a
pas changé, seule l'adresse bouge. Ton cycle de signature de 7 jours
n'est pas entamé.

---

## Ce que ça coûte (rien, et voilà pourquoi)

Le plan gratuit de Cloudflare donne chaque jour :

| Ressource | Inclus par jour | Ce que ça représente pour vous |
|---|---|---|
| Requêtes | 100 000 | des milliers de messages |
| Stockage | 5 Go | les messages sont effacés dès qu'ils sont reçus |
| Lignes écrites | 100 000 | ~1 par message envoyé |

Un groupe de dix amis n'approche pas ces limites. Si jamais une limite
était atteinte, le relais refuserait des opérations jusqu'à minuit UTC —
il ne serait pas facturé.

Le relais dort quand personne ne parle, et se réveille à la milliseconde
où un message arrive. C'est le mécanisme d'« hibernation » de
Cloudflare : les téléphones restent connectés pendant ce sommeil, donc
un message ne se perd pas et n'attend pas.

---

## Ce que Cloudflare peut voir, et ce qu'il ne peut pas

À dire clairement, parce que c'est le cœur du projet :

**Ne peut pas :** lire un message. Tout est chiffré de bout en bout par
les téléphones avant d'arriver. Le relais manipule des octets opaques.

**Ne peut pas :** relier deux boîtes aux lettres. Une conversation
utilise deux boîtes indépendantes, une par sens, sans lien exploitable
entre elles.

**Ne peut pas :** se faire passer pour un contact. Les invitations sont
vérifiées par empreinte au moment du scan du QR : un bundle substitué
serait rejeté par le téléphone.

**Peut :** voir les adresses IP qui se connectent, comme n'importe quel
hébergeur. Le code ne journalise rien (`observability` désactivée), mais
Cloudflare voit passer le trafic. C'était déjà vrai avec le tunnel.

**Peut :** constater qu'une boîte donnée reçoit du trafic à tel moment.
Sans savoir de qui, ni pour qui, ni quoi.

---

## Mettre à jour le relais plus tard

```bash
cd blackout/relay-worker && npx wrangler deploy
```

L'adresse ne change pas. Rien à retoucher dans l'app.

## Le faire tourner en local (pour développer)

```bash
cd blackout/relay-worker && npm run dev
```

Rien n'est envoyé chez Cloudflare : c'est le vrai moteur, mais sur ta
machine. Les tests qui exercent les WebSockets tournent contre lui :

```bash
cd blackout/relay-worker && npm run test:live
```

(avec `BLACKOUT_WORKER_URL=http://127.0.0.1:8787` dans l'environnement)

## Si quelque chose ne va pas

**`wrangler login` n'ouvre pas le navigateur** — copie l'adresse
affichée dans le terminal et colle-la à la main.

**`Authentication error` au deploy** — relance `npx wrangler login`.

**L'app dit « relais injoignable »** — vérifie d'abord l'adresse avec
`curl .../healthz`. Si `curl` répond et pas l'app, c'est l'adresse
enregistrée dans les réglages qui est fausse (un `/` final de trop est
nettoyé automatiquement, mais pas une faute de frappe).

**Voir ce qui se passe en ligne** — `npx wrangler tail` affiche les
requêtes en direct. À n'utiliser que pour dépanner : ça allume
temporairement une visibilité qu'on garde éteinte le reste du temps.
