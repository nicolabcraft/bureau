/* web/pixel/nav.js : lot L6, voir docs/vue-pixel.md (2.8) */
/*
 * Which view is shown and where the camera looks: scrolling between floors, the integer zoom rule, the sideways
 * stops of a narrow view, Escape. Lot L6, contract in 2.8. Shares one scope with the other web/pixel files: the
 * public names are the ones of the 2.8 block (NAV, navGoto, navStep, navPanTo, navFitZoom, navZoomBy, navSetMode,
 * navBack, navTick, activeCamera), every other top-level name wears `nav`. Declares only, nothing runs at load.
 *
 * Choices recorded here (additions to 2.8, all additive):
 *  - NAV.ty is the vertical target, in world px; floorCam.y eases towards it in whole pixels (at once under REDUCED).
 *    The sideways target is private (navTx). NAV.floor follows NAV.ty (the floor under the middle of the free part
 *    of the view) unless navGoto named it: then it is set at once and does not flicker through the floors on the way.
 *  - navShift(dy): boot.js hands it the shiftY of syncFloors. A floor added on top moves the world down by BLOCK; the
 *    camera and the target move with it, so the picture stays put. (floorGone moves floorCam.y itself and hands the
 *    sum through flrTakeShift, which navTick adds to the target.)
 *  - The part of the view hidden by an overlay (the dialog box, on a phone also the card) is Camera.insets.bottom,
 *    in logical px. It eases in and out (a few frames) so that the floor slides instead of jumping; navGoto frames
 *    the floor in what the final insets leave free.
 *  - navResize(): measures #zone, resizes the cameras and applies the zoom rule. navBind(): the buttons of #zoom,
 *    #pan, #bVueAvancee and #bPlanTech. navSetPlan(on): the technical plan of the advanced view.
 *  - navBack closes the dialog box, then the « Qui m'attend » filter, then the advanced view. The card is closed by
 *    app.js (its Escape handler runs first, in the capture phase, and yields while the dialog box is open).
 */

const NAV = { mode: 'floor', floor: 0, ty: 0, plan: false };

const navMargin = 8;               // px of air around the floor when the zoom rule fits it
const navEaseRate = 9;             // 1 / s: exponential ease of the scroll
let navSeen = 0;                   // NAV.ty that NAV.floor was last worked out from (NaN: work it out again)
let navTx = null;                  // sideways target (world x of the left edge of the view), null: none
let navInsCur = 0;                 // overlay height in logical px, as applied to the cameras
let navInsGoal = 0;                // the same, as it will be once eased
let navSize = '';                  // last measured view, to tell a real resize
let navZoneEl = null;
const navEls = {};
let navPhone = null;               // matchMedia of the phone layout

function navZone() {
  return navZoneEl || (navZoneEl = document.getElementById('zone'));
}

/** Size of the building in world px: the plate width is the common one of the floors. */
function navWorld() {
  const n = FLOORS.length;
  const cols = n && FLOORS[0].plan ? FLOORS[0].plan.cols : COLS_MIN;
  return buildingSize(n, cols);
}

function navNotify(name, arg) {
  const px = typeof window !== 'undefined' ? window.Pixel : null;
  if (px && typeof px[name] === 'function') {
    try { px[name](arg); } catch (err) { console.error(err); }
  }
}

/* ------------------------------ camera limits ------------------------------ */

/** The y the camera may take (same rule as Camera.clampTo, for a given bottom inset). */
function navClampY(y, bottom) {
  const c = floorCam, top = c.insets.top, free = c.bh - top - bottom, H = c.worldH;
  if (!(H > 0)) return Number.isFinite(y) ? y : 0;
  return free >= H ? 0 - Math.round((free - H) / 2) - top : clamp(y, 0 - top, H - c.bh + bottom);
}

function navClampX(x) {
  const c = floorCam, l = c.insets.left, r = c.insets.right, free = c.bw - l - r, W = c.worldW;
  if (!(W > 0)) return x;
  return free >= W ? 0 - Math.round((free - W) / 2) - l : clamp(x, 0 - l, W - c.bw + r);
}

function navClampWorld() {
  const s = navWorld();
  floorCam.clampTo(s.w, s.h);
  return s;
}

/* ------------------------------ insets ------------------------------ */

function navOverlayGoal() {
  const h = uiOverlayHeight();
  return h > 0 ? Math.ceil((h * floorCam.dpr) / floorCam.zoom) : 0;
}

