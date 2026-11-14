/* web/pixel/boot.js : lot L6, voir docs/vue-pixel.md (2.10) */
/*
 * Starts everything and is the only file that runs at load: applyOffice (a state of the service becomes floors,
 * people and talks), the frame loop, window.Pixel for app.js, window.__pixel for tests and captures. Lot L6,
 * contract in 2.10. Shares one scope with the other web/pixel files: the public names are Pixel, applyOffice and
 * getOffice, every other top-level name wears `boo`.
 *
 * Every module is called straight (no typeof guard): advanced.js, tubes.js, journal.js and techplan.js are in the page.
 *
 * Choices recorded here (additions to 2.10, all additive):
 *  - Pixel.toast(text, ms, err): app.js shows its messages through the toast of ui.js, so one timer owns #toast.
 *  - Pixel.onOpenThread: set by app.js, called by dialog.js (« Ouvrir la conversation » of the dialog box), see L5b.
 *  - The first state places everything without animation (syncFloors and syncPeople with animate false), then picks the
 *    floor to show: the lowest one where somebody waits, else the first floor of a project, else the ground floor.
 *    syncFloors' shiftY goes to navShift, so a floor added on top never moves the picture.
 *  - A new frame order detail: setFloorTiers also runs at the start of the render, after navTick moved the camera, so a
 *    floor that scrolls into view is drawn at once (the update runs it with the camera of the frame before).
 *  - Every frame: updateFloorBar, uiTick (clock, chip) and inpTick (hover) after the scene is presented.
 *  - A throw in a frame is logged (once per message every 5 s) and the loop goes on.
 *  - window.__pixel adds applyMs and counters to stats() (the cost of the last applyOffice, floors drawn, buffer size),
 *    bubbles() (the speech boxes of the last frame) and pick(sx, sy) (pickScene) for tests and captures.
 */

let booOffice = null;
let booLoop = null;
let booBuf = null;                 // the scene buffer { c, g }
let booScene = null;               // canvas #scene
let booText = null;                // canvas #texte
let booTg = null;                  // its 2d context
let booFrozen = false;
let booApplyMs = 0;
let booApplyFirstMs = 0;
let booApplyMaxMs = 0;
const booSteps = { floors: 0, people: 0, talk: 0, hud: 0, nav: 0, first: null };   // ms of the parts of the last applyOffice (first: of the first one)
let booWorldW = 0;
let booTextClear = true;
let booErrKey = '';
let booErrAt = 0;
let booFakeSeq = 0;
let booLastT = 0;

/* ------------------------------ Pixel (for app.js) ------------------------------ */

const Pixel = {
  state(office) { applyOffice(office); },
  select(id) {
    setSelected(id || null);
    const fl = id ? floorOfPerson(id) : null;
    if (fl) navGoto(fl.index);
  },
  filterWaiting(on) { setWaitFilter(!!on); },
  portrait(canvas, id) { drawPortrait(canvas, id); },
  toast(text, ms, err) { toast(text, ms, err); },
  view(mode) {
    if (mode === undefined) return NAV.mode;
    navSetMode(mode);
    return NAV.mode;
  },
  onAgentClick: null,
  onOpenThread: null,        // set by app.js: (id) => open the Boite thread of that agent (the dialog box calls it)
  onFloorChange: null,
  onViewChange: null,
};

/* ------------------------------ state ------------------------------ */

/** The floor to show first: where somebody waits (lowest), else the first project floor, else the ground floor. */
function booFirstFloor() {
  for (const fl of FLOORS) if (fl.stats && fl.stats.waiting > 0) return fl.index;
  return Math.min(1, FLOORS.length - 1);
}

/**
 * Brings the page in line with a state of the service. The first one places everything without animation. In order:
 * syncFloors, syncPeople, syncTalk, refreshJournal, updateHud, advLayout when floors changed. An empty state received
 * while the core is not 'connected' is ignored, as in the isometric view.
 */
