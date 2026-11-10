/* web/immeuble/moteur.js: part of the building view, owned by the « moteur » module (see docs/vue-immeuble.md). */
/* ================================================================ scene state */
const cv = $('#cv'), ctx = cv.getContext('2d', {alpha: false}), layer2 = document.createElement('canvas');
const g2 = layer2.getContext('2d');
g = ctx;
let cw = 800, ch = 500, dpr = 1, layerStale = true;
const cam = {z: .5, px: 0, py: 0}, camT = {z: .5, px: 0, py: 0};
let autoFit = true, focus = -1, hover = null;
const ZMAX = 3.4;
let ZMIN = .22;                       // lowered by zoomFloor() when the whole building would not fit at .22
const PXMAX = 1e5;                    // the camera never wanders further than this from the building (px)
let activeF = null;                   // the floor under construction, refreshed once per frame
function activeFloor(){
  for(let i = 0; i < floors.length; i++){ const p = floors[i].plot; if(p && p.started && !p.done) return floors[i]; }
  return null;
}
let resizeDue = true;
// device pixel ratio cap: a very large canvas costs more fill than the scene is worth
const MAXPX = 4.4e6;
function resize(){
  resizeDue = false;
  const r = $('#scene').getBoundingClientRect();
  const nw = Math.max(200, r.width), nh = Math.max(200, r.height);
  const nd = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAXPX / (nw * nh)));
  if(nw === cw && nh === ch && nd === dpr && cv.width) return;
  cw = nw; ch = nh; dpr = nd;
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  layerStale = true;                   // the tint layer is sized on first use (see passBegin)
  // only the size changed (a card opens, the window moves): no jump. Framed views reframe softly; a free camera keeps its offset
  // from the centre of the canvas, so the point looked at stays in the middle.
  if(autoFit) fitNow(false);
}

/* ---- framing: the box of what we look at, fitted in the free part of the canvas (no allocation) */
const FITB = {x0: 0, x1: 0, y0: 0, y1: 0}, FITO = {z: .5, px: 0, py: 0}, USE = {l: 238, r: 60, t: 12, b: 12};
function fitAdd(x, y, z){ const p = pp(x, y, z); if(p[0] < FITB.x0) FITB.x0 = p[0]; if(p[0] > FITB.x1) FITB.x1 = p[0]; if(p[1] < FITB.y0) FITB.y0 = p[1]; if(p[1] > FITB.y1) FITB.y1 = p[1]; }
function fitBox(f, ap){
  const sB = ZB, sL = ZL; ZB = 0; ZL = 0;
  const nf = Math.max(1, floors.length);
  let zlo = -14, zhi;
  if(f >= 0 && floors[f]){ zlo = floors[f].z0 - 14; zhi = floors[f].z0 + BH + 12; }
  else zhi = (nf - 1) * FHt + BH + 16;
  FITB.x0 = 1e9; FITB.x1 = -1e9; FITB.y0 = 1e9; FITB.y1 = -1e9;
  for(let k = 0; k < 2; k++){
    const z = k ? zhi : zlo;
    fitAdd(-3, -3, z); fitAdd(W + 3, -3, z); fitAdd(W + 3, D + 3.6, z); fitAdd(-3, D + 3.6, z);
  }
  if(ap){ const m = ap.plot.mast; fitAdd(m.x, m.y, ap.z0 + 220); fitAdd(m.x + 3, m.y + 5, 0); }
  ZB = sB; ZL = sL;
  return FITB;
}
function usable(){
  if(cw > 700){ USE.l = 238; USE.r = 60; USE.t = 12; USE.b = 12; }
  else { USE.l = 8; USE.r = 54; USE.t = 86; USE.b = 8; }
  return USE;
}
/* the zoom and offset that frame the floor f (-1: the whole building), written in FITO */
function fitFor(f, ap){
  const b = fitBox(f, ap), u = usable();
  const aw = Math.max(40, cw - u.l - u.r), ah = Math.max(40, ch - u.t - u.b);
  const zf = Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0)) * .97;
  FITO.z = clamp(zf, ZMIN, ZMAX);
  FITO.px = (u.l + aw / 2) - cw / 2 - (b.x0 + b.x1) / 2 * FITO.z;
  FITO.py = (u.t + ah / 2) - ch / 2 - (b.y0 + b.y1) / 2 * FITO.z;
  return zf;
}
/* the lowest zoom: the whole building fits with some air, whatever the number of floors */
let zminN = -1, zminW = 0, zminH = 0;
function zoomFloor(){
  if(floors.length === zminN && cw === zminW && ch === zminH) return;
  zminN = floors.length; zminW = cw; zminH = ch; ZMIN = .22;
  const zf = fitFor(-1, null);
  ZMIN = clamp(zf * .8, .05, .22);
}
function fitNow(snap){
  zoomFloor();
  fitFor(focus, activeF || activeFloor());
  camT.z = FITO.z; camT.px = FITO.px; camT.py = FITO.py;
  if(snap || reduced){ cam.z = camT.z; cam.px = camT.px; cam.py = camT.py; }
}
function notifyFloor(){
  const cb = window.Immeuble && window.Immeuble.surEtage;
  if(typeof cb !== 'function') return;
  const fl = focus >= 0 ? floors[focus] : null;
  try { cb(fl && fl.id != null ? fl.id : null); } catch(err){ console.error(err); }
}
/* a floor left the building (chantier.js, removeFloor): the floors above it have moved down one place. If the one we looked
   at is gone we go back to the overview; else the same floor stays open under its new number, and the frame follows. */
