/* web/pixel/input.js : lot L6, voir docs/vue-pixel.md (2.8) */
/*
 * Mouse, touch and keyboard on the scene: wheel, drag, pinch, keys, click and hover. Lot L6, contract in 2.8.
 * Shares one scope with the other web/pixel files: the public names are bindInput and pickScene, every other
 * top-level name wears `inp`. Declares only, nothing runs at load (boot.js calls bindInput).
 *
 * Choices recorded here:
 *  - pickScene returns one reused object { kind, id }: read it at once, do not keep it. In the floor view it tests, in
 *    this order, the people in the towers (towerPersonAt), then on the floor under the point the speech bubbles
 *    (bubbleAt), the people (personAt), and last the floor itself; id is the person id, the conversation id or the
 *    floor index. In the advanced view it is advPick (lot L9), guarded.
 *  - Wheel scrolls the building (NAV.ty, in logical px); shift or a horizontal wheel moves it sideways; ctrl + wheel
 *    (a trackpad pinch) and a two-finger pinch zoom by whole steps only. Drag pans both ways, with no easing, and
 *    moves the scroll target with it (navHold).
 *  - A tap or click on a person calls Pixel.onAgentClick (app.js opens the card, which calls Pixel.select back);
 *    without app.js it selects directly. A click on a bubble opens the dialog box (openDialogFor, talk.js); a click on
 *    an empty spot of a floor centres that floor.
 *  - Keys act on the document, never while a field, the card, the dialog box or the journal has the focus (they scroll
 *    themselves); Escape goes to navBack except in a field. inpTick(), every frame, re-reads what is under a resting
 *    mouse so the tip follows someone who walks away.
 */

const inpPick = { kind: null, id: null };
const inpPointers = new Map();     // pointer id -> { x, y } in canvas CSS px
let inpCanvas = null;
let inpDrag = null;                // { id, sx, sy, lx, ly, moved }
let inpPinch = null;               // { d0 }
let inpWheelAcc = 0;
let inpHover = { x: 0, y: 0, on: false };
let inpHand = false;
const inpSlop = 5;                 // CSS px before a press becomes a drag
const inpPinchStep = 1.4;          // distance ratio that is one zoom step

function inpSet(kind, id) {
  inpPick.kind = kind;
  inpPick.id = id;
  return inpPick;
}

/** What is under the point (sx, sy), CSS px on the canvas: { kind: 'person' | 'bubble' | 'floor' | null, id }. A reused object. */
function pickScene(sx, sy) {
  inpSet(null, null);
  if (NAV.mode === 'advanced') {
    const w = advCam.screenToWorld(sx, sy), r = advPick(w.x, w.y);
    if (r) inpSet(r.kind, r.id);
    return inpPick;
  }
  const n = FLOORS.length;
  if (!n) return inpPick;
  const w = floorCam.screenToWorld(sx, sy), px = w.x - STAIRS_W;
  const rider = towerPersonAt(px, w.y);
  if (rider) return inpSet('person', rider.id);
  for (let i = n - 1; i >= 0; i--) {
    const fl = FLOORS[i], top = fl.y + fl.dy;
    if (w.y < top || w.y >= top + BLOCK) continue;
    const py = w.y - top;
    if (px >= 0 && px < fl.plan.width && py < PLATE_H && fl.p >= 1) {
      const conv = bubbleAt(fl, px, py);
      if (conv) return inpSet('bubble', conv.id);
      const p = personAt(fl, px, py);
      if (p) return inpSet('person', p.id);
    }
    return inpSet('floor', fl.index);
  }
  return inpPick;
}

function inpCanvasPoint(e) {
  const r = inpCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function inpCamera() {
  return activeCamera();
}

function inpSelect(id) {
  const px = window.Pixel;
  if (px && typeof px.onAgentClick === 'function') px.onAgentClick(id);
  else if (px) px.select(id);
}

function inpClick(sx, sy) {
  const r = pickScene(sx, sy);
  if (r.kind === 'bubble') {
    const conv = CONVERSATIONS.find((c) => c.id === r.id);
    if (conv) openDialogFor(conv);
  } else if (r.kind === 'person') {
    inpSelect(r.id);
  } else if (r.kind === 'floor' && NAV.mode === 'floor') {
    navGoto(r.id);
  }
}

/* ------------------------------ pointer ------------------------------ */

function inpDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const p = inpCanvasPoint(e);
  try { inpCanvas.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that is already gone */ }
  inpPointers.set(e.pointerId, p);
  hideTip();
  inpHover.on = false;
  if (inpPointers.size === 1) {
    inpDrag = { id: e.pointerId, sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false };
    inpPinch = null;
  } else if (inpPointers.size === 2) {
    const [a, b] = Array.from(inpPointers.values());
    inpPinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    if (inpDrag) inpDrag.moved = true;
  }
}

