/* web/pixel/talk.js : lot L5, voir docs/vue-pixel.md (1.5 a 1.12, 2.6) */
/*
 * Played conversations of the pixel view: the events of OfficeState.events (and the chatter of people on a
 * break) become real talks between Person objects of people.js, with speech bubbles, state bubbles
 * (question mark, exclamation mark, hourglass), a log and listeners. Lot L5, contract in 2.6.
 * Shares one scope with the other web/pixel files: the public names are the ones of the 2.6 block
 * (Conversation shape, CONVERSATIONS, syncTalk, tickTalk, drawBubbles, bubbleRects, bubbleAt, openDialogFor,
 * TALK_LOG, onTalk), every other top-level name wears `tlk`. Declares only, nothing runs at load.
 *
 * Choices recorded here (all additive to 2.6):
 *  - Who stands where. delegate: the delegator walks to the desk of the receiver (parts = [delegator, receiver]).
 *    report: the reporter carries a folder to the receiver (parts = [reporter, receiver]); no receiver: the reporter
 *    speaks alone. blocked: the thread above walks to the desk of the agent in error (parts = [agent, manager]).
 *    plan validated / done: the chef and up to two managers meet at the board (fl.fx.board fills while they talk);
 *    plan proposed, waiting, answered: one speaker, nobody moves. arrive: the newcomer is taken over at the door
 *    (people.js `personArrive`) and a colleague of the ground floor comes to the entry. depart: the leaver is
 *    taken over on the ground floor when it reaches the entry, a colleague comes; people.js then finishes the exit.
 *    chat: two people at rest at the same break place keep their cup and their spot (props, pose and spots restored
 *    after personAssign) and talk.
 *  - An event waits (75 s at most) until the people it needs are at rest, then plays; one that can no longer play
 *    (person gone, newcomer already inside) is dropped. 8 events wait at most, 4 conversations play at most; chatter
 *    gives way to an event.
 *  - Rhythm: text written at 30 letters per second (at once under REDUCED), then kept 1.4 s plus 30 ms per letter.
 *  - Conversation (additive fields): `spoken` (lines begun), `solo`, `started`. TALK_LOG entries: who = thread id of
 *    the speaker, plus `name` (its title) and `idx` (index in parts). onTalk returns a function that unsubscribes.
 *  - bubbleRects(fl) entries are [x, y, w, h, conv | null] in plan px, the tail included; hit test and labels read them.
 *  - Speech bubbles are placed in plan px: above the head, shifted aside, stacked, then below the feet; inside the
 *    plate, inside the part of the view that Camera.insets leave free (the dialog box), clear of the headers of the
 *    rooms and of the people who talk. The « Qui m'attend » filter keeps only the waiting ones.
 */

const CONVERSATIONS = [];
const TALK_LOG = [];

const tlkMaxConv = 4;
const tlkMaxQueue = 8;
const tlkMaxAgeMs = 30000;       // an event older than this when the page sees it is not played (1.7)
const tlkMaxWaitMs = 75000;      // an event that cannot start for this long is dropped
const tlkSeenMax = 200;
const tlkLogMax = 300;
const tlkTypeCps = 30;
const tlkHoldBase = 1.4;
const tlkHoldPerChar = 0.03;
const tlkTextW = 100;            // wrap width of a bubble text, px
const tlkPitch = 11;             // line pitch inside a bubble: the font cell is 11 rows high
const tlkTail = 2;               // rows of a tail beyond the box
const tlkGatherMax = 45;         // seconds to reach the place (same floor)
const tlkTravelMax = 110;        // seconds, when somebody has to change floor
const tlkWait = 0;
const tlkDrop = -1;
const tlkWho = { a: 0, b: 1, c: 2 };

const tlkQueue = [];             // { ev, t0 }
const tlkSeen = new Set();
const tlkListeners = [];
const tlkAgents = new Map();     // thread id -> last OfficeAgent seen (a departed one stays)
const tlkTeams = new Map();      // thread id -> last Team seen
const tlkRecent = [];            // ids of the last lines played, for pickLines
const tlkBoards = [];            // boards to wipe a while after a meeting: { fl, t }
let tlkPrimed = false;
let tlkSeq = 0;
let tlkFrame = 0;
let tlkClock = 0;
let tlkPumpT = 0;
let tlkScanT = 0;

/* ------------------------------------------ listeners and log ------------------------------------------ */

function onTalk(fn) {
  if (typeof fn !== 'function') return () => {};
  tlkListeners.push(fn);
  return () => {
    const i = tlkListeners.indexOf(fn);
    if (i >= 0) tlkListeners.splice(i, 1);
  };
}

function tlkEmit(type, conv, entry) {
  for (let i = 0; i < tlkListeners.length; i++) {
    try {
      tlkListeners[i]({ type, conv, entry: entry || null });
    } catch (e) {
      console.error('onTalk listener', e);
    }
  }
}

function tlkTitle(p) {
  const a = tlkAgent(p.id);
  return (a && a.title) || (p.info && p.info.title) || '';
}

/* ------------------------------------------ state of the office ------------------------------------------ */

function tlkAgent(id) {
  if (!id) return null;
  const a = tlkAgents.get(id);
  if (a) return a;
  const p = personById(id);
  return (p && p.info) || null;
}

function tlkTeam(id) {
  return tlkTeams.get(id) || null;
}

function tlkIndex(office) {
  const teams = office.teams || [];
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    for (let k = 0; k < team.agents.length; k++) {
      const a = team.agents[k];
      tlkAgents.set(a.id, a);
      tlkTeams.set(a.id, team);
    }
  }
  if (tlkAgents.size > 600) {   // forget the departed ones that are long gone
    const keep = new Set();
    for (const team of teams) for (const a of team.agents) keep.add(a.id);
    for (const id of tlkAgents.keys()) if (!keep.has(id) && !personById(id)) { tlkAgents.delete(id); tlkTeams.delete(id); }
  }
}

function tlkMark(id) {
  tlkSeen.add(id);
  if (tlkSeen.size > tlkSeenMax) tlkSeen.delete(tlkSeen.values().next().value);
}

