/* web/immeuble/chantier.js: part of the building view, owned by the « immeuble » module (see docs/vue-immeuble.md). */
/* ================================================================ crane */
function craneState(fl, tt){
  const p = fl.plot, z0 = fl.z0, Zc = z0 + 112, P = p.pallet;
  let hx = P.x, hy = P.y, hz = 118, load = null;
  for(const c of p.cycles){
    if(tt < c.t0 || tt >= c.t0 + c.dur) continue;
    const u = (tt - c.t0) / c.dur;
    const mv = eio(clamp((u - .34) / .36, 0, 1)), back = eio(clamp((u - .86) / .14, 0, 1));
    if(u < .86){ hx = lerp(P.x, c.tx, mv); hy = lerp(P.y, c.ty, mv); } else { hx = lerp(c.tx, P.x, back); hy = lerp(c.ty, P.y, back); }
    if(u < .18) hz = lerp(118, 12, eio(u / .18));
    else if(u < .34) hz = lerp(12, Zc, eio((u - .18) / .16));
    else if(u < .7) hz = Zc + Math.sin(((u - .34) / .36) * Math.PI) * 8;
    else if(u < .86) hz = lerp(Zc, z0 + 22, eio((u - .7) / .16));
    else hz = lerp(z0 + 22, 118, back);
    if(u >= .18 && u < .84) load = c.kind;
    return {hx, hy, hz, load};
  }
  return {hx, hy, hz, load};
}
const craneMastP = (tt) => tt < 300 ? 0 : tt < 1200 ? eo3((tt - 300) / 900) : tt < 9900 ? 1 : 1 - eio(clamp((tt - 9900) / 900, 0, 1));
function drawCraneBase(fl){
  const p = fl.plot, tt = T - p.start, mp = craneMastP(tt); if(mp <= 0) return;
  const m = p.mast, H = (fl.z0 + 170) * mp, w = .5, P = p.pallet;
  ZB = 0;
  if(tt < 9000){
    box(P.x - .9, P.y - .9, 1.8, 1.8, 0, 5, '#8a6a46');
    const cyc = p.cycles;
    const rT = 4 - cyc.slice(0, 4).filter((c) => tt > c.t0 + c.dur * .2).length; if(rT > 0) box(P.x - .8, P.y - .8, 1.6, 1.6, 5, 5 * rT, '#4a556b');
    const rW = 2 - cyc.slice(4, 6).filter((c) => tt > c.t0 + c.dur * .2).length; if(rW > 0) box(P.x - .5, P.y + 1.1, 1.0, .4, 0, 28, '#e8ecf2');
    const rC = 2 - cyc.slice(6, 8).filter((c) => tt > c.t0 + c.dur * .2).length; if(rC > 0) box(P.x + 1.2, P.y - .7, 1.2, 1.2, 0, 14 * rC, '#9A6B4B');
  }
  const fx = m.x - w / 2, fy = m.y - w / 2;
  box(fx - .3, fy - .3, w + .6, w + .6, 0, 8, '#555f73');
  const C = [[fx, fy], [fx + w, fy], [fx + w, fy + w], [fx, fy + w]];
  for(const c of C) line(pp(c[0], c[1], 8), pp(c[0], c[1], H), '#F0C36A', 2.2);
  const faces = [];
  if(FV.py) faces.push([C[3], C[2]]); if(FV.my) faces.push([C[0], C[1]]); if(FV.px) faces.push([C[1], C[2]]); if(FV.mx) faces.push([C[0], C[3]]);
  const seg = 18;
  for(const f of faces) for(let z = 8; z < H - seg; z += seg){
    line(pp(f[0][0], f[0][1], z), pp(f[1][0], f[1][1], z + seg), '#F0C36A', 1.1);
    line(pp(f[1][0], f[1][1], z), pp(f[0][0], f[0][1], z + seg), '#d6a84f', 1.1);
  }
}
function drawCraneTop(fl){
  const p = fl.plot, tt = T - p.start, mp = craneMastP(tt); if(mp <= .02) return;
  ZB = 0;
  const m = p.mast, H = (fl.z0 + 170) * mp, st = craneState(fl, tt);
  const dx = st.hx - m.x, dy = st.hy - m.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
  const L = 14, CL = 3.4;
  const tip = pp(m.x + ux * L, m.y + uy * L, H), ctip = pp(m.x - ux * CL, m.y - uy * CL, H), mt = pp(m.x, m.y, H);
  const tip2 = pp(m.x + ux * L, m.y + uy * L, H - 8), ctip2 = pp(m.x - ux * CL, m.y - uy * CL, H - 8);
  box(m.x - ux * CL - .4, m.y - uy * CL - .4, .8, .8, H - 16, 14, '#6e7686');
  line(ctip, tip, '#F0C36A', 3.6); line(ctip2, tip2, '#d6a84f', 1.8);
  const n = 14;
  for(let i = 0; i < n; i++){ const t0 = i / n, t1 = (i + 1) / n; line([lerp(ctip[0], tip[0], t0), lerp(ctip[1], tip[1], t0)], [lerp(ctip2[0], tip2[0], t1), lerp(ctip2[1], tip2[1], t1)], 'rgba(240,195,106,.75)', 1); }
  const apex = pp(m.x, m.y, H + 34); line(mt, apex, '#F0C36A', 2.6);
  line(apex, pp(m.x + ux * L * .62, m.y + uy * L * .62, H), 'rgba(232,236,242,.75)', 1); line(apex, pp(m.x - ux * CL * .9, m.y - uy * CL * .9, H), 'rgba(232,236,242,.75)', 1);
  box(m.x - .35, m.y - .35, .7, .7, H - 6, 10, '#3d4658');
  const trd = clamp(dist, 1.6, L - .6), tr = pp(m.x + ux * trd, m.y + uy * trd, H - 3);
  box(m.x + ux * trd - .25, m.y + uy * trd - .25, .5, .5, H - 8, 5, '#2a303d');
  const hk = pp(st.hx, st.hy, st.hz);
  line(tr, hk, 'rgba(232,236,242,.85)', 1.2); g.fillStyle = '#E0645A'; g.fillRect(hk[0] - 3, hk[1] - 1, 6, 5);
  if(st.load === 'tiles'){ box(st.hx - .8, st.hy - .8, 1.6, 1.6, st.hz - 12, 5, '#4a556b'); line(hk, pp(st.hx - .7, st.hy - .7, st.hz - 4), '#d6a84f', 1); line(hk, pp(st.hx + .7, st.hy + .7, st.hz - 4), '#d6a84f', 1); }
  else if(st.load === 'walls') box(st.hx - .5, st.hy - .1, 1.0, .2, st.hz - 32, 28, '#e8ecf2');
  else if(st.load === 'crates'){ box(st.hx - .55, st.hy - .55, 1.1, 1.1, st.hz - 22, 15, '#9A6B4B'); line(hk, pp(st.hx - .5, st.hy - .5, st.hz - 7), '#d6a84f', 1); line(hk, pp(st.hx + .5, st.hy + .5, st.hz - 7), '#d6a84f', 1); }
  if(reduced || Math.floor(T / 500) % 2){ g.fillStyle = '#ff6a5a'; const b = pp(m.x, m.y, H + 36); g.beginPath(); g.arc(b[0], b[1] - 2, 2.4, 0, 7); g.fill(); }
}
function drawGuard(fl){
  // guard rails and sign along the open edges of a floor under construction
  const p = fl.plot, tt = T - p.start; if(tt > 9800) return;
  const e = clamp(tt / 500, 0, 1) * (1 - clamp((tt - 9500) / 300, 0, 1)); if(e <= .01) return;
  g.globalAlpha = e;
  const post = (x, y) => { line(pp(x, y, 0), pp(x, y, 14), '#cdd5e2', 2); line(pp(x, y, 8), pp(x, y, 14), '#E0645A', 2.2); };
  for(let x = 0; x <= W; x += 1.25) post(x, D + .35);
  for(let y = 0; y <= D; y += 1.6) post(W + .3, y);
  line(pp(0, D + .35, 12), pp(W, D + .35, 12), '#F0C36A', 1.6); line(pp(W + .3, D + .35, 12), pp(W + .3, 0, 12), '#F0C36A', 1.6);
  const yy = D + .36;
  if(FV.py){ poly(quadY(.6, 5.2, yy, 14, 30), '#1b2230', '#F0C36A'); textOn('Chantier : ' + (fl.name.length > 30 ? fl.name.slice(0, 29) + '…' : fl.name), .6, yy, 1, 0, 4.6, .2, 20.5, 7.6, '#F0C36A', 700); }
  g.globalAlpha = 1;
}
function drawZoneGuard(fl, z){
  // barrier and sign around a zone that is being built on an existing floor
  const p = z.plot, tt = T - p.start; if(tt > p.dur) return;
  const e = clamp(tt / 450, 0, 1) * (1 - clamp((tt - (p.dur - 700)) / 500, 0, 1)); if(e <= .01) return;
  const x0 = z.x0, y0 = z.y0, x1 = z.x0 + ZW, y1 = z.row === 'back' ? z.y0 + ZD : D;
  g.globalAlpha = e;
  const post = (x, y) => { line(pp(x, y, 0), pp(x, y, 14), '#cdd5e2', 2); line(pp(x, y, 8), pp(x, y, 14), '#E0645A', 2.2); };
  // the sides that look into the corridor and the neighbours (the outer walls need none)
  const sides = z.row === 'back' ? [[x0, y1, x1, y1], [x1, y0, x1, y1]] : [[x0, y0, x1, y0], [x1, y0, x1, y1]];
  for(const s of sides){
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.round(len / 1.25));
    for(let k = 0; k <= n; k++) post(lerp(s[0], s[2], k / n), lerp(s[1], s[3], k / n));
    line(pp(s[0], s[1], 12), pp(s[2], s[3], 12), '#F0C36A', 1.6);
  }
  if(FV.py){
    const yy = (z.row === 'back' ? y1 : y1) + .02, xs = x0 + .3;
    if(z.row === 'back'){ poly(quadY(xs, xs + 4.4, yy, 14, 30), '#1b2230', '#F0C36A'); textOn('Chantier : ' + (z.name.length > 22 ? z.name.slice(0, 21) + '…' : z.name), xs, yy, 1, 0, 4.4, .2, 20.5, 7.6, '#F0C36A', 700); }
  }
  g.globalAlpha = 1;
}

