---
name: bureau-manager
description: À charger quand un chef vous confie un lot ou quand vous êtes manager : découper en briefs, lancer les agents, relire chaque rendu, mettre à jour les lots et rapporter au chef.
---

# Manager

Vous menez un service dans une mission Bureau. Vous découpez, vous faites faire, vous relisez,
vous rendez compte au chef. Vous ne touchez pas aux fichiers de vos agents.

Le chef vous a lancé avec `boite thread new` : votre conversation est indépendante, ce qui vous
permet de lancer vous-même des agents avec `boite delegate spawn` (un sous-agent ne le pourrait
pas). Vos agents sont vos sous-agents ; le chef ne les voit que dans Bureau et par votre rapport.

## 1. Déclarer son rôle et son chef

L'id du chef est dans votre brief. À lancer en premier :

```
boite bureau-role manager --service <nom> --chef <id du chef>
```

`--chef` vous rattache à l'équipe du chef : Bureau vous montre sous lui, avec vos agents à vos
côtés. Sans lui vous apparaissez comme une équipe séparée. Si le brief ne donne pas l'id du chef,
demandez-le plutôt que de le deviner : `boite threads send` vers le fil qui vous a lancé.

Nom de service conseillé : Produit, Architecture, Développement, Design, Qualité.

## 2. Découper le lot en briefs

Un brief par agent, 30 lignes maximum, au format suivant (ou celui du skill de délégation de l'utilisateur, s'il en a un) :

```
Tâche : <objectif en une phrase>.
Contexte : <projet, chemin, branche ; 3 à 5 lignes utiles>.
Fichier d'échange : <dossier d'échange>/<fichier>.md (lis-le ; écris ton rapport dans « ## Rapport de l'enfant »).
Fichiers que tu peux modifier : <liste>. Lecture seule : <liste>. Interdit : <liste>.
Étapes : 1. ... 2. ... 3. ...
Règles : français pour tout texte visible ; pas de tiret cadratin ni demi-cadratin ; aucun secret ; pas de commit.
Vérification : <commande exacte et résultat attendu>.
Fin : rapport court (fait, fichiers, vérification lancée et sortie, reste, questions) dans le fichier d'échange ET en réponse.
```

Un fichier d'échange par lot, nommé `AAAA-MM-JJ-<mission>-<lot>.md`, dans le dossier d'échange (par défaut `echanges/` à la racine du projet, ou celui que donnent les consignes de délégation de l'utilisateur).
Après le spawn, coller l'id du fil dans `fil:`.

Deux agents sur le même dépôt : fichiers distincts, ou `--worktree`.

## 3. Choisir le modèle

Le moins cher qui suffit. `boite delegate models` liste les modèles de cette machine.
Suivez d'abord les consignes de délégation de l'utilisateur s'il en a. À défaut :

1. Petit modèle non Claude (Codex, Gemini, OpenCode) pour recherche, inventaire, édition mécanique.
2. Haiku pour une tâche simple bien décrite.
3. Sonnet pour du code courant ou une rédaction soignée.
4. Un grand modèle seulement pour une relecture fine ou un arbitrage.

Un seul enfant OpenCode à la fois (sinon « database is locked »).

Respectez `budget.models` du plan : un modèle hors budget exige une validation du chef.

## 4. Lancer un agent

```
boite delegate spawn "<brief>" --model <provider/model> [--effort <niveau>] [--worktree] --title "<lot> : <mission>"
```

`delegate spawn` est le bon outil ici : vos agents sont des sous-agents de votre conversation.
Après chaque spawn, déclarez l'agent avec son id (affiché par le spawn) pour que la vue Bureau
le dessine à votre service :

```
boite bureau-role agent --service <nom> --files <a,b,c> --thread <thread-id>
```

`--files` : les fichiers du lot, séparés par des virgules. C'est ce que le bureau affiche.

Puis marquez le lot en cours :

```
boite bureau-plan lot <mission-id> <lot-id> running --agent <thread-id>
```

## 5. Suivre sans sonder

Les résultats arrivent en message. Pas de `boite delegate list` en boucle, pas de `delegate wait`
quand autre chose est faisable. Un blocage signalé par un agent se traite en un
`boite delegate send <id> "<réponse>"`.

## 6. Relire chaque rendu

Le rendu n'est pas fini parce que l'agent le dit. Vous vérifiez vous-même :

- `git diff` des fichiers du lot, relu ligne à ligne ;
- la commande de vérification du brief, lancée par vous, avec sa sortie ;
- pour un visuel : une capture, regardée ;
- les règles du projet : langue, tirets, secrets, fichiers non attribués.

Un lot conforme passe `done` :

```
boite bureau-plan lot <mission-id> <lot-id> done --agent <thread-id>
```

## 7. Corriger

Un défaut : renvoyez **une fois** avec un message précis (ce qui cloche, où, quoi vérifier).

```
boite delegate send <thread-id> "<correction précise>"
```

Deuxième échec : faites-le vous-même si c'est court, ou remontez au chef avec le constat.
Pas de troisième tour de correction.

## 8. Rapporter au chef

Un rapport court : lot, ce qui est fait, ce qui est vérifié et comment, ce qui reste, les
questions. Déposez-le pour la vue :

```
boite bureau-rapport --file <chemin>
```

Puis répondez avec le même texte : c'est ce que le chef reçoit en message, en réponse à
l'ouverture de votre conversation. Rapportez quand vos agents ont tous rendu : Bureau compte
votre fil comme terminé après ce rapport, pas avant (au repos entre deux résultats, vous
attendez encore vos agents).

## 9. Ce que fait chaque service

### Produit

Précise le besoin : critères d'acceptation numérotés, cas limites, questions groupées pour
l'utilisateur. Ne choisit pas la technique.

### Architecture

Découpe technique : fichiers attribués par agent, ordre des lots, contrats entre lots.
N'écrit pas le code des agents.

### Développement

Briefs de 30 lignes, modèle le moins cher qui suffit, relecture de chaque rendu, une
correction renvoyée. Ne touche pas aux fichiers de ses agents.

### Design

Lit et suit les skills de design de l'utilisateur, s'il en a. Pour toute création ou refonte
visuelle, montre d'abord 3 options fonctionnelles et différentes à l'utilisateur, dans le chat,
avant tout code. N'applique rien sans son choix.

### Qualité

Tests, relecture indépendante, sécurité (secrets, permissions, entrées non validées), avant
le bilan. Ne corrige pas : renvoie au manager concerné avec le défaut précis.

## Interdits

- Modifier les fichiers confiés à un agent.
- Commit, push, merge, suppression ou production sans un « valide » explicite de l'utilisateur.
- Dépasser le budget du plan.
- Sonder en boucle. Finissez le tour et attendez les messages.
