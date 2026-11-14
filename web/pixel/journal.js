/* web/pixel/journal.js : lot L10, voir docs/vue-pixel.md (2.9, 2.10) */
/*
 * The journal of the advanced view: one line per spoken line of TALK_LOG (talk.js), in four tabs (Tout, Travail,
 * Papotage, Alertes). Fills #journal (shell.html owns the box, nav.js its `hidden`). Lot L10, contract in 2.9.
 * Shares one scope with the other web/pixel files: the public names are buildJournal and refreshJournal, every other
 * top-level name wears `jrn`. Declares only, nothing runs at load.
 *
 * Choices recorded here (additions to 2.9, all additive):
 *  - New lines go at the bottom, like a chat log; the list follows them only while it is scrolled to its end, else a
 *    button « N nouvelles » brings the reader back.
 *  - The DOM is written when something changes (a line, a tab, the scroll state), never per frame. A tab only hides the
 *    lines of the other groups with CSS, so switching is free.
 *  - Backfill: the first state is only marked as seen by talk.js (nothing plays), so the journal would open empty. At the first
 *    refreshJournal that finds an office, the events of the last 2 minutes (getOffice().events) become lines, worded by
 *    pickLines of dialogues.js like the talks (same seed: the id of the event), stamped with the time of the event, in a
 *    quieter colour (class jrn-passe). With nothing to show, a text explains what the journal is for.
 *  - Lines arrive through onTalk; refreshJournal (called by applyOffice) also catches up with what TALK_LOG holds
 *    and the journal has not shown, and notices that #journal was shown or hidden.
 *  - Hover or focus on a line: advHighlight([fromId, toId]); leaving: advHighlight(null). Click: advFocus(who), else the
 *    other people of the exchange. After a click, the highlight is dropped by itself after 2.5 s unless the pointer or
 *    the focus is still on the line (touch screens have no hover).
 *  - jrnInsets() gives the room the journal takes ({ right, bottom }, CSS px, 0 when hidden): at the right on a wide
 *    window, a sheet at the bottom up to 720 px. nav.js can add it to advCam.insets.
 *  - Style: classes `jrn-`, injected once as a <style> by buildJournal, with the variables of shell.html.
 */

const jrnTabs = [
  { id: 'tout', label: 'Tout' },
  { id: 'travail', label: 'Travail' },
  { id: 'papotage', label: 'Papotage' },
  { id: 'alertes', label: 'Alertes' },
];
const jrnGroupOf = { delegate: 'travail', report: 'travail', plan: 'travail', answered: 'travail', arrive: 'travail', depart: 'travail', chat: 'papotage', blocked: 'alertes', waiting: 'alertes' };
const jrnKindLabel = { delegate: 'Délégation', report: 'Rapport', plan: 'Plan', answered: 'Réponse', arrive: 'Arrivée', depart: 'Départ', chat: 'Papotage', blocked: 'Blocage', waiting: 'Attente' };
const jrnKindColour = { delegate: '#9A6B4B', report: '#8FD9C4', plan: '#AEB8C8', answered: '#86B06E', arrive: '#9CC7D8', depart: '#7C879A', chat: '#4A5875', blocked: '#E0645A', waiting: '#F0C36A' };
const jrnMax = 300;
const jrnNearEnd = 36;           // px from the end of the list that still count as « at the end »

let jrnRoot = null;              // #journal
let jrnList = null;              // <ol>
let jrnPanel = null;
let jrnEmpty = null;
let jrnMore = null;              // the « N nouvelles » button
let jrnTabEls = [];
let jrnSel = 'tout';
let jrnRecs = [];                // { e, li, group }
let jrnCounts = { tout: 0, travail: 0, papotage: 0, alertes: 0 };
let jrnPending = 0;              // lines added out of sight, in the shown tab
let jrnDone = new WeakSet();     // TALK_LOG entries already shown
let jrnOff = null;               // onTalk unsubscribe
let jrnHidden = true;
let jrnLive = 0;                 // lines of the live flow in jrnRecs (the past ones come before them)
let jrnPrimed = false;           // the events of the first state were turned into lines
let jrnHover = null;             // line (li) the highlight is for
let jrnClearT = 0;
let jrnBox = { w: 0, h: 0, bottom: false };
const jrnIns = { right: 0, bottom: 0 };

/* ------------------------------ style ------------------------------ */

