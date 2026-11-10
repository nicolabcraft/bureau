/* web/immeuble/ville.js: part of the building view, owned by the « ville » module (see docs/vue-immeuble.md). */
/* ================================================================ city and landscape
   The city around the building: street grid, blocks with shops (signs, awnings), park with a fountain,
   bus stops, car parks, trees and street lamps; life: cars and buses obeying the lights, bikes, pedestrians
   crossing at the crosswalks, crowds at the lights, steam, birds, cloud shadows; at night: windows,
   street lamps, signs and headlights lit; sky with sun, moon and stars.

   How it stays light: the static decor is baked in off-screen tiles (per rotation angle and zoom tier),
   only the living elements are drawn every frame, with a level of detail that follows the zoom. During a
   rotation or a zoom the decor is drawn live, then baked again once the view is stable.

   Entry points used by the engine: buildCity(), cityInit(), updateCars(dt), cityBegin/cityBack/cityFront(night).
   Every other name starts with ville / VILLE_. */

const city = {bl: [], trees: [], lamps: [], cars: []};
const WX0 = -44, WX1 = W + 44, WY0 = -44, WY1 = D + 48;

/* ------------------------------------------------------------------ street grid */
const villeHY = [-25.5, -6.5, 24.5, 44.5];                           // axes of the streets running along x
const villeVX = [-27.5, -6.5, 21.5, 42.5];                           // axes of the streets running along y
const villeXE = [WX0, -30, -25, -9, -4, 19, 24, 40, 45, WX1];        // blocks along x: [2i, 2i+1]
const villeYE = [WY0, -28, -23, -9, -4, 22, 27, 42, 47, WY1];        // blocks along y: [2i, 2i+1]
const VILLE_PL = 3.35;       // crosswalk axis, from the street axis
const VILLE_STOP = 4.5;      // stop line, from the crossing street axis
const VILLE_CYC = 21;        // traffic light cycle (s)
const VILLE_FP = 46;         // height of one storey (px)
const VILLE_TS = 512;        // tile size (px)
const VILLE_TIERS = [.25, .375, .56, .84, 1.27, 1.9, 2.85, 4.3, 6.4];
const VILLE_HP = Math.PI / 2;
const VILLE_MAXW = 5000, VILLE_MAXG = 256;
const VT = {BLD: 0, TREE: 1, LAMP: 2, SHEL: 3, BENCH: 4, PCAR: 5, FOUNT: 6, HEDGE: 7};
const VK = {CAR: 0, BUS: 1, BIKE: 2, PED: 3, SIG: 4, FOUNT: 5, WAIT: 6, LOOP: 7, STEAM: 8};

const villeS = {
  t: 3, rs: 2463534242, frame: 0, dseed: 0,
  stat: [], lights: [], gops: [], lanes: [], dynAll: [], birds: [], clouds: [],
  sigH: new Uint8Array(16), sigV: new Uint8Array(16), okX: new Uint8Array(16), okY: new Uint8Array(16), off: new Float32Array(16),
  nx: new Float32Array(64), ny: new Float32Array(64), nn: new Int16Array(256), ncr: new Uint8Array(256),
  angs: [null, null, null, null], tiles: new Map(), vs: new Map(), pool: [], tier: -1, rest: true, ang: 0,
  z: 1, tx: 0, ty: 0, K: 0, vx0: 0, vx1: 0, vy0: 0, vy1: 0, cx: 0, cy: 0,
  vis: [], nv: 0, mi: new Int32Array(256), mj: new Int32Array(256), nm: 0,
  dyn: [], dk: new Float64Array(512), nd: 0, dneg: 0,
  ls: new Int32Array(2048), lk: new Float64Array(2048),
  lastZ: 0, zStable: 0, ready: false, spr: null, sky: null,
  // lit windows recorded during a bake
  bs: 1, bx: 0, by: 0, ov: null, rec: false, tile: null
};

