# Vue immeuble : contrat des modules

La vue de Bureau devient un immeuble isométrique : un étage par projet Boite, les agents de ce projet à leurs bureaux. Ce document fixe le découpage du code, les données reçues du service, les fonctions que les modules s'échangent et le budget de fluidité. Il fait foi entre les modules ; un changement d'interface se décide ici d'abord.

Origine : la maquette B3 (immeuble fermé, ville vivante, fluidité mesurée), découpée telle quelle en fichiers puis branchée sur les vraies données.

## 1. Décisions de produit

1. Vue isométrique 2.5D, seule vue : pas de bascule vers l'ancienne vue 2D.
2. Un étage par projet Boite qui a au moins une conversation non archivée. Les conversations sans projet vont à l'étage « Sans projet ». Un nouveau projet ajoute un étage au sommet, construit en animation (grue, dalle, murs, mobilier), puis ses agents arrivent.
3. Ordre des étages : celui de la première apparition, gardé dans `localStorage` (clé `bureau.immeuble.etages`). Au premier chargement : l'ordre de `projects.list`. Un projet qui n'a plus de conversation pendant 20 s perd son étage : ses agents sortent, puis l'étage est démoli (le chantier rejoué à l'envers) et les étages du dessus descendent. Le rez-de-chaussée, qui porte l'entrée, n'est jamais démoli : il reste vide. Un projet qui revient pendant la démolition fait reconstruire son étage.
4. Étages sans écart, façade continue. Un étage qu'on ne regarde pas est fermé : murs, fenêtres éclairées selon le nombre d'agents présents, une ou deux fenêtres ambre qui pulsent quand des agents attendent l'utilisateur. Seul l'étage regardé s'ouvre.
5. Aucune étiquette d'étage à côté de l'immeuble. Le panneau « Immeuble » en haut à gauche suffit : par étage, nom, nombre d'agents, jauge, « N attend » en ambre, « Plan à valider » quand une mission attend.
6. Heure toujours réelle. Le réglage manuel de l'heure n'existe que derrière `?demo=1`.
7. Ville vivante autour : piétons, feux, bus, voitures, commerces, parc. Elle ne doit pas coûter la fluidité.
8. Zoom (molette au curseur, pincement, boutons, touches + et -), déplacement (glisser, flèches), rotation (Q et E par quart de tour, clic droit glissé, deux doigts), recentrage (double clic, 0). PageHaut et PageBas changent d'étage, Échap revient à l'ensemble.
9. Éclairage selon l'heure (matin, journée, soir, nuit, lampes aux bureaux occupés).
10. Un agent qui change de projet prend l'ascenseur jusqu'à son nouvel étage.
11. Chantier à chaque nouveau projet (étage entier) et à chaque nouvelle mission ou équipe sur un étage existant (sa zone se construit : barrière, sol, cloisons, bureaux).
12. Niveau de détail automatique selon le zoom et le nombre d'agents.
13. Survol d'un agent : bulle (nom, rôle et service, état et depuis quand, lot de mission s'il en a un). Un agent qui attend l'utilisateur est entouré d'ambre et son nom reste affiché.
14. On garde tout ce que fait la vue actuelle : fiche d'un agent (portrait, rôle, service, supérieur, modèle, état, depuis, fichiers, dernier rapport, question), « Ouvrir la conversation », « Répondre », « Arrêter », « Qui m'attend », « Plan de mission » et « Valider le plan », bandeau de connexion, départ par la porte d'entrée avec un message à l'archivage, état vide, `prefers-reduced-motion`.

## 2. Données reçues du service

`src/model.ts` reste le contrat unique. Ajouts :

```ts
/** A Boite project, as projects.list gives it, without its path. */
export interface ProjectInfo {
  id: string;
  name: string;
}
// OfficeState
  /** Every project Boite knows, in projects.list order. The view keeps those that have a team. */
  projects: ProjectInfo[];
// Team
  /** The root thread's project, null when it has none. */
  projectId: string | null;
// OfficeAgent
  /** Epoch ms the thread was created: the plan seats the oldest first. */
  createdAt: number;
```

