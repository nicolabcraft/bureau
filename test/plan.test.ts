import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* plan.js is plain script text shared with the page: load it on its own, as the page would, with nothing around it. */
type Agent = { id: string; title: string; role: string; service: string | null; parentId: string | null; state: string; createdAt: number };
type Team = { id: string; title: string; projectId: string | null; projectName: string | null; agents: Agent[]; mission: { id: string; status: string; title: string } | null; lastActivity: number };
type Zone = { key: string; label: string; service: string | null; leadId: string; memberIds: string[]; colorKey: string };
type Floor = { id: string; name: string; zones: Zone[]; chefId: string | null; stats: Record<string, number>; missions: { id: string; status: string; title: string }[] };
type Plan = { floors: Floor[]; order: string[] };
type Office = { teams: Team[]; projects: { id: string; name: string }[] };
type Cap = { zones(floorIndex: number): number; seats: number };

const source = readFileSync(join(import.meta.dir, '..', 'web', 'immeuble', 'plan.js'), 'utf8');
const planImmeuble = new Function(`${source}\nreturn planImmeuble;`)() as (office: Office, memo: string[] | null, cap: Cap) => Plan;

const CAP: Cap = { zones: () => 3, seats: 5 };
let clock = 0;
const agent = (id: string, role: string, parentId: string | null, extra: Partial<Agent> = {}): Agent => ({
  id, title: `Fil ${id}`, role, service: null, parentId, state: 'idle', createdAt: ++clock, ...extra,
});
const team = (agents: Agent[], extra: Partial<Team> = {}): Team => ({
  id: agents[0]!.id, title: agents[0]!.title, projectId: null, projectName: null, agents, mission: null, lastActivity: 1, ...extra,
});
const office = (teams: Team[], projects: { id: string; name: string }[] = []): Office => ({ teams, projects });
const PROJECTS = [
  { id: 'p1', name: 'Boutique' },
  { id: 'p2', name: 'Atelier' },
  { id: 'p3', name: 'Site' },
];
const ids = (plan: Plan) => plan.floors.map((floor) => floor.id);

/** A chef with `services` managers, each with `perService` agents. */
function crew(root: string, projectId: string | null, services: string[], perService = 2, extra: Partial<Team> = {}): Team {
  const chef = agent(root, 'chef', null);
  const agents = [chef];
  for (const service of services) {
    const mgr = agent(`${root}-m-${service}`, 'manager', root, { service });
    agents.push(mgr);
    for (let i = 0; i < perService; i++) agents.push(agent(`${root}-${service}-${i}`, 'agent', mgr.id, { service }));
  }
  return team(agents, { projectId, ...extra });
}

describe('floor order', () => {
  const teams = () => [crew('c1', 'p1', ['Dev']), crew('c2', 'p2', ['Dev']), crew('c3', 'p3', ['Dev'])];

  test('first load: projects.list order, one floor per project that has a team', () => {
    const plan = planImmeuble(office([crew('c3', 'p3', ['Dev']), crew('c1', 'p1', ['Dev'])], PROJECTS), null, CAP);
    expect(ids(plan)).toEqual(['p1', 'p3']);
    expect(plan.floors.map((floor) => floor.name)).toEqual(['Boutique', 'Site']);
    expect(plan.order).toEqual(['p1', 'p3']);
  });

  test('the remembered order wins, even over projects.list', () => {
    const plan = planImmeuble(office(teams(), PROJECTS), ['p3', 'p1', 'p2'], CAP);
    expect(ids(plan)).toEqual(['p3', 'p1', 'p2']);
    expect(plan.order).toEqual(['p3', 'p1', 'p2']);
  });

  test('a new project goes on top and is added to the order to remember', () => {
    const plan = planImmeuble(office(teams(), PROJECTS), ['p2', 'p1'], CAP);
    expect(ids(plan)).toEqual(['p2', 'p1', 'p3']);
    expect(plan.order).toEqual(['p2', 'p1', 'p3']);
  });

  test('two new projects at once come in projects.list order, whatever the activity', () => {
    const plan = planImmeuble(office([crew('c3', 'p3', ['Dev'], 2, { lastActivity: 99 }), crew('c2', 'p2', ['Dev'])], PROJECTS), ['p1'], CAP);
    expect(ids(plan)).toEqual(['p2', 'p3']);
    expect(plan.order).toEqual(['p2', 'p3']);
  });

  test('a project with no team any more has no floor and leaves the order to remember', () => {
    const plan = planImmeuble(office([crew('c1', 'p1', ['Dev']), crew('c3', 'p3', ['Dev'])], PROJECTS), ['p1', 'p2', 'p3'], CAP);
    expect(ids(plan)).toEqual(['p1', 'p3']);
    expect(plan.order).toEqual(['p1', 'p3']);
    // Its floor is gone: if the project comes back it is a new project, so it lands on top.
    expect(ids(planImmeuble(office(teams(), PROJECTS), plan.order, CAP))).toEqual(['p1', 'p3', 'p2']);
  });

  test('a project Boite no longer lists still gets a floor, named after its team, after the known ones', () => {
    const lost = crew('c9', 'gone', ['Dev'], 1, { projectName: 'Ancien' });
    const plan = planImmeuble(office([lost, crew('c1', 'p1', ['Dev'])], PROJECTS), null, CAP);
    expect(ids(plan)).toEqual(['p1', 'gone']);
    expect(plan.floors[1]!.name).toBe('Ancien');
    expect(planImmeuble(office([crew('c9', 'gone', ['Dev'])], PROJECTS), null, CAP).floors[0]!.name).toBe('Projet sans nom');
  });

  test('a bad memory (null, duplicates, junk) is repaired, and a long one of old projects is forgotten at once', () => {
    expect(ids(planImmeuble(office(teams(), PROJECTS), ['p2', 'p2', 7 as unknown as string, 'p1'], CAP))).toEqual(['p2', 'p1', 'p3']);
    const memo = Array.from({ length: 80 }, (_, i) => `old${i}`).concat(['p1']);
    const plan = planImmeuble(office([crew('c1', 'p1', ['Dev'])], PROJECTS), memo, CAP);
    expect(plan.order).toEqual(['p1']);
  });

  test('nothing to show: no floor', () => {
    expect(planImmeuble(office([], PROJECTS), null, CAP)).toEqual({ floors: [], order: [] });
    expect(planImmeuble(office([], PROJECTS), ['p1'], CAP)).toEqual({ floors: [], order: [] });
  });
});

