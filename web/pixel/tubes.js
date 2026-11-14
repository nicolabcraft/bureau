/* web/pixel/tubes.js : lot L9, voir docs/vue-pixel.md (2.9) */
/*
 * The pneumatic tubes of the cutaway, the capsules that travel in them, and the crane. Lot L9, contract in 2.9. Shares one
 * scope with the other web/pixel files: the public names are launchCapsule, tickCapsules, drawCapsules and drawCrane, every
 * other top-level name wears `tub`. Declares only, nothing runs at load. No DOM. Geometry comes from advanced.js (advLay);
 * the colours are the closed palette (the copper of the mock is `pot`, `woodL` and `brick`).
 *
 * Choices recorded here (additions to 2.9, all additive):
 *  - The capsules start on onTalk: the `start` event of a conversation of kind delegate or report. The listener is attached the
 *    first time tickCapsules runs (nothing runs at load). One capsule per conversation (the ids of the last 32 are kept).
 *    The path goes from the nozzle over the desk of parts[0] up to the tube of its floor, along it, down the copper pipe to the
 *    tube of the other floor if there is one, along it and down to the nozzle over the desk of parts[1].
 *  - A delegation capsule is copper, a report capsule is green. 14 capsules at most (the oldest is replaced), the pool is made
 *    once; under reduced motion a capsule is not seen travelling, only the pulse where it arrives.
 *  - tubPaintFloor and tubPaintPipe draw the tubes into the pre-rendered cutaway; tubDrawSite draws what stands around a floor
 *    that is built or pulled down (blueprint, delivery truck, workers); drawCrane draws the tower crane over the building.
 *    The site is a pure function of Floor.p, like build.js: a demolition is the same picture played backwards.
 */

const tubMax = 14;
const tubSpeed = 85;                             // px/s along the tubes
const tubPool = [];                              // capsules, made on first use
const tubPulses = [];                            // arrival marks: { on, x, y, t }
const tubSeen = [];                              // ids of the conversations that already launched one
const tubPos = { x: 0, y: 0, v: false };
const tubPort = { x: 0, f: 0 };
let tubUnsub = null;
let tubStart = 0;                                // order of launch, to find the oldest

function tubInit() {
  if (tubPool.length) return;
  for (let i = 0; i < tubMax; i++) tubPool.push({ on: false, kind: 'delegate', d: 0, len: 0, n: 0, order: 0, x: new Float32Array(8), y: new Float32Array(8), seg: new Float32Array(8) });
  for (let i = 0; i < 8; i++) tubPulses.push({ on: false, x: 0, y: 0, t: 0 });
}

/* ------------------------------ the tubes themselves ------------------------------ */

/** The ceiling tube of one floor, its nozzles over the desks and the junction box: into the pre-rendered cutaway. */
function tubPaintFloor(g, lay, lf) {
  const y = lf.ty, x0 = lay.ix - 2, x1 = lay.pipe + 3;
  rect(g, x0, y + 2, x1 - x0, 3, 'steel'); rect(g, x0, y + 2, x1 - x0, 1, 'steelL'); rect(g, x0, y + 5, x1 - x0, 1, 'ink');
  for (let x = lay.ix + 18; x < x1 - 4; x += 36) { rect(g, x, y + 1, 3, 5, 'pot'); rect(g, x, y + 1, 1, 5, 'woodL'); rect(g, x + 2, y + 1, 1, 5, 'brick'); }
  rect(g, x0, y + 7, x1 - x0, 1, 'ink'); rect(g, x0, y + 6, x1 - x0, 1, 'red');          // cable tray with a red cable
  for (const px of lf.ports) {
    rect(g, px, y + 6, 1, 8, 'steelL'); rect(g, px + 1, y + 6, 1, 8, 'steel');
    rect(g, px - 1, y + 13, 4, 3, 'pot'); rect(g, px - 1, y + 15, 4, 1, 'brick'); rect(g, px, y + 13, 1, 1, 'woodL');
  }
  const cx = lay.ix - 6;                                                                // a wall conduit with a junction box beside the stairs
  rect(g, cx, y + 8, 2, advIH - 11, 'brick'); rect(g, cx, y + 8, 1, advIH - 11, 'pot'); rect(g, cx - 2, y + 24, 6, 5, 'steel'); rect(g, cx - 2, y + 24, 6, 1, 'ink'); rect(g, cx - 1, y + 26, 1, 1, 'steelL');
}

