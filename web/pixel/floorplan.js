/* web/pixel/floorplan.js : lot L3, voir docs/vue-pixel.md (2.4)
   PURE: no DOM, no other file, nothing runs at load. Names of the 2.4 block are public, every other top-level name wears `fpl`.

   Units. Plan coordinates: px from the top left corner of a floor plate; the grid is CELL (8 px) square, `cols` x PLATE_ROWS.
   - rects of plan.offices, plan.rooms, plan.open, plan.furniture, plan.cafeteria, plan.hall, plan.entrance: CELLS {x, y, w, h};
   - Desk.x, Desk.y, Desk.w: PX (the desk top, 40 x 12 px); Desk.seat, Desk.approach: cells; plan.rooms[].header: PX {x, y, w} (22 px strip);
   - plan.door, plan.landY, plan.lights: PX; door of an office and of a room, every Spot: cells.
   - a room rect is its left wall plus its interior: the right wall is the first column of the next rect, or the column after the last one
     (neighbouring rooms share a wall, so rects never overlap). Interior = rect.x + 1 to rect.x + rect.w - 1, rows rect.y + 1 to rect.y + rect.h - 2.
   Additions to the 2.4 shapes (all additive):
   - Spot may carry `px`, `py` (feet position in px of someone sitting): sofa and bench. `x, y` stay the walkable cell in front of the seat.
   - plan.standing: ids of the agents of the spec that got no desk (the plate is full): they work standing in the open space.
   - furniture[].z: sort depth in px, the y a person's feet must pass to be drawn in front of it; smaller draws first.
     kind: 'plant' | 'printer' | 'board' | 'clock' | 'sign' (chef panel) | 'fridge' | 'micro' | 'coffee' | 'cooler' | 'vend' | 'toilet'
     | 'table' (with its two chairs) | 'sofa' (the back sorts at z, the seat 12 px later) | 'bench' | 'meet' | 'lounge' | 'recep'.
     The rect is the blocking footprint, or the anchor of a wall piece; the sprite may reach out of it (a plant grows upwards).
   Desk positions: 3 rows at y 118, 164, 210 in a room (manager first, then agents row by row), the seat is the cell above the desk. */

const CELL = 8;                                  // placement and collision grid, px
const PLATE_ROWS = 44;
const PLATE_H = 352;
const SLAB = 16;
const BLOCK = PLATE_H + SLAB;                    // 368
const STAIRS_W = 56;
const LIFT_W = 44;
const SKY_H = 80;
const GROUND_H = 24;
const COLS_MIN = 62;
const COLS_MAX = 96;

// Rows of a plate, px (the 2.4 template: back wall 16, head zone to 64, rooms 64 to 264, corridor, cafeteria wall, entrance wall).
const fplBack = 16, fplRoomsY = 64, fplRoomH = 200, fplCorY = 264, fplCafeY = 272, fplCafeFloor = 296, fplEntY = 336;
const fplLandRow = 41;                         // the last walkable row: landings, smoking corner, entry
const fplLandY = fplLandRow * CELL + 7;      // feet line of a person on a landing (335)
const fplDeskW = 40, fplDeskH = 12, fplColW = 68, fplHdr = 30;
const fplDeskRows = [118, 164, 210];           // desk tops: the manager row and two rows of agents (46 px apart at least: the name fits under the desk)
const fplMaxPerRoom = 8, fplMaxOffices = 3, fplOfficePitch = 232;
const fplStairFlights = 10, fplStairXl = -42, fplStairXr = -12;

// Typed arrays shared by findPath and the reachability pass (a plate has 96 x 44 cells at most).
const fplCellsMax = COLS_MAX * PLATE_ROWS;
const fplQueue = new Int16Array(fplCellsMax);
const fplPrev = new Int16Array(fplCellsMax);
const fplSeen = new Uint32Array(fplCellsMax);
let fplStamp = 0;

function fplClamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fplCmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function fplByAge(a, b) { return (a.createdAt - b.createdAt) || fplCmp(a.id, b.id); }

/* ---------- the building ---------- */

function floorTitle(index) {
  return index <= 0 ? 'Rez-de-chaussée' : index === 1 ? '1er étage' : index + 'e étage';
}

