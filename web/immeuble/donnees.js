/* web/immeuble/donnees.js: part of the building view, owned by the « donnees » module (see docs/vue-immeuble.md). */
/* ================================================================ data: an OfficeState applied to the scene */
/* applyOffice(office) compares the state with the scene and drives the other modules: addFloor / updateFloor /
   demolishFloor (etages.js, chantier.js), spawnAgent / setAgentState / moveAgent / leaveAgent (agents.js). The first
   state is placed without animation; the next ones animate. planImmeuble (plan.js) decides who sits where.
   A project that has no team any more loses its floor: its people walk out, then the floor is demolished (one chantier or
   demolition at a time) and the floors above come down. The ground floor is the entrance: it stays, empty. */
const MEMO_KEY = 'bureau.immeuble.etages';
const ENTER_GAP_MS = 650;
const DEMOLISH_GRACE_MS = 20000;   // a project must stay without a team this long before its floor comes down
const DATA = {
  loaded: false,
  office: null,
  grace: DEMOLISH_GRACE_MS, // ms; tests set it to 0
  memo: [],                 // floor order stored by an earlier visit (project ids)
  order: [],                // floor ids in scene order, floors without a team included
  floors: new Map(),        // project id -> {id, fl, name, sig, zoneOrder, zones: Map(key -> last ZoneSpec), seats: Map(key -> id[]), gone, demo}
  placed: new Map(),        // agent id -> {info, fd, zoneKey, seat, a, pending}
  infos: new Map(),         // agent id -> OfficeAgent of the state being applied (reused, no allocation per state)
  wants: new Map(),         // agent id -> {fd, zoneKey, seat} of the state being applied (reused)
  queue: [],                // agents that wait to walk in (floor or zone still in chantier, or one door at a time)
  timer: 0,
  lastEnter: 0,
  memoText: '',
  busy: false
};
const NO_STATS = {total: 0, running: 0, waiting: 0, queued: 0, done: 0, error: 0};

function loadMemo(){
  try {
    const v = JSON.parse(localStorage.getItem(MEMO_KEY) || '[]');
    return Array.isArray(v) ? v.filter((id) => typeof id === 'string') : [];
  } catch(e){ return []; }
}
function saveMemo(list){
  const text = JSON.stringify(list);
  if(text === DATA.memoText) return;
  DATA.memoText = text;
  try { localStorage.setItem(MEMO_KEY, text); } catch(e){ /* storage blocked: the order lasts for this visit */ }
}

/* The chantier is over: etages.js / chantier.js may say so with floorBuilt and zoneBuilt, else the floor's plot does. */
const dFloorBuilt = (fl) => typeof floorBuilt === 'function' ? floorBuilt(fl) : !fl.plot || !!fl.plot.done;
const dZoneBuilt = (fl, key) => typeof zoneBuilt === 'function' ? zoneBuilt(fl, key) : true;
const dFloorEmpty = (fl) => typeof floorEmpty === 'function' ? floorEmpty(fl) : true;
const sameInfo = (a, b) => a.state === b.state && a.waitingFor === b.waitingFor && a.role === b.role;

function agentInfo(id){ const p = DATA.placed.get(id); return p ? p.info : null; }
function floorOfAgent(id){ const p = DATA.placed.get(id); return p ? p.fd.fl : null; }

/* ----- one floor */
function floorData(spec, animate){
  const stable = stableSpec(null, spec);
  const fl = addFloor(stable, animate);
  const fd = {id: spec.id, fl, name: spec.name, sig: '', nz: 0, zoneOrder: [], zones: new Map(), seats: new Map(), gone: false, demo: false};
  DATA.floors.set(spec.id, fd); DATA.order.push(spec.id);
  stableSpec(fd, spec);
  fd.sig = specSig(fd, spec); fd.nz = fd.zoneOrder.length;
  return fd;
}
function specSig(fd, spec){ let s = spec.name; for(const k of fd.zoneOrder){ const z = fd.zones.get(k); s += '|' + k + ':' + z.label + ':' + z.colorKey; } return s; }
/* The zones keep the place they were given: the ones already on the floor first (a zone with nobody stays as an
   empty one, leadId null), then the new ones. Without `fd` it is just the plan's order. */
function stableSpec(fd, spec){
  if(!fd) return spec;
  const live = new Map();
  for(const z of spec.zones) live.set(z.key, z);
  for(const k of fd.zoneOrder) if(!live.has(k)){ const z = fd.zones.get(k); fd.zones.set(k, Object.assign({}, z, {leadId: null, memberIds: []})); }
  for(const z of spec.zones){ if(!fd.zones.has(z.key)) fd.zoneOrder.push(z.key); fd.zones.set(z.key, z); }
  // Empty zones are forgotten, oldest first, once the floor holds more zones than its capacity.
  const max = Math.max(1, CAPACITE.zones(fd.fl ? fd.fl.i : 0));
  for(let i = 0; fd.zoneOrder.length > max && i < fd.zoneOrder.length;){
    const k = fd.zoneOrder[i];
    if(live.has(k)) i++; else { fd.zoneOrder.splice(i, 1); fd.zones.delete(k); fd.seats.delete(k); }
  }
  return {id: spec.id, name: spec.name, zones: fd.zoneOrder.map((k) => fd.zones.get(k)), chefId: spec.chefId, stats: spec.stats, missions: spec.missions};
}