/** The vertical copper pipe from the roof of the highest built floor to the ground, with a collar at every floor. */
function tubPaintPipe(g, lay, top) {
  if (top < 0) return;
  const y0 = lay.floors[top].ty, p = lay.pipe;
  rect(g, p, y0 - 6, 3, lay.gy - y0 + 6, 'brick'); rect(g, p, y0 - 6, 1, lay.gy - y0 + 6, 'pot'); rect(g, p, y0 - 6, 1, 3, 'woodL');
  for (const lf of lay.floors) {
    if (lf.fl.p < 1) continue;
    rect(g, p - 1, lf.ty + 2, 5, 3, 'pot'); rect(g, p - 1, lf.ty + 2, 5, 1, 'woodL'); rect(g, p - 1, lf.ty + 4, 5, 1, 'brick');
  }
}

/* ------------------------------ capsules ------------------------------ */

/** Position (and whether it moves vertically) at distance d of a capsule's path; reused object. */
function tubAt(c, d) {
  let i = 0;
  while (i < c.n - 2 && d > c.seg[i]) { d -= c.seg[i]; i++; }
  const l = c.seg[i], u = l > 0 ? Math.min(1, Math.max(0, d / l)) : 1, o = tubPos;
  o.x = c.x[i] + (c.x[i + 1] - c.x[i]) * u;
  o.y = c.y[i] + (c.y[i + 1] - c.y[i]) * u;
  o.v = c.x[i] === c.x[i + 1];
  return o;
}

/** Where a person's nozzle is: over its desk, else over where it stands now. */
function tubPortOf(p, out) {
  const lay = advLay, fl = p && p.floor;
  if (!lay || !fl) return false;
  const lf = lay.floors[fl.index];
  if (!lf || !lf.ty) return false;
  const dl = p.desk ? lf.desks.get(p.desk.id) : null;
  let x;
  if (dl) x = dl.x;
  else { const r = advRecs.get(p); x = r ? clamp(r.x, lay.ix + 6, lay.e0 - 6) : lay.ix + 40; }
  out.x = x; out.f = fl.index;
  return true;
}

/** Sends a capsule from one person's desk to the other's. kind: 'delegate' | 'report'. */
function launchCapsule(fromPerson, toPerson, kind) {
  tubInit();
  if (!advLay || advStale()) advLayout(FLOORS);
  const lay = advLay;
  if (!tubPortOf(fromPerson, tubPort)) return;
  const ax = tubPort.x, af = tubPort.f;
  if (!tubPortOf(toPerson, tubPort)) return;
  const bx = tubPort.x, bf = tubPort.f;
  let c = null;
  for (const q of tubPool) if (!q.on) { c = q; break; }
  if (!c) { c = tubPool[0]; for (const q of tubPool) if (q.order < c.order) c = q; }
  const ta = lay.floors[af].ty, tb = lay.floors[bf].ty;
  let n = 0;
  const add = (x, y) => { c.x[n] = x; c.y[n] = y; n++; };
  add(ax, ta + 14); add(ax, ta + 3);
  if (af !== bf) { add(lay.pipe + 1, ta + 3); add(lay.pipe + 1, tb + 3); }
  add(bx, tb + 3); add(bx, tb + 14);
  let len = 0;
  for (let i = 1; i < n; i++) { const l = Math.abs(c.x[i] - c.x[i - 1]) + Math.abs(c.y[i] - c.y[i - 1]); c.seg[i - 1] = l; len += l; }
  c.n = n; c.len = len; c.d = 0; c.kind = kind === 'report' ? 'report' : 'delegate'; c.on = true; c.order = ++tubStart;
}