function applyOffice(office) {
  if (!office) return;
  const teams = office.teams || [];
  if (!teams.length && office.core !== 'connected') return;
  const t0 = performance.now();
  const first = booOffice === null;
  booOffice = office;
  const r = syncFloors(office, !first);
  navShift(r.shiftY);
  const t1 = performance.now();
  syncPeople(office, !first);
  const t2 = performance.now();
  syncTalk(office);
  refreshJournal();
  const t3 = performance.now();
  updateHud(office);
  if (r.added.length || r.removed.length || r.changed.length) advLayout(FLOORS);
  const t4 = performance.now();
  const size = navWorld();
  if (first || size.w !== booWorldW) {
    booWorldW = size.w;
    navFitZoom();
    if (first) navGoto(booFirstFloor(), 'now');
  }
  const t5 = performance.now();
  booApplyMs = t5 - t0;
  booSteps.floors = t1 - t0; booSteps.people = t2 - t1; booSteps.talk = t3 - t2; booSteps.hud = t4 - t3; booSteps.nav = t5 - t4;
  if (first) booSteps.first = { floors: booSteps.floors, people: booSteps.people, talk: booSteps.talk, hud: booSteps.hud, nav: booSteps.nav };
  if (first) booApplyFirstMs = booApplyMs;
  if (booApplyMs > booApplyMaxMs) booApplyMaxMs = booApplyMs;
}

function getOffice() { return booOffice; }

/* ------------------------------ frame ------------------------------ */

function booReport(err) {
  const key = String((err && err.message) || err);
  const now = Date.now();
  if (key === booErrKey && now - booErrAt < 5000) return;
  booErrKey = key;
  booErrAt = now;
  console.error(err);
}

/** One step of the simulation (the update of 2.10, without the camera). */
function booSim(dt) {
  setFloorTiers(floorCam);
  tickFloors(dt);
  tickBuild(dt);
  tickPeople(dt);
  tickTalk(dt);
  tickCapsules(dt);
  tickParticles(dt);
}

function booUpdate(dt) {
  try {
    if (!booFrozen) booSim(dt);
    navTick(dt);
  } catch (err) { booReport(err); }
}

function booSizeCanvases(cam) {
  if (!booBuf || booBuf.c.width !== cam.bw || booBuf.c.height !== cam.bh) booBuf = makeBuffer(cam.bw, cam.bh);
}

/* Same size as the scene canvas after presentBuffer(zoom): the buffer times the whole zoom step (presentBuffer rounds it the same way). */
function booSizeText(zoom) {
  const k = Math.max(1, Math.round(zoom || 1));
  const w = booBuf.c.width * k;
  const h = booBuf.c.height * k;
  if (booText.width !== w || booText.height !== h) {
    booText.width = w;
    booText.height = h;
    booTg.imageSmoothingEnabled = false;
  }
}

function booRender(T) {
  try {
    booLastT = T;
    const cam = activeCamera();
    if (!cam.viewW) { navResize(); if (!cam.viewW) return; }
    booSizeCanvases(cam);
    const g = booBuf.g;
    // #texte takes the size the scene will have after presentBuffer, before the labels are drawn on it:
    // resizing a canvas clears it, so a resize after renderBuilding would blank the labels for one frame.
    booSizeText(NAV.mode === 'advanced' ? cam.zoom : floorCam.zoom);
    if (NAV.mode === 'advanced') {
      renderAdvanced(g, T);
      if (NAV.plan) drawTechPlan(g, T);
      if (booTextClear) { booTg.clearRect(0, 0, booText.width, booText.height); booTextClear = false; }
      presentBuffer(booScene, booBuf, cam.zoom);
    } else {
      setFloorTiers(floorCam);
      renderBuilding(g, booTg, floorCam, T);
      booTextClear = true;
      presentBuffer(booScene, booBuf, floorCam.zoom);
    }
    if (booText.style.width !== booScene.style.width) booText.style.width = booScene.style.width;
    if (booText.style.height !== booScene.style.height) booText.style.height = booScene.style.height;
    updateFloorBar(T);
    navUpdateControls();
    uiTick(T);
    inpTick();
  } catch (err) { booReport(err); }
}

/* ------------------------------ page ------------------------------ */

function booInit() {
  palStrict = uiDemo;   // outside the demo, an unknown colour name draws magenta instead of throwing on every frame
  booScene = document.getElementById('scene');
  booText = document.getElementById('texte');
  if (!booScene || !booText) return;
  booTg = booText.getContext('2d');
  booTg.imageSmoothingEnabled = false;
  navBind();
  uiInit();
  bindInput(booScene);
  buildJournal();
  window.addEventListener('resize', navResize);
  window.addEventListener('orientationchange', navResize);
  const zone = document.getElementById('zone');
  if (zone && typeof ResizeObserver === 'function') new ResizeObserver(navResize).observe(zone);
  navResize();
  booLoop = startLoop(booUpdate, booRender);
}