/** 1.7: the first state only marks the events as seen; afterwards every unseen event younger than 30 s plays. */
function syncTalk(office) {
  if (!office) return;
  tlkIndex(office);
  const events = office.events || [];
  const now = Date.now();
  if (!tlkPrimed) {
    tlkPrimed = true;
    for (let i = 0; i < events.length; i++) tlkMark(events[i].id);
  } else {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (tlkSeen.has(ev.id)) continue;
      tlkMark(ev.id);
      if (now - ev.at > tlkMaxAgeMs) continue;
      tlkQueue.push({ ev, t0: now });
      if (tlkQueue.length > tlkMaxQueue) tlkQueue.shift();
    }
  }
  try { tlkPump(); } catch (e) { tlkFault(e, null); }
}

/* ------------------------------------------ who can talk ------------------------------------------ */

/** A person that stands or sits still where it is: can be taken over without a visible jump. */
function tlkAtRest(p) {
  return !!p && !p.gone && p.present && p.visible && !p.tz && !p.conv && !p.leaving && !p.arriving && !p.arrival && p.trip === 0 && !!p.floor && p.pose !== 'walk';
}

/** A person that can be sent somewhere (walking is fine). */
function tlkCanMove(p) {
  return !!p && !p.gone && p.present && p.visible && !p.tz && !p.conv && !p.leaving && !p.arriving && !p.arrival && p.trip === 0 && !!p.floor;
}

/** The nearest person at rest on floor fl to the cell `near`, within walking distance; `preferId` wins ties of distance. */
function tlkPartner(fl, near, exclude, preferId) {
  let best = null;
  let bd = 1e9;
  for (let i = 0; i < PEOPLE.length; i++) {
    const q = PEOPLE[i];
    if (q.floor !== fl || q === exclude || !tlkAtRest(q)) continue;
    let d = Math.abs(q.cx - near.x) + Math.abs(q.cy - near.y);
    if (preferId && q.id === preferId) d -= 1000;
    if (d < bd) { bd = d; best = q; }
  }
  return bd < 36 ? best : null;
}

/* ------------------------------------------ recipes: who plays an event, where ------------------------------------------ */

/** A recipe: { kind, event, fl, parts, stage, assign, otherId, thirdId, keep, limit }. assign: 0 nothing, 1 role, 2 arrival then role. */
function tlkRecipe(ev) {
  switch (ev.kind) {
    case 'delegate': return tlkVisit(ev, ev.agentId, ev.fromId, true, null, false, ev.fromId);
    case 'report': return tlkReport(ev);
    case 'blocked': return tlkVisit(ev, ev.agentId, ev.toId, false, null, true, ev.toId);
    case 'waiting':
    case 'answered': return tlkSolo(ev, ev.agentId);
    case 'plan': return tlkPlan(ev);
    case 'arrive': return tlkDoor(ev, true);
    case 'depart': return tlkDoor(ev, false);
    default: return tlkDrop;
  }
}

function tlkSolo(ev, id) {
  const p = personById(id);
  if (!p || p.gone) return tlkDrop;
  if (!(p.present && p.visible && !p.tz && p.floor)) return tlkWait;
  return { kind: ev.kind, event: ev, fl: p.floor, parts: [p], stage: [null], assign: [0], otherId: null, thirdId: null, keep: null, limit: tlkGatherMax };
}

/**
 * One person visits another: `host` stays where it is, `vis` walks to the place where one stands to talk to it
 * (changing floor when needed). `visFirst`: the visitor speaks first (parts = [visitor, host]).
 */
function tlkVisit(ev, hostId, visId, visFirst, prop, soloOk, otherId) {
  const host = personById(hostId);
  if (!host || host.gone || host.leaving) return tlkDrop;
  if (!tlkAtRest(host)) return tlkWait;
  let vis = visId ? personById(visId) : null;
  if (vis && (vis.gone || vis.leaving || vis === host)) vis = null;
  if (!vis) {
    if (!soloOk) return tlkDrop;
    return { kind: ev.kind, event: ev, fl: host.floor, parts: [host], stage: [null], assign: [1], otherId: null, thirdId: null, keep: null, limit: tlkGatherMax };
  }
  if (!tlkCanMove(vis)) return tlkWait;
  const v = personVisitCell(host);
  const far = vis.floor !== host.floor;
  const vstage = { x: v.x, y: v.y, f: v.f, floor: far ? host.floor.index : undefined, prop };
  return {
    kind: ev.kind, event: ev, fl: host.floor,
    parts: visFirst ? [vis, host] : [host, vis],
    stage: visFirst ? [vstage, null] : [null, vstage],
    assign: [1, 1], otherId, thirdId: null, keep: null, limit: far ? tlkTravelMax : tlkGatherMax,
  };
}

function tlkReport(ev) {
  const rc = ev.toId ? personById(ev.toId) : null;
  if (!rc || rc.gone || rc.leaving) return tlkSolo(ev, ev.agentId);
  return tlkVisit(ev, ev.toId, ev.agentId, true, 'folder', false, ev.toId);
}

const tlkBoardSets = [[2, 0, 4], [3, 1, 5], [1, 3, 5], [0, 2, 4]];

/** Board spots for n people: the chef (first) in the middle, the others on each side, 16 px apart. */
function tlkBoardSpots(plan, n) {
  const sp = plan.spots.board;
  if (!sp || !sp.length) return null;
  for (let s = 0; s < tlkBoardSets.length; s++) {
    const set = tlkBoardSets[s];
    let ok = true;
    for (let k = 0; k < n; k++) if (!sp[set[k]] || sp[set[k]].by) ok = false;
    if (ok) return set.slice(0, n).map((i) => sp[i]);
  }
  const free = sp.filter((x) => !x.by);
  return free.length >= n ? free.slice(0, n) : null;
}

