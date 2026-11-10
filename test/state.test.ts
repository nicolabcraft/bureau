import { describe, expect, test } from 'bun:test';
import type { Mission } from '../src/model';
import { emptyRegistry } from '../src/registry';
import { buildState, agentState, hasReportedBack, REPORT_GRACE_MS } from '../src/state';
import { thread } from './helpers';

const NOW = 5_000_000;

function build(threads: ReturnType<typeof thread>[], registry = emptyRegistry(), projects: { id: string; name: string; path: string }[] = []) {
  return buildState({ threads, projects, registry, core: 'connected', now: NOW });
}

describe('guessed roles', () => {
  const tree = [
    thread('root', { createdAt: 1 }),
    thread('mgr', { parentThreadId: 'root', createdAt: 2 }),
    thread('leaf', { parentThreadId: 'root', createdAt: 3 }),
    thread('deep', { parentThreadId: 'mgr', createdAt: 4 }),
    thread('deeper', { parentThreadId: 'deep', createdAt: 5 }),
  ];

  test('root is chef, depth 1 with children is manager, without children is agent, deeper is agent', () => {
    const [team] = build(tree).teams;
    const roles = Object.fromEntries(team!.agents.map((agent) => [agent.id, agent.role]));
    expect(roles).toEqual({ root: 'chef', mgr: 'manager', leaf: 'agent', deep: 'agent', deeper: 'agent' });
    expect(team!.agents.every((agent) => agent.roleSource === 'guessed')).toBe(true);
  });

  test('agents come root first, then breadth-first, with their parent id', () => {
    const [team] = build(tree).teams;
    expect(team!.agents.map((agent) => agent.id)).toEqual(['root', 'mgr', 'leaf', 'deep', 'deeper']);
    expect(team!.agents.map((agent) => agent.parentId)).toEqual([null, 'root', 'root', 'mgr', 'deep']);
  });

  test('a declared role wins, and its service is passed down from a manager', () => {
    const registry = emptyRegistry();
    registry.roles.mgr = { role: 'manager', service: 'Développement', files: [], at: 1 };
    registry.roles.deep = { role: 'agent', service: null, files: ['src/a.ts', 'src/b.ts'], at: 1 };
    registry.roles.leaf = { role: 'manager', service: 'Qualité', files: [], at: 1 };
    const [team] = build(tree, registry).teams;
    const by = Object.fromEntries(team!.agents.map((agent) => [agent.id, agent]));
    expect(by.mgr).toMatchObject({ role: 'manager', roleSource: 'declared', service: 'Développement' });
    expect(by.leaf).toMatchObject({ role: 'manager', service: 'Qualité' });
    expect(by.deep).toMatchObject({ role: 'agent', roleSource: 'declared', service: 'Développement', files: ['src/a.ts', 'src/b.ts'] });
    expect(by.deeper!.service).toBeNull();
    expect(by.root!.service).toBeNull();
  });
});

const mission = (id: string, chefId: string, status: Mission['status'], createdAt = 1): Mission => ({
  id,
  chefId,
  title: id,
  summary: '',
  budget: { maxAgents: null, models: [] },
  lots: [],
  status,
  createdAt,
  validatedAt: null,
  validatedVia: null,
});

