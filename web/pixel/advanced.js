/* web/pixel/advanced.js : lot L9, voir docs/vue-pixel.md (2.9) */
/*
 * The advanced view: a cutaway of the whole building. One band per floor, the same people as the floor view (it
 * simulates nothing: it reads person.act, person.desk, person.floor and the tower coordinates), the copper tubes and the
 * capsules of tubes.js, the crane while a floor is built. Lot L9, contract in 2.9. Shares one scope with the other
 * web/pixel files: the public names are advCam, advLayout, advPlace, renderAdvanced, advPick, advHighlight and advFocus,
 * every other top-level name wears `adv`. Declares only, nothing runs at load. No DOM: everything is drawn in the buffer
 * `g` that boot.js hands to renderAdvanced.
 *
 * World. Pixels of the cutaway, origin at the top left of the layout (x grows right, y down): the band of floor i is
 * 54 px high (50 of interior, 4 of slab), the highest one starts at advTop, the street is under the ground band. From left
 * to right: the balcony with its rail (the entrance canopy and door on the ground floor), the stair tower, the interior (the
 * same width on every floor: chef office, board, one slot of 13 px per occupied desk, shelves, the break corner), the lift
 * shaft and the vertical copper pipe. advLayout turns the FloorPlans into those positions and into the stations people stand at.
 *
 * Where people are. A seated person sits at the slot of its desk. Anybody else goes to the station nearest to where it
 * really is on its plan (visit cell of a desk, coffee machine, window, rail, sofa, lift landing...): the cutaway keeps the plan
 * order and lets them glide along the band at walking speed. People in a tower (tz) are placed from their world height:
 * the cab, or the switchback stairs. Several people at one station stand side by side.
 *
 * Drawn once per (layout, time of day, built floors): the sky and the street, the floor bands with their furniture, the
 * tubes and the roof. Drawn each frame: floors under construction, lift cab, monitors, machine effects, people (a proxy of
 * each Person, so the simulation is never touched), capsules, particles, crane, markers, plaques and speech bubbles.
 *
 * Choices recorded here (additions to 2.9, all additive):
 *  - renderAdvanced leaves an identity transform; the world is drawn with translate(-advCam.x, -advCam.y). It follows the
 *    camera itself: advCam is fitted when the view is shown, when the window or the layout changes (the whole building, else x2
 *    with scrolling), and eases towards a point that advFocus asked for. nav.js only keeps its zoom and insets in step.
 *  - It rebuilds its layout by itself when a floor's plan or version changed, so it never depends on advLayout being called.
 *  - The drawn buffer carries no #texte layer: the labels are bitmap text in the buffer. Static labels (room names, floor
 *    sign, roof sign) are in `AdvLayout.labels`; plaques, markers and speech bubbles are placed clear of them and of each other.
 *  - Speech bubbles are the box canvases of talk.js (Conversation.buf), a tail added here; they stay inside the part of the view
 *    that Camera.insets leave free. A bubble with no free place is left out for that frame (the dialog box has the line).
 *  - The selection (setSelected) and the « Qui m'attend » filter (pplWaitFilter) apply here too. advHighlight draws a ring and
 *    a plaque on the named people and dims the rest, like the filter does.
 *  - advPick returns { kind: 'person' | 'bubble' | 'floor', id } in a reused object.
 *  - The sky is baked here: sky.js anchors its sky, skyline and street on the floor view's geometry (368 px floors), which
 *    does not suit a 54 px band. It shares the hour (sceneHour, skyKind, nightAlpha).
 */

const advCam = new Camera();

/* ------------------------------ geometry ------------------------------ */

const advFH = 54;                                // one floor in the stack
const advIH = 50;                                // interior height
const advTop = 32;                               // y of the top of the highest band: room for the roof props, so that six floors still fit x2 in a 752 px view
const advBX = 6;                                 // left edge of the balcony
const advBalc = 20;                              // balcony width
const advStairW = 28;                            // stair tower width
const advLiftW = 22;                             // lift shaft width
const advPitch = 13;                             // one desk slot
const advIWMax = 520;                            // widest interior that still keeps full service names (x2 in a 1280 px view)
const advIWMin = 260;                            // narrowest interior (the least a floor needs is 244)
const advCafeW = 118;                            // the break corner, from the coffee machine to the bench
const advPad = 140;                              // least sky and street beyond the world, on every side (more when the view is wider than the building)
let advPx = advPad;                              // the margins in use, horizontal and vertical
let advPy = advPad;
let advPadVer = -1;
const advStreetH = 20;
const advSpeed = 52;                             // px/s of a person gliding along a band
const advKinds = ['day', 'dawn', 'dusk', 'night'];

const advAccents = { dev: 'glass', arch: 'screen', design: 'lampHi', qa: 'leafL', prod: 'pot', misc: 'wallMid' };
const advShorts = { dev: 'Dév.', arch: 'Arc.', design: 'Design', qa: 'Qual.', prod: 'Prod.' };
const advLook = {
  day: { top: 'steelD', low: 'night', ceil: 'conc', seam: 'steel', fl1: 'wood', fl2: 'woodD', pane: 'steelL', roof: 'conc' },
  dawn: { top: 'steelD', low: 'night', ceil: 'conc', seam: 'steel', fl1: 'wood', fl2: 'woodD', pane: 'steelL', roof: 'conc' },
  dusk: { top: 'night', low: 'night', ceil: 'concD', seam: 'steelD', fl1: 'woodD', fl2: 'ink', pane: 'steel', roof: 'concD' },
  night: { top: 'night', low: 'ink', ceil: 'steelD', seam: 'night', fl1: 'woodD', fl2: 'ink', pane: 'steelD', roof: 'steelD' },
};
const advBooks = ['red', 'lamp', 'leaf', 'screen', 'pot'];
const advShelfCols = ['steelL', 'pot', 'screenD', 'lamp'];
const advFull = { plan: 1, slab: 1, cols: 1, ceil: 1, wall: 1, win: 1, furn: 1, lit: true };

let advVer = 0;
let advLay = null;                               // the current AdvLayout

/* ------------------------------ small things ------------------------------ */

let advSprites = null;
function advSpr() {
  if (!advSprites) {
    advSprites = {
      plant: bakeRows(['....A..A...A...', '..A.lAAlA.lA...', '.AllAlllAllllA.', '.llllmllllmlll.', 'Allmllllllllll.', '.llllllmlllmlA.', '..lllmlllllll..', '...lllllmlll...', '....mllllll....', '.....lllmm.....', '......pppp.....', '.....pBBBBp....', '.....BBBBBB....', '.....BBBBBB....', '......BBBB.....'],
        { A: 'leafL', l: 'leaf', m: 'leafD', p: 'woodD', B: 'pot' }),
      qm: bakeRows(['.......', '.#####.', '#.....#', '......#', '....##.', '...#...', '.......', '...#...'], { '#': 'wood' }),
    };
  }
  return advSprites;
}