function floorRemoved(r){
  if(focus === r){ setFocus(-1); return; }
  if(focus > r) focus--;
  fitNow(false); buildPanel(); updateUI(true);
}
function setFocus(f){
  f = f >= 0 && f < floors.length ? f | 0 : -1;
  const changed = f !== focus;
  focus = f; autoFit = true; fitNow(false); buildPanel(); updateUI(true);
  if(f >= 0 && changed) toast('Étage ' + (f + 1) + ' : ' + floors[f].name, 1800);
  if(changed) notifyFloor();
}
function goFloor(d){
  if(!floors.length) return;
  setFocus(focus < 0 ? (d > 0 ? floors.length - 1 : 0) : clamp(focus + d, 0, floors.length - 1));
}
function rotateBy(q){ RAt += q * Math.PI / 2; if(reduced) RA = RAt; }
function snapCam(){ if(reduced){ cam.z = camT.z; cam.px = camT.px; cam.py = camT.py; } }
function zoomBy(k, mxp, myp){
  autoFit = false;
  const cx = mxp == null ? cw / 2 : mxp, cy = myp == null ? ch / 2 : myp;
  const wx = (cx - cw / 2 - camT.px) / camT.z, wy = (cy - ch / 2 - camT.py) / camT.z;
  camT.z = clamp(camT.z * k, ZMIN, ZMAX);
  camT.px = cx - cw / 2 - wx * camT.z; camT.py = cy - ch / 2 - wy * camT.z;
  snapCam();
}
function panBy(dx, dy){
  autoFit = false;
  camT.px = clamp(camT.px + dx, -PXMAX, PXMAX); camT.py = clamp(camT.py + dy, -PXMAX, PXMAX);
  snapCam();
}
/* open the floor of an agent and centre the camera on it; returns false when the agent is unknown */
function centreOnAgent(a){
  const fl = floors[a.fl]; if(!fl) return false;
  const was = focus;
  if(focus !== a.fl) setFocus(a.fl);
  zoomFloor(); fitFor(focus, null);
  const z = was === a.fl ? Math.max(camT.z, FITO.z) : Math.min(ZMAX, FITO.z * 1.25);
  const u = usable(), sB = ZB, sL = ZL;
  ZB = a.inCab ? EL.z : fl.z0; ZL = fl.lift;
  const p = pp(a.x, a.y, 14);
  ZB = sB; ZL = sL;
  autoFit = false;
  camT.z = z;
  camT.px = (u.l + (cw - u.l - u.r) / 2) - cw / 2 - p[0] * z;
  camT.py = (u.t + (ch - u.t - u.b) / 2) - ch / 2 - p[1] * z;
  snapCam();
  return true;
}