function tlkPlan(ev) {
  const chef = personById(ev.agentId);
  if (!chef || chef.gone) return tlkDrop;
  if (ev.phase === 'proposed') return tlkSolo(ev, ev.agentId);
  if (!tlkAtRest(chef)) return tlkWait;
  const fl = chef.floor;
  const team = tlkTeam(ev.agentId);
  const managers = team ? team.agents.filter((a) => a.role === 'manager' && a.id !== chef.id).sort((a, b) => a.createdAt - b.createdAt) : [];
  const parts = [chef];
  let busy = false;
  for (let i = 0; i < managers.length && parts.length < 3; i++) {
    const q = personById(managers[i].id);
    if (!q || q.gone || q.leaving || q.floor !== fl) continue;
    if (tlkCanMove(q)) parts.push(q); else busy = true;
  }
  if (parts.length === 1 && busy) return tlkWait;
  const spots = tlkBoardSpots(fl.plan, parts.length);
  const stage = parts.map((p, k) => (spots ? { x: spots[k].x, y: spots[k].y, f: 'up', spot: spots[k], pose: k === 0 ? 'hold' : 'stand', prop: k === 0 ? 'marker' : null } : null));
  return {
    kind: 'plan', event: ev, fl, parts, stage, assign: parts.map(() => 1),
    otherId: parts[1] ? parts[1].id : null, thirdId: parts[2] ? parts[2].id : null, keep: null, limit: tlkGatherMax,
  };
}

/** arrive (`arriving` true) or depart: a scene at the entry of the ground floor. */
function tlkDoor(ev, arriving) {
  const p = personById(ev.agentId);
  if (!p || p.gone) return tlkDrop;
  let fl;
  if (arriving) {
    if (!p.arrival) return tlkDrop;   // already walking in: too late to take it over
    fl = p.floor;
    if (!fl || p.trip) return tlkDrop;
  } else {
    if (!p.leaving) return tlkWait;
    fl = p.floor;
    if (!fl || fl.index !== 0 || p.tz || p.trip || !p.present || !p.visible || p.conv || p.alpha < 0.99) return tlkWait;
  }
  const spot = fl.plan.spots.entry && fl.plan.spots.entry[0];
  if (!spot) return tlkDrop;
  const info = tlkAgent(ev.agentId);
  const q = tlkPartner(fl, spot, p, (info && info.parentId) || ev.parentId || null);
  const parts = [p];
  const stage = [arriving ? null : { x: spot.x, y: spot.y, f: 'down' }];
  const assign = [arriving ? 2 : 1];
  if (q) {
    const c = freeCellNear(fl.plan, spot.x + 2, spot.y);
    parts.push(q);
    stage.push({ x: c[0], y: c[1], f: 'left' });
    assign.push(1);
  }
  return { kind: ev.kind, event: ev, fl, parts, stage, assign, otherId: q ? q.id : null, thirdId: null, keep: null, limit: tlkGatherMax };
}

/* ------------------------------------------ the queue ------------------------------------------ */

/** Ends the oldest chatter to make room for an event; true when there is room. */
function tlkMakeRoom() {
  if (CONVERSATIONS.length < tlkMaxConv) return true;
  for (let i = 0; i < CONVERSATIONS.length; i++) {
    if (CONVERSATIONS[i].kind === 'chat') { tlkEnd(CONVERSATIONS[i], true); return true; }
  }
  return false;
}

function tlkPump() {
  if (!tlkQueue.length) return;
  const now = Date.now();
  for (let i = 0; i < tlkQueue.length; ) {
    const it = tlkQueue[i];
    if (now - it.t0 > tlkMaxWaitMs) { tlkQueue.splice(i, 1); continue; }
    const r = tlkRecipe(it.ev);
    if (r === tlkDrop) { tlkQueue.splice(i, 1); continue; }
    if (r === tlkWait || !tlkMakeRoom()) { i++; continue; }
    tlkQueue.splice(i, 1);
    tlkStart(r);
  }
}

/* ------------------------------------------ conversations ------------------------------------------ */

function tlkLines(rec) {
  const now = Date.now();
  if (rec.kind === 'chat') {
    const ctx = { agent: tlkAgent(rec.parts[0].id), other: tlkAgent(rec.parts[1].id), team: tlkTeam(rec.parts[0].id), lot: null, now };
    return pickLines('chat', ctx, Math.floor(rnd(0, 4294967296)), tlkRecent);
  }
  const ev = rec.event;
  const ctx = { event: ev, agent: tlkAgent(ev.agentId), other: rec.otherId ? tlkAgent(rec.otherId) : null, team: tlkTeam(ev.agentId), lot: null, now };
  if (rec.thirdId) ctx.third = tlkAgent(rec.thirdId);
  return pickLines(ev.kind, ctx, hash(ev.id), tlkRecent);
}

function tlkHoldFor(text) {
  return tlkHoldBase + tlkHoldPerChar * text.length;
}

function tlkStart(rec) {
  const lines = tlkLines(rec);
  if (!lines || !lines.length) return false;
  const solo = rec.assign.every((k) => k === 0);
  if (solo) {   // one speech at a time per person
    for (let i = CONVERSATIONS.length - 1; i >= 0; i--) if (CONVERSATIONS[i].solo && CONVERSATIONS[i].parts[0] === rec.parts[0]) tlkEnd(CONVERSATIONS[i], true);
  }
  const conv = {
    id: 'cv' + (++tlkSeq), kind: rec.kind,
    floor: rec.fl, parts: rec.parts.slice(), lines: lines.map((l) => ({ who: tlkWho[l.who], text: l.text })), line: 0,
    phase: 'gather', typed: 0, cur: null, event: rec.event || null,
    spoken: 0, solo, started: false, stage: rec.stage, keep: rec.keep || [], ready: [], assigned: [],
    gt: 0, limit: rec.limit, tf: 0, shown: -1, tdone: false, hold: 0, holdFor: 0, elapsed: 0, total: 0,
    buf: null, fill: 'white', mark: null,
  };
  for (const l of conv.lines) conv.total += l.text.length / tlkTypeCps + tlkHoldFor(l.text);
  let ok = true;
  for (let i = 0; i < conv.parts.length; i++) {
    const p = conv.parts[i];
    conv.ready[i] = rec.assign[i] === 0;
    conv.assigned[i] = false;
    if (rec.assign[i] === 0) continue;
    const had = conv.keep[i] || null;
    p.conv = conv;
    if (!personAssign(p, (q) => tlkRole(conv, q, i))) { ok = false; p.conv = null; break; }
    conv.assigned[i] = true;
    const st = conv.stage[i];
    if (st && st.spot) { st.spot.by = p; p.res.push(st.spot); }
    if (had) tlkRestore(p, had);
  }
  if (!ok) {
    conv.phase = 'end';
    for (const p of conv.parts) if (p.conv === conv) p.conv = null;
    return false;
  }
  if (conv.kind === 'plan' && conv.floor.fx) conv.floor.fx.board = 0;
  CONVERSATIONS.push(conv);
  return true;
}

