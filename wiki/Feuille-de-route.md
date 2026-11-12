# Feuille de route

Ce qui existe est décrit dans les autres pages. Cette page ne liste que ce qui est **prévu** : rien ici n'est livré, et les dates ne sont pas fixées.

## Prévu : demandes à Boite

La permission `threads.archive` pour les plugins est arrivée dans Boite 2.0.0-nightly.20261111.1 : l'[archivage automatique](Archivage-automatique) archive pour de vrai depuis Bureau 0.1.1.

### Un onglet Bureau dans le panneau de Boite

Boite permet maintenant à un plugin d'ajouter des boutons, un onglet de panneau et des commandes de palette (`provides.ui`, permission `ui`, mtsu-dev/boite#1002). Ce n'est pas encore dans une version publiée de Boite. Bureau sert toujours une page locale, ouverte dans l'onglet navigateur du panneau ; un onglet Bureau la remplacerait.

## Limites connues

- Répondre à une permission se fait dans la conversation : le plugin n'a pas le droit de répondre à la place de l'utilisateur.
- Les réglages de l'archivage se changent par commande, pas dans un écran de Boite.
- La vue immeuble n'a pas été mesurée sur un téléphone ni sur un poste modeste : la fluidité annoncée vaut pour un poste de bureau courant.

## Proposer une idée

Ouvrir un [ticket](https://github.com/nicolabcraft/bureau/issues/new/choose). Voir aussi [Développement](Developpement) pour contribuer.