function navSetInsets(px) {
  floorCam.insets.bottom = px;
  navInsCur = px;
  navAdvInsets();
}

/**
 * The cutaway's insets: what the floor view has at the bottom (dialog box, phone card), plus the journal: a column on the
 * right (desktop) or a sheet at the bottom (phone). advanced.js reads them in its own fit and clamp; nothing is eased here.
 */
function navAdvInsets() {
  const k = advCam.dpr / advCam.zoom;
  const j = NAV.mode === 'advanced' ? jrnInsets() : null;
  advCam.insets.bottom = navInsCur + (j ? Math.ceil(j.bottom * k) : 0);
  advCam.insets.right = j ? Math.ceil(j.right * k) : 0;
}

/** Reads the overlay height and eases the insets towards it. Returns true when the goal changed. */
function navInsets(dt) {
  const goal = navOverlayGoal();
  const changed = goal !== navInsGoal;
  navInsGoal = goal;
  if (navInsCur !== goal) {
    const d = goal - navInsCur;
    const step = REDUCED || Math.abs(d) <= 1 ? d : Math.round(d * Math.min(1, dt * 14)) || Math.sign(d);
    navSetInsets(navInsCur + step);
    navClampWorld();
  }
  return changed;
}

/* ------------------------------ zoom ------------------------------ */

function navApplyZoom(z, ax, ay) {
  if (floorCam.zoom !== z) floorCam.setZoom(z, ax, ay);
  navGoal();
  navSetInsets(navInsGoal);
  navClampWorld();
}

function navGoal() {
  navInsGoal = navOverlayGoal();
}

/**
 * The zoom rule (2.8): the largest ZOOMS entry such that the building is not wider than the view and a floor with its
 * slab is not taller (8 px of air), but never less than 2 CSS px per logical px; when none does, round(2 * dpr), and the
 * view scrolls (up and down always, sideways by navPanTo).
 */
function navFitZoom() {
  const cam = floorCam;
  if (!cam.viewW) return;
  const s = navWorld(), dpr = cam.dpr;
  let best = 0;
  for (const z of ZOOMS) {
    const css = z / dpr;
    if (css >= 2 && s.w * css <= cam.viewW - navMargin && BLOCK * css <= cam.viewH - navMargin) best = z;
  }
  if (!best) best = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(1, Math.round(2 * dpr)));
  navApplyZoom(best);
  navFloorPanTo('floor', 'now');
  navGoto(NAV.floor, 'now');
}

/** One step up (+1) or down (-1) on ZOOMS around the middle of the view; the floor stays in view. */
function navZoomBy(step) {
  const z = ZOOMS[clamp(ZOOMS.indexOf(floorCam.zoom) + step, 0, ZOOMS.length - 1)];
  if (z === floorCam.zoom) return;
  navApplyZoom(z);
  navGoto(NAV.floor, 'now');
}

/** Called when the window or #zone changes size (or the pixel ratio changes): measures, resizes the cameras, applies the rule. */
function navResize() {
  const zone = navZone();
  if (!zone) return;
  const w = zone.clientWidth, h = zone.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  const key = w + 'x' + h + '@' + dpr;
  if (key === navSize) return;
  navSize = key;
  floorCam.resize(w, h, dpr);
  advCam.resize(w, h, dpr);
  navFitZoom();
}

/* ------------------------------ floors ------------------------------ */

function navSetFloor(index) {
  const fl = FLOORS[index];
  if (!fl || NAV.floor === index && navFloorSent === fl.id) return;
  NAV.floor = index;
  navFloorSent = fl.id;
  updateFloorChip(index);
  navNotify('onFloorChange', fl.id);
}
let navFloorSent = null;           // project id handed to Pixel.onFloorChange last (null: not yet)

/** Camera top that frames floor `index` in the part of the view the overlay leaves free. */
function navTargetY(index) {
  const cam = floorCam, free = cam.bh - cam.insets.top - navInsGoal;
  if (index === 0) return navClampY(Infinity, navInsGoal);   // the ground floor sits at the bottom: entrance strip and street in view, even when it is the only floor
  return navClampY(floorScrollY(index, FLOORS.length, free), navInsGoal);
}

