/* web/pixel/floor.js : lot L3, voir docs/vue-pixel.md (2.4)
   The building as a scene: live floors, static decor baked once per (floor, version, sky), furniture, the two towers, the cab, labels.
   Shares one scope with the other web/pixel files: public names are the ones of the 2.4 signatures, every other top-level name wears `flr`.
   Declares only, nothing runs at load.

   Choices recorded here (additions to the 2.4 shapes, all additive):
   - Piece = { x, y, w, h, sy, draw(g, T) }: a drawn object of a floor, plan px. floorFurniture(fl) and floorDrawables(fl) both give the same
     reused array (every piece, wall pieces included: their small `sy` sorts them behind the people).
   - Floor.fx = { micro, coffee, print, board }: seconds left of the moving parts of the equipment (board: progress 0..1). actions.js and talk.js
     set them, tickFloors counts the three timers down.
   - LIFT.x: plan x of the cab centre. LIFT.y: world y of the FEET of a rider when the cab is level with a landing (liftStopY). people.js owns
     y, fl, moving, dir, owner and want; floor.js only eases LIFT.door towards LIFT.want (0 closed, 1 open).
   - floorGone moves floorCam.y by -BLOCK (the floors below move up) and flrTakeShift() hands the sum to nav.js, which adds it to NAV.ty.
   - Persons in the towers and the waiting ones under the veil are drawn with pplDraw(g, p, x, y, T) (people.js); the filter is the boolean pplWaitFilter. */

const FLOORS = [];                               // Floor[], index 0 = ground floor
const floorCam = new Camera();
const LIFT = { y: 0, x: 0, fl: 0, door: 0, want: 0, moving: false, dir: 0, owner: null };

const flrMemoKey = 'bureau.immeuble.etages';
const flrIdleSeconds = 20;                       // a project without a team this long loses its floor
const flrCacheMax = 12;                          // baked floor canvases
const flrLabelMax = 800;

// Service colours (closed palette): wall accent, carpet and carpet lines.
const flrServices = {
  dev: { acc: 'glass', c0: 'carpA', c1: 'carpB' },
  arch: { acc: 'screen', c0: 'steelD', c1: 'night' },
  design: { acc: 'lampHi', c0: 'wallSh', c1: 'base' },
  qa: { acc: 'leafL', c0: 'leafD', c1: 'screenD' },
  prod: { acc: 'pot', c0: 'brick', c1: 'woodD' },
  misc: { acc: 'wallMid', c0: 'night', c1: 'ink' },
};
const flrSky = {
  day: ['glass', 'glassHi', 'white'],
  dawn: ['glass', 'lampHi', 'lamp'],
  dusk: ['carpA', 'pot', 'lamp'],
  night: ['ink', 'night', 'carpB'],
};
const flrBayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/* ------------------------------ small pieces ------------------------------ */

let flrSprites = null;
function flrSpr() {
  if (!flrSprites) {
    flrSprites = {
      plant: bakeRows(['....A..A...A...', '..A.lAAlA.lA...', '.AllAlllAllllA.', '.llllmllllmlll.', 'Allmllllllllll.', '.llllllmlllmlA.', '..lllmlllllll..', '...lllllmlll...', '....mllllll....', '.....lllmm.....', '......pppp.....', '.....pBBBBp....', '.....BBBBBB....', '.....BBBBBB....', '......BBBB.....'],
        { A: 'leafL', l: 'leaf', m: 'leafD', p: 'woodD', B: 'pot' }),
    };
  }
  return flrSprites;
}

function flrCarpet(g, x, y, w, h, c0, c1) {
  rect(g, x, y, w, h, c0);
  for (let i = 0; i < w; i += 16) rect(g, x + i, y, 1, h, c1);
  for (let j = 0; j < h; j += 16) rect(g, x, y + j, w, 1, c1);
  for (let k = 0; k < (w * h) / 80; k++) {
    const hh = hash('cp' + x + '_' + y + '_' + k);
    rect(g, x + (hh % w), y + ((hh >>> 9) % h), 1, 1, hh & 1 ? c1 : 'ink');
  }
  rect(g, x, y, w, 3, c1); rect(g, x, y + 3, w, 1, 'ink'); rect(g, x, y, 3, h, c1);   // shade cast by the walls
}

function flrBrick(g, x0, y0, w, h) {
  for (let y = y0, r = 0; y < y0 + h; y += 8, r++) {
    for (let x = x0 - (r & 1 ? 8 : 0); x < x0 + w; x += 16) {
      const hh = hash('br' + x + '_' + y), c = hh % 3 ? 'woodD' : 'brick';
      const xs = Math.max(x, x0), xe = Math.min(x + 16, x0 + w);
      if (xe > xs) {
        rect(g, xs, y, xe - xs, 8, c); rect(g, xs, y, xe - xs, 1, hh % 4 ? 'wood' : 'woodL'); rect(g, xs, y + 7, xe - xs, 1, 'night');
        if (x >= x0) rect(g, x, y, 1, 8, 'night');
        if (hh % 7 === 0) rect(g, xs + 3, y + 3, 3, 1, 'night');
      }
    }
  }
}

function flrStone(g, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y += 16) {
    for (let x = x0; x < x0 + w; x += 16) {
      const a = (((x - x0) >> 4) + ((y - y0) >> 4)) & 1;
      rect(g, x, y, 16, 16, a ? 'conc' : 'concD'); rect(g, x, y, 16, 1, 'steelL'); rect(g, x, y, 1, 16, 'steelL');
      if (hash('st' + x + y) % 3 === 0) rect(g, x + 5, y + 6, 2, 1, 'steel');
    }
  }
}

function flrVWall(g, x, y, h, cl, cr) { rect(g, x, y, 8, h, 'ink'); rect(g, x + 1, y, 3, h, cl); rect(g, x + 4, y, 3, h, cr); }
function flrHWall(g, x, y, w, c, face) {
  rect(g, x, y, w, 8, 'ink'); rect(g, x + 1, y + 1, w - 2, face ? 3 : 5, c);
  if (face) rect(g, x + 1, y + 4, w - 2, 3, 'night'); else rect(g, x + 1, y + 6, w - 2, 1, 'night');
}
function flrPictoMan(g, x, y, c) { rect(g, x + 2, y, 3, 3, c); rect(g, x + 1, y + 4, 5, 5, c); rect(g, x + 1, y + 9, 2, 3, c); rect(g, x + 4, y + 9, 2, 3, c); }
function flrPictoWoman(g, x, y, c) { rect(g, x + 2, y, 3, 3, c); rect(g, x + 2, y + 3, 3, 2, c); rect(g, x + 1, y + 5, 5, 3, c); rect(g, x, y + 8, 7, 2, c); rect(g, x + 1, y + 10, 2, 2, c); rect(g, x + 4, y + 10, 2, 2, c); }

function flrService(colorKey) { return flrServices[colorKey] || flrServices.misc; }
function flrGeo(plan) {
  const W = plan.width, dx = Math.round((W * 0.4) / 8) * 8;
  return { W, cafeX1: W - 120, dx, lampX: dx + 62, ey: 336, cb: 272 };
}
function flrFurn(plan, kind) { return plan.furniture.filter((f) => f.kind === kind); }

/* ------------------------------ the baked decor ------------------------------ */

function flrPaintFloorLayer(g, plan) {
  const W = plan.width, geo = flrGeo(plan);
  rect(g, 0, 0, W, 352, 'night');
  for (let x = 8; x < W - 8; x += 16) rect(g, x, 16, 1, 248, 'ink');
  for (let y = 16; y < 264; y += 16) rect(g, 8, y, W - 16, 1, 'ink');
  for (let i = 0; i < W * 3; i++) {
    const h = hash('sp' + i + plan.id);
    rect(g, 8 + (h % (W - 16)), 16 + ((h >>> 12) % 248), 1, 1, h & 1 ? 'ink' : 'steelD');
  }
  for (const o of plan.offices) {   // parquet and rug of a chef office
    const x0 = o.rect.x * 8;
    rect(g, x0 + 8, 16, 104, 32, 'parqA');
    for (let x = x0 + 8; x < x0 + 112; x += 8) rect(g, x, 16, 1, 32, 'parqLn');
    for (let y = 16; y < 48; y++) if ((y * 7) % 11 === 0) rect(g, x0 + 8 + ((y * 13) % 96), y, 6, 1, 'parqB');
    rect(g, x0 + 8, 16, 104, 3, 'parqLn');
    rect(g, x0 + 20, 24, 64, 22, 'ink'); rect(g, x0 + 21, 25, 62, 20, 'pot'); rect(g, x0 + 23, 27, 58, 16, 'brick'); rect(g, x0 + 25, 29, 54, 12, 'pot');
    for (let x = x0 + 25; x < x0 + 79; x += 4) rect(g, x, 29, 1, 12, 'brick');
  }
  for (const r of plan.rooms) {
    const sv = flrService(r.colorKey), x = (r.rect.x + 1) * 8, w = (r.rect.w - 1) * 8;
    flrCarpet(g, x, 72, w, 184, sv.c0, sv.c1);
    for (const d of r.desks) rect(g, d.x - 6, d.y - 4, d.w + 12, 20, sv.c1);
  }
  if (plan.open.rect.w > 0) {
    const o = plan.open.rect;
    flrCarpet(g, o.x * 8, o.y * 8, o.w * 8, o.h * 8, 'carpB', 'carpA');
    for (const d of plan.open.desks) rect(g, d.x - 6, d.y - 4, d.w + 12, 20, 'carpA');
  }
  for (const f of flrFurn(plan, 'lounge')) {
    const x = f.x * 8, y = f.y * 8, w = f.w * 8, h = f.h * 8;
    flrCarpet(g, x, y, w, h, 'screenD', 'steelD'); rect(g, x + 2, y + 2, w - 4, 1, 'steelD'); rect(g, x + 2, y + h - 3, w - 4, 1, 'steelD');
  }
  flrBrick(g, 8, 264, geo.cafeX1 - 8, 72);
  flrStone(g, geo.cafeX1, 264, W - 8 - geo.cafeX1, 72);
  for (const x of [0, W - 8]) { flrStone(g, x, 320, 8, 16); rect(g, x, 335, 8, 1, 'concD'); }   // the hall floor goes on through the doorways
  for (const s of flrFurn(plan, 'sofa')) {
    const x = s.x * 8, y = s.y * 8;
    rect(g, x - 6, y + 8, 92, 26, 'ink'); rect(g, x - 5, y + 9, 90, 24, 'carpA');
    for (let k = x - 5; k < x + 85; k += 6) rect(g, k, y + 9, 1, 24, 'carpB');
  }
  for (const t of flrFurn(plan, 'table')) { const x = t.x * 8 + 8; rect(g, x - 8, 312, 40, 16, 'ink'); rect(g, x - 7, 313, 38, 14, 'woodD'); }
}

