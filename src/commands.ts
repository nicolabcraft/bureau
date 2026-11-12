/*
 * The `boite <name>` commands Bureau gives agents. Every output is French, one
 * fact per line; errors go to stderr and say what to run instead. Exit codes:
 * 0 success, 1 error, 2 usage.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Mission, Role } from './model';
import { CoreClient } from './rpc';
import { buildState, officeRows, wouldLoop } from './state';
import {
  appendJournal,
  coreArchiver,
  DEFAULT_SETTINGS,
  readJournal,
  readSettings,
  runArchivePass,
  SettingsError,
  trimJournal,
  writeSettings,
  type ArchiveSettings,
  type KeepReason,
} from './archive';
import {
  createMission,
  declareRole,
  dropMission,
  markValidated,
  proposedMissionOf,
  readRegistry,
  REPORT_MAX_BYTES,
  RegistryError,
  setLotState,
  updateRegistry,
  validatePlan,
  type Registry,
} from './registry';

export const COMMAND_NAMES = ['bureau', 'bureau-role', 'bureau-plan', 'bureau-mission', 'bureau-rapport', 'bureau-archive'] as const;

export interface CommandIO {
  out(line: string): void;
  err(line: string): void;
}

export interface CommandContext {
  env: Record<string, string | undefined>;
  io: CommandIO;
  /** Where relative paths are resolved. Default: the process's directory. */
  cwd?: string;
  version?: string;
}

class UsageError extends Error {}
class CommandError extends Error {}

const USAGE: Record<string, string> = {
  bureau: 'boite bureau',
  'bureau-role': 'boite bureau-role <chef|manager|agent> [--service <nom>] [--files <a,b,c>] [--thread <id>] [--chef <id-du-chef>]',
  'bureau-plan':
    'boite bureau-plan <plan.json> [--remplacer]\n       boite bureau-plan valider <mission-id> --chat\n       boite bureau-plan lot <mission-id> <lot-id> <todo|running|done> [--agent <thread-id>]\n       boite bureau-plan fini <mission-id>',
  'bureau-mission': 'boite bureau-mission [--json]',
  'bureau-rapport': 'boite bureau-rapport <texte>\n       boite bureau-rapport --file <chemin>',
  'bureau-archive':
    'boite bureau-archive [--dry-run] [--json]\n       boite bureau-archive journal [--json]\n       boite bureau-archive reglages [--auto <oui|non>] [--delai <heures>] [--etendu <oui|non>] [--delai-etendu <heures>]',
};

interface Parsed {
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

/** Splits arguments into positionals, boolean flags and `--name value` options. Unknown options are a usage error. */
function parseArgs(args: string[], bool: string[], valued: string[]): Parsed {
  const parsed: Parsed = { positional: [], flags: new Set(), values: new Map() };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) {
      parsed.positional.push(arg);
      continue;
    }
    const [name, inline] = arg.split(/=(.*)/s, 2) as [string, string | undefined];
    if (bool.includes(name)) {
      parsed.flags.add(name);
    } else if (valued.includes(name)) {
      const value = inline ?? args[++index];
      if (value === undefined) throw new UsageError(`L'option ${name} attend une valeur.`);
      parsed.values.set(name, value);
    } else {
      throw new UsageError(`Option inconnue : ${name}.`);
    }
  }
  return parsed;
}

const dataDirOf = (ctx: CommandContext): string => {
  const dir = ctx.env.BOITE_PLUGIN_DATA;
  if (!dir) throw new CommandError('BOITE_PLUGIN_DATA est absent : lance cette commande avec `boite <nom>` depuis Boite.');
  return dir;
};

const callerOf = (ctx: CommandContext): string => {
  const id = ctx.env.BOITE_CALLER_THREAD_ID;
  if (!id) throw new CommandError('Le fil appelant est inconnu : lance cette commande depuis la conversation d\'un agent Boite, avec `boite <nom>`.');
  return id;
};