describe('conversations without a project', () => {
  test('go to a « Sans projet » floor, in a « Conversations » zone, with no chef', () => {
    const plan = planImmeuble(office([team([agent('a', 'chef', null)]), team([agent('b', 'chef', null)])], PROJECTS), null, CAP);
    expect(plan.floors).toHaveLength(1);
    const [floor] = plan.floors;
    expect(floor).toMatchObject({ id: '', name: 'Sans projet', chefId: null });
    expect(floor!.zones).toEqual([{ key: '#conversations', label: 'Conversations', service: null, leadId: 'a', memberIds: ['b'], colorKey: '#conversations' }]);
  });

  test('on a first load the « Sans projet » floor is the lowest', () => {
    const plan = planImmeuble(office([crew('c1', 'p1', ['Dev']), team([agent('a', 'chef', null)])], PROJECTS), null, CAP);
    expect(ids(plan)).toEqual(['', 'p1']);
  });

  test('a lone conversation of a project sits in that floor next to its team', () => {
    const plan = planImmeuble(office([crew('c1', 'p1', ['Dev']), team([agent('solo', 'chef', null)], { projectId: 'p1' })], PROJECTS), null, CAP);
    const floor = plan.floors[0]!;
    expect(floor.chefId).toBe('c1');
    expect(floor.zones.map((zone) => zone.key)).toEqual(['Dev', '#conversations']);
    expect(floor.zones[1]).toMatchObject({ leadId: 'solo', memberIds: [] });
  });
});

