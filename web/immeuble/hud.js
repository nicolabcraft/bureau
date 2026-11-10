/* web/immeuble/hud.js: part of the building view, owned by the « interface » module (see docs/vue-immeuble.md). */
/* ================================================================ names over the scene */
const HF1 = '600 11.5px ' + FONT;
const HNW = new Map();   // label width by text, measured once
function hudWaiting(a){ return a.info ? a.info.state === 'waiting' : a.st === 'att'; }
function drawHud(){
  ZB = 0; ZL = 0;
  ctx.font = HF1; ctx.textAlign = 'center';
  for(let i = 0; i < agents.length; i++){
    const a = agents[i], fa = floors[a.fl];
    if(!fa || fa.op <= .6) continue;
    const wait = hudWaiting(a);
    if((wait && fa.vis > .6) || a === hover){
      if(a.alpha < .5) continue;
      ZB = a.inCab ? EL.z : fa.z0; ZL = fa.lift; const pt = pp(a.x, a.y, 0);
      const qx = pt[0] * cam.z + cw / 2 + cam.px, qy = (pt[1] + 14 / cam.z) * cam.z + ch / 2 + cam.py;
      const t = a.info ? a.info.title : a.name;
      let w = HNW.get(t); if(w === undefined){ w = ctx.measureText(t).width + 10; HNW.set(t, w); }
      ctx.fillStyle = 'rgba(16,21,30,.82)'; ctx.beginPath(); ctx.roundRect(qx - w / 2, qy - 11, w, 17, 4); ctx.fill();
      ctx.fillStyle = wait ? '#F0C36A' : '#E8ECF2'; ctx.fillText(t, qx, qy + 1.5);
    }
  }
  ZB = 0; ZL = 0;
}

/* ================================================================ wording */
const HST = {
  running: {lib: 'En cours', col: '#8FD9C4'},
  waiting: {lib: 'Attend ta réponse', col: '#F0C36A'},
  queued: {lib: 'En file d’attente', col: '#6F7F9C'},
  idle: {lib: 'En pause', col: '#8DA2C0'},
  done: {lib: 'Fini', col: '#59627A'},
  error: {lib: 'En erreur', col: '#E0645A'}
};
/* the scene's own state names (agents.js) to the service's */
const HSC = {err: 'error', run: 'running', att: 'waiting', file: 'queued', pause: 'idle', fini: 'done', work: 'running'};
const HROLE = {chef: 'Chef de projet', manager: 'Manager', mgr: 'Manager', agent: 'Agent', staff: 'Agent', worker: 'Ouvrier'};
const hudEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const hudPl = (n, un, plu) => n + ' ' + (n > 1 ? plu : un);
function hudSince(ms){
  const m = Math.floor(ms / 60000);
  if(ms < 45000) return 'à l’instant';
  if(m < 1) return 'moins d’une minute';
  if(m < 60) return m + ' min';
  if(m < 1440) return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  return Math.floor(m / 1440) + ' j';
}
function hudState(a){
  const i = a.info, k = i ? i.state : HSC[a.st];
  const e = HST[k] || {lib: '', col: '#59627A'};
  let lib = e.lib;
  if(i && k === 'waiting' && i.waitingFor === 'permission') lib = 'Attend ton autorisation';
  return {lib, col: e.col, since: i ? (i.since != null ? i.since : i.updatedAt) : null};
}

/* ================================================================ hover bubble (the engine's pointer code calls these) */
const BUL = {el: null, key: '', w: 0, h: 0, below: false};
function bulleOf(a){
  const i = a.info, s = hudState(a);
  let role = i ? HROLE[i.role] || '' : HROLE[a.role] || '';
  if(i && i.service) role += (role ? ', ' : '') + i.service;
  let when = '';
  if(s.since != null){ const t = hudSince(Date.now() - s.since); when = t === 'à l’instant' ? ', à l’instant' : ' depuis ' + t; }
  const lot = i && i.lot ? i.lot.title : '';
  return '<b>' + hudEsc(i ? i.title : a.name) + '</b>' + (role ? '<span>' + hudEsc(role) + '</span>' : '')
    + (s.lib ? '<span class="et"><i style="background:' + s.col + '"></i>' + hudEsc(s.lib + when) + '</span>' : '')
    + (lot ? '<span class="lot">Lot : ' + hudEsc(lot) + '</span>' : '');
}
function showBulle(a, mxp, myp){
  const bl = BUL.el || (BUL.el = $('#bulle')), html = bulleOf(a);
  if(html !== BUL.key || bl.hidden){ bl.innerHTML = html; BUL.key = html; bl.hidden = false; BUL.w = bl.offsetWidth; BUL.h = bl.offsetHeight; }
  const below = myp - 16 - BUL.h < 6;
  bl.style.left = clamp(mxp, BUL.w / 2 + 6, Math.max(BUL.w / 2 + 6, cw - BUL.w / 2 - 6)) + 'px';
  bl.style.top = (below ? myp + 22 : myp - 16) + 'px';
  if(below !== BUL.below){ BUL.below = below; bl.style.transform = below ? 'translate(-50%,0)' : ''; }
}
function hideBulle(){ const bl = BUL.el || (BUL.el = $('#bulle')); if(!bl.hidden){ bl.hidden = true; BUL.key = ''; } }

