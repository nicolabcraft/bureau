/* web/app.js: glue between the service and the view (state, agent card, lists, plan, buttons). Owned by the « interface » module, see docs/vue-immeuble.md. */
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const MIN = 60000;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const plur = (n, un, plu) => n + ' ' + (n > 1 ? plu : un);

const ETAT = {
  running: {lib: 'En cours', col: '#8FD9C4'},
  waiting: {lib: 'Attend ta réponse', col: '#F0C36A'},
  queued: {lib: 'En file d’attente', col: '#6F7F9C'},
  idle: {lib: 'En pause', col: '#8DA2C0'},
  done: {lib: 'Fini', col: '#59627A'},
  error: {lib: 'En erreur', col: '#E0645A'}
};
const ROLE = {chef: 'Chef de projet', manager: 'Manager', agent: 'Agent'};
const LOT_ETAT = {todo: 'À faire', running: 'En cours', done: 'Fait'};

function fmtSince(ms){
  const m = Math.floor(ms / MIN);
  if(ms < 45000) return 'à l’instant';
  if(m < 1) return 'moins d’une minute';
  if(m < 60) return m + ' min';
  if(m < 1440) return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  return Math.floor(m / 1440) + ' j';
}
const ilya = (t) => { const s = fmtSince(Date.now() - t); return s === 'à l’instant' ? s : 'il y a ' + s; };
function modelName(m){
  if(!m) return 'Inconnu';
  const last = String(m).split('/').pop();
  const x = /^claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)$/.exec(last);
  if(x) return x[1][0].toUpperCase() + x[1].slice(1) + ' ' + x[2] + '.' + x[3];
  const g = /^gemini-([\d.]+)-(\w+)$/.exec(last);
  if(g) return 'Gemini ' + g[1] + ' ' + g[2][0].toUpperCase() + g[2].slice(1);
  return last;
}
const sinceOf = (d) => d.since != null ? d.since : d.updatedAt;

/* ------------------------------------------------------------ current state */
let STATE = null;
let sel = null;                 // agent id whose card is open
let filtreAttente = false, listeFermee = false, planOuvert = false, legendeOuverte = false;
let floorKey = null;            // project id of the floor being looked at ('' = « Sans projet »), null = whole building
let svcDown = false, stopArmed = false, opener = null;
const AG = new Map();           // agent id -> {d, team}

const el = {
  fiche: $('#fiche'), liste: $('#pListe'), detail: $('#pDetail'), plan: $('#pPlan'), legende: $('#pLegende'), bLegende: $('#bLegende'),
  bAttente: $('#bAttente'), bPlan: $('#bPlan'), bandeau: $('#bandeau'), toast: $('#toast'), annonce: $('#annonce'), vide: $('#videScene')
};
const im = () => window.Immeuble || null;
const call = (name, ...args) => { const o = im(); if(o && typeof o[name] === 'function'){ try{ return o[name](...args); }catch(err){ console.error(err); } } };

/* ------------------------------------------------------------ messages */
let toastTimer = 0, sayTimer = 0;
function toast(msg, err){
  el.toast.textContent = msg; el.toast.classList.toggle('err', !!err); el.toast.dataset.v = 'true';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.dataset.v = 'false'; }, err ? 5200 : 3200);
  el.annonce.textContent = ''; clearTimeout(sayTimer); sayTimer = setTimeout(() => { el.annonce.textContent = msg; }, 60);
}

/* ------------------------------------------------------------ derived data */
function indexAgents(st){
  AG.clear();
  for(const t of st.teams || []){
    const lots = new Map();
    if(t.mission) for(const l of t.mission.lots) if(l.agentId) lots.set(l.agentId, l);
    for(const d of t.agents){
      const l = lots.get(d.id);
      d.lot = l ? {title: l.title, state: l.state} : null;   // view-only: the bubble shows the agent's lot
      AG.set(d.id, {d, team: t});
    }
  }
}
function allWaiting(){
  const out = [];
  if(STATE) for(const t of STATE.teams) for(const d of t.agents) if(d.state === 'waiting') out.push({team: t, d});
  out.sort((p, q) => sinceOf(p.d) - sinceOf(q.d));
  return out;
}
/* the plan shown: the mission of the floor being looked at, else the latest one that waits for a validation */
function missionTeam(){
  if(!STATE) return null;
  const withMission = STATE.teams.filter((t) => t.mission);
  const rank = (list) => list.slice().sort((a, b) => (a.mission.status === 'proposed' ? 0 : 1) - (b.mission.status === 'proposed' ? 0 : 1) || b.mission.createdAt - a.mission.createdAt)[0] || null;
  if(floorKey != null){
    const here = rank(withMission.filter((t) => (t.projectId || '') === floorKey));
    if(here) return here;
  }
  const pending = withMission.filter((t) => t.mission.status === 'proposed').sort((a, b) => b.mission.createdAt - a.mission.createdAt);
  return pending[0] || null;
}
/* once the plan is open it stays on its team, so « Validé dans Bureau » shows after the click */
let planTeamId = null;
function shownTeam(){
  const t = planOuvert && planTeamId && STATE ? STATE.teams.find((x) => x.id === planTeamId && x.mission) : null;
  return t || missionTeam();
}
const projectLabel = (t) => t.projectName || 'Sans projet';

