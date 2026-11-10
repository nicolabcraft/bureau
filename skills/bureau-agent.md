---
name: bureau-agent
description: À charger quand vous exécutez un lot délégué par un manager : lire le fichier d'échange, ne toucher que vos fichiers, vérifier, rendre le rapport au format fixe et signaler un blocage.
---

# Agent

Vous exécutez un lot, pas la mission. Votre périmètre est écrit dans le brief et dans le
fichier d'échange. Vous ne sortez ni des fichiers ni du format.

## 1. Prendre le rôle

Le manager l'a normalement déjà fait. Vous êtes son sous-agent (`boite delegate spawn`) : pas de
`--chef` à donner. Sinon :

```
boite bureau-role agent --service <nom> --files <a,b,c>
```

`--files` : vos fichiers, séparés par des virgules. C'est ce que le bureau affiche.

## 2. Lire le fichier d'échange

Le brief cite le fichier d'échange du lot (`AAAA-MM-JJ-<slug>.md`, dans le dossier d'échange :
`echanges/` à la racine du projet par défaut, ou celui des consignes de délégation de l'utilisateur).
Lisez-le en entier avant la première commande : objectif, fichiers attribués, fichiers en lecture seule, interdits,
vérification attendue.

Un brief ambigu et qui change le résultat (deux fichiers possibles, deux comportements
possibles) : demandez avant d'écrire, pas après.

## 3. Ne toucher que ses fichiers

`Fichiers que tu peux modifier` est une liste fermée. Tout le reste est en lecture seule,
même une correction évidente, même une virgule. Un fichier voisin qui doit changer : dites-le
dans le rapport, ne le modifiez pas.

Pas de commit, pas de push, pas de suppression, pas de branche, pas de reformatage global
sans ordre explicite. Pas de nouvelle dépendance sans l'accord du manager.

## 4. Travailler

1. Lire avant d'écrire : fichiers du lot, fichiers de référence, conventions du dépôt.
2. Imiter le style existant (langue du code, nommage, structure) plutôt qu'inventer.
3. Faire des changements minimaux et lisibles, sans commentaire ajouté inutilement.
4. Ne jamais afficher, journaliser ou committer un secret.

## 5. Vérifier

Lancez la commande de vérification du brief, et toute commande du projet pour ce type de
fichier (tests existants, lint, typecheck, compilation). Notez la commande exacte et sa
sortie réelle. Un succès non lancé ne s'invente pas.

## 6. Rapport au format fixe

Cinq titres, rien d'autre, dans cet ordre :

```
## Rapport de l'enfant
### Fait
### Fichiers
### Vérification
### Reste
### Questions
```

- Fait : ce qui est terminé, en phrases courtes.
- Fichiers : chemins touchés, un par ligne.
- Vérification : commande exacte et extrait de sortie.
- Reste : ce qui n'est pas fait, et pourquoi.
- Questions : groupées, numérotées, seulement si une décision ne vous appartient pas.

Écrivez-le dans le fichier d'échange, sous « ## Rapport de l'enfant ». Déposez le même
texte pour la vue :

```
boite bureau-rapport --file <chemin>
```

Puis répondez avec le rapport : le manager le reçoit en message.

## 7. Bloqué

Un blocage réel (fichier verrouillé, accès manquant, brief contredit le dépôt) :

```
boite delegate send <id parent> "<blocage, en une ou deux phrases>"
```

Donnez l'id du fil parent fourni dans le brief, le blocage, et ce que vous pouvez faire en
attendant. Continuez sur ce qui est faisable. N'inventez pas une solution hors périmètre.

## Interdits

- Toucher un fichier hors de la liste attribuée.
- Commit, push, merge, suppression, action en production sans ordre explicite.
- Contourner un test qui échoue (le supprimer, le désactiver, le rendre toujours vrai).
- Rendre un rapport sans la sortie réelle de la vérification.
- Sonder le parent. Les messages arrivent seuls.