const jrnCss = `
#journal.jrn{display:flex;flex-direction:column;overflow:hidden;font-size:13px}
.jrn-tete{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:8px 10px;border-bottom:1px solid var(--ligne)}
.jrn-titre{margin:0;font-size:14px;font-weight:650;margin-right:auto}
.jrn-onglets{display:flex}
.jrn-onglet{min-height:30px;padding:2px 9px;border:1px solid var(--ligne2);border-radius:0;margin-left:-1px;background:var(--bouton);color:var(--texte);font-size:13px}
.jrn-onglet:first-child{margin-left:0;border-radius:4px 0 0 4px}
.jrn-onglet:last-child{border-radius:0 4px 4px 0}
.jrn-onglet:hover{background:#38455C}
.jrn-onglet[aria-selected=true]{position:relative;z-index:1;background:var(--lampe);border-color:var(--lampe);color:#2A2008}
.jrn-onglet:focus-visible{position:relative;z-index:2}
.jrn-corps{flex:1;min-height:0;position:relative;display:flex;flex-direction:column}
.jrn-liste{flex:1;min-height:0;margin:0;padding:0;list-style:none;overflow:auto;overscroll-behavior:contain;scrollbar-color:var(--ligne2) var(--panneau)}
.jrn-liste[data-o=travail] .jrn-l:not(.jrn-g-travail),.jrn-liste[data-o=papotage] .jrn-l:not(.jrn-g-papotage),.jrn-liste[data-o=alertes] .jrn-l:not(.jrn-g-alertes){display:none}
.jrn-l{position:relative;border-bottom:1px solid #2A3548}
.jrn-l::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--jrn-c,#4A5875);pointer-events:none}
.jrn-b{display:grid;grid-template-columns:64px minmax(0,1fr);gap:1px 8px;width:100%;padding:7px 10px 8px 13px;border:0;border-radius:0;background:transparent;color:var(--texte);font:inherit;text-align:left;cursor:pointer}
.jrn-b:hover,.jrn-b:focus-visible{background:#2B3649}
.jrn-b:focus-visible{outline-offset:-2px}
.jrn-t{color:var(--doux);font-size:12px;font-variant-numeric:tabular-nums;padding-top:1px}
.jrn-h{min-width:0;overflow-wrap:anywhere}
.jrn-qui{font-weight:600}
.jrn-vers{color:var(--doux)}
.jrn-k{color:var(--doux);font-size:11.5px;line-height:1.5}
.jrn-tx{min-width:0;overflow-wrap:anywhere}
.jrn-passe .jrn-tx{color:var(--doux)}
.jrn-vide{margin:0;padding:14px 12px;color:var(--doux)}
.jrn-plus{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);min-height:30px;padding:3px 12px;border:1px solid var(--lampe);border-radius:15px;background:var(--lampe);color:#2A2008;font-size:12.5px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.4)}
@media (max-width:720px){
  #journal.jrn{left:0;right:0;top:auto;bottom:0;width:auto;height:min(42%,300px);border-left:0;border-top:1px solid var(--ligne2)}
  .jrn-onglet{min-height:36px;padding:2px 11px}
  .jrn-b{padding-top:8px;padding-bottom:9px}
}
`;

/* ------------------------------ small things ------------------------------ */

function jrnPad(n) {
  return n < 10 ? '0' + n : String(n);
}

function jrnClock(at) {
  const d = new Date(at);
  return jrnPad(d.getHours()) + ':' + jrnPad(d.getMinutes()) + ':' + jrnPad(d.getSeconds());
}

function jrnTitleOf(id, fallback) {
  const p = id && typeof personById === 'function' ? personById(id) : null;
  return (p && p.info && p.info.title) || fallback || '';
}

function jrnEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function jrnAtEnd() {
  return jrnList.scrollHeight - jrnList.scrollTop - jrnList.clientHeight <= jrnNearEnd;
}

function jrnToEnd() {
  jrnList.scrollTop = jrnList.scrollHeight;
  jrnSetPending(0);
}

function jrnSetPending(n) {
  if (n === jrnPending) return;
  jrnPending = n;
  if (!jrnMore) return;
  jrnMore.hidden = n <= 0;
  if (n > 0) jrnMore.textContent = n === 1 ? '1 nouvelle' : n + ' nouvelles';
}

const jrnEmptyNone = 'Aucun échange récent. Les délégations, rapports et discussions s’affichent ici.';
const jrnEmptyTab = 'Rien dans cet onglet pour le moment.';

function jrnCountsChanged() {
  if (!jrnEmpty) return;
  jrnEmpty.hidden = jrnCounts[jrnSel] > 0;
  const text = jrnCounts.tout > 0 ? jrnEmptyTab : jrnEmptyNone;
  if (jrnEmpty.textContent !== text) jrnEmpty.textContent = text;
}

