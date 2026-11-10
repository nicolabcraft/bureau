/* web/immeuble/agents.js: part of the building view, owned by the « agents » module (see docs/vue-immeuble.md). */
/* ================================================================ agents
   One character per Boite thread. The real state (OfficeAgent.state) drives a small state machine:
   setAgentState replaces the agent's plan (a short list of acts) instead of appending to it, so quick
   state changes never pile actions up. Steady postures are reached by walking, or at once when
   prefers-reduced-motion is set or when the agent is spawned with how === 'instant'. */
const SKIN = ['#F1C7A0', '#E0AC82', '#C58C62', '#8D5A3B', '#6B4128'];
const HAIR = ['#2b2118', '#5a3a22', '#a8772f', '#1a1a1f', '#8d8d96', '#b4472f'];
const SHIRT = ['#e7ebf2', '#c9d4e6', '#f0d9c0', '#b9d9cf', '#d8c8e6', '#f2c9c4'];
const PANTS = ['#2f3a50', '#3a3f4d', '#46506a'];
const DIRV = {dr: [1, 0], ul: [-1, 0], dl: [0, 1], ur: [0, -1]};
const particles = [];
const AMB = '#F0C36A', MINT = '#8FD9C4', RED = '#E0645A', GREYC = '#6b7488', BFONT = '700 11px ' + FONT;
/* OfficeAgent.state -> the scene's short state (read by the engine and the HUD: run att pause file fini err) */
const STMAP = {running: 'run', waiting: 'att', queued: 'file', idle: 'pause', done: 'fini', error: 'err'};
/* bubble over a seated or standing agent: '?' amber, 'sand' (hourglass), 'err' red, 'ok' mint (flash only) */
const BUBMAP = {waiting: '?', queued: 'sand', error: 'err'};
const DESKST = {running: true, waiting: true, queued: true, error: true};
const PATHMAX = 6;           // path searches per frame
const ONEDAY = 1e12;         // a wait that never ends: the next state change replaces it
let selId = null, waitFilter = false, pathQ = 0, dimK = 1;

function lookFor(id){
  const r = mul32(hashS(id));
  return {skin: SKIN[(r() * SKIN.length) | 0], hair: HAIR[(r() * HAIR.length) | 0], shirt: SHIRT[(r() * SHIRT.length) | 0], pants: PANTS[(r() * PANTS.length) | 0], long: r() < .4};
}
const roleOf = (r) => r === 'chef' ? 'chef' : r === 'manager' ? 'mgr' : 'staff';
const teamOf = (d) => d && d.zone ? (d.zone.key !== undefined ? d.zone.key : d.zone.id) : null;
/* colours resolved once per agent (no string building while drawing) */
function mkCols(a){
  const L = a.look, ro = a.role;
  const shirt = ro === 'chef' ? '#222b3c' : ro === 'worker' ? '#f28c28' : ro === 'mgr' ? mx(L.vest || '#8794AD', '#ffffff', .1) : L.shirt;
  return {shirt, shirtF: mx(shirt, GREYC, .45), skin: L.skin, skinF: mx(L.skin, GREYC, .4), hair: L.hair, hairF: mx(L.hair, GREYC, .4),
    pants: ro === 'worker' ? '#3a4a66' : ro === 'chef' ? '#1a2130' : L.pants};
}
function tint(a, desk){
  const w = desk && desk.zone && desk.zone.pal ? desk.zone.pal.wall : undefined;
  if(a.look.vest !== w){ a.look.vest = w; a.col = null; }
}
function mkAgent(o){
  const a = Object.assign({
    x: 0, y: 0, fl: 0, hf: 0, zb: 0, dir: 'dl', mode: 'stand', plan: [], cur: null, path: null, ph: 0, alpha: 1, carry: null, bubble: null, st: 'run', leaving: false, inCab: false,
    info: null, desk: null, zone: null, team: null, held: [], seatD: null, tgt: null, atCafe: false, dim: 0, flashT: 0, col: null, look: lookFor(o.id)
  }, o);
  a.alive = true; AGM.set(a.id, a); agents.push(a); return a;
}