/* ------------------------------------------------------------ header and banner */
function refreshHeader(){
  const wc = STATE ? STATE.waitingCount : 0;
  const na = $('#nAttente'); na.hidden = !wc; na.textContent = wc;
  el.bAttente.setAttribute('aria-label', wc ? 'Qui m’attend, ' + plur(wc, 'agent', 'agents') : 'Qui m’attend');
  const mt = shownTeam();
  el.bPlan.hidden = !mt;
  el.bPlan.classList.toggle('plein', !!mt && mt.mission.status === 'proposed');
  el.bPlan.setAttribute('aria-pressed', String(planOuvert && !!mt));
}
function refreshBanner(){
  let txt = '', alerte = false;
  if(svcDown){ txt = 'Le service Bureau ne répond plus. Nouvelle tentative en cours.'; alerte = true; }
  else if(STATE && STATE.core === 'disconnected'){ txt = 'Bureau a perdu la connexion avec Boite. Ce que tu vois peut être ancien.'; alerte = true; }
  else if(STATE && STATE.core === 'connecting'){ txt = 'Connexion à Boite en cours.'; }
  el.bandeau.hidden = !txt; el.bandeau.textContent = txt; el.bandeau.classList.toggle('alerte', alerte);
}
function showEmpty(mode){
  el.vide.hidden = !mode;
  if(mode === 'aucune') el.vide.innerHTML = '<h2>Aucun agent au travail</h2><p>Lance <code>/mission</code> dans une conversation pour monter une équipe.</p>';
  else if(mode === 'attente') el.vide.innerHTML = '<h2>Connexion en cours</h2><p>' + (svcDown ? 'Le service Bureau ne répond pas. Nouvelle tentative en cours.' : 'Bureau lit l’état de Boite.') + '</p>';
}

