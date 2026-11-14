/* web/pixel/sky.js : lot L7, voir docs/vue-pixel.md (2.7)
   The world around the building and its night light: time of day, sky, skyline, street, roof, stepped light pools.
   Shares one scope with the other web/pixel files: public names are the ones of the 2.7 signatures (skyKind, nightAlpha, sceneHour,
   setHourOverride, drawCity, applyLight), every other top-level name wears `sky`. Declares only, nothing runs at load: the decor of a
   sky kind is baked on first use, the pools of light on first use of a radius.

   Choices recorded here (additions to the 2.7 shapes, all additive):
   - nightAlpha is stepped by 1/25 and capped at 16/25 = 0.64, the highest step under the 0.66 of the contract.
   - drawCity has no time argument: cars, walkers and clouds read their own clock (performance.now); skySetTime(t | null) freezes it (captures, tests).
     With REDUCED the clock stands still.
   - Everything of drawCity is anchored in the WORLD (patterns and tiles follow cam.x and cam.y), so a pan never makes the dither crawl.
   - applyLight dims plate and slab with one buffer-sized mask (a canvas reused by every floor), punches stepped pools of light at the
     occupied desks, the lit places and the walkers, then repaints the lit windows of the back wall.
   - Needs from floor.js: FLOORS (count and plate width, to place the horizon and the roof). Needs from people.js: peopleOnFloor. */

/* ------------------------------ time of day ------------------------------ */

const skyAlphaTl = [[0, 0.66], [5, 0.66], [7, 0.14], [9, 0], [17, 0], [18.5, 0.2], [20.5, 0.6], [24, 0.66]];
const skyAlphaSteps = 25;
const skyAlphaTop = 16;                          // 16 / 25 = 0.64

let skyOverride = null;
let skyTzOff = 0;
let skyTzStamp = -1e12;

/** Darkness of the night mask for an hour (0..24): piecewise linear, then cut into steps of 1/25, never continuous. */
function nightAlpha(h) {
  let v = 0.66;
  for (let i = 1; i < skyAlphaTl.length; i++) {
    const a = skyAlphaTl[i - 1], b = skyAlphaTl[i];
    if (h <= b[0]) { v = a[1] + ((b[1] - a[1]) * (h - a[0])) / (b[0] - a[0]); break; }
  }
  return Math.min(skyAlphaTop, Math.round(v * skyAlphaSteps)) / skyAlphaSteps;
}

function skyKind(h) {
  return h >= 20 || h < 5 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'dusk';
}

/** Hour of the scene: the demo override, else the real local time. Allocates nothing (the zone offset is read once a minute). */
function sceneHour() {
  if (skyOverride !== null) return skyOverride;
  const now = Date.now();
  if (now - skyTzStamp > 60000 || now < skyTzStamp) { skyTzOff = new Date(now).getTimezoneOffset(); skyTzStamp = now; }
  const h = (now / 3600000 - skyTzOff / 60) % 24;
  return h < 0 ? h + 24 : h;
}

/** Demo only (?demo=1): a fixed hour (0..24, wrapped), or null for the real time. */
function setHourOverride(h) {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) { skyOverride = null; return; }
  skyOverride = ((Number(h) % 24) + 24) % 24;
}