/* ------------------------------ tests and captures ------------------------------ */

function booCopyFloor(fl) {
  return {
    index: fl.index, id: fl.id, name: fl.name, title: fl.title, y: fl.y, dy: fl.dy, p: fl.p, tier: fl.tier, ver: fl.ver, ghost: fl.ghost,
    cols: fl.plan ? fl.plan.cols : 0, stats: fl.stats ? Object.assign({}, fl.stats) : null,
  };
}

function booCopyPerson(p) {
  return {
    id: p.id, floor: p.floor ? p.floor.index : null, desk: p.desk ? p.desk.id : null, x: p.x, y: p.y, cx: p.cx, cy: p.cy, dir: p.dir,
    tz: p.tz, wx: p.wx, wy: p.wy, pose: p.pose, act: p.act, seated: p.seated, present: p.present, visible: p.visible, alpha: p.alpha,
    leaving: p.leaving, talking: !!p.conv, state: p.info ? p.info.state : null,
  };
}

function booCopyConv(c) {
  return {
    id: c.id, kind: c.kind, floor: c.floor ? c.floor.index : null, parts: c.parts.map((p) => p.id), line: c.line, spoken: c.spoken,
    phase: c.phase, typed: c.typed, lines: c.lines.map((l) => ({ who: l.who, text: l.text })),
  };
}

window.Pixel = Pixel;
window.__pixel = {
  seed(n) { seedRandom(n); },
  hour(h) { setHourOverride(h); },
  freeze(on) {
    booFrozen = !!on;
    skySetTime(booFrozen ? booLastT : null);
  },
  advance(seconds) {
    let left = Math.max(0, Number(seconds) || 0);
    while (left > 1e-9) {
      const dt = Math.min(0.05, left);
      booSim(dt);
      left -= dt;
    }
  },
  floors() { return FLOORS.map(booCopyFloor); },
  people() { return PEOPLE.map(booCopyPerson); },
  conversations() { return CONVERSATIONS.map(booCopyConv); },
  log() { return TALK_LOG.map((e) => Object.assign({}, e)); },
  bubbles() {   // boxes drawn on the last frame, plan px of each floor: [floor index, x, y, w, h, conversation id | null]
    const out = [];
    for (const fl of FLOORS) for (const r of bubbleRects(fl)) out.push([fl.index, r[0], r[1], r[2], r[3], r[4] ? r[4].id : null]);
    return out;
  },
  pick(sx, sy) { const r = pickScene(sx, sy); return { kind: r.kind, id: r.id }; },   // what is under a point of the scene, CSS px
  stats() {
    let drawn = 0;
    for (const fl of FLOORS) if (fl.tier === 0) drawn++;
    const cam = activeCamera();
    return {
      office: booOffice !== null, mode: NAV.mode, floor: NAV.floor, floors: FLOORS.length, drawn, people: PEOPLE.length, talks: CONVERSATIONS.length,
      zoom: cam.zoom, dpr: cam.dpr, bw: cam.bw, bh: cam.bh, x: cam.x, y: cam.y, ty: NAV.ty, applyMs: booApplyMs, applyFirstMs: booApplyFirstMs, applyMaxMs: booApplyMaxMs, steps: Object.assign({}, booSteps), frozen: booFrozen,
    };
  },
  goto(index) { navGoto(index, 'now'); },
  view(mode) { return window.Pixel.view(mode); },
  emit(event) {
    const base = booOffice || { teams: [], projects: [], waitingCount: 0, core: 'connected', generatedAt: Date.now(), archives: [], events: [] };
    const ev = Object.assign({ id: 'fake-' + Date.now() + '-' + (++booFakeSeq), at: Date.now() }, event);
    syncTalk(Object.assign({}, base, { events: (base.events || []).concat([ev]) }));
    return ev.id;
  },
  perf() { return booLoop ? Object.assign({}, booLoop.stats()) : null; },
};

if (typeof document !== 'undefined') booInit();
