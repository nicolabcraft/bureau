import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* floorplan.js is plain script text shared with the page: load it on its own, as the page would, with nothing around it. */
const source = readFileSync(join(import.meta.dir, '..', 'web', 'pixel', 'floorplan.js'), 'utf8');

const PUBLIC = [
  'CELL', 'PLATE_ROWS', 'PLATE_H', 'SLAB', 'BLOCK', 'STAIRS_W', 'LIFT_W', 'SKY_H', 'GROUND_H', 'COLS_MIN', 'COLS_MAX',
  'planBuilding', 'buildingCols', 'layoutFloor', 'buildingSize', 'floorTop', 'floorAtY', 'floorScrollY', 'floorTitle', 'stairPoints', 'findPath', 'freeCellNear',
];

type Rect = { x: number; y: number; w: number; h: number };
type Spot = { x: number; y: number; f: string; px?: number; py?: number };
type Desk = { id: string; where: string; x: number; y: number; w: number; seat: { x: number; y: number }; approach: { x: number; y: number }; ownerId: string | null; facing: string };
type SpotName = 'coffee' | 'micro' | 'fountain' | 'printer' | 'window' | 'smoke' | 'rail' | 'sofa' | 'bench' | 'board' | 'plant' | 'stairs' | 'lift' | 'entry';
type Room = { key: string; managerId: string; colorKey: string; title: string; rect: Rect; door: { x: number; y: number }; header: { x: number; y: number; w: number }; cols: number; desks: Desk[] };
type Plan = {
  id: string; name: string; spec: Spec; cols: number; rows: number; width: number; height: number; blocked: Uint8Array;
  offices: { teamId: string; chefId: string; rect: Rect; door: { x: number; y: number }; desk: Desk; sign: string }[];
  rooms: Room[]; open: { rect: Rect; desks: Desk[] }; desks: Desk[]; spots: Record<SpotName, Spot[]>;
  cafeteria: Rect; hall: Rect; entrance: Rect; door: Rect; landY: number; lights: { x: number; y: number; r: number; desk: string | null }[];
  furniture: { kind: string; x: number; y: number; w: number; h: number; z: number }[]; standing: string[];
};
type Spec = {
  id: string; name: string; index: number; title: string;
  offices: { teamId: string; chefId: string; title: string }[];
  rooms: { key: string; managerId: string; service: string | null; title: string; colorKey: string; agentIds: string[] }[];
  open: string[]; stats: Record<string, number>; missions: { id: string; status: string; title: string }[];
};
type Agent = { id: string; title: string; role: string; service: string | null; parentId: string | null; state: string; createdAt: number };
type Team = { id: string; title: string; projectId: string | null; projectName: string | null; agents: Agent[]; mission: { id: string; status: string; title: string } | null; lastActivity: number };
type Office = { teams: Team[]; projects: { id: string; name: string }[] };

const api = new Function(`${source}\nreturn { ${PUBLIC.join(', ')} };`)() as {
  CELL: number; PLATE_ROWS: number; PLATE_H: number; SLAB: number; BLOCK: number; STAIRS_W: number; LIFT_W: number; SKY_H: number; GROUND_H: number; COLS_MIN: number; COLS_MAX: number;
  planBuilding(office: Office, memo: string[] | null): { floors: Spec[]; order: string[] };
  buildingCols(specs: Spec[]): number;
  layoutFloor(spec: Spec, cols: number): Plan;
  buildingSize(count: number, cols: number): { w: number; h: number };
  floorTop(index: number, count: number): number;
  floorAtY(wy: number, count: number): number;
  floorScrollY(index: number, count: number, viewH: number): number;
  floorTitle(index: number): string;
  stairPoints(index: number, count: number): number[][];
  findPath(plan: Plan, sx: number, sy: number, tx: number, ty: number): number[][] | null;
  freeCellNear(plan: Plan, cx: number, cy: number): number[];
};
const { CELL, PLATE_ROWS, PLATE_H, SLAB, BLOCK, STAIRS_W, LIFT_W, SKY_H, GROUND_H, COLS_MIN, COLS_MAX, planBuilding, buildingCols, layoutFloor, buildingSize, floorTop, floorAtY, floorScrollY, floorTitle, stairPoints, findPath, freeCellNear } = api;

/* ---------- fixtures ---------- */

let clock = 0;
const agent = (id: string, role: string, parentId: string | null, extra: Partial<Agent> = {}): Agent => ({
  id, title: `Fil ${id}`, role, service: null, parentId, state: 'idle', createdAt: ++clock, ...extra,
});
const team = (agents: Agent[], extra: Partial<Team> = {}): Team => ({
  id: agents[0]!.id, title: agents[0]!.title, projectId: null, projectName: null, agents, mission: null, lastActivity: 1, ...extra,
});
const office = (teams: Team[], projects: { id: string; name: string }[] = []): Office => ({ teams, projects });
const PROJECTS = [{ id: 'p1', name: 'Boutique' }, { id: 'p2', name: 'Atelier' }, { id: 'p3', name: 'Site' }];

/** A chef with `services` managers, each with `perService` agents. */
function crew(root: string, projectId: string | null, services: string[], perService = 2, extra: Partial<Team> = {}): Team {
  const agents = [agent(root, 'chef', null)];
  for (const service of services) {
    const mgr = agent(`${root}-m-${service}`, 'manager', root, { service, title: `Manager ${service}` });
    agents.push(mgr);
    for (let i = 0; i < perService; i++) agents.push(agent(`${root}-${service}-${i}`, 'agent', mgr.id, { service }));
  }
  return team(agents, { projectId, ...extra });
}

/** The Boutique of the budget: 1 chef, 5 managers, 7 agents (3 + 1 + 1 + 1 + 1). */
function boutique(): Team {
  const chef = agent('b-chef', 'chef', null);
  const agents = [chef];
  const per: Record<string, number> = { Développement: 3, Architecture: 1, Design: 1, Qualité: 1, Produit: 1 };
  for (const [service, n] of Object.entries(per)) {
    const m = agent(`b-m-${service}`, 'manager', 'b-chef', { service, title: `Manager ${service}` });
    agents.push(m);
    for (let i = 0; i < n; i++) agents.push(agent(`b-${service}-${i}`, 'agent', m.id, { service }));
  }
  return team(agents, { projectId: 'p1', projectName: 'Boutique' });
}

