/*
 * Bureau's registry: `<BOITE_PLUGIN_DATA>/registre.json`. It holds the roles
 * agents declare, the missions chefs propose, the reports agents file and the
 * notices waiting for a busy chef. Writers take the `registre.lock` lock and
 * replace the file atomically; readers never need the lock.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lot, LotState, Mission, Report, Role } from './model';

export const REGISTRY_FILE = 'registre.json';
export const LOCK_FILE = 'registre.lock';
/** Longest wait for the lock, in milliseconds. */
export const LOCK_WAIT_MS = 5_000;
/** A lock older than this is considered abandoned. */
export const LOCK_STALE_MS = 30_000;
/** Largest report, in bytes. */
export const REPORT_MAX_BYTES = 64 * 1024;

export interface RoleEntry {
  role: Role;
  service: string | null;
  files: string[];
  at: number;
  /**
   * The chef this manager reports to, set by `boite bureau-role manager --chef <id>`.
   * It places a conversation started with `boite thread new` (so with no `parentThreadId`) under that chef.
   */
  chefId?: string;
}

export interface Notice {
  threadId: string;
  prompt: string;
  at: number;
}

export interface Registry {
  version: 1;
  roles: Record<string, RoleEntry>;
  missions: Record<string, Mission>;
  reports: Record<string, Report>;
  pendingNotices: Notice[];
}

/** A registry problem the user can act on; the message is French and says what to do. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export const emptyRegistry = (): Registry => ({ version: 1, roles: {}, missions: {}, reports: {}, pendingNotices: [] });

export const registryPath = (dataDir: string): string => join(dataDir, REGISTRY_FILE);
export const lockPath = (dataDir: string): string => join(dataDir, LOCK_FILE);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses the registry text. An empty text is an empty registry. */
export function parseRegistry(text: string): Registry {
  if (text.trim() === '') return emptyRegistry();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RegistryError(`${REGISTRY_FILE} n'est pas du JSON valide. Supprime ce fichier dans le dossier de données du plugin : Bureau le recrée vide.`);
  }
  if (!isObject(raw) || raw.version !== 1) {
    throw new RegistryError(`${REGISTRY_FILE} a une version inconnue (attendu : 1). Supprime ce fichier : Bureau le recrée vide.`);
  }
  return {
    version: 1,
    roles: isObject(raw.roles) ? (raw.roles as Record<string, RoleEntry>) : {},
    missions: isObject(raw.missions) ? (raw.missions as Record<string, Mission>) : {},
    reports: isObject(raw.reports) ? (raw.reports as Record<string, Report>) : {},
    pendingNotices: Array.isArray(raw.pendingNotices) ? (raw.pendingNotices as Notice[]) : [],
  };
}