/** Puts back what personAssign cleared (cup in hand, pose, facing, reserved spots) for people who keep their place. */
function tlkRestore(p, snap) {
  p.prop = snap.prop;
  p.pose = snap.pose;
  p.dir = snap.dir;
  for (let i = 0; i < snap.res.length; i++) {
    const s = snap.res[i];
    if (!s.by) { s.by = p; p.res.push(s); }
  }
}

/** Turns a person who stands towards the one who speaks (or, for the speaker, towards the first listener). */
function tlkFace(conv, p, i) {
  if (p.seated || conv.parts.length < 2 || (conv.kind === 'plan' && i === 0)) return;
  const cur = conv.cur;
  let oi = i === 0 ? 1 : 0;
  if (cur && cur.who !== i) oi = cur.who;
  const o = conv.parts[oi];
  if (o && o !== p && o.floor === p.floor && !o.tz) personFaceTo(p, o);
}

/** The behaviour of one person of a conversation: reach the place, hold it until the talk ends. */
function* tlkRole(conv, p, i) {
  const st = conv.stage[i];
  try {
    if (conv.kind === 'arrive' && i === 0 && p.arrival) yield* personArrive(p);
    if (st) {
      if (st.floor !== undefined && p.floor.index !== st.floor) {
        yield* personTravel(p, st.floor, null);
        if (conv.phase === 'end') return;
      }
      if (st.prop) p.prop = st.prop;
      yield* personWalkTo(p, st.x, st.y);
      if (conv.phase === 'end') return;
      if (st.f) p.dir = st.f;
      p.pose = st.pose || 'stand';
    } else if (!conv.keep[i]) {
      p.pose = conv.kind === 'blocked' && i === 0 ? 'hand' : p.seated ? 'sit' : 'stand';
    }
    conv.ready[i] = true;
    while (conv.phase !== 'end') {
      tlkFace(conv, p, i);
      yield;
    }
  } finally {
    if (p.conv === conv) p.conv = null;
    actRelease(p);
    if (st && st.prop && p.prop === st.prop) p.prop = null;
    if (conv.keep[i]) p.prop = null;
    if (p.pose !== 'walk') p.pose = p.seated ? 'sit' : 'stand';
  }
}

function tlkFillFor(conv, who) {
  if (conv.kind === 'waiting' || conv.kind === 'answered') return 'lampHi';
  return conv.kind === 'blocked' && who === 0 ? 'lampHi' : 'white';
}

/** Draws the box and the letters shown so far into the bubble canvas of the conversation. */
function tlkPaint(conv) {
  const cur = conv.cur;
  const b = conv.buf;
  const g = b.g;
  const w = cur.w;
  const h = cur.h;
  g.clearRect(0, 0, b.c.width, b.c.height);
  tlkBox(g, 0, 0, w, h, conv.fill);
  const accent = conv.kind === 'blocked' && cur.who === 0 ? 'red' : conv.kind === 'waiting' ? 'lamp' : null;
  if (accent) rect(g, 1, 2, 2, h - 4, accent);
  let pos = 0;
  const text = cur.text;
  for (let i = 0; i < cur.wrapped.length; i++) {
    const line = cur.wrapped[i];
    const shown = Math.max(0, Math.min(line.length, conv.typed - pos));
    if (shown > 0) drawText(g, shown === line.length ? line : line.slice(0, shown), 4, 2 + i * tlkPitch, 'ink');
    pos += line.length;
    if (text.charAt(pos) === ' ') pos++;
  }
}

function tlkBox(g, x, y, w, h, fill) {
  rect(g, x + 1, y, w - 2, h, 'ink');
  rect(g, x, y + 1, w, h - 2, 'ink');
  rect(g, x + 1, y + 1, w - 2, h - 2, fill);
}

function tlkBeginLine(conv) {
  const ln = conv.lines[conv.line];
  const wrapped = wrapText(ln.text, tlkTextW);
  let w = 0;
  for (let i = 0; i < wrapped.length; i++) w = Math.max(w, textWidth(wrapped[i]));
  const cur = { who: ln.who, text: ln.text, wrapped, w: Math.max(20, w + 8), h: (wrapped.length - 1) * tlkPitch + 15 };
  conv.cur = cur;
  conv.spoken = conv.line + 1;
  conv.typed = 0;
  conv.tf = 0;
  conv.shown = -1;
  conv.tdone = false;
  conv.hold = 0;
  conv.holdFor = tlkHoldFor(ln.text);
  conv.fill = tlkFillFor(conv, ln.who);
  if (!conv.buf || conv.buf.c.width !== cur.w || conv.buf.c.height !== cur.h) conv.buf = makeBuffer(cur.w, cur.h);
  const speaker = conv.parts[ln.who];
  const entry = {
    at: Date.now(), convId: conv.id, kind: conv.kind, floorId: conv.floor ? conv.floor.id : null,
    fromId: conv.parts[0].id, toId: conv.parts[1] ? conv.parts[1].id : null,
    who: speaker.id, name: tlkTitle(speaker), idx: ln.who, text: ln.text,
  };
  TALK_LOG.push(entry);
  if (TALK_LOG.length > tlkLogMax) TALK_LOG.splice(0, TALK_LOG.length - tlkLogMax);
  tlkEmit('line', conv, entry);
}

