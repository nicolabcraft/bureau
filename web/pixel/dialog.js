/* web/pixel/dialog.js : lot L5, voir docs/vue-pixel.md (2.6, 2.10) */
/*
 * Dialog box of the pixel view: two portraits, the lines of a conversation so far, « Ouvrir la conversation ».
 * Lot L5, contract in 2.6. Shares one scope with the other web/pixel files: the public names are showDialog,
 * hideDialog and dialogHeight, every other top-level name wears `dbx`. Declares only, nothing runs at load: the
 * markup is built inside `#dialog` (shell.html, lot L6) the first time a conversation is shown, with its own
 * `<style>` (classes `dbx-`); the position of `#dialog` itself stays in shell.html.
 *
 * Choices recorded here:
 *  - The box follows the conversation in play (talk.js calls dbxUpdate every tick; it writes the DOM only when
 *    the lines, the letters shown or the speaker changed). A finished conversation stays readable until
 *    hideDialog. Every text goes through textContent (titles and lines come from users).
 *  - Left portrait: the first of conv.parts; right portrait: the speaker when it is not the first, else the second.
 *    Solo conversations (waiting, answered, plan proposed, report without receiver) show one portrait.
 *  - dialogHeight() is in CSS px, margins included, 0 when hidden; the log has a fixed height so that it does not
 *    change while a talk is read. nav.js converts it to logical px for Camera.insets (css px * dpr / zoom).
 *  - « Ouvrir la conversation » calls window.Pixel.onOpenThread(id of the thread the talk is about) when app.js
 *    sets it, else window.Pixel.onAgentClick(id) (the card, which holds the button that opens the Boite thread). Fermer calls hideDialog.
 */

const dbxLabels = {
  delegate: 'Délégation', report: 'Rapport', blocked: 'Blocage', waiting: 'Attente', plan: 'Plan de mission',
  arrive: 'Arrivée', depart: 'Départ', answered: 'Réponse', chat: 'Papotage',
};

const dbxCss = `
#dialog[hidden]{display:none}
.dbx-box{box-sizing:border-box;width:calc(100% - 20px);max-width:760px;margin:10px auto;display:grid;grid-template-columns:84px 1fr 84px;gap:12px;align-items:end;padding:12px 14px;
  background:var(--fond,#1A212E);color:var(--texte,#E8ECF2);border:2px solid var(--doux,#AAB5C8);box-shadow:0 0 0 2px var(--fond,#1A212E),0 0 0 4px var(--ligne,#37435A);font-size:14px;line-height:1.4}
.dbx-box.dbx-solo{grid-template-columns:84px 1fr}
.dbx-box.dbx-solo .dbx-pb{display:none}
.dbx-por{display:block;width:84px;height:77px;image-rendering:pixelated;background:var(--panneau,#222B3A);border:2px solid var(--ligne,#37435A);transition:transform .12s steps(2)}
.dbx-por.dbx-talk{border-color:var(--lampe,#F0C36A);transform:translateY(-4px)}
.dbx-mid{min-width:0;display:grid;grid-template-columns:1fr auto auto;grid-template-areas:"kind open close" "log log log";align-items:center;column-gap:6px;row-gap:6px}
.dbx-kind{grid-area:kind;color:var(--doux,#AAB5C8);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbx-open{grid-area:open}
.dbx-close{grid-area:close}
.dbx-mid button{font:inherit;font-size:12px;color:var(--doux,#AAB5C8);background:transparent;border:1px solid var(--ligne,#37435A);border-radius:3px;padding:3px 9px;min-height:28px;cursor:pointer;touch-action:manipulation}
.dbx-mid button:hover,.dbx-mid button:focus-visible{border-color:var(--doux,#AAB5C8);color:var(--texte,#E8ECF2)}
.dbx-log{grid-area:log;height:62px;overflow:auto;width:100%}
.dbx-log p{margin:0 0 4px;position:relative}
.dbx-log b{font-weight:650;margin-right:6px}
.dbx-wait{color:var(--doux,#AAB5C8)}
.dbx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:720px){
  .dbx-box{margin:6px auto;gap:8px;padding:8px;grid-template-columns:52px 1fr 52px;font-size:13px}
  .dbx-box.dbx-solo{grid-template-columns:52px 1fr}
  .dbx-por{width:52px;height:48px}
  .dbx-mid{grid-template-columns:1fr auto;grid-template-areas:"kind close" "log log" "open open"}
  .dbx-log{height:60px}
  .dbx-open{justify-self:stretch}
}
@media (prefers-reduced-motion:reduce){.dbx-por{transition:none}}
`;

let dbxRoot = null;
let dbxEl = null;
let dbxConv = null;
let dbxH = 0;
let dbxSig = '';
let dbxPorKey = '';
let dbxRows = [];