/* ------------------------------------------------------------------ helpers */
function villeRnd(){
  let x = villeS.rs | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; villeS.rs = x;
  return (x >>> 0) / 4294967296;
}
function villeHash(a, b, c, d){
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483629) + Math.imul(d | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
let villeA = 0, villeB = 0, villeC = 0, villeD = 0;
function villeProj(){ villeA = (RC - RS) * 32; villeB = -(RS + RC) * 32; villeC = (RC + RS) * 16; villeD = (RC - RS) * 16; }
const villeSx = (x, y) => (x - PV.x) * villeA + (y - PV.y) * villeB;
const villeSy = (x, y, z) => (x - PV.x) * villeC + (y - PV.y) * villeD - z;
const villeDep = (x, y) => (x - PV.x) * (RC + RS) + (y - PV.y) * (RC - RS);

function villeObj(t, x0, y0, x1, y1, h){
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {t, x0, y0, x1, y1, h, zt: h, cx, cy, x: cx, y: cy, col: '#56627B', col2: '#3a4256', v: 0, s: 1, nf: 1, gh: 40, z0: 0, f: 0, sf: 0, roof: 0, id: 0, big: 8,
    bal: 0, shop: 0, name: '', sign: '#c0564a', aw: '#c0564a', aw2: '#efe6d4', kx: 0, ky: 0, steam: 0, type: 0, ax: 0};
}
function villeAdd(o){ villeS.stat.push(o); return o; }
function villeLight(x, y, hx, hy, hz, pr, gr){ villeS.lights.push({x, y, hx, hy, hz, pr, gr, hid: new Int8Array(4).fill(-1)}); }

const VILLE_WALL = ['#8c7b6b', '#9a8a78', '#6f7d8a', '#7b8a94', '#a39382', '#7a6a62', '#8a9484', '#6e7487', '#9b7e6c', '#85736a', '#5f6b7a', '#b0a590', '#8f8678', '#73808f'];
const VILLE_ROOF = ['#4a4e58', '#5a5560', '#6b4a42', '#44505c', '#585f6b', '#4f4a46'];
const VILLE_SIGN = ['#b5483c', '#2f6f8f', '#c58a2a', '#3f8a63', '#7a4a8a', '#a8457a', '#2d6a6a', '#c56a2a'];
const VILLE_AW = [['#b5483c', '#efe6d4'], ['#2f6f8f', '#efe6d4'], ['#3f8a63', '#efe6d4'], ['#c58a2a', '#efe6d4'], ['#7a4a8a', '#efe6d4'], ['#a8457a', '#efe6d4']];
const VILLE_NAMES = ['Boulangerie', 'Café du Coin', 'Pharmacie', 'Librairie', 'Fleuriste', 'Épicerie', 'Opticien', 'Pressing', 'Banque', 'Le Zinc', 'Pizzeria', 'Tabac', 'Coiffeur', 'Fromagerie', 'Cinéma', 'Hôtel', 'Vélos', 'Musique', 'Jeux', 'Atelier', 'Crêperie', 'Primeur', 'Boucherie', 'Chocolat'];
const VILLE_GL = ['#4f6786', '#86a3c0', '#a89f86'];
const VILLE_SKIN = ['#F1C7A0', '#E0AC82', '#C58C62', '#8D5A3B', '#6B4128'];
const VILLE_HAIR = ['#2b2118', '#5a3a22', '#a8772f', '#1a1a1f', '#8d8d96', '#b4472f'];
const VILLE_SHIRT = ['#d9dee8', '#b9c8e0', '#e8cfb0', '#a8d0c4', '#cdb6e0', '#eeb0aa', '#e8c25a', '#6d8fc4', '#c0564a', '#4f8f6c'];
const VILLE_PANTS = ['#2f3a50', '#3a3f4d', '#46506a', '#5a4a3a', '#2a2f3a'];
const VILLE_CARS = ['#c0564a', '#d9b45a', '#5a86b8', '#8a8f9c', '#6fa88f', '#e8e4da', '#3f4658', '#a8537a', '#4a7a5a', '#cfd2d8'];

/* ------------------------------------------------------------------ generation: ground */
function villeGenGround(){
  const G = villeS.gops; G.length = 0;
  const R = (x0, y0, x1, y1, col) => G.push({t: 0, x0, y0, x1, y1, col, a: 0, b: null});
  const Ln = (x0, y0, x1, y1, col, w, dash) => G.push({t: 1, x0, y0, x1, y1, col, a: w, b: dash || null});
  const C = (cx, cy, rx, ry, col) => G.push({t: 2, x0: cx, y0: cy, x1: rx, y1: ry, col, a: 0, b: null});
  R(WX0, WY0, WX1, WY1, '#1b2231');
  // block backgrounds
  for(let bx = 0; bx < 5; bx++) for(let by = 0; by < 5; by++){
    const x0 = villeXE[bx * 2], x1 = villeXE[bx * 2 + 1], y0 = villeYE[by * 2], y1 = villeYE[by * 2 + 1];
    const col = (bx === 2 && by === 2) ? '#243a31' : (bx === 2 && by === 3) ? '#2a4a38' : (bx === 3 && by === 2) ? '#1f2634' : '#272f40';
    R(x0, y0, x1, y1, col);
  }
  // building platform and slab joints
  R(-3, -3, W + 3, D + 3.3, '#2c3547');
  R(-3, D + 3.05, W + 3, D + 3.3, '#3a4559');
  for(let x = -2; x < W + 3; x += 1) Ln(x, -3, x, D + 3.3, 'rgba(255,255,255,.035)', .8);
  for(let y = -2; y < D + 3.3; y += 1) Ln(-3, y, W + 3, y, 'rgba(255,255,255,.035)', .8);
  // sidewalks and curbs
  for(let bx = 0; bx < 5; bx++) for(let by = 0; by < 5; by++){
    const x0 = villeXE[bx * 2], x1 = villeXE[bx * 2 + 1], y0 = villeYE[by * 2], y1 = villeYE[by * 2 + 1];
    const sw = '#343d51', cb = '#4a556c';
    R(x0, y0, x1, y0 + 2, sw); R(x0, y1 - 2, x1, y1, sw); R(x0, y0 + 2, x0 + 2, y1 - 2, sw); R(x1 - 2, y0 + 2, x1, y1 - 2, sw);
    if(by > 0) R(x0, y0, x1, y0 + .25, cb);
    if(by < 4) R(x0, y1 - .25, x1, y1, cb);
    if(bx > 0) R(x0, y0, x0 + .25, y1, cb);
    if(bx < 4) R(x1 - .25, y0, x1, y1, cb);
  }
  // streets
  const road = '#171c28';
  for(const y of villeHY) R(WX0, y - 2.5, WX1, y + 2.5, road);
  for(const x of villeVX) R(x - 2.5, WY0, x + 2.5, WY1, road);
  // markings: dashed axis, bike lanes, crosswalks, stop lines
  const dash = [14, 12], dash2 = [6, 6];
  for(let j = 0; j < 4; j++){
    const y = villeHY[j];
    for(let i = -1; i < 4; i++){
      const a = i < 0 ? WX0 : villeVX[i] + 4.6, b = i === 3 ? WX1 : villeVX[i + 1] - 4.6;
      Ln(a, y, b, y, 'rgba(238,226,170,.5)', 1.3, dash);
      Ln(a, y - 1.9, b, y - 1.9, 'rgba(236,240,250,.16)', 1, dash2); Ln(a, y + 1.9, b, y + 1.9, 'rgba(236,240,250,.16)', 1, dash2);
    }
  }
  for(let i = 0; i < 4; i++){
    const x = villeVX[i];
    for(let j = -1; j < 4; j++){
      const a = j < 0 ? WY0 : villeHY[j] + 4.6, b = j === 3 ? WY1 : villeHY[j + 1] - 4.6;
      Ln(x, a, x, b, 'rgba(238,226,170,.5)', 1.3, dash);
      Ln(x - 1.9, a, x - 1.9, b, 'rgba(236,240,250,.16)', 1, dash2); Ln(x + 1.9, a, x + 1.9, b, 'rgba(236,240,250,.16)', 1, dash2);
    }
  }
  const zc = 'rgba(238,242,250,.5)', sl = 'rgba(238,242,250,.42)';
  for(let i = 0; i < 4; i++) for(let j = 0; j < 4; j++){
    const cx = villeVX[i], cy = villeHY[j];
    for(let k = 0; k < 6; k++){
      const o = -2.25 + k * .9;
      R(cx + 2.7, cy + o, cx + 3.95, cy + o + .45, zc); R(cx - 3.95, cy + o, cx - 2.7, cy + o + .45, zc);
      R(cx + o, cy + 2.7, cx + o + .45, cy + 3.95, zc); R(cx + o, cy - 3.95, cx + o + .45, cy - 2.7, zc);
    }
    R(cx - 4.65, cy + .15, cx - 4.3, cy + 2.45, sl); R(cx + 4.3, cy - 2.45, cx + 4.65, cy - .15, sl);
    R(cx - 2.45, cy - 4.65, cx - .15, cy - 4.3, sl); R(cx + .15, cy + 4.3, cx + 2.45, cy + 4.65, sl);
  }
  // park: paths, esplanade, flower beds
  const pc = {x: 7.5, y: 34.5};
  R(-2, 33.7, 17, 35.3, '#3b4457'); R(6.7, 29, 8.3, 40, '#3b4457');
  C(pc.x, pc.y, 5.6, 5.6, '#454f64'); C(pc.x, pc.y, 5.1, 5.1, '#3d465b');
  for(const [fx, fy] of [[2, 31.5], [13, 31.5], [2, 37.5], [13, 37.5]]){
    C(fx, fy, 1.7, 1.7, '#3a2d3f'); C(fx, fy, 1.3, 1.3, '#355c3f');
    for(let k = 0; k < 7; k++){ const a = k * 0.9, rr = k === 0 ? 0 : .75; C(fx + Math.cos(a) * rr, fy + Math.sin(a) * rr, .26, .26, ['#e06a7a', '#f0c36a', '#b78ae0', '#f4f0e6'][k % 4]); }
  }
  // car park: bays, arrows, curbs
  for(let k = 0; k <= 12; k++){ const y = -1 + k * 1.7; Ln(27, y, 30, y, 'rgba(236,240,250,.4)', 1); Ln(34, y, 37, y, 'rgba(236,240,250,.4)', 1); }
  Ln(27, -1, 27, 19.4, 'rgba(236,240,250,.3)', 1); Ln(37, -1, 37, 19.4, 'rgba(236,240,250,.3)', 1);
  R(30.9, 1, 31.1, 17, 'rgba(238,226,170,.4)'); R(32.9, 1, 33.1, 17, 'rgba(238,226,170,.4)');
  // bus stops: platform
  R(2.5, 27.25, 6.5, 29, '#3d475c'); R(10.5, 20, 14.5, 21.75, '#3d475c'); R(24.25, 7.5, 26, 11.5, '#3d475c');
  // contact shadow of the buildings
  for(const o of villeS.stat) if(o.t === VT.BLD && o.z0 === 0) R(o.x0 - .45, o.y0 - .45, o.x1 + .45, o.y1 + .45, 'rgba(6,10,20,.26)');
}

/* ------------------------------------------------------------------ generation: buildings and street furniture */
function villeMkBuilding(r, ring, x0, y0, x1, y1, bd){
  const w = x1 - x0, d = y1 - y0, u = r();
  const type = ring === 1 ? (u < .52 ? 0 : u < .8 ? 1 : 2) : (u < .2 ? 0 : u < .62 ? 1 : u < .76 ? 2 : 3);
  const o = villeObj(VT.BLD, x0, y0, x1, y1, 0);
  o.type = type; o.id = villeS.stat.length + 1;
  o.col = VILLE_WALL[(r() * VILLE_WALL.length) | 0]; o.col2 = VILLE_ROOF[(r() * VILLE_ROOF.length) | 0];
  o.name = VILLE_NAMES[(r() * VILLE_NAMES.length) | 0]; o.sign = VILLE_SIGN[(r() * VILLE_SIGN.length) | 0];
  const aw = VILLE_AW[(r() * VILLE_AW.length) | 0]; o.aw = aw[0]; o.aw2 = aw[1];
  let nf;
  if(type === 0) nf = ring === 1 ? (r() < .55 ? 1 : 2) : 2 + ((r() * 2) | 0);
  else if(type === 1) nf = ring === 1 ? 2 : 3 + ((r() * 4) | 0);
  else if(type === 2) nf = 2;
  else nf = 6 + ((r() * 2) | 0);
  o.nf = nf;
  o.gh = type === 2 ? 40 : 52;
  o.shop = (type === 0 || (type === 1 && r() < .5)) ? 1 : 0;
  o.bal = (type === 1 || (type === 0 && nf > 1 && r() < .5)) && r() < .7 ? 1 : 0;
  o.roof = type === 2 ? 2 : r() < .3 && nf > 1 ? 1 : 0;
  o.h = o.gh + (nf - 1) * VILLE_FP + 4;
  o.zt = o.h + (type === 2 ? 26 : 20);
  o.steam = r() < .12 ? 1 : 0;
  const e = .06;
  o.sf = (y1 >= bd.y1 - e ? 1 : 0) | (y0 <= bd.y0 + e ? 2 : 0) | (x1 >= bd.x1 - e ? 4 : 0) | (x0 <= bd.x0 + e ? 8 : 0);
  o.big = Math.max(w, d) + o.h / 14;
  villeAdd(o); city.bl.push(o);
  if(type === 3){
    // tower: setback storey with a crown
    const n1 = Math.max(3, (nf * .62) | 0); o.nf = n1; o.h = o.gh + (n1 - 1) * VILLE_FP + 4; o.roof = 3; o.zt = o.h + 4; o.shop = r() < .4 ? 1 : 0; o.bal = 0;
    const u2 = villeObj(VT.BLD, x0 + 1.1, y0 + 1.1, x1 - 1.1, y1 - 1.1, 0);
    u2.type = 3; u2.id = o.id + 1000; u2.col = o.col; u2.col2 = o.col2; u2.z0 = o.h; u2.gh = VILLE_FP; u2.nf = nf - n1 + 1; u2.h = (u2.nf - 1) * VILLE_FP + 6; u2.zt = o.h + u2.h + 40; u2.roof = 0; u2.sf = 0; u2.steam = 0; u2.big = o.big;
    u2.ax = 1;
    villeAdd(u2); city.bl.push(u2);
  }
  return o;
}
function villeRow(r, ring, xa, xb, ya, yb, bd){
  let x = xa;
  while(x < xb - .2){
    let w = 4 + r() * 3.6; if(xb - (x + w) < 3.6) w = xb - x;
    villeMkBuilding(r, ring, x, ya, x + w, yb, bd);
    x += w;
  }
}
function villeGenLotBlock(r, ring, ix0, iy0, ix1, iy1){
  const bd = {x0: ix0, y0: iy0, x1: ix1, y1: iy1};
  let dep = ring === 1 ? 5.6 : 6.6;
  const H = iy1 - iy0;
  if(H < 2 * dep + .6) dep = (H - .6) / 2;
  villeRow(r, ring, ix0, ix1, iy0, iy0 + dep, bd);
  villeRow(r, ring, ix0, ix1, iy1 - dep, iy1, bd);
  if(H - 2 * dep > 1.6){
    for(let k = 0; k < 5; k++) villeTree(ix0 + 1.2 + r() * (ix1 - ix0 - 2.4), iy0 + dep + .8 + r() * (H - 2 * dep - 1.6), .8 + r() * .5, (r() * 3) | 0);
  }
}
function villeTree(x, y, s, v){ const o = villeObj(VT.TREE, x, y, x, y, 60 * s); o.s = s; o.v = v; o.zt = 74 * s; o.cx = x; o.cy = y; o.x = x; o.y = y; villeAdd(o); city.trees.push(o); return o; }
function villeLamp(x, y, kx, ky){ const o = villeObj(VT.LAMP, x, y, x, y, 72); o.kx = kx; o.ky = ky; o.zt = 80; villeAdd(o); city.lamps.push(o); villeLight(x, y, x + kx * .85, y + ky * .85, 72, 150, 34); return o; }
function villeBench(x, y, ax){ const o = villeObj(VT.BENCH, x - .8, y - .35, x + .8, y + .35, 14); if(ax){ o.x0 = x - .35; o.x1 = x + .35; o.y0 = y - .8; o.y1 = y + .8; } o.ax = ax; o.cx = x; o.cy = y; o.zt = 22; villeAdd(o); return o; }
function villeHedge(x0, y0, x1, y1, h){ const o = villeObj(VT.HEDGE, x0, y0, x1, y1, h || 12); o.col = '#2f6a45'; o.zt = o.h + 2; villeAdd(o); return o; }
function villeShelter(x, y, ax, kx, ky){
  const o = villeObj(VT.SHEL, x, y, x + (ax ? 1.1 : 2.8), y + (ax ? 2.8 : 1.1), 34); o.ax = ax; o.kx = kx; o.ky = ky; o.zt = 62; villeAdd(o); villeLight((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 0, 0, 0, 90, 0); return o;
}
function villePCar(x, y, ax, sgn, col){ const L = ax ? 2.5 : 1.2, Wd = ax ? 1.2 : 2.5; const o = villeObj(VT.PCAR, x - L / 2, y - Wd / 2, x + L / 2, y + Wd / 2, 26); o.col = col; o.ax = ax; o.kx = sgn; o.zt = 30; villeAdd(o); return o; }

function villeGenPark(r){
  const o = villeObj(VT.FOUNT, 7.5 - 2.6, 34.5 - 2.6, 7.5 + 2.6, 34.5 + 2.6, 14); o.zt = 56; villeAdd(o); villeLight(7.5, 34.5, 0, 0, 0, 150, 0);
  for(let k = 0; k < 15; k++){
    let x, y, ok = false, n = 0;
    while(!ok && n++ < 40){
      x = -1.4 + r() * 17.8; y = 29.8 + r() * 9.6;
      ok = Math.abs(x - 7.5) > 1.7 && Math.abs(y - 34.5) > 1.7 && Math.hypot(x - 7.5, y - 34.5) > 6.1 && !(Math.abs(x - 2) < 2.4 && Math.abs(y - 31.5) < 2.4) && !(Math.abs(x - 13) < 2.4 && Math.abs(y - 31.5) < 2.4) && !(Math.abs(x - 2) < 2.4 && Math.abs(y - 37.5) < 2.4) && !(Math.abs(x - 13) < 2.4 && Math.abs(y - 37.5) < 2.4);
    }
    if(ok) villeTree(x, y, .95 + r() * .5, k % 3);
  }
  villeBench(3.6, 33.1, 0); villeBench(11.4, 33.1, 0); villeBench(3.6, 35.9, 0); villeBench(11.4, 35.9, 0);
  villeLamp(5.4, 31.4, 0, 0); villeLamp(9.6, 31.4, 0, 0); villeLamp(5.4, 37.6, 0, 0); villeLamp(9.6, 37.6, 0, 0);
  for(const [x0, y0, x1, y1] of [[-2, 29.1, 17, 29.7], [-2, 39.5, 17, 40]]) villeHedge(x0, y0, x1, y1, 9);
}
function villeGenParking(r){
  for(let k = 0; k < 12; k++){
    const y = -1 + k * 1.7 + .85;
    if(r() < .66) villePCar(28.5, y, 1, r() < .5 ? 1 : -1, VILLE_CARS[(r() * VILLE_CARS.length) | 0]);
    if(r() < .66) villePCar(35.5, y, 1, r() < .5 ? 1 : -1, VILLE_CARS[(r() * VILLE_CARS.length) | 0]);
  }
  for(const y of [-1.2, 19.2]) villeTree(32, y, 1.1, 0);
  for(const y of [4, 9, 14]) villeLamp(32, y, 0, 0);
  villeHedge(26.2, -1.9, 27, 19.9, 8); villeHedge(37.2, -1.9, 37.9, 19.9, 8);
}
function villeGenStreet(r){
  // trees and lamps along each sidewalk; none at crossings or on bus platforms
  const near = (v, list, m) => { for(const c of list) if(Math.abs(v - c) < m) return true; return false; };
  for(let j = 0; j < 4; j++) for(const sd of [-1, 1]){
    const y = villeHY[j];
    for(let k = 0, x = WX0 + 3 + (sd > 0 ? 0 : 3.4); x < WX1 - 2; k++, x += 6.8){
      if(near(x, villeVX, 5.6)) continue;
      const side = y + sd * 4, lampY = y + sd * 2.85;
      if(j === 2 && sd < 0 && x > 9.5 && x < 16) continue;        // platform of the centre stop
      if(j === 2 && sd > 0 && x > 1.5 && x < 8) continue;         // platform of the park stop
      villeTree(x, side, .85 + r() * .45, (r() * 3) | 0);
      if(!near(x + 3.4, villeVX, 5.6)) villeLamp(x + 3.4, lampY, 0, -sd);
    }
  }
  for(let i = 0; i < 4; i++) for(const sd of [-1, 1]){
    const x = villeVX[i];
    for(let y = WY0 + 3 + (sd > 0 ? 0 : 3.4); y < WY1 - 2; y += 6.8){
      if(near(y, villeHY, 5.6)) continue;
      if(i === 2 && sd > 0 && y > 6.5 && y < 12.5) continue;      // platform of the car park stop
      villeTree(x + sd * 4, y, .85 + r() * .45, (r() * 3) | 0);
      if(!near(y + 3.4, villeHY, 5.6)) villeLamp(x + sd * 2.85, y + 3.4, -sd, 0);
    }
  }
  // bus stops
  villeShelter(10.9, 20.35, 0, 0, 1); villeShelter(3.1, 27.7, 0, 0, -1); villeShelter(24.35, 8, 1, -1, 0);
  // benches and planters around the platform
  for(const x of [3, 7.5, 12]) villeBench(x, -2.3, 0);
  for(const y of [3, 8, 12]) villeBench(-2.3, y, 1);
  for(const [x, y] of [[-3.1, -3.1], [17.1, -3.1], [-3.1, 18.6]]){ villeHedge(x - .6, y - .6, x + .6, y + .6, 10); }
}

function buildCity(){
  const r = mul32(777), S = villeS;
  S.stat.length = 0; S.lights.length = 0; city.bl.length = 0; city.trees.length = 0; city.lamps.length = 0; city.cars.length = 0;
  S.angs[0] = S.angs[1] = S.angs[2] = S.angs[3] = null;
  S.dseed = (Date.now() / 864e5) | 0;
  for(let bx = 0; bx < 5; bx++) for(let by = 0; by < 5; by++){
    const x0 = villeXE[bx * 2], x1 = villeXE[bx * 2 + 1], y0 = villeYE[by * 2], y1 = villeYE[by * 2 + 1];
    const ring = Math.max(Math.abs(bx - 2), Math.abs(by - 2));
    if(ring === 0) continue;
    if(bx === 2 && by === 3){ villeGenPark(r); continue; }
    if(bx === 3 && by === 2){ villeGenParking(r); continue; }
    villeGenLotBlock(r, ring, x0 + 2, y0 + 2, x1 - 2, y1 - 2);
  }
  villeGenStreet(r);
  villeGenGround();
  villeInitDyn(r);
  villeInitSprites();
  S.tiles.clear(); S.tier = -1;
}

/* ------------------------------------------------------------------ static decor drawing (baking and live mode) */
let villeFax = 0, villeFay = 0, villeFtx = 0, villeFty = 0, villeFnx = 0, villeFny = 0, villeFlen = 0;
const VILLE_FN = ['py', 'my', 'px', 'mx'];
function villeFaceGeo(b, f){
  if(f === 0){ villeFax = b.x0; villeFay = b.y1; villeFtx = 1; villeFty = 0; villeFnx = 0; villeFny = 1; villeFlen = b.x1 - b.x0; }
  else if(f === 1){ villeFax = b.x0; villeFay = b.y0; villeFtx = 1; villeFty = 0; villeFnx = 0; villeFny = -1; villeFlen = b.x1 - b.x0; }
  else if(f === 2){ villeFax = b.x1; villeFay = b.y0; villeFtx = 0; villeFty = 1; villeFnx = 1; villeFny = 0; villeFlen = b.y1 - b.y0; }
  else { villeFax = b.x0; villeFay = b.y0; villeFtx = 0; villeFty = 1; villeFnx = -1; villeFny = 0; villeFlen = b.y1 - b.y0; }
}
// path of a vertical quad on the current face, from u0 to u1 (along), z0 to z1, pushed outwards by off
function villeFq(u0, u1, z0, z1, off){
  const ax = villeFax + villeFtx * u0 + villeFnx * off, ay = villeFay + villeFty * u0 + villeFny * off;
  const bx = villeFax + villeFtx * u1 + villeFnx * off, by = villeFay + villeFty * u1 + villeFny * off;
  const sa = villeSx(ax, ay), sb = villeSx(bx, by);
  g.moveTo(sa, villeSy(ax, ay, z0)); g.lineTo(sb, villeSy(bx, by, z0)); g.lineTo(sb, villeSy(bx, by, z1)); g.lineTo(sa, villeSy(ax, ay, z1)); g.closePath();
}
// sloped quad: from (u0..u1, offset o0, z0) to (u0..u1, offset o1, z1)
function villeSlope(u0, u1, o0, z0, o1, z1){
  const ax = villeFax + villeFtx * u0, ay = villeFay + villeFty * u0, bx = villeFax + villeFtx * u1, by = villeFay + villeFty * u1;
  g.moveTo(villeSx(ax + villeFnx * o0, ay + villeFny * o0), villeSy(ax + villeFnx * o0, ay + villeFny * o0, z0));
  g.lineTo(villeSx(bx + villeFnx * o0, by + villeFny * o0), villeSy(bx + villeFnx * o0, by + villeFny * o0, z0));
  g.lineTo(villeSx(bx + villeFnx * o1, by + villeFny * o1), villeSy(bx + villeFnx * o1, by + villeFny * o1, z1));
  g.lineTo(villeSx(ax + villeFnx * o1, ay + villeFny * o1), villeSy(ax + villeFnx * o1, ay + villeFny * o1, z1));
  g.closePath();
}
function villeTopPath(x0, y0, x1, y1, z){
  g.moveTo(villeSx(x0, y0), villeSy(x0, y0, z)); g.lineTo(villeSx(x1, y0), villeSy(x1, y0, z)); g.lineTo(villeSx(x1, y1), villeSy(x1, y1, z)); g.lineTo(villeSx(x0, y1), villeSy(x0, y1, z)); g.closePath();
}
// record of a lightable quad (coordinates in the glow tile, half resolution)
function villeRec(u0, u1, z0, z1, off, a, b, c, d, cls){
  const L = villeS.ov; if(!L || L.n >= VILLE_MAXW) return;
  const ax = villeFax + villeFtx * u0 + villeFnx * off, ay = villeFay + villeFty * u0 + villeFny * off;
  const bx = villeFax + villeFtx * u1 + villeFnx * off, by = villeFay + villeFty * u1 + villeFny * off;
  const k = villeS.bs * .5, X = villeS.bx, Y = villeS.by, q = L.q, i = L.n * 8;
  const x0 = (villeSx(ax, ay) - X) * k, x1 = (villeSx(bx, by) - X) * k;
  const y0a = (villeSy(ax, ay, z0) - Y) * k, y0b = (villeSy(bx, by, z0) - Y) * k, y1a = (villeSy(ax, ay, z1) - Y) * k, y1b = (villeSy(bx, by, z1) - Y) * k;
  if(Math.max(x0, x1) < -2 || Math.min(x0, x1) > 258) return;
  if(Math.max(Math.max(y0a, y0b), Math.max(y1a, y1b)) < -2 || Math.min(Math.min(y0a, y0b), Math.min(y1a, y1b)) > 258) return;
  q[i] = x0; q[i + 1] = y0a; q[i + 2] = x1; q[i + 3] = y0b; q[i + 4] = x1; q[i + 5] = y1b; q[i + 6] = x0; q[i + 7] = y1a;
  const j = L.n * 4; L.sc[j] = a; L.sc[j + 1] = b; L.sc[j + 2] = c; L.sc[j + 3] = d; L.cl[L.n] = cls; L.n++;
}
function villeFloorZ(b, fi){ return b.z0 + (fi === 0 ? 0 : b.gh + (fi - 1) * VILLE_FP); }

function villeFace(b, f, lod){
  villeFaceGeo(b, f);
  const len = villeFlen, shd = NS[VILLE_FN[f]], gh = b.gh, nf = b.nf, z0 = b.z0, bit = (b.sf >> f) & 1;
  const shopF = b.shop && bit && z0 === 0, doorF = bit && !shopF && z0 === 0;
  const cols = Math.max(1, Math.floor((len - .4) / 1.3)), pitch = len / cols, ww = pitch * .55, mg = (pitch - ww) / 2;
  const top = z0 + b.h, rec = villeS.rec && lod === 0, fi0 = shopF ? 1 : 0;
  if(lod === 1){
    // medium level of detail: one row of windows per storey, dashes
    const u0 = mg, u1 = len - mg;
    const x0 = villeFax + villeFtx * u0, y0 = villeFay + villeFty * u0, x1 = villeFax + villeFtx * u1, y1 = villeFay + villeFty * u1;
    const L = Math.hypot(villeSx(x1, y1) - villeSx(x0, y0), villeSy(x1, y1, 0) - villeSy(x0, y0, 0)), k = L / Math.max(.1, u1 - u0);
    g.setLineDash([ww * k, (pitch - ww) * k]); g.lineWidth = 24; g.lineCap = 'butt'; g.strokeStyle = sh(VILLE_GL[0], shd * .7);
    g.beginPath();
    for(let fi = fi0; fi < nf; fi++){ const z = villeFloorZ(b, fi) + 23; g.moveTo(villeSx(x0, y0), villeSy(x0, y0, z)); g.lineTo(villeSx(x1, y1), villeSy(x1, y1, z)); }
    g.stroke(); g.setLineDash([]);
    return;
  }
  // cornices
  g.beginPath(); for(let fi = 1; fi < nf; fi++){ const z = villeFloorZ(b, fi); villeFq(0, len, z - 1.5, z + 1, 0); }
  villeFq(0, len, top - 4.5, top + .3, 0);
  g.fillStyle = sh(b.col, shd + .1); g.fill();
  // windows, by glass tone
  for(let tone = 0; tone < 3; tone++){
    g.beginPath(); let any = 0;
    for(let fi = fi0; fi < nf; fi++){
      const fz = villeFloorZ(b, fi), wz0 = fz + 11, wz1 = fz + 35;
      for(let c = 0; c < cols; c++){
        if(doorF && fi === 0 && c === (cols >> 1)) continue;
        const hv = villeHash(b.id, f, fi, c), tn = hv < .5 ? 0 : hv < .82 ? 1 : 2;
        if(tn !== tone) continue;
        const u0 = mg + c * pitch;
        villeFq(u0, u0 + ww, wz0, wz1, .01); any = 1;
        if(rec && villeHash(b.id, f + 7, fi, c + villeS.dseed) < .66){
          const h3 = villeHash(b.id, f + 11, fi, c), h4 = villeHash(c, fi, b.id, f + 3);
          const on = 17.6 + h3 * h3 * 4.2, off = 21.8 + h4 * 9.4, m1 = villeHash(fi, c, f, b.id) < .32;
          const on2 = m1 ? 5 + h3 * 2.2 : -1, off2 = m1 ? on2 + .4 + h4 * 1 : -1;
          villeRec(u0, u0 + ww, wz0, wz1, .01, on, off, on2, off2, tone === 2 ? 1 : hv < .12 ? 2 : 0);
        }
      }
    }
    if(any){ g.fillStyle = sh(VILLE_GL[tone], shd * .7); g.fill(); }
  }
  // balconies
  if(b.bal && z0 === 0){
    g.beginPath(); for(let fi = 1; fi < nf; fi++) for(let c = 1; c < cols; c += 2){ const u0 = mg + c * pitch - .12, fz = villeFloorZ(b, fi); villeSlope(u0, u0 + ww + .24, 0, fz + 1, .65, fz + 1); }
    g.fillStyle = sh('#b6b1a4', shd + .05); g.fill();
    g.beginPath(); for(let fi = 1; fi < nf; fi++) for(let c = 1; c < cols; c += 2){ const u0 = mg + c * pitch - .12, fz = villeFloorZ(b, fi); villeFq(u0, u0 + ww + .24, fz - 2, fz + 1, .65); }
    g.fillStyle = sh('#8d887c', shd); g.fill();
    g.beginPath(); for(let fi = 1; fi < nf; fi++) for(let c = 1; c < cols; c += 2){ const u0 = mg + c * pitch - .12, fz = villeFloorZ(b, fi); villeFq(u0, u0 + ww + .24, fz + 1, fz + 10, .65); }
    g.fillStyle = 'rgba(160,190,215,.22)'; g.fill(); g.strokeStyle = sh('#2a3140', shd); g.lineWidth = .9; g.stroke();
  }
  if(shopF){
    g.beginPath(); villeFq(.12, len - .12, 3, 31, .01); g.fillStyle = sh('#1c2635', shd * .6); g.fill();
    const nb = Math.max(1, Math.floor((len - .4) / 2)), bw = (len - .4) / nb, dr = nb >> 1;
    for(let k = 0; k < nb; k++){
      const u0 = .2 + k * bw + .14, u1 = .2 + (k + 1) * bw - .14;
      g.beginPath();
      if(k === dr){ villeFq(u0 + .1, u1 - .1, 3, 27, .03); g.fillStyle = sh('#10171f', shd * .6); g.fill(); }
      else { villeFq(u0, u1, 6, 28, .02); g.fillStyle = sh('#34495f', shd * .6); g.fill(); if(rec) villeRec(u0, u1, 6, 28, .02, -1, 0, 0, 0, 3); }
    }
    // striped awning
    const ns = Math.max(2, Math.floor((len - .2) / .55)), sw = (len - .2) / ns;
    for(let i = 0; i < ns; i++){
      const u0 = .1 + i * sw, u1 = u0 + sw;
      g.beginPath(); villeSlope(u0, u1, 0, 34, .85, 27); g.fillStyle = sh(i & 1 ? b.aw2 : b.aw, shd + .12); g.fill();
      g.beginPath(); villeFq(u0, u1, 22, 27, .85); g.fillStyle = sh(i & 1 ? b.aw2 : b.aw, shd - .05); g.fill();
    }
    // shop sign
    g.beginPath(); villeFq(.25, len - .25, 37, 49, .02); g.fillStyle = sh(b.sign, shd * .5); g.fill();
    if(rec) villeRec(.25, len - .25, 37, 49, .02, -1, 0, 0, 0, 4);
    if(len > 2.6){
      let size = 8.5; g.font = '700 ' + size + 'px ' + FONT;
      let wt = g.measureText(b.name).width / 32;
      if(wt > len - .7){ size = Math.max(5.5, size * (len - .7) / wt); g.font = '700 ' + size + 'px ' + FONT; wt = g.measureText(b.name).width / 32; }
      textOn(b.name, villeFax, villeFay, villeFtx, villeFty, len, Math.max(.1, (len - wt) / 2), 40, size, '#f4efe4', 700);
    }
  } else if(doorF){
    const u0 = len / 2 - .5;
    g.beginPath(); villeFq(u0, u0 + 1, 0, 30, .02); g.fillStyle = sh('#2a2f3a', shd * .6); g.fill();
    g.beginPath(); villeFq(u0 + .12, u0 + .88, 3, 26, .03); g.fillStyle = sh('#3b4d63', shd * .6); g.fill();
    if(rec) villeRec(u0 + .12, u0 + .88, 31, 36, .03, -1, 0, 0, 0, 3);
    g.beginPath(); villeFq(u0 - .1, u0 + 1.1, 30, 37, .04); g.fillStyle = sh('#4a5468', shd); g.fill();
  }
}

function villeGable(b, top, lod){
  const x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1, w = x1 - x0, d = y1 - y0, rh = Math.min(Math.min(w, d) * .5, 20);
  const alongX = w >= d, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, ov = .32;
  g.fillStyle = sh(b.col, NS.px - .02);
  // gables
  g.beginPath();
  if(alongX){
    if(FV.px){ g.moveTo(villeSx(x1, y0), villeSy(x1, y0, top)); g.lineTo(villeSx(x1, y1), villeSy(x1, y1, top)); g.lineTo(villeSx(x1, ym), villeSy(x1, ym, top + rh)); g.closePath(); }
    if(FV.mx){ g.moveTo(villeSx(x0, y0), villeSy(x0, y0, top)); g.lineTo(villeSx(x0, y1), villeSy(x0, y1, top)); g.lineTo(villeSx(x0, ym), villeSy(x0, ym, top + rh)); g.closePath(); }
  } else {
    if(FV.py){ g.moveTo(villeSx(x0, y1), villeSy(x0, y1, top)); g.lineTo(villeSx(x1, y1), villeSy(x1, y1, top)); g.lineTo(villeSx(xm, y1), villeSy(xm, y1, top + rh)); g.closePath(); }
    if(FV.my){ g.moveTo(villeSx(x0, y0), villeSy(x0, y0, top)); g.lineTo(villeSx(x1, y0), villeSy(x1, y0, top)); g.lineTo(villeSx(xm, y0), villeSy(xm, y0, top + rh)); g.closePath(); }
  }
  g.fill();
  // slopes, farthest first
  const slope = (xa, ya, xb, yb, xc, yc, xd, yd, col) => {
    g.beginPath(); g.moveTo(villeSx(xa, ya), villeSy(xa, ya, top - 1)); g.lineTo(villeSx(xb, yb), villeSy(xb, yb, top - 1)); g.lineTo(villeSx(xc, yc), villeSy(xc, yc, top + rh)); g.lineTo(villeSx(xd, yd), villeSy(xd, yd, top + rh)); g.closePath();
    g.fillStyle = col; g.fill();
  };
  if(alongX){
    const dN = villeDep(xm, ym - d / 4), dS = villeDep(xm, ym + d / 4);
    const sN = () => slope(x0 - ov, y0 - ov, x1 + ov, y0 - ov, x1 + ov, ym, x0 - ov, ym, sh(b.col2, NS.my + .02));
    const sS = () => slope(x0 - ov, y1 + ov, x1 + ov, y1 + ov, x1 + ov, ym, x0 - ov, ym, sh(b.col2, NS.py + .08));
    if(dN < dS){ sN(); sS(); } else { sS(); sN(); }
  } else {
    const dW = villeDep(xm - w / 4, ym), dE = villeDep(xm + w / 4, ym);
    const sW = () => slope(x0 - ov, y0 - ov, x0 - ov, y1 + ov, xm, y1 + ov, xm, y0 - ov, sh(b.col2, NS.mx + .02));
    const sE = () => slope(x1 + ov, y0 - ov, x1 + ov, y1 + ov, xm, y1 + ov, xm, y0 - ov, sh(b.col2, NS.px + .08));
    if(dW < dE){ sW(); sE(); } else { sE(); sW(); }
  }
  // dormer and chimney
  if(b.steam){ box(x1 - 1.1, y0 + .5, .7, .7, top + rh * .35, 16, '#6b625a'); }
}

function villeRoof(b, lod){
  const top = b.z0 + b.h, x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1;
  if(b.roof === 2){ villeGable(b, top, lod); return; }
  g.beginPath(); villeTopPath(x0 + .3, y0 + .3, x1 - .3, y1 - .3, top);
  g.fillStyle = b.roof === 1 ? '#7d786c' : sh(b.col2, .04); g.fill();
  if(lod === 2) return;
  g.strokeStyle = sh(b.col, .24); g.lineWidth = 2.4; g.lineJoin = 'round'; g.stroke();
  const w = x1 - x0 - .9, d = y1 - y0 - .9;
  if(b.roof === 1){
    // roof terrace: planters and parasols
    for(let k = 0; k < 3; k++){
      const hv = villeHash(b.id, k, 5, 1), px = x0 + .6 + hv * Math.max(0, w - 1.2), py = y0 + .6 + villeHash(b.id, k, 6, 2) * Math.max(0, d - 1.2);
      if(k === 0){ box(x0 + .5, y0 + .5, Math.max(.5, w * .6), .5, top, 6, '#2f6a45'); }
      else {
        const sx = villeSx(px, py), sy = villeSy(px, py, top);
        g.strokeStyle = '#d8d2c2'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 17); g.stroke();
        ell(sx, sy - 17, 8.5, 4.2, k === 1 ? '#c0564a' : '#e8c25a');
        ell(sx, sy - 1, 4, 2, 'rgba(0,0,0,.2)');
      }
    }
  } else if(b.type !== 3 || b.ax === 0){
    const n = 1 + ((villeHash(b.id, 9, 9, 9) * 3) | 0);
    for(let k = 0; k < n; k++){
      const px = x0 + .6 + villeHash(b.id, k, 1, 4) * Math.max(0, w - 1.4), py = y0 + .6 + villeHash(b.id, k, 2, 5) * Math.max(0, d - 1.1);
      box(px, py, .9, .6, top, 6 + ((villeHash(b.id, k, 3, 6) * 4) | 0), '#8f98a8');
    }
  }
  if(b.steam) box(x1 - 1.3, y0 + .6, .7, .7, top, 16, '#6b625a');
  if(b.ax === 1 && lod < 2){
    // tower crown: antenna
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sx = villeSx(cx, cy), sy = villeSy(cx, cy, top);
    box(cx - .7, cy - .7, 1.4, 1.4, top, 8, '#59647a');
    g.strokeStyle = '#8f98a8'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(sx, sy - 8); g.lineTo(sx, sy - 40); g.stroke();
    g.fillStyle = '#ff5a4a'; g.fillRect(sx - 1.4, sy - 42, 2.8, 2.8);
  }
}

function villeDrawBuilding(b, lod){
  box(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, b.z0, b.h, b.col);
  if(lod < 2){
    if(FV.py) villeFace(b, 0, lod);
    if(FV.my) villeFace(b, 1, lod);
    if(FV.px) villeFace(b, 2, lod);
    if(FV.mx) villeFace(b, 3, lod);
  }
  villeRoof(b, lod);
}

const VILLE_TREEC = [['#2f6a4a', '#3c8059', '#2b5f43'], ['#3a6f3a', '#4d8a45', '#2f5c33'], ['#2c5a45', '#36704f', '#244c3a'], ['#5a7a3a', '#74903f', '#4a6a32']];
function villeDrawTree(t, lod){
  const s = t.s, sx = villeSx(t.cx, t.cy), sy = villeSy(t.cx, t.cy, 0);
  const pal = VILLE_TREEC[t.v === 2 ? 2 : ((((t.cx * 7 + t.cy * 13) | 0) & 7) === 0 ? 3 : t.v)];
  ell(sx, sy + 1, 11 * s, 4.6 * s, 'rgba(0,0,0,.26)');
  g.strokeStyle = '#5b4030'; g.lineWidth = 3.2 * s; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 24 * s); g.stroke();
  if(t.v === 2){
    g.fillStyle = pal[0]; g.beginPath(); g.moveTo(sx - 12 * s, sy - 14 * s); g.lineTo(sx + 12 * s, sy - 14 * s); g.lineTo(sx, sy - 44 * s); g.closePath(); g.fill();
    g.fillStyle = pal[1]; g.beginPath(); g.moveTo(sx - 9.5 * s, sy - 30 * s); g.lineTo(sx + 9.5 * s, sy - 30 * s); g.lineTo(sx, sy - 58 * s); g.closePath(); g.fill();
    g.fillStyle = pal[2]; g.beginPath(); g.moveTo(sx - 6.5 * s, sy - 46 * s); g.lineTo(sx + 6.5 * s, sy - 46 * s); g.lineTo(sx, sy - 70 * s); g.closePath(); g.fill();
  } else if(t.v === 1){
    ell(sx, sy - 42 * s, 10 * s, 20 * s, pal[0]); ell(sx - 3 * s, sy - 47 * s, 6 * s, 13 * s, pal[1]); ell(sx + 4 * s, sy - 36 * s, 5 * s, 9 * s, pal[2]);
  } else {
    ell(sx, sy - 38 * s, 15 * s, 14 * s, pal[0]); ell(sx - 6 * s, sy - 42 * s, 10 * s, 9.5 * s, pal[1]); ell(sx + 7 * s, sy - 33 * s, 9 * s, 8 * s, pal[2]);
  }
}
function villeDrawLamp(l){
  const sx = villeSx(l.cx, l.cy), sy = villeSy(l.cx, l.cy, 0), hx = l.cx + l.kx * .85, hy = l.cy + l.ky * .85, hsx = villeSx(hx, hy), hsy = villeSy(hx, hy, 74);
  ell(sx, sy + 1, 5, 2.4, 'rgba(0,0,0,.25)');
  g.strokeStyle = '#6a7488'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 72); g.lineTo(hsx, hsy); g.stroke();
  g.fillStyle = '#aeb8c8'; g.fillRect(hsx - 4.5, hsy - 1, 9, 4);
}
function villeDrawBench(b){
  const x0 = b.x0, y0 = b.y0, w = b.x1 - b.x0, d = b.y1 - b.y0;
  if(b.ax){ box(x0 + .1, y0 + .1, .1, .12, 0, 5, '#3b4252'); box(x0 + .1, y1b(b) - .22, .1, .12, 0, 5, '#3b4252'); box(x0, y0, w, d, 5, 2.5, '#8a6a46'); box(x0, y0, .12, d, 7.5, 7, '#7a5a3c'); }
  else { box(x0 + .1, y0 + .1, .12, .1, 0, 5, '#3b4252'); box(x1b(b) - .22, y0 + .1, .12, .1, 0, 5, '#3b4252'); box(x0, y0, w, d, 5, 2.5, '#8a6a46'); box(x0, y0, w, .12, 7.5, 7, '#7a5a3c'); }
}
const y1b = (b) => b.y1, x1b = (b) => b.x1;
function villeDrawShelter(s){
  const x0 = s.x0, y0 = s.y0, x1 = s.x1, y1 = s.y1, ax = s.ax;
  // slab, back glass, bench, roof, posts, panel
  box(x0 - .1, y0 - .1, x1 - x0 + .2, y1 - y0 + .2, 0, 1.5, '#4a556a');
  g.beginPath();
  if(ax === 0){ const yb = s.ky > 0 ? y0 + .08 : y1 - .08; g.moveTo(villeSx(x0, yb), villeSy(x0, yb, 2)); g.lineTo(villeSx(x1, yb), villeSy(x1, yb, 2)); g.lineTo(villeSx(x1, yb), villeSy(x1, yb, 32)); g.lineTo(villeSx(x0, yb), villeSy(x0, yb, 32)); }
  else { const xb = s.kx > 0 ? x0 + .08 : x1 - .08; g.moveTo(villeSx(xb, y0), villeSy(xb, y0, 2)); g.lineTo(villeSx(xb, y1), villeSy(xb, y1, 2)); g.lineTo(villeSx(xb, y1), villeSy(xb, y1, 32)); g.lineTo(villeSx(xb, y0), villeSy(xb, y0, 32)); }
  g.closePath(); g.fillStyle = 'rgba(160,200,225,.34)'; g.fill(); g.strokeStyle = '#8794AD'; g.lineWidth = 1; g.stroke();
  if(ax === 0) box(x0 + .35, s.ky > 0 ? y0 + .25 : y1 - .65, x1 - x0 - .7, .4, 1.5, 8, '#6d7a8c');
  else box(s.kx > 0 ? x0 + .25 : x1 - .65, y0 + .35, .4, y1 - y0 - .7, 1.5, 8, '#6d7a8c');
  for(const [px, py] of [[x0, y0], [x1 - .12, y0], [x0, y1 - .12], [x1 - .12, y1 - .12]]) box(px, py, .12, .12, 1.5, 31, '#5a667c');
  box(x0 - .12, y0 - .12, x1 - x0 + .24, y1 - y0 + .24, 32, 3.5, '#3d4658');
  // stop pole
  const px = ax === 0 ? x1 + .35 : (s.kx > 0 ? x1 + .1 : x0 - .1), py = ax === 0 ? (s.ky > 0 ? y1 - .15 : y0 + .15) : y1 + .35;
  const sx = villeSx(px, py), sy = villeSy(px, py, 0);
  g.strokeStyle = '#6a7488'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 66); g.stroke();
  g.fillStyle = '#2f6fa8'; g.fillRect(sx - 5, sy - 78, 10, 12); g.fillStyle = '#f4efe4'; g.fillRect(sx - 3, sy - 75, 6, 3); g.fillRect(sx - 3, sy - 70, 6, 3);
}
// is the front (or rear) end of the vehicle turned towards the camera?
function villeEndVisible(ax, sgn, front){
  const s = front ? sgn : -sgn;
  return ax ? (s > 0 ? FV.px : FV.mx) : (s > 0 ? FV.py : FV.my);
}
function villeCarShape(x, y, ax, sgn, col, lampOn){
  const L = 2.5, Wd = 1.2, w = ax ? L : Wd, d = ax ? Wd : L, cl = L * .5, cw = Wd * .84;
  box(x - w / 2, y - d / 2, w, d, 3, 10, col);
  const bx = ax ? x - cl / 2 - sgn * .1 : x - cw / 2, by = ax ? y - cw / 2 : y - cl / 2 - sgn * .1, bw = ax ? cl : cw, bd = ax ? cw : cl;
  box(bx, by, bw, bd, 13, 8, '#2a3649');
  box(bx + .03, by + .03, bw - .06, bd - .06, 21, 2.6, col);
  const fx = x + (ax ? sgn * L / 2 : 0), fy = y + (ax ? 0 : sgn * L / 2), rx = x - (ax ? sgn * L / 2 : 0), ry = y - (ax ? 0 : sgn * L / 2);
  const hx = ax ? 0 : .38, hy = ax ? .38 : 0;
  if(villeEndVisible(ax, sgn, true)){
    g.fillStyle = lampOn ? '#fff2c0' : '#cfd4de';
    g.fillRect(villeSx(fx + hx, fy + hy) - 1.5, villeSy(fx + hx, fy + hy, 8) - 1.5, 3, 3); g.fillRect(villeSx(fx - hx, fy - hy) - 1.5, villeSy(fx - hx, fy - hy, 8) - 1.5, 3, 3);
  }
  if(villeEndVisible(ax, sgn, false)){
    g.fillStyle = '#b8352c';
    g.fillRect(villeSx(rx + hx, ry + hy) - 1.4, villeSy(rx + hx, ry + hy, 8) - 1.4, 2.8, 2.8); g.fillRect(villeSx(rx - hx, ry - hy) - 1.4, villeSy(rx - hx, ry - hy, 8) - 1.4, 2.8, 2.8);
  }
}
function villeDrawFountain(o){
  const cx = o.cx, cy = o.cy, R = 2.5;
  const ring = (r, z, n, out) => { for(let i = 0; i < n; i++){ const a = i / n * 6.2832, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; out.push([villeSx(x, y), villeSy(x, y, z)]); } };
  let pts = []; ring(R, 0, 26, pts); ring(R, 11, 26, pts);
  const hp = hull(pts); g.beginPath(); g.moveTo(hp[0][0], hp[0][1]); for(let i = 1; i < hp.length; i++) g.lineTo(hp[i][0], hp[i][1]); g.closePath(); g.fillStyle = '#7d8799'; g.fill();
  const ell2 = (r, z, col) => { g.beginPath(); for(let i = 0; i < 28; i++){ const a = i / 28 * 6.2832, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if(i) g.lineTo(villeSx(x, y), villeSy(x, y, z)); else g.moveTo(villeSx(x, y), villeSy(x, y, z)); } g.closePath(); g.fillStyle = col; g.fill(); };
  ell2(R, 11, '#b9c1cf'); ell2(R - .32, 11, '#8fa1b3'); ell2(R - .4, 8.5, '#4f86a8');
  pts = []; ring(.5, 8, 14, pts); ring(.5, 26, 14, pts);
  const h2 = hull(pts); g.beginPath(); g.moveTo(h2[0][0], h2[0][1]); for(let i = 1; i < h2.length; i++) g.lineTo(h2[i][0], h2[i][1]); g.closePath(); g.fillStyle = '#9aa3b3'; g.fill();
  ell2(1.15, 26, '#b9c1cf'); ell2(.95, 25, '#5a93b5');
}
function villeDrawStatic(o, lod){
  switch(o.t){
    case 0: villeDrawBuilding(o, lod); break;
    case 1: villeDrawTree(o, lod); break;
    case 2: villeDrawLamp(o); break;
    case 3: villeDrawShelter(o); break;
    case 4: villeDrawBench(o); break;
    case 5: villeCarShape(o.cx, o.cy, o.ax, o.kx, o.col, false); break;
    case 6: villeDrawFountain(o); break;
    default: box(o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0, 0, o.h, o.col);
  }
}