function flrPaintWindow(g, sk, kind, x, w) {
  rect(g, x - 1, 2, w + 2, 12, 'steelL'); rect(g, x, 3, w, 10, sk[0]); rect(g, x, 8, w, 3, sk[1]); rect(g, x, 11, w, 2, sk[2]);
  for (let i = 0; i < w; i += 5) {
    const bh = 2 + ((i * 7 + x) % 5);
    rect(g, x + i, 13 - bh, 4, bh, kind === 'night' ? 'ink' : 'steel');
    if (kind === 'night' && (i + x) % 3 === 0) rect(g, x + i + 1, 13 - bh + 1, 1, 1, 'lamp');
  }
  rect(g, x + (w >> 1), 3, 1, 10, 'steelL');
}

function flrPaintWallLayer(g, plan, kind) {
  const W = plan.width, geo = flrGeo(plan), sk = flrSky[kind] || flrSky.day, cb = geo.cb;
  // back wall: face, mullions, windows
  rect(g, 0, 0, W, 16, 'steelD'); rect(g, 0, 0, W, 2, 'steel'); rect(g, 0, 14, W, 2, 'ink');
  for (let x = 32; x < W; x += 32) rect(g, x, 2, 1, 12, 'night');
  for (const o of plan.offices) {
    const x0 = o.rect.x * 8;
    flrPaintWindow(g, sk, kind, x0 + 48, 32);
    rect(g, x0 + 8, 1, 32, 14, 'ink'); rect(g, x0 + 9, 2, 30, 12, 'woodD');   // bookcase
    for (let r = 0; r < 2; r++) {
      rect(g, x0 + 9, 2 + r * 6, 30, 1, 'ink');
      for (let k = 0; k < 9; k++) rect(g, x0 + 10 + k * 3, 3 + r * 6, 2, 5, ['red', 'lamp', 'leaf', 'screen', 'steelL', 'pot'][(k + r * 2) % 6]);
    }
  }
  for (const s of plan.spots.window) flrPaintWindow(g, sk, kind, s.x * 8 - 8, 24);
  if (!plan.offices.length) { flrPaintWindow(g, sk, kind, 40, 32); flrPaintWindow(g, sk, kind, 104, 32); }
  const bd = flrFurn(plan, 'board')[0];
  if (bd) { const x = bd.x * 8; rect(g, x - 1, 1, 74, 14, 'steelL'); rect(g, x, 2, 72, 12, 'white'); rect(g, x, 13, 72, 1, 'steel'); }
  // side walls: the doorway of rows 40 and 41 stays open, with a lintel
  for (const x of [0, W - 8]) {
    for (const [y0, y1] of [[0, 320], [336, 352]]) {
      const top = Math.max(y0, 16);
      rect(g, x, y0, 8, y1 - y0, 'ink'); rect(g, x + (x ? 0 : 1), top, 7, y1 - top, 'steelD'); rect(g, x + (x ? 1 : 5), top, 2, y1 - top, 'steel');
    }
    rect(g, x, 316, 8, 4, 'ink'); rect(g, x + 1, 317, 6, 2, 'steelL');
  }
  rect(g, W - 7, 302, 6, 12, 'ink'); rect(g, W - 6, 304, 3, 3, 'lampHi'); rect(g, W - 6, 309, 3, 3, 'steelL'); rect(g, W - 6, 312, 3, 1, 'steel');   // call panel of the lift
  rect(g, 1, 302, 6, 12, 'ink'); rect(g, 2, 304, 4, 8, 'leafD'); rect(g, 3, 305, 2, 5, 'screen'); rect(g, 2, 312, 4, 1, 'leaf');                 // sign of the stairs
  // glass offices
  for (const o of plan.offices) {
    const x0 = o.rect.x * 8, sx = x0 + 128, sy = 32;
    rect(g, x0, 16, 8, 40, 'steelL'); rect(g, x0 + 2, 17, 4, 38, 'glass');
    rect(g, x0 + 112, 16, 8, 16, 'steelL'); rect(g, x0 + 114, 17, 4, 14, 'glass');
    rect(g, x0 + 112, 32, 8, 2, 'steelD'); rect(g, x0 + 112, 46, 8, 2, 'steelD');
    rect(g, x0, 48, 120, 3, 'steelL'); rect(g, x0, 51, 120, 5, 'glass'); rect(g, x0, 51, 120, 1, 'glassHi'); rect(g, x0, 55, 120, 1, 'steel');
    rect(g, sx + 8, sy + 24, 3, 3, 'woodD'); rect(g, sx + 77, sy + 24, 3, 3, 'woodD');
    rect(g, sx, sy, 88, 24, 'ink'); rect(g, sx + 1, sy + 1, 86, 22, 'lamp'); rect(g, sx + 1, sy + 21, 86, 2, 'wood');
  }
  // rooms: walls in the accent of the service, shared walls half and half, header plaque (its text is on the crisp layer)
  const rooms = plan.rooms;
  rooms.forEach((rm, i) => {
    const acc = flrService(rm.colorKey).acc, next = rooms[i + 1] ? flrService(rooms[i + 1].colorKey).acc : acc, prev = i ? flrService(rooms[i - 1].colorKey).acc : acc;
    const x = rm.rect.x * 8, w = (rm.rect.w + 1) * 8, doorX = (rm.door.x - 1) * 8;
    flrHWall(g, x, 64, w, acc, false);
    flrVWall(g, x, 72, 192, prev === acc || !i ? acc : prev, acc); flrVWall(g, x + w - 8, 72, 192, acc, i < rooms.length - 1 ? next : acc);
    flrHWall(g, x, 256, doorX - x, acc, true); flrHWall(g, doorX + 24, 256, x + w - doorX - 24, acc, true);
    rect(g, doorX, 256, 2, 8, 'ink'); rect(g, doorX + 22, 256, 2, 8, 'ink');
    rect(g, rm.header.x, rm.header.y, rm.header.w, 22, 'ink'); rect(g, rm.header.x, rm.header.y, rm.header.w, 2, acc);
  });
  if (plan.open.rect.w > 0) { const o = plan.open.rect, w = Math.min(o.w * 8, 92); rect(g, o.x * 8, 74, w, 13, 'ink'); rect(g, o.x * 8, 74, w, 2, 'steelL'); }
  // cafeteria wall: slate tiles, drawers under the counter, plaque, fixtures (the moving parts are drawn with the furniture)
  const cx1 = geo.cafeX1;
  rect(g, 8, cb, cx1 - 8, 24, 'steelD'); rect(g, 8, cb, cx1 - 8, 2, 'steel'); rect(g, 8, cb + 22, cx1 - 8, 2, 'ink');
  for (let y = cb + 3, r = 0; y < cb + 21; y += 8, r++) {
    for (let x = 8 - (r & 1 ? 8 : 0); x < cx1; x += 16) {
      const xs = Math.max(x, 8), xe = Math.min(x + 16, cx1);
      rect(g, xs, y + 7, xe - xs, 1, 'night'); if (x >= 8) rect(g, x, y, 1, 8, 'night'); rect(g, xs + 1, y, Math.max(0, xe - xs - 2), 1, 'steel');
    }
  }
  rect(g, 50, cb + 14, 128, 3, 'woodL'); rect(g, 50, cb + 14, 128, 1, 'parqA'); rect(g, 50, cb + 17, 128, 7, 'woodD'); rect(g, 50, cb + 23, 128, 1, 'ink');
  for (let x = 52; x < 176; x += 21) { rect(g, x, cb + 18, 19, 5, 'wood'); rect(g, x, cb + 18, 19, 1, 'woodL'); rect(g, x, cb + 22, 19, 1, 'night'); rect(g, x + 8, cb + 19, 4, 1, 'lamp'); rect(g, x + 8, cb + 20, 4, 1, 'woodL'); }
  rect(g, 52, cb + 2, 46, 12, 'ink'); rect(g, 52, cb + 2, 3, 12, 'lamp'); rect(g, 55, cb + 2, 43, 1, 'steel');
  rect(g, 164, cb + 12, 12, 2, 'steelL'); rect(g, 164, cb + 13, 12, 1, 'steel'); rect(g, 168, cb + 6, 2, 6, 'steelL'); rect(g, 168, cb + 6, 5, 1, 'steelL'); rect(g, 166, cb + 9, 3, 2, 'glass');
  rect(g, 117, cb + 10, 4, 4, 'white'); rect(g, 121, cb + 11, 1, 2, 'white'); rect(g, 170, cb + 10, 4, 4, 'lampHi');
  const fr = { x: 24, y: 264 };   // fridge: two doors, handles, magnets, feet
  rect(g, fr.x, fr.y, 20, 32, 'ink'); rect(g, fr.x + 1, fr.y + 1, 18, 30, 'steelL'); rect(g, fr.x + 1, fr.y + 1, 18, 2, 'white'); rect(g, fr.x + 15, fr.y + 1, 4, 30, 'steel'); rect(g, fr.x + 1, fr.y + 11, 18, 1, 'steel'); rect(g, fr.x + 1, fr.y + 12, 18, 1, 'white');
  rect(g, fr.x + 13, fr.y + 4, 2, 5, 'steelD'); rect(g, fr.x + 13, fr.y + 15, 2, 9, 'steelD'); rect(g, fr.x + 4, fr.y + 3, 4, 3, 'lamp'); rect(g, fr.x + 9, fr.y + 5, 3, 3, 'red'); rect(g, fr.x + 5, fr.y + 16, 5, 4, 'glassHi'); rect(g, fr.x, fr.y + 30, 20, 2, 'steelD');
  for (const vx of [208, 240]) {   // vending machines
    const v = { x: vx, y: 264, w: 28, h: 32 };
    rect(g, v.x, v.y, v.w, v.h, 'ink'); rect(g, v.x + 1, v.y + 1, v.w - 2, v.h - 2, 'steelD'); rect(g, v.x + 1, v.y + 1, v.w - 2, 1, 'steel'); rect(g, v.x + 2, v.y + 3, v.w - 12, v.h - 13, 'glassHi'); rect(g, v.x + 3, v.y + 4, v.w - 14, v.h - 15, 'night');
    for (let r = 0; r < 4; r++) {
      rect(g, v.x + 3, v.y + 8 + r * 5, v.w - 14, 1, 'steelD');
      for (let c = 0; c < 3; c++) rect(g, v.x + 4 + c * 4, v.y + 5 + r * 5, 3, 3, ['red', 'lamp', 'leaf', 'glass', 'pot', 'white'][(r * 3 + c + v.x) % 6]);
    }
    rect(g, v.x + v.w - 8, v.y + 4, 5, 10, 'steel'); rect(g, v.x + v.w - 7, v.y + 6, 3, 2, 'screen'); for (let k = 0; k < 3; k++) rect(g, v.x + v.w - 7, v.y + 10 + k * 2, 3, 1, 'steelL');
    rect(g, v.x + 4, v.y + v.h - 7, v.w - 8, 4, 'ink'); rect(g, v.x + 5, v.y + v.h - 6, v.w - 10, 1, 'steelD');
  }
  // hall: wall band and the two toilet doors
  const hx = geo.W - 120;
  rect(g, hx, cb, 112, 24, 'steelD'); rect(g, hx, cb, 112, 2, 'steel'); rect(g, hx, cb + 22, 112, 2, 'ink');
  [flrPictoMan, flrPictoWoman].forEach((fn, k) => {
    const x = geo.W - 112 + k * 40, y = cb - 6;
    rect(g, x - 2, y - 2, 28, 34, 'steelL'); rect(g, x, y, 24, 30, 'ink'); rect(g, x + 1, y + 1, 22, 28, 'woodL'); rect(g, x + 1, y + 1, 22, 2, 'parqA'); rect(g, x + 3, y + 4, 18, 22, 'wood'); rect(g, x + 3, y + 4, 18, 1, 'woodL'); rect(g, x + 3, y + 25, 18, 1, 'woodD');
    rect(g, x + 5, y + 7, 14, 16, 'ink'); rect(g, x + 6, y + 8, 12, 14, 'steelD'); fn(g, x + 8, y + 9, k ? 'lampHi' : 'screen'); rect(g, x + 19, y + 16, 2, 2, 'lamp');
  });
  for (const m of flrFurn(plan, 'meet')) {
    const mx = m.x * 8 + 8, my = 160;   // table of 96 x 24 px with six chairs, papers and a lamp
    for (let k = 0; k < 3; k++) for (const cy of [my - 12, my + 26]) { rect(g, mx + 8 + k * 28, cy, 16, 10, 'steelD'); rect(g, mx + 8 + k * 28, cy + (cy < my ? 0 : 6), 16, 4, 'steel'); }
    rect(g, mx, my, 96, 24, 'ink'); rect(g, mx + 1, my + 1, 94, 19, 'wood'); rect(g, mx + 1, my + 1, 94, 2, 'woodL'); rect(g, mx + 1, my + 20, 94, 3, 'woodD');
    rect(g, mx + 10, my + 6, 12, 7, 'white'); rect(g, mx + 12, my + 8, 8, 1, 'steelL'); rect(g, mx + 44, my + 8, 10, 3, 'lamp'); rect(g, mx + 70, my + 5, 6, 6, 'white'); rect(g, mx + 78, my + 9, 4, 4, 'lampHi');
  }
  for (const o of flrFurn(plan, 'lounge')) {
    const x = o.x * 8, y = o.y * 8, w = o.w * 8, h = o.h * 8, cx = x + (w >> 1);
    const sofa = (yy, up) => {
      rect(g, x + 10, yy, w - 20, 16, 'ink'); rect(g, x + 11, yy + 1, w - 22, 14, 'carpA'); rect(g, x + 11, yy + (up ? 1 : 11), w - 22, 4, 'carpB');
      for (let xx = x + 11; xx < x + w - 11; xx += 18) rect(g, xx, yy + (up ? 5 : 1), 1, 9, 'ink');
      rect(g, x + 8, yy + 1, 4, 14, 'ink'); rect(g, x + 9, yy + 2, 2, 12, 'carpB'); rect(g, x + w - 12, yy + 1, 4, 14, 'ink'); rect(g, x + w - 11, yy + 2, 2, 12, 'carpB');
    };
    sofa(y + 10, true); sofa(y + h - 26, false);
    const ty = y + (h >> 1) - 8;
    rect(g, cx - 18, ty, 36, 16, 'ink'); rect(g, cx - 17, ty + 1, 34, 13, 'woodL'); rect(g, cx - 17, ty + 1, 34, 1, 'parqA'); rect(g, cx - 17, ty + 12, 34, 2, 'woodD'); rect(g, cx - 8, ty + 4, 6, 5, 'white'); rect(g, cx + 4, ty + 5, 5, 4, 'pot'); rect(g, cx + 4, ty + 5, 5, 1, 'lampHi');
    g.drawImage(flrSpr().plant, x + 2, ty); g.drawImage(flrSpr().plant, x + w - 18, ty);
  }
  for (const o of flrFurn(plan, 'recep')) {
    const x = o.x * 8, y = o.y * 8;
    rect(g, x - 2, y - 2, 108, 24, 'ink'); rect(g, x, y, 104, 18, 'wood'); rect(g, x, y, 104, 2, 'woodL'); rect(g, x, y + 11, 104, 7, 'woodD'); rect(g, x, y + 11, 104, 1, 'wood');
    rect(g, x + 58, y + 2, 16, 8, 'ink'); rect(g, x + 59, y + 3, 14, 6, 'steel'); rect(g, x + 59, y + 3, 14, 1, 'steelL'); rect(g, x + 12, y + 3, 12, 6, 'white'); rect(g, x + 14, y + 5, 8, 1, 'steelL'); rect(g, x + 34, y + 4, 4, 4, 'white'); rect(g, x + 38, y + 5, 1, 2, 'white'); rect(g, x + 86, y + 3, 10, 5, 'lamp'); rect(g, x + 86, y + 3, 10, 1, 'lampHi');
  }
  // tables with two chairs, cups and napkins; bench in the hall
  for (const tf of flrFurn(plan, 'table')) {
    const tx = tf.x * 8 + 8, ty = 308;
    for (const cx of [tx - 8, tx + 26]) { rect(g, cx, ty + 1, 6, 11, 'ink'); rect(g, cx + 1, ty + 2, 4, 9, 'steelD'); rect(g, cx + 1, ty + 2, 4, 2, 'steel'); rect(g, cx + 1, ty + 9, 4, 2, 'night'); }
    rect(g, tx, ty, 24, 12, 'ink'); rect(g, tx + 1, ty + 1, 22, 8, 'wood'); rect(g, tx + 1, ty + 1, 22, 1, 'woodL'); rect(g, tx + 1, ty + 9, 22, 2, 'woodD'); rect(g, tx + 3, ty + 10, 2, 2, 'ink'); rect(g, tx + 19, ty + 10, 2, 2, 'ink');
    rect(g, tx + 5, ty + 3, 4, 4, 'white'); rect(g, tx + 9, ty + 4, 1, 2, 'white'); rect(g, tx + 14, ty + 3, 5, 3, 'lampHi'); rect(g, tx + 13, ty + 6, 4, 2, 'red');
  }
  const bx = geo.W - 112;
  rect(g, bx, 322, 32, 3, 'woodL'); rect(g, bx, 325, 32, 5, 'woodD'); rect(g, bx + 1, 330, 3, 2, 'ink'); rect(g, bx + 29, 330, 3, 2, 'ink'); rect(g, bx, 322, 32, 1, 'parqA');
  // entrance strip: slate wall; glass door with a step on the ground floor, a big window above; floor lamp; ashtray
  const ey = geo.ey, dx = geo.dx;
  rect(g, 8, ey, geo.W - 16, 16, 'steelD'); rect(g, 8, ey, geo.W - 16, 3, 'steel'); rect(g, 8, ey + 3, geo.W - 16, 1, 'ink');
  for (let x = 8; x < geo.W - 8; x += 16) rect(g, x, ey + 4, 1, 8, 'night');
  rect(g, 8, ey + 12, geo.W - 16, 4, 'ink'); rect(g, 8, ey + 12, geo.W - 16, 1, 'steel');
  if (plan.id === '') {
    rect(g, dx - 2, ey - 6, 36, 22, 'steelL'); rect(g, dx - 2, ey - 6, 36, 1, 'white'); rect(g, dx, ey - 4, 32, 20, 'ink'); rect(g, dx - 4, ey + 14, 40, 2, 'woodL');
    rect(g, dx - 52, ey + 2, 42, 11, 'ink'); rect(g, dx - 52, ey + 2, 3, 11, 'screen'); rect(g, dx - 49, ey + 2, 39, 1, 'steel');   // plaque
  } else {
    rect(g, dx - 2, ey, 36, 16, 'steelL'); rect(g, dx, ey + 2, 32, 12, 'ink');
    for (const wx of [dx + 2, dx + 17]) { rect(g, wx, ey + 3, 13, 10, sk[0]); rect(g, wx, ey + 8, 13, 3, sk[1]); rect(g, wx, ey + 11, 13, 2, sk[2]); rect(g, wx, ey + 3, 13, 1, 'glassHi'); rect(g, wx + 6, ey + 3, 1, 10, 'steelL'); }
  }
  const lx = geo.lampX;
  rect(g, lx - 5, ey - 26, 11, 6, 'lamp'); rect(g, lx - 5, ey - 26, 11, 1, 'lampHi'); rect(g, lx - 4, ey - 20, 9, 1, 'wood'); rect(g, lx, ey - 19, 2, 30, 'steel'); rect(g, lx + 1, ey - 19, 1, 30, 'steelD'); rect(g, lx - 5, ey + 10, 12, 3, 'steelD'); rect(g, lx - 5, ey + 10, 12, 1, 'steel');
  rect(g, dx - 20, 326, 5, 8, 'steelD'); rect(g, dx - 19, 326, 3, 2, 'steel'); rect(g, dx - 18, 334, 1, 3, 'steel');
}