/* ----- path finding: A* on a fixed grid, no allocation but the returned path */
const PGW = 44, PGH = 28, POX = 5, POY = 5, PGN = PGW * PGH;
const pgG = new Int32Array(PGN), pgF = new Int32Array(PGN), pgP = new Int32Array(PGN), pgS = new Uint8Array(PGN), pgO = new Int32Array(PGN);
const NDX = [1, -1, 0, 0], NDY = [0, 0, 1, -1];
function walkable(fl, x, y, worker){
  if(x >= 0 && x < W && y >= 0 && y < D) return (worker && fl.plot && !fl.plot.done) ? true : !fl.blk.has(KK(x, y));
  if(fl.i === 0 && y >= D && y <= D + 2) return x >= -2 && x < W + 9;
  return false;
}
function moveOK(fl, x, y, nx, ny){
  if(fl.plot && !fl.plot.done) return true;
  if(ny !== y && fl.vb.has(KK(x, Math.max(y, ny)))) return false;
  if(nx !== x && fl.hb.has(KK(Math.max(x, nx), y))) return false;
  return true;
}
function astar(fl, sx, sy, gx, gy, worker){
  if(sx === gx && sy === gy) return [];
  const six = sx + POX, siy = sy + POY, gix = gx + POX, giy = gy + POY;
  if(six < 0 || six >= PGW || siy < 0 || siy >= PGH || gix < 0 || gix >= PGW || giy < 0 || giy >= PGH) return null;
  pgS.fill(0);
  const s0 = siy * PGW + six, goal = giy * PGW + gix;
  let no = 0; pgO[no++] = s0; pgG[s0] = 0; pgF[s0] = 0; pgP[s0] = -1; pgS[s0] = 1;
  let n = 0;
  while(no > 0 && n++ < 4000){
    let bi = 0; for(let i = 1; i < no; i++) if(pgF[pgO[i]] < pgF[pgO[bi]]) bi = i;
    const c = pgO[bi]; pgO[bi] = pgO[--no]; pgS[c] = 2;
    if(c === goal){
      let len = 0; for(let q = c; pgP[q] >= 0; q = pgP[q]) len++;
      const path = new Array(len);
      for(let q = c, i = len - 1; pgP[q] >= 0; q = pgP[q], i--) path[i] = [(q % PGW) - POX + .5, ((q / PGW) | 0) - POY + .5];
      return path;
    }
    const cx = (c % PGW) - POX, cy = ((c / PGW) | 0) - POY;
    for(let k = 0; k < 4; k++){
      const nx = cx + NDX[k], ny = cy + NDY[k], ix = nx + POX, iy = ny + POY;
      if(ix < 0 || ix >= PGW || iy < 0 || iy >= PGH) continue;
      const ni = iy * PGW + ix; if(pgS[ni] === 2) continue;
      const isGoal = ni === goal, wk = walkable(fl, nx, ny, worker);
      if(!isGoal && !wk) continue;
      if(isGoal && !(wk || fl.blk.has(KK(nx, ny)))) continue;
      if(!moveOK(fl, cx, cy, nx, ny)) continue;
      const ng = pgG[c] + 1; if(pgS[ni] === 1 && pgG[ni] <= ng) continue;
      pgG[ni] = ng; pgP[ni] = c; pgF[ni] = ng + Math.abs(nx - gx) + Math.abs(ny - gy);
      if(pgS[ni] !== 1){ pgS[ni] = 1; pgO[no++] = ni; }
    }
  }
  return null;
}
const flOf = (a) => floors[a.fl];
function seatPos(d){ return [d.seatC[0] + .5, d.seatC[1] + .5]; }
function face(a, dx, dy){ if(Math.abs(dx) > Math.abs(dy)) a.dir = dx > 0 ? 'dr' : 'ul'; else if(Math.abs(dy) > 0) a.dir = dy > 0 ? 'dl' : 'ur'; }

/* ----- spots (cafeteria, bench, standing places): a spot is {c: [cx, cy], busy, zone?}; own = the agent that took it */
const NOSPOTS = [];
const spotsOf = (fl, k) => (fl && fl.spots && fl.spots[k]) || NOSPOTS;
function freeSpot(list){ const s = list.find((q) => !q.busy); if(s) s.busy = true; return s || list[0]; }   // legacy helper
function claim(a, lists, zone){
  for(let pass = 0; pass < 2; pass++){
    if(pass === 1 && zone == null) break;
    for(let l = 0; l < lists.length; l++){
      const li = lists[l];
      for(let i = 0; i < li.length; i++){
        const s = li[i];
        if(s.busy || (pass === 0 && zone != null && s.zone != null && s.zone !== zone)) continue;
        s.busy = true; s.own = a.id; a.held.push(s); return s;
      }
    }
  }
  for(let l = 0; l < lists.length; l++) if(lists[l].length) return lists[l][hashS(a.id) % lists[l].length];   // all taken: share one
  return null;
}
/* no desk and no free standing place (or none declared yet): a spot in the corridor */
const hallSpot = (a) => ({c: [1 + hashS(a.id) % 13, 8]});
function relOne(a, s){ if(s && s.own === a.id){ s.busy = false; s.own = null; } }
function releaseAll(a){ for(let i = 0; i < a.held.length; i++) relOne(a, a.held[i]); a.held.length = 0; }
function seatOn(a, d){ if(a.seatD && a.seatD !== d && a.seatD.agent === a.id) a.seatD.agent = null; a.seatD = d; if(d) d.agent = a.id; }
function unseat(a){ if(a.seatD){ if(a.seatD.agent === a.id) a.seatD.agent = null; a.seatD = null; } }