function tubOnTalk(ev) {
  if (ev.type !== 'start') return;
  const cv = ev.conv;
  if (!cv || (cv.kind !== 'delegate' && cv.kind !== 'report') || tubSeen.indexOf(cv.id) >= 0) return;
  tubSeen.push(cv.id);
  if (tubSeen.length > 32) tubSeen.shift();
  if (cv.parts.length >= 2) launchCapsule(cv.parts[0], cv.parts[1], cv.kind);
}

function tubPulse(x, y) {
  for (let i = 0; i < tubPulses.length; i++) { const q = tubPulses[i]; if (!q.on) { q.on = true; q.x = x; q.y = y; q.t = 0.5; return; } }
}

/** Moves the capsules; attaches the talk listener the first time. Costs nothing while no capsule flies. */
function tickCapsules(dt) {
  tubInit();
  if (!tubUnsub && typeof onTalk === 'function') tubUnsub = onTalk(tubOnTalk);
  for (let i = 0; i < tubPool.length; i++) {
    const c = tubPool[i];
    if (!c.on) continue;
    c.d += REDUCED ? c.len : tubSpeed * dt;
    if (c.d >= c.len) { c.on = false; tubPulse(c.x[c.n - 1], c.y[c.n - 1] - 1); }
  }
  for (let i = 0; i < tubPulses.length; i++) { const q = tubPulses[i]; if (q.on && (q.t -= dt) <= 0) q.on = false; }
}

const tubColours = { delegate: ['pot', 'woodL'], report: ['screenD', 'screen'] };

/** True while a capsule flies or a pulse shows. */
function tubBusy() {
  for (let i = 0; i < tubPool.length; i++) if (tubPool[i].on) return true;
  for (let i = 0; i < tubPulses.length; i++) if (tubPulses[i].on) return true;
  return false;
}

function drawCapsules(g, T) {
  for (let i = 0; i < tubPool.length; i++) {
    const c = tubPool[i];
    if (!c.on || REDUCED) continue;
    const col = tubColours[c.kind];
    for (let k = 5; k >= 1; k--) {
      const q = tubAt(c, Math.max(0, c.d - 3 * k));
      rect(g, q.x, q.y, 1, 1, k < 3 ? 'lampHi' : k < 5 ? 'lamp' : 'wood');
    }
    const p = tubAt(c, c.d), x = Math.round(p.x), y = Math.round(p.y);
    if (p.v) { rect(g, x - 3, y - 5, 7, 11, 'white'); rect(g, x - 2, y - 4, 5, 9, 'ink'); rect(g, x - 1, y - 3, 3, 7, col[0]); rect(g, x - 1, y - 3, 1, 7, col[1]); }
    else { rect(g, x - 5, y - 3, 11, 7, 'white'); rect(g, x - 4, y - 2, 9, 5, 'ink'); rect(g, x - 3, y - 1, 7, 3, col[0]); rect(g, x - 3, y - 1, 7, 1, col[1]); }
  }
  for (let i = 0; i < tubPulses.length; i++) { const q = tubPulses[i]; if (q.on) rect(g, Math.round(q.x) - 2, Math.round(q.y) - 1, 5, 3, q.t > 0.25 ? 'lampHi' : 'lamp'); }
}

/* ------------------------------ the site and the crane ------------------------------ */

/** The floor the crane works on: the lowest one that is not built. */
function tubTarget(lay) {
  for (let i = 0; i < lay.floors.length; i++) if (lay.floors[i].fl.p < 1) return lay.floors[i];
  return null;
}