/* ================================================================ level of detail */
/* LOW (read by the floors and the agents) switches at a zoom that rises with the agents of the open floor:
   many small people on a floor are unreadable and expensive, so the simple drawings come sooner. Hysteresis stops flicker. */
const LOD = {low: false, open: 0, thr: .62};
function updateLod(){
  let n = 0;
  for(let i = 0; i < floors.length; i++){ const f = floors[i]; if(f.op > .5) n += f.ag.length; }
  LOD.open = n;
  LOD.thr = .62 + Math.min(.24, Math.max(0, n - 10) * .012);
  LOD.low = cam.z < (LOD.low ? LOD.thr * 1.04 : LOD.thr * .96);
  LOW = LOD.low;
}

/* ================================================================ update */
let lastUI = 0, evOff = false;
function update(dt){
  T += dt;
  // chantiers and demolitions; demoI: the floor being taken down (-1: none), the ones above it are put away like above an open floor
  let demoI = -1;
  for(let i = 0; i < floors.length; i++){
    const fl = floors[i], p = fl.plot; if(!p || !p.started || p.done) continue;
    if(p.rev){ if(stepDemolition(fl, dt)) i--; else demoI = i; continue; }
    const tt = T - p.start;
    if(!p.spawned && tt >= p.spawnAt){ p.spawned = true; if(typeof spawnWorkers === 'function') spawnWorkers(fl); }
    if(tt >= DEMO_LEN && typeof finishFloor === 'function') finishFloor(fl, false);
  }
  stepDrop(dt);
  const nf = floors.length;
  activeF = activeFloor(); zoomFloor();
  updateElevator(dt); EL.z += dropCab();
  for(let ai = agents.length - 1; ai >= 0; ai--){
    const a = agents[ai];
    if(a.role === 'worker' && a.delay > 0){ a.delay -= dt; if(a.delay > 0) continue; }
    if(!a.leaving) a.alpha = Math.min(1, a.alpha + dt / 420);
    else if(a.path && a.path.length < 3) a.alpha = Math.max(0, a.alpha - dt / 500);
    stepAgent(a, dt);
  }
  let near = false;
  nearC.length = nf; nearC.fill(false);
  for(let i = 0; i < agents.length; i++){ const a = agents[i]; if(a.alpha <= 0 || a.inCab) continue; if(a.fl === 0 && Math.hypot(a.x - (DOORX + 1), a.y - D) < 2.1) near = true; const of = floors[a.fl], dp = of && of.office && of.office.doorPt; if(Math.hypot(a.x - (dp ? dp[0] : 3.5), a.y - (dp ? dp[1] : 7)) < 1.6) nearC[a.fl] = true; }
  const k = 1 - Math.exp(-dt / 140);
  doorState.open += ((reduced ? 0 : near ? 1 : 0) - doorState.open) * k;
  for(let i = 0; i < nf; i++){ const f = floors[i]; f.dc = (f.dc || 0) + ((reduced ? 0 : nearC[i] ? 1 : 0) - (f.dc || 0)) * k; }
  for(let i = 0; i < nf; i++){ const f = floors[i]; if(reduced || f.op < .5 || Math.random() >= dt / 200) continue; const q = f.cof || (f.cof = f.fix.find((x) => x.kind === 'coffee')); if(q) particles.push({f: f.i, x: q.x + .1, y: q.y + .05, z: 38, vx: 0, vy: 0, vz: 16, life: 0, max: 1300, col: 'rgba(255,255,255,.5)', size: 2.4, steam: true}); }
  for(let i = particles.length - 1; i >= 0; i--){ const q = particles[i]; q.life += dt; q.x += (q.vx || 0) * dt / 1000; q.y += (q.vy || 0) * dt / 1000; q.z += q.vz * dt / 1000; if(!q.steam) q.vz -= 120 * dt / 1000; if(q.life > q.max) particles.splice(i, 1); }
  updateCars(dt);
  if(fast) fastMin = (fastMin + dt / 1000 * (1440 / 30)) % 1440;
  // floors above the focus (or, in the overview, above the floor being demolished) fade and lift
  const lim = focus >= 0 ? focus : demoI >= 0 ? demoI : nf;
  for(let i = 0; i < nf; i++){
    const f = floors[i];
    const tg = f.i <= lim ? 1 : 0; f.vis = reduced ? tg : f.vis + clamp(tg - f.vis, -dt / 550, dt / 550); f.lift = (1 - f.vis) * 50; if(f.plot && !f.plot.started) f.vis = 0;
    const ot = (focus === f.i || (f.plot && !f.plot.done)) ? 1 : 0;
    f.op = reduced ? ot : f.op + clamp(ot - f.op, -dt / 520, dt / 520);
    f.actS += (f.act - f.actS) * (reduced ? 1 : 1 - Math.exp(-dt / 700));
  }
  // rotation and camera
  if(reduced){ RA = RAt; } else { const d = RAt - RA; RA += Math.abs(d) < .0004 ? d : d * (1 - Math.exp(-dt / 170)); }
  if(autoFit) fitNow(false);
  if(reduced){ cam.z = camT.z; cam.px = camT.px; cam.py = camT.py; }
  else { const c = 1 - Math.exp(-dt / 190); cam.z += (camT.z - cam.z) * c; cam.px += (camT.px - cam.px) * c; cam.py += (camT.py - cam.py) * c; }
  lastUI += dt; if(lastUI > 250){ lastUI = 0; updateUI(false); }
}

