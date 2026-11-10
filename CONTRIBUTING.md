# Contribuer à Bureau

Merci de votre intérêt. Bureau est un plugin de [Boite](https://github.com/mtsu-dev/boite) : un service qui sert une vue « open space » sur 127.0.0.1, des commandes `boite bureau*` et trois skills (chef, manager, agent). Lisez [AGENTS.md](AGENTS.md) pour les règles du code, [docs/conception.md](docs/conception.md) pour l'architecture et le [wiki](https://github.com/nicolabcraft/bureau/wiki) pour l'usage.

Participer au projet, c'est accepter son [code de conduite](CODE_OF_CONDUCT.md). Une faille se signale en privé, comme [SECURITY.md](SECURITY.md) le décrit, jamais dans une issue publique.

## Installer

Il faut [Bun](https://bun.sh) dans la version de `packageManager` (champ de `package.json`).

```sh
git clone https://github.com/nicolabcraft/bureau.git
cd bureau
bun install --frozen-lockfile
```

## Lancer la démo

```sh
bun run demo
```

Le vrai service tourne contre un faux core qui fait vivre une équipe réaliste. La commande affiche l'adresse à ouvrir dans un navigateur (dans Boite : `boite browse <adresse>`). Aucune installation de Boite n'est nécessaire.

Pour essayer le plugin dans Boite, depuis un terminal (pas depuis un agent) : `boite plugin dev .`.

## Vérifier avant d'envoyer

```sh
bun run check            # types (tsc)
bun test                 # tests du service, du registre, des commandes, de l'archivage, du manifeste
bun run check:manifest   # boite-plugin.json contre les règles du schema 2
```

La CI relance ces trois commandes, plus un contrôle sans tiret cadratin ni demi-cadratin et le contrôle du wiki (`bun scripts/check-wiki.ts`).

Quand vous modifiez un skill (`skills/*.md`) ou le code du service, lancez aussi `bun run pack` et commitez `boite-plugin.json` : il contient le texte des skills et l'empreinte sha256 de `bureau.js`. Le même code donne toujours la même empreinte, sur toutes les machines. La CI de release refuse un manifeste qui diffère de celui que `pack` produit.

## Règles du projet

- Code et commentaires en anglais. README, wiki, interface, sorties des commandes, skills et commits en français.
- Pas de tiret cadratin ni demi-cadratin dans les textes, pas d'emoji dans l'interface.
- Aucun secret, jeton, lien d'appairage ni chemin personnel dans le code, les tests, les captures ou les journaux joints.
- Le contrat de données entre le service et la vue est `src/model.ts`. La vue (`web/index.html`) ne fait que dessiner un `OfficeState`, sans ressource distante.
- Bureau parle à Boite seulement par le RPC du core, avec les permissions déclarées dans le manifeste.
- Un changement de comportement s'accompagne d'un test.

## Style des commits

Un commit s'écrit `type: résumé`, en français, à l'indicatif, sans point final.

| Type | Pour |
|---|---|
| `feat` | une nouvelle fonction |
| `fix` | une correction |
| `perf` | un gain de performance |
| `refactor` | une réécriture sans changement de comportement |
| `docs` | README, wiki, docs |
| `test` | les tests |
| `ci` | les workflows et l'outillage du dépôt |
| `build` | la construction du plugin (`pack`, dépendances) |
| `chore` | le reste |
| `revert` | l'annulation d'un commit |

Exemples : `feat: archivage automatique des conversations inutilisées`, `fix: la porte du chef reste ouverte après une mission`.

## Ouvrir une pull request

1. Cherchez ou ouvrez d'abord une issue pour un changement important : on s'accorde sur le besoin avant le code.
2. Créez une branche depuis `main` (un fork si vous n'avez pas les droits).
3. Gardez la PR centrée sur un seul sujet.
4. Lancez les trois commandes de vérification ci-dessus.
5. Ouvrez la PR avec un titre au format `type: résumé` : il devient le message du commit et la ligne des notes de version. Le modèle de PR vous guide ; joignez une capture avant et après pour un changement de la vue.
6. Répondez aux retours dans la même PR. Elle est fusionnée en squash une fois la CI verte et la relecture faite.

Les étiquettes (`vue`, `service`, `commandes`, `skills`, `documentation`...) sont posées automatiquement selon les fichiers touchés. Les issues marquées `bonne première issue` ou `aide bienvenue` sont un bon point de départ.