/** Opens the core once, runs `use`, and closes. */
async function withCore<T>(ctx: CommandContext, use: (core: CoreClient) => Promise<T>): Promise<T> {
  const url = ctx.env.BOITE_CORE_URL;
  const token = ctx.env.BOITE_TOKEN;
  if (!url || !token) throw new CommandError('Boite est injoignable : BOITE_CORE_URL ou BOITE_TOKEN manque. Lance cette commande avec `boite <nom>` depuis Boite.');
  const core = new CoreClient({ url, token, version: ctx.version ?? '0.0.0', reconnect: false });
  core.start();
  try {
    await core.waitReady();
  } catch (error) {
    core.stop();
    throw new CommandError(`Boite est injoignable (${error instanceof Error ? error.message : String(error)}). Vérifie que Boite tourne, puis relance la commande.`);
  }
  try {
    return await use(core);
  } finally {
    core.stop();
  }
}

// ---------------------------------------------------------------------------
// bureau
// ---------------------------------------------------------------------------

async function bureau(args: string[], ctx: CommandContext): Promise<number> {
  parseArgs(args, [], []);
  const dir = dataDirOf(ctx);
  let port = '';
  try {
    port = readFileSync(join(dir, 'port'), 'utf8').trim();
  } catch {
    // Handled below with the rest of "not running".
  }
  const down = () => {
    ctx.io.err('Le service Bureau ne tourne pas.');
    ctx.io.err('Démarre-le : Réglages > Plugins > Bureau > Démarrer.');
    return 1;
  };
  if (!/^\d{1,5}$/.test(port)) return down();
  const address = `http://127.0.0.1:${port}/`;
  try {
    const response = await fetch(`${address}api/state`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return down();
    await response.body?.cancel();
  } catch {
    return down();
  }
  ctx.io.out(`Adresse : ${address}`);
  ctx.io.out(`Pour l'ouvrir dans Boite : boite browse ${address}`);
  return 0;
}

// ---------------------------------------------------------------------------
// bureau-role
// ---------------------------------------------------------------------------

const ROLES: Role[] = ['chef', 'manager', 'agent'];

async function bureauRole(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, [], ['--service', '--files', '--thread', '--chef']);
  const role = parsed.positional[0];
  if (parsed.positional.length !== 1 || !ROLES.includes(role as Role)) throw new UsageError('Le rôle doit être chef, manager ou agent.');
  const service = parsed.values.get('--service')?.trim();
  if (parsed.values.has('--service') && !service) throw new UsageError('--service attend un nom de service non vide.');
  const filesRaw = parsed.values.get('--files');
  const files = filesRaw === undefined ? undefined : filesRaw.split(',').map((file) => file.trim()).filter(Boolean);
  const chefId = parsed.values.get('--chef')?.trim();
  if (parsed.values.has('--chef') && !chefId) throw new UsageError("--chef attend l'id du fil du chef (donné par `boite where`).");
  if (chefId !== undefined && role !== 'manager') throw new UsageError("--chef ne va qu'avec le rôle manager : un agent lancé avec `boite delegate spawn` est déjà rattaché à son manager.");
  const dir = dataDirOf(ctx);
  const target = parsed.values.get('--thread') ?? callerOf(ctx);

  if (chefId !== undefined || (parsed.values.has('--thread') && target !== ctx.env.BOITE_CALLER_THREAD_ID)) {
    const threads = await withCore(ctx, (core) => core.call('threads.list', {}));
    if (!threads.some((thread) => thread.id === target)) {
      throw new CommandError(`Le fil ${target} n'existe pas. Relis son id dans le résultat de \`boite delegate spawn\` ou de \`boite thread new\`, ou dans \`boite bureau-mission\`.`);
    }
    if (chefId !== undefined) {
      if (chefId === target) throw new CommandError(`Le fil ${target} ne peut pas être son propre chef.`);
      if (!threads.some((thread) => thread.id === chefId)) {
        throw new CommandError(`Le chef ${chefId} n'existe pas. Son id est dans le résultat de \`boite where\` lancé dans la conversation du chef.`);
      }
      // The check and the write are separate: a loop made in between is dropped when the team is built.
      const rows = officeRows(threads);
      if (wouldLoop(rows, readRegistry(dir), target, chefId)) {
        throw new CommandError(`Le fil ${chefId} est sous le fil ${target} dans l'équipe : le rattacher sous lui ferait une boucle. Donne l'id du vrai chef (la racine de l'équipe).`);
      }
    }
  }

  const entry = await updateRegistry(dir, (registry) => declareRole(registry, target, { role: role as Role, service, files, chefId }));
  ctx.io.out(`Rôle déclaré : ${entry.role}`);
  if (entry.service) ctx.io.out(`Service : ${entry.service}`);
  if (entry.files.length > 0) ctx.io.out(`Fichiers : ${entry.files.join(', ')}`);
  if (entry.chefId) ctx.io.out(`Chef : ${entry.chefId}`);
  ctx.io.out(`Fil : ${target}`);
  return 0;
}