/** Text cut to a width, no dots: names are labels, not sentences. */
function advClip(s, maxW) {
  s = String(s || '');
  if (textWidth(s) <= maxW) return s;
  let n = s.length;
  while (n > 1 && textWidth(s.slice(0, n)) > maxW) n--;
  return s.slice(0, n).replace(/[ ,.:;'-]+$/, '');
}

/** Labels of a service, from the longest to the shortest. */
function advRoomLabels(svc, colorKey, title) {
  const out = [];
  const base = svc || title || '';
  if (base) out.push(base);
  if (advShorts[colorKey]) out.push(advShorts[colorKey]);
  if (base.length > 3) out.push(base.slice(0, 3) + '.');
  if (base.length > 1) out.push(base.slice(0, 1) + '.');
  return out;
}

function advPlate(g, s, cx, y, fg, bg) {
  const w = textWidth(s) + 6, x = Math.round(cx - w / 2);
  rect(g, x - 1, y - 1, w + 2, 12, 'ink');
  rect(g, x, y, w, 10, bg || 'night');
  drawText(g, s, x + 3, y - 1, fg || 'white');
  return x;
}

/* ------------------------------ layout ------------------------------ */

/** What a floor needs in width, and its occupied desks. */
function advFloorInfo(fl, plan, full) {
  const offices = plan.offices;
  const svc = new Map();
  for (const s of (plan.spec && plan.spec.rooms) || []) svc.set(s.key, s.service || '');
  const rooms = plan.rooms.map((room) => {
    const name = svc.get(room.key) || advClip(room.title, 70);
    const desks = room.desks.filter((d) => d.ownerId);
    const w = Math.max(4 + Math.max(1, desks.length) * advPitch + 3, full ? textWidth(name) + 7 : 0);   // full names: the room is as wide as its name
    return { room, desks, name, w };
  });
  const open = plan.open.desks.filter((d) => d.ownerId);
  const head = offices.length ? 6 + offices.length * 52 + 34 : 106;
  let need = head + 12 + advCafeW + 8;
  for (const r of rooms) need += r.w;
  if (open.length) need += 4 + open.length * advPitch + 3;
  return { offices, rooms, open, head, need, svc, full };
}

function advBuildFloor(lay, fl, inf, i) {
  const ty = advTop + (lay.n - 1 - i) * advFH;
  const lf = {
    index: i, fl, plan: fl.plan, ver: fl.ver, ty, b: ty + 46, f: ty + 49,
    items: [], desks: new Map(), deskList: [], rooms: [], offices: [], win: [], ports: [], stations: [], plants: [],
    boardX: 0, cafeX: 0, signRect: null, hasChef: false,
  };
  if (!inf) return lf;
  const ix = lay.ix, iw = lay.iw, plan = fl.plan, it = lf.items;
  const addDesk = (d, x, kind, room) => {
    const dl = { id: d.id, x: x + 6, ux: x, kind, ownerId: d.ownerId, lf, room: room || null, ref: null };
    lf.desks.set(d.id, dl);
    lf.deskList.push(dl);
    lf.ports.push(dl.x);
    it.push({ k: 'desk', dl });
    return dl;
  };
  // head: chef offices and the board, or the bench and the reception of a floor without a chef
  lf.hasChef = inf.offices.length > 0;
  let x = ix + 6;
  if (lf.hasChef) {
    inf.offices.forEach((o, k) => {
      const ox = ix + 6 + k * 52;
      lf.offices.push({ x: ox, w: 46, chefId: o.chefId });
      it.push({ k: 'office', x: ox });
      addDesk(o.desk, ox + 18, 'chef', null);
    });
    lf.boardX = ix + 6 + inf.offices.length * 52 + 4;
    x = ix + inf.head;
  } else {
    it.push({ k: 'bench', x: ix + 6 }, { k: 'recep', x: ix + 44 });
    lf.boardX = ix + 74;
    x = ix + inf.head;
  }
  it.push({ k: 'board', x: lf.boardX });
  // rooms, one partition each, then the open space
  for (const r of inf.rooms) {
    const x0 = x, x1 = x0 + r.w;
    const room = r.room;
    const svc = inf.svc.get(room.key) || '';
    const rl = { key: room.key, x0, x1, colorKey: room.colorKey, acc: advAccents[room.colorKey] || 'wallMid', labels: inf.full ? [r.name] : advRoomLabels(svc, room.colorKey, room.title), label: '', rect: null };
    lf.rooms.push(rl);
    it.push({ k: 'part', rl });
    r.desks.forEach((d, k) => addDesk(d, x0 + 4 + k * advPitch, k === 0 ? 'mgr' : 'agent', rl));
    x = x1;
  }
  if (inf.open.length) {
    const x0 = x, x1 = x0 + 4 + inf.open.length * advPitch + 3;
    const rl = { key: 'open', x0, x1, colorKey: 'misc', acc: 'steelL', labels: [], label: '', rect: null };
    lf.rooms.push(rl);
    it.push({ k: 'part', rl });
    inf.open.forEach((d, k) => addDesk(d, x0 + 4 + k * advPitch, 'agent', rl));
    x = x1;
  }
  // the break corner is anchored to the right wall; shelves and plants fill what lies between
  lf.cafeX = ix + iw - advCafeW - 6;
  for (let fx = x + 2, j = 0; fx < lf.cafeX - 14; fx += 13, j++) {
    it.push(j % 2 ? { k: 'bigplant', x: fx + 1 } : { k: 'shelf', x: fx });
    if (j % 2) lf.plants.push(fx + 6);
  }
  const c = lf.cafeX;
  lf.cafe = { coffee: c, micro: c + 14, fountain: c + 32, printer: c + 43, couch: c + 63, bench: c + 98 };
  it.push({ k: 'coffee', x: lf.cafe.coffee }, { k: 'micro', x: lf.cafe.micro }, { k: 'fountain', x: lf.cafe.fountain }, { k: 'printer', x: lf.cafe.printer },
    { k: 'couch', x: lf.cafe.couch }, { k: 'bench2', x: lf.cafe.bench });
  // windows on the back wall, every 58 px from the end of the head
  for (let wx = ix + inf.head + 14; wx < ix + iw - 20; wx += 58) lf.win.push(wx);
  // the floor sign: the project name, one or two lines, over the break corner
  const nm = fl.name || '';
  let lines = textWidth(nm) <= 70 ? [nm] : wrapText(nm, 70);
  if (lines.length > 2) lines = [lines[0], advClip(lines.slice(1).join(' '), 70)];
  const sw = Math.max.apply(null, lines.map(textWidth)) + 6;
  lf.sign = { lines, x: c - 2, y: lf.ty + 9, w: sw, h: lines.length * 9 + 2 };
  it.push({ k: 'sign' });
  lf.signRect = { x: lf.sign.x, y: lf.sign.y, w: sw, h: lf.sign.h, text: nm };
  lay.labels.push(lf.signRect);
  // room names: the longest label that fits its slot
  for (const rl of lf.rooms) {
    const room = rl;
    const w = rl.x1 - rl.x0 - 2;
    for (const t of room.labels) if (textWidth(t) + 4 <= w) { rl.label = t; break; }
    if (rl.label) {
      rl.rect = { x: rl.x0 + 1, y: lf.ty + 9, w: textWidth(rl.label) + 4, h: 11, text: rl.label };
      lay.labels.push(rl.rect);
    }
  }
  advBuildStations(lay, lf);
  lf.ports.sort((a, b) => a - b);
  return lf;
}

/** x of a Spot in the cutaway. */
function advSpotX(lay, lf, name, k, count) {
  const c = lf.cafe;
  switch (name) {
    case 'coffee': return c.coffee + 3 + k * 4;
    case 'micro': return c.micro + 7;
    case 'fountain': return c.fountain + 3;
    case 'printer': return c.printer + 4 + k * 5;
    case 'board': return lf.boardX + 3 + k * 4;
    case 'window': return lf.win.length ? lf.win[k % lf.win.length] + 6 : lay.ix + 20;
    case 'smoke': return advBX + 5 + k * 8;
    case 'rail': return advBX + 4 + k * 10;
    case 'sofa': return c.couch + 4 + k * 7;
    case 'bench': return c.bench + 4 + k * 9;
    case 'plant': return lf.plants.length ? lf.plants[k % lf.plants.length] : lay.ix + 60;
    case 'stairs': return lay.ix + 4;
    case 'lift': return lay.e0 - 6;
    case 'entry': return advBX + 10;
    default: return lay.ix + 40;
  }
}

function advBuildStations(lay, lf) {
  const S = lf.stations, plan = lf.plan;
  const add = (px, py, cx, lane, desk, seat) => S.push({ px, py, cx, lane, desk, seat, n: 0 });
  for (const d of plan.desks) {
    const dl = lf.desks.get(d.id);
    if (!dl) continue;
    add(d.x + 20, d.y + 4, dl.x, 'back', dl, true);
    add(d.approach.x * CELL + 4, d.approach.y * CELL + 7, dl.x, 'front', dl, false);
  }
  const names = Object.keys(plan.spots);
  for (const name of names) {
    const list = plan.spots[name];
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const px = s.px !== undefined ? s.px : s.x * CELL + 4, py = s.py !== undefined ? s.py : s.y * CELL + 7;
      add(px, py, advSpotX(lay, lf, name, k, list.length), name === 'sofa' || name === 'bench' ? 'back' : 'front', null, false);
    }
  }
}

/** Pure geometry of the cutaway, in px, from the floors (default: FLOORS). Called again when floors change. */
function advLayout(floors) {
  floors = floors || FLOORS;
  const n = floors.length;
  const lay = {
    ver: ++advVer, n, w: 0, h: 0, ix: 0, iw: 0, e0: 0, e1: 0, wallR: 0, pipe: 0, gy: 0, stairX0: 0, stairX1: 0,
    craneX: 0, pickX: 0, floors: [], labels: [], keys: [], roof: null,
  };
  let infos = [], iw = advIWMin;
  for (let pass = 0; pass < 2; pass++) {
    infos = [];
    iw = advIWMin;
    for (let i = 0; i < n; i++) {
      const fl = floors[i];
      const inf = fl.plan ? advFloorInfo(fl, fl.plan, pass === 0) : null;
      infos.push(inf);
      if (inf && inf.need > iw) iw = inf.need;
    }
    if (iw <= advIWMax) break;                    // full service names fit; else the rooms keep their desks' width and the names are shortened
  }
  lay.stairX0 = advBX + advBalc;
  lay.stairX1 = lay.stairX0 + advStairW;
  lay.ix = lay.stairX1 + 2;
  lay.iw = iw;
  lay.e0 = lay.ix + iw;
  lay.e1 = lay.e0 + advLiftW;
  lay.wallR = lay.e1 + 2;
  lay.pipe = lay.wallR + 1;
  lay.w = lay.pipe + 3 + 6;
  lay.gy = advTop + n * advFH;
  lay.h = lay.gy + advStreetH;
  lay.craneX = lay.ix + iw - advCafeW - 6 - 16;           // just left of the floor sign
  lay.pickX = lay.ix + 44;
  for (let i = 0; i < n; i++) {
    lay.floors.push(advBuildFloor(lay, floors[i], infos[i], i));
    lay.keys.push(floors[i].plan, floors[i].ver);
  }
  // the roof sign (static label): over the head of the top floor
  const rw = textWidth('Bureau') + 12;
  lay.roof = { x: lay.ix + 100, y: advTop - 4 - 22, w: rw, h: 15, text: 'Bureau' };
  lay.labels.push(lay.roof);
  advLay = lay;
  advCam.clampTo(lay.w, lay.h);
  return lay;
}

/** True when the layout no longer matches the floors. Allocates nothing. */
function advStale() {
  const lay = advLay;
  if (!lay || lay.n !== FLOORS.length) return true;
  for (let i = 0; i < lay.n; i++) {
    const fl = FLOORS[i];
    if (lay.keys[2 * i] !== fl.plan || lay.keys[2 * i + 1] !== fl.ver) return true;
  }
  return false;
}

/* ------------------------------ where people are ------------------------------ */

const advRecs = new WeakMap();                   // Person -> record
const advDrawn = [];                             // records drawn this frame, reused
const advPlaceOut = { x: 0, y: 0, pose: 'stand', dir: 'down' };
const advSeatPoses = { type: 1, hand: 1, read: 1, sleep: 1, str: 1, sit: 1 };

function advRecOf(p) {
  let r = advRecs.get(p);
  if (!r) {
    r = {
      p, x: 0, y: 0, tx: 0, ty: 0, dir: 1, moving: false, wt: 0, init: false, floor: -1, st: null, seat: null, k: 0, lane: 'front',
      tower: null, lastX: 0, fxT: 0, look: null, vis: false, nameSrc: null, name: '', nameW: 0,
      px: { id: p.id, info: p.info, look: p.look, sheet: null, sheetV: undefined, pose: 'stand', dir: 'down', seated: false, t: 0, prop: null, alpha: 1, nod: 0 },
    };
    advRecs.set(p, r);
  }
  return r;
}

/** Feet height in the cutaway of a world height in the floor view's coordinates (a reused object). */
const advRide = { fi: 0, y: 0 };
function advRideY(wy) {
  const lay = advLay, n = lay.n, landY = FLOORS[0] && FLOORS[0].plan ? FLOORS[0].plan.landY : 335;
  const fi = (floorTop(0, n) + landY - wy) / BLOCK;   // floors above the ground landing
  advRide.fi = fi; advRide.y = lay.floors[0].f - fi * advFH;
  return advRide;
}

/** The station of a person who is not seated at its desk: the nearest one of its floor, by where it is on its plan. */
function advNearest(lf, p) {
  const S = lf.stations;
  let best = null, bd = 1e12;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.seat) continue;
    const dx = s.px - p.x, dy = s.py - p.y, d = dx * dx + dy * dy * 1.3;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Fills rec.tx, ty, lane, st, seat, tower for a person. Returns false when the person is not on the cutaway. */
function advAim(p, rec) {
  const lay = advLay;
  rec.st = null; rec.seat = null; rec.tower = null;
  if (!p.present) return false;
  if (p.tz) {
    const r = advRideY(p.wy), fi = Math.max(0, Math.min(lay.n - 1, r.fi));
    rec.tower = p.tz;
    rec.ty = clamp(r.y, lay.floors[lay.n - 1].f, lay.floors[0].f);
    if (p.tz === 'lift') rec.tx = lay.e0 + 11;
    else {
      const u = fi - Math.floor(fi), w = lay.stairX1 - lay.stairX0 - 4;
      rec.tx = u < 0.5 ? lay.stairX1 - 2 - (u / 0.5) * w : lay.stairX0 + 2 + ((u - 0.5) / 0.5) * w;
    }
    return true;
  }
  if (!p.visible || !p.floor) return false;
  const lf = lay.floors[p.floor.index];
  if (!lf || !lf.ty) return false;
  if (p.seated && p.desk && p.seatId === p.desk.id) {
    const dl = lf.desks.get(p.desk.id);
    if (dl) { rec.seat = dl; rec.tx = dl.x; rec.ty = lf.b; rec.lane = 'back'; return true; }
  }
  const s = advNearest(lf, p);
  if (!s) { rec.tx = lay.ix + 40; rec.ty = lf.f; rec.lane = 'front'; return true; }
  rec.st = s;
  rec.lane = s.lane;
  rec.ty = s.lane === 'back' ? lf.b : lf.f;
  rec.tx = s.cx;
  return true;
}

/** Where a person should be in the cutaway: at its desk, at the coffee corner, on the rail, in the cab, in the lobby... Reused object. */
function advPlace(person) {
  if (!advLay || advStale()) advLayout(FLOORS);
  const rec = advRecOf(person);
  const o = advPlaceOut;
  if (!advAim(person, rec)) { o.x = 0; o.y = 0; o.pose = 'stand'; o.dir = 'down'; return o; }
  o.x = rec.tx; o.y = rec.ty;
  o.pose = rec.tower ? 'stand' : rec.seat ? (advSeatPoses[person.pose] ? person.pose : 'type') : person.pose === 'walk' ? 'stand' : person.pose;
  o.dir = person.dir === 'left' || person.dir === 'right' ? person.dir : 'down';
  return o;
}

/** One frame of positions: aim, group people at the same station, glide, pick the pose for the proxy. */
function advPlaceAll(dt) {
  const lay = advLay;
  advDrawn.length = 0;
  for (let f = 0; f < lay.floors.length; f++) { const S = lay.floors[f].stations; for (let i = 0; i < S.length; i++) S[i].n = 0; }
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i], rec = advRecOf(p);
    rec.vis = advAim(p, rec);
    if (!rec.vis) { rec.init = false; continue; }
    if (rec.st) rec.k = rec.st.n++;
    advDrawn.push(rec);
  }
  for (let i = 0; i < advDrawn.length; i++) {
    const rec = advDrawn[i], p = rec.p, st = rec.st;
    let tx = rec.tx;
    if (st) tx += st.desk ? -10 - 8 * rec.k : (rec.k - (st.n - 1) / 2) * 8;
    const fl = p.floor ? p.floor.index : -1;
    if (rec.tower) {
      rec.x = tx; rec.y = rec.ty; rec.moving = true; rec.init = true; rec.floor = fl;
      rec.dir = tx >= rec.lastX ? 1 : -1;
    } else {
      if (!rec.init || rec.floor !== fl) { rec.x = tx; rec.init = true; rec.floor = fl; }
      const dx = tx - rec.x;
      if (REDUCED || Math.abs(dx) > 160) { rec.x = tx; rec.moving = false; }
      else if (Math.abs(dx) > 0.6) {
        rec.x += Math.sign(dx) * Math.min(Math.abs(dx), advSpeed * dt);
        rec.moving = true;
        rec.dir = dx > 0 ? 1 : -1;
        rec.wt += dt;
      } else { rec.x = tx; rec.moving = false; }
      rec.y = rec.ty;
    }
    rec.lastX = rec.x;
    advPose(rec);
  }
}