function flrPaintSlab(g, W, y0) {
  rect(g, 0, y0, W, 16, 'steelD');
  rect(g, 0, y0, W, 1, 'ink'); rect(g, 0, y0 + 1, W, 1, 'steelL'); rect(g, 0, y0 + 2, W, 6, 'conc');
  for (let k = 0; k < (W * 6) / 30; k++) { const h = hash('sl' + W + '_' + k); rect(g, h % W, y0 + 2 + ((h >>> 10) % 6), 1, 1, h & 1 ? 'concD' : 'steelL'); }
  for (const yy of [y0 + 4, y0 + 6]) for (let x = yy & 3; x < W; x += 7) rect(g, x, yy, 3, 1, 'steel');
  for (let x = 62; x < W; x += 124) rect(g, x, y0 + 2, 1, 6, 'concD');
  rect(g, 0, y0 + 8, W, 1, 'concD'); rect(g, 0, y0 + 9, W, 1, 'steelD');
  const dens = [1, 0.75, 0.5, 0.5, 0.25, 0.125];   // dithered shadow under the slab
  g.fillStyle = palColor('ink');
  for (let y = 0; y < dens.length; y++) {
    const t = dens[y] * 16;
    for (let x = 0; x < W; x++) if (flrBayer[(y & 3) * 4 + (x & 3)] < t) g.fillRect(x, y0 + 10 + y, 1, 1);
  }
  rect(g, 0, y0 + 15, W, 1, 'ink');
}

