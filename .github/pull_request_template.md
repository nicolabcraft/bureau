<!--
Le titre devient le message du commit et la ligne des notes de version :
type: résumé, avec type parmi feat, fix, perf, refactor, docs, test, ci, build, chore ou revert.
Exemple : fix: la porte du chef reste ouverte après une mission.
-->

## Ce qui change

Le problème, puis le comportement obtenu. Lien vers l'issue qu'elle ferme (Closes #...).

## Vérification

Les commandes lancées et leur résultat, et ce qui n'a pas été vérifié.
Pour un changement visuel (vue), joindre une capture avant et après.

## Parties touchées

Cocher ce que la PR modifie. Laisser le reste vide.

- [ ] La vue (web/)
- [ ] Le service (src/)
- [ ] Les commandes boite bureau*
- [ ] Les skills (le manifeste est régénéré avec `bun run pack`)
- [ ] La documentation (README, wiki/, docs/)
- [ ] L'outillage (CI, scripts)

## Liste de contrôle

- [ ] `bun run check`, `bun test` et `bun run check:manifest` passent.
- [ ] Aucun secret, chemin personnel, tiret cadratin ni demi-cadratin dans les fichiers.
- [ ] Textes visibles en français, code et commentaires en anglais.
