/* web/immeuble/etages.js: part of the building view, owned by the « immeuble » module (see docs/vue-immeuble.md). */
/* ================================================================ world: floors */
const D = 16, W = 15, ZW = 5, ZD = 7, BH = 84, FH = 12, FHt = 94, DOORX = 7;
const floors = [];
const agents = [];
const AGM = new Map();
const agentById = (id) => { const a = AGM.get(id); return a && a.alive ? a : undefined; };
let LOW = false;
const KK = (x, y) => (x + 20) * 100 + (y + 20);

/* ---- capacity: what planImmeuble reads. Upper floors: 4 zones of 6 desks; the ground floor keeps the chef office, so 3 zones. */
const CAPACITE = {zones: (i) => i === 0 ? 3 : 4, seats: 6};
/* zone slots: a zone takes the first free slot of its floor, in this order (x0, y0 of a 5 x 7 block) */
const SLOTS_G = [{x0: 5, y0: 0, row: 'back'}, {x0: 10, y0: 0, row: 'back'}, {x0: 0, y0: 9, row: 'front'}];
const SLOTS_U = [{x0: 0, y0: 0, row: 'back'}, {x0: 5, y0: 0, row: 'back'}, {x0: 10, y0: 0, row: 'back'}, {x0: 0, y0: 9, row: 'front'}];
/* desks of a zone, relative to its block: lead first (seat 0), then 5 more; the chair is one tile south of the desk */
const ZREL = [{rx: 1, ry: 1, seat: [1, 2]}, {rx: 3, ry: 1, seat: [3, 2]}, {rx: 0, ry: 3, seat: [0, 4]}, {rx: 3, ry: 3, seat: [3, 4]}, {rx: 0, ry: 5, seat: [0, 6]}, {rx: 3, ry: 5, seat: [3, 6]}];
/* places to stand for the members who have no desk (aisle, then the row against the wall) */
const ZSTAND = [[2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [0, 1], [1, 0], [2, 0], [3, 0], [0, 0], [4, 0]];

/* ---- colour of a zone: the maquette palette for the six known services, a stable colour from a hash otherwise */
const SVCPAL = [['architecture', 'arch'], ['design', 'design'], ['developpement', 'dev'], ['produit', 'prod'], ['qualite', 'qual'], ['donnees', 'data']];
const foldName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function hsl2hex(h, s, l){
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hx(f(0) * 255, f(8) * 255, f(4) * 255);
}
const HUES = [340, 52, 190, 300, 88, 4, 140, 255], HPAL = new Map();
function zonePal(spec){
  for(const c of [spec.colorKey, spec.service, spec.label]){
    const k = foldName(c); if(!k) continue;
    for(const [name, key] of SVCPAL) if(k === key || k === name || k.indexOf(name) === 0) return PAL[key];
  }
  const seed = foldName(spec.colorKey || spec.service || spec.label || spec.key), hs = hashS(seed), h = (HUES[hs % HUES.length] + ((hs >>> 8) % 21) - 10 + 360) % 360;
  let p = HPAL.get(h);
  if(!p){ p = {floor: hsl2hex(h, 26, 27), grid: hsl2hex(h, 26, 29.5), line: hsl2hex(h, 28, 36), wall: hsl2hex(h, 44, 66)}; HPAL.set(h, p); }
  return p;
}


/* ================================================================ contract: floors and zones */
/* new floor on top. animate: chantier (crane, slab, walls, furniture) then the floor closes; reduced motion builds it at once. */
function addFloor(spec, animate){ return newFloor(spec, !!animate && !reduced, true); }
/* spec: FloorSpec. A zone not built yet takes a free slot (zone chantier when animate); a zone that left the spec stays, empty. */
function updateFloor(fl, spec, animate){
  fl.spec = spec; fl.stats = spec.stats; fl.missions = spec.missions; fl.chefId = spec.chefId;
  if(spec.name) fl.name = spec.name;
  let dirty = false;
  const cap = CAPACITE.zones(fl.i);
  for(const zs of spec.zones || []){
    const z = fl.zones.find((q) => q.key === zs.key);
    if(z){
      const pal = zonePal(zs);
      z.name = zs.label; z.service = zs.service || zs.label; z.colorKey = zs.colorKey;
      if(z.pal !== pal){ z.pal = pal; for(const a of fl.areas) if(a.zone === z) a.pal = pal; dirty = true; }
      continue;
    }
    if(fl.zones.length >= cap) continue;
    const si = freeZoneSlot(fl); if(si < 0) continue;
    addZone(fl, zs, si, !!animate && !reduced && !(fl.plot && !fl.plot.done));
    dirty = true;
  }
  if(dirty){ rebuildFacade(fl); fl.ver++; }
}
/* seat 0 = lead, 'chef' = the glass office; null when the zone or the seat does not exist */
function deskFor(fl, zoneKey, seat){
  if(zoneKey === 'chef') return fl.chefDesk || null;
  const z = fl.zones.find((q) => q.key === zoneKey);
  return z ? z.desks[seat] || null : null;
}
/* built = no chantier (or demolition) under way and no fall in progress after a floor below was demolished */
const floorBuilt = (fl) => (!fl.plot || fl.plot.done) && !(fl.drop > 0);
function zoneBuilt(fl, zoneKey){ const z = fl.zones.find((q) => q.key === zoneKey); return !z || !z.plot || z.plot.done; }
function freeZoneSlot(fl){ for(let s = 0; s < fl.slots.length; s++) if(!fl.zones.some((z) => z.slot === s)) return s; return -1; }

/* ---- chantier plumbing: items built while BP is a plot appear along its timeline; BP null = there at once */
let BP = null, BZ = null;
const TMF = {back: (i) => 5600 + i * 40, part: (i) => 6300 + i * 40, plaque: 8200, furn: (fl) => 7800 + Math.min(fl.fi++ * 26, 1900)};
const TMZ = {back: (i) => 2300 + i * 50, part: (i) => 2200 + i * 55, plaque: 6500, furn: () => 3700 + Math.min(BZ.fi++ * 95, 2600)};
let TM = TMF;
function onAct(fl, fn){ if(BP && !BP.done) BP.act.push(fn); else fn(); }
function S(fl, cx, cy, kind, fn, o){
  const it = Object.assign({fl, cx, cy, kind, fn, t0: 0, dur: 450, b: 0, pl: BP}, o || {});
  fl.st.push(it); return it;
}
function addShadow(fl, x, y, w, d, h, t0){ fl.sh.push({x, y, w, d, h, t0: t0 || 0, pl: BP}); }
function blockCells(fl, x, y, w, d){ onAct(fl, () => { for(let i = 0; i < w; i++) for(let j = 0; j < d; j++) fl.blk.add(KK(x + i, y + j)); }); }
function edgeV(fl, x0, x1, y, skip){ onAct(fl, () => { for(let x = x0; x < x1; x++) if(!(skip && skip.includes(x))) fl.vb.add(KK(x, y)); }); }
function edgeH(fl, x, y0, y1, skip){ onAct(fl, () => { for(let y = y0; y < y1; y++) if(!(skip && skip.includes(y))) fl.hb.add(KK(x, y)); }); }
function furn(fl, cx, cy, fn, shadow, o){
  const t0 = o && o.t0 !== undefined ? o.t0 : TM.furn(fl);
  const it = S(fl, cx, cy, 'pop', fn, Object.assign({t0, dur: 450}, o || {}));
  if(shadow) addShadow(fl, shadow[0], shadow[1], shadow[2], shadow[3], shadow[4], t0);
  return it;
}
/* zone chantiers finish on their own clock: called once per frame by drawBuilding */
function tickPlots(){
  for(let i = 0; i < floors.length; i++){
    const fl = floors[i], zs = fl.zones;
    for(let k = 0; k < zs.length; k++){
      const p = zs[k].plot;
      if(p && !p.done && T - p.start >= p.dur){ p.done = true; for(const f of p.act.splice(0)) f(); fl.sortN = -1; fl.ver++; }
    }
  }
}

function newFloor(spec, dynamic, startNow){
  const i = floors.length, ground = i === 0;
  const fl = {i, id: spec.id, name: spec.name, spec, stats: spec.stats, missions: spec.missions, chefId: spec.chefId, ground, slots: ground ? SLOTS_G : SLOTS_U,
    z0: i * FHt, drop: 0, zones: [], areas: [], st: [], sh: [], desks: [], fix: [], blk: new Set(), vb: new Set(), hb: new Set(), fi: 0, plot: null, chefDesk: null, vis: 1, lift: 0, op: dynamic ? 1 : 0, act: 0, actS: 0, n: 0, nAtt: 0, nAmb: 0, ag: [], agk: [], tc: {}, sorted: [], sortRA: NaN, sortN: -1, wr: null, belt: [], winL: [], bd: [], office: null, rugs: [], ver: 0,
    spots: {counter: [{c:[11, 10], busy:false}, {c:[12, 10], busy:false}],
            table: [{c:[10, 12], busy:false}, {c:[12, 12], busy:false}, {c:[12, 13], busy:false}, {c:[14, 13], busy:false}],
            idle: [{c:[10, 14], busy:false}, {c:[11, 14], busy:false}, {c:[12, 15], busy:false}, {c:[13, 15], busy:false}, {c:[11, 11], busy:false}, {c:[13, 11], busy:false}],
            bench: [{c:[5, 12], busy:false, d:[5.75, 12.5]}, {c:[5, 13], busy:false, d:[5.75, 13.5]}, {c:[5, 14], busy:false, d:[5.75, 14.5]}],
            stand: []}};
  if(dynamic){
    fl.plot = mkPlot(!!startNow);
  }
  fl.wr = [0, 1, 2, 3].map((f) => { const r = mul32(hashS('wr' + spec.id + i + f)); return Array.from({length: 16}, () => r()); });
  floors.push(fl);
  BP = fl.plot; TM = TMF; BZ = null;
  buildFloor(fl, spec);
  BP = null;
  rebuildFacade(fl);
  return fl;
}

function buildFloor(fl, spec){
  const ground = fl.ground;
  const A = (x0, y0, x1, y1, pal, type) => { const a = {x0, y0, x1, y1, pal, type}; fl.areas.push(a); return a; };
  A(0, 7, 15, 9, PAL.hall, 'corr');
  if(ground){ A(5, 9, 10, 16, PAL.lobby, 'lobby'); chefGround(fl, A); }
  else { A(5, 9, 10, 12, PAL.lobby, 'lobby'); chefLobby(fl, A); }
  A(10, 9, 15, 16, PAL.cafe, 'cafe');
  /* zones, then the free slots */
  const cap = CAPACITE.zones(fl.i);
  let n = 0;
  for(const zs of spec.zones || []){ if(n >= cap) break; addZone(fl, zs, n, false); n++; }
  for(let s = 0; s < fl.slots.length; s++) if(!fl.zones.some((z) => z.slot === s)) freeArea(fl, s);
  /* outer walls */
  const wt = (base, i, k) => base + i * k;
  for(let x = 0; x < W; x++){
    S(fl, x + .5, -.15, 'wall', (e) => drawWallN(fl, x, e), {t0: wt(5600, x, 40), dur: 450});
    if(!(ground && (x === DOORX || x === DOORX + 1))) S(fl, x + .5, D + .12, 'wall', (e) => drawWallS(fl, x, e), {t0: wt(6300, x, 40), dur: 450});
    onAct(fl, () => { if(!(ground && (x === DOORX || x === DOORX + 1))) fl.vb.add(KK(x, D)); });
  }
  for(let y = 0; y < D; y++){
    S(fl, -.15, y + .5, 'wall', (e) => drawWallW(fl, y, e), {t0: wt(5700, y, 40), dur: 450});
    S(fl, W + .15, y + .5, 'wall', (e) => drawWallE(fl, y, e), {t0: wt(6000, y, 40), dur: 450});
  }
  /* corridor, lobby, cafeteria, elevator */
  plant(fl, 9.2, 7.6, 1); plant(fl, 14.2, 7.6, 2); plant(fl, .3, 8.6, 3);
  plant(fl, 9.3, 15.1, 5); blockCells(fl, 9, 15, 1, 1);
  plant(fl, 14.3, 15.1, 6); blockCells(fl, 14, 15, 1, 1);
  floorLamp(fl, 9.55, 14.4);
  cafeteria(fl);
  elevator(fl);
  if(ground){
    plant(fl, 9.2, 9.7, 4); blockCells(fl, 9, 9, 1, 1);
    plant(fl, 4.2, 15, 7);
    furn(fl, 5.5, 13.5, () => drawBench(), [5.02, 11.95, .9, 3.1, 30]);
    blockCells(fl, 5, 12, 1, 3);
    fl.rugs.push({x: 7.05, y: 15.15, w: 1.9, d: .85, c: '#2a3446', e: '#8FD9C4', t0: 0});
    S(fl, 8, D + .15, 'door', () => drawLobbyDoor(fl), {pts: [[7, D], [9, D]], b: .02});
    furn(fl, 6.2, 15.2, () => drawCoatRack(6.2, 15.2), null);
    furn(fl, 6.9, 10.2, () => drawBin(6.9, 10.2), null);
  } else {
    plant(fl, 5.35, 9.7, 4); blockCells(fl, 5, 9, 1, 1);
    fl.rugs.push({x: 5.7, y: 10.1, w: 2.1, d: 1.4, c: '#3b4a63', e: '#8794AD', t0: 8000});
    floorLamp(fl, 7.7, 11.55);
  }
}

/* chef office of the ground floor: the maquette's glass office, back left */
function chefGround(fl, A){
  const a = A(0, 0, 5, 7, PAL.chef, 'chef'); a.win = {0: [[.2, 1.5]], 3: [[5.2, 6.6]]};
  fl.office = {x0: 0, x1: 5, y: 7, door: 3, px: .3, pw: 2.6, into: -1, sideX: 5, sy0: 0, sy1: 7, doorPt: [3.5, 7]};
  S(fl, 2.5, 0, 'decor', () => drawClock(fl), {t0: 8200, dur: 300, pts: [[1.5, 0], [3.5, 0]], b: .02});
  S(fl, 0, 2.8, 'decor', () => drawBoard(fl), {t0: 8200, dur: 300, pts: [[0, 1.2], [0, 4.4]], b: .02});
  furn(fl, 4, .6, () => drawBookshelf(), [3.1, .05, 1.8, .5, 46]);
  blockCells(fl, 3, 0, 2, 1);
  chefDesk(fl, 1, 1);
  fl.rugs.push({x: 1.2, y: 2.9, w: 2.6, d: 1.9, c: '#6b3f3a', e: '#c79a6b', t0: 7600});
  plant(fl, 4.2, 6.3, 0); blockCells(fl, 4, 6, 1, 1);
  glassOffice(fl);
}
/* upper floors: the chef office is the glass room south of the elevator lobby */
function chefLobby(fl, A){
  A(5, 12, 10, 16, PAL.chef, 'chef');
  fl.office = {x0: 5, x1: 10, y: 12, door: 6, px: 7.2, pw: 2.6, into: 1, sideX: 10, sy0: 12, sy1: 16, doorPt: [6.5, 12]};
  chefDesk(fl, 6, 13);
  fl.rugs.push({x: 5.7, y: 13.6, w: 2.6, d: 1.9, c: '#6b3f3a', e: '#c79a6b', t0: 7600});
  plant(fl, 5.4, 15.3, 0); blockCells(fl, 5, 15, 1, 1);
  glassOffice(fl);
}
function chefDesk(fl, x, y){
  const cd = {x, y, w: 2, seatC: [x, y + 1], zone: {id: 'chef', key: 'chef', pal: PAL.chef}, mgr: true, i: 0, agent: null, chef: true, h: 77, fl};
  fl.desks.push(cd); fl.chefDesk = cd; blockCells(fl, x, y, 2, 1);
  furn(fl, x + 1, y + .5, () => drawDesk(cd), [x, y, 2, 1, 16]);
  furn(fl, x + .5, y + 1.5, () => drawChair(x + .5, y + 1.5), null, {b: -.01});
}
function glassOffice(fl){
  const o = fl.office;
  S(fl, (o.x0 + o.x1) / 2, o.y, 'glass', () => glassFrontAt(fl, o), {t0: 8200, dur: 300, b: .3});
  S(fl, o.sideX, (o.sy0 + o.sy1) / 2, 'glass', () => glassSideAt(fl, o), {t0: 8200, dur: 300, b: .3});
  edgeV(fl, o.x0, o.x1, o.y, [o.door]); edgeH(fl, o.sideX, o.sy0, o.sy1);
}

/* free zone slot: open space that a zone replaces when it is built */
function freeArea(fl, s){
  const P = fl.slots[s];
  fl.areas.push({x0: P.x0, y0: P.y0, x1: P.x0 + ZW, y1: P.row === 'front' ? D : P.y0 + ZD, pal: PAL.hall, type: 'free', slot: s});
  const pl = (x, y, k) => { const it = furn(fl, x, y, () => drawPlant(x, y, k), null); it.slot = s; fl.fix.push({kind: 'plant', x, y, slot: s}); };
  pl(P.x0 + 1, P.y0 + 1.5, 8 + s); pl(P.x0 + 4, P.y0 + 5.2, 12 + s);
}
function clearFree(fl, s){
  fl.areas = fl.areas.filter((a) => a.slot !== s);
  fl.st = fl.st.filter((it) => it.slot !== s);
  fl.fix = fl.fix.filter((f) => f.slot !== s);
  fl.sortN = -1;
}

function addZone(fl, spec, si, own){
  clearFree(fl, si);
  const saveP = BP, saveTM = TM, saveZ = BZ;
  const z = {id: spec.key, key: spec.key, zi: fl.zones.length, slot: si, name: spec.label, service: spec.service || spec.label, colorKey: spec.colorKey, row: fl.slots[si].row, x0: fl.slots[si].x0, y0: fl.slots[si].y0, pal: zonePal(spec), desks: [], stand: [], fl, plot: null, fi: 0};
  if(own){ z.plot = {started: true, done: false, start: T, act: [], dur: 7600}; BP = z.plot; TM = TMZ; BZ = z; }
  else if(fl.plot && !fl.plot.done){ BP = fl.plot; TM = TMF; }
  fl.zones.push(z); fl.tc[z.id] = 0;
  mkZone(fl, z);
  BP = saveP; TM = saveTM; BZ = saveZ;
  return z;
}
function mkZone(fl, z){
  const x0 = z.x0, y0 = z.y0, back = z.row === 'back', tm = TM;
  fl.areas.push({x0, y0, x1: x0 + ZW, y1: back ? y0 + ZD : D, pal: z.pal, type: 'zone', zone: z});
  ZREL.forEach((r, i) => {
    const d = {x: x0 + r.rx, y: y0 + r.ry, w: 2, seatC: [x0 + r.seat[0], y0 + r.seat[1]], zone: z, mgr: i === 0, i, agent: null, h: hashS(z.key + z.slot + i + fl.id), fl};
    z.desks.push(d); fl.desks.push(d);
    blockCells(fl, d.x, d.y, 2, 1);
    furn(fl, d.x + 1, d.y + .5, () => drawDesk(d), [d.x, d.y, 2, 1, 16]);
    furn(fl, d.seatC[0] + .5, d.seatC[1] + .5, () => drawChair(d.seatC[0] + .5, d.seatC[1] + .5), null, {b: -.01});
  });
  for(const s of ZSTAND){ const sp = {c: [x0 + s[0], y0 + s[1]], busy: false, zone: z.key}; z.stand.push(sp); fl.spots.stand.push(sp); }
  const part = (xx, yy, horiz, i) => S(fl, xx + .5 + (horiz ? 0 : .07), yy + .5 + (horiz ? .07 : 0), 'wall', (e) => drawPart(xx, yy, horiz, z.pal.wall, e), {t0: tm.part(i), dur: 420});
  if(back){
    for(let i = 0; i < ZW; i++) if(i !== 2) part(x0 + i, y0 + ZD, true, i);
    for(let j = 0; j < ZD; j++) part(x0 + ZW, y0 + j, false, j);
    edgeV(fl, x0, x0 + ZW, y0 + ZD, [x0 + 2]);
    edgeH(fl, x0 + ZW, y0, y0 + ZD);
  } else {
    for(let i = 0; i < ZW; i++) S(fl, x0 + i + .5, y0 + .1, 'wall', (e) => drawBackPart(x0 + i, y0, z.pal.wall, e), {t0: tm.back(i), dur: 450});
    for(let j = 0; j < D - y0; j++) if(j !== 2) part(x0 + ZW, y0 + j, false, j);
    edgeV(fl, x0, x0 + ZW, y0);
    edgeH(fl, x0 + ZW, y0, D, [y0 + 2]);
  }
  const py = back ? 0 : y0 + .2, xs = back ? x0 + 1.35 : x0 + .9, w = back ? 2.3 : 3.2;
  S(fl, xs + w / 2, py, 'decor', () => drawPlaque(z), {t0: tm.plaque, dur: 300, pts: [[xs, py], [xs + w, py]], b: .02});
}

function plant(fl, x, y, i){
  furn(fl, x, y, () => drawPlant(x, y, i), null);
  fl.fix.push({kind: 'plant', x, y});
}
function floorLamp(fl, x, y){
  S(fl, x, y, 'flat', () => drawFloorLamp(x, y), {});
  fl.fix.push({kind: 'lamp', x, y});
}
function cafeteria(fl){
  const add = (cx, cy, fn, sh) => furn(fl, cx, cy, fn, sh);
  add(10.5, 9.5, () => drawFridge(10.1, 9.1), [10.1, 9.1, .85, .8, 56]); blockCells(fl, 10, 9, 1, 1);
  add(12, 9.5, () => drawCounter(11.05, 9.1), [11, 9.05, 2, .95, 30]); blockCells(fl, 11, 9, 2, 1);
  add(13.5, 9.5, () => drawVending(13.1, 9.1, 0), [13.1, 9.1, .8, .8, 60]); blockCells(fl, 13, 9, 1, 1);
  add(14.5, 9.5, () => drawVending(14.1, 9.1, 1), [14.1, 9.1, .8, .8, 60]); blockCells(fl, 14, 9, 1, 1);
  add(14.5, 11.5, () => drawCooler(14.5, 11.5), null); blockCells(fl, 14, 11, 1, 1);
  add(11.5, 12.5, () => drawTable(11.5, 12.5), null); blockCells(fl, 11, 12, 1, 1);
  add(13.2, 13.7, () => drawTable(13.2, 13.7), null); blockCells(fl, 13, 13, 1, 1);
  add(10.3, 14.9, () => drawBin(10.3, 14.9), null);
  fl.fix.push({kind: 'vend', x: 13.55, y: 9.1, c: '#7fd0ff'}, {kind: 'vend', x: 14.55, y: 9.1, c: '#ff9bd0'}, {kind: 'coffee', x: 11.9, y: 9.5});
}
function elevator(fl){
  blockCells(fl, 8, 9, 2, 2);
  S(fl, 9, 10.3, 'flat', () => drawShaft(fl), {b: .1});
  fl.fix.push({kind: 'elev', x: 9, y: 10.6});
}

/* ---- facade data from the floor plan: belt, windows and wall bands per face (0 north, 1 south, 2 east, 3 west) */
function areaAtCell(fl, x, y){ for(let i = fl.areas.length - 1; i >= 0; i--){ const a = fl.areas[i]; if(x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1) return a; } return null; }
function faceWins(len, a, b, over){
  if(over) return over;
  if(len < 1.8) return [];
  if(len >= 4.5 && len <= 5.5) return [[a + .15, a + 1.25], [b - 1.25, b - .15]];
  if(len < 2.8){ const m = (a + b) / 2, hw = Math.min(.6, (len - .6) / 2); return [[m - hw, m + hw]]; }
  const n = Math.floor(len / 2.3), out = [];
  for(let k = 0; k < n; k++){ const m = a + len * (k + .5) / n; out.push([m - .65, m + .65]); }
  return out;
}
function rebuildFacade(fl){
  const door = fl.ground ? [DOORX, DOORX + 2] : null;
  for(let fi = 0; fi < 4; fi++){
    const L = fi < 2 ? W : D, belt = [], wins = [], bd = [];
    let a0 = 0, cur = null, curDoor = false;
    const flush = (u) => {
      belt.push([a0, u, cur ? cur.pal.wall : PAL.hall.wall]);
      if(!curDoor) for(const w of faceWins(u - a0, a0, u, cur && cur.win && cur.win[fi])) wins.push(w);
    };
    for(let u = 0; u < L; u++){
      const c = fi === 0 ? [u, 0] : fi === 1 ? [u, D - 1] : fi === 2 ? [W - 1, u] : [0, u];
      const ar = areaAtCell(fl, c[0], c[1]);
      const inDoor = !!(door && fi === 1 && u >= door[0] && u < door[1]);
      if(u === 0){ cur = ar; a0 = 0; curDoor = inDoor; }
      else if(ar !== cur || inDoor !== curDoor){ flush(u); cur = ar; a0 = u; curDoor = inDoor; }
      bd[u] = ar ? ar.pal.wall : PAL.hall.wall;
    }
    flush(L);
    fl.belt[fi] = belt; fl.winL[fi] = wins; fl.bd[fi] = bd;
  }
}

/* ================================================================ drawing: floor pass */
const WALL = '#56627B';
const doorState = {open: 0};
const plotP = (p, t0, dur) => { if(!p || p.done) return 1; if(!p.started) return 0; return clamp((T - p.start - t0) / dur, 0, 1); };
const plotE = (fl, t0, dur) => plotP(fl.plot, t0, dur);
const nAgents = (fl) => fl.n || 0;

function drawSlab(fl){
  if(fl.i === 0) return;
  const e = plotE(fl, 1000, 500); if(e <= 0) return;
  g.globalAlpha = e;
  const x0 = -.3, x1 = W + .3, y0 = -.3, y1 = D + .25, z0 = -10, z1 = 0;
  if(FV.py) poly(quadY(x0, x1, y1, z0, z1), sh(SLABC, NS.py));
  if(FV.my) poly(quadY(x0, x1, y0, z0, z1), sh(SLABC, NS.my));
  if(FV.px) poly(quadX(x1, y0, y1, z0, z1), sh(SLABC, NS.px));
  if(FV.mx) poly(quadX(x0, y0, y1, z0, z1), sh(SLABC, NS.mx));
  g.globalAlpha = 1;
}
/* finished floor: one path per colour and area instead of one polygon per tile */
function tilesStatic(fl){
  for(let ai = 0; ai < fl.areas.length; ai++){
    const a = fl.areas[ai], ce = a.type === 'cafe' ? '#5F4939' : a.pal.grid, co = a.pal.floor;
    if(a.zone && a.zone.plot && !a.zone.plot.done) continue;
    for(let par = 0; par < 2; par++){
      g.beginPath();
      for(let x = a.x0; x < a.x1; x++) for(let y = a.y0; y < a.y1; y++){
        if(((x + y) & 1) !== par) continue;
        const q = topQ(x, y, 1, 1, 0); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.closePath();
      }
      g.fillStyle = par ? co : ce; g.fill();
    }
  }
}
/* convex hull of 8 projected points, in typed arrays, no allocation */
const HX = new Float64Array(8), HY = new Float64Array(8), HQX = new Float64Array(20), HQY = new Float64Array(20), IDX = new Int8Array(8);
function setPt(i, x, y){ const dx = x - PV.x, dy = y - PV.y; HX[i] = (dx * RC - dy * RS - dx * RS - dy * RC) * 32; HY[i] = (dx * RC - dy * RS + dx * RS + dy * RC) * 16 - ZB - ZL; }
function crs(ox, oy, ax, ay, bx, by){ return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox); }
function hullPath(n){
  for(let i = 0; i < n; i++) IDX[i] = i;
  for(let i = 1; i < n; i++){ const v = IDX[i]; let j = i - 1; while(j >= 0 && (HX[IDX[j]] > HX[v] || (HX[IDX[j]] === HX[v] && HY[IDX[j]] > HY[v]))){ IDX[j + 1] = IDX[j]; j--; } IDX[j + 1] = v; }
  let k = 0;
  for(let i = 0; i < n; i++){ const px = HX[IDX[i]], py = HY[IDX[i]]; while(k >= 2 && crs(HQX[k - 2], HQY[k - 2], HQX[k - 1], HQY[k - 1], px, py) <= 0) k--; HQX[k] = px; HQY[k] = py; k++; }
  const t = k + 1;
  for(let i = n - 2; i >= 0; i--){ const px = HX[IDX[i]], py = HY[IDX[i]]; while(k >= t && crs(HQX[k - 2], HQY[k - 2], HQX[k - 1], HQY[k - 1], px, py) <= 0) k--; HQX[k] = px; HQY[k] = py; k++; }
  k--;
  g.beginPath(); g.moveTo(HQX[0], HQY[0]); for(let i = 1; i < k; i++) g.lineTo(HQX[i], HQY[i]); g.closePath();
}
let shKey = -1, shStyle = '';
function shadowStyle(al){ const q = Math.round(al * 1000); if(q !== shKey){ shKey = q; shStyle = 'rgba(8,12,24,' + (q / 1000).toFixed(3) + ')'; } return shStyle; }
function drawShadows(fl){
  for(let si = 0; si < fl.sh.length; si++){
    const s = fl.sh[si], e = plotP(s.pl, s.t0, 450); if(e <= 0) continue;
    const ox = SUN.dx * SUN.f * s.h / 32 * .9, oy = SUN.dy * SUN.f * s.h / 32 * .9;
    for(let k = LOW ? 1 : 2; k >= 0; k--){
      const gr = k * .11, x0 = s.x - gr, y0 = s.y - gr, x1 = s.x + s.w + gr, y1 = s.y + s.d + gr;
      setPt(0, x0, y0); setPt(1, x1, y0); setPt(2, x1, y1); setPt(3, x0, y1); setPt(4, x0 + ox, y0 + oy); setPt(5, x1 + ox, y0 + oy); setPt(6, x1 + ox, y1 + oy); setPt(7, x0 + ox, y1 + oy);
      hullPath(8); g.fillStyle = shadowStyle(SUN.a * e * .42); g.fill();
    }
  }
  // soft occlusion at the foot of the walls
  const ew = plotE(fl, 5600, 900);
  aoEdge(0, 0, W, 0, 0, 1, .8, .42 * ew * (1 - CUT.N * .6));
  aoEdge(0, 0, 0, D, 1, 0, .8, .4 * ew * (1 - CUT.W * .6));
  aoEdge(W, 0, W, D, -1, 0, .7, .3 * ew * (1 - CUT.E * .6));
  aoEdge(0, D, W, D, 0, -1, .6, .26 * ew);
}
function aoEdge(x0, y0, x1, y1, nx, ny, w, a){
  if(a <= .02) return;
  const q = [pp(x0, y0), pp(x1, y1), pp(x1 + nx * w, y1 + ny * w), pp(x0 + nx * w, y0 + ny * w)];
  const m0 = pp((x0 + x1) / 2, (y0 + y1) / 2), m1 = pp((x0 + x1) / 2 + nx * w, (y0 + y1) / 2 + ny * w);
  const gr = g.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
  gr.addColorStop(0, 'rgba(6,10,22,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(6,10,22,0)');
  g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fillStyle = gr; g.fill();
}
function tileState(fl, a, x, y){
  const p = fl.plot; if(!p || p.done) return null;
  if(!p.started) return false;
  const tt = T - p.start, k = Math.min(3, Math.floor(y / 4));
  const dist = Math.hypot(x + .5 - 7.5, y + .5 - (4 * k + 2));
  const t0 = 1500 + 850 * k + 700 + dist * 28;
  const e = clamp((tt - t0) / 360, 0, 1);
  if(e <= 0) return false;
  let col = null;
  if(a.type === 'zone'){ const pt = clamp((tt - (6600 + y * 35)) / 420, 0, 1); col = pt >= 1 ? null : mx(CONC, a.pal.floor, pt); }
  return [e, (1 - eo3(e)) * 46, col];
}
/* a zone under chantier: bare slab, then its tiles lay down in a diagonal sweep */
function tilesZone(a, z){
  const tt = T - z.plot.start, e0 = clamp(tt / 350, 0, 1);
  g.globalAlpha = e0; poly(topQ(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, 0), CONC); g.globalAlpha = 1;
  for(let x = a.x0; x < a.x1; x++) for(let y = a.y0; y < a.y1; y++){
    const e = clamp((tt - 500 - ((x - a.x0) + (y - a.y0)) * 70) / 320, 0, 1); if(e <= 0) continue;
    if(e < 1) g.globalAlpha = e;
    poly(topQ(x, y, 1, 1, (1 - eo3(e)) * 40), (x + y) & 1 ? a.pal.floor : a.pal.grid);
    if(e < 1) g.globalAlpha = 1;
  }
}
function drawFloorTiles(fl){
  const statT = !fl.plot || fl.plot.done || (fl.plot.started && T - fl.plot.start > 7700);
  if(statT) tilesStatic(fl);
  else for(const a of fl.areas){
    for(let x = a.x0; x < a.x1; x++) for(let y = a.y0; y < a.y1; y++){
      const st = tileState(fl, a, x, y);
      if(st === false) continue;
      let col = (x + y) & 1 ? a.pal.floor : a.pal.grid, dz = 0, al = 1;
      if(a.type === 'cafe' && ((x + y) & 1) === 0) col = '#5F4939';
      if(st){ al = st[0]; dz = st[1]; if(st[2]) col = (x + y) & 1 ? st[2] : sh(st[2], .04); }
      if(al < 1) g.globalAlpha = al;
      poly(topQ(x, y, 1, 1, dz), col);
      if(al < 1) g.globalAlpha = 1;
    }
  }
  for(let ai = 0; ai < fl.areas.length; ai++){ const a = fl.areas[ai]; if(a.zone && a.zone.plot && !a.zone.plot.done) tilesZone(a, a.zone); }
  const done = !fl.plot || fl.plot.done || (fl.plot.started && T - fl.plot.start > 7000);
  if(done) for(const a of fl.areas){
    if(a.type !== 'zone' && a.type !== 'chef') continue;
    if(a.zone && a.zone.plot && !a.zone.plot.done) continue;
    const q = topQ(a.x0 + .04, a.y0 + .04, a.x1 - a.x0 - .08, a.y1 - a.y0 - .08, 0);
    g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath();
    g.strokeStyle = a.pal.line; g.globalAlpha = .9; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1;
  }
  for(const r of fl.rugs || []){
    const e = plotE(fl, r.t0, 400); if(e <= 0) continue;
    g.globalAlpha = e; poly(topQ(r.x, r.y, r.w, r.d, .3), r.c, r.e); poly(topQ(r.x + .18, r.y + .18, r.w - .36, r.d - .36, .35), sh(r.c, .08)); g.globalAlpha = 1;
  }
}
function hull(pts){
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for(const p of pts){ while(lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for(let i = pts.length - 1; i >= 0; i--){ const p = pts[i]; while(up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
const SUN = {dx: 0, dy: 1, f: .5, a: .2};
function sunUpdate(){
  const hf = LT.hf, dayK = LT.day;
  const sxo = lerp(-3.4, 4.6, hf), ln = lerp(6.4, 3.4, Math.sin(hf * Math.PI));
  const n = Math.hypot(sxo, ln);
  SUN.dx = dayK > .1 ? sxo / n : .3; SUN.dy = dayK > .1 ? ln / n : .9;
  SUN.f = lerp(.25, lerp(.45, 1.1, 1 - Math.sin(hf * Math.PI)), dayK);
  SUN.a = .13 + .15 * dayK;
  SUN.sxo = sxo; SUN.ln = ln;
}
function winRect(list, fn){ for(const w of list) fn(w); }
function drawBeams(fl){
  const day = LT.day, moon = day < .12 ? (.12 - day) / .12 : 0;
  const a = day * .2 + moon * .05;
  if(a < .008) return;
  const e = plotE(fl, 8000, 600); if(e <= 0) return;
  const hf = LT.hf, sxo = SUN.sxo, ln = SUN.ln;
  g.save();
  { const q = topQ(0, 0, W, D, 0); g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.clip(); }
  const rgb0 = day > .12 ? '255,240,205' : '150,180,255';
  const beam = (p0, p1, v, k) => {
    // p0, p1: window ends on the wall; v: displacement vector of the beam on the floor
    const q = [pp(p0[0], p0[1]), pp(p1[0], p1[1]), pp(p1[0] + v[0], p1[1] + v[1]), pp(p0[0] + v[0], p0[1] + v[1])];
    const m0 = pp((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2), m1 = pp((p0[0] + p1[0]) / 2 + v[0], (p0[1] + p1[1]) / 2 + v[1]);
    const gr = g.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
    gr.addColorStop(0, 'rgba(' + rgb0 + ',' + (a * k * e * 1.3).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(' + rgb0 + ',0)');
    g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fillStyle = gr; g.fill();
  };
  for(const w of fl.winL[0]) beam([w[0], 0], [w[1], 0], [sxo, ln], 1);
  for(const w of fl.winL[3]) beam([0, w[0]], [0, w[1]], [ln * .8, sxo * .35 + 1.2], (1 - hf) * .9 + .1);
  for(const w of fl.winL[2]) beam([W, w[0]], [W, w[1]], [-ln * .8, -sxo * .2 + 1.4], hf * .9 + .1);
  g.restore();
}
function drawSheen(fl){
  const k = LT.day * .07; if(k < .006) return;
  const e = plotE(fl, 8000, 600); if(e <= 0) return;
  g.save();
  for(const a of fl.areas){
    if(a.type !== 'corr' && a.type !== 'lobby') continue;
    const q = topQ(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, 0);
    g.save(); g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.clip();
    const bw = 1.3, pos = a.x0 - bw + (a.x1 - a.x0 + bw) * (LT.hf * .9 + .05);
    const s = [pp(pos, a.y0), pp(pos + bw, a.y0), pp(pos + bw + 1.2, a.y1), pp(pos + 1.2, a.y1)];
    const m0 = pp(pos, a.y0), m1 = pp(pos + bw, a.y0);
    const gr = g.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,' + (k * e).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.beginPath(); g.moveTo(s[0][0], s[0][1]); for(let i = 1; i < 4; i++) g.lineTo(s[i][0], s[i][1]); g.closePath(); g.fillStyle = gr; g.fill();
    g.restore();
  }
  g.restore();
}

/* ================================================================ drawing: walls */
/* ================================================================ drawing: walls, facade and roof */
const WINC = {unlit: '#26324a', lit: '#ffd58a', amber: '#ffbf47', mid: '#365a86', ambNow: '#ffbf47'};
const AMBP = [];
function winColors(){
  const d = clamp(LT.day * 1.5, 0, 1);
  const glass = mx('#26324a', '#9db9d6', d);
  WINC.unlit = mx(glass, hx(LT.wr, LT.wg, LT.wb), LT.wa * .9);
  WINC.lit = mx('#ffd58a', '#d9e0e8', d * .8);
  WINC.amber = mx('#ffc552', '#f1cf8a', d);
  WINC.mid = mx(LT.t, LT.b, .5);
  for(let i = 0; i < 12; i++) AMBP[i] = mx('#d98a1c', WINC.amber, i / 11);
}
function winGlass(q, interior, fl, rr, amb){
  g.fillStyle = interior ? WINC.mid : amb ? WINC.ambNow : rr < fl.actS ? WINC.lit : WINC.unlit;
  g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fill();
  g.strokeStyle = '#d3dbe8'; g.lineWidth = 2; g.stroke();
}
function winStars(fl, plane, c, a, b){
  if(LT.day >= .5) return;
  const sa = (1 - LT.day * 2) * (reduced ? .8 : .55 + .45 * Math.sin(T / 700 + a * 9)), si = (a * 10 | 0) * 37;
  g.fillStyle = 'rgba(255,255,240,' + sa.toFixed(2) + ')';
  for(let i = 0; i < 3; i++){
    const u = a + (b - a) * (RND[(si + i * 53) & 255] / 100), zz = 32 + RND[(si + i * 71 + 19) & 255] / 100 * 28;
    const p = plane === 'y' ? pp(u, c, zz) : pp(c, u, zz);
    g.fillRect(p[0] - .8, p[1] - .8, 1.6, 1.6);
  }
}
function drawWindowSet(fl, plane, c, list, lo, hi, interiorVis, exteriorVis, cExt, fi){
  for(let j = 0; j < list.length; j++){
    const w = list[j], a = Math.max(w[0], lo), b = Math.min(w[1], hi); if(b <= a) continue;
    const m = (a + b) / 2;
    if(interiorVis){ const q = plane === 'y' ? quadY(a, b, c, 26, 66) : quadX(c, a, b, 26, 66); winGlass(q, true, fl, 1, false); const mm = plane === 'y' ? [pp(m, c, 26), pp(m, c, 66)] : [pp(c, m, 26), pp(c, m, 66)]; line(mm[0], mm[1], '#d3dbe8', 1.5); winStars(fl, plane, c, a, b); }
    if(exteriorVis){ const q = plane === 'y' ? quadY(a, b, cExt, 26, 66) : quadX(cExt, a, b, 26, 66); winGlass(q, false, fl, fl.wr[fi][j], j < fl.nAmb); const mm = plane === 'y' ? [pp(m, cExt, 26), pp(m, cExt, 66)] : [pp(cExt, m, 26), pp(cExt, m, 66)]; line(mm[0], mm[1], '#d3dbe8', 1.5); }
  }
}
const BANDI = {N: 0, S: 1, E: 2, W: 3};
const bandOf = (fl, side, i) => fl.bd[BANDI[side]][i];
/* an open floor lowers the walls on the camera side; a closed one (op = 0) keeps all four at full height */
function drawWallN(fl, x, e){
  const h = lerp(BH, FH, CUT.N * fl.op) * eo3(e); if(h < .8) return;
  box(x, -.3, 1, .3, 0, h, WALL);
  if(h < BH * .8) return;
  if(FV.py){ const band = bandOf(fl, 'N', x); poly(quadY(x, x + 1, 0, 0, 10), sh(band, -.35)); poly(quadY(x, x + 1, 0, 10, 11.5), band); }
  drawWindowSet(fl, 'y', 0, fl.winL[0], x, x + 1, FV.py, FV.my, -.3, 0);
}
function drawWallW(fl, y, e){
  const h = lerp(BH, FH, CUT.W * fl.op) * eo3(e); if(h < .8) return;
  box(-.3, y, .3, 1, 0, h, WALL);
  if(h < BH * .8) return;
  if(FV.px){ const band = bandOf(fl, 'W', y); poly(quadX(0, y, y + 1, 0, 10), sh(band, -.5)); poly(quadX(0, y, y + 1, 10, 11.5), sh(band, -.2)); }
  drawWindowSet(fl, 'x', 0, fl.winL[3], y, y + 1, FV.px, FV.mx, -.3, 3);
}
function drawWallE(fl, y, e){
  const h = lerp(BH, lerp(70, FH, CUT.E), fl.op) * eo3(e); if(h < .8) return;
  box(W, y, .3, 1, 0, h, WALL);
  if(h < 56) return;
  if(FV.mx){ const band = bandOf(fl, 'E', y); poly(quadX(W, y, y + 1, 0, 10), sh(band, -.45)); poly(quadX(W, y, y + 1, 10, 11.5), sh(band, -.2)); }
  drawWindowSet(fl, 'x', W, fl.winL[2], y, y + 1, FV.mx, FV.px, W + .3, 2);
}
function drawWallS(fl, x, e){
  const h = lerp(BH, lerp(62, FH, CUT.S), fl.op) * eo3(e); if(h < .8) return;
  box(x, D, 1, .25, 0, h, '#566178');
  if(h > 40 && FV.my){ poly(quadY(x, x + 1, D, 0, 8), sh('#8794AD', -.4)); }
  if(h >= BH * .8) drawWindowSet(fl, 'y', D, fl.winL[1], x, x + 1, FV.my, FV.py, D + .25, 1);
}

/* ---- closed floor: continuous facade (slab, walls, team belt, windows lit by the floor's activity) */
const FKEY = ['my', 'py', 'px', 'mx'], SLABC = '#2b3446';
const faceVis = (fi) => fi === 0 ? FV.my : fi === 1 ? FV.py : fi === 2 ? FV.px : FV.mx;
let PX = 0, PY = 0;
function facePt(fi, u, z){
  let x, y;
  if(fi === 0){ x = u; y = -.3; } else if(fi === 1){ x = u; y = D + .25; } else if(fi === 2){ x = W + .3; y = u; } else { x = -.3; y = u; }
  const dx = x - PV.x, dy = y - PV.y;
  PX = (dx * RC - dy * RS - dx * RS - dy * RC) * 32; PY = (dx * RC - dy * RS + dx * RS + dy * RC) * 16 - z - ZB - ZL;
}
function faceQuad(fi, u0, u1, z0, z1, col){
  facePt(fi, u0, z0); const ax = PX, ay = PY; facePt(fi, u1, z0); const bx = PX, by = PY; facePt(fi, u1, z1); const cx = PX, cy = PY; facePt(fi, u0, z1);
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(PX, PY); g.closePath(); g.fillStyle = col; g.fill();
}
function facadeBody(fl, roof){
  for(let fi = 0; fi < 4; fi++){
    if(!faceVis(fi)) continue;
    const ns = NS[FKEY[fi]], u0 = -.3, u1 = fi < 2 ? W + .3 : D + .25, bl = fl.belt[fi];
    if(fl.i > 0) faceQuad(fi, u0, u1, -10, 0, sh(SLABC, ns));
    faceQuad(fi, u0, u1, 0, BH, sh(WALL, ns));
    for(let s = 0; s < bl.length; s++){ const b = bl[s]; faceQuad(fi, b[0], b[1], 0, 10, sh(b[2], ns * .5 - .15)); faceQuad(fi, b[0], b[1], 10, 11.5, sh(b[2], ns * .4)); }
    faceQuad(fi, u0, u1, BH - 3, BH, sh(WALL, ns + .2));
    if(fi === 1 && fl.i === 0){ faceQuad(1, DOORX, DOORX + 2, 0, 46, '#1d2536'); drawLobbyDoor(fl); }
  }
  const q = topQ(-.3, -.3, W + .6, D + .55, BH);
  g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.closePath(); g.fillStyle = roof ? '#3a4357' : CONC; g.fill();
  if(roof) drawRoof();
}
function facadeWindows(fl){
  const detail = cam.z > .36, amb = fl.nAmb;
  for(let fi = 0; fi < 4; fi++){
    if(!faceVis(fi)) continue;
    const list = fl.winL[fi], wr = fl.wr[fi], nl = list.length;
    for(let st = 0; st < 3; st++){
      let any = false; g.beginPath();
      for(let j = 0; j < nl; j++){
        const state = j < amb ? 2 : wr[j] < fl.actS ? 1 : 0; if(state !== st) continue;
        const w = list[j];
        facePt(fi, w[0], 26); const ax = PX, ay = PY; facePt(fi, w[1], 26); const bx = PX, by = PY; facePt(fi, w[1], 66); const cx = PX, cy = PY; facePt(fi, w[0], 66);
        g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(PX, PY); g.closePath(); any = true;
      }
      if(any){ g.fillStyle = st === 0 ? WINC.unlit : st === 1 ? WINC.lit : WINC.ambNow; g.fill(); }
    }
    if(detail){
      g.beginPath();
      for(let j = 0; j < nl; j++){
        const w = list[j];
        facePt(fi, w[0], 26); g.moveTo(PX, PY); facePt(fi, w[1], 26); g.lineTo(PX, PY); facePt(fi, w[1], 66); g.lineTo(PX, PY); facePt(fi, w[0], 66); g.lineTo(PX, PY); g.closePath();
        facePt(fi, (w[0] + w[1]) / 2, 26); g.moveTo(PX, PY); facePt(fi, (w[0] + w[1]) / 2, 66); g.lineTo(PX, PY);
      }
      g.strokeStyle = '#d3dbe8'; g.lineWidth = 2; g.lineJoin = 'miter'; g.stroke();
    }
  }
}
const ROOFK = [{x: 2.4, y: 3, w: 2.2, d: 1.6, h: 9, c: '#6b7488', k: 0}, {x: 10.6, y: 2.4, w: 1.8, d: 1.8, h: 7, c: '#78839a', k: 0}, {x: 9.6, y: 9.6, w: 2, d: 2, h: 14, c: '#5b667a', k: 0}, {x: 3.2, y: 10.6, w: 3, d: 1.4, h: 6, c: '#6b7488', k: 0}];
const byK = (a, b) => a.k - b.k;
/* the roof rides the top floor: it lifts off while a floor is built above it, then comes down on the new top */
const ROOF = {host: -1, k: 1, t: 0};
function roofStep(){
  const nf = floors.length; if(!nf) return;
  const top = floors[nf - 1], building = !!(top.plot && !top.plot.done);   // a chantier or a demolition: the roof lifts
  const dt = clamp(T - ROOF.t, 0, 100); ROOF.t = T;
  const kStep = reduced ? 1 : dt / 700;
  if(ROOF.host < 0) ROOF.k = 1;
  // host < 0: first frame. host >= nf: the floor that carried the roof was demolished: ROOF.k stays (lifted), the roof lands on the new top.
  if(ROOF.host < 0 || ROOF.host >= nf) ROOF.host = building ? nf - 2 : nf - 1;
  if(building){ ROOF.k = Math.max(0, ROOF.k - kStep); }
  else {
    if(ROOF.host !== nf - 1){ if(ROOF.k > 0) ROOF.k = Math.max(0, ROOF.k - kStep); else { ROOF.host = nf - 1; } }
    else ROOF.k = Math.min(1, ROOF.k + kStep);
  }
}
function drawRoof(){
  const k = eo3(ROOF.k); if(k <= .01) return;
  const sb = ZB; ZB += (1 - k) * 90; g.globalAlpha = k;
  drawRoofBody();
  ZB = sb; g.globalAlpha = 1;
}
function drawRoofBody(){
  const pc = '#4a566e';
  box(-.3, -.3, W + .6, .35, BH, 5, pc); box(-.3, D - .1, W + .6, .35, BH, 5, pc); box(-.3, -.3, .35, D + .55, BH, 5, pc); box(W - .05, -.3, .35, D + .55, BH, 5, pc);
  for(let i = 0; i < ROOFK.length; i++){ const b = ROOFK[i]; b.k = dep(b.x + b.w / 2, b.y + b.d / 2); }
  ROOFK.sort(byK);
  for(let i = 0; i < ROOFK.length; i++){ const b = ROOFK[i]; box(b.x, b.y, b.w, b.d, BH, b.h, b.c); }
  const a = pp(13, 13, BH), t = pp(13, 13, BH + 34); line(a, t, '#8794AD', 1.6);
}
/* the red beacon blinks: drawn on its own, never in the cached bitmap of the roof */
function drawBeacon(){
  if(ROOF.k < .5 || !(reduced || Math.floor(T / 600) % 2)) return;
  const t = pp(13, 13, BH + 34);
  g.fillStyle = '#ff6a5a'; g.beginPath(); g.arc(t[0], t[1] - 1, 2.2, 0, 7); g.fill();
}

function drawPart(x, y, horiz, col, e){
  const h = 11 * eo3(e); if(h < .5) return;
  if(horiz) box(x, y, 1, .14, 0, 11, sh(col, -.4), eo3(e)); else box(x, y, .14, 1, 0, 11, sh(col, -.4), eo3(e));
  g.globalAlpha = .9; if(horiz) poly(topQ(x, y, 1, .14, h), sh(col, .1)); else poly(topQ(x, y, .14, 1, h), sh(col, .1)); g.globalAlpha = 1;
}
function drawBackPart(x, y, col, e){
  const h = lerp(40, 11, CUT.N) * eo3(e); if(h < .8) return;
  box(x, y, 1, .2, 0, h, '#4a5670');
  if(FV.py) poly(quadY(x, x + 1, y + .2, 0, Math.min(h, 9)), sh(col, -.35));
}
function drawPlaque(z){
  const back = z.row === 'back';
  if(!FV.py) return;
  if(back ? CUT.N > .12 : CUT.N > .45) return;
  const n = z.name.length > 15 ? z.name.slice(0, 14) + '…' : z.name, fl = z.fl;
  const cnt = fl.tc[z.id] || 0;
  const x0 = z.x0, y = (back ? 0 : z.y0 + .2) + .01, zz = back ? 40 : 24, w = back ? 2.3 : 3.2, xs = back ? x0 + 1.35 : x0 + .9;
  poly(quadY(xs, xs + w, y, zz - 3, zz + 17), '#1b2230');
  poly(quadY(xs, xs + .12, y, zz - 3, zz + 17), z.pal.wall);
  textOn(n, xs, y, 1, 0, w, .22, zz + 9, 9.5, '#E8ECF2', 700);
  textOn(cnt + (cnt > 1 ? ' agents' : ' agent'), xs, y, 1, 0, w, .22, zz + 1.5, 7.5, '#AAB5C8', 500);
}
function drawClock(fl){
  if(!FV.py || CUT.N > .12) return;
  const R = 17, mins = curMin(), now = (DT.setTime(Date.now()), DT);
  g.save(); plane(2.5, .01, 64, 1, 0);
  ell(0, 2, R + 3, R + 3, 'rgba(0,0,0,.25)'); ell(0, 0, R + 2.5, R + 2.5, '#1b2230'); ell(0, 0, R + .5, R + .5, '#cfd8e6'); ell(0, 0, R - 1.5, R - 1.5, '#f3efe6');
  g.strokeStyle = '#2a303d'; g.lineCap = 'round';
  for(let i = 0; i < 60; i++){
    const a = i * Math.PI / 30, big = i % 5 === 0, r1 = R - 2, r2 = R - (big ? 6 : 3.6);
    g.lineWidth = big ? 1.6 : .7; g.beginPath(); g.moveTo(Math.sin(a) * r1, -Math.cos(a) * r1); g.lineTo(Math.sin(a) * r2, -Math.cos(a) * r2); g.stroke();
  }
  const sec = fast ? (mins * 60) % 60 : now.getSeconds() + now.getMilliseconds() / 1000;
  const s0 = Math.floor(sec), fr = sec - s0;
  const sa = reduced ? s0 * 6 : fast ? sec * 6 : ((s0 - 1) + eob(clamp(fr / .32, 0, 1))) * 6;
  const ma = ((mins % 60) + (fast ? 0 : sec / 60)) * 6, ha = ((mins / 60) % 12) * 30;
  const hand = (deg, len, w, col, tail = 0) => { const a = deg * Math.PI / 180; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(-Math.sin(a) * tail, Math.cos(a) * tail); g.lineTo(Math.sin(a) * len, -Math.cos(a) * len); g.stroke(); };
  hand(ha, R * .5, 2.6, '#1f2530'); hand(ma, R * .76, 1.8, '#1f2530'); hand(sa, R * .84, 1, '#E0645A', 4);
  ell(0, 0, 2, 2, '#E0645A');
  g.restore();
  const hh = Math.floor(mins / 60) % 24, mm = Math.floor(mins % 60);
  poly(quadY(1.75, 3.25, .01, 36, 44), '#10151e');
  textOn((hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, 1.75, .01, 1, 0, 1.5, .2, 37.8, 7.5, '#8FD9C4', 700);
}
function drawBoard(fl){
  if(!FV.px || CUT.W > .12) return;
  const x = .01;
  poly(quadX(x, 1.2, 4.4, 36, 62), '#e8ecf2', '#9aa6ba');
  const prog = .25 + .5 * ((Math.sin(T / 5200 + fl.i) + 1) / 2);
  poly(quadX(x, 1.45, 4.15, 41, 45), '#b9c3d4'); poly(quadX(x, 1.45, 1.45 + 2.7 * prog, 41, 45), '#8FD9C4');
  textOn('Avancement', x, 1.4, 0, 1, 2.8, 0, 53, 7.5, '#2a303d', 700);
  [['#F0C36A', 1.6], ['#F4A39B', 2.3], ['#8FD9C4', 3.0]].forEach((n) => poly(quadX(x, n[1], n[1] + .5, 48, 56), n[0]));
}
function drawBookshelf(){
  box(3.1, .05, 1.8, .5, 0, 46, '#6b4a34');
  if(!FV.py) return;
  for(let r = 0; r < 3; r++){
    const z = 6 + r * 14;
    poly(quadY(3.18, 4.82, .55, z, z + 11), '#3b2a1f');
    for(let i = 0; i < 9; i++){
      const w = .13 + (RND[(r * 9 + i) & 255] % 5) * .012, x = 3.2 + i * .18;
      poly(quadY(x, x + w, .55, z, z + 6 + (RND[(r * 9 + i + 100) & 255] % 5)), ['#8F95D8', '#F0C36A', '#6C8EBF', '#E0645A', '#8FD9C4', '#AE8FCC'][(i + r * 2) % 6]);
    }
  }
}
function drawLobbyDoor(fl){
  const x0 = DOORX, x1 = DOORX + 2, y = D + .12, ox = doorState.open * .92;
  const leaf = (a, b) => { poly(quadY(a, b, y, 0, 46), 'rgba(150,215,230,.22)', 'rgba(143,217,196,.9)'); line(pp((a + b) / 2, y, 8), pp((a + b) / 2, y, 40), 'rgba(255,255,255,.12)', 3); };
  leaf(x0 + .06 - ox, x0 + 1 - ox); leaf(x0 + 1 + ox, x1 - .06 + ox);
  box(x0 - .12, D, .16, .3, 0, 52, '#8794AD'); box(x1 - .04, D, .16, .3, 0, 52, '#8794AD');
  box(x0 - .12, D, 2.28, .3, 48, 9, '#667289');
  if(FV.py) textOn('Entrée', x0 - .12, D + .31, 1, 0, 2.28, .5, 51.2, 8.5, '#E8ECF2', 700);
  else if(FV.my) textOn('Sortie', x0 - .12, D - .01, 1, 0, 2.28, .5, 51.2, 8.5, '#E8ECF2', 700);
}
function glassFrontAt(fl, o){
  const x0 = o.x0, x1 = o.x1, y = o.y, dc = o.door, col = 'rgba(170,222,238,.14)';
  for(let x = x0; x < x1; x++){ if(x === dc) continue; poly(quadY(x, x + 1, y, 0, 50), col, 'rgba(210,235,245,.35)'); }
  box(x0, y - .06, dc - x0, .12, 0, 4, '#8794AD'); box(dc + 1, y - .06, x1 - dc - 1, .12, 0, 4, '#8794AD');
  line(pp(x0, y, 50), pp(dc, y, 50), '#c9d4e4', 2); line(pp(dc + 1, y, 50), pp(x1, y, 50), '#c9d4e4', 2);
  for(const x of [x0, dc, dc + 1, x1]) line(pp(x, y, 0), pp(x, y, 50), '#c9d4e4', 2);
  const yy = y + (FV.py ? .02 : -.02);
  poly(quadY(o.px, o.px + o.pw, yy, 28, 38), '#c39a58');
  const nm = fl.name.length > 26 ? fl.name.slice(0, 25) + '…' : fl.name;
  textOn(nm, o.px, yy, 1, 0, o.pw, .12, 31.3, 7, '#2A2008', 700);
  const ang = Math.PI - o.into * (fl.dc || 0) * Math.PI * .52, hx0 = dc + 1, hy0 = y;
  const ex = hx0 + Math.cos(ang), ey = hy0 + Math.sin(ang);
  poly([pp(hx0, hy0, 0), pp(ex, ey, 0), pp(ex, ey, 48), pp(hx0, hy0, 48)], 'rgba(170,222,238,.26)', '#e9c27a');
}
function glassSideAt(fl, o){
  const x = o.sideX, y0 = o.sy0, y1 = o.sy1;
  for(let y = y0; y < y1; y++) poly(quadX(x, y, y + 1, 0, 50), 'rgba(170,222,238,.12)', 'rgba(210,235,245,.3)');
  box(x - .06, y0, .12, y1 - y0, 0, 4, '#8794AD');
  line(pp(x, y0, 50), pp(x, y1, 50), '#c9d4e4', 2);
  for(let y = y0; y <= y1; y++) line(pp(x, y, 0), pp(x, y, 50), 'rgba(201,212,228,.55)', 1.2);
}
function drawShaft(fl){
  // glass shaft frame, door leaves at the front (+y face, y = 10.5)
  const open = fl.eo || 0, y = 10.5, h = FHt - 12;
  poly(quadX(8, 9, 10.5, 0, h), 'rgba(170,222,238,.10)'); poly(quadX(10, 9, 10.5, 0, h), 'rgba(170,222,238,.10)'); poly(quadY(8, 10, 9, 0, h), 'rgba(170,222,238,.10)');
  for(const [px, py] of [[8, 9], [10, 9], [8, 10.5], [10, 10.5]]) line(pp(px, py, 0), pp(px, py, h), '#aab5c8', 2.4);
  const ox = open * .93;
  const leaf = (a, b) => { poly(quadY(a, b, y, 0, 56), 'rgba(205,216,230,.78)', '#8794AD'); line(pp((a + b) / 2, y, 6), pp((a + b) / 2, y, 50), 'rgba(255,255,255,.2)', 2); };
  leaf(8.04 - ox, 9.0 - ox);
  leaf(9.0 + ox, 9.96 + ox);
  box(7.95, 10.4, 2.1, .2, 56, 8, '#5a667c');
  if(FV.py) textOn('Ascenseur', 7.95, 10.61, 1, 0, 2.1, .38, 59.2, 7, '#8FD9C4', 700);
  poly(quadY(10.1, 10.25, y, 20, 30), fl.eo > .1 ? '#8FD9C4' : '#F0C36A');
}
function drawCab(zb){
  // translucent cabin 8.1..9.9 x 9.1..10.4
  ZB = zb;
  const x = 8.12, y = 9.12, w = 1.76, d = 1.28, h = 52;
  poly(topQ(x, y, w, d, 4), '#3a4355');
  if(FV.my) poly(quadY(x, x + w, y, 4, h), 'rgba(205,216,230,.40)', 'rgba(255,255,255,.3)');
  if(FV.mx) poly(quadX(x, y, y + d, 4, h), 'rgba(205,216,230,.40)', 'rgba(255,255,255,.3)');
  if(FV.px) poly(quadX(x + w, y, y + d, 4, h), 'rgba(205,216,230,.40)', 'rgba(255,255,255,.3)');
  if(FV.py) poly(quadY(x, x + w, y + d, 4, h), 'rgba(205,216,230,.34)', 'rgba(255,255,255,.3)');
  poly(topQ(x, y, w, d, h), '#5a667c');
  const L = pp(x + w / 2, y + d / 2, h - 2); g.fillStyle = 'rgba(255,240,200,.9)'; g.fillRect(L[0] - 5, L[1] - 1, 10, 2);
}

/* ================================================================ drawing: furniture */
function drawDesk(d){
  const x = d.x, y = d.y, wood = d.chef ? '#7a5238' : '#9A6B4B';
  if(LOW) box(x + .05, y + .08, 1.9, .84, 0, 13, '#6c4630'); else { box(x + .05, y + .08, .12, .84, 0, 13, '#6c4630'); box(x + 1.83, y + .08, .12, .84, 0, 13, '#6c4630'); box(x + 1.2, y + .1, .6, .8, 0, 13, '#80573d'); }
  box(x, y, 2, 1, 13, 3, wood);
  const ag = d.agent ? agentById(d.agent) : null;
  const working = ag && ag.mode === 'sit' && (ag.st === 'run' || ag.st === 'att');
  const att = ag && ag.st === 'att';
  if(LOW){ box(x + 1.0, y + .26, .78, .07, 16, 20, '#1b212b'); if(FV.py && working){ poly(quadY(x + 1.05, x + 1.73, y + .335, 20.6, 34), att ? '#F0C36A' : '#8FD9C4'); } return; }
  box(x + .5, y + .55, .6, .25, 16, 1, '#2c3340');
  box(x + 1.28, y + .3, .22, .16, 16, 3, '#1f252f');
  box(x + 1.0, y + .26, .78, .07, 19, 17, '#1b212b');
  if(d.h % 3 === 0){ box(x + 1.75, y + .3, .2, .07, 19, 14, '#1b212b'); }
  if(FV.py){
    const sq = quadY(x + 1.05, x + 1.73, y + .335, 20.6, 34);
    g.beginPath(); g.moveTo(sq[0][0], sq[0][1]); for(let i = 1; i < 4; i++) g.lineTo(sq[i][0], sq[i][1]); g.closePath();
    g.fillStyle = working ? (att ? '#F0C36A' : '#8FD9C4') : '#26303d'; g.globalAlpha = working ? .92 : 1; g.fill(); g.globalAlpha = 1;
    if(working){
      const ph = reduced ? 0 : T / 260;
      for(let i = 0; i < 4; i++){
        const wl = .18 + (RND[(d.h + i * 29 + Math.floor(ph + i * 1.7) * 7) & 255] / 100) * .38;
        line(pp(x + 1.1, y + .34, 31 - i * 2.9), pp(x + 1.1 + wl, y + .34, 31 - i * 2.9), 'rgba(15,41,35,.75)', 1.4);
      }
      if(!reduced && Math.floor(T / 450) % 2 === 0) line(pp(x + 1.56, y + .34, 22.4), pp(x + 1.66, y + .34, 22.4), 'rgba(15,41,35,.9)', 1.6);
    } else line(pp(x + 1.1, y + .34, 31), pp(x + 1.4, y + .34, 24), 'rgba(255,255,255,.07)', 3);
  }
  const h = d.h % 4;
  if(h === 0) box(x + .15, y + .15, .2, .2, 16, 5, '#e8ecf2');
  else if(h === 1) poly(topQ(x + .1, y + .12, .4, .5, 16.2), '#e9e3d6');
  else if(h === 2) box(x + .15, y + .55, .22, .22, 16, 4, '#E0645A');
  else { poly(topQ(x + .1, y + .15, .35, .45, 16.2), '#cfd8e6'); box(x + .2, y + .2, .15, .12, 16.2, 3, '#F0C36A'); }
  box(x + .08, y + .72, .16, .16, 16, 2, '#2a303d');
  const lp = pp(x + .16, y + .8, 16), lt = pp(x + .3, y + .62, 38);
  line(lp, [lp[0] + 1, lp[1] - 12], '#aab5c8', 1.6); line([lp[0] + 1, lp[1] - 12], lt, '#aab5c8', 1.6);
  g.fillStyle = ag && LT.lamp > .05 ? '#ffe3a0' : '#c8a456'; g.beginPath(); g.moveTo(lt[0] - 5, lt[1] + 3); g.lineTo(lt[0] + 5, lt[1] + 3); g.lineTo(lt[0] + 2.5, lt[1] - 3); g.lineTo(lt[0] - 2.5, lt[1] - 3); g.closePath(); g.fill();
  if(d.chef && FV.py) poly(quadY(x + .5, x + 1.1, y + 1.01, 7, 11), '#c39a58');
}
function drawChair(cx, cy){
  if(LOW){ box(cx - .24, cy - .24, .48, .48, 8, 4, '#39455c'); return; }
  box(cx - .24, cy - .24, .48, .48, 8, 3, '#39455c');
  box(cx - .24, cy + .17, .48, .08, 10, 13, '#39455c');
  const b = pp(cx, cy, 0); line(b, pp(cx, cy, 8), '#222a37', 2); ell(b[0], b[1], 7, 3, '#222a37');
}
function drawPlant(x, y, i){
  const [sx, sy] = pp(x, y, 0);
  if(LOW){ g.fillStyle = '#b6704c'; g.fillRect(sx - 5, sy - 13, 10, 13); ell(sx, sy - 24, 9, 9, '#4ea56e'); return; }
  g.save(); g.translate(sx, sy);
  ell(0, 2, 8, 3.5, 'rgba(0,0,0,.25)');
  g.fillStyle = '#b6704c'; g.beginPath(); g.moveTo(-6, -13); g.lineTo(6, -13); g.lineTo(4.5, 0); g.lineTo(-4.5, 0); g.closePath(); g.fill();
  g.fillStyle = '#d58a62'; g.fillRect(-6.5, -15, 13, 3);
  const sway = reduced ? 0 : Math.sin(T / 900 + i * 1.7) * .09;
  const leaves = [[-9, -30, '#3f8f5f'], [9, -32, '#4ea56e'], [0, -39, '#5db27a'], [-4, -27, '#356f4e'], [5, -27, '#3f8f5f']];
  leaves.forEach((l, k) => {
    g.save(); g.translate(0, -14); g.rotate(sway * (1 + k * .2));
    g.fillStyle = l[2]; g.beginPath(); g.moveTo(-2, 0); g.quadraticCurveTo(l[0] * .9, l[1] + 14, l[0], l[1] + 14); g.quadraticCurveTo(l[0] * .5 + 3, l[1] + 12, 2, 0); g.closePath(); g.fill();
    g.restore();
  });
  g.restore();
}
function drawFloorLamp(x, y){
  const [sx, sy] = pp(x, y, 0);
  g.save(); g.translate(sx, sy);
  ell(0, 1, 7, 3, 'rgba(0,0,0,.28)'); line([0, 0], [0, -48], '#6a7488', 2.4);
  g.fillStyle = LT.lamp > .05 ? '#ffe3a0' : '#d8b86a'; g.beginPath(); g.moveTo(-8, -42); g.lineTo(8, -42); g.lineTo(5, -56); g.lineTo(-5, -56); g.closePath(); g.fill();
  g.restore();
}
function drawCoatRack(x, y){
  const [sx, sy] = pp(x, y, 0);
  g.save(); g.translate(sx, sy);
  ell(0, 1, 7, 3, 'rgba(0,0,0,.28)'); line([0, 0], [0, -46], '#6b4a34', 2.6);
  for(const [dx, c] of [[-6, '#4d6a86'], [6, '#8a5b46'], [0, '#6b7488']]){ line([0, -42], [dx, -38], '#6b4a34', 2); g.fillStyle = c; g.beginPath(); g.roundRect(dx - 3.2, -38, 6.4, 13, 2.5); g.fill(); }
  g.restore();
}
function drawBin(x, y){
  const [sx, sy] = pp(x, y, 0);
  g.save(); g.translate(sx, sy); ell(0, 1, 6, 2.8, 'rgba(0,0,0,.25)');
  g.fillStyle = '#5b667a'; g.beginPath(); g.moveTo(-5, -12); g.lineTo(5, -12); g.lineTo(4, 0); g.lineTo(-4, 0); g.closePath(); g.fill(); ell(0, -12, 5, 2.2, '#8794AD'); g.restore();
}
function drawBench(){
  box(5.12, 11.95, .8, 3.1, 9, 4, '#5f7a92'); box(5.02, 11.95, .2, 3.1, 13, 18, '#4e667c');
  for(const y of [12.1, 14.7]){ box(5.2, y, .12, .15, 0, 9, '#222a37'); box(5.7, y, .12, .15, 0, 9, '#222a37'); }
}
function drawFridge(x, y){
  if(LOW){ box(x, y, .85, .8, 0, 56, '#cfd8e6'); return; }
  box(x, y, .85, .8, 0, 56, '#cfd8e6');
  if(FV.py){ line(pp(x, y + .8, 38), pp(x + .85, y + .8, 38), '#8794AD', 1.2); box(x + .06, y + .8, .05, .05, 20, 10, '#8794AD'); box(x + .06, y + .8, .05, .05, 42, 8, '#8794AD'); poly(quadY(x + .5, x + .75, y + .81, 44, 52), '#F0C36A'); }
}
function drawCounter(x, y){
  if(LOW){ box(x, y, 2, .95, 0, 29, '#8a6244'); box(x + .55, y + .15, .6, .55, 29, 22, '#2b3341'); return; }
  box(x, y, 2, .95, 0, 26, '#8a6244'); box(x - .05, y - .05, 2.1, 1.05, 26, 3, '#c9b79c');
  box(x + .55, y + .15, .6, .55, 29, 22, '#2b3341');
  if(FV.py){ poly(quadY(x + .62, x + 1.05, y + .71, 40, 46), '#8FD9C4'); poly(quadY(x + .62, x + .72, y + .71, 33, 36), reduced || Math.floor(T / 700) % 2 ? '#F0C36A' : '#6b5a2a'); }
  box(x + .78, y + .4, .16, .16, 29, 4, '#f3efe6'); box(x + 1.45, y + .3, .14, .14, 29, 5, '#f3efe6'); box(x + 1.65, y + .55, .14, .14, 29, 5, '#e8ecf2'); box(x + .12, y + .3, .35, .3, 29, 3, '#6a7488');
}
function drawVending(x, y, k){
  box(x, y, .8, .8, 0, 60, k ? '#5a2f4d' : '#274d6b');
  if(!FV.py) return;
  if(LOW){ poly(quadY(x + .08, x + .72, y + .81, 8, 52), k ? '#ff9bd0' : '#7fd0ff'); return; }
  const q = quadY(x + .08, x + .72, y + .81, 8, 52);
  g.beginPath(); g.moveTo(q[0][0], q[0][1]); for(let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fillStyle = '#0f1722'; g.fill();
  for(let r = 0; r < 4; r++) for(let c = 0; c < 4; c++){
    const on = reduced || (RND[(k * 97 + r * 31 + c * 13 + Math.floor(T / 1400 + r * .7) * 17) & 255] % 7) > 0;
    const z = 12 + r * 9.6, a = x + .13 + c * .14;
    poly(quadY(a, a + .09, y + .82, z, z + 6), on ? ['#ff9b6b', '#ffd36b', '#8FD9C4', '#ff9bd0', '#7fd0ff'][(r + c * 2 + k) % 5] : '#2a3445');
  }
  poly(quadY(x + .12, x + .68, y + .82, 4, 8), '#1b212b');
}
function drawCooler(x, y){
  const [sx, sy] = pp(x, y, 0);
  if(LOW){ g.fillStyle = '#d9e1ec'; g.fillRect(sx - 8, sy - 28, 16, 28); g.fillStyle = 'rgba(125,200,235,.85)'; g.fillRect(sx - 6, sy - 52, 12, 24); return; }
  g.save(); g.translate(sx, sy);
  ell(0, 1, 9, 4, 'rgba(0,0,0,.28)');
  g.fillStyle = '#d9e1ec'; g.fillRect(-8, -28, 16, 28); g.fillStyle = '#b7c3d4'; g.fillRect(-8, -28, 16, 3);
  g.fillStyle = '#6fb2cf'; g.fillRect(-4, -20, 3, 3); g.fillStyle = '#E0645A'; g.fillRect(1, -20, 3, 3);
  g.fillStyle = 'rgba(125,200,235,.85)'; g.beginPath(); g.roundRect(-6, -52, 12, 24, 4); g.fill();
  g.fillStyle = 'rgba(255,255,255,.7)';
  if(!reduced) for(let i = 0; i < 3; i++){ const t = ((T / 1100 + i * .33) % 1); g.beginPath(); g.arc(Math.sin(i * 2 + t * 6) * 2, -30 - t * 18, 1.1, 0, 7); g.fill(); }
  g.restore();
}
function drawTable(x, y){
  const [sx, sy] = pp(x, y, 0);
  if(LOW){ line([sx, sy], [sx, sy - 26], '#2a303d', 3); ell(sx, sy - 28, 15, 7.5, '#d9b88c'); return; }
  g.save(); g.translate(sx, sy);
  ell(0, 1, 11, 5, 'rgba(0,0,0,.28)'); line([0, 0], [0, -26], '#2a303d', 3);
  ell(0, -27, 15, 7.5, '#c9a074'); ell(0, -28, 15, 7.5, '#d9b88c');
  g.restore();
}
function drawSofa(x, y, w, c){
  box(x, y, w, .9, 0, 11, sh(c, -.2)); box(x, y + .65, w, .25, 11, 14, sh(c, -.1));
  box(x, y, .2, .9, 11, 7, sh(c, .05)); box(x + w - .2, y, .2, .9, 11, 7, sh(c, .05)); box(x + .2, y + .05, w - .4, .6, 11, 4, c);
}

/* ---- floors */
const CXA = [-.5, W + .5, W + .5, -.5], CYA = [-.5, -.5, D + .5, D + .5];
const CXG = [-2.5, W + 9.5, W + 9.5, -2.5], CYG = [-.5, -.5, D + 2.8, D + 2.8];
/* screen rectangle (device px) of a floor, optionally united with RC4 */
function floorBox(fl, top, union){
  const sB = ZB, sL = ZL; ZB = 0; ZL = fl.lift;
  const cx = fl.i === 0 ? CXG : CXA, cy = fl.i === 0 ? CYG : CYA;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for(let zi = 0; zi < 2; zi++){
    const zz = zi ? fl.z0 + top : fl.z0 - 14;
    for(let ci = 0; ci < 4; ci++){ const p = pp(cx[ci], cy[ci], zz); if(p[0] < x0) x0 = p[0]; if(p[0] > x1) x1 = p[0]; if(p[1] < y0) y0 = p[1]; if(p[1] > y1) y1 = p[1]; }
  }
  ZB = sB; ZL = sL;
  const m = 90 * cam.z, ox = cw / 2 + cam.px, oy = ch / 2 + cam.py;
  const a0 = (x0 * cam.z + ox - m) * dpr, b0 = (y0 * cam.z + oy - m) * dpr, a1 = (x1 * cam.z + ox + m) * dpr, b1 = (y1 * cam.z + oy + m) * dpr;
  if(union){ if(a0 < RC4[0]) RC4[0] = a0; if(b0 < RC4[1]) RC4[1] = b0; if(a1 > RC4[2]) RC4[2] = a1; if(b1 > RC4[3]) RC4[3] = b1; }
  else { RC4[0] = a0; RC4[1] = b0; RC4[2] = a1; RC4[3] = b1; }
}
function sortStatic(fl){
  const L = fl.st, out = fl.sorted; out.length = L.length;
  for(let i = 0; i < L.length; i++){
    const it = L[i]; let k;
    if(it.pts){ k = -1e9; for(let q = 0; q < it.pts.length; q++){ const d = dep(it.pts[q][0], it.pts[q][1]); if(d > k) k = d; } k += it.b; } else k = dep(it.cx, it.cy) + it.b;
    it.k = k; out[i] = it;
  }
  out.sort(byK);
  fl.sortRA = RA; fl.sortN = L.length;
}
/* agents of a floor, back to front, in fl.ag / fl.agk (the lift cabin is a null entry) */
function sortDyn(fl, cab){
  const ag = fl.ag, ak = fl.agk; let m = ag.length;
  for(let i = 0; i < m; i++) ak[i] = dep(ag[i].x, ag[i].y) + .02;
  if(cab){ ag[m] = null; ak[m] = dep(9, 9.75) + .05; m++; }
  for(let i = 1; i < m; i++){ const a = ag[i], k = ak[i]; let j = i - 1; while(j >= 0 && ak[j] > k){ ag[j + 1] = ag[j]; ak[j + 1] = ak[j]; j--; } ag[j + 1] = a; ak[j + 1] = k; }
  return m;
}
function drawDyn(fl, a){
  if(a){ drawAgent(a, a.inCab ? EL.z : fl.z0); ZB = fl.z0; }
  else { const sz = ZB; drawCab(EL.z); ZB = sz; }
}
function drawStatic(fl, s, e){
  if(s.kind === 'pop' && e < 1){
    const sc = Math.max(.001, eob(e)), b = pp(s.cx, s.cy, 0);
    g.save(); g.globalAlpha = Math.min(1, e * 3); g.translate(b[0], b[1]); g.scale(1, sc); g.translate(-b[0], -b[1]); s.fn(1); g.restore();
  } else if(s.kind === 'wall') s.fn(e);
  else s.fn(1);
}
/* the open floor: interior, furniture and agents sorted back to front (static order cached per angle) */
function drawOpen(fl){
  const p = fl.plot; if(p && !p.started) return;
  ZB = fl.z0; ZL = fl.lift;
  let building = !!(p && !p.done);
  for(let zi = 0; zi < fl.zones.length; zi++){ const zp = fl.zones[zi].plot; if(zp && !zp.done) building = true; }
  drawCached(fl, 'base', building ? -1 : fl.ver | 0, () => { drawSlab(fl); drawFloorTiles(fl); drawShadows(fl); drawBeams(fl); drawSheen(fl); });
  if(fl.sortRA !== RA || fl.sortN !== fl.st.length) sortStatic(fl);
  const m = sortDyn(fl, Math.round(EL.cur) === fl.i), ag = fl.ag, ak = fl.agk, st = fl.sorted, ns = st.length, done = !p || p.done;
  let di = 0;
  const vz = cam.z, vx0 = (-cw / 2 - cam.px) / vz - 160, vx1 = (cw / 2 - cam.px) / vz + 160, vy0 = (-ch / 2 - cam.py) / vz - 60, vy1 = (ch / 2 - cam.py) / vz + 130, lowD = cam.z < .4;
  for(let si = 0; si <= ns; si++){
    const lim = si < ns ? st[si].k : 1e18;
    while(di < m && ak[di] <= lim){ const a = ag[di]; di++; if(a){ const q = pp(a.x, a.y, 0); if(q[0] < vx0 || q[0] > vx1 || q[1] < vy0 || q[1] > vy1) continue; } drawDyn(fl, a); }
    if(si === ns) break;
    const it = st[si];
    if(lowD && it.kind === 'decor') continue;
    const q = pp(it.cx, it.cy, 0); if(q[0] < vx0 || q[0] > vx1 || q[1] < vy0 || q[1] > vy1) continue;
    let e = 1; const ip = it.pl;
    if(ip && !ip.done){ if(!ip.started) continue; e = clamp((T - ip.start - it.t0) / it.dur, 0, 1); if(e <= 0) continue; }
    drawStatic(fl, it, e);
  }
  for(let i = 0; i < particles.length; i++){
    const q = particles[i]; if(q.f !== fl.i) continue;
    const pt = pp(q.x, q.y, q.z), al = 1 - q.life / q.max;
    g.globalAlpha = Math.max(0, al) * (q.steam ? .5 : 1); g.fillStyle = q.col; g.beginPath(); g.arc(pt[0] + (q.steam ? Math.sin(q.life / 220) * 2 : 0), pt[1], q.size * (q.steam ? 1 + q.life / 900 : 1), 0, 7); g.fill(); g.globalAlpha = 1;
  }
  if(p && !p.done) drawGuard(fl);
  for(let zi = 0; zi < fl.zones.length; zi++){ const zp = fl.zones[zi].plot; if(zp && !zp.done) drawZoneGuard(fl, fl.zones[zi]); }
  if(fl.op < .98){   // ceiling that closes the floor while its walls rise
    const q = topQ(-.3, -.3, W + .6, D + .55, BH); g.globalAlpha = 1 - fl.op;
    g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.closePath(); g.fillStyle = CONC; g.fill(); g.globalAlpha = 1;
  }
}
/* people who walk on the pavement stay visible when the ground floor is closed; they fade out in the doorway */
function drawOutside(fl){
  const m = sortDyn(fl, false), ag = fl.ag;
  for(let i = 0; i < m; i++){
    const a = ag[i]; if(a.y <= D - .5) continue;
    const al = a.alpha; a.alpha = al * clamp((a.y - (D - .5)) / .8, 0, 1); drawAgent(a, fl.z0); ZB = fl.z0; a.alpha = al;
  }
}
function closedBody(fl, roof){
  if(fl.i === 0 && !FV.py) drawOutside(fl);
  const rv = roof && ROOF.k < .999 ? -1 : (fl.ver | 0) * 8 + (fl.i === 0 ? Math.round(doorState.open * 6) : 0);
  drawCached(fl, roof ? 'bodyR' : 'body', rv, () => facadeBody(fl, roof), BH + 50);
  if(roof) drawBeacon();
  if(fl.i === 0 && FV.py) drawOutside(fl);
}
const closedOK = (f) => f.op < .02 && f.vis >= .99 && !(f.plot && !f.plot.started);
function drawBuilding(night){
  const nf = floors.length; let lastV = -1;
  tickPlots(); roofStep();
  for(let i = nf - 1; i >= 0; i--){ const f = floors[i]; if(f.vis > .01 && !(f.plot && !f.plot.started)){ lastV = i; break; } }
  let i = 0;
  while(i < nf){
    const f = floors[i];
    if(f.vis <= .01 || (f.plot && !f.plot.started)){ i++; continue; }
    floorBox(f, i === lastV ? BH + 50 : BH + 40, false);
    if(RC4[2] < 0 || RC4[0] > cv.width || RC4[3] < 0 || RC4[1] > cv.height){ i++; continue; }
    const closed = f.op < .02, opaque = f.vis >= .99, alpha = opaque ? 1 : Math.pow(f.vis, 1.5);
    if(!night && opaque){
      ZB = f.z0; ZL = f.lift;
      if(closed){ closedBody(f, i === ROOF.host); facadeWindows(f); } else drawOpen(f);
      i++; continue;
    }
    if(closed){
      let j = i;
      if(opaque) while(j + 1 < nf && closedOK(floors[j + 1])) j++;
      for(let k = i + 1; k <= j; k++) floorBox(floors[k], k === lastV ? BH + 50 : BH + 40, true);
      passBegin(RC4[0], RC4[1], RC4[2], RC4[3]);
      for(let k = i; k <= j; k++){ const fk = floors[k]; ZB = fk.z0; ZL = fk.lift; closedBody(fk, k === ROOF.host); }
      passTint();
      for(let k = i; k <= j; k++){ const fk = floors[k]; ZB = fk.z0; ZL = fk.lift; facadeWindows(fk); }
      passEnd(alpha); i = j + 1;
    } else {
      passBegin(RC4[0], RC4[1], RC4[2], RC4[3]);
      drawOpen(f); passTint(); if(f.vis > .5) lightsFor(f);
      passEnd(alpha); i++;
    }
  }
  ZB = 0; ZL = 0;
}
