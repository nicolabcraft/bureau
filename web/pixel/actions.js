/*
 * Office-life actions of the pixel view: what a person does while at rest, one generator each.
 * Lot L4, docs/vue-pixel.md 2.5. Shares one scope with the other web/pixel files: the public names are
 * ACTIONS and pickAction, everything else here is prefixed `act`. Declares only, nothing runs at load.
 *
 * An action is `function*(p)` meant for `yield*`: it sets `p.act` when it starts and puts it back to null
 * when it ends, and `actRun` releases the Spots and the prop even when the generator is cancelled
 * (generator.return runs the finally block). Time comes from the driver: `yield` returns the seconds that
 * passed (tier 2 floors are stepped four times a second with the time they missed), see actWait.
 * Movement primitives (personWalkTo, personStepTo, personTravel...) live in people.js.
 */

/** Waits `seconds` of simulated time. */
function* actWait(seconds) {
  let t = 0;
  while (t < seconds) t += (yield) || 0.016;
}

/** Releases every Spot the person holds. */
function actRelease(p) {
  const res = p.res;
  for (let i = 0; i < res.length; i++) res[i].by = null;
  res.length = 0;
}

/** Reserves a random free Spot of the floor of p, or null when none is free. */
function actTake(p, name) {
  const list = p.floor.plan.spots[name];
  if (!list) return null;
  let free = 0;
  for (let i = 0; i < list.length; i++) if (!list[i].by) free++;
  if (!free) return null;
  let k = Math.floor(rnd(0, free));
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.by) continue;
    if (k-- === 0) { s.by = p; p.res.push(s); return s; }
  }
  return null;
}

/** Walks to the cell of a Spot and takes its facing. */
function* actToSpot(p, s) {
  yield* personWalkTo(p, s.x, s.y);
  if (s.f) p.dir = s.f;
  p.pose = 'stand';
}

/** Walks in front of a seat (sofa, bench), then steps onto it: feet at (s.px, s.py), seated facing the viewer. */
function* actSitAt(p, s) {
  yield* personWalkTo(p, s.x, s.y);
  yield* personStepTo(p, s.px, s.py, 20);
  p.cx = s.x;
  p.cy = s.y;
  p.dir = 'down';
  p.pose = 'sit';
  p.seated = true;
  p.seatId = null;
}

/** Sets the seconds-left of a machine animation (floor.js decrements `fl.fx`, when it exists). */
function actFx(fl, key, seconds) {
  if (fl.fx) fl.fx[key] = seconds;
}

/** A plan furniture of a kind, in plan px, or null. */
function actFurniture(plan, kind) {
  const list = plan.furniture;
  for (let i = 0; i < list.length; i++) if (list[i].kind === kind) return list[i];
  return null;
}

/** Puffs of a particle kind around a plan point (nothing under reduced motion). */
function actEmit(p, kind, x, y, vx, vy, life) {
  if (!REDUCED) emitParticle(p.floor.index, kind, x, y, vx, vy, life);
}

/** Runs a body with the bookkeeping every action owes: act set, then spots, prop and act released even if cancelled. */
function* actRun(p, kind, body) {
  p.act = kind;
  try {
    yield* body(p);
  } finally {
    actRelease(p);
    p.prop = null;
    if (p.act === kind) p.act = null;
    if (p.pose !== 'walk') p.pose = p.seated ? 'sit' : 'stand';
  }
}

/** Sips for `n` rounds with the prop in hand, a wisp of steam after each. */
function* actSip(p, n, steam) {
  p.pose = 'hold';
  for (let i = 0; i < n; i++) {
    yield* actWait(rnd(1, 1.6));
    if (steam) actEmit(p, PART.steam, p.x + 5, p.y - 17, 0, -7, 1.2);
  }
}

/* ------------------------------------------ bodies ------------------------------------------ */

function* actType(p) {
  for (;;) {
    p.pose = 'type';
    yield* actWait(rnd(10, 22));
    if (p.seated && p.info && p.info.role !== 'chef' && rnd(0, 1) < 0.2) {
      p.pose = 'str';
      p.act = 'stretch';
      yield* actWait(2.4);
      p.act = 'type';
    }
  }
}

function* actWaitBody(p) {
  p.pose = 'hand';
  for (;;) yield;
}

function* actRead(p) {
  p.prop = p.look.glasses ? 'book' : 'paper';
  p.pose = 'read';
  p.dir = 'down';
  yield* actWait(rnd(3, 5));
}

function* actCoffee(p) {
  const s = actTake(p, 'coffee');
  if (!s) return;
  yield* actToSpot(p, s);
  p.pose = 'hold';
  yield* actWait(0.7);
  actFx(p.floor, 'coffee', 3.2);
  for (let i = 0; i < 4; i++) {
    actEmit(p, PART.steam, s.x * CELL + 4 + rnd(-3, 3), s.y * CELL - 6, 0, -8, 1.2);
    yield* actWait(0.7);
  }
  p.prop = 'cup';
  p.dir = 'down';
  yield* actSip(p, 3, true);
}