Le service relit `projects.list` quand un fil arrive dans un projet qu'il ne connaît pas (une fois par projet).

Le chemin d'un projet n'est jamais envoyé à la page. Le flux ne change pas : `GET /api/state`, puis `GET /api/events` (événement `state`, l'`OfficeState` entier à chaque changement), actions `POST /api/reveal`, `/api/stop`, `/api/missions/:id/validate`.

## 3. Assemblage de la page

`src/page.ts` assemble `web/index.html` (balisage et CSS, marque `<!-- scripts -->`), les modules de `web/immeuble/` dans l'ordre de `SCENE_FILES`, tous dans une seule fonction en mode strict (une portée commune, comme dans la maquette), puis `web/app.js` dans un second script. `src/main.ts` l'appelle en macro Bun (la page est figée dans `bureau.js`) ; `scripts/demo.ts` la relit à chaque requête : une modification se voit en rechargeant la page, sans relancer la démo.

Règles de la portée commune :
- un nom déclaré deux fois casse la page : `bun test test/page.test.ts` le détecte ;
- un nom de premier niveau qu'un autre module utilise fait partie du contrat : pas de renommage ni de changement de signature sans accord ;
- un module ne s'exécute pas au chargement, sauf `boucle.js` (le dernier) qui démarre tout ; les autres ne font que déclarer ;
- `app.js` ne voit pas la portée de la scène : il passe par `window.Immeuble`.

## 4. Modules et propriétaires

| Module | Fichiers | Fait |
|---|---|---|
| moteur | `web/immeuble/noyau.js`, `moteur.js`, `controles.js`, `boucle.js`, `scripts/mesure-vue.js` | projection, caméra, zoom, déplacement, rotation, ouverture d'un étage, clics et survol, boucle d'images, passes de rendu, caches hors écran, niveau de détail, `window.Immeuble`, `window.__bureau`, mesure |
| immeuble | `web/immeuble/etages.js`, `chantier.js` | étages à partir d'un `FloorSpec`, zones et bureaux, murs, façade, fenêtres, toit, entrée, mobilier, chantier d'un étage et d'une zone |
| agents | `web/immeuble/agents.js` | personnages, déplacements, états, ascenseur, entrée et départ, portrait de la fiche, contour ambre, filtre « Qui m'attend » |
| ville | `web/immeuble/ville.js`, `lumiere.js` | ville et sa vie, ciel, soleil, lune, étoiles, éclairage selon l'heure, halos |
| interface | `web/index.html`, `web/app.js`, `web/immeuble/hud.js` | en-tête, panneau Immeuble, bulle, outils, horloge, fiche, listes, plan, boutons, messages, bandeau, état vide, mobile, accessibilité |
| donnees | `web/immeuble/plan.js`, `donnees.js`, `src/model.ts`, `src/state.ts`, `src/service.ts`, `scripts/demo.ts`, `test/plan.test.ts`, `test/state.test.ts`, `test/helpers.ts`, `test/service.test.ts` | projets dans l'état, plan de l'immeuble (pur), application d'un `OfficeState` à la scène, démo |

Hors modules (manager) : `src/page.ts`, `src/main.ts`, `test/page.test.ts`, `docs/`, `wiki/`, `README.md`, `boite-plugin.json`.

## 5. Interfaces entre modules

Noms existants de la maquette à garder : `floors`, `agents`, `AGM`, `agentById`, `T`, `cam`, `camT`, `focus`, `setFocus`, `fitNow`, `zoomBy`, `rotateBy`, `reduced`, `curMin`, `LT`, `pp`, `dep`, `g`, `ctx`, `hover`, `EL`, `toast`.

### plan.js (donnees), pur

```js
/** cap = {zones(floorIndex) -> number, seats -> number}: given by etages.js (CAPACITE). memo = remembered floor order (project ids). */
function planImmeuble(office, memo, cap) -> { floors: FloorSpec[], order: string[] }
FloorSpec = { id, name, zones: ZoneSpec[], chefId, stats, missions }
  // id: project id, '' for « Sans projet »; stats = {total, running, waiting, queued, done, error}; missions = [{id, status, title}]
ZoneSpec = { key, label, service, leadId, memberIds, colorKey }
  // key stable (service name or manager id); leadId sits on seat 0; memberIds in stable order (oldest first)
  // more members than cap.seats - 1: the extra ones get no desk (they stand in the zone)
  // more zones than cap.zones(i): the smallest merge into a zone « Autres »
```

Composition d'un étage : le chef de l'équipe la plus récemment active occupe le bureau vitré ; chaque service (déclaré par `bureau-role`, sinon chaque manager) devient une zone, son manager en tête ; les autres équipes du projet deviennent chacune une zone (leur racine en tête) ; les conversations seules (racine sans enfant) vont dans une zone « Conversations ».

### etages.js et chantier.js (immeuble)

```js
const CAPACITE = { zones(i), seats };           // read by planImmeuble: 3 zones on the ground floor, 4 above, 6 seats a zone
function floorBuilt(fl) -> boolean               // no chantier, or it is over
function zoneBuilt(fl, zoneKey) -> boolean       // the zone is finished or never had a chantier
function floorEmpty(fl) -> boolean               // nobody left on the floor, windows dark
function demolishFloor(fl, animate) -> boolean   // chantier played backwards, then removeFloor: the floors above come down
function reviveFloor(fl) -> boolean              // the project came back during the demolition: built again from there
function addFloor(spec, animate) -> fl           // on top; animate: chantier, then the floor closes
function updateFloor(fl, spec, animate)          // name, new zones (zone chantier when animate), zone labels
function deskFor(fl, zoneKey, seat) -> desk|null // seat 0 = lead; 'chef' for the glass office
// fl: { i, id, name, z0, zones, desks, spots: {counter, table, idle, bench, stand}, plot, op, vis, lift, stats, missions, office, ver, ... }
// fl.spots.stand = [{c: [cx, cy], busy, zone: zoneKey}]: standing places for agents without a desk
// fl.office.doorPt: the glass office door, opened by the engine; fl.ver: bumped when the static decor changes
// drawing used by the engine: drawBuilding(night), drawOpen(fl), closedBody(fl, roof), floorBox(fl, top, union)
```

### agents.js (agents)

```js
function spawnAgent(info, fl, desk, how, zoneKey) -> a  // info: OfficeAgent; how: 'instant' (first load) | 'door' (walks in, lift)
function setAgentState(a, info)                  // info: the new OfficeAgent; behaviour from state (table below)
function moveAgent(a, fl, desk, zoneKey)         // lift when the floor changes, walk otherwise; zoneKey places an agent without desk
function leaveAgent(a)                           // lift to the ground floor, out by the door, then removed
function setWaitFilter(on)                       // « Qui m'attend »: dims everyone but the waiting agents
function setSelected(id)                         // white ring under the agent whose card is open
function drawPortrait(canvas, id)                // the agent's face and bust for the card
// a: { id (thread id), info (OfficeAgent), fl, hf (home floor), team (zone key), x, y, st: run|att|pause|file|fini|err, alpha, inCab, leaving, ... }
```

| État (`OfficeAgent.state`) | Sur la scène |
|---|---|
| `running` | assis à son bureau, écran allumé, tape |
| `waiting` | assis, main levée, bulle « ? », contour ambre, nom affiché |
| `queued` | à l'arrivée : banc de l'entrée ; ensuite : à son bureau, bulle sablier |
| `idle` | pause à la cafétéria de l'étage, gobelet |
| `done` | rend son dossier à son responsable, puis cafétéria, grisé |
| `error` | assis, bulle rouge |
| absent de l'état | ascenseur, sortie par la porte d'entrée |

### donnees.js (donnees)

```js
function applyOffice(office)   // diff with the previous state: floors (addFloor/updateFloor), agents (spawn/setState/move/leave)
function agentInfo(id) -> OfficeAgent | null
function floorOfAgent(id) -> fl | null
function finishFloor(fl, quiet)   // the engine calls it when a floor chantier ends; then the floor's agents walk in
function floorDemolished(fl)      // chantier.js calls it when a demolished floor has left the building
```

`applyOffice` copie sur chaque étage `fl.id`, `fl.name`, `fl.stats` et `fl.missions` à chaque état. `app.js` ajoute `lot {title, state}` à chaque `OfficeAgent` avant `Immeuble.etat` ; `a.info` le garde pour la bulle. Un état vide reçu pendant que le core n'est pas `connected` est ignoré.

Premier état reçu : tout est placé sans animation. Ensuite : animations. Un étage est construit avant que ses agents n'entrent.

### hud.js (interface)

```js
function buildPanel()            // panneau Immeuble, rebuilt when floors change
function updateUI(force)         // counters, gauges, clock; called by the engine about 4 times a second
function showBulle(a, x, y)      // hover bubble; hideBulle()
function toast(text, ms)
```

Le clavier de la scène (Q, E, +, -, 0, flèches, PageHaut, PageBas, Échap) est au moteur (`controles.js`) ; `app.js` prend Échap en premier tant qu'une fiche est ouverte.

### moteur.js (moteur)

```js
function drawCached(fl, name, ver, fn, top = 60)  // static decor of a floor kept as a bitmap; ver < 0: no cache (chantier)
```

### window.Immeuble (moteur, dans boucle.js), pour app.js

```js
window.Immeuble = {
  etat(office),             // -> applyOffice
  selectionner(id | null),  // focus the agent's floor, centre on it, setSelected
  filtrerAttente(on),       // -> setWaitFilter
  portrait(canvas, id),     // -> drawPortrait
  surClicAgent: null,       // set by app.js: (id) => open the card
  surEtage: null,           // set by app.js: (projectId | null) => the floor shown changed
};
```

## 6. Budget de fluidité

Mesuré avec `bun run demo` en mode gros (`BUREAU_DEMO=gros` : 5 projets, 40 agents), page ouverte avec `?demo=1` (sinon l'heure ne se règle pas), fenêtre 1280x800, harnais `scripts/mesure-vue.js` (injecté dans la page, événements pointeur synthétiques et `requestAnimationFrame`), 3 passages, médiane.

| Mesure | Seuil |
|---|---|
| Images/s en glisser, zoom, rotation, jour et nuit | au moins 60 |
| Pire image hors charge machine | 34 ms au plus |
| CPU par image, vue d'ensemble | 3 ms au plus |
| CPU par image, étage ouvert | 4 ms au plus |
| Mémoire allouée par image | 150 Ko au plus |
| `applyOffice` pour 40 agents | 2 ms au plus |

Moyens : décor statique pré-rendu hors écran, étages fermés en façade seule, tri de profondeur mis en cache par angle, aucune allocation inutile par image, niveau de détail, rien de dessiné hors écran.

## 7. Vérification

- `bun run check`, `bun test` (0 échec), `bun run check:manifest`, `bun run pack` puis manifeste commité, `bun scripts/check-wiki.ts`.
- `bun run demo` vu avec `boite browser` : ensemble, étage ouvert, nuit (`?demo=1`), nouveau projet en chantier, survol d'un agent, 390 px de large ; console sans erreur.
- Textes visibles en français, sans tiret cadratin ni demi-cadratin, sans emoji ; aucune ressource réseau ; code et commentaires en anglais.
