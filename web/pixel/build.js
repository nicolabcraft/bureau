/* web/pixel/build.js : lot L7, voir docs/vue-pixel.md (2.7)
   The building site of one floor (construction and demolition) and its tower crane.
   Shares one scope with the other web/pixel files: public names are the ones of the 2.7 signatures (BUILD_SECONDS, startBuild, tickBuild,
   drawConstruction, drawFloorCrane), every other top-level name wears `bld`. Declares only, nothing runs at load.

   How it works. A site is a pure function of the progress `q = fl.p` (0..1) and of the clock T: a demolition is the same picture played
   backwards (p goes from 1 to 0), so nothing about the picture is stored. `fl.build = { t0, dir }` only drives p (tickBuild).
   Seven crane jobs (bldS / bldE are their intervals of q) each carry one load from the pallet to a slot of the deck:
     0 steel columns, 1 beams, 2 concrete skip (screed), 3 wall panels, 4 glass crate, 5 furniture crate, 6 lamps.
   The crane sets the load down at bldArrive; workers then install it, left to right, during the next stretch (bldInst): the layer
   (columns, beams, screed, walls, glass) is revealed by a wipe. Job 5 is the fit-out: the real decor of the floor (drawFloorStatic) is
   revealed by a wipe, and the pieces of floorFurniture(fl) show up behind the edge of it, so that q = 1 is exactly the finished floor.
   Job 6 switches the lights on: from there the night mask has the small pools of the lit places, like applyLight without people.
   - drawConstruction paints into a plate sized offscreen canvas (transparent where the frame is open), dims it with its own night mask
     (applyLight is not called while fl.p < 1), then copies it to g, whose transform floor.js has set to the plate origin.
   - drawFloorCrane draws in buffer px with floorCam (the signature has no camera): mast against the outer wall of the lift tower,
     jib over the plate (in the sky for the top floor, across the slab above for the others), trolley, rope, hook and load.
     It also dims the slab under the plate at night: floor.js draws that slab itself and does not apply the night mask to it.
   - The 30 ms of the decor of the floor is paid in startBuild (bldWarm), not in the middle of the build. */

const BUILD_SECONDS = 13;                        // readable, 8 to 15 s

let bldTime = 0;                                 // seconds, advanced by tickBuild
const bldKits = new WeakMap();                   // plan -> baked layers of its site
let bldPlate = null;                             // plate sized offscreen canvas of the picture
let bldDark = null;                              // plate sized night mask
let bldScratch = null;                           // 1 x 1 canvas to bake the real decor early

/* ------------------------------ the jobs of the crane ------------------------------ */

const bldS = [0, 0.14, 0.28, 0.40, 0.52, 0.64, 0.78];            // job k starts here (q)
const bldE = [0.14, 0.28, 0.40, 0.52, 0.64, 0.78, 0.92];         // and ends here
const bldArrive = [0.119, 0.259, 0.382, 0.502, 0.622, 0.759, 0.899];   // the load is set down: s + 0.85 * (e - s)
const bldInst = [0.12, 0.12, 0.10, 0.12, 0.10, 0.211, 0.04];     // length of the install after the drop (job 5: until q = 0.97)
const bldSlotX = [60, 88, 112, 72, 100, 64, 124];                // where the loads are set down, plan px (feet of the load)
const bldSlotY = [150, 196, 238, 110, 170, 214, 130];
const bldZc = 46;                                // cruise height of a load, px (drawn as an upward shift)
const bldZh = 120;                               // height of the empty hook on its way back
const bldLoadW = [32, 36, 20, 28, 30, 30, 24];
const bldLoadH = [9, 10, 16, 12, 16, 18, 10];