function tubGeom(lay, out) {
  const n = lay.n;
  let hb = -1;
  for (let i = 0; i < n; i++) if (lay.floors[i].fl.p >= 1) hb = i;
  const topBuilt = hb === n - 1;
  out.baseY = hb >= 0 ? lay.floors[hb].ty - 4 : lay.floors[n - 1].ty + advIH;
  out.jibY = topBuilt ? advTop - 28 : advTop;
  out.mastTop = out.jibY - 4;
  return out;
}
const tubG = { baseY: 0, jibY: 0, mastTop: 0 };
const tubHook = { x: 0, y: 0, carry: false, cargo: '' };

/** Hook of the crane: one trip per load, from the pallet in the street to a spot of the floor. t: seconds of the 14 s site. */
function tubHookAt(lay, lf, G, t, st) {
  const f0 = lf.ty, h = tubHook, rest = G.jibY + 8, pick = lay.pickX, ix = lay.ix, iw = lay.iw, gy = lay.gy;
  const trip = (u, tx, ty, restX) => {
    if (u < 0.2) { h.x = restX + (pick - restX) * (u / 0.2); h.y = rest; }
    else if (u < 0.4) { h.x = pick; h.y = rest + (gy + 2 - rest) * ((u - 0.2) / 0.2); }
    else if (u < 0.6) { h.x = pick; h.y = gy + 2 + (ty - 28 - (gy + 2)) * ((u - 0.4) / 0.2); }
    else if (u < 0.8) { h.x = pick + (tx - pick) * ((u - 0.6) / 0.2); h.y = ty - 28; }
    else { h.x = tx; h.y = ty - 28 + 28 * ((u - 0.8) / 0.2); }
    h.carry = u >= 0.4 && u < 1;
  };
  h.carry = false; h.cargo = '';
  if (t < 2.5) { h.x = pick + 60; h.y = rest; }
  else if (t < 4.25) { trip((t - 2.5) / 1.75, ix + 8, f0 + 4, pick + 60); h.cargo = 'columns'; }
  else if (t < 6) { trip((t - 4.25) / 1.75, ix + Math.round(iw * 0.38), f0 + 6, ix + 8); h.cargo = 'beam'; }
  else if (t < 7.5) { h.x = advBX + (lay.wallR - advBX) * st.slab; h.y = f0 + advIH - 22; h.carry = true; h.cargo = 'bucket'; }
  else if (t < 9.5) { h.x = ix + 20 + (iw - 40) * st.wall; h.y = f0 + advIH - 12 - Math.round(36 * st.wall); h.carry = true; h.cargo = 'bricks'; }
  else if (t < 11) { const nw = lf.win.length, j = nw ? Math.min(nw - 1, Math.floor(st.win * nw)) : 0; h.x = (nw ? lf.win[j] : ix + 40) + 6; h.y = f0 + 6; h.carry = true; h.cargo = 'pane'; }
  else if (t < 13) { const u = (t - 11) / 2; trip(u < 0.5 ? u * 2 : (u - 0.5) * 2, ix + Math.round(iw * (u < 0.5 ? 0.3 : 0.72)), f0 + 30, u < 0.5 ? pick + 60 : ix + Math.round(iw * 0.3)); h.cargo = 'crate'; }
  else { h.x = ix + Math.round(iw * 0.72); h.y = rest; }
  return h;
}

