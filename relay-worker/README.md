# relay-worker — le relais Blackout sur Cloudflare

Portage du relais Node (`../relay-server`) vers Cloudflare Workers +
Durable Objects, pour qu'il tourne en permanence, gratuitement, à une
adresse stable.

**Le protocole HTTP et WebSocket est identique au caractère près.**
Migrer ne demande donc ni recompilation ni réinstallation de l'app :
seule l'adresse change, dans les réglages.

Marche à suivre pour la mise en ligne : [../docs/SETUP-RELAIS.md](../docs/SETUP-RELAIS.md).

## Organisation

| Fichier | Rôle |
|---|---|
| `src/worker.js` | routage ; répond lui-même à `/healthz` pour ne pas réveiller la base |
| `src/relayRoom.js` | le Durable Object : WebSockets en hibernation, alarme de purge |
| `src/store.js` | les boîtes et les invitations en SQL — **aucune API Cloudflare** |
| `src/http.js` | les routes, en API Fetch standard |

Cette séparation n'est pas cosmétique : `store.js` et `http.js` ne
touchent à rien de spécifique à Cloudflare, ils tournent donc tels quels
sous Node pour être testés. Ce qui est vérifié est ce qui est déployé,
pas une réimplémentation qui lui ressemble.

## Tests

```bash
npm test
```

30 tests sous Node : les boîtes, les jetons, l'expiration, le découpage
des gros blobs, et les codes de statut HTTP un par un.

```bash
npm run dev
```

puis, dans un autre terminal, avec `BLACKOUT_WORKER_URL=http://127.0.0.1:8787` :

```bash
npm run test:live
```

7 tests contre le **vrai moteur Cloudflare** tournant en local : c'est
là que les WebSockets sont exercées (abonnement, refus sans jeton,
arriéré, temps réel, ack, abonnements multiples, étanchéité entre
boîtes).

Enfin, depuis `../app`, le test de bout en bout : deux instances
complètes de l'app qui conversent en libsignal à travers ce relais.

```bash
BLACKOUT_RELAY_URL=http://127.0.0.1:8787 npm run test:relay
```

## Choix de conception

**Un seul Durable Object pour tout le relais.** Cloudflare permettrait
un objet par boîte, mais l'app ouvre UNE seule WebSocket sur laquelle
elle s'abonne à toutes ses boîtes — et une socket ne peut être rattachée
qu'à un objet. Découper imposerait une dizaine de connexions par
téléphone et une refonte du client. À l'échelle d'un groupe d'amis, un
objet unique suffit largement, et le code reste lisible donc auditable.

**Les blobs sont découpés.** SQLite refuse toute ligne de plus de 2 Mo
dans un Durable Object, alors qu'une photo chiffrée peut peser
plusieurs Mo. Les blobs sont donc rangés en morceaux de 600 000
caractères et recollés à la lecture — un test vérifie qu'un gros blob
ressort identique, faute de quoi le déchiffrement échouerait.

**Les WebSockets hibernent.** Sans cela, l'objet resterait en mémoire
tant qu'un téléphone est connecté, et consommerait le quota gratuit en
quelques heures. Conséquence à ne jamais oublier en modifiant ce code :
**toute variable d'instance disparaît au réveil**. L'état d'abonnement
d'une socket est donc rangé dans la socket elle-même
(`serializeAttachment`), jamais dans une `Map`.

**Une colonne `seq` ordonne les messages.** Trier sur l'horodatage seul
rendait les messages déposés dans la même milliseconde dans un ordre
arbitraire — défaut trouvé par un test, pas en production.

## Et le relais Node ?

`../relay-server` reste dans le dépôt : il sert aux tests d'intégration
de l'app (lancé en sous-processus, sans réseau) et de solution de
repli. Les deux implémentations parlent le même protocole.
