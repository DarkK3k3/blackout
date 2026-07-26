# Modèle de menace de Blackout

Ce document dit **ce que Blackout protège, ce qu'il ne protège pas, et
pourquoi**. Le lire évite les mauvaises surprises : aucune app ne protège
contre tout, et une app qui prétend le contraire ment.

## Ce qui est protégé

**Le contenu de tes messages, contre tout le monde sauf ton correspondant.**
Chiffrement de bout en bout par `libsignal` (l'implémentation officielle de
Signal, pas une réécriture maison) : X3DH/PQXDH pour l'établissement de
session, Double Ratchet ensuite.

- **Forward secrecy** : chaque message a sa propre clé, détruite après usage.
  Voler ton téléphone aujourd'hui ne donne pas les messages d'hier.
- **Post-compromise security** : le ratchet Diffie-Hellman renouvelle le
  secret à chaque changement de sens. Un attaquant qui aurait volé un état
  de session en perd le bénéfice dès l'échange suivant.
- **Résistance post-quantique** (PQXDH) : la couche Kyber protège contre le
  scénario « on enregistre aujourd'hui, on déchiffre dans quinze ans avec un
  ordinateur quantique ».

**Tes données au repos, contre le vol physique du téléphone.** Toute la base
locale (messages, contacts, états de session) est chiffrée par SQLCipher avec
une clé aléatoire de 256 bits rangée dans le Keychain iOS / Keystore Android.
Quelqu'un qui extrait le fichier de base de données n'obtient que du bruit.

**L'identité de ton correspondant, si tu fais la vérification.** Le code de
vérification mensuel (l'équivalent du « safety number » de Signal) permet de
confirmer que personne ne s'intercale. Il se compare de vive voix ou par QR.

**Ton graphe social, vis-à-vis du serveur relais.** Le relais ne voit que des
identifiants de boîtes aléatoires et des blobs chiffrés. Pas de compte, pas
d'annuaire, pas de numéro de téléphone, pas de liste de contacts.

## Ce qui n'est PAS protégé

**Les métadonnées de trafic.** Le relais voit *quand* une boîte reçoit
quelque chose et *quelle taille* fait le message. Quelqu'un qui observerait
le réseau du relais **et** ta connexion pourrait corréler les horaires.
Blackout n'est pas Tor : il ne cache pas que tu communiques, seulement avec
qui et quoi.

**Une fuite lors du tout premier message.** Le premier message d'une nouvelle
relation porte l'identifiant pseudonyme (un UUID aléatoire) de l'expéditeur en
clair dans l'enveloppe — libsignal lie les adresses à la session, le
destinataire doit donc savoir qui écrit avant de pouvoir déchiffrer. Cet UUID
n'est rattaché à aucune identité réelle, et les messages suivants n'en portent
plus. C'est un compromis assumé et documenté.

**Un téléphone compromis.** Si quelqu'un contrôle ton système d'exploitation
(logiciel espion, appareil rooté/jailbreaké par un tiers), il lit tes messages
à l'écran — avant chiffrement, après déchiffrement. Aucun protocole n'y peut
rien.

**Ton correspondant lui-même.** Il peut faire une capture d'écran, recopier,
montrer son téléphone. Le chiffrement protège le transport, pas la confiance.

**Une identité non vérifiée.** Si tu n'as jamais comparé le code mensuel avec
un contact, tu sais que la conversation est chiffrée, mais pas *avec qui*.
Le scan physique du QR rend une interception très difficile — mais si un jour
tu reçois un QR par un autre canal (message, email), vérifie le code.

**La destruction à distance.** Pas d'effacement à distance, pas de messages
éphémères en v1.

## Décisions de conception et leurs raisons

**Pourquoi aucun compte ?** Un compte, c'est un identifiant central, donc une
liste d'utilisateurs, donc une cible. Ici chaque installation génère sa paire
de clés localement : il n'existe aucune base d'utilisateurs à saisir ou à
faire fuiter.

**Pourquoi le code de vérification tourne-t-il chaque mois ?** Pour créer une
habitude de re-vérification. Il est dérivé par KDF de l'empreinte fixe des
deux clés d'identité + le mois courant. C'est un **calcul en lecture seule**,
totalement séparé du Double Ratchet : le régénérer ne renégocie aucune clé et
ne coupe jamais la conversation. Un test automatisé vérifie précisément cette
propriété à chaque modification du code.

**Pourquoi le fan-out pour les groupes ?** À 5-10 personnes, chiffrer une
copie par membre est simple, robuste et sans état partagé — donc peu de
surface de bug. Les « Sender Keys » de Signal sont plus efficaces à grande
échelle mais bien plus complexes, surtout combinés au mesh Bluetooth.

**Pourquoi le relais ne stocke-t-il que des jetons hachés ?** Pour qu'un vol
du disque du serveur ne permette ni de lire les boîtes en attente ni d'y
écrire. Le serveur ne conserve aucun journal d'accès ni d'adresse IP.

## Si tu perds ton téléphone

Il n'y a **pas de sauvegarde**, par conception : une sauvegarde, c'est une
copie de tes clés hors de l'appareil. Concrètement, un téléphone perdu =
identité perdue = il faut refaire les QR avec tes contacts. Le prix de
l'absence de cloud.

## Ce projet n'a pas été audité

Le protocole et son implémentation viennent de Signal et sont audités. Mais
la *façon* dont Blackout les assemble (le transport, le stockage, le modèle
d'invitation) est du code amateur écrit pour un usage privé entre amis. Il
n'a fait l'objet d'aucun audit de sécurité indépendant. Ne l'utilise pas pour
des situations où ta sécurité physique dépend du secret de tes messages —
dans ce cas, utilise Signal.