/** Scrolls to a floor: 'smooth' (default) eases in whole pixels, 'now' jumps (reduced motion, first frame, zoom change). */
function navGoto(index, how) {
  const n = FLOORS.length;
  if (!n) return;
  const i = clamp(Math.round(index) || 0, 0, n - 1);
  navGoal();
  if (how === 'now' || REDUCED) {
    navSetInsets(navInsGoal);
    navClampWorld();
    floorCam.y = navTargetY(i);
    navClampWorld();
    NAV.ty = floorCam.y;
  } else {
    NAV.ty = navTargetY(i);
  }
  navSeen = NAV.ty;
  navSetFloor(i);
}

/** The neighbouring floor: +1 up, -1 down. */
function navStep(d) {
  navGoto(clamp(NAV.floor + d, 0, FLOORS.length - 1));
}

/** The world moved by dy px (a floor added on top): the camera and its target move with it, the picture stays put. */
function navShift(dy) {
  if (!dy) return;
  floorCam.y += dy;
  NAV.ty += dy;
  navSeen = NaN;
}

/* ------------------------------ sideways ------------------------------ */

/** The three sideways stops of the cutaway (advanced view): the stair tower, the middle, the lift shaft. Instant. */
function navAdvPanTo(stop) {
  const cam = advCam, lay = advLay;
  if (!lay || !lay.n) return;
  cam.x = stop === 'stairs' ? lay.stairX0 - 14 : stop === 'lift' ? lay.w - cam.bw + cam.insets.right : Math.round((lay.w - cam.bw) / 2);
  cam.clampTo(lay.w, lay.h);
}

/**
 * Sideways stop when the building is wider than the view: 'stairs', 'floor' or 'lift'. The 'floor' stop starts at the left
 * edge of the plate (the chef's office and the first rooms), which is also where a narrow view begins. In the advanced view
 * the same three buttons move advCam.
 */
function navPanTo(stop, how) {
  if (NAV.mode === 'advanced') navAdvPanTo(stop);
  else navFloorPanTo(stop, how);
}

function navFloorPanTo(stop, how) {
  const cam = floorCam, s = navWorld();
  if (cam.bw - cam.insets.left - cam.insets.right >= s.w) { navTx = null; return; }
  const x = stop === 'stairs' ? 0 : stop === 'lift' ? s.w - cam.bw : STAIRS_W - 4;
  navTx = navClampX(x);
  if (how === 'now' || REDUCED) {
    cam.x = navTx;
    navTx = null;
    navClampWorld();
  }
}

/** A drag moved the camera by itself: the scroll target follows it, no sideways target is left, the floor is worked out again. */
function navHold() {
  NAV.ty = floorCam.y;
  navTx = null;
  navSeen = NaN;
}

/** Moves the view sideways by dx logical px (keys), no easing. */
function navPanSide(dx) {
  navTx = null;
  floorCam.x += dx;
  navClampWorld();
}

/* ------------------------------ views ------------------------------ */

/** The journal shows in the cutaway only; the technical plan takes the whole width, so it hides it until the plan closes. */
function navJournal() {
  const journal = document.getElementById('journal');
  if (journal) journal.hidden = NAV.mode !== 'advanced' || NAV.plan;
  refreshJournal();                          // measures it now: advanced.js fits its camera on the next frame
  navAdvInsets();
}

function navSetMode(mode) {
  if (mode !== 'floor' && mode !== 'advanced') return;
  if (NAV.mode === mode) return;
  NAV.mode = mode;
  if (mode === 'floor') NAV.plan = false;
  navJournal();
  uiViewState();
  navNotify('onViewChange', mode);
}

function navSetPlan(on) {
  const next = !!on && NAV.mode === 'advanced';
  if (NAV.plan === next) return;
  NAV.plan = next;
  navJournal();
  uiViewState();
}

/** Escape: the dialog box, then (app.js) the card, then the wait filter, then the advanced view, then nothing. Returns true when it did something. */
function navBack() {
  if (dialogHeight() > 0) { hideDialog(); return true; }
  if (pplWaitFilter) {
    const b = document.getElementById('bAttente');
    if (b) { b.click(); return true; }
    setWaitFilter(false);
    return true;
  }
  if (NAV.mode === 'advanced') { navSetMode('floor'); return true; }
  return false;
}

function activeCamera() {
  return NAV.mode === 'advanced' ? advCam : floorCam;
}

/* ------------------------------ buttons ------------------------------ */

