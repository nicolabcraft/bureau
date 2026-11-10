import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendJournal,
  CORE_ARCHIVE_OPEN,
  DEFAULT_SETTINGS,
  decideArchive,
  HOUR_MS,
  journalPath,
  parseSettings,
  readJournal,
  readSettings,
  recentNotes,
  runArchivePass,
  SETTINGS_FILE,
  trimJournal,
  writeSettings,
  type ArchiveSettings,
  type Decision,
  type JournalEntry,
} from '../src/archive';
import { runCommand } from '../src/commands';
import type { ThreadRow } from '../src/core-types';
import type { Mission } from '../src/model';
import { emptyRegistry, type Registry } from '../src/registry';
import { startService, type Service } from '../src/service';
import { capture, cleanTempDirs, fakeCore, TOKEN, tempDir, thread, waitFor, type FakeCore } from './helpers';

const NOW = 1_000 * HOUR_MS;
/** A thread that last changed `hours` hours before NOW. */
const idleFor = (id: string, hours: number, extra: Partial<ThreadRow> = {}): ThreadRow => thread(id, { createdAt: 1, updatedAt: NOW - hours * HOUR_MS, ...extra });
const mission = (id: string, chefId: string, status: Mission['status']): Mission => ({
  id,
  chefId,
  title: id,
  summary: '',
  budget: { maxAgents: null, models: [] },
  lots: [],
  status,
  createdAt: 1,
  validatedAt: null,
  validatedVia: null,
});
/** A registry that makes the team of `ids` a Bureau team (declared roles). */
const bureauRegistry = (...ids: string[]): Registry => {
  const registry = emptyRegistry();
  for (const id of ids) registry.roles[id] = { role: 'agent', service: null, files: [], at: 1 };
  return registry;
};
const settings = (extra: Partial<ArchiveSettings> = {}): ArchiveSettings => ({ ...DEFAULT_SETTINGS, ...extra });

function decide(threads: ThreadRow[], registry: Registry = emptyRegistry(), config: ArchiveSettings = settings()): Record<string, Decision> {
  return Object.fromEntries(decideArchive({ threads, registry, settings: config, now: NOW }).map((decision) => [decision.threadId, decision]));
}
const archivedIds = (decisions: Record<string, Decision>) =>
  Object.values(decisions)
    .filter((decision) => decision.archive)
    .map((decision) => decision.threadId)
    .sort();

describe('defaults', () => {
  test('6 h, option étendue coupée, 48 h pour l\'option étendue', () => {
    expect(DEFAULT_SETTINGS).toEqual({ auto: true, delayHours: 6, extended: false, extendedDelayHours: 48 });
  });
  test('Boite does not open threads.archive to plugins yet, so the core archiver stays off', () => {
    expect(CORE_ARCHIVE_OPEN).toBe(false);
  });
});

describe('what is archived (Bureau teams)', () => {
  const team = (hours: number, extra: Partial<ThreadRow> = {}) => [
    idleFor('chef', hours),
    idleFor('child', hours, { parentThreadId: 'chef', ...extra }),
  ];

  test('a finished child and an idle chef with no mission, at rest for more than 6 h', () => {
    const decisions = decide(team(7), bureauRegistry('chef'));
    expect(archivedIds(decisions)).toEqual(['chef', 'child']);
    expect(decisions.child).toMatchObject({ archive: true, rule: 'bureau', delayHours: 6 });
    expect(decisions.child!.reason).toBe('fini depuis 7 h (délai 6 h)');
    expect(decisions.chef!.reason).toBe('au repos depuis 7 h (délai 6 h)');
  });

  test('the chef of a finished mission', () => {
    const registry = bureauRegistry();
    registry.missions.m1 = mission('m1', 'chef', 'done');
    expect(archivedIds(decide(team(7), registry))).toEqual(['chef', 'child']);
  });

  test('a manager attached by a chef link, once its report is old enough', () => {
    const registry = emptyRegistry();
    registry.roles.resp = { role: 'manager', service: 'Développement', files: [], at: 1, chefId: 'chef' };
    registry.reports.resp = { text: 'fini', at: NOW - 8 * HOUR_MS };
    const decisions = decide([idleFor('chef', 9), idleFor('resp', 9)], registry);
    expect(decisions.resp).toMatchObject({ archive: true, rule: 'bureau' });
  });

  test('the delay is inclusive: exactly 6 h archives, a minute less does not', () => {
    expect(decide(team(6), bureauRegistry('chef')).child!.archive).toBe(true);
    const almost = decide([idleFor('chef', 6 - 1 / 60), idleFor('child', 6 - 1 / 60, { parentThreadId: 'chef' })], bureauRegistry('chef'));
    expect(almost.child).toMatchObject({ archive: false, keep: 'recent' });
  });

  test('the delay is a setting', () => {
    const rows = team(3);
    expect(archivedIds(decide(rows, bureauRegistry('chef'), settings({ delayHours: 2 })))).toEqual(['chef', 'child']);
    expect(archivedIds(decide(rows, bureauRegistry('chef'), settings({ delayHours: 4 })))).toEqual([]);
  });

  test('a later report counts as activity', () => {
    const registry = bureauRegistry('chef');
    registry.reports.child = { text: 'ok', at: NOW - 1 * HOUR_MS };
    const decisions = decide(team(20), registry);
    expect(decisions.child).toMatchObject({ archive: false, keep: 'recent' });
    expect(decisions.chef!.archive).toBe(false);
  });
});