/* ------------------------------ highlight and focus ------------------------------ */

function jrnHot(li) {
  if (li === jrnHover) return;
  jrnHover = li;
  if (typeof advHighlight !== 'function') return;
  const rec = li ? jrnRecOf.get(li) : null;
  advHighlight(rec ? [rec.e.fromId, rec.e.toId] : null);
}

const jrnRecOf = new WeakMap();   // li -> record

function jrnReachable(id) {
  const p = id && typeof personById === 'function' ? personById(id) : null;
  return !!(p && p.floor);
}

function jrnGo(rec) {
  const e = rec.e;
  const ids = [e.who, e.fromId, e.toId];
  for (const id of ids) {
    if (jrnReachable(id)) {
      if (typeof advFocus === 'function') advFocus(id);
      return;
    }
  }
  if (typeof Pixel !== 'undefined' && Pixel && typeof Pixel.toast === 'function') Pixel.toast('Cet agent n’est plus dans l’immeuble.', 2500);
}

function jrnLineOf(target) {
  const li = target && target.closest ? target.closest('.jrn-l') : null;
  return li && jrnList.contains(li) ? li : null;
}

/* ------------------------------ lines ------------------------------ */

function jrnMake(e) {
  const li = jrnEl('li', 'jrn-l');
  const group = jrnGroupOf[e.kind] || '';
  if (group) li.classList.add('jrn-g-' + group);
  if (e.past) li.classList.add('jrn-passe');
  li.style.setProperty('--jrn-c', jrnKindColour[e.kind] || '#4A5875');
  const b = jrnEl('button', 'jrn-b');
  b.type = 'button';
  b.appendChild(jrnEl('time', 'jrn-t', jrnClock(e.at)));
  const h = jrnEl('span', 'jrn-h');
  h.appendChild(jrnEl('b', 'jrn-qui', e.name || jrnTitleOf(e.who, 'Quelqu’un')));
  const otherId = e.who === e.fromId ? e.toId : e.fromId;
  if (otherId && otherId !== e.who) {
    const other = jrnTitleOf(otherId, '');
    if (other) h.appendChild(jrnEl('span', 'jrn-vers', ' à ' + other));
  }
  b.appendChild(h);
  b.appendChild(jrnEl('span', 'jrn-k', jrnKindLabel[e.kind] || ''));
  b.appendChild(jrnEl('span', 'jrn-tx', '« ' + e.text + ' »'));
  li.appendChild(b);
  return { e, li, group };
}

function jrnTrim() {
  while (jrnRecs.length > jrnMax) {
    const old = jrnRecs.shift();
    if (old.li === jrnHover) jrnHot(null);
    old.li.remove();
    jrnCounts.tout--;
    if (old.group) jrnCounts[old.group]--;
    if (jrnLive > jrnRecs.length) jrnLive = jrnRecs.length;
  }
}

function jrnAdd(e) {
  if (!jrnList || !e || jrnDone.has(e)) return;
  jrnDone.add(e);
  const wasEnd = jrnAtEnd();
  const rec = jrnMake(e);
  jrnRecOf.set(rec.li, rec);
  jrnList.appendChild(rec.li);
  jrnRecs.push(rec);
  jrnLive++;
  jrnCounts.tout++;
  if (rec.group) jrnCounts[rec.group]++;
  jrnTrim();
  const shown = jrnSel === 'tout' || jrnSel === rec.group;
  if (shown && !jrnHidden) {
    if (wasEnd) jrnToEnd();
    else jrnSetPending(jrnPending + 1);
  }
  jrnCountsChanged();
}

/* ------------------------------ tabs ------------------------------ */

function jrnSelect(id, focus) {
  if (id === jrnSel && !focus) return;
  jrnSel = id;
  jrnTabEls.forEach((el) => {
    const on = el.dataset.o === id;
    el.setAttribute('aria-selected', String(on));
    el.tabIndex = on ? 0 : -1;
    if (on) {
      jrnPanel.setAttribute('aria-labelledby', el.id);
      if (focus) el.focus();
    }
  });
  jrnList.dataset.o = id;
  jrnHot(null);
  jrnCountsChanged();
  jrnToEnd();
}