/* Seats of one zone: whoever sits keeps the seat; the lead takes seat 0; newcomers take the next free seat; the rest stand. */
function seatZone(fd, z){
  const S = CAPACITE.seats;
  let seats = fd.seats.get(z.key);
  if(!seats){ seats = new Array(S).fill(null); fd.seats.set(z.key, seats); }
  const lead = z.leadId, members = z.memberIds;
  for(let s = 0; s < S; s++){
    const id = seats[s];
    if(id !== null && id !== lead && members.indexOf(id) < 0) seats[s] = null;
  }
  if(lead !== null){
    const at = seats.indexOf(lead);
    if(at !== 0){
      const other = seats[0];
      if(at > 0) seats[at] = other;   // swap: the one in seat 0 takes the lead's old seat (null when none)
      seats[0] = lead;
    }
  }
  for(let i = 0; i < members.length; i++){
    const id = members[i];
    if(seats.indexOf(id) >= 0) continue;
    const free = seats.indexOf(null, 1);
    if(free > 0) seats[free] = id;
  }
  for(let i = 0; i < members.length + 1; i++){
    const id = i === 0 ? lead : members[i - 1];
    if(id === null) continue;
    DATA.wants.set(id, {fd, zoneKey: z.key, seat: seats.indexOf(id)});
  }
}

/* ----- the diff */
function applyOffice(office){
  if(!office || !Array.isArray(office.teams)) return;
  // While the core is not connected the state may be empty (the service just started): keep the scene as it is and wait
  // for a real state, so the first load is not played as arrivals and a restart does not walk everybody out.
  if(office.teams.length === 0 && office.core !== 'connected') return;
  DATA.office = office;
  syncScene();
}
function syncScene(){
  if(DATA.busy || !DATA.office) return;
  DATA.busy = true;
  try { syncNow(DATA.office); } finally { DATA.busy = false; }
}
function syncNow(office){
  const first = !DATA.loaded;
  if(first){ DATA.memo = loadMemo(); DATA.loaded = true; }
  const animate = !first && !reduced;
  // The order the plan starts from: the floors of the scene, then what a past visit remembered.
  const memo = DATA.order.concat(DATA.memo.filter((id) => DATA.order.indexOf(id) < 0));
  const plan = planImmeuble(office, memo, CAPACITE);
  DATA.memo = plan.order;   // only projects that have a team: a project gone is forgotten

  // Floors: a project with a team and no floor yet gets one on top, one chantier at a time.
  const wants = DATA.wants; wants.clear();
  const infos = DATA.infos; infos.clear();
  for(const t of office.teams) for(const a of t.agents) infos.set(a.id, a);
  let panel = false, building = DATA.order.some((id) => !dFloorBuilt(DATA.floors.get(id).fl));
  const alive = new Set();
  for(const spec of plan.floors){
    let fd = DATA.floors.get(spec.id);
    if(!fd){
      if(building && animate) continue;
      fd = floorData(spec, animate);
      panel = true;
      if(animate){
        building = true;
        toast('Nouveau projet : ' + spec.name + '. Un étage se construit.', 4200);
        if(focus < 0 && autoFit) fitNow(false);
      }
    }
    alive.add(spec.id);
    const stable = fd.fl ? stableSpec(fd, spec) : spec;
    const sig = specSig(fd, spec);
    if(sig !== fd.sig){
      const grew = stable.zones.length > fd.nz;
      fd.name = spec.name; fd.sig = sig; fd.nz = stable.zones.length; panel = true;
      updateFloor(fd.fl, stable, animate && grew);
      if(animate && grew) toast('Nouvelle équipe sur l’étage ' + spec.name + '.', 3200);
    }
    const fl = fd.fl; fl.id = spec.id; fl.name = spec.name; fl.stats = spec.stats; fl.missions = spec.missions;
    if(spec.chefId !== null) wants.set(spec.chefId, {fd, zoneKey: 'chef', seat: 0});
    for(const z of spec.zones) seatZone(fd, z);
    for(const k of fd.seats.keys()) if(!spec.zones.some((z) => z.key === k)) fd.seats.get(k).fill(null);
  }
  // A project without a team any more: nobody is seated on its floor (they walk out), then flushDemolitions takes it down.
  // If the project comes back first the floor stays; if the demolition has begun, the chantier goes on forward from where it got to.
  for(const [id, fd] of DATA.floors){
    if(alive.has(id)){
      if(fd.gone){ fd.gone = false; if(fd.demo){ fd.demo = false; if(typeof reviveFloor === 'function') reviveFloor(fd.fl); } panel = true; }
      continue;
    }
    const fl = fd.fl; fl.stats = NO_STATS; fl.missions = [];
    for(const seats of fd.seats.values()) seats.fill(null);
    if(!fd.gone) fd.goneAt = Date.now();
    fd.gone = true;
  }

  // Agents.
  for(const [id, w] of wants){
    const info = infos.get(id);
    let p = DATA.placed.get(id);
    if(!p){
      p = {info, fd: w.fd, zoneKey: w.zoneKey, seat: w.seat, a: null, pending: true};
      DATA.placed.set(id, p);
      if(first) enterNow(p, 'instant'); else DATA.queue.push(id);
      continue;
    }
    const a = p.a, old = p.info;
    p.info = info;
    if(a){
      if(!sameInfo(old, info)) setAgentState(a, info); else a.info = info;
      if(w.fd !== p.fd || w.zoneKey !== p.zoneKey || w.seat !== p.seat){
        p.fd = w.fd; p.zoneKey = w.zoneKey; p.seat = w.seat;
        moveAgent(a, w.fd.fl, deskOf(p), w.zoneKey);
      }
    } else { p.fd = w.fd; p.zoneKey = w.zoneKey; p.seat = w.seat; }
  }
  for(const [id, p] of DATA.placed){
    if(wants.has(id)) continue;
    DATA.placed.delete(id);
    if(p.a) leaveAgent(p.a);
  }

  saveMemo(plan.order);
  if(panel){ buildPanel(); updateUI(true); if(first) fitNow(true); }
  flushQueue();
}
function deskOf(p){ return p.seat < 0 ? null : deskFor(p.fd.fl, p.zoneKey, p.seat); }
function enterNow(p, how){
  p.pending = false;
  p.a = spawnAgent(p.info, p.fd.fl, deskOf(p), how, p.zoneKey);
}
/* Newcomers walk in one at a time, once their floor (and their zone) is built. */
function flushQueue(){
  clearTimeout(DATA.timer); DATA.timer = 0;
  const q = DATA.queue;
  let i = 0, wait = false;
  while(i < q.length){
    const p = DATA.placed.get(q[i]);
    if(!p || !p.pending){ q.splice(i, 1); continue; }
    if(!dFloorBuilt(p.fd.fl) || !dZoneBuilt(p.fd.fl, p.zoneKey)){ wait = true; i++; continue; }
    const now = performance.now();
    if(!reduced && now - DATA.lastEnter < ENTER_GAP_MS){ wait = true; break; }
    DATA.lastEnter = now;
    enterNow(p, reduced ? 'instant' : 'door');
    q.splice(i, 1);
  }
  if(flushDemolitions()) wait = true;
  if(wait || q.length) DATA.timer = setTimeout(flushQueue, 250);
}
/* A floor whose project has no team: once its people are out, its windows dark and no other chantier or demolition runs,
   it is demolished. Returns true while a floor still waits for that moment (the caller keeps polling). */