function bldEase(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function bldProg(q, a, len) { return len <= 0 ? (q >= a ? 1 : 0) : q <= a ? 0 : q >= a + len ? 1 : (q - a) / len; }

const bldHk = { gx: 0, gy: 0, hz: 0, lz: 0, load: -1 };
/** Position of the hook and of its load at progress q (plan px; hz, lz: height of the hook and of the load above the deck). Reused object. */
function bldHook(q, W) {
  const o = bldHk, pxx = W - 141, pyy = 307;
  if (q >= bldE[6]) { o.gx = pxx; o.gy = pyy; o.hz = bldZh; o.lz = 0; o.load = -1; return o; }
  let k = 0;
  while (k < 6 && q >= bldE[k]) k++;
  const u = Math.max(0, (q - bldS[k]) / (bldE[k] - bldS[k])), sx = bldSlotX[k], sy = bldSlotY[k];
  o.load = u < 0.85 ? k : -1;
  if (u < 0.12) { o.gx = pxx; o.gy = pyy; o.hz = bldZh * (1 - bldEase(u / 0.12)); o.lz = 0; }
  else if (u < 0.30) { o.gx = pxx; o.gy = pyy; o.hz = o.lz = bldZc * bldEase((u - 0.12) / 0.18); }
  else if (u < 0.68) { const v = bldEase((u - 0.30) / 0.38); o.gx = pxx + (sx - pxx) * v; o.gy = pyy + (sy - pyy) * v; o.hz = o.lz = bldZc; }
  else if (u < 0.85) { o.gx = sx; o.gy = sy; o.hz = o.lz = bldZc * (1 - bldEase((u - 0.68) / 0.17)); }
  else if (u < 0.90) { o.gx = sx; o.gy = sy; o.hz = bldZh * bldEase((u - 0.85) / 0.05); o.lz = 0; }
  else { const v = bldEase((u - 0.90) / 0.10); o.gx = sx + (pxx - sx) * v; o.gy = sy + (pyy - sy) * v; o.hz = bldZh; o.lz = 0; }
  return o;
}

/* ------------------------------ baked layers of a site ------------------------------ */

function bldBuf(W) { return makeBuffer(W, PLATE_H); }

function bldCone(g, cx, cy) {
  rect(g, cx - 3, cy + 7, 8, 2, 'ink'); rect(g, cx - 2, cy + 4, 6, 3, 'pot'); rect(g, cx - 1, cy, 4, 5, 'pot'); rect(g, cx - 1, cy + 2, 4, 1, 'white');
}

function bldFloods(W) { return [[74, 296], [W - 24, 300], [150, 30], [W - 48, 26]]; }

/** Formwork deck with its rebar mesh, side posts, hazard barriers, hoarding, hut, pallet, mixer, cones and floodlights. */
function bldPaintDeck(g, W) {
  rect(g, 8, 16, W - 16, 320, 'night');
  for (let x = 8; x < W - 8; x += 6) rect(g, x, 16, 1, 320, 'steelD');
  for (let y = 16; y < 336; y += 6) rect(g, 8, y, W - 16, 1, 'steelD');
  for (let k = 0; k < 160; k++) { const h = hash('dk' + k); rect(g, 8 + (h % (W - 16)), 16 + ((h >>> 10) % 320), 1, 1, 'ink'); }
  rect(g, 8, 12, W - 16, 4, 'ink'); rect(g, 8, 13, W - 16, 2, 'steel'); rect(g, 8, 13, W - 16, 1, 'steelL');
  for (const x of [0, W - 8]) {
    rect(g, x, 16, 8, 304, 'ink'); rect(g, x + 2, 16, 4, 304, 'steelD'); rect(g, x + 3, 16, 2, 304, 'steel');
    for (let y = 40; y < 316; y += 38) rect(g, x + 1, y, 6, 2, 'steelL');
    rect(g, x, 320, 8, 16, 'ink');                                          // hazard barrier across the doorway
    for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) if (((i + j) >> 2) & 1) rect(g, x + i, 320 + j, 1, 1, 'lamp');
  }
  rect(g, 8, 336, W - 16, 16, 'woodD');                                     // hoarding along the bottom with its banner
  for (let x = 8; x < W - 8; x += 12) rect(g, x, 336, 1, 16, 'ink');
  rect(g, 8, 336, W - 16, 2, 'wood'); rect(g, 8, 350, W - 16, 2, 'ink');
  const bx = (W >> 1) - 96;
  rect(g, bx, 338, 192, 12, 'ink'); rect(g, bx + 1, 339, 190, 10, 'lamp'); rect(g, bx + 1, 339, 190, 1, 'lampHi');
  for (let k = 0; k < 190; k += 16) rect(g, bx + 1 + k, 345, 8, 2, 'ink');
  const hu = { x: 14, y: 276, w: 44, h: 48 };                               // hut of the site manager
  rect(g, hu.x + 3, hu.y + hu.h, hu.w - 4, 3, 'ink'); rect(g, hu.x, hu.y, hu.w, hu.h, 'ink'); rect(g, hu.x + 1, hu.y + 1, hu.w - 2, hu.h - 2, 'steelD');
  rect(g, hu.x + 1, hu.y + 1, hu.w - 2, 3, 'steelL');
  for (let y = hu.y + 6; y < hu.y + hu.h - 2; y += 4) rect(g, hu.x + 1, y, hu.w - 2, 1, 'steel');
  rect(g, hu.x + 5, hu.y + 8, 16, 12, 'ink'); rect(g, hu.x + 6, hu.y + 9, 14, 10, 'glass'); rect(g, hu.x + 6, hu.y + 9, 14, 2, 'glassHi');
  rect(g, hu.x + 28, hu.y + 10, 14, 24, 'ink'); rect(g, hu.x + 29, hu.y + 11, 12, 22, 'pot'); rect(g, hu.x + 38, hu.y + 22, 2, 2, 'lamp');
  const pa = { x: W - 176, y: 300, w: 70 };                                 // pallet where the crane picks its loads
  rect(g, pa.x - 2, pa.y + 12, pa.w + 4, 4, 'ink'); rect(g, pa.x, pa.y + 13, pa.w, 2, 'woodD');
  for (let r = 0; r < 2; r++) { rect(g, pa.x, pa.y + r * 5 - 1, pa.w, 5, 'ink'); rect(g, pa.x + 1, pa.y + r * 5, pa.w - 2, 3, 'steel'); rect(g, pa.x + 1, pa.y + r * 5, pa.w - 2, 1, 'steelL'); }
  const mx = W - 92, my = 282;                                              // concrete mixer
  rect(g, mx - 2, my + 16, 36, 5, 'ink'); rect(g, mx, my + 17, 32, 2, 'steelD');
  rect(g, mx + 2, my + 16, 8, 8, 'ink'); rect(g, mx + 3, my + 17, 6, 6, 'steel'); rect(g, mx + 22, my + 16, 8, 8, 'ink'); rect(g, mx + 23, my + 17, 6, 6, 'steel');
  rect(g, mx + 2, my, 26, 17, 'ink'); rect(g, mx + 3, my + 1, 24, 15, 'lamp'); rect(g, mx + 3, my + 1, 24, 3, 'lampHi'); rect(g, mx + 3, my + 12, 24, 4, 'wood');
  for (let k = 0; k < 24; k += 5) rect(g, mx + 3 + k, my + 4, 1, 8, 'woodL');
  for (const [cx, cy] of [[68, 318], [102, 310], [W - 24, 316], [W - 60, 310], [150, 296]]) bldCone(g, cx, cy);
  for (const [px, py] of bldFloods(W)) { rect(g, px - 1, py, 3, 26, 'steelD'); rect(g, px - 4, py - 5, 9, 5, 'steelL'); rect(g, px - 3, py - 4, 7, 3, 'lampHi'); }
}