/* ----- elevator: any number of floors, up to 4 riders, calls grouped by direction (SCAN) */
const EL = {cur: 0, door: 0, mode: 'idle', target: 0, riders: [], waiters: [], t: 0, z: 0, dir: 1, spd: 1 / 750};
const CAB = [[8.6, 9.7], [9.4, 9.7], [8.6, 10.2], [9.4, 10.2]];
function elevReset(){ EL.cur = 0; EL.door = 0; EL.mode = 'idle'; EL.riders.length = 0; EL.waiters.length = 0; EL.t = 0; EL.z = 0; EL.dir = 1; for(const f of floors) f.eo = 0; }
function elRoom(){ let n = 0; for(let i = 0; i < EL.riders.length; i++){ const c = EL.riders[i].cur; if(c && c.state !== 'exit') n++; } return n < 4; }
/* should the cab open at floor f? pass: it is only passing by (take a waiter going the same way, or anyone when empty) */
function elStopHere(f, pass){
  let inside = 0;
  for(let i = 0; i < EL.riders.length; i++){ const c = EL.riders[i].cur; if(c && c.state === 'in'){ inside++; if(c.to === f) return true; } }
  if(!elRoom()) return false;
  for(let i = 0; i < EL.waiters.length; i++){
    const a = EL.waiters[i], c = a.cur;
    if(c && c.state === 'wait' && a.fl === f){ if(!pass) return true; if((c.to > f ? 1 : -1) === EL.dir || inside === 0) return true; }
  }
  return false;
}
let scAh = -1, scAd = 1e9, scBk = -1, scBd = 1e9;
function elCons(f){ const d = (f - EL.cur) * EL.dir; if(d >= -.001){ if(d < scAd){ scAd = d; scAh = f; } } else if(-d < scBd){ scBd = -d; scBk = f; } }
/* next floor to serve: nearest stop ahead, else behind (the direction flips); near: nearest of both */
function elScan(near){
  scAh = -1; scAd = 1e9; scBk = -1; scBd = 1e9;
  for(let i = 0; i < EL.riders.length; i++){ const c = EL.riders[i].cur; if(c && c.state === 'in') elCons(c.to); }
  if(elRoom()) for(let i = 0; i < EL.waiters.length; i++){ const a = EL.waiters[i], c = a.cur; if(c && c.state === 'wait') elCons(a.fl); }
  if(scAh >= 0 && (!near || scBk < 0 || scAd <= scBd)) return scAh;
  if(scBk >= 0){ EL.dir = -EL.dir; return scBk; }
  return -1;
}
function elGo(f){
  if(Math.abs(f - EL.cur) < .01){ EL.mode = 'open'; EL.t = 0; return; }
  EL.target = f; EL.dir = f > EL.cur ? 1 : -1; EL.spd = Math.max(1 / 750, Math.abs(f - EL.cur) / 2600); EL.mode = 'moving';
}
function freeSlot(){
  for(let s = 0; s < 4; s++){
    let used = false;
    for(let i = 0; i < EL.riders.length; i++){ const c = EL.riders[i].cur; if(c && (c.state === 'board' || c.state === 'in') && c.slot === s){ used = true; break; } }
    if(!used) return s;
  }
  return 0;
}
function updateElevator(dt){
  pathQ = 0; dimK = reduced ? 1 : 1 - Math.exp(-dt / 160);
  if(EL.mode === 'idle'){
    const f = elScan(true);
    if(f >= 0) elGo(f);
  } else if(EL.mode === 'moving'){
    const prev = EL.cur, d = EL.target - EL.cur, st = reduced ? 1e9 : EL.spd * dt;
    if(Math.abs(d) <= st){ EL.cur = EL.target; EL.mode = 'open'; EL.t = 0; }
    else {
      EL.cur += Math.sign(d) * st;
      const f = EL.dir > 0 ? Math.floor(EL.cur) : Math.ceil(EL.cur);
      if(f !== EL.target && (EL.dir > 0 ? f > prev : f < prev) && elStopHere(f, true)){ EL.cur = f; EL.target = f; EL.mode = 'open'; EL.t = 0; }
    }
  } else if(EL.mode === 'open'){
    EL.door = Math.min(1, EL.door + dt / (reduced ? 1 : 350)); EL.t += dt;
    if(EL.door >= 1){
      const fi = Math.round(EL.cur);
      for(let i = 0; i < EL.riders.length; i++){ const a = EL.riders[i], c = a.cur; if(c && c.state === 'in' && c.to === fi){ c.state = 'exit'; c.busy = true; c.k = 0; c.from = [a.x, a.y]; } }
      for(let i = EL.waiters.length - 1; i >= 0; i--){
        const a = EL.waiters[i], c = a.cur;
        if(c && c.state === 'wait' && a.fl === fi && elRoom()){ c.state = 'board'; c.busy = true; c.k = 0; c.from = [a.x, a.y]; c.slot = freeSlot(); EL.waiters.splice(i, 1); EL.riders.push(a); }
      }
      let busy = false;
      for(let i = 0; i < EL.riders.length; i++){ const c = EL.riders[i].cur; if(c && c.busy){ busy = true; break; } }
      if(!busy && EL.t > 700) EL.mode = 'closing';
    }
  } else if(EL.mode === 'closing'){
    EL.door = Math.max(0, EL.door - dt / (reduced ? 1 : 350));
    if(EL.door <= 0){ const f = elScan(false); if(f >= 0) elGo(f); else EL.mode = 'idle'; }
  }
  { let n = 0; for(let i = 0; i < EL.riders.length; i++){ const a = EL.riders[i]; if(a.alive && a.cur && a.cur.t === 'ride') EL.riders[n++] = a; } EL.riders.length = n; }
  { let n = 0; for(let i = 0; i < EL.waiters.length; i++){ const a = EL.waiters[i]; if(a.alive && a.cur && a.cur.t === 'ride') EL.waiters[n++] = a; } EL.waiters.length = n; }
  EL.z = EL.cur * FHt;
  for(let i = 0; i < floors.length; i++){ const f = floors[i]; f.eo = Math.abs(EL.cur - f.i) < .01 ? EL.door : 0; }
}