let skyFrozen = null;                            // seconds, or null: performance.now
function skySetTime(t) { skyFrozen = t === null || t === undefined ? null : Number(t); }
function skyNow() {
  if (REDUCED) return 0;
  if (skyFrozen !== null) return skyFrozen;
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/* ------------------------------ geometry of the world ------------------------------ */

const skyGeo = { n: 1, plate: COLS_MIN * CELL, w: 0, h: 0, gy: 0 };
function skyMeasure() {
  const n = FLOORS.length > 0 ? FLOORS.length : 1;
  const first = FLOORS.length > 0 ? FLOORS[0] : null;
  skyGeo.n = n;
  skyGeo.plate = first && first.plan ? first.plan.width : COLS_MIN * CELL;
  skyGeo.w = STAIRS_W + skyGeo.plate + LIFT_W;
  skyGeo.h = SKY_H + n * BLOCK + GROUND_H;
  skyGeo.gy = skyGeo.h - GROUND_H;               // world y of the top of the street
  return skyGeo;
}

/* ------------------------------ baking helpers ------------------------------ */

const skyBayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const skyBands = {                               // from the anchor up: [colour, distance above the anchor where it starts]
  day: [['glassHi', 0], ['glass', 40], ['sky', 110]],
  dawn: [['lamp', 0], ['lampHi', 40], ['glassHi', 100], ['glass', 170], ['sky', 250]],
  dusk: [['lamp', 0], ['pot', 40], ['carpA', 110], ['carpB', 190]],
  night: [['carpB', 0], ['night', 60], ['ink', 130]],
};
const skyLook = {                                // skyline and street colours per kind
  day: { far: 'steelL', near: 'steel', win: null, lit: 'glassHi', pLit: 0, litHi: 'white', pHi: 0, walk: 'conc', walkJ: 'concD', road: 'steelD', roadS: 'steel', dash: 'wallHi' },
  dawn: { far: 'steelL', near: 'steelD', win: null, lit: 'lampHi', pLit: 0.1, litHi: 'white', pHi: 0, walk: 'conc', walkJ: 'concD', road: 'steelD', roadS: 'steel', dash: 'wallHi' },
  dusk: { far: 'steelD', near: 'night', win: 'steelD', lit: 'lamp', pLit: 0.35, litHi: 'lampHi', pHi: 0.06, walk: 'concD', walkJ: 'steelD', road: 'steelD', roadS: 'night', dash: 'wallMid' },
  night: { far: 'night', near: 'ink', win: 'night', lit: 'lamp', pLit: 0.4, litHi: 'lampHi', pHi: 0.08, walk: 'concD', walkJ: 'steelD', road: 'night', roadS: 'ink', dash: 'steelL' },
};
const skyH = 300;                                // height of the sky gradient above its anchor
const skyRoofSpan = 20;                          // the anchor (horizon colour) is this far under the roof line
const skyTileW = 512;                            // skyline tile
const skyLineH = 300;
const skyStreetW = 128;
const skyCarColours = ['red', 'lamp', 'glass', 'white', 'leaf', 'pot'];

function skyFill(img, x, y, c) {
  const col = rgb(c), o = (y * img.width + x) * 4;
  img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
}

/** Sky: a 4 px wide tile, rows from the zenith to the horizon, ordered dither (Bayer 4x4) between two bands. */
function skyBakeGradient(kind) {
  const bands = skyBands[kind], b = makeBuffer(4, skyH), img = b.g.createImageData(4, skyH), blend = 12;
  for (let r = 0; r < skyH; r++) {
    const d = skyH - 1 - r;
    let i = 0;
    while (i + 1 < bands.length && d >= bands[i + 1][1]) i++;
    for (let x = 0; x < 4; x++) {
      let c = bands[i][0];
      if (i + 1 < bands.length) {
        const gap = bands[i + 1][1] - d;                 // distance to the next band
        if (gap <= blend) { const t = 1 - gap / blend; if (skyBayer[(r & 3) * 4 + x] / 16 < t) c = bands[i + 1][0]; }
      }
      skyFill(img, x, r, c);
    }
  }
  b.g.putImageData(img, 0, 0);
  return b.c;
}

/** One layer of the skyline: seamless tile of buildings standing on the bottom edge. */
function skyBakeLayer(kind, near) {
  const lk = skyLook[kind], b = makeBuffer(skyTileW, skyLineH), g = b.g;
  const body = near ? lk.near : lk.far;
  const wMin = near ? 22 : 16, wMax = near ? 44 : 30, hMin = near ? 70 : 110, hMax = near ? 190 : 270;
  let x = 0, k = 0;
  while (x < skyTileW) {
    const h = hash((near ? 'sn' : 'sf') + k);
    let w = wMin + (h % (wMax - wMin + 1));
    if (x + w > skyTileW) w = skyTileW - x;
    const bh = hMin + ((h >>> 8) % (hMax - hMin + 1)), top = skyLineH - bh;
    rect(g, x, top, w, bh, body);
    if (near && w >= 8) rect(g, x, top, w, 1, lk.far);          // roof edge catches the light
    if (!near && (h >>> 16) % 4 === 0) rect(g, x + (w >> 1), top - 10, 1, 10, body);   // antenna
    if (near) {
      for (let wy = top + 5, j = 0; wy + 3 < skyLineH - 2; wy += 7, j++) {
        for (let wx = x + 4, i = 0; wx + 3 <= x + w - 3; wx += 6, i++) {
          const q = hash('w' + k + '_' + i + '_' + j), r = (q % 1000) / 1000;
          if (r < lk.pHi) rect(g, wx, wy, 3, 3, lk.litHi);
          else if (r < lk.pLit) rect(g, wx, wy, 3, 3, lk.lit);
          else if (lk.win) rect(g, wx, wy, 3, 3, lk.win);
        }
      }
    }
    x += w;
    k++;
  }
  return b.c;
}

function skyBakeStars() {
  const b = makeBuffer(256, 220);
  for (let i = 0; i < 70; i++) {
    const h = hash('star' + i), x = h % 256, y = (h >>> 8) % 220;
    if (y > 120 && (h >>> 20) % 3 !== 0) continue;                // thinner towards the horizon
    rect(b.g, x, y, 1, 1, (h >>> 4) % 5 === 0 ? 'lampHi' : (h >>> 4) % 3 === 0 ? 'steelL' : 'white');
  }
  return b.c;
}

function skyDisc(g, cx, cy, r, c0, c1) {
  for (let y = -r - 1; y <= r + 1; y++) {
    for (let x = -r - 1; x <= r + 1; x++) {
      const d = Math.hypot(x, y);
      if (d <= r - 1.5) rect(g, cx + x, cy + y, 1, 1, c0);
      else if (d <= r) rect(g, cx + x, cy + y, 1, 1, c1);
    }
  }
}

function skyBakeBody(kind) {
  if (kind === 'night') {
    const b = makeBuffer(13, 13);
    skyDisc(b.g, 6, 6, 6, 'wallHi', 'wallMid');
    for (const [x, y] of [[4, 4], [8, 5], [5, 8], [8, 9], [3, 7]]) rect(b.g, x, y, 1, 1, 'wallMid');
    for (let y = 1; y < 12; y++) rect(b.g, 10 + (y % 2), y, 1, 1, 'steelL');
    return b.c;
  }
  const b = makeBuffer(15, 15);
  skyDisc(b.g, 7, 7, 7, kind === 'day' ? 'lampHi' : 'lamp', kind === 'day' ? 'lamp' : 'pot');
  return b.c;
}

const skyCloudRows = [
  ['.......aaaa.........', '.....aaaaaaaa.aaa...', '..aaaaaaaaaaaaaaaaa.', '.aaaaaaaaaaaaaaaaaaa', '.bbbbbbbbbbbbbbbbbb.'],
  ['..........aaaaa.............', '......aaaaaaaaaaaa..aaaa....', '..aaaaaaaaaaaaaaaaaaaaaaaa..', '.aaaaaaaaaaaaaaaaaaaaaaaaaa.', '.bbbbbbbbbbbbbbbbbbbbbbbbbb.'],
  ['....aaaa......', '..aaaaaaaaa...', '.aaaaaaaaaaaa.', '.bbbbbbbbbbbb.'],
];
const skyCloudColours = { day: { a: 'white', b: 'glassHi' }, dawn: { a: 'wallHi', b: 'lampHi' }, dusk: { a: 'lampHi', b: 'lamp' } };

function skyBakeStreet(kind) {
  const lk = skyLook[kind], b = makeBuffer(skyStreetW, GROUND_H), g = b.g;
  rect(g, 0, 0, skyStreetW, 6, lk.walk);
  rect(g, 0, 0, skyStreetW, 1, kind === 'night' ? 'steel' : 'steelL');
  for (let x = 0; x < skyStreetW; x += 16) rect(g, x, 1, 1, 3, lk.walkJ);
  rect(g, 0, 4, skyStreetW, 1, lk.walkJ);
  rect(g, 0, 5, skyStreetW, 1, 'steelD');
  rect(g, 0, 6, skyStreetW, GROUND_H - 6, lk.road);
  for (let i = 0; i < 90; i++) { const h = hash('road' + i); rect(g, h % skyStreetW, 6 + ((h >>> 8) % (GROUND_H - 6)), 1 + ((h >>> 20) % 2), 1, lk.roadS); }
  for (let x = 8; x < skyStreetW; x += 32) rect(g, x, 15, 14, 1, lk.dash);
  rect(g, 0, GROUND_H - 1, skyStreetW, 1, 'ink');
  return b.c;
}

function skyBakeLamp(kind) {                     // street lamp with, at night, a stepped pool of light on the ground
  const night = kind === 'night' || kind === 'dusk', w = 56, h = 56, b = makeBuffer(w, h), g = b.g, fx = 28, fy = 46;
  if (night) {
    for (let y = -9; y <= 9; y++) {
      for (let x = -26; x <= 26; x++) {
        const d = Math.hypot(x / 26, y / 8);
        if (d <= 0.4 && ((x + y) & 1) === 0) rect(g, fx + x, fy + y, 1, 1, 'lampHi');
        else if (d <= 0.7 && ((x + y) & 1) === 0) rect(g, fx + x, fy + y, 1, 1, 'lamp');
        else if (d <= 1 && (x & 1) === 0 && (y & 1) === 0) rect(g, fx + x, fy + y, 1, 1, 'lamp');
      }
    }
  }
  rect(g, fx - 3, fy - 1, 7, 2, 'steelD');
  rect(g, fx, 6, 2, fy - 6, 'steel'); rect(g, fx + 1, 6, 1, fy - 6, 'steelD');
  rect(g, fx - 5, 3, 11, 4, 'ink'); rect(g, fx - 4, 4, 9, 2, night ? 'lampHi' : 'steelL');
  return b.c;
}

function skyBakeCar(colour, right, night) {
  const w = 22, ext = night ? 14 : 0, b = makeBuffer(w + ext, 9), g = b.g;
  g.save();
  if (!right) { g.translate(w + ext, 0); g.scale(-1, 1); }
  rect(g, 0, 3, 22, 5, 'ink'); rect(g, 4, 0, 13, 4, 'ink');
  rect(g, 1, 4, 20, 3, colour); rect(g, 5, 1, 11, 3, colour); rect(g, 1, 4, 20, 1, 'white');
  rect(g, 6, 2, 4, 2, 'glassHi'); rect(g, 11, 2, 4, 2, 'glassHi'); rect(g, 10, 1, 1, 3, colour);
  rect(g, 3, 6, 4, 3, 'ink'); rect(g, 15, 6, 4, 3, 'ink'); rect(g, 4, 7, 2, 1, 'steelL'); rect(g, 16, 7, 2, 1, 'steelL');
  rect(g, 21, 4, 1, 2, 'lampHi'); rect(g, 0, 4, 1, 2, 'red');
  if (night) for (let y = 3; y <= 7; y++) for (let x = 22; x < 22 + ext; x++) if (((x + y) & 1) === 0 && x - 22 < ext - Math.abs(y - 5) * 3) rect(g, x, y, 1, 1, 'lamp');
  g.restore();
  return b.c;
}

function skyBakeWalker(skin, top, pants, step) {
  const b = makeBuffer(5, 7), g = b.g;
  rect(g, 1, 0, 3, 2, skin); rect(g, 1, 0, 3, 1, 'ink');
  rect(g, 1, 2, 3, 3, top); rect(g, 0, 2, 1, 3, top); rect(g, 4, 2, 1, 3, top);
  if (step) { rect(g, 1, 5, 1, 2, pants); rect(g, 3, 5, 1, 1, pants); rect(g, 4, 6, 1, 1, pants); } else { rect(g, 1, 5, 1, 2, pants); rect(g, 3, 5, 1, 2, pants); }
  return b.c;
}

const skyKits = {};
function skyBuildKit(kind) {
  const night = kind === 'night', cloud = skyCloudColours[kind];
  const kit = {
    kind,
    grad: skyBakeGradient(kind), gradPat: null, zenith: palColor(skyBands[kind][skyBands[kind].length - 1][0]), low: palColor(skyBands[kind][0][0]),
    far: skyBakeLayer(kind, false), near: skyBakeLayer(kind, true),
    stars: night ? skyBakeStars() : null,
    body: skyBakeBody(kind),
    clouds: cloud ? skyCloudRows.map((rows) => bakeRows(rows, { a: cloud.a, b: cloud.b })) : null,
    street: skyBakeStreet(kind), streetPat: null,
    lamp: skyBakeLamp(kind),
    carsR: skyCarColours.map((c) => skyBakeCar(c, true, night)),
    carsL: skyCarColours.map((c) => skyBakeCar(c, false, night)),
    walkers: [],
  };
  const looks = [['skinA', 'steel', 'night'], ['skinB', 'red', 'steelD'], ['skinC', 'leaf', 'woodD'], ['skinA', 'lamp', 'carpB']];
  for (const [s, t, p] of looks) kit.walkers.push([skyBakeWalker(s, t, p, false), skyBakeWalker(s, t, p, true)]);
  return kit;
}
function skyKit(kind) {
  const key = skyBands[kind] ? kind : 'day';
  return skyKits[key] || (skyKits[key] = skyBuildKit(key));
}

/* moving things of the street: constant tables, positions are a function of the clock */
const skyCarDir = [1, -1, 1, -1, 1, -1];
const skyCarSpeed = [34, 27, 22, 38, 29, 24];
const skyCarPhase = [0, 150, 400, 560, 720, 840];
const skyCarCol = [0, 2, 3, 1, 4, 5];
const skyLoop = 920;
const skyWalkDir = [1, -1, 1, -1];
const skyWalkSpeed = [10, 12, 8, 11];
const skyWalkPhase = [0, 90, 210, 330];
const skyWalkLoop = 520;
const skyCloudX = [40, 210, 380, 560];
const skyCloudY = [10, 30, 16, 44];
const skyCloudV = [1.6, 2.4, 1.1, 2];
const skyCloudK = [0, 1, 2, 0];

/* ------------------------------ the city ------------------------------ */

/** The world around the building: ink, dithered sky above the roof, skyline, street at the foot of the ground floor. Leaves an identity transform. */
function drawCity(g, cam, kind) {
  const kit = skyKit(kind), geo = skyMeasure(), t = skyNow();
  const bw = cam.bw, bh = cam.bh, cx = cam.x, cy = cam.y, horizon = geo.gy - cy;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = palColor('ink');
  g.fillRect(0, 0, bw, bh);
  // sky: zenith colour, the gradient tile (anchored just under the roof line so that dawn and dusk show on the roof), then the horizon colour down to the street
  if (horizon > 0) {
    if (!kit.gradPat) kit.gradPat = g.createPattern(kit.grad, 'repeat');
    const anchor = SKY_H + skyRoofSpan - cy, top = anchor - skyH, y1 = Math.min(bh, horizon);
    if (top > 0) { g.fillStyle = kit.zenith; g.fillRect(0, 0, bw, Math.min(top, bh)); }
    const y0 = Math.max(0, top), y2 = Math.min(y1, anchor);
    if (y2 > y0) {
      g.setTransform(1, 0, 0, 1, -cx, top);
      g.fillStyle = kit.gradPat;
      g.fillRect(cx, y0 - top, bw, y2 - y0);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (y1 > Math.max(0, anchor)) { g.fillStyle = kit.low; g.fillRect(0, Math.max(0, anchor), bw, y1 - Math.max(0, anchor)); }
  }
  // stars, sun or moon, clouds: near the top of the world, that is just above the roof
  if (cy < 240) {
    if (kit.stars) for (let x = Math.floor(cx / 256) * 256 - cx; x < bw; x += 256) g.drawImage(kit.stars, x, -cy);
    const bx = Math.round(geo.w * (kit.kind === 'night' ? 0.2 : 0.78) - cx - (kit.body.width >> 1)), by = 22 - cy - (kit.body.height >> 1);
    if (bx > -20 && bx < bw) g.drawImage(kit.body, bx, by);
    if (kit.clouds) {
      const span = geo.w + 260;
      for (let k = 0; k < 4; k++) {
        const sp = kit.clouds[skyCloudK[k]];
        let wx = (skyCloudX[k] + t * skyCloudV[k]) % span;
        wx -= 130;
        const sx = Math.round(wx - cx), sy = Math.round(skyCloudY[k] - cy);
        if (sx < bw && sx + sp.width > 0 && sy + sp.height > 0 && sy < bh) g.drawImage(sp, sx, sy);
      }
    }
  }
  // skyline, far then near, standing on the horizon
  if (horizon > 0 && horizon - skyLineH < bh) {
    const sy = horizon - skyLineH;
    for (let x = Math.floor(cx / skyTileW) * skyTileW - cx; x < bw; x += skyTileW) g.drawImage(kit.far, x, sy);
    for (let x = Math.floor((cx + 200) / skyTileW) * skyTileW - (cx + 200); x < bw; x += skyTileW) g.drawImage(kit.near, x, sy);
  }
  skyDrawRoof(g, cam, geo, t);
  // street
  if (horizon < bh && horizon + GROUND_H > 0) {
    if (!kit.streetPat) kit.streetPat = g.createPattern(kit.street, 'repeat');
    g.setTransform(1, 0, 0, 1, -cx, horizon);
    g.fillStyle = kit.streetPat;
    g.fillRect(cx, 0, bw, GROUND_H);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const lampStep = 192;
    for (let wx = Math.floor((cx - 60) / lampStep) * lampStep + 40; wx < cx + bw + 30; wx += lampStep) g.drawImage(kit.lamp, wx - cx - 28, horizon + 5 - 46);
    for (let k = 0; k < 4; k++) {   // walkers on the pavement
      const dir = skyWalkDir[k];
      let x = (skyWalkPhase[k] + dir * skyWalkSpeed[k] * t) % skyWalkLoop;
      if (x < 0) x += skyWalkLoop;
      const frame = kit.walkers[k][((t * 3 + k) | 0) & 1];
      for (let wx = x - 40 + Math.ceil((cx - 10 - (x - 40)) / skyWalkLoop) * skyWalkLoop; wx < cx + bw; wx += skyWalkLoop) g.drawImage(frame, wx - cx, horizon - 1);
    }
    for (let k = 0; k < 6; k++) {   // cars on two lanes
      const dir = skyCarDir[k], sp = (dir > 0 ? kit.carsR : kit.carsL)[skyCarCol[k]];
      let x = (skyCarPhase[k] + dir * skyCarSpeed[k] * t) % skyLoop;
      if (x < 0) x += skyLoop;
      const y = horizon + (dir > 0 ? 7 : 15);
      for (let wx = x - 80 + Math.ceil((cx - sp.width - (x - 80)) / skyLoop) * skyLoop; wx < cx + bw; wx += skyLoop) g.drawImage(sp, wx - cx, y);
    }
  }
}

/* roof: cornice over the top plate with its little machines, drawn behind the towers; bare while the top floor is being built or pulled down */
const skyRoofTone = [
  { cor: 'conc', corHi: 'steelL', corLo: 'concD', main: 'steel', hi: 'steelL', lo: 'steelD', wood: 'wood' },
  { cor: 'concD', corHi: 'steel', corLo: 'steelD', main: 'steelD', hi: 'steel', lo: 'night', wood: 'woodD' },
  { cor: 'steelD', corHi: 'steelD', corLo: 'night', main: 'night', hi: 'steelD', lo: 'ink', wood: 'night' },
];
function skyDrawRoof(g, cam, geo, t) {
  const top = FLOORS.length > 0 ? FLOORS[FLOORS.length - 1] : null;
  if (!top || (top.build && top.p < 1)) return;
  const ox = STAIRS_W - cam.x, yb = SKY_H - cam.y, W = geo.plate;
  if (yb < -2 || yb - 46 > cam.bh || ox > cam.bw || ox + W < 0) return;
  const a = nightAlpha(sceneHour()), tn = skyRoofTone[a > 0.45 ? 2 : a > 0.15 ? 1 : 0];
  rect(g, ox - 2, yb - 6, W + 4, 6, tn.cor); rect(g, ox - 2, yb - 6, W + 4, 1, tn.corHi); rect(g, ox - 2, yb - 1, W + 4, 1, tn.corLo);
  rect(g, ox - 2, yb - 7, W + 4, 1, 'ink');
  const ac = ox + W - 132;                                       // two air conditioning units
  for (let k = 0; k < 2; k++) {
    const x = ac + k * 34;
    rect(g, x, yb - 17, 28, 11, 'ink'); rect(g, x + 1, yb - 16, 26, 9, tn.main); rect(g, x + 1, yb - 16, 26, 1, tn.hi);
    rect(g, x + 4, yb - 13, 8, 5, tn.lo); rect(g, x + 16, yb - 13, 8, 5, tn.lo); rect(g, x + 7, yb - 11, 2, 1, tn.hi); rect(g, x + 19, yb - 11, 2, 1, tn.hi);
  }
  const wt = ox + W - 64;                                        // water tank on legs
  rect(g, wt + 2, yb - 12, 2, 6, 'ink'); rect(g, wt + 18, yb - 12, 2, 6, 'ink');
  rect(g, wt, yb - 28, 22, 16, 'ink'); rect(g, wt + 1, yb - 27, 20, 14, tn.wood); rect(g, wt + 1, yb - 27, 20, 1, tn.hi);
  for (let x = wt + 5; x < wt + 20; x += 5) rect(g, x, yb - 26, 1, 12, 'ink');
  rect(g, wt - 1, yb - 22, 24, 1, 'ink'); rect(g, wt - 1, yb - 17, 24, 1, 'ink');
  const an = ox + W - 20;                                        // antenna with its beacon
  rect(g, an, yb - 42, 2, 36, tn.main); rect(g, an - 4, yb - 36, 10, 1, tn.main); rect(g, an - 3, yb - 31, 8, 1, tn.main);
  rect(g, an, yb - 44, 2, 2, ((t * 1.2) | 0) % 2 ? 'red' : 'ink');
  rect(g, ox + 24, yb - 10, 18, 4, tn.main); rect(g, ox + 24, yb - 10, 18, 1, tn.hi); rect(g, ox + 28, yb - 13, 3, 3, tn.lo);
}

/* ------------------------------ night light ------------------------------ */

const skyPoolLevels = [1, 0.74, 0.46, 0.22];     // opacity of the hole at each ring: four steps, no gradient
const skyPoolEdges = [0.38, 0.62, 0.84, 1];      // outer edge of each ring, as a fraction of the radius
const skyPools = new Map();

/** Pool of light of radius r (px): rings of opacity 1, 0.74, 0.46, 0.22, the seam of two rings dithered on a checker, nothing smooth. Baked once per radius. */
function skyPool(r) {
  let c = skyPools.get(r);
  if (c) return c;
  const size = r * 2, b = makeBuffer(size, size), img = b.g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - r + 0.5, y - r + 0.5), f = dist / r;
      let lv = 4;
      for (let i = 0; i < 4; i++) if (f < skyPoolEdges[i]) { lv = i; break; }
      if (lv < 4 && (skyPoolEdges[lv] * r - dist) < 1.2 && ((x + y) & 1) === 1) lv++;
      if (lv < 4) d[(y * size + x) * 4 + 3] = Math.round(skyPoolLevels[lv] * 255);
    }
  }
  b.g.putImageData(img, 0, 0);
  skyPools.set(r, b.c);
  return b.c;
}

