/*
 * People of the pixel view: one Person per thread, kept in step with the OfficeState (syncPeople), moved by
 * generators (life of the office from actions.js, trips through the stair and lift towers), drawn with the
 * sheets of sprites.js. Lot L4, docs/vue-pixel.md 2.5. Shares one scope with the other web/pixel files: the
 * public names are those of the 2.5 block (PEOPLE, ACT_KINDS, syncPeople, setPersonState, tickPeople,
 * personById, peopleOnFloor, peopleInTowers, personAt, towerPersonAt, peopleDrawables, setWaitFilter,
 * setSelected, personAssign, personCancel, personWalkTo, personStepTo, personFaceTo, personVisitCell,
 * personTravel, personRideLift, personRideStairs) plus `personArrive` (talk.js, see its comment), `pplDraw` and `pplWaitFilter`, agreed with floor.js,
 * which draws the people of the towers and the waiting ones again under the dark veil of the wait filter.
 * Everything else here is prefixed `ppl`. Declares only, nothing runs at load.
 *
 * Units. x, y: feet in plan px of person.floor; cx, cy: the cell of the last waypoint. In a tower (tz set,
 * visible false) wx is the plan x and wy the world y of the feet. A person at a desk has its feet at
 * (desk.x + 20, desk.y + 4); on a sofa or a bench at (spot.px, spot.py).
 *
 * Time. A behaviour is a generator; the driver passes the seconds that passed to next(), which `yield`
 * returns inside (tier 2 floors are stepped four times a second with the time they missed). A person on a
 * trip (p.trip > 0) is never interrupted: a change of state sets p.dirty and is applied when the trip ends.
 */

const PEOPLE = [];

const ACT_KINDS = ['type', 'wait', 'bench', 'coffee', 'smoke', 'fountain', 'printer', 'board', 'micro', 'plants', 'stretch', 'window', 'phone', 'sleep', 'rail', 'read', 'sofa', 'chat', 'deliver', 'lift', 'stairs', 'walk'];

const pplById = new Map();
const pplSeen = new Set();
const pplOnFloorList = [];
const pplTowerList = [];
const pplDrawList = [];
const pplDeskIndexes = new WeakMap(); // FloorPlan -> Map(ownerId -> Desk)
let pplWaitFilter = false;
let pplSelected = null;
let pplFlip = false;
let pplFailures = 0;
const pplStats = { noPath: 0, errors: 0 };

const pplSpeed = 26;           // px per second on the plate
const pplLiftIn = 22;          // default x of the cab centre, from the plate width
const pplLiftSpeed = 105;      // px per second of the cab

function pplHour() {
  return typeof sceneHour === 'function' ? sceneHour() : 12;
}

/* ------------------------------------------ sync ------------------------------------------ */

function pplMake(info, targetId) {
  const p = {
    id: info.id, info, state: info.state, role: info.role, targetId,
    floor: null, desk: null, plan: null, stand: null,
    x: 0, y: 0, cx: 0, cy: 0, dir: 'down', tz: null, wx: 0, wy: 0,
    pose: 'stand', act: null, prop: null, icon: null,
    seated: false, seatId: null, present: false, visible: false, alpha: 1, alphaT: 1, leaving: false, conv: null,
    look: lookFor(info.id, info.role),
    co: null, res: [], t: rnd(0, 5), acc: 0, nod: 0, trip: 0, dirty: false,
    arrival: false, arriving: false, deliverPending: false, gone: false, faults: 0,
    sheet: null, sheetV: undefined, dr: null,
  };
  p.dr = { sy: 0, draw: (g, T) => pplDraw(g, p, p.x, p.y, T) };
  return p;
}

function pplDeskIndex(plan) {
  let m = pplDeskIndexes.get(plan);
  if (!m) {
    m = new Map();
    for (const d of plan.desks) if (d.ownerId) m.set(d.ownerId, d);
    pplDeskIndexes.set(plan, m);
  }
  return m;
}

/** The floor a person works on: the one of its project, else the ground floor. */
function pplTarget(p) {
  return floorById(p.targetId) || FLOORS[0] || null;
}

function pplHomeIndex(p) {
  const f = floorById(p.targetId);
  return f ? f.index : -1;
}

/** Looks for the desk (or the standing place) of p on its current floor, when that floor is its own. */
function pplBindDesk(p) {
  const fl = p.floor;
  p.desk = null;
  if (!fl) return;
  if (fl.id !== p.targetId) return;
  p.desk = pplDeskIndex(fl.plan).get(p.id) || null;
}

