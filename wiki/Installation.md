# Installation

Bureau est un plugin Boite au manifeste schema 2, avec le runtime `bun`. Il s'installe depuis l'adresse de son dépôt git.

## Avant de commencer

- Boite installé, avec la gestion des plugins (Réglages > Plugins).
- Rien d'autre côté utilisateur : le plugin n'ouvre aucune ressource distante.

Bun n'est nécessaire que pour travailler sur le code (voir [Développement](Developpement)).

## Étapes

1. Ouvrir Réglages > Plugins > Ajouter depuis une URL git.
2. Coller `https://github.com/nicolabcraft/bureau` et valider.
3. Accepter les permissions demandées (voir plus bas).
4. Démarrer le service Bureau dans la même page de réglages.

Ensuite, dans une conversation, lancer `/bureau` : la vue s'ouvre dans l'onglet navigateur du panneau de Boite.

## Permissions demandées

| Permission | Pourquoi |
|---|---|
| `threads.read` | lister les conversations et suivre leurs changements pour dessiner l'immeuble |
| `threads.write` | prévenir le chef quand le plan est validé dans la vue (`turns.start`), arrêter le tour d'un agent (`turns.stop`) |
| `ui.reveal` | le bouton « Ouvrir la conversation » amène Boite sur le bon fil |

`threads.write` couvre aussi `threads.archive`, dont l'[archivage automatique](Archivage-automatique) a besoin (Boite 2.0.0-nightly.20261111.1 ou plus récent).

## Vérifier que ça marche

Dans un terminal ou une conversation de Boite :

```
boite bureau
```

La commande affiche l'adresse de la vue, par exemple `http://127.0.0.1:47317/`, et la ligne `boite browse <adresse>` pour l'ouvrir. Si le service ne tourne pas, elle le dit et indique Réglages > Plugins > Bureau > Démarrer.

## Mise à jour et suppression

Elles passent par la même page Réglages > Plugins. Les fichiers de données de Bureau (registre des rôles, réglages, journal) sont dans le dossier privé du plugin : voir [Configuration](Configuration).

## Un problème ?

Voir [Dépannage et FAQ](Depannage-et-FAQ).