/** The proxy that pplDraw reads: pose, facing and seating seen from the cutaway. */
function advPose(rec) {
  const p = rec.p, px = rec.px;
  px.id = p.id; px.info = p.info; px.prop = p.prop; px.alpha = p.alpha; px.nod = p.nod;
  if (px.look !== p.look) { px.look = p.look; px.sheet = null; px.sheetV = undefined; }
  if (rec.tower) {
    px.pose = rec.tower === 'lift' ? 'stand' : 'walk';
    px.dir = rec.tower === 'lift' ? 'down' : rec.dir > 0 ? 'right' : 'left';
    px.seated = false; px.t = p.t;
    return;
  }
  if (rec.moving) {
    px.pose = 'walk'; px.dir = rec.dir > 0 ? 'right' : 'left'; px.seated = false; px.t = rec.wt;
    return;
  }
  px.t = p.t;
  if (rec.seat) {
    px.seated = true; px.dir = 'down';
    px.pose = advSeatPoses[p.pose] ? p.pose : 'type';
    return;
  }
  const seatedHere = rec.lane === 'back' && p.seated;
  px.seated = seatedHere;
  px.pose = seatedHere ? (p.pose === 'sleep' ? 'sleep' : 'sit') : p.pose === 'walk' ? 'stand' : p.pose;
  let dir = p.dir === 'left' || p.dir === 'right' ? p.dir : 'down';
  const cv = p.conv;
  if (cv && cv.parts) {
    for (let i = 0; i < cv.parts.length; i++) {
      const o = cv.parts[i];
      if (o === p) continue;
      const orc = advRecs.get(o);
      if (orc && orc.vis && !orc.tower && o.floor === p.floor && orc.x !== rec.x) { dir = orc.x > rec.x ? 'right' : 'left'; break; }
    }
  }
  px.dir = dir;
}

/* ------------------------------ time of day, sky, street ------------------------------ */

const advBayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const advSky = {                                 // from the horizon up: [colour, distance above it where it starts]
  day: [['glassHi', 0], ['glass', 50], ['sky', 150]],
  dawn: [['lamp', 0], ['lampHi', 40], ['glassHi', 100], ['glass', 170], ['sky', 250]],
  dusk: [['lamp', 0], ['pot', 40], ['carpA', 110], ['carpB', 190]],
  night: [['carpB', 0], ['night', 70], ['ink', 160]],
};
const advCity = {                                // skyline and street colours per kind
  day: { far: 'steelL', near: 'steel', win: null, lit: 'glassHi', pLit: 0, walk: 'conc', walkJ: 'concD', road: 'steelD', roadS: 'steel', dash: 'wallHi' },
  dawn: { far: 'steelL', near: 'steelD', win: null, lit: 'lampHi', pLit: 0.1, walk: 'conc', walkJ: 'concD', road: 'steelD', roadS: 'steel', dash: 'wallHi' },
  dusk: { far: 'steelD', near: 'night', win: 'steelD', lit: 'lamp', pLit: 0.35, walk: 'concD', walkJ: 'steelD', road: 'steelD', roadS: 'night', dash: 'wallMid' },
  night: { far: 'night', near: 'ink', win: 'night', lit: 'lamp', pLit: 0.4, walk: 'concD', walkJ: 'steelD', road: 'night', roadS: 'ink', dash: 'steelL' },
};

function advKindOf() {
  return skyKind(sceneHour());
}

/** The sky behind and around the building: dithered bands, stars or sun, skyline, street. World px, origin at (-advPx, -advPy). */
function advBakeBackdrop(lay, kind) {
  const W = lay.w + 2 * advPx, H = lay.h + 2 * advPy, gy = lay.gy + advPy;
  const b = makeBuffer(W, H), g = b.g, img = g.createImageData(W, H), d = img.data;
  const bands = advSky[kind], look = advCity[kind];
  const blend = 14;
  for (let y = 0; y < H; y++) {
    const dist = gy - y;                                   // above the horizon
    let i = 0;
    if (dist >= 0) while (i + 1 < bands.length && dist >= bands[i + 1][1]) i++;
    const ca = rgb(bands[i][0]), cb = i + 1 < bands.length && dist >= 0 ? rgb(bands[i + 1][0]) : ca;
    const gap = i + 1 < bands.length ? bands[i + 1][1] - dist : 1e9, mix = gap <= blend && dist >= 0 ? 1 - gap / blend : 0;
    for (let x = 0; x < W; x++) {
      const col = mix > 0 && advBayer[(y & 3) * 4 + (x & 3)] / 16 < mix ? cb : ca, o = (y * W + x) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (kind === 'night') {
    for (let k = 0; k < 90; k++) {
      const h = hash('astar' + k);
      rect(g, h % W, (h >>> 8) % Math.max(1, gy - 60), 1, 1, (h >>> 4) % 5 === 0 ? 'lampHi' : (h >>> 4) % 3 === 0 ? 'steelL' : 'white');
    }
  }
  // sun or moon, over the left of the roof
  const bx = advPx + 14, by = advPy + 20;
  if (kind === 'night') {
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) { const r = Math.hypot(x, y); if (r <= 4.5) rect(g, bx + x, by + y, 1, 1, 'wallHi'); else if (r <= 6) rect(g, bx + x, by + y, 1, 1, 'wallMid'); }
  } else {
    const c0 = kind === 'day' ? 'lampHi' : 'lamp', c1 = kind === 'day' ? 'lamp' : 'pot';
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) { const r = Math.hypot(x, y); if (r <= 5.5) rect(g, bx + x, by + y, 1, 1, c0); else if (r <= 7) rect(g, bx + x, by + y, 1, 1, c1); }
  }
  // skyline, two layers standing on the horizon
  for (let layer = 0; layer < 2; layer++) {
    const near = layer === 1, body = near ? look.near : look.far;
    const wMin = near ? 22 : 16, wMax = near ? 44 : 30, hMin = near ? 70 : 100, hMax = near ? 170 : 240;
    let x = -((layer * 37) % 20), k = 0;
    while (x < W) {
      const h = hash((near ? 'asn' : 'asf') + k);
      const w = wMin + (h % (wMax - wMin + 1)), bh = hMin + ((h >>> 8) % (hMax - hMin + 1)), top = gy - bh;
      rect(g, x, top, w, bh + 2, body);
      if (near) rect(g, x, top, w, 1, look.far);
      else if ((h >>> 16) % 4 === 0) rect(g, x + (w >> 1), top - 9, 1, 9, body);
      if (near) {
        for (let wy = top + 5, j = 0; wy + 3 < gy - 2; wy += 7, j++) {
          for (let wx = x + 4, q = 0; wx + 3 <= x + w - 3; wx += 6, q++) {
            const r = (hash('aw' + k + '_' + q + '_' + j) % 1000) / 1000;
            if (r < look.pLit) rect(g, wx, wy, 3, 3, look.lit);
            else if (look.win) rect(g, wx, wy, 3, 3, look.win);
          }
        }
      }
      x += w;
      k++;
    }
  }
  // street: pavement, road, lane dashes, the ground under it
  rect(g, 0, gy, W, 6, look.walk);
  rect(g, 0, gy, W, 1, kind === 'night' ? 'steel' : 'steelL');
  for (let x = 0; x < W; x += 16) rect(g, x, gy + 1, 1, 3, look.walkJ);
  rect(g, 0, gy + 4, W, 1, look.walkJ);
  rect(g, 0, gy + 5, W, 1, 'steelD');
  rect(g, 0, gy + 6, W, advStreetH - 6, look.road);
  for (let k = 0; k < 400; k++) { const h = hash('aroad' + k); rect(g, h % W, gy + 6 + ((h >>> 8) % (advStreetH - 6)), 1 + ((h >>> 20) % 2), 1, look.roadS); }
  for (let x = 8; x < W; x += 32) rect(g, x, gy + 12, 14, 1, look.dash);
  rect(g, 0, gy + advStreetH - 1, W, 1, 'ink');
  rect(g, 0, gy + advStreetH, W, H - gy - advStreetH, kind === 'night' ? 'ink' : 'night');
  // two street lamps, two trees
  const lit = kind === 'night' || kind === 'dusk';
  for (const lx of [advPx + 12, advPx + lay.w - 18]) {
    rect(g, lx, gy - 40, 2, 38, 'steel'); rect(g, lx + 1, gy - 40, 1, 38, 'steelD');
    rect(g, lx - 5, gy - 43, 11, 4, 'ink'); rect(g, lx - 4, gy - 42, 9, 2, lit ? 'lampHi' : 'steelL');
    if (lit) for (let y = -3; y <= 3; y++) for (let x = -18; x <= 18; x++) { const r = Math.hypot(x / 18, y / 3); if (r <= 0.6 && ((x + y) & 1) === 0) rect(g, lx + x, gy + 3 + y, 1, 1, r <= 0.3 ? 'lampHi' : 'lamp'); }
  }
  for (const tx of [advPx + lay.w * 0.34, advPx + lay.w * 0.9]) {
    const x = Math.round(tx);
    rect(g, x + 3, gy - 18, 3, 16, 'woodD'); rect(g, x - 3, gy - 34, 15, 13, 'leafD'); rect(g, x - 1, gy - 36, 11, 9, 'leaf'); rect(g, x + 1, gy - 34, 4, 3, 'leafL');
  }
  return b.c;
}