function buildingSize(count, cols) {
  return { w: STAIRS_W + cols * CELL + LIFT_W, h: SKY_H + count * BLOCK + GROUND_H };
}

function floorTop(index, count) { return SKY_H + (count - 1 - index) * BLOCK; }

function floorAtY(wy, count) {
  if (!(count > 0) || wy < SKY_H || wy >= SKY_H + count * BLOCK) return -1;
  return count - 1 - Math.floor((wy - SKY_H) / BLOCK);
}

function floorScrollY(index, count, viewH) {
  if (index >= count - 1) return 0;
  const total = buildingSize(count, 0).h;
  let y = floorTop(index, count) - SLAB;         // the slab above (with the name), then the plate
  if (viewH > BLOCK) y -= Math.floor((viewH - BLOCK) / 2);
  return Math.round(fplClamp(y, 0, Math.max(0, total - viewH)));
}

function stairPoints(index, count) {
  if (index < 0 || index >= count - 1) return [];
  const yb = floorTop(index, count) + fplLandY;
  const pts = [[fplStairXr, yb]];
  for (let k = 0; k < fplStairFlights; k++) {
    pts.push([k % 2 ? fplStairXr : fplStairXl, yb - Math.round((k + 1) * BLOCK / fplStairFlights)]);
  }
  return pts;
}

/* ---------- from the state to floors ---------- */

function fplColorKey(service) {
  if (!service) return 'misc';
  const s = String(service).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/^dev/.test(s)) return 'dev';
  if (/^arch/.test(s)) return 'arch';
  if (/^design/.test(s)) return 'design';
  if (/^(qual|qa|test)/.test(s)) return 'qa';
  if (/^prod/.test(s)) return 'prod';
  return 'misc';
}

function fplCount(agents, state) { return agents.filter((a) => a.state === state).length; }

function fplSpec(id, name, list, index) {
  const all = [];
  for (const t of list) for (const a of t.agents) all.push(a);
  const byId = new Map(all.map((a) => [a.id, a]));

  // Glass offices: teams whose root is a chef with at least one child, the oldest first (stable), three at most.
  const chefTeams = list.filter((t) => t.agents.length > 1 && t.agents[0].role === 'chef')
    .sort((a, b) => fplByAge(a.agents[0], b.agents[0])).slice(0, fplMaxOffices);
  const officeChefs = new Set(chefTeams.map((t) => t.agents[0].id));
  const offices = chefTeams.map((t) => ({ teamId: t.id, chefId: t.agents[0].id, title: t.agents[0].title }));

  // Rooms: one per manager; an agent sits in the room of its nearest manager ancestor, else in the open space.
  const managers = all.filter((a) => a.role === 'manager').sort(fplByAge);
  const members = new Map(managers.map((m) => [m.id, []]));
  const open = [];
  for (const a of all) {
    if (a.role === 'manager' || officeChefs.has(a.id)) continue;
    let home = null, up = a.parentId, hops = 0;
    while (up && hops++ < 20) {
      const u = byId.get(up);
      if (!u) break;
      if (u.role === 'manager') { home = u; break; }
      up = u.parentId;
    }
    (home ? members.get(home.id) : open).push(a);
  }
  const rooms = managers.map((m) => ({
    key: 'room:' + m.id, managerId: m.id, service: m.service || null, title: m.title, colorKey: fplColorKey(m.service),
    agentIds: members.get(m.id).sort(fplByAge).map((a) => a.id),
  }));

  return {
    id, name, index, title: floorTitle(index),
    offices, rooms,
    open: open.sort(fplByAge).map((a) => a.id),
    stats: {
      total: all.length, running: fplCount(all, 'running'), waiting: fplCount(all, 'waiting'),
      queued: fplCount(all, 'queued'), done: fplCount(all, 'done'), error: fplCount(all, 'error'),
    },
    missions: list.filter((t) => t.mission).map((t) => ({ id: t.mission.id, status: t.mission.status, title: t.mission.title })),
  };
}