/** A spec written by hand: `rooms` lists the agent counts, `open` the free agents, `chefs` the glass offices. */
function spec(rooms: number[], open = 0, chefs = 1, id = 'p1'): Spec {
  const offices = Array.from({ length: chefs }, (_, k) => ({ teamId: `t${k}`, chefId: `chef${k}`, title: `Mission ${k}` }));
  return {
    id, name: id || 'Sans projet', index: id ? 1 : 0, title: floorTitle(id ? 1 : 0), offices,
    rooms: rooms.map((n, i) => ({ key: `room:m${i}`, managerId: `m${i}`, service: 'Développement', title: `Manager ${i}`, colorKey: 'dev', agentIds: Array.from({ length: n }, (_, k) => `a${i}-${k}`) })),
    open: Array.from({ length: open }, (_, k) => `o${k}`),
    stats: { total: 0, running: 0, waiting: 0, queued: 0, done: 0, error: 0 }, missions: [],
  };
}

const boutiqueSpec = () => planBuilding(office([boutique()], PROJECTS), null).floors[1]!;

/* ---------- checks shared by the layout tests ---------- */

const cellRect = (x: number, y: number, w: number, h: number): Rect => ({ x: Math.floor(x / CELL), y: Math.floor(y / CELL), w: Math.ceil((x + w) / CELL) - Math.floor(x / CELL), h: Math.ceil((y + h) / CELL) - Math.floor(y / CELL) });
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const deskCells = (d: Desk) => cellRect(d.x, d.y, d.w, 12);
const walkable = (plan: Plan, c: { x: number; y: number }) => c.x >= 0 && c.y >= 0 && c.x < plan.cols && c.y < PLATE_ROWS && !plan.blocked[c.y * plan.cols + c.x];
const landings = (plan: Plan) => [plan.spots.stairs[0]!, plan.spots.lift[0]!];

/** Every structural rule of 2.4 on one plan; returns the cells that must be reachable. */
function checkPlan(plan: Plan): void {
  expect(plan.cols).toBeGreaterThanOrEqual(COLS_MIN);
  expect(plan.cols).toBeLessThanOrEqual(COLS_MAX);
  expect(plan.rows).toBe(PLATE_ROWS);
  expect(plan.width).toBe(plan.cols * CELL);
  expect(plan.height).toBe(PLATE_H);
  expect(plan.blocked.length).toBe(plan.cols * PLATE_ROWS);

  // No overlap between offices, rooms, the open zone and the furniture; desks apart from each other and from the furniture.
  const rects: [string, Rect][] = [];
  plan.offices.forEach((o, i) => rects.push([`office ${i}`, o.rect]));
  plan.rooms.forEach((r, i) => rects.push([`room ${i}`, r.rect]));
  if (plan.open.rect.w > 0) rects.push(['open', plan.open.rect]);
  plan.furniture.forEach((f, i) => rects.push([`${f.kind} ${i}`, f]));
  for (let i = 0; i < rects.length; i++) {
    const [name, r] = rects[i]!;
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= plan.cols && r.y + r.h <= PLATE_ROWS).toBe(true);
    for (let j = i + 1; j < rects.length; j++) {
      const [other, q] = rects[j]!;
      if (hit(r, q)) throw new Error(`${name} overlaps ${other}: ${JSON.stringify(r)} ${JSON.stringify(q)}`);
    }
  }
  const ids = new Set<string>();
  plan.desks.forEach((d, i) => {
    expect(ids.has(d.id)).toBe(false);
    ids.add(d.id);
    expect(d.id).toBe(`${d.where}#${d.id.split('#')[1]}`);
    expect(d.facing).toBe('down');
    const r = deskCells(d);
    for (const [name, q] of rects) if (!name.startsWith('office') && !name.startsWith('room') && name !== 'open' && hit(r, q)) throw new Error(`desk ${d.id} overlaps ${name}`);
    for (let j = i + 1; j < plan.desks.length; j++) if (hit(r, deskCells(plan.desks[j]!))) throw new Error(`desks ${d.id} and ${plan.desks[j]!.id} overlap`);
    expect(walkable(plan, d.seat)).toBe(true);
    expect(walkable(plan, d.approach)).toBe(true);
    // the desk is in its own zone and blocks its cells
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(plan.blocked[y * plan.cols + x]).toBe(1);
  });
  for (const room of plan.rooms) for (const d of room.desks) {
    expect(d.where).toBe(room.key);
    const c = deskCells(d);
    expect(c.x).toBeGreaterThan(room.rect.x);
    expect(c.x + c.w).toBeLessThanOrEqual(room.rect.x + room.rect.w);
    expect(c.y).toBeGreaterThanOrEqual(room.rect.y + 1);
    expect(c.y + c.h).toBeLessThanOrEqual(room.rect.y + room.rect.h - 1);
  }
  for (const o of plan.offices) {
    const c = deskCells(o.desk);
    expect(c.x).toBeGreaterThan(o.rect.x);
    expect(c.x + c.w).toBeLessThanOrEqual(o.rect.x + o.rect.w - 1);
  }
  for (const d of plan.open.desks) {
    const c = deskCells(d);
    expect(c.x).toBeGreaterThanOrEqual(plan.open.rect.x);
    expect(c.x + c.w).toBeLessThanOrEqual(plan.open.rect.x + plan.open.rect.w);
  }
  expect(plan.desks.length).toBe(plan.offices.length + plan.rooms.reduce((n, r) => n + r.desks.length, 0) + plan.open.desks.length);

  // Spots: walkable, at least 2 (6 for board) where the contract says so, stairs and lift on the landing row.
  for (const name of (['coffee', 'window', 'smoke', 'rail', 'sofa'] as SpotName[])) expect(plan.spots[name].length).toBeGreaterThanOrEqual(2);
  expect(plan.spots.board!.length).toBeGreaterThanOrEqual(6);
  for (const name of (['micro', 'fountain', 'printer', 'bench', 'plant', 'stairs', 'lift'] as SpotName[])) expect(plan.spots[name].length).toBeGreaterThanOrEqual(1);
  expect(plan.spots.entry!.length).toBe(plan.id === '' ? 1 : 0);
  for (const [name, list] of Object.entries(plan.spots)) for (const s of list) {
    if (!walkable(plan, s)) throw new Error(`spot ${name} ${JSON.stringify(s)} is not walkable`);
    expect(['up', 'down', 'left', 'right']).toContain(s.f);
  }
  const landY = Math.floor(plan.landY / CELL);
  expect(plan.spots.stairs![0]!.y).toBe(landY);
  expect(plan.spots.lift![0]!.y).toBe(landY);
  expect(plan.spots.stairs![0]!.x).toBe(1);
  expect(plan.spots.lift![0]!.x).toBe(plan.cols - 2);
}