/* ================================================================ Immeuble panel */
let hudSig = '';
const hudRows = new Map();   // floor index -> {el, c, j, p, v, key...}
function floorSig(){ let s = String(focus); for(const f of floors) s += '|' + f.i + ':' + f.name + ':' + (f.plot && !f.plot.done ? 1 : 0); return s; }
function buildPanel(){
  const el = $('#etages');
  const hadFocus = el.contains(document.activeElement) ? document.activeElement.dataset.f : null;
  let h = '<h2>Immeuble</h2><button class="btn petit vue" type="button" data-f="-1"' + (focus < 0 ? ' aria-current="true"' : '') + '>Vue d’ensemble</button>';
  for(let i = floors.length - 1; i >= 0; i--){
    const fl = floors[i], neuf = fl.plot && !fl.plot.done;
    h += '<button class="etage' + (neuf ? ' neuf' : '') + '" type="button" data-f="' + i + '"' + (focus === i ? ' aria-current="true"' : '') + '><span class="no">' + (i + 1) + '</span><b>' + hudEsc(fl.name) + '</b>'
      + '<small><span class="ec">' + (neuf ? (fl.plot.rev ? 'démolition' : 'chantier') : '0 agent') + '</span><span class="jauge"><i style="width:0"></i></span></small><span class="puces"></span></button>';
  }
  el.innerHTML = h;
  hudRows.clear();
  for(const b of el.querySelectorAll('.etage')){
    hudRows.set(+b.dataset.f, {el: b, c: b.querySelector('.ec'), j: b.querySelector('.jauge i'), p: b.querySelector('.puces'), key: '', cnt: '', w: ''});
  }
  hudSig = floorSig();
  if(hadFocus != null){ const b = el.querySelector('[data-f="' + hadFocus + '"]'); if(b) b.focus({preventScroll: true}); }
}
/* per-floor counts: from fl.stats (donnees.js) or, until it is there, from the agents of the scene */
const HS0 = {total: 0, running: 0, waiting: 0, queued: 0, idle: 0, done: 0, error: 0};
function collectStats(){
  const out = [];
  for(const fl of floors) out.push(fl.stats || null);
  for(let n = 0; n < out.length; n++) if(!out[n]) out[n] = Object.assign({}, HS0);
  for(const a of agents){
    const fl = floors[a.fl];
    if(!fl || fl.stats || a.role === 'worker' || a.leaving) continue;
    const s = out[a.fl], k = a.info ? a.info.state : HSC[a.st];
    s.total++; if(k in s) s[k]++;
  }
  return out;
}
const HCNT = [['#8FD9C4', 'running', 'en cours', 'en cours'], ['#8794AD', 'idle', 'en pause', 'en pause'], ['#F0C36A', 'waiting', 'attend', 'attendent'], ['#6F7F9C', 'queued', 'en file', 'en file'], ['#59627A', 'done', 'fini', 'finis'], ['#E0645A', 'error', 'en erreur', 'en erreur']];
let hudCounter = '', hudSous = '', hudClock = '', hudPhase = '', hudZoom = '', hudRot = '', hudDpEl = null, hudDpOff = null;
function updateUI(force){
  if(force || hudSig !== floorSig()) buildPanel();
  const st = collectStats(), tot = Object.assign({}, HS0);
  let nbp = 0;
  for(let n = 0; n < floors.length; n++){
    const fl = floors[n], s = st[n], r = hudRows.get(fl.i), neuf = fl.plot && !fl.plot.done;
    if(!neuf) nbp++;
    for(const k in tot) tot[k] += s[k] || 0;
    if(!r) continue;
    const n1 = neuf ? (fl.plot.rev ? 'démolition' : 'chantier') : s.total > 0 ? hudPl(s.total, 'agent', 'agents') : 'vide';
    if(r.cnt !== n1){ r.cnt = n1; r.c.textContent = n1; }
    const jw = neuf || !s.total ? 0 : Math.round(100 * (s.running || 0) / s.total);
    if(r.w !== jw){ r.w = jw; r.j.style.width = jw + '%'; }
    const pav = !neuf && fl.missions && fl.missions.some((m) => m.status === 'proposed');
    const wt = s.waiting || 0;
    const key = wt + '|' + (s.done || 0) + '|' + (pav ? 1 : 0) + '|' + s.total + '|' + (s.running || 0) + '|' + (neuf ? (fl.plot.rev ? 2 : 1) : 0);
    if(r.key !== key){
      r.key = key;
      r.p.innerHTML = (wt ? '<span class="att">' + wt + (wt > 1 ? ' attendent' : ' attend') + '</span>' : '') + (pav ? '<span class="pav">Plan à valider</span>' : '') + (s.done ? '<span class="fin">' + hudPl(s.done, 'fini', 'finis') + '</span>' : '');
      r.el.setAttribute('aria-label', 'Étage ' + (fl.i + 1) + ', ' + fl.name + (neuf ? (fl.plot.rev ? ' : démolition en cours' : ' : chantier en cours') : ' : ' + n1 + ', ' + (s.running || 0) + ' en cours' + (wt ? ', ' + wt + (wt > 1 ? ' attendent' : ' attend') : '') + (pav ? ', plan à valider' : '')));
    }
  }
  const items = [];
  for(const c of HCNT){ const n = tot[c[1]]; if(n || c[1] === 'running' || c[1] === 'waiting' || c[1] === 'done') items.push('<span><i style="background:' + c[0] + '"></i><b>' + n + '</b> ' + (n > 1 ? c[3] : c[2]) + '</span>'); }
  const html = items.join('');
  if(force || hudCounter !== html){ hudCounter = html; $('#compteur').innerHTML = html; }
  const sous = floors.length ? hudPl(nbp, 'projet', 'projets') + ', ' + hudPl(tot.total, 'agent', 'agents') : 'Aucun projet';
  if(hudSous !== sous){ hudSous = sous; $('#sous').textContent = sous; }
  const m = curMin(), hh = Math.floor(m / 60) % 24, mm = Math.floor(m % 60);
  const t = (hh < 10 ? '0' : '') + hh + '<i id="dp">:</i>' + (mm < 10 ? '0' : '') + mm;
  if(hudClock !== t){ hudClock = t; $('#hh').innerHTML = t; hudDpEl = $('#dp'); hudDpOff = null; }
  const off = !reduced && (new Date()).getSeconds() % 2 === 1;
  if(hudDpEl && hudDpOff !== off){ hudDpOff = off; hudDpEl.classList.toggle('off', off); }
  const ph = phaseOf(m / 60);
  if(hudPhase !== ph){ hudPhase = ph; $('#phase').textContent = ph; }
  if(DEMO) $('#rHeure').value = Math.floor(m);
  const zl = Math.round(cam.z * 100) + ' %';
  if(hudZoom !== zl){ hudZoom = zl; $('#zoomv').textContent = zl; }
  const rot = (-RA * 180 / Math.PI).toFixed(1);
  if(hudRot !== rot){ hudRot = rot; $('#boussole').style.transform = 'rotate(' + rot + 'deg)'; }
}
$('#etages').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if(b) setFocus(+b.dataset.f); });