function tlkEnd(conv, aborted) {
  if (conv.phase === 'end') return;
  conv.phase = 'end';
  conv.cur = null;
  const i = CONVERSATIONS.indexOf(conv);
  if (i >= 0) CONVERSATIONS.splice(i, 1);
  for (let k = 0; k < conv.parts.length; k++) {
    const p = conv.parts[k];
    if (p.conv === conv) p.conv = null;
    if (aborted && conv.assigned[k] && !p.gone) personCancel(p);   // a trip is never cut: personCancel does nothing then, the role ends by itself
  }
  if (conv.kind === 'plan' && conv.floor && conv.floor.fx) tlkBoards.push({ fl: conv.floor, t: 6 });
  if (conv.started) tlkEmit('end', conv, null);
  if (typeof dbxUpdate === 'function') dbxUpdate();
}

function tlkStep(conv, dt) {
  for (let i = 0; i < conv.parts.length; i++) {
    if (conv.parts[i].gone) { tlkEnd(conv, true); return; }
  }
  if (conv.phase === 'gather') {
    conv.gt += dt;
    let all = true;
    for (let i = 0; i < conv.ready.length; i++) if (!conv.ready[i]) all = false;
    if (all) {
      conv.phase = 'talk';
      conv.started = true;
      conv.line = 0;
      tlkEmit('start', conv, null);
      tlkBeginLine(conv);
    } else if (conv.gt > conv.limit) {
      tlkEnd(conv, true);
    }
    return;
  }
  conv.elapsed += dt;
  if (conv.kind === 'plan' && conv.floor.fx) conv.floor.fx.board = Math.min(1, conv.elapsed / Math.max(1, conv.total));
  const cur = conv.cur;
  if (!conv.tdone) {
    if (REDUCED) {
      conv.typed = cur.text.length;
    } else {
      conv.tf += dt * tlkTypeCps;
      conv.typed = Math.min(cur.text.length, Math.floor(conv.tf));
    }
    if (conv.typed !== conv.shown) { conv.shown = conv.typed; tlkPaint(conv); }
    if (conv.typed >= cur.text.length) {
      conv.tdone = true;
      for (let i = 0; i < conv.parts.length; i++) if (i !== cur.who) conv.parts[i].nod = 0.6;   // the listeners nod
    }
    return;
  }
  conv.hold += dt;
  if (conv.hold < conv.holdFor) return;
  if (conv.line + 1 < conv.lines.length) {
    conv.line++;
    tlkBeginLine(conv);
  } else {
    tlkEnd(conv, false);
  }
}

/* ------------------------------------------ chatter ------------------------------------------ */

const tlkChatActs = { coffee: 1, fountain: 1, window: 1, rail: 1, smoke: 1, sofa: 1 };
const tlkRest = new WeakMap();    // Person -> { act, since }: since when the person does that at rest
const tlkCool = new WeakMap();    // Person -> tlkClock until which it does not start another chat
const tlkCands = [];
let tlkLastChat = -100;          // tlkClock of the last chat start

function tlkChatCount() {
  let n = 0;
  for (let i = 0; i < CONVERSATIONS.length; i++) if (CONVERSATIONS[i].kind === 'chat') n++;
  return n;
}

/** Two people at rest on the same floor and the same break place start to chat (1.11). Runs twice a second. */
function tlkScan() {
  if (CONVERSATIONS.length >= tlkMaxConv - 1 || tlkChatCount() >= 2 || tlkClock - tlkLastChat < 3) return;
  const c = tlkCands;
  c.length = 0;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (!p.floor || !tlkAtRest(p) || !tlkChatActs[p.act]) continue;
    let r = tlkRest.get(p);
    if (!r || r.act !== p.act) { r = { act: p.act, since: tlkClock }; tlkRest.set(p, r); }
    if (tlkClock - r.since < 1.5 || (tlkCool.get(p) || 0) > tlkClock) continue;
    c.push(p);
  }
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const a = c[i];
      const b = c[j];
      if (a.floor !== b.floor || a.act !== b.act || Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy) > 7) continue;
      if (rnd(0, 1) > 0.55) continue;
      const first = tlkRest.get(a).since <= tlkRest.get(b).since ? a : b;
      tlkStartChat(first, first === a ? b : a);
      return;
    }
  }
}

function tlkSnap(p) {
  return { prop: p.prop, pose: p.pose, dir: p.dir, res: p.res.slice() };
}

function tlkStartChat(a, b) {
  const rec = {
    kind: 'chat', event: null, fl: a.floor, parts: [a, b], stage: [null, null], assign: [1, 1],
    otherId: null, thirdId: null, keep: [tlkSnap(a), tlkSnap(b)], limit: tlkGatherMax,
  };
  if (tlkStart(rec)) {
    tlkLastChat = tlkClock;
    tlkCool.set(a, tlkClock + 40);
    tlkCool.set(b, tlkClock + 40);
  }
}

/* ------------------------------------------ the tick ------------------------------------------ */

let tlkFaults = 0;

/** A fault in a conversation must never stop the frame loop: it is logged (three times at most) and the conversation ends. */
function tlkFault(e, conv) {
  if (tlkFaults++ < 3) console.error('talk', e);
  if (conv) {
    try { tlkEnd(conv, true); } catch (e2) { const i = CONVERSATIONS.indexOf(conv); if (i >= 0) CONVERSATIONS.splice(i, 1); }
  }
}

function tickTalk(dt) {
  tlkFrame++;
  tlkClock += dt;
  for (let i = CONVERSATIONS.length - 1; i >= 0; i--) {
    const conv = CONVERSATIONS[i];
    if (!conv) continue;
    try { tlkStep(conv, dt); } catch (e) { tlkFault(e, conv); }
  }
  tlkPumpT += dt;
  if (tlkPumpT >= 0.25) {
    tlkPumpT = 0;
    try { tlkPump(); } catch (e) { tlkFault(e, null); }
  }
  tlkScanT += dt;
  if (tlkScanT >= 0.5) {
    tlkScanT = 0;
    try { tlkScan(); } catch (e) { tlkFault(e, null); }
  }
  for (let i = tlkBoards.length - 1; i >= 0; i--) {
    const b = tlkBoards[i];
    b.t -= dt;
    if (b.t > 0) continue;
    tlkBoards.splice(i, 1);
    let busy = false;
    for (let k = 0; k < CONVERSATIONS.length; k++) if (CONVERSATIONS[k].kind === 'plan' && CONVERSATIONS[k].floor === b.fl) busy = true;
    if (!busy && b.fl.fx) b.fl.fx.board = 0;
  }
  if (typeof dbxUpdate === 'function') dbxUpdate();
}