/** A deterministic standing place in the open space, for the agents the plate has no desk for. */
function pplStandCell(p) {
  const plan = p.floor.plan;
  if (p.stand && p.stand.plan === plan) return p.stand;
  const r = plan.open.rect;
  const h = hash(p.id);
  const c = r.w > 0 ? freeCellNear(plan, r.x + (h % r.w), r.y + ((h >>> 8) % r.h)) : freeCellNear(plan, 30, 20);
  p.stand = { plan, x: c[0], y: c[1] };
  return p.stand;
}

/** Puts a person on a floor without any walking: seated at its desk, or standing. */
function pplPlace(p, fl) {
  p.floor = fl;
  p.plan = fl.plan;
  p.present = true;
  p.visible = true;
  p.alpha = p.alphaT = 1;
  pplBindDesk(p);
  const d = p.desk;
  if (d) {
    p.x = d.x + 20; p.y = d.y + 4; p.cx = d.seat.x; p.cy = d.seat.y;
    p.dir = d.facing || 'down'; p.seated = true; p.seatId = d.id; p.pose = 'sit';
  } else {
    const c = pplStandCell(p);
    p.cx = c.x; p.cy = c.y; p.x = c.x * CELL + 4; p.y = c.y * CELL + 7;
    p.dir = 'down'; p.seated = false; p.pose = 'stand';
  }
}

function pplSpawn(info, targetId, animate) {
  const p = pplMake(info, targetId);
  PEOPLE.push(p);
  pplById.set(p.id, p);
  const ground = FLOORS[0];
  const own = floorById(targetId) || ground;
  if (animate && ground) {
    p.floor = ground;
    p.plan = ground.plan;
    p.arrival = true;
    p.present = false;
    p.visible = false;
    p.alpha = p.alphaT = 0;
    p.dir = 'up';
  } else if (own) {
    pplPlace(p, own);
  }
  return p;
}

/** Stops the current behaviour unless the person is on a trip, in a talk or arriving (their own flow ends first). */
function pplRestart(p) {
  if (p.trip > 0 || p.arriving || p.conv || p.leaving) { p.dirty = true; return; }
  personCancel(p);
}

/**
 * The state of a thread changed (or its role): the table of 2.5 applies at the next life step. A person
 * who just became `done` carries the folder to the manager first.
 */
function setPersonState(p, info) {
  const old = p.state;
  p.info = info;
  if (info.role !== p.role) { p.role = info.role; p.look = lookFor(p.id, info.role); p.sheet = null; }
  if (info.state === old) return;
  p.state = info.state;
  if (info.state === 'done') p.deliverPending = true;
  else p.deliverPending = false;
  pplRestart(p);
}

/** The person left the state: out by the lift and the front door. */
function pplDepart(p, animate) {
  if (!animate && !p.trip) { pplRemove(p); return; }
  p.leaving = true;
  p.deliverPending = false;
  pplRestart(p);
}

function pplRemove(p) {
  p.gone = true;
  p.present = false;
  p.visible = false;
  if (p.co) { try { p.co.return(); } catch (e) { /* running generator */ } p.co = null; }
  actRelease(p);
  if (LIFT.owner === p) { LIFT.owner = null; LIFT.want = 0; }
  p.tz = null;
}

/**
 * Brings the people in line with an OfficeState (after syncFloors). `animate` false (the first state): everybody
 * is placed at once; true: newcomers walk in by the front door and take the lift or the stairs, the ones who left
 * walk out, a change of project is a ride in the lift.
 */
function syncPeople(office, animate) {
  pplSeen.clear();
  const teams = (office && office.teams) || [];
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const target = team.projectId == null ? '' : team.projectId;
    for (let k = 0; k < team.agents.length; k++) {
      const a = team.agents[k];
      pplSeen.add(a.id);
      let p = pplById.get(a.id);
      if (!p) { pplSpawn(a, target, !!animate); continue; }
      if (p.leaving && !p.gone) { p.leaving = false; pplRestart(p); }
      if (target !== p.targetId) {
        p.targetId = target;
        pplBindDesk(p);
        pplRestart(p);
      } else if (p.floor && !p.tz) {
        const had = p.desk ? p.desk.id : null;
        pplBindDesk(p);
        const now = p.desk ? p.desk.id : null;
        if (had !== now && p.seated && !p.trip && !p.conv) { p.seated = false; pplRestart(p); }
      }
      setPersonState(p, a);
    }
  }
  for (let i = PEOPLE.length - 1; i >= 0; i--) {
    const p = PEOPLE[i];
    if (!pplSeen.has(p.id) && !p.leaving && !p.gone) pplDepart(p, !!animate);
  }
  for (let i = PEOPLE.length - 1; i >= 0; i--) {
    if (PEOPLE[i].gone) { pplById.delete(PEOPLE[i].id); PEOPLE.splice(i, 1); }
  }
}