function bldPaintScreed(g, W) {
  rect(g, 8, 16, W - 16, 320, 'conc');
  for (let x = 8; x < W - 8; x += 32) rect(g, x, 16, 1, 320, 'concD');
  for (let y = 16; y < 336; y += 32) rect(g, 8, y, W - 16, 1, 'concD');
  for (let k = 0; k < 420; k++) { const h = hash('sc' + k); rect(g, 8 + (h % (W - 16)), 16 + ((h >>> 10) % 320), 1 + (h % 3), 1, h & 1 ? 'concD' : 'steelL'); }
}

function bldGrid(W) {
  const xs = [];
  for (let x = 40; x <= W - 40; x += 64) xs.push(x);
  return xs;
}
const bldRows = [72, 160, 248];

function bldPaintColumns(g, W) {
  const xs = bldGrid(W);
  for (const cx of xs) {
    for (let j = 0; j < bldRows.length - 1; j++) {
      const y1 = bldRows[j], y2 = bldRows[j + 1];
      rect(g, cx - 2, y1 + 4, 5, y2 - y1 - 8, 'ink'); rect(g, cx - 2, y1 + 4, 4, y2 - y1 - 8, 'steel');
      rect(g, cx - 2, y1 + 4, 1, y2 - y1 - 8, 'steelL'); rect(g, cx + 1, y1 + 4, 1, y2 - y1 - 8, 'steelD');
    }
    for (const cy of bldRows) {
      rect(g, cx - 6, cy - 6, 12, 12, 'concD'); rect(g, cx - 6, cy - 6, 12, 1, 'steelL'); rect(g, cx - 5, cy - 5, 10, 10, 'ink'); rect(g, cx - 4, cy - 4, 8, 8, 'steel');
      rect(g, cx - 4, cy - 4, 8, 2, 'steelL'); rect(g, cx - 4, cy + 2, 8, 2, 'steelD');
      for (const [bx, by] of [[-3, -3], [2, -3], [-3, 2], [2, 2]]) rect(g, cx + bx, cy + by, 1, 1, 'ink');
    }
  }
}

function bldPaintBeams(g, W) {
  const xs = bldGrid(W);
  for (const cy of bldRows) {
    for (let i = 0; i < xs.length - 1; i++) {
      const x1 = xs[i], x2 = xs[i + 1];
      rect(g, x1 + 4, cy - 2, x2 - x1 - 8, 5, 'ink'); rect(g, x1 + 4, cy - 2, x2 - x1 - 8, 4, 'steel');
      rect(g, x1 + 4, cy - 2, x2 - x1 - 8, 1, 'steelL'); rect(g, x1 + 4, cy + 2, x2 - x1 - 8, 1, 'steelD');
      for (let x = x1 + 8; x < x2 - 6; x += 10) rect(g, x, cy, 1, 1, 'steelL');
    }
  }
}

function bldWindows(plan) {
  const list = [];                                                          // [x, w] of the windows of the back wall (as floor.js paints them)
  for (const s of plan.spots.window) list.push([s.x * 8 - 8, 24]);
  for (const o of plan.offices) list.push([o.rect.x * 8 + 48, 32]);
  if (!plan.offices.length) list.push([40, 32], [104, 32]);
  return list;
}

function bldHWall(g, x, y, w) { rect(g, x, y, w, 8, 'ink'); rect(g, x + 1, y + 1, w - 2, 5, 'wallMid'); rect(g, x + 1, y + 6, w - 2, 1, 'wallSh'); }
function bldVWall(g, x, y, h) { rect(g, x, y, 8, h, 'ink'); rect(g, x + 1, y, 3, h, 'wallMid'); rect(g, x + 4, y, 3, h, 'wallSh'); }

function bldPaintWalls(g, plan) {
  const W = plan.width;
  rect(g, 0, 0, W, 16, 'steelD'); rect(g, 0, 0, W, 2, 'steel'); rect(g, 0, 14, W, 2, 'ink');
  for (let x = 32; x < W; x += 32) rect(g, x, 2, 1, 12, 'night');
  for (const x of [0, W - 8]) {
    for (const [y0, y1] of [[0, 320], [336, 352]]) { const t = Math.max(y0, 16); rect(g, x, y0, 8, y1 - y0, 'ink'); rect(g, x + 1, t, 6, y1 - t, 'steelD'); }
    rect(g, x, 316, 8, 4, 'ink');
  }
  for (const rm of plan.rooms) {
    const x = rm.rect.x * 8, w = (rm.rect.w + 1) * 8, doorX = (rm.door.x - 1) * 8;
    bldHWall(g, x, 64, w); bldVWall(g, x, 72, 192); bldVWall(g, x + w - 8, 72, 192);
    bldHWall(g, x, 256, doorX - x); bldHWall(g, doorX + 24, 256, x + w - doorX - 24);
  }
  rect(g, 8, 272, W - 16, 24, 'steelD'); rect(g, 8, 272, W - 16, 2, 'steel'); rect(g, 8, 294, W - 16, 2, 'ink');
  rect(g, 8, 336, W - 16, 16, 'steelD'); rect(g, 8, 336, W - 16, 3, 'steel'); rect(g, 8, 339, W - 16, 1, 'ink'); rect(g, 8, 348, W - 16, 4, 'ink');
}