// ---------------------------------------------------------------------------
// bureau-plan
// ---------------------------------------------------------------------------

const missionOrFail = (registry: Registry, id: string | undefined): Mission => {
  if (!id) throw new UsageError('Il manque l\'id de la mission.');
  const mission = registry.missions[id];
  if (!mission) {
    const known = Object.keys(registry.missions);
    throw new CommandError(`Mission inconnue : ${id}.${known.length > 0 ? ` Missions connues : ${known.join(', ')}.` : ' Aucune mission : dépose d\'abord un plan avec `boite bureau-plan <plan.json>`.'}`);
  }
  return mission;
};

async function bureauPlan(args: string[], ctx: CommandContext): Promise<number> {
  const sub = args[0];
  if (sub === 'valider') return planValidate(args.slice(1), ctx);
  if (sub === 'lot') return planLot(args.slice(1), ctx);
  if (sub === 'fini') return planDone(args.slice(1), ctx);
  return planSubmit(args, ctx);
}

async function planSubmit(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, ['--remplacer'], []);
  if (parsed.positional.length !== 1) throw new UsageError('Donne le fichier du plan : `boite bureau-plan <plan.json>`.');
  const file = parsed.positional[0]!;
  const dir = dataDirOf(ctx);
  const chefId = callerOf(ctx);
  let text: string;
  try {
    text = readFileSync(resolve(ctx.cwd ?? process.cwd(), file), 'utf8');
  } catch {
    throw new CommandError(`Fichier introuvable : ${file}. Écris le plan en JSON (voir le skill bureau-chef), puis relance \`boite bureau-plan ${file}\`.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CommandError(`${file} n'est pas du JSON valide (${error instanceof Error ? error.message : String(error)}). Corrige la syntaxe puis relance la commande.`);
  }
  const result = validatePlan(raw);
  if (!result.ok) {
    ctx.io.err(`Plan invalide : ${result.errors.length} problème${result.errors.length > 1 ? 's' : ''} à corriger dans ${file}.`);
    for (const error of result.errors) ctx.io.err(error);
    return 1;
  }
  const mission = await updateRegistry(dir, (registry) => {
    const pending = proposedMissionOf(registry, chefId);
    if (pending) {
      if (!parsed.flags.has('--remplacer')) {
        throw new CommandError(`Un plan attend déjà la validation (mission ${pending.id}). Pour le remplacer : \`boite bureau-plan ${file} --remplacer\`.`);
      }
      dropMission(registry, pending.id);
    }
    return createMission(registry, chefId, result.plan);
  });
  ctx.io.out(`Mission ${mission.id} créée : ${mission.title}`);
  ctx.io.out(`Lots : ${mission.lots.length}`);
  ctx.io.out('En attente de la validation de l\'utilisateur.');
  ctx.io.out('Ne lance aucun lot avant la validation : tu recevras un message quand elle viendra.');
  return 0;
}