/* ================================================================ tools (keys are in controles.js) */
$('#bZin').onclick = () => zoomBy(1.35); $('#bZout').onclick = () => zoomBy(1 / 1.35);
$('#bRg').onclick = () => rotateBy(-1); $('#bRd').onclick = () => rotateBy(1);
$('#bCentre').onclick = () => { autoFit = true; fitNow(false); };

/* manual clock, only on the page opened with ?demo=1 (noyau.js unhides the footer) */
$('#rHeure').oninput = (e) => { manualMin = +e.target.value; fast = false; syncTime(); updateUI(false); };
$('#bReel').onclick = () => { manualMin = null; fast = false; syncTime(); updateUI(false); };
$('#bJour').onclick = () => { fast = !fast; if(fast){ fastMin = manualMin != null ? manualMin : realMin(); manualMin = null; } syncTime(); updateUI(false); };
function syncTime(){ $('#bReel').setAttribute('aria-pressed', String(manualMin == null && !fast)); $('#bJour').setAttribute('aria-pressed', String(fast)); }

/* ================================================================ short message over the scene (the engine and the data module call it too) */
let toastTimer = 0, toastSay = 0;
function toast(s, ms = 3200, err){
  const t = $('#toast'), live = $('#annonce');
  t.textContent = s; t.classList.toggle('err', !!err); t.dataset.v = 'true';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.dataset.v = 'false'; }, ms);
  live.textContent = ''; clearTimeout(toastSay); toastSay = setTimeout(() => { live.textContent = s; }, 60);
}