function bldPaintGlass(g, plan) {
  for (const [x, w] of bldWindows(plan)) {
    rect(g, x - 1, 2, w + 2, 12, 'steelL'); rect(g, x, 3, w, 10, 'glass'); rect(g, x, 3, w, 2, 'glassHi'); rect(g, x + (w >> 1), 3, 1, 10, 'steelL');
  }
  for (const o of plan.offices) {
    const x0 = o.rect.x * 8;
    rect(g, x0, 16, 8, 40, 'steelL'); rect(g, x0 + 2, 17, 4, 38, 'glass');
    rect(g, x0 + 112, 16, 8, 16, 'steelL'); rect(g, x0 + 114, 17, 4, 14, 'glass');
    rect(g, x0, 48, 120, 3, 'steelL'); rect(g, x0, 51, 120, 5, 'glass'); rect(g, x0, 51, 120, 1, 'glassHi');
  }
}

function bldLoadSprite(i) {
  const b = makeBuffer(bldLoadW[i], bldLoadH[i]), g = b.g, w = bldLoadW[i], h = bldLoadH[i];
  if (i === 0) {
    rect(g, 0, 0, w, h, 'ink');
    for (const y of [1, 4, 7]) { rect(g, 1, y, w - 2, 2, 'steel'); rect(g, 1, y, w - 2, 1, 'steelL'); }
    rect(g, 6, 0, 2, h, 'lamp'); rect(g, 24, 0, 2, h, 'lamp');
  } else if (i === 1) {
    rect(g, 0, 7, w, 3, 'ink'); rect(g, 1, 8, w - 2, 1, 'woodD');
    for (const y of [1, 4]) { rect(g, 1, y, w - 2, 3, 'ink'); rect(g, 1, y, w - 2, 2, 'steel'); rect(g, 1, y, w - 2, 1, 'steelL'); }
    rect(g, 8, 0, 2, 7, 'lamp'); rect(g, 26, 0, 2, 7, 'lamp');
  } else if (i === 2) {
    rect(g, 0, 2, w, 12, 'ink'); rect(g, 1, 3, w - 2, 10, 'steelD'); rect(g, 2, 3, w - 4, 3, 'conc'); rect(g, 7, 14, 6, 2, 'ink'); rect(g, 9, 0, 2, 3, 'lamp');
  } else if (i === 3) {
    rect(g, 0, 9, w, 3, 'woodD'); rect(g, 0, 1, w, 9, 'ink'); rect(g, 1, 2, w - 2, 7, 'wallHi'); rect(g, 1, 4, w - 2, 1, 'wallMid'); rect(g, 1, 7, w - 2, 1, 'wallMid');
  } else if (i === 4) {
    rect(g, 0, 0, w, h, 'ink'); rect(g, 1, 1, w - 2, h - 2, 'woodL'); rect(g, 3, 3, 10, 10, 'glass'); rect(g, 3, 3, 10, 2, 'glassHi'); rect(g, 17, 3, 10, 10, 'glass'); rect(g, 17, 3, 10, 2, 'glassHi');
  } else if (i === 5) {
    rect(g, 0, 0, w, h, 'ink'); rect(g, 1, 1, w - 2, h - 2, 'woodL');
    for (let x = 5; x < w - 2; x += 6) rect(g, x, 1, 1, h - 2, 'wood');
    rect(g, 1, 8, w - 2, 1, 'wood'); rect(g, 22, 3, 6, 4, 'lamp'); rect(g, 22, 3, 6, 1, 'lampHi');
  } else {
    rect(g, 0, 0, w, h, 'ink'); rect(g, 1, 1, w - 2, h - 2, 'steelL');
    for (let x = 3; x < w - 3; x += 5) { rect(g, x, 3, 3, 4, 'lampHi'); rect(g, x, 7, 3, 1, 'lamp'); }
  }
  return b.c;
}
const bldLoads = [];
function bldLoad(i) { return bldLoads[i] || (bldLoads[i] = bldLoadSprite(i)); }

function bldMakeKit(fl) {
  const plan = fl.plan, W = plan.width, kit = { W, pcsSrc: null, pcs: null, pth: null };
  const make = (paint, arg) => { const b = bldBuf(W); paint(b.g, arg); return b.c; };
  kit.deck = make(bldPaintDeck, W);
  kit.screed = make(bldPaintScreed, W);
  kit.cols = make(bldPaintColumns, W);
  kit.beams = make(bldPaintBeams, W);
  kit.walls = make(bldPaintWalls, plan);
  kit.glass = make(bldPaintGlass, plan);
  kit.floods = bldFloods(W);
  return kit;
}

function bldKit(fl) {
  let k = bldKits.get(fl.plan);
  if (!k) { k = bldMakeKit(fl); bldKits.set(fl.plan, k); }
  return k;
}