function* actSmoke(p) {
  if (!p.look.smoker) { yield* actStretch(p); return; }
  const s = actTake(p, 'smoke');
  if (!s) { yield* actWindow(p); return; }
  yield* actToSpot(p, s);
  p.prop = 'cigarette';
  p.pose = 'hold';
  const sx = p.dir === 'left' ? -3 : 3;
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 4; k++) {
      yield* actWait(0.45);
      actEmit(p, PART.smoke, p.x + sx + 4, p.y - 16, rnd(-2, 2), -9, 2.2);
    }
    p.pose = 'stand';
    yield* actWait(0.5);
    actEmit(p, PART.ash, p.x + 5, p.y - 8, 0, 14, 0.7);
    p.pose = 'hold';
  }
}

function* actFountain(p) {
  const s = actTake(p, 'fountain');
  if (!s) return;
  yield* actToSpot(p, s);
  p.pose = 'hold';
  yield* actWait(0.8);
  p.prop = 'glass';
  p.dir = 'down';
  yield* actSip(p, 2, false);
}

function* actPrinter(p) {
  const s = actTake(p, 'printer');
  if (!s) return;
  yield* actToSpot(p, s);
  p.pose = 'hold';
  yield* actWait(0.6);
  actFx(p.floor, 'print', 2.6);
  yield* actWait(2.8);
  p.prop = 'paper';
  p.pose = 'read';
  p.dir = 'down';
  yield* actWait(3.5);
}

function* actBoard(p) {
  const s = actTake(p, 'board');
  if (!s) return;
  yield* actToSpot(p, s);
  p.prop = 'marker';
  const n = Math.floor(rnd(3, 6));
  for (let i = 0; i < n; i++) {
    p.pose = 'hold';
    yield* actWait(rnd(0.8, 1.4));
    p.pose = 'stand';
    yield* actWait(rnd(0.5, 1));
  }
}

function* actMicro(p) {
  const s = actTake(p, 'micro');
  if (!s) return;
  yield* actToSpot(p, s);
  p.pose = 'hold';
  yield* actWait(0.6);
  actFx(p.floor, 'micro', 3.5);
  p.pose = 'stand';
  yield* actWait(3.5);
  actEmit(p, PART.puff, s.x * CELL + 8, s.y * CELL - 12, 0, -4, 0.6);
  p.prop = 'bowl';
  const sofa = actTake(p, 'sofa');
  if (sofa) {
    yield* actSitAt(p, sofa);
    yield* actWait(0.5);
    for (let i = 0; i < 5; i++) {
      p.pose = 'sit';
      yield* actWait(1);
      actEmit(p, PART.steam, p.x + 3, p.y - 13, 0, -6, 1);
    }
  } else {
    p.dir = 'down';
    yield* actSip(p, 3, true);
  }
}

function* actPlants(p) {
  if (!p.look.gardener) { yield* actWindow(p); return; }
  const s = actTake(p, 'plant');
  if (!s) return;
  p.prop = 'can';
  yield* actToSpot(p, s);
  p.dir = 'up';
  p.pose = 'hold';
  for (let i = 0; i < 8; i++) {
    yield* actWait(0.4);
    actEmit(p, PART.drop, p.x + 7, p.y - 10, rnd(-1, 1) * 4, 18, 0.5);
  }
}

function* actStretch(p) {
  p.dir = 'down';
  p.pose = 'str';
  yield* actWait(rnd(2.2, 3.4));
}

function* actWindow(p) {
  const s = actTake(p, 'window');
  if (!s) return;
  yield* actToSpot(p, s);
  yield* actWait(rnd(5, 9));
}

function* actRail(p) {
  const s = actTake(p, 'rail');
  if (!s) { yield* actWindow(p); return; }
  yield* actToSpot(p, s);
  yield* actWait(rnd(5, 9));
}

/** A seat of the sofa, else of the bench; null when both are taken. */
function actSeat(p) {
  return actTake(p, 'sofa') || actTake(p, 'bench');
}

function* actPhone(p) {
  const s = actSeat(p);
  if (!s) return;
  yield* actSitAt(p, s);
  p.prop = 'phone';
  yield* actWait(rnd(6, 10));
}

function* actSofa(p) {
  const s = actTake(p, 'sofa');
  if (!s) return;
  yield* actSitAt(p, s);
  yield* actWait(rnd(1, 2));
  if (p.look.glasses) p.prop = 'book';
  yield* actWait(rnd(6, 10));
}

function* actSleep(p) {
  const s = actSeat(p);
  if (!s) return;
  yield* actSitAt(p, s);
  p.pose = 'sleep';
  for (let i = 0; i < 7; i++) {
    yield* actWait(1.3);
    actEmit(p, PART.zzz, p.x + 4, p.y - 18, 5, -6, 2.2);
  }
}

