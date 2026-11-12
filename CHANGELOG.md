# Journal des versions

Chaque version publiée sur GitHub reprend sa section de ce fichier, suivie du tuto d'installation complet.

## 0.1.1

- L'archivage automatique archive pour de vrai : Boite ouvre `threads.archive` aux plugins sous `threads.write` depuis 2.0.0-nightly.20261111.1. Avec un Boite plus ancien, chaque refus est noté au journal.
- L'exemple de plan du skill `bureau-chef` cite `claude/claude-opus-5-5` au lieu d'un identifiant de modèle périmé.

## 0.1.0

Première version publique.

### La vue : l'immeuble des projets
- Un immeuble en isométrique au milieu d'une petite ville vivante (piétons, feux, bus, commerces, parc). Un étage par projet Boite qui a au moins une conversation en cours ; les conversations sans projet occupent l'étage « Sans projet ».
- Chaque conversation est un personnage à son bureau : il tape quand un tour tourne, lève la main entouré d'ambre quand il t'attend, va à la cafétéria quand il est au repos, rend son dossier à son responsable quand il a fini.
- Un nouveau projet fait construire un étage (grue, dalle, murs, mobilier) ; une nouvelle équipe fait construire sa zone. Un projet sans conversation depuis 20 secondes voit son étage démoli, et les étages du dessus descendent.
- Ascenseur entre les étages, entrée et départ par la porte, éclairage selon l'heure réelle.
- Zoom, déplacement, rotation, recentrage ; panneau « Immeuble » avec une jauge par étage, « N attend » et « Plan à valider » ; bulle au survol d'un agent ; légende par le bouton « ? ».
- Fiche d'un agent : état, service, supérieur, modèle, fichiers, dernier rapport, « Ouvrir la conversation », « Répondre », « Arrêter ». Liste « Qui m'attend ». Plan de mission et « Valider le plan ».
- Au moins 60 images par seconde avec 5 étages et 40 agents sur un poste de bureau courant. Respect de « réduire les animations ».

### L'organisation
- Commandes `boite bureau`, `bureau-role`, `bureau-plan`, `bureau-mission`, `bureau-rapport`, `bureau-archive`.
- Commandes du composeur `/bureau` et `/mission`.
- Skills `bureau-chef`, `bureau-manager`, `bureau-agent` : un chef qui fait valider son plan, des responsables qui lancent leurs agents, des agents qui rendent un rapport.
- Archivage automatique des conversations au repos (règles, journal, passage à blanc ; l'archivage réel attend que Boite ouvre `threads.archive` aux plugins).