/** Shadow cast on a plate by the slab of the floor above: ordered dither, dense under the slab and fading out. */
function flrPaintShadow(g, W) {
  const dens = [1, 1, 0.75, 0.75, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.125, 0.125, 0.0625, 0.0625];
  g.fillStyle = palColor('ink');
  for (let y = 0; y < dens.length; y++) {
    const t = dens[y] * 16;
    for (let x = 8; x < W - 8; x++) if (flrBayer[(y & 3) * 4 + (x & 3)] < t) g.fillRect(x, 16 + y, 1, 1);
  }
}

/* cache of baked floors: at most flrCacheMax canvases, the least recently used one goes first */
const flrCache = [];
let flrUse = 0;
function flrStatic(fl, kind) {
  let hit = null;
  for (const e of flrCache) if (e.fl === fl && e.kind === kind) { hit = e; break; }
  if (hit && hit.ver === fl.ver && hit.above === fl.hasAbove) { hit.used = ++flrUse; return hit.c; }
  const W = fl.plan.width;
  const b = hit ? hit.buf : makeBuffer(W, BLOCK);
  if (hit && (b.c.width !== W)) { b.c.width = W; b.g.imageSmoothingEnabled = false; }
  b.g.clearRect(0, 0, W, BLOCK);
  flrPaintFloorLayer(b.g, fl.plan);
  flrPaintWallLayer(b.g, fl.plan, kind);
  flrPaintSlab(b.g, W, PLATE_H);
  if (fl.hasAbove) flrPaintShadow(b.g, W);
  if (hit) { hit.ver = fl.ver; hit.above = fl.hasAbove; hit.used = ++flrUse; hit.buf = b; return b.c; }
  if (flrCache.length >= flrCacheMax) {
    let old = 0;
    for (let i = 1; i < flrCache.length; i++) if (flrCache[i].used < flrCache[old].used) old = i;
    flrCache.splice(old, 1);
  }
  flrCache.push({ fl, kind, ver: fl.ver, above: fl.hasAbove, c: b.c, buf: b, used: ++flrUse });
  return b.c;
}

/** The decor bitmap of the plate and its slab (width x BLOCK), baked per (floor, version, sky); the caller has moved the origin to the plate. */
function drawFloorStatic(g, fl, kind) {
  g.drawImage(flrStatic(fl, kind), 0, 0);
}

/* ------------------------------ towers ------------------------------ */

let flrTowerCache = null;   // { n, w, L, R }

function flrFlight(g, xs, ys, xe, ye) {
  const n = 10, run = Math.abs(xe - xs), dir = xe > xs ? 1 : -1, dy = (ye - ys) / n, tw = Math.ceil(run / n) + 1;
  for (let i = 0; i <= run; i++) {
    const x = xs + dir * i, y = Math.round(ys + ((ye - ys) * i) / run);
    rect(g, x, y + 2, 1, 3, 'steelD'); rect(g, x, y + 4, 1, 1, 'ink'); rect(g, x, y - 15, 1, 1, 'steel');
    if (i % 10 === 0) rect(g, x, y - 14, 1, 12, 'steelD');
  }
  for (let s = 0; s < n; s++) {
    const x = Math.round(xs + (dir * run * s) / n), y = Math.round(ys + dy * (s + 0.5)), xl = dir > 0 ? x : x - tw + 1;
    rect(g, xl, y, tw, 1, 'steelL'); rect(g, xl, y + 1, tw, 1, 'steel');
  }
}

function flrLedge(g, x, y, w, label) {
  rect(g, x, y, w, 32, 'ink'); rect(g, x + 1, y + 1, w - 2, 30, 'conc'); rect(g, x + 1, y + 1, w - 2, 2, 'steelL'); rect(g, x + 1, y + 3, w - 2, 1, 'steel');
  rect(g, x + 1, y + 26, w - 2, 3, 'concD'); rect(g, x + 1, y + 29, w - 2, 2, 'steelD');
  if (label && textWidth(label) <= w - 2) { rect(g, x + 1, y + 8, w - 2, 13, 'ink'); drawText(g, label, x + 1 + ((w - 2 - textWidth(label)) >> 1), y + 8, 'lampHi'); }
}

function flrTowers() {
  const n = FLOORS.length;
  const w = n ? FLOORS[0].plan.width : COLS_MIN * 8;
  if (flrTowerCache && flrTowerCache.n === n && flrTowerCache.w === w) return flrTowerCache;
  const H = buildingSize(n, 0).h;
  const left = makeBuffer(STAIRS_W, H), right = makeBuffer(LIFT_W, H);
  const lg = left.g, rg = right.g;
  rect(lg, 0, 0, STAIRS_W, H, 'ink'); rect(rg, 0, 0, LIFT_W, H, 'ink');
  for (let i = 0; i < n; i++) {
    const y0 = floorTop(i, n), lbl = i ? String(i) : 'R';
    rect(lg, 0, y0, 8, BLOCK, 'ink'); rect(lg, 1, y0, 7, BLOCK, 'steelD'); rect(lg, 5, y0, 2, BLOCK, 'steel');
    rect(rg, 36, y0, 8, BLOCK, 'ink'); rect(rg, 36, y0, 7, BLOCK, 'steelD'); rect(rg, 37, y0, 2, BLOCK, 'steel');
    rect(lg, 8, y0, STAIRS_W - 8, BLOCK, 'night'); rect(rg, 0, y0, 36, BLOCK, 'night');
    for (let x = 20; x < STAIRS_W; x += 12) rect(lg, x, y0, 1, BLOCK, 'ink');
    for (let x = 12; x < 36; x += 12) rect(rg, x, y0, 1, BLOCK, 'ink');
    for (let k = 0; k < 260; k++) {
      const h = hash('tw' + i + '_' + k);
      rect(lg, 8 + (h % (STAIRS_W - 8)), y0 + ((h >>> 8) % BLOCK), 1, 1, h & 1 ? 'ink' : 'steelD');
      rect(rg, h % 36, y0 + ((h >>> 14) % BLOCK), 1, 1, h & 1 ? 'ink' : 'steelD');
    }
    flrLedge(lg, STAIRS_W - 12, y0 + 336, 12, lbl);   // stair landing
    rect(rg, 0, y0 + 336, 5, 32, 'ink'); rect(rg, 1, y0 + 337, 3, 30, 'conc'); rect(rg, 1, y0 + 337, 3, 2, 'steelL'); rect(rg, 1, y0 + 362, 3, 5, 'concD');   // lift sill
    for (const x of [3, 32]) {   // guide rails with brackets
      rect(rg, x, y0, 2, 334, 'steelD'); rect(rg, x, y0, 1, 334, 'steel');
      for (let y = y0 + 10; y < y0 + 334; y += 40) rect(rg, x - 1, y, 4, 2, 'steelL');
    }
    rect(rg, 7, y0 + 284, 16, 10, 'ink'); rect(rg, 8, y0 + 285, 14, 8, 'steelD'); drawText(rg, lbl, 15 - (textWidth(lbl) >> 1), y0 + 282, 'lampHi');
  }
  for (let i = 0; i < n - 1; i++) {   // flights: ten per floor, alternating, from landing i to landing i + 1
    const pts = stairPoints(i, n);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      flrFlight(lg, STAIRS_W + a[0], a[1], STAIRS_W + b[0], b[1]);
      const px = STAIRS_W + b[0], last = k === pts.length - 1;
      rect(lg, px - (b[0] < -20 ? 3 : 0), b[1] + 3, last ? 0 : 6, 3, 'conc'); rect(lg, px - (b[0] < -20 ? 3 : 0), b[1] + 3, last ? 0 : 6, 1, 'steelL');
    }
  }
  if (n) {   // pulley at the top of the lift shaft
    const py = floorTop(n - 1, n) + 14;
    rect(rg, 8, py - 4, 20, 3, 'steelD'); rect(rg, 13, py - 1, 10, 10, 'steel'); rect(rg, 14, py, 8, 8, 'steelD'); rect(rg, 17, py + 3, 2, 2, 'steelL');
  }
  flrTowerCache = { n, w, L: left.c, R: right.c };
  return flrTowerCache;
}

function flrDrawTowers(g, cam, T) {
  const n = FLOORS.length;
  if (!n) return;
  const tw = flrTowers(), H = buildingSize(n, 0).h, plateW = FLOORS[0].plan.width, rx = STAIRS_W + plateW;
  const sy0 = Math.max(0, cam.y), sy1 = Math.min(H, cam.y + cam.bh);
  if (sy1 <= sy0) return;
  g.drawImage(tw.L, 0, sy0, STAIRS_W, sy1 - sy0, -cam.x, sy0 - cam.y, STAIRS_W, sy1 - sy0);
  g.drawImage(tw.R, 0, sy0, LIFT_W, sy1 - sy0, rx - cam.x, sy0 - cam.y, LIFT_W, sy1 - sy0);
  // cab: cables, closed landing doors, roof, back wall, rail, floor, door leaf; the riders stand inside
  const X = (v) => Math.round(v - cam.x), Y = (v) => Math.round(v - cam.y), lx = rx;
  const top = floorTop(n - 1, n) + 24, cabTop = LIFT.y - 33;
  rect(g, X(lx + 17), Y(top), 1, Math.round(cabTop - top), 'steelD'); rect(g, X(lx + 19), Y(top), 1, Math.round(cabTop - top), 'steelD');
  for (let i = 0; i < n; i++) {
    const stop = liftStopY(i);
    if (stop + 1 < cam.y || stop - 60 > cam.y + cam.bh) continue;
    const open = LIFT.fl === i && !LIFT.moving ? LIFT.door : 0, h = Math.round((1 - open) * 34);
    if (h > 0) { rect(g, X(lx), Y(stop - 33), 3, h, 'steelL'); rect(g, X(lx), Y(stop - 33), 1, h, 'white'); rect(g, X(lx + 2), Y(stop - 33), 1, h, 'steelD'); }
    const lit = LIFT.fl === i && !LIFT.moving && LIFT.door > 0.5;
    rect(g, X(lx + 22), Y(stop - 49), 3, 3, lit ? 'lampHi' : 'steelD'); rect(g, X(lx + 26), Y(stop - 49), 3, 3, LIFT.moving && LIFT.dir < 0 ? 'lamp' : 'steelD');
  }
  const cx0 = X(lx + 5), cy0 = Y(cabTop);
  rect(g, cx0 - 1, cy0 - 1, 28, 36, 'ink'); rect(g, cx0, cy0, 26, 34, 'steelL'); rect(g, cx0, cy0, 26, 3, 'steel'); rect(g, cx0 + 1, cy0 + 3, 24, 28, 'steelD'); rect(g, cx0 + 1, cy0 + 3, 24, 2, 'lampHi');
  for (let x = cx0 + 8; x < cx0 + 25; x += 8) rect(g, x, cy0 + 6, 1, 25, 'steel');
  rect(g, cx0 + 2, cy0 + 20, 22, 1, 'steelL'); rect(g, cx0, cy0 + 31, 26, 3, 'woodD'); rect(g, cx0, cy0 + 31, 26, 1, 'wood');
  const riders = peopleInTowers();
  for (const p of riders) if (p.tz === 'lift' && p.wy > LIFT.y - 40 && p.wy < LIFT.y + 3) pplDraw(g, p, STAIRS_W + p.wx - cam.x, p.wy - cam.y, T);
  const dh = Math.round((1 - LIFT.door) * 31);
  if (dh > 0) { rect(g, cx0, cy0 + 3, 5, dh, 'steel'); rect(g, cx0, cy0 + 3, 1, dh, 'steelL'); rect(g, cx0 + 4, cy0 + 3, 1, dh, 'steelD'); }
  rect(g, cx0 + 24, cy0 + 3, 2, 28, 'ink');
  for (const p of riders) if (p.tz === 'stairs') pplDraw(g, p, STAIRS_W + p.wx - cam.x, p.wy - cam.y, T);
  const a = nightAlpha(sceneHour());   // night dims the towers like the floors
  if (a > 0) {
    g.globalAlpha = a; g.fillStyle = palColor('ink');
    g.fillRect(-cam.x, sy0 - cam.y, STAIRS_W, sy1 - sy0); g.fillRect(rx - cam.x, sy0 - cam.y, LIFT_W, sy1 - sy0);
    g.globalAlpha = 1;
  }
}