/* ----- acts */
function beginAct(a, c){
  const fl = flOf(a);
  if(c.t === 'go'){
    unseat(a);
    if(reduced){ a.x = c.cx + .5; a.y = c.cy + .5; a.mode = 'stand'; a.path = []; c.skip = true; return; }
    if(a.mode === 'sit') a.mode = 'stand';
    pathQ++;
    const p = astar(fl, Math.floor(a.x), Math.floor(a.y), c.cx, c.cy, a.role === 'worker');
    if(!p){ a.x = c.cx + .5; a.y = c.cy + .5; a.mode = 'stand'; c.skip = true; return; }
    a.path = p; a.mode = 'walk';
  } else if(c.t === 'sit'){
    c.from = [a.x, a.y]; c.k = 0; a.mode = 'sit'; a.dir = c.dir || 'ur';
    if(c.d) seatOn(a, c.d);
    if(reduced){ a.x = c.x; a.y = c.y; c.skip = true; }
  } else if(c.t === 'wait'){
    c.k = 0; if(a.mode === 'walk') a.mode = 'stand';
    if(c.dir) a.dir = c.dir;
    if(c.st) a.st = c.st;
    if(c.bubble !== undefined) a.bubble = c.bubble;
  } else if(c.t === 'leave'){
    unseat(a);
    if(reduced){ removeAgent(a); c.skip = true; return; }
    a.leaving = true;
    pathQ++;
    const p = astar(fl, Math.floor(a.x), Math.floor(a.y), W + 5, D + 1, false);
    if(!p){ removeAgent(a); c.skip = true; return; }
    a.path = p; a.mode = 'walk';
  } else if(c.t === 'vanish'){ a.leaving = true; c.k = 0; a.mode = 'stand'; }
  else if(c.t === 'ride'){
    unseat(a);
    if(reduced){ a.fl = c.to; a.zb = floors[c.to].z0; a.x = 9.5; a.y = 11.5; a.mode = 'stand'; c.skip = true; return; }
    c.state = 'wait'; c.busy = false; a.mode = 'stand'; a.dir = 'ur'; EL.waiters.push(a);
  }
}
function runAct(a, c, dt){
  if(c.skip) return true;
  if(c.t === 'go' || c.t === 'leave'){
    let step = 2.5 * dt / 1000;
    while(step > 0 && a.path && a.path.length){
      const w = a.path[0], dx = w[0] - a.x, dy = w[1] - a.y, d = Math.hypot(dx, dy);
      if(d <= step){ a.x = w[0]; a.y = w[1]; a.path.shift(); step -= d; a.ph += d * 5.2; }
      else { a.x += dx / d * step; a.y += dy / d * step; a.ph += step * 5.2; face(a, dx, dy); step = 0; }
    }
    if(!a.path || !a.path.length){ if(c.t === 'leave') removeAgent(a); else a.mode = 'stand'; return true; }
    return false;
  }
  if(c.t === 'sit'){ c.k += dt / 260; const e = eio(clamp(c.k, 0, 1)); a.x = lerp(c.from[0], c.x, e); a.y = lerp(c.from[1], c.y, e); return c.k >= 1; }
  if(c.t === 'wait'){ c.k += dt; return c.k >= c.ms; }
  if(c.t === 'do'){ c.fn(a); return true; }
  if(c.t === 'vanish'){ c.k += dt; a.alpha = Math.max(0, 1 - c.k / 600); if(c.k >= 600){ removeAgent(a); return true; } return false; }
  if(c.t === 'ride'){
    if(c.state === 'board'){
      c.k += dt / 500; const e = eio(clamp(c.k, 0, 1)), s = CAB[c.slot % 4];
      a.x = lerp(c.from[0], s[0], e); a.y = lerp(c.from[1], s[1], e); face(a, s[0] - c.from[0], s[1] - c.from[1]); a.mode = 'walk'; a.ph += dt * .012;
      if(c.k >= 1){ c.state = 'in'; c.busy = false; a.inCab = true; a.mode = 'stand'; a.dir = 'dl'; }
    } else if(c.state === 'in'){ a.zb = EL.z; }
    else if(c.state === 'exit'){
      if(c.k === 0){ a.fl = c.to; a.inCab = false; a.zb = floors[c.to].z0; }
      c.k += dt / 500; const e = eio(clamp(c.k, 0, 1)); a.x = lerp(c.from[0], 9 + (c.slot % 2) * .8 - .4, e); a.y = lerp(c.from[1], 11.5, e); a.mode = 'walk'; a.dir = 'dl'; a.ph += dt * .012;
      if(c.k >= 1){ a.mode = 'stand'; c.busy = false; return true; }
    }
    return false;
  }
  return true;
}
function stepAgent(a, dt){
  if(a.role !== 'worker'){
    const tg = waitFilter && a.st !== 'att' ? 1 : 0;
    a.dim = Math.abs(tg - a.dim) < .01 ? tg : a.dim + (tg - a.dim) * dimK;
  }
  if(!a.cur){
    if(!a.plan.length){ if(!a.inCab) a.zb = floors[a.fl].z0; return; }
    if(a.plan[0].t === 'go' && pathQ >= PATHMAX) return;   // a burst of replans: spread the path searches over frames
    a.cur = a.plan.shift(); beginAct(a, a.cur);
  }
  if(a.cur && runAct(a, a.cur, dt)) a.cur = null;
  if(!a.inCab) a.zb = floors[a.fl].z0;
}
function removeAgent(a){
  releaseAll(a); unseat(a);
  for(const f of floors) for(const d of f.desks) if(d.agent === a.id) d.agent = null;
  a.alive = false; a.cur = null; a.plan.length = 0;
  if(AGM.get(a.id) === a) AGM.delete(a.id);
  const i = agents.indexOf(a); if(i >= 0) agents.splice(i, 1);
}
const goC = (cx, cy) => ({t: 'go', cx, cy});
const doA = (fn) => ({t: 'do', fn});
const waitA = (ms, o) => Object.assign({t: 'wait', ms}, o);
const rideA = (to) => ({t: 'ride', to});
function sitAct(d, dir){ const p = seatPos(d); return {t: 'sit', x: p[0], y: p[1], dir: dir || 'ur', d}; }
const liftX = (a) => 8 + (hashS(a.id) % 2);