function dbxMake(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function dbxMeasure() {
  dbxH = dbxRoot && !dbxRoot.hidden ? Math.ceil(dbxRoot.getBoundingClientRect().height) : 0;
}

/** Builds the markup once; false when the page has no `#dialog`. */
function dbxEnsure() {
  if (dbxEl) return true;
  const root = document.getElementById('dialog');
  if (!root) return false;
  dbxRoot = root;
  if (!document.getElementById('dbx-style')) {
    const st = document.createElement('style');
    st.id = 'dbx-style';
    st.textContent = dbxCss;
    document.head.appendChild(st);
  }
  const box = dbxMake('div', 'dbx-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Discussion');
  const pa = dbxMake('canvas', 'dbx-por dbx-pa');
  const pb = dbxMake('canvas', 'dbx-por dbx-pb');
  pa.width = pb.width = 72;
  pa.height = pb.height = 66;
  const mid = dbxMake('div', 'dbx-mid');
  const kind = dbxMake('span', 'dbx-kind');
  const open = dbxMake('button', 'dbx-open', 'Ouvrir la conversation');
  const close = dbxMake('button', 'dbx-close', 'Fermer');
  open.type = close.type = 'button';
  open.addEventListener('click', dbxOpenThread);
  close.addEventListener('click', hideDialog);
  const log = dbxMake('div', 'dbx-log');
  log.setAttribute('aria-live', 'polite');
  mid.append(kind, open, close, log);
  box.append(pa, mid, pb);
  root.replaceChildren(box);
  dbxEl = { box, pa, pb, kind, log };
  if (typeof ResizeObserver === 'function') new ResizeObserver(dbxMeasure).observe(root);
  return true;
}

/** The thread the talk is about: the agent of its event, else the first of the people. */
function dbxMainId(conv) {
  if (conv.event && conv.event.agentId) return conv.event.agentId;
  return conv.parts[0] ? conv.parts[0].id : null;
}

function dbxOpenThread() {
  if (!dbxConv) return;
  const id = dbxMainId(dbxConv);
  const px = typeof window !== 'undefined' ? window.Pixel : null;
  if (!id || !px) return;
  if (typeof px.onOpenThread === 'function') px.onOpenThread(id);
  else if (typeof px.onAgentClick === 'function') px.onAgentClick(id);
}

function dbxName(p) {
  return (p && p.info && p.info.title) || '';
}

function dbxPortraits(conv) {
  const a = conv.parts[0] || null;
  const cur = conv.cur;
  const b = conv.parts.length < 2 ? null : cur && cur.who >= 1 ? conv.parts[cur.who] : conv.parts[1];
  const key = (a ? a.id : '') + '|' + (b ? b.id : '');
  if (key !== dbxPorKey) {
    dbxPorKey = key;
    if (a) drawPortrait(dbxEl.pa, a.id, a.role);
    if (b) drawPortrait(dbxEl.pb, b.id, b.role);
    dbxEl.pa.title = dbxName(a);
    dbxEl.pb.title = dbxName(b);
  }
  const live = conv.phase === 'talk' && cur;
  dbxEl.pa.classList.toggle('dbx-talk', !!live && cur.who === 0);
  dbxEl.pb.classList.toggle('dbx-talk', !!live && cur.who !== 0);
  dbxEl.box.classList.toggle('dbx-solo', conv.parts.length < 2);
}

function dbxFloorName(conv) {
  return conv.floor && typeof floorTitle === 'function' ? floorTitle(conv.floor.index) : '';
}

/** Writes the box for the current state of dbxConv. `force`: even when nothing seems to have changed. */
function dbxRender(force) {
  const conv = dbxConv;
  const live = conv.phase === 'talk' && !!conv.cur;
  const spoken = conv.spoken;
  const sig = spoken + ':' + (live ? conv.typed : -1) + ':' + conv.phase + ':' + (conv.cur ? conv.cur.who : -1);
  if (!force && sig === dbxSig) return;
  dbxSig = sig;
  const label = (dbxLabels[conv.kind] || 'Discussion') + (dbxFloorName(conv) ? ', ' + dbxFloorName(conv) : '');
  if (dbxEl.kind.textContent !== label) dbxEl.kind.textContent = label;
  dbxPortraits(conv);
  const log = dbxEl.log;
  if (spoken === 0) {
    if (!dbxRows.length && !log.firstChild) log.appendChild(dbxMake('p', 'dbx-wait', 'Les personnages se rejoignent.'));
    return;
  }
  if (!dbxRows.length) log.replaceChildren();
  while (dbxRows.length < spoken) {
    const line = conv.lines[dbxRows.length];
    const p = dbxMake('p');
    const who = dbxMake('b', '', dbxName(conv.parts[line.who]) + ' :');
    const shown = dbxMake('span');
    shown.setAttribute('aria-hidden', 'true');
    const full = dbxMake('span', 'dbx-sr', line.text);
    p.append(who, shown, full);
    log.appendChild(p);
    dbxRows.push({ shown, text: line.text });
  }
  for (let i = 0; i < dbxRows.length; i++) {
    const r = dbxRows[i];
    const last = i === spoken - 1 && live;
    const text = last ? r.text.slice(0, conv.typed) : r.text;
    if (r.shown.textContent !== text) r.shown.textContent = text;
  }
  log.scrollTop = log.scrollHeight;
}

/** Called by talk.js every tick: follows the conversation shown. */
function dbxUpdate() {
  if (!dbxConv || !dbxEl || dbxRoot.hidden) return;
  dbxRender(false);
}

function showDialog(conv) {
  if (!conv || !dbxEnsure()) return;
  dbxConv = conv;
  dbxSig = '';
  dbxPorKey = '';
  dbxRows = [];
  dbxEl.log.replaceChildren();
  dbxRoot.hidden = false;
  dbxRender(true);
  dbxMeasure();
}

function hideDialog() {
  dbxConv = null;
  dbxH = 0;
  if (dbxRoot) dbxRoot.hidden = true;
}

/** Height of the box in CSS px, margins included; 0 when hidden. */
function dialogHeight() {
  return dbxH;
}