describe('zones of a floor', () => {
  test('a service is a zone: its manager leads (seat 0), its agents follow, oldest first', () => {
    const plan = planImmeuble(office([crew('c1', 'p1', ['Dev', 'QA'], 3)], PROJECTS), null, CAP);
    const floor = plan.floors[0]!;
    expect(floor.chefId).toBe('c1');
    expect(floor.zones.map((zone) => [zone.key, zone.label, zone.service, zone.leadId, zone.memberIds])).toEqual([
      ['Dev', 'Dev', 'Dev', 'c1-m-Dev', ['c1-Dev-0', 'c1-Dev-1', 'c1-Dev-2']],
      ['QA', 'QA', 'QA', 'c1-m-QA', ['c1-QA-0', 'c1-QA-1', 'c1-QA-2']],
    ]);
    expect(floor.zones[0]!.colorKey).toBe('Dev');
  });

  test('two managers of one service share a zone led by the older manager', () => {
    const chef = agent('c', 'chef', null);
    const m1 = agent('m1', 'manager', 'c', { service: 'Dev' });
    const m2 = agent('m2', 'manager', 'c', { service: 'Dev' });
    const a = agent('a', 'agent', 'm2', { service: 'Dev' });
    const [zone] = planImmeuble(office([team([chef, m2, m1, a], { projectId: 'p1' })], PROJECTS), null, CAP).floors[0]!.zones;
    expect(zone).toMatchObject({ key: 'Dev', leadId: 'm1' });
    expect(zone!.memberIds).toEqual(['m2', 'a']);
  });

  test('a manager without a service is a zone of its own, keyed by its id', () => {
    const chef = agent('c', 'chef', null);
    const m = agent('m', 'manager', 'c');
    const a = agent('a', 'agent', 'm');
    const [zone] = planImmeuble(office([team([chef, m, a], { projectId: 'p1' })], PROJECTS), null, CAP).floors[0]!.zones;
    expect(zone).toMatchObject({ key: 'm', label: 'Fil m', service: null, leadId: 'm', memberIds: ['a'], colorKey: 'm' });
  });

  test('a manager that is not the oldest of its zone still leads it', () => {
    const chef = agent('c', 'chef', null);
    const a = agent('a', 'agent', 'm', { service: 'Dev' });
    const m = agent('m', 'manager', 'c', { service: 'Dev' });
    const [zone] = planImmeuble(office([team([chef, m, a], { projectId: 'p1' })], PROJECTS), null, CAP).floors[0]!.zones;
    expect(zone).toMatchObject({ leadId: 'm', memberIds: ['a'] });
  });

  test('agents handed straight to the chef: by their service when they have one, else one loose zone', () => {
    const chef = agent('c', 'chef', null);
    const a = agent('a', 'agent', 'c');
    const b = agent('b', 'agent', 'c');
    const d = agent('d', 'agent', 'c', { service: 'Design' });
    const zones = planImmeuble(office([team([chef, a, b, d], { projectId: 'p1' })], PROJECTS), null, CAP).floors[0]!.zones;
    expect(zones.map((zone) => [zone.key, zone.label, zone.leadId, zone.memberIds])).toEqual([
      ['#direct', 'Équipe', 'a', ['b']],
      ['Design', 'Design', 'd', []],
    ]);
  });

  test('a grandchild joins the zone of the manager above it', () => {
    const chef = agent('c', 'chef', null);
    const m = agent('m', 'manager', 'c', { service: 'Dev' });
    const a = agent('a', 'agent', 'm', { service: 'Dev' });
    const deep = agent('deep', 'agent', 'a', { service: 'Dev' });
    const [zone] = planImmeuble(office([team([chef, m, a, deep], { projectId: 'p1' })], PROJECTS), null, CAP).floors[0]!.zones;
    expect(zone).toMatchObject({ leadId: 'm', memberIds: ['a', 'deep'] });
  });

  test('every agent of the floor is placed exactly once, the chef only as chefId', () => {
    const t = crew('c1', 'p1', ['Dev', 'QA', 'Design', 'Data'], 2);
    const other = crew('c2', 'p1', ['Ops'], 1);
    const solo = team([agent('solo', 'chef', null)], { projectId: 'p1' });
    const floor = planImmeuble(office([t, other, solo], PROJECTS), null, { zones: () => 3, seats: 4 }).floors[0]!;
    const placed = floor.zones.flatMap((zone) => [zone.leadId, ...zone.memberIds]);
    const expected = [...t.agents, ...other.agents, ...solo.agents].map((entry) => entry.id).filter((id) => id !== floor.chefId);
    expect(placed.slice().sort()).toEqual(expected.slice().sort());
    expect(new Set(placed).size).toBe(placed.length);
  });
});

describe('several teams in one project', () => {
  test('the chef is the root of the most recent team with agents under it; the other team is a zone led by its root', () => {
    const old = crew('old', 'p1', ['Dev'], 1, { lastActivity: 10 });
    const recent = crew('recent', 'p1', ['QA'], 2, { lastActivity: 50 });
    const floor = planImmeuble(office([old, recent], PROJECTS), null, CAP).floors[0]!;
    expect(floor.chefId).toBe('recent');
    expect(floor.zones.map((zone) => [zone.key, zone.leadId])).toEqual([
      ['old', 'old'],
      ['QA', 'recent-m-QA'],
    ]);
    // Everyone of the other team, its managers too, is in its zone.
    expect(floor.zones[0]!.memberIds).toEqual(['old-m-Dev', 'old-Dev-0']);
    expect(floor.zones[0]!.label).toBe('Fil old');
  });

  test('a lone conversation never takes the glass office, even when it is the most recent', () => {
    const t = crew('c1', 'p1', ['Dev'], 1, { lastActivity: 5 });
    const solo = team([agent('solo', 'chef', null)], { projectId: 'p1', lastActivity: 500 });
    expect(planImmeuble(office([solo, t], PROJECTS), null, CAP).floors[0]!.chefId).toBe('c1');
  });

  test('missions of the floor and counts by state', () => {
    const a = crew('c1', 'p1', ['Dev'], 3, { mission: { id: 'mi-1', status: 'proposed', title: 'Refonte' } });
    a.agents[2]!.state = 'running';
    a.agents[3]!.state = 'waiting';
    a.agents[4]!.state = 'queued';
    a.agents[0]!.state = 'error';
    a.agents[1]!.state = 'done';
    const b = crew('c2', 'p1', ['QA'], 1, { mission: { id: 'mi-2', status: 'done', title: 'Recette' } });
    const floor = planImmeuble(office([a, b], PROJECTS), null, CAP).floors[0]!;
    expect(floor.missions).toEqual([
      { id: 'mi-1', status: 'proposed', title: 'Refonte' },
      { id: 'mi-2', status: 'done', title: 'Recette' },
    ]);
    expect(floor.stats).toEqual({ total: 8, running: 1, waiting: 1, queued: 1, done: 1, error: 1 });
  });
});