function navBind() {
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
    return el;
  };
  on('zIn', () => navZoomBy(1));
  on('zOut', () => navZoomBy(-1));
  on('bVueAvancee', () => navSetMode(NAV.mode === 'advanced' ? 'floor' : 'advanced'));
  on('bPlanTech', () => navSetPlan(!NAV.plan));
  const pan = document.getElementById('pan');
  if (pan) {
    for (const b of pan.querySelectorAll('button[data-stop]')) b.addEventListener('click', () => navPanTo(b.dataset.stop));
  }
  navPhone = typeof matchMedia === 'function' ? matchMedia('(max-width: 720px)') : null;
  navEls.zout = document.getElementById('zOut');
  navEls.zin = document.getElementById('zIn');
  navEls.zval = document.getElementById('zVal');
  navEls.pan = pan;
  navEls.stops = pan ? Array.from(pan.querySelectorAll('button[data-stop]')) : [];
}

let navZoomKey = '';
let navPanKey = '';

/** The little controls follow the camera; the DOM is written only when something changed. */
function navUpdateControls() {
  const cam = activeCamera();
  const zk = cam.zoom + '@' + cam.dpr;
  if (zk !== navZoomKey) {
    navZoomKey = zk;
    const css = Math.round((cam.zoom / cam.dpr) * 100) / 100;
    if (navEls.zval) navEls.zval.textContent = '×' + String(css).replace('.', ',');
    if (navEls.zout) navEls.zout.disabled = cam.zoom <= ZOOMS[0];
    if (navEls.zin) navEls.zin.disabled = cam.zoom >= ZOOMS[ZOOMS.length - 1];
  }
  if (!navEls.pan) return;
  const ac = activeCamera(), W = ac.worldW;
  // the stops are for a view wider than the screen; on a phone the cutaway is dragged instead (they would cover it)
  const wide = W > ac.bw - ac.insets.left - ac.insets.right && !(NAV.mode === 'advanced' && navPhone && navPhone.matches);
  const left = ac === floorCam || !advLay ? 1 : advLay.stairX0 - 14 + 1;
  const stop = !wide ? '' : ac.x <= left ? 'stairs' : ac.x >= W - ac.bw + ac.insets.right - 1 ? 'lift' : 'floor';
  const pk = (wide ? 1 : 0) + stop + NAV.mode;
  if (pk === navPanKey) return;
  navPanKey = pk;
  navEls.pan.hidden = !wide;
  for (const b of navEls.stops) b.setAttribute('aria-pressed', String(b.dataset.stop === stop));
}

/* ------------------------------ frame ------------------------------ */

function navFloorAtCentre(ty) {
  const n = FLOORS.length;
  const y = ty + floorCam.insets.top + (floorCam.bh - floorCam.insets.top - navInsGoal) / 2;
  const i = floorAtY(y, n);
  return i >= 0 ? i : y < SKY_H ? n - 1 : 0;
}

/**
 * Every frame: takes the shift of the demolitions, eases the insets, then the camera towards NAV.ty (and the sideways
 * target) in whole pixels, keeps the camera inside the building and works NAV.floor out from where the view rests.
 */
function navTick(dt) {
  const cam = floorCam;
  if (!cam.viewW) return;
  const shift = flrTakeShift();
  if (shift) { NAV.ty += shift; navSeen = NaN; }
  if (navInsets(dt) && FLOORS.length) navGoto(NAV.floor);
  const s = navWorld();
  cam.clampTo(s.w, s.h);
  NAV.ty = navClampY(NAV.ty, navInsGoal);
  if (cam.y !== NAV.ty) {
    const d = NAV.ty - cam.y;
    cam.y = REDUCED || Math.abs(d) <= 1 ? NAV.ty : cam.y + (Math.round(d * Math.min(1, dt * navEaseRate)) || Math.sign(d));
  }
  if (navTx !== null) {
    const tx = navClampX(navTx), d = tx - cam.x;
    cam.x = REDUCED || Math.abs(d) <= 1 ? tx : cam.x + (Math.round(d * Math.min(1, dt * navEaseRate)) || Math.sign(d));
    if (cam.x === tx) navTx = null;
  }
  cam.clampTo(s.w, s.h);
  if (NAV.mode === 'advanced') navAdvInsets();   // advanced.js fits and eases advCam itself; here only its insets follow the journal
  const n = FLOORS.length;
  if (n) {
    if (NAV.floor >= n) { NAV.floor = n - 1; navSeen = NaN; }
    if (NAV.ty !== navSeen) {
      navSeen = NAV.ty;
      navSetFloor(navFloorAtCentre(NAV.ty));
    }
  }
}
