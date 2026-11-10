# Configuration

Bureau n'a pas d'écran de réglages dans Boite : Boite ne laisse pas un plugin en déclarer. La configuration tient dans le manifeste (permissions), le port du service et quelques fichiers du dossier de données.

## Permissions

Déclarées dans `boite-plugin.json` : `threads.read`, `threads.write`, `ui.reveal`. Détail dans [Installation](Installation). Bureau parle à Boite seulement par le RPC du core, avec son jeton de plugin.

## Le service

- Il écoute uniquement sur `127.0.0.1`, jamais sur le réseau.
- Port : il essaie d'abord `47317`, puis prend le suivant de libre (jusqu'à 100 essais). Il écrit le port retenu dans le fichier `port` du dossier de données. `boite bureau` lit ce fichier et donne l'adresse exacte.
- Il se reconnecte seul au core de Boite, en attendant 1, 2, 5 puis 10 secondes entre les essais.
- Protections de l'API locale : l'en-tête `Host` doit être `127.0.0.1:<port>` (contre le rebinding DNS), et toute requête POST exige l'en-tête `X-Bureau: 1` et, si elle en a un, une origine identique à celle de la page.

## Dossier de données

Boite donne au plugin un dossier privé (`BOITE_PLUGIN_DATA`). Il contient :

| Fichier | Rôle |
|---|---|
| `registre.json` | rôles déclarés, missions, rapports, messages en attente pour un chef occupé |
| `registre.lock` | verrou d'écriture du registre (attente 5 s au plus, abandonné au bout de 30 s) |
| `reglages.json` | réglages de l'archivage (voir plus bas) |
| `archivage.jsonl` | journal des archivages, une ligne JSON par tentative |
| `port` | port actuel du service |

Le registre est écrit de façon atomique (fichier temporaire puis renommage). Le service le relit quand il change.

Ces fichiers ne contiennent que ce que les agents ont déclaré : rôles, plans, rapports, titres de conversations. Rien n'est envoyé hors de la machine.

## Réglages de l'archivage

Ils se changent avec `boite bureau-archive reglages` (voir [Archivage automatique](Archivage-automatique)). Forme du fichier :

```json
{ "version": 1, "archivage": { "auto": true, "delaiHeures": 6, "etendu": false, "delaiEtenduHeures": 48 } }
```

Un champ absent ou invalide reprend sa valeur par défaut.

## Variables d'environnement

Elles sont fournies par Boite aux commandes et au service. Il n'y a rien à régler à la main, sauf pour un essai.

| Variable | Utilisée par | Sens |
|---|---|---|
| `BOITE_PLUGIN_DATA` | service, commandes | dossier de données du plugin |
| `BOITE_CALLER_THREAD_ID` | commandes | fil qui lance la commande |
| `BOITE_CORE_URL`, `BOITE_TOKEN` | service, commandes | adresse du core de Boite et jeton du plugin |
| `BUREAU_PORT` | `bun run demo` seulement | port de la démo (47318 par défaut) |
| `BUREAU_DEMO` | `bun run demo` seulement | `gros` : 5 projets et 40 agents |

## Animations

La vue respecte « réduire les animations » du système : plus personne ne marche, les étages et les zones apparaissent sans chantier, le zoom, la rotation et le changement d'étage sont instantanés.
