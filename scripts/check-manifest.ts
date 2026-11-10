/*
 * Checks `boite-plugin.json` against the schema 2 rules of Boite's plugin
 * reader (docs/plugins.md: Schema 2, Permissions, Limits): names, lengths,
 * at most 20 entries, known permissions, no unknown field at any depth.
 * Also refuses the em and en dashes the project bans in visible texts.
 *
 * `bun scripts/check-manifest.ts [path]`, `bun run check:manifest`.
 */
import { readFileSync } from 'node:fs';

export const ZERO = '0'.repeat(64);
const TOP = ['schema', 'id', 'name', 'version', 'description', 'homepage', 'runtime', 'executable', 'artifacts', 'permissions', 'provides'];
const PROVIDES = ['accountPools', 'desktopApp', 'gateway', 'service', 'commands', 'skills', 'prompt', 'slashCommands'];
const PERMISSIONS = ['threads.read', 'threads.write', 'todos', 'ui.reveal'];
const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ENTRY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
// En and em dash, spelled by code point so this file holds none itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasControl = (text: string) => [...text].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

function httpsProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return 'an https URL of at most 2048 characters';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.host || url.username || url.password) return 'an https URL with a host and no credentials';
  } catch {
    return 'an https URL';
  }
  return null;
}

/** The problems with the manifest text, none when it is sound. */
export function manifestProblems(text: string, file = 'boite-plugin.json'): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return [`${file}: not JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!isObject(raw)) return [`${file}: must be a JSON object`];
  const problems: string[] = [];
  const refuse = (field: string, expected: string) => problems.push(`${file}: ${field} must be ${expected}`);
  const unknownKeys = (value: Record<string, unknown>, allowed: string[], field: string) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) refuse(field ? `${field}.${key}` : key, `one of ${allowed.join(', ')} (unknown field)`);
  };
  const string = (value: unknown, field: string, min: number, max: number): value is string => {
    if (typeof value !== 'string' || value.length < min || value.length > max || hasControl(value)) {
      refuse(field, `${min === 0 ? 'at most' : `${min} to`} ${max} characters, no control characters`);
      return false;
    }
    return true;
  };
  const noDash = (value: string, field: string) => {
    if (DASHES.test(value)) refuse(field, 'free of em and en dashes');
  };

  unknownKeys(raw, TOP, '');
  if (raw.schema !== 2) refuse('schema', '2');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) refuse('id', 'lowercase letters, digits and inner hyphens, 1 to 64 characters');
  else if (raw.id !== 'bureau') refuse('id', 'bureau');
  string(raw.name, 'name', 1, 60);
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) refuse('version', 'MAJOR.MINOR.PATCH');
  string(raw.description, 'description', 1, 300);
  const homepage = httpsProblem(raw.homepage);
  if (homepage) refuse('homepage', homepage);

  if (raw.runtime !== 'bun') refuse('runtime', '"bun"');
  if (typeof raw.executable !== 'string' || !EXECUTABLE.test(raw.executable)) refuse('executable', 'a file name without extension');
  else if (raw.executable !== 'bureau') refuse('executable', 'bureau');

  const artifacts = raw.artifacts;
  if (!isObject(artifacts) || Object.keys(artifacts).length !== 1 || !('any' in artifacts)) {
    refuse('artifacts', 'exactly one key, "any" (runtime bun)');
  } else {
    const any = artifacts.any;
    if (!isObject(any)) refuse('artifacts.any', '{ "url", "sha256" }');
    else {
      unknownKeys(any, ['url', 'sha256'], 'artifacts.any');
      const url = httpsProblem(any.url);
      if (url) refuse('artifacts.any.url', url);
      if (typeof any.sha256 !== 'string' || !SHA256.test(any.sha256)) refuse('artifacts.any.sha256', '64 lowercase hexadecimal characters');
    }
  }

  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions)) refuse('permissions', 'a list');
    else {
      raw.permissions.forEach((permission: unknown, index: number) => {
        if (typeof permission !== 'string' || !PERMISSIONS.includes(permission)) refuse(`permissions[${index}]`, `one of ${PERMISSIONS.join(', ')}`);
      });
      if (new Set(raw.permissions).size !== raw.permissions.length) refuse('permissions', 'distinct names');
    }
  }

  const provides = raw.provides;
  if (!isObject(provides)) {
    refuse('provides', 'an object');
    return problems;
  }
  unknownKeys(provides, PROVIDES, 'provides');
  if (Object.keys(provides).length === 0) refuse('provides', 'at least one feature');
  if ('service' in provides && (!isObject(provides.service) || Object.keys(provides.service).length !== 0)) refuse('provides.service', '{}');

  const entries = (field: 'commands' | 'skills' | 'slashCommands', allowed: string[], check: (entry: Record<string, unknown>, where: string) => void) => {
    const list = provides[field];
    if (list === undefined) return;
    if (!Array.isArray(list)) return refuse(`provides.${field}`, 'a list');
    if (list.length > 20) refuse(`provides.${field}`, 'at most 20 entries');
    const names = new Set<string>();
    list.forEach((entry: unknown, index: number) => {
      const where = `provides.${field}[${index}]`;
      if (!isObject(entry)) return refuse(where, 'an object');
      unknownKeys(entry, allowed, where);
      if (typeof entry.name !== 'string' || entry.name.length < 1 || entry.name.length > 40 || !ENTRY_NAME.test(entry.name)) {
        refuse(`${where}.name`, 'lowercase words joined by hyphens, 1 to 40 characters');
      } else if (names.has(entry.name)) refuse(`${where}.name`, 'unique');
      else names.add(entry.name);
      if (string(entry.description, `${where}.description`, 1, 200)) noDash(entry.description, `${where}.description`);
      check(entry, where);
    });
  };
  entries('commands', ['name', 'description', 'usage'], (entry, where) => {
    if (entry.usage !== undefined && string(entry.usage, `${where}.usage`, 0, 200)) noDash(entry.usage as string, `${where}.usage`);
  });
  entries('skills', ['name', 'description', 'body'], (entry, where) => {
    if (typeof entry.body !== 'string' || entry.body.trim() === '') refuse(`${where}.body`, 'the text of a SKILL.md');
    else {
      if (Buffer.byteLength(entry.body) > 32 * 1024) refuse(`${where}.body`, 'at most 32 KB');
      noDash(entry.body, `${where}.body`);
    }
  });
  entries('slashCommands', ['name', 'description', 'hint', 'prompt'], (entry, where) => {
    if (entry.hint !== undefined && typeof entry.hint !== 'string') refuse(`${where}.hint`, 'a string');
    if (typeof entry.prompt !== 'string' || entry.prompt.trim() === '' || Buffer.byteLength(entry.prompt) > 8 * 1024) refuse(`${where}.prompt`, 'a text of at most 8 KB');
    else noDash(entry.prompt, `${where}.prompt`);
  });
  if (provides.prompt !== undefined && string(provides.prompt, 'provides.prompt', 1, 1000)) noDash(provides.prompt, 'provides.prompt');

  return problems;
}

/** Whether the digest is still the placeholder `bun run pack` replaces. */
export function unpacked(text: string): boolean {
  const artifacts = (JSON.parse(text) as { artifacts?: { any?: { sha256?: string } } }).artifacts;
  return artifacts?.any?.sha256 === ZERO;
}

if (import.meta.main) {
  const path = process.argv[2] ?? 'boite-plugin.json';
  const text = readFileSync(path, 'utf8');
  const problems = manifestProblems(text, path);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`${path}: accepted${unpacked(text) ? ' (sha256 is still the placeholder: run bun run pack)' : ''}`);
}
