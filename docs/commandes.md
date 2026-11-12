# Commandes, skills et registre de Bureau (spécification)

Référence commune au service, à la vue et aux skills. Toute sortie de commande est en français, une info par ligne, `--json` pour les données.

## Commandes `boite <nom>` (agents)
Le fil appelant est `BOITE_CALLER_THREAD_ID`. Le registre est `<BOITE_PLUGIN_DATA>/registre.json`.

| Commande | Usage | Effet |
|---|---|---|
| `bureau` | `bureau` | Affiche l'adresse de la vue (`http://127.0.0.1:<port>/`) et la ligne à lancer : `boite browse <adresse>`. Si le service ne tourne pas : le dire et indiquer Réglages > Plugins > Bureau > Démarrer. |
| `bureau-role` | `bureau-role <chef\|manager\|agent> [--service <nom>] [--files <a,b,c>] [--thread <id>] [--chef <id-du-chef>]` | Déclare le rôle du fil appelant, ou du fil `--thread` (un manager déclare le rôle d'un agent qu'il vient de lancer). `--chef` (rôle manager seulement) rattache un responsable lancé avec `boite thread new` au chef : voir « Trois étages ». Services conseillés : Produit, Architecture, Développement, Design, Qualité (texte libre accepté). |
| `bureau-plan` | `bureau-plan <plan.json>` | Le chef dépose son plan. Crée une mission `proposed` liée au fil appelant. Affiche l'id de mission et « En attente de la validation de l'utilisateur ». Refuse un 2e plan `proposed` pour le même chef (remplace seulement avec `--remplacer`). |
| `bureau-plan` | `bureau-plan valider <mission-id> --chat` | Seulement quand l'utilisateur a approuvé ce plan lui-même dans la conversation du chef. Marque `validated`, `validatedVia: chat`. |
| `bureau-plan` | `bureau-plan lot <mission-id> <lot-id> <todo\|running\|done> [--agent <thread-id>]` | Met à jour un lot (le chef ou un manager). |
| `bureau-plan` | `bureau-plan fini <mission-id>` | Le chef a rendu le bilan : `done`. |
| `bureau-mission` | `bureau-mission [--json]` | Organigramme de l'équipe du fil appelant (racine de son arbre, responsables rattachés compris) : rôle, service, état, modèle de chacun ; plan et état des lots ; rapports reçus. Le chef, un responsable et un agent voient la même équipe entière. |
| `bureau-rapport` | `bureau-rapport <texte>` ou `bureau-rapport --file <chemin>` | Dépose le rapport du fil appelant (64 Ko max). Il s'affiche dans sa fiche et comme dossier sur le bureau de son manager. |
| `bureau-archive` | `bureau-archive [--dry-run] [--json]` | Un passage d'archivage avec les réglages courants. `--dry-run` : liste seulement. Sans API d'archivage ouverte aux plugins, liste les fils et sort avec le code 1. |
| `bureau-archive` | `bureau-archive journal [--json]` | Les 30 derniers archivages de `archivage.jsonl` (date, fil, raison, mode). |
| `bureau-archive` | `bureau-archive reglages [--auto <oui|non>] [--delai <heures>] [--etendu <oui|non>] [--delai-etendu <heures>]` | Affiche ou change `reglages.json` : défauts 6 h, option étendue coupée, 48 h. |

Codes de sortie : 0 succès, 1 erreur (message qui dit quoi lancer à la place), 2 usage.

