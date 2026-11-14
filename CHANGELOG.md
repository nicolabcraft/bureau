# Journal des versions

Chaque version publiée sur GitHub reprend sa section de ce fichier, suivie du tuto d'installation complet.

## 0.2.0

### La vue : l'immeuble vu de dessus
- Vue en pixel art, qui remplace la vue isométrique : les étages sont empilés, chacun est un plan vu de dessus. Un étage par projet Boite ; les conversations sans projet occupent le rez-de-chaussée.
- Chaque étage a son escalier et son ascenseur visibles, sa cafétéria et ses sanitaires. Un agent qui change de projet prend l'ascenseur ou l'escalier jusqu'à son nouvel étage.
- Chaque agent est un personnage à son poste : il tape, lève la main quand il attend ta réponse, fait une pause quand il est au repos, rend son dossier à son responsable quand il a fini.
- Les agents qui se parlent ont des bulles. Un clic sur une bulle ouvre une boîte de dialogue avec les deux portraits et « Ouvrir la conversation ».
- Un nouveau projet fait construire son étage (grue, dalle, murs, mobilier) ; une nouvelle équipe fait construire sa zone. Un projet sans conversation pendant 20 secondes voit son étage démoli.
- Éclairage selon l'heure réelle : jour, soir, nuit.
- Barre d'étages à droite, zoom, défilement entre étages, clavier (PageHaut, PageBas, Début, Fin, flèches, + et -, 0, Échap). Sur téléphone, la barre devient une bande en bas : Escalier, Étage, Ascenseur.
- « Qui m'attend », fiche d'un agent, plan de mission et « Valider le plan » gardent leur place dans l'en-tête.
- Au moins 60 images par seconde en vue d'étage, de jour comme de nuit, avec 5 étages et 40 agents (mesure de la démo, fenêtre 1280 x 800).
- La vue isométrique reste dans le dépôt, sans être servie.

### Vue avancée
- Bouton « Vue avancée » : une coupe de l'immeuble, chaque étage en bande, avec la cage de l'ascenseur et la grue pendant un chantier.
- Les délégations et les rapports partent en capsules, de l'agent qui délègue vers celui qui reçoit.
- Journal des échanges à droite, avec les onglets Tout, Travail, Papotage et Alertes. Survoler une ligne met en évidence ses deux agents ; un clic amène la vue sur l'agent.
- Bouton « Plan technique » : l'arbre de délégation de bureau en bureau, avec le modèle sous chaque bureau.

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