let skyMask = null;
function skyMaskFor(w, h) {
  if (!skyMask) skyMask = makeBuffer(w, h);
  else if (skyMask.c.width !== w || skyMask.c.height !== h) { skyMask.c.width = w; skyMask.c.height = h; skyMask.g.imageSmoothingEnabled = false; }
  return skyMask;
}

const skyPlanInfo = new WeakMap();               // plan -> { byDesk: Map(desk id -> light), n, xs, ys (dots of the lit windows) }
function skyInfo(plan) {
  let info = skyPlanInfo.get(plan);
  if (info) return info;
  const byDesk = new Map();
  for (const l of plan.lights) if (l.desk) byDesk.set(l.desk, l);
  const wins = [];                               // [x, w] of the windows of the back wall, as floor.js paints them
  for (const s of plan.spots.window) wins.push([s.x * 8 - 8, 24]);
  for (const o of plan.offices) wins.push([o.rect.x * 8 + 48, 32]);
  if (!plan.offices.length) wins.push([40, 32], [104, 32]);
  const xs = [], ys = [];
  for (const [x, w] of wins) {
    for (let i = 0; i < w; i += 5) {
      const bh = 2 + ((i * 7 + x) % 5);
      if ((i + x) % 3 === 0) { xs.push(x + i + 1); ys.push(13 - bh + 1); }
    }
  }
  info = { byDesk, n: xs.length, xs: Int16Array.from(xs), ys: Int16Array.from(ys) };
  skyPlanInfo.set(plan, info);
  return info;
}