/* ------------------------------------------------------------ card */
let sigs = {detail: '', liste: '', plan: ''};
function renderDetail(){
  const a = AG.get(sel); if(!a) return;
  const d = a.d, t = a.team;
  const par = d.parentId ? t.agents.find((x) => x.id === d.parentId) : null;
  const sup = d.parentId ? (par ? par.title : 'Inconnu') : 'Toi';
  const sig = JSON.stringify([d, sup, stopArmed]);
  if(sig === sigs.detail) return;
  const fresh = sigs.detail === '';
  sigs.detail = sig;
  $('#dNom').textContent = d.title || 'Sans titre';
  $('#dRole').textContent = (ROLE[d.role] || d.role) + (d.roleSource === 'guessed' ? ' (deviné)' : '');
  $('#dService').textContent = d.service || 'Non précisé';
  $('#dSup').textContent = sup;
  $('#dModele').textContent = modelName(d.model) + (d.provider ? ' (' + d.provider + ')' : '');
  const et = ETAT[d.state] || {lib: d.state, col: '#59627A'};
  $('#dEtat').textContent = et.lib; $('#dPastille').style.background = et.col;
  const since = sinceOf(d);
  $('#dDepuis').innerHTML = '<span data-since="' + since + '">' + esc(fmtSince(Date.now() - since)) + '</span>';
  const waiting = d.state === 'waiting';
  $('#dQuestion').hidden = !waiting;
  if(waiting) $('#dQuestionTexte').textContent = d.waitingFor === 'permission' ? 'Une autorisation : il demande si tu l’accordes.' : 'Une réponse : il te pose une question.';
  $('#dFichiers').innerHTML = d.files && d.files.length ? d.files.map((f) => '<li>' + esc(f) + '</li>').join('') : '<li>Aucun fichier attribué</li>';
  $('#dRapport').innerHTML = d.report && d.report.text
    ? '<div class="rapport" tabindex="0" role="region" aria-label="Dernier rapport">' + esc(d.report.text) + '</div><small>Déposé <span data-since="' + d.report.at + '" data-ilya="1">' + esc(ilya(d.report.at)) + '</span></small>'
    : 'Aucun rapport déposé';
  $('#bRep').hidden = !waiting;
  const stoppable = d.state === 'running' || d.state === 'queued' || waiting;
  const bs = $('#bStop'); bs.hidden = !stoppable; bs.textContent = stopArmed ? 'Confirmer l’arrêt' : 'Arrêter';
  if(fresh || !el.detail.dataset.id || el.detail.dataset.id !== d.id){ el.detail.dataset.id = d.id; call('portrait', $('#portrait'), d.id); }
}
function renderList(){
  const w = allWaiting();
  const b = $('#listeAttente');
  const sig = JSON.stringify(w.map((it) => [it.d.id, it.d.title, it.d.waitingFor, sinceOf(it.d), it.team.projectName, it.team.title]));
  if(sig === sigs.liste) return;
  sigs.liste = sig;
  if(!w.length){ b.innerHTML = '<p>Personne ne t’attend pour le moment.</p>'; return; }
  b.innerHTML = '';
  for(const it of w){
    const btn = document.createElement('button');
    btn.className = 'ligne-liste'; btn.type = 'button'; btn.dataset.id = it.d.id;
    const what = it.d.waitingFor === 'permission' ? 'Attend une autorisation' : 'Te pose une question';
    const since = sinceOf(it.d);
    btn.innerHTML = '<b>' + esc(it.d.title || 'Sans titre') + '</b><span>' + esc(what) + '</span><small>' + esc(projectLabel(it.team) + ', ') + '<span data-since="' + since + '">' + esc(fmtSince(Date.now() - since)) + '</span></small>';
    b.appendChild(btn);
  }
}
function renderPlan(){
  const t = shownTeam(), m = t && t.mission;
  if(!m) return;
  const sig = JSON.stringify([m, t.title, t.projectName, t.agents.map((x) => [x.id, x.title])]);
  if(sig === sigs.plan) return;
  sigs.plan = sig;
  $('#planResume').textContent = projectLabel(t) + '. ' + (m.title ? m.title + '. ' : '') + (m.summary || '');
  const bud = [];
  if(m.budget && m.budget.maxAgents != null) bud.push('Budget : ' + plur(m.budget.maxAgents, 'agent', 'agents') + ' au plus.');
  if(m.budget && m.budget.models && m.budget.models.length) bud.push('Modèles autorisés : ' + m.budget.models.map(modelName).join(', ') + '.');
  $('#planBudget').textContent = bud.join(' ');
  $('#planBudget').hidden = !bud.length;
  const proposed = m.status === 'proposed';
  $('#planCorps').innerHTML = m.lots.map((l) => {
    const ag = l.agentId ? t.agents.find((x) => x.id === l.agentId) : null;
    const pending = proposed && l.state === 'todo';
    const agTxt = l.agentId ? 'Agent : ' + (ag ? ag.title : 'introuvable') : 'Pas encore lancé';
    return '<tr class="' + (pending ? 'a-valider' : '') + '"><td>' + esc(l.title) + '<span class="sup">' + esc(l.service) + '</span><span class="sup">' + esc(agTxt) + '</span></td><td>' + esc(modelName(l.model)) + '</td><td>' + (pending ? 'À valider' : esc(LOT_ETAT[l.state] || l.state)) + '</td></tr>';
  }).join('');
  const bv = $('#bValider'), note = $('#planNote');
  bv.hidden = !proposed; bv.disabled = false; note.className = '';
  if(proposed) note.textContent = 'Le chef de projet attend ta validation avant de lancer les lots.';
  else if(m.status === 'done') note.textContent = 'Mission terminée.';
  else { note.className = 'ok'; note.textContent = m.validatedVia === 'chat' ? 'Validé dans le chat' : 'Validé dans Bureau'; }
}
let lastMode = 'vide';
function showPanel(){
  const mode = sel != null ? 'detail' : planOuvert ? 'plan' : (filtreAttente && !listeFermee) ? 'liste' : legendeOuverte ? 'legende' : 'vide';
  el.liste.hidden = mode !== 'liste'; el.detail.hidden = mode !== 'detail'; el.plan.hidden = mode !== 'plan'; el.legende.hidden = mode !== 'legende';
  el.bLegende.setAttribute('aria-pressed', String(mode === 'legende'));
  el.fiche.hidden = mode === 'vide';
  if(mode !== lastMode){ sigs = {detail: '', liste: '', plan: ''}; el.detail.dataset.id = ''; lastMode = mode; }
  if(mode === 'detail') renderDetail();
  if(mode === 'liste') renderList();
  if(mode === 'plan') renderPlan();
  return mode;
}
function refreshUI(){
  if(planOuvert && !shownTeam()) planOuvert = false;
  if(sel != null && !AG.has(sel)){ sel = null; stopArmed = false; call('selectionner', null); }
  refreshHeader(); refreshBanner();
  showPanel();
  call('filtrerAttente', filtreAttente);
}
function focusHeading(id){
  setTimeout(() => { const h = $(id); if(h && !el.fiche.hidden) h.focus({preventScroll: true}); }, 30);
}
function ouvrir(id){
  if(!AG.has(id)) return;
  if(!opener && document.activeElement && document.activeElement.tagName === 'BUTTON' && !el.fiche.contains(document.activeElement)) opener = document.activeElement;
  sel = id; planOuvert = false; stopArmed = false; sigs.detail = '';
  refreshUI();
  call('selectionner', id);
  focusHeading('#dNom');
}
function fermer(){
  if(sel != null){ sel = null; stopArmed = false; call('selectionner', null); }
  else if(planOuvert){ planOuvert = false; }
  else if(filtreAttente && !listeFermee){ listeFermee = true; }
  else if(legendeOuverte){ legendeOuverte = false; }
  refreshUI();
  if(opener && document.contains(opener) && !el.fiche.contains(opener) && opener.offsetParent !== null) opener.focus({preventScroll: true});
  opener = null;
}
const panelOpen = () => sel != null || planOuvert || (filtreAttente && !listeFermee) || legendeOuverte;
document.querySelectorAll('[data-fermer]').forEach((b) => b.addEventListener('click', fermer));
$('#listeAttente').addEventListener('click', (ev) => { const b = ev.target.closest('[data-id]'); if(b){ opener = el.bAttente; ouvrir(b.dataset.id); } });
/* Escape closes the card first; a second press is the engine's (back to the whole building) */
document.addEventListener('keydown', (ev) => {
  if(ev.key === 'Escape' && panelOpen() && !ev.defaultPrevented){ ev.stopPropagation(); ev.preventDefault(); fermer(); }
}, true);

