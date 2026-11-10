# Bureau : conception (proposition du 2026-11-08)

Plugin Boite (manifeste schema 2) en deux morceaux : la fenêtre qui montre le bureau, et l'organisation qui cadre le travail des agents.

## 1. Ce que Boite donne à un plugin
- Pas de point d'extension pour dessiner dans la fenêtre de Boite (vérifié dans beboite/boite 6ee6740, `PluginProvides` : accountPools, desktopApp, gateway, service, commands, skills, prompt, slashCommands).
- Choix (la vue doit être DANS Boite, 2026-11-08) : un `service` en runtime `bun` (un seul .js pour toutes les machines) sert une page locale `http://127.0.0.1:<port>` mise à jour en direct (SSE) ; elle s'ouvre dans l'onglet navigateur du panneau de Boite (`boite browse`, qui accepte localhost). Commande `/bureau` pour l'ouvrir.
- Plus tard, possible : PR amont dans Boite pour un vrai onglet « plugin » du panneau.
- Permissions demandées :
  - `threads.read` : `threads.list`, `threads.get`, événements `thread.created`, `thread.updated`, `turn.started`, `turn.finished`.
  - `threads.write` : `threads.create`, `turns.start` pour lancer une mission depuis la fenêtre.
  - `ui.reveal` : « Ouvrir la conversation » amène Boite sur le bon fil.
- Pas de `desktopApp`.
- Données d'un fil utiles : `status` (idle, queued, running, waiting, ...), `parentThreadId` (qui a délégué à qui), `model`, `runningSince`, `title`, `doneAt`.
- Commandes `boite <nom>` pour les agents (reçoivent `BOITE_CALLER_THREAD_ID`), skills, ligne de guide, commandes `/` du composeur.
- Dossier privé `BOITE_PLUGIN_DATA` pour le registre des rôles.

## 2. L'organisation (orchestrateur)
Fondée sur une recherche du 2026-11-08 : rôles qui reviennent le plus (CrewAI, MetaGPT, ChatDev, BMAD, Claude Code agent teams, LangGraph) et niveau d'autonomie conseillé.

### Rôles
| Rôle | Fait | Ne fait pas |
|---|---|---|
| Chef de projet | lancé par `/mission <demande>` ; écrit `mission.md` (objectif, lots, qui, modèle, budget), le montre, attend « Valider le plan », puis nomme les managers utiles ; rend le bilan | ne code pas ; ne valide jamais son propre plan |
| Manager Produit | précise le besoin : critères d'acceptation, questions groupées pour l'utilisateur | ne choisit pas la technique |
| Manager Architecture | découpe technique, fichiers attribués par agent, ordre des lots | n'écrit pas le code des agents |
| Manager Développement | briefs de 30 lignes, modèle le moins cher qui suffit, relit chaque rendu, renvoie une fois en correction | ne touche pas aux fichiers de ses agents |
| Manager Design (si visuel) | applique les skills de design de l'utilisateur : 3 options montrées avant tout code | n'applique rien sans le choix de l'utilisateur |
| Manager Qualité | tests, relecture indépendante, sécurité, avant le bilan | ne corrige pas lui-même : renvoie au manager concerné |
| Agent | un lot, seulement ses fichiers, rapport au format fixe | pas de commit, push ni suppression sans ordre |

Le chef ne crée que les managers utiles à la mission (une correction simple : Développement + Qualité). Pas de scrum master : seul BMAD l'a eu et l'a abandonné.

### Autonomie (ce que la recherche soutient)
1. Le chef montre son découpage avant de lancer quoi que ce soit (CrewAI planifie avant de déléguer, BMAD garde l'humain sur chaque artefact, Codex ne délègue que sur demande).
2. Après « Valider le plan » : lecture, recherche, maquettes et tests partent seuls.
3. Restent bloqués jusqu'à l'utilisateur : commit, push, merge, suppression, prod, dépense hors budget.
4. Budget par mission (nombre d'agents, modèles autorisés) fixé dans le plan ; dépassement = nouvelle validation.
5. Défaut à ne pas reproduire : le lead de Claude Code agent teams approuve seul les plans de ses coéquipiers.

### Outils du plugin
- `boite bureau-role <chef|manager|agent> [--service <nom>] [--chef <id>]` : le fil appelant déclare son rôle ; un responsable lancé avec `boite thread new` se rattache à son chef avec `--chef`.
- `boite bureau-plan <fichier mission.md>` : le chef dépose son plan ; la vue l'affiche avec « Valider le plan ».
- `boite bureau-mission [--json]` : organigramme et état de la mission.
- `boite bureau-rapport <fichier|texte>` : rapport d'un agent vers son manager.
- `/mission <demande>` et `/bureau` (ouvrir la vue) dans le composeur. Skills : `bureau-chef`, `bureau-manager`, `bureau-agent`.

La délégation passe par `boite delegate spawn` (hiérarchie via `parentThreadId`), mais Boite n'autorise qu'un étage : un sous-agent ne peut pas lancer d'agents. Les trois étages (chef, responsables, agents) viennent donc de deux mécanismes :
- le chef lance chaque responsable avec `boite thread new` (conversation indépendante, sans `parentThreadId`, son premier rapport revient au chef) ;
- le responsable se rattache au chef avec `boite bureau-role manager --service <nom> --chef <id du chef>` (lien `chefId` dans le registre) et lance ses agents avec `boite delegate spawn`.

Bureau place un fil à lien `chefId` sous son chef comme s'il en était l'enfant ; le chef, ses responsables et leurs agents forment une seule équipe, racine = le chef. Sans rôle déclaré, la vue devine : racine = chef, niveau 1 = manager, niveau 2 = agent.

### Ce qui distingue Bureau (manques relevés partout)
- Surface de contrôle, pas seulement d'observation : valider le plan, arrêter un agent (`turns.stop`), ouvrir la bonne conversation (`ui.reveal`).
- File « Qui m'attend » commune à tous les agents et tous les fournisseurs (Claude, Codex, OpenCode, Gemini : Boite les unifie déjà).
- Hiérarchie dessinée, plan de mission visible, plusieurs projets = plusieurs salles.
- Limite : répondre à une permission reste dans la conversation (le plugin n'a pas le droit `allow`) ; le bouton « Répondre » y amène.

## 3. La fenêtre
Chaque fil devient un bonhomme ; son état donne sa posture (tape, main levée, café, attend, rangé). Clic = fiche et « Ouvrir la conversation ». Filtre « Qui m'attend ». Direction graphique : option A (open space pixel art), retenue.

Organisation de la scène (v2) : bureau vitré du chef en haut, une zone par service (sol de couleur, cloisons basses, panneau nom et responsable), puis la cafétéria, le banc d'attente et la porte d'entrée en bas ; le trottoir, à droite de la porte, est d'où les agents arrivent. Les déplacements suivent un graphe de couloirs (plus court chemin, obstacles : bureaux, cloisons, mobilier) ; une porte s'ouvre quand le chemin d'un personnage la traverse. États au repos (`idle`, `done`) : cafétéria ; `queued` : banc ; autres : bureau.

## 4. Livraison proposée
GitHub public `nicolabcraft/bureau`, installable par Réglages > Plugins > Ajouter depuis une URL git.