function jrnTabKey(ev) {
  const i = jrnTabs.findIndex((t) => t.id === jrnSel);
  let k = -1;
  if (ev.key === 'ArrowRight') k = (i + 1) % jrnTabs.length;
  else if (ev.key === 'ArrowLeft') k = (i + jrnTabs.length - 1) % jrnTabs.length;
  else if (ev.key === 'Home') k = 0;
  else if (ev.key === 'End') k = jrnTabs.length - 1;
  if (k < 0) return;
  ev.preventDefault();
  jrnSelect(jrnTabs[k].id, true);
}

/* ------------------------------ public ------------------------------ */

/** Builds the journal into #journal (once): header with the tabs, the list, the empty message. Starts listening to onTalk. */
function buildJournal() {
  if (jrnRoot) return;
  const root = document.getElementById('journal');
  if (!root) return;
  jrnRoot = root;
  if (!document.getElementById('jrn-style')) {
    const st = document.createElement('style');
    st.id = 'jrn-style';
    st.textContent = jrnCss;
    document.head.appendChild(st);
  }
  root.classList.add('jrn');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Journal des échanges');
  root.textContent = '';
  const head = jrnEl('div', 'jrn-tete');
  head.appendChild(jrnEl('h2', 'jrn-titre', 'Journal'));
  const tabs = jrnEl('div', 'jrn-onglets');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Filtrer le journal');
  jrnTabEls = jrnTabs.map((t) => {
    const b = jrnEl('button', 'jrn-onglet', t.label);
    b.type = 'button';
    b.id = 'jrn-onglet-' + t.id;
    b.dataset.o = t.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t.id === jrnSel));
    b.setAttribute('aria-controls', 'jrn-panneau');
    b.tabIndex = t.id === jrnSel ? 0 : -1;
    b.addEventListener('click', () => jrnSelect(t.id, false));
    b.addEventListener('keydown', jrnTabKey);
    tabs.appendChild(b);
    return b;
  });
  head.appendChild(tabs);
  root.appendChild(head);
  jrnPanel = jrnEl('div', 'jrn-corps');
  jrnPanel.id = 'jrn-panneau';
  jrnPanel.setAttribute('role', 'tabpanel');
  jrnPanel.setAttribute('aria-labelledby', 'jrn-onglet-' + jrnSel);
  jrnList = jrnEl('ol', 'jrn-liste');
  jrnList.dataset.o = jrnSel;
  jrnEmpty = jrnEl('p', 'jrn-vide', jrnEmptyNone);
  jrnMore = jrnEl('button', 'jrn-plus');
  jrnMore.type = 'button';
  jrnMore.hidden = true;
  jrnMore.setAttribute('aria-label', 'Aller aux dernières lignes du journal');
  jrnMore.addEventListener('click', jrnToEnd);
  jrnPanel.append(jrnEmpty, jrnList, jrnMore);
  root.appendChild(jrnPanel);
  jrnList.addEventListener('scroll', () => { if (jrnPending && jrnAtEnd()) jrnSetPending(0); }, { passive: true });
  jrnList.addEventListener('pointerover', (ev) => { if (ev.pointerType !== 'touch') jrnHot(jrnLineOf(ev.target)); });
  jrnList.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch' && !jrnList.contains(document.activeElement)) jrnHot(null); });
  jrnList.addEventListener('focusin', (ev) => jrnHot(jrnLineOf(ev.target)));
  jrnList.addEventListener('focusout', (ev) => { if (!ev.relatedTarget || !jrnList.contains(ev.relatedTarget)) jrnHot(null); });
  jrnList.addEventListener('click', (ev) => {
    const li = jrnLineOf(ev.target);
    const rec = li ? jrnRecOf.get(li) : null;
    if (!rec) return;
    jrnGo(rec);
    jrnHot(li);
    clearTimeout(jrnClearT);
    jrnClearT = setTimeout(() => {
      if (jrnHover === li && !li.matches(':hover') && !li.contains(document.activeElement)) jrnHot(null);
    }, 2500);
  });
  if (typeof MutationObserver === 'function') {
    new MutationObserver(jrnVisibility).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(jrnMeasure).observe(root);
  jrnHidden = root.hidden;
  if (typeof onTalk === 'function') jrnOff = onTalk((ev) => { if (ev && ev.type === 'line' && ev.entry) jrnAdd(ev.entry); });
  jrnCatchUp();
  jrnCountsChanged();
}