el.bAttente.addEventListener('click', () => {
  filtreAttente = !filtreAttente; listeFermee = false;
  el.bAttente.setAttribute('aria-pressed', String(filtreAttente));
  if(filtreAttente) planOuvert = false;
  sigs.liste = '';
  refreshUI();
  if(filtreAttente && sel == null) focusHeading('#listeTitre');
});
el.bLegende.addEventListener('click', () => {
  const open = !(legendeOuverte && showPanel() === 'legende');
  if(open){ opener = el.bLegende; if(sel != null){ sel = null; call('selectionner', null); } planOuvert = false; if(filtreAttente) listeFermee = true; }
  legendeOuverte = open;
  refreshUI();
  if(open) focusHeading('#legendeTitre');
});
el.bPlan.addEventListener('click', () => {
  planOuvert = !planOuvert; planTeamId = null;
  if(planOuvert){ const t = missionTeam(); planTeamId = t ? t.id : null; if(sel != null){ sel = null; call('selectionner', null); } }
  sigs.plan = '';
  refreshUI();
  if(planOuvert) focusHeading('#planTitre');
});

/* ------------------------------------------------------------ actions */
async function post(path, body){
  let r;
  try{
    r = await fetch(path, {method: 'POST', headers: {'X-Bureau': '1', 'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  }catch(err){ throw new Error('Le service Bureau ne répond pas.'); }
  if(!r.ok){
    let m = '';
    try{ const j = await r.json(); m = j && (j.error || j.message) || ''; }catch(err){ /* empty body */ }
    throw new Error(typeof m === 'string' && m ? m : 'Le service a refusé la demande (code ' + r.status + ').');
  }
  try{ return await r.json(); }catch(err){ return {}; }
}
async function busy(btn, fn){
  btn.disabled = true;
  try{ await fn(); }catch(err){ toast(err && err.message ? err.message : 'Action impossible.', true); }
  finally{ btn.disabled = false; }
}
function reveal(btn){
  const a = AG.get(sel); if(!a) return;
  busy(btn, async () => { await post('/api/reveal', {threadId: a.d.id}); toast('Conversation de ' + (a.d.title || 'l’agent') + ' ouverte dans Boite.'); });
}
$('#bConv').addEventListener('click', function(){ reveal(this); });
$('#bRep').addEventListener('click', function(){ reveal(this); });
let stopTimer = 0;
$('#bStop').addEventListener('click', function(){
  const a = AG.get(sel); if(!a) return;
  if(!stopArmed){
    stopArmed = true; this.textContent = 'Confirmer l’arrêt';
    clearTimeout(stopTimer); stopTimer = setTimeout(() => { stopArmed = false; this.textContent = 'Arrêter'; sigs.detail = ''; }, 3500);
    return;
  }
  clearTimeout(stopTimer); stopArmed = false; this.textContent = 'Arrêter';
  busy(this, async () => { await post('/api/stop', {threadId: a.d.id}); toast('Arrêt demandé pour ' + (a.d.title || 'l’agent') + '.'); await loadState(); });
});
$('#bValider').addEventListener('click', function(){
  const t = shownTeam(); if(!t) return;
  busy(this, async () => {
    await post('/api/missions/' + encodeURIComponent(t.mission.id) + '/validate', {});
    toast('Plan validé : le chef de projet est prévenu.');
    await loadState();
  });
});

/* ------------------------------------------------------------ state */
/* An archived conversation is gone from the state: the scene walks its agent out by the front door; we say it too. */
let archivesSeen = null;
function noteArchives(st){
  const list = st.archives || [];
  if(archivesSeen === null){ archivesSeen = new Set(list.map((n) => n.threadId + '|' + n.at)); return; }
  for(const n of [...list].reverse()){
    const key = n.threadId + '|' + n.at;
    if(archivesSeen.has(key)) continue;
    archivesSeen.add(key);
    toast((n.title || 'Sans titre') + ' part : conversation archivée (' + n.reason + ').');
  }
}
function applyState(st){
  STATE = st;
  noteArchives(st);
  indexAgents(st);
  showEmpty((st.teams || []).length ? null : 'aucune');
  bind();
  call('etat', st);
  refreshUI();
}

/* ------------------------------------------------------------ scene hooks */
let bound = null;
function bind(){
  const o = im();
  if(!o || bound === o) return;
  bound = o;
  o.surClicAgent = (id) => { if(AG.has(id)) ouvrir(id); };
  o.surEtage = (pid) => { floorKey = pid == null ? null : String(pid); planTeamId = null; refreshHeader(); if(planOuvert) refreshUI(); };
}

/* ------------------------------------------------------------ service link */
let es = null, backoff = 1000;
function setDown(v){ if(svcDown !== v){ svcDown = v; refreshBanner(); if(!STATE) showEmpty('attente'); } }
async function loadState(){
  try{
    const r = await fetch('/api/state', {cache: 'no-store'});
    if(!r.ok) throw new Error('state');
    const st = await r.json();
    setDown(false); applyState(st);
  }catch(err){ setDown(true); }
}
function connect(){
  try{ es = new EventSource('/api/events'); }catch(err){ setDown(true); setTimeout(connect, backoff); return; }
  es.addEventListener('open', () => { backoff = 1000; setDown(false); });
  es.addEventListener('state', (ev) => { let st; try{ st = JSON.parse(ev.data); }catch(err){ return; } setDown(false); applyState(st); });
  es.addEventListener('error', () => {
    setDown(true);
    if(es && es.readyState === 2){
      es.close(); es = null;
      setTimeout(() => { connect(); loadState(); }, backoff);
      backoff = Math.min(backoff * 2, 10000);
    }
  });
}
setInterval(() => {
  document.querySelectorAll('[data-since]').forEach((n) => {
    const t0 = Number(n.dataset.since);
    n.textContent = n.dataset.ilya ? ilya(t0) : fmtSince(Date.now() - t0);
  });
}, 5000);
setInterval(() => { if(!es || es.readyState !== 1) loadState(); }, 15000);

bind();
showEmpty('attente');
loadState();
connect();
})();