/* ------------------------------------------------------------------ baking: angles, tiles, glow */
const VILLE_ND = [];
const VILLE_LITC = ['#ffd68a', '#ffb36b', '#a9d8ff', '#ffeec2', 'rgba(255,214,150,.34)', '#ff8fc8'];
let villeBx0 = 0, villeBy0 = 0, villeBx1 = 0, villeBy1 = 0;

function villeOpBB(op){
  if(op.t === 2){
    const sx = villeSx(op.x0, op.y0), sy = villeSy(op.x0, op.y0, 0), r = Math.max(op.x1, op.y1) * 46;
    villeBx0 = sx - r; villeBx1 = sx + r; villeBy0 = sy - r; villeBy1 = sy + r; return;
  }
  const pad = op.t === 1 ? op.a + 2 : 0;
  const a = villeSx(op.x0, op.y0), b = villeSx(op.x1, op.y0), c = villeSx(op.x1, op.y1), d = villeSx(op.x0, op.y1);
  const e = villeSy(op.x0, op.y0, 0), f = villeSy(op.x1, op.y0, 0), h = villeSy(op.x1, op.y1, 0), i = villeSy(op.x0, op.y1, 0);
  villeBx0 = Math.min(Math.min(a, b), Math.min(c, d)) - pad; villeBx1 = Math.max(Math.max(a, b), Math.max(c, d)) + pad;
  villeBy0 = Math.min(Math.min(e, f), Math.min(h, i)) - pad; villeBy1 = Math.max(Math.max(e, f), Math.max(h, i)) + pad;
}
function villeDrawOp(op){
  if(op.t === 0){
    g.beginPath(); g.moveTo(villeSx(op.x0, op.y0), villeSy(op.x0, op.y0, 0)); g.lineTo(villeSx(op.x1, op.y0), villeSy(op.x1, op.y0, 0)); g.lineTo(villeSx(op.x1, op.y1), villeSy(op.x1, op.y1, 0)); g.lineTo(villeSx(op.x0, op.y1), villeSy(op.x0, op.y1, 0)); g.closePath();
    g.fillStyle = op.col; g.fill();
  } else if(op.t === 1){
    g.setLineDash(op.b || VILLE_ND); g.lineWidth = op.a; g.strokeStyle = op.col; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(villeSx(op.x0, op.y0), villeSy(op.x0, op.y0, 0)); g.lineTo(villeSx(op.x1, op.y1), villeSy(op.x1, op.y1, 0)); g.stroke();
    if(op.b) g.setLineDash(VILLE_ND);
  } else {
    g.beginPath();
    for(let k = 0; k < 24; k++){ const a = k / 24 * 6.2832, x = op.x0 + Math.cos(a) * op.x1, y = op.y0 + Math.sin(a) * op.y1; if(k) g.lineTo(villeSx(x, y), villeSy(x, y, 0)); else g.moveTo(villeSx(x, y), villeSy(x, y, 0)); }
    g.closePath(); g.fillStyle = op.col; g.fill();
  }
}