describe('what is never archived', () => {
  const alone = (extra: Partial<ThreadRow>, registry = bureauRegistry('t')) => decide([idleFor('t', 100, extra)], registry).t!;

  test('a thread at work: running, queued', () => {
    expect(alone({ status: 'running', runningSince: 1 })).toMatchObject({ archive: false, keep: 'en-cours' });
    expect(alone({ status: 'queued' })).toMatchObject({ archive: false, keep: 'en-cours' });
  });

  test('a thread that waits for the user: a permission or an open question', () => {
    expect(alone({ status: 'waiting' })).toMatchObject({ archive: false, keep: 'attend-reponse' });
    expect(alone({ openQuestions: 1 })).toMatchObject({ archive: false, keep: 'attend-reponse' });
    // An open question wins over a rest status.
    expect(alone({ status: 'idle', openQuestions: 2 }).keep).toBe('attend-reponse');
  });

  test('a thread in error', () => {
    expect(alone({ status: 'error' })).toMatchObject({ archive: false, keep: 'erreur' });
  });

  test('a pinned thread', () => {
    expect(alone({ pinned: true })).toMatchObject({ archive: false, keep: 'epingle' });
    expect(alone({ pinned: false }).archive).toBe(true);
  });

  test('the chef of a mission that is not finished (proposed or validated)', () => {
    for (const status of ['proposed', 'validated'] as const) {
      const registry = bureauRegistry();
      registry.missions.m1 = mission('m1', 't', status);
      expect(alone({}, registry)).toMatchObject({ archive: false, keep: 'chef-mission' });
    }
  });

  test('a thread a Bureau message waits for', () => {
    const registry = bureauRegistry('t');
    registry.pendingNotices.push({ threadId: 't', prompt: 'x', at: 1 });
    expect(alone({}, registry)).toMatchObject({ archive: false, keep: 'message-en-attente' });
  });

  test('a thread above one that still works, at any depth', () => {
    const rows = [
      idleFor('chef', 100),
      idleFor('mgr', 100, { parentThreadId: 'chef' }),
      idleFor('deep', 100, { parentThreadId: 'mgr', status: 'running', runningSince: 1 }),
      idleFor('other', 100, { parentThreadId: 'chef' }),
    ];
    const decisions = decide(rows, bureauRegistry('chef'));
    expect(decisions.chef).toMatchObject({ archive: false, keep: 'equipe-active' });
    expect(decisions.mgr).toMatchObject({ archive: false, keep: 'equipe-active' });
    expect(decisions.deep).toMatchObject({ archive: false, keep: 'en-cours' });
    expect(decisions.other!.archive).toBe(true);
  });

  test('a thread whose child waits for the user', () => {
    const rows = [idleFor('chef', 100), idleFor('child', 100, { parentThreadId: 'chef', openQuestions: 1 })];
    expect(decide(rows, bureauRegistry('chef')).chef!.keep).toBe('equipe-active');
  });

  test('archived threads, team chats, salons and incognito threads get no decision', () => {
    const rows = [
      idleFor('gone', 100, { archived: true }),
      idleFor('chat', 100, { teamId: 'team' }),
      idleFor('salon', 100, { councilId: 'c' }),
      idleFor('secret', 100, { incognito: true }),
    ];
    expect(decideArchive({ threads: rows, registry: emptyRegistry(), settings: settings({ extended: true }), now: NOW })).toEqual([]);
  });

  test('nothing is ever deleted: a decision only asks to archive', () => {
    const [decision] = decideArchive({ threads: [idleFor('t', 100)], registry: bureauRegistry('t'), settings: settings(), now: NOW });
    expect(Object.keys(decision!).sort()).toEqual(['archive', 'delayHours', 'idleHours', 'reason', 'rule', 'threadId', 'title']);
  });
});