let advBack = null;                              // { kind, w, h, px, py, c }: the sky of the hour, one at a time
function advBackdrop(lay, kind) {
  const b = advBack;
  if (!b || b.kind !== kind || b.w !== lay.w || b.h !== lay.h || b.px !== advPx || b.py !== advPy) {
    advBack = { kind, w: lay.w, h: lay.h, px: advPx, py: advPy, c: advBakeBackdrop(lay, kind) };
  }
  return advBack.c;
}

/* ------------------------------ painting a floor ------------------------------ */

/** Hoisted pieces and every layer of a floor that is being built. t in seconds of a 14 s site; p, the progress. */
const advSt = { plan: 0, slab: 0, cols: 0, ceil: 0, wall: 0, win: 0, furn: 0, lit: false };
function advStageP(t, a, b) { return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a); }
function advStage(p) {
  const t = Math.max(0, Math.min(1, p)) * 14, c = advStageP(t, 2.5, 4.25), e = advStageP(t, 4.25, 6), o = advSt;
  o.plan = advStageP(t, 0, 2.5);
  o.slab = advStageP(t, 6, 7.5);
  o.cols = c < 1 ? (c < 0.75 ? 0 : (c - 0.75) * 4) : 1;
  o.ceil = e < 0.75 ? 0 : (e - 0.75) * 4;
  o.wall = advStageP(t, 7.5, 9.5);
  o.win = advStageP(t, 9.5, 11);
  o.furn = advStageP(t, 11, 13);
  o.lit = t >= 13 && (t > 13.5 || (Math.floor(t * 12) & 1) === 1);
  return o;
}

function advPaintFloor(g, lay, lf, st, kind, back) {
  const L = advLook[kind] || advLook.day, y = lf.ty, ix = lay.ix, iw = lay.iw, i = lf.index;
  const ceilW = lay.wallR + 2 - advBX;
  if (st.slab < 1) tubBlueprint(g, lay, lf, st.plan);              // the plan of the floor, until its slab is poured
  // the dark shafts behind the stairs and the lift
  if (st.cols > 0 || st.wall > 0) {
    rect(g, lay.stairX0, y + 8, advStairW, advIH - 8, 'night');
    rect(g, lay.e0, y + 8, advLiftW, advIH - 8, 'night');
  }
  // back wall rising from the floor
  const wh = Math.round((advIH - 8) * st.wall);
  if (wh > 0) {
    const lit = st.lit, top = lit ? L.top : 'night', low = lit ? L.low : 'ink', y1 = y + advIH - wh;
    rect(g, ix, y1, iw, Math.min(wh, 24), top);
    if (wh > 24) { rect(g, ix, y + 32, iw, wh - 24, low); rect(g, ix, y + 32, iw, 1, L.pane); }
    for (let x = ix + 20; x < ix + iw; x += 28) rect(g, x, y1, 1, Math.min(wh, 24), L.seam);
    rect(g, ix, y + 47, iw, 1, lit ? L.fl1 : 'ink');
    rect(g, ix, y + 48, iw, 2, lit ? L.fl2 : 'ink');
    for (let x = ix + 3; x < ix + iw; x += 9) rect(g, x, y + 48, 1, 1, 'ink');
  }
  // windows: holes through to the sky
  const nw = lf.win.length;
  if (st.win > 0) {
    for (let j = 0; j < nw; j++) {
      const local = clamp(st.win * nw - j, 0, 1);
      if (local <= 0) continue;
      const x = lf.win[j];
      rect(g, x - 1, y + 10, 14, 17, L.pane);
      const hh = Math.max(1, Math.round(15 * local));
      g.drawImage(back, x + advPx, y + 11 + advPy, 12, hh, x, y + 11, 12, hh);
      if (local >= 1) { rect(g, x + 5, y + 11, 1, 15, L.pane); rect(g, x, y + 18, 12, 1, L.pane); rect(g, x + 1, y + 12, 2, 1, 'white'); rect(g, x + 2, y + 13, 1, 1, 'white'); }
    }
  }
  // structure: slab, columns, ceiling beam
  if (st.slab > 0) {
    const sw = Math.round(ceilW * st.slab);
    rect(g, advBX, y + advIH, sw, 4, 'steelD'); rect(g, advBX, y + advIH, sw, 1, 'steel'); rect(g, advBX, y + advIH + 3, sw, 1, 'ink');
    for (let x = advBX + 6; x < advBX + sw; x += 12) rect(g, x, y + advIH + 1, 1, 2, 'conc');
  }
  if (st.cols > 0) {
    const ch = Math.round(advIH * st.cols);
    for (let q = 0; q < 3; q++) {
      const cx = q === 0 ? ix - 2 : q === 1 ? lay.e0 - 2 : lay.wallR - 1;
      rect(g, cx, y + advIH - ch, 3, ch, 'steelD'); rect(g, cx, y + advIH - ch, 1, ch, 'steel'); rect(g, cx + 3, y + advIH - ch, 1, ch, 'ink');
      for (let k = y + advIH - ch + 5; k < y + advIH - 4; k += 10) rect(g, cx + 1, k, 1, 1, 'steel');
    }
  }
  if (st.ceil > 0) {
    const cw = Math.round(ceilW * st.ceil);
    rect(g, ix, y, Math.max(0, cw - (ix - advBX)), 8, L.ceil);
    rect(g, advBX, y, cw, 2, 'steelD'); rect(g, advBX, y, cw, 1, 'steel'); rect(g, advBX, y + 8, cw, 1, 'ink');
  }
  // the tubes first: nothing of them may show on a label
  if (st.ceil >= 1 && st.furn > 0) tubPaintFloor(g, lay, lf);
  // furniture, hoisted one after the other
  if (st.furn > 0) {
    const n = lf.items.length;
    for (let j = 0; j < n; j++) {
      const local = clamp(st.furn * (n + 2) - j, 0, 1);
      if (local <= 0) continue;
      advDrawItem(g, lay, lf, lf.items[j], local >= 1 ? 0 : Math.round((1 - local) * -30));
    }
  }
  if (st.cols >= 1) advPaintShaft(g, lay, lf, i);
  if (st.slab >= 1 && i > 0) advPaintRail(g, lay, y);
  if (i === 0 && st.cols >= 1) advPaintCanopy(g, lay, y);
}

/** The stair switchback (two flights per floor) and the frame of the lift door. */
function advPaintShaft(g, lay, lf, i) {
  const y = lf.ty, x0 = lay.stairX0, x1 = lay.stairX1, top = i < lay.n - 1;
  // lift door frame, jambs and indicator
  const e = lay.e0;
  rect(g, e + 1, y + 6, 20, 44, 'ink'); rect(g, e + 2, y + 9, 18, 41, 'night');
  rect(g, e + 1, y + 6, 20, 3, 'ink'); rect(g, e + 9, y + 7, 4, 1, 'lampHi');
  rect(g, e + 2, y + 9, 1, 41, 'steel'); rect(g, e + 19, y + 9, 1, 41, 'steel');
  if (!top) return;
  // flights from this floor's landing to the next: right end to left end at mid height, back to the right end at the landing above
  const yb = y + 49, ym = y + 22, yt = y - 5;
  advFlight(g, x1 - 1, yb, x0 + 1, ym, 9);
  advFlight(g, x0 + 1, ym, x1 - 1, yt, 9);
  rect(g, x0, ym, 4, 2, 'steelL'); rect(g, x0, ym + 2, 4, 1, 'steel');
}

function advFlight(g, xa, ya, xb, yb, n) {
  const dir = xb > xa ? 1 : -1, run = Math.abs(xb - xa), tw = Math.ceil(run / n) + 1;
  for (let k = 0; k < n; k++) {
    const x = Math.round(xa + (dir * run * k) / n), y = Math.round(ya + ((yb - ya) * (k + 1)) / n), xl = dir > 0 ? x : x - tw + 1;
    rect(g, xl, y, tw, 1, 'steelL'); rect(g, xl, y + 1, tw, 2, 'steel'); rect(g, xl, y + 3, tw, 1, 'ink');
  }
  for (let k = 0; k <= run; k += 2) rect(g, xa + dir * k, Math.round(ya + ((yb - ya) * k) / run) - 14, 1, 1, 'steelL');
}

function advPaintRail(g, lay, y) {
  const by = y + advIH;
  rect(g, advBX, by - 12, 1, 12, 'steelL'); rect(g, advBX, by - 12, advBalc - 2, 1, 'steelL'); rect(g, advBX, by - 6, advBalc - 2, 1, 'steel');
  for (let x = advBX + 5; x < lay.stairX0 - 3; x += 5) rect(g, x, by - 11, 1, 11, 'steel');
  rect(g, advBX + 2, by - 4, 3, 4, 'ink'); rect(g, advBX + 2, by - 4, 3, 1, 'steel'); rect(g, advBX + 3, by - 5, 1, 1, 'red');
  g.drawImage(advSpr().plant, advBX + 11, by - 15);
}

function advPaintCanopy(g, lay, y) {
  rect(g, advBX - 6, y + 8, advBalc + 10, 3, 'steelD'); rect(g, advBX - 6, y + 8, advBalc + 10, 1, 'steel'); rect(g, advBX - 6, y + 11, advBalc + 10, 1, 'pot');
  // entrance door: frame, glass and the mat
  rect(g, advBX + 1, y + 14, 18, 36, 'ink'); rect(g, advBX + 2, y + 15, 16, 35, 'glass'); rect(g, advBX + 2, y + 15, 16, 4, 'glassHi');
  rect(g, advBX + 9, y + 15, 2, 35, 'ink'); rect(g, advBX + 4, y + 22, 1, 5, 'white'); rect(g, advBX + 13, y + 22, 1, 5, 'white');
  rect(g, advBX + 2, y + 48, 16, 2, 'woodD');
}