function villeAngle(a){
  const S = villeS; let A = S.angs[a]; if(A) return A;
  const st = S.stat, n = st.length;
  A = {n, ord: new Int32Array(n), bb: new Float32Array(n * 4), neg: 0, gx0: 1e9, gy0: 1e9, gx1: -1e9, gy1: -1e9};
  const keys = new Float64Array(n), idx = new Array(n);
  for(let i = 0; i < n; i++){
    const o = st[i]; keys[i] = villeDep(o.cx, o.cy); idx[i] = i;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const pad = o.t === VT.BLD ? 1.1 : .25, mgn = o.t === VT.TREE ? 26 : 14;
    for(let c = 0; c < 8; c++){
      const x = (c & 1) ? o.x1 + pad : o.x0 - pad, y = (c & 2) ? o.y1 + pad : o.y0 - pad, z = (c & 4) ? o.zt : o.z0;
      const sx = villeSx(x, y), sy = villeSy(x, y, z);
      if(sx < x0) x0 = sx; if(sx > x1) x1 = sx; if(sy < y0) y0 = sy; if(sy > y1) y1 = sy;
    }
    A.bb[i * 4] = x0 - mgn; A.bb[i * 4 + 1] = y0 - mgn; A.bb[i * 4 + 2] = x1 + mgn; A.bb[i * 4 + 3] = y1 + mgn;
    if(x0 < A.gx0) A.gx0 = x0; if(x1 > A.gx1) A.gx1 = x1; if(y0 < A.gy0) A.gy0 = y0; if(y1 > A.gy1) A.gy1 = y1;
  }
  for(const [x, y] of [[WX0, WY0], [WX1, WY0], [WX1, WY1], [WX0, WY1]]){
    const sx = villeSx(x, y), sy = villeSy(x, y, 0);
    if(sx < A.gx0) A.gx0 = sx; if(sx > A.gx1) A.gx1 = sx; if(sy < A.gy0) A.gy0 = sy; if(sy > A.gy1) A.gy1 = sy;
  }
  idx.sort((p, q) => keys[p] - keys[q] || p - q);
  for(let i = 0; i < n; i++){ A.ord[i] = idx[i]; if(keys[idx[i]] < 0) A.neg = i + 1; }
  S.angs[a] = A; return A;
}

