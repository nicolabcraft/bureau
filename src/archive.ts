/*
 * Automatic archiving of conversations nobody uses any more.
 *
 * Three parts, the first two pure:
 *  - `decideArchive`: the eligibility rules, one decision per office thread;
 *  - `runArchivePass`: applies the decisions through an injected `archiver`
 *    (or only lists them, for a dry run) and records each archiving;
 *  - the settings file `reglages.json` and the journal `archivage.jsonl` in the
 *    plugin's data directory.
 *
 * Boite does not open `threads.archive` to plugins yet (its plugin permissions
 * are threads.read, threads.write, todos and ui.reveal), so `coreArchiver`
 * stays switched off by `CORE_ARCHIVE_OPEN`. Nothing here deletes a thread.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectRow, ThreadRow } from './core-types';
import type { CoreClient } from './rpc';
import type { ArchiveNote, OfficeAgent } from './model';
import { buildState, officeRows, ACTIVE_WINDOW_MS } from './state';
import type { Registry } from './registry';

export const SETTINGS_FILE = 'reglages.json';
export const JOURNAL_FILE = 'archivage.jsonl';
export const HOUR_MS = 60 * 60 * 1000;
/** The journal is cut to its newest lines beyond this size, in bytes. */
export const JOURNAL_MAX_BYTES = 512 * 1024;
export const MAX_DELAY_HOURS = 24 * 365;

/**
 * Flip to true once Boite lets a plugin call `threads.archive` (a permission in the manifest, and
 * the method in the core's plugin table). Until then no thread is archived by Bureau.
 */
export const CORE_ARCHIVE_OPEN = false;

export interface ArchiveSettings {
  /** Archive on its own, in the service. */
  auto: boolean;
  /** Hours of rest before a thread of a Bureau team is archived. */
  delayHours: number;
  /** Also archive every other inactive thread. Off by default. */
  extended: boolean;
  /** Hours of rest before such a thread is archived. */
  extendedDelayHours: number;
}

export const DEFAULT_SETTINGS: ArchiveSettings = { auto: true, delayHours: 6, extended: false, extendedDelayHours: 48 };

/** A settings problem the user can act on; the message says what to do. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validDelay = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DELAY_HOURS;

/** Reads the `archivage` block of the settings text. A missing or invalid field keeps its default. Never throws. */
export function parseSettings(text: string): ArchiveSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (text.trim() === '') return settings;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return settings;
  }
  const block = isObject(raw) && isObject(raw.archivage) ? raw.archivage : null;
  if (!block) return settings;
  if (typeof block.auto === 'boolean') settings.auto = block.auto;
  if (validDelay(block.delaiHeures)) settings.delayHours = block.delaiHeures;
  if (typeof block.etendu === 'boolean') settings.extended = block.etendu;
  if (validDelay(block.delaiEtenduHeures)) settings.extendedDelayHours = block.delaiEtenduHeures;
  return settings;
}