function flushDemolitions(){
  if(typeof demolishFloor !== 'function') return false;
  let wait = false, busy = null;
  for(const fd of DATA.floors.values()){
    if(!fd.gone || fd.demo || fd.fl.i === 0) continue;
    wait = true;
    if(Date.now() - (fd.goneAt || 0) < DATA.grace) continue;
    if(busy === null) busy = DATA.order.some((id) => !dFloorBuilt(DATA.floors.get(id).fl));
    if(busy || !dFloorEmpty(fd.fl)) continue;
    busy = true;
    fd.demo = true;
    if(!demolishFloor(fd.fl, !reduced)){ fd.demo = false; busy = null; }
  }
  return wait;
}

/* The chantier of a floor is over (the engine calls this once the build time has passed): the floor closes and its agents walk in. */
function finishFloor(fl, quiet){
  const p = fl.plot; if(!p || p.done) return;
  p.done = true;
  for(const f of p.act.splice(0)) f();
  p.workers.forEach((w) => { if(w.alive) removeAgent(w); });
  if(quiet) fl.op = focus === fl.i ? 1 : 0;
  else toast('Étage ' + (fl.i + 1) + ' prêt : ' + fl.name, 3000);
  fitNow(reduced); buildPanel(); updateUI(true);
  syncScene();
}

/* The demolition is over (chantier.js calls this when the floor has left the building): forget it, say so, go on with the next. */
function floorDemolished(fl){
  let id = null;
  for(const [k, fd] of DATA.floors) if(fd.fl === fl){ id = k; break; }
  if(id === null) return;
  const name = DATA.floors.get(id).name;
  DATA.floors.delete(id);
  const at = DATA.order.indexOf(id); if(at >= 0) DATA.order.splice(at, 1);
  toast('Projet ' + name + ' terminé : son étage est démoli.', 4200);
  buildPanel(); updateUI(true);
  syncScene();
}