function villeOverlay(){
  return {c: null, x: null, q: new Float32Array(VILLE_MAXW * 8), sc: new Float32Array(VILLE_MAXW * 4), cl: new Uint8Array(VILLE_MAXW), lit: new Uint8Array(VILLE_MAXW), n: 0, dirty: false, ptr: 0};
}
function villeNewTile(){
  return {key: 0, ang: 0, ti: 0, i: 0, j: 0, s: 1, used: 0, baked: false, c0: null, x0: null, c1: null, x1: null, c2: null, x2: null, has0: false, has1: false, has2: false, lf: villeOverlay(), ln: villeOverlay()};
}
function villeLitAt(L, i, h){
  const j = i * 4, on = L.sc[j];
  if(on < 0) return 1;
  const hh = h < 12 ? h + 24 : h;
  if(hh >= on && hh < L.sc[j + 1]) return 1;
  const on2 = L.sc[j + 2];
  if(on2 > 0 && h >= on2 && h < L.sc[j + 3]) return 1;
  return 0;
}
function villeOvDraw(L){
  if(!L.c){ L.c = document.createElement('canvas'); L.c.width = L.c.height = VILLE_TS / 2; L.x = L.c.getContext('2d'); }
  const x = L.x;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, VILLE_TS / 2, VILLE_TS / 2);
  const q = L.q, cl = L.cl, lit = L.lit, n = L.n;
  for(let c = 0; c < 6; c++){
    let any = false;
    x.beginPath();
    for(let i = 0; i < n; i++){
      if(!lit[i] || cl[i] !== c) continue;
      const j = i * 8; x.moveTo(q[j], q[j + 1]); x.lineTo(q[j + 2], q[j + 3]); x.lineTo(q[j + 4], q[j + 5]); x.lineTo(q[j + 6], q[j + 7]); x.closePath(); any = true;
    }
    if(any){ x.fillStyle = VILLE_LITC[c]; x.fill(); }
  }
  L.dirty = false;
}
function villeLayerCtx(t, n, s, ox, oy){
  if(!t['c' + n]){ const c = document.createElement('canvas'); c.width = c.height = VILLE_TS; t['c' + n] = c; t['x' + n] = c.getContext('2d'); }
  const x = t['x' + n]; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, VILLE_TS, VILLE_TS); x.setTransform(s, 0, 0, s, -ox * s, -oy * s);
  t['has' + n] = true; return x;
}
function villeBake(t){
  const S = villeS, s = t.s, TW = VILLE_TS / s, ox = t.i * TW, oy = t.j * TW;
  const svg = g, szb = ZB, szl = ZL; ZB = 0; ZL = 0;
  S.bs = s; S.bx = ox; S.by = oy; S.rec = true; S.ov = t.lf;
  t.lf.n = 0; t.ln.n = 0; t.has0 = t.has1 = t.has2 = false;
  const A = villeAngle(S.ang), lod = s < .3 ? 2 : s < .5 ? 1 : 0;
  g = villeLayerCtx(t, 0, s, ox, oy);
  const ops = S.gops;
  for(let i = 0; i < ops.length; i++){
    const op = ops[i]; villeOpBB(op);
    if(villeBx1 < ox || villeBx0 > ox + TW || villeBy1 < oy || villeBy0 > oy + TW) continue;
    villeDrawOp(op);
  }
  let cur = 0;
  const bb = A.bb, st = S.stat;
  for(let q = 0; q < A.n; q++){
    const i = A.ord[q], b4 = i * 4;
    if(bb[b4] > ox + TW || bb[b4 + 2] < ox || bb[b4 + 1] > oy + TW || bb[b4 + 3] < oy) continue;
    const layer = q < A.neg ? 1 : 2;
    if(layer !== cur){ cur = layer; if(!t['has' + layer]) g = villeLayerCtx(t, layer, s, ox, oy); else g = t['x' + layer]; S.ov = layer === 1 ? t.lf : t.ln; }
    villeDrawStatic(st[i], lod);
  }
  S.rec = false; S.ov = null;
  const h = LT.h;
  for(let w = 0; w < 2; w++){ const L = w ? t.ln : t.lf; for(let i = 0; i < L.n; i++) L.lit[i] = villeLitAt(L, i, h); L.dirty = L.n > 0; L.ptr = 0; }
  t.baked = true;
  g = svg; ZB = szb; ZL = szl;
}
function villeAcquire(key, ang, ti, i, j){
  const S = villeS, pool = S.pool;
  let t = null;
  if(pool.length < Math.max(44, S.nv + 14)){ t = villeNewTile(); pool.push(t); }
  else {
    for(let k = 0; k < pool.length; k++){ const p = pool[k]; if(p.used < S.frame - 1 && (t === null || p.used < t.used)) t = p; }
    if(t === null){ if(pool.length >= 130) return null; t = villeNewTile(); pool.push(t); }
    else S.tiles.delete(t.key);
  }
  t.key = key; t.ang = ang; t.ti = ti; t.i = i; t.j = j; t.s = VILLE_TIERS[ti]; t.baked = false; t.used = S.frame;
  S.tiles.set(key, t);
  return t;
}
function villeAlt(i, j){
  const S = villeS, TW = VILLE_TS / VILLE_TIERS[S.tier], cx = (i + .5) * TW, cy = (j + .5) * TW;
  for(let d = 1; d < VILLE_TIERS.length; d++) for(let sg = -1; sg <= 1; sg += 2){
    const t2 = S.tier + sg * d; if(t2 < 0 || t2 >= VILLE_TIERS.length) continue;
    const TW2 = VILLE_TS / VILLE_TIERS[t2];
    const t = S.tiles.get((S.ang * 16 + t2) * 67108864 + (Math.floor(cx / TW2) + 4096) * 8192 + (Math.floor(cy / TW2) + 4096));
    if(t !== undefined && t.baked){ t.used = S.frame; return t; }
  }
  return null;
}
function villeTiles(){
  const S = villeS, A = villeAngle(S.ang), ds = S.z;
  let ti = S.tier;
  if(ti < 0 || VILLE_TIERS[ti] < ds * .75 || VILLE_TIERS[ti] > ds * 1.5){ ti = 0; while(ti < VILLE_TIERS.length - 1 && VILLE_TIERS[ti] < ds * .88) ti++; }
  if(ti !== S.tier) S.vs.clear();
  S.tier = ti;
  const TW = VILLE_TS / VILLE_TIERS[ti], base = (S.ang * 16 + ti) * 67108864;
  const i0 = Math.floor(Math.max(S.vx0, A.gx0) / TW), i1 = Math.floor(Math.min(S.vx1, A.gx1) / TW);
  const j0 = Math.floor(Math.max(S.vy0, A.gy0) / TW), j1 = Math.floor(Math.min(S.vy1, A.gy1) / TW);
  for(let j = j0; j <= j1; j++) for(let i = i0; i <= i1; i++){
    const t = S.tiles.get(base + (i + 4096) * 8192 + (j + 4096));
    if(t === undefined || !t.baked){ if(S.nm < 255){ S.mi[S.nm] = i; S.mj[S.nm] = j; S.nm++; } }
    else { t.used = S.frame; if(S.nv < 120) S.vis[S.nv++] = t; }
  }
  const cxw = (S.vx0 + S.vx1) / 2, cyw = (S.vy0 + S.vy1) / 2, t0 = performance.now();
  let did = 0;
  while(S.nm > 0){
    let bi = -1, bd = 1e30;
    for(let k = 0; k < S.nm; k++){
      const d = ((S.mi[k] + .5) * TW - cxw) ** 2 + ((S.mj[k] + .5) * TW - cyw) ** 2;
      if(d < bd && (S.zStable >= 3 || villeAlt(S.mi[k], S.mj[k]) === null)){ bd = d; bi = k; }
    }
    if(bi < 0) break;
    const i = S.mi[bi], j = S.mj[bi];
    const t = villeAcquire(base + (i + 4096) * 8192 + (j + 4096), S.ang, ti, i, j);
    if(t === null) break;
    villeBake(t); did++;
    if(S.nv < 120) S.vis[S.nv++] = t;
    S.nm--; S.mi[bi] = S.mi[S.nm]; S.mj[bi] = S.mj[S.nm];
    if(performance.now() - t0 > 5) break;
  }
  // preload a neighbouring tile once everything is ready
  if(S.nm === 0 && S.zStable >= 8 && performance.now() - t0 < 3){
    let done = false;
    for(let j = j0 - 1; j <= j1 + 1 && !done; j++) for(let i = i0 - 1; i <= i1 + 1 && !done; i++){
      if(i * TW > A.gx1 || (i + 1) * TW < A.gx0 || j * TW > A.gy1 || (j + 1) * TW < A.gy0) continue;
      const key = base + (i + 4096) * 8192 + (j + 4096);
      if(S.tiles.has(key)) continue;
      const t = villeAcquire(key, S.ang, ti, i, j);
      if(t){ villeBake(t); done = true; }
    }
  }
}
// flip a few windows per tile and redraw the glow tiles that changed
function villeScan(){
  const S = villeS;
  if(S.K < .02) return;
  const h = LT.h; let budget = 2;
  for(let n = 0; n < S.nv; n++){
    const t = S.vis[n];
    for(let w = 0; w < 2; w++){
      const L = w ? t.ln : t.lf;
      if(L.n > 0){
        let p = L.ptr; const cnt = L.n < 28 ? L.n : 28;
        for(let k = 0; k < cnt; k++){ if(p >= L.n) p = 0; const v = villeLitAt(L, p, h); if(v !== L.lit[p]){ L.lit[p] = v; L.dirty = true; } p++; }
        L.ptr = p;
      }
      if(L.dirty && budget > 0){ villeOvDraw(L); budget--; }
    }
  }
}

/* ------------------------------------------------------------------ decor display: back and front phases */
function villeBlit(t, layer, ox, oy, TW){
  const S = villeS, c = t['c' + layer];
  if(!c || !t['has' + layer]) return;
  const x0 = Math.round(ox * S.z + S.tx), y0 = Math.round(oy * S.z + S.ty), x1 = Math.round((ox + TW) * S.z + S.tx), y1 = Math.round((oy + TW) * S.z + S.ty);
  g.drawImage(c, x0, y0, x1 - x0, y1 - y0);
}
function villeTilesPhase(layer){
  const S = villeS, TW = VILLE_TS / VILLE_TIERS[S.tier];
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  for(let n = 0; n < S.nv; n++){ const t = S.vis[n]; villeBlit(t, layer, t.i * TW, t.j * TW, TW); }
  for(let m = 0; m < S.nm; m++){
    const i = S.mi[m], j = S.mj[m], t = villeAlt(i, j);
    const x0 = Math.round(i * TW * S.z + S.tx), y0 = Math.round(j * TW * S.z + S.ty), x1 = Math.round((i + 1) * TW * S.z + S.tx), y1 = Math.round((j + 1) * TW * S.z + S.ty);
    g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    if(t !== null){ const TW2 = VILLE_TS / t.s; villeBlit(t, layer, t.i * TW2, t.j * TW2, TW2); }
    else if(layer === 0){
      g.setTransform(S.z, 0, 0, S.z, S.tx, S.ty);
      const ox = i * TW, oy = j * TW, ops = S.gops;
      for(let k = 0; k < ops.length; k++){ const op = ops[k]; villeOpBB(op); if(villeBx1 < ox || villeBx0 > ox + TW || villeBy1 < oy || villeBy0 > oy + TW) continue; villeDrawOp(op); }
    }
    g.restore();
  }
  g.restore();
}
function villeLiveGround(){
  const S = villeS, ops = S.gops;
  for(let k = 0; k < ops.length; k++){
    const op = ops[k]; villeOpBB(op);
    if(villeBx1 < S.vx0 || villeBx0 > S.vx1 || villeBy1 < S.vy0 || villeBy0 > S.vy1) continue;
    villeDrawOp(op);
  }
}
function villeLiveStatics(phase){
  const S = villeS, st = S.stat, n = st.length, z = cam.z;
  let c = 0;
  for(let i = 0; i < n; i++){
    const o = st[i], sx = villeSx(o.cx, o.cy) * z + S.cx, sy = villeSy(o.cx, o.cy, 0) * z + S.cy;
    const mgh = (o.big * 34 + 80) * z;
    if(sx < -mgh || sx > cw + mgh || sy - (o.zt + 40) * z > ch || sy + (o.big * 17 + 40) * z < 0) continue;
    const k = villeDep(o.cx, o.cy);
    if((k < 0) !== (phase === 0)) continue;
    if(c < 2048){ S.ls[c] = i; S.lk[c] = k; c++; }
  }
  for(let a = 1; a < c; a++){
    const ia = S.ls[a], ka = S.lk[a]; let b = a - 1;
    while(b >= 0 && (S.lk[b] > ka || (S.lk[b] === ka && S.ls[b] > ia))){ S.lk[b + 1] = S.lk[b]; S.ls[b + 1] = S.ls[b]; b--; }
    S.lk[b + 1] = ka; S.ls[b + 1] = ia;
  }
  for(let q = 0; q < c; q++) villeDrawStatic(st[S.ls[q]], 2);
}
// is the point (x, y, z) hidden by a building, seen from the camera? (ray towards the camera: +32 px of height per step)
function villeOccluded(x, y, z){
  const ux = RC + RS, uy = RC - RS, st = villeS.stat;
  for(let i = 0; i < st.length; i++){
    const b = st[i]; if(b.t !== VT.BLD) continue;
    const top = b.z0 + b.h; if(top <= z) continue;
    let t0 = 0, t1 = (top - z) / 32;
    const zb = (b.z0 - z) / 32; if(zb > t0) t0 = zb;
    let a = (b.x0 - x) / ux, c = (b.x1 - x) / ux; if(a > c){ const t = a; a = c; c = t; }
    if(a > t0) t0 = a; if(c < t1) t1 = c;
    if(t1 - t0 <= .05) continue;
    a = (b.y0 - y) / uy; c = (b.y1 - y) / uy; if(a > c){ const t = a; a = c; c = t; }
    if(a > t0) t0 = a; if(c < t1) t1 = c;
    if(t1 - t0 > .05) return true;
  }
  return false;
}
// light pools on the ground, before the night tint: additive and boosted to survive the tint
function villePools(){
  const S = villeS; if(S.K < .02) return;
  const L = S.lights, z = cam.z;
  g.save(); g.globalCompositeOperation = 'lighter';
  g.globalAlpha = clamp(S.K * (LT.wa > .02 ? .4 / Math.max(.25, 1 - LT.wa) : .5), 0, 1);
  for(let i = 0; i < L.length; i++){
    const l = L[i], sx = villeSx(l.x, l.y), sy = villeSy(l.x, l.y, 0), r = l.pr * z, X = sx * z + S.cx, Y = sy * z + S.cy;
    if(X < -r || X > cw + r || Y < -r || Y > ch + r) continue;
    g.drawImage(S.spr.pool, sx - l.pr, sy - l.pr * .5, l.pr * 2, l.pr);
  }
  g.restore();
}
function villeLampGlows(front){
  const S = villeS, L = S.lights, z = cam.z;
  g.globalAlpha = S.K;
  for(let i = 0; i < L.length; i++){
    const l = L[i]; if(l.gr <= 0) continue;
    if((villeDep(l.hx, l.hy) >= 0) !== front) continue;
    const sx = villeSx(l.hx, l.hy), sy = villeSy(l.hx, l.hy, l.hz), r = l.gr * z, X = sx * z + S.cx, Y = sy * z + S.cy;
    if(X < -r || X > cw + r || Y < -r || Y > ch + r) continue;
    if(S.rest){ if(l.hid[S.ang] < 0) l.hid[S.ang] = villeOccluded(l.hx, l.hy, l.hz) ? 1 : 0; if(l.hid[S.ang]) continue; }
    g.drawImage(S.spr.glow, sx - l.gr, sy - l.gr, l.gr * 2, l.gr * 2);
  }
  g.globalAlpha = 1;
}
/* the building's own effect on the ground, for any number of floors: its shadow (length from the sun and from the
   height still visible) and, at night, the light that spills from its windows (strength from the agents present) */