function planBuilding(office, memo) {
  const teams = (office && office.teams) || [];
  const projects = (office && office.projects) || [];
  const stored = Array.isArray(memo)
    ? memo.filter((id, i, all) => typeof id === 'string' && id !== '' && all.indexOf(id) === i) : [];

  // Teams by project, most recent first (ties by id: the plan never depends on the input order).
  const byProject = new Map();
  for (const t of teams) {
    if (!t.agents || !t.agents.length) continue;
    const id = t.projectId == null ? '' : t.projectId;
    if (!byProject.has(id)) byProject.set(id, []);
    byProject.get(id).push(t);
  }
  for (const list of byProject.values()) list.sort((a, b) => (b.lastActivity - a.lastActivity) || fplCmp(a.id, b.id));

  // Order: the memo as it is, then the new projects in projects.list order (unknown ones last). The ground floor is always first.
  const rank = (id) => { const k = projects.findIndex((p) => p.id === id); return k < 0 ? projects.length : k; };
  const fresh = [...byProject.keys()].filter((id) => id !== '' && !stored.includes(id))
    .sort((a, b) => (rank(a) - rank(b)) || fplCmp(a, b));
  const order = stored.filter((id) => byProject.has(id)).concat(fresh);

  const nameOf = (id, list) => {
    const p = projects.find((q) => q.id === id);
    return (p && p.name) || (list[0] && list[0].projectName) || 'Projet sans nom';
  };
  const floors = [fplSpec('', 'Sans projet', byProject.get('') || [], 0)];
  for (const id of order) {
    const list = byProject.get(id);
    floors.push(fplSpec(id, nameOf(id, list), list, floors.length));
  }
  return { floors, order };
}

/* ---------- widths ---------- */

// The head zone (offices, printer, plants) and the rows of rooms and desks, for `limit` cells of width.
// Rooms keep their capacity when they fit; else the widest lose columns, then the last ones are dropped. What does not fit stands in the open space.
function fplSizing(spec, limit) {
  let offices = (spec.offices || []).slice(0, fplMaxOffices);
  const headNeed = (n) => (n ? 16 + fplOfficePitch * n : 248) / CELL + 7;   // printer, then a plant and the free column on the right
  while (offices.length && headNeed(offices.length) > limit) offices = offices.slice(0, -1);
  const droppedChefs = (spec.offices || []).slice(offices.length).map((o) => o.chefId);

  const roomW = (c) => Math.floor((c * fplColW + 16) / CELL);
  const rooms = (spec.rooms || []).map((r) => ({ src: r, cols: Math.max(1, Math.ceil(Math.min(r.agentIds.length, fplMaxPerRoom) / 2)) }));
  const edgeOf = () => { let cur = 2; for (const r of rooms) cur += roomW(r.cols) - 1; return cur + 1; };   // first cell after the last wall
  const droppedRooms = [];
  while (rooms.length && edgeOf() + 2 > limit) {
    let best = -1;
    for (let i = 0; i < rooms.length; i++) if (rooms[i].cols > 1 && (best < 0 || rooms[i].cols >= rooms[best].cols)) best = i;
    if (best >= 0) rooms[best].cols--;
    else droppedRooms.push(rooms.pop());
  }

  let openIds = (spec.open || []).concat(droppedChefs);
  for (const r of rooms) openIds = openIds.concat(r.src.agentIds.slice(r.cols * 2));
  for (const r of droppedRooms) openIds = openIds.concat([r.src.managerId], r.src.agentIds);

  const fx = rooms.length ? edgeOf() : 3;
  const openW = (c) => Math.ceil((c * fplColW + 8) / CELL);
  let ocols = Math.ceil(openIds.length / 3);
  while (ocols > 0 && fx + openW(ocols) + 2 > limit) ocols--;
  const wo = ocols ? openW(ocols) : 0;
  const need = Math.max(headNeed(offices.length), rooms.length ? edgeOf() + 2 : 0, ocols ? fx + wo + 2 : 0);
  return { offices, rooms, openIds, fx, ocols, wo, need, edge: rooms.length ? edgeOf() : 0 };
}

function buildingCols(specs) {
  let need = COLS_MIN;
  for (const spec of specs || []) need = Math.max(need, fplSizing(spec, 1e9).need);
  return Math.min(COLS_MAX, need);
}

/* ---------- one plate ---------- */

function fplBlock(plan, x, y, w, h) {
  const gw = plan.cols;
  const x0 = Math.max(0, Math.floor(x / CELL)), x1 = Math.min(gw, Math.ceil((x + w) / CELL));
  const y0 = Math.max(0, Math.floor(y / CELL)), y1 = Math.min(PLATE_ROWS, Math.ceil((y + h) / CELL));
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) plan.blocked[j * gw + i] = 1;
}