describe('overflow', () => {
  test('more zones than the floor holds: the smallest merge into « Autres », the others keep their order', () => {
    const chef = agent('c', 'chef', null);
    const agents = [chef];
    const sizes: [string, number][] = [['A', 1], ['B', 4], ['C', 0], ['D', 3], ['E', 0]];
    for (const [service, n] of sizes) {
      const m = agent(`m${service}`, 'manager', 'c', { service });
      agents.push(m);
      for (let i = 0; i < n; i++) agents.push(agent(`${service}${i}`, 'agent', m.id, { service }));
    }
    const floor = planImmeuble(office([team(agents, { projectId: 'p1' })], PROJECTS), null, { zones: () => 3, seats: 5 }).floors[0]!;
    expect(floor.zones.map((zone) => zone.key)).toEqual(['B', 'D', '#autres']);
    const others = floor.zones[2]!;
    expect(others).toMatchObject({ label: 'Autres', service: null });
    expect([others.leadId, ...others.memberIds].sort()).toEqual(['A0', 'mA', 'mC', 'mE']);
  });

  test('the zone limit follows the floor index', () => {
    const teams = [crew('c1', 'p1', ['A', 'B', 'C']), crew('c2', 'p2', ['A', 'B', 'C'])];
    const plan = planImmeuble(office(teams, PROJECTS), null, { zones: (i) => (i === 0 ? 2 : 3), seats: 5 });
    expect(plan.floors.map((floor) => floor.zones.length)).toEqual([2, 3]);
  });

  test('more members than seats: they all stay in the zone, oldest first, for the view to stand them up', () => {
    const t = crew('c1', 'p1', ['Dev'], 9);
    const [zone] = planImmeuble(office([t], PROJECTS), null, { zones: () => 3, seats: 4 }).floors[0]!.zones;
    expect(zone!.memberIds).toHaveLength(9);
    expect(zone!.memberIds.slice(0, 3)).toEqual(['c1-Dev-0', 'c1-Dev-1', 'c1-Dev-2']);
  });
});