function villeBuildingGround(){
  const S = villeS;
  let top = 0, act = 0, n = 0;
  for(let i = 0; i < floors.length; i++){
    const f = floors[i]; if(f.plot && !f.plot.started) continue;
    const v = f.vis; if(v <= .01) continue;
    const t = f.z0 + BH * smooth(v); if(t > top) top = t;
    act += f.actS * smooth(v); n++;
  }
  if(top < 12) return;
  const a = LT.day * LT.day * .5;
  if(a > .02){
    const k = Math.min(SUN.f * top / 32 * .9, 13), ox = SUN.dx * k, oy = SUN.dy * k;
    for(let q = 2; q >= 0; q--){
      const gr = q * .45, x0 = -.3 - gr, y0 = -.3 - gr, x1 = W + .3 + gr, y1 = D + .25 + gr;
      setPt(0, x0, y0); setPt(1, x1, y0); setPt(2, x1, y1); setPt(3, x0, y1);
      setPt(4, x0 + ox, y0 + oy); setPt(5, x1 + ox, y0 + oy); setPt(6, x1 + ox, y1 + oy); setPt(7, x0 + ox, y1 + oy);
      hullPath(8); g.fillStyle = shadowStyle(a * .5); g.fill();
    }
  }
  if(S.K > .02){
    const al = clamp(S.K * (LT.wa > .02 ? .4 / Math.max(.25, 1 - LT.wa) : .5) * (.25 + .75 * act / n), 0, 1);
    const cx = villeSx(W / 2, D / 2), cy = villeSy(W / 2, D / 2, 0);
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = al;
    g.drawImage(S.spr.pool, cx - 780, cy - 390, 1560, 780);
    g.restore();
  }
}
function villeBack(){
  const S = villeS; ZB = 0; ZL = 0;
  if(S.rest) villeTilesPhase(0); else villeLiveGround();
  villeCloudShadows();
  villeBuildingGround();
  villePools();
  villeDynPhase(0);
  if(S.rest) villeTilesPhase(1); else villeLiveStatics(0);
  villeBirds(false);
}
function villeFront(){
  const S = villeS; ZB = 0; ZL = 0;
  villeDynPhase(1);
  if(S.rest) villeTilesPhase(2); else villeLiveStatics(1);
  villeBirds(true);
}
function villeLights(front){
  const S = villeS, L = LT.lamp;
  if(L < .1) return;
  ZB = 0; ZL = 0;
  if(S.rest){
    const TW = VILLE_TS / VILLE_TIERS[S.tier];
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = S.K;
    for(let n = 0; n < S.nv; n++){
      const t = S.vis[n], ov = front ? t.ln : t.lf;
      if(ov.c === null || ov.n === 0) continue;
      const x0 = Math.round(t.i * TW * S.z + S.tx), y0 = Math.round(t.j * TW * S.z + S.ty), x1 = Math.round((t.i + 1) * TW * S.z + S.tx), y1 = Math.round((t.j + 1) * TW * S.z + S.ty);
      g.drawImage(ov.c, x0, y0, x1 - x0, y1 - y0);
    }
    g.restore();
  }
  villeDynLights(front, L);
}

/* ------------------------------------------------------------------ living elements: creation */
const VILLE_BUSC = ['#3f9a76', '#2f6fa8', '#d9a43a'];
function villeDyn(kind, x, y){
  return {kind, x, y, axis: 'x', lane: y, p: x, v: 0, c: '#ffffff', hide: 0, sp: 0, dir: 1, vmax: 3, len: 2.5, ln: null, dwell: 0, served: -1,
    ox: 0, oy: 0, ph: 0, moving: 0, sk: '#F1C7A0', hr: '#2b2118', sh: '#d9dee8', pn: '#2f3a50', na: 0, nb: 0, s: 0, elen: 1, edx: 1, edy: 0, slot: 0, wait: 0, pause: 0, off: 0, ecr: 0, eci: 0,
    grp: 0, idx: 0, a0: 0, a1: 0, a2: 0, a3: 0, r0: 0, hd: null, ci: 0};
}
function villeLook(o, r){
  o.sk = VILLE_SKIN[(r() * VILLE_SKIN.length) | 0]; o.hr = VILLE_HAIR[(r() * VILLE_HAIR.length) | 0]; o.sh = VILLE_SHIRT[(r() * VILLE_SHIRT.length) | 0]; o.pn = VILLE_PANTS[(r() * VILLE_PANTS.length) | 0];
}
function villePlaceVeh(v){
  if(v.axis === 'x'){ v.x = v.p; v.y = v.lane; } else { v.x = v.lane; v.y = v.p; }
  v.v = v.dir * v.sp;
}
function villePedPlace(o, na, slot, s){
  const S = villeS, nb = S.nn[na * 4 + slot];
  o.na = na; o.nb = nb; o.slot = slot; o.s = s;
  const dx = S.nx[nb] - S.nx[na], dy = S.ny[nb] - S.ny[na], L = Math.hypot(dx, dy);
  o.elen = L; o.edx = dx / L; o.edy = dy / L; o.ecr = S.ncr[na * 4 + slot]; o.eci = na >> 2;
  o.x = S.nx[na] + o.edx * s; o.y = S.ny[na] + o.edy * s;
  o.axis = o.edx !== 0 ? 'x' : 'y';
  if(o.axis === 'x'){ o.lane = o.y; o.p = o.x; } else { o.lane = o.x; o.p = o.y; }
}
const villeW4 = new Float32Array(4);
function villePedNext(o){
  const S = villeS, na = o.nb, prev = o.slot ^ 1, w = villeW4;
  let tot = 0, best = -1;
  for(let k = 0; k < 4; k++){
    const nb2 = S.nn[na * 4 + k];
    if(nb2 < 0 || k === prev){ w[k] = 0; continue; }
    const inter = nb2 >> 2, ii = inter >> 2, jj = inter & 3, loc = (ii === 1 || ii === 2) && (jj === 1 || jj === 2) ? 1 : .35;
    w[k] = (k === o.slot ? 3 : 1.4) * loc; tot += w[k];
  }
  if(tot <= 0) best = S.nn[na * 4 + prev] >= 0 ? prev : o.slot;
  else { let r = villeRnd() * tot; for(let k = 0; k < 4; k++){ if(w[k] > 0){ best = k; r -= w[k]; if(r <= 0) break; } } }
  villePedPlace(o, na, best, 0);
}