function fplFurniture(plan, kind, x, y, w, h, z) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  plan.furniture.push({ kind, x: cx, y: cy, w: Math.ceil((x + w) / CELL) - cx, h: Math.ceil((y + h) / CELL) - cy, z });
}

function fplDesk(plan, where, k, x, y, ownerId) {
  const d = {
    id: where + '#' + k, where, x, y, w: fplDeskW,
    seat: { x: (x + fplDeskW / 2) >> 3, y: (y >> 3) - 1 },
    approach: { x: (x >> 3) - 1, y: y >> 3 },
    ownerId: ownerId || null, facing: 'down',
  };
  fplBlock(plan, x, y, fplDeskW, fplDeskH);
  plan.desks.push(d);
  plan.lights.push({ x: x + fplDeskW / 2, y, r: where.indexOf('office:') === 0 ? 24 : 18, desk: d.id });
  return d;
}

function layoutFloor(spec, cols) {
  cols = fplClamp(Math.round(cols) || COLS_MIN, COLS_MIN, COLS_MAX);
  const W = cols * CELL, GW = cols;
  const sz = fplSizing(spec, cols);
  const plan = {
    id: spec.id, name: spec.name, spec, cols, rows: PLATE_ROWS, width: W, height: PLATE_H,
    blocked: new Uint8Array(cols * PLATE_ROWS),
    offices: [], rooms: [], open: { rect: { x: sz.fx, y: 9, w: sz.wo, h: sz.wo ? 22 : 0 }, desks: [] }, desks: [],
    spots: { coffee: [], micro: [], fountain: [], printer: [], window: [], smoke: [], rail: [], sofa: [], bench: [], board: [], plant: [], stairs: [], lift: [], entry: [] },
    cafeteria: null, hall: null, entrance: null, door: null, landY: fplLandY, lights: [], furniture: [], standing: [],
  };
  const sp = plan.spots;
  const plants = [];

  // Outer walls: back wall, side walls with a 2 row passage to each tower at the landing, entrance wall.
  fplBlock(plan, 0, 0, W, fplBack);
  fplBlock(plan, 0, 0, CELL, 320); fplBlock(plan, 0, 336, CELL, 16);
  fplBlock(plan, W - CELL, 0, CELL, 320); fplBlock(plan, W - CELL, 336, CELL, 16);
  fplBlock(plan, 0, fplEntY, W, PLATE_H - fplEntY);

  // Glass offices of the chefs, left to right, each followed by its mission panel. A box is 120 x 40 px (rows 2 to 6) and row 7 stays a
  // free walkway under all of them, so that the strips between two offices (board, printer, windows) are never shut in.
  const nOff = sz.offices.length;
  sz.offices.forEach((o, k) => {
    const x0 = 16 + fplOfficePitch * k, bx = x0 >> 3;
    fplBlock(plan, x0, 16, 8, 40); fplBlock(plan, x0 + 112, 16, 8, 16); fplBlock(plan, x0, 48, 120, 8);
    const desk = fplDesk(plan, 'office:' + o.teamId, 0, x0 + 40, 36, o.chefId);
    fplBlock(plan, x0 + 128, 32, 88, 24);
    fplFurniture(plan, 'sign', x0 + 128, 32, 88, 24, 56);
    plan.offices.push({ teamId: o.teamId, chefId: o.chefId, rect: { x: bx, y: 2, w: 15, h: 5 }, door: { x: bx + 14, y: 4 }, desk, sign: o.title });
    plants.push({ c: bx + 15, r: 2, water: true }, { c: bx + 27, r: 2, water: true });
  });
  if (!nOff) plants.push({ c: 28, r: 2, water: true });
  plants.push({ c: GW - 4, r: 2, water: true });

  // Rooms: a glass-free box per manager, header strip, manager desk then two rows of agent desks, door in the bottom wall.
  let cur = 2;
  for (const r of sz.rooms) {
    const w = Math.floor((r.cols * fplColW + 16) / CELL), x = cur;
    cur += w - 1;
    const inner = w * CELL - 16, ix = (x + 1) * CELL, cw = inner / r.cols;
    const gx = x + Math.floor((w * CELL - 24) / 16);               // 3 cell door gap in the bottom wall
    fplBlock(plan, x * CELL, fplRoomsY, w * CELL, 8);
    fplBlock(plan, x * CELL, fplRoomsY, 8, fplRoomH); fplBlock(plan, (x + w - 1) * CELL, fplRoomsY, 8, fplRoomH);
    fplBlock(plan, x * CELL, 256, (gx - x) * CELL, 8); fplBlock(plan, (gx + 3) * CELL, 256, (x + w - gx - 3) * CELL, 8);
    const desks = [fplDesk(plan, r.src.key, 0, ix + ((inner - fplDeskW) >> 1), fplDeskRows[0], r.src.managerId)];
    for (let k = 1; k <= r.cols * 2; k++) {
      const row = 1 + Math.floor((k - 1) / r.cols), c = (k - 1) % r.cols;
      desks.push(fplDesk(plan, r.src.key, k, ix + Math.floor(c * cw + (cw - fplDeskW) / 2), fplDeskRows[row], r.src.agentIds[k - 1]));
    }
    plan.rooms.push({
      key: r.src.key, managerId: r.src.managerId, colorKey: r.src.colorKey, title: r.src.title,
      rect: { x, y: 8, w: w - 1, h: 25 }, door: { x: gx + 1, y: 32 }, header: { x: (x + 1) * CELL, y: fplRoomsY + 9, w: (w - 2) * CELL },
      cols: r.cols, desks,
    });
  }

  // Open space: desks by columns of three, filled by age; the agents the plate cannot seat stand.
  for (let k = 0; k < sz.ocols * 3; k++) {
    const c = Math.floor(k / 3);
    plan.open.desks.push(fplDesk(plan, 'open', k, sz.fx * CELL + 18 + c * fplColW, fplDeskRows[k % 3], sz.openIds[k]));
  }
  plan.standing = sz.openIds.slice(sz.ocols * 3);
  if (sz.ocols) plants.push({ c: sz.fx + (sz.wo >> 1) - 1, r: 32, water: true });

  // What is left of the rooms row: a meeting table and a lounge, so a small floor does not look abandoned.
  const usedPx = sz.ocols ? (sz.fx + sz.wo) * CELL + 16 : sz.rooms.length ? (cur) * CELL : 16;
  if (W - 8 - usedPx >= 150) {
    const tx = (usedPx + 24) & ~7, ty = 160, lx = tx + 96 + 24, lw = W - 8 - 16 - lx;
    fplBlock(plan, tx - 8, ty - 14, 112, 52); fplFurniture(plan, 'meet', tx - 8, ty - 14, 112, 52, ty + 24);
    plan.lights.push({ x: tx + 48, y: ty + 12, r: 30, desk: null });
    if (lw >= 64) {
      fplBlock(plan, lx, 100, lw, 116); fplFurniture(plan, 'lounge', lx, 100, lw, 116, 216);
      plan.lights.push({ x: lx + lw / 2, y: 158, r: 36, desk: null });
    }
  }
  if (spec.id === '' && usedPx <= 200) { fplBlock(plan, 216, 220, 104, 20); fplFurniture(plan, 'recep', 216, 220, 104, 20, 240); }

  // Back wall: board, clock, printer; their spots lie on the head zone passage (rows 2 and 3).
  const printX = nOff ? 16 + fplOfficePitch * nOff : 248, pc = printX >> 3;
  fplBlock(plan, printX, 16, 24, 8); fplFurniture(plan, 'printer', printX, 16, 24, 8, 24);
  fplFurniture(plan, 'board', 152, 0, 72, 16, 4); fplFurniture(plan, 'clock', 324, 0, 11, 16, 3);
  sp.printer.push({ x: pc, y: 3, f: 'up' }, { x: pc + 1, y: 3, f: 'up' });
  for (let k = 0; k < 6; k++) sp.board.push({ x: 19 + k, y: 3, f: 'up' });
  plan.lights.push({ x: 188, y: 24, r: 20, desk: null }, { x: printX + 12, y: 28, r: 14, desk: null });

  // Plants (2 x 1 cells at their base) and their watering spots below.
  const lampX = Math.round(W * 0.4 / 8) * 8 + 32 + 30;
  plants.push({ c: ((W - 120) >> 3) - 2, r: fplLandRow, water: false }, { c: (lampX >> 3) + 3, r: fplLandRow, water: false });
  for (const p of plants) {
    fplBlock(plan, p.c * CELL, p.r * CELL, 16, 8);
    fplFurniture(plan, 'plant', p.c * CELL, p.r * CELL, 16, 8, p.r * CELL + 8);
    if (p.water) sp.plant.push({ x: p.c, y: p.r + 1, f: 'up' });
  }

  // Cafeteria wall (rows 34 to 36) from x 24 to the right wall, appliances on it, tables and sofa below.
  const cafeX1 = W - 120;
  fplBlock(plan, 24, fplCafeY, W - 32, 24);
  fplFurniture(plan, 'fridge', 24, 264, 20, 32, fplCafeY + 1);
  fplFurniture(plan, 'micro', 122, 274, 18, 12, fplCafeY + 1);
  fplFurniture(plan, 'coffee', 144, 265, 18, 22, fplCafeY + 1);
  fplFurniture(plan, 'cooler', 186, 266, 12, 30, fplCafeY + 1);
  fplFurniture(plan, 'vend', 208, 264, 28, 32, fplCafeY + 1);
  fplFurniture(plan, 'vend', 240, 264, 28, 32, fplCafeY + 1);
  for (let k = 0; k < 2; k++) fplFurniture(plan, 'toilet', W - 112 + k * 40, 266, 24, 30, fplCafeY + 1);
  sp.coffee.push({ x: 18, y: 37, f: 'up' }, { x: 19, y: 37, f: 'up' });
  sp.micro.push({ x: 16, y: 37, f: 'up' });
  sp.fountain.push({ x: 23, y: 37, f: 'up' });
  for (const tx of [136, 200, 264]) {
    if (tx + 32 >= cafeX1) continue;
    fplBlock(plan, tx - 8, 304, 40, 18); fplFurniture(plan, 'table', tx - 8, 304, 40, 18, 320);
  }
  fplBlock(plan, 24, 320, 80, 16); fplFurniture(plan, 'sofa', 24, 320, 80, 16, 326);
  for (let k = 0; k < 4; k++) { const px = 36 + k * 18; sp.sofa.push({ x: px >> 3, y: 39, f: 'down', px, py: 333 }); }
  fplBlock(plan, W - 112, 322, 32, 10); fplFurniture(plan, 'bench', W - 112, 322, 32, 10, 332);
  for (let k = 0; k < 2; k++) { const px = W - 104 + k * 16; sp.bench.push({ x: px >> 3, y: 39, f: 'down', px: px + 4, py: 332 }); }
  plan.lights.push({ x: 153, y: 287, r: 26, desk: null }, { x: 56, y: 336, r: 30, desk: null }, { x: 34, y: 284, r: 14, desk: null },
    { x: 228, y: 288, r: 18, desk: null }, { x: W - 80, y: 286, r: 26, desk: null });

  // Entrance strip: door, smoking corner, rail, towers' landings.
  const dx = Math.round(W * 0.4 / 8) * 8, dc = dx >> 3;
  plan.door = { x: dx, y: fplEntY, w: 32, h: 16 };
  sp.smoke.push({ x: dc - 4, y: fplLandRow, f: 'right' }, { x: dc - 2, y: fplLandRow, f: 'left' });
  sp.rail.push({ x: dc + 5, y: fplLandRow, f: 'down' }, { x: dc + 8, y: fplLandRow, f: 'down' });
  if (spec.id === '') sp.entry.push({ x: dc + 1, y: fplLandRow, f: 'down' });
  sp.stairs.push({ x: 1, y: fplLandRow, f: 'left' });
  sp.lift.push({ x: GW - 2, y: fplLandRow, f: 'right' });
  plan.lights.push({ x: lampX, y: fplEntY - 8, r: 22, desk: null }, { x: 10, y: 324, r: 12, desk: null }, { x: W - 10, y: 324, r: 12, desk: null });
  plan.cafeteria = { x: 1, y: 34, w: (cafeX1 >> 3) - 1, h: 8 };
  plan.hall = { x: cafeX1 >> 3, y: 34, w: GW - 1 - (cafeX1 >> 3), h: 8 };
  plan.entrance = { x: 1, y: fplLandRow, w: GW - 2, h: 3 };

  // Window spots (back wall, row 2): every 5 cells from the right half, not inside a glass office.
  const inOffice = (c) => plan.offices.some((o) => c >= o.rect.x && c <= o.rect.x + o.rect.w - 1);
  const free = (c) => c >= 1 && c < GW - 1 && !plan.blocked[2 * GW + c] && !inOffice(c);
  for (let c = 37; c <= GW - 6; c += 5) if (free(c)) sp.window.push({ x: c, y: 2, f: 'up' });
  for (let c = GW - 3; sp.window.length < 2 && c > 2; c -= 5) if (free(c)) sp.window.push({ x: c, y: 2, f: 'up' });

  // Whatever the layout left cut off from the landing is closed, so every free cell can be reached.
  fplFill(plan, 1, fplLandRow);
  for (let i = 0; i < GW * PLATE_ROWS; i++) if (!plan.blocked[i] && fplSeen[i] !== fplStamp) plan.blocked[i] = 1;
  return plan;
}