/* ------------------------------ furniture pieces ------------------------------ */

function flrChair(g, px, y) {
  rect(g, px - 8, y - 15, 16, 8, 'ink'); rect(g, px - 7, y - 14, 14, 6, 'steelD'); rect(g, px - 7, y - 14, 14, 1, 'steel'); rect(g, px - 7, y - 9, 14, 1, 'night');
  rect(g, px - 9, y - 10, 2, 6, 'ink'); rect(g, px + 7, y - 10, 2, 6, 'ink'); rect(g, px - 9, y - 10, 1, 1, 'steel'); rect(g, px + 8, y - 10, 1, 1, 'steel');
}

/** Desk seen from the front: the monitor shows its BACK to the viewer, the screen light falls on the face of the person behind it. */
function flrDrawDesk(g, fl, d, T) {
  const x = d.x, y = d.y, w = d.w;
  const occ = d.ownerId ? personById(d.ownerId) : null;
  const on = !!(occ && occ.seated && occ.present && occ.visible);
  const st = on && occ.info ? occ.info.state : null;
  rect(g, x + 3, y + 12, w, 2, 'ink');                                                              // shadow on the floor
  rect(g, x, y, w, 8, 'wood'); rect(g, x, y, w, 1, 'woodL'); rect(g, x, y + 1, w, 1, 'parqA'); rect(g, x + w - 1, y, 1, 8, 'woodD');
  for (let k = 0; k < 5; k++) { const hh = hash('gr' + x + y + k); rect(g, x + 2 + (hh % (w - 12)), y + 2 + ((hh >>> 8) % 5), 6 + (hh % 5), 1, 'woodL'); }   // grain
  rect(g, x, y + 8, w, 4, 'woodD'); rect(g, x, y + 8, w, 1, 'wood'); rect(g, x + 1, y + 11, w - 2, 1, 'ink');                  // front panel
  rect(g, x + 3, y + 9, 14, 3, 'wood'); rect(g, x + 3, y + 9, 14, 1, 'woodL'); rect(g, x + 9, y + 10, 3, 1, 'lamp');
  rect(g, x + w - 17, y + 9, 14, 3, 'wood'); rect(g, x + w - 17, y + 9, 14, 1, 'woodL'); rect(g, x + w - 11, y + 10, 3, 1, 'lamp');
  const cx = x + w / 2;
  let sc = null;
  if (on) { if (st === 'running') sc = 'screen'; else if (st === 'waiting') sc = ((T * 2) | 0) % 2 ? 'lampHi' : 'lamp'; else if (st === 'error') sc = 'red'; }
  rect(g, x + 3, y + 2, 6, 5, 'white'); rect(g, x + 3, y + 2, 6, 1, 'steelL'); rect(g, x + 4, y + 4, 4, 1, 'steel'); rect(g, x + 5, y + 6, 4, 1, 'steelL');   // papers
  rect(g, x + w - 12, y + 3, 3, 2, 'ink'); rect(g, x + w - 12, y + 3, 3, 1, 'steel');                                                             // mouse
  rect(g, x + 11, y + 3, 4, 4, 'white'); rect(g, x + 15, y + 4, 1, 2, 'white'); rect(g, x + 11, y + 3, 4, 1, 'steelL');                           // mug
  if (on && st === 'running' && ((T * 3) | 0) % 2) rect(g, x + 12, y + 1, 1, 1, 'white');
  if (d.lamp) { rect(g, x + w - 8, y + 3, 3, 1, 'steelD'); rect(g, x + w - 7, y, 1, 3, 'steelD'); rect(g, x + w - 9, y - 1, 5, 2, fl.lampsOn && on ? 'lampHi' : 'steelL'); }
  rect(g, cx - 9, y - 3, 18, 9, 'ink'); rect(g, cx - 8, y - 2, 16, 7, 'steel'); rect(g, cx - 8, y - 2, 16, 1, 'steelL'); rect(g, cx + 7, y - 2, 1, 7, 'steelD'); rect(g, cx - 8, y + 4, 16, 1, 'steelD');
  rect(g, cx - 1, y, 3, 3, 'steelL'); rect(g, cx, y + 1, 1, 1, 'steelD'); rect(g, cx + 3, y - 1, 4, 1, 'steelD');                                  // back of the monitor: vent, foot
  rect(g, cx - 6, y + 6, 12, 1, 'steelL'); rect(g, cx - 6, y + 7, 12, 1, 'ink');
  if (sc) {
    rect(g, cx - 8, y - 4, 16, 1, sc); rect(g, cx + 6, y + 3, 1, 1, 'screen');
    const fy = y + 4;   // light of the screen on the face of the person behind it
    for (const dx of [-3, 2]) for (const dy of [-11, -9]) rect(g, cx + dx, fy + dy, 1, 1, sc);
    rect(g, cx - 1, fy - 7, 1, 1, sc); rect(g, cx + 1, fy - 7, 1, 1, sc);
  }
  if (on && occ.pose === 'type' && st === 'running') {
    const k = ((T * 9) | 0) % 2;
    rect(g, cx - 12, y - 1 + k, 2, 2, occ.look.skin); rect(g, cx + 10, y - k, 2, 2, occ.look.skin);   // hands over the edge of the monitor
  }
}

function flrBoardDraw(g, x, y, p) {
  const c = 'steelD';
  rect(g, x + 4, y + 3, Math.round(Math.min(1, p * 4) * 14), 1, c);
  if (p > 0.25) { rect(g, x + 4, y + 5, 12, 7, c); rect(g, x + 5, y + 6, 10, 5, 'white'); }
  if (p > 0.45) { const n = Math.round(Math.min(1, (p - 0.45) * 4) * 14); for (let i = 0; i < n; i++) rect(g, x + 18 + i, y + 8, 1, 1, 'red'); }
  if (p > 0.55) { rect(g, x + 36, y + 5, 12, 7, c); rect(g, x + 37, y + 6, 10, 5, 'white'); }
  if (p > 0.75) rect(g, x + 52, y + 6, Math.round(Math.min(1, (p - 0.75) * 4) * 14), 1, 'steel');
}

function flrPiece(list, sy, x, y, w, h, draw) { list.push({ x, y, w, h, sy, draw }); }

