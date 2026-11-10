# Feuille de route

Ce qui existe est décrit dans les autres pages. Cette page ne liste que ce qui est **prévu** : rien ici n'est livré, et les dates ne sont pas fixées.

## Prévu : demandes à Boite

Deux manques viennent de Boite lui-même, pas de Bureau. Bureau les contourne aujourd'hui.

### Permission `threads.archive` pour les plugins

Aujourd'hui, Boite ne l'ouvre pas aux plugins (permissions possibles : `threads.read`, `threads.write`, `todos`, `ui.reveal`). Conséquence : l'[archivage automatique](Archivage-automatique) applique ses règles, tient son journal et son passage à blanc, mais n'archive rien.

Quand Boite ouvrira la méthode :

1. déclarer la permission dans `boite-plugin.json` ;
2. passer `CORE_ARCHIVE_OPEN` à `true` dans `src/archive.ts`.

### Un panneau de plugin dans Boite

Boite ne propose pas de point d'extension pour dessiner dans sa fenêtre : `PluginProvides` ne couvre que `accountPools`, `desktopApp`, `gateway`, `service`, `commands`, `skills`, `prompt` et `slashCommands`. Bureau sert donc une page locale, ouverte dans l'onglet navigateur du panneau.

Un vrai onglet de plugin dans le panneau est une piste, par une contribution à Boite. Il remplacerait la page locale ouverte avec `/bureau`.

## Limites connues

- Répondre à une permission se fait dans la conversation : le plugin n'a pas le droit de répondre à la place de l'utilisateur.
- Les réglages de l'archivage se changent par commande, pas dans un écran de Boite.
- La vue immeuble n'a pas été mesurée sur un téléphone ni sur un poste modeste : la fluidité annoncée vaut pour un poste de bureau courant.

## Proposer une idée

Ouvrir un [ticket](https://github.com/nicolabcraft/bureau/issues/new/choose). Voir aussi [Développement](Developpement) pour contribuer.
