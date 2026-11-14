/* web/pixel/ui.js : lot L6, voir docs/vue-pixel.md (2.8) */
/*
 * The page around the scene: counters and clock in the header, the floor chip, the hover tip, toasts, the state of
 * the view buttons, the demo clock. Lot L6, contract in 2.8. Shares one scope with the other web/pixel files: the
 * public names are updateHud, updateFloorChip, showTip, hideTip and toast, every other top-level name wears `ui`.
 * Declares only, nothing runs at load (boot.js calls uiInit, then uiTick every frame).
 *
 * Choices recorded here:
 *  - app.js owns what depends on its own state (« Qui m'attend » and its count, the plan button, the connection
 *    banner, the empty state): it knows the floor shown, the plan open and whether the service answers. updateHud
 *    writes the counters, the summary under the title and the clock.
 *  - Every text of a person goes through textContent (titles and lots come from users). Counters are built from
 *    numbers and fixed words only.
 *  - uiOverlayHeight() is what nav.js turns into Camera.insets: the dialog box, plus on a phone the card, which is
 *    then a sheet under the scene (the two stack: the card sits above the dialog box through the --dh variable of #zone).
 *  - The DOM is written only on change: the clock once a minute, the chip when its numbers change, the tip when its
 *    content changes (it moves with the pointer through transform).
 *  - ?demo=1 shows a « Démo » button in the header that opens #pied (folded by default, a panel under the header, never over a
 *    control): a slider for the hour of the scene, « Heure réelle » and « Jour en 30 s » (setHourOverride).
 */

const uiStates = [
  ['running', '#8FD9C4', 'en cours', 'en cours', true],
  ['idle', '#8794AD', 'en pause', 'en pause', false],
  ['waiting', '#F0C36A', 'attend', 'attendent', true],
  ['queued', '#6F7F9C', 'en file', 'en file', false],
  ['done', '#59627A', 'fini', 'finis', true],
  ['error', '#E0645A', 'en erreur', 'en erreur', false],
];
const uiStateLabel = {
  running: 'En cours', waiting: 'Attend ta réponse', queued: 'En file d’attente', idle: 'En pause', done: 'Fini', error: 'En erreur',
};
const uiRoleLabel = { chef: 'Chef de projet', manager: 'Manager', agent: 'Agent' };
const uiEls = {};
const uiDemo = typeof location !== 'undefined' && /[?&]demo=1(&|$)/.test(location.search);
let uiCountKey = '';
let uiSummary = '';
let uiClockMin = -1;
let uiPhaseName = '';
let uiChip = { index: -2, name: '', total: -1, wait: -1, cons: false, title: '' };
let uiTipKey = '';
let uiTipW = 0;
let uiTipH = 0;
let uiSheet = 0;                   // card height in CSS px while it is a sheet (phone), else 0
let uiDlgSeen = -1;
let uiJrSeen = -1;
let uiJhSeen = -1;
let uiFast = false;
let uiFastMin = 0;
let uiLastT = 0;
let uiToastTimer = 0;
let uiPhoneQuery = null;

function uiEl(id) {
  return uiEls[id] || (uiEls[id] = document.getElementById(id));
}

function uiPl(n, one, many) {
  return n + ' ' + (n > 1 ? many : one);
}

/* ------------------------------ header ------------------------------ */

/** Counters by state, the summary under the title. Called with every state of the service. */
function updateHud(office) {
  const teams = (office && office.teams) || [];
  const count = { running: 0, idle: 0, waiting: 0, queued: 0, done: 0, error: 0 };
  const projects = new Set();
  let total = 0;
  for (const t of teams) {
    if (t.projectId != null) projects.add(t.projectId);
    for (const a of t.agents) {
      total++;
      if (a.state in count) count[a.state]++;
    }
  }
  const key = uiStates.map((s) => count[s[0]]).join('.');
  const box = uiEl('compteur');
  if (box && key !== uiCountKey) {
    uiCountKey = key;
    box.replaceChildren();
    for (const [name, colour, one, many, always] of uiStates) {
      const n = count[name];
      if (!n && !always) continue;
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = colour;
      dot.setAttribute('aria-hidden', 'true');
      const b = document.createElement('b');
      b.textContent = String(n);
      item.append(dot, b, ' ' + (n > 1 ? many : one));
      box.appendChild(item);
    }
  }
  const sous = total ? uiPl(projects.size, 'projet', 'projets') + ', ' + uiPl(total, 'agent', 'agents') : 'Aucun agent';
  const sEl = uiEl('sous');
  if (sEl && sous !== uiSummary) { uiSummary = sous; sEl.textContent = sous; }
}