function flrBuildPieces(fl) {
  const plan = fl.plan, list = [];
  const geo = flrGeo(plan);
  for (const d of plan.desks) {
    d.lamp = d.where.indexOf('office:') === 0 || d.id.endsWith('#0') || hash('lamp' + d.id) % 2 === 0;
    flrPiece(list, d.y + 12, d.x, d.y - 6, d.w, 42, (g, T) => flrDrawDesk(g, fl, d, T));
    flrPiece(list, d.y + 2, d.x + 12, d.y - 15, 16, 16, (g) => flrChair(g, Math.round(d.x + d.w / 2), d.y));
  }
  for (const f of flrFurn(plan, 'plant')) {
    const x = f.x * 8, y = f.y * 8;
    flrPiece(list, y + 8, x, y - 7, 16, 15, (g) => g.drawImage(flrSpr().plant, x, y - 7));
  }
  for (const f of flrFurn(plan, 'printer')) {
    const px = f.x * 8;
    flrPiece(list, 24, px, 12, 24, 22, (g) => {
      const y = 12;
      rect(g, px, y + 8, 24, 14, 'steelL'); rect(g, px, y + 8, 24, 2, 'white'); rect(g, px + 2, y + 10, 20, 8, 'steel'); rect(g, px + 4, y + 3, 16, 6, 'steelD'); rect(g, px + 17, y + 12, 3, 2, 'screen');
      const p = fl.fx.print;
      if (p > 0) { const o = Math.min(1, p / 2); rect(g, px + 6, y + 14, 12, Math.round(2 + o * 7), 'white'); rect(g, px + 6, y + 14 + Math.round(2 + o * 7), 12, 1, 'steelL'); } else rect(g, px + 5, y + 15, 14, 2, 'white');
    });
  }
  for (const f of flrFurn(plan, 'board')) flrPiece(list, 4, f.x * 8, 2, 72, 12, (g) => { if (fl.fx.board > 0) flrBoardDraw(g, f.x * 8, 2, fl.fx.board); });
  for (const f of flrFurn(plan, 'clock')) {
    const x = f.x * 8 + 4;
    flrPiece(list, 3, x, 3, 11, 11, (g) => {
      const hr = sceneHour(), h = hr % 12, m = (hr % 1) * 60;
      rect(g, x, 3, 11, 11, 'ink'); rect(g, x + 1, 4, 9, 9, 'white'); rect(g, x + 5, 8, 1, 1, 'ink');
      const hx = Math.round(Math.sin((h / 12) * Math.PI * 2) * 2), hy = Math.round(-Math.cos((h / 12) * Math.PI * 2) * 2);
      const mx = Math.round(Math.sin((m / 60) * Math.PI * 2) * 3), my = Math.round(-Math.cos((m / 60) * Math.PI * 2) * 3);
      rect(g, x + 5 + hx, 8 + hy, 1, 1, 'ink'); rect(g, x + 5 + mx, 8 + my, 1, 1, 'steelD'); rect(g, x + 5 + (mx >> 1), 8 + (my >> 1), 1, 1, 'steelD');
    });
  }
  for (const s of flrFurn(plan, 'sofa')) {   // sofa: the back first, seat and arms after the people sitting on it
    const x = s.x * 8, y = s.y * 8;
    flrPiece(list, y + 6, x - 2, y, 84, 10, (g) => {
      rect(g, x - 2, y, 84, 10, 'ink'); rect(g, x, y + 1, 80, 8, 'carpA'); rect(g, x, y + 1, 80, 1, 'steel');
      for (let k = 0; k < 4; k++) { rect(g, x + 1 + k * 19, y + 2, 18, 7, 'carpB'); rect(g, x + 1 + k * 19, y + 2, 18, 1, 'carpA'); }
    });
    flrPiece(list, y + 18, x - 3, y + 5, 86, 15, (g) => {
      rect(g, x - 3, y + 8, 86, 10, 'ink'); rect(g, x - 2, y + 9, 84, 8, 'carpA'); rect(g, x - 2, y + 9, 84, 1, 'steel');
      for (let k = 1; k < 4; k++) rect(g, x + k * 19, y + 10, 1, 6, 'ink');
      rect(g, x - 3, y + 5, 5, 13, 'ink'); rect(g, x - 2, y + 6, 3, 11, 'carpB'); rect(g, x + 78, y + 5, 5, 13, 'ink'); rect(g, x + 79, y + 6, 3, 11, 'carpB');
      rect(g, x + 2, y + 18, 3, 2, 'ink'); rect(g, x + 75, y + 18, 3, 2, 'ink');
    });
  }
  // wall equipment with a moving part: microwave light, coffee drip, cooler bubbles
  flrPiece(list, geo.cb + 1, 116, 264, 90, 32, (g, T) => {
    const mx = 122, my = 274, cx = 144, cy = 265, wx = 186, wy = 266;
    rect(g, mx, my, 18, 12, 'ink'); rect(g, mx + 1, my + 1, 12, 10, fl.fx.micro > 0 ? 'lampHi' : 'steelD'); rect(g, mx + 14, my + 2, 2, 2, 'screen'); rect(g, mx + 14, my + 6, 2, 4, 'steel');
    rect(g, cx, cy, 18, 22, 'ink'); rect(g, cx + 1, cy + 1, 16, 20, 'steelD'); rect(g, cx + 2, cy + 2, 14, 4, 'red'); rect(g, cx + 6, cy + 9, 6, 8, 'ink'); rect(g, cx + 3, cy + 20, 12, 2, 'steelL');
    if (fl.fx.coffee > 0) rect(g, cx + 8, cy + 9, 2, Math.min(8, Math.round(fl.fx.coffee * 2.4)), 'woodD');
    rect(g, wx + 1, wy + 14, 10, 16, 'steelL'); rect(g, wx + 1, wy + 14, 10, 2, 'white'); rect(g, wx + 4, wy + 24, 2, 2, 'steelD'); rect(g, wx + 7, wy + 24, 2, 2, 'red');
    rect(g, wx + 1, wy, 10, 16, 'glass'); rect(g, wx + 2, wy + 1, 8, 6, 'glassHi'); rect(g, wx, wy, 12, 1, 'steelL');
    const bb = Math.floor(T * 4) % 6;
    rect(g, wx + 4 + (bb % 3) * 2, wy + 3 + ((5 - bb) % 5) * 2, 1, 1, 'white');
  });
  // call lamp of the lift on the right wall: lit while the cab waits at this floor
  flrPiece(list, geo.cb + 1, geo.W - 8, 302, 8, 12, (g, T) => {
    rect(g, geo.W - 6, 304, 3, 3, LIFT.fl === fl.index && !LIFT.moving ? 'lampHi' : LIFT.moving && ((T * 3) | 0) % 2 ? 'lamp' : 'steelD');
  });
  return list;
}

function floorFurniture(fl) {
  if (!fl.pieces || fl.piecesVer !== fl.ver) { fl.pieces = flrBuildPieces(fl); fl.piecesVer = fl.ver; }
  return fl.pieces;
}
function floorDrawables(fl) { return floorFurniture(fl); }

/* ------------------------------ doors ------------------------------ */

function openDoor(fl, name, seconds) {
  if (name !== 'entry' && name !== 'glass') return;
  if (seconds > fl.doorT[name]) fl.doorT[name] = seconds;
}

function flrDrawDoors(g, fl) {
  const plan = fl.plan, geo = flrGeo(plan);
  if (plan.id === '') {   // glass door of the ground floor: two leaves that slide apart
    const v = fl.doors.entry, ey = geo.ey, dx = geo.dx, slide = Math.round(v * 11);
    rect(g, dx + 2 - slide, ey - 2, 13, 16, 'glass'); rect(g, dx + 17 + slide, ey - 2, 13, 16, 'glass');
    rect(g, dx + 2 - slide, ey - 2, 13, 2, 'glassHi'); rect(g, dx + 17 + slide, ey - 2, 13, 2, 'glassHi');
    rect(g, dx + 5 - slide, ey + 3, 1, 6, 'glassHi'); rect(g, dx + 20 + slide, ey + 3, 1, 6, 'glassHi');
    rect(g, dx + 14 - slide, ey + 4, 1, 6, 'white'); rect(g, dx + 17 + slide, ey + 4, 1, 6, 'white');
    rect(g, dx, ey - 4, 2, 20, 'ink'); rect(g, dx + 30, ey - 4, 2, 20, 'ink');
  }
  const v = fl.doors.glass;
  for (const o of plan.offices) {   // leaf of the glass door of an office: shut across the gap, swung into the room when open
    const x0 = o.rect.x * 8;
    if (v < 0.5) { rect(g, x0 + 114, 34, 2, 12, 'woodD'); rect(g, x0 + 114, 34, 1, 12, 'wood'); } else { rect(g, x0 + 104, 34, 10, 2, 'woodD'); rect(g, x0 + 104, 34, 10, 1, 'wood'); }
  }
}

/* ------------------------------ building state ------------------------------ */

const flrNoPlan = { cols: 0, width: COLS_MIN * 8 };
let flrPendingShift = 0;