/** One piece of furniture. dy: the drop of a piece being hoisted. */
function advDrawItem(g, lay, lf, it, dy) {
  const y = lf.ty + dy, b = lf.ty + 46 + dy;
  switch (it.k) {
    case 'desk': {
      const ux = it.dl.ux;
      rect(g, ux + 3, b - 1, 7, 1, 'ink'); rect(g, ux + 5, b, 3, 1, 'steelD');          // chair foot
      advDeskFront(g, ux, b, null, 0, false);
      break;
    }
    case 'office': {
      const x = it.x;
      rect(g, x, y + 12, 46, 1, 'steelL'); rect(g, x + 45, y + 12, 1, 35, 'steelL'); rect(g, x, y + 12, 1, 6, 'steelL');
      for (let k = 0; k < 6; k++) rect(g, x + 37 + (k & 1), y + 16 + k * 3, 1, 1, 'white');
      rect(g, x + 24, y + 13, 1, 34, 'steel');
      rect(g, x + 4, b - 20, 8, 20, 'woodD'); rect(g, x + 4, b - 20, 8, 1, 'ink'); rect(g, x + 4, b - 13, 8, 1, 'ink'); rect(g, x + 4, b - 6, 8, 1, 'ink');
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) rect(g, x + 5 + j * 2 + (k & 1), b - 19 + k * 7, 1, 5, advBooks[(k * 3 + j) % 5]);
      g.drawImage(advSpr().plant, x + 33, b - 14);
      break;
    }
    case 'bench': { const x = it.x; rect(g, x, b - 3, 28, 2, 'wood'); rect(g, x, b - 3, 28, 1, 'woodL'); rect(g, x + 1, b - 1, 2, 2, 'woodD'); rect(g, x + 25, b - 1, 2, 2, 'woodD'); rect(g, x, b - 12, 28, 1, 'woodD'); rect(g, x, b - 12, 1, 9, 'woodD'); rect(g, x + 27, b - 12, 1, 9, 'woodD'); break; }
    case 'recep': { const x = it.x; rect(g, x, b - 12, 26, 12, 'woodD'); rect(g, x, b - 13, 26, 2, 'wood'); rect(g, x, b - 13, 26, 1, 'woodL'); rect(g, x + 2, b - 9, 22, 1, 'ink'); rect(g, x + 16, b - 19, 6, 5, 'ink'); rect(g, x + 17, b - 18, 4, 3, 'screen'); rect(g, x + 18, b - 14, 2, 1, 'steel'); break; }
    case 'board': { const x = it.x; rect(g, x - 1, y + 17, 28, 22, 'steelL'); rect(g, x, y + 18, 26, 20, 'white'); rect(g, x, y + 38, 26, 2, 'steel'); rect(g, x + 3, y + 38, 4, 1, 'ink'); rect(g, x + 9, y + 38, 3, 1, 'red'); break; }
    case 'bigplant': { const x = it.x; g.drawImage(advSpr().plant, x + 2, b - 14); rect(g, x, b - 14, 4, 6, 'leaf'); rect(g, x + 1, b - 16, 2, 4, 'leafL'); break; }
    case 'shelf': { const x = it.x; rect(g, x, b - 18, 12, 18, 'woodD'); rect(g, x, b - 18, 12, 1, 'ink'); rect(g, x, b - 12, 12, 1, 'ink'); rect(g, x, b - 6, 12, 1, 'ink'); for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) rect(g, x + 1 + j * 3, b - 16 + k * 6, 2, 4, advShelfCols[(j + k) % 4]); break; }
    case 'coffee': { const x = it.x; rect(g, x, b - 8, 10, 8, 'woodD'); rect(g, x, b - 8, 10, 1, 'ink'); rect(g, x + 4, b - 8, 1, 8, 'ink');
      rect(g, x, b - 20, 10, 12, 'ink'); rect(g, x + 1, b - 19, 8, 10, 'steel'); rect(g, x + 2, b - 18, 3, 2, 'screenD'); rect(g, x + 6, b - 18, 1, 1, 'lamp'); rect(g, x + 7, b - 18, 1, 1, 'red'); rect(g, x + 2, b - 14, 6, 4, 'ink'); rect(g, x + 1, b - 19, 1, 9, 'steelL'); rect(g, x + 4, b - 14, 2, 1, 'pot'); break; }
    case 'micro': { const x = it.x; rect(g, x, b - 10, 14, 10, 'woodD'); rect(g, x, b - 10, 14, 1, 'ink'); rect(g, x, b - 11, 14, 1, 'wood'); rect(g, x + 6, b - 9, 1, 9, 'ink');
      rect(g, x + 1, b - 18, 12, 7, 'ink'); rect(g, x + 2, b - 17, 10, 5, 'steel'); rect(g, x + 3, b - 16, 6, 3, 'ink'); rect(g, x + 10, b - 17, 1, 5, 'steelD'); rect(g, x + 10, b - 15, 1, 1, 'lamp'); break; }
    case 'fountain': { const x = it.x; rect(g, x, b - 15, 7, 15, 'ink'); rect(g, x + 1, b - 14, 5, 6, 'glassHi'); rect(g, x + 1, b - 14, 5, 3, 'glass'); rect(g, x + 1, b - 8, 5, 8, 'steel'); rect(g, x + 2, b - 10, 3, 1, 'ink'); rect(g, x + 5, b - 12, 1, 1, 'pot'); break; }
    case 'printer': { const x = it.x; rect(g, x, b - 9, 14, 9, 'woodD'); rect(g, x, b - 9, 14, 1, 'ink'); rect(g, x + 1, b - 16, 12, 8, 'ink'); rect(g, x + 2, b - 15, 10, 4, 'steelL'); rect(g, x + 2, b - 11, 10, 2, 'steel'); rect(g, x + 10, b - 14, 1, 1, 'screen'); rect(g, x + 3, b - 18, 6, 2, 'white'); break; }
    case 'couch': { const x = it.x; rect(g, x, b - 14, 30, 14, 'ink'); rect(g, x + 1, b - 13, 28, 12, 'brick'); rect(g, x + 3, b - 8, 24, 6, 'pot'); rect(g, x + 3, b - 8, 24, 1, 'woodL'); rect(g, x + 1, b - 13, 28, 4, 'pot'); rect(g, x + 14, b - 8, 1, 6, 'brick'); rect(g, x + 1, b - 1, 2, 1, 'ink'); rect(g, x + 27, b - 1, 2, 1, 'ink'); break; }
    case 'bench2': { const x = it.x; rect(g, x, b - 3, 20, 2, 'wood'); rect(g, x, b - 3, 20, 1, 'woodL'); rect(g, x + 1, b - 1, 2, 2, 'woodD'); rect(g, x + 17, b - 1, 2, 2, 'woodD'); rect(g, x, b - 11, 20, 1, 'woodD'); rect(g, x, b - 11, 1, 8, 'woodD'); rect(g, x + 19, b - 11, 1, 8, 'woodD'); break; }
    case 'part': {
      const rl = it.rl, x = rl.x0, ya = lf.ty + dy;
      rect(g, x, ya + 10, 1, advIH - 12, 'ink'); rect(g, x, ya + 10, 1, advIH - 12, rl.acc); rect(g, x + 1, ya + 10, 1, 3, rl.acc);
      advPaintRoomLabel(g, rl, dy);
      break;
    }
    case 'sign': {
      advPaintSign(g, lf, dy);
      break;
    }
    default: break;
  }
}

/** The name plate of a room (a label: always drawn over the decor). */
function advPaintRoomLabel(g, rl, dy) {
  const r = rl.rect;
  if (!r) return;
  rect(g, r.x, r.y + dy, r.w, r.h, 'ink'); rect(g, r.x, r.y + dy, r.w, 1, rl.acc); drawText(g, rl.label, r.x + 2, r.y + dy, 'white');
}

/** The floor sign: the project name. */
function advPaintSign(g, lf, dy) {
  const s = lf.sign;
  rect(g, s.x, s.y + dy, s.w, s.h, 'ink'); rect(g, s.x, s.y + dy, s.w, 1, 'lamp');
  for (let k = 0; k < s.lines.length; k++) drawText(g, s.lines[k], s.x + 3, s.y + dy + k * 9, 'lampHi');
}

/** The name plates again, over the capsules that cross them (only while one flies). */
function advDrawLabels(g, lay) {
  for (let f = 0; f < lay.floors.length; f++) {
    const lf = lay.floors[f];
    if (lf.fl.p < 1 || !lf.sign) continue;
    for (let i = 0; i < lf.rooms.length; i++) advPaintRoomLabel(g, lf.rooms[i], 0);
    advPaintSign(g, lf, 0);
  }
}

/** The part of a desk seen from the front, drawn over the seated person: monitor back, top, front panel, legs. sc: colour of the screen's light, or null. */
function advDeskFront(g, ux, b, sc, T, lamp) {
  rect(g, ux + 2, b - 12, 9, 7, 'ink'); rect(g, ux + 3, b - 11, 7, 5, 'steelD'); rect(g, ux + 4, b - 10, 2, 1, 'steel');
  if (sc) { rect(g, ux + 3, b - 12, 7, 1, sc); }
  rect(g, ux + 5, b - 6, 3, 2, 'steel');
  rect(g, ux, b - 5, 13, 3, 'wood'); rect(g, ux, b - 5, 13, 1, 'woodL'); rect(g, ux, b - 3, 13, 1, 'woodD');
  rect(g, ux + 1, b - 2, 2, 3, 'woodD'); rect(g, ux + 10, b - 2, 2, 3, 'woodD'); rect(g, ux + 3, b - 2, 7, 1, 'ink');
  if (lamp) { rect(g, ux + 11, b - 8, 1, 3, 'lampHi'); rect(g, ux + 10, b - 9, 2, 1, 'lamp'); }
}

/* ------------------------------ roof and tower frames ------------------------------ */

function advPaintRoof(g, lay, kind) {
  const L = advLook[kind] || advLook.day, ix = lay.ix, yb = advTop - 4;
  rect(g, advBX, yb, lay.wallR + 2 - advBX, 4, 'steelD'); rect(g, advBX, yb, lay.wallR + 2 - advBX, 1, 'steel'); rect(g, advBX, yb + 3, lay.wallR + 2 - advBX, 1, 'ink');
  rect(g, advBX, yb - 3, 1, 3, 'steelL'); rect(g, lay.wallR + 1, yb - 3, 1, 3, 'steelL'); rect(g, advBX, yb - 3, lay.wallR + 2 - advBX, 1, 'steelL');
  const tx = Math.max(ix + lay.iw - 134, lay.roof.x + lay.roof.w + 8);   // water tank, clear of the sign
  rect(g, tx + 2, yb - 8, 2, 8, 'woodD'); rect(g, tx + 18, yb - 8, 2, 8, 'woodD'); rect(g, tx, yb - 24, 22, 17, 'ink'); rect(g, tx + 1, yb - 23, 20, 15, 'wood'); rect(g, tx + 1, yb - 23, 20, 1, 'woodL');
  for (let k = 5; k < 21; k += 5) rect(g, tx + k, yb - 22, 1, 14, 'woodD');
  rect(g, tx - 1, yb - 14, 24, 1, 'steel'); rect(g, tx + 10, yb - 28, 3, 4, 'ink');
  const r = lay.roof;                                               // sign board
  rect(g, r.x + 2, yb - 8, 2, 8, 'steel'); rect(g, r.x + r.w - 4, yb - 8, 2, 8, 'steel');
  rect(g, r.x, r.y, r.w, r.h, 'ink'); rect(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 'woodD'); drawText(g, r.text, r.x + 6, r.y + 1, 'lamp');
  rect(g, ix + 30, yb - 10, 18, 10, 'steel'); rect(g, ix + 30, yb - 10, 18, 1, 'ink');                     // air conditioning
  for (let k = 3; k < 17; k += 3) rect(g, ix + 30 + k, yb - 8, 1, 7, 'steelD');
  rect(g, ix + 54, yb - 7, 12, 7, 'steel'); rect(g, ix + 54, yb - 7, 12, 1, 'ink');
  rect(g, lay.stairX0 + 6, yb - 16, 4, 16, 'pot'); rect(g, lay.stairX0 + 6, yb - 16, 1, 16, 'woodL'); rect(g, lay.stairX0 + 5, yb - 18, 6, 3, 'brick');   // chimney
  rect(g, lay.e1 - 6, yb - 28, 1, 28, 'steelL'); rect(g, lay.e1 - 10, yb - 22, 9, 1, 'steelL'); rect(g, lay.e1 - 9, yb - 15, 7, 1, 'steelL');             // antenna
}