/** Every desk, door and spot reachable from both landings; every free cell reachable (the plan closes what is cut off). */
function checkReach(plan: Plan): void {
  const targets: [string, { x: number; y: number }][] = [];
  for (const d of plan.desks) targets.push([`seat ${d.id}`, d.seat], [`approach ${d.id}`, d.approach]);
  for (const r of plan.rooms) targets.push([`door of ${r.key}`, r.door]);
  for (const o of plan.offices) targets.push([`door of office ${o.teamId}`, o.door]);
  for (const [name, list] of Object.entries(plan.spots)) list.forEach((s, i) => targets.push([`spot ${name} ${i}`, s]));
  for (const from of landings(plan)) {
    for (const [name, t] of targets) {
      const path = findPath(plan, from.x, from.y, t.x, t.y);
      if (path === null) throw new Error(`${name} (${t.x},${t.y}) cannot be reached from (${from.x},${from.y})`);
      if (path.length) expect(path[path.length - 1]).toEqual([t.x, t.y]);
    }
  }
  const from = landings(plan)[0]!;
  for (let y = 0; y < plan.rows; y++) for (let x = 0; x < plan.cols; x++) {
    if (!plan.blocked[y * plan.cols + x] && findPath(plan, from.x, from.y, x, y) === null) throw new Error(`free cell (${x},${y}) is cut off`);
  }
}

/* ---------- the file ---------- */