/* ================================================================ render */
/* per-section timing, only when asked (window.__bureau.prof(true)): the timer calls are not free */
const PR = {};
let pmk = 0, profOn = false;
function mk0(){ if(profOn) pmk = performance.now(); }
function mk(n){ if(!profOn) return; const t = performance.now(); PR[n] = (PR[n] || 0) + t - pmk; pmk = t; }

/* ---- frame state shared by the passes */
let Z = 1, TX = 0, TY = 0, PXr = 0, PYr = 0, PWr = 0, PHr = 0;
const RC4 = new Float64Array(4);
function ensureLayer(){
  if(!layerStale) return;
  layer2.width = Math.round(cw * dpr); layer2.height = Math.round(ch * dpr); layerStale = false;
}
/* a pass draws into the off-screen layer, tints it (night, source-atop), then composites the rectangle on the canvas */
function passBegin(x0, y0, x1, y1){
  ensureLayer();
  PXr = Math.max(0, Math.floor(x0)); PYr = Math.max(0, Math.floor(y0));
  PWr = Math.min(layer2.width, Math.ceil(x1)) - PXr; PHr = Math.min(layer2.height, Math.ceil(y1)) - PYr;
  if(PWr < 1 || PHr < 1){ PWr = 0; PHr = 0; }
  g = g2; g.setTransform(1, 0, 0, 1, 0, 0); if(PWr) g.clearRect(PXr, PYr, PWr, PHr); g.setTransform(Z, 0, 0, Z, TX, TY); ZB = 0; ZL = 0;
}
function passTint(){
  if(!PWr) return;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = LT.w; g.fillRect(PXr, PYr, PWr, PHr); g.globalCompositeOperation = 'source-over'; g.setTransform(Z, 0, 0, Z, TX, TY);
}
function passEnd(alpha){
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if(PWr){ ctx.globalAlpha = alpha; ctx.drawImage(layer2, PXr, PYr, PWr, PHr, PXr, PYr, PWr, PHr); ctx.globalAlpha = 1; }
  g = ctx; ctx.setTransform(Z, 0, 0, Z, TX, TY);
}
function passAll(){ ensureLayer(); passBegin(0, 0, layer2.width, layer2.height); }