/* ------------------------------ cache of what does not move ------------------------------ */

let advCache = null;                             // { c, g } world + pad
let advCacheKey = '';
let advCacheMask = -1;
let advCacheVer = -1;
let advCachePx = 0;
let advCachePy = 0;
let advCacheKind = '';
let advBuiltTop = -1;

function advBuiltMask() {
  let m = 0;
  for (let i = 0; i < FLOORS.length && i < 30; i++) if (FLOORS[i].p >= 1) m |= 1 << i;
  return m;
}

function advBakeStatic(lay, kind, mask) {
  const W = lay.w + 2 * advPx, H = lay.h + 2 * advPy;
  if (!advCache || advCache.c.width !== W || advCache.c.height !== H) advCache = makeBuffer(W, H);
  const g = advCache.g, back = advBackdrop(lay, kind);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(back, 0, 0);
  g.setTransform(1, 0, 0, 1, advPx, advPy);
  let top = -1;
  for (const lf of lay.floors) {
    if (lf.fl.p < 1) continue;
    advPaintFloor(g, lay, lf, advFull, kind, back);
    if (lf.index > top) top = lf.index;
  }
  advBuiltTop = top;
  tubPaintPipe(g, lay, top);
  if (top >= 0) {
    const y0 = lay.floors[top].ty;
    rect(g, advBX, y0 - 4, lay.wallR + 2 - advBX, 4, 'steelD'); rect(g, advBX, y0 - 4, lay.wallR + 2 - advBX, 1, 'steel'); rect(g, advBX, y0 - 1, lay.wallR + 2 - advBX, 1, 'ink');
    if (top === lay.n - 1 && mask === (1 << lay.n) - 1) advPaintRoof(g, lay, kind);
  }
  rect(g, advBX - 2, lay.gy - 1, lay.wallR + 6 - advBX, 1, 'ink');
  g.setTransform(1, 0, 0, 1, 0, 0);
  advCacheVer = lay.ver; advCacheKind = kind; advCacheMask = mask; advCachePx = advPx; advCachePy = advPy;
}

/* ------------------------------ marks, plaques, bubbles ------------------------------ */

const advPlaced = new Float32Array(4 * 128);     // rects taken this frame: x, y, w, h
let advPlacedN = 0;
const advBub = [];                               // speech boxes drawn this frame: [x, y, w, h, conv]
let advBubN = 0;
const advPrefs = new WeakMap();                  // Conversation -> candidate index that worked last time
const advSpot = [];                              // people shown in the spotlight: records
const advHl = [];                                // ids of advHighlight
const advView = { x0: 0, y0: 0, x1: 0, y1: 0 };
const advPickOut = { kind: null, id: null };
let advFlash = null;                             // { i, t }

function advTake(x, y, w, h) {
  if (advPlacedN >= 128) return;
  const o = advPlacedN * 4;
  advPlaced[o] = x; advPlaced[o + 1] = y; advPlaced[o + 2] = w; advPlaced[o + 3] = h;
  advPlacedN++;
}

/** True when the box touches no static label (room names, signs) and nothing taken this frame. */
function advFreeLabels(x, y, w, h) {
  for (let i = 0; i < advPlacedN; i++) {
    const o = i * 4;
    if (x < advPlaced[o] + advPlaced[o + 2] + 1 && x + w + 1 > advPlaced[o] && y < advPlaced[o + 1] + advPlaced[o + 3] + 1 && y + h + 1 > advPlaced[o + 1]) return false;
  }
  const L = advLay.labels;
  for (let i = 0; i < L.length; i++) {
    const r = L[i];
    if (x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y) return false;
  }
  return true;
}

function advFree(x, y, w, h) {
  const v = advView;
  if (x < v.x0 || y < v.y0 || x + w > v.x1 || y + h > v.y1) return false;
  for (let i = 0; i < advPlacedN; i++) {
    const o = i * 4;
    if (x < advPlaced[o] + advPlaced[o + 2] + 1 && x + w + 1 > advPlaced[o] && y < advPlaced[o + 1] + advPlaced[o + 3] + 1 && y + h + 1 > advPlaced[o + 1]) return false;
  }
  const L = advLay.labels;
  for (let i = 0; i < L.length; i++) {
    const r = L[i];
    if (x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y) return false;
  }
  return true;
}

function advHeadY(rec) {
  return Math.round(rec.y) - (rec.seat || (rec.px.seated && !rec.moving) ? 19 : 21);
}

/** The « ? » and « ! » of someone who waits or is in error: over the head, else beside it when a room name is there; left out when nothing is free. */
function advDrawIcon(g, rec, T) {
  const s = rec.p.info ? rec.p.info.state : '';
  if (s !== 'waiting' && s !== 'error') return;
  const hx = Math.round(rec.x), hy0 = advHeadY(rec) - 12, bob = REDUCED ? 0 : ((T * 3) | 0) & 1;
  let hx2 = hx, hy = hy0;
  let ok = false;
  for (let k = 0; k < 5 && !ok; k++) {
    hx2 = hx + (k === 1 ? 10 : k === 2 ? -10 : k === 3 ? 18 : k === 4 ? -18 : 0);
    hy = hy0 + (k === 0 ? 0 : 5);
    ok = advFreeLabels(hx2 - 5, hy - 2, 11, 12);
  }
  if (!ok) return;
  hy += bob;
  if (s === 'waiting') {
    rect(g, hx2 - 4, hy - 1, 9, 10, 'lamp'); rect(g, hx2 - 3, hy, 7, 8, 'white'); rect(g, hx2 - 1, hy + 9, 3, 1, 'lamp'); rect(g, hx2, hy + 8, 1, 1, 'white');
    drawText(g, '?', hx2 - 2, hy - 1, 'wood');
  } else {
    rect(g, hx2 - 4, hy - 1, 9, 10, 'red'); rect(g, hx2 - 3, hy, 7, 8, 'brick'); rect(g, hx2 - 1, hy + 9, 3, 1, 'red');
    drawText(g, '!', hx2, hy - 1, 'white');
  }
  advTake(hx2 - 5, hy - bob - 2, 11, 13);
}

/** A name over a floor line, stacked upwards until it finds a free place. */
function advDrawPlaque(g, rec, fg) {
  const p = rec.p, title = p.info && p.info.title ? p.info.title : 'Agent';
  if (rec.tower) return;                          // a rider has left the floor its plaque would name
  if (rec.nameSrc !== title) { rec.nameSrc = title; rec.name = advClip(title, 120); rec.nameW = textWidth(rec.name) + 6; }
  const name = rec.name, w = rec.nameW, lay = advLay, lf = lay.floors[p.floor ? p.floor.index : 0];
  if (!lf) return;
  // inside the interior of its floor, under the ceiling beam and over the heads; beside the head when something is over it
  const y = lf.ty + 11, x0 = Math.round(rec.x - w / 2), xmin = lay.stairX0 + 1, xmax = lay.e1 - 1;
  for (let s = 0; s < 40; s++) {
    const dx = s === 0 ? 0 : ((s + 1) >> 1) * 6 * (s & 1 ? 1 : -1);
    const x = x0 + dx;
    if (x - 1 < xmin || x + w + 1 > xmax) continue;
    if (advFree(x - 1, y - 1, w + 2, 12)) {
      advPlate(g, name, x + w / 2, y, fg, 'night');
      advTake(x - 1, y - 1, w + 2, 12);
      return;
    }
  }
}

const advSpotXY = { x: 0, y: 0 };

/** Candidate c of a speech bubble of size w x h for a speaker: above the head, stacked higher, shifted aside, then under the feet. True when it is free (the place is in advSpotXY). */
function advTryBubble(c, w, h, hx, headY, feetY) {
  const row = c % 6, col = (c / 6) | 0;
  const dx = col === 0 ? 0 : col === 1 ? -((w >> 1) + 10) : col === 2 ? (w >> 1) + 10 : col === 3 ? -(w + 14) : (w + 14);
  const x = clamp(hx - (w >> 1) + dx, advView.x0 + 1, Math.max(advView.x0 + 1, advView.x1 - w - 1));
  const y = row < 5 ? headY - h - 8 - row * 13 : feetY + 6;
  if (!advFree(x, y, w, h)) return false;
  advSpotXY.x = x; advSpotXY.y = y;
  return true;
}

function advDrawBubble(g, cv, rec) {
  const cur = cv.cur, w = cur.w, h = cur.h, hx = Math.round(rec.x), headY = advHeadY(rec), feetY = Math.round(rec.y);
  const pref = advPrefs.get(cv);
  let found = -1;
  if (pref !== undefined && advTryBubble(pref, w, h, hx, headY, feetY)) found = pref;
  else for (let c = 0; c < 30; c++) if (advTryBubble(c, w, h, hx, headY, feetY)) { found = c; break; }
  if (found < 0) return;
  const bx = advSpotXY.x, by = advSpotXY.y;
  advPrefs.set(cv, found);
  g.drawImage(cv.buf.c, bx, by);
  advTake(bx, by, w, h);
  // the tail: from the box towards the speaker's head
  const below = by > headY;
  const tx = clamp(hx, bx + 4, bx + w - 5), fill = cv.fill || 'white';
  if (below) {
    rect(g, tx - 2, by - 1, 1, 1, 'ink'); rect(g, tx - 1, by - 1, 3, 1, fill); rect(g, tx + 2, by - 1, 1, 1, 'ink');
    rect(g, tx - 1, by - 2, 1, 1, 'ink'); rect(g, tx, by - 2, 1, 1, fill); rect(g, tx + 1, by - 2, 1, 1, 'ink'); rect(g, tx, by - 3, 1, 1, 'ink');
  } else {
    for (let yy = by + h + 1; yy < headY - 2; yy += 2) rect(g, hx, yy, 1, 1, 'steel');
    rect(g, tx - 2, by + h, 1, 1, 'ink'); rect(g, tx - 1, by + h, 3, 1, fill); rect(g, tx + 2, by + h, 1, 1, 'ink');
    rect(g, tx - 1, by + h + 1, 1, 1, 'ink'); rect(g, tx, by + h + 1, 1, 1, fill); rect(g, tx + 1, by + h + 1, 1, 1, 'ink'); rect(g, tx, by + h + 2, 1, 1, 'ink');
  }
  if (advBubN < advBub.length) { const o = advBub[advBubN]; o[0] = bx; o[1] = by; o[2] = w; o[3] = h; o[4] = cv; }
  else advBub.push([bx, by, w, h, cv]);
  advBubN++;
}