function topLevelNames(text: string): string[] {
  return [...text.matchAll(/^(?:(?:const|let|var|class)\s+|(?:async\s+)?function\s*\*?\s*)([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
}

describe('floorplan.js is pure and alone', () => {
  test('every top-level name is public (2.4) or wears the prefix fpl', () => {
    for (const name of topLevelNames(source)) expect(PUBLIC.includes(name) || name.startsWith('fpl')).toBe(true);
  });
  test('every public name is declared', () => {
    for (const name of PUBLIC) expect(topLevelNames(source)).toContain(name);
  });
  test('no DOM, no other file, no randomness, no clock', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['document', 'canvas', 'Math.random', 'Date.now', 'performance', 'localStorage', 'fetch(', 'import ', 'require(', 'globalThis']) expect(code.includes(word)).toBe(false);
    expect(/(^|[^.\w])window(?!\s*:)/.test(code)).toBe(false);
  });
  test('no dash, no emoji, LF only', () => {
    expect(/[–—]/.test(source)).toBe(false);
    expect(/[\u{1F000}-\u{1FFFF}]/u.test(source)).toBe(false);
    expect(source.includes('\r')).toBe(false);
  });
  test('constants of 2.4', () => {
    expect([CELL, PLATE_ROWS, PLATE_H, SLAB, BLOCK, STAIRS_W, LIFT_W, SKY_H, GROUND_H, COLS_MIN, COLS_MAX]).toEqual([8, 44, 352, 16, 368, 56, 44, 80, 24, 62, 96]);
  });
});

describe('planBuilding', () => {
  const ids = (plan: { floors: Spec[] }) => plan.floors.map((f) => f.id);

  test('the ground floor is always there, first, even in an empty office', () => {
    const empty = planBuilding(office([]), null);
    expect(ids(empty)).toEqual(['']);
    expect(empty.order).toEqual([]);
    expect(empty.floors[0]).toMatchObject({ id: '', name: 'Sans projet', index: 0, title: 'Rez-de-chaussée', offices: [], rooms: [], open: [] });
    expect(planBuilding(null as unknown as Office, null).floors).toHaveLength(1);
  });

  test('first load: projects.list order, one floor per project that has a team, indexes and titles follow', () => {
    const plan = planBuilding(office([crew('c3', 'p3', ['Dev']), crew('c1', 'p1', ['Dev']), crew('cx', null, ['Dev'])], PROJECTS), null);
    expect(ids(plan)).toEqual(['', 'p1', 'p3']);
    expect(plan.order).toEqual(['p1', 'p3']);
    expect(plan.floors.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(plan.floors.map((f) => f.title)).toEqual(['Rez-de-chaussée', '1er étage', '2e étage']);
    expect(plan.floors[1]!.name).toBe('Boutique');
  });

  test('memory is kept as it is, new projects land on top, unknown and empty ids are forgotten', () => {
    const teams = [crew('c1', 'p1', ['Dev']), crew('c2', 'p2', ['Dev']), crew('c3', 'p3', ['Dev'])];
    expect(ids(planBuilding(office(teams, PROJECTS), ['p3', 'p1']))).toEqual(['', 'p3', 'p1', 'p2']);
    expect(planBuilding(office(teams, PROJECTS), ['p3', 'gone', '', 'p3', 'p1']).order).toEqual(['p3', 'p1', 'p2']);
    expect(ids(planBuilding(office([teams[1]!], PROJECTS), ['p1', 'p2']))).toEqual(['', 'p2']);
  });

  test('a project without a known name uses the team name, else a default', () => {
    const t = crew('c9', 'zz', ['Dev'], 1, { projectName: 'Portail' });
    expect(planBuilding(office([t], []), null).floors[1]!.name).toBe('Portail');
    expect(planBuilding(office([crew('c8', 'yy', ['Dev'])], []), null).floors[1]!.name).toBe('Projet sans nom');
  });

  test('offices: one per team whose root is a chef with a child; a lone root goes to the open space', () => {
    const lone = team([agent('lone', 'chef', null)], { projectId: 'p1' });
    const floor = planBuilding(office([crew('c1', 'p1', ['Dev']), lone], PROJECTS), null).floors[1]!;
    expect(floor.offices).toEqual([{ teamId: 'c1', chefId: 'c1', title: 'Fil c1' }]);
    expect(floor.open).toEqual(['lone']);
  });

  test('at most three offices, the oldest chefs first; the others sit in the open space', () => {
    const teams = ['c1', 'c2', 'c3', 'c4'].map((id) => crew(id, 'p1', ['Dev'], 0));
    const floor = planBuilding(office([...teams].reverse(), PROJECTS), null).floors[1]!;
    expect(floor.offices.map((o) => o.chefId)).toEqual(['c1', 'c2', 'c3']);
    expect(floor.open).toEqual(['c4']);
  });

  test('rooms: one per manager, oldest first, agents under their nearest manager, oldest first', () => {
    const chef = agent('c', 'chef', null);
    const m1 = agent('m1', 'manager', 'c', { service: 'Design', title: 'Resp. Design' });
    const m2 = agent('m2', 'manager', 'c', { service: 'Qualité' });
    const a1 = agent('a1', 'agent', 'm1');
    const sub = agent('sub', 'agent', 'a1');                         // deeper: still the room of m1
    const a0 = agent('a0', 'agent', 'm1', { createdAt: 1 });         // older than everyone
    const loose = agent('loose', 'agent', 'c');                      // no manager above: open space
    const nested = agent('m3', 'manager', 'm2', { service: 'Autre' });
    const deep = agent('deep', 'agent', 'm3');
    const floor = planBuilding(office([team([chef, m1, m2, a1, sub, a0, loose, nested, deep], { projectId: 'p1' })], PROJECTS), null).floors[1]!;
    expect(floor.rooms.map((r) => r.managerId)).toEqual(['m1', 'm2', 'm3']);
    expect(floor.rooms[0]).toMatchObject({ key: 'room:m1', service: 'Design', title: 'Resp. Design', colorKey: 'design', agentIds: ['a0', 'a1', 'sub'] });
    expect(floor.rooms[1]).toMatchObject({ colorKey: 'qa', agentIds: [], title: 'Fil m2' });
    expect(floor.rooms[2]).toMatchObject({ colorKey: 'misc', agentIds: ['deep'] });
    expect(floor.open).toEqual(['loose']);
  });

  test('a manager of a team without chef still gets its room', () => {
    const m = agent('m', 'manager', null, { service: 'Produit' });
    const a = agent('a', 'agent', 'm');
    const floor = planBuilding(office([team([m, a], { projectId: 'p1' })], PROJECTS), null).floors[1]!;
    expect(floor.offices).toEqual([]);
    expect(floor.rooms[0]).toMatchObject({ managerId: 'm', colorKey: 'prod', agentIds: ['a'] });
  });

  test('colour keys follow the service, accents and case aside', () => {
    const keys = ['Développement', 'développement', 'Architecture', 'Design', 'Qualité', 'QA', 'Produit', 'Sécurité', null].map((service) => {
      const m = agent(`m-${service}`, 'manager', null, { service });
      return planBuilding(office([team([m], { projectId: 'p1' })], PROJECTS), null).floors[1]!.rooms[0]!.colorKey;
    });
    expect(keys).toEqual(['dev', 'dev', 'arch', 'design', 'qa', 'qa', 'prod', 'misc', 'misc']);
  });

  test('stats and missions cover every team of the floor', () => {
    const a = crew('c1', 'p1', ['Dev'], 2, { mission: { id: 'M1', status: 'validated', title: 'Refonte' } });
    a.agents[1]!.state = 'running'; a.agents[2]!.state = 'waiting'; a.agents[3]!.state = 'error';
    const b = crew('c2', 'p1', ['Dev'], 0);
    const floor = planBuilding(office([a, b], PROJECTS), null).floors[1]!;
    expect(floor.stats).toEqual({ total: 6, running: 1, waiting: 1, queued: 0, done: 0, error: 1 });
    expect(floor.missions).toEqual([{ id: 'M1', status: 'validated', title: 'Refonte' }]);
  });

  test('the same state always gives the same plan, whatever the order of the teams', () => {
    const teams = [crew('c1', 'p1', ['Dev', 'Design']), crew('c2', 'p1', ['QA']), crew('c3', 'p2', ['Dev'])];
    const a = planBuilding(office(teams, PROJECTS), null);
    const b = planBuilding(office([...teams].reverse(), PROJECTS), null);
    expect(JSON.stringify(a.floors.map((f) => [f.id, f.rooms.length, f.offices.length]))).toBe(JSON.stringify(b.floors.map((f) => [f.id, f.rooms.length, f.offices.length])));
    expect(a.order).toEqual(b.order);
  });
});

describe('buildingCols', () => {
  test('between COLS_MIN and COLS_MAX, COLS_MIN for the usual floors', () => {
    expect(buildingCols([])).toBe(COLS_MIN);
    expect(buildingCols([spec([], 0, 0, ''), boutiqueSpec(), spec([2, 2], 2)])).toBe(COLS_MIN);
  });
  test('the widest floor sets the width of every floor', () => {
    const wide = spec([8, 8, 8], 6);
    const cols = buildingCols([spec([2]), wide]);
    expect(cols).toBeGreaterThan(COLS_MIN);
    expect(cols).toBe(buildingCols([wide]));
    expect(layoutFloor(spec([2]), cols).cols).toBe(cols);
    expect(layoutFloor(wide, cols).cols).toBe(cols);
  });
  test('never above COLS_MAX', () => {
    expect(buildingCols([spec([8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8], 40, 3)])).toBe(COLS_MAX);
    expect(layoutFloor(spec([2]), 500).cols).toBe(COLS_MAX);
    expect(layoutFloor(spec([2]), 3).cols).toBe(COLS_MIN);
  });
  test('three offices need the full width', () => {
    expect(buildingCols([spec([2], 0, 2)])).toBeGreaterThan(COLS_MIN);
    expect(buildingCols([spec([2], 0, 3)])).toBe(COLS_MAX);
  });
});

describe('layoutFloor', () => {
  const shapes: [string, Spec][] = [
    ['empty ground floor', spec([], 0, 0, '')],
    ['ground floor with desks', spec([], 4, 0, '')],
    ['Boutique', boutiqueSpec()],
    ['one lonely chef', spec([], 0, 1)],
    ['one room of one', spec([1])],
    ['rooms of every size', spec([1, 3, 5, 8])],
    ['open space only', spec([], 7, 0)],
    ['two offices, three rooms', spec([2, 4, 8], 3, 2)],
    ['three offices, rooms and open space', spec([4, 6], 5, 3)],
    ['a full plate', spec([8, 8, 8, 8], 12, 3)],
  ];
  const cols = (s: Spec) => buildingCols([s]);

  for (const [name, s] of shapes) {
    test(`${name}: structure, no overlap, everything reachable from both landings`, () => {
      const plan = layoutFloor(s, cols(s));
      checkPlan(plan);
      checkReach(plan);
    });
  }

  test('every plan of the Boutique building shares one width and one carcass', () => {
    const specs = [spec([], 4, 0, ''), boutiqueSpec(), spec([8, 8, 8], 6, 2)];
    const width = buildingCols(specs);
    const plans = specs.map((s) => layoutFloor(s, width));
    for (const plan of plans) { checkPlan(plan); checkReach(plan); expect(plan.cols).toBe(width); }
    const [a, ...rest] = plans;
    for (const p of rest) {
      expect(p.cafeteria).toEqual(a!.cafeteria);
      expect(p.hall).toEqual(a!.hall);
      expect(p.entrance).toEqual(a!.entrance);
      expect(p.door).toEqual(a!.door);
      expect(p.landY).toBe(a!.landY);
      expect(p.spots.coffee).toEqual(a!.spots.coffee);
      expect(p.spots.stairs).toEqual(a!.spots.stairs);
      expect(p.spots.lift).toEqual(a!.spots.lift);
      expect(p.spots.smoke).toEqual(a!.spots.smoke);
    }
  });

  test('deterministic: same spec and same cols, same plan', () => {
    const s = spec([3, 8, 2], 4, 2);
    const a = layoutFloor(s, 80), b = layoutFloor(JSON.parse(JSON.stringify(s)), 80);
    expect(Array.from(a.blocked)).toEqual(Array.from(b.blocked));
    const strip = (p: Plan) => JSON.stringify({ ...p, blocked: null, spec: null });
    expect(strip(a)).toBe(strip(b));
  });

  test('a plan is independent of the plans made before it', () => {
    const s = boutiqueSpec();
    const first = layoutFloor(s, COLS_MIN);
    layoutFloor(spec([8, 8, 8], 9, 3), COLS_MAX);
    findPath(first, 1, 41, 30, 10);
    expect(Array.from(layoutFloor(s, COLS_MIN).blocked)).toEqual(Array.from(first.blocked));
  });

  test('geometry of the template: walls, passages at the landing, bottom strip', () => {
    const plan = layoutFloor(boutiqueSpec(), COLS_MIN);
    const at = (x: number, y: number) => plan.blocked[y * plan.cols + x];
    for (let x = 0; x < plan.cols; x++) { expect(at(x, 0)).toBe(1); expect(at(x, 1)).toBe(1); expect(at(x, 42)).toBe(1); expect(at(x, 43)).toBe(1); }
    for (const y of [40, 41]) { expect(at(0, y)).toBe(0); expect(at(plan.cols - 1, y)).toBe(0); }
    for (const y of [10, 39, 42, 43]) { expect(at(0, y)).toBe(1); expect(at(plan.cols - 1, y)).toBe(1); }
    expect(plan.landY).toBe(41 * CELL + 7);
    expect(plan.door).toEqual({ x: 200, y: 336, w: 32, h: 16 });
    expect(plan.height).toBe(352);
  });

  test('head zone: glass offices are 15 x 5 cells side by side, the printer follows them, row 7 stays a free walkway', () => {
    for (const n of [1, 2, 3]) {
      const s = spec([2, 4], 3, n);
      const plan = layoutFloor(s, buildingCols([s]));
      expect(plan.offices.map((o) => o.rect)).toEqual(Array.from({ length: n }, (_, k) => ({ x: 2 + 29 * k, y: 2, w: 15, h: 5 })));
      for (const o of plan.offices) {
        expect(o.door).toEqual({ x: o.rect.x + 14, y: 4 });
        expect(plan.blocked[o.door.y * plan.cols + o.door.x]).toBe(0);
        expect(plan.blocked[(o.door.y + 1) * plan.cols + o.door.x]).toBe(0);
        expect(plan.furniture.some((f) => f.kind === 'sign' && f.x === o.rect.x + 16)).toBe(true);
      }
      const printer = plan.furniture.find((f) => f.kind === 'printer')!;
      expect(printer.x).toBe(2 + 29 * n);
      for (let x = 1; x < plan.cols - 1; x++) expect(plan.blocked[7 * plan.cols + x]).toBe(0);
      expect(plan.spots.board.map((b) => b.x)).toEqual([19, 20, 21, 22, 23, 24]);
    }
  });

  test('rooms: 1 to 4 desk columns by steps of two desks, header strip, door in the bottom wall', () => {
    const small = layoutFloor(spec([1, 2, 3, 5]), COLS_MAX);
    const big = layoutFloor(spec([7, 8]), COLS_MAX);
    expect(small.rooms.map((r) => r.cols)).toEqual([1, 1, 2, 3]);
    expect(small.rooms.map((r) => r.desks.length)).toEqual([3, 3, 5, 7]);
    expect(big.rooms.map((r) => r.cols)).toEqual([4, 4]);
    expect(big.rooms.map((r) => r.desks.length)).toEqual([9, 9]);
    for (const plan of [small, big]) {
      checkPlan(plan);
      for (const r of plan.rooms) {
        expect(r.header.w).toBe((r.rect.w - 1) * CELL);
        expect(r.rect.y).toBe(8);
        expect(r.rect.h).toBe(25);
        expect(plan.blocked[r.door.y * plan.cols + r.door.x]).toBe(0);
        expect(r.door.y).toBe(32);
        expect(r.desks[0]!.id).toBe(`${r.key}#0`);
      }
    }
    expect(small.rooms.map((r) => r.rect.w)).toEqual([9, 9, 18, 26]);       // each rect ends where the next one starts
    for (let i = 1; i < small.rooms.length; i++) expect(small.rooms[i]!.rect.x).toBe(small.rooms[i - 1]!.rect.x + small.rooms[i - 1]!.rect.w);
  });

  test('desks: manager first, then agents in the order of the spec (oldest first); empty desks have no owner', () => {
    const s = spec([3]);
    s.rooms[0]!.managerId = 'boss';
    const plan = layoutFloor(s, COLS_MIN);
    expect(plan.rooms[0]!.cols).toBe(2);
    expect(plan.rooms[0]!.desks.map((d) => d.ownerId)).toEqual(['boss', 'a0-0', 'a0-1', 'a0-2', null]);
    expect(plan.offices[0]!.desk.ownerId).toBe('chef0');
    expect(plan.offices[0]).toMatchObject({ teamId: 't0', chefId: 'chef0', sign: 'Mission 0' });
  });

  test('seniority: a newcomer never moves anyone, even when the room grows', () => {
    const seats = (s: Spec) => new Map(layoutFloor(s, COLS_MAX).desks.filter((d) => d.ownerId).map((d) => [d.ownerId!, d.id]));
    let s = spec([1], 1);
    let before = seats(s);
    for (let n = 2; n <= 8; n++) {
      s = spec([n], 2);
      const after = seats(s);
      for (const [owner, desk] of before) expect(after.get(owner)).toBe(desk);
      before = after;
    }
  });

  test('a ninth agent of a manager takes a desk of the open space', () => {
    const plan = layoutFloor(spec([10], 2), COLS_MAX);
    expect(plan.rooms[0]!.cols).toBe(4);
    expect(plan.rooms[0]!.desks.map((d) => d.ownerId).filter(Boolean)).toHaveLength(9);
    expect(plan.open.desks.map((d) => d.ownerId).filter(Boolean)).toEqual(['o0', 'o1', 'a0-8', 'a0-9']);
    expect(plan.standing).toEqual([]);
    checkPlan(plan); checkReach(plan);
  });

  test('at COLS_MAX the agents without a desk stand in the open space (desk null), and the plate never grows', () => {
    const s = spec([8, 8, 8, 8], 30, 3);
    const everyone = [...s.offices.map((o) => o.chefId), ...s.rooms.flatMap((r) => [r.managerId, ...r.agentIds]), ...s.open];
    expect(buildingCols([s])).toBe(COLS_MAX);
    const plan = layoutFloor(s, 10_000);
    expect(plan.cols).toBe(COLS_MAX);
    const seated = plan.desks.map((d) => d.ownerId).filter((id): id is string => !!id);
    expect(new Set(seated).size).toBe(seated.length);
    expect(plan.standing.length).toBeGreaterThan(0);
    for (const id of plan.standing) expect(seated).not.toContain(id);
    // every agent of the spec is seated or standing, once
    expect([...seated, ...plan.standing].sort()).toEqual([...everyone].sort());
    checkPlan(plan); checkReach(plan);
  });

  test('too many rooms for COLS_MAX: rooms lose columns, then the last ones are dropped, nobody breaks the plan', () => {
    const s = spec(Array.from({ length: 14 }, () => 8), 0, 0);
    const plan = layoutFloor(s, COLS_MAX);
    expect(plan.cols).toBe(COLS_MAX);
    expect(plan.rooms.length).toBeLessThan(14);
    expect(plan.rooms.length).toBeGreaterThan(5);
    for (const r of plan.rooms) expect(r.cols).toBe(1);
    expect(plan.standing.length).toBeGreaterThan(0);
    checkPlan(plan); checkReach(plan);
  });

  test('a floor narrower than its need still fits its cols (offices are dropped to the open space)', () => {
    const s = spec([2], 0, 3);
    const plan = layoutFloor(s, COLS_MIN);
    expect(plan.offices).toHaveLength(1);
    expect(plan.desks.map((d) => d.ownerId)).toEqual(expect.arrayContaining(['chef0', 'a0-0']));
    expect(plan.open.desks.map((d) => d.ownerId)).toEqual(['chef1', 'chef2', null]);
    checkPlan(plan); checkReach(plan);
  });

  test('lights: one pool per desk (with its id), others for the fixed corners', () => {
    const plan = layoutFloor(boutiqueSpec(), COLS_MIN);
    const byDesk = plan.lights.filter((l) => l.desk);
    expect(byDesk.map((l) => l.desk).sort()).toEqual(plan.desks.map((d) => d.id).sort());
    expect(plan.lights.length).toBeGreaterThan(byDesk.length + 5);
    for (const l of plan.lights) { expect(l.r).toBeGreaterThan(0); expect(l.x).toBeGreaterThanOrEqual(0); expect(l.x).toBeLessThanOrEqual(plan.width); expect(l.y).toBeGreaterThanOrEqual(0); expect(l.y).toBeLessThanOrEqual(plan.height); }
  });

  test('the ground floor has the entry spot and a reception; other floors have no entry spot', () => {
    const rez = layoutFloor(spec([], 4, 0, ''), COLS_MIN);
    expect(rez.spots.entry).toHaveLength(1);
    expect(rez.furniture.some((f) => f.kind === 'recep')).toBe(true);
    expect(layoutFloor(boutiqueSpec(), COLS_MIN).spots.entry).toEqual([]);
  });

  test('a seated person is visited from the approach cell, which is the cell left of the desk', () => {
    const plan = layoutFloor(boutiqueSpec(), COLS_MIN);
    for (const d of plan.desks) {
      expect(d.approach.x).toBe(Math.floor(d.x / CELL) - 1);
      expect(d.seat.y).toBe(Math.floor(d.y / CELL) - 1);
      expect(d.seat.x).toBe(Math.floor((d.x + d.w / 2) / CELL));
    }
  });

  test('speed: the Boutique is laid out in 2 ms at most', () => {
    const s = boutiqueSpec();
    expect(s.rooms).toHaveLength(5);
    expect(s.rooms.reduce((n, r) => n + r.agentIds.length, 0)).toBe(7);
    for (let i = 0; i < 40; i++) layoutFloor(s, COLS_MIN);
    const times: number[] = [];
    for (let i = 0; i < 40; i++) { const t = performance.now(); layoutFloor(s, COLS_MIN); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    const median = times[20]!;
    console.log(`layoutFloor Boutique: median ${median.toFixed(3)} ms, worst ${times[39]!.toFixed(3)} ms`);
    expect(median).toBeLessThanOrEqual(2);
  });
});

describe('the building geometry', () => {
  test('buildingSize', () => {
    expect(buildingSize(5, 62)).toEqual({ w: 56 + 496 + 44, h: 80 + 5 * 368 + 24 });
    expect(buildingSize(5, 62)).toEqual({ w: 596, h: 1944 });
    expect(buildingSize(1, 96)).toEqual({ w: STAIRS_W + 768 + LIFT_W, h: SKY_H + BLOCK + GROUND_H });
  });
  test('floorTop: the ground floor is at the bottom, the top floor right under the sky', () => {
    expect(floorTop(4, 5)).toBe(SKY_H);
    expect(floorTop(3, 5)).toBe(SKY_H + BLOCK);
    expect(floorTop(0, 5)).toBe(SKY_H + 4 * BLOCK);
    expect(floorTop(0, 1)).toBe(SKY_H);
    expect(floorTop(0, 5) + BLOCK + GROUND_H).toBe(buildingSize(5, 62).h);
  });
  test('floorAtY: plate and slab belong to their floor, sky and ground to nobody', () => {
    expect(floorAtY(0, 5)).toBe(-1);
    expect(floorAtY(SKY_H - 1, 5)).toBe(-1);
    expect(floorAtY(SKY_H, 5)).toBe(4);
    expect(floorAtY(SKY_H + PLATE_H - 1, 5)).toBe(4);
    expect(floorAtY(SKY_H + PLATE_H, 5)).toBe(4);              // its slab
    expect(floorAtY(SKY_H + BLOCK - 1, 5)).toBe(4);
    expect(floorAtY(SKY_H + BLOCK, 5)).toBe(3);
    expect(floorAtY(floorTop(0, 5), 5)).toBe(0);
    expect(floorAtY(floorTop(0, 5) + BLOCK - 1, 5)).toBe(0);
    expect(floorAtY(floorTop(0, 5) + BLOCK, 5)).toBe(-1);      // the street
    expect(floorAtY(100, 0)).toBe(-1);
    for (let i = 0; i < 5; i++) expect(floorAtY(floorTop(i, 5) + 100, 5)).toBe(i);
  });
  test('floorScrollY: the slab above then the plate, centred in a taller view, 0 for the top floor', () => {
    expect(floorScrollY(4, 5, 376)).toBe(0);
    expect(floorScrollY(3, 5, BLOCK)).toBe(floorTop(3, 5) - SLAB);
    expect(floorScrollY(2, 5, 376)).toBe(floorTop(2, 5) - SLAB - 4);
    expect(floorScrollY(2, 5, 500)).toBe(floorTop(2, 5) - SLAB - 66);
    const s = (i: number, v: number) => floorScrollY(i, 5, v);
    for (let i = 0; i < 5; i++) {
      const y = s(i, 376);
      expect(Number.isInteger(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + 376).toBeLessThanOrEqual(buildingSize(5, 62).h);
    }
    expect(s(0, 376)).toBe(floorTop(0, 5) - SLAB - 4);
    expect(floorScrollY(0, 1, 800)).toBe(0);                       // the only floor is the top one
    expect(floorScrollY(0, 2, 2000)).toBe(0);                      // a view taller than the building
  });
  test('floorTitle', () => {
    expect(['Rez-de-chaussée', '1er étage', '2e étage', '3e étage', '12e étage']).toEqual([0, 1, 2, 3, 12].map(floorTitle));
  });
  test('stairPoints: ten flights, zig-zag, from the landing of a floor to the landing of the one above', () => {
    const pts = stairPoints(1, 5);
    expect(pts).toHaveLength(11);
    const landing = (i: number) => floorTop(i, 5) + layoutFloor(spec([]), COLS_MIN).landY;
    expect(pts[0]![1]).toBe(landing(1));
    expect(pts[10]![1]).toBe(landing(2));
    expect(pts[10]![0]).toBe(pts[0]![0]);
    for (let k = 1; k < pts.length; k++) {
      expect(pts[k]![1]!).toBeLessThan(pts[k - 1]![1]!);
      expect(pts[k]![0]).not.toBe(pts[k - 1]![0]);
    }
    for (const [x] of pts) { expect(x).toBeLessThan(0); expect(x).toBeGreaterThanOrEqual(-STAIRS_W); }
    expect(stairPoints(4, 5)).toEqual([]);                          // nothing above the top floor
    expect(stairPoints(0, 1)).toEqual([]);
  });
});

describe('findPath', () => {
  const plan = layoutFloor(boutiqueSpec(), COLS_MIN);
  const walk = (path: number[][], sx: number, sy: number) => {
    // every step is a straight run over free cells
    let x = sx, y = sy;
    for (const [px, py] of path) {
      expect(px === x || py === y).toBe(true);
      while (x !== px || y !== py) {
        x += Math.sign(px! - x); y += Math.sign(py! - y);
        expect(plan.blocked[y * plan.cols + x]).toBe(0);
      }
    }
  };

  test('same cell: empty path; outside the plate: null', () => {
    expect(findPath(plan, 1, 41, 1, 41)).toEqual([]);
    expect(findPath(plan, -1, 41, 5, 5)).toBeNull();
    expect(findPath(plan, 1, 41, plan.cols, 5)).toBeNull();
    expect(findPath(plan, 1, 41, 5, PLATE_ROWS)).toBeNull();
  });
  test('excludes the start, keeps the corners and the goal, crosses no wall', () => {
    const a = plan.spots.stairs[0]!, b = plan.spots.lift[0]!;
    const path = findPath(plan, a.x, a.y, b.x, b.y)!;
    expect(path.length).toBeGreaterThan(2);
    expect(path[0]).not.toEqual([a.x, a.y]);
    expect(path[path.length - 1]).toEqual([b.x, b.y]);
    walk(path, a.x, a.y);
  });
  test('a straight corridor is a single waypoint', () => {
    expect(findPath(plan, 3, 33, 40, 33)).toEqual([[40, 33]]);
  });
  test('may end on a blocked cell (a desk), never crosses one', () => {
    const d = plan.rooms[0]!.desks[1]!;
    const path = findPath(plan, 1, 41, Math.floor(d.x / CELL) + 1, Math.floor(d.y / CELL))!;
    expect(path).not.toBeNull();
    const last = path[path.length - 1]!;
    expect(plan.blocked[last[1]! * plan.cols + last[0]!]).toBe(1);
    const before = path.slice(0, -1);
    walk(before, 1, 41);

  });
  test('walled goal: null when no free cell touches the goal', () => {
    const wall = layoutFloor(spec([2]), COLS_MIN);
    expect(findPath(wall, 1, 41, 0, 0)).toBeNull();                  // the corner of the back wall: its neighbours are walls
  });
  test('round trip between the two landings', () => {
    const a = plan.spots.stairs[0]!, b = plan.spots.lift[0]!;
    const go = findPath(plan, a.x, a.y, b.x, b.y)!, back = findPath(plan, b.x, b.y, a.x, a.y)!;
    walk(back, b.x, b.y);
    const len = (p: number[][], sx: number, sy: number) => { let n = 0, x = sx, y = sy; for (const [px, py] of p) { n += Math.abs(px! - x) + Math.abs(py! - y); x = px!; y = py!; } return n; };
    expect(len(go, a.x, a.y)).toBe(len(back, b.x, b.y));
  });
  test('speed: 96 x 44 cells in 0.4 ms at most', () => {
    const wide = layoutFloor(spec([8, 8, 8, 8], 12, 3), COLS_MAX);
    expect(wide.cols * wide.rows).toBe(4224);
    const a = wide.spots.stairs[0]!, b = wide.spots.lift[0]!;
    const targets = [b, ...wide.desks.slice(0, 20).map((d) => d.seat)];
    const n = 300;
    for (let i = 0; i < 50; i++) findPath(wide, a.x, a.y, b.x, b.y);
    const t1 = performance.now();
    for (let i = 0; i < n; i++) { const g = targets[i % targets.length]!; findPath(wide, a.x, a.y, g.x, g.y); }
    const typical = (performance.now() - t1) / n;
    // worst case: the goal (a corner of the back wall) has no free neighbour, so the search visits every free cell of the plate
    expect(findPath(wide, a.x, a.y, 0, 0)).toBeNull();
    const t2 = performance.now();
    for (let i = 0; i < n; i++) findPath(wide, a.x, a.y, 0, 0);
    const full = (performance.now() - t2) / n;
    console.log(`findPath 96x44: typical ${typical.toFixed(3)} ms, full-plate search ${full.toFixed(3)} ms`);
    expect(typical).toBeLessThanOrEqual(0.4);
    expect(full).toBeLessThanOrEqual(0.4);
  });
});

describe('freeCellNear', () => {
  const plan = layoutFloor(boutiqueSpec(), COLS_MIN);
  test('a free cell is its own answer', () => {
    expect(freeCellNear(plan, 1, 41)).toEqual([1, 41]);
  });
  test('a blocked cell gives the nearest free one, reachable from the landing', () => {
    const d = plan.rooms[0]!.desks[1]!;
    const cx = Math.floor(d.x / CELL) + 2, cy = Math.floor(d.y / CELL);
    const [x, y] = freeCellNear(plan, cx, cy);
    expect(plan.blocked[y! * plan.cols + x!]).toBe(0);
    expect(Math.abs(x! - cx) + Math.abs(y! - cy)).toBeLessThanOrEqual(3);
    expect(findPath(plan, 1, 41, x!, y!)).not.toBeNull();
  });
  test('the answer is deterministic and beats every other free cell in distance', () => {
    const cx = 20, cy = 33;
    for (const [px, py] of [[5, 0], [30, 34], [50, 36], [70, 10], [0, 20], [60, 42]] as const) {
      const [x, y] = freeCellNear(plan, px, py);
      expect(freeCellNear(plan, px, py)).toEqual([x!, y!]);
      const d = (X: number, Y: number) => (X - px) ** 2 + (Y - py) ** 2;
      for (let j = 0; j < plan.rows; j++) for (let i = 0; i < plan.cols; i++) if (!plan.blocked[j * plan.cols + i]) expect(d(i, j)).toBeGreaterThanOrEqual(d(x!, y!));
    }
    expect(cx + cy).toBe(53);
  });
  test('out of range cells are clamped', () => {
    const [x, y] = freeCellNear(plan, -9, 500);
    expect(plan.blocked[y! * plan.cols + x!]).toBe(0);
  });
});

describe('floor.js (L3 phase 2): hygiene that needs no browser', () => {
  const floorSource = readFileSync(join(import.meta.dir, '..', 'web', 'pixel', 'floor.js'), 'utf8');
  const FLOOR_PUBLIC = [
    'FLOORS', 'floorCam', 'LIFT', 'syncFloors', 'floorById', 'floorOfPerson', 'floorFurniture', 'floorDrawables', 'drawFloorStatic', 'openDoor',
    'liftStopY', 'tickFloors', 'setFloorTiers', 'floorToScreen', 'renderBuilding', 'drawFloorLabels', 'finishFloor', 'floorGone',
  ];
  test('every top-level name is public (2.4) or wears the prefix flr, and every public name is declared', () => {
    const names = topLevelNames(floorSource);
    for (const name of names) expect(FLOOR_PUBLIC.includes(name) || name.startsWith('flr')).toBe(true);
    for (const name of FLOOR_PUBLIC) expect(names).toContain(name);
  });
  test('no name is shared with floorplan.js', () => {
    const mine = new Set(topLevelNames(source));
    for (const name of topLevelNames(floorSource)) expect(mine.has(name)).toBe(false);
  });
  test('no dash, no emoji, LF only, nothing remote, nothing runs at load', () => {
    expect(/[–—]/.test(floorSource)).toBe(false);
    expect(/[\u{1F000}-\u{1FFFF}]/u.test(floorSource)).toBe(false);
    expect(floorSource.includes('\r')).toBe(false);
    expect(/https?:\/\//.test(floorSource)).toBe(false);
    const code = floorSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const line of code.split('\n')) expect(/^(?:[a-zA-Z_$][\w$.]*\(|for\b|if\b|while\b)/.test(line)).toBe(false);
  });
});