describe('managers attached with a chef link', () => {
  // `resp` was started with `boite thread new`: no parentThreadId. Its agents were spawned by it.
  const floors = [
    thread('chef', { createdAt: 1 }),
    thread('resp', { createdAt: 2 }),
    thread('ag1', { parentThreadId: 'resp', createdAt: 3 }),
    thread('ag2', { parentThreadId: 'resp', createdAt: 4 }),
    thread('lone', { createdAt: 5 }),
  ];
  const linked = () => {
    const registry = emptyRegistry();
    registry.roles.resp = { role: 'manager', service: 'Développement', files: [], at: 10, chefId: 'chef' };
    return registry;
  };
  const teamIds = (state: ReturnType<typeof build>) => state.teams.map((team) => team.id).sort();
  const respState = (registry: ReturnType<typeof linked>, threads = floors) =>
    build(threads, registry).teams.find((team) => team.id === 'chef')!.agents.find((agent) => agent.id === 'resp')!.state;

  test('without the link a responsable is a team of its own', () => {
    const state = build(floors);
    expect(teamIds(state)).toEqual(['chef', 'lone', 'resp']);
    expect(state.teams.find((team) => team.id === 'resp')!.agents.map((agent) => agent.id)).toEqual(['resp', 'ag1', 'ag2']);
  });

  test('with the link the responsable sits under the chef and its agents under it: three floors, one team', () => {
    const state = build(floors, linked());
    expect(teamIds(state)).toEqual(['chef', 'lone']);
    const team = state.teams.find((entry) => entry.id === 'chef')!;
    expect(team.agents.map((agent) => [agent.id, agent.parentId])).toEqual([
      ['chef', null],
      ['resp', 'chef'],
      ['ag1', 'resp'],
      ['ag2', 'resp'],
    ]);
  });

  test('roles: the attached thread is a manager, its agents are guessed agents with its service', () => {
    const team = build(floors, linked()).teams.find((entry) => entry.id === 'chef')!;
    const by = Object.fromEntries(team.agents.map((agent) => [agent.id, agent]));
    expect(by.chef).toMatchObject({ role: 'chef', roleSource: 'guessed' });
    expect(by.resp).toMatchObject({ role: 'manager', roleSource: 'declared', service: 'Développement' });
    expect(by.ag1).toMatchObject({ role: 'agent', roleSource: 'guessed', service: 'Développement' });
  });

  test('the link makes it a manager even next to a stale role', () => {
    const registry = linked();
    registry.roles.resp!.role = 'agent';
    const team = build(floors, registry).teams.find((entry) => entry.id === 'chef')!;
    expect(team.agents.find((agent) => agent.id === 'resp')!.role).toBe('manager');
  });

  test('the chef carries the mission of the whole tree', () => {
    const registry = linked();
    registry.missions.m1 = mission('m1', 'chef', 'validated');
    const state = build(floors, registry);
    expect(state.teams.find((team) => team.id === 'chef')!.mission!.id).toBe('m1');
    expect(state.teams.find((team) => team.id === 'lone')!.mission).toBeNull();
  });

  test('a link to a thread that is gone, archived or itself is ignored', () => {
    const gone = linked();
    gone.roles.resp!.chefId = 'ghost';
    expect(teamIds(build(floors, gone))).toEqual(['chef', 'lone', 'resp']);
    const archived = [thread('chef', { archived: true, createdAt: 1 }), ...floors.slice(1)];
    expect(teamIds(build(archived, linked()))).toEqual(['lone', 'resp']);
    const self = linked();
    self.roles.resp!.chefId = 'resp';
    expect(teamIds(build(floors, self))).toEqual(['chef', 'lone', 'resp']);
  });

  test('a link that would close a loop is dropped, the older one stays', () => {
    // resp is under chef (declared at 10). chef then declares itself under ag1, an agent of resp: dropped.
    const registry = linked();
    registry.roles.chef = { role: 'manager', service: null, files: [], at: 20, chefId: 'ag1' };
    const team = build(floors, registry).teams.find((entry) => entry.id === 'chef')!;
    expect(team.agents.map((agent) => agent.id)).toEqual(['chef', 'resp', 'ag1', 'ag2']);
    expect(team.agents.find((agent) => agent.id === 'chef')!.parentId).toBeNull();
    // Two managers pointing at each other: the first one declared wins, no thread is lost.
    const twins = emptyRegistry();
    twins.roles.chef = { role: 'manager', service: null, files: [], at: 1, chefId: 'resp' };
    twins.roles.resp = { role: 'manager', service: null, files: [], at: 2, chefId: 'chef' };
    const ids = build(floors, twins).teams.flatMap((entry) => entry.agents.map((agent) => agent.id)).sort();
    expect(ids).toEqual(['ag1', 'ag2', 'chef', 'lone', 'resp']);
  });

  test('at rest the attached manager is idle while its agents may report, done after its report or the mission', () => {
    expect(respState(linked())).toBe('idle');
    const reported = linked();
    reported.reports.resp = { text: 'Lot terminé.', at: 5 };
    expect(respState(reported)).toBe('done');
    const over = linked();
    over.missions.m1 = mission('m1', 'chef', 'done');
    expect(respState(over)).toBe('done');
    const open = linked();
    open.missions.m1 = mission('m1', 'chef', 'validated');
    expect(respState(open)).toBe('idle');
    const otherChef = linked();
    otherChef.missions.m1 = mission('m1', 'lone', 'done');
    expect(respState(otherChef)).toBe('idle');
  });

  test('a manager that reported and then worked again is idle, not done, until it reports anew', () => {
    const at = 100_000;
    const moved = (updatedAt: number) => floors.map((row) => (row.id === 'resp' ? { ...row, updatedAt } : row));
    const reported = linked();
    reported.reports.resp = { text: 'Lot terminé.', at };
    // Its turn ends a few seconds after the report: still done.
    expect(respState(reported, moved(at + 5_000))).toBe('done');
    expect(respState(reported, moved(at + REPORT_GRACE_MS))).toBe('done');
    // A later change means it worked again and rests without a new report.
    expect(respState(reported, moved(at + REPORT_GRACE_MS + 1))).toBe('idle');
    expect(respState(reported, moved(at + 3_600_000))).toBe('idle');
    // While it works it runs, whatever its report says.
    const busy = moved(at + 3_600_000).map((row) => (row.id === 'resp' ? { ...row, status: 'running' as const } : row));
    expect(respState(reported, busy)).toBe('running');
    // A new report after the rework brings it back to done.
    const again = linked();
    again.reports.resp = { text: 'Lot repris et terminé.', at: at + 3_600_000 };
    expect(respState(again, moved(at + 3_600_000 + 4_000))).toBe('done');
    // A report from a clock slightly ahead of the thread is still current.
    expect(respState(reported, moved(at - 1_000))).toBe('done');
  });

  test('hasReportedBack: no report falls back on the mission, a stale report does not', () => {
    const row = thread('resp', { updatedAt: 500_000 });
    expect(hasReportedBack(row, undefined, true)).toBe(true);
    expect(hasReportedBack(row, undefined, false)).toBe(false);
    expect(hasReportedBack(row, { text: 'x', at: 500_000 - 1_000 }, false)).toBe(true);
    expect(hasReportedBack(row, { text: 'x', at: 500_000 - REPORT_GRACE_MS - 1 }, true)).toBe(false);
  });

  test('a working manager stays running even after its report', () => {
    const registry = linked();
    registry.reports.resp = { text: 'Lot terminé.', at: 5 };
    const busy = floors.map((row) => (row.id === 'resp' ? { ...row, status: 'running' as const } : row));
    expect(respState(registry, busy)).toBe('running');
  });

  test('a thread without the link keeps the old rule: a root is idle', () => {
    const registry = emptyRegistry();
    registry.reports.resp = { text: 'Lot terminé.', at: 5 };
    expect(build(floors, registry).teams.find((team) => team.id === 'resp')!.agents[0]!.state).toBe('idle');
  });
});