/* ------------------------------ dynamic parts of a frame ------------------------------ */

function advMonitorColour(occ, T) {
  if (!occ || !occ.present || !occ.info) return null;
  const s = occ.info.state;
  if (s === 'running') return 'screen';
  if (s === 'waiting') return ((T * 2) | 0) & 1 ? 'lampHi' : 'lamp';
  if (s === 'error') return ((T * 3) | 0) & 1 ? 'red' : 'brick';
  return null;
}

/** Desk fronts over the seated people (monitor lit by the state of the occupant), then the night lamps. */
function advDrawDesks(g, lay, T, night) {
  for (let f = 0; f < lay.floors.length; f++) {
    const lf = lay.floors[f];
    if (lf.fl.p < 1) continue;
    for (let d = 0; d < lf.deskList.length; d++) {
      const dl = lf.deskList[d];
      const occ = dl.ownerId ? personById(dl.ownerId) : null;
      const sitting = !!(occ && occ.seated && occ.present && occ.visible);
      const sc = sitting ? advMonitorColour(occ, T) : null;
      advDeskFront(g, dl.ux, lf.b, sc, T, night && sitting && occ.info && occ.info.state === 'running');
      if (sc === 'screen' && occ.pose === 'type' && !REDUCED) { const k = ((T * 9) | 0) % 2; rect(g, dl.ux + 1, lf.b - 6 + k, 2, 1, occ.look.skin); rect(g, dl.ux + 10, lf.b - 5 - k, 2, 1, occ.look.skin); }
    }
  }
}

/** Machines at work (the fx timers of the floor), the board of a meeting, the door of the entrance. */
function advDrawFx(g, lay, T) {
  for (let f = 0; f < lay.floors.length; f++) {
    const lf = lay.floors[f], fl = lf.fl;
    if (fl.p < 1 || !lf.cafe) continue;
    const c = lf.cafe, b = lf.b, fx = fl.fx;
    if (fx) {
      if (fx.coffee > 0) { rect(g, c.coffee + 4, b - 12, 1, 1 + (((T * 4) | 0) & 1), 'pot'); rect(g, c.coffee + 3, b - 8, 3, 2, 'white'); }
      if (fx.print > 0) { const u = 1 - fx.print / 2.6, off = Math.round(u * 8); rect(g, c.printer + 3, b - 18 - (off % 5), 6, 2, 'white'); rect(g, c.printer + 4, b - 18 - (off % 5), 4, 1, 'steelL'); }
      if (fx.micro > 0) { rect(g, c.micro + 3, b - 16, 6, 3, 'lamp'); rect(g, c.micro + 4 + (((T * 8) | 0) & 3), b - 15, 1, 1, 'lampHi'); }
      if (fx.board > 0) advDrawBoard(g, lf, fx.board);
    }
    if (((T * 3) | 0) % 7 === 0) rect(g, c.fountain + 1 + (((T * 8) | 0) & 3), b - 13 + (((T * 4) | 0) % 3), 1, 1, 'white');
  }
  const g0 = lay.floors[0];
  if (g0 && g0.fl.doors && g0.fl.doors.entry > 0.05) { const o = Math.round(g0.fl.doors.entry * 7); rect(g, advBX + 10 - o, g0.ty + 15, o * 2, 35, 'night'); }
}

const advBoard = [['r', 'carpA', 4, 3, 7, 5], ['l', 'red', 11, 5, 5, 1], ['r', 'carpA', 16, 3, 7, 5], ['l', 'ink', 7, 8, 1, 4], ['r', 'pot', 3, 12, 8, 4], ['l', 'ink', 11, 14, 4, 1], ['r', 'leafD', 15, 12, 8, 4], ['l', 'red', 19, 8, 1, 4], ['l', 'ink', 4, 17, 16, 1]];
function advDrawBoard(g, lf, p) {
  const bx = lf.boardX, by = lf.ty + 18, n = Math.floor(p * advBoard.length + 0.01);
  for (let k = 0; k < Math.min(n, advBoard.length); k++) {
    const s = advBoard[k];
    if (s[0] === 'r') { rect(g, bx + s[2], by + s[3], s[4], 1, s[1]); rect(g, bx + s[2], by + s[3] + s[5] - 1, s[4], 1, s[1]); rect(g, bx + s[2], by + s[3], 1, s[5], s[1]); rect(g, bx + s[2] + s[4] - 1, by + s[3], 1, s[5], s[1]); }
    else rect(g, bx + s[2], by + s[3], s[4], s[5], s[1]);
  }
}

/** The one cab of the building: cables, the cab at the height of LIFT.y, its door leaves, the lamps of the landing. */
function advDrawLift(g, lay, T) {
  const n = lay.n;
  if (!n || !FLOORS[0].plan) return;
  const r = advRideY(LIFT.y), cx = lay.e0 + 2, yb = clamp(r.y, lay.floors[n - 1].f, lay.floors[0].f);   // feet line of the cab floor
  const top = lay.floors[n - 1].ty + 10;
  rect(g, lay.e0 + 9, top, 1, Math.max(0, Math.round(yb - 42 - top)), 'steel'); rect(g, lay.e0 + 12, top, 1, Math.max(0, Math.round(yb - 42 - top)), 'steel');
  const y0 = Math.round(yb) - 41;
  rect(g, cx, y0, 18, 43, 'ink'); rect(g, cx + 1, y0 + 1, 16, 41, 'night'); rect(g, cx + 1, y0 + 1, 16, 2, 'woodL'); rect(g, cx + 1, y0 + 39, 16, 2, 'steel');
  advCabLeaves = Math.round((1 - LIFT.door) * 3);
  // lamps: the landing where the cab waits, open
  if (!LIFT.moving && LIFT.door > 0.4) { const lf = lay.floors[LIFT.fl]; if (lf) rect(g, lay.e0 + 9, lf.ty + 7, 4, 1, 'lampHi'); }
}
let advCabLeaves = 0;

function advDrawCabFront(g, lay) {
  const n = lay.n;
  if (!n || !FLOORS[0].plan) return;
  const r = advRideY(LIFT.y), cx = lay.e0 + 2, y0 = Math.round(clamp(r.y, lay.floors[n - 1].f, lay.floors[0].f)) - 41, w = 3 + advCabLeaves;
  rect(g, cx + 1, y0 + 3, w, 38, 'steel'); rect(g, cx + 1, y0 + 3, 1, 38, 'steelL');
  rect(g, cx + 17 - w, y0 + 3, w, 38, 'steel'); rect(g, cx + 16, y0 + 3, 1, 38, 'steelD');
}

/** Little puffs for the people who sip, smoke or sleep (layer -1 of the particle pool). */
function advEmit(rec, dt) {
  const p = rec.p;
  if (REDUCED || rec.moving || rec.tower) return;
  const pose = rec.px.pose, prop = p.prop;
  let every = 0, kind = 0, ox = 5, oy = -17, vx = 0, vy = -7, life = 1.2;
  if (prop === 'cup' || prop === 'glass' || prop === 'bowl') { every = 0.9; kind = PART.steam; }
  else if (prop === 'cigarette') { every = 0.5; kind = PART.smoke; ox = rec.px.dir === 'left' ? -8 : 8; oy = -15; vy = -9; life = 2.2; }
  else if (pose === 'sleep') { every = 1.4; kind = PART.zzz; ox = 4; oy = -19; vx = 5; vy = -6; life = 2.2; }
  if (!every) { rec.fxT = 0; return; }
  rec.fxT += dt;
  if (rec.fxT >= every) { rec.fxT = 0; emitParticle(-1, kind, rec.x + ox, rec.y + oy, vx, vy, life); }
}

/* ------------------------------ the camera ------------------------------ */

let advSeenT = -10;                              // T of the last frame drawn: a gap means the view was just shown
let advLastT = 0;
const advFitKey = { vw: 0, vh: 0, dpr: 0, lw: 0, lh: 0, ir: 0 };
let advGoal = null;                              // { x, y }: where the camera eases to, null: nowhere
let advLastX = 0;
let advLastY = 0;

/** Whole building when it fits at 2 css px per pixel or more (largest integer zoom), else x2 css and scrolling (the rule of navFitZoom). */
function advFit(lay, floorIndex) {
  const cam = advCam;
  if (!cam.viewW || !lay) return;
  const ins = cam.insets, dpr = cam.dpr, zk = cam.zoom;
  // the insets are in logical px at the zoom they were measured for: work in device px, so that the choice does not depend on it
  const insX = (ins.left + ins.right) * zk, insY = (ins.top + ins.bottom) * zk;
  let best = 0;
  for (const z of ZOOMS) {
    if (z / dpr >= 2 && lay.w * z + insX <= cam.viewW * dpr && lay.h * z + insY <= cam.viewH * dpr) best = z;
  }
  const fits = best > 0;
  if (!fits) best = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(1, Math.round(2 * dpr)));   // never under 2 css px per pixel: the view scrolls
  cam.setZoom(best);
  cam.clampTo(lay.w, lay.h);
  if (!fits) {
    const lf = lay.floors[Math.max(0, Math.min(lay.n - 1, floorIndex))];
    // a phone starts at the stairs, a wide view on the middle of the building
    const k = zk / best;   // the insets are measured again at the new zoom: nav.js does it next frame
    cam.x = cam.viewW < 600 ? lay.stairX0 - 14 : Math.round((lay.w - cam.bw + (ins.right - ins.left) * k) / 2);
    cam.y = Math.round((lf ? lf.ty + advIH / 2 : lay.h / 2) - cam.bh / 2);
    cam.clampTo(lay.w, lay.h);
  }
  advGoal = null;
  advLastX = cam.x; advLastY = cam.y;
}