/** Pieces of the floor sorted by depth once, with the x at which the fit-out crew reaches them. */
function bldPieces(kit, fl) {
  const src = floorFurniture(fl);
  if (kit.pcsSrc === src && kit.pcs && kit.pcs.length === src.length) return kit.pcs;
  const list = src.slice();
  list.sort((a, b) => a.sy - b.sy);
  kit.pcsSrc = src; kit.pcs = list;
  kit.pth = new Float32Array(list.length);
  for (let i = 0; i < list.length; i++) kit.pth[i] = list[i].x + list[i].w / 2;
  return list;
}

function bldEnsure(W) {
  if (!bldPlate || bldPlate.c.width !== W) { bldPlate = bldBuf(W); bldDark = bldBuf(W); }
}

/** Bakes the layers of the site and the real decor of the floor ahead of time, so the first frames of the build cost nothing special. */
function bldWarm(fl) {
  bldKit(fl);
  if (!bldScratch) bldScratch = makeBuffer(1, 1);
  drawFloorStatic(bldScratch.g, fl, skyKind(sceneHour()));
}

/* ------------------------------ the workers ------------------------------ */

const bldWorkerN = 5;
const bldRouteN = 10;
const bldWorkerLooks = [
  { top: 'pot', hair: 'lamp', skin: 'skinB' }, { top: 'lamp', hair: 'lamp', skin: 'skinA' }, { top: 'pot', hair: 'lamp', skin: 'skinC' },
  { top: 'lamp', hair: 'lamp', skin: 'skinB' }, { top: 'leaf', hair: 'lamp', skin: 'skinA' },
];
const bldSheets = [];
const bldRx = new Float32Array(bldWorkerN * bldRouteN);
const bldRy = new Float32Array(bldWorkerN * bldRouteN);
const bldRleg = new Float32Array(bldWorkerN * bldRouteN);   // seconds to walk to this waypoint from the previous one
const bldRdw = new Float32Array(bldWorkerN * bldRouteN);    // seconds spent at it
const bldRwork = new Uint8Array(bldWorkerN * bldRouteN);    // 0 look around, 1 hammer, 2 weld, 3 read
const bldRdir = new Uint8Array(bldWorkerN * bldRouteN);     // 0 down, 1 up, 2 right, 3 left: how the worker arrived
const bldRtot = new Float32Array(bldWorkerN);
const bldRph = new Float32Array(bldWorkerN);
let bldRouteW = -1;

/** Walking routes of the workers over the deck, a few waypoints each, fixed for a plate width. */
function bldRoutes(W) {
  if (bldRouteW === W) return;
  bldRouteW = W;
  const nx = [];
  for (let x = 72; x <= W - 48; x += 64) nx.push(x);
  const ny = [116, 204, 292];
  for (let i = 0; i < bldWorkerN; i++) {
    const base = i * bldRouteN, h0 = hash('ws' + i);
    let ix = h0 % nx.length, iy = (h0 >>> 4) % 3, total = 0;
    for (let j = 0; j < bldRouteN; j++) {
      const h = hash('wm' + i + '_' + j), opts = [];
      if (ix > 0) opts.push([-1, 0]);
      if (ix < nx.length - 1) opts.push([1, 0]);
      if (iy > 0) opts.push([0, -1]);
      if (iy < 2) opts.push([0, 1]);
      const m = opts[h % opts.length];
      ix += m[0]; iy += m[1];
      bldRx[base + j] = nx[ix]; bldRy[base + j] = ny[iy];
      bldRdir[base + j] = m[0] > 0 ? 2 : m[0] < 0 ? 3 : m[1] > 0 ? 0 : 1;
      bldRwork[base + j] = (h >>> 8) % 4;
      bldRdw[base + j] = 2 + ((h >>> 12) % 4);
    }
    for (let j = 0; j < bldRouteN; j++) {
      const p = base + ((j + bldRouteN - 1) % bldRouteN), c = base + j;
      bldRleg[c] = Math.max(0.3, Math.hypot(bldRx[c] - bldRx[p], bldRy[c] - bldRy[p]) / 24);
      total += bldRleg[c] + bldRdw[c];
    }
    bldRtot[i] = total;
    bldRph[i] = ((hash('wp' + i) % 1000) / 1000) * total;
  }
}

const bldWk = { x: 0, y: 0, moving: false, dir: 0, work: 0 };
function bldWorkerAt(i, t) {
  const o = bldWk, base = i * bldRouteN;
  let tt = (t + bldRph[i]) % bldRtot[i];
  for (let j = 0; j < bldRouteN; j++) {
    const c = base + j, p = base + ((j + bldRouteN - 1) % bldRouteN), leg = bldRleg[c];
    o.dir = bldRdir[c];
    if (tt < leg) { const f = tt / leg; o.x = bldRx[p] + (bldRx[c] - bldRx[p]) * f; o.y = bldRy[p] + (bldRy[c] - bldRy[p]) * f; o.moving = true; o.work = 0; return o; }
    tt -= leg;
    if (tt < bldRdw[c]) { o.x = bldRx[c]; o.y = bldRy[c]; o.moving = false; o.work = bldRwork[c]; return o; }
    tt -= bldRdw[c];
  }
  o.x = bldRx[base]; o.y = bldRy[base]; o.moving = false; o.work = 0;
  return o;
}

