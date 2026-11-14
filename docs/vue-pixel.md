# Vue pixel : contrat d'architecture

La vue 2D pixel art remplace la vue isométrique à l'affichage. La vue isométrique (`web/immeuble/`, `docs/vue-immeuble.md`) est en pause : son code reste, personne ne le modifie. Ce document fixe les données des discussions entre agents (section 1) et le découpage de la nouvelle vue en modules (section 2, écrite une fois le mélange choisi par Nicolas). Il fait foi entre les lots : un changement d'interface se décide ici d'abord.

Mission m-ny8cm (remplace m-6drdu), branche `feat/vue-pixel`. Brief de référence : `.maquettes/2026-11-10-vue-pixel/BRIEF-COMMUN.md`.

## 1. Données des discussions

Une discussion est une scène où deux personnages (parfois trois) se rejoignent et se parlent à tour de rôle. Elle naît d'un événement réel du travail (délégation, rapport, blocage...) ou d'une pause (papotage). Le texte vient d'un catalogue de répliques par défaut en français, nourries de ce que Bureau sait : titres, lots, rapports, états, modèles, durées. Bureau ne lit le contenu d'aucune conversation et ne demande rien de plus à Boite.

### 1.1 Ce que le service sait déjà

**Fils Boite** (`threads.list`, puis les événements `thread.created`, `thread.updated`, `thread.removed` ; type `ThreadRow` de `src/core-types.ts`) :

| Champ | Sens | Exposé dans `OfficeAgent` |
|---|---|---|
| `id`, `title` | identité et nom du fil | `id`, `title` |
| `projectId` | projet Boite, donc l'étage | `Team.projectId` (celui de la racine) |
| `providerId`, `model` | `claude`, `codex`, `opencode` ; id du modèle, ou null | `provider`, `model` |
| `status` | `idle`, `queued`, `running`, `waiting`, `error` | `state` (avec `openQuestions` et le lien chef) |
| `openQuestions` | questions posées sans arrêter le tour, en attente de l'utilisateur | `state: waiting`, `waitingFor: question` |
| `runningSince`, `requestSince` | début du tour ou de la demande en cours | `since` (null au repos) |
| `parentThreadId` | le fil qui a délégué à celui-ci | `parentId` |
| `createdAt`, `updatedAt` | création, dernier changement | `createdAt`, `updatedAt` |
| `archived`, `teamId`, `councilId`, `incognito` | fils hors bureau, écartés | aucun |
| `pinned` | épinglé par l'utilisateur | aucun |

**Registre Bureau** (`registre.json`, `src/registry.ts`) :