function advCamera(lay, T, dt) {
  const cam = advCam;
  if (!cam.viewW) return;
  const f = advFitKey;
  const ir = Math.round((cam.insets.right * cam.zoom) / 16);   // the journal, in 16 device px
  const changed = f.vw !== cam.viewW || f.vh !== cam.viewH || f.dpr !== cam.dpr || f.lw !== lay.w || f.lh !== lay.h || f.ir !== ir;
  if (T - advSeenT > 0.25 || changed) {
    f.vw = cam.viewW; f.vh = cam.viewH; f.dpr = cam.dpr; f.lw = lay.w; f.lh = lay.h; f.ir = ir;
    advFit(lay, typeof NAV !== 'undefined' ? NAV.floor : 0);
  } else if (advGoal) {
    if (cam.x !== advLastX || cam.y !== advLastY) advGoal = null;   // somebody dragged: the goal is forgotten
    else {
      const k = REDUCED ? 1 : Math.min(1, dt * 7);
      const dx = advGoal.x - cam.x, dy = advGoal.y - cam.y;
      cam.x = Math.abs(dx) <= 1 || k >= 1 ? advGoal.x : cam.x + (Math.round(dx * k) || Math.sign(dx));
      cam.y = Math.abs(dy) <= 1 || k >= 1 ? advGoal.y : cam.y + (Math.round(dy * k) || Math.sign(dy));
      if (cam.x === advGoal.x && cam.y === advGoal.y) advGoal = null;
    }
  }
  cam.clampTo(lay.w, lay.h);
  advLastX = cam.x; advLastY = cam.y;
  const ins = cam.insets;
  advView.x0 = cam.x + ins.left; advView.y0 = cam.y + ins.top; advView.x1 = cam.x + cam.bw - ins.right; advView.y1 = cam.y + cam.bh - ins.bottom;
}

/* ------------------------------ the frame ------------------------------ */

/** Margins of sky wide enough to fill the view around the building, at least advPad, at most 480; they only grow while a layout lasts. */
function advPads(lay) {
  if (lay.ver !== advPadVer) { advPadVer = lay.ver; advPx = advPad; advPy = advPad; }
  const nx = clamp(Math.ceil((advCam.bw - lay.w) / 2) + 16, advPad, 480), ny = clamp(Math.ceil((advCam.bh - lay.h) / 2) + 16, advPad, 480);
  if (nx > advPx) advPx = nx;
  if (ny > advPy) advPy = ny;
}

/** The cutaway into the buffer g (the size of advCam). Leaves an identity transform. */
function renderAdvanced(g, T) {
  if (!advLay || advStale()) advLayout(FLOORS);
  const lay = advLay, cam = advCam;
  const dt = Math.max(0, Math.min(0.05, T - advLastT));
  advLastT = T;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  rect(g, 0, 0, cam.bw, cam.bh, 'ink');
  if (!lay.n) { advSeenT = T; return; }
  advCamera(lay, T, dt);
  advSeenT = T;
  const kind = advKindOf(), mask = advBuiltMask();
  advPads(lay);
  if (advCacheVer !== lay.ver || advCacheKind !== kind || advCacheMask !== mask || advCachePx !== advPx || advCachePy !== advPy) advBakeStatic(lay, kind, mask);
  const back = advBackdrop(lay, kind);
  g.drawImage(advCache.c, -cam.x - advPx, -cam.y - advPy);
  g.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
  const night = kind === 'night' || kind === 'dusk';
  // floors being built or pulled down, the street traffic
  for (let f = 0; f < lay.n; f++) { const lf = lay.floors[f]; if (lf.fl.p < 1) advPaintFloor(g, lay, lf, advStage(lf.fl.p), kind, back); }
  advDrawTraffic(g, lay, T, night);
  tubDrawSite(g, lay, T);
  advDrawLift(g, lay, T);
  advPlaceAll(dt);
  advPlacedN = 0; advBubN = 0;
  // people: seated ones, then the desk fronts over them, then everybody else sorted by depth
  const list = advDrawn;
  for (let i = 0; i < list.length; i++) { const r = list[i]; if (r.seat) pplDraw(g, r.px, r.x, r.y, T); }
  advDrawDesks(g, lay, T, night);
  advSortDepth(list);
  for (let i = 0; i < list.length; i++) { const r = list[i]; if (!r.seat) pplDraw(g, r.px, r.x, r.y, T); advEmit(r, dt); }
  advDrawCabFront(g, lay);
  advDrawFx(g, lay, T);
  drawCapsules(g, T);
  if (tubBusy()) advDrawLabels(g, lay);
  drawParticles(g, -1, T);
  drawCrane(g, T);
  // the spotlight: the « Qui m'attend » filter and the journal's highlight dim the rest and redraw the chosen people
  const waitOn = typeof pplWaitFilter !== 'undefined' && pplWaitFilter;
  advSpot.length = 0;
  if (waitOn || advHl.length) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i], st = r.p.info ? r.p.info.state : '';
      if ((waitOn && st === 'waiting') || (advHl.length && advHl.indexOf(r.p.id) >= 0)) advSpot.push(r);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.66;
    rect(g, 0, 0, cam.bw, cam.bh, 'ink');
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
    for (let i = 0; i < advSpot.length; i++) { const r = advSpot[i]; pplDraw(g, r.px, r.x, r.y, T); }
    drawCrane(g, T);
  }
  // rings, icons, names, speech
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (advHl.length && advHl.indexOf(r.p.id) >= 0) advRing(g, r, 'lamp');
    advDrawIcon(g, r, T);
  }
  const sel = typeof pplSelected !== 'undefined' ? pplSelected : null;
  for (let i = 0; i < list.length; i++) {
    const r = list[i], p = r.p, st = p.info ? p.info.state : '';
    if (st === 'waiting' || p.id === sel || (advHl.length && advHl.indexOf(p.id) >= 0)) advDrawPlaque(g, r, st === 'waiting' ? 'lampHi' : 'white');
  }
  for (let i = 0; i < CONVERSATIONS.length; i++) {
    const cv = CONVERSATIONS[i];
    if (cv.phase !== 'talk' || !cv.cur || !cv.buf) continue;
    const sp = cv.parts[cv.cur.who], rec = sp ? advRecs.get(sp) : null;
    if (!rec || !rec.vis || rec.tower) continue;
    if (waitOn && !(sp.info && sp.info.state === 'waiting')) continue;
    advDrawBubble(g, cv, rec);
  }
  if (advFlash) {
    advFlash.t -= dt;
    if (advFlash.t <= 0) advFlash = null;
    else if (REDUCED || ((advFlash.t * 6) | 0) & 1) {
      const lf = lay.floors[advFlash.i];
      if (lf) { rect(g, advBX, lf.ty, lay.wallR + 2 - advBX, 1, 'lamp'); rect(g, advBX, lf.ty + advIH + 3, lay.wallR + 2 - advBX, 1, 'lamp'); rect(g, advBX, lf.ty, 1, advIH + 3, 'lamp'); rect(g, lay.wallR + 1, lf.ty, 1, advIH + 3, 'lamp'); }
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** Insertion sort by depth: the list is nearly sorted from one frame to the next, and nothing is allocated. */
function advSortDepth(list) {
  for (let i = 1; i < list.length; i++) {
    const r = list[i];
    let j = i - 1;
    while (j >= 0 && (list[j].y > r.y || (list[j].y === r.y && list[j].x > r.x))) { list[j + 1] = list[j]; j--; }
    list[j + 1] = r;
  }
}

function advRing(g, rec, c) {
  const x = Math.round(rec.x), y = Math.round(rec.y);
  rect(g, x - 8, y + 2, 16, 1, c); rect(g, x - 8, y + 1, 1, 2, c); rect(g, x + 7, y + 1, 1, 2, c);
}

/** Two cars on the street, from the clock. */
let advCars = null;
function advDrawTraffic(g, lay, T, night) {
  if (!advCars) {
    advCars = [];
    for (const [col, right] of [['red', true], ['glass', false], ['lamp', true]]) {
      const b = makeBuffer(22, 9), c = b.g;
      c.save();
      if (!right) { c.translate(22, 0); c.scale(-1, 1); }
      rect(c, 0, 3, 22, 5, 'ink'); rect(c, 4, 0, 13, 4, 'ink'); rect(c, 1, 4, 20, 3, col); rect(c, 5, 1, 11, 3, col); rect(c, 1, 4, 20, 1, 'white');
      rect(c, 6, 2, 4, 2, 'glassHi'); rect(c, 11, 2, 4, 2, 'glassHi'); rect(c, 10, 1, 1, 3, col);
      rect(c, 3, 6, 4, 3, 'ink'); rect(c, 15, 6, 4, 3, 'ink'); rect(c, 4, 7, 2, 1, 'steelL'); rect(c, 16, 7, 2, 1, 'steelL'); rect(c, 21, 4, 1, 2, 'lampHi'); rect(c, 0, 4, 1, 2, 'red');
      c.restore();
      advCars.push({ c: b.c, right });
    }
  }
  const t = REDUCED ? 0 : T, span = lay.w + 120;
  for (let k = 0; k < advCars.length; k++) {
    const car = advCars[k], sp = 18 + k * 7;
    let x = (k * 190 + (car.right ? 1 : -1) * sp * t) % span;
    if (x < 0) x += span;
    g.drawImage(car.c, Math.round(x - 60), lay.gy + (car.right ? 5 : 11));
  }
}

/* ------------------------------ picking, highlight, focus ------------------------------ */

/** What is under a world point of the cutaway: a speech bubble, a person, else the floor band. A reused object, or null. */
function advPick(wx, wy) {
  const o = advPickOut;
  for (let i = advBubN - 1; i >= 0; i--) {
    const b = advBub[i];
    if (wx >= b[0] && wx <= b[0] + b[2] && wy >= b[1] && wy <= b[1] + b[3] + 4) { o.kind = 'bubble'; o.id = b[4].id; return o; }
  }
  let best = null;
  for (let i = 0; i < advDrawn.length; i++) {
    const r = advDrawn[i];
    if (Math.abs(wx - r.x) <= 7 && wy - r.y >= -20 && wy - r.y <= 3 && (!best || r.y > best.y || (r.y === best.y && r.x > best.x))) best = r;
  }
  if (best) { o.kind = 'person'; o.id = best.p.id; return o; }
  if (advLay) for (let f = 0; f < advLay.n; f++) { const lf = advLay.floors[f]; if (wy >= lf.ty && wy < lf.ty + advFH && wx >= advBX && wx <= advLay.wallR) { o.kind = 'floor'; o.id = lf.index; return o; } }
  return null;
}

/** Journal hover: rings and names on these people, the rest dimmed; null clears it. */
function advHighlight(ids) {
  advHl.length = 0;
  if (ids) for (const id of ids) if (id) advHl.push(id);
}

/** Camera to this person, as a click on a journal line does: zoomed in enough to read, the floor flashes. */
function advFocus(id) {
  const p = personById(id);
  if (!p || !p.floor) return;
  if (!advLay || advStale()) advLayout(FLOORS);
  const cam = advCam, rec = advRecs.get(p);
  let x, y;
  if (rec && rec.vis) { x = rec.x; y = rec.y; } else { const o = advPlace(p); x = o.x; y = o.y; }
  if (cam.zoom / cam.dpr < 3) {
    let z = ZOOMS[ZOOMS.length - 1];
    for (const k of ZOOMS) if (k / cam.dpr >= 3) { z = k; break; }
    cam.setZoom(z);
  }
  advGoal = { x: Math.round(x - cam.bw / 2), y: Math.round(y - 20 - cam.bh / 2) };
  advLastX = cam.x; advLastY = cam.y;
  advFlash = { i: p.floor.index, t: 1.2 };
}