/* ------------------------------------------ queries ------------------------------------------ */

function personById(id) {
  return pplById.get(id) || null;
}

function peopleOnFloor(fl) {
  pplOnFloorList.length = 0;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (p.floor === fl && p.present && !p.tz) pplOnFloorList.push(p);
  }
  return pplOnFloorList;
}

function peopleInTowers() {
  const list = pplTowerList;
  list.length = 0;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (p.tz && p.present) {
      let j = list.length;
      list.push(p);
      while (j > 0 && list[j - 1].wy > p.wy) { list[j] = list[j - 1]; j--; }
      list[j] = p;
    }
  }
  return list;
}

/** Topmost visible person whose body (12 x 20 around the feet) holds the point, plan px of floor fl. */
function personAt(fl, px, py) {
  let best = null;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (p.floor !== fl || !p.visible || !p.present || p.tz) continue;
    if (Math.abs(px - p.x) <= 6 && py >= p.y - 19 && py <= p.y + 1 && (!best || p.y > best.y)) best = p;
  }
  return best;
}

/** The same in tower coordinates: plan x and world y. */
function towerPersonAt(wx, wy) {
  let best = null;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (!p.tz || !p.present) continue;
    if (Math.abs(wx - p.wx) <= 6 && wy >= p.wy - 19 && wy <= p.wy + 1 && (!best || p.wy > best.wy)) best = p;
  }
  return best;
}

function setWaitFilter(on) {
  pplWaitFilter = !!on;
}

function setSelected(id) {
  pplSelected = id || null;
}

/* ------------------------------------------ drawing ------------------------------------------ */

function pplSheet(p) {
  const s = p.info.state;
  const v = s === 'waiting' ? 'amber' : s === 'error' ? 'red' : s === 'done' ? 'done' : null;
  if (!p.sheet || p.sheetV !== v) { p.sheet = bakeSheet(p.look, v); p.sheetV = v; }
  return p.sheet;
}

/** Frame of the sheet for the pose and direction; sets pplFlip. Seated frames: the view follows `dir` ('up' is from behind). */
function pplFrame(p) {
  const dir = p.dir;
  const back = dir === 'up';
  const base = back ? FRAME.up : dir === 'down' ? FRAME.down : FRAME.side;
  pplFlip = dir === 'left';
  switch (p.pose) {
    case 'walk': return base + 1 + (((p.t * 9) | 0) % 4);
    case 'sit': pplFlip = false; return p.seated && back ? FRAME.sitUp : FRAME.sit;
    case 'type': {
      if (!p.seated) return base;
      pplFlip = false;
      return (back ? FRAME.typeUp0 : FRAME.type0) + (((p.t * 8) | 0) & 1);
    }
    case 'hand': pplFlip = false; return (back ? FRAME.handUp0 : FRAME.hand0) + (((p.t * 3) | 0) & 1);
    case 'hold': return dir === 'down' ? FRAME.hold : base;
    case 'str': pplFlip = false; return FRAME.str0 + (((p.t * 1.2) | 0) & 1);
    case 'read': return dir === 'down' ? FRAME.read : base;
    case 'sleep': pplFlip = false; return back ? FRAME.sitUp : FRAME.sleep;
    default: return base;
  }
}

function pplRing(g, x, y) {
  const c = 'lampHi';
  rect(g, x - 4, y - 3, 9, 1, c); rect(g, x - 6, y - 2, 2, 1, c); rect(g, x + 5, y - 2, 2, 1, c);
  rect(g, x - 7, y - 1, 1, 2, c); rect(g, x + 7, y - 1, 1, 2, c);
  rect(g, x - 6, y + 1, 2, 1, c); rect(g, x + 5, y + 1, 2, 1, c); rect(g, x - 4, y + 2, 9, 1, c);
}