describe('agent state', () => {
  test('running, queued and error map straight', () => {
    expect(agentState(thread('a', { status: 'running' }))).toEqual({ state: 'running', waitingFor: null });
    expect(agentState(thread('a', { status: 'queued' }))).toEqual({ state: 'queued', waitingFor: null });
    expect(agentState(thread('a', { status: 'error' }))).toEqual({ state: 'error', waitingFor: null });
  });

  test('a permission request is waiting for permission', () => {
    expect(agentState(thread('a', { status: 'waiting' }))).toEqual({ state: 'waiting', waitingFor: 'permission' });
  });

  test('open questions make it waiting, even while a turn runs', () => {
    expect(agentState(thread('a', { status: 'running', openQuestions: 2 }))).toEqual({ state: 'waiting', waitingFor: 'question' });
    expect(agentState(thread('a', { status: 'idle', openQuestions: 1 }))).toEqual({ state: 'waiting', waitingFor: 'question' });
    expect(agentState(thread('a', { status: 'running', openQuestions: 0 })).state).toBe('running');
  });

  test('idle is idle for a root and done for a delegated child', () => {
    expect(agentState(thread('a'))).toEqual({ state: 'idle', waitingFor: null });
    expect(agentState(thread('b', { parentThreadId: 'a' }))).toEqual({ state: 'done', waitingFor: null });
    expect(agentState(thread('b', { parentThreadId: null }))).toEqual({ state: 'idle', waitingFor: null });
  });

  test('an attached manager at rest is done only once it has reported back', () => {
    expect(agentState(thread('a'), false)).toEqual({ state: 'idle', waitingFor: null });
    expect(agentState(thread('a'), true)).toEqual({ state: 'done', waitingFor: null });
    expect(agentState(thread('a', { status: 'running' }), true).state).toBe('running');
  });

  test('since is requestSince, else runningSince, and null at rest', () => {
    const state = build([
      thread('r', { status: 'running', requestSince: 10, runningSince: 20 }),
      thread('s', { status: 'running', runningSince: 30 }),
      thread('t', { status: 'idle', requestSince: 40 }),
    ]);
    const since = Object.fromEntries(state.teams.flatMap((team) => team.agents).map((agent) => [agent.id, agent.since]));
    expect(since).toEqual({ r: 10, s: 30, t: null });
  });
});