describe('extended option (every inactive thread)', () => {
  const loose = [idleFor('lone', 60), idleFor('young', 30), idleFor('busy', 100, { status: 'running', runningSince: 1 })];

  test('off by default: a thread outside the Bureau teams is kept', () => {
    const decisions = decide(loose);
    expect(archivedIds(decisions)).toEqual([]);
    expect(decisions.lone).toMatchObject({ archive: false, keep: 'hors-bureau' });
  });

  test('on: archived after 48 h, kept before, with the same exclusions', () => {
    const decisions = decide(loose, emptyRegistry(), settings({ extended: true }));
    expect(decisions.lone).toMatchObject({ archive: true, rule: 'etendu', delayHours: 48 });
    expect(decisions.lone!.reason).toContain('option étendue');
    expect(decisions.young).toMatchObject({ archive: false, keep: 'recent' });
    expect(decisions.busy).toMatchObject({ archive: false, keep: 'en-cours' });
    expect(archivedIds(decisions)).toEqual(['lone']);
  });

  test('on: the extended delay is a setting', () => {
    expect(archivedIds(decide(loose, emptyRegistry(), settings({ extended: true, extendedDelayHours: 24 })))).toEqual(['lone', 'young']);
  });

  test('on: pinned, waiting, error and unfinished-mission threads are still kept', () => {
    const registry = emptyRegistry();
    registry.missions.m1 = mission('m1', 'chef', 'validated');
    const rows = [idleFor('pin', 90, { pinned: true }), idleFor('wait', 90, { openQuestions: 1 }), idleFor('err', 90, { status: 'error' }), idleFor('chef', 90)];
    const decisions = decide(rows, registry, settings({ extended: true }));
    expect(archivedIds(decisions)).toEqual([]);
  });

  test('a Bureau team keeps the short delay even when the option is on', () => {
    const rows = [idleFor('chef', 7), idleFor('child', 7, { parentThreadId: 'chef' }), idleFor('lone', 7)];
    const decisions = decide(rows, bureauRegistry('chef'), settings({ extended: true }));
    expect(archivedIds(decisions)).toEqual(['chef', 'child']);
    expect(decisions.lone).toMatchObject({ archive: false, keep: 'recent' });
  });
});

describe('settings', () => {
  test('parseSettings keeps defaults for a missing, broken or invalid file', () => {
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{ not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ archivage: { auto: 'yes', delaiHeures: -3, etendu: 1, delaiEtenduHeures: 'x' } }))).toEqual(DEFAULT_SETTINGS);
  });

  test('write then read, and the file lives in the data directory', () => {
    const dir = tempDir();
    expect(readSettings(dir)).toEqual(DEFAULT_SETTINGS);
    writeSettings(dir, { auto: false, delayHours: 1.5, extended: true, extendedDelayHours: 72 });
    expect(existsSync(join(dir, SETTINGS_FILE))).toBe(true);
    expect(readSettings(dir)).toEqual({ auto: false, delayHours: 1.5, extended: true, extendedDelayHours: 72 });
  });

  test('a delay of 0 or less is refused', () => {
    expect(() => writeSettings(tempDir(), settings({ delayHours: 0 }))).toThrow('supérieur à 0');
  });
});