/** The raw text of the registry file, '' when it does not exist yet. */
export function readRegistryText(dataDir: string): string {
  try {
    return readFileSync(registryPath(dataDir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export function readRegistry(dataDir: string): Registry {
  return parseRegistry(readRegistryText(dataDir));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface LockOptions {
  waitMs?: number;
  staleMs?: number;
}

/** Takes `registre.lock` by exclusive creation. Returns the function that releases it. */
export async function acquireLock(dataDir: string, options: LockOptions = {}): Promise<() => void> {
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const path = lockPath(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const deadline = Date.now() + waitMs;
  for (let delay = 10; ; delay = Math.min(delay * 2, 100)) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeFileSync(fd, `${process.pid} ${Date.now()}\n`);
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // Already removed, for example by a writer that judged it stale.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try {
      if (Date.now() - statSync(path).mtimeMs > staleMs) {
        unlinkSync(path);
        continue;
      }
    } catch {
      // The holder released it between our two calls: try again at once.
      continue;
    }
    if (Date.now() >= deadline) {
      throw new RegistryError(`Le registre est verrouillé depuis plus de ${Math.round(waitMs / 1000)} s (${LOCK_FILE}). Relance la commande ; si cela dure, supprime ${LOCK_FILE} dans le dossier de données du plugin.`);
    }
    await sleep(delay);
  }
}

/** Writes the registry atomically: a temporary file, then a rename over the real one. */
export function writeRegistryAtomic(dataDir: string, registry: Registry): void {
  mkdirSync(dataDir, { recursive: true });
  const target = registryPath(dataDir);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`);
  // A reader that has the file open can make the rename fail briefly on Windows.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        try {
          unlinkSync(temp);
        } catch {
          // Nothing to clean.
        }
        throw error;
      }
      Bun.sleepSync(10);
    }
  }
}

/**
 * Reads the registry under the lock, lets `change` edit it, and writes it
 * back. When `change` throws nothing is written. Returns what `change` returns.
 */
export async function updateRegistry<T>(dataDir: string, change: (registry: Registry) => T, options: LockOptions = {}): Promise<T> {
  const release = await acquireLock(dataDir, options);
  try {
    const registry = readRegistry(dataDir);
    const result = change(registry);
    writeRegistryAtomic(dataDir, registry);
    return result;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Plan validation
// ---------------------------------------------------------------------------

export interface Plan {
  title: string;
  summary: string;
  budget: { maxAgents: number | null; models: string[] };
  lots: { id: string; title: string; service: string; model: string }[];
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

const LOT_ID = /^[A-Za-z0-9_-]{1,20}$/;
const hasControl = (text: string) => [...text].some((char) => char.charCodeAt(0) < 0x20 && char !== '\n' && char !== '\t');

/** Strict check of a parsed plan.json. Every error says what to change; all errors come back at once. */
export function validatePlan(raw: unknown): PlanResult {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['Le plan doit être un objet JSON : { "title", "summary", "lots": [...] }.'] };

  const known = ['title', 'summary', 'budget', 'lots'];
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) errors.push(`Champ inconnu « ${key} » : supprime-le (champs permis : ${known.join(', ')}).`);
  }

  const text = (value: unknown, field: string, max: number, what: string): string | null => {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`« ${field} » doit être ${what} non vide (texte).`);
      return null;
    }
    if (value.length > max) {
      errors.push(`« ${field} » est trop long (${value.length} caractères, ${max} au plus) : raccourcis-le.`);
      return null;
    }
    if (hasControl(value)) {
      errors.push(`« ${field} » contient des caractères de contrôle : retire-les.`);
      return null;
    }
    return value.trim();
  };

  const title = text(raw.title, 'title', 200, 'un titre');
  const summary = text(raw.summary, 'summary', 4000, 'un résumé de 2 à 4 lignes');

  let maxAgents: number | null = null;
  let models: string[] = [];
  if (raw.budget !== undefined) {
    const budget = raw.budget;
    if (!isObject(budget)) {
      errors.push('« budget » doit être un objet : { "maxAgents": 8, "models": ["claude/claude-sonnet-5-5"] }.');
    } else {
      for (const key of Object.keys(budget)) {
        if (key !== 'maxAgents' && key !== 'models') errors.push(`Champ inconnu « budget.${key} » : supprime-le (permis : maxAgents, models).`);
      }
      if (budget.maxAgents !== undefined) {
        const value = budget.maxAgents;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
          errors.push('« budget.maxAgents » doit être un entier de 1 à 100 (ou absent pour ne pas limiter).');
        } else {
          maxAgents = value;
        }
      }
      if (budget.models !== undefined) {
        const list = budget.models;
        if (!Array.isArray(list) || list.some((model) => typeof model !== 'string' || model.trim() === '')) {
          errors.push('« budget.models » doit être une liste de modèles (texte non vide), par exemple ["claude/claude-sonnet-5-5"].');
        } else {
          models = list.map((model) => (model as string).trim());
        }
      }
    }
  }

  const lots: Plan['lots'] = [];
  if (!Array.isArray(raw.lots)) {
    errors.push('« lots » doit être une liste de 1 à 40 lots : [{ "id": "L1", "title": "...", "service": "Développement", "model": "claude/claude-sonnet-5-5" }].');
  } else if (raw.lots.length < 1 || raw.lots.length > 40) {
    errors.push(`« lots » doit contenir de 1 à 40 lots (il en contient ${raw.lots.length}).`);
  } else {
    const seen = new Set<string>();
    raw.lots.forEach((entry: unknown, index: number) => {
      const where = `lots[${index}]`;
      if (!isObject(entry)) {
        errors.push(`${where} doit être un objet { "id", "title", "service", "model" }.`);
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!['id', 'title', 'service', 'model'].includes(key)) errors.push(`Champ inconnu « ${where}.${key} » : supprime-le (permis : id, title, service, model).`);
      }
      let id: string | null = null;
      if (typeof entry.id !== 'string' || !LOT_ID.test(entry.id)) {
        errors.push(`« ${where}.id » doit faire 1 à 20 caractères parmi A-Z, a-z, 0-9, _ et - (par exemple "L1").`);
      } else if (seen.has(entry.id)) {
        errors.push(`« ${where}.id » : l'id « ${entry.id} » est déjà pris par un autre lot. Donne un id unique à chaque lot.`);
      } else {
        seen.add(entry.id);
        id = entry.id;
      }
      const lotTitle = text(entry.title, `${where}.title`, 200, 'un titre de lot');
      const service = text(entry.service, `${where}.service`, 60, 'un service (Produit, Architecture, Développement, Design, Qualité)');
      const model = text(entry.model, `${where}.model`, 120, 'un modèle (par exemple "claude/claude-sonnet-5-5")');
      if (id !== null && lotTitle !== null && service !== null && model !== null) lots.push({ id, title: lotTitle, service, model });
    });
  }

  if (errors.length > 0 || title === null || summary === null) return { ok: false, errors };
  return { ok: true, plan: { title, summary, budget: { maxAgents, models }, lots } };
}