const bldWxs = new Float32Array(bldWorkerN);
const bldWys = new Float32Array(bldWorkerN);
const bldWdir = new Uint8Array(bldWorkerN);
const bldWmv = new Uint8Array(bldWorkerN);
const bldWwk = new Uint8Array(bldWorkerN);

function bldDrawWorkers(g, T, W) {
  bldRoutes(W);
  const still = REDUCED;
  for (let i = 0; i < bldWorkerN; i++) {
    const w = bldWorkerAt(i, still ? 0 : T);
    bldWxs[i] = w.x; bldWys[i] = w.y; bldWdir[i] = w.dir; bldWmv[i] = w.moving && !still ? 1 : 0; bldWwk[i] = w.work;
  }
  let done = 0;
  for (let rank = 0; rank < bldWorkerN; rank++) {   // painter's order: the one with the smallest y first
    let best = -1;
    for (let i = 0; i < bldWorkerN; i++) if (!(done & (1 << i)) && (best < 0 || bldWys[i] < bldWys[best])) best = i;
    done |= 1 << best;
    const i = best, x = Math.round(bldWxs[i]), y = Math.round(bldWys[i]);
    if (!bldSheets[i]) bldSheets[i] = bakeSheet(Object.assign({}, WORKER_LOOK, bldWorkerLooks[i]), null);
    const d = bldWdir[i], base = d === 0 ? FRAME.down : d === 1 ? FRAME.up : FRAME.side, flip = d === 3;
    let frame = base;
    if (bldWmv[i]) frame = base + 1 + (((T * 9) | 0) + i) % 4;
    else if (bldWwk[i] === 1) frame = FRAME.hand0 + (((T * 4) | 0) + i) % 2;
    else if (bldWwk[i] === 2) frame = FRAME.hold;
    else if (bldWwk[i] === 3) frame = FRAME.read;
    const front = frame >= FRAME.sit;
    rect(g, x - 4, y - 1, 9, 2, 'ink'); rect(g, x - 2, y + 1, 5, 1, 'ink');
    drawSprite(g, bldSheets[i], frame, x, y, flip && !front);
    if (frame === FRAME.hold) {
      const f = ((T * 14) | 0) % 3;
      if (f) { rect(g, x + 5, y - 9, 2, 2, f === 1 ? 'white' : 'lampHi'); rect(g, x + 8, y - 7 + f, 1, 1, 'lamp'); rect(g, x + 3, y - 11, 1, 1, 'lampHi'); }
    } else if (!bldWmv[i] && bldWwk[i] === 1 && ((T * 4) | 0) % 2) rect(g, x + 6, y - 6, 1, 1, 'white');
  }
}

/* ------------------------------ the site picture ------------------------------ */

function bldWipe(g, src, F, H) {
  const w = Math.round(F);
  if (w > 0) g.drawImage(src, 0, 0, w, H, 0, 0, w, H);
}
function bldEdge(g, F, p) {
  if (p <= 0 || p >= 1) return;
  const x = Math.round(F) - 1;
  for (let y = 16; y < 336; y += 16) rect(g, x, y, 1, 8, 'lampHi');
}

function bldBeacon(g, x, y, fx, blink) {
  if (x <= fx) return;                                                      // already covered by the fit-out
  rect(g, x, y, 4, 4, 'ink'); rect(g, x + 1, y + 1, 2, 2, blink ? 'red' : 'pot');
}

const bldDustX = [-1, 0, 1, -1, 1, -1, 0, 1];
const bldDustY = [-1, -1, -1, 0, 0, 1, 1, 1];

