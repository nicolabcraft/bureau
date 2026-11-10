## Installer Bureau depuis zéro

Bureau est un plugin de Boite. Boite télécharge lui-même le fichier `bureau.js` de cette version et vérifie sa somme SHA-256 : tu n'as aucun fichier à copier à la main.

### Ce qu'il faut
- Boite, avec la gestion des plugins (menu Réglages, puis Plugins).
- Rien d'autre : pas besoin d'installer Bun ni Node, Boite fournit le moteur `bun` aux plugins.

### Première installation
1. Ouvre Boite, puis Réglages > Plugins.
2. Choisis « Ajouter depuis une URL git ».
3. Colle l'adresse `https://github.com/nicolabcraft/bureau` et valide. Boite lit `boite-plugin.json` sur la branche `main`, télécharge `bureau.js` attaché à cette version ({{TAG}}) et contrôle sa somme SHA-256 (plus bas).
4. Accepte les trois permissions : `threads.read` (voir les conversations pour dessiner l'immeuble), `threads.write` (prévenir le chef quand tu valides un plan, arrêter un agent), `ui.reveal` (ouvrir la bonne conversation).
5. Dans la même page, sur la ligne Bureau, clique « Démarrer » pour lancer son service.

### Mettre à jour une ancienne version
1. Réglages > Plugins > Bureau > Mettre à jour. Boite remplace `bureau.js` et le manifeste ; rien à supprimer à la main.
2. Si Boite ne propose pas la mise à jour : retire le plugin (Réglages > Plugins > Bureau > Supprimer), puis refais la première installation ci-dessus.
3. Tes données sont gardées dans le dossier privé du plugin, que Boite ne vide pas : registre des rôles et des missions (`registre.json`), réglages et journal de l'archivage.

### Vérifier que ça marche
1. Dans une conversation de Boite, tape `/bureau`, ou lance la commande `boite bureau` dans un terminal.
2. La vue s'ouvre dans l'onglet navigateur du panneau de Boite (sinon la commande affiche son adresse, par exemple `http://127.0.0.1:47317/`, avec la ligne `boite browse <adresse>`).
3. Tu dois voir l'immeuble : un étage par projet qui a une conversation en cours, tes agents à leur bureau.
4. Si `boite bureau` dit que le service ne tourne pas : Réglages > Plugins > Bureau > Démarrer, puis recommence.

### Somme SHA-256 de `bureau.js`
`{{SHA256}}`

Elle est aussi dans `SHA256SUMS`, attaché à cette version, et dans `artifacts.any.sha256` de `boite-plugin.json`.

Un problème : https://github.com/nicolabcraft/bureau/wiki/Depannage-et-FAQ