describe('a pass', () => {
  const rows = [idleFor('chef', 10), idleFor('child', 10, { parentThreadId: 'chef' }), idleFor('busy', 10, { parentThreadId: 'chef', status: 'running', runningSince: 1 }), idleFor('old', 10, { parentThreadId: 'chef' })];
  const base = { threads: rows, registry: bureauRegistry('chef'), settings: settings(), now: NOW, mode: 'auto' as const };

  test('a dry run lists the candidates and touches nothing', async () => {
    const calls: string[] = [];
    const records: JournalEntry[] = [];
    const result = await runArchivePass({ ...base, dryRun: true, archiver: async (id) => void calls.push(id), record: (entry) => records.push(entry) });
    // The chef stays: busy, below it, still works.
    expect(result.candidates.map((decision) => decision.threadId).sort()).toEqual(['child', 'old']);
    expect(result).toMatchObject({ dryRun: true, archived: [], failed: [], unavailable: false });
    expect(calls).toEqual([]);
    expect(records).toEqual([]);
  });

  test('a real pass archives each candidate once and journals it', async () => {
    const calls: string[] = [];
    const records: JournalEntry[] = [];
    const result = await runArchivePass({ ...base, dryRun: false, archiver: async (id) => void calls.push(id), record: (entry) => records.push(entry) });
    expect(calls.sort()).toEqual(['child', 'old']);
    expect(result.archived).toHaveLength(2);
    expect(records.map((entry) => entry.threadId).sort()).toEqual(['child', 'old']);
    expect(records[0]).toMatchObject({ at: NOW, ok: true, rule: 'bureau', mode: 'auto' });
    expect(records[0]!.reason).toContain('depuis 10 h');
  });

  test('a refusal by Boite is journaled as failed and the pass goes on', async () => {
    const records: JournalEntry[] = [];
    const result = await runArchivePass({
      ...base,
      dryRun: false,
      archiver: async (id) => {
        if (id === 'child') throw new Error('child is not open to plugins');
      },
      record: (entry) => records.push(entry),
    });
    expect(result.archived.map((decision) => decision.threadId)).toEqual(['old']);
    expect(result.failed).toEqual([{ decision: expect.objectContaining({ threadId: 'child' }), error: 'child is not open to plugins' }]);
    expect(records.find((entry) => entry.threadId === 'child')).toMatchObject({ ok: false, error: 'child is not open to plugins' });
  });

  test('without an archiver nothing is archived and the pass says it is unavailable', async () => {
    const records: JournalEntry[] = [];
    const result = await runArchivePass({ ...base, dryRun: false, archiver: null, record: (entry) => records.push(entry) });
    expect(result).toMatchObject({ unavailable: true, archived: [], failed: [] });
    expect(result.candidates).toHaveLength(2);
    expect(records).toEqual([]);
  });

  test('skip leaves out threads Boite already refused', async () => {
    const calls: string[] = [];
    await runArchivePass({ ...base, dryRun: false, skip: new Set(['child']), archiver: async (id) => void calls.push(id) });
    expect(calls).toEqual(['old']);
  });
});

describe('journal', () => {
  const entry = (n: number, extra: Partial<JournalEntry> = {}): JournalEntry => ({ at: n, threadId: `t${n}`, title: `Fil ${n}`, reason: 'au repos', rule: 'bureau', mode: 'auto', ok: true, ...extra });

  test('appends lines, reads the newest ones, skips a broken line', () => {
    const dir = tempDir();
    expect(readJournal(dir)).toEqual([]);
    for (let n = 1; n <= 5; n++) appendJournal(dir, entry(n));
    writeFileSync(journalPath(dir), `${readFileSync(journalPath(dir), 'utf8')}{broken\n`);
    expect(readJournal(dir, 3).map((line) => line.threadId)).toEqual(['t3', 't4', 't5']);
  });

  test('the view gets the successful archivings of the last day, newest first', () => {
    const entries = [entry(1, { at: NOW - 30 * HOUR_MS }), entry(2, { at: NOW - 2 * HOUR_MS }), entry(3, { at: NOW - 1 * HOUR_MS, ok: false, error: 'non' }), entry(4, { at: NOW - 1 * HOUR_MS })];
    expect(recentNotes(entries, NOW).map((note) => note.threadId)).toEqual(['t4', 't2']);
  });

  test('trims to its newest lines past the size limit', () => {
    const dir = tempDir();
    for (let n = 1; n <= 40; n++) appendJournal(dir, entry(n));
    trimJournal(dir, 1_000);
    const kept = readJournal(dir, 1_000);
    expect(kept.length).toBeLessThan(40);
    expect(kept.at(-1)!.threadId).toBe('t40');
  });
});