/* ================================================================ demolition: the chantier of a floor, played backwards */
/* A floor is taken down by running its own chantier clock back: fl.plot.start moves forward twice as fast as T, so
   T - plot.start goes from the end of the chantier (windows dark, barrier and crane come in, the furniture and the walls
   go in the reverse order of their building, the slab is the last to leave) down to 0. Every drawing already follows that
   clock, so none of it is written twice. The ground floor is the entrance of the building: it is never demolished.
     demolishFloor(fl, animate) -> boolean   // false: not possible now (ground floor, chantier under way); true: under way or done
     reviveFloor(fl) -> boolean               // the project came back: the chantier goes on forward, finishFloor ends it
     floorEmpty(fl) -> boolean                // nobody is left on the floor and its windows are dark: it may be demolished */
const DEMO_LEN = 10800;       // length of a floor chantier: moteur.js ends it at that time
const DROP_MS = 1100;         // the floors above come down by one floor height in that time
let dropT = -1, dropR = 0, dropLeft = 0;   // dropT < 0: nothing falls; dropR: first floor that falls; dropLeft: 1 -> 0

function mkPlot(started){
  const p = {started, done: false, start: started ? T : 0, act: [], cycles: [], workers: [], spawned: false, spawnAt: 1000, rev: false};
  const tl = (t0, dur, kind, tx, ty) => p.cycles.push({t0, dur, kind, tx, ty});
  for(let k = 0; k < 4; k++) tl(1500 + 850 * k, 850, 'tiles', 7.5, 4 * k + 2);
  tl(5000, 700, 'walls', 7.5, .4); tl(5700, 700, 'walls', 7.5, 15.5);
  tl(7200, 800, 'crates', 7.5, 3.5); tl(8000, 800, 'crates', 7.5, 12);
  p.mast = {x: W + 1.2, y: 5.5}; p.pallet = {x: W + 3, y: 10};
  return p;
}