function* actBench(p) {
  const s = actTake(p, 'bench');
  if (!s) return;
  yield* actSitAt(p, s);
  yield* actWait(rnd(5, 8));
}

/** The floor index to visit: a random other built floor; `near` keeps to the floors next to the current one. */
function actVisitIndex(p, near) {
  const here = p.floor.index;
  const options = [];
  for (let i = 0; i < FLOORS.length; i++) {
    const f = FLOORS[i];
    if (i === here || (f.p !== undefined && f.p < 1)) continue;
    if (near && Math.abs(i - here) !== 1) continue;
    options.push(i);
  }
  return options.length ? pick(options) : -1;
}

/** A short visit to another floor and back. The whole visit is one trip: nothing interrupts it. */
function* actVisit(p, how) {
  const home = p.floor.index;
  const to = actVisitIndex(p, how === 'stairs');
  if (to < 0) return;
  p.trip++;
  try {
    yield* personTravel(p, to, how);
    yield* actWait(rnd(2.5, 5));
    const back = pplHomeIndex(p);
    yield* personTravel(p, back < 0 ? home : back, how);
  } finally {
    p.trip--;
  }
}

/** Done: carries the folder to the manager standing on the same floor, hands it over, goes back. */
function* actDeliver(p) {
  const boss = p.info && p.info.parentId ? personById(p.info.parentId) : null;
  if (!boss || boss === p || boss.floor !== p.floor || !boss.present || boss.tz || boss.conv || boss.leaving) return;
  p.prop = 'folder';
  const v = personVisitCell(boss);
  yield* personWalkTo(p, v.x, v.y);
  personFaceTo(p, boss);
  p.pose = 'stand';
  yield* actWait(2.5);
  p.prop = null;
}

/** One action per kind of ACT_KINDS that a person can start on their own (talk.js owns chat). */
const ACTIONS = {
  *type(p) { yield* actRun(p, 'type', actType); },
  *wait(p) { yield* actRun(p, 'wait', actWaitBody); },
  *read(p) { yield* actRun(p, 'read', actRead); },
  *coffee(p) { yield* actRun(p, 'coffee', actCoffee); },
  *smoke(p) { yield* actRun(p, 'smoke', actSmoke); },
  *fountain(p) { yield* actRun(p, 'fountain', actFountain); },
  *printer(p) { yield* actRun(p, 'printer', actPrinter); },
  *board(p) { yield* actRun(p, 'board', actBoard); },
  *micro(p) { yield* actRun(p, 'micro', actMicro); },
  *plants(p) { yield* actRun(p, 'plants', actPlants); },
  *stretch(p) { yield* actRun(p, 'stretch', actStretch); },
  *window(p) { yield* actRun(p, 'window', actWindow); },
  *rail(p) { yield* actRun(p, 'rail', actRail); },
  *phone(p) { yield* actRun(p, 'phone', actPhone); },
  *sofa(p) { yield* actRun(p, 'sofa', actSofa); },
  *sleep(p) { yield* actRun(p, 'sleep', actSleep); },
  *bench(p) { yield* actRun(p, 'bench', actBench); },
  *deliver(p) { yield* actRun(p, 'deliver', actDeliver); },
  *stairs(p) { yield* actRun(p, 'stairs', (q) => actVisit(q, 'stairs')); },
  *lift(p) { yield* actRun(p, 'lift', (q) => actVisit(q, 'lift')); },
};

/** Draw weights of a break: [key, weight, condition]. The night makes the sofa a bed. */
function actWeights(p, night) {
  const look = p.look;
  const w = actWeightList;
  w[0] = 0.16;                       // coffee
  w[1] = look.smoker ? 0.2 : 0;      // smoke
  w[2] = 0.08;                       // fountain
  w[3] = 0.07;                       // printer
  w[4] = 0.07;                       // micro
  w[5] = look.gardener ? 0.1 : 0;    // plants
  w[6] = 0.09;                       // stretch
  w[7] = 0.1;                        // window
  w[8] = 0.06;                       // rail
  w[9] = 0.1;                        // phone
  w[10] = night ? 0.5 : 0.02;        // sleep
  w[11] = 0.04;                      // stairs
  w[12] = 0.04;                      // lift
  w[13] = 0.05;                      // read
  w[14] = 0.04;                      // board
  w[15] = 0.05;                      // sofa
  return w;
}
const actWeightList = new Array(16).fill(0);
const actWeightKeys = ['coffee', 'smoke', 'fountain', 'printer', 'micro', 'plants', 'stretch', 'window', 'rail', 'phone', 'sleep', 'stairs', 'lift', 'read', 'board', 'sofa'];

/** Draws the key of a break for p at `hour` (0 to 24): a weighted choice with the engine's `rnd`. */
function pickAction(p, hour) {
  const night = hour >= 21 || hour < 6;
  const w = actWeights(p, night);
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i];
  let r = rnd(0, total);
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return actWeightKeys[i];
  }
  return 'stretch';
}