// ---------------------------------------------------------------------------
// Edits on the registry. Each one runs inside `updateRegistry`.
// ---------------------------------------------------------------------------

export function newMissionId(existing: Record<string, unknown>): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    const id = `m-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`;
    if (!(id in existing)) return id;
  }
}

export function declareRole(
  registry: Registry,
  threadId: string,
  entry: { role: Role; service?: string; files?: string[]; chefId?: string },
  now = Date.now()
): RoleEntry {
  const before = registry.roles[threadId];
  const next: RoleEntry = {
    role: entry.role,
    service: entry.service ?? before?.service ?? null,
    files: entry.files ?? before?.files ?? [],
    at: now,
  };
  // The link survives a later declaration that does not mention it, but only while the thread stays a manager.
  const chefId = entry.chefId ?? (entry.role === 'manager' ? before?.chefId : undefined);
  if (typeof chefId === 'string' && chefId !== '') next.chefId = chefId;
  registry.roles[threadId] = next;
  return next;
}

/** The `proposed` mission of a chef, if any. */
export function proposedMissionOf(registry: Registry, chefId: string): Mission | null {
  return Object.values(registry.missions).find((mission) => mission.chefId === chefId && mission.status === 'proposed') ?? null;
}

export function createMission(registry: Registry, chefId: string, plan: Plan, now = Date.now()): Mission {
  const id = newMissionId(registry.missions);
  const lots: Lot[] = plan.lots.map((lot) => ({ ...lot, agentId: null, state: 'todo' }));
  const mission: Mission = {
    id,
    chefId,
    title: plan.title,
    summary: plan.summary,
    budget: { maxAgents: plan.budget.maxAgents, models: plan.budget.models },
    lots,
    status: 'proposed',
    createdAt: now,
    validatedAt: null,
    validatedVia: null,
  };
  registry.missions[id] = mission;
  return mission;
}

export function dropMission(registry: Registry, missionId: string): void {
  delete registry.missions[missionId];
  registry.pendingNotices = registry.pendingNotices.filter((notice) => !notice.prompt.includes(missionId));
}

export function markValidated(mission: Mission, via: 'bureau' | 'chat', now = Date.now()): void {
  mission.status = 'validated';
  mission.validatedAt = now;
  mission.validatedVia = via;
}

export function setLotState(mission: Mission, lotId: string, state: LotState, agentId: string | undefined): Lot | null {
  const lot = mission.lots.find((entry) => entry.id === lotId);
  if (!lot) return null;
  lot.state = state;
  if (agentId !== undefined) lot.agentId = agentId;
  return lot;
}

/** The notice the service sends to a chef once its plan is validated in Bureau. */
export function validationPrompt(missionId: string): string {
  return `Le plan ${missionId} a été validé dans Bureau. Lance les lots.`;
}

export const registryExists = (dataDir: string): boolean => existsSync(registryPath(dataDir));