// ---------------------------------------------------------------------------
// Service and command
// ---------------------------------------------------------------------------

const services: Service[] = [];
const cores: FakeCore[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const fake of cores.splice(0)) fake.stop();
});
afterAll(cleanTempDirs);

const real = Date.now();
const hoursAgo = (hours: number) => real - hours * HOUR_MS;
const liveRows = [
  thread('chef', { title: 'Chef', createdAt: 1, updatedAt: hoursAgo(10) }),
  thread('done1', { title: 'Agent fini', parentThreadId: 'chef', createdAt: 2, updatedAt: hoursAgo(10) }),
  thread('fresh', { title: 'Agent au travail', parentThreadId: 'chef', status: 'running', runningSince: hoursAgo(1), createdAt: 3, updatedAt: hoursAgo(1) }),
];
/** The registry of a Bureau team: the chef declared its role. */
const writeTeamRegistry = (dir: string) => writeFileSync(join(dir, 'registre.json'), JSON.stringify({ version: 1, roles: { chef: { role: 'chef', service: null, files: [], at: 1 } } }));

async function startWith(archiver: Parameters<typeof startService>[0]['archiver'], archiveEveryMs = 0) {
  const dataDir = tempDir();
  writeTeamRegistry(dataDir);
  const fake = fakeCore({ 'threads.list': () => liveRows, 'projects.list': () => [] });
  cores.push(fake);
  const service = await startService({ dataDir, page: '<p>x</p>', version: '0.0.0', port: 0, debounceMs: 20, pollMs: 100, log: () => {}, coreUrl: fake.url, token: TOKEN, archiver, archiveEveryMs });
  services.push(service);
  await waitFor(() => service.snapshot().core === 'connected', 'the core');
  return { service, dataDir, fake };
}