async function planValidate(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, ['--chat'], []);
  if (parsed.positional.length !== 1) throw new UsageError('Donne l\'id de la mission.');
  if (!parsed.flags.has('--chat')) {
    throw new UsageError('`valider` ne s\'emploie qu\'avec --chat, quand l\'utilisateur a approuvé ce plan lui-même dans ta conversation. Sinon il valide avec le bouton « Valider le plan » de Bureau.');
  }
  const dir = dataDirOf(ctx);
  const caller = callerOf(ctx);
  const id = parsed.positional[0]!;
  const mission = await updateRegistry(dir, (registry) => {
    const found = missionOrFail(registry, id);
    if (found.chefId !== caller) throw new CommandError(`Seul le chef de la mission (fil ${found.chefId}) peut la valider dans le chat.`);
    if (found.status !== 'proposed') throw new CommandError(`La mission ${id} n'attend plus de validation (état : ${found.status}).`);
    markValidated(found, 'chat');
    return found;
  });
  ctx.io.out(`Mission ${mission.id} validée dans le chat.`);
  ctx.io.out('Tu peux lancer les lots.');
  return 0;
}

async function planLot(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, [], ['--agent']);
  const [missionId, lotId, state] = parsed.positional;
  if (parsed.positional.length !== 3 || !missionId || !lotId) throw new UsageError('Il faut l\'id de la mission, l\'id du lot et son état.');
  if (state !== 'todo' && state !== 'running' && state !== 'done') throw new UsageError('L\'état d\'un lot est todo, running ou done.');
  const dir = dataDirOf(ctx);
  const caller = callerOf(ctx);
  const agent = parsed.values.get('--agent');
  const lot = await updateRegistry(dir, (registry) => {
    const mission = missionOrFail(registry, missionId);
    if (registry.roles[caller]?.role === 'agent') throw new CommandError('Seuls le chef et les managers mettent à jour un lot : envoie ton résultat avec `boite bureau-rapport`.');
    if (mission.status === 'proposed') throw new CommandError(`Le plan de la mission ${missionId} n'est pas validé : ne lance aucun lot. Attends la validation de l'utilisateur.`);
    if (mission.status === 'done') throw new CommandError(`La mission ${missionId} est terminée.`);
    const updated = setLotState(mission, lotId, state, agent);
    if (!updated) throw new CommandError(`Lot inconnu : ${lotId}. Lots de la mission : ${mission.lots.map((entry) => entry.id).join(', ')}.`);
    return updated;
  });
  ctx.io.out(`Lot ${lot.id} : ${lot.state} (mission ${missionId})`);
  if (lot.agentId) ctx.io.out(`Agent : ${lot.agentId}`);
  return 0;
}

async function planDone(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, [], []);
  if (parsed.positional.length !== 1) throw new UsageError('Donne l\'id de la mission.');
  const dir = dataDirOf(ctx);
  const caller = callerOf(ctx);
  const id = parsed.positional[0]!;
  await updateRegistry(dir, (registry) => {
    const mission = missionOrFail(registry, id);
    if (mission.chefId !== caller) throw new CommandError(`Seul le chef de la mission (fil ${mission.chefId}) peut la terminer.`);
    if (mission.status === 'proposed') throw new CommandError(`Le plan de la mission ${id} n'a pas été validé : rien à terminer.`);
    if (mission.status === 'done') throw new CommandError(`La mission ${id} est déjà terminée.`);
    mission.status = 'done';
  });
  ctx.io.out(`Mission ${id} terminée.`);
  return 0;
}

// ---------------------------------------------------------------------------
// bureau-mission
// ---------------------------------------------------------------------------

const STATE_TEXT = {
  running: 'au travail',
  queued: 'en file d\'attente',
  waiting: 'attend l\'utilisateur',
  idle: 'au repos',
  done: 'terminé',
  error: 'en erreur',
} as const;

const MISSION_TEXT = { proposed: 'proposée, en attente de validation', validated: 'validée', done: 'terminée' } as const;