function pplProp(g, p, x, y, T) {
  const name = p.prop;
  if (!name) return;
  const hold = p.pose === 'hold';
  const left = p.dir === 'left';
  const hx = hold ? 5 : 4;
  const hy = y - (hold ? 14 : 9);
  if (name === 'cigarette') {
    const tip = ((T * 3) | 0) % 2 ? 'red' : 'lamp';
    if (left) { rect(g, x - 7, y - 14, 4, 1, 'white'); rect(g, x - 8, y - 14, 1, 1, tip); }
    else { rect(g, x + 4, y - 14, 4, 1, 'white'); rect(g, x + 8, y - 14, 1, 1, tip); }
    return;
  }
  const img = PROPS[name];
  if (!img) return;
  const w = img.width;
  let px = left ? x - hx - w + 1 : x + hx;
  let py = hy;
  switch (name) {
    case 'paper': px = x - 4; py = y - 10; break;
    case 'book': px = x - 3; py = y - 10; break;
    case 'folder': px = x - 3; py = y - 11; break;
    case 'phone': px = left ? x - 5 : x + 3; py = y - 9; break;
    case 'bowl': px -= 2; py += 1; break;
    case 'can': px -= 1; break;
    case 'glass': py -= 1; break;
    case 'cup': break;
    case 'marker': px = left ? x - 7 : x + 6; py = y - 13; break;
    default: break;
  }
  g.drawImage(img, px, py);
}

/**
 * Draws a person with the feet at (x, y) in the current space of g: the plan of its floor for the people of a
 * floor, tower coordinates for the people of a tower. Shadow, selection ring, frame, prop; no icon or bubble.
 */
function pplDraw(g, p, x, y, T) {
  const sheet = pplSheet(p);
  const frame = pplFrame(p);
  const flip = pplFlip;
  const sx = Math.round(x);
  const sy = Math.round(y) + (p.nod > 0 && ((p.nod * 10) | 0) % 2 ? 1 : 0);
  const fade = p.alpha < 1;
  if (fade) g.globalAlpha = p.alpha > 0 ? p.alpha : 0;
  if (pplSelected === p.id) pplRing(g, sx, sy);
  if (!(p.seated || p.pose === 'sit' || p.pose === 'sleep')) {
    rect(g, sx - 4, sy - 1, 9, 2, 'ink');
    rect(g, sx - 2, sy + 1, 5, 1, 'ink');
  }
  drawSprite(g, sheet, frame, sx, sy, flip);
  pplProp(g, p, sx, sy, T);
  if (fade) g.globalAlpha = 1;
}

/** The people of a floor as sortable drawables (sy = feet), in a reused array. Nobody in a tower, nobody not yet in. */
function peopleDrawables(fl) {
  const list = pplDrawList;
  list.length = 0;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (p.floor !== fl || !p.visible || !p.present || p.tz) continue;
    p.dr.sy = p.y;
    list.push(p.dr);
  }
  return list;
}

/* ------------------------------------------ movement ------------------------------------------ */

/** Walks in a straight line to plan px (x, y) at `speed` px/s. */
function* personStepTo(p, x, y, speed) {
  const sp = speed || pplSpeed;
  if (REDUCED) { p.x = x; p.y = y; return; }
  p.pose = 'walk';
  let dt = 0.016;
  for (;;) {
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.hypot(dx, dy);
    const st = sp * dt;
    if (d <= st) { p.x = x; p.y = y; break; }
    p.x += (dx / d) * st;
    p.y += (dy / d) * st;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    dt = (yield) || 0.016;
  }
  p.pose = 'stand';
}

/** Walks to cell (cx, cy) by findPath: walls and desks respected. Leaves the seat first. */
function* personWalkTo(p, cx, cy) {
  const plan = p.floor.plan;
  const sx = p.cx * CELL + 4;
  const sy = p.cy * CELL + 7;
  if (Math.abs(p.x - sx) + Math.abs(p.y - sy) > 1.5) yield* personStepTo(p, sx, sy, 24);
  const path = findPath(plan, p.cx, p.cy, cx, cy);
  if (!path) {
    pplStats.noPath++;
    p.seated = false;
    p.cx = cx; p.cy = cy; p.x = cx * CELL + 4; p.y = cy * CELL + 7;
    p.pose = 'stand';
    return;
  }
  if (path.length) p.seated = false;
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    yield* personStepTo(p, c[0] * CELL + 4, c[1] * CELL + 7);
    p.cx = c[0];
    p.cy = c[1];
  }
  p.pose = 'stand';
}