/* ------------------------------------------ bubbles ------------------------------------------ */

const tlkItems = [];              // reused: one per bubble of the floor being drawn
const tlkObst = [];               // reused: boxes of the people who talk, [x, y, w, h] (a bubble never covers them)
const tlkSoft = [];               // reused: boxes of everybody else on the floor (a bubble avoids them when it can)
const tlkKeepCache = new WeakMap();
const tlkPref = new WeakMap();    // Person -> candidate index that fitted last time (no flicker)
const tlkOut = [];                // by floor index: { frame, list, pool }
const tlkEmpty = [];
const tlkShifts = [0, -0.35, 0.35, -0.7, 0.7, -1.05, 1.05];
const tlkWide = 13 + 7 * 2 * 4;
const tlkCandidates = tlkWide + 2 * 28;
const tlkBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
let tlkN = 0;
let tlkNo = 0;
let tlkNs = 0;
let tlkStateImgs = null;
let tlkCx = 0;
let tlkCy = 0;
let tlkCw = 0;
let tlkCh = 0;
let tlkCm = 0;
let tlkLeft = 0;
let tlkSeeY0 = 0;
let tlkSeeY1 = 0;
let tlkRight = 0;

function tlkItem() {
  let it = tlkItems[tlkN];
  if (!it) it = tlkItems[tlkN] = { p: null, conv: null, img: null, w: 0, h: 0, ax: 0, top: 0, feet: 0, fill: 'white' };
  tlkN++;
  return it;
}

function tlkStates() {
  if (tlkStateImgs) return tlkStateImgs;
  const mk = (w, h, fill, draw) => {
    const b = makeBuffer(w, h);
    tlkBox(b.g, 0, 0, w, h, fill);
    draw(b.g);
    return b.c;
  };
  tlkStateImgs = {
    q0: mk(11, 13, 'lamp', (g) => drawText(g, '?', 3, 1, 'ink')),
    q1: mk(11, 13, 'lampHi', (g) => drawText(g, '?', 3, 1, 'ink')),
    bang: mk(11, 13, 'red', (g) => drawText(g, '!', 5, 1, 'white')),
    hour: mk(11, 11, 'steelD', (g) => g.drawImage(PROPS.hourglass, 3, 3)),
  };
  return tlkStateImgs;
}

/**
 * Boxes (plan px) that no bubble may cover: the containers of the labels that floor.js draws on the text layer and always
 * keeps (it only omits desk names, room headers and « Postes libres » when a bubble touches them, and a bubble must not
 * hide a room name): room headers, « Postes libres », chef panels and the fixed signs. They mirror the `flrSetBox` boxes of
 * drawFloorLabels; heights are those of a line at zoom 1, the largest.
 */
function tlkKeep(plan) {
  let k = tlkKeepCache.get(plan);
  if (!k) {
    k = [];
    for (const rm of plan.rooms) k.push([rm.header.x, rm.header.y, rm.header.w, 22]);
    if (plan.open.rect.w > 0) k.push([plan.open.rect.x * CELL, 74, Math.min(plan.open.rect.w * CELL, 92), 13]);
    const W = plan.width;
    for (const o of plan.offices) k.push([o.rect.x * CELL + 128, 32, 88, 24]);
    k.push([52, 274, 46, 12]);                  // Cafétéria
    k.push([W - 112, 298, 64, 12]);             // Sanitaires
    k.push([8, 308, 100, 12]);                  // Escalier
    k.push([W - 108, 308, 100, 12]);            // Ascenseur
    if (plan.id === '') k.push([Math.round((W * 0.4) / CELL) * CELL - 52, 338, 42, 11]);   // Accueil
    tlkKeepCache.set(plan, k);
  }
  return k;
}

function tlkHits(x, y, w, h, r) {
  return x < r[0] + r[2] && r[0] < x + w && y < r[1] + r[3] && r[1] < y + h;
}

/**
 * Tries candidate c of item `it`; on success leaves the rect (top left, tail included) in tlkCx, tlkCy, tlkCw, tlkCh and the
 * tail kind in tlkCm (0 tail down, 1 tail up, 2 tail left: box on the right of the speaker, 3 tail right). Candidates:
 * 0 to 2 above the head (centred, reaching left, reaching right), 3 to 5 the same below the feet, 6 and 7 beside the head
 * (right, left), 8 and 9 beside the whole group of people who talk (right, left), 10 to 12 stacked above 0 to 2.
 * `soft`: also keep clear of the people who do not talk. `loose` 1: the keep-out boxes are ignored, 2: the people who talk too.
 */
