# Idées pour la suite

Propositions classées par intérêt réel, pas par facilité. Chacune est
jugée sur le même critère que tout le reste du projet : **est-ce que ça
révèle quelque chose à quelqu'un ?** Une fonction qui oblige à trahir le
modèle est refusée, même si elle est jolie.

Rien ici n'est décidé. C'est une carte, pas un plan.

---

## 1. L'âme DedSec — ce qui donnerait vraiment un caractère

### Avatars dérivés de la clé d'identité ★ ma préférée
Un motif géométrique anguleux, généré **à partir de la clé publique** du
contact. Deux bénéfices d'un coup :
- chaque personne a un visage reconnaissable, l'app cesse d'être une
  liste de texte ;
- **si la clé d'un contact change, son avatar change**. Une attaque par
  substitution devient visible du coin de l'œil, sans ouvrir le moindre
  menu. C'est de la sécurité déguisée en décoration.

Coût : faible. Aucune donnée ne circule, tout se calcule sur l'appareil.

### Tableau de bord « ce que le serveur sait »
Un écran qui affiche, en temps réel et en style panneau de contrôle, ce
que le relais peut réellement observer : nombre de boîtes, octets
transmis, et surtout la longue liste de ce qu'il **ne peut pas** voir.
Très Watch Dogs, et honnête : ça rend le modèle de sécurité tangible au
lieu de le laisser dans un fichier de documentation.

### Carte du réseau
Une vue en graphe : tes contacts, qui est joignable par le relais, qui
l'est par Bluetooth, qui est hors ligne. Les liens s'allument quand un
message passe. C'est l'écran le plus « hacktiviste » possible, et il
sert vraiment — on voit d'un coup qui est atteignable.

### Geste de panique
Un geste secret (appui long à trois doigts, ou code de déverrouillage
alternatif) qui verrouille l'app instantanément, ou efface les clés.
Classique du genre, et pas décoratif : le vrai scénario de menace de ce
projet, c'est quelqu'un qui prend ton téléphone déverrouillé.

### Séquence de démarrage
Un bref « réveil système » au lancement — vérification du chiffrement,
de la base, du relais — en trois lignes de monospace qui défilent. Une
seconde, pas plus. Ça donne le ton, et ça affiche de vrais états.

### Sons
Bips discrets, souffle de modem à l'envoi. **Coupés par défaut**, activés
dans les réglages. Un son qui se déclenche sans prévenir dans un lieu
public est exactement ce qu'une app discrète ne doit pas faire.

---

## 2. Ce qui manque vraiment (au-delà du décor)

### Sauvegarde chiffrée et changement de téléphone ★ le plus urgent
Aujourd'hui, **téléphone perdu = tout perdu** : contacts, conversations,
identité. Il faut un export chiffré par mot de passe, restaurable sur un
nouvel appareil. C'est le trou le plus sérieux du projet, très loin
devant les fonctions manquantes.

### Messages éphémères
Un délai d'effacement par conversation (1 h, 1 jour, 1 semaine). Simple
à faire, et cohérent avec le reste : on ne garde pas ce qui n'a pas
besoin d'être gardé.

### Photos, groupes, notes vocales
Les trois fonctions attendues. Le moteur de groupe est déjà écrit et
testé ; il manque les écrans.

### Réponses citées et réactions
Peu de travail, gros effet sur le confort d'une conversation à plusieurs.

### Vérification par QR en face à face
En plus du code mensuel : deux téléphones côte à côte, un QR scanné, et
la vérification est faite en deux secondes sans rien dicter.

---

## 3. Vers un réseau social — et le vrai obstacle

L'objectif est atteignable, mais il y a un piège à nommer tout de suite.

Un réseau social classique a besoin d'un **annuaire** : chercher
quelqu'un, suggérer des amis, savoir qui connaît qui. Or c'est
exactement ce que Blackout refuse : le relais ne doit jamais connaître
le graphe social. **Ces deux choses sont incompatibles**, et il faudra
choisir en connaissance de cause.

Ce qui reste possible **sans rien trahir** :

- **Fil de groupe** — des publications éphémères diffusées aux membres
  d'un groupe, avec le même chiffrement que les messages. Techniquement
  c'est un groupe qui existe déjà ; il manque la présentation.
- **Salons thématiques** — des groupes nommés, rejoignables par
  invitation, jamais par recherche.
- **Événements** — un rendez-vous avec lieu et heure, position partagée
  automatiquement à l'approche, et qui s'efface après.
- **Fichiers** — partage de documents, chiffrés, avec expiration.
- **Statuts** — « disponible », « en route », visible seulement des
  contacts vérifiés.

Autrement dit : un réseau social **par invitation uniquement**, où
l'on ne trouve personne qu'on ne connaît pas déjà. C'est une limite,
mais c'est aussi la seule version honnête du concept.

---

## 4. Ce que je déconseille, et pourquoi

| Idée | Pourquoi non |
|---|---|
| Annuaire, recherche d'utilisateurs | Le serveur apprendrait qui existe et qui cherche qui : le modèle entier s'effondre |
| Sauvegarde dans le cloud | Les clés quitteraient l'appareil — contrainte non négociable du projet |
| Aperçus de liens | Le téléphone irait chercher l'aperçu chez un tiers, qui apprendrait ce qu'on s'envoie |
| Notifications push | Apple apprendrait qui reçoit un message et quand |
| Numéro de téléphone comme identifiant | C'est précisément ce que Signal fait et qu'on évite ici |
| Accusés de lecture activés d'office | Métadonnée offerte sans nécessité ; à laisser en option, éteinte |

---

## 5. Si je devais choisir trois choses

1. **La sauvegarde chiffrée** — parce que perdre son téléphone ne
   devrait pas signifier tout perdre.
2. **Les avatars dérivés des clés** — beaucoup de caractère pour peu de
   travail, et un vrai gain de sécurité.
3. **Le fil de groupe** — c'est le premier pas concret vers le réseau
   social, et il ne demande aucune concession.