/* ---------- paths ---------- */

function fplNextStamp() {
  if (++fplStamp >= 0xfffffff0) { fplSeen.fill(0); fplStamp = 1; }
  return fplStamp;
}

// Marks (fplSeen = current stamp) every cell reachable from (sx, sy) without crossing a blocked cell.
function fplFill(plan, sx, sy) {
  const gw = plan.cols, gh = plan.rows, blocked = plan.blocked, stamp = fplNextStamp();
  let qh = 0, qt = 0;
  fplQueue[qt++] = sy * gw + sx;
  fplSeen[sy * gw + sx] = stamp;
  while (qh < qt) {
    const c = fplQueue[qh++], cx = c % gw, cy = (c - cx) / gw;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const n = ny * gw + nx;
      if (blocked[n] || fplSeen[n] === stamp) continue;
      fplSeen[n] = stamp;
      fplQueue[qt++] = n;
    }
  }
}

function findPath(plan, sx, sy, tx, ty) {
  const gw = plan.cols, gh = plan.rows, blocked = plan.blocked;
  if (sx < 0 || sy < 0 || sx >= gw || sy >= gh || tx < 0 || ty < 0 || tx >= gw || ty >= gh) return null;
  const s = sy * gw + sx, g = ty * gw + tx;
  if (s === g) return [];
  const stamp = fplNextStamp();
  let qh = 0, qt = 0, found = false;
  fplQueue[qt++] = s;
  fplSeen[s] = stamp;
  fplPrev[s] = -1;
  while (qh < qt && !found) {
    const c = fplQueue[qh++], cx = c % gw, cy = (c - cx) / gw;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const n = ny * gw + nx;
      if (fplSeen[n] === stamp || (blocked[n] && n !== g)) continue;
      fplSeen[n] = stamp;
      fplPrev[n] = c;
      if (n === g) { found = true; break; }
      fplQueue[qt++] = n;
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = g; c !== s; c = fplPrev[c]) cells.push(c);
  cells.reverse();
  // Merge straight runs: keep the corners and the goal.
  const out = [];
  let px = sx, py = sy, dx = 0, dy = 0;
  for (let i = 0; i < cells.length; i++) {
    const x = cells[i] % gw, y = (cells[i] - x) / gw, ddx = x - px, ddy = y - py;
    if (i > 0 && (ddx !== dx || ddy !== dy)) out.push([px, py]);
    dx = ddx; dy = ddy; px = x; py = y;
  }
  out.push([px, py]);
  return out;
}

function freeCellNear(plan, cx, cy) {
  const gw = plan.cols, gh = plan.rows, blocked = plan.blocked;
  cx = fplClamp(Math.round(cx), 0, gw - 1);
  cy = fplClamp(Math.round(cy), 0, gh - 1);
  if (!blocked[cy * gw + cx]) return [cx, cy];
  let best = null, bd = 1e9;
  for (let r = 1; r <= Math.max(gw, gh); r++) {
    if (best && r * r > bd) break;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= gh) continue;
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        const x = cx + dx;
        if (x < 0 || x >= gw || blocked[y * gw + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd || (d === bd && (y < best[1] || (y === best[1] && x < best[0])))) { bd = d; best = [x, y]; }
      }
    }
  }
  return best || [cx, cy];
}