function tlkTryCandidate(it, c, placed, np, keep, soft, loose) {
  const w = it.w;
  const h = it.h;
  const b = tlkBounds;
  let x;
  let y;
  let ww = w;
  let hh = h + tlkTail;
  let m = 0;
  if (c >= tlkWide) {   // far beside the head, further and further: the last resort of a squeezed corner
    const k = c - tlkWide;
    const right = (k & 1) === 0;
    const off = 14 + (k >> 1) * 16;
    m = right ? 2 : 3;
    ww = w + tlkTail;
    hh = h;
    x = Math.round(right ? it.ax + off : it.ax - off - ww);
    y = Math.max(b.y0, Math.min(b.y1 - hh, (it.top + it.feet) / 2 - h / 2));   // beside the head, slid inside the free part of the plate
  } else if (c > 12) {   // wide search: eight offsets along the row, above or below, up to four bubbles higher
    const e = c - 13;
    const dx = tlkShifts[e % 7];
    const below = ((e / 7) | 0) % 2 === 1;
    const lvl = (e / 14) | 0;
    x = Math.round(it.ax + dx * w - w / 2);
    if (x + w > b.x1) x = b.x1 - w;
    if (x < b.x0) x = b.x0;
    if (below) { m = 1; y = it.feet + 3 + lvl * (h + 3); } else y = it.top - 3 - hh - lvl * (h + 3);
  } else if (c < 6 || c > 9) {
    const col = c < 6 ? c % 3 : (c - 10) % 3;
    x = Math.round(col === 0 ? it.ax - w / 2 : col === 1 ? it.ax - w + 12 : it.ax - 12);
    if (x + w > b.x1) x = b.x1 - w;
    if (x < b.x0) x = b.x0;
    if (c >= 3 && c < 6) { m = 1; y = it.feet + 3; } else y = it.top - 3 - hh - (c > 9 ? h + 3 : 0);
  } else {
    const right = c === 6 || c === 8;
    m = right ? 2 : 3;
    ww = w + tlkTail;
    hh = h;
    const edge = c < 8 ? (right ? it.ax + 9 : it.ax - 9) : right ? Math.max(tlkRight, it.ax + 6) + 5 : Math.min(tlkLeft, it.ax - 6) - 5;
    x = Math.round(right ? edge : edge - ww);
    y = Math.max(b.y0, Math.min(b.y1 - hh, (it.top + it.feet) / 2 - h / 2));   // beside the head, slid inside the free part of the plate
  }
  y = Math.round(y);
  tlkCx = x;
  tlkCy = y;
  tlkCw = ww;
  tlkCh = hh;
  tlkCm = m;
  if (x < b.x0 || x + ww > b.x1 || y < b.y0 || y + hh > b.y1) return false;
  for (let i = 0; i < np; i++) if (tlkHits(x, y, ww, hh, placed[i])) return false;
  if (loose !== 1) for (let i = 0; i < keep.length; i++) if (tlkHits(x, y, ww, hh, keep[i])) return false;
  if (loose !== 2) for (let i = 0; i < tlkNo; i++) if (tlkHits(x, y, ww, hh, tlkObst[i])) return false;
  if (soft) for (let i = 0; i < tlkNs; i++) if (tlkHits(x, y, ww, hh, tlkSoft[i])) return false;
  return true;
}

/** An outlined wedge of two rows leaving the box edge row y (tail down: s = 1, tail up: s = -1) at column tx. */
function tlkDrawTail(g, fill, tx, y, up) {
  const s = up ? -1 : 1;
  rect(g, tx - 2, y, 1, 1, 'ink');
  rect(g, tx - 1, y, 3, 1, fill);
  rect(g, tx + 2, y, 1, 1, 'ink');
  rect(g, tx - 1, y + s, 1, 1, 'ink');
  rect(g, tx, y + s, 1, 1, fill);
  rect(g, tx + 1, y + s, 1, 1, 'ink');
  rect(g, tx, y + 2 * s, 1, 1, 'ink');
}

/** The same on a side edge: column x is the border column of the box, `dir` -1 points left, +1 points right. */
function tlkDrawSideTail(g, fill, x, ty, dir) {
  rect(g, x, ty - 2, 1, 1, 'ink');
  rect(g, x, ty - 1, 1, 3, fill);
  rect(g, x, ty + 2, 1, 1, 'ink');
  rect(g, x + dir, ty - 1, 1, 1, 'ink');
  rect(g, x + dir, ty, 1, 1, fill);
  rect(g, x + dir, ty + 1, 1, 1, 'ink');
  rect(g, x + 2 * dir, ty, 1, 1, 'ink');
}

function tlkOutOf(fl) {
  let o = tlkOut[fl.index];
  if (!o) o = tlkOut[fl.index] = { frame: -1, list: [], pool: [], n: 0 };
  return o;
}

function tlkShownOn(p, fl, filter) {
  if (!p || p.floor !== fl || !p.present || !p.visible || p.tz) return false;
  if (p.y < tlkSeeY0 || p.y - 20 > tlkSeeY1 || p.x < tlkBounds.x0 - 8 || p.x > tlkBounds.x1 + 8) return false;   // out of the view: no floating bubble
  return !filter || (p.info && p.info.state === 'waiting');
}

function tlkTalking(p) {
  if (p.conv && p.conv.phase === 'talk') return true;
  for (let i = 0; i < CONVERSATIONS.length; i++) {
    const cv = CONVERSATIONS[i];
    if (cv.phase === 'talk' && cv.solo && cv.parts[0] === p) return true;
  }
  return false;
}

/**
 * State bubbles and speech bubbles of floor fl, in buffer px (g has the identity transform). Placed in plan px so that
 * bubbleRects is exact; the rects of this frame stay in tlkOut[fl.index] for the labels and the hit test.
 */
function drawBubbles(g, fl, cam, T) {
  try {
    tlkDrawBubbles(g, fl, cam, T);
  } catch (e) {
    tlkFault(e, null);
  }
}

