# Archivage automatique

Bureau range les conversations que plus personne n'utilise. Il archive, il ne supprime jamais.

> **Version de Boite** : l'archivage réel demande Boite 2.0.0-nightly.20261111.1 ou plus récent, qui ouvre `threads.archive` aux plugins sous la permission `threads.write`. Boite n'archive alors qu'un fil non épinglé, et seul le propriétaire peut le restaurer. Avec un Boite plus ancien, chaque tentative est refusée, notée au journal (`ok: false`), et le passage réel sort avec le code 1.

## Règles

Un fil est archivé quand toutes ces conditions sont vraies :

- il est au repos (état « En pause » ou « Fini ») ;
- sa dernière activité est plus vieille que le délai. Elle compte le dernier changement du fil, son rapport, et l'activité des fils placés en dessous ;
- aucune des protections ci-dessous ne s'applique.

### Délais

| Fils | Délai par défaut |
|---|---|
| Fil d'une équipe Bureau (mission ou rôle déclaré) | 6 h |
| Autres fils, seulement si l'option étendue est active | 48 h |

L'option étendue est coupée par défaut.

### Jamais archivés

- un fil en cours (`running`, `queued`) ;
- un fil qui attend une réponse (permission ou question) ;
- un fil en erreur ;
- un fil épinglé ;
- le chef d'une mission pas finie (`proposed` ou `validated`) ;
- un fil qui attend un message de Bureau ;
- un fil dont un fil en dessous travaille encore, est en file ou attend ;
- les fils déjà archivés, les chats d'équipe de Boite, les salons, les conversations incognito.

## Réglages

Boite ne laisse pas un plugin déclarer des réglages dans ses propres écrans : ils se changent par commande, et sont gardés dans `reglages.json` du dossier de données (voir [Configuration](Configuration)). Le service les relit à chaque passage.

```
boite bureau-archive reglages
boite bureau-archive reglages --delai 6 --etendu oui --delai-etendu 48 --auto oui
```

| Option | Sens | Défaut |
|---|---|---|
| `--auto <oui\|non>` | le service fait un passage tout seul | oui |
| `--delai <heures>` | repos avant archivage d'un fil d'équipe Bureau | 6 |
| `--etendu <oui\|non>` | archiver aussi les autres fils inactifs | non |
| `--delai-etendu <heures>` | repos avant archivage de ces autres fils | 48 |

Le service fait un passage toutes les 10 minutes quand `auto` est actif. `boite bureau-archive` lance un passage à la main.

## Passage à blanc

```
boite bureau-archive --dry-run
```

Liste ce qui serait archivé sans rien toucher : un fil par ligne (id, titre, raison), puis le nombre de fils gardés par motif (en cours, attend une réponse, en erreur, épinglés, chef d'une mission pas finie, message de Bureau en attente, équipe encore active, activité récente, hors équipes Bureau) et les réglages utilisés. `--json` donne les mêmes données.

## Journal

```
boite bureau-archive journal
```

Affiche les 30 dernières tentatives de `archivage.jsonl` : date, état (archivé ou refusé avec la raison), id du fil, titre, raison, mode (`auto` ou `manuel`). Le fichier est coupé à ses lignes les plus récentes au-delà de 512 Ko.

Un refus de Boite est journalisé, et le fil n'est pas retenté avant le redémarrage du service.

## Dans la vue

Un fil archivé sort par la porte d'entrée, puis disparaît.

## Archiver à la main en attendant

```
boite thread archive <id>
```

La liste des candidats vient de `boite bureau-archive --dry-run`.

## Quand Boite ouvrira la méthode

Il faudra déclarer la permission dans `boite-plugin.json` et passer `CORE_ARCHIVE_OPEN` à `true` dans `src/archive.ts`. Rien d'autre ne change : règles, réglages et journal sont déjà en place.