function uiPhase(h) {
  return h >= 5 && h < 11 ? 'Matin' : h >= 11 && h < 18 ? 'Journée' : h >= 18 && h < 22 ? 'Soir' : 'Nuit';
}

function uiClock() {
  const h = sceneHour(), m = Math.floor(h * 60) % 1440;
  if (m === uiClockMin) return;
  uiClockMin = m;
  const hh = Math.floor(m / 60), mm = m % 60;
  const t = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  const el = uiEl('hh'), ph = uiEl('phase');
  if (el) el.textContent = t;
  const name = uiPhase(h);
  if (ph && name !== uiPhaseName) { uiPhaseName = name; ph.textContent = name; }
  const r = uiEl('rHeure');
  if (r && uiDemo && document.activeElement !== r) r.value = String(m);
}

/** The buttons of the view follow NAV: « Vue avancée » is pressed in the cutaway, « Plan technique » exists only in it. */
function uiViewState() {
  const adv = uiEl('bVueAvancee'), plan = uiEl('bPlanTech');
  if (adv) {
    adv.hidden = false;
    adv.setAttribute('aria-pressed', String(NAV.mode === 'advanced'));
  }
  if (plan) {
    plan.hidden = NAV.mode !== 'advanced';
    plan.setAttribute('aria-pressed', String(NAV.plan));
  }
}

/* ------------------------------ floor chip ------------------------------ */

/** The chip top right of the scene: « 1er étage : Boutique » and « 12 agents, 1 attend » or « Chantier en cours ». */
function updateFloorChip(index) {
  const chip = uiEl('puce');
  const fl = FLOORS[index];
  if (!chip) return;
  const c = uiChip;
  if (!fl) {
    if (c.index !== -1) { c.index = -1; chip.hidden = true; }
    return;
  }
  const st = fl.stats || { total: 0, waiting: 0 };
  const total = st.total || 0, wait = st.waiting || 0, cons = fl.p < 1;
  if (c.index === index && c.name === fl.name && c.total === total && c.wait === wait && c.cons === cons && c.title === fl.title) return;
  c.index = index; c.name = fl.name; c.total = total; c.wait = wait; c.cons = cons; c.title = fl.title;
  chip.hidden = false;
  const t = chip.querySelector('b'), s = chip.querySelector('small');
  if (t) t.textContent = fl.title + ' : ' + fl.name;
  if (s) s.textContent = cons ? 'Chantier en cours' : total ? uiPl(total, 'agent', 'agents') + ', ' + wait + (wait > 1 ? ' attendent' : ' attend') : 'Aucun agent';
}

/* ------------------------------ tip ------------------------------ */

function uiSince(ms) {
  const m = Math.floor(ms / 60000);
  if (ms < 45000) return 'à l’instant';
  if (m < 1) return 'moins d’une minute';
  if (m < 60) return m + ' min';
  if (m < 1440) return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  return Math.floor(m / 1440) + ' j';
}

/** Hover tip: name, role and service, state and since, lot. (sx, sy) are CSS px on the scene. */
function showTip(person, sx, sy) {
  const tip = uiEl('infobulle'), zone = uiEl('zone');
  const a = person && person.info;
  if (!tip || !zone || !a) return;
  const since = a.since != null ? a.since : a.updatedAt;
  const when = since != null ? uiSince(Date.now() - since) : '';
  const state = a.state === 'waiting' && a.waitingFor === 'permission' ? 'Attend ton autorisation' : uiStateLabel[a.state] || '';
  const role = (uiRoleLabel[a.role] || '') + (a.service ? (a.role ? ', ' : '') + a.service : '');
  const key = [a.id, a.title, role, a.state, a.waitingFor, when, a.lot ? a.lot.title : ''].join('|');
  if (key !== uiTipKey || tip.hidden) {
    uiTipKey = key;
    tip.replaceChildren();
    const b = document.createElement('b');
    b.textContent = a.title || 'Sans titre';
    tip.appendChild(b);
    if (role) { const r = document.createElement('span'); r.textContent = role; tip.appendChild(r); }
    if (state) {
      const e = document.createElement('span');
      e.className = 'et';
      const dot = document.createElement('i');
      const st = uiStates.find((s) => s[0] === a.state);
      dot.style.background = st ? st[1] : '#59627A';
      e.append(dot, state + (when ? (when === 'à l’instant' ? ', ' : ' depuis ') + when : ''));
      tip.appendChild(e);
    }
    if (a.lot && a.lot.title) { const l = document.createElement('span'); l.className = 'lot'; l.textContent = 'Lot : ' + a.lot.title; tip.appendChild(l); }
    tip.hidden = false;
    uiTipW = tip.offsetWidth;
    uiTipH = tip.offsetHeight;
  }
  const zw = zone.clientWidth;
  const left = clamp(sx, uiTipW / 2 + 6, Math.max(uiTipW / 2 + 6, zw - uiTipW / 2 - 6));
  const below = sy - 18 - uiTipH < 6;
  tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(below ? sy + 22 : sy - 18 - uiTipH) + 'px) translateX(-50%)';
}

