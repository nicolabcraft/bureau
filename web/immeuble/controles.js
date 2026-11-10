/* web/immeuble/controles.js: part of the building view, owned by the « moteur » module (see docs/vue-immeuble.md). */
/* pointer: pan (left), rotate (right), pinch and twist (two fingers), wheel zoom, tap on an agent or a façade; keyboard */
const ptrs = new Map();
let drag = null;
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect();
  ptrs.set(e.pointerId, {x: e.clientX - r.left, y: e.clientY - r.top, b: e.button});
  if(ptrs.size === 1){ drag = {mode: e.button === 2 ? 'rot' : 'pan', sx: e.clientX, sy: e.clientY, moved: 0, ra: RAt, px: camT.px, py: camT.py}; cv.classList.add('prise'); hideBulle(); hover = null; }
  else if(ptrs.size === 2){ const [a, b] = [...ptrs.values()]; drag = {mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), an0: Math.atan2(b.y - a.y, b.x - a.x), z0: camT.z, ra: RAt, moved: 99, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: camT.px, py: camT.py}; }
});
/* the agent under the pointer (screen px in the canvas), or null; only agents of an open floor can be hit */
function pickAgent(mxp, myp){
  let best = null, bd = 18;
  for(let i = 0; i < agents.length; i++){
    const a = agents[i], fl = floors[a.fl];
    if(a.alpha < .5 || !fl || fl.vis < .6 || fl.op < .6) continue;
    ZB = a.inCab ? EL.z : fl.z0; ZL = fl.lift;
    const p = pp(a.x, a.y, 14), sx = p[0] * cam.z + cw / 2 + cam.px, sy = p[1] * cam.z + ch / 2 + cam.py, d = Math.hypot(sx - mxp, sy - myp);
    if(d < bd){ bd = d; best = a; }
  }
  ZB = 0; ZL = 0;
  return best;
}
cv.addEventListener('pointermove', (e) => {
  const r = cv.getBoundingClientRect(), mxp = e.clientX - r.left, myp = e.clientY - r.top;
  if(ptrs.has(e.pointerId)){ const p = ptrs.get(e.pointerId); p.x = mxp; p.y = myp; }
  if(drag && ptrs.size >= 2 && drag.mode === 'pinch'){
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), an = Math.atan2(b.y - a.y, b.x - a.x);
    autoFit = false;
    const k = clamp(drag.z0 * d / Math.max(10, drag.d0), ZMIN, ZMAX);
    const wx = (drag.mx - cw / 2 - drag.px) / drag.z0, wy = (drag.my - ch / 2 - drag.py) / drag.z0;
    camT.z = k; camT.px = (a.x + b.x) / 2 - cw / 2 - wx * k; camT.py = (a.y + b.y) / 2 - ch / 2 - wy * k;
    RAt = drag.ra + (an - drag.an0); RA = RAt; cam.z = camT.z; cam.px = camT.px; cam.py = camT.py;
    return;
  }
  if(drag && ptrs.size === 1 && (e.buttons & 3 || e.pointerType === 'touch')){
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    if(drag.mode === 'rot'){ RAt = drag.ra + dx * .008; RA = RAt; }
    else if(drag.moved > 3){ autoFit = false; camT.px = drag.px + dx; camT.py = drag.py + dy; cam.px = camT.px; cam.py = camT.py; }
    return;
  }
  // hover
  const best = pickAgent(mxp, myp);
  if(best !== hover) cv.style.cursor = best ? 'pointer' : '';
  hover = best;
  if(best) showBulle(best, mxp, myp); else hideBulle();
});
/* the floor whose façade is under the pointer, or -1 (a click is rare: allocating the hull here is fine) */
function pickFloor(mxp, myp){
  for(let i = floors.length - 1; i >= 0; i--){
    const fl = floors[i]; if(fl.vis < .5 || (fl.plot && !fl.plot.done)) continue;
    if(focus >= 0 && i !== focus) continue;
    ZB = fl.z0; ZL = fl.lift;
    const pts = [];
    for(const z of [-10, BH]) for(const [x, y] of [[0, 0], [W, 0], [W, D], [0, D]]){ const p = pp(x, y, z); pts.push([p[0] * cam.z + cw / 2 + cam.px, p[1] * cam.z + ch / 2 + cam.py]); }
    ZB = 0; ZL = 0;
    const hp = hull(pts); let inside = false;
    for(let a = 0, b = hp.length - 1; a < hp.length; b = a++){ const xi = hp[a][0], yi = hp[a][1], xj = hp[b][0], yj = hp[b][1]; if(((yi > myp) !== (yj > myp)) && (mxp < (xj - xi) * (myp - yi) / (yj - yi) + xi)) inside = !inside; }
    if(inside) return i;
  }
  return -1;
}
/* a tap (a press that barely moved): an agent opens its card, a façade opens its floor */
function tap(mxp, myp){
  const a = pickAgent(mxp, myp), cb = window.Immeuble && window.Immeuble.surClicAgent;
  if(a && typeof cb === 'function'){ try { cb(a.id); } catch(err){ console.error(err); } return; }
  const i = pickFloor(mxp, myp);
  if(i >= 0 && i !== focus) setFocus(i);
}
function endPtr(e){
  const r = cv.getBoundingClientRect();
  const was = drag; ptrs.delete(e.pointerId);
  if(ptrs.size === 0){
    cv.classList.remove('prise'); drag = null;
    if(was && was.mode === 'pan' && was.moved < 4 && e.type === 'pointerup' && e.button === 0) tap(e.clientX - r.left, e.clientY - r.top);
  } else if(ptrs.size === 1){ const [p] = [...ptrs.values()]; drag = {mode: 'pan', sx: p.x + r.left, sy: p.y + r.top, moved: 99, ra: RAt, px: camT.px, py: camT.py}; }
}
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', () => { hover = null; hideBulle(); cv.style.cursor = ''; });
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-dy * (e.ctrlKey ? .01 : .0016)), e.clientX - r.left, e.clientY - r.top);
}, {passive: false});
cv.addEventListener('dblclick', () => { autoFit = true; fitNow(false); });

/* keyboard. Registered in the capture phase and stopped there, so no other handler of the page applies the same key twice.
   Typing in a field never moves the camera. Escape is handled apart, in the bubble phase: the card of the app takes it first. */
const ARROW = {ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]};
window.addEventListener('keydown', (e) => {
  const t = e.target, tag = t && t.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  let used = true;
  if(k === 'q' || k === 'Q') rotateBy(-1);
  else if(k === 'e' || k === 'E') rotateBy(1);
  else if(k === '+' || k === '=') zoomBy(1.25);
  else if(k === '-' || k === '_') zoomBy(1 / 1.25);
  else if(k === '0'){ autoFit = true; fitNow(false); }
  else if(k === 'PageUp' || (k === 'ArrowUp' && e.shiftKey)) goFloor(1);
  else if(k === 'PageDown' || (k === 'ArrowDown' && e.shiftKey)) goFloor(-1);
  else if(ARROW[k]){ const d = ARROW[k], s = 60; panBy(d[0] * s, d[1] * s); }
  else used = false;
  if(used){ e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
window.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if(focus >= 0) setFocus(-1); else if(!autoFit){ autoFit = true; fitNow(false); }
});
