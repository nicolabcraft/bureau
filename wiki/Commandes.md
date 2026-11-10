# Commandes

Bureau ajoute six commandes à `boite`. Toute sortie est en français, une information par ligne. L'option `--json` donne les données brutes quand elle existe. Les erreurs vont sur la sortie d'erreur et disent quoi lancer à la place.

Codes de sortie : 0 succès, 1 erreur, 2 usage.

Le fil appelant est celui que Boite fournit à la commande (`BOITE_CALLER_THREAD_ID`). Les commandes doivent donc se lancer avec `boite <nom>` depuis Boite, par un agent ou depuis un terminal de Boite.

| Commande | Qui | En bref |
|---|---|---|
| `boite bureau` | tous | adresse de la vue |
| `boite bureau-role` | chef, responsables, agents | déclarer un rôle |
| `boite bureau-plan` | chef, responsables | déposer le plan, valider, suivre les lots |
| `boite bureau-mission` | tous | organigramme, plan, rapports |
| `boite bureau-rapport` | responsables, agents | déposer un rapport |
| `boite bureau-archive` | utilisateur | passage d'archivage, journal, réglages |

Dans une conversation, deux commandes `/` existent aussi : `/bureau` et `/mission <demande>` (voir en bas de page).

## boite bureau

Affiche l'adresse de la vue et la ligne pour l'ouvrir dans Boite.

```
boite bureau
```

```
Adresse : http://127.0.0.1:47317/
Pour l'ouvrir dans Boite : boite browse http://127.0.0.1:47317/
```

Si le service ne tourne pas : « Le service Bureau ne tourne pas. » puis « Démarre-le : Réglages > Plugins > Bureau > Démarrer. » (code 1).

## boite bureau-role

Déclare le rôle du fil appelant, ou celui d'un autre fil avec `--thread`.

```
boite bureau-role <chef|manager|agent> [--service <nom>] [--files <a,b,c>] [--thread <id>] [--chef <id-du-chef>]
```

| Option | Sens |
|---|---|
| `--service <nom>` | service du fil. Conseillés : Produit, Architecture, Développement, Design, Qualité (texte libre accepté) |
| `--files <a,b,c>` | fichiers attribués, séparés par des virgules ; la fiche de l'agent les affiche |
| `--thread <id>` | déclare le rôle de ce fil, par exemple un agent que le responsable vient de lancer |
| `--chef <id-du-chef>` | rôle `manager` seulement : rattache un responsable lancé avec `boite thread new` à son chef |

Exemples :

```
boite bureau-role chef
boite bureau-role manager --service Développement --chef <id du chef>
boite bureau-role agent --service Développement --files src/a.ts,src/b.ts --thread <id de l'agent>
```

`--chef` avec un autre rôle que `manager` : code 2. Une déclaration suivante du même fil, toujours manager, garde le lien au chef ; un autre rôle l'efface.

## boite bureau-plan

Quatre formes.

```
boite bureau-plan <plan.json> [--remplacer]
boite bureau-plan valider <mission> --chat
boite bureau-plan lot <mission> <lot> <todo|running|done> [--agent <thread-id>]
boite bureau-plan fini <mission>
```

| Forme | Effet |
|---|---|
| `<plan.json>` | le chef dépose son plan : mission `proposed` liée à son fil. Affiche l'id de mission et « En attente de la validation de l'utilisateur ». Refuse un second plan `proposed` du même chef, sauf `--remplacer` |
| `valider <mission> --chat` | seulement quand l'utilisateur a approuvé ce plan dans la conversation du chef : mission `validated`, validée via le chat |
| `lot <mission> <lot> <état> [--agent <id>]` | met à jour un lot (le chef ou un responsable) |
| `fini <mission>` | le chef a rendu son bilan : mission `done` |

Exemples :

```
boite bureau-plan plan.json
boite bureau-plan lot m-k3x9p L1 running --agent <thread-id>
boite bureau-plan lot m-k3x9p L1 done --agent <thread-id>
boite bureau-plan fini m-k3x9p
```

Format de `plan.json` : voir [Missions](Missions). Un id de mission inconnu donne la liste des missions connues.

## boite bureau-mission

Affiche l'organigramme de l'équipe du fil appelant : rôle, service, état et modèle de chacun, plan et état des lots, rapports reçus. Le chef, un responsable et un agent voient la même équipe entière.

```
boite bureau-mission [--json]
```

À relancer quand un message arrive, pas en boucle.

## boite bureau-rapport

Dépose le rapport du fil appelant. Il s'affiche dans sa fiche et comme dossier sur le bureau de son responsable.

```
boite bureau-rapport <texte>
boite bureau-rapport --file <chemin>
```

64 Ko au plus ; au-delà, la commande refuse et suggère de résumer ou de citer un chemin.

## boite bureau-archive

Passage d'archivage, journal et réglages. Détails et règles : [Archivage automatique](Archivage-automatique).

```
boite bureau-archive [--dry-run] [--json]
boite bureau-archive journal [--json]
boite bureau-archive reglages [--auto <oui|non>] [--delai <heures>] [--etendu <oui|non>] [--delai-etendu <heures>]
```

Exemples :

```
boite bureau-archive --dry-run
boite bureau-archive journal
boite bureau-archive reglages --delai 6 --etendu oui --delai-etendu 48 --auto oui
```

Tant que Boite n'ouvre pas `threads.archive` aux plugins, un passage réel n'archive rien : il liste les fils, le dit et sort avec le code 1.

## Commandes de composeur

| Commande | Effet |
|---|---|
| `/bureau` | lance `boite bureau`, puis `boite browse` sur l'adresse affichée |
| `/mission <demande>` | l'agent devient le chef de projet de cette mission : il lit le skill `bureau-chef` et le suit à la lettre |
