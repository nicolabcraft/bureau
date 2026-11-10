/* web/immeuble/boucle.js: part of the building view, owned by the « moteur » module (see docs/vue-immeuble.md). */
/* The last module: it declares nothing the others need, and starts everything. */

/* ================================================================ the page's door to the scene (the app does not see this scope) */
window.Immeuble = {
  /* an OfficeState from the service: the data module applies it to the scene. Ignored while the measurement freezes the data. */
  etat(office){ if(!evOff && typeof applyOffice === 'function') applyOffice(office); },
  /* focus the floor of this agent, centre on it and ring it; null clears the ring */
  selectionner(id){
    if(typeof setSelected === 'function') setSelected(id == null ? null : id);
    if(id == null) return false;
    const a = agentById(id);
    return a ? centreOnAgent(a) : false;
  },
  filtrerAttente(on){ if(typeof setWaitFilter === 'function') setWaitFilter(!!on); },
  portrait(canvas, id){ if(typeof drawPortrait === 'function') drawPortrait(canvas, id); },
  surClicAgent: null,   // set by app.js: (id) => open the card
  surEtage: null,       // set by app.js: (projectId | null) => the floor shown changed
};

/* ================================================================ main loop */
let last = 0, paused = false;
function frame(ts){
  const dt = last ? Math.min(ts - last, 60) : 16; last = ts;
  if(resizeDue) resize();
  if(!paused) update(dt);
  render();
  requestAnimationFrame(frame);
}
new ResizeObserver(() => { resizeDue = true; }).observe($('#scene'));

/* what the measurement script (scripts/mesure-vue.js) and the tests drive */
window.__bureau = {
  noEvents(v){ evOff = !!v; },
  setReduced(v){ reduced = !!v; },
  pause(v){ paused = !!v; },
  step(ms){ for(let t = 0; t < ms; t += 16) update(16); },
  setMin(m){ manualMin = m; fast = false; syncTime(); },
  setAngle(a){ RAt = a; RA = a; },
  setZoom(z){ autoFit = false; camT.z = z; cam.z = z; },
  setFocus, rotateBy, zoomBy, fitNow,
  cache(v){ cacheOn = !!v; },
  prof(v){ profOn = !!v; if(!v) for(const k in PR) delete PR[k]; },
  renderOnce(){ render(); },
  updateOnce(dt){ update(dt); },
  get T(){ return T; }, get cam(){ return cam; }, get PR(){ return PR; }, get LOD(){ return LOD; },
  get focus(){ return focus; }, get size(){ return {w: cw, h: ch, dpr}; },
  /* canvas position (css px) of an agent's head, for synthetic pointer events */
  screenOf(id){
    const a = agentById(id), fl = a && floors[a.fl]; if(!fl) return null;
    ZB = a.inCab ? EL.z : fl.z0; ZL = fl.lift; const p = pp(a.x, a.y, 14); ZB = 0; ZL = 0;
    return {x: p[0] * cam.z + cw / 2 + cam.px, y: p[1] * cam.z + ch / 2 + cam.py};
  },
  floors, agents, EL, DEMO,
};

buildCity(); cityInit(); resize();
if(typeof elevReset === 'function') elevReset();
syncTime(); fitNow(true); buildPanel(); updateUI(true);
requestAnimationFrame(frame);