function tubCargo(g, kind, x, y) {
  switch (kind) {
    case 'columns': rect(g, x - 8, y, 3, 22, 'steel'); rect(g, x - 5, y, 1, 22, 'ink'); rect(g, x + 5, y, 3, 22, 'steel'); rect(g, x + 8, y, 1, 22, 'ink'); break;
    case 'beam': rect(g, x - 20, y + 2, 40, 4, 'steel'); rect(g, x - 20, y + 2, 40, 1, 'steelL'); rect(g, x - 20, y + 6, 40, 1, 'ink'); for (let k = -18; k < 18; k += 6) rect(g, x + k, y + 3, 1, 1, 'pot'); break;
    case 'bucket': rect(g, x - 6, y, 12, 9, 'ink'); rect(g, x - 5, y + 1, 10, 7, 'conc'); rect(g, x - 5, y + 1, 10, 1, 'steel'); rect(g, x - 2, y + 9, 4, 2, 'conc'); break;
    case 'bricks': rect(g, x - 8, y + 7, 16, 2, 'woodD'); rect(g, x - 7, y, 14, 7, 'ink'); for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) rect(g, x - 6 + c * 3 + (r & 1), y + 1 + r * 2, 2, 1, 'brick'); break;
    case 'pane': rect(g, x - 6, y, 12, 15, 'steelL'); rect(g, x - 5, y + 1, 10, 13, 'glass'); rect(g, x - 4, y + 2, 2, 1, 'white'); break;
    case 'crate': rect(g, x - 7, y, 14, 12, 'ink'); rect(g, x - 6, y + 1, 12, 10, 'wood'); rect(g, x - 6, y + 5, 12, 1, 'woodD'); rect(g, x - 6, y + 1, 2, 10, 'lamp'); break;
    default: break;
  }
}

let tubWorkerSheet = null;

/** What stands around a floor being built or pulled down: the blueprint, the delivery truck, two workers. */
function tubDrawSite(g, lay, T) {
  const target = tubTarget(lay);
  for (let f = 0; f < lay.floors.length; f++) {
    const lf = lay.floors[f], fl = lf.fl;
    if (fl.p >= 1) continue;
    const st = advSt, t = Math.max(0, Math.min(1, fl.p)) * 14, y = lf.ty;
    advStage(fl.p);
    // the delivery truck, in the street: arrives at the start, leaves at the end
    if (lf === target) {
      const gone = t > 13, enter = Math.min(1, t / 1.2);
      const x = Math.round(-60 + (lay.ix + 80) * (gone ? 1 : enter) + (gone ? (t - 13) * 70 : 0)), ty = lay.gy + 22;
      rect(g, x, ty - 16, 44, 14, 'ink'); rect(g, x + 1, ty - 15, 30, 12, 'pot'); rect(g, x + 1, ty - 15, 30, 1, 'woodL'); rect(g, x + 31, ty - 15, 12, 12, 'conc'); rect(g, x + 36, ty - 13, 6, 5, 'glass');
      rect(g, x + 6, ty - 5, 7, 7, 'ink'); rect(g, x + 33, ty - 5, 7, 7, 'ink'); rect(g, x + 8, ty - 3, 3, 3, 'steelL'); rect(g, x + 35, ty - 3, 3, 3, 'steelL');
      if (t < 12.2) { rect(g, x + 2, ty - 21, 16, 5, 'wood'); rect(g, x + 2, ty - 17, 16, 1, 'woodD'); }
    }
    if (st.cols >= 1 && st.furn < 1) {
      if (!tubWorkerSheet) tubWorkerSheet = bakeSheet(WORKER_LOOK, null);
      for (let k = 0; k < 2; k++) {
        const x = k === 0 ? lay.ix + 60 + Math.round(st.wall * 60) : lay.ix + Math.round(lay.iw * 0.75) - Math.round(st.win * 70);
        const fr = ((T * 3 + k) | 0) & 1 ? FRAME.side : FRAME.side + 1 + ((T * 8) | 0) % 4;
        drawSprite(g, tubWorkerSheet, REDUCED ? FRAME.side : fr, x, y + 49, k === 1);
      }
    }
  }
}

/** A line of the blueprint, cut where the sheet has not been drawn yet (x of its edge: xe). */
function tubLine(g, xe, x, y, w, h, c) {
  if (x < xe) rect(g, x, y, Math.min(w, xe - x), h, c);
}