/** The floor as a site, in plan px (g has its origin at the plate). At q = 1 it is the finished floor; at q = 0 an empty deck. */
function drawConstruction(g, fl, T) {
  const plan = fl.plan;
  if (!plan) return;
  const W = plan.width, H = PLATE_H, q = fl.p, kit = bldKit(fl);
  bldEnsure(W);
  const pg = bldPlate.g;
  pg.setTransform(1, 0, 0, 1, 0, 0);
  pg.globalAlpha = 1;
  pg.globalCompositeOperation = 'source-over';
  pg.clearRect(0, 0, W, H);
  pg.drawImage(kit.deck, 0, 0);
  // layers: each is revealed by a wipe once its load has been set down
  const pour = bldProg(q, bldArrive[2], bldInst[2]);
  if (pour > 0) {
    bldWipe(pg, kit.screed, pour * W, H);
    if (pour < 1) { rect(pg, pour * W - 6, 16, 6, 320, 'concD'); rect(pg, pour * W - 7, 16, 1, 320, 'steelD'); }
  }
  const fc = bldProg(q, bldArrive[0], bldInst[0]), fb = bldProg(q, bldArrive[1], bldInst[1]);
  bldWipe(pg, kit.cols, fc * W, H); bldEdge(pg, fc * W, fc);
  bldWipe(pg, kit.beams, fb * W, H); bldEdge(pg, fb * W, fb);
  const fw = bldProg(q, bldArrive[3], bldInst[3]), fg = bldProg(q, bldArrive[4], bldInst[4]);
  bldWipe(pg, kit.walls, fw * W, H); bldEdge(pg, fw * W, fw);
  bldWipe(pg, kit.glass, fg * W, H); bldEdge(pg, fg * W, fg);
  const fd = bldProg(q, bldArrive[5], bldInst[5]), fx = fd * W, kind = skyKind(sceneHour());
  if (fd >= 1) drawFloorStatic(pg, fl, kind);
  else if (fd > 0) {
    pg.save(); pg.beginPath(); pg.rect(0, 0, Math.round(fx), H); pg.clip();
    drawFloorStatic(pg, fl, kind);
    pg.restore();
    bldEdge(pg, fx, fd);
  }
  if (fd > 0) {   // the furniture the crane hoisted in, behind the edge of the fit-out
    const pcs = bldPieces(kit, fl);
    for (let i = 0; i < pcs.length; i++) if (kit.pth[i] < fx - 4) pcs[i].draw(pg, T);
  }
  // loads waiting to be installed
  for (let k = 0; k < 7; k++) {
    const p = bldProg(q, bldArrive[k], bldInst[k]);
    if (q < bldArrive[k] || p >= 1) continue;
    const sp = bldLoad(k), w = bldLoadW[k], h = bldLoadH[k], rem = Math.max(1, Math.round(h * (1 - p)));
    pg.drawImage(sp, 0, h - rem, w, rem, Math.round(bldSlotX[k] - w / 2), bldSlotY[k] - rem, w, rem);
    const tsa = (q - bldArrive[k]) * BUILD_SECONDS;
    if (tsa > 0 && tsa < 0.5) {
      for (let i = 0; i < 8; i++) if (((i + ((tsa * 10) | 0)) & 1) === 0 || tsa < 0.2) rect(pg, bldSlotX[k] + bldDustX[i] * (3 + tsa * 22), bldSlotY[k] - 3 + bldDustY[i] * (2 + tsa * 10) - tsa * 6, 1, 1, tsa < 0.3 ? 'wallHi' : 'wallMid');
    }
  }
  bldDrawWorkers(pg, T, W);
  const blink = ((T * 2) | 0) % 2;
  bldBeacon(pg, 10, 24, fx, blink); bldBeacon(pg, W - 14, 24, fx, blink); bldBeacon(pg, 12, 326, fx, blink); bldBeacon(pg, W - 16, 326, fx, blink);
  // night: the site is dark, with the pools of its floodlights, the workers, the crane lamp and, once the lamps are in, the small lit places
  const a = nightAlpha(sceneHour());
  if (a > 0) {
    const mg = bldDark.g;
    mg.globalCompositeOperation = 'source-over';
    mg.clearRect(0, 0, W, H);
    mg.globalAlpha = a;
    mg.fillStyle = palColor('ink');
    mg.fillRect(0, 0, W, H);
    mg.globalAlpha = 1;
    if (a > 0.1) {
      mg.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < kit.floods.length; i++) { const f = kit.floods[i]; if (f[0] > fx) mg.drawImage(skyPool(36), Math.round(f[0] - 36), Math.round(f[1] + 4 - 36)); }
      for (let i = 0; i < bldWorkerN; i++) mg.drawImage(skyPool(14), Math.round(bldWxs[i] - 14), Math.round(bldWys[i] - 10 - 14));
      const hk = bldHook(q, W);
      mg.drawImage(skyPool(24), Math.round(hk.gx - 24), Math.round(hk.gy - hk.lz - 8 - 24));
      if (q >= bldArrive[6]) for (let i = 0; i < plan.lights.length; i++) { const l = plan.lights[i]; if (!l.desk) mg.drawImage(skyPool(8), Math.round(l.x - 8), Math.round(l.y - 8)); }
      mg.globalCompositeOperation = 'source-over';
    }
    pg.globalCompositeOperation = 'source-atop';
    pg.drawImage(bldDark.c, 0, 0);
    pg.globalCompositeOperation = 'source-over';
  }
  g.drawImage(bldPlate.c, 0, 0);
}

/* ------------------------------ the crane ------------------------------ */

const bldCraneTone = [
  { jib: 'lamp', jibHi: 'lampHi', mast: 'steel', mastHi: 'steelL', dark: 'steelD' },
  { jib: 'pot', jibHi: 'lamp', mast: 'steelD', mastHi: 'steel', dark: 'night' },
  { jib: 'brick', jibHi: 'pot', mast: 'night', mastHi: 'steelD', dark: 'ink' },
];
const bldMastTiles = [];
const bldMastPats = [null, null, null];
function bldMastTile(t) {
  if (bldMastTiles[t]) return bldMastTiles[t];
  const tn = bldCraneTone[t], b = makeBuffer(8, 8), g = b.g;
  rect(g, 0, 0, 2, 8, tn.mast); rect(g, 6, 0, 2, 8, tn.mast); rect(g, 0, 0, 1, 8, tn.mastHi); rect(g, 7, 0, 1, 8, tn.dark);
  for (let i = 1; i < 7; i++) rect(g, i, i, 1, 1, tn.mast);
  rect(g, 2, 0, 4, 1, tn.dark);
  return (bldMastTiles[t] = b.c);
}

function bldShadow(g, x, y, w) {
  g.fillStyle = palColor('ink');
  for (let r = 0; r < 3; r++) {
    const hw = Math.round((w >> 1) * (r === 1 ? 1 : 0.7));
    for (let i = -hw; i <= hw; i++) if (((i + r) & 1) === 0) g.fillRect(Math.round(x) + i, Math.round(y) + r - 1, 1, 1);
  }
}

