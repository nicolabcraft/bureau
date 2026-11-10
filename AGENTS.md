# Travailler sur Bureau

Bureau est un plugin Boite (manifeste schema 2, runtime `bun`) : un service qui sert une vue « open space » sur 127.0.0.1, ouverte dans l'onglet navigateur du panneau de Boite, plus des commandes et des skills qui donnent aux agents une organisation chef, managers, agents. Lire `docs/conception.md` et `docs/commandes.md`.

## Commandes

```sh
bun install
bun run check      # tsc
bun test           # tests du service, du registre et des commandes
bun run pack       # bureau.js + skills et sha256 dans boite-plugin.json
boite plugin dev . # depuis un terminal, pas d'un agent
```

## Règles

- Code et commentaires en anglais ; README, interface, sorties des commandes, skills et commits en français (`type: résumé`).
- Contrat de données unique : `src/model.ts`. La vue (`web/index.html`) ne fait que dessiner un `OfficeState`.
- Bureau parle à Boite seulement par le RPC du core avec son jeton de plugin (`threads.read`, `threads.write`, `ui.reveal`).
- Aucune ressource distante dans la vue. Pas de tiret cadratin ni demi-cadratin dans les textes visibles, pas d'emoji dans l'interface.
- `boite-plugin.json` : `commands`, `prompt`, `slashCommands` à la main ; `skills` et `artifacts` écrits par `bun run pack`.