const firstLine = (text: string, max = 120): string => {
  const line = text.split('\n').find((entry) => entry.trim() !== '')?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

async function bureauMission(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, ['--json'], []);
  if (parsed.positional.length > 0) throw new UsageError('Cette commande ne prend pas d\'argument.');
  const dir = dataDirOf(ctx);
  const caller = callerOf(ctx);
  const registry = readRegistry(dir);
  const { threads, projects } = await withCore(ctx, async (core) => ({
    threads: await core.call('threads.list', {}),
    projects: await core.call('projects.list', {}),
  }));
  const state = buildState({ threads, projects, registry, core: 'connected', now: Date.now() });
  const team = state.teams.find((entry) => entry.agents.some((agent) => agent.id === caller));
  if (!team) throw new CommandError(`Le fil ${caller} n'apparaît dans aucune équipe (archivé, salon ou incognito). Lance la commande depuis la conversation d'un agent actif.`);

  if (parsed.flags.has('--json')) {
    ctx.io.out(JSON.stringify({ caller, team }, null, 2));
    return 0;
  }

  const { mission } = team;
  ctx.io.out(`Équipe : ${team.title}${team.projectName ? ` (projet ${team.projectName})` : ''}`);
  ctx.io.out(`Fil appelant : ${caller}`);
  if (mission) {
    ctx.io.out(`Mission ${mission.id} : ${mission.title} (${MISSION_TEXT[mission.status]})`);
    ctx.io.out(`Résumé : ${firstLine(mission.summary, 300)}`);
    const budget = [
      mission.budget.maxAgents === null ? null : `${mission.budget.maxAgents} agents au plus`,
      mission.budget.models.length > 0 ? `modèles : ${mission.budget.models.join(', ')}` : null,
    ].filter(Boolean);
    if (budget.length > 0) ctx.io.out(`Budget : ${budget.join(' ; ')}`);
  } else {
    ctx.io.out('Mission : aucune. Le chef en propose une avec `boite bureau-plan <plan.json>`.');
  }
  ctx.io.out('Organigramme :');
  const depthOf = new Map<string, number>();
  for (const agent of team.agents) depthOf.set(agent.id, agent.parentId === null ? 0 : (depthOf.get(agent.parentId) ?? 0) + 1);
  for (const agent of team.agents) {
    const label = `${agent.role}${agent.service ? ` ${agent.service}` : ''}${agent.roleSource === 'guessed' ? ' (deviné)' : ''}`;
    const waiting = agent.waitingFor ? ` (${agent.waitingFor === 'question' ? 'question' : 'permission'})` : '';
    ctx.io.out(
      `${'  '.repeat(depthOf.get(agent.id) ?? 0)}${label} | ${agent.title} | ${STATE_TEXT[agent.state]}${waiting} | modèle : ${agent.model ?? 'inconnu'} | id : ${agent.id}`
    );
  }
  if (mission) {
    ctx.io.out('Lots :');
    for (const lot of mission.lots) ctx.io.out(`${lot.id} | ${lot.state} | ${lot.service} | ${lot.title} | ${lot.model} | agent : ${lot.agentId ?? 'aucun'}`);
  }
  const reports = team.agents.filter((agent) => agent.report);
  ctx.io.out(reports.length > 0 ? 'Rapports :' : 'Rapports : aucun');
  for (const agent of reports) ctx.io.out(`${agent.id} | ${agent.title} : ${firstLine(agent.report!.text)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// bureau-rapport
// ---------------------------------------------------------------------------

async function bureauRapport(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = parseArgs(args, [], ['--file']);
  const file = parsed.values.get('--file');
  let text: string;
  if (file !== undefined) {
    if (parsed.positional.length > 0) throw new UsageError('Donne soit un texte, soit --file <chemin>, pas les deux.');
    try {
      text = readFileSync(resolve(ctx.cwd ?? process.cwd(), file), 'utf8');
    } catch {
      throw new CommandError(`Fichier introuvable : ${file}. Écris ton rapport dans un fichier puis relance \`boite bureau-rapport --file <chemin>\`, ou passe le texte en argument.`);
    }
  } else {
    if (parsed.positional.length === 0) throw new UsageError('Il manque le rapport.');
    text = parsed.positional.join(' ');
  }
  text = text.trim();
  if (text === '') throw new CommandError('Le rapport est vide : écris ce que tu as fait, les fichiers touchés, la vérification et ce qui reste.');
  const bytes = Buffer.byteLength(text);
  if (bytes > REPORT_MAX_BYTES) {
    throw new CommandError(`Rapport trop long : ${Math.ceil(bytes / 1024)} Ko, 64 Ko au plus. Résume-le, ou garde le détail dans un fichier et cite son chemin.`);
  }
  const dir = dataDirOf(ctx);
  const caller = callerOf(ctx);
  await updateRegistry(dir, (registry) => {
    registry.reports[caller] = { text, at: Date.now() };
  });
  ctx.io.out(`Rapport déposé (${bytes} octets).`);
  ctx.io.out('Il apparaît dans ta fiche et sur le bureau de ton manager.');
  return 0;
}