function inpMove(e) {
  const p = inpCanvasPoint(e);
  if (!inpPointers.has(e.pointerId)) {
    if (e.pointerType === 'mouse') { inpHover.x = p.x; inpHover.y = p.y; inpHover.on = true; inpTick(); }
    return;
  }
  inpPointers.set(e.pointerId, p);
  if (inpPinch && inpPointers.size >= 2) {
    const [a, b] = Array.from(inpPointers.values());
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, ratio = d / inpPinch.d0;
    if (ratio >= inpPinchStep) { inpZoom(1); inpPinch.d0 = d; }
    else if (ratio <= 1 / inpPinchStep) { inpZoom(-1); inpPinch.d0 = d; }
    return;
  }
  const d = inpDrag;
  if (!d || d.id !== e.pointerId) return;
  if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) > inpSlop) {
    d.moved = true;
    inpCanvas.classList.add('drag');
  }
  if (d.moved) {
    inpCamera().panBy(d.lx - p.x, d.ly - p.y);
    if (NAV.mode === 'floor') navHold();
  }
  d.lx = p.x;
  d.ly = p.y;
}

function inpEnd(e, click) {
  const d = inpDrag, known = inpPointers.has(e.pointerId);
  inpPointers.delete(e.pointerId);
  if (!known) return;
  if (inpPointers.size < 2) inpPinch = null;
  if (inpPointers.size === 0) {
    inpCanvas.classList.remove('drag');
    inpDrag = null;
    if (click && d && !d.moved && d.id === e.pointerId) inpClick(d.lx, d.ly);
    if (e.pointerType === 'mouse') { const p = inpCanvasPoint(e); inpHover.x = p.x; inpHover.y = p.y; inpHover.on = true; }
  }
}

function inpLeave(e) {
  if (e.pointerType === 'mouse' && !inpPointers.size) {
    inpHover.on = false;
    hideTip();
    if (inpHand) { inpHand = false; inpCanvas.classList.remove('hand'); }
  }
}

/** Every frame: re-reads what is under a resting mouse (cursor and tip). */
function inpTick() {
  if (!inpCanvas) return;
  const h = inpHover;
  if (!h.on || inpDrag) return;
  const r = pickScene(h.x, h.y);
  const hand = r.kind === 'person' || r.kind === 'bubble';
  if (hand !== inpHand) { inpHand = hand; inpCanvas.classList.toggle('hand', hand); }
  if (r.kind === 'person') {
    const p = personById(r.id);
    if (p && p.info) {
      showTip(p, h.x, h.y);
      return;
    }
  }
  hideTip();
}

/* ------------------------------ wheel and zoom ------------------------------ */

function inpZoom(step) {
  if (NAV.mode === 'advanced') advCam.zoomBy(step);
  else navZoomBy(step);
}

function inpWheel(e) {
  e.preventDefault();
  const cam = inpCamera();
  const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? cam.viewH : 1;
  if (e.ctrlKey) {
    inpWheelAcc -= e.deltaY * unit;
    if (Math.abs(inpWheelAcc) >= 40) { inpZoom(inpWheelAcc > 0 ? 1 : -1); inpWheelAcc = 0; }
    return;
  }
  const dy = e.shiftKey ? 0 : e.deltaY * unit, dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
  if (NAV.mode === 'floor') {
    const k = cam.dpr / cam.zoom;      // CSS px to logical px
    if (dy) NAV.ty += dy * k;
    if (dx) navPanSide(dx * k);
  } else {
    cam.panBy(dx, dy);
  }
}

/* ------------------------------ keys ------------------------------ */

function inpKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target, field = t && t.closest ? t.closest('input,select,textarea,[contenteditable="true"]') : null;
  if (field) return;
  if (e.key === 'Escape') {
    if (navBack()) e.preventDefault();
    return;
  }
  if (t && t.closest && t.closest('#fiche,#dialog,#journal')) return;
  const n = FLOORS.length, floorView = NAV.mode === 'floor';
  switch (e.key) {
    case '+': case '=': inpZoom(1); break;
    case '-': case '_': inpZoom(-1); break;
    case '0': if (floorView) navFitZoom(); break;
    case 'PageUp': case 'ArrowUp': if (!floorView) return; navStep(1); break;
    case 'PageDown': case 'ArrowDown': if (!floorView) return; navStep(-1); break;
    case 'Home': if (!floorView) return; navGoto(n - 1); break;
    case 'End': if (!floorView) return; navGoto(0); break;
    case 'ArrowLeft': if (floorView) navPanSide(-16); else inpCamera().panBy(-16 * inpCamera().zoom / inpCamera().dpr, 0); break;
    case 'ArrowRight': if (floorView) navPanSide(16); else inpCamera().panBy(16 * inpCamera().zoom / inpCamera().dpr, 0); break;
    default: return;
  }
  e.preventDefault();
}

/** Wires the canvas (pointer, wheel) and the document (keys). */
function bindInput(canvas) {
  inpCanvas = canvas;
  canvas.addEventListener('pointerdown', inpDown);
  canvas.addEventListener('pointermove', inpMove);
  canvas.addEventListener('pointerup', (e) => inpEnd(e, true));
  canvas.addEventListener('pointercancel', (e) => inpEnd(e, false));
  canvas.addEventListener('pointerleave', inpLeave);
  canvas.addEventListener('wheel', inpWheel, { passive: false });
  document.addEventListener('keydown', inpKey);
}