describe('what is left out', () => {
  test('archived threads, team chats, council salons and incognito threads are ignored', () => {
    const state = build([
      thread('keep'),
      thread('old', { archived: true }),
      thread('chat', { teamId: 't1' }),
      thread('salon', { councilId: 'c1' }),
      thread('secret', { incognito: true }),
    ]);
    expect(state.teams.map((team) => team.id)).toEqual(['keep']);
  });

  test('a child of an archived parent starts a team of its own', () => {
    const state = build([thread('gone', { archived: true }), thread('orphan', { parentThreadId: 'gone' })]);
    expect(state.teams).toHaveLength(1);
    const [agent] = state.teams[0]!.agents;
    expect(agent).toMatchObject({ id: 'orphan', parentId: null, role: 'chef', state: 'done' });
  });

  test('a delegation cycle neither loops nor loses threads', () => {
    const state = build([thread('a', { parentThreadId: 'b', createdAt: 1 }), thread('b', { parentThreadId: 'a', createdAt: 2 })]);
    const ids = state.teams.flatMap((team) => team.agents.map((agent) => agent.id)).sort();
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('teams', () => {
  test('are sorted by the latest activity in the tree, newest first', () => {
    const state = build([
      thread('old', { updatedAt: 100 }),
      thread('mid', { updatedAt: 200 }),
      thread('quiet-root', { updatedAt: 50 }),
      thread('busy-child', { parentThreadId: 'quiet-root', updatedAt: 900 }),
    ]);
    expect(state.teams.map((team) => team.id)).toEqual(['quiet-root', 'mid', 'old']);
    expect(state.teams[0]!.lastActivity).toBe(900);
  });

  test('count waiting agents across teams and name the project', () => {
    const state = build(
      [
        thread('a', { projectId: 'p1', status: 'waiting' }),
        thread('b', { parentThreadId: 'a', openQuestions: 1 }),
        thread('c', { status: 'running' }),
      ],
      emptyRegistry(),
      [{ id: 'p1', name: 'Boutique', path: 'F:\\Dev\\Boutique' }]
    );
    expect(state.waitingCount).toBe(2);
    expect(state.teams.find((team) => team.id === 'a')!.projectName).toBe('Boutique');
    expect(state.teams.find((team) => team.id === 'c')!.projectName).toBeNull();
    expect(state).toMatchObject({ core: 'connected', generatedAt: NOW });
  });

  test('carry the root project id on each team, and every project without its path, in projects.list order', () => {
    const state = build(
      [
        thread('a', { projectId: 'p2', createdAt: 1 }),
        thread('kid', { projectId: 'other', parentThreadId: 'a', createdAt: 2 }),
        thread('b', { projectId: 'ghost', createdAt: 3 }),
        thread('c', { createdAt: 4 }),
      ],
      emptyRegistry(),
      [
        { id: 'p2', name: 'Atelier', path: 'F:\\Dev\\Atelier' },
        { id: 'p1', name: 'Boutique', path: 'F:\\Dev\\Boutique' },
      ]
    );
    const team = (id: string) => state.teams.find((entry) => entry.id === id)!;
    // The project of a team is the root thread's, whatever its children say.
    expect(team('a').projectId).toBe('p2');
    expect(team('b')).toMatchObject({ projectId: 'ghost', projectName: null });
    expect(team('c').projectId).toBeNull();
    expect(state.projects).toEqual([
      { id: 'p2', name: 'Atelier' },
      { id: 'p1', name: 'Boutique' },
    ]);
    expect(JSON.stringify(state)).not.toContain('path');
    expect(JSON.stringify(state)).not.toContain('Atelier\\');
  });

  test('carry the newest mission whose chef is in the tree, and each agent report', () => {
    const mission = (id: string, chefId: string, createdAt: number): Mission => ({
      id,
      chefId,
      title: id,
      summary: '',
      budget: { maxAgents: null, models: [] },
      lots: [],
      status: 'proposed',
      createdAt,
      validatedAt: null,
      validatedVia: null,
    });
    const registry = emptyRegistry();
    registry.missions.m1 = mission('m1', 'root', 10);
    registry.missions.m2 = mission('m2', 'root', 20);
    registry.missions.other = mission('other', 'elsewhere', 30);
    registry.reports.kid = { text: 'fini', at: 7 };
    const [team] = build([thread('root'), thread('kid', { parentThreadId: 'root' })], registry).teams;
    expect(team!.mission!.id).toBe('m2');
    expect(team!.agents.find((agent) => agent.id === 'kid')!.report).toEqual({ text: 'fini', at: 7 });
    expect(team!.agents.find((agent) => agent.id === 'root')!.report).toBeNull();
  });
});

describe('live teams', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const later = (threads: ReturnType<typeof thread>[], now: number) =>
    buildState({ threads, projects: [], registry: emptyRegistry(), core: 'connected', now, live: true });

  test('a quiet team older than a day leaves the office', () => {
    const state = later([thread('old', { updatedAt: 1_000 }), thread('fresh', { updatedAt: 2 * DAY })], 2 * DAY + 1_000);
    expect(state.teams.map((team) => team.id)).toEqual(['fresh']);
  });

  test('an old team with someone at work stays', () => {
    const state = later([thread('old', { updatedAt: 1_000 }), thread('kid', { updatedAt: 1_000, parentThreadId: 'old', status: 'running' })], 3 * DAY);
    expect(state.teams.map((team) => team.id)).toEqual(['old']);
  });

  test('the office holds 30 teams at most', () => {
    const many = Array.from({ length: 40 }, (_, i) => thread(`t${i}`, { updatedAt: 10_000 + i }));
    expect(later(many, 20_000).teams.length).toBe(30);
  });
});