## Trois étages : chef, responsables, agents
Boite n'autorise qu'un étage de délégation : un sous-agent lancé par `boite delegate spawn` ne peut pas en lancer d'autres. Les responsables de service ne sont donc pas des sous-agents du chef.
- Le chef lance chaque responsable avec `boite thread new <projet> "<brief>" --title "<service> : <mission>" --model claude/claude-sonnet-5-5 --effort high`. C'est une conversation indépendante (pas de `parentThreadId`) dont le premier rapport revient au chef, et qui peut lancer ses propres agents avec `boite delegate spawn`.
- Le brief demande au responsable de lancer `boite bureau-role manager --service <nom> --chef <id du chef>` (l'id du chef : ligne `thread:` de `boite where`). Le chef peut le poser lui-même : `boite bureau-role manager --service <nom> --thread <id du responsable> --chef <id du chef>`.
- Le responsable déclare ses agents avec `boite bureau-role agent --service <nom> --thread <id>`.
- Vérifications de `--chef` : le fil et le chef existent (`threads.list`), le fil n'est pas son propre chef, et le rattachement ne ferme pas de boucle (le chef ne peut pas être sous un de ses descendants). Sinon code 1 avec un message qui dit quoi faire. `--chef` avec un rôle autre que manager : code 2.
- Le lien est gardé dans le registre (`chefId`). Une déclaration suivante du même fil, toujours manager, le garde ; un autre rôle l'efface.

## Format de plan.json
```json
{
  "title": "Refonte de l'espace client",
  "summary": "Ce que l'utilisateur veut, en 2 à 4 lignes.",
  "budget": { "maxAgents": 8, "models": ["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"] },
  "lots": [
    { "id": "L1", "title": "Webhook invoice.paid et ses tests", "service": "Développement", "model": "claude/claude-sonnet-5-5" },
    { "id": "L2", "title": "Relecture sécurité", "service": "Qualité", "model": "claude/claude-opus-5-5" }
  ]
}
```
`id` de lot : unique dans le plan, 1 à 20 caractères `[A-Za-z0-9_-]`. `lots` : 1 à 40. `maxAgents` facultatif.

## Validation d'un plan
- Dans la vue : bouton « Valider le plan » -> le service marque `validated` (`validatedVia: bureau`) et envoie au fil du chef, par `turns.start` : « Le plan <id> a été validé dans Bureau. Lance les lots. » Si le chef est occupé, le service réessaie quand le fil repasse au repos (événement `thread.updated`).
- Dans le chat : l'utilisateur approuve (« valide ») au chef, qui lance `boite bureau-plan valider <id> --chat`.
- Le chef ne valide jamais son plan de lui-même.

## Registre (`registre.json`)
```json
{
  "version": 1,
  "roles": { "<threadId>": { "role": "manager", "service": "Développement", "files": [], "at": 0, "chefId": "<threadId du chef, facultatif>" } },
  "missions": { "<missionId>": { "...": "Mission de src/model.ts" } },
  "reports": { "<threadId>": { "text": "...", "at": 0 } },
  "pendingNotices": [ { "threadId": "...", "prompt": "...", "at": 0 } ]
}
```
Écriture atomique (fichier temporaire puis renommage) sous verrou `registre.lock` (création exclusive, attente 5 s max, verrou de plus de 30 s considéré abandonné). Le service relit le fichier quand il change.

## Arbre de l'équipe
Le fil au-dessus de chaque fil est son `parentThreadId` (s'il est visible), sauf pour un fil avec un lien `chefId` : il se place sous ce chef comme s'il en était l'enfant, et ses propres sous-agents (`parentThreadId` = le responsable) se placent sous lui. Le chef, le responsable et l'agent appartiennent alors à la même équipe, de racine le chef : `bureau-mission` montre la même équipe depuis chacun.

Un lien est ignoré (le fil reste racine de sa propre équipe) quand le chef n'existe plus, est archivé, est le fil lui-même, ou quand il fermerait une boucle. Si deux liens se contredisent, le plus ancien (`at`) reste.

## Rôle deviné (sans `bureau-role`)
Racine = chef ; profondeur 1 = manager si elle a des enfants, sinon agent ; profondeur 2 et plus = agent. Service deviné : celui déclaré du manager parent, sinon null. Un fil rattaché par `--chef` est toujours manager (même si une ligne de rôle contraire traîne dans le registre), et ses agents sont des agents devinés qui héritent de son service.

## État d'un personnage (depuis `ThreadSummary`)
- `status: running` -> running ; `queued` -> queued ; `error` -> error.
- `status: waiting` -> waiting (`waitingFor: permission`) ; `openQuestions > 0` -> waiting (`waitingFor: question`), prioritaire sur running.
- `idle` : racine -> idle ; enfant (a un `parentThreadId`) -> done.
- `idle` d'un responsable rattaché par `--chef` (donc sans `parentThreadId`) : done seulement s'il a déposé son rapport (`bureau-rapport`) ou si une mission de son chef est `done` ; sinon idle. Raison : entre deux résultats de ses agents il est au repos sans avoir fini, un `idle` seul ne dit pas « terminé ». S'il retravaille (running, queued, waiting, error), l'état courant prime.
- Fils archivés, équipes (`teamId`), salons (`councilId`) et incognito : ignorés.

## Archivage (`src/archive.ts`)
Règles (`decideArchive`, pur) : archivé si au repos (`idle` ou `done`), non épinglé (`pinned`), pas chef d'une mission `proposed` ou `validated`, pas visé par un message de Bureau en attente, aucun fil en dessous en cours, en file ou en attente, et dernière activité (changement du fil, son rapport, ou celle d'un fil en dessous) plus vieille que le délai. Délai `delaiHeures` pour une équipe Bureau (une mission ou un rôle déclaré), `delaiEtenduHeures` pour les autres fils, qui ne comptent que si `etendu` est vrai. Jamais touchés : fils archivés, chats d'équipe, salons, incognito.

`reglages.json` : `{ "version": 1, "archivage": { "auto": true, "delaiHeures": 6, "etendu": false, "delaiEtenduHeures": 48 } }`, relu à chaque passage. `archivage.jsonl` : une ligne JSON par tentative `{ at, threadId, title, reason, rule, mode, ok, error? }`. Le service fait un passage toutes les 10 minutes (si `auto`), l'état de la vue porte `archives` (dernières 24 h).

Archivage officiel : `threads.archive` avec `onlyIfIdle`, jamais `threads.remove`. Ouvert aux plugins sous `threads.write` depuis Boite 2.0.0-nightly.20261111.1 (archivage seul, jamais un fil épinglé) : `CORE_ARCHIVE_OPEN = true`. Un refus de Boite est journalisé (`ok: false`) et le fil n'est pas retenté avant le redémarrage du service.

## Slash commands
- `/bureau` : « Lance `boite bureau`, puis `boite browse` sur l'adresse affichée, sans autre commentaire. »
- `/mission <demande>` : « Tu es le chef de projet de cette mission. Lis le skill bureau-chef et suis-le à la lettre. Demande : »

## Skills
`bureau-chef`, `bureau-manager`, `bureau-agent` : sources dans `skills/<nom>.md`, copiées dans le manifeste par `bun run pack`.