/* ================================================================ state machine (the contract) */
/* the bubble and the posture details that depend on the state; read when the agent arrives, so a change on the way costs nothing */
function mood(a){
  const s = a.info ? a.info.state : null;
  a.bubble = (s && BUBMAP[s]) || null;
}
/* drop what the agent was doing; a ride already under way (cabin or doors) is kept: returns it, else null */
function cancel(a){
  releaseAll(a); unseat(a);
  const c = a.cur;
  a.plan.length = 0; a.path = null; a.carry = null; a.bubble = null; a.atCafe = false;
  if(c && c.t === 'ride' && (c.state === 'board' || c.state === 'in' || c.state === 'exit')) return c;
  a.cur = null; if(a.mode === 'walk') a.mode = 'stand';
  return null;
}
/* put the agent in its final posture at once (first load, reduced motion) */
function settle(a){
  const keep = a.cur; if(keep && keep.t === 'ride') a.cur = null;
  cancel(a); a.cur = null; a.inCab = false; a.leaving = false;
  const fl = floors[a.hf]; if(!fl) return;
  a.fl = a.hf; a.zb = fl.z0; a.alpha = 1; a.path = null; a.planHf = a.hf; a.planDesk = a.desk;
  const s = a.info ? a.info.state : 'running';
  if(DESKST[s]){
    a.tgt = 'desk';
    if(a.desk){ const p = seatPos(a.desk); a.x = p[0]; a.y = p[1]; a.mode = 'sit'; a.dir = 'ur'; seatOn(a, a.desk); }
    else { const sp = claim(a, [spotsOf(fl, 'stand')], a.zone) || hallSpot(a); a.x = sp.c[0] + .5; a.y = sp.c[1] + .5; a.mode = 'stand'; a.dir = 'dl'; }
  } else {
    a.tgt = 'cafe';
    const sp = claim(a, s === 'done' ? [spotsOf(fl, 'idle'), spotsOf(fl, 'table')] : [spotsOf(fl, 'table'), spotsOf(fl, 'idle')]);
    if(sp){ a.x = sp.c[0] + .5; a.y = sp.c[1] + .5; }
    a.mode = 'stand'; a.dir = 'dr'; a.atCafe = true; a.carry = s === 'idle' ? 'mug' : null;
  }
  mood(a);
}
function seatPlan(a, fl){
  if(a.desk){ const p = a.desk.seatC; a.plan.push(goC(p[0], p[1]), sitAct(a.desk), doA(mood)); }
  else {
    const sp = claim(a, [spotsOf(fl, 'stand')], a.zone) || hallSpot(a);
    a.plan.push(goC(sp.c[0], sp.c[1]));
    a.plan.push(doA((q) => { q.dir = 'dl'; mood(q); }));
  }
}
function cafePlan(a, fl, done){
  const cs = done ? null : claim(a, [spotsOf(fl, 'counter')]);
  const ts = claim(a, done ? [spotsOf(fl, 'idle'), spotsOf(fl, 'table')] : [spotsOf(fl, 'table'), spotsOf(fl, 'idle')]);
  if(cs) a.plan.push(goC(cs.c[0], cs.c[1]), waitA(1700, {dir: 'ur'}), doA((q) => { q.carry = 'mug'; relOne(q, cs); }));
  if(ts) a.plan.push(goC(ts.c[0], ts.c[1]));
  a.plan.push(doA((q) => { q.atCafe = true; q.bubble = null; q.carry = q.info && q.info.state === 'idle' ? 'mug' : null; }), waitA(ONEDAY, {dir: 'dr'}));
}
/* hands the file to the agent above, when that one sits on the same floor */
function handoverPlan(a){
  const m = a.info && a.info.parentId ? agentById(a.info.parentId) : null;
  if(!m || m.fl !== a.hf || m.mode !== 'sit' || !m.seatD) return;
  const sc = m.seatD.seatC;
  a.plan.push(doA((q) => { q.carry = 'folder'; }), goC(sc[0] + 1, sc[1]), waitA(1500, {dir: 'ul'}),
    doA((q) => { q.carry = null; m.flashT = T + 1400; }));
}
/* plan from floor startFl to the posture of the current state on the home floor */
function route(a, startFl, prev){
  const hf = a.hf, fl = floors[hf]; if(!fl) return;
  const s = a.info ? a.info.state : 'running';
  if(startFl !== hf) a.plan.push(goC(liftX(a), 11), rideA(hf));
  else if(s === 'done' && prev === 'running') handoverPlan(a);
  if(DESKST[s]) seatPlan(a, fl); else cafePlan(a, fl, s === 'done');
}
function planFor(a, prev){
  const s = a.info.state, want = DESKST[s] ? 'desk' : 'cafe';
  if(reduced || !floors[a.hf]){ settle(a); return; }
  if(a.tgt === want && a.planHf === a.hf && a.planDesk === a.desk && !a.leaving){
    // same destination: nothing to replan; the bubble follows the state once the agent is in place
    if(a.mode === 'sit' || a.atCafe) mood(a);
    if(a.atCafe) a.carry = s === 'idle' ? (a.carry || 'mug') : null;
    return;
  }
  const keep = cancel(a);
  a.tgt = want; a.planHf = a.hf; a.planDesk = a.desk;
  route(a, keep ? keep.to : a.fl, prev);
}
/* a new agent comes in by the front door and goes to its place; a queued one waits a moment on the entrance bench first */
function walkIn(a){
  a.fl = 0; a.zb = 0; a.x = W + 5.5; a.y = D + 1.5; a.alpha = 0; a.mode = 'stand'; a.dir = 'ul'; a.plan.length = 0; a.cur = null;
  a.tgt = DESKST[a.info.state] ? 'desk' : 'cafe'; a.planHf = a.hf; a.planDesk = a.desk;
  if(a.info.state === 'queued'){
    const s = claim(a, [spotsOf(floors[0], 'bench')]);
    if(s && s.d) a.plan.push(goC(s.c[0], s.c[1]), {t: 'sit', x: s.d[0], y: s.d[1], dir: 'dr'}, doA((q) => { q.bubble = 'sand'; }), waitA(4000), doA((q) => { relOne(q, s); q.bubble = null; }));
  }
  route(a, 0, null);
}
function spawnAgent(info, fl, desk, how, zoneKey){
  const old = AGM.get(info.id);
  if(old && old.alive){ old.info = info; moveAgent(old, fl, desk, zoneKey); setAgentState(old, info); return old; }
  const a = mkAgent({id: info.id, info, fl: fl.i, hf: fl.i, zb: fl.z0, name: info.title, role: roleOf(info.role), desk: desk || null, zone: zoneKey === undefined ? null : zoneKey, team: teamOf(desk), st: STMAP[info.state] || 'run'});
  tint(a, desk);
  if(how === 'door' && !reduced) walkIn(a); else settle(a);
  return a;
}
function setAgentState(a, info){
  if(!a || !a.alive) return;
  const prev = a.info ? a.info.state : null, role = roleOf(info.role);
  a.info = info; a.name = info.title || a.name;
  if(a.role !== role){ a.role = role; a.col = null; }
  a.st = STMAP[info.state] || 'run';
  if(a.leaving){ a.leaving = false; a.tgt = null; }   // it is back in the state: cancel the departure
  if(prev === info.state && a.tgt) return;
  planFor(a, prev);
}
function moveAgent(a, fl, desk, zoneKey){
  if(!a || !a.alive || !fl) return;
  a.hf = fl.i; a.desk = desk || null; a.team = teamOf(desk); if(zoneKey !== undefined) a.zone = zoneKey;
  tint(a, desk);
  if(a.leaving){ a.leaving = false; }
  a.tgt = null;
  if(!a.info) return;
  planFor(a, a.info.state);
}
function leaveAgent(a){
  if(!a || !a.alive || a.leaving) return;
  if(reduced){ removeAgent(a); return; }
  const keep = cancel(a);
  a.tgt = 'out'; a.leaving = true;
  const start = keep ? keep.to : a.fl;
  if(start !== 0) a.plan.push(goC(liftX(a), 11), rideA(0));
  a.plan.push({t: 'leave'});
}
function setWaitFilter(on){ waitFilter = !!on; }
function setSelected(id){ selId = id == null ? null : id; }