/** The people of an event, in the order talk.js seats them: the first speaks first. */
function jrnPartsOf(ev, agents, team) {
  const get = (id) => (id && agents.get(id)) || (id === ev.agentId ? { id, title: ev.title, role: 'agent', state: 'idle' } : null);
  const me = get(ev.agentId);
  let other = null, third = null;
  switch (ev.kind) {
    case 'delegate': return { parts: [get(ev.fromId), me], other: get(ev.fromId), third };
    case 'report':
    case 'blocked': other = get(ev.toId); return { parts: [me, other], other, third };
    case 'plan': {
      const mgrs = team ? team.agents.filter((a) => a.role === 'manager' && a.id !== ev.agentId).sort((a, b) => a.createdAt - b.createdAt) : [];
      if (ev.phase !== 'proposed') { other = mgrs[0] || null; third = mgrs[1] || null; }
      return { parts: [me, other, third], other, third };
    }
    case 'arrive':
    case 'depart': {
      const a = agents.get(ev.agentId);
      other = get((a && a.parentId) || ev.parentId || null);
      return { parts: [me, other], other, third };
    }
    default: return { parts: [me], other: null, third };
  }
}

/** The events of the last two minutes of the first state, as journal lines (marked past). */
function jrnBackfill() {
  if (jrnPrimed) return;
  const office = typeof getOffice === 'function' ? getOffice() : null;
  if (!office) return;
  jrnPrimed = true;
  if (typeof pickLines !== 'function') return;
  const events = office.events || [];
  const now = Date.now();
  const agents = new Map(), teams = new Map();
  for (const t of office.teams || []) for (const a of t.agents) { agents.set(a.id, a); teams.set(a.id, t); }
  const recent = [];
  const entries = [];
  for (const ev of events) {
    if (now - ev.at > 120000) continue;
    const { parts, other, third } = jrnPartsOf(ev, agents, teams.get(ev.agentId) || null);
    const me = agents.get(ev.agentId) || { id: ev.agentId, title: ev.title };
    const ctx = { event: ev, agent: me, other, team: teams.get(ev.agentId) || null, lot: null, now };
    if (third) ctx.third = third;
    let lines = null;
    try { lines = pickLines(ev.kind, ctx, hash(ev.id), recent); } catch (e) { lines = null; }
    if (!lines) continue;
    const who = { a: 0, b: 1, c: 2 };
    for (const ln of lines) {
      const k = who[ln.who] || 0;
      const sp = parts[k] || parts[0] || me;
      entries.push({
        at: ev.at, convId: 'ev-' + ev.id, kind: ev.kind, floorId: null,
        fromId: (parts[0] || me).id, toId: parts[1] ? parts[1].id : null, who: sp.id, name: sp.title || '', idx: k, text: ln.text, past: true,
      });
    }
  }
  if (!entries.length || !jrnList) return;
  const first = jrnList.firstChild;
  for (const e of entries) {
    jrnDone.add(e);
    const rec = jrnMake(e);
    jrnRecOf.set(rec.li, rec);
    jrnList.insertBefore(rec.li, first);
    jrnRecs.splice(jrnRecs.length - jrnLive, 0, rec);
    jrnCounts.tout++;
    if (rec.group) jrnCounts[rec.group]++;
  }
  jrnTrim();
  jrnCountsChanged();
  if (!jrnHidden) jrnToEnd();
}

function jrnCatchUp() {
  if (typeof TALK_LOG === 'undefined') return;
  for (let i = 0; i < TALK_LOG.length; i++) if (!jrnDone.has(TALK_LOG[i])) jrnAdd(TALK_LOG[i]);
}

function jrnVisibility() {
  if (!jrnRoot) return;
  const hidden = jrnRoot.hidden;
  if (hidden === jrnHidden) return;
  jrnHidden = hidden;
  if (hidden) jrnHot(null);
  else jrnToEnd();
  jrnMeasure();
}

function jrnMeasure() {
  if (!jrnRoot) return;
  if (jrnRoot.hidden) { jrnBox.w = 0; jrnBox.h = 0; return; }
  jrnBox.w = jrnRoot.offsetWidth;
  jrnBox.h = jrnRoot.offsetHeight;
  jrnBox.bottom = typeof matchMedia === 'function' && matchMedia('(max-width:720px)').matches;
}

/** The room the journal takes, CSS px: { right, bottom }, a reused object. 0 when it is hidden. */
function jrnInsets() {
  jrnIns.right = jrnBox.bottom ? 0 : jrnBox.w;
  jrnIns.bottom = jrnBox.bottom ? jrnBox.h : 0;
  return jrnIns;
}

/** Called by applyOffice: shows the lines TALK_LOG holds that the journal missed, and follows #journal being shown or hidden. */
function refreshJournal() {
  if (!jrnRoot) return;
  jrnVisibility();
  jrnBackfill();
  jrnCatchUp();
}