/* ---- off-screen cache of a static drawing of one floor.
   drawCached(fl, name, ver, fn, top): fn draws what does not move (the floor's slab, tiles, shadows, or its façade) with the
   usual drawing functions, ZB and ZL already set for the floor. The first call (and every call after the key changed) draws
   it into a canvas of its own; the next ones only blit that canvas, whatever the pan. The key: the rotation, the zoom, the
   sun, LOW, ZL and ver. ver is the caller's own number: bump it when the drawing changes (a zone is built, a window goes
   out...), or pass a negative one while the drawing animates (then nothing is cached). top: height of the drawing (default 60).
   While the zoom moves the last bitmap is stretched; while the view rotates fn is drawn directly (no bitmap). */
let cacheOn = true, frameNo = 0, zMoving = false, rMoving = false, lastZ = 0, lastRA = 0, sunKey = 0;
const CACHE_MAXPX = 5.5e6;
const CB4 = new Float64Array(4);
function cacheBounds(top){
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for(let k = 0; k < 2; k++) for(let c = 0; c < 4; c++){
    const p = pp(c === 1 || c === 2 ? W + 1.5 : -1.5, c >= 2 ? D + 1.5 : -1.5, k ? top : -12);
    if(p[0] < x0) x0 = p[0]; if(p[0] > x1) x1 = p[0]; if(p[1] < y0) y0 = p[1]; if(p[1] > y1) y1 = p[1];
  }
  CB4[0] = x0; CB4[1] = y0; CB4[2] = x1; CB4[3] = y1;
}
function drawCached(fl, name, ver, fn, top = 60){
  if(ver < 0 || rMoving || !cacheOn){ fn(); return; }
  const set = fl.bmp || (fl.bmp = {});
  let c = set[name];
  const exact = c && c.ra === RA && c.sun === sunKey && c.low === LOW && c.zl === ZL && c.zb === ZB && c.ver === ver && c.dpr === dpr;
  const ratio = c ? Z / c.zk : 0;
  if(!(exact && (zMoving ? ratio > .6 && ratio < 1.7 : Math.abs(ratio - 1) < .003))){
    cacheBounds(top);
    const zk = Z, ox = Math.floor(CB4[0] * zk), oy = Math.floor(CB4[1] * zk);
    const w = Math.ceil(CB4[2] * zk) - ox, h = Math.ceil(CB4[3] * zk) - oy;
    if(w < 1 || h < 1 || w * h > CACHE_MAXPX){ fn(); return; }
    if(!c){ const cvs = document.createElement('canvas'); c = set[name] = {cv: cvs, g: cvs.getContext('2d')}; }
    if(c.cv.width !== w || c.cv.height !== h){ c.cv.width = w; c.cv.height = h; } else c.g.clearRect(0, 0, w, h);
    const gs = g, zb = ZB, zl = ZL;
    g = c.g; g.setTransform(zk, 0, 0, zk, -ox, -oy);
    fn();
    g = gs; ZB = zb; ZL = zl;
    c.zk = zk; c.ox = ox; c.oy = oy; c.ra = RA; c.sun = sunKey; c.low = LOW; c.zl = ZL; c.zb = ZB; c.ver = ver; c.dpr = dpr;
  }
  c.used = frameNo;
  const k = Z / c.zk;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(c.cv, Math.round(TX + c.ox * k), Math.round(TY + c.oy * k), Math.round(c.cv.width * k), Math.round(c.cv.height * k));
  g.setTransform(Z, 0, 0, Z, TX, TY);
}
/* bitmaps of floors that were not drawn for a few seconds are released */
function sweepCaches(){
  for(let i = 0; i < floors.length; i++){
    const set = floors[i].bmp; if(!set) continue;
    for(const n in set){ const c = set[n]; if(frameNo - c.used > 180){ c.cv.width = 1; c.cv.height = 1; delete set[n]; } }
  }
}