function spawnWorkers(fl){
  const p = fl.plot;
  for(let i = 0; i < 3; i++){
    const w = mkAgent({id: 'w' + fl.i + i, fl: fl.i, hf: fl.i, zb: fl.z0, name: 'Ouvrier', role: 'worker', team: null, st: 'work'});
    w.x = W - .5 - i; w.y = D - 1.5; w.alpha = 0; p.workers.push(w);
    const r = mul32(hashS('w' + fl.i + i));
    for(let k = 0; k < 7; k++) w.plan.push(goC(1 + ((r() * 13) | 0), 2 + ((r() * 13) | 0)), waitA(1300 + r() * 600, {hammer: true, dir: r() < .5 ? 'dr' : 'dl'}));
    w.plan.push(goC(W - 1, D - 1), {t: 'vanish'});
    w.delay = i * 900;
  }
}

/* ================================================================ sprites */
function ln(x0, y0, x1, y1, col, w){ g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.stroke(); }
/* bubble above the head: '?' amber, hourglass, red '!', mint check */
function drawBubble(a, hy){
  const k = a.flashT > T ? 'ok' : a.bubble; if(!k) return;
  const bx = 9, by = hy - 20;
  g.fillStyle = k === 'ok' ? MINT : k === '?' ? AMB : k === 'err' ? RED : '#c9d4e6';
  g.beginPath(); g.roundRect(bx - 8, by, 16, 14, 4); g.fill();
  g.beginPath(); g.moveTo(bx - 5, by + 13); g.lineTo(bx - 8, by + 18); g.lineTo(bx - 1, by + 13); g.fill();
  g.strokeStyle = '#2A2008'; g.fillStyle = '#2A2008'; g.lineWidth = 1.8; g.lineCap = 'round';
  if(k === 'ok'){ g.beginPath(); g.moveTo(bx - 4, by + 7); g.lineTo(bx - 1, by + 10); g.lineTo(bx + 4, by + 4); g.stroke(); }
  else if(k === 'sand'){
    g.beginPath(); g.moveTo(bx - 3.6, by + 3); g.lineTo(bx + 3.6, by + 3); g.moveTo(bx - 3.6, by + 11); g.lineTo(bx + 3.6, by + 11); g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.moveTo(bx - 3, by + 3.6); g.lineTo(bx + 3, by + 3.6); g.lineTo(bx, by + 7); g.lineTo(bx + 3, by + 10.4); g.lineTo(bx - 3, by + 10.4); g.lineTo(bx, by + 7); g.closePath(); g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(bx - 2, by + 10.4); g.lineTo(bx + 2, by + 10.4); g.lineTo(bx, by + 8.4); g.closePath(); g.fill();
  } else if(k === 'err'){ g.font = BFONT; g.textAlign = 'center'; g.fillText('!', bx, by + 11.5); }
  else { g.font = BFONT; g.textAlign = 'center'; g.fillText('?', bx, by + 11.5); }
}
function drawAgent(a, zb){
  if(a.alpha <= 0) return;
  ZB = zb;
  const pt = pp(a.x, a.y, 0), sx = pt[0], sy = pt[1];
  const C = a.col || (a.col = mkCols(a)), L = a.look;
  const sit = a.mode === 'sit', walk = a.mode === 'walk', fini = a.st === 'fini', att = a.st === 'att';
  const base = a.alpha * (1 - .74 * a.dim), pu = reduced ? 1 : .72 + .28 * Math.sin(T / 260);
  g.save(); g.translate(sx, sy);
  if(a.id === selId){ g.globalAlpha = Math.max(base, .5); g.beginPath(); g.ellipse(0, 1.5, 13, 6, 0, 0, 7); g.strokeStyle = '#ffffff'; g.lineWidth = 1.8; g.stroke(); }
  if(att){
    g.globalAlpha = base * .2 * pu; g.beginPath(); g.ellipse(0, 1.5, 10.5, 4.8, 0, 0, 7); g.fillStyle = AMB; g.fill();
    g.globalAlpha = base * pu; g.strokeStyle = AMB; g.lineWidth = 1.8; g.stroke();
  }
  g.globalAlpha = base * (fini ? .62 : 1);
  ell(0, 1.5, 9, 4.2, 'rgba(0,0,0,.28)');
  const bob = walk ? Math.abs(Math.cos(a.ph)) * 1.5 : 0;
  const hip = (sit ? -8 : -12) - bob, ty = hip - 13, hy = ty - 5.4;
  if(LOW){
    if(att){ g.globalAlpha = base * pu; g.strokeStyle = AMB; g.lineWidth = 3; g.beginPath(); g.rect(-5.6, ty, 11.2, 14.5); g.stroke(); g.beginPath(); g.arc(0, ty - 4.4, 5.4, 0, 7); g.stroke(); g.globalAlpha = base * (fini ? .62 : 1); }
    g.fillStyle = C.pants; g.fillRect(-4, hip, 8, sit ? 8 : 12);
    g.fillStyle = fini ? C.shirtF : C.shirt; g.fillRect(-5.6, ty, 11.2, 14.5);
    g.fillStyle = L.skin; g.beginPath(); g.arc(0, ty - 4.4, 5.4, 0, 7); g.fill();
    g.fillStyle = a.role === 'worker' ? '#F0C36A' : L.hair; g.beginPath(); g.arc(0, ty - 5.6, 5.6, Math.PI, 0); g.fill();
    g.globalAlpha = base; drawBubble(a, hy);
    g.restore(); return;
  }
  const fv = DIRV[a.dir] || DIRV.dl, rx = fv[0] * RC - fv[1] * RS, ry = fv[0] * RS + fv[1] * RC, tw = (rx + ry) * SQ, sd = (rx - ry) * SQ;
  const front = tw > -.3, sw = walk ? Math.sin(a.ph) : 0;
  g.save(); g.scale(.84 + .16 * Math.abs(tw), 1);
  if(att){   // amber outline of the legs, torso and head, under the sprite
    g.globalAlpha = base * pu; g.strokeStyle = AMB; g.lineWidth = 4; g.lineJoin = 'round';
    if(sit){ g.beginPath(); g.rect(-5, -9, 10, 9); g.stroke(); } else { ln(-2.4, hip, -2.4 + sw * 3.4, -1, AMB, 7.6); ln(2.4, hip, 2.4 - sw * 3.4, -1, AMB, 7.6); }
    g.beginPath(); g.roundRect(-5.6, ty, 11.2, 14.5, 4); g.stroke();
    g.beginPath(); g.ellipse(0, hy, 5.6, 5.8, 0, 0, 7); g.stroke();
    g.globalAlpha = base * (fini ? .62 : 1);
  }
  const pants = C.pants;
  if(sit){ g.fillStyle = pants; g.fillRect(-5, -9, 4.4, 9); g.fillRect(.6, -9, 4.4, 9); g.fillStyle = '#12161e'; g.fillRect(-5.4, -2, 5, 2.4); g.fillRect(.4, -2, 5, 2.4); }
  else { ln(-2.4, hip, -2.4 + sw * 3.4, -1, pants, 4.3); ln(2.4, hip, 2.4 - sw * 3.4, -1, pants, 4.3); g.fillStyle = '#12161e'; g.fillRect(-4.6 + sw * 3.4, -2.4, 4.4, 2.6); g.fillRect(.2 - sw * 3.4, -2.4, 4.4, 2.6); }
  const shirt = fini ? C.shirtF : C.shirt;
  rrect(-5.6, ty, 11.2, 14.5, 4, shirt);
  if(a.role === 'chef' && front){ g.fillStyle = '#f3efe6'; g.beginPath(); g.moveTo(-2, ty + .3); g.lineTo(2, ty + .3); g.lineTo(0, ty + 7); g.closePath(); g.fill(); g.fillStyle = '#F0C36A'; g.fillRect(-.6, ty + 2, 1.2, 6); }
  if(a.role === 'mgr' && front){ g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(-1.2, ty + 1, 2.4, 8); }
  if(a.role === 'worker'){ g.fillStyle = '#f3efe6'; g.fillRect(-5.6, ty + 6, 11.2, 1.8); g.fillRect(-5.6, ty + 10, 11.2, 1.5); }
  const hand = L.skin;
  if(sit){
    const typ = att ? 0 : (reduced || a.st === 'err' ? 0 : Math.sin(T / 120 + a.id.length) * 1.1);
    ln(-5.3, ty + 4, -5.8, ty - 1 + typ, shirt, 3); ln(5.3, ty + 4, 5.8, ty - 1 - typ, shirt, 3);
    ell(-5.8, ty - 2 + typ, 1.6, 1.6, hand); if(!att) ell(5.8, ty - 2 - typ, 1.6, 1.6, hand);
    if(att){ const wv = reduced ? 0 : Math.sin(T / 160) * 2; ln(5.3, ty + 3, 7 + wv, ty - 11, shirt, 3); ell(7 + wv, ty - 12.5, 1.9, 1.9, hand); }
  } else if(a.mode === 'stand' && a.cur && a.cur.hammer){
    const s2 = reduced ? 0 : Math.sin(T / 110);
    ln(5.3, ty + 3, 9 + s2 * 2, ty - 4 + s2 * 4, shirt, 3); ln(9 + s2 * 2, ty - 4 + s2 * 4, 12 + s2 * 3, ty - 11 + s2 * 6, '#8a6a46', 1.8);
    g.fillStyle = '#8794AD'; g.fillRect(10 + s2 * 3, ty - 14 + s2 * 6, 6, 3.2); ln(-5.3, ty + 3, -6, ty + 10, shirt, 3);
    if(!reduced && s2 > .96 && Math.random() < .5) particles.push({f: a.fl, x: a.x + .4, y: a.y + .4, z: 6, vx: (Math.random() - .5) * .8, vy: (Math.random() - .5) * .8, vz: 22 + Math.random() * 20, life: 0, max: 380, col: '#ffd36b', size: 1.6});
  } else if(att && !walk){   // standing and waiting for the user: one hand up
    const wv = reduced ? 0 : Math.sin(T / 160) * 2;
    ln(-5.3, ty + 3, -5.6, ty + 11, shirt, 3); ell(-5.6, ty + 12, 1.6, 1.6, hand);
    ln(5.3, ty + 3, 7 + wv, ty - 11, shirt, 3); ell(7 + wv, ty - 12.5, 1.9, 1.9, hand);
  } else {
    ln(-5.3, ty + 3, -5.6 - sw * 2, ty + 11, shirt, 3); ln(5.3, ty + 3, 5.6 + sw * 2, ty + 11, shirt, 3);
    ell(-5.6 - sw * 2, ty + 12, 1.6, 1.6, hand); ell(5.6 + sw * 2, ty + 12, 1.6, 1.6, hand);
  }
  if(a.carry === 'folder'){ g.fillStyle = '#F0C36A'; g.fillRect(3, ty + 6, 8, 6); g.fillStyle = '#d6a84f'; g.fillRect(3, ty + 5, 4, 1.5); }
  if(a.carry === 'mug'){ g.fillStyle = '#f3efe6'; g.fillRect(5.5, ty + 5, 4, 4.4); g.strokeStyle = '#f3efe6'; g.lineWidth = 1; g.beginPath(); g.arc(10, ty + 7, 1.6, -1.4, 1.4); g.stroke();
    if(!reduced){ g.strokeStyle = 'rgba(255,255,255,.45)'; for(let i = 0; i < 2; i++){ const t = ((T / 900 + i * .5) % 1); g.beginPath(); g.moveTo(7.5 + i * 1.5 + Math.sin(t * 6 + i) * 1.2, ty + 4 - t * 7); g.lineTo(7.5 + i * 1.5 + Math.sin(t * 6 + i + .6) * 1.2, ty + 2 - t * 7); g.stroke(); } } }
  const skin = fini ? C.skinF : L.skin;
  ell(0, ty + .5, 2.2, 2, skin); ell(0, hy, 5.6, 5.8, skin);
  g.fillStyle = fini ? C.hairF : L.hair;
  if(!front){ g.beginPath(); g.ellipse(0, hy - .4, 5.9, 6, 0, 0, 7); g.fill(); if(L.long) g.fillRect(-5.4, hy, 10.8, 8); }
  else {
    g.beginPath(); g.ellipse(0, hy - 2.2, 5.9, 4.3, 0, Math.PI, 0); g.fill();
    if(L.long){ g.fillRect(-5.9, hy - 2, 2.4, 9); g.fillRect(3.5, hy - 2, 2.4, 9); }
    if(tw < 0){ g.beginPath(); g.ellipse(-sd * 1.5, hy - .8, 4.6, 4.6, 0, 0, 7); g.fill(); }
    g.fillStyle = '#1f2530';
    const ex = sd * 2.4 * (1 - Math.max(0, tw) * .6), sep = 1.9 * clamp(tw, 0, 1);
    if(tw > .4){ g.fillRect(ex - sep - .8, hy + .3, 1.5, 1.8); g.fillRect(ex + sep - .7, hy + .3, 1.5, 1.8); }
    else g.fillRect(ex + sd * 1.2 - .7, hy + .3, 1.5, 1.8);
  }
  if(a.role === 'worker'){ g.fillStyle = '#F0C36A'; g.beginPath(); g.ellipse(0, hy - 2.2, 6.4, 4.6, 0, Math.PI, 0); g.fill(); g.fillRect(-7, hy - 2.4, 14, 1.8); }
  g.restore();
  g.globalAlpha = base; drawBubble(a, hy);
  g.restore();
}