function flrLoadMemo() {
  try { const v = JSON.parse(localStorage.getItem(flrMemoKey)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}
function flrSaveMemo(order) {
  try { if (localStorage.getItem(flrMemoKey) !== JSON.stringify(order)) localStorage.setItem(flrMemoKey, JSON.stringify(order)); } catch (e) { /* storage may be off */ }
}

function flrMake(spec) {
  return {
    index: 0, id: spec.id, name: spec.name, title: spec.title, spec, plan: null, ver: 0, y: 0, dy: 0, dyT: 1, p: 1, build: null, tier: 2,
    doors: { entry: 0, glass: 0 }, doorT: { entry: 0, glass: 0 }, stats: spec.stats, missions: spec.missions, lampsOn: false,
    agents: new Map(), fx: { micro: 0, coffee: 0, print: 0, board: 0 }, ghost: false, emptyT: 0, hasAbove: false, sig: '', pieces: null, piecesVer: -1,
  };
}

function flrSignature(spec) { return JSON.stringify([spec.offices, spec.rooms, spec.open]); }

function syncFloors(office, animate) {
  const old = FLOORS.slice();
  const oldGroundY = old.length ? old[0].y : null;
  const memo = old.length ? old.filter((f) => f.id !== '').map((f) => f.id) : flrLoadMemo();
  const planned = planBuilding(office, memo);
  flrSaveMemo(planned.order);
  const byId = new Map(old.map((f) => [f.id, f]));
  const result = planned.floors.map((spec) => ({ spec, fl: byId.get(spec.id) || null }));
  // a floor whose project has no team any more stays (a ghost) until its demolition ends: it keeps its place
  const live = new Set(planned.floors.map((s) => s.id));
  old.forEach((f, k) => {
    if (live.has(f.id)) return;
    let at = 1;
    for (let j = k - 1; j >= 0; j--) { const pos = result.findIndex((r) => r.fl && r.fl.id === old[j].id); if (pos >= 0) { at = pos + 1; break; } }
    result.splice(at, 0, { spec: f.spec, fl: f, ghost: true });
  });
  const added = [], changed = [];
  const floors = result.map((r) => {
    let fl = r.fl;
    if (!fl) { fl = flrMake(r.spec); added.push(fl); }
    return fl;
  });
  const cols = buildingCols(result.map((r) => r.spec));
  result.forEach((r, i) => {
    const fl = floors[i];
    fl.index = i;
    fl.title = floorTitle(i);
    if (!r.ghost) {
      fl.spec = r.spec; fl.name = r.spec.name; fl.stats = r.spec.stats; fl.missions = r.spec.missions;
      if (fl.ghost) { fl.ghost = false; fl.emptyT = 0; if (fl.build && fl.build.dir < 0) startBuild(fl, 1); }
      const names = fl.agents;
      names.clear();
    } else if (!fl.ghost) { fl.ghost = true; fl.emptyT = 0; }
  });
  // who is who: titles and states for the labels
  for (const t of (office && office.teams) || []) {
    const pid = t.projectId == null ? '' : t.projectId;
    const fl = floors.find((f) => f.id === pid && !f.ghost);
    if (fl) for (const a of t.agents) fl.agents.set(a.id, a);
  }
  FLOORS.length = 0;
  for (const fl of floors) FLOORS.push(fl);
  const n = FLOORS.length;
  FLOORS.forEach((fl, i) => {
    fl.y = floorTop(i, n);
    const above = i < n - 1;
    if (fl.hasAbove !== above) { fl.hasAbove = above; if (fl.plan) fl.ver++; }
    const sig = flrSignature(fl.spec);
    if (!fl.plan || fl.plan.cols !== cols || sig !== fl.sig) {
      fl.plan = layoutFloor(fl.spec, cols); fl.sig = sig; fl.ver++;
      if (!added.includes(fl)) changed.push(fl);
    }
  });
  for (const fl of added) {
    if (animate && old.length) startBuild(fl, 1);
    else { fl.p = 1; fl.build = null; }
  }
  LIFT.x = (n ? FLOORS[0].plan.width : flrNoPlan.width) + LIFT_W / 2;
  if (LIFT.fl >= n) LIFT.fl = Math.max(0, n - 1);
  if (!LIFT.moving && !LIFT.owner && n) LIFT.y = liftStopY(LIFT.fl);
  return { added, removed: [], changed, shiftY: oldGroundY === null || !n ? 0 : FLOORS[0].y - oldGroundY };
}

function floorById(id) { return FLOORS.find((f) => f.id === id) || null; }
function floorOfPerson(id) { const p = personById(id); return p ? p.floor : null; }

function liftStopY(index) {
  return floorTop(index, FLOORS.length) + (FLOORS[0] && FLOORS[0].plan ? FLOORS[0].plan.landY : 335);
}

function finishFloor(fl) {
  fl.p = 1; fl.build = null; fl.ver++;
}

function floorGone(fl) {
  const k = FLOORS.indexOf(fl);
  if (k < 0) return;
  FLOORS.splice(k, 1);
  const n = FLOORS.length;
  FLOORS.forEach((f, i) => {
    f.index = i; f.title = floorTitle(i); f.y = floorTop(i, n);
    if (i >= k) { f.dy = -BLOCK; f.dyT = 0; }               // the floors above come down
    const above = i < n - 1;
    if (f.hasAbove !== above) { f.hasAbove = above; f.ver++; }
  });
  for (let i = flrCache.length - 1; i >= 0; i--) if (flrCache[i].fl === fl) flrCache.splice(i, 1);
  if (REDUCED) for (const f of FLOORS) { f.dy = 0; f.dyT = 1; }
  floorCam.y -= BLOCK;
  flrPendingShift -= BLOCK;
  if (LIFT.fl >= n) LIFT.fl = Math.max(0, n - 1);
  if (!LIFT.moving && !LIFT.owner && n) LIFT.y = liftStopY(LIFT.fl);
}

/** Sum of the camera shifts of the demolitions since the last call: nav.js adds it to NAV.ty. */
function flrTakeShift() { const s = flrPendingShift; flrPendingShift = 0; return s; }

function tickFloors(dt) {
  const night = nightAlpha(sceneHour()) > 0.2;
  const step = dt / 0.3;
  LIFT.door = Math.abs(LIFT.want - LIFT.door) <= step ? LIFT.want : LIFT.door + Math.sign(LIFT.want - LIFT.door) * step;
  for (const fl of FLOORS) {
    fl.lampsOn = night;
    for (const name of ['entry', 'glass']) {
      const target = fl.doorT[name] > 0 ? 1 : 0;
      if (fl.doorT[name] > 0) fl.doorT[name] -= dt;
      const v = fl.doors[name];
      fl.doors[name] = Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
    }
    const fx = fl.fx;
    if (fx.micro > 0) fx.micro = Math.max(0, fx.micro - dt);
    if (fx.coffee > 0) fx.coffee = Math.max(0, fx.coffee - dt);
    if (fx.print > 0) fx.print = Math.max(0, fx.print - dt);
    if (fl.dy !== 0) {
      fl.dyT = Math.min(1, fl.dyT + dt / 1.4);
      const k = fl.dyT < 0.5 ? 2 * fl.dyT * fl.dyT : 1 - Math.pow(-2 * fl.dyT + 2, 2) / 2;
      fl.dy = fl.dyT >= 1 || REDUCED ? 0 : Math.round(-BLOCK * (1 - k));
    }
    if (fl.ghost && !fl.build) { fl.emptyT += dt; if (fl.emptyT >= flrIdleSeconds) startBuild(fl, -1); }
  }
}

function setFloorTiers(cam) {
  const top = cam.y, bottom = cam.y + cam.bh;
  for (const fl of FLOORS) { const y = fl.y + fl.dy; fl.tier = y < bottom && y + BLOCK > top ? 0 : 2; }
  for (let i = 0; i < FLOORS.length; i++) {
    if (FLOORS[i].tier !== 0) continue;
    if (i > 0 && FLOORS[i - 1].tier === 2) FLOORS[i - 1].tier = 1;
    if (i < FLOORS.length - 1 && FLOORS[i + 1].tier === 2) FLOORS[i + 1].tier = 1;
  }
}

const flrPoint = { x: 0, y: 0 };
function floorToScreen(fl, cam, x, y) {
  flrPoint.x = STAIRS_W + x - cam.x;
  flrPoint.y = fl.y + fl.dy + y - cam.y;
  return flrPoint;
}

/* ------------------------------ rendering ------------------------------ */

const flrSort = [];
function flrSortPieces(list) {
  for (let i = 1; i < list.length; i++) {   // insertion sort: the list is nearly sorted from one frame to the next, and it is stable
    const o = list[i];
    let j = i - 1;
    while (j >= 0 && list[j].sy > o.sy) { list[j + 1] = list[j]; j--; }
    list[j + 1] = o;
  }
}

function flrDrawFloor(g, fl, cam, T, kind, plateSeen) {
  const ox = STAIRS_W - cam.x, oy = fl.y + fl.dy - cam.y;
  g.setTransform(1, 0, 0, 1, ox, oy);
  if (fl.p < 1) {
    drawConstruction(g, fl, T);
    g.drawImage(flrStatic(fl, kind), 0, PLATE_H, fl.plan.width, SLAB, 0, PLATE_H, fl.plan.width, SLAB);   // the slab under it
  } else {
    drawFloorStatic(g, fl, kind);
    if (!plateSeen) { g.setTransform(1, 0, 0, 1, 0, 0); return; }
    flrDrawDoors(g, fl);
    const list = flrSort;
    list.length = 0;
    for (const o of floorDrawables(fl)) list.push(o);
    for (const o of peopleDrawables(fl)) list.push(o);
    flrSortPieces(list);
    for (const o of list) o.draw(g, T);
    drawParticles(g, fl.index, T);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (fl.p >= 1 && plateSeen) {
    applyLight(g, fl, cam, T);
    if (typeof pplWaitFilter !== 'undefined' && pplWaitFilter) {   // « Qui m'attend »: a veil on the floor, the waiting ones stay lit
      g.globalAlpha = 0.66; g.fillStyle = palColor('ink'); g.fillRect(ox, oy, fl.plan.width, BLOCK); g.globalAlpha = 1;
      g.setTransform(1, 0, 0, 1, ox, oy);
      for (const p of peopleOnFloor(fl)) if (p.visible && p.info && p.info.state === 'waiting') pplDraw(g, p, p.x, p.y, T);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    drawBubbles(g, fl, cam, T);
  }
}

function renderBuilding(g, tg, cam, T) {
  const kind = skyKind(sceneHour());
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawCity(g, cam, kind);
  flrDrawTowers(g, cam, T);
  const top = cam.y, bottom = cam.y + cam.bh;
  for (let i = FLOORS.length - 1; i >= 0; i--) {   // from the top: each visible floor entirely before the next one
    const fl = FLOORS[i];
    if (fl.tier !== 0) continue;
    const y = fl.y + fl.dy;
    flrDrawFloor(g, fl, cam, T, kind, y < bottom && y + PLATE_H > top);
  }
  for (const fl of FLOORS) if (fl.build && fl.tier <= 1) { g.setTransform(1, 0, 0, 1, 0, 0); drawFloorCrane(g, fl, T); }
  if (tg) {
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, tg.canvas.width, tg.canvas.height);
    flrRectCount = 0;
    for (let i = FLOORS.length - 1; i >= 0; i--) if (FLOORS[i].tier === 0) drawFloorLabels(tg, FLOORS[i], cam, T);
  }
}

/* ------------------------------ labels (crisp layer) ------------------------------ */

const flrLabels = new Map();
const flrWraps = new Map();
const flrRects = [];       // the label boxes of the last frame, device px: tests read them to check that no two overlap
let flrRectCount = 0;
function flrLabelBoxes() { return flrRects.slice(0, flrRectCount); }

/** Text image: bitmap font scaled by a whole factor, with a one pixel shadow unless the colour is ink. */
function flrLabel(text, colour, tf) {
  const key = text + '|' + colour + '|' + tf;
  let c = flrLabels.get(key);
  if (c) return c;
  const w = Math.max(1, textWidth(text));
  const small = makeBuffer(w, FONT_H + 1);
  if (colour !== 'ink') drawText(small.g, text, 0, 1, 'ink');
  drawText(small.g, text, 0, 0, colour);
  const big = makeBuffer(w * tf, (FONT_H + 1) * tf);
  big.g.drawImage(small.c, 0, 0, w, FONT_H + 1, 0, 0, w * tf, (FONT_H + 1) * tf);
  if (flrLabels.size >= flrLabelMax) flrLabels.clear();
  flrLabels.set(key, big.c);
  return big.c;
}

const flrDots = '...';

/** The text if it fits maxW (font px); else its longest start followed by dots; '' when not even the dots fit. A word is never cut without the dots. */
function flrFit(text, maxW) {
  if (textWidth(text) <= maxW) return text;
  const dots = textWidth(flrDots);
  if (dots > maxW) return '';
  let s = text;
  while (s.length > 0 && textWidth(s + flrDots) > maxW) s = s.slice(0, -1);
  s = s.replace(/[\s,.:;!?(\/+-]+$/, '');
  return s + flrDots;
}

/** At most n lines of maxW font px: wrapped at spaces, a word wider than a line or a rest that does not fit ends in dots. */
function flrLines(text, maxW, n) {
  const key = text + '|' + maxW + '|' + n;
  let r = flrWraps.get(key);
  if (r) return r;
  if (n < 1) r = [];
  else {
    const lines = wrapText(text, maxW);
    r = lines.length <= n
      ? lines.map((l) => flrFit(l, maxW))
      : lines.slice(0, n - 1).map((l) => flrFit(l, maxW)).concat([flrFit(lines.slice(n - 1).join(' '), maxW)]);
    r = r.filter((l) => l !== '');
  }
  if (flrWraps.size >= flrLabelMax) flrWraps.clear();
  flrWraps.set(key, r);
  return r;
}

/** Records a label box of the frame (device px); `box` is the container it must stay in, when it has one. */
function flrRecord(x, y, w, h, box) {
  let r = flrRects[flrRectCount];
  if (!r) r = flrRects[flrRectCount] = { x: 0, y: 0, w: 0, h: 0, bx: 0, by: 0, bw: 0, bh: 0, ch: 0, fg: '', pl: '' };
  r.fg = ''; r.pl = '';
  r.x = x; r.y = y; r.w = w; r.h = h; r.ch = h;
  if (box) { r.bx = box[0]; r.by = box[1]; r.bw = box[2]; r.bh = box[3]; } else { r.bx = 0; r.by = 0; r.bw = 0; r.bh = 0; }
  flrRectCount++;
  return r;
}

const flrBox = [0, 0, 0, 0];
let flrBoxOn = false;
/** The container (device px) of the labels drawn by the next flrPut calls; flrNoBox forgets it. */
function flrSetBox(x, y, w, h) { flrBox[0] = x; flrBox[1] = y; flrBox[2] = w; flrBox[3] = h; flrBoxOn = true; }
function flrNoBox() { flrBoxOn = false; }

/**
 * Draws a label at device px (x, y); align 'l', 'c' or 'r' on x. Returns its device width. Skipped (0) when it would touch a bubble or
 * overlap a label already drawn this frame (the text was wrapped and cut with dots to its container before that).
 */
function flrPut(tg, ctx, text, colour, tf, x, y, align, bubbles) {
  if (text === '') return 0;
  const img = flrLabel(text, colour, tf);
  const left = align === 'c' ? x - (img.width >> 1) : align === 'r' ? x - img.width : x;
  if (left > tg.canvas.width || left + img.width < 0 || y > tg.canvas.height || y + img.height < 0) return 0;
  if (bubbles) {
    const z = ctx.z, px = left / z + ctx.cam.x - STAIRS_W, py = (y - ctx.oy) / z, pw = img.width / z, ph = img.height / z;
    for (const b of bubbles) if (px < b[0] + b[2] && b[0] < px + pw && py < b[1] + b[3] && b[1] < py + ph) return 0;
  }
  for (let i = 0; i < flrRectCount; i++) {
    const r = flrRects[i];
    if (left < r.x + r.w && r.x < left + img.width && y < r.y + r.h && r.y < y + img.height) return 0;
  }
  tg.drawImage(img, left, y);
  flrRecord(left, y, img.width, img.height, flrBoxOn ? flrBox : null).ch = FONT_H * tf;
  return img.width;
}

const flrCtx = { cam: null, z: 1, tf: 1, ox: 0, oy: 0 };

/**
 * Colour of the name of an agent. Every name is drawn on a dark plate (flrNamePlate), so each one keeps a contrast of 5.6:1 at least on the
 * worst floor of a room (measured: scripts of the L3 bench). done: cooler and dimmer than a working agent; away from the desk: warm grey.
 */
function flrStateColour(a, seated) {
  if (!a) return 'wallMid';
  if (a.state === 'waiting') return 'lamp';
  if (a.state === 'error') return 'wallHi';
  if (a.state === 'done') return 'steelL';
  return seated ? 'wallHi' : 'wallMid';
}
function flrNamePlate(a) { return a && a.state === 'error' ? 'brick' : 'ink'; }
const flrPlateAlpha = 0.9;

/**
 * A block of centred lines on a plate (ink, or brick for an error) that is 90 % opaque, so the name reads on any floor, day and night.
 * Same rules as flrPut: skipped when it would touch a bubble or a label already drawn; the plate is the box that is recorded.
 */
function flrPutBlock(tg, ctx, lines, colour, plate, tf, cx, y, bubbles) {
  if (!lines.length) return 0;
  let w = 0;
  for (const l of lines) w = Math.max(w, flrLabel(l, colour, tf).width);
  const padX = 2 * tf, padY = tf, lineH = (FONT_H + 1) * tf;
  const content = (lines.length - 1) * lineH + FONT_H * tf;
  const bx = cx - (w >> 1) - padX, bw = w + 2 * padX, by = y - padY, bh = content + 2 * padY;
  if (bx > tg.canvas.width || bx + bw < 0 || by > tg.canvas.height || by + bh < 0) return 0;
  if (bubbles) {
    const z = ctx.z, px = bx / z + ctx.cam.x - STAIRS_W, py = (by - ctx.oy) / z, pw = bw / z, ph = bh / z;
    for (const b of bubbles) if (px < b[0] + b[2] && b[0] < px + pw && py < b[1] + b[3] && b[1] < py + ph) return 0;
  }
  for (let i = 0; i < flrRectCount; i++) {
    const r = flrRects[i];
    if (bx < r.x + r.w && r.x < bx + bw && by < r.y + r.h && r.y < by + bh) return 0;
  }
  tg.globalAlpha = flrPlateAlpha; tg.fillStyle = palColor(plate); tg.fillRect(bx, by, bw, bh); tg.globalAlpha = 1;
  for (let k = 0; k < lines.length; k++) {
    const img = flrLabel(lines[k], colour, tf);
    tg.drawImage(img, cx - (img.width >> 1), y + k * lineH);
  }
  const rec = flrRecord(bx, by, bw, bh, flrBoxOn ? flrBox : null);
  rec.fg = colour; rec.pl = plate;
  return bw;
}

function flrPlate(tg, cam, z, tf, other, topDev) {
  const h = 12 * z, f2 = FONT_H * tf * 2 <= h ? tf * 2 : tf;   // the title is twice as big when the plate is tall enough
  const t1 = other.title, t2 = other.name + (other.p < 1 ? ', en chantier' : '');
  const w1 = textWidth(t1) * f2, w2 = textWidth(t2) * tf, stripe = Math.max(2, Math.round(1.5 * z)), pad = Math.round(3 * z);
  const pw = stripe + pad + w1 + 6 * tf + w2 + pad;
  const plateW = other.plan ? other.plan.width : flrNoPlan.width;
  const lx = Math.min(Math.max(cam.x - STAIRS_W + 6, 6), Math.max(6, plateW - pw / z - 6));
  const x0 = Math.round((STAIRS_W + lx - cam.x) * z);
  tg.fillStyle = palColor('ink'); tg.fillRect(x0, topDev, pw, h);
  tg.fillStyle = palColor(other.p < 1 ? 'lamp' : other.index === 0 ? 'screen' : 'lamp'); tg.fillRect(x0, topDev, stripe, h);
  const capTop = (f) => topDev + Math.round((h - 7 * f) / 2) - 2 * f;
  const x1 = x0 + stripe + pad;
  tg.drawImage(flrLabel(t1, 'lampHi', f2), x1, capTop(f2));
  tg.drawImage(flrLabel(t2, 'steelL', tf), x1 + w1 + 6 * tf, capTop(tf));
  flrRecord(x0, topDev, pw, h, null);
}

function drawFloorLabels(tg, fl, cam, T) {
  const z = cam.zoom, tf = Math.max(1, Math.round(z / 2.4));
  const ctx = flrCtx;
  ctx.cam = cam; ctx.z = z; ctx.tf = tf;
  ctx.ox = Math.round((STAIRS_W - cam.x) * z);
  ctx.oy = Math.round((fl.y + fl.dy - cam.y) * z);
  const ox = ctx.ox, oy = ctx.oy, plan = fl.plan;
  // name plate of the floor below, on this slab; the top floor also carries its own, in the sky above it
  if (fl.index > 0) flrPlate(tg, cam, z, tf, FLOORS[fl.index - 1], oy + (PLATE_H + 2) * z);
  if (fl.index === FLOORS.length - 1) flrPlate(tg, cam, z, tf, fl, oy - 14 * z);
  if (fl.p < 1) return;
  const bubbles = bubbleRects(fl);
  const X = (px) => ox + Math.round(px * z), Y = (py) => oy + Math.round(py * z);
  const lineH = (FONT_H + 1) * tf;
  // A label is wrapped and cut (with dots) to the width of its container in device px, then centred in it; a container too short for
  // a line gets fewer lines.
  // headers of the rooms: the service, then « Resp. : title » on up to two lines
  for (const rm of plan.rooms) {
    const h = rm.header, avail = Math.floor(((h.w - 4) * z) / tf);
    const room = fl.spec.rooms.find((r) => r.key === rm.key), service = (room && room.service) || rm.title;
    const cap = Math.max(1, Math.floor((22 * z) / lineH)), lines = [flrFit(service, avail)];
    if (cap > 1) for (const l of flrLines('Resp. : ' + rm.title, avail, Math.min(2, cap - 1))) lines.push(l);
    const top = Y(h.y) + Math.round((22 * z - lines.length * lineH) / 2);
    flrSetBox(X(h.x), Y(h.y), h.w * z, 22 * z);
    lines.forEach((l, k) => flrPut(tg, ctx, l, k ? 'steelL' : 'wallHi', tf, X(h.x + 2), top + k * lineH, 'l', bubbles));
  }
  if (plan.open.rect.w > 0) {
    const o = plan.open.rect, w = Math.min(o.w * 8, 92);
    flrSetBox(X(o.x * 8), Y(74), w * z, 13 * z);
    flrPut(tg, ctx, flrFit('Postes libres', Math.floor(((w - 6) * z) / tf)), 'wallHi', tf, X(o.x * 8 + 3), Y(74) + Math.round((13 * z - lineH) / 2), 'l', bubbles);
  }
  // names under the desks, in the colour of the state (dimmed while the person is away), in a column of 64 px
  const maxW = Math.floor((64 * z) / tf) - 4;   // the plate adds two pixels on each side
  for (const d of plan.desks) {
    if (!d.ownerId || d.where.indexOf('office:') === 0) continue;   // the panel of the chef carries its name
    const a = fl.agents.get(d.ownerId), p = personById(d.ownerId), seated = !!(p && p.seated && p.present);
    if (!a) continue;
    const colour = flrStateColour(a, seated), cx = X(d.x + d.w / 2);
    flrSetBox(cx - 32 * z, Y(d.y + 14) - tf, 64 * z, 32 * z);
    flrPutBlock(tg, ctx, flrLines(a.title, maxW, 2), colour, flrNamePlate(a), tf, cx, Y(d.y + 14), bubbles);
  }
  // panels of the chefs
  for (const o of plan.offices) {
    const sx = o.rect.x * 8 + 128, avail = Math.floor((80 * z) / tf);
    const lines = flrLines(o.sign, avail, Math.max(1, Math.min(3, Math.floor((24 * z - 2) / lineH))));
    const top = Y(32) + Math.round((24 * z - lines.length * lineH) / 2);
    flrSetBox(X(sx), Y(32), 88 * z, 24 * z);
    lines.forEach((l, k) => flrPut(tg, ctx, l, 'ink', tf, X(sx + 44), top + k * lineH, 'c', null));
  }
  // fixed signs
  const geo = flrGeo(plan), fit = (s, logical) => flrFit(s, Math.floor((logical * z) / tf));
  flrSetBox(X(52), Y(geo.cb + 2), 46 * z, 12 * z);
  flrPut(tg, ctx, fit('Cafétéria', 38), 'lampHi', tf, X(58), Y(geo.cb + 2) + Math.round((12 * z - lineH) / 2), 'l', null);
  if (plan.id === '') {
    flrSetBox(X(geo.dx - 52), Y(geo.ey + 2), 42 * z, 11 * z);
    flrPut(tg, ctx, fit('Accueil', 37), 'screen', tf, X(geo.dx - 49), Y(geo.ey + 2) + Math.round((11 * z - lineH) / 2), 'l', null);
  }
  flrSetBox(X(geo.W - 112), Y(geo.cb + 26), 64 * z, lineH);
  flrPut(tg, ctx, fit('Sanitaires', 64), 'ink', tf, X(geo.W - 80), Y(geo.cb + 26), 'c', null);
  flrSetBox(X(8), Y(308), 100 * z, lineH);
  flrPut(tg, ctx, fit('Escalier', 100), 'steelL', tf, X(10), Y(308), 'l', null);
  flrSetBox(X(geo.W - 108), Y(308), 100 * z, lineH);
  flrPut(tg, ctx, fit('Ascenseur', 96), 'ink', tf, X(geo.W - 10), Y(308), 'r', null);
  flrNoBox();
}