/** Turns p towards another person (a seated person keeps facing their screen). */
function personFaceTo(p, other) {
  if (p.seated) { p.dir = p.desk && p.seatId ? p.desk.facing || 'down' : 'down'; return; }
  const dx = other.x - p.x;
  const dy = other.y - p.y;
  p.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

/** Where someone stands to talk to p: beside the desk of a seated person, else on a free cell next to them. */
function personVisitCell(p) {
  const plan = p.floor.plan;
  const free = (x, y) => x > 0 && y > 0 && x < plan.cols - 1 && y < plan.rows && !plan.blocked[y * plan.cols + x];
  if (p.seated && p.desk && p.seatId === p.desk.id) {
    const a = p.desk.approach;
    if (free(a.x, a.y)) return { x: a.x, y: a.y, f: 'right' };
  }
  const options = [[0, 1, 'up'], [-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down']];
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (free(p.cx + o[0], p.cy + o[1])) return { x: p.cx + o[0], y: p.cy + o[1], f: o[2] };
  }
  const c = freeCellNear(plan, p.cx, p.cy);
  return { x: c[0], y: c[1], f: 'up' };
}

/** Runs a generator with act = kind while nothing more specific is set (plain walking between two activities). */
function* pplAs(p, kind, gen) {
  const prev = p.act;
  if (prev === null) p.act = kind;
  try {
    yield* gen;
  } finally {
    if (p.act === kind) p.act = prev;
  }
}

/** Walks to the desk and sits, facing the way the desk says. Without a desk, goes to a standing place. */
function* pplGoSeat(p) {
  yield* pplAs(p, 'walk', pplGoSeatBody(p));
}

function* pplGoSeatBody(p) {
  const d = p.desk;
  if (!d) {
    const c = pplStandCell(p);
    yield* personWalkTo(p, c.x, c.y);
    p.dir = 'down';
    return;
  }
  if (p.seated && p.seatId === d.id) return;
  yield* personWalkTo(p, d.seat.x, d.seat.y);
  yield* personStepTo(p, d.x + 20, d.y + 4, 24);
  p.cx = d.seat.x;
  p.cy = d.seat.y;
  p.dir = d.facing || 'down';
  p.seated = true;
  p.seatId = d.id;
  p.pose = 'sit';
}

/* ------------------------------------------ towers ------------------------------------------ */

function pplEase(k) {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

/** World y of the feet on the landing of a floor. */
function pplLandingY(fl) {
  return floorTop(fl.index, FLOORS.length) + fl.plan.landY;
}

/** Walks in tower coordinates (wx, wy) at `speed`; `side` keeps the profile views (stairs). */
function* pplStepW(p, x, y, speed, side) {
  const sp = speed || pplSpeed;
  if (REDUCED) { p.wx = x; p.wy = y; return; }
  p.pose = 'walk';
  let dt = 0.016;
  for (;;) {
    const dx = x - p.wx;
    const dy = y - p.wy;
    const d = Math.hypot(dx, dy);
    const st = sp * dt;
    if (d <= st) { p.wx = x; p.wy = y; break; }
    p.wx += (dx / d) * st;
    p.wy += (dy / d) * st;
    p.dir = side ? (dx > 0 ? 'right' : 'left') : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    dt = (yield) || 0.016;
  }
  p.pose = 'stand';
}

function pplEnterTower(p, kind) {
  p.tz = kind;
  p.visible = false;
  p.wx = p.x;
  p.wy = pplLandingY(p.floor);
}

function pplLeaveTower(p, fl, x) {
  p.floor = fl;
  p.plan = fl.plan;
  p.tz = null;
  p.x = x;
  p.y = fl.plan.landY;
  p.cx = x < 0 ? 0 : fl.plan.cols - 1;
  p.cy = (fl.plan.landY / CELL) | 0;
  p.visible = true;
}

function* pplLiftOpen() {
  LIFT.want = 1;
  let guard = 0;
  while (LIFT.door < 0.98 && guard < 3) guard += (yield) || 0.016;
}

function* pplLiftClose() {
  LIFT.want = 0;
  let guard = 0;
  while (LIFT.door > 0.02 && guard < 3) guard += (yield) || 0.016;
}

function* pplLiftMove(i, rider) {
  if (LIFT.fl === i && !LIFT.moving) return;
  yield* pplLiftClose();
  LIFT.moving = true;
  const y0 = LIFT.y;
  const y1 = liftStopY(i);
  const total = REDUCED ? 0.05 : Math.max(1, Math.abs(y1 - y0) / pplLiftSpeed);
  LIFT.dir = y1 < y0 ? -1 : 1;
  let t = 0;
  while (t < total) {
    t += (yield) || 0.016;
    LIFT.y = y0 + (y1 - y0) * pplEase(Math.min(1, t / total));
    if (rider) rider.wy = LIFT.y;
  }
  LIFT.y = y1;
  if (rider) rider.wy = y1;
  LIFT.fl = i;
  LIFT.moving = false;
  LIFT.dir = 0;
}

/**
 * Rides the lift to floor toIndex: waits for its turn on the landing (one rider at a time), calls the cab, steps in,
 * rides, steps out onto the landing of the destination floor. act is 'lift' during the ride.
 */
function* personRideLift(p, toIndex) {
  const from = p.floor.index;
  const dest = FLOORS[toIndex];
  if (from === toIndex || !dest) return;
  const s = p.floor.plan.spots.lift[0];
  if (!s) return;
  const prev = p.act;
  p.act = 'lift';
  try {
    yield* personWalkTo(p, s.x, s.y);
    p.dir = 'right';
    p.pose = 'stand';
    while (LIFT.owner && LIFT.owner !== p) yield;
    LIFT.owner = p;
    if (LIFT.fl !== from || LIFT.moving) yield* pplLiftMove(from, null);
    yield* pplLiftOpen();
    const plan = p.floor.plan;
    const cabX = LIFT.x !== undefined ? LIFT.x : plan.width + pplLiftIn;
    yield* personStepTo(p, plan.width + 2, plan.landY, 26);
    pplEnterTower(p, 'lift');
    yield* pplStepW(p, cabX, p.wy, 26);
    p.dir = 'down';
    p.pose = 'stand';
    yield* actWait(0.35);
    yield* pplLiftMove(toIndex, p);
    yield* pplLiftOpen();
    yield* actWait(0.25);
    p.dir = 'left';
    yield* pplStepW(p, dest.plan.width + 2, pplLandingY(dest), 26);
    pplLeaveTower(p, dest, dest.plan.width + 2);
    const out = dest.plan.spots.lift[0];
    yield* personStepTo(p, out.x * CELL + 4, dest.plan.landY, 26);
    p.cx = out.x;
    p.cy = out.y;
  } finally {
    if (LIFT.owner === p) { LIFT.owner = null; LIFT.want = 0; }
    p.act = prev;
  }
}

/**
 * Climbs or descends the stair tower flight by flight, one floor at a time, and comes out on the landing of
 * floor toIndex. act is 'stairs' on the way.
 */
function* personRideStairs(p, toIndex) {
  const from = p.floor.index;
  const n = FLOORS.length;
  if (from === toIndex || !FLOORS[toIndex]) return;
  const s = p.floor.plan.spots.stairs[0];
  if (!s) return;
  yield* personWalkTo(p, s.x, s.y);
  p.dir = 'left';
  yield* personStepTo(p, -4, p.floor.plan.landY, 26);
  const prev = p.act;
  try {
    p.act = 'stairs';
    pplEnterTower(p, 'stairs');
    yield* pplStepW(p, -6, p.wy, 26, true);
    const up = toIndex > from;
    let lv = from;
    while (lv !== toIndex) {
      const pts = stairPoints(up ? lv : lv - 1, n);
      if (!pts.length) break;
      if (!up) pts.reverse();
      for (let k = 0; k < pts.length; k++) yield* pplStepW(p, pts[k][0], pts[k][1], 34, true);
      lv += up ? 1 : -1;
    }
    const dest = FLOORS[lv];
    yield* pplStepW(p, -6, pplLandingY(dest), 26, true);
    pplLeaveTower(p, dest, -6);
    const out = dest.plan.spots.stairs[0];
    yield* personStepTo(p, out.x * CELL + 4, dest.plan.landY, 26);
    p.cx = out.x;
    p.cy = out.y;
  } finally {
    p.act = prev;
  }
}

/**
 * Goes to floor toIndex: to the landing, through the wall to the tower, the ride, out onto the landing. `how`:
 * 'lift' | 'stairs' | null (null: the stairs half of the time for one floor, else the lift). A trip is never
 * interrupted (p.trip).
 */
function* personTravel(p, toIndex, how) {
  p.trip++;
  try {
    for (let guard = 0; p.floor.index !== toIndex && guard < 6; guard++) {
      const d = toIndex - p.floor.index;
      const stairs = how === 'stairs' || (how !== 'lift' && Math.abs(d) === 1 && rnd(0, 1) < 0.5);
      if (stairs) yield* personRideStairs(p, toIndex);
      else yield* personRideLift(p, toIndex);
    }
  } finally {
    p.trip--;
  }
}

/* ------------------------------------------ behaviours ------------------------------------------ */

/**
 * Cancels the current behaviour: spots and prop released (the generator's finally blocks run), the person stays
 * where they are. Nothing happens during a trip.
 */
function personCancel(p) {
  if (p.trip > 0) return;
  if (p.co) {
    try { p.co.return(); } catch (e) { /* the generator is running: it ends by itself */ }
    p.co = null;
  }
  actRelease(p);
  p.prop = null;
  p.icon = null;
  p.act = null;
  p.pose = p.seated ? 'sit' : 'stand';
}

/** Runs `gen` (a generator object, or a function taking the person) instead of the current behaviour. False during a trip. */
function personAssign(p, gen) {
  if (p.trip > 0) return false;
  personCancel(p);
  p.deliverPending = false;
  p.co = typeof gen === 'function' ? gen(p) : gen;
  return true;
}

/**
 * Walks a newcomer in: appears at the front door of the ground floor (fading in, the door opens) and steps to the
 * entry Spot. To be used with `yield*`, like personTravel. It clears `p.arrival`, sets `p.arriving` for its whole
 * length (so a change of state, a relayout or a tier 2 floor never cuts it) and shows act 'walk'. Without talk.js,
 * pplLife calls it first thing for a person with `p.arrival`, then goes on to the target floor and the state table
 * of 2.5. When talk.js takes the arrival over (an 'arrive' conversation), it assigns its own generator with
 * personAssign, which calls `yield* personArrive(p)` at the right moment: pplLife is then not running, and starts
 * again, with `p.arrival` already false, once that generator ends (the person then travels to their floor as
 * usual). A person with `p.arrival` still set and no generator is simply not yet in the building (present false).
 */
function* personArrive(p) {
  p.arrival = false;
  yield* pplAs(p, 'walk', pplArrive(p));
}

function* pplArrive(p) {
  const fl = p.floor;
  const plan = fl.plan;
  const d = plan.door;
  const s = plan.spots.entry[0];
  p.arriving = true;
  try {
    p.present = true;
    p.visible = false;
    p.seated = false;
    p.dir = 'up';
    p.pose = 'stand';
    p.x = d.x + 16;
    p.y = d.y + 9;
    p.cx = (p.x / CELL) | 0;
    p.cy = (plan.landY / CELL) | 0;
    if (typeof openDoor === 'function') openDoor(fl, 'entry', 2.5);
    yield* actWait(rnd(0.2, 0.8));
    p.visible = true;
    p.alphaT = 1;
    yield* personStepTo(p, s.x * CELL + 4, plan.landY, 24);
    p.cx = s.x;
    p.cy = s.y;
  } finally {
    p.arriving = false;
  }
}

function* pplLeave(p) {
  p.desk = null;
  p.seated = false;
  p.seatId = null;
  if (p.floor.index !== 0) yield* personTravel(p, 0, 'lift');
  const fl = p.floor;
  const plan = fl.plan;
  const s = plan.spots.entry[0];
  const d = plan.door;
  if (s && d) {
    yield* personWalkTo(p, s.x, s.y);
    p.dir = 'down';
    if (typeof openDoor === 'function') openDoor(fl, 'entry', 2.5);
    yield* personStepTo(p, d.x + 16, d.y + 9, 24);
    p.alphaT = 0;
    yield* actWait(0.4);
  }
  pplRemove(p);
}

function* pplQueued(p) {
  p.icon = 'hourglass';
  p.act = 'wait';
  p.pose = 'sit';
  for (;;) yield;
}

/** A break: one action drawn by pickAction, then a pause; now and then back to the desk. */
function* pplBreak(p) {
  yield* ACTIONS[pickAction(p, pplHour())](p);
  yield* actWait(rnd(0.8, 3));
  if (!p.seated && p.desk && rnd(0, 1) < 0.25) yield* pplGoSeat(p);
}

/** The life of a person: what the state table of 2.5 says, from arrival to departure. Restarted after any cancel. */
function* pplLife(p) {
  if (p.arrival) yield* personArrive(p);
  if (p.leaving) { yield* pplAs(p, 'walk', pplLeave(p)); return; }
  p.icon = null;
  let tf = pplTarget(p);
  while (tf && tf !== p.floor && tf.p !== undefined && tf.p < 1) {
    yield* ACTIONS.window(p);
    yield* actWait(1);
    tf = pplTarget(p);
  }
  if (tf && tf !== p.floor) {
    yield* pplAs(p, 'walk', personTravel(p, tf.index, null));
    if (p.leaving) return;
  }
  pplBindDesk(p);
  switch (p.info.state) {
    case 'running':
      yield* pplGoSeat(p);
      yield* ACTIONS.type(p);
      return;
    case 'waiting':
    case 'error':
      yield* pplGoSeat(p);
      yield* ACTIONS.wait(p);
      return;
    case 'queued':
      if (!p.seated) yield* ACTIONS.bench(p);
      yield* pplGoSeat(p);
      yield* pplQueued(p);
      return;
    default:
      break;
  }
  if (p.info.state === 'done' && p.deliverPending) {
    p.deliverPending = false;
    yield* actWait(rnd(1, 4));
    yield* ACTIONS.deliver(p);
  }
  if (!p.seated && rnd(0, 1) < 0.3) yield* pplGoSeat(p);
  for (;;) {
    yield* pplBreak(p);
    if (p.dirty) { p.dirty = false; return; }
  }
}

function* pplIdleForever() {
  for (;;) yield;
}

/* ------------------------------------------ the tick ------------------------------------------ */

/** The plan of the floor changed (a wider building): desks keep their owner, the others go to the nearest free cell. */
function pplRelayout(p) {
  const plan = p.floor.plan;
  const had = p.plan;
  p.plan = plan;
  if (!had || had === plan || p.tz) return;
  const old = p.desk ? p.desk.id : null;
  pplBindDesk(p);
  if (p.trip > 0) return;
  if (p.seated && p.desk && p.desk.id === old) {
    const d = p.desk;
    p.x = d.x + 20; p.y = d.y + 4; p.cx = d.seat.x; p.cy = d.seat.y;
  } else {
    const c = freeCellNear(plan, p.cx, p.cy);
    p.cx = c[0]; p.cy = c[1]; p.x = c[0] * CELL + 4; p.y = c[1] * CELL + 7;
    p.seated = false;
  }
  p.stand = null;
  if (!p.conv && !p.arriving) personCancel(p);
}

function pplStep(p, dt) {
  if (!p.floor) return;
  p.t += dt;
  if (p.nod > 0) p.nod -= dt;
  if (p.alpha !== p.alphaT) {
    const k = 4 * dt;
    p.alpha = p.alpha < p.alphaT ? Math.min(p.alphaT, p.alpha + k) : Math.max(p.alphaT, p.alpha - k);
  }
  if (p.floor.plan !== p.plan) pplRelayout(p);
  if (p.conv) { if (p.act === null) p.act = 'chat'; }
  else if (p.act === 'chat') p.act = null;
  if (!p.co) p.co = p.faults > 3 ? pplIdleForever() : pplLife(p);
  try {
    if (p.co.next(dt).done) p.co = null;
  } catch (e) {
    p.co = null;
    p.faults++;
    pplStats.errors++;
    if (pplFailures++ < 3) console.error('person ' + p.id, e);
  }
}

/**
 * Advances every person: floors of tier 0 and 1 each frame, tier 2 four times a second with the time they
 * missed. A person in a tower or on a trip is always stepped, and so is one who is not on a plan yet.
 */
function tickPeople(dt) {
  for (let i = PEOPLE.length - 1; i >= 0; i--) {
    const p = PEOPLE[i];
    if (p.gone) { pplById.delete(p.id); PEOPLE.splice(i, 1); continue; }
    let step = dt;
    if (p.floor && p.floor.tier === 2 && !p.tz && p.trip === 0 && !p.arriving) {
      p.acc += dt;
      if (p.acc < 0.25) continue;
      step = p.acc;
      p.acc = 0;
    }
    pplStep(p, step);
  }
}