/** The plan of a floor to come: a blue sheet that is drawn from the left, its outlines and the desks. */
function tubBlueprint(g, lay, lf, p) {
  if (p <= 0) return;
  const y = lf.ty, x0 = advBX, wTotal = lay.wallR + 3 - x0, w = Math.round(wTotal * p), xe = x0 + w;
  rect(g, x0, y - 2, w, advFH + 2, 'carpB');
  for (let gx = x0 - (x0 % 8) + 8; gx < xe; gx += 8) for (let gy = y + 8 - ((y + 8) % 8) + 8; gy < y + advFH; gy += 8) rect(g, gx, gy, 1, 1, 'carpA');
  tubLine(g, xe, lay.ix, y + 8, lay.iw, 1, 'steelL'); tubLine(g, xe, lay.ix, y, lay.iw + 50, 1, 'glass'); tubLine(g, xe, lay.ix, y + advIH, lay.iw + 50, 1, 'glass'); tubLine(g, xe, advBX, y + advIH + 3, wTotal, 1, 'glass');
  tubLine(g, xe, lay.ix - 1, y, 1, advIH, 'glass'); tubLine(g, xe, lay.stairX0, y, 1, advIH, 'glass'); tubLine(g, xe, lay.e0, y, 1, advIH, 'glass'); tubLine(g, xe, lay.wallR, y, 1, advIH, 'glass');
  for (let d = 0; d < lf.deskList.length; d++) {
    const ux = lf.deskList[d].ux;
    tubLine(g, xe, ux + 2, y + 40, 9, 1, 'steelL'); tubLine(g, xe, ux + 2, y + 40, 1, 6, 'steelL'); tubLine(g, xe, ux + 10, y + 40, 1, 6, 'steelL');
  }
  if (xe < x0 + wTotal) rect(g, xe, y - 2, 1, advFH + 2, 'lampHi');
}

/** The tower crane: mast on the roof of the highest built floor, jib over the floor being worked on, hook and load. */
function drawCrane(g, T) {
  const lay = advLay;
  if (!lay || !lay.n) return;
  const lf = tubTarget(lay);
  if (!lf) return;
  const G = tubGeom(lay, tubG), st = advStage(lf.fl.p), t = Math.max(0, Math.min(1, lf.fl.p)) * 14, h = tubHookAt(lay, lf, G, t, st);
  const mx = lay.craneX, pick = lay.pickX, jy = G.jibY, tick = REDUCED ? 0 : (T * 60) | 0;
  rect(g, mx - 2, G.mastTop, 5, G.baseY - G.mastTop, 'steelD');
  for (let y = G.mastTop + 3; y < G.baseY - 2; y += 6) { rect(g, mx - 2, y, 5, 1, 'steel'); rect(g, mx - 1, y + 1, 1, 4, 'ink'); rect(g, mx + 1, y + 1, 1, 4, 'ink'); }
  rect(g, mx - 8, G.baseY - 6, 17, 6, 'pot'); rect(g, mx - 8, G.baseY - 1, 17, 1, 'brick');
  const jl = mx + 14 - pick + 8;
  rect(g, pick - 8, jy, jl, 3, 'pot'); rect(g, pick - 8, jy, jl, 1, 'woodL');
  for (let x = pick - 4; x < mx - 4; x += 6) { rect(g, x, jy + 3, 1, 3, 'brick'); rect(g, x + 3, jy + 4, 1, 2, 'brick'); }
  rect(g, mx + 4, jy + 3, 9, 5, 'conc'); rect(g, mx + 4, jy + 3, 9, 1, 'ink'); rect(g, mx + 3, jy - 6, 5, 8, 'ink'); rect(g, mx + 4, jy - 5, 3, 2, 'lamp');
  rect(g, mx, G.mastTop - 2, 1, (tick & 8) ? 2 : 1, 'red');
  const hx = Math.round(h.x), hy = Math.round(h.y);
  rect(g, hx, jy + 3, 1, Math.max(0, hy - jy - 3), 'steelL'); rect(g, hx - 1, jy + 3, 3, 2, 'ink'); rect(g, hx - 1, hy, 3, 3, 'pot');
  if (h.carry) tubCargo(g, h.cargo, hx, hy + 3);
}