| Donnée | Contenu | Où dans l'état |
|---|---|---|
| `roles[threadId]` | `role`, `service`, `files`, `at`, `chefId` (lien d'un manager démarré avec `boite thread new`) | `role`, `roleSource`, `service`, `files`, `parentId` ; `at` n'est pas exposé |
| `missions[id]` | titre, résumé, budget, `status` (`proposed`, `validated`, `done`), `createdAt`, `validatedAt`, `validatedVia`, lots | `Team.mission` (la plus récente dont le chef est dans l'arbre) |
| `Lot` | `id`, `title`, `service`, `model` prévu (`claude/claude-sonnet-5-5`), `agentId`, `state` (`todo`, `running`, `done`) | `Mission.lots`, sans aucune date |
| `reports[threadId]` | `text` (64 Ko au plus) et `at` ; un seul rapport par fil, le dernier remplace le précédent | `OfficeAgent.report` |
| `pendingNotices` | messages en attente pour un chef occupé | interne |

**Journal d'archivage** : `ArchiveNote { threadId, title, reason, at }` sur le dernier jour, dans `OfficeState.archives`.

**Déduit par le service** (`src/state.ts`) : le rôle (déclaré, sinon par la profondeur dans l'arbre), l'équipe (un arbre de délégation), l'état d'un manager rattaché (`done` après son rapport, voir `hasReportedBack`), les compteurs.

**Dates disponibles** : `createdAt` et `updatedAt` d'un fil, `since` de la demande en cours, `report.at`, `mission.createdAt` et `validatedAt`, `archive.at`. Aucune date pour un changement d'état de lot, ni pour le début d'un état au repos.

### 1.2 Ce que le service ne sait pas

1. Le contenu des conversations : personne ne sait ce que se disent réellement deux agents. Les répliques sont donc des textes par défaut, jamais des citations.
2. Qui parle à qui : `boite delegate send` et `boite threads send` ne passent pas par Bureau. Un blocage signalé par un agent à son manager n'est visible que si le fil passe en `error`. Les liens connus sont `parentId` (délégation) et le lien chef.
3. L'historique : l'état est un instantané. Une transition (`running` vers `done`) n'est connue que par comparaison de deux instantanés.
4. Le nom de l'utilisateur : les textes disent « l'utilisateur » ou « toi », jamais un prénom.
5. Le lien lot et agent hors `bureau-plan lot ... --agent` : sans lui, un agent n'a pas de lot (`{lot}` vaut null).

### 1.3 Décision : les événements naissent dans le service

**Choix : le service dérive les événements en comparant deux états consécutifs, et les publie dans `OfficeState.events`** (typé, section 1.4). La vue ne compare plus que ce qu'elle compare déjà (étages et personnages à créer ou retirer, postures).

Pourquoi le service plutôt que la vue :

1. **Granularité.** Le service reçoit chaque événement Boite et peut comparer à chaque changement. La vue ne reçoit qu'un instantané toutes les 250 ms au plus (`debounceMs`) : un fil qui passe `running`, `error`, `running` dans cet intervalle, ou un rapport suivi d'un repos immédiat, serait perdu ou confondu.
2. **Une seule vérité.** Plusieurs pages ouvertes, ou une page rechargée, voient la même histoire, avec les mêmes identifiants. Avec une comparaison dans la page, chaque onglet inventerait la sienne, et un rechargement perdrait l'événement en cours.
3. **Dates exactes.** `at` est l'heure où le service a vu le changement, pas l'heure de réception dans la page (un onglet en arrière-plan reçoit tard).
4. **Testable sans navigateur.** `deriveEvents` est une fonction pure, testée avec `bun test` comme `buildState`. Les règles (rapport suivi de `done`, anti-rebond, déplacement d'un agent entre équipes) sont subtiles : les tester dans une page est fragile.
5. **Les données sont déjà là.** Le registre (rapports, lots, missions) est lu par le service ; la page n'y a accès qu'à travers l'état.
6. **Coût faible.** Au plus 40 événements, environ 10 Ko, dans un état d'environ 25 Ko pour 40 agents.

Ce que ça coûte : un champ de plus dans le contrat, un fichier `src/events.ts`, quelques lignes dans `src/service.ts`. Le lot L1 du plan est déjà « Service : événements de discussion dans OfficeState, avec tests ». Dépendance : le lot Discussions (L5) travaille en parallèle de L1 sur les types de 1.4 et des événements factices ; L1 n'est requis que pour l'intégration.

**Principe de robustesse** : les événements ne portent que les discussions. L'état (`OfficeAgent.state`) reste la source de vérité des postures et des déplacements. Si un événement est perdu (page fermée, retard), la scène reste juste, il manque une discussion. La vue ne dépend d'aucun événement pour placer un personnage.

**Ce qui naît dans la vue** : le papotage (deux personnages en pause au même endroit, aucun événement du service), la mise en scène de chaque discussion (trajets, tours de parole, durée des bulles), et le choix de la réplique dans le catalogue.

### 1.4 Ajouts à `src/model.ts`

À ajouter tels quels (commentaires en anglais, comme le reste du fichier).

```ts
/** What happened in the office, for the conversations the view plays. */
export type OfficeEventKind = 'arrive' | 'depart' | 'delegate' | 'report' | 'blocked' | 'waiting' | 'answered' | 'plan';

export interface OfficeEventBase {
  /**
   * Unique, `<epoch ms>-<n>`. The view plays an id once and keeps the ids it has seen.
   * Ids are not ordered across service runs, `at` is.
   */
  id: string;
  /** Epoch ms the service saw the change. */
  at: number;
  /** The team the event belongs to (`Team.id`): the view finds the floor from it. */
  teamId: string;
  /** The thread the event is about: the worker, the newcomer, the leaver, the chef of a plan. */
  agentId: string;
  /** Its title at that moment: a thread that left is no longer in `teams`. */
  title: string;
}

export type OfficeEvent = OfficeEventBase &
  (
    /** A thread appeared in the office. `parentId`: the thread above it, null for a root. */
    | { kind: 'arrive'; parentId: string | null }
    /** A thread left the office: archived by Bureau, or gone from the live list (deleted, archived elsewhere, team out of the day). */
    | { kind: 'depart'; reason: 'archived' | 'gone' }
    /** `fromId` hands work to `agentId`. `lotId`: the mission lot, when one was attached at that time. */
    | { kind: 'delegate'; fromId: string; lotId: string | null }
    /** `agentId` handed its work back. `hasReport`: it filed a report (`boite bureau-rapport`). `toId`: who receives it, null for a root. */
    | { kind: 'report'; toId: string | null; lotId: string | null; hasReport: boolean }
    /** `agentId` went to `error`. `toId`: the thread above it, null for a root. */
    | { kind: 'blocked'; toId: string | null }
    /** `agentId` waits for the user. */
    | { kind: 'waiting'; waitingFor: 'permission' | 'question' }
    /** `agentId` stopped waiting: the user answered. */
    | { kind: 'answered' }
    /** A mission changed phase; `agentId` is its chef. */
    | { kind: 'plan'; phase: 'proposed' | 'validated' | 'done'; missionId: string }
  );

// OfficeState
  /**
   * Recent events, oldest first: the last two minutes, 40 at most. Empty right after the service connects:
   * it never replays the past.
   */
  events: OfficeEvent[];
```

`OfficeState.events` est obligatoire : `src/state.ts` (`StateInput.events?`, vide par défaut), `test/helpers.ts` et tout test qui construit un `OfficeState` à la main sont à mettre à jour.

### 1.5 Règles de dérivation

`deriveEvents(prev, next, log, now)` compare, par id de fil sur toutes les équipes (un agent qui change d'équipe n'arrive pas et ne part pas), l'état précédent `prev` et le nouveau `next`. `prev` null (premier état, reconnexion à Boite) : aucun événement, `next` devient la référence.

| Genre | Déclencheur | `agentId` | Anti-doublon |
|---|---|---|---|
| `arrive` | un id présent dans `next`, absent de `prev` | le nouveau | aucun |
| `depart` | un id présent dans `prev`, absent de `next` ; `reason: archived` si `next.archives` le cite, sinon `gone` | le partant | aucun |
| `delegate` | (a) arrivée d'un agent qui a un `parentId` ; (b) un lot passe en `running` ou reçoit un `agentId` pour un agent déjà présent | l'agent qui reçoit (`fromId` : son `parentId`) | un seul `delegate` par agent et par fenêtre de 2 minutes : le cas (b) est ignoré si le cas (a) l'a déjà émis (`log`) |
| `report` | (a) `report.at` d'un agent augmente ; (b) l'agent passe en `done` sans `report` nouveau dans `log` | l'agent qui rend | un seul `report` par agent et par fenêtre de 2 minutes : le rapport déposé juste avant la fin du tour (a) supprime le (b) |
| `blocked` | l'état devient `error` | l'agent en erreur | 30 s par agent |
| `waiting` | l'état devient `waiting` (`waitingFor` de l'agent) | l'agent qui attend | 30 s par agent |
| `answered` | l'état quitte `waiting` pour autre chose que `error` | l'agent qui reprend | seulement si un `waiting` du même agent est dans `log` ou `prev` |
| `plan` | pour une mission `M` de `next` : `proposed` quand elle apparaît en `proposed` ; `validated` quand elle passe à `validated` (ou apparaît déjà validée) ; `done` quand elle passe à `done` | le chef (`mission.chefId`) | une fois par phase et par mission |

Détails :
- Les événements d'un même passage sont rangés par ordre de genre : `arrive`, `delegate`, `plan`, `waiting`, `blocked`, `report`, `answered`, `depart`.
- `id` : `${now}-${k}`, `k` compté dans le passage ; on augmente `k` tant que l'id est déjà dans `log`.
- `log` en sortie : l'ancien journal élagué (plus vieux que `EVENT_WINDOW_MS`, au plus `EVENT_MAX` les plus récents) puis les nouveaux.
- Un agent qui n'a pas de manager (racine) produit quand même `report`, `blocked`, `waiting` avec `toId: null`.
- Choix de L1 là où le tableau ne tranche pas : un agent absent de `prev` ne produit ni `report`, ni `blocked`, ni `waiting` (seulement `arrive`) ; un `delegate` sans `parentId` est ignoré ; une mission déjà `done` à son apparition ne produit pas de `plan` ; le journal est plafonné à `EVENT_MAX` (40) après ajout des nouveaux ; `answered` est émis dès que `prev` a l'agent en `waiting` et `next` ne l'a ni en `waiting` ni en `error`.

### 1.6 Branchement dans le service

Fichiers (pour le lot L1) :

```ts
// src/events.ts (nouveau, pur)
export const EVENT_WINDOW_MS = 2 * 60 * 1000;
export const EVENT_MAX = 40;
/** The new log: `log` pruned, then the events `prev` to `next` produced. A null `prev` produces none. */
export function deriveEvents(prev: OfficeState | null, next: OfficeState, log: readonly OfficeEvent[], now: number): OfficeEvent[];
/** The events the page needs: the log pruned to the window and the cap. */
export function recentEvents(log: readonly OfficeEvent[], now: number): OfficeEvent[];
```

`src/state.ts` : `StateInput.events?: OfficeEvent[]`, recopié dans `OfficeState.events` (`[]` par défaut).

`src/service.ts` :
- deux variables : `baseline: OfficeState | null` et `eventLog: OfficeEvent[]` ;
- `advance()` : si `loading` ou si le core n'est pas `connected`, ne fait rien ; sinon construit un état (`live: true`, `events: []`), fait `eventLog = deriveEvents(baseline, next, eventLog, Date.now())`, puis `baseline = next` ;
- `advance` est appelé, regroupé dans un seul passage par tour de boucle d'événements (`queueMicrotask`), depuis `applyEvent` (après l'application), `reloadRegistry` (quand le texte a changé), et la fin d'un passage d'archivage qui a archivé ;
- fin de `loadAll` et perte de connexion : `baseline = null` (la référence est refaite sans rien émettre, pour qu'une reconnexion ne produise ni départs ni arrivées en rafale) ;
- `snapshot()` : `buildState({ ..., events: recentEvents(eventLog, Date.now()) })`.

Tests (`test/events.test.ts`, nouveau) : un cas par genre ; `prev` null ; reconnexion ; anti-doublon `delegate` (arrivée puis lot) ; `report` (déposé puis `done`, `done` seul) ; anti-rebond de `waiting` et `blocked` ; agent qui change d'équipe ; mission `proposed` puis `validated` puis `done` ; élagage et plafond ; unicité des ids ; taille JSON de 40 événements sous 15 Ko. `scripts/demo.ts` doit produire chaque genre au moins une fois (délégation, rapport, erreur, attente, plan validé, arrivée du « Portail partenaires », archivage).

### 1.7 Lecture côté vue

- Au premier état reçu, la vue marque tous les ids de `events` comme vus et ne joue rien. Ensuite elle joue chaque id inconnu dont `at` a moins de 30 s (un onglet resté en arrière-plan ne rejoue pas dix minutes d'histoire). La vue garde les 200 derniers ids vus.
- Le texte est choisi au moment de jouer, pas à la réception : les variables sont lues dans l'état courant. C'est voulu : `bureau-role --files` et `bureau-plan lot` arrivent quelques secondes après l'arrivée de l'agent, et le manager n'a fini de marcher jusqu'au bureau qu'après. Pour un partant (plus dans `teams`), la vue lit la dernière `OfficeAgent` qu'elle a gardée du personnage.
- Choix d'une réplique : parmi les répliques du genre dont la condition `si` est vraie et dont toutes les variables ont une valeur ; tirage fixé par l'id de l'événement (deux pages tirent la même) ; jamais la même réplique que l'une des 8 dernières jouées. Chaque genre a des répliques sans variable, jouées quand rien d'autre ne convient.
- Une discussion dure au plus 3 bulles. Au plus 4 discussions en même temps dans la vue, 8 en attente ; au-delà, les plus anciennes sont abandonnées (la posture de l'état suffit).
- Sans interlocuteur (`toId` null, personne dans la pièce), seule la réplique `a` est jouée.
- Rythme proposé (le lot Discussions peut l'ajuster) : texte écrit à 30 caractères par seconde, bulle gardée 1,8 s plus 40 ms par caractère. Avec `prefers-reduced-motion`, le texte apparaît d'un coup.

### 1.8 Variables

Les textes utilisent `{nom}`. **Événements** : les noms sont absolus (`{agent}` est toujours l'agent de l'événement). **Papotage** : les noms sont relatifs à celui qui parle (`_moi`, `_toi`).

Une variable sans valeur exclut la réplique (voir 1.7). Trois variables ont toujours une valeur : `{agent}`, `{toi}`, `{heure}`.

| Variable | Valeur | Max | Absente quand |
|---|---|---|---|
| `{agent}` | titre du fil de l'événement (`event.title`) | 20 | jamais |
| `{manager}` | le fil au-dessus de `{agent}` : « le manager Design » (manager avec service), « mon manager » (sans service), « le chef » | 26 | pas de fil au-dessus |
| `{service}` | `service` de l'agent de l'événement ; dans une réunion de plan, celui du manager qui parle | 14 | service inconnu |
| `{lot}` | titre du lot dont `agentId` est l'agent (`lotId` de l'événement, sinon recherche par `agentId`) | 28 | pas de lot |
| `{lotid}` | id du même lot, par exemple « L1 » | 6 | pas de lot |
| `{modele}` | modèle de l'agent, abrégé : `claude-sonnet-5-5` donne « Sonnet 5.5 », `big-pickle` reste tel quel ; à défaut, celui que le lot prévoit | 14 | modèle inconnu |
| `{duree}` | `report` : de `createdAt` à `report.at` (sinon à `at`) ; autres genres : de `since` à maintenant ; formes « 45 s », « 12 min », « 2 h 05 » | 8 | pas de date |
| `{fichiers}` | premier fichier de `files` (nom du dossier ou du fichier, sans le début du chemin si plus long que le maximum) | 24 | `files` vide |
| `{rapport}` | première phrase du rapport (jusqu'à `. ` ou une fin de ligne), sans marques markdown | 34 | pas de rapport |
| `{attente}` | `waitingFor` : « une permission » ou « une réponse » | 14 | pas en attente |
| `{projet}` | `Team.projectName` | 20 | équipe sans projet |
| `{mission}` | titre de la mission | 26 | pas de mission |
| `{nlots}` | nombre de lots de la mission | 2 | pas de mission |
| `{heure}` | heure locale, « 14 h 20 » | 7 | jamais |

Papotage, relatives à celui qui parle (`moi`) et à son interlocuteur (`toi`) : `{toi}` (titre, 20), `{lot_moi}` et `{lot_toi}` (28), `{modele_moi}` et `{modele_toi}` (14), `{duree_moi}` et `{duree_toi}` (8, de `since` à maintenant), `{service_toi}` (14), `{projet}` (20), `{heure}` (7).

**Nettoyage de toute valeur** (`motSur`) : les textes viennent des utilisateurs (titres de fils, rapports) et peuvent contenir n'importe quoi. Avant insertion : espaces réduits à un ; le tiret cadratin et le demi-cadratin (U+2014, U+2013) remplacés par `-` ; `’` par `'` ; `«` et `»` supprimés ; `œ` par `oe`, `ë` par `e`, `ü` par `u` ; tout caractère hors du jeu de la police supprimé (emoji compris). Puis coupe au maximum de la variable : à la dernière espace avant la limite si elle laisse au moins 8 caractères, sinon coupe nette ; les `, : ; ( ' -` de fin sont retirés ; pas de points de suspension.

### 1.9 Règles des textes

- Moins de 60 caractères par bulle une fois les variables insérées : chaque réplique du catalogue, avec chaque variable à son maximum, fait **59 caractères au plus**. Le test du lot Discussions le calcule (voir 1.12).
- Jeu de caractères de la police bitmap : `A-Z a-z 0-9`, `é è ê à â ç ô û ù î ï É È À Ç` (le `Ç` s'ajoute à la liste du brief commun : « Ça » ouvre plusieurs répliques) et la ponctuation `. , : ; ! ? ' ( ) / + - %`. La police dessine en plus `« » ’ œ Œ ë ü` (décision du chef), pour afficher les titres des utilisateurs ; le catalogue reste dans le jeu ci-dessus, et le nettoyage de 1.8 peut garder ces caractères. Jamais de points de suspension.
- Pas de tiret cadratin ni demi-cadratin, pas d'emoji. Un trait d'union dans un mot composé est permis.
- Les agents n'ont pas de genre : pas de participe passé qui s'accorde (« bloqué », « prêt », « ravi »). On écrit « ça bloque », « je n'avance plus ».
- Pas de prénom d'utilisateur. Le nom des boutons de l'interface (« Valider le plan ») est permis.
- `a` : celui qui ouvre ; `b` : celui qui répond ; `c` : un second répondant éventuel (réunion). Une cellule vide : rien à dire. `si` : condition (`*` : toujours).

### 1.10 Catalogue des répliques par événement

**Délégation** (`a` : celui qui délègue, `b` : l'agent qui reçoit)

| id | si | a | b |
|---|---|---|---|
| d01 | * | Le lot {lotid} est pour toi : {lot}. | Reçu, je lis le fichier d'échange. |
| d02 | * | Ton lot : {lot}. Bonne chance. | Merci, je commence tout de suite. |
| d03 | * | Tu touches à {fichiers}, rien d'autre. | Compris, seulement {fichiers}. |
| d04 | * | Je te confie {lot}, sans stress. | Merci, je te fais un rapport propre. |
| d05 | * | Nouveau lot {lotid}, tu tournes sur {modele}. | Parfait, {modele} suffit pour ça. |
| d06 | * | {agent}, j'ai une tâche pour toi. | Je t'écoute, je lève les yeux. |
| d07 | * | Dis-moi vite si tu bloques. | Promis, je te préviens. |
| d08 | * | Je te donne {lotid} sur {projet}. | Reçu, je m'installe et j'attaque. |
| d09 | * | L'équipe {service} compte sur toi. | Je ne vous décevrai pas. |
| d10 | * | On a un nouveau lot à lancer. | Je suis sur le coup. |

**Rapport** (`a` : l'agent qui rend, `b` : celui qui reçoit)

| id | si | a | b |
|---|---|---|---|
| r01 | * | Rapport : {rapport} | Bien, je relis ça tout de suite. |
| r02 | * | J'ai fini {lot} en {duree}. | Super, pose le dossier ici. |
| r03 | * | Lot {lotid} rendu, tout est vérifié. | Merci, je relis le diff ligne à ligne. |
| r04 | * | Voilà mon rapport, {duree} de travail. | Parfait, je vérifie de mon côté. |
| r05 | * | C'est fait, tout est dans {fichiers}. | Je regarde ça, beau travail. |
| r06 | * | Terminé, il reste peu de choses. | Note-les dans le rapport, merci. |
| r07 | * | Mon rapport est prêt. | Je le lis et je valide le lot. |
| r08 | * | Résultat : {rapport} | Merci, je marque {lotid} comme fini. |

**Blocage** (`a` : l'agent en erreur, `b` : celui qui vient voir)

| id | si | a | b |
|---|---|---|---|
| b01 | * | Ça plante, je n'avance plus ! | Je viens voir ton écran. |
| b02 | * | Erreur sur {lot}, à l'aide ! | J'arrive, ne touche à rien. |
| b03 | * | Ça bloque depuis {duree}. | Montre-moi l'erreur, on regarde. |
| b04 | * | Mon tour s'est arrêté sur une erreur. | Relance-le, je reste à côté. |
| b05 | * | J'ai cassé quelque chose dans {fichiers}. | On regarde ça ensemble. |
| b06 | * | Rouge partout, {manager}, tu peux venir ? | Je suis là, respire un coup. |
| b07 | * | Je ne comprends pas cette erreur. | Moi non plus, voyons ça. |
| b08 | * | {modele} cale sur ce problème. | On essaie autre chose, viens. |

**Attente de l'utilisateur** (`a` seul : l'agent parle au spectateur ; `si` : `permission` ou `question`)

| id | si | a | b |
|---|---|---|---|
| w01 | * | J'attends ta réponse depuis {duree}. | |
| w02 | permission | Je demande la permission de continuer. | |
| w03 | question | Une question pour toi sur {lot}. | |
| w04 | * | Je n'avance plus sans ta réponse. | |
| w05 | permission | Une autorisation et je repars. | |
| w06 | * | Eh, ça fait {duree} que je lève la main ! | |
| w07 | question | Peux-tu répondre à ma question ? | |
| w08 | * | Quelqu'un peut me débloquer ? | |
| w09 | permission | Cette commande a besoin de ton accord. | |

**Plan** (`a` : le chef, `b` et `c` : deux managers ; `si` : `validated`, `proposed` ou `done`)

| id | si | a | b | c |
|---|---|---|---|---|
| p01 | validated | Le plan est validé, on y va ! | Je lance mes agents. | Mes briefs sont prêts. |
| p02 | validated | {nlots} lots à lancer pour {mission}. | Je prends les miens, chef. | Moi aussi, je m'organise. |
| p03 | validated | Le plan est validé, vous pouvez lancer. | Parfait, je découpe mon lot. | Je prépare les fichiers. |
| p04 | validated | Réunion courte : qui prend quoi ? | {service}, ça me va. | Je m'occupe du reste. |
| p05 | validated | Plan validé sur {projet}, au travail ! | Compris, chef. | On s'y met. |
| p06 | validated | C'est parti pour {mission}. | Mes agents arrivent, chef. | Je démarre dans la minute. |
| p07 | validated | Respectez le budget, un agent par lot. | Compris, un agent par lot. | Reçu, pas de dépassement. |
| p08 | validated | On valide, on lance, on rapporte. | Dans cet ordre, chef. | Je prépare mes rapports. |
| q01 | proposed | Le plan attend ta validation. | | |
| q02 | proposed | {nlots} lots prévus, à toi de valider. | | |
| q03 | proposed | Je ne lance rien sans ton feu vert. | | |
| q04 | proposed | Plan prêt : {mission}. | | |
| q05 | proposed | Un clic sur Valider le plan et on démarre. | | |
| q06 | proposed | Voici le plan, dis-moi s'il te convient. | | |
| f01 | done | Mission terminée, bravo à tous ! | Beau travail, chef. | On a tenu le plan. |
| f02 | done | {mission} est livrée. | On a tenu le plan. | Quelle équipe ! |
| f03 | done | Les {nlots} lots sont rendus. | Tout est vérifié de notre côté. | Plus qu'à fêter ça. |
| f04 | done | Fin de mission, un café pour tous ? | Je prends un double. | Je paie ma tournée. |
| f05 | done | Merci pour le travail sur {projet}. | Avec plaisir, chef. | À la prochaine mission. |
| f06 | done | Tout est livré, je rends compte. | Merci, chef. | On souffle un peu. |

**Arrivée** (`a` : le nouveau, `b` : quelqu'un de présent, de préférence son manager)

| id | si | a | b |
|---|---|---|---|
| v01 | * | Bonjour, je suis {agent}. | Bienvenue, installe-toi. |
| v02 | * | Me voilà, l'ascenseur est lent. | Ton bureau est au fond. |
| v03 | * | Je rejoins l'équipe {service}. | Bienvenue dans l'équipe. |
| v04 | * | Salut, quel est mon bureau ? | Le premier libre, en face. |
| v05 | * | Je démarre sur {projet} aujourd'hui. | Bon courage, ça bouge ici. |
| v06 | * | Me voilà, je prends mes quartiers. | Le café est au fond du couloir. |
| v07 | * | {agent} au rapport, on commence ? | Pose tes affaires, on y va. |
| v08 | * | Quelqu'un m'a demandé ? | Oui, {manager} te cherche. |

**Départ** (`a` : celui qui part, `b` : un collègue ; `si` : `archived` ou `gone`)

| id | si | a | b |
|---|---|---|---|
| x01 | * | Ma journée est finie, bonne soirée. | Merci pour tout, à bientôt. |
| x02 | * | Je rends mon badge et je file. | Bon retour, prends l'ascenseur. |
| x03 | * | Plus rien à faire ici, je pars. | Merci pour {lot}, c'était propre. |
| x04 | archived | Mon fil est archivé, au revoir. | Salut, ton bureau reste au chaud. |
| x05 | gone | On m'a retiré de la liste, salut ! | Déjà ? À la prochaine. |
| x06 | * | Je sors par la grande porte. | À la prochaine ! |
| x07 | * | J'ai donné tout ce que j'avais. | Merci, tu as bien travaillé. |
| x08 | archived | On m'envoie aux archives, à plus ! | Repose-toi bien. |
| x09 | gone | Mon fil a disparu, je m'en vais. | Étrange, mais bon voyage. |

**Réponse reçue** (`a` seul : l'agent qui attendait reprend)

| id | si | a | b |
|---|---|---|---|
| n01 | * | Merci, je reprends mon travail. | |
| n02 | * | Réponse reçue, ça repart. | |
| n03 | * | Parfait, je continue sur {lot}. | |
| n04 | * | Compris, je termine ça. | |
| n05 | * | Super, plus qu'à taper. | |
| n06 | * | Merci, j'avais besoin de ça. | |

### 1.11 Papotage

Le papotage ne vient d'aucun événement : la vue le déclenche quand deux personnages au repos se trouvent au même endroit de pause (machine à café, fenêtre, garde-corps de l'entrée, canapé). Celui qui arrive le premier ouvre (`a`), l'autre répond (`b`). `si` de l'ouverture : l'état de l'interlocuteur (`running`, `waiting`, `error`, `done`, `queued`, `idle`) ; `si` de la réponse : l'état de celui qui répond. Les variables sont relatives à celui qui parle (1.8).

**Ouvertures (30)**

| id | si | a |
|---|---|---|
| c01 | * | Ça fait du bien, cette pause. |
| c02 | * | Déjà {heure} ? Le temps file. |
| c03 | * | Le café de la machine est toujours aussi fort. |
| c04 | * | Sur {projet}, ça avance bien, non ? |
| c05 | * | Tu bosses sur quoi en ce moment ? |
| c06 | * | De mon côté, je suis sur {lot_moi}. |
| c07 | * | Moi, je tourne sur {modele_moi}. Et toi ? |
| c08 | * | Cette plante a l'air d'avoir soif. |
| c09 | * | Regarde par la fenêtre, la ville bouge. |
| c10 | * | La fontaine à eau, c'est une bonne invention. |
| c11 | * | L'imprimante bloque encore, je crois. |
| c12 | * | Je m'étire cinq minutes et je repars. |
| c13 | * | L'ascenseur met une éternité, non ? |
| c14 | * | J'ai déjà {duree_moi} sur ma tâche. |
| c15 | running | Alors, {lot_toi} avance bien ? |
| c16 | running | Tu tapes depuis {duree_toi}, fais une pause. |
| c17 | waiting | Tu attends toujours une réponse ? |
| c18 | waiting | Ça fait {duree_toi} que tu attends, non ? |
| c19 | error | Ton erreur, tu l'as réglée ? |
| c20 | error | Courage, ça arrive à tout le monde. |
| c21 | done | Bravo pour ton rapport, {toi}. |
| c22 | done | Tu as fini ? Tu as de la chance ! |
| c23 | queued | Tu es en file, ton tour arrive. |
| c24 | idle | Tu es en pause, toi aussi ? |
| c25 | * | {service_toi}, ça se passe comment ? |
| c26 | * | Tu tournes sous {modele_toi}, c'est agréable ? |
| c27 | * | Ça te dirait un autre café ? |
| c28 | * | Tu as lu le dernier rapport ? |
| c29 | * | On se retrouve au tableau blanc plus tard ? |
| c30 | * | Un jour, on aura un balcon plus grand. |

**Réponses**

| id | si | b |
|---|---|---|
| y01 | * | Ha oui, tu as raison. |
| y02 | * | Ça me fait sourire. |
| y03 | * | Exactement ce que je pensais. |
| y04 | * | Belle journée, en tout cas. |
| y05 | * | Allez, on s'y remet bientôt ! |
| y06 | * | Possible, je n'y avais pas pensé. |
| y07 | running | Oui, ça tape bien, merci. |
| y08 | running | Dans le dur, mais ça passe. |
| y09 | waiting | J'attends une réponse, rien d'autre. |
| y10 | waiting | Toujours rien, je patiente. |
| y11 | error | Une erreur têtue, mais je m'accroche. |
| y12 | error | Merci, je vais y arriver. |
| y13 | done | Oui, rapport rendu, je souffle. |
| y14 | done | Tout est livré, je me repose. |
| y15 | idle | Je recharge, comme toi. |
| y16 | queued | Mon tour arrive, j'ai hâte. |
| y17 | * | On en reparle autour d'un café. |

### 1.12 Vérification du catalogue

Le catalogue vit dans un seul fichier, `web/pixel/dialogues.js` (voir section 2), sous la forme de listes `{ id, si, a, b, c }` par genre. Un test `test/dialogues.test.ts` (propriétaire : le lot Discussions) lit ce fichier et vérifie :

1. longueur : avec chaque variable remplacée par une chaîne de sa longueur maximale (1.8), chaque réplique fait au plus 59 caractères ;
2. jeu de caractères : rien hors du jeu de la police (1.9), donc ni U+2014, ni U+2013, ni emoji ;
3. chaque variable utilisée existe dans le tableau de 1.8 ;
4. pour chaque genre et chaque valeur de `si`, au moins 2 répliques sans variable optionnelle (hors `{agent}`, `{toi}`, `{heure}`) ;
5. au moins 6 répliques par genre, au moins 30 ouvertures de papotage ;
6. ids uniques.

## 2. Modules

Cette section découpe le code des deux vues en fichiers, un propriétaire par fichier, pour que des agents travaillent en parallèle sans jamais toucher le même fichier. Elle reprend le modèle de `docs/vue-immeuble.md` (une portée commune, un contrat de noms, un budget mesuré). Base de code : `option-c.html` (étage vu de dessus) et `option-b.html` (coupe, tubes, journal), découpés en fichiers puis branchés sur les vraies données. Les noms de lots sont ceux du plan m-ny8cm (L1 à L10).

### 2.1 Décisions

1. **Une simulation, deux rendus.** Les personnages, leurs trajets, leurs discussions et le chantier tournent toujours, quelle que soit la vue affichée. La vue d'étage (principale) dessine l'immeuble : tous les étages empilés dans une seule scène, chacun vu de dessus, rez-de-chaussée en bas ; on défile verticalement, seuls les étages à l'écran sont dessinés (2 ou 3 à x2). La vue avancée (bouton « Vue avancée ») dessine la coupe de tout l'immeuble à partir des mêmes personnages : elle ne simule rien, elle lit `person.act` (l'action en cours) et place chacun dans la coupe (2.9). Conséquence : une discussion qui démarre se joue vraiment dans l'étage ; la capsule et le journal de la vue avancée suivent le même événement.
2. **Un étage est un open space à salles, dans une carcasse commune.** Par projet : un bureau vitré par chef, une salle fermée par manager (couleur de son service, en-tête « Resp. : <titre> », ses agents), des postes libres pour les agents sans manager. La carcasse est la même à chaque étage (modèle B, choisi par Nicolas) : même largeur, cafétéria et sanitaires au même endroit, bande d'entrée en bas, tour d'escalier à gauche et gaine d'ascenseur à droite, qui traversent tous les étages au même endroit. Seuls les salles, les meubles et les gens changent. Le plan d'un étage est calculé par une fonction pure à partir de l'`OfficeState` (2.4), pas dessiné à la main.
3. **Une portée commune** (comme `web/immeuble/`) : les fichiers de `web/pixel/` sont réunis dans une seule fonction en mode strict, dans l'ordre de 2.2. `web/pixel/app.js` est un second script qui ne voit que `window.Pixel`.
4. **La vue isométrique reste dans le dépôt, sans être servie.** `web/immeuble/`, `web/index.html`, `web/app.js`, `docs/vue-immeuble.md`, `test/plan.test.ts` ne sont plus modifiés. `src/page.ts` garde `SCENE_FILES` et `assemblePage`, ajoute `PIXEL_FILES`, et exporte deux fonctions : `readPage()` sert la vue pixel (c'est elle que `src/main.ts` et `scripts/demo.ts` appellent), `readIsoPage()` assemble l'ancienne vue pour que ses tests continuent de passer. La vue pixel a son propre balisage (`web/pixel/shell.html`) : la charte de `web/index.html` y est recopiée, pas partagée.
5. **Deux fichiers purs.** `floorplan.js` et `dialogues.js` ne dépendent d'aucun autre fichier, pas même de `hash` ou `clamp` du moteur (ils ont leurs propres copies préfixées) : un test les charge seuls, comme `test/plan.test.ts` charge `plan.js` (`new Function(source + "\nreturn nom;")`). Tout ce qui se teste sans navigateur vit dans ces fichiers.
6. **Noms.** Code, commentaires et identifiants en anglais. Un nom de premier niveau qui est dans les blocs de signatures de 2.3 à 2.10 est public : pas de renommage ni de changement de signature sans accord (la règle de l'immeuble). Tous les autres portent le préfixe de leur fichier (2.2, colonne Préfixe) : `flrCache`, `pplTick`... Deux agents ne peuvent donc jamais déclarer le même nom.
7. **Pas d'exécution au chargement**, sauf `boot.js` (le dernier fichier), qui démarre tout, et la lecture de `REDUCED` dans `engine.js`. Les autres déclarent seulement.
8. **Variété et hasard.** Tout ce qui ne dépend pas du temps (apparence d'un agent, répliques, plan d'un étage) se tire de `hash(id)` ou d'un tirage initialisé : deux pages affichent la même chose. Le hasard de la simulation passe par `rnd` et `pick` (2.3), initialisables par `seedRandom(n)`, pour que les tests et les captures soient reproductibles.
9. **Ordre des étages et mémoire** comme l'immeuble : ordre de première apparition, gardé dans `localStorage` sous la clé `bureau.immeuble.etages` (liste d'ids de projet) ; au premier chargement, ordre de `projects.list` ; le rez-de-chaussée (« Sans projet », entrée de l'immeuble) est toujours en bas et n'est jamais démoli. Un projet sans conversation pendant 20 s perd son étage : ses agents sortent par l'ascenseur et la porte, puis l'étage est démoli (chantier à l'envers) ; s'il revient pendant la démolition, l'étage est reconstruit. Les étages sont empilés de bas en haut : un nouveau projet s'ajoute au sommet (chantier avec grue) ; quand un étage du milieu est démoli, ceux du dessus descendent d'un étage (2.4, `Floor.dy`).

### 2.2 Fichiers, propriétaires, ordre de chargement

Ordre de `PIXEL_FILES` (aussi l'ordre de chargement). Un lot ne touche que ses fichiers.

| # | Fichier | Lot | Préfixe | Contenu |
|---|---|---|---|---|
| 1 | `web/pixel/palette.js` | L2 | `pal` | palette fermée, `rgb` |
| 2 | `web/pixel/font.js` | L2 | `fnt` | police bitmap à accents |
| 3 | `web/pixel/engine.js` | L2 | `eng` | tampons, caméra à zoom entier, boucle, particules, hasard, mesure |
| 4 | `web/pixel/floorplan.js` | L3 | `fpl` | **pur** : étages à partir de l'état, largeur commune, plan en cellules de 8 px, géométrie de l'immeuble, chemins |
| 5 | `web/pixel/floor.js` | L3 | `flr` | étages vivants, décor statique pré-rendu, meubles, tours d'escalier et d'ascenseur, cabine, étiquettes, rendu de l'immeuble |
| 6 | `web/pixel/sprites.js` | L4 | `spr` | apparence, planches de sprites, accessoires, portrait |
| 7 | `web/pixel/actions.js` | L4 | `act` | actions de vie de bureau (générateurs) |
| 8 | `web/pixel/people.js` | L4 | `ppl` | personnages, états, trajets, passage par les tours, entrée et départ |
| 9 | `web/pixel/sky.js` | L7 | `sky` | ciel, rue, heure, lumière de nuit |
| 10 | `web/pixel/build.js` | L7 | `bld` | chantier d'un étage et grue |
| 11 | `web/pixel/dialogues.js` | L5 | `dlg` | **pur** : catalogue (section 1) et choix des répliques |
| 12 | `web/pixel/talk.js` | L5 | `tlk` | discussions, bulles, papotage, journal des échanges |
| 13 | `web/pixel/dialog.js` | L5 | `dbx` | boîte de dialogue à portraits |
| 14 | `web/pixel/nav.js` | L6 | `nav` | vue affichée, défilement entre étages, règle de zoom |
| 15 | `web/pixel/facade.js` | L6 | `fac` | barre d'étages à droite |
| 16 | `web/pixel/input.js` | L6 | `inp` | souris, toucher, clavier, désignation d'un objet |
| 17 | `web/pixel/ui.js` | L6 | `ui` | en-tête, compteurs, puce d'étage, infobulle, horloge, fiche (aide), mobile |
| 18 | `web/pixel/advanced.js` | L9 | `adv` | vue avancée : géométrie de la coupe et rendu |
| 19 | `web/pixel/tubes.js` | L9 | `tub` | tubes, capsules, grue de la coupe |
| 20 | `web/pixel/journal.js` | L10 | `jrn` | journal des échanges (DOM) |
| 21 | `web/pixel/techplan.js` | L10 | `tec` | plan technique (rendu sur le canevas) |
| 22 | `web/pixel/boot.js` | L6 | `boo` | applyOffice, boucle, `window.Pixel`, `window.__pixel` |

Hors portée commune : `web/pixel/shell.html` (balisage et CSS, marque `<!-- scripts -->`) et `web/pixel/app.js` (liaison avec le service), tous deux L6.

Fichiers hors `web/pixel/`, un seul propriétaire chacun :

| Fichiers | Lot |
|---|---|
| `src/model.ts`, `src/events.ts`, `src/state.ts`, `src/service.ts`, `test/events.test.ts`, `test/helpers.ts` | L1 |
| `scripts/demo.ts` | L1 (événements de chaque genre), puis L8 (scénario de la vue : nouveau projet à 40 s) : jamais en même temps |
| `test/floorplan.test.ts` | L3 |
| `test/dialogues.test.ts` | L5 |
| `src/page.ts`, `test/page.test.ts` | manager Développement à l'étape 0, puis L8 (jamais en même temps) |
| `scripts/mesure-pixel.js`, `README.md`, `wiki/`, `CHANGELOG.md`, `boite-plugin.json` (par `bun run pack`) | L8 |
| `docs/vue-pixel.md` | A2 (sections 1 et 2) ; L8 ajoute une section 3 (vérification) sans toucher aux deux premières |

**Étape 0, faite par le manager Développement avant de lancer L3 :** créer les 22 fichiers vides avec leur en-tête (`/* web/pixel/<nom>.js : lot Lx, voir docs/vue-pixel.md */`), écrire `PIXEL_FILES` et `readPage` / `readIsoPage` dans `src/page.ts`, un `shell.html` minimal (un canevas `#scene`, les ids de 2.10), un `app.js` minimal et le **squelette de `boot.js`** (`applyOffice`, boucle, `window.Pixel`, `window.__pixel` dans l'ordre de 2.10, appels aux fonctions des autres lots protégés par `typeof fn === 'function'` tant qu'elles n'existent pas ; L6 retire ces gardes à la fin), et faire passer les contrôles actuels de `test/page.test.ts` sur `readIsoPage()` (la vue isométrique) pour que `bun test` reste vert. Ainsi `bun run demo` sert la page dès le premier lot, et `src/page.ts` et `test/page.test.ts` ne sont plus édités avant L8.

### 2.3 Moteur (L2) : `palette.js`, `font.js`, `engine.js`

```js
// palette.js
const PALETTE = { ink: '#1A212E', /* ... */ };  // closed, 24 to 40 named colours, hex only; the names of option-c.html and option-b.html are the starting set
function rgb(name) -> [r, g, b]                  // memoised; throws on an unknown name in development, returns [255,0,255] in production

// font.js : 5x7 proportional bitmap, FONT_H = 11 rows (accents above, descenders below)
const FONT_H = 11;
function textWidth(s) -> px
function drawText(g, s, x, y, colour)            // colour: palette name; one atlas per colour, built on first use
function wrapText(s, maxWidth) -> string[]       // breaks at spaces only
// glyphs: A-Z a-z 0-9, . , : ; ! ? ' ( ) / + - %, é è ê ë à â ô û ù î ï ç É È Ê À Ç, œ Œ « » ’ ü, space.
// A character the font lacks is skipped (width 0), never an error.

// engine.js
function makeBuffer(w, h) -> { c, g }            // offscreen canvas and its 2D context, imageSmoothingEnabled = false
function rect(g, x, y, w, h, colour)             // colour: palette name or '#hex'; x and y rounded
function bakeRows(rows, map) -> canvas           // sprite from string rows and a char -> palette name map
function hash(s) -> uint32                       // FNV-1a
function clamp(v, a, b)
let REDUCED                                      // prefers-reduced-motion, read once at load (the only load-time execution outside boot.js, guarded by typeof matchMedia)
function seedRandom(n)                           // makes rnd and pick deterministic (tests, captures)
function rnd(a, b) -> float                      // simulation randomness
function pick(list) -> item
const ZOOMS = [1, 2, 3, 4, 5, 6];                // integer zoom steps only
class Camera {                                   // world px -> buffer px -> device px, always integer
  x; y;                                          // world position of the buffer's top-left pixel (integers)
  zoom;                                          // one of ZOOMS: DEVICE pixels per logical pixel (dpr 2: zoom 1 is 0.5 CSS px)
  bw; bh;                                        // buffer size in logical px
  insets;                                        // {top, right, bottom, left} logical px covered by UI (dialog box): fit and clamp avoid them
  fit(worldW, worldH, viewW, viewH, dpr)         // dpr optional; largest ZOOMS entry that shows the whole world, else 1; centres it; the camera remembers the world size
  setZoom(z, anchorScreenX, anchorScreenY)       // zoom around a screen point, keeps that world point under it
  zoomBy(step, ax, ay)                           // +1 / -1 on ZOOMS
  panBy(dxScreen, dyScreen)                      // screen px, snapped to whole logical px
  clampTo(worldW, worldH)                        // keeps the world visible (smaller than the view: centred); panBy, setZoom and resize re-clamp on their own
  screenToWorld(sx, sy) -> { x, y }
  worldToScreen(wx, wy) -> { x, y }
  resize(viewW, viewH, dpr)                      // recomputes bw and bh
}
function presentBuffer(canvas, buffer, zoom)     // buffer: canvas or {c, g}; zoom optional (else deduced from the parent); copies at integer device scale, no smoothing; sets backing size and CSS size
function startLoop(update, render) -> { stop(), stats() }
  // requestAnimationFrame; update(dt) then render(T); dt clamped to 0.05 s; T = seconds since start; paused while the tab is hidden
  // stats() -> { fps, cpuMs, worstMs, frames } over the last 5 s
const PART = { steam: 0, smoke: 1, drop: 2, ash: 3, zzz: 4, puff: 5, spark: 6, dust: 7 };
function emitParticle(layer, kind, x, y, vx, vy, life)   // layer: floor index (x, y in plan px of that floor) or -1 for the advanced view (its own px); pool of 256, typed arrays, oldest overwritten
function tickParticles(dt)
function drawParticles(g, layer, T)              // draws in the current space of g: the caller has done translate(-cam.x, -cam.y)
```

Règles du moteur : un pixel logique égale un pixel du tampon ; le tampon est agrandi par un facteur entier en pixels de l'appareil (`devicePixelRatio` compris), jamais de demi-pixel ; `imageSmoothingEnabled = false` partout et `image-rendering: pixelated` sur le canevas ; aucune forme vectorielle lisse dans la scène. Un facteur de zoom qui ne fait pas tenir le plan dans la fenêtre (téléphone de 390 px) donne un défilement, jamais un zoom fractionnaire.

### 2.4 Immeuble et étages (L3) : `floorplan.js` (pur), `floor.js`

Modèle B : un seul immeuble, tous les étages empilés dans une scène monde, rez-de-chaussée en bas, séparés par une dalle épaisse. Références : `.maquettes/2026-11-13-etages/option-b.html` et ses captures (rendu d'étage de `2026-11-12-melange-b`).

**Repères.** Coordonnées « plan » : pixels à partir du coin haut gauche du plateau de l'étage (cellules de 8 px, `x` négatif dans la tour d'escalier, `x >= plan.width` dans la tour d'ascenseur). Coordonnées « monde » : pixels de la scène, origine en haut à gauche de l'immeuble ; le plateau de l'étage `fl` est à `(STAIRS_W, fl.y + fl.dy)`. Une personne dans une tour a des coordonnées `wx` (en x plan) et `wy` (en y monde), voir 2.5.

```js
// floorplan.js : pure, no DOM, no other file
const CELL = 8;                                  // placement and collision grid, px (half a 16 px decor tile)
const PLATE_ROWS = 44, PLATE_H = 352;            // every floor plate: 44 rows
const SLAB = 16;                                 // slab under a plate; the name plate of the floor below (number and project) is drawn on it
const BLOCK = PLATE_H + SLAB;                    // 368: one floor in the stack
const STAIRS_W = 56, LIFT_W = 44;                // tower widths, px, left and right of the plate
const SKY_H = 80, GROUND_H = 24;                 // above the top plate (its name plate, crane room), under the ground floor (street edge)
const COLS_MIN = 62, COLS_MAX = 96;              // plate width in cells (496 px at least)
function planBuilding(office, memo) -> { floors: FloorSpec[], order: string[] }
  // office: OfficeState; memo: remembered project ids (or null). Same rules as the isometric planImmeuble:
  // one floor per project with a team, the ground floor '' (« Sans projet ») always, order = memo then projects.list.
  // floors[0] is always the ground floor ''; order lists the project ids only, without ''.
function buildingCols(specs) -> cols             // the common plate width: the widest need of any floor, between COLS_MIN and COLS_MAX
function layoutFloor(spec, cols) -> FloorPlan    // deterministic: same spec and same cols, same plan; cols comes from buildingCols
function buildingSize(count, cols) -> { w, h }   // w = STAIRS_W + cols * CELL + LIFT_W; h = SKY_H + count * BLOCK + GROUND_H
function floorTop(index, count) -> y             // world y of the top of the plate of floor index: SKY_H + (count - 1 - index) * BLOCK
function floorAtY(wy, count) -> index | -1       // the floor whose plate or slab carries this world y; -1: sky or ground
function floorScrollY(index, count, viewH) -> y  // camera top (world px) that frames the floor: the slab above with its name, then the plate, centred when the view is taller; viewH in logical px; 0 for the top floor (sky and crane show), except that the ground floor is always framed at the bottom (entrance strip and street visible), also when it is the only floor
function floorTitle(index) -> string             // 'Rez-de-chaussée', '1er étage', '2e étage'...
function stairPoints(index, count) -> [[x, y], ...]   // the flights of the stair tower from the landing of floor index to the one above, plan x, world y, 10 flights, zig-zag
function findPath(plan, sx, sy, tx, ty) -> [[cx, cy], ...] | null   // BFS on plan.blocked, 4-neighbours, excludes the start, may end on a blocked target cell
function freeCellNear(plan, cx, cy) -> [cx, cy]  // nearest walkable cell (used to visit a seated person)
```

```js
FloorSpec = {
  id: string,                  // project id, '' for « Sans projet »
  name: string,                // project name or « Sans projet »
  index: number, title: string,   // from the order: 0 = ground floor; title = floorTitle(index)
  offices: [{ teamId, chefId, title }],         // one glass office per team whose root has the role chef and at least one child
  rooms: [{ key, managerId, service, title, colorKey, agentIds: [] }],   // one per manager; agentIds = the agents under it, oldest first
  open: [agentId, ...],        // free desks: agents without manager, roots without children, oldest first
  stats: { total, running, waiting, queued, done, error },
  missions: [{ id, status, title }],
}
// colorKey: 'dev' | 'arch' | 'design' | 'qa' | 'prod' | 'misc' (Développement, Architecture, Design, Qualité, Produit, other)
// An agent belongs to the room of its nearest manager ancestor; none: open space. A manager of a team without chef sits in its room anyway.

FloorPlan = {
  id, name, spec,
  cols, rows, width, height,   // cells, then px; rows = PLATE_ROWS, height = PLATE_H, cols = the common width given to layoutFloor
  blocked: Uint8Array,         // cols * rows cells, 1 = not walkable (walls, furniture, desks)
  offices: [{ teamId, chefId, rect, door, desk, sign }],      // rect = {x, y, w, h} in cells; door = {x, y} walkable cell; sign = the chef's title; 3 at most per floor (oldest chefs), the other chefs sit in `open`
  rooms: [{ key, managerId, colorKey, title, rect, door, header, cols, desks: [Desk] }],   // header = {x, y, w} in px: the name strip, 22 px high; cols = desk columns (1 to 4); rect = left wall plus interior, the right wall is shared with the next rect
  open: { rect, desks: [Desk] },
  standing: [agentId, ...],    // agents of the spec that got no desk (the plate is full): they work standing in the open space
  desks: [Desk],               // every desk, stable ids
  spots: { coffee, micro, fountain, printer, window, smoke, rail, sofa, bench, board, plant, stairs, lift, entry },   // each: [Spot]; entry only on the ground floor
  cafeteria: rect, hall: rect, entrance: rect,   // hall = sanitaires and bench; entrance = the bottom strip (rail, smoking corner, door)
  door: { x, y, w, h },        // the door of the entrance strip, px; real only when spec.id is '' (decorative glass on the other floors)
  landY: number,               // px: the feet line of a person on the landing (last walkable row); stairs and lift spots are on it
  lights: [{ x, y, r, desk }], // light pools (px) for sky.js; desk = desk id or null
  furniture: [{ kind, x, y, w, h, z }],   // static decor, rect in cells (blocking footprint or anchor of a wall piece, the sprite may reach out of it); z = sort depth in px
  // kind: plant printer board clock sign fridge micro coffee cooler vend toilet table sofa bench meet lounge recep
}
Desk = { id, where, x, y, w, seat: {x, y}, approach: {x, y}, ownerId, facing }   // facing: 'down' for every desk made by layoutFloor (seated facing the viewer, monitor seen from behind, as option-b.html); 'up' is supported by sprites.js but not produced   // id = where + '#' + k; where = 'office:<teamId>' | room key | 'open'; seat and approach are walkable cells
Spot = { x, y, f }             // walkable cell and facing: 'up' | 'down' | 'left' | 'right'; sofa and bench Spots also carry px, py (feet position in px of someone sitting)
// Units, as built in floorplan.js (its header has the details): rects of offices, rooms, open, furniture, cafeteria, hall, entrance in cells; Desk.x, y, w, header, door, landY, lights in px; seat, approach, doors of offices and rooms, every Spot in cells.
```

Règles de `layoutFloor` (testées par `test/floorplan.test.ts`, L3) :
- Gabarit des maquettes de D4c et du rendu d'étage de D4b : plateau de 44 rangées de 8 px (352 px) sur au moins 62 colonnes (496 px). De haut en bas : mur du fond avec fenêtres (16 px), zone du chef (bureau vitré de 120 x 40 px à gauche (la rangée 7 reste libre), panneau de mission de 88 x 24 px), rangée de salles (64 à 264 px), couloir, mur de la cafétéria, sol de la cafétéria, mur d'entrée. Bureau de 40 px (5 cellules), mur de 8 px (1 cellule), en-tête de salle de 30 px. Une salle de manager a 1 à 4 colonnes de postes (68 px chacune) sur 2 rangées d'agents en plus du poste du manager (rangées de postes à y = 118, 164 et 210 px) : elle grandit par paliers de 2 postes (jusqu'à 8 agents), pour que le plan ne change pas à chaque arrivée.
- Ce gabarit retire 16 px à la maquette B (salle de 200 px au lieu de 216, dalle de 16 px au lieu de 24) pour qu'un étage entier et sa dalle (`BLOCK` = 368 px, 736 px à x2) tiennent dans la hauteur utile de 1280 x 800 (752 px après un en-tête de 48 px). Trois rangées de postes avec leurs noms tiennent encore dans 200 px (calculé : le dernier nom finit 3 px au-dessus du mur). Garde-fous de Design : l'en-tête de salle garde ses 3 lignes entières (« Resp. : Manager Développement ») et 6 px de marge avant le premier poste ; les 16 px se retirent sur l'écart entre rangées de postes (pas moins de 46 px, le nom sur 2 lignes tient sous le poste), pas sur l'en-tête ; la plaque d'étage fait 12 px et la face béton de la dalle 10 px plus une ombre tramée, pour que la plaque ne morde pas le mur du plateau ; les rangées du bas (couloir, cafétéria, entrée, bas du plateau) se décalent de -16 px d'un bloc ; les noms restent dessinés après les personnages.
- Au-delà de 8 agents sous un même manager, les suivants prennent des postes de la zone `open` de l'étage. Si le plateau atteint `COLS_MAX`, les agents en trop n'ont pas de poste (`desk: null`) : ils travaillent debout dans l'open space. Aucun plan ne dépasse `COLS_MAX` (testé).
- Largeur commune : `buildingCols(specs)` prend le plus grand besoin parmi les étages (largeur des salles, de la zone ouverte, de la cafétéria et des sanitaires qui se calent contre le mur de droite). Quand un étage plus large apparaît, `syncFloors` refait le plan de tous les étages avec la nouvelle largeur : `ver` change, les personnes gardent leur poste (`Desk.id`) et les autres sont replacées par `freeCellNear`. C'est rare et jamais animé.
- Même carcasse à chaque étage : mur d'entrée, cafétéria, sanitaires, palier d'escalier (cellule 1 de la rangée du palier) et d'ascenseur (dernière cellule moins 1) à la même place (aux colonnes près pour ce qui est calé à droite). Les murs latéraux laissent un passage de 2 rangées vers chaque tour, au niveau du palier.
- Aucun chevauchement entre salles, bureaux, meubles ; chaque poste, chaque `Spot`, chaque porte atteignable depuis les deux paliers (`findPath`) ; au moins une cellule libre autour de chaque poste.
- Un agent garde son poste (`Desk.id`) tant que sa salle ne change pas : les postes sont attribués par ancienneté (`createdAt`), les nouveaux en dernier.
- Au moins 2 `Spot` pour `coffee`, `window`, `smoke`, `rail`, `sofa`, 6 pour `board` (réunion du plan), 1 pour chaque autre ; `stairs` et `lift` sur la rangée du palier, `entry` au rez-de-chaussée. `smoke` et `rail` sont dans la bande d'entrée (le balcon de la vue isométrique n'existe plus).

**`findPath` et les tours.** `findPath` ne connaît que le plateau d'un étage. Un trajet entre étages est : `findPath` jusqu'au `Spot` du palier (`stairs` ou `lift`), puis marche en ligne droite sur `plan.landY` à travers le passage du mur jusqu'à la tour (la personne quitte le plateau : `p.tz` est posé, 2.5), trajet dans la tour (marches de `stairPoints`, ou cabine), sortie sur le palier de l'étage d'arrivée, puis `findPath` sur son plan. Le trajet dans la tour est du ressort de `actions.js` (2.5).

```js
// floor.js : live floors, towers, labels
const FLOORS = [];                               // Floor[], index 0 = ground floor
const floorCam = new Camera();                   // the building camera (a declaration only: Camera comes from engine.js, loaded before)
Floor = { index, id, name, title, spec, plan, ver, y, dy, p, build, tier, doors: { entry, glass }, fx, ghost, emptyT, stats, missions, lampsOn }
//   fx = { micro, coffee, print, board }: seconds left of the moving parts of the equipment (board: progress 0..1); people.js sets micro, coffee, print, talk.js sets board, tickFloors counts the three timers down
//   ghost, emptyT: a floor whose team is gone; emptyT counts the 20 s before the demolition starts
//   y: world y of the top of the plate, = floorTop(index, FLOORS.length), integer; dy: draw offset in px, 0 at rest (floors above a demolished one come down by easing dy from -BLOCK to 0)
//   p: build progress 0..1 (1 = built); build: null | { t0, dir } owned by build.js; ver: bumped when the static decor changes
//   tier: 0 on screen, 1 neighbour of one on screen, 2 far (set by setFloorTiers, read by tickPeople and tickTalk)
const LIFT = { x, y, fl, door, want, moving, dir, owner };   // the one cab of the building. x: plan x of the cab centre; y: world y of the cab floor line (feet line); fl: index it stands at; door: 0..1, eased towards want by floor.js;
                                                          // owner: Person | null (one rider at a time; others wait on their landing). The cab moves (y, fl, want, owner) are driven by people.js and actions.js, the drawing and the door easing by floor.js
function syncFloors(office, animate) -> { added: [Floor], removed: [Floor], changed: [Floor], shiftY }
  // planBuilding + buildingCols + layoutFloor; a new floor on top calls startBuild(fl, 1) when animate; a floor with no people for 20 s calls startBuild(fl, -1).
  // shiftY: how far the world origin moved (a floor added on top moves every floor down by BLOCK, a demolition moves the floors below up): nav adds it to floorCam.y so the picture stays put.
function floorById(id) -> Floor | null
function floorOfPerson(id) -> Floor | null       // a person in a tower still belongs to the floor they left, until they arrive
Piece = { x, y, w, h, sy, draw(g, T) }           // a drawn object of a floor, plan px
function floorFurniture(fl) -> [Piece]           // every piece, wall pieces included (their small sy sorts them behind the people); for build.js to hoist
function floorDrawables(fl) -> [Piece]           // the same reused array as floorFurniture, sorted with people by sy
function drawFloorStatic(g, fl, kind)            // the decor bitmap of plate and slab (width x BLOCK), cached per (floor, ver, sky kind), drawn at the plate origin
function openDoor(fl, name, seconds)             // 'entry' | 'glass'; doors animate in tickFloors
function liftStopY(index) -> y                   // world y of the feet line when the cab stands at floor index: floorTop(index, n) + plan.landY
function tickFloors(dt)                          // doors, LIFT.door, dy easing
function setFloorTiers(cam)                      // tier of every floor from what the camera shows
function floorToScreen(fl, cam, x, y) -> { x, y }   // plan px to buffer px (reused object), for bubbles and hit tests
function renderBuilding(g, tg, cam, T)           // the layer order below; g = scene buffer, tg = the text layer (device pixels)
function drawFloorLabels(tg, fl, cam, T)         // plates, room headers, desk names, signs on the text layer; skips names that a bubble covers (bubbleRects, 2.6)
function finishFloor(fl)                         // build.js calls it when a construction ends; people walk in afterwards
function floorGone(fl)                           // build.js calls it when a demolition ends; the floors above come down; it moves floorCam.y by -BLOCK (the floors below move up)
function flrTakeShift() -> px                    // public despite its prefix: returns and clears the pending shift of floorGone; nav.js adds it to NAV.ty every frame
```

Ordre des couches de `renderBuilding` (le seul endroit où il est fixé). Seuls les étages dont le plateau ou la dalle croise l'écran sont dessinés (`setFloorTiers`, au plus 3 à x2) ; chaque étage visible est traité en entier (couches 3 à 8) avant le suivant, de haut en bas :

1. `drawCity(g, cam, kind)` (sky.js) : fond, ciel au-dessus du toit, rue au pied du rez-de-chaussée.
2. Les deux tours (escalier à gauche, gaine d'ascenseur à droite) : décor statique pré-rendu sur toute la hauteur de l'immeuble par ciel, volées de marches, câbles, repères de palier ; puis la cabine et sa porte (`LIFT`), et les personnes en cours de passage dans une tour (`peopleInTowers()`, people.js), triées par `wy`. La nuit et le filtre « Qui m'attend » les assombrissent comme les étages.
3. Origine plan de l'étage : `drawFloorStatic`, ou `drawConstruction(g, fl, T)` (build.js) tant que `fl.p < 1`, puis la dalle de dessous.
4. Portes (entrée, porte vitrée du chef).
5. Objets triés par `sy` : `floorDrawables(fl)` puis `peopleDrawables(fl)` (people.js), un seul tri sur un tableau réutilisé.
6. `drawParticles(g, fl.index, T)` (coordonnées plan, avec le `translate` de l'origine du plateau actif).
7. Retour au tampon : `applyLight(g, fl, cam, T)` (sky.js), la nuit ; puis `drawBubbles(g, fl, cam, T)` (talk.js) : bulles d'état et de parole.
8. Filtre « Qui m'attend » : voile sombre sur l'étage, puis les agents qui attendent redessinés avec leurs bulles.

Après toutes les couches, `drawFloorCrane(g, fl, T)` (build.js) au-dessus de l'étage en chantier, puis le tampon est présenté (`presentBuffer`) et, **sur le canevas de texte `#texte`** (même taille que `#scene`, en pixels de l'appareil, vidé à chaque image), `drawFloorLabels` pour chaque étage visible. Les textes de nom (plaque d'étage sur la dalle, en-têtes de salle, noms sous les postes, panneau du chef, « Cafétéria », « Sanitaires », « Escalier », « Ascenseur ») sont ainsi nets : police bitmap rasterisée à 1 pixel de police par pixel d'appareil et agrandie par un facteur entier `TF = max(1, round(cam.zoom / 2.4))`, jamais floue, jamais agrandie avec la scène. Les étiquettes se mettent en cache comme images (texte, couleur, facteur), 800 au plus. Un nom n'est jamais caché par un personnage (le texte est sur son propre canevas, au-dessus) ni par une bulle (`bubbleRects`) ; un nom de salle ou de poste qui toucherait une bulle est simplement omis le temps de la bulle. Le texte des bulles de parole reste dans le tampon, à l'échelle de la scène.

### 2.5 Personnages (L4) : `sprites.js`, `actions.js`, `people.js`

```js
// sprites.js
const SPRITE_W = 12, SPRITE_H = 20;              // at least 12 x 20, selective outline, 4 walk frames per direction
function lookFor(id, role) -> Look               // skin, hair, hair style, top, pants, shoes, glasses, headphones, accent, smoker, gardener: all from hash(id)
function bakeSheet(look, variant) -> canvas      // variant: null | 'amber' (waiting) | 'red' (error) | 'done' (greyed); one sheet per look and variant, baked on first use
const FRAME = { down: 0, up: 5, side: 10, sit: 15, sleep: 16, hand0: 17, hand1: 18, hold: 19, str0: 20, str1: 21, read: 22, type0: 23, type1: 24, sitUp: 25, typeUp0: 26, typeUp1: 27, handUp0: 28, handUp1: 29, count: 30 };   // *Up: seated seen from behind, for Desk.facing 'up'
const WORKER_LOOK = { ... };                     // construction worker for build.js
function drawSprite(g, sheet, frame, x, y, flip) // feet at (x, y)
function drawPortrait(canvas, id)                // face and bust for the card and the dialog box, from lookFor(id)
const PROPS = { cup, paper, bowl, can, phone, cigarette, hourglass, folder, book, glass, marker };   // small sprites, baked with bakeRows

// people.js
const PEOPLE = [];                               // Person[]
Person = {
  id, info,                                      // thread id; the last OfficeAgent seen
  floor, desk,                                   // Floor; Desk | null
  x, y, cx, cy, dir,                             // feet in px, cell, 'up' | 'down' | 'left' | 'right' (plan px, plan cells)
  tz, wx, wy,                                    // tz: null | 'lift' | 'stairs': in a tower, off the plate (then visible is false on the plan); wx: plan x (negative in the stair tower, >= plan.width in the lift tower), wy: world y of the feet line
  pose,                                          // 'stand' | 'walk' | 'sit' | 'type' | 'hand' | 'hold' | 'str' | 'read' | 'sleep'
  act,                                           // ACT_KIND or null: what the person is doing, read by the advanced view; 'walk' during plain walks, 'chat' while p.conv is set
  prop, icon, seated, present, visible, alpha, leaving, conv, look,
  trip, nod,                                     // trip > 0: a floor change is under way and cannot be interrupted (a state change waits); nod: seconds left of a head nod
}
const ACT_KINDS = ['type', 'wait', 'bench', 'coffee', 'smoke', 'fountain', 'printer', 'board', 'micro', 'plants', 'stretch', 'window', 'phone', 'sleep', 'rail', 'read', 'sofa', 'chat', 'deliver', 'lift', 'stairs', 'walk'];
function syncPeople(office, animate)             // after syncFloors: spawn, setPersonState, movePerson, leavePerson from the diff with the last state; animate false: everyone placed at once, no walking. A floor with Floor.p < 1 holds its arrivals on the ground floor until finishFloor
function setPersonState(p, info)                 // the table below
function tickPeople(dt)                          // floors with tier 0 and 1 every frame, tier 2 four times a second with the time they missed; a person with tz is always stepped
function personById(id) -> Person | null
function peopleOnFloor(fl) -> [Person]           // reused array: read it, do not keep it; a person in a tower is not in it
function peopleInTowers() -> [Person]            // reused array, sorted by wy, drawn by renderBuilding (2.4)
function personAt(fl, px, py) -> Person | null   // hit test in plan px of floor fl, topmost first
function towerPersonAt(wx, wy) -> Person | null  // hit test in tower coordinates (plan x, world y)
function peopleDrawables(fl) -> [{ sy, draw(g, T) }]
function pplDraw(g, p, x, y, T)                 // draws one person at feet (x, y): sprite, prop, ring, amber or red variant; no hourglass, « ? » or « ! » (talk.js draws those). Seated: feet at (desk.x + 20, desk.y + 4), the desk sorts at desk.y + 12
let pplWaitFilter                                // the « Qui m'attend » filter, set by setWaitFilter, read by renderBuilding (layer 8)
function setWaitFilter(on)                       // « Qui m'attend »
function setSelected(id)                         // ring under the person whose card is open
// helpers for talk.js (generators, to be used with yield*):
function* personArrive(p)                        // public (people.js): a newcomer's entry from the front door to the lift or stairs and the desk; talk.js takes it over for the 'arrive' conversation
function personAssign(p, gen) -> bool            // gen: a generator or (p) => generator; cancels the current behaviour and runs it; returns false (and does nothing) while p.trip > 0
function personCancel(p)
function* personWalkTo(p, cx, cy)                // path by findPath, walls and desks respected
function* personStepTo(p, x, y, speed)
function personFaceTo(p, other)
function personVisitCell(p) -> { x, y, f }       // in cells: where someone stands to talk to a seated p
// changing floor (actions.js, generators, to be used with yield*): the person walks to the landing, crosses the wall, rides, comes out on the landing of the destination floor
function* personTravel(p, toIndex, how)          // how: 'lift' | 'stairs' | null (null: stairs for one floor half of the time, else lift); Person.act 'lift' or 'stairs' during the ride
function* personRideLift(p, toIndex)             // waits its turn (LIFT.owner), calls the cab, steps in, rides, steps out; sets p.tz, p.wx, p.wy, moves p.floor on arrival
function* personRideStairs(p, toIndex)           // walks stairPoints(index, count) flight by flight, one floor at a time
```

| État (`OfficeAgent.state`) | Sur la scène |
|---|---|
| `running` | assis à son poste, écran allumé, tape |
| `waiting` | assis, main levée, bulle « ? » ambre, contour ambre, nom affiché en permanence |
| `queued` | banc de l'entrée à l'arrivée, puis à son poste avec un sablier |
| `idle` | pause : une action de vie de bureau |
| `done` | apporte son dossier à son manager, puis pause, légèrement grisé |
| `error` | assis, bulle rouge, appelle son manager, qui vient voir |
| absent de l'état | ascenseur, sortie par la porte d'entrée |

`actions.js` expose `ACTIONS` (clé : générateur `function*(p)`) pour au moins : type, read, coffee, smoke, fountain, printer, board, micro, plants, stretch, window, rail, phone, sofa, sleep (la nuit), stairs, lift, et `pickAction(p, hour)`. Chaque action pose `p.act` au début et le remet à `null` à la fin, libère ses `Spot` et ses accessoires même si elle est annulée.

### 2.6 Discussions (L5) : `dialogues.js` (pur), `talk.js`, `dialog.js`

```js
// dialogues.js : pure; the catalogue of section 1 and its rules, no DOM, no other file
const CATALOG = { delegate: [...], report: [...], blocked: [...], waiting: [...], plan: [...], arrive: [...], depart: [...], answered: [...], chatter: [...], reply: [...] };
function cleanValue(text, max) -> string         // « motSur » of 1.8
function modelShort(model) -> string | null      // 'claude-sonnet-5-5' -> 'Sonnet 5.5'
function formatDuration(ms) -> string            // '45 s', '12 min', '2 h 05'
function buildVars(kind, ctx) -> { [name]: string | null }   // ctx = { event, agent, other, team, lot, now, third?, otherLot? } : plain objects, no lookup in the page
function pickLines(kind, ctx, seed, recent) -> [{ who: 'a' | 'b' | 'c', text }] | null
  // 1.7 : condition si, variables present, seeded draw; only the last 8 ids of recent count, recent is trimmed to 8 after the draw (the caller keeps the array); null when nothing is eligible
  // kind 'chat' draws an opener (CATALOG.chatter, si = state of other) and a reply (CATALOG.reply); without other, only the opener
  // ctx: agent = the thread of the event (a departed one: the last OfficeAgent kept, null tolerated), other = the interlocutor (null alone), third = plan only: the second manager who speaks the c cells (without it c is not played), otherLot = chat only, lot null: searched in team.mission.lots (lotId, then agentId)
  // {agent} falls back to « Agent »; {rapport} has no value when the event has hasReport false
```

```js
// talk.js
Conversation = {
  id, kind,                                      // 'delegate' | 'report' | 'blocked' | 'waiting' | 'answered' | 'plan' | 'arrive' | 'depart' | 'chat'
  floor, parts: [Person], lines: [{ who, text }], line,   // who = index in parts (talk.js maps a, b, c of pickLines to 0, 1, 2); line: index being spoken
  phase,                                         // 'gather' | 'talk' | 'end'
  typed, cur,                                    // letters shown; cur = { who, text, wrapped: [string], w, h }
  event,                                         // OfficeEvent | null (chatter)
}
const CONVERSATIONS = [];
function syncTalk(office)                        // plays the unseen events of office.events (1.7); the first state only marks them seen; keeps 8 pending events at most, ignores those older than 30 s; 4 conversations at once
function tickTalk(dt)                            // chatter starts here: two people at rest on the same floor and the same break spot
function drawBubbles(g, fl, cam, T)              // state bubbles (« ? », « ! », hourglass) and speech bubbles of floor fl, in buffer px via floorToScreen, placed without overlap, kept inside the plate and above the dialog box; a state bubble with no room is omitted, a speech bubble with no room is omitted for that frame (the dialog box keeps the line)
function bubbleRects(fl) -> [[x, y, w, h, conv | null]]   // plan px of the bubbles drawn this frame on fl (reused array), so that drawFloorLabels leaves a bubble uncovered
function bubbleAt(fl, px, py) -> Conversation | null   // plan px of floor fl
function openDialogFor(conv)                     // click on a bubble or a pair: dialog.js
const TALK_LOG = [];                             // { at, convId, kind, floorId, fromId, toId, who, name, idx, text }, one entry per spoken line, 300 at most; who = id of the thread that speaks, name = its name, idx = index of the line in the conversation
function onTalk(fn) -> unsubscribe               // fn({ type: 'start' | 'line' | 'end', conv, entry }): the capsules (L9) and the journal (L10) listen here
```

`dialog.js` : la boîte à portraits en bas de la scène (`#dialog` dans le balisage, 2.10) : deux portraits (`drawPortrait`), le nom, les répliques de la discussion jusqu'ici, « Ouvrir la conversation ». Elle suit la discussion en cours ; une discussion terminée reste lisible jusqu'à la fermeture.

```js
// dialog.js
function showDialog(conv)
function hideDialog()
function dialogHeight() -> px                   // CSS px, margins included, 0 when hidden; navTick sets floorCam.insets.bottom = ceil(dialogHeight() * dpr / zoom) (same for advCam)
```

Les genres de 1.5 et les discussions : `delegate`, `report`, `blocked`, `plan`, `arrive` et `depart` (court, à la porte ou à l'ascenseur), `answered` ont des acteurs (`agentId`, `fromId`/`toId`) et un lieu (visite au poste, réunion au tableau pour `plan`) ; `waiting` n'ajoute qu'une réplique de l'agent vers le spectateur (bulle « ? » ambre). Au plus 4 discussions à la fois (1.7).

### 2.7 Ville, ciel, lumière, chantier (L7) : `sky.js`, `build.js`

```js
// sky.js
function skyKind(hour) -> 'night' | 'dawn' | 'day' | 'dusk'
function nightAlpha(hour) -> 0..0.66             // stepped (1/25), never continuous
function sceneHour() -> hour                     // real local time, or the demo override
function setHourOverride(h | null)               // demo only (?demo=1)
function drawCity(g, cam, kind)                  // the world around the building: ink background, dithered sky above the roof, street along the foot of the ground floor (cars and walkers on a few lines); pre-rendered per kind
function applyLight(g, fl, cam, T)               // night mask of floor fl (plate and slab) with stepped light pools at fl.plan.lights, at occupied desks (peopleOnFloor) and at lit spots; lit windows of the back wall

// build.js
const BUILD_SECONDS = 13;                        // readable, 8 to 15 s
function startBuild(fl, dir)                     // dir 1 builds, -1 demolishes; sets fl.build and fl.p
function tickBuild(dt)                           // advances fl.p; at the end calls finishFloor(fl) or floorGone(fl) (floor.js)
function drawConstruction(g, fl, T)              // in plan px, instead of the decor while fl.p < 1: columns and beams delivered, slab, walls, glass, furniture hoisted (floorFurniture), light, workers (WORKER_LOOK)
function drawFloorCrane(g, fl, T)                // in world px, after all floors: tower crane over the floor being built or demolished (mast on the lift side, jib across the plate, load); drawn whenever fl.build is set
```

### 2.8 Interface (L6) : `nav.js`, `facade.js`, `input.js`, `ui.js`, `shell.html`, `app.js`

```js
// nav.js
const NAV = { mode: 'floor' | 'advanced', floor: index /* the floor the camera centres on */, ty: y /* scroll target, world px */, plan: false /* technical plan shown in the advanced view */ };
function navGoto(index, how)                     // scrolls floorCam to floorScrollY(index, ...): how 'smooth' (default, eased, whole pixels) | 'now' (reduced motion, first frame, zoom change); calls Pixel.onFloorChange when NAV.floor changes
function navStep(d)                              // the neighbouring floor, d = +1 up, -1 down (PageUp, PageDown, arrows up and down)
function navPanTo(stop)                          // 'stairs' | 'floor' | 'lift': sideways stops when the building is wider than the view (phone, narrow panel)
function navFitZoom()                            // the zoom rule below; also called on resize and on key 0
function navZoomBy(step)                         // +1 / -1 on ZOOMS around the centre of the view, keeps the floor in view
function navSetMode(mode)                        // 'floor' | 'advanced'; calls Pixel.onViewChange
function navBack()                               // Escape: closes the dialog box, then the card, then the wait filter, then leaves the advanced view, then nothing
function navTick(dt)                             // adds flrTakeShift() and the shiftY of syncFloors to NAV.ty; eases floorCam.y towards NAV.ty (integer steps, instant with REDUCED), updates NAV.floor from the centre of the view, keeps the camera inside the building
function activeCamera() -> Camera                // floorCam in the floor view, advCam in the advanced view

// facade.js : the floor bar on the right (DOM buttons, not a canvas); the file keeps its name
function buildFloorBar()                         // one button per floor in a map of the building (top = sky): number or « Rez », short name, dot when someone waits, hazard stripes while under construction; click -> navGoto; rebuilt when floors change or the bar is resized
function updateFloorBar(T)                       // every frame, cheap: frame of what is on screen (from floorCam), mark of the cab (LIFT.y), current floor, waiting dots (cached key, DOM written only on change)

// input.js : wheel, drag, pinch, keys, click and hover
function bindInput(canvas)
//   wheel: scrolls the building vertically (sets NAV.ty); drag: pans both ways, no easing; pinch and + / - / 0: zoom (navZoomBy, navFitZoom)
//   keys: PageUp, ArrowUp: floor above; PageDown, ArrowDown: floor below; Home: top floor; End: ground floor; ArrowLeft, ArrowRight: pan sideways; Escape: navBack
//   click: a bubble opens the dialog, a person opens the card, an empty spot of a floor centres that floor (navGoto)
function pickScene(sx, sy) -> { kind: 'person' | 'bubble' | 'floor' | null, id }   // floor view: floorAtY, towerPersonAt, personAt, bubbleAt (screen px to world, world to plan px of that floor); id = person id, conversation id or floor index; advanced view: advPick

// ui.js
function updateHud(office)                       // counters, summary, clock and the floor chip; it does not write the banner nor the plan button (app.js writes « Qui m'attend » and its count, the plan button, the banner and the empty state)
function updateFloorChip(index)                  // the chip top right of the scene: « 1er étage : Boutique », « 12 agents, 1 attend » or « Chantier en cours »
function showTip(person, sx, sy)                 // hover tip: name, role and service, state and since, lot
function hideTip()
function toast(text, ms, err)                   // err: error style
```

**Règle de zoom (`navFitZoom`).** `css = zoom / dpr`. On prend le plus grand `zoom` de `ZOOMS` tel que la largeur de l'immeuble tienne (`buildingSize(...).w * css <= viewW - 8`) et qu'un étage avec sa dalle tienne (`BLOCK * css <= viewH - 8`), mais jamais `css < 2` : si aucun zoom n'atteint 2, on prend `zoom = round(2 * dpr)` (au plus le dernier de `ZOOMS`) et on défile (verticalement toujours, de côté par `navPanTo`, trois arrêts : escalier, étage, ascenseur). Résultat visé : 1280 x 800 (zone utile 1216 x 752, en-tête de 48 px, barre de 64 px) à x2 : largeur 596 px x 2 = 1192 et `BLOCK` 368 x 2 = 736, donc la bande d'entrée et l'étage entier tiennent. Un téléphone de 390 x 844 reste à x2 (côté de la barre de 44 px, soit 346 px utiles pour 596 px x 2) : on défile de côté. Le zoom change toujours par pas entiers, jamais fractionnaire, et `floorCam.clampTo` garde l'immeuble dans la vue (centré s'il est plus petit). Un plateau plus large que 62 colonnes (jusqu'à 96) déborde à x2 à 1280 : la règle prend alors x2 quand même (`css >= 2`) et on défile de côté, au lieu de redescendre à x1.

Sur téléphone, trois boutons « Escalier », « Étage », « Ascenseur » (`#pan`) en bas de la scène appellent `navPanTo`.

`app.js` reprend la liaison de `web/app.js` : état et flux du service (`/api/state`, `/api/events`), fiche d'un agent, liste « Qui m'attend », plan de mission et « Valider le plan », « Ouvrir la conversation », « Répondre », « Arrêter », bandeau de connexion, état vide, messages à l'archivage. Il passe par `window.Pixel` (2.9), jamais par la portée de la scène, et ajoute `lot { title, state }` à chaque `OfficeAgent` avant `Pixel.state`. La fiche est une couche posée sur la scène (une feuille en bas sur téléphone) ; sa hauteur compte dans `insets` avec celle de la boîte de dialogue. Tant que `renderAdvanced` n'existe pas, le bouton « Vue avancée » reste caché.

### 2.9 Vue avancée (L9, L10) : `advanced.js`, `tubes.js`, `journal.js`, `techplan.js`

La coupe est calculée à partir des `FloorPlan` : chaque étage devient une bande, ses salles et ses postes sont mis à la suite de gauche à droite dans l'ordre des plans (chef, salles, postes libres, cafétéria), avec la tour d'escalier et le garde-corps de l'entrée à gauche, la cage d'ascenseur à droite, la rue en bas et la grue au sommet pendant un chantier.

```js
// advanced.js
const advCam = new Camera();                     // insets.right = width of #journal, set by nav.js; #pan also acts on it; framing: the largest integer zoom that fits the cut
function advLayout(floors) -> AdvLayout          // pure geometry in px: floor bands, desk and spot positions, tube ports, shaft; recomputed when floors change
function advPlace(person) -> { x, y, pose, dir } // from person.act and person.desk: at its desk, at the coffee corner, at the entrance rail, in the lift, in the lobby...
function renderAdvanced(g, T)                    // layers: sky, horizon and street (drawn here: drawCity of sky.js is tuned to 368 px floors), building, tubes (tubes.js), people (drawSprite, seated facing the viewer), bubbles (speech of CONVERSATIONS in play), lights (applyLight idea, simplified), crane.
                                                 // Leaves the identity transform on g and draws the world under translate(-advCam.x, -advCam.y); drawTechPlan does the same
function advPick(wx, wy) -> { kind, id } | null
function advHighlight(ids | null)                // journal hover: lights these people, dims the rest
function advFocus(id)                            // camera to this person, same as a click on a journal line

// tubes.js
function launchCapsule(fromPerson, toPerson, kind)   // kind: 'delegate' | 'report'; path from the sender's nozzle to the receiver's, across floors
function tickCapsules(dt)
function drawCapsules(g, T)
function drawCrane(g, T)                         // crane of the section, over the floor being built

// journal.js : fills #journal (2.10); lines come from TALK_LOG and onTalk
function buildJournal()                          // tabs Tout, Travail, Papotage, Alertes
function refreshJournal()
//   Travail = delegate, report, plan, answered, arrive, depart; Papotage = chat; Alertes = blocked, waiting
//   hover on a line: advHighlight([fromId, toId]); click: advFocus(id)

// techplan.js : the « Plan technique » view, drawn on the canvas when NAV.plan is true
function drawTechPlan(g, T)                      // blueprint: delegation tree from desk to desk, model under each desk
function techPlanLabels() -> [{ x, y, w, h, text }]   // every label, for the overlap test
```

Règles de lisibilité (défauts relevés sur les maquettes) : dans `techplan.js`, aucune étiquette ne recouvre une autre (le test `techPlanLabels` le vérifie sur la démo, y compris les modèles et le nom d'étage) ; dans la vue d'étage, le nom d'une salle est dessiné après les personnages ; une bulle ne passe jamais sous la boîte de dialogue (`Camera.insets`).

### 2.10 Page, liaison et points d'accroche (L6 ; L8 pour les tests de page)

Ids du balisage (`shell.html`, L6), avec ce qui y écrit :

| Id | Contenu | Écrit par |
|---|---|---|
| `#scene` (canevas) | la vue, étage ou avancée | boot.js |
| `#texte` (canevas) | couche de texte nette, mêmes dimensions que `#scene`, en pixels de l'appareil (2.4) | boot.js (taille), floor.js (contenu) |
| `#etages` (div) | barre d'étages à droite (boutons), avec `#zoom` (- ×2 +) et `#pan` (Escalier, Étage, Ascenseur, téléphone) à côté | facade.js, nav.js |
| `#puce` | puce d'étage en haut à droite de la scène | ui.js |
| `#bVueAvancee`, `#bPlanTech` | boutons de l'en-tête | ui.js (état), nav.js (action) |
| `#dialog` | boîte de dialogue à portraits | dialog.js |
| `#journal` | journal, onglets compris | journal.js |
| `#fiche`, `#bAttente`, `#bPlan`, `#bandeau`, `#toast` | fiche, « Qui m'attend », plan de mission, bandeau, messages (comme `web/index.html`) | app.js (bouton « Qui m'attend » et son compte, plan, bandeau, état vide), ui.js (compteurs, résumé, horloge, puce) |
| `#zone` (main), `#infobulle` | zone de la scène ; infobulle de survol | shell.html, ui.js |
| `#pied` | curseur d'heure de démonstration, seulement avec `?demo=1` | ui.js |

```js
// window.Pixel (boot.js), for app.js
window.Pixel = {
  state(office),             // -> applyOffice
  select(id | null),         // navGoto(floorOfPerson(id).index), setSelected
  filterWaiting(on),         // -> setWaitFilter
  portrait(canvas, id),      // -> drawPortrait
  view(mode),                // 'floor' | 'advanced'; no argument: returns the mode
  onAgentClick: null,        // set by app.js: (id) => open the card
  onFloorChange: null,       // set by app.js: (projectId | null) => the floor shown changed
  onViewChange: null,        // set by app.js: (mode) => the button state follows
  onOpenThread: null,        // set by app.js: (id) => opens the Boite thread of that agent; called by « Ouvrir la conversation » of the dialog box, falls back to onAgentClick
  toast(text, ms, err),      // message at the bottom of the scene
};
function applyOffice(office)     // boot.js. First state: everything placed without animation. Then, in this order:
                                 // syncFloors, syncPeople, syncTalk, refreshJournal, updateHud, advLayout when floors changed.
                                 // An empty state received while the core is not 'connected' is ignored (as in the isometric view).
function getOffice() -> OfficeState | null   // the last state applied
// Frame, in this order (boot.js): update: setFloorTiers, tickFloors, tickBuild, tickPeople, tickTalk, tickCapsules, tickParticles, navTick.
// render: renderBuilding (clears #texte, draws the labels) in the floor view, or renderAdvanced (then drawTechPlan if NAV.plan); presentBuffer; updateFloorBar.
```

Points d'accroche pour les tests et les captures : `window.__pixel` (boot.js, toujours présent, sans effet sur la page) :

```js
window.__pixel = {
  seed(n), hour(h | null), freeze(on), advance(seconds),   // advance runs the simulation without drawing: fast, reproducible
  floors(), people(), conversations(), log(), stats(),     // plain data copies for assertions
  goto(index), view(mode), emit(event),                    // emit: plays a fake OfficeEvent (L5 can work before L1 is done)
  perf(),                                                   // startLoop().stats()
  bubbles(), pick(sx, sy),                                  // bubbleRects of the shown floors; pickScene at a screen point
  // stats() also details applyOffice (per step)
};
```

Tests Bun (sans navigateur) : `test/floorplan.test.ts` (L3), `test/dialogues.test.ts` (L5, 1.12), `test/events.test.ts` (L1) chargent les fichiers purs seuls. `test/page.test.ts` (L8, Haiku) vérifie, pour `readPage()` : la page est assemblée, chaque script se lit, **aucun nom de premier niveau (`function`, `const`, `let`, `class`) n'est déclaré deux fois dans `web/pixel/`**, rien ne vient du réseau, ni tiret cadratin ou demi-cadratin, ni emoji ; et pour `readIsoPage()` les mêmes contrôles que l'actuel. Captures et mesures : `bun run demo` (`BUREAU_DEMO=gros` : 5 projets, 40 agents) vu avec `boite browser` en 1280 x 800 et 390 x 844, console sans erreur ; `scripts/mesure-pixel.js` (L8, sur le modèle de `scripts/mesure-vue.js`) lit `__pixel.perf()`.

### 2.11 Dépendances entre lots et ordre

| Lot | Dépend de | Peut commencer |
|---|---|---|
| L2 moteur | rien | tout de suite |
| L1 service | la partie 1 (1.4 à 1.6) | tout de suite |
| L3 immeuble et étages | L2 ; d'abord `floorplan.js` (pur, rapide, avec le test), puis `floor.js` (plateaux, tours, cabine, étiquettes) ; deux agents possibles, `floorplan.js` d'abord | après L2 |
| L4 personnages | L2 ; `findPath`, `FloorPlan`, `stairPoints`, `LIFT` de L3 | `sprites.js` après L2, `people.js` et `actions.js` (trajets par les tours) quand `floorplan.js` est livré |
| L7 ville et chantier | L2, `FloorPlan.lights` de L3, `WORKER_LOOK` de L4 | `sky.js` après L2, `build.js` après L3 et L4 |
| L5 discussions | `People` de L4, types de 1.4 | `dialogues.js` tout de suite (pur) ; `talk.js` après L4 ; intégration des vrais événements après L1 |
| L6 interface | L2, L3 (`floorScrollY`, `buildingSize`, `floorCam`), L4 (`drawPortrait`) | après L3 ; `shell.html` et `app.js` plus tôt si l'étape 0 les a posés |
| L9 vue avancée | L2, L3 (`FloorPlan`), L4 (`person.act`), L5 (`onTalk`) | après L5 |
| L10 journal et plan technique | L5 (`TALK_LOG`), L9 (`advLayout`, `advFocus`) | après L9 |
| L6 `boot.js`, version finale | tous les modules appelés (L9, L10 compris) | en dernier, petite reprise du squelette : retirer les gardes `typeof`, vérifier l'ordre de 2.10 |
| L8 assemblage | tous | à la fin : `page.ts` final, `page.test.ts`, `mesure-pixel.js`, démo, docs, wiki, changelog, pack |

Au plus 2 agents Sonnet en même temps : l'ordre proposé est L2 et L1 ; puis L3 et L4 ; puis L5 et L7 ; puis L6 et L9 ; puis L10 ; puis la reprise finale de `boot.js` par L6 ; L8 (Haiku) peut tourner avec n'importe quelle paire. Chaque lot livre quand son module répond à ce contrat et que ses tests passent ; une fonction d'un autre lot qui n'existe pas encore se remplace dans le harnais du lot, jamais dans le fichier de l'autre.

### 2.12 Budget de fluidité

Mesuré avec `bun run demo` en mode gros (`BUREAU_DEMO=gros` : 5 projets, 40 agents) et en mode normal (25 personnages), page ouverte avec `?demo=1`, fenêtre 1280 x 800, `__pixel.perf()` sur 5 s de `requestAnimationFrame`, 3 passages, médiane.

| Mesure | Seuil |
|---|---|
| Images par seconde, vue d'étage, 25 personnages, 2 ou 3 étages à l'écran, jour et nuit | au moins 60 |
| Images par seconde, vue avancée, capsules en cours | au moins 60 |
| Pire image hors charge machine | 34 ms au plus |
| CPU par image, vue d'étage (3 étages à l'écran ; la maquette B mesure 1,2 ms) | 3 ms au plus |
| CPU par image, vue avancée | 4 ms au plus |
| Mémoire allouée par image | 100 Ko au plus (objets créés par image : aucun dans les boucles de dessin) |
| `applyOffice` pour 40 agents | 2 ms au plus (le premier appel, 3 à 7 ms, est une exception acceptée ; 0,3 ms ensuite) |
| `layoutFloor` pour l'étage Boutique | 2 ms au plus |
| `findPath` sur un plateau de 96 x 44 cellules (4 224 cases, la largeur maximale) | 0,4 ms au plus |
| Décor statique d'un étage (plateau et dalle, 496 x 368 px au moins), première image | 30 ms au plus |
| Étages dessinés par image | 3 au plus (`__pixel.stats()`) |
| Décors en cache (étages, tours) | 24 Mo au plus (la maquette B : 17 Mo pour 5 étages) |
| Défilement d'un étage au suivant, pire image | 34 ms au plus (les étages voisins sont déjà en cache) |

Moyens, par fichier : décor statique (plateau et dalle) pré-rendu hors écran par (étage, version, ciel), cache de 12 canevas au plus, le ciel courant pour les étages de tier 0 et 1 ; décor des tours pré-rendu sur toute la hauteur par ciel, seuls la cabine et les passants sont redessinés ; étiquettes de la couche de texte mises en cache comme images (800 au plus) ; planches de sprites cuites une fois par apparence et variante ; atlas de police par couleur ; particules en tableaux typés (256) ; un tableau de tri réutilisé ; BFS sur tableaux typés ; texte d'une bulle rasterisé quand la bulle change, pas à chaque image ; masque de nuit à la taille du tampon, pools de lumière pré-calculés ; étages hors écran : simulés quatre fois par seconde avec le temps manqué (tier 2), pas dessinés ; vue avancée : bandes d'étage pré-rendues, seuls les personnages, capsules et bulles sont redessinés ; `getImageData` jamais dans la boucle ; boucle suspendue quand l'onglet est caché.

### 2.13 Points ouverts

**Modèle B : chiffres retenus.** Plateau de 44 rangées de 8 px (352 px) sur 62 à 96 colonnes (496 à 768 px), dalle de 16 px, bloc de 368 px, tour d'escalier de 56 px à gauche, gaine d'ascenseur de 44 px à droite, 80 px de ciel au-dessus et 24 px de rue au pied. Cinq étages à 62 colonnes : 596 x 1 944 px. À x2 sur 1280 x 800 (zone utile 1216 x 752) : 1 192 x 736 px par étage, donc l'étage entier, sa dalle et sa bande d'entrée tiennent (règle de zoom de 2.8) ; avec la boîte de dialogue ouverte, `Camera.insets` décale la vue et la caméra défile. La maquette B fait 392 px de bloc : à x2 elle déborde de 32 px, c'est le défaut relevé. Ce contrat retire 16 px (salle de 216 à 200 px, dalle de 24 à 16 px) ; **validé par le chef le 2026-11-14**, sans objection d'art de Design : si on garde 392 px, la règle de zoom ne peut plus montrer un étage entier à x2 sur 1280 x 800.

**Noms changés par la révision pour le modèle B** (tout le reste de 2.3 à 2.10 est inchangé ; la vue avancée, 2.9, ne change qu'une phrase sur le balcon) :

| Fichier | Retiré ou renommé | Remplacé par ou ajouté |
|---|---|---|
| `floorplan.js` | `layoutFloor(spec)` ; `FloorPlan.balcony`, `FloorPlan.lobby` | `layoutFloor(spec, cols)` ; `hall`, `entrance`, `door`, `landY`, `rooms[].cols` ; `FloorSpec.index`, `title` ; `buildingCols`, `buildingSize`, `floorTop`, `floorAtY`, `floorScrollY`, `floorTitle`, `stairPoints` ; constantes `PLATE_ROWS`, `PLATE_H`, `SLAB`, `BLOCK`, `STAIRS_W`, `LIFT_W`, `SKY_H`, `GROUND_H`, `COLS_MIN`, `COLS_MAX` |
| `floor.js` | `renderFloorView(g, fl, cam, T)` ; `Floor.doors { lift, stairs, entry, glass }`, `openDoor` sur `'lift'` et `'stairs'` | `renderBuilding(g, tg, cam, T)` ; `doors { entry, glass }` ; `Floor.title`, `y`, `dy`, `tier` ; `LIFT`, `liftStopY`, `setFloorTiers`, `floorToScreen`, `drawFloorLabels` ; `syncFloors` rend aussi `shiftY` |
| `people.js`, `actions.js` | `personAt(fl, wx, wy)` en pixels monde | `personAt(fl, px, py)` en pixels plan ; `Person.tz`, `wx`, `wy` ; `peopleInTowers`, `towerPersonAt` ; `personTravel`, `personRideLift`, `personRideStairs` |
| `talk.js` | `drawBubbles` ne dessine plus les noms ; `bubbleAt(fl, wx, wy)` en pixels monde | les noms vont à `drawFloorLabels` ; `bubbleAt(fl, px, py)` en pixels plan ; `bubbleRects(fl)` |
| `sky.js` | `drawFacadeSky`, `windowLit` | rien (plus de colonne de façade) ; `drawCity` change de sens (fond, ciel, rue) |
| `build.js` | `drawFacadeCrane(g, x, y, fl, T)` | `drawFloorCrane(g, fl, T)` |
| `nav.js` | `NAV.ride`, `renderRide`, `navGoto(index, 'ride' \| 'cut')` | `NAV.ty` ; `navGoto(index, 'smooth' \| 'now')`, `navStep`, `navPanTo`, `navFitZoom`, `navZoomBy` |
| `facade.js` (nom de fichier gardé) | `drawFacade(canvas, T)`, `facadeFloorAt` | `buildFloorBar`, `updateFloorBar(T)` (barre de boutons à droite) |
| `ui.js` | | `updateFloorChip(index)` |
| `shell.html` | `#facade` | `#texte`, `#etages`, `#zoom`, `#pan`, `#puce` (2.10) |

**Points ouverts**

1. Les tours (décor de l'escalier et de la gaine, cabine) sont dans `floor.js` (L3) : c'est la carcasse commune. La grue est dans `build.js` (L7). Si L3 devient trop gros, le chef peut la couper en deux agents (`floorplan.js` puis `floor.js`, 2.11) ; les noms ne changent pas.
2. La couche de texte `#texte` est nouvelle (B : « petits textes nets pour les noms »). `font.js` ne change pas : `drawFloorLabels` rasterise le texte avec `drawText` et `textWidth` dans un petit tampon puis l'agrandit par un facteur entier.
3. Une seule cabine, une personne à la fois (`LIFT.owner`) : les autres attendent sur leur palier. Si la démo en gros (40 agents) montre des files, on décidera d'une seconde cabine ; le contrat de `LIFT` est prêt pour un tableau, pas encore écrit ainsi.
4. L'ordre des étages est celui de 2.1 (9) : un étage du milieu démoli fait descendre ceux du dessus (`Floor.dy`), un étage ajouté au sommet décale le monde de `BLOCK` (`shiftY`).
5. La vue avancée ignore `Floor.y` et `dy` : elle lit les `FloorPlan` et `person.act`.

Les noms de 2.3 à 2.10 ne changent qu'avec un accord écrit ici.

## 3. Vérification

### 3.1 Commandes

```sh
bun run check                       # tsc, sans erreur
bun test                            # tests du service, des registres, de la page et des fichiers purs
bun run pack                        # bureau.js, skills et sha256 dans boite-plugin.json
bun run check:manifest
bun scripts/check-wiki.ts           # liens et contenu du wiki
bun run demo                        # mode normal : 3 projets, un 4e à 30 s (étage en chantier, grue), son équipe vers 44 s
BUREAU_DEMO=gros bun run demo       # mode gros : 5 projets, 40 agents au départ (39 après 34 s : sv-a20 quitte l'étage)
```

Mesure (démo en mode gros, page ouverte avec `?demo=1`, fenêtre 1280 x 800, `scripts/mesure-pixel.js`) :

```sh
boite browser eval "$(cat scripts/mesure-pixel.js)"
boite browser eval "__mesurePixel.start({passes: 3})"   # environ une minute
boite browser eval "__mesurePixel.get()"                  # tableau, puis JSON
```

Le script lit `__pixel.perf()` (temps de calcul) et la durée entre deux images (pire image). Chaque passage dure 5 s, précédés de 1,5 s d'attente. Médiane de 3 passages.

### 3.2 Mesure de fluidité

Relevée le 2026-11-14, démo en mode gros, fenêtre 1280 x 800, 3 passages, médiane.

| Mesure | images/s | pire image (ms) | CPU/image (ms) | CPU max (ms) | Ko/image | budget |
|---|---|---|---|---|---|---|
| Étage, jour (3 étages à l'écran) | 75 | 13,5 | 0,62 | 2 | 11 | tenu |
| Étage, nuit (3 étages à l'écran) | 74,4 | 40 | 0,63 | 1,4 | 10 | dépassé |
| Défilement d'un étage au suivant | 75 | 13,5 | 0,79 | 1,8 | 13 | tenu |
| Vue avancée, capsules en cours | 75 | 13,5 | 0,63 | 1,5 | 3 | tenu |
| Plan technique | 75 | 13,6 | 0,83 | 1,8 | 6 | tenu |

Budget (2.12) : images/s au moins 60, pire image au plus 34 ms, CPU/image au plus 3 ms (étage) et 4 ms (vue avancée), Ko/image au plus 100.

- Étage de nuit : un seul passage a dépassé (40 ms). Relancé seul, trois passages donnent une pire image de 26,7 ms, budget tenu. Le temps de calcul JavaScript reste à 2,5 ms au plus : l'écart vient d'hors de la boucle (composition du navigateur, ramasse-miettes), cause non trouvée.
- 75 images/s est probablement le rafraîchissement de l'écran de mesure, pas un plafond de la vue.
- Les personnages et les conversations de la démo continuent de changer pendant la mesure : elle n'est pas figée.

### 3.3 Démo

- Mode normal : le 4e projet « Portail partenaires » apparaît dans la barre d'étages à 30 s ; son étage est en chantier vers 38 s (« Chantier en cours », mât de grue à droite de la tour, petit à cette taille : à vérifier de visu) ; son équipe (Manager Développement, API partenaires, Documentation) est arrivée vers 44 s.
- Mode gros : 5 projets. 40 agents au départ, 39 à partir de 34 s (`sv-a20` quitte l'étage, comme prévu dans `scripts/demo.ts`).
- Rien à corriger dans `scripts/demo.ts` pour l'arrivée d'un nouveau projet vers 40 s.

### 3.4 Captures de référence

Dans `docs/captures/`, prises le 2026-11-14 sur la démo normale (`bun run demo`, `?demo=1`) :

| Fichier | Vue | Taille |
|---|---|---|
| `docs/captures/pixel-etage.png` | étage « Boutique », jour (12:00) | 1280 x 800 |
| `docs/captures/pixel-nuit.png` | étage « Boutique », nuit (03:00) | 1280 x 800 |
| `docs/captures/pixel-chantier.png` | étage « Portail partenaires » en chantier, avec la grue au sommet (démo normale, vers 38 s) | 1280 x 800 |
| `docs/captures/pixel-avancee.png` | vue avancée avec le journal | 1280 x 800 |
| `docs/captures/pixel-plan.png` | plan technique | 1280 x 800 |
| `docs/captures/pixel-mobile.png` | étage « Boutique » sur téléphone | 390 x 844 |

`docs/capture.png` (image du README) est une copie de `pixel-etage.png`. Les captures isométriques (`docs/captures/immeuble-*.png`) restent dans le dépôt, sans être référencées par le README ni le wiki.

### 3.5 Limites connues

1. `scripts/demo.ts` crée son registre dans le dossier temporaire du système (`os.tmpdir()`), pas dans `F:dev-tmp` : à changer si la règle des fichiers temporaires s'applique à la démo.
2. Pic de 40 ms unique sur l'étage de nuit (3.2), non reproduit à 26,7 ms sur une nouvelle série.
3. Sur le plan technique (`pixel-plan.png`), les étiquettes de postes voisins sont serrées (« Sonnet » sur deux lignes) : à relire à l'œil.
