import { afterEach, describe, expect, test } from 'bun:test';
import { deriveEvents, EVENT_MAX, EVENT_WINDOW_MS, recentEvents } from '../src/events';
import type { AgentState, Lot, Mission, OfficeAgent, OfficeEvent, OfficeState, Team } from '../src/model';
import { startService } from '../src/service';
import { cleanTempDirs, fakeCore, tempDir, thread, TOKEN, waitFor } from './helpers';

afterEach(cleanTempDirs);

const T0 = 1_000_000;

function agent(id: string, extra: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Titre ${id}`,
    role: 'agent',
    roleSource: 'guessed',
    service: null,
    parentId: 'chef',
    model: 'claude-sonnet-5-5',
    provider: 'claude',
    state: 'running',
    waitingFor: null,
    since: null,
    updatedAt: T0,
    createdAt: T0,
    report: null,
    files: [],
    ...extra,
  };
}
const root = (extra: Partial<OfficeAgent> = {}) => agent('chef', { role: 'chef', parentId: null, ...extra });

function team(id: string, agents: OfficeAgent[], mission: Mission | null = null): Team {
  return { id, title: `Équipe ${id}`, projectId: null, projectName: null, agents, mission, lastActivity: T0 };
}
function state(teams: Team[], extra: Partial<OfficeState> = {}): OfficeState {
  return { teams, projects: [], waitingCount: 0, core: 'connected', generatedAt: T0, archives: [], events: [], ...extra };
}
function mission(extra: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    chefId: 'chef',
    title: 'Refonte',
    summary: '',
    budget: { maxAgents: null, models: [] },
    lots: [],
    status: 'proposed',
    createdAt: T0,
    validatedAt: null,
    validatedVia: null,
    ...extra,
  };
}
const lot = (extra: Partial<Lot> = {}): Lot => ({ id: 'L1', title: 'Comptes', service: 'Développement', model: 'claude/claude-sonnet-5-5', agentId: null, state: 'todo', ...extra });
/** One team "t" whose members are `chef` and the given agents. */
const office = (agents: OfficeAgent[], extra: Partial<OfficeState> = {}, m: Mission | null = null) => state([team('t', [root(), ...agents], m)], extra);
const kinds = (events: OfficeEvent[]) => events.map((event) => event.kind);
const step = (prev: OfficeState | null, next: OfficeState, log: OfficeEvent[] = [], now = T0 + 1_000) => deriveEvents(prev, next, log, now);

describe('deriveEvents: one case per kind', () => {
  test('arrive', () => {
    const events = step(office([]), office([agent('a1', { parentId: null })]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'arrive', agentId: 'a1', teamId: 't', title: 'Titre a1', parentId: null, at: T0 + 1_000 });
  });

  test('depart: gone, then archived when the journal names it', () => {
    const gone = step(office([agent('a1')]), office([]));
    expect(gone).toMatchObject([{ kind: 'depart', agentId: 'a1', reason: 'gone', title: 'Titre a1', teamId: 't' }]);
    const archives = [{ threadId: 'a1', title: 'x', reason: 'repos', at: T0 }];
    const archived = step(office([agent('a1')]), office([], { archives }));
    expect(archived).toMatchObject([{ kind: 'depart', reason: 'archived' }]);
  });

  test('delegate on arrival with a parent, with its lot', () => {
    const m = mission({ status: 'validated', lots: [lot({ agentId: 'a1', state: 'running' })] });
    const events = step(office([], {}, mission({ status: 'validated' })), office([agent('a1')], {}, m));
    expect(kinds(events)).toEqual(['arrive', 'delegate']);
    expect(events[1]).toMatchObject({ kind: 'delegate', agentId: 'a1', fromId: 'chef', lotId: 'L1' });
  });

  test('report: filed, with its lot', () => {
    const m = mission({ lots: [lot({ agentId: 'a1', state: 'running' })] });
    const prev = office([agent('a1')], {}, m);
    const next = office([agent('a1', { report: { text: 'ok', at: T0 + 500 } })], {}, m);
    expect(step(prev, next)).toMatchObject([{ kind: 'report', agentId: 'a1', toId: 'chef', lotId: 'L1', hasReport: true }]);
  });

  test('a root produces report, waiting and blocked with no receiver', () => {
    const prev = state([team('t', [root()])]);
    expect(step(prev, state([team('t', [root({ report: { text: 'x', at: T0 } })])]))).toMatchObject([{ kind: 'report', toId: null }]);
    expect(step(prev, state([team('t', [root({ state: 'waiting', waitingFor: 'question' })])]))).toMatchObject([{ kind: 'waiting', waitingFor: 'question' }]);
    expect(step(prev, state([team('t', [root({ state: 'error' })])]))).toMatchObject([{ kind: 'blocked', toId: null }]);
  });

  test('blocked', () => {
    const events = step(office([agent('a1')]), office([agent('a1', { state: 'error' })]));
    expect(events).toMatchObject([{ kind: 'blocked', agentId: 'a1', toId: 'chef' }]);
  });

  test('waiting carries the reason', () => {
    const events = step(office([agent('a1')]), office([agent('a1', { state: 'waiting', waitingFor: 'permission' })]));
    expect(events).toMatchObject([{ kind: 'waiting', agentId: 'a1', waitingFor: 'permission' }]);
  });

  test('answered when waiting ends, not when it ends in error', () => {
    const waiting = office([agent('a1', { state: 'waiting', waitingFor: 'question' })]);
    expect(step(waiting, office([agent('a1')]))).toMatchObject([{ kind: 'answered', agentId: 'a1' }]);
    expect(kinds(step(waiting, office([agent('a1', { state: 'error' })])))).toEqual(['blocked']);
  });

  test('plan: the chef is the agent', () => {
    const events = step(office([]), office([], {}, mission()));
    expect(events).toMatchObject([{ kind: 'plan', phase: 'proposed', missionId: 'm1', agentId: 'chef', teamId: 't', title: 'Titre chef' }]);
  });
});

describe('deriveEvents: baseline and noise', () => {
  test('a null prev produces nothing and keeps the pruned log', () => {
    const old: OfficeEvent = { id: 'o-0', at: T0 - EVENT_WINDOW_MS - 1, kind: 'answered', teamId: 't', agentId: 'a', title: 'a' };
    const recent: OfficeEvent = { ...old, id: 'o-1', at: T0 };
    expect(step(null, office([agent('a1')]), [old, recent])).toEqual([recent]);
  });

  test('reconnection: the first state after a reload is the reference, then no storm', () => {
    // The service sets baseline = null after a reload, so `prev` is null for the first state.
    const world = office([agent('a1'), agent('a2')]);
    const first = step(null, world);
    expect(first).toEqual([]);
    expect(step(world, world, first)).toEqual([]);
  });

  test('identical states produce nothing', () => {
    const s = office([agent('a1', { state: 'waiting', waitingFor: 'question' })], {}, mission());
    expect(step(s, s)).toEqual([]);
  });

  test('delegate: arrival then lot gives one event', () => {
    const arrived = step(office([]), office([agent('a1')]));
    expect(kinds(arrived)).toEqual(['arrive', 'delegate']);
    const m = mission({ status: 'validated', lots: [lot({ agentId: 'a1', state: 'running' })] });
    const bare = office([agent('a1')], {}, mission({ status: 'validated' }));
    const again = step(bare, office([agent('a1')], {}, m), arrived, T0 + 5_000);
    expect(kinds(again).filter((k) => k === 'delegate')).toHaveLength(1);
    // Without the earlier arrival in the log, the lot alone delegates.
    expect(kinds(step(bare, office([agent('a1')], {}, m)))).toEqual(['delegate']);
    // Once the window passed, a new lot delegates again.
    const late = step(bare, office([agent('a1')], {}, m), arrived, T0 + 1_000 + EVENT_WINDOW_MS + 1);
    expect(kinds(late)).toEqual(['delegate']);
  });

  test('delegate: a lot going to running for an agent already there, then nothing more', () => {
    const idle = mission({ lots: [lot({ agentId: 'a1', state: 'todo' })] });
    const run = mission({ lots: [lot({ agentId: 'a1', state: 'running' })] });
    const a = office([agent('a1')], {}, idle);
    const b = office([agent('a1')], {}, run);
    expect(kinds(step(a, b))).toEqual(['delegate']);
    expect(step(b, b)).toEqual([]);
  });

  test('report: filed then done gives one; done alone gives one without a report', () => {
    const a = office([agent('a1')]);
    const filed = office([agent('a1', { report: { text: 'ok', at: T0 + 100 } })]);
    const done = office([agent('a1', { state: 'done', report: { text: 'ok', at: T0 + 100 } })]);
    const first = step(a, filed);
    const second = step(filed, done, first, T0 + 5_000);
    expect(kinds(second)).toEqual(['report']);
    const alone = step(a, office([agent('a1', { state: 'done' })]));
    expect(alone).toMatchObject([{ kind: 'report', hasReport: false }]);
    // Done first, report later: still one report in the window.
    const late = step(office([agent('a1', { state: 'done' })]), done, alone, T0 + 5_000);
    expect(kinds(late)).toEqual(['report']);
  });

  test('waiting and blocked are debounced for 30 s per agent', () => {
    const run = office([agent('a1')]);
    const wait = office([agent('a1', { state: 'waiting', waitingFor: 'permission' })]);
    const w1 = step(run, wait, [], T0);
    expect(kinds(w1)).toEqual(['waiting']);
    expect(kinds(step(run, wait, w1, T0 + 29_000))).toEqual(['waiting']);
    expect(kinds(step(run, wait, w1, T0 + 31_000))).toEqual(['waiting', 'waiting']);
    const err = office([agent('a1', { state: 'error' })]);
    const b1 = step(run, err, [], T0);
    expect(kinds(step(run, err, b1, T0 + 20_000))).toEqual(['blocked']);
    expect(kinds(step(run, err, b1, T0 + 31_000))).toEqual(['blocked', 'blocked']);
  });

  test('an agent that changes team neither arrives nor departs', () => {
    const prev = state([team('t1', [root(), agent('a1')]), team('t2', [agent('chef2', { parentId: null })])]);
    const next = state([team('t1', [root()]), team('t2', [agent('chef2', { parentId: null }), agent('a1', { parentId: 'chef2' })])]);
    expect(step(prev, next)).toEqual([]);
  });

  test('a mission goes proposed, validated, done: once per phase', () => {
    const p = office([], {}, mission());
    const v = office([], {}, mission({ status: 'validated', validatedAt: T0, validatedVia: 'bureau' }));
    const d = office([], {}, mission({ status: 'done' }));
    let log: OfficeEvent[] = [];
    log = step(office([]), p, log, T0);
    log = step(p, v, log, T0 + 1_000);
    log = step(v, d, log, T0 + 2_000);
    expect(log.map((e) => (e.kind === 'plan' ? e.phase : e.kind))).toEqual(['proposed', 'validated', 'done']);
    // The same transition seen again is not played twice.
    expect(step(p, v, log, T0 + 3_000)).toHaveLength(3);
  });

  test('a mission that appears already validated gives validated', () => {
    const v = office([], {}, mission({ status: 'validated' }));
    expect(step(office([]), v)).toMatchObject([{ kind: 'plan', phase: 'validated' }]);
  });

  test('events of one pass follow the kind order', () => {
    const prev = office([agent('a1'), agent('a2', { state: 'waiting', waitingFor: 'question' }), agent('a3')]);
    const next = office([agent('a1', { state: 'done' }), agent('a2'), agent('a4')], {}, mission());
    expect(kinds(step(prev, next))).toEqual(['arrive', 'delegate', 'plan', 'report', 'answered', 'depart']);
  });
});

describe('the log', () => {
  const event = (n: number, at: number): OfficeEvent => ({ id: `e-${n}`, at, kind: 'answered', teamId: 't', agentId: 'a', title: 'a' });

  test('prunes by age and keeps the most recent EVENT_MAX', () => {
    const now = T0 + EVENT_WINDOW_MS * 2;
    const log = [event(0, T0), event(1, now - EVENT_WINDOW_MS - 1), event(2, now - EVENT_WINDOW_MS), event(3, now)];
    expect(recentEvents(log, now).map((e) => e.id)).toEqual(['e-2', 'e-3']);
    const many = Array.from({ length: EVENT_MAX + 15 }, (_, n) => event(n, now));
    const kept = recentEvents(many, now);
    expect(kept).toHaveLength(EVENT_MAX);
    expect(kept[0]!.id).toBe('e-15');
    expect(deriveEvents(office([]), office([agent('x')]), many, now)).toHaveLength(EVENT_MAX);
  });

  test('ids are unique, even in one millisecond and against the log', () => {
    const prev = office([]);
    const next = office([agent('a1'), agent('a2'), agent('a3')]);
    const first = deriveEvents(prev, next, [], T0);
    const clash: OfficeEvent[] = [{ ...event(0, T0), id: `${T0}-1` }];
    const second = deriveEvents(prev, next, clash, T0);
    for (const log of [first, second]) expect(new Set(log.map((e) => e.id)).size).toBe(log.length);
    expect(second.filter((e) => e.id === `${T0}-1`)).toHaveLength(1);
    const third = deriveEvents(office([]), office([agent('b1')]), first, T0);
    expect(new Set(third.map((e) => e.id)).size).toBe(third.length);
  });

  test('40 events weigh under 15 KB', () => {
    const states: AgentState[] = ['waiting', 'error', 'done'];
    let log: OfficeEvent[] = [];
    for (let i = 0; log.length < EVENT_MAX; i++) {
      const id = `agent-${i}-with-a-long-thread-title`;
      const next = office([agent(id, { title: 'Un titre de fil assez long pour la mesure', state: states[i % 3]! })], {}, mission());
      log = deriveEvents(office([]), next, log, T0 + i);
    }
    expect(log).toHaveLength(EVENT_MAX);
    expect(JSON.stringify(log).length).toBeLessThan(15 * 1024);
  });
});

describe('service', () => {
  test('events reach the state, none right after connecting', async () => {
    const rows = [thread('chef', { status: 'running' }), thread('w1', { parentThreadId: 'chef', status: 'running' })];
    const core = fakeCore({ 'threads.list': () => rows, 'projects.list': () => [] });
    const service = await startService({ dataDir: tempDir(), page: '', version: 't', coreUrl: core.url, token: TOKEN, port: 0, debounceMs: 5, pollMs: 60_000, archiveEveryMs: 0 });
    try {
      await waitFor(() => service.snapshot().core === 'connected' && service.snapshot().teams.length === 1, 'connection');
      // Let the reference state be taken.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(service.snapshot().events).toEqual([]);
      core.emit('thread.created', thread('w2', { parentThreadId: 'chef', status: 'queued' }));
      core.emit('thread.updated', thread('w1', { parentThreadId: 'chef', status: 'error' }));
      const events = await waitFor(() => (service.snapshot().events.length >= 3 ? service.snapshot().events : null), 'events');
      expect(kinds(events)).toEqual(['arrive', 'delegate', 'blocked']);
      expect(new Set(events.map((e) => e.id)).size).toBe(3);
      const served = (await (await fetch(`${service.url}api/state`)).json()) as OfficeState;
      expect(served.events).toHaveLength(3);
    } finally {
      await service.stop();
      core.stop();
    }
  });
});
