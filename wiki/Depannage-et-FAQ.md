# Dépannage et FAQ

## Dépannage

### « Le service Bureau ne tourne pas. »

La commande `boite bureau` ne trouve pas le service. Réglages > Plugins > Bureau > Démarrer, puis relancer `boite bureau`.

### La vue affiche « Bureau a perdu la connexion avec Boite »

Le service n'arrive plus à joindre le core de Boite. Ce qui est affiché peut être ancien. Le service retente seul (1, 2, 5 puis 10 secondes). Si ça dure : Réglages > Plugins > Bureau > Redémarrer.

Un clic sur « Ouvrir la conversation » ou « Arrêter » pendant la coupure répond « Bureau n'est pas connecté à Boite : relance le service ».

### « Hôte refusé : utilise http://127.0.0.1:<port>/ »

La page doit être ouverte par `http://127.0.0.1:<port>/`, pas par `localhost` ni un autre nom. Lancer `boite bureau` pour l'adresse exacte.

### Le port 47317 est pris

Le service prend le port libre suivant (jusqu'à 100 essais). `boite bureau` donne le port réel.

### La vue est vide

- Aucune équipe n'a eu d'activité dans les 24 dernières heures : la vue montre les équipes récentes, 30 au plus.
- Les fils archivés, chats d'équipe de Boite, salons et conversations incognito n'apparaissent pas.
- Lancer une conversation avec un sous-agent, ou `/mission`, fait apparaître une équipe.

### Un responsable apparaît comme une équipe séparée

Il n'a pas été rattaché au chef. Le responsable lance `boite bureau-role manager --service <nom> --chef <id du chef>`, ou le chef le fait pour lui :

```
boite bureau-role manager --service <nom> --thread <id du responsable> --chef <id du chef>
```

L'id du chef est la ligne `thread:` de `boite where`. Un lien est ignoré si le chef n'existe plus, est archivé, ou si le rattachement fermerait une boucle.

### Un responsable reste « En pause » alors qu'il a fini

Bureau le compte « Fini » seulement après son rapport (`boite bureau-rapport`) ou quand la mission de son chef est terminée. Entre deux résultats de ses agents, il est au repos sans avoir fini. S'il retravaille après son rapport sans en redéposer un, il redevient « En pause ».

### `bureau-plan` refuse le plan

- « Un plan attend déjà la validation » : un plan `proposed` existe déjà pour ce chef. Ajouter `--remplacer` pour le remplacer.
- Plan invalide : vérifier le format dans [Missions](Missions) (1 à 40 lots, ids de 1 à 20 caractères `A-Za-z0-9_-`, ids uniques).
- Mission inconnue : la commande liste les missions connues.

### `bureau-rapport` : rapport trop long

64 Ko au plus. Résumer, ou garder le détail dans un fichier et citer son chemin.

### `bureau-archive` sort avec le code 1

Boite a refusé au moins un fil : il est épinglé, ou Boite est antérieur à 2.0.0-nightly.20261111.1 et n'ouvre pas `threads.archive` aux plugins. Le motif est dans `boite bureau-archive journal`. `--dry-run` donne la liste sans erreur.

### « BOITE_PLUGIN_DATA est absent » ou « Boite est injoignable »

La commande a été lancée hors de Boite. Utiliser `boite <nom>` depuis Boite.

### Les journaux du service

Le service écrit ses messages sur sa sortie d'erreur, préfixés par `[bureau]`.

## FAQ

### Bureau change-t-il mes conversations ?

Il lit les conversations, et il agit seulement quand on le lui demande dans la vue : prévenir le chef après « Valider le plan », arrêter un tour après confirmation, ouvrir une conversation. Il n'envoie rien d'autre et ne supprime rien.

### Puis-je répondre à une permission depuis la vue ?

Non. Le plugin n'a pas le droit de répondre pour vous. « Répondre » amène Boite sur la conversation concernée.

### Quels fournisseurs d'agents sont pris en charge ?

Ceux que Boite unifie : Bureau lit les conversations de Boite, quel que soit le fournisseur. Le modèle de chaque agent est affiché dans sa fiche.

### Et avec plusieurs projets ?

Chaque conversation racine forme une équipe, avec son nom de projet. Le menu d'équipe, sur le titre de la vue, passe de l'une à l'autre.

### Faut-il utiliser `/mission` pour que la vue serve ?

Non. La vue montre toute conversation avec ses sous-agents. `/mission` ajoute l'organisation (chef, plan validé, responsables) par-dessus.

### Les données quittent-elles ma machine ?

Non. La vue est servie en local, sans ressource distante, et les fichiers du plugin restent dans son dossier de données.

### Comment signaler un bug ou proposer une idée ?

Ouvrir un ticket : [nouveau ticket](https://github.com/nicolabcraft/bureau/issues/new/choose). Pour une faille de sécurité, suivre la [politique de sécurité](https://github.com/nicolabcraft/bureau/security/policy).