/* ================================================================ portrait for the card: bust of the character, 72x68, same colours as the sprite */
function drawPortrait(canvas, id){
  if(!canvas || !canvas.getContext) return;
  const c = canvas.getContext('2d'); if(!c) return;
  const a = AGM.get(id), alive = a && a.alive;
  const info = alive ? a.info : (typeof agentInfo === 'function' ? agentInfo(id) : null);
  const look = alive ? a.look : lookFor(id);
  const role = alive ? a.role : info ? roleOf(info.role) : 'staff';
  const fini = alive ? a.st === 'fini' : !!info && info.state === 'done';
  const C = alive && a.col ? a.col : mkCols({look, role});
  const sx = (canvas.width || 72) / 72, sy = (canvas.height || 68) / 68;
  c.setTransform(sx, 0, 0, sy, 0, 0); c.clearRect(0, 0, 72, 68);
  const bg = c.createLinearGradient(0, 0, 0, 68); bg.addColorStop(0, '#222c40'); bg.addColorStop(1, '#161c29');
  c.fillStyle = bg; c.fillRect(0, 0, 72, 68);
  const skin = fini ? C.skinF : C.skin, hair = fini ? C.hairF : C.hair, shirt = fini ? C.shirtF : C.shirt;
  const rr = (x, y, w, h, r, col) => { c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = col; c.fill(); };
  const el = (x, y, w, h, col) => { c.beginPath(); c.ellipse(x, y, w, h, 0, 0, 7); c.fillStyle = col; c.fill(); };
  if(look.long) rr(20.5, 18, 31, 34, 12, hair);                       // long hair behind the shoulders
  rr(9, 47, 54, 34, 16, shirt);                                        // shoulders
  if(role === 'chef'){
    c.fillStyle = '#f3efe6'; c.beginPath(); c.moveTo(29, 47); c.lineTo(43, 47); c.lineTo(36, 61); c.closePath(); c.fill();
    c.fillStyle = '#F0C36A'; c.fillRect(35, 50, 2, 14);
  } else if(role === 'mgr'){ c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(34.8, 49, 2.4, 19); }
  rr(30, 38, 12, 12, 4, mx(skin, '#000000', .14));                      // neck
  el(22.4, 29.5, 2.6, 3.4, mx(skin, '#000000', .06)); el(49.6, 29.5, 2.6, 3.4, mx(skin, '#000000', .06));
  el(36, 28, 13.5, 15, skin);                                          // head
  c.fillStyle = hair; c.beginPath(); c.ellipse(36, 22, 14.6, 11.8, 0, Math.PI, 0); c.fill();
  if(look.long){ c.fillRect(21.4, 21, 4.6, 19); c.fillRect(46, 21, 4.6, 19); } else { c.fillRect(21.4, 21, 3.2, 7); c.fillRect(47.4, 21, 3.2, 7); }
  c.fillStyle = '#1f2530'; c.fillRect(30.2, 29, 3, 3.8); c.fillRect(38.8, 29, 3, 3.8);
  c.strokeStyle = mx(skin, '#000000', .3); c.lineWidth = 1.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(32, 38); c.quadraticCurveTo(36, 40.4, 40, 38); c.stroke();
  c.setTransform(1, 0, 0, 1, 0, 0);
}