let lkMin = -99;
function refreshLight(){
  const m = curMin();
  if(fast || manualMin != null || lkMin < -50 || Math.abs(m - lkMin) >= .1){ lightAt(m / 60); winColors(); lkMin = m; }
  WINC.ambNow = reduced ? WINC.amber : AMBP[Math.round((.5 + .5 * Math.sin(T / 330)) * 11)];
}
const nearC = [];
function countAgents(){
  const nf = floors.length;
  for(let i = 0; i < nf; i++){ const f = floors[i]; f.n = 0; f.nAtt = 0; f.ag.length = 0; const zs = f.zones; if(zs) for(let q = 0; q < zs.length; q++) f.tc[zs[q].id] = 0; }
  const cabF = Math.round(EL.cur);
  for(let i = 0; i < agents.length; i++){
    const a = agents[i], fa = floors[a.fl];
    if(a.role !== 'worker' && !a.leaving && fa){ fa.n++; if(a.st === 'att') fa.nAtt++; if(fa.tc[a.team] !== undefined) fa.tc[a.team]++; }
    const fo = a.inCab ? floors[cabF] : fa;
    if(fo && a.alpha > 0 && !(a.role === 'worker' && a.delay > 0)) fo.ag.push(a);
  }
  for(let i = 0; i < nf; i++){ const f = floors[i]; f.act = f.n ? Math.min(1, f.n / 11) * .92 + .08 : 0; f.nAmb = Math.min(f.nAtt, 2); }
}
function render(){
  mk0();
  refreshLight(); orient(); sunUpdate();
  frameNo++;
  zMoving = Math.abs(cam.z - lastZ) > cam.z * .0005 || Math.abs(camT.z - cam.z) > cam.z * .004; lastZ = cam.z;
  rMoving = Math.abs(RA - lastRA) > 1e-5; lastRA = RA;
  sunKey = Math.round(SUN.dx * 200) * 1e6 + Math.round(SUN.dy * 200) * 1e3 + Math.round(SUN.f * 200) + Math.round(SUN.a * 200) * 1e9;
  countAgents(); updateLod(); mk('count');
  Z = cam.z * dpr; TX = (cw / 2 + cam.px) * dpr; TY = (ch / 2 + cam.py) * dpr;
  const night = LT.lamp >= .04 || LT.wa >= .02;
  let fadingF = false; for(let i = 0; i < floors.length; i++){ const f = floors[i]; if(f.vis > .01 && f.vis < .99) fadingF = true; }
  const ap = activeF, pass = night || fadingF;
  const craneBehind = ap && dep(ap.plot.mast.x, ap.plot.mast.y) < 0;
  cityBegin(night); mk('sky');
  cityBack(night);
  mk('city');
  if(ap && craneBehind){ if(night){ passAll(); drawCraneBase(ap); passTint(); passEnd(1); } else drawCraneBase(ap); }
  drawBuilding(pass);
  mk('building');
  if(ap && !craneBehind){ if(night){ passAll(); drawCraneBase(ap); passTint(); passEnd(1); } else drawCraneBase(ap); }
  ZB = 0; ZL = 0;
  cityFront(night);
  mk('front');
  if(ap){ if(night){ passAll(); drawCraneTop(ap); passTint(); passEnd(1); } else drawCraneTop(ap); }
  ZB = 0; ZL = 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawHud();
  mk('hud');
  if((frameNo & 63) === 0) sweepCaches();
}