export function readSettings(dataDir: string): ArchiveSettings {
  try {
    return parseSettings(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes the settings (atomic rename). */
export function writeSettings(dataDir: string, settings: ArchiveSettings): void {
  if (!validDelay(settings.delayHours) || !validDelay(settings.extendedDelayHours)) {
    throw new SettingsError(`Un délai doit être un nombre d'heures supérieur à 0 et d'au plus ${MAX_DELAY_HOURS}.`);
  }
  mkdirSync(dataDir, { recursive: true });
  const body = { version: 1, archivage: { auto: settings.auto, delaiHeures: settings.delayHours, etendu: settings.extended, delaiEtenduHeures: settings.extendedDelayHours } };
  const path = join(dataDir, SETTINGS_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Why a thread is kept. */
export type KeepReason =
  | 'en-cours'
  | 'attend-reponse'
  | 'erreur'
  | 'epingle'
  | 'chef-mission'
  | 'message-en-attente'
  | 'equipe-active'
  | 'recent'
  | 'hors-bureau';

/** Which rule archives a thread. `bureau`: a thread of a Bureau team; `etendu`: the extended option. */
export type ArchiveRule = 'bureau' | 'etendu';

export interface Decision {
  threadId: string;
  title: string;
  archive: boolean;
  /** Set when `archive` is false. */
  keep?: KeepReason;
  /** Set when `archive` is true. */
  rule?: ArchiveRule;
  /** Hours since the thread's last activity. */
  idleHours: number;
  /** The delay that applied, in hours. */
  delayHours: number;
  /** A line for the journal and the dry run, e.g. "au repos depuis 7 h (délai 6 h)". */
  reason: string;
}

export interface ArchiveInput {
  threads: Iterable<ThreadRow>;
  projects?: Iterable<ProjectRow>;
  registry: Registry;
  settings: ArchiveSettings;
  now: number;
}

const formatHours = (hours: number): string => {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toString().replace('.', ',')} h`;
};

const KEEP_TEXT: Record<KeepReason, string> = {
  'en-cours': 'un tour est en cours ou en file',
  'attend-reponse': 'attend une réponse de l\'utilisateur',
  erreur: 'en erreur : à regarder avant de ranger',
  epingle: 'épinglé',
  'chef-mission': 'chef d\'une mission pas finie',
  'message-en-attente': 'un message de Bureau l\'attend',
  'equipe-active': 'un fil en dessous travaille encore',
  recent: 'activité récente',
  'hors-bureau': 'hors des équipes Bureau (option étendue coupée)',
};

/**
 * One decision per office thread (archived threads, team chats, salons and incognito threads are
 * not office threads and never come back). A thread is archived when ALL of these hold:
 *  - it is at rest: `idle` or `done` (never running, queued, waiting for the user, nor in error);
 *  - it is not pinned;
 *  - it is not the chef of a mission that is not `done`, nor the target of a pending Bureau notice;
 *  - no thread below it in its team is running, queued or waiting;
 *  - its last activity is older than the delay: the latest change or report of the thread itself or
 *    of any thread below it (a chef is not archived right after one of its agents finished).
 * The delay is `delayHours` for a thread of a Bureau team (a team with a mission or a declared
 * role), and `extendedDelayHours` for any other thread, which only counts when `extended` is on.
 */
export function decideArchive(input: ArchiveInput): Decision[] {
  const { registry, settings, now } = input;
  const rows = officeRows(input.threads);
  const state = buildState({ threads: rows.values(), projects: input.projects ?? [], registry, core: 'connected', now });
  const openChefs = new Set(Object.values(registry.missions).filter((mission) => mission.status !== 'done').map((mission) => mission.chefId));
  const noticed = new Set(registry.pendingNotices.map((notice) => notice.threadId));
  const decisions: Decision[] = [];

  for (const team of state.teams) {
    const managed = team.mission !== null || team.agents.some((agent) => agent.roleSource === 'declared');
    const live = (agent: OfficeAgent) => agent.state === 'running' || agent.state === 'queued' || agent.state === 'waiting';
    const children = new Map<string, OfficeAgent[]>();
    for (const agent of team.agents) {
      if (agent.parentId === null) continue;
      children.set(agent.parentId, [...(children.get(agent.parentId) ?? []), agent]);
    }
    const liveBelow = (id: string, seen = new Set<string>()): boolean => {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        if (live(child) || liveBelow(child.id, seen)) return true;
      }
      return false;
    };

    const ownActivity = (id: string) => Math.max(rows.get(id)?.updatedAt ?? 0, registry.reports[id]?.at ?? 0);
    const activityOf = (id: string, seen = new Set<string>()): number => {
      seen.add(id);
      let latest = ownActivity(id);
      for (const child of children.get(id) ?? []) if (!seen.has(child.id)) latest = Math.max(latest, activityOf(child.id, seen));
      return latest;
    };

    for (const agent of team.agents) {
      const row = rows.get(agent.id);
      if (!row) continue;
      const lastActivity = activityOf(agent.id);
      const idleHours = Math.max(0, now - lastActivity) / HOUR_MS;
      const rule: ArchiveRule = managed ? 'bureau' : 'etendu';
      const delayHours = managed ? settings.delayHours : settings.extendedDelayHours;
      const make = (keep: KeepReason | null): Decision => ({
        threadId: row.id,
        title: row.title,
        archive: keep === null,
        ...(keep === null ? { rule } : { keep }),
        idleHours,
        delayHours,
        reason: keep === null ? `${agent.state === 'done' ? 'fini' : 'au repos'} depuis ${formatHours(idleHours)} (délai ${formatHours(delayHours)}${rule === 'etendu' ? ', option étendue' : ''})` : KEEP_TEXT[keep],
      });

      let keep: KeepReason | null = null;
      if (agent.state === 'running' || agent.state === 'queued') keep = 'en-cours';
      else if (agent.state === 'waiting') keep = 'attend-reponse';
      else if (agent.state === 'error') keep = 'erreur';
      else if (row.pinned === true) keep = 'epingle';
      else if (openChefs.has(row.id)) keep = 'chef-mission';
      else if (noticed.has(row.id)) keep = 'message-en-attente';
      else if (liveBelow(row.id)) keep = 'equipe-active';
      else if (!managed && !settings.extended) keep = 'hors-bureau';
      else if (idleHours < delayHours) keep = 'recent';
      decisions.push(make(keep));
    }
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface JournalEntry {
  /** Epoch ms. */
  at: number;
  threadId: string;
  title: string;
  reason: string;
  rule: ArchiveRule;
  /** `auto`: the service; `manuel`: `boite bureau-archive`. */
  mode: 'auto' | 'manuel';
  ok: boolean;
  /** Why Boite refused, when `ok` is false. */
  error?: string;
}

export const journalPath = (dataDir: string): string => join(dataDir, JOURNAL_FILE);

export function appendJournal(dataDir: string, entry: JournalEntry): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(journalPath(dataDir), `${JSON.stringify(entry)}\n`);
}

/** The newest `limit` entries, oldest first. Unreadable lines are skipped. */
export function readJournal(dataDir: string, limit = 50): JournalEntry[] {
  let text: string;
  try {
    text = readFileSync(journalPath(dataDir), 'utf8');
  } catch {
    return [];
  }
  const entries: JournalEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const raw = JSON.parse(line) as Partial<JournalEntry>;
      if (typeof raw.threadId === 'string' && typeof raw.at === 'number') entries.push(raw as JournalEntry);
    } catch {
      // A half-written line: skip it.
    }
  }
  return entries.slice(-limit);
}

/** Keeps the journal under `JOURNAL_MAX_BYTES` by dropping its oldest lines. */
export function trimJournal(dataDir: string, maxBytes = JOURNAL_MAX_BYTES): void {
  const path = journalPath(dataDir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  if (Buffer.byteLength(text) <= maxBytes) return;
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  while (lines.length > 1 && Buffer.byteLength(lines.join('\n')) > maxBytes / 2) lines.shift();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${lines.join('\n')}\n`);
  renameSync(tmp, path);
}

/** What the view needs from the journal: the archivings of the last day, newest first. */
export function recentNotes(entries: JournalEntry[], now: number): ArchiveNote[] {
  return entries
    .filter((entry) => entry.ok && now - entry.at < ACTIVE_WINDOW_MS)
    .map((entry) => ({ threadId: entry.threadId, title: entry.title, reason: entry.reason, at: entry.at }))
    .reverse()
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

/** Archives one thread through Boite. Must throw when Boite refuses. It must never delete. */
export type Archiver = (threadId: string) => Promise<void>;

/**
 * The official archiving: Boite's `threads.archive` with `onlyIfIdle`, so a thread that started a
 * turn since the list was read is left alone. Null while Boite keeps it closed to plugins.
 */
export function coreArchiver(client: Pick<CoreClient, 'call'>): Archiver | null {
  if (!CORE_ARCHIVE_OPEN) return null;
  return async (threadId) => {
    await client.call('threads.archive', { threadId, archived: true, onlyIfIdle: true });
  };
}

export interface PassOptions extends ArchiveInput {
  mode: 'auto' | 'manuel';
  /** List only. */
  dryRun: boolean;
  /** Null: Boite offers no way to archive. */
  archiver: Archiver | null;
  /** Threads to leave out of the candidates (for example ones Boite already refused). */
  skip?: ReadonlySet<string>;
  /** Called once per archiving attempt, to write the journal. */
  record?: (entry: JournalEntry) => void;
}

export interface PassResult {
  /** Every decision, kept threads included. */
  decisions: Decision[];
  /** The threads the rules archive. */
  candidates: Decision[];
  archived: Decision[];
  failed: { decision: Decision; error: string }[];
  dryRun: boolean;
  /** True when a real pass had no archiver: nothing was archived. */
  unavailable: boolean;
}

export async function runArchivePass(options: PassOptions): Promise<PassResult> {
  const decisions = decideArchive(options);
  const candidates = decisions.filter((decision) => decision.archive && options.skip?.has(decision.threadId) !== true);
  const result: PassResult = { decisions, candidates, archived: [], failed: [], dryRun: options.dryRun, unavailable: false };
  if (options.dryRun) return result;
  if (options.archiver === null) {
    result.unavailable = candidates.length > 0;
    return result;
  }
  for (const decision of candidates) {
    const entry = { at: options.now, threadId: decision.threadId, title: decision.title, reason: decision.reason, rule: decision.rule!, mode: options.mode };
    try {
      await options.archiver(decision.threadId);
      result.archived.push(decision);
      options.record?.({ ...entry, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ decision, error: message });
      options.record?.({ ...entry, ok: false, error: message });
    }
  }
  return result;
}