function villeInitDyn(r){
  const S = villeS;
  S.lanes.length = 0; S.dynAll.length = 0; S.birds.length = 0; S.clouds.length = 0; city.cars.length = 0; S.t = 3;
  for(let i = 0; i < 16; i++) S.off[i] = (i * 7.3 + ((i * 13) % 5) * 1.7) % VILLE_CYC;
  const add = (o) => { S.dynAll.push(o); city.cars.push(o); return o; };
  // lanes: two ways per street, plus a bike lane on the near streets
  for(let ax = 0; ax < 2; ax++) for(let ci = 0; ci < 4; ci++) for(let dd = 0; dd < 2; dd++) for(let bike = 0; bike < 2; bike++){
    const dir = dd ? -1 : 1, ring = ci === 1 || ci === 2;
    if(bike && !ring) continue;
    const c = ax === 0 ? villeHY[ci] : villeVX[ci], off = (bike ? 2.05 : 1.3) * (ax === 0 ? dir : -dir);
    const lo = (ax === 0 ? WX0 : WY0) + 6, hi = (ax === 0 ? WX1 : WY1) - 6;
    const L = {ax, ci, dir, bike, c: c + off, lo, hi, span: hi - lo, veh: [], sp: new Float64Array(4), si: new Int32Array(4), sg: ax, bs: []};
    for(let m = 0; m < 4; m++){ const cross = ax === 0 ? villeVX[m] : villeHY[m]; L.sp[m] = cross - dir * VILLE_STOP; L.si[m] = ax === 0 ? m * 4 + ci : ci * 4 + m; }
    S.lanes.push(L);
    const n = bike ? 1 : ring ? 5 : 1;
    for(let k = 0; k < n; k++){
      const v = villeDyn(bike ? VK.BIKE : VK.CAR, 0, 0);
      v.ln = L; v.dir = dir; v.axis = ax === 0 ? 'x' : 'y'; v.lane = L.c;
      v.p = dir > 0 ? L.lo + (k + .25 + r() * .5) * L.span / n : L.hi - (k + .25 + r() * .5) * L.span / n;
      v.vmax = bike ? 1.5 + r() * .4 : 2.7 + r() * .7; v.len = bike ? 1.3 : 2.5; v.sp = v.vmax * .6;
      v.ci = bike ? 0 : (r() * VILLE_CARS.length) | 0; v.c = bike ? VILLE_SHIRT[(r() * VILLE_SHIRT.length) | 0] : VILLE_CARS[v.ci];
      villeLook(v, r); villePlaceVeh(v); L.veh.push(v); add(v);
    }
  }
  // buses: three lines with a stop, two passing through
  const busSpec = [[0, 2, -1, 12.3, '#3f9a76'], [0, 2, 1, 4.5, '#2f6fa8'], [1, 2, -1, 9.4, '#d9a43a'], [0, 1, 1, -1, '#3f9a76'], [1, 1, 1, -1, '#2f6fa8']];
  for(const [ax, ci, dir, stop, col] of busSpec){
    const L = S.lanes.find((l) => l.ax === ax && l.ci === ci && l.dir === dir && !l.bike), v = L.veh[2];
    v.kind = VK.BUS; v.len = 5.2; v.vmax = 2.1; v.c = col; v.ci = VILLE_BUSC.indexOf(col); v.sp = 1;
    if(stop >= 0) L.bs.push(stop);
  }
  // crosswalks: graph of sidewalk corners
  for(let i = 0; i < 4; i++) for(let j = 0; j < 4; j++) for(let b = 0; b < 4; b++){
    const id = (i * 4 + j) * 4 + b, bx = b & 1, by = (b >> 1) & 1;
    S.nx[id] = villeVX[i] + (bx ? VILLE_PL : -VILLE_PL); S.ny[id] = villeHY[j] + (by ? VILLE_PL : -VILLE_PL);
    S.nn[id * 4] = bx ? (i < 3 ? ((i + 1) * 4 + j) * 4 + (b & 2) : -1) : (i * 4 + j) * 4 + (b | 1); S.ncr[id * 4] = bx ? 0 : 1;
    S.nn[id * 4 + 1] = bx ? (i * 4 + j) * 4 + (b & 2) : (i > 0 ? ((i - 1) * 4 + j) * 4 + (b | 1) : -1); S.ncr[id * 4 + 1] = bx ? 1 : 0;
    S.nn[id * 4 + 2] = by ? (j < 3 ? (i * 4 + j + 1) * 4 + (b & 1) : -1) : (i * 4 + j) * 4 + (b | 2); S.ncr[id * 4 + 2] = by ? 0 : 1;
    S.nn[id * 4 + 3] = by ? (i * 4 + j) * 4 + (b & 1) : (j > 0 ? (i * 4 + j - 1) * 4 + (b | 2) : -1); S.ncr[id * 4 + 3] = by ? 1 : 0;
  }
  for(let k = 0; k < 44; k++){
    const o = villeDyn(VK.PED, 0, 0);
    villeLook(o, r); o.sp = .85 + r() * .4; o.off = (r() - .5) * .7; o.ph = r() * 6;
    let na = 0, slot = 0, tries = 0;
    do {
      const ii = r() < .75 ? 1 + ((r() * 2) | 0) : (r() * 4) | 0, jj = r() < .75 ? 1 + ((r() * 2) | 0) : (r() * 4) | 0;
      na = (ii * 4 + jj) * 4 + ((r() * 4) | 0); slot = (r() * 4) | 0; tries++;
    } while(S.nn[na * 4 + slot] < 0 && tries < 80);
    villePedPlace(o, na, slot, 0); o.s = r() * o.elen * .9; villePedPlace(o, na, slot, o.s);
    o.ox = -o.edy * o.off; o.oy = o.edx * o.off;
    add(o);
  }
  // park walkers
  for(let k = 0; k < 4; k++){
    const o = villeDyn(VK.LOOP, 0, 0); villeLook(o, r);
    o.a0 = 7.5; o.a1 = 34.5; o.r0 = 4.2 + (k & 1) * .6; o.a2 = k * 1.6; o.a3 = (k & 1 ? -1 : 1) * (.17 + r() * .05); o.moving = 1; o.ph = r() * 6;
    o.x = o.a0 + Math.cos(o.a2) * o.r0; o.y = o.a1 + Math.sin(o.a2) * o.r0; add(o);
  }
  // passengers at the stops
  const homes = [[11.9, 21.15, 0, 2, -1], [12.9, 21.15, 0, 2, -1], [4.0, 27.95, 0, 2, 1], [5.1, 27.95, 0, 2, 1], [24.65, 8.9, 1, 2, -1], [24.65, 9.9, 1, 2, -1]];
  const lanes2 = [S.lanes.find((l) => l.ax === 0 && l.ci === 2 && l.dir === -1 && !l.bike), S.lanes.find((l) => l.ax === 0 && l.ci === 2 && l.dir === 1 && !l.bike), S.lanes.find((l) => l.ax === 1 && l.ci === 2 && l.dir === -1 && !l.bike)];
  homes.forEach((h, k) => {
    const o = villeDyn(VK.WAIT, h[0], h[1]); villeLook(o, r); o.a0 = h[0]; o.a1 = h[1]; o.ln = lanes2[k >> 1]; o.pause = 0; o.ph = r() * 6; add(o);
  });
  for(const st of S.stat) if(st.t === VT.BLD && st.steam){ const o = villeDyn(VK.STEAM, st.x1 - 1, st.y0 + .9); o.a0 = st.z0 + st.h + 18; o.ph = r() * 6; add(o); }
  add(villeDyn(VK.FOUNT, 7.5, 34.5));
  // traffic lights: four poles per crossing
  for(let i = 0; i < 4; i++) for(let j = 0; j < 4; j++) for(const k of [[-1, 1, 0], [1, -1, 0], [1, 1, 1], [-1, -1, 1]]){
    const o = villeDyn(VK.SIG, villeVX[i] + k[0] * 3, villeHY[j] + k[1] * 3); o.grp = k[2]; o.idx = i * 4 + j; o.hd = new Int8Array(4).fill(-1); add(o);
  }
  // birds: three flocks above the highest roof; cloud shadows
  let zTop = 0; for(const o of S.stat) if(o.zt > zTop) zTop = o.zt;
  for(let k = 0; k < 3; k++){
    const a = r() * 6.28, n = 5 + ((r() * 3) | 0), bo = new Float32Array(n * 3);
    for(let b = 0; b < n; b++){ bo[b * 3] = -b * 1.3 * Math.cos(a) + (r() - .5) * 1.6; bo[b * 3 + 1] = -b * 1.3 * Math.sin(a) + (r() - .5) * 1.6; bo[b * 3 + 2] = (r() - .5) * 18; }
    S.birds.push({x: -30 + r() * 80, y: -30 + r() * 90, z: zTop + 30 + r() * 50, vx: Math.cos(a) * (3.2 + r() * 1.6), vy: Math.sin(a) * (3.2 + r() * 1.6), n, bo, ph: r() * 6});
  }
  for(let k = 0; k < 4; k++) S.clouds.push({x: -30 + k * 24, y: -20 + ((k * 37) % 70), vx: .55 + (k % 3) * .2, vy: .25, s: .8 + r() * .6});
  S.nd = 0; S.dneg = 0;
}
function villeInitSprites(){
  const S = villeS; if(S.spr) return;
  const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; };
  const rad = (x, cx, cy, r, stops) => { const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); for(const [o, c] of stops) gr.addColorStop(o, c); x.fillStyle = gr; };
  S.spr = {
    glow: mk(64, 64, (x) => { rad(x, 32, 32, 32, [[0, 'rgba(255,230,170,.9)'], [.3, 'rgba(255,216,140,.4)'], [1, 'rgba(255,200,120,0)']]); x.fillRect(0, 0, 64, 64); }),
    pool: mk(128, 64, (x) => { x.setTransform(1, 0, 0, .5, 0, 32); rad(x, 64, 0, 64, [[0, 'rgba(255,222,150,.9)'], [.4, 'rgba(255,208,128,.38)'], [1, 'rgba(255,200,120,0)']]); x.fillRect(0, -64, 128, 128); x.setTransform(1, 0, 0, 1, 0, 0); }),
    shadow: mk(256, 128, (x) => { x.setTransform(1, 0, 0, .5, 0, 64); rad(x, 128, 0, 128, [[0, 'rgba(6,10,22,.6)'], [.6, 'rgba(6,10,22,.35)'], [1, 'rgba(6,10,22,0)']]); x.fillRect(0, -128, 256, 256); x.setTransform(1, 0, 0, 1, 0, 0); }),
    cloud: mk(220, 110, (x) => { x.fillStyle = '#fff'; for(const [dx, dy, r] of [[50, 62, 28], [88, 48, 38], [128, 58, 32], [160, 66, 24], [100, 70, 30]]){ x.beginPath(); x.arc(dx, dy, r, 0, 7); x.fill(); } }),
    sun: mk(128, 128, (x) => { rad(x, 64, 64, 64, [[0, 'rgba(255,225,160,.55)'], [.4, 'rgba(255,225,160,.18)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(0, 0, 128, 128); }),
    moon: mk(128, 128, (x) => { rad(x, 64, 64, 64, [[0, 'rgba(170,190,255,.35)'], [.4, 'rgba(170,190,255,.12)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(0, 0, 128, 128); }),
    gR: mk(32, 32, (x) => { rad(x, 16, 16, 16, [[0, 'rgba(255,70,55,.95)'], [1, 'rgba(255,70,55,0)']]); x.fillRect(0, 0, 32, 32); }),
    gY: mk(32, 32, (x) => { rad(x, 16, 16, 16, [[0, 'rgba(255,200,60,.95)'], [1, 'rgba(255,200,60,0)']]); x.fillRect(0, 0, 32, 32); }),
    gG: mk(32, 32, (x) => { rad(x, 16, 16, 16, [[0, 'rgba(80,255,150,.95)'], [1, 'rgba(80,255,150,0)']]); x.fillRect(0, 0, 32, 32); })
  };
  const r = mul32(99); S.stars = Array.from({length: 70}, () => ({x: r(), y: r() * .7, s: .6 + r() * 1.1, p: r() * 6}));
}

/* ------------------------------------------------------------------ living elements: simulation */
function villeSigUpdate(){
  const S = villeS;
  for(let i = 0; i < 16; i++){
    const ph = (S.t + S.off[i]) % VILLE_CYC;
    S.sigH[i] = ph < 8 ? 0 : ph < 9.5 ? 1 : 2;
    S.sigV[i] = ph >= 10.5 && ph < 18.5 ? 0 : ph >= 18.5 && ph < 20 ? 1 : 2;
    S.okX[i] = ph >= .4 && ph < 5.2 ? 1 : 0;
    S.okY[i] = ph >= 10.9 && ph < 15.6 ? 1 : 0;
  }
}
function updateCars(dt){
  if(reduced) return;
  const S = villeS;
  dt = Math.min(dt, 100) / 1000;
  S.t += dt;
  villeSigUpdate();
  const lanes = S.lanes;
  for(let li = 0; li < lanes.length; li++){
    const L = lanes[li], vs = L.veh, n = vs.length, dir = L.dir;
    for(let k = 0; k < n; k++){
      const v = vs[k];
      let lim = v.vmax;
      if(n > 1){
        const ld = vs[k + 1 === n ? 0 : k + 1];
        let d = dir * (ld.p - v.p); if(d < 0) d += L.span;
        const gap = d - (ld.len + v.len) * .5 - .5;
        const gl = gap < .15 ? 0 : Math.sqrt(10 * (gap - .15));
        if(gl < lim) lim = gl;
      }
      const front = v.p + dir * v.len * .5;
      for(let m = 0; m < 4; m++){
        const d = dir * (L.sp[m] - front);
        if(d < -.7 || d > 16) continue;
        const st = L.sg === 0 ? S.sigH[L.si[m]] : S.sigV[L.si[m]];
        if(st === 0) continue;
        if(st === 1 && d < v.sp * v.sp / 10 + .5) continue;
        const gl = Math.sqrt(11 * Math.max(d, 0));
        if(gl < lim) lim = gl;
      }
      if(v.kind === VK.BUS){
        if(v.dwell > 0){ v.dwell -= dt; lim = 0; }
        else for(let b = 0; b < L.bs.length; b++){
          const d = dir * (L.bs[b] - v.p);
          if(v.served !== b && d >= -.2 && d < 5){
            const gl = Math.sqrt(10 * Math.max(d, 0)); if(gl < lim) lim = gl;
            if(d < .4 && v.sp < .25){ v.dwell = 3.2 + villeRnd() * 2; v.served = b; }
          } else if(v.served === b && (d < -8 || d > 40)) v.served = -1;
        }
      }
      if(v.sp > lim) v.sp = Math.max(lim, v.sp - 7 * dt); else v.sp = Math.min(lim, v.sp + 2.4 * dt);
      v.p += dir * v.sp * dt;
      if(dir > 0){ if(v.p > L.hi) v.p -= L.span; } else if(v.p < L.lo) v.p += L.span;
      if(v.axis === 'x'){ v.x = v.p; } else { v.y = v.p; }
      v.v = dir * v.sp;
      if(v.kind === VK.BIKE) v.ph += v.sp * dt * 5;
    }
  }
  const all = S.dynAll;
  for(let i = 0; i < all.length; i++){
    const o = all[i];
    if(o.kind === VK.PED){
      if(o.pause > 0){ o.pause -= dt; o.moving = 0; continue; }
      if(o.s <= 0 && o.ecr && !(o.slot < 2 ? S.okX : S.okY)[o.eci]){ o.moving = 0; continue; }
      const sp = (o.ecr ? 1.5 : 1) * o.sp;
      o.s += sp * dt; o.ph += sp * dt * 6.5; o.moving = 1;
      if(o.s >= o.elen){
        villePedNext(o);
        if(!o.ecr && villeRnd() < .05) o.pause = 1.5 + villeRnd() * 3.5;
      }
      o.x = S.nx[o.na] + o.edx * o.s; o.y = S.ny[o.na] + o.edy * o.s;
      const tx = -o.edy * o.off, ty = o.edx * o.off, kk = Math.min(1, dt * 5);
      o.ox += (tx - o.ox) * kk; o.oy += (ty - o.oy) * kk;
      o.axis = o.edx !== 0 ? 'x' : 'y';
      if(o.axis === 'x'){ o.lane = o.y; o.p = o.x; o.v = o.edx * sp; } else { o.lane = o.x; o.p = o.y; o.v = o.edy * sp; }
    } else if(o.kind === VK.LOOP){
      o.a2 += o.a3 * dt; o.ph += dt * 4.2;
      o.x = o.a0 + Math.cos(o.a2) * o.r0; o.y = o.a1 + Math.sin(o.a2) * o.r0; o.lane = o.y; o.p = o.x;
    } else if(o.kind === VK.WAIT){
      // a bus at its stop: the passenger boards, another one arrives later
      let bus = null; const vs = o.ln.veh;
      for(let k = 0; k < vs.length; k++){ const v = vs[k]; if(v.kind === VK.BUS && v.dwell > 0 && Math.abs(v.p - (o.ln.ax === 0 ? o.a0 : o.a1)) < 1.6){ bus = v; break; } }
      if(o.hide){ o.pause -= dt; if(o.pause <= 0 && bus === null){ o.hide = 0; o.s = 0; o.x = o.a0; o.y = o.a1; } }
      else if(bus !== null){
        o.s += dt / 1.3; o.moving = 1; o.ph += dt * 6;
        o.x = o.a0 + (bus.x - o.a0) * o.s; o.y = o.a1 + (bus.y - o.a1) * o.s;
        if(o.s >= 1){ o.hide = 1; o.pause = 7 + villeRnd() * 9; o.moving = 0; }
      } else { o.moving = 0; o.s = 0; o.x = o.a0; o.y = o.a1; }
      o.lane = o.y; o.p = o.x;
    }
  }
  const bi = S.birds;
  for(let k = 0; k < bi.length; k++){
    const b = bi[k]; b.x += b.vx * dt; b.y += b.vy * dt;
    if(b.x > WX1 + 10) b.x = WX0 - 10; else if(b.x < WX0 - 10) b.x = WX1 + 10;
    if(b.y > WY1 + 10) b.y = WY0 - 10; else if(b.y < WY0 - 10) b.y = WY1 + 10;
  }
  const cl = S.clouds;
  for(let k = 0; k < cl.length; k++){ const c = cl[k]; c.x += c.vx * dt; c.y += c.vy * dt; if(c.x > WX1 + 20) c.x = WX0 - 20; if(c.y > WY1 + 20) c.y = WY0 - 20; }
}

/* ------------------------------------------------------------------ living elements: drawing */
function villeCollectDyn(){
  const S = villeS, all = S.dynAll, z = cam.z;
  let c = 0;
  for(let i = 0; i < all.length; i++){
    const o = all[i];
    if(o.hide) continue;
    const x = o.x + o.ox, y = o.y + o.oy, sx = villeSx(x, y) * z + S.cx, sy = villeSy(x, y, 0) * z + S.cy;
    if(sx < -110 * z || sx > cw + 110 * z || sy < -40 * z || sy - 110 * z > ch) continue;
    S.dyn[c] = o; S.dk[c] = villeDep(x, y); c++;
  }
  const dyn = S.dyn, dk = S.dk;
  for(let a = 1; a < c; a++){
    const oa = dyn[a], ka = dk[a]; let b = a - 1;
    while(b >= 0 && dk[b] > ka){ dk[b + 1] = dk[b]; dyn[b + 1] = dyn[b]; b--; }
    dk[b + 1] = ka; dyn[b + 1] = oa;
  }
  S.nd = c; let neg = 0; while(neg < c && dk[neg] < 0) neg++;
  S.dneg = neg;
}
function villeStrip(ax, ay, bx, by, z0, z1){
  g.moveTo(villeSx(ax, ay), villeSy(ax, ay, z0)); g.lineTo(villeSx(bx, by), villeSy(bx, by, z0)); g.lineTo(villeSx(bx, by), villeSy(bx, by, z1)); g.lineTo(villeSx(ax, ay), villeSy(ax, ay, z1)); g.closePath();
}
function villeBody(sx, sy, o, small){
  // character in profile, swinging legs and arms
  const sw = o.moving ? Math.sin(o.ph) : 0, bob = o.moving ? Math.abs(Math.cos(o.ph)) * 1.4 : 0;
  if(small){
    g.fillStyle = o.sh; g.fillRect(sx - 2.6, sy - 22, 5.2, 14); g.fillStyle = o.sk; g.fillRect(sx - 2, sy - 27, 4, 4.5);
    return;
  }
  g.fillStyle = 'rgba(0,0,0,.26)'; g.beginPath(); g.ellipse(sx, sy + 1.2, 8, 3.4, 0, 0, 7); g.fill();
  const hip = sy - 12 - bob;
  g.strokeStyle = o.pn; g.lineWidth = 3.8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(sx - 2.2, hip); g.lineTo(sx - 2.2 + sw * 3.4, sy - 1); g.moveTo(sx + 2.2, hip); g.lineTo(sx + 2.2 - sw * 3.4, sy - 1); g.stroke();
  const ty = hip - 13;
  g.fillStyle = o.sh; g.beginPath(); g.roundRect(sx - 5, ty, 10, 14, 3.5); g.fill();
  g.strokeStyle = o.sh; g.lineWidth = 2.8; g.beginPath(); g.moveTo(sx - 4.8, ty + 3); g.lineTo(sx - 5.2 - sw * 2, ty + 11); g.moveTo(sx + 4.8, ty + 3); g.lineTo(sx + 5.2 + sw * 2, ty + 11); g.stroke();
  g.fillStyle = o.sk; g.beginPath(); g.arc(sx, ty - 4.6, 4.8, 0, 7); g.fill();
  g.fillStyle = o.hr; g.beginPath(); g.arc(sx, ty - 5.6, 5, Math.PI, 0); g.fill();
}
// pre-rendered thumbnails of cars and buses: one per (tier, angle, heading, colour)
function villeVehSprite(o){
  const S = villeS, bus = o.kind === VK.BUS, xa = o.axis === 'x', head = (xa ? 0 : 2) + (o.dir > 0 ? 0 : 1);
  const key = (((S.tier * 4 + S.ang) * 4 + head) * 16 + o.ci) * 2 + (bus ? 1 : 0);
  let sp = S.vs.get(key);
  if(sp !== undefined) return sp;
  const s = VILLE_TIERS[S.tier], w = bus ? 250 : 140, h = bus ? 170 : 110, ax = w / 2, ay = bus ? 128 : 82;
  const c = document.createElement('canvas'); c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
  const x = c.getContext('2d'), svg = g;
  x.setTransform(s, 0, 0, s, (ax - villeSx(0, 0)) * s, (ay - villeSy(0, 0, 0)) * s);
  g = x;
  if(bus) villeBusShape(0, 0, xa, o.dir, o.c); else { g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(villeSx(0, 0), villeSy(0, 0, 0) + 1, 28, 10, 0, 0, 7); g.fill(); villeCarShape(0, 0, xa, o.dir, o.c, true); }
  g = svg;
  sp = {c, ax, ay, w, h}; S.vs.set(key, sp);
  return sp;
}
function villeDrawVeh(o){
  if(villeS.rest){
    const sp = villeVehSprite(o);
    g.drawImage(sp.c, villeSx(o.x, o.y) - sp.ax, villeSy(o.x, o.y, 0) - sp.ay, sp.w, sp.h);
    return;
  }
  const xa = o.axis === 'x';
  if(o.kind === VK.BUS){ villeBusShape(o.x, o.y, xa, o.dir, o.c); return; }
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(villeSx(o.x, o.y), villeSy(o.x, o.y, 0) + 1, 28, 10, 0, 0, 7); g.fill();
  villeCarShape(o.x, o.y, xa, o.dir, o.c, LT.lamp > .2);
}
function villeBusShape(x, y, xa, sgn, col){
  const L = 5.2, Wd = 1.5, w = xa ? L : Wd, d = xa ? Wd : L;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(villeSx(x, y), villeSy(x, y, 0) + 1, 56, 17, 0, 0, 7); g.fill();
  box(x - w / 2, y - d / 2, w, d, 3, 31, col);
  g.beginPath();
  const np = 5, pw = (L - .9) / np, e = .01;
  for(let k = 0; k < np; k++){
    const a = -L / 2 + .45 + k * pw, b = a + pw - .14;
    if(xa){
      if(FV.py) villeStrip(x + a, y + Wd / 2 + e, x + b, y + Wd / 2 + e, 15, 28);
      if(FV.my) villeStrip(x + a, y - Wd / 2 - e, x + b, y - Wd / 2 - e, 15, 28);
    } else {
      if(FV.px) villeStrip(x + Wd / 2 + e, y + a, x + Wd / 2 + e, y + b, 15, 28);
      if(FV.mx) villeStrip(x - Wd / 2 - e, y + a, x - Wd / 2 - e, y + b, 15, 28);
    }
  }
  if(villeEndVisible(xa, sgn, true)){
    if(xa) villeStrip(x + sgn * (L / 2 + e), y - Wd / 2 + .15, x + sgn * (L / 2 + e), y + Wd / 2 - .15, 14, 28);
    else villeStrip(x - Wd / 2 + .15, y + sgn * (L / 2 + e), x + Wd / 2 - .15, y + sgn * (L / 2 + e), 14, 28);
  }
  g.fillStyle = '#25374d'; g.fill();
  const fx = x + (xa ? sgn * L / 2 : 0), fy = y + (xa ? 0 : sgn * L / 2), rx = x - (xa ? sgn * L / 2 : 0), ry = y - (xa ? 0 : sgn * L / 2), hx = xa ? 0 : .45, hy = xa ? .45 : 0;
  if(villeEndVisible(xa, sgn, true)){
    g.fillStyle = LT.lamp > .2 ? '#fff2c0' : '#cfd4de';
    g.fillRect(villeSx(fx + hx, fy + hy) - 1.8, villeSy(fx + hx, fy + hy, 7) - 1.8, 3.6, 3.6); g.fillRect(villeSx(fx - hx, fy - hy) - 1.8, villeSy(fx - hx, fy - hy, 7) - 1.8, 3.6, 3.6);
  }
  if(villeEndVisible(xa, sgn, false)){
    g.fillStyle = '#b8352c';
    g.fillRect(villeSx(rx + hx, ry + hy) - 1.6, villeSy(rx + hx, ry + hy, 7) - 1.6, 3.2, 3.2); g.fillRect(villeSx(rx - hx, ry - hy) - 1.6, villeSy(rx - hx, ry - hy, 7) - 1.6, 3.2, 3.2);
  }
}
function villeDrawBike(o){
  const xa = o.axis === 'x', sx = villeSx(o.x, o.y), sy = villeSy(o.x, o.y, 0);
  const fx = villeSx(o.x + (xa ? o.dir * .6 : 0), o.y + (xa ? 0 : o.dir * .6)) - sx, fy = villeSy(o.x + (xa ? o.dir * .6 : 0), o.y + (xa ? 0 : o.dir * .6), 0) - sy;
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(sx, sy + 1, 14, 5, 0, 0, 7); g.fill();
  g.strokeStyle = '#1b2230'; g.lineWidth = 1.6; g.beginPath();
  g.ellipse(sx + fx, sy + fy - 4, 4.6, 4.6, 0, 0, 7); g.moveTo(sx - fx + 4.6, sy - fy - 4); g.ellipse(sx - fx, sy - fy - 4, 4.6, 4.6, 0, 0, 7); g.stroke();
  g.strokeStyle = o.c; g.lineWidth = 1.6; g.beginPath(); g.moveTo(sx - fx, sy - fy - 4); g.lineTo(sx - fx * .1, sy - fy * .1 - 11); g.lineTo(sx + fx, sy + fy - 4); g.stroke();
  o.moving = 1;
  g.fillStyle = o.sh; g.beginPath(); g.roundRect(sx - fx * .1 - 4, sy - fy * .1 - 26, 8, 14, 3); g.fill();
  g.fillStyle = o.sk; g.beginPath(); g.arc(sx - fx * .02, sy - fy * .02 - 30, 4.4, 0, 7); g.fill();
  g.fillStyle = o.hr; g.beginPath(); g.arc(sx - fx * .02, sy - fy * .02 - 31, 4.6, Math.PI, 0); g.fill();
  const sw = Math.sin(o.ph) * 3; g.strokeStyle = o.pn; g.lineWidth = 3; g.beginPath(); g.moveTo(sx - fx * .1, sy - fy * .1 - 13); g.lineTo(sx + fx * .2 + sw, sy + fy * .2 - 6); g.stroke();
}
function villeDrawSignal(o){
  const S = villeS, sx = villeSx(o.x, o.y), sy = villeSy(o.x, o.y, 0), st = o.grp === 0 ? S.sigH[o.idx] : S.sigV[o.idx];
  g.strokeStyle = '#59647a'; g.lineWidth = 2; g.lineCap = 'butt'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 58); g.stroke();
  g.fillStyle = '#10151f'; g.fillRect(sx - 3.6, sy - 78, 7.2, 21);
  g.fillStyle = st === 2 ? '#ff4b3e' : '#3a1512'; g.fillRect(sx - 2, sy - 76.5, 4, 4);
  g.fillStyle = st === 1 ? '#ffc83c' : '#3a2e12'; g.fillRect(sx - 2, sy - 71, 4, 4);
  g.fillStyle = st === 0 ? '#4bff8f' : '#12301f'; g.fillRect(sx - 2, sy - 65.5, 4, 4);
}
function villeDrawFountainDyn(o){
  const t = reduced ? 1.3 : villeS.t, cx = o.x, cy = o.y;
  g.fillStyle = 'rgba(214,240,255,.85)'; g.beginPath();
  for(let j = 0; j < 7; j++){
    const ang = j * 6.2832 / 6, rj = j === 6 ? 0 : 1.15, hmax = j === 6 ? 46 : 22;
    for(let k = 0; k < 4; k++){
      const u = ((t * .7 + k * .25 + j * .09) % 1), r = rj * (.35 + u * .75), h = 24 + hmax * 4 * u * (1 - u);
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r, px = villeSx(x, y), py = villeSy(x, y, h);
      g.moveTo(px + 1.5, py); g.arc(px, py, 1.5, 0, 7);
    }
  }
  g.fill();
  g.strokeStyle = 'rgba(214,240,255,.35)'; g.lineWidth = 1; g.beginPath();
  for(let k = 0; k < 3; k++){
    const u = ((t * .4 + k / 3) % 1), r = .5 + u * 1.7;
    for(let i = 0; i <= 20; i++){ const a = i / 20 * 6.2832, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if(i) g.lineTo(villeSx(x, y), villeSy(x, y, 8.6)); else g.moveTo(villeSx(x, y), villeSy(x, y, 8.6)); }
  }
  g.stroke();
}
const VILLE_STEAMC = Array.from({length: 32}, (_, i) => 'rgba(235,240,248,' + (.32 * (1 - (i + .5) / 32)).toFixed(2) + ')');
function villeDrawSteam(o){
  const t = reduced ? 0 : villeS.t, sx = villeSx(o.x, o.y), sy = villeSy(o.x, o.y, o.a0);
  for(let k = 0; k < 4; k++){
    const u = ((t * .35 + k * .25 + o.ph) % 1);
    g.fillStyle = VILLE_STEAMC[(u * 31.99) | 0];
    g.beginPath(); g.arc(sx + Math.sin(u * 5 + o.ph) * 3 + u * 8, sy - u * 34, 3 + u * 6, 0, 7); g.fill();
  }
}
function villeDrawDyn(o){
  switch(o.kind){
    case 0: case 1: villeDrawVeh(o); break;
    case 2: villeDrawBike(o); break;
    case 3: case 6: case 7: villeBody(villeSx(o.x + o.ox, o.y + o.oy), villeSy(o.x + o.ox, o.y + o.oy, 0), o, cam.z < .4); break;
    case 4: villeDrawSignal(o); break;
    case 5: villeDrawFountainDyn(o); break;
    default: villeDrawSteam(o);
  }
}
function villeDynPhase(ph){
  const S = villeS, dyn = S.dyn;
  const a = ph === 0 ? 0 : S.dneg, b = ph === 0 ? S.dneg : S.nd;
  for(let i = a; i < b; i++) villeDrawDyn(dyn[i]);
}
function villeDynLights(front, L){
  const S = villeS, dyn = S.dyn, a = front ? S.dneg : 0, b = front ? S.nd : S.dneg;
  g.save(); g.setTransform(S.z, 0, 0, S.z, S.tx, S.ty);
  villeLampGlows(front);
  for(let i = a; i < b; i++){
    const o = dyn[i], k = o.kind;
    if(k <= 2){
      const xa = o.axis === 'x', d = k === 1 ? 4.2 : k === 2 ? 1.6 : 3.3;
      const hx = o.x + (xa ? o.dir * d : 0), hy = o.y + (xa ? 0 : o.dir * d);
      g.globalAlpha = .5 * L; g.drawImage(S.spr.pool, villeSx(hx, hy) - 52, villeSy(hx, hy, 0) - 26, 104, 52);
    } else if(k === 4){
      if(S.rest){ if(o.hd[S.ang] < 0) o.hd[S.ang] = villeOccluded(o.x, o.y, 70) ? 1 : 0; if(o.hd[S.ang]) continue; }
      const st = o.grp === 0 ? S.sigH[o.idx] : S.sigV[o.idx];
      g.globalAlpha = .9; g.drawImage(st === 2 ? S.spr.gR : st === 1 ? S.spr.gY : S.spr.gG, villeSx(o.x, o.y) - 13, villeSy(o.x, o.y, 0) - 87 + (st === 2 ? 0 : st === 1 ? 5.5 : 11), 26, 26);
    }
  }
  g.restore(); g.globalAlpha = 1;
}
function villeCloudShadows(){
  const S = villeS, a = LT.day * .17;
  if(a < .02) return;
  g.globalAlpha = a;
  for(let k = 0; k < S.clouds.length; k++){ const c = S.clouds[k]; g.drawImage(S.spr.shadow, villeSx(c.x, c.y) - 210 * c.s, villeSy(c.x, c.y, 0) - 105 * c.s, 420 * c.s, 210 * c.s); }
  g.globalAlpha = 1;
}
const VILLE_BIRDC = Array.from({length: 20}, (_, i) => 'rgba(24,32,46,' + ((i + .5) / 20).toFixed(2) + ')');
/* birds fly above every city roof; the ones behind the building (depth < 0) are drawn before it, the others after,
   so a flock never crosses the building whatever its height */
function villeBirds(front){
  const S = villeS, a = clamp(LT.day * 1.5 - .25, 0, 1);
  if(a < .05) return;
  const t = reduced ? 0 : S.t;
  g.strokeStyle = VILLE_BIRDC[(a * 19.99) | 0]; g.lineWidth = 1.5; g.lineCap = 'round'; g.beginPath();
  for(let k = 0; k < S.birds.length; k++){
    const b = S.birds[k], sx0 = villeSx(b.x, b.y) * cam.z + S.cx;
    if(sx0 < -200 || sx0 > cw + 200) continue;
    for(let i = 0; i < b.n; i++){
      const x = b.x + b.bo[i * 3], y = b.y + b.bo[i * 3 + 1];
      if((villeDep(x, y) >= 0) !== front) continue;
      const sx = villeSx(x, y), sy = villeSy(x, y, b.z + b.bo[i * 3 + 2]);
      const f = Math.sin(t * 9 + i * 1.7 + b.ph) * 3.4;
      g.moveTo(sx - 6, sy + f - 1); g.lineTo(sx, sy + 1); g.lineTo(sx + 6, sy + f - 1);
    }
  }
  g.stroke();
}

/* ------------------------------------------------------------------ frame preparation and sky */
function villePrep(){
  const S = villeS;
  if(!S.spr) villeInitSprites();
  S.frame++;
  villeProj();
  S.z = cam.z * dpr; S.tx = (cw / 2 + cam.px) * dpr; S.ty = (ch / 2 + cam.py) * dpr; S.cx = cw / 2 + cam.px; S.cy = ch / 2 + cam.py;
  S.K = clamp((LT.lamp - .08) / .72, 0, 1);
  S.vx0 = -S.cx / cam.z; S.vx1 = (cw - S.cx) / cam.z; S.vy0 = -S.cy / cam.z; S.vy1 = (ch - S.cy) / cam.z;
  const q = Math.round(RA / VILLE_HP);
  S.rest = Math.abs(RA - q * VILLE_HP) < 1e-6; S.ang = ((q % 4) + 4) % 4;
  S.nv = 0; S.nm = 0;
  if(Math.abs(cam.z - S.lastZ) < S.lastZ * .002) S.zStable++; else S.zStable = 0;
  S.lastZ = cam.z;
  villeSigUpdate();
  if(S.rest) villeTiles();
  villeCollectDyn();
  if(S.rest) villeScan();
}
const villeSq = new Float64Array(8);
function villeSkyCovered(){
  const S = villeS, z = cam.z;
  const xs = [WX0, WX1, WX1, WX0], ys = [WY0, WY0, WY1, WY1];
  for(let k = 0; k < 4; k++){ villeSq[k * 2] = villeSx(xs[k], ys[k]) * z + S.cx; villeSq[k * 2 + 1] = villeSy(xs[k], ys[k], 0) * z + S.cy; }
  const mxp = (villeSq[0] + villeSq[2] + villeSq[4] + villeSq[6]) / 4, myp = (villeSq[1] + villeSq[3] + villeSq[5] + villeSq[7]) / 4;
  for(let e = 0; e < 4; e++){
    const ax = villeSq[e * 2], ay = villeSq[e * 2 + 1], bx = villeSq[((e + 1) & 3) * 2], by = villeSq[((e + 1) & 3) * 2 + 1];
    const ref = (bx - ax) * (myp - ay) - (by - ay) * (mxp - ax);
    for(let c = 0; c < 4; c++){
      const px = c & 1 ? cw : 0, py = c & 2 ? ch : 0;
      if(((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * ref < 0) return false;
    }
  }
  return true;
}
function drawSky(){
  villePrep();
  if(villeSkyCovered()) return;
  const S = villeS, night = 1 - clamp(LT.day * 2.2, 0, 1), nq = Math.round(night * 16);
  const key = LT.t + LT.b + '|' + cw + 'x' + ch + '|' + dpr + '|' + nq;
  let K = S.sky; if(!K) K = S.sky = {c: document.createElement('canvas'), key: ''};
  if(K.key !== key){
    K.c.width = Math.max(1, Math.round(cw * dpr)); K.c.height = Math.max(1, Math.round(ch * dpr));
    const x = K.c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gr = x.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, LT.t); gr.addColorStop(1, LT.b); x.fillStyle = gr; x.fillRect(0, 0, cw, ch);
    if(nq > 0){ x.fillStyle = '#fff'; x.globalAlpha = nq / 16 * .5; for(const s of S.stars) x.fillRect(s.x * cw, s.y * ch, s.s, s.s); x.globalAlpha = 1; }
    K.key = key;
  }
  ctx.drawImage(K.c, 0, 0, cw, ch);
  if(night > .05){ ctx.fillStyle = '#fff'; for(let k = 0; k < 16; k++){ const s = S.stars[k]; ctx.globalAlpha = night * (reduced ? .5 : .25 + .45 * Math.sin(villeS.t * 1.7 + s.p)); ctx.fillRect(s.x * cw, s.y * ch, s.s + .6, s.s + .6); } ctx.globalAlpha = 1; }
  const hr = LT.h < 6 ? LT.h + 24 : LT.h;
  const body = (h0, h1, col, spr, rr) => {
    const u = (hr - h0) / (h1 - h0); if(u < -.02 || u > 1.02) return;
    const x = cw * (.08 + .84 * clamp(u, 0, 1)), y = ch * (.34 - .27 * Math.sin(clamp(u, 0, 1) * Math.PI));
    ctx.drawImage(spr, x - rr * 4, y - rr * 4, rr * 8, rr * 8); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
  };
  body(6, 18, '#ffe9b0', S.spr.sun, 20); body(18, 30, '#dfe6f5', S.spr.moon, 13);
  ctx.globalAlpha = .10 + .22 * LT.day;
  for(let i = 0; i < 4; i++){ const sp = reduced ? 0 : S.t * (7 + i * 2.4), x = ((i * 310 + sp) % (cw + 260)) - 130, y = ch * (.06 + i * .05); ctx.drawImage(S.spr.cloud, x, y, 180, 90); }
  ctx.globalAlpha = 1;
}


/* ---- engine adapter: the static decor is baked in tiles by angle and zoom, the living elements are drawn live */
function cityInit(){}
function cityBegin(night){
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSky();   // villePrep(), then the sky only when the ground does not cover the view
  g = ctx; ctx.setTransform(Z, 0, 0, Z, TX, TY); ZB = 0; ZL = 0;
}
/* at night the whole canvas is still only ground and city when the ground covers the view: tint it in place, no extra layer */
function cityBack(night){
  if(!night){ villeBack(); return; }
  if(villeSkyCovered()){
    villeBack();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = LT.w; ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(Z, 0, 0, Z, TX, TY); villeLights(false);
  } else { passAll(); villeBack(); passTint(); villeLights(false); passEnd(1); }
}
function cityFront(night){
  if(night){ passAll(); villeFront(); passTint(); villeLights(true); passEnd(1); } else villeFront();
}