function floorEmpty(fl){
  for(let i = 0; i < agents.length; i++){ const a = agents[i]; if(a.role !== 'worker' && (a.hf === fl.i || a.fl === fl.i)) return false; }
  return reduced || fl.actS < .03;
}

function demolishFloor(fl, animate){
  if(!fl || fl.i <= 0 || floors[fl.i] !== fl) return false;
  if(fl.plot && fl.plot.rev) return true;
  if(!animate || reduced){ removeFloor(fl, false); return true; }
  if(fl.plot && !fl.plot.done) return false;
  for(let k = 0; k < fl.zones.length; k++){ const zp = fl.zones[k].plot; if(zp && !zp.done) return false; }
  const p = fl.plot || (fl.plot = mkPlot(true));
  p.started = true; p.done = false; p.rev = true; p.spawned = true; p.start = T - DEMO_LEN;
  // Everything on the floor follows the clock of this plot, whatever chantier (or none) put it there.
  for(let k = 0; k < fl.st.length; k++) fl.st[k].pl = p;
  for(let k = 0; k < fl.sh.length; k++) fl.sh[k].pl = p;
  return true;
}
function reviveFloor(fl){
  const p = fl && fl.plot;
  if(!p || !p.rev) return false;
  p.rev = false;
  return true;
}
/* once per frame for a floor in demolition: true when the floor has left the building */
function stepDemolition(fl, dt){
  const p = fl.plot;
  p.start += 2 * dt;
  if(T - p.start > 0) return false;
  removeFloor(fl, true);
  return true;
}

