# Premiers pas

Une fois le plugin installé et le service démarré (voir [Installation](Installation)).

## 1. Ouvrir la vue

Dans une conversation, taper `/bureau`. L'agent lance `boite bureau`, puis `boite browse` sur l'adresse affichée. La vue s'ouvre dans le panneau.

Chaque conversation racine de Boite, avec les fils placés sous elle, forme une équipe ; chaque fil devient un personnage. Voir [La vue du Bureau](La-vue-du-Bureau).

## 2. Lancer une mission

Dans une conversation, taper :

```
/mission <votre demande>
```

L'agent devient le chef de projet : il lit le skill `bureau-chef`, reformule la demande en trois lignes, pose des questions si le besoin est flou, puis dépose un plan avec `boite bureau-plan`. Il ne lance rien avant votre accord.

## 3. Valider le plan

Deux façons, au choix :

- dans la vue, ouvrir « Plan de mission » et cliquer sur « Valider le plan » ;
- dans la conversation du chef, écrire « valide ». Le chef lance alors `boite bureau-plan valider <mission> --chat`.

Le chef ne valide jamais son propre plan. Détails : [Missions](Missions).

## 4. Suivre le travail

- Chaque agent travaille à son bureau dans la vue. Cliquer sur un personnage ouvre sa fiche.
- « Qui m'attend » filtre les agents qui attendent une réponse de votre part.
- « Ouvrir la conversation » amène Boite sur la conversation de l'agent. C'est là qu'on répond à une permission ou à une question.
- « Arrêter » demande une confirmation, puis arrête le tour de l'agent.
- Depuis un terminal ou un agent : `boite bureau-mission` affiche l'organigramme, les lots et les rapports.

## 5. Le bilan

Quand tous les lots sont faits, le chef fait relire l'ensemble par le responsable Qualité, rend un bilan (fait, vérifié, reste, questions) et clôt la mission avec `boite bureau-plan fini <mission>`.

## Pour aller plus loin

- Essayer la vue sans Boite : `bun run demo` (voir [Développement](Developpement)).
- Régler le rangement des conversations : [Archivage automatique](Archivage-automatique).