// ---------------------------------------------------------------------------
// bureau-archive
// ---------------------------------------------------------------------------

const KEEP_LABEL: Record<KeepReason, string> = {
  'en-cours': 'en cours',
  'attend-reponse': 'attend une réponse',
  erreur: 'en erreur',
  epingle: 'épinglés',
  'chef-mission': 'chef d\'une mission pas finie',
  'message-en-attente': 'message de Bureau en attente',
  'equipe-active': 'équipe encore active',
  recent: 'activité récente',
  'hors-bureau': 'hors équipes Bureau',
};

const yesNo = (value: string, option: string): boolean => {
  if (['oui', 'true', 'on', '1'].includes(value.toLowerCase())) return true;
  if (['non', 'false', 'off', '0'].includes(value.toLowerCase())) return false;
  throw new UsageError(`${option} attend oui ou non.`);
};
const hoursOf = (value: string, option: string): number => {
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw new UsageError(`${option} attend un nombre d'heures supérieur à 0.`);
  return number;
};
const showSettings = (settings: ArchiveSettings): string[] => [
  `Archivage automatique : ${settings.auto ? 'oui' : 'non'}`,
  `Délai (équipes Bureau) : ${settings.delayHours} h`,
  `Option étendue (tous les fils inactifs) : ${settings.extended ? 'oui' : 'non'}`,
  `Délai étendu : ${settings.extendedDelayHours} h`,
];