describe('stable places', () => {
  const base = () => [crew('c1', 'p1', ['Dev', 'QA'], 3), crew('c2', 'p2', ['Dev'], 2)];

  test('the plan does not depend on the order of the input', () => {
    const forward = planImmeuble(office(base(), PROJECTS), null, CAP);
    const reversed = base().reverse();
    for (const t of reversed) t.agents.reverse();
    // The root stays first (the service guarantees it); the others come in any order.
    for (const t of reversed) t.agents.unshift(t.agents.pop()!);
    expect(planImmeuble(office(reversed, PROJECTS.slice().reverse()), forward.order, CAP)).toEqual(forward);
  });

  test('an agent that changes state, or a team that becomes the busiest, moves nobody on the floor', () => {
    const teams = base();
    const before = planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones;
    teams[0]!.agents[3]!.state = 'running';
    teams[0]!.lastActivity = 999;
    expect(planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones).toEqual(before);
  });

  test('a newcomer takes the next seat of its zone and moves nobody', () => {
    const teams = base();
    const before = planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones;
    teams[0]!.agents.push(agent('late', 'agent', 'c1-m-Dev', { service: 'Dev' }));
    const after = planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones;
    expect(after[0]!.memberIds).toEqual([...before[0]!.memberIds, 'late']);
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  test('a newcomer who is older than the rest (smaller createdAt) is the only one who would take an earlier seat', () => {
    const teams = base();
    const late = agent('later', 'agent', 'c1-m-QA', { service: 'QA', createdAt: 1e9 });
    teams[0]!.agents.push(late);
    const zones = planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones;
    expect(zones[1]!.memberIds.at(-1)).toBe('later');
  });

  test('a new service becomes the last zone, after the existing ones', () => {
    const teams = base();
    const before = planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones;
    const m = agent('m-new', 'manager', 'c1', { service: 'Design' });
    teams[0]!.agents.push(m, agent('x', 'agent', 'm-new', { service: 'Design' }));
    const after = planImmeuble(office(teams, PROJECTS), null, CAP).floors[0]!.zones;
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toMatchObject({ key: 'Design', leadId: 'm-new' });
  });
});

describe('purity', () => {
  test('does not touch its input', () => {
    const input = office([crew('c1', 'p1', ['Dev', 'QA']), team([agent('s', 'chef', null)])], PROJECTS);
    const memo = ['p1'];
    const copy = JSON.stringify([input, memo]);
    planImmeuble(input, memo, CAP);
    expect(JSON.stringify([input, memo])).toBe(copy);
  });

  test('an office with no projects list, or no teams field, does not throw', () => {
    expect(() => planImmeuble({ teams: [crew('c1', 'p1', ['Dev'])] } as unknown as Office, null, CAP)).not.toThrow();
    expect(planImmeuble({} as unknown as Office, null, CAP)).toEqual({ floors: [], order: [] });
  });
});

/* ---- donnees.js: an OfficeState applied to a stubbed scene (the real scene needs a canvas) ---- */
type Call = string;
function scene(options: { stored?: string[]; reduced?: boolean } = {}) {
  const calls: Call[] = [];
  const storage = new Map<string, string>();
  if (options.stored) storage.set('bureau.immeuble.etages', JSON.stringify(options.stored));
  let clock = 1_000;
  const timers: (() => void)[] = [];
  const floors: any[] = [];
  const agents = new Map<string, any>();
  const globals = {
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
    performance: { now: () => clock },
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => timers.splice(0),
    reduced: options.reduced === true,
    focus: -1,
    autoFit: true,
    CAPACITE: { zones: () => 4, seats: 4 },
    fitNow: () => {},
    buildPanel: () => calls.push('panel'),
    updateUI: () => {},
    toast: (text: string) => calls.push(`toast ${text}`),
    removeAgent: () => {},
    addFloor: (spec: any, animate: boolean) => {
      const fl: any = { i: floors.length, plot: animate ? { done: false, act: [], workers: [] } : null, spec };
      floors.push(fl);
      calls.push(`addFloor ${spec.id || '-'} ${animate ? 'animated' : 'instant'} zones=${spec.zones.map((z: Zone) => z.key).join(',')}`);
      return fl;
    },
    updateFloor: (fl: any, spec: any, animate: boolean) =>
      calls.push(`updateFloor ${fl.id || '-'} ${animate ? 'animated' : 'instant'} zones=${spec.zones.map((z: Zone) => `${z.key}${z.leadId === null ? '(empty)' : ''}`).join(',')}`),
    deskFor: (fl: any, zoneKey: string, seat: number) => ({ fl, zoneKey, seat }),
    spawnAgent: (info: any, fl: any, desk: any, how: string, zoneKey: string) => {
      const a = { id: info.id, info, fl, desk };
      agents.set(info.id, a);
      calls.push(`spawn ${info.id} ${how} floor=${fl.id || '-'} zone=${zoneKey} seat=${desk ? desk.seat : 'stand'}`);
      return a;
    },
    setAgentState: (a: any, info: any) => {
      a.info = info;
      calls.push(`state ${a.id} ${info.state}`);
    },
    moveAgent: (a: any, fl: any, desk: any, zoneKey: string) => calls.push(`move ${a.id} floor=${fl.id || '-'} zone=${zoneKey} seat=${desk ? desk.seat : 'stand'}`),
    leaveAgent: (a: any) => {
      agents.delete(a.id);
      calls.push(`leave ${a.id}`);
    },
    // The chantier module: the ground floor is never demolished; an animated demolition lasts until the test says the engine is done.
    floorEmpty: () => state.empty,
    demolishFloor: (fl: any, animate: boolean) => {
      if (fl.i === 0 || state.refuse) return false;
      calls.push(`demolish ${fl.id || '-'} ${animate ? 'animated' : 'instant'}`);
      if (animate) fl.plot = { done: false, act: [], workers: [], rev: true };
      else remove(fl);
      return true;
    },
    reviveFloor: (fl: any) => {
      if (!fl.plot || !fl.plot.rev) return false;
      fl.plot.rev = false;
      calls.push(`revive ${fl.id || '-'}`);
      return true;
    },
  };
  const state = { empty: true, refuse: false };
  const remove = (fl: any) => {
    floors.splice(fl.i, 1);
    floors.forEach((f, i) => (f.i = i));
    api.floorDemolished(fl);
  };
  type Api = {
    applyOffice(office: any): void;
    agentInfo(id: string): any;
    floorOfAgent(id: string): any;
    finishFloor(fl: any, quiet: boolean): void;
    floorDemolished(fl: any): void;
  };
  let api: Api;
  const names = Object.keys(globals);
  const donnees = readFileSync(join(import.meta.dir, '..', 'web', 'immeuble', 'donnees.js'), 'utf8');
  api = new Function(...names, `${source}\n${donnees}\nDATA.grace = 0;
return {applyOffice, agentInfo, floorOfAgent, finishFloor, floorDemolished};`)(...names.map((name) => (globals as any)[name])) as Api;
  return {
    ...api,
    state,
    /** The engine took the floor down: it leaves the scene and the data module hears of it. */
    demolished: remove,
    calls,
    floors,
    storage,
    /** The calls since the last take. */
    take: () => calls.splice(0),
    advance(ms: number) {
      clock += ms;
      for (const fn of timers.splice(0)) fn();
    },
  };
}
const full = (teams: Team[], extra: Record<string, unknown> = {}) => ({ ...office(teams, PROJECTS), core: 'connected', waitingCount: 0, generatedAt: 0, archives: [], ...extra });
const agentsOf = (state: { teams: Team[] }) => state.teams.flatMap((t) => t.agents);

describe('applyOffice', () => {
  const two = () => full([crew('c1', 'p1', ['Dev'], 2), crew('c2', 'p2', ['QA'], 1)]);

  test('the first state is placed without animation: floors in order, every agent seated on its zone and seat', () => {
    const s = scene();
    s.applyOffice(two());
    const calls = s.take();
    expect(calls.filter((c) => c.startsWith('addFloor'))).toEqual(['addFloor p1 instant zones=Dev', 'addFloor p2 instant zones=QA']);
    expect(calls.filter((c) => c.startsWith('spawn'))).toEqual([
      'spawn c1 instant floor=p1 zone=chef seat=0',
      'spawn c1-m-Dev instant floor=p1 zone=Dev seat=0',
      'spawn c1-Dev-0 instant floor=p1 zone=Dev seat=1',
      'spawn c1-Dev-1 instant floor=p1 zone=Dev seat=2',
      'spawn c2 instant floor=p2 zone=chef seat=0',
      'spawn c2-m-QA instant floor=p2 zone=QA seat=0',
      'spawn c2-QA-0 instant floor=p2 zone=QA seat=1',
    ]);
    expect(calls.some((c) => c.startsWith('toast'))).toBe(false);
    expect(s.floors[0].stats.total).toBe(4);
    expect(s.floors[0].name).toBe('Boutique');
    expect(s.agentInfo('c1-Dev-0')).toMatchObject({ id: 'c1-Dev-0' });
    expect(s.floorOfAgent('c2-QA-0')).toBe(s.floors[1]);
    expect(s.floorOfAgent('ghost')).toBeNull();
    expect(s.agentInfo('ghost')).toBeNull();
  });

  test('an empty state while the core is not connected is not applied: not the first state, nobody walks out', () => {
    const s = scene();
    s.applyOffice(full([], { core: 'connecting' }));
    expect(s.take()).toEqual([]);
    s.applyOffice(two());
    expect(s.take().filter((c) => c.startsWith('spawn')).every((c) => c.includes(' instant '))).toBe(true);
    s.applyOffice(full([], { core: 'disconnected' }));
    expect(s.take()).toEqual([]);
    s.applyOffice(full([]));
    expect(s.take().filter((c) => c.startsWith('leave')).length).toBe(7);
  });

  test('the same state again does nothing; a state that changes calls setAgentState once', () => {
    const s = scene();
    const o = two();
    s.applyOffice(o);
    s.take();
    s.applyOffice(JSON.parse(JSON.stringify(o)));
    expect(s.take()).toEqual([]);
    const next = JSON.parse(JSON.stringify(o));
    agentsOf(next).find((a) => a.id === 'c1-Dev-0')!.state = 'waiting';
    s.applyOffice(next);
    expect(s.take()).toEqual(['state c1-Dev-0 waiting']);
    // The page adds a lot to the agent before handing the state over: it stays on the info.
    const withLot = JSON.parse(JSON.stringify(next));
    (agentsOf(withLot).find((a) => a.id === 'c1-Dev-0') as any).lot = { title: 'Lot A', state: 'running' };
    s.applyOffice(withLot);
    expect(s.take()).toEqual([]);
    expect(s.agentInfo('c1-Dev-0').lot).toEqual({ title: 'Lot A', state: 'running' });
  });

  test('a new project: floor built on top first, its agents walk in one at a time once it is finished', () => {
    const s = scene();
    s.applyOffice(two());
    s.take();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 2), crew('c2', 'p2', ['QA'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    let calls = s.take();
    expect(calls).toContain('addFloor p3 animated zones=Ops');
    expect(calls.some((c) => c.startsWith('spawn'))).toBe(false);
    expect(calls.some((c) => c.startsWith('toast Nouveau projet : Site'))).toBe(true);
    s.advance(5_000);
    expect(s.take().some((c) => c.startsWith('spawn'))).toBe(false);
    s.finishFloor(s.floors[2], false);
    calls = s.take();
    expect(calls.filter((c) => c.startsWith('spawn'))).toEqual(['spawn c3 door floor=p3 zone=chef seat=0']);
    s.advance(700);
    expect(s.take()).toEqual(['spawn c3-m-Ops door floor=p3 zone=Ops seat=0']);
    s.advance(700);
    expect(s.take()).toEqual(['spawn c3-Ops-0 door floor=p3 zone=Ops seat=1']);
  });

  test('two new projects are built one after the other', () => {
    const s = scene();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1)]));
    s.take();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c2', 'p2', ['QA'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    expect(s.take().filter((c) => c.startsWith('addFloor'))).toEqual(['addFloor p2 animated zones=QA']);
    s.finishFloor(s.floors[1], false);
    expect(s.take().filter((c) => c.startsWith('addFloor'))).toEqual(['addFloor p3 animated zones=Ops']);
  });

  test('a new agent walks in by the door, takes the next seat and moves nobody', () => {
    const s = scene();
    const o = two();
    s.applyOffice(o);
    s.take();
    const next = JSON.parse(JSON.stringify(o));
    next.teams[0].agents.push(agent('late', 'agent', 'c1-m-Dev', { service: 'Dev', state: 'queued' }));
    s.applyOffice(next);
    expect(s.take()).toEqual(['spawn late door floor=p1 zone=Dev seat=3']);
  });

  test('an agent gone leaves; its seat is free for the next one', () => {
    const s = scene();
    const o = two();
    s.applyOffice(o);
    s.take();
    const next = JSON.parse(JSON.stringify(o));
    next.teams[0].agents = next.teams[0].agents.filter((a: Agent) => a.id !== 'c1-Dev-0');
    s.applyOffice(next);
    expect(s.take()).toEqual(['leave c1-Dev-0']);
    next.teams[0].agents.push(agent('late', 'agent', 'c1-m-Dev', { service: 'Dev' }));
    s.applyOffice(next);
    expect(s.take()).toEqual(['spawn late door floor=p1 zone=Dev seat=1']);
  });

  test('an agent that changes project is moved to its new floor', () => {
    const s = scene();
    const o = two();
    s.applyOffice(o);
    s.take();
    const next = JSON.parse(JSON.stringify(o));
    const [moved] = next.teams[1].agents.splice(2, 1);
    next.teams[0].agents.push({ ...moved, parentId: 'c1-m-Dev', service: 'Dev' });
    s.applyOffice(next);
    expect(s.take()).toEqual(['move c2-QA-0 floor=p1 zone=Dev seat=3']);
    expect(s.floorOfAgent('c2-QA-0')).toBe(s.floors[0]);
  });

  test('a new service on a floor builds its zone, and its people wait for it', () => {
    const s = scene();
    const o = two();
    s.applyOffice(o);
    s.take();
    const next = JSON.parse(JSON.stringify(o));
    next.teams[0].agents.push(agent('m-ux', 'manager', 'c1', { service: 'UX' }), agent('ux-0', 'agent', 'm-ux', { service: 'UX' }));
    s.applyOffice(next);
    const calls = s.take();
    expect(calls).toContain('updateFloor p1 animated zones=Dev,UX');
    expect(calls).toContain('spawn m-ux door floor=p1 zone=UX seat=0');
  });

  const three = () => full([crew('c1', 'p1', ['Dev'], 1), crew('c2', 'p2', ['QA'], 1), crew('c3', 'p3', ['Ops'], 1)]);

  test('a project with no team any more: its people walk out, then its floor is demolished (not before they are out)', () => {
    const s = scene();
    s.applyOffice(three());
    s.take();
    s.state.empty = false;
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    let calls = s.take();
    expect(calls.filter((c) => c.startsWith('leave'))).toEqual(['leave c2', 'leave c2-m-QA', 'leave c2-QA-0']);
    expect(calls.some((c) => c.startsWith('demolish'))).toBe(false);
    expect(s.floors[1].stats.total).toBe(0);
    // Somebody is still on the floor: nothing happens, however long we wait.
    s.advance(250);
    s.advance(250);
    expect(s.take()).toEqual([]);
    s.state.empty = true;
    s.advance(250);
    expect(s.take()).toEqual(['demolish p2 animated']);
    // The engine is done: the floor leaves, the page says so and the memory forgets it.
    s.demolished(s.floors[1]);
    calls = s.take();
    expect(calls).toContain('toast Projet Atelier terminé : son étage est démoli.');
    expect(calls).toContain('panel');
    expect(JSON.parse(s.storage.get('bureau.immeuble.etages')!)).toEqual(['p1', 'p3']);
    // The floor above is still in place and still known.
    expect(s.floorOfAgent('c3-Ops-0')).toBe(s.floors[1]);
    expect(s.floors[1].id).toBe('p3');
  });

  test('floors are demolished one at a time', () => {
    const s = scene();
    s.applyOffice(three());
    s.take();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1)]));
    expect(s.take().filter((c) => c.startsWith('demolish'))).toEqual(['demolish p2 animated']);
    s.advance(250);
    s.advance(250);
    // p3 waits for the demolition of p2 to end.
    expect(s.take()).toEqual([]);
    // The next one starts as soon as the first is gone.
    s.demolished(s.floors[1]);
    expect(s.take().filter((c) => c.startsWith('demolish'))).toEqual(['demolish p3 animated']);
    s.demolished(s.floors[1]);
    expect(s.floors.length).toBe(1);
  });

  test('a chantier under way delays the demolition; a demolition delays a new project', () => {
    const s = scene();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c2', 'p2', ['QA'], 1)]));
    s.take();
    // A new project starts its chantier; meanwhile p2 has no team any more.
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    expect(s.take()).toContain('addFloor p3 animated zones=Ops');
    s.advance(250);
    expect(s.take().some((c) => c.startsWith('demolish'))).toBe(false);
    s.finishFloor(s.floors[2], false);
    s.advance(250);
    expect(s.take().filter((c) => c.startsWith('demolish'))).toEqual(['demolish p2 animated']);
    // A project that arrives during the demolition is built after it.
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c3', 'p3', ['Ops'], 1), crew('c4', 'p4', ['UX'], 1)], { projects: [...PROJECTS, { id: 'p4', name: 'Portail' }] }));
    expect(s.take().some((c) => c.startsWith('addFloor'))).toBe(false);
    s.demolished(s.floors[1]);
    expect(s.take()).toContain('addFloor p4 animated zones=UX');
  });

  test('the project comes back during the demolition: the floor is built again where it stopped, and its people come back', () => {
    const s = scene();
    s.applyOffice(three());
    s.take();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    s.advance(250);
    expect(s.take().filter((c) => c.startsWith('demolish'))).toEqual(['demolish p2 animated']);
    s.applyOffice(three());
    const calls = s.take();
    expect(calls).toContain('revive p2');
    expect(calls.some((c) => c.startsWith('addFloor'))).toBe(false);
    // Its people wait for the floor to be finished again, then walk in.
    expect(calls.some((c) => c.startsWith('spawn'))).toBe(false);
    s.finishFloor(s.floors[1], false);
    expect(s.take().filter((c) => c.startsWith('spawn')).length).toBe(1);
    s.advance(700);
    s.advance(700);
    expect(s.floors.length).toBe(3);
    expect(s.floorOfAgent('c2-QA-0')).toBe(s.floors[1]);
  });

  test('the project comes back before the demolition began: nothing happens to the floor', () => {
    const s = scene();
    s.applyOffice(three());
    s.take();
    s.state.empty = false;
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    s.take();
    s.applyOffice(three());
    s.state.empty = true;
    s.advance(250);
    s.advance(250);
    const calls = s.take();
    expect(calls.some((c) => c.startsWith('demolish') || c.startsWith('revive'))).toBe(false);
    expect(calls.some((c) => c.startsWith('addFloor'))).toBe(false);
    expect(s.floors.length).toBe(3);
  });

  test('the ground floor is the entrance: it stays when its project is gone, empty, and is not remembered', () => {
    const s = scene();
    s.applyOffice(two());
    s.take();
    s.applyOffice(full([crew('c2', 'p2', ['QA'], 1)]));
    const calls = s.take();
    expect(calls.filter((c) => c.startsWith('leave')).length).toBe(4);
    expect(s.floors[0].stats.total).toBe(0);
    expect(calls.some((c) => c.startsWith('addFloor'))).toBe(false);
    s.advance(250);
    s.advance(250);
    expect(s.take().some((c) => c.startsWith('demolish'))).toBe(false);
    expect(s.floors.length).toBe(2);
    expect(JSON.parse(s.storage.get('bureau.immeuble.etages')!)).toEqual(['p2']);
    // It comes back in its place.
    s.applyOffice(two());
    expect(s.take().filter((c) => c.startsWith('addFloor'))).toEqual([]);
  });

  test('reduced motion: the floor goes at once, without the animation', () => {
    const s = scene({ reduced: true });
    s.applyOffice(three());
    s.take();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c3', 'p3', ['Ops'], 1)]));
    s.advance(250);
    const calls = s.take();
    expect(calls).toContain('demolish p2 instant');
    expect(calls).toContain('toast Projet Atelier terminé : son étage est démoli.');
    expect(s.floors.map((f: any) => f.id)).toEqual(['p1', 'p3']);
  });

  test('an empty state while the core is connected demolishes every floor but the ground floor', () => {
    const s = scene();
    s.applyOffice(three());
    s.take();
    s.applyOffice(full([]));
    s.advance(250);
    expect(s.take().filter((c) => c.startsWith('demolish'))).toEqual(['demolish p2 animated']);
    s.demolished(s.floors[1]);
    s.advance(250);
    expect(s.take().filter((c) => c.startsWith('demolish'))).toEqual(['demolish p3 animated']);
    s.demolished(s.floors[1]);
    s.take();
    s.advance(250);
    expect(s.take()).toEqual([]);
    expect(s.floors.length).toBe(1);
  });

  test('the floor order is stored, and a visit after it starts from it', () => {
    const s = scene();
    s.applyOffice(full([crew('c2', 'p2', ['QA'], 0)]));
    s.applyOffice(full([crew('c2', 'p2', ['QA'], 0), crew('c1', 'p1', ['Dev'], 0)]));
    expect(JSON.parse(s.storage.get('bureau.immeuble.etages')!)).toEqual(['p2', 'p1']);
    const again = scene({ stored: ['p2', 'p1'] });
    again.applyOffice(two());
    expect(again.take().filter((c) => c.startsWith('addFloor')).map((c) => c.split(' ')[1])).toEqual(['p2', 'p1']);
  });

  test('reduced motion: everything appears at once', () => {
    const s = scene({ reduced: true });
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1)]));
    s.take();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 1), crew('c2', 'p2', ['QA'], 1)]));
    const calls = s.take();
    expect(calls).toContain('addFloor p2 instant zones=QA');
    expect(calls.filter((c) => c.startsWith('spawn')).every((c) => c.includes(' instant '))).toBe(true);
  });

  test('more people than seats: the extra ones stand in their zone', () => {
    const s = scene();
    s.applyOffice(full([crew('c1', 'p1', ['Dev'], 5)]));
    const spawns = s.take().filter((c) => c.startsWith('spawn c1-Dev'));
    expect(spawns.slice(-2)).toEqual(['spawn c1-Dev-3 instant floor=p1 zone=Dev seat=stand', 'spawn c1-Dev-4 instant floor=p1 zone=Dev seat=stand']);
  });

  test('50 agents (the budget says 40) are applied in 2 ms or less', () => {
    const s = scene();
    const o = full([1, 2, 3, 4, 5].map((n) => crew(`c${n}`, `p${n}`, ['A', 'B', 'C'], 2, { lastActivity: n })), { projects: [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, name: `Projet ${n}` })) });
    s.applyOffice(o);
    expect(agentsOf(o).length).toBeGreaterThanOrEqual(40);
    const states = ['running', 'waiting', 'idle', 'queued'];
    const times: number[] = [];
    for (let round = 0; round < 60; round++) {
      const next = JSON.parse(JSON.stringify(o));
      agentsOf(next).forEach((a, i) => (a.state = states[(i + round) % 4]!));
      const t0 = performance.now();
      s.applyOffice(next);
      times.push(performance.now() - t0);
      s.take();
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]!).toBeLessThan(2);
  });
});