function hideTip() {
  const tip = uiEl('infobulle');
  if (tip && !tip.hidden) { tip.hidden = true; uiTipKey = ''; }
}

/* ------------------------------ toast ------------------------------ */

/** A short message over the scene; it is read out too (#toast is a status region). */
function toast(text, ms, err) {
  const el = uiEl('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', !!err);
  el.dataset.v = 'true';
  clearTimeout(uiToastTimer);
  uiToastTimer = setTimeout(() => { el.dataset.v = 'false'; }, ms > 0 ? ms : err ? 5200 : 3200);
}

/* ------------------------------ overlay, demo clock, frame ------------------------------ */

/** CSS px of the scene hidden by the dialog box (and, on a phone, the card): nav.js turns it into Camera.insets. */
function uiOverlayHeight() {
  const d = dialogHeight();
  return d + uiSheet;
}

function uiMeasureSheet() {
  const f = uiEl('fiche');
  uiSheet = f && !f.hidden && uiPhoneQuery && uiPhoneQuery.matches ? Math.ceil(f.getBoundingClientRect().height) : 0;
}

function uiBindDemo() {
  const foot = uiEl('pied'), open = uiEl('bDemo');
  if (!foot || !open || !uiDemo) return;
  open.hidden = false;
  open.addEventListener('click', () => {
    foot.hidden = !foot.hidden;
    open.setAttribute('aria-expanded', String(!foot.hidden));
    open.setAttribute('aria-pressed', String(!foot.hidden));
  });
  const range = uiEl('rHeure'), real = uiEl('bReel'), day = uiEl('bJour');
  let manual = false;                // the hour is set by hand or by the fast day, not read from the clock
  const sync = () => {
    if (real) real.setAttribute('aria-pressed', String(!manual));
    if (day) day.setAttribute('aria-pressed', String(uiFast));
  };
  if (range) range.addEventListener('input', () => {
    uiFast = false; manual = true;
    setHourOverride(Number(range.value) / 60);
    uiClockMin = -1;
    sync();
  });
  if (real) real.addEventListener('click', () => { uiFast = false; manual = false; setHourOverride(null); uiClockMin = -1; sync(); });
  if (day) day.addEventListener('click', () => {
    uiFast = !uiFast;
    if (uiFast) { uiFastMin = sceneHour() * 60; manual = true; } else { manual = false; setHourOverride(null); }
    sync();
  });
  sync();
}

/** Wires the page (demo clock, card measure). */
function uiInit() {
  uiPhoneQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 720px)') : null;
  const f = uiEl('fiche');
  if (f && typeof ResizeObserver === 'function') new ResizeObserver(uiMeasureSheet).observe(f);
  if (uiPhoneQuery && uiPhoneQuery.addEventListener) uiPhoneQuery.addEventListener('change', uiMeasureSheet);
  uiBindDemo();
  uiViewState();
}

/** Every frame: the clock, the chip, the --dh variable, the fast demo day. */
function uiTick(T) {
  const dt = Math.min(0.1, Math.max(0, T - uiLastT));
  uiLastT = T;
  if (uiFast) {
    uiFastMin = (uiFastMin + (dt * 1440) / 30) % 1440;
    setHourOverride(uiFastMin / 60);
  }
  uiClock();
  updateFloorChip(NAV.floor);
  const jb = NAV.mode === 'advanced' ? jrnInsets() : null, jr = jb ? jb.right : 0, jh = jb ? jb.bottom : 0;
  if (jr !== uiJrSeen || jh !== uiJhSeen) {          // the controls stay clear of the journal (--jr: column, --jh: sheet)
    uiJrSeen = jr; uiJhSeen = jh;
    const zone = uiEl('zone');
    if (zone) { zone.style.setProperty('--jr', jr + 'px'); zone.style.setProperty('--jh', jh + 'px'); }
  }
  const d = dialogHeight();
  if (d !== uiDlgSeen) {
    uiDlgSeen = d;
    const zone = uiEl('zone');
    if (zone) zone.style.setProperty('--dh', d + 'px');
  }
}