/** Cuts a pool of light into the mask at plan point (x, y) of a plate whose origin is (ox, oy) in buffer px. */
function skyHole(mg, ox, oy, x, y, r) {
  mg.drawImage(skyPool(r), Math.round(ox + x - r), Math.round(oy + y - r));
}

/** Night mask of floor fl (plate and slab): dark at nightAlpha, stepped pools of light at occupied desks, lit places and walkers; lit windows after. */
function applyLight(g, fl, cam, T) {
  const a = nightAlpha(sceneHour());
  const plan = fl.plan;
  if (a <= 0 || !plan) return;
  const ox = STAIRS_W - cam.x, oy = fl.y + fl.dy - cam.y;
  const x0 = Math.max(0, ox), y0 = Math.max(0, oy), x1 = Math.min(cam.bw, ox + plan.width), y1 = Math.min(cam.bh, oy + BLOCK);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const m = skyMaskFor(cam.bw, cam.bh), mg = m.g;
  mg.globalCompositeOperation = 'source-over';
  mg.clearRect(x0, y0, w, h);
  mg.globalAlpha = a;
  mg.fillStyle = palColor('ink');
  mg.fillRect(x0, y0, w, h);
  mg.globalAlpha = 1;
  const info = skyInfo(plan);
  if (a > 0.1) {
    mg.globalCompositeOperation = 'destination-out';
    const people = peopleOnFloor(fl), lights = plan.lights;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p.visible) continue;
      if (p.seated && p.desk) { const l = info.byDesk.get(p.desk.id); if (l) skyHole(mg, ox, oy, l.x, l.y, l.r); } else skyHole(mg, ox, oy, p.x, p.y - 10, 10);
    }
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (l.desk) continue;
      let near = false;
      const rr = l.r * l.r * 4;
      for (let j = 0; j < people.length; j++) {
        const p = people[j];
        if (!p.visible) continue;
        const dx = p.x - l.x, dy = p.y - l.y;
        if (dx * dx + dy * dy < rr) { near = true; break; }
      }
      skyHole(mg, ox, oy, l.x, l.y, near ? l.r : 8);
    }
    mg.globalCompositeOperation = 'source-over';
  }
  g.drawImage(m.c, x0, y0, w, h, x0, y0, w, h);
  if (a > 0.2) {                                   // lit windows of the city seen through the back wall, over the mask
    g.fillStyle = palColor('lamp');
    for (let i = 0; i < info.n; i++) g.fillRect(ox + info.xs[i], oy + info.ys[i], 1, 1);
  }
}