function releaseFloor(fl){
  const set = fl.bmp; fl.bmp = null;
  if(set) for(const n in set){ set[n].cv.width = 1; set[n].cv.height = 1; }
}
/* The floor leaves `floors`; what pointed at a floor above it (index, height, agents on the move, lift, roof) follows it
   down by one. animate: the floors above start one floor height too high and come down (stepDrop). */
function removeFloor(fl, animate){
  const r = fl.i;
  if(r <= 0 || floors[r] !== fl) return;
  endDrop();
  if(fl.plot) for(const w of fl.plot.workers) if(w.alive) removeAgent(w);
  floors.splice(r, 1);
  releaseFloor(fl);
  const fall = animate && !reduced && r < floors.length;
  for(let k = r; k < floors.length; k++){ const f = floors[k]; f.i = k; f.drop = fall ? FHt : 0; f.z0 = k * FHt + f.drop; f.sortN = -1; }
  dropT = fall ? 0 : -1; dropR = r; dropLeft = 1;
  for(let i = 0; i < agents.length; i++){
    const a = agents[i];
    if(a.fl >= r) a.fl--;   // (nobody should be on the floor gone; if one is, it lands on the floor below)
    if(a.hf >= r) a.hf--;
    if(a.planHf > r) a.planHf--;
    const c = a.cur; if(c && c.t === 'ride' && c.to > r) c.to--;
    for(let q = 0; q < a.plan.length; q++){ const s = a.plan[q]; if(s.t === 'ride' && s.to > r) s.to--; }
  }
  if(EL.cur > r) EL.cur--;
  if(EL.target > r) EL.target--;
  if(ROOF.host > r) ROOF.host--;
  for(let i = particles.length - 1; i >= 0; i--){ const q = particles[i]; if(q.f === r) particles.splice(i, 1); else if(q.f > r) q.f--; }
  if(typeof floorRemoved === 'function') floorRemoved(r);
  if(typeof floorDemolished === 'function') floorDemolished(fl);
}
function endDrop(){
  if(dropT < 0) return;
  for(let i = 0; i < floors.length; i++){ const f = floors[i]; f.drop = 0; f.z0 = i * FHt; }
  dropT = -1;
}
/* the floors above a demolished one come down, once per frame; then the data module may start the next chantier */
function stepDrop(dt){
  if(dropT < 0) return;
  dropT += dt;
  const k = clamp(dropT / DROP_MS, 0, 1);
  dropLeft = 1 - eio(k);
  for(let i = dropR; i < floors.length; i++){ const f = floors[i]; if(f.drop > 0){ f.drop = FHt * dropLeft; f.z0 = i * FHt + f.drop; } }
  if(k >= 1){ endDrop(); if(typeof syncScene === 'function') syncScene(); }
}
/* the lift cabin rides with the floors that are still coming down (EL.z is set from EL.cur by agents.js each frame) */
function dropCab(){ return dropT < 0 ? 0 : FHt * dropLeft * clamp(EL.cur - (dropR - 1), 0, 1); }
