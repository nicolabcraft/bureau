# Sécurité

## Signaler une faille

Utilisez le [signalement privé de GitHub](https://github.com/nicolabcraft/bureau/security/advisories/new) (onglet Security, « Report a vulnerability »).
Ne signalez pas une faille dans une issue, une pull request ou une discussion publique.

Indiquez la version de Bureau et de Boite, le système, les étapes pour reproduire et ce qu'un attaquant obtient.
Décrivez les jetons, les liens d'appairage et le contenu des conversations sans en donner les vraies valeurs.

Le responsable répond dans l'avis, le corrige, puis le publie avec la release qui contient le correctif.

## Versions prises en charge

Bureau est jeune. Seules la dernière release et la branche `main` reçoivent les correctifs de sécurité.

## Périmètre

Dans le périmètre :

- le service Bureau : il écoute sur 127.0.0.1 seulement, sert une page locale et parle à Boite avec le jeton de plugin qu'il reçoit (`threads.read`, `threads.write`, `ui.reveal`) ;
- les commandes `boite bureau*` et ce qu'elles écrivent dans le dossier de données du plugin ;
- les skills livrés dans le manifeste, qui guident les agents ;
- le fichier `bureau.js` publié avec chaque release et son empreinte sha256 dans `boite-plugin.json`.

Hors périmètre :

- les failles de Boite lui-même, des agents (Claude Code, Codex, OpenCode et les autres) ou de Bun : à signaler à leurs auteurs ;
- ce qu'un agent fait avec les permissions que vous lui avez accordées ;
- les attaques qui demandent déjà le jeton du core de Boite ou l'accès à votre session.