describe('service', () => {
  test('archiveNow archives the eligible threads, journals them and lists them in the state', async () => {
    const calls: string[] = [];
    const { service, dataDir } = await startWith(async (id) => void calls.push(id));
    // The chef has a child at work, so it stays; the child at rest goes.
    const result = await service.archiveNow();
    expect(result.archived.map((decision) => decision.threadId)).toEqual(['done1']);
    expect(calls).toEqual(['done1']);
    expect(readJournal(dataDir)).toMatchObject([{ threadId: 'done1', ok: true, mode: 'auto', rule: 'bureau' }]);
    expect(service.snapshot().archives).toMatchObject([{ threadId: 'done1', title: 'Agent fini' }]);
  });

  test('a dry run lists and changes nothing', async () => {
    const calls: string[] = [];
    const { service, dataDir } = await startWith(async (id) => void calls.push(id));
    const result = await service.archiveNow({ dryRun: true });
    expect(result.candidates.map((decision) => decision.threadId)).toEqual(['done1']);
    expect(calls).toEqual([]);
    expect(readJournal(dataDir)).toEqual([]);
    expect(service.snapshot().archives).toEqual([]);
  });

  test('the settings file is read at each pass', async () => {
    const calls: string[] = [];
    const { service, dataDir } = await startWith(async (id) => void calls.push(id));
    writeSettings(dataDir, settings({ delayHours: 20 }));
    expect((await service.archiveNow()).candidates).toEqual([]);
    writeSettings(dataDir, settings({ delayHours: 5 }));
    expect((await service.archiveNow()).candidates.map((decision) => decision.threadId)).toEqual(['done1']);
  });

  test('a thread Boite refuses is journaled once and not retried', async () => {
    let attempts = 0;
    const { service, dataDir } = await startWith(async () => {
      attempts++;
      throw new Error('threads.archive is not open to plugins');
    });
    await service.archiveNow();
    await service.archiveNow();
    expect(attempts).toBe(1);
    expect(readJournal(dataDir).filter((line) => !line.ok)).toHaveLength(1);
    // The second pass skipped the thread Boite refused.
    expect(service.snapshot().archives).toEqual([]);
  });

  test('without an archiver (Boite closed to plugins) a real pass archives nothing', async () => {
    const { service, dataDir } = await startWith(undefined);
    const result = await service.archiveNow();
    expect(result).toMatchObject({ unavailable: true, archived: [] });
    expect(readJournal(dataDir)).toEqual([]);
  });

  test('the timer runs a pass by itself, unless auto is off', async () => {
    const calls: string[] = [];
    const { dataDir } = await startWith(async (id) => void calls.push(id), 40);
    writeSettings(dataDir, settings({ auto: false }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual([]);
    writeSettings(dataDir, settings({ auto: true, delayHours: 6 }));
    await waitFor(() => calls.includes('done1'), 'the automatic pass');
  });
});

describe('boite bureau-archive', () => {
  function setup() {
    const dataDir = tempDir();
    writeTeamRegistry(dataDir);
    const fake = fakeCore({ 'threads.list': () => liveRows, 'projects.list': () => [] });
    cores.push(fake);
    const env = { BOITE_PLUGIN_DATA: dataDir, BOITE_CORE_URL: fake.url, BOITE_TOKEN: TOKEN };
    const run = async (...argv: string[]) => {
      const out = capture();
      const code = await runCommand(['bureau-archive', ...argv], { env, io: out.io, cwd: dataDir, version: '0.0.0' });
      return { code, out: out.out, err: out.err };
    };
    return { dataDir, fake, run };
  }

  test('--dry-run lists what would be archived and archives nothing', async () => {
    const { dataDir, fake, run } = setup();
    const { code, out, err } = await run('--dry-run');
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toBe('Passage à blanc : 1 fil(s) seraient archivés.');
    expect(out.some((line) => line.startsWith('done1 | Agent fini | '))).toBe(true);
    expect(fake.calls.map((call) => call.method)).not.toContain('threads.archive');
    expect(readJournal(dataDir)).toEqual([]);
  });

  test('--dry-run --json gives the candidates and the kept reasons', async () => {
    const { run } = setup();
    const { code, out } = await run('--dry-run', '--json');
    expect(code).toBe(0);
    const data = JSON.parse(out.join('\n'));
    expect(data.dryRun).toBe(true);
    expect(data.candidates.map((entry: Decision) => entry.threadId)).toEqual(['done1']);
    expect(data.kept.map((entry: Decision) => entry.keep).sort()).toEqual(['en-cours', 'equipe-active']);
  });

  test('a real run says plainly that Boite offers no archiving to plugins, lists the threads, exits 1, archives nothing', async () => {
    const { dataDir, fake, run } = setup();
    const { code, out, err } = await run();
    expect(code).toBe(1);
    expect(out[0]).toBe('1 fil(s) à archiver.');
    expect(err.join('\n')).toContain('Boite n\'ouvre pas encore threads.archive aux plugins');
    expect(fake.calls.map((call) => call.method)).not.toContain('threads.archive');
    expect(readJournal(dataDir)).toEqual([]);
  });

  test('reglages shows the defaults, changes them, and refuses nonsense', async () => {
    const { dataDir, run } = setup();
    expect((await run('reglages')).out).toContain('Délai (équipes Bureau) : 6 h');
    const set = await run('reglages', '--delai', '2,5', '--etendu', 'oui', '--delai-etendu', '72', '--auto', 'non');
    expect(set.code).toBe(0);
    expect(readSettings(dataDir)).toEqual({ auto: false, delayHours: 2.5, extended: true, extendedDelayHours: 72 });
    expect((await run('reglages', '--delai', '0')).code).toBe(2);
    expect((await run('reglages', '--etendu', 'peut-etre')).code).toBe(2);
    expect(readSettings(dataDir).delayHours).toBe(2.5);
  });

  test('journal lists the archivings', async () => {
    const { dataDir, run } = setup();
    expect((await run('journal')).out).toEqual(['Journal vide : Bureau n\'a rien archivé.']);
    appendJournal(dataDir, { at: 0, threadId: 't1', title: 'Fil 1', reason: 'au repos depuis 7 h (délai 6 h)', rule: 'bureau', mode: 'manuel', ok: true });
    const { out } = await run('journal');
    expect(out).toEqual(['1970-01-01T00:00:00.000Z | archivé | t1 | Fil 1 | au repos depuis 7 h (délai 6 h) | manuel']);
  });

  test('an unknown option is a usage error', async () => {
    expect((await setup().run('--partout')).code).toBe(2);
  });
});
