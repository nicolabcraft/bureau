# Skills

Bureau fournit trois skills, un par rôle. Ce sont des fichiers de consignes que Boite met à disposition des agents ; leurs sources sont dans le dossier [`skills/`](https://github.com/nicolabcraft/bureau/tree/main/skills) du dépôt, copiées dans le manifeste par `bun run pack`.

Une ligne de guide fournie par le plugin dit aux agents quand s'en servir : sur `/mission`, ils sont chef ; lancés avec `boite thread new` pour mener un service, ils sont responsables ; lancés avec `boite delegate spawn` par un responsable, ils sont agents. Bureau n'est pas utilisé pour une conversation ordinaire sans délégation.

## bureau-chef

Chargé quand l'utilisateur lance `/mission` ou nomme un chef.

1. Prendre le rôle : `boite bureau-role chef`.
2. Reformuler la demande en trois lignes : objectif, résultat attendu, contraintes connues.
3. Poser des questions, seulement si le besoin est flou sur un point qui change le plan. Groupées et numérotées.
4. Écrire `plan.json` : 1 à 40 lots, le modèle le moins cher qui suffit pour chacun, un budget.
5. Déposer le plan avec `boite bureau-plan`, puis finir son tour et attendre.
6. Attendre la validation : bouton « Valider le plan » ou « valide » dans le chat. Jamais de validation par soi-même.
7. Nommer les responsables utiles et les lancer avec `boite thread new`, avec un brief de 30 lignes au plus.
8. Suivre avec `boite bureau-mission`, sans sonder en boucle.
9. Faire relire l'ensemble par le responsable Qualité avant le bilan.
10. Rendre le bilan en quatre blocs (fait, vérifié, reste, questions), puis `boite bureau-plan fini`.

Interdits : coder, commit, push, merge, suppression ou production sans « valide » explicite, valider son propre plan, dépasser le budget sans nouvelle validation, sonder en boucle, lancer un responsable avec `boite delegate spawn`.

## bureau-manager

Chargé quand un chef confie un lot, ou quand on est responsable de service.

1. Se déclarer : `boite bureau-role manager --service <nom> --chef <id du chef>`.
2. Découper le lot en briefs de 30 lignes au plus, un par agent, avec fichiers autorisés, lecture seule, interdits, étapes et vérification attendue.
3. Choisir le modèle le moins cher qui suffit, dans le budget du plan.
4. Lancer chaque agent avec `boite delegate spawn`, le déclarer avec `boite bureau-role agent ... --thread <id>`, marquer le lot `running`.
5. Suivre sans sonder : les résultats arrivent en message.
6. Relire chaque rendu soi-même : diff, commande de vérification relancée, capture pour un visuel, règles du projet. Un lot conforme passe `done`.
7. Corriger une seule fois par message précis ; au deuxième échec, corriger soi-même ou remonter au chef.
8. Rapporter au chef avec `boite bureau-rapport --file <chemin>` quand tous les agents ont rendu.

Ce que fait chaque service :

| Service | Fait |
|---|---|
| Produit | critères d'acceptation numérotés, cas limites, questions groupées ; ne choisit pas la technique |
| Architecture | découpe technique, fichiers par agent, ordre des lots, contrats entre lots ; n'écrit pas le code |
| Développement | briefs, choix du modèle, relecture de chaque rendu, une correction renvoyée ; ne touche pas aux fichiers de ses agents |
| Design | applique les skills de design de l'utilisateur ; trois options montrées avant tout code ; n'applique rien sans choix |
| Qualité | tests, relecture indépendante, sécurité (secrets, permissions, entrées non validées) ; renvoie au manager concerné, ne corrige pas |

## bureau-agent

Chargé quand on exécute un lot délégué par un responsable.

1. Prendre le rôle si le responsable ne l'a pas fait : `boite bureau-role agent --service <nom> --files <a,b,c>`.
2. Lire en entier le fichier d'échange que cite le brief avant la première commande. C'est une convention de l'utilisateur : un fichier par lot qui décrit l'objectif, les fichiers autorisés et la vérification attendue.
3. Ne toucher que les fichiers attribués : la liste est fermée.
4. Lire avant d'écrire, imiter le style existant, changements minimaux, aucun secret.
5. Lancer la vérification du brief et les commandes du projet, noter la sortie réelle.
6. Rendre un rapport au format fixe, cinq titres dans cet ordre :

```
## Rapport de l'enfant
### Fait
### Fichiers
### Vérification
### Reste
### Questions
```

7. Déposer le même texte pour la vue : `boite bureau-rapport --file <chemin>`, puis répondre avec le rapport.
8. Bloqué : `boite delegate send <id parent> "<blocage>"` et continuer sur ce qui est faisable.

Interdits : toucher un fichier hors liste, commit, push, merge, suppression sans ordre, contourner un test qui échoue, rendre un rapport sans la sortie réelle de la vérification, sonder le parent.

## Personnaliser

Les skills sont en français et reflètent une façon de travailler précise (briefs de 30 lignes, un seul tour de correction). Pour les adapter, modifier `skills/<nom>.md` puis lancer `bun run pack` : voir [Développement](Developpement).