/** Tower crane over the floor being built or demolished, in buffer px (it reads floorCam). Draws whenever fl.build is set. */
function drawFloorCrane(g, fl, T) {
  const plan = fl.plan, cam = floorCam;
  if (!plan || !fl.build) return;
  const W = plan.width, n = FLOORS.length, top = fl.index === n - 1;
  const ox = STAIRS_W - cam.x, oy = fl.y + fl.dy - cam.y;
  const jy = oy - (top ? 46 : 8), mastX = ox + W + 36, jx0 = 8 - cam.x, jx1 = mastX + 10;
  const baseW = SKY_H + n * BLOCK + 6, baseY = baseW - cam.y;                 // foot of the mast in the street
  if (jy > cam.bh || baseY < 0 || jx1 < 0 || jx0 > cam.bw) return;
  const a = nightAlpha(sceneHour()), tone = a > 0.45 ? 2 : a > 0.15 ? 1 : 0, tn = bldCraneTone[tone];
  g.setTransform(1, 0, 0, 1, 0, 0);
  // the slab under the plate is drawn by floor.js without the night mask: dim it here
  if (a > 0 && fl.p < 1) { g.globalAlpha = a; g.fillStyle = palColor('ink'); g.fillRect(ox, oy + PLATE_H, W, SLAB); g.globalAlpha = 1; }
  // mast: a lattice pattern anchored on the world, from the jib down to the street
  if (!bldMastPats[tone]) bldMastPats[tone] = g.createPattern(bldMastTile(tone), 'repeat');
  g.setTransform(1, 0, 0, 1, mastX, -cam.y);
  g.fillStyle = bldMastPats[tone];
  g.fillRect(0, jy + cam.y, 8, baseW - (jy + cam.y));
  g.setTransform(1, 0, 0, 1, 0, 0);
  rect(g, mastX - 4, baseY - 2, 16, 4, 'ink'); rect(g, mastX - 3, baseY - 1, 14, 2, tn.dark);
  // jib: bar, lattice, operator cab, counterweight, beacon
  rect(g, jx0, jy, jx1 - jx0, 4, tn.jib); rect(g, jx0, jy, jx1 - jx0, 1, tn.jibHi); rect(g, jx0, jy + 4, jx1 - jx0, 2, tn.dark);
  for (let x = jx0; x < jx1; x += 10) { rect(g, x, jy + 3, 5, 2, tn.dark); rect(g, x + 5, jy + 5, 1, 1, 'ink'); }
  rect(g, mastX - 8, jy - 12, 14, 12, 'ink'); rect(g, mastX - 7, jy - 11, 12, 10, tn.jib); rect(g, mastX - 6, jy - 10, 6, 5, 'glass'); rect(g, mastX - 6, jy - 10, 6, 1, 'glassHi');
  rect(g, mastX + 6, jy - 4, 12, 10, 'ink'); rect(g, mastX + 7, jy - 3, 10, 8, 'concD'); rect(g, mastX + 7, jy - 3, 10, 1, 'conc');
  rect(g, jx0, jy - 2, 2, 2, ((T * 2) | 0) % 2 ? 'red' : 'ink');
  // trolley, rope, hook and load
  const hk = bldHook(fl.p, W), tx = Math.round(ox + hk.gx), ly = oy + hk.gy;
  const lw = hk.load >= 0 ? bldLoadW[hk.load] : 0, lh = hk.load >= 0 ? bldLoadH[hk.load] : 0;
  const ring = Math.max(Math.round(ly - hk.hz - lh - 5), jy + 9);
  if (hk.load >= 0 && hk.lz > 3) bldShadow(g, ox + hk.gx, ly, lw);
  rect(g, tx - 4, jy + 3, 8, 4, tn.dark); rect(g, tx - 3, jy + 3, 6, 1, tn.mastHi);
  rect(g, tx, jy + 7, 1, Math.max(0, ring - (jy + 7)), 'ink');
  rect(g, tx - 2, ring, 5, 3, tn.jib); rect(g, tx - 1, ring + 3, 3, 2, tn.dark);
  if (hk.load >= 0) g.drawImage(bldLoad(hk.load), Math.round(tx - lw / 2), Math.round(ly - hk.lz - lh));
  if (a > 0.2) rect(g, tx - 1, ring - 1, 3, 1, 'lampHi');
}

/* ------------------------------ driving p ------------------------------ */

/** Begins a construction (dir 1) or a demolition (dir -1) of floor fl; a build in the other direction turns round from the current p. */
function startBuild(fl, dir) {
  const d = dir < 0 ? -1 : 1, b = fl.build;
  if (b && b.dir === d) return;
  const p0 = b ? fl.p : d > 0 ? 0 : 1;
  const spent = d > 0 ? p0 : 1 - p0;
  fl.build = { t0: bldTime - spent * BUILD_SECONDS, dir: d };
  fl.p = p0;
  if (d > 0 && fl.plan) bldWarm(fl);
}

/** Advances p of every floor with a build; at the end calls finishFloor (construction) or floorGone (demolition). */
function tickBuild(dt) {
  bldTime += dt;
  for (let i = FLOORS.length - 1; i >= 0; i--) {
    const fl = FLOORS[i], b = fl.build;
    if (!b) continue;
    const e = (bldTime - b.t0) / BUILD_SECONDS;
    if (b.dir > 0) {
      fl.p = e >= 1 ? 1 : e;
      if (e >= 1) { if (fl.plan) bldKits.delete(fl.plan); finishFloor(fl); }
    } else {
      fl.p = e >= 1 ? 0 : 1 - e;
      if (e >= 1) { if (fl.plan) bldKits.delete(fl.plan); floorGone(fl); }
    }
  }
}