async function bureauArchive(args: string[], ctx: CommandContext): Promise<number> {
  const sub = args[0] === 'journal' || args[0] === 'reglages' ? args[0] : null;
  const parsed = parseArgs(sub ? args.slice(1) : args, ['--dry-run', '--json'], sub === 'reglages' ? ['--auto', '--delai', '--etendu', '--delai-etendu'] : []);
  if (parsed.positional.length > 0) throw new UsageError(`Argument inattendu : ${parsed.positional[0]}.`);
  const dir = dataDirOf(ctx);

  if (sub === 'reglages') {
    const settings = { ...readSettings(dir) };
    const changes = ['--auto', '--delai', '--etendu', '--delai-etendu'].filter((name) => parsed.values.has(name));
    if (parsed.values.has('--auto')) settings.auto = yesNo(parsed.values.get('--auto')!, '--auto');
    if (parsed.values.has('--delai')) settings.delayHours = hoursOf(parsed.values.get('--delai')!, '--delai');
    if (parsed.values.has('--etendu')) settings.extended = yesNo(parsed.values.get('--etendu')!, '--etendu');
    if (parsed.values.has('--delai-etendu')) settings.extendedDelayHours = hoursOf(parsed.values.get('--delai-etendu')!, '--delai-etendu');
    if (changes.length > 0) {
      try {
        writeSettings(dir, settings);
      } catch (error) {
        if (error instanceof SettingsError) throw new CommandError(error.message);
        throw error;
      }
      ctx.io.out('Réglages enregistrés (le service les relit à chaque passage).');
    }
    if (parsed.flags.has('--json')) ctx.io.out(JSON.stringify(settings, null, 2));
    else for (const line of showSettings(settings)) ctx.io.out(line);
    if (changes.length === 0) ctx.io.out(`Défauts : ${DEFAULT_SETTINGS.delayHours} h, option étendue coupée (${DEFAULT_SETTINGS.extendedDelayHours} h une fois active).`);
    return 0;
  }

  if (sub === 'journal') {
    const entries = readJournal(dir, 30);
    if (parsed.flags.has('--json')) {
      ctx.io.out(JSON.stringify(entries, null, 2));
      return 0;
    }
    if (entries.length === 0) ctx.io.out('Journal vide : Bureau n\'a rien archivé.');
    for (const entry of entries) {
      const status = entry.ok ? 'archivé' : `refusé (${entry.error ?? 'raison inconnue'})`;
      ctx.io.out(`${new Date(entry.at).toISOString()} | ${status} | ${entry.threadId} | ${entry.title} | ${entry.reason} | ${entry.mode}`);
    }
    return 0;
  }

  const dryRun = parsed.flags.has('--dry-run');
  const registry = readRegistry(dir);
  const settings = readSettings(dir);
  const result = await withCore(ctx, async (core) =>
    runArchivePass({
      threads: await core.call('threads.list', {}),
      projects: await core.call('projects.list', {}),
      registry,
      settings,
      now: Date.now(),
      mode: 'manuel',
      dryRun,
      archiver: coreArchiver(core),
      record: (entry) => appendJournal(dir, entry),
    })
  );
  if (!dryRun) trimJournal(dir);

  if (parsed.flags.has('--json')) {
    ctx.io.out(JSON.stringify({ dryRun, unavailable: result.unavailable, candidates: result.candidates, archived: result.archived, failed: result.failed, kept: result.decisions.filter((entry) => !entry.archive) }, null, 2));
  } else {
    ctx.io.out(`${dryRun ? 'Passage à blanc : ' : ''}${result.candidates.length} fil(s) ${dryRun ? 'seraient archivés' : 'à archiver'}.`);
    for (const decision of result.candidates) ctx.io.out(`${decision.threadId} | ${decision.title} | ${decision.reason}`);
    const kept = new Map<KeepReason, number>();
    for (const decision of result.decisions) if (!decision.archive) kept.set(decision.keep!, (kept.get(decision.keep!) ?? 0) + 1);
    if (kept.size > 0) ctx.io.out(`Gardés : ${[...kept].map(([reason, count]) => `${count} ${KEEP_LABEL[reason]}`).join(', ')}.`);
    ctx.io.out(`Réglages : ${settings.delayHours} h, option étendue ${settings.extended ? `oui (${settings.extendedDelayHours} h)` : 'non'}.`);
    for (const decision of result.archived) ctx.io.out(`Archivé : ${decision.threadId} | ${decision.title}`);
    for (const { decision, error } of result.failed) ctx.io.err(`Refusé par Boite : ${decision.threadId} | ${error}`);
  }
  if (result.unavailable) {
    ctx.io.err('Rien n\'a été archivé : l\'archivage réel est coupé dans Bureau (CORE_ARCHIVE_OPEN). Archive à la main avec `boite thread archive <id>`, ou relance avec --dry-run pour la liste seule.');
    return 1;
  }
  return result.failed.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------

const HANDLERS: Record<string, (args: string[], ctx: CommandContext) => Promise<number>> = {
  bureau,
  'bureau-role': bureauRole,
  'bureau-plan': bureauPlan,
  'bureau-mission': bureauMission,
  'bureau-rapport': bureauRapport,
  'bureau-archive': bureauArchive,
};

/** Runs `argv` (command name first) and returns the exit code. Never throws. */
export async function runCommand(argv: string[], ctx: CommandContext): Promise<number> {
  const [name, ...args] = argv;
  const handler = name === undefined ? undefined : HANDLERS[name];
  if (!name || !handler) {
    ctx.io.err(`Commande inconnue : ${name ?? '(aucune)'}.`);
    ctx.io.err(`Commandes de Bureau : ${COMMAND_NAMES.join(', ')}.`);
    return 2;
  }
  try {
    return await handler(args, ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.io.err(error.message);
      for (const line of `Usage : ${USAGE[name]}`.split('\n')) ctx.io.err(line);
      return 2;
    }
    if (error instanceof CommandError || error instanceof RegistryError) {
      ctx.io.err(error.message);
      return 1;
    }
    ctx.io.err(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