function tlkDrawBubbles(g, fl, cam, T) {
  const out = tlkOutOf(fl);
  out.frame = tlkFrame;
  out.list.length = 0;
  out.n = 0;
  const plan = fl.plan;
  const filter = typeof pplWaitFilter !== 'undefined' && pplWaitFilter;
  // plan px of the part of the plate that the view shows and that the dialog box leaves free
  const o0 = floorToScreen(fl, cam, 0, 0);
  const ox = o0.x;
  const oy = o0.y;
  const ins = cam.insets;
  const b = tlkBounds;
  const seeY0 = ins.top - oy;
  const seeY1 = cam.bh - ins.bottom - oy;
  b.x0 = Math.max(2, ins.left - ox + 1);
  b.x1 = Math.min(plan.width - 2, cam.bw - ins.right - ox - 1);
  b.y0 = Math.max(1, seeY0 + 1);
  b.y1 = Math.min(PLATE_H - 1, seeY1 - 1);
  tlkSeeY0 = seeY0;
  tlkSeeY1 = seeY1;
  tlkN = 0;
  tlkNo = 0;
  tlkLeft = 1e9;
  tlkRight = -1e9;
  for (let i = 0; i < CONVERSATIONS.length; i++) {
    const cv = CONVERSATIONS[i];
    if (cv.phase !== 'talk') continue;
    for (let k = 0; k < cv.parts.length; k++) {
      const q = cv.parts[k];
      if (q.floor !== fl || !q.visible || q.tz) continue;
      let o = tlkObst[tlkNo];
      if (!o) o = tlkObst[tlkNo] = [0, 0, 0, 0];
      o[0] = q.x - 6; o[1] = q.y - 20; o[2] = 12; o[3] = 21;
      if (o[0] < tlkLeft) tlkLeft = o[0];
      if (o[0] + 12 > tlkRight) tlkRight = o[0] + 12;
      tlkNo++;
    }
    const cur = cv.cur;
    if (!cur || !cv.buf) continue;
    const p = cv.parts[cur.who];
    if (!tlkShownOn(p, fl, filter)) continue;
    const it = tlkItem();
    it.p = p; it.conv = cv; it.img = cv.buf.c; it.w = cur.w; it.h = cur.h; it.ax = p.x; it.top = p.y - 21; it.feet = p.y; it.fill = cv.fill;
  }
  const people = peopleOnFloor(fl);
  const st = tlkStates();
  const pulse = REDUCED ? 0 : ((T * 2) | 0) & 1;
  tlkNs = 0;
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    if (!p.visible || p.alpha < 0.5 || !p.info) continue;
    if (p.y < seeY0 - 24 || p.y - 40 > seeY1) continue;   // too far from the view to matter for placement
    if (!(p.conv && p.conv.phase === 'talk')) {
      let o = tlkSoft[tlkNs];
      if (!o) o = tlkSoft[tlkNs] = [0, 0, 0, 0];
      o[0] = p.x - 6; o[1] = p.y - 20; o[2] = 12; o[3] = 21;
      tlkNs++;
    }
    const s = p.info.state;
    const img = s === 'waiting' ? (pulse ? st.q1 : st.q0) : s === 'error' ? st.bang : p.icon === 'hourglass' ? st.hour : null;
    if (!img || tlkTalking(p) || !tlkShownOn(p, fl, filter)) continue;
    const it = tlkItem();
    it.p = p; it.conv = null; it.img = img; it.w = img.width; it.h = img.height; it.ax = p.x; it.top = p.y - 21; it.feet = p.y;
    it.fill = s === 'waiting' ? (pulse ? 'lampHi' : 'lamp') : s === 'error' ? 'red' : 'steelD';
  }
  if (tlkN === 0) return;

  const keep = tlkKeep(plan);
  const placed = out.pool;
  let np = 0;
  for (let n = 0; n < tlkN; n++) {
    const it = tlkItems[n];
    let ok = false;
    const pref = tlkPref.get(it.p);
    if (pref !== undefined && tlkTryCandidate(it, pref >> 3, placed, np, keep, (pref & 1) === 1, (pref >> 1) & 3)) {
      ok = true;
    } else {
      // passes: clear of everybody; clear of the talkers only; the same stacked and shifted wide; then, for a speech, rather
      // than none, over the people who talk (never over a bubble or a name)
      for (let pass = 0; pass < (it.conv ? 4 : 3) && !ok; pass++) {
        const soft = pass === 0 ? 1 : 0;
        const loose = pass === 3 ? 2 : 0;
        const from = pass >= 2 ? 10 : 0;
        const to = pass === 0 || pass === 1 ? 10 : tlkCandidates;
        for (let c = pass > 2 ? 0 : from; c < to; c++) {
          if (tlkTryCandidate(it, c, placed, np, keep, soft === 1, loose)) { tlkPref.set(it.p, (c << 3) | (loose << 1) | soft); ok = true; break; }
        }
      }
    }
    if (!ok) continue;   // no free place for it in the visible part of the plate: left out this frame (the dialog box has the line)
    let r = placed[np];
    if (!r) r = placed[np] = [0, 0, 0, 0, null];
    r[0] = tlkCx; r[1] = tlkCy; r[2] = tlkCw; r[3] = tlkCh; r[4] = it.conv;
    np++;
    out.list.push(r);
    const sx = Math.round(ox) + tlkCx + (tlkCm === 2 ? tlkTail : 0);
    const sy = Math.round(oy) + tlkCy + (tlkCm === 1 ? tlkTail : 0);
    g.drawImage(it.img, sx, sy);
    if (tlkCm < 2) {
      const tx = sx + Math.max(4, Math.min(it.w - 5, Math.round(it.ax) - (tlkCx + 0)));
      if (tlkCm === 1) tlkDrawTail(g, it.fill, tx, sy, true);
      else tlkDrawTail(g, it.fill, tx, sy + it.h - 1, false);
    } else {
      const mid = Math.round((it.top + it.feet) / 2) - 3;
      const ty = Math.round(oy) + Math.max(tlkCy + 4, Math.min(tlkCy + it.h - 5, mid));
      if (tlkCm === 2) tlkDrawSideTail(g, it.fill, sx, ty, -1);
      else tlkDrawSideTail(g, it.fill, sx + it.w - 1, ty, 1);
    }
  }
  out.n = np;
}

/** Plan px boxes of the bubbles drawn this frame on fl: [x, y, w, h, conv | null]. A reused array, empty when none was drawn. */
function bubbleRects(fl) {
  const o = tlkOut[fl.index];
  return o && o.frame === tlkFrame ? o.list : tlkEmpty;
}

/** The conversation whose speech bubble holds the plan point (px, py) of floor fl, or null. */
function bubbleAt(fl, px, py) {
  const list = bubbleRects(fl);
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r[4] && px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]) return r[4];
  }
  return null;
}

/** A click on a bubble or on one of the pair: the dialog box (dialog.js). */
function openDialogFor(conv) {
  if (conv && typeof showDialog === 'function') showDialog(conv);
}
