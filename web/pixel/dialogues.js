/*
 * Conversation texts of the pixel view: the catalogue of docs/vue-pixel.md 1.10 and 1.11 and the rules
 * that pick and fill a line (1.7, 1.8, 1.9). Lot L5 (pure part), contract in 2.6.
 * PURE: no DOM, no other file of web/pixel, no clock or random source of its own (the caller gives `now`
 * and the seed). Shares one scope with the other web/pixel files: the public names are CATALOG,
 * cleanValue, modelShort, formatDuration, buildVars and pickLines, every other top-level name is
 * prefixed `dlg`. Declares only, nothing runs at load. The catalogue is written with its real accents
 * (the file is UTF-8); the character classes of the code are written with escapes.
 *
 * ctx = { event, agent, other, team, lot, now } plain objects (OfficeEvent, OfficeAgent, Team, Lot of
 * src/model.ts). Where 2.6 leaves room, this file decides:
 *  - Who is `agent` and `other`. Events: `agent` is the thread of the event (a departed one: the last
 *    OfficeAgent the view kept; null is tolerated, the title then comes from `event.title`), `other` the
 *    interlocutor (the delegator for `delegate`, the receiver for `report`/`blocked`, a colleague for
 *    `arrive`/`depart`, the first manager for `plan`, null alone). Chat: `agent` speaks first, `other`
 *    answers, `event` is null.
 *  - Two optional ctx fields: `third` (plan only: the second manager, who speaks the `c` cells; without
 *    it `c` is not played) and `otherLot` (chat only: the lot of `other`, searched in team.mission.lots
 *    by agentId when absent). `lot` null or absent: the lot is looked up in `team.mission.lots` (by
 *    event.lotId, then by agentId), a lookup in the given objects, never in the page.
 *  - `{manager}`: the parent is the thread of `agent.parentId` (else event.fromId, toId or parentId),
 *    found in `team.agents` or in `other`; unknown parent: no value.
 *  - `{rapport}` has no value for a `report` event with hasReport false (the stored report is an older one).
 *  - `{nlots}` has no value for an empty lot list and is capped at 99 (max 2 characters).
 *  - `{agent}` falls back to "Agent" when the title cleans to nothing (it always has a value).
 *  - Plan: `{service}` is the service of the manager who speaks (`other` for b, `third` for c, the agent
 *    itself for a).
 *  - Cells played: `a` always; `b` only with an interlocutor; `c` only with `third`; an empty cell is
 *    skipped. A line whose played cells need a variable without value is excluded.
 *  - Chat: `pickLines('chat', ...)` draws an opener from CATALOG.chatter (`si` = state of `other`, variables
 *    from the speaker) and a reply from CATALOG.reply (`si` = state of `other`, variables from `other`'s
 *    side). Both ids go to `recent`. Without `other`, only the opener.
 *  - `recent`: only its last 8 ids count and it is trimmed to 8 after the draw. When nothing is eligible
 *    (all excluded or recent) the answer is null: the posture alone tells the story.
 *  - A value that ends with punctuation and sits before `.,:;!?` in the text loses its own end, so a
 *    lot titled "Fix bug." does not give "Fix bug..".
 */

/** One catalogue line: `si` is '*' or a state, phase or reason; a, b, c are the texts of the speakers ('' = silent). */
function dlgE(id, si, a, b = '', c = '') {
  return { id, si, a, b, c };
}

const CATALOG = {
  delegate: [
    dlgE('d01', '*', 'Le lot {lotid} est pour toi : {lot}.', 'Reçu, je lis le fichier d\'échange.'),
    dlgE('d02', '*', 'Ton lot : {lot}. Bonne chance.', 'Merci, je commence tout de suite.'),
    dlgE('d03', '*', 'Tu touches à {fichiers}, rien d\'autre.', 'Compris, seulement {fichiers}.'),
    dlgE('d04', '*', 'Je te confie {lot}, sans stress.', 'Merci, je te fais un rapport propre.'),
    dlgE('d05', '*', 'Nouveau lot {lotid}, tu tournes sur {modele}.', 'Parfait, {modele} suffit pour ça.'),
    dlgE('d06', '*', '{agent}, j\'ai une tâche pour toi.', 'Je t\'écoute, je lève les yeux.'),
    dlgE('d07', '*', 'Dis-moi vite si tu bloques.', 'Promis, je te préviens.'),
    dlgE('d08', '*', 'Je te donne {lotid} sur {projet}.', 'Reçu, je m\'installe et j\'attaque.'),
    dlgE('d09', '*', 'L\'équipe {service} compte sur toi.', 'Je ne vous décevrai pas.'),
    dlgE('d10', '*', 'On a un nouveau lot à lancer.', 'Je suis sur le coup.'),
  ],
  report: [
    dlgE('r01', '*', 'Rapport : {rapport}', 'Bien, je relis ça tout de suite.'),
    dlgE('r02', '*', 'J\'ai fini {lot} en {duree}.', 'Super, pose le dossier ici.'),
    dlgE('r03', '*', 'Lot {lotid} rendu, tout est vérifié.', 'Merci, je relis le diff ligne à ligne.'),
    dlgE('r04', '*', 'Voilà mon rapport, {duree} de travail.', 'Parfait, je vérifie de mon côté.'),
    dlgE('r05', '*', 'C\'est fait, tout est dans {fichiers}.', 'Je regarde ça, beau travail.'),
    dlgE('r06', '*', 'Terminé, il reste peu de choses.', 'Note-les dans le rapport, merci.'),
    dlgE('r07', '*', 'Mon rapport est prêt.', 'Je le lis et je valide le lot.'),
    dlgE('r08', '*', 'Résultat : {rapport}', 'Merci, je marque {lotid} comme fini.'),
  ],
  blocked: [
    dlgE('b01', '*', 'Ça plante, je n\'avance plus !', 'Je viens voir ton écran.'),
    dlgE('b02', '*', 'Erreur sur {lot}, à l\'aide !', 'J\'arrive, ne touche à rien.'),
    dlgE('b03', '*', 'Ça bloque depuis {duree}.', 'Montre-moi l\'erreur, on regarde.'),
    dlgE('b04', '*', 'Mon tour s\'est arrêté sur une erreur.', 'Relance-le, je reste à côté.'),
    dlgE('b05', '*', 'J\'ai cassé quelque chose dans {fichiers}.', 'On regarde ça ensemble.'),
    dlgE('b06', '*', 'Rouge partout, {manager}, tu peux venir ?', 'Je suis là, respire un coup.'),
    dlgE('b07', '*', 'Je ne comprends pas cette erreur.', 'Moi non plus, voyons ça.'),
    dlgE('b08', '*', '{modele} cale sur ce problème.', 'On essaie autre chose, viens.'),
  ],
  waiting: [
    dlgE('w01', '*', 'J\'attends ta réponse depuis {duree}.'),
    dlgE('w02', 'permission', 'Je demande la permission de continuer.'),
    dlgE('w03', 'question', 'Une question pour toi sur {lot}.'),
    dlgE('w04', '*', 'Je n\'avance plus sans ta réponse.'),
    dlgE('w05', 'permission', 'Une autorisation et je repars.'),
    dlgE('w06', '*', 'Eh, ça fait {duree} que je lève la main !'),
    dlgE('w07', 'question', 'Peux-tu répondre à ma question ?'),
    dlgE('w08', '*', 'Quelqu\'un peut me débloquer ?'),
    dlgE('w09', 'permission', 'Cette commande a besoin de ton accord.'),
  ],
  plan: [
    dlgE('p01', 'validated', 'Le plan est validé, on y va !', 'Je lance mes agents.', 'Mes briefs sont prêts.'),
    dlgE('p02', 'validated', '{nlots} lots à lancer pour {mission}.', 'Je prends les miens, chef.', 'Moi aussi, je m\'organise.'),
    dlgE('p03', 'validated', 'Le plan est validé, vous pouvez lancer.', 'Parfait, je découpe mon lot.', 'Je prépare les fichiers.'),
    dlgE('p04', 'validated', 'Réunion courte : qui prend quoi ?', '{service}, ça me va.', 'Je m\'occupe du reste.'),
    dlgE('p05', 'validated', 'Plan validé sur {projet}, au travail !', 'Compris, chef.', 'On s\'y met.'),
    dlgE('p06', 'validated', 'C\'est parti pour {mission}.', 'Mes agents arrivent, chef.', 'Je démarre dans la minute.'),
    dlgE('p07', 'validated', 'Respectez le budget, un agent par lot.', 'Compris, un agent par lot.', 'Reçu, pas de dépassement.'),
    dlgE('p08', 'validated', 'On valide, on lance, on rapporte.', 'Dans cet ordre, chef.', 'Je prépare mes rapports.'),
    dlgE('q01', 'proposed', 'Le plan attend ta validation.'),
    dlgE('q02', 'proposed', '{nlots} lots prévus, à toi de valider.'),
    dlgE('q03', 'proposed', 'Je ne lance rien sans ton feu vert.'),
    dlgE('q04', 'proposed', 'Plan prêt : {mission}.'),
    dlgE('q05', 'proposed', 'Un clic sur Valider le plan et on démarre.'),
    dlgE('q06', 'proposed', 'Voici le plan, dis-moi s\'il te convient.'),
    dlgE('f01', 'done', 'Mission terminée, bravo à tous !', 'Beau travail, chef.', 'On a tenu le plan.'),
    dlgE('f02', 'done', '{mission} est livrée.', 'On a tenu le plan.', 'Quelle équipe !'),
    dlgE('f03', 'done', 'Les {nlots} lots sont rendus.', 'Tout est vérifié de notre côté.', 'Plus qu\'à fêter ça.'),
    dlgE('f04', 'done', 'Fin de mission, un café pour tous ?', 'Je prends un double.', 'Je paie ma tournée.'),
    dlgE('f05', 'done', 'Merci pour le travail sur {projet}.', 'Avec plaisir, chef.', 'À la prochaine mission.'),
    dlgE('f06', 'done', 'Tout est livré, je rends compte.', 'Merci, chef.', 'On souffle un peu.'),
  ],
  arrive: [
    dlgE('v01', '*', 'Bonjour, je suis {agent}.', 'Bienvenue, installe-toi.'),
    dlgE('v02', '*', 'Me voilà, l\'ascenseur est lent.', 'Ton bureau est au fond.'),
    dlgE('v03', '*', 'Je rejoins l\'équipe {service}.', 'Bienvenue dans l\'équipe.'),
    dlgE('v04', '*', 'Salut, quel est mon bureau ?', 'Le premier libre, en face.'),
    dlgE('v05', '*', 'Je démarre sur {projet} aujourd\'hui.', 'Bon courage, ça bouge ici.'),
    dlgE('v06', '*', 'Me voilà, je prends mes quartiers.', 'Le café est au fond du couloir.'),
    dlgE('v07', '*', '{agent} au rapport, on commence ?', 'Pose tes affaires, on y va.'),
    dlgE('v08', '*', 'Quelqu\'un m\'a demandé ?', 'Oui, {manager} te cherche.'),
  ],
  depart: [
    dlgE('x01', '*', 'Ma journée est finie, bonne soirée.', 'Merci pour tout, à bientôt.'),
    dlgE('x02', '*', 'Je rends mon badge et je file.', 'Bon retour, prends l\'ascenseur.'),
    dlgE('x03', '*', 'Plus rien à faire ici, je pars.', 'Merci pour {lot}, c\'était propre.'),
    dlgE('x04', 'archived', 'Mon fil est archivé, au revoir.', 'Salut, ton bureau reste au chaud.'),
    dlgE('x05', 'gone', 'On m\'a retiré de la liste, salut !', 'Déjà ? À la prochaine.'),
    dlgE('x06', '*', 'Je sors par la grande porte.', 'À la prochaine !'),
    dlgE('x07', '*', 'J\'ai donné tout ce que j\'avais.', 'Merci, tu as bien travaillé.'),
    dlgE('x08', 'archived', 'On m\'envoie aux archives, à plus !', 'Repose-toi bien.'),
    dlgE('x09', 'gone', 'Mon fil a disparu, je m\'en vais.', 'Étrange, mais bon voyage.'),
  ],
  answered: [
    dlgE('n01', '*', 'Merci, je reprends mon travail.'),
    dlgE('n02', '*', 'Réponse reçue, ça repart.'),
    dlgE('n03', '*', 'Parfait, je continue sur {lot}.'),
    dlgE('n04', '*', 'Compris, je termine ça.'),
    dlgE('n05', '*', 'Super, plus qu\'à taper.'),
    dlgE('n06', '*', 'Merci, j\'avais besoin de ça.'),
  ],
  // Chatter openers (1.11): `si` is the state of the interlocutor.
  chatter: [
    dlgE('c01', '*', 'Ça fait du bien, cette pause.'),
    dlgE('c02', '*', 'Déjà {heure} ? Le temps file.'),
    dlgE('c03', '*', 'Le café de la machine est toujours aussi fort.'),
    dlgE('c04', '*', 'Sur {projet}, ça avance bien, non ?'),
    dlgE('c05', '*', 'Tu bosses sur quoi en ce moment ?'),
    dlgE('c06', '*', 'De mon côté, je suis sur {lot_moi}.'),
    dlgE('c07', '*', 'Moi, je tourne sur {modele_moi}. Et toi ?'),
    dlgE('c08', '*', 'Cette plante a l\'air d\'avoir soif.'),
    dlgE('c09', '*', 'Regarde par la fenêtre, la ville bouge.'),
    dlgE('c10', '*', 'La fontaine à eau, c\'est une bonne invention.'),
    dlgE('c11', '*', 'L\'imprimante bloque encore, je crois.'),
    dlgE('c12', '*', 'Je m\'étire cinq minutes et je repars.'),
    dlgE('c13', '*', 'L\'ascenseur met une éternité, non ?'),
    dlgE('c14', '*', 'J\'ai déjà {duree_moi} sur ma tâche.'),
    dlgE('c15', 'running', 'Alors, {lot_toi} avance bien ?'),
    dlgE('c16', 'running', 'Tu tapes depuis {duree_toi}, fais une pause.'),
    dlgE('c17', 'waiting', 'Tu attends toujours une réponse ?'),
    dlgE('c18', 'waiting', 'Ça fait {duree_toi} que tu attends, non ?'),
    dlgE('c19', 'error', 'Ton erreur, tu l\'as réglée ?'),
    dlgE('c20', 'error', 'Courage, ça arrive à tout le monde.'),
    dlgE('c21', 'done', 'Bravo pour ton rapport, {toi}.'),
    dlgE('c22', 'done', 'Tu as fini ? Tu as de la chance !'),
    dlgE('c23', 'queued', 'Tu es en file, ton tour arrive.'),
    dlgE('c24', 'idle', 'Tu es en pause, toi aussi ?'),
    dlgE('c25', '*', '{service_toi}, ça se passe comment ?'),
    dlgE('c26', '*', 'Tu tournes sous {modele_toi}, c\'est agréable ?'),
    dlgE('c27', '*', 'Ça te dirait un autre café ?'),
    dlgE('c28', '*', 'Tu as lu le dernier rapport ?'),
    dlgE('c29', '*', 'On se retrouve au tableau blanc plus tard ?'),
    dlgE('c30', '*', 'Un jour, on aura un balcon plus grand.'),
  ],
  // Chatter replies (1.11): `si` is the state of the one who answers; the text is in `b`.
  reply: [
    dlgE('y01', '*', '', 'Ha oui, tu as raison.'),
    dlgE('y02', '*', '', 'Ça me fait sourire.'),
    dlgE('y03', '*', '', 'Exactement ce que je pensais.'),
    dlgE('y04', '*', '', 'Belle journée, en tout cas.'),
    dlgE('y05', '*', '', 'Allez, on s\'y remet bientôt !'),
    dlgE('y06', '*', '', 'Possible, je n\'y avais pas pensé.'),
    dlgE('y07', 'running', '', 'Oui, ça tape bien, merci.'),
    dlgE('y08', 'running', '', 'Dans le dur, mais ça passe.'),
    dlgE('y09', 'waiting', '', 'J\'attends une réponse, rien d\'autre.'),
    dlgE('y10', 'waiting', '', 'Toujours rien, je patiente.'),
    dlgE('y11', 'error', '', 'Une erreur têtue, mais je m\'accroche.'),
    dlgE('y12', 'error', '', 'Merci, je vais y arriver.'),
    dlgE('y13', 'done', '', 'Oui, rapport rendu, je souffle.'),
    dlgE('y14', 'done', '', 'Tout est livré, je me repose.'),
    dlgE('y15', 'idle', '', 'Je recharge, comme toi.'),
    dlgE('y16', 'queued', '', 'Mon tour arrive, j\'ai hâte.'),
    dlgE('y17', '*', '', 'On en reparle autour d\'un café.'),
  ],
};

/** Genres played by an event, in the order of 1.5. */
const dlgEventKinds = ['delegate', 'report', 'blocked', 'waiting', 'plan', 'arrive', 'depart', 'answered'];

/** Own copies of the engine helpers: this file loads alone. */
function dlgClamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 32-bit integer mix of a number and a salt: the same inputs always give the same draw. */
function dlgHash(n, salt) {
  let h = (Math.floor(n) | 0) ^ Math.imul((salt | 0) + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A seed as an integer: numbers as they are, strings folded, anything else 0. */
function dlgSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(seed);
  if (typeof seed === 'string') {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return h | 0;
  }
  return 0;
}

// Everything the font draws that a value may keep once cleaned: letters, digits, accents, space and 1.9 punctuation.
const dlgForeign = /[^A-Za-z0-9\u00e9\u00e8\u00ea\u00e0\u00e2\u00e7\u00f4\u00fb\u00f9\u00ee\u00ef\u00c9\u00c8\u00ca\u00c0\u00c7.,:;!?'()\/+% -]/gu;

/** 1.8 "motSur": makes any user text safe for a bubble and cuts it to `max` characters. */
function cleanValue(text, max) {
  let s = text == null ? '' : String(text);
  s = s
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\u2019/g, "'")
    .replace(/[\u00ab\u00bb]/g, '')
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'Oe')
    .replace(/\u00eb/g, 'e')
    .replace(/\u00fc/g, 'u');
  s = s.replace(dlgForeign, (ch) => (/\s/u.test(ch) ? ' ' : ''));
  s = s.replace(/ {2,}/g, ' ').trim();
  if (typeof max === 'number' && max > 0 && s.length > max) {
    let cut = s.slice(0, max);
    if (s[max] !== ' ') {
      const i = cut.lastIndexOf(' ');
      if (i >= 8) cut = cut.slice(0, i);
    }
    s = cut;
  }
  return s.replace(/[ ,:;('-]+$/, '');
}

/** 'claude-sonnet-5-5' gives 'Sonnet 5.5'; a model that is not a Claude id stays as it is. Null when unknown. */
function modelShort(model) {
  if (typeof model !== 'string') return null;
  let m = model.trim();
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1);
  if (!m) return null;
  if (!m.startsWith('claude-')) return m;
  m = m.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  let family = '';
  let version = '';
  let x = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(m);
  if (x) {
    family = x[1];
    version = x[3] !== undefined ? x[2] + '.' + x[3] : x[2];
  } else {
    x = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)$/.exec(m);
    if (!x) return m;
    family = x[3];
    version = x[2] !== undefined ? x[1] + '.' + x[2] : x[1];
  }
  return family.charAt(0).toUpperCase() + family.slice(1) + ' ' + version;
}

/** '45 s', '12 min', '2 h 05'. Negative or unusable input counts as 0. */
function formatDuration(ms) {
  const s = Math.floor(dlgClamp(typeof ms === 'number' && Number.isFinite(ms) ? ms : 0, 0, Infinity) / 1000);
  if (s < 60) return s + ' s';
  const min = Math.floor(s / 60);
  if (min < 60) return min + ' min';
  const r = min % 60;
  return Math.floor(min / 60) + ' h ' + (r < 10 ? '0' : '') + r;
}

/** A cleaned value, or null when nothing is left of it. */
function dlgOpt(text, max) {
  const v = cleanValue(text, max);
  return v === '' ? null : v;
}

/** First file of the list; a long path loses its beginning, folder by folder. */
function dlgFile(file, max) {
  if (typeof file !== 'string') return null;
  const parts = file.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return null;
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const cand = parts[i] + '/' + out;
    if (cand.length > max) break;
    out = cand;
  }
  return out;
}

/** First sentence of a report, markdown marks removed: up to ". " or the end of the line. A heading is skipped when other text exists. */
function dlgSentence(text) {
  if (typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let line = lines.find((l) => !l.startsWith('#')) ?? lines[0] ?? '';
  line = line.replace(/^(?:\s*(?:[#>]+|[-*+]\s|\d+[.)]\s))+\s*/, '');
  line = line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .replace(/(^|[\s(])_+|_+(?=$|[\s.,;:!?)])/g, '$1');
  const i = line.indexOf('. ');
  if (i >= 0) line = line.slice(0, i);
  return line.replace(/\.+$/, '').trim();
}

/** The lot of an agent: by id first, then by the agent it is given to. */
function dlgFindLot(team, lotId, agentId) {
  const lots = team && team.mission && team.mission.lots;
  if (!Array.isArray(lots)) return null;
  return (lotId && lots.find((l) => l.id === lotId)) || (agentId && lots.find((l) => l.agentId === agentId)) || null;
}

function dlgNow(ctx) {
  return typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now();
}

/** '14 h 20', local time. */
function dlgClock(now) {
  const d = new Date(now);
  const m = d.getMinutes();
  return d.getHours() + ' h ' + (m < 10 ? '0' : '') + m;
}

/** Model of an agent, else the model its lot plans ('claude/claude-haiku-5-5'). */
function dlgModel(agent, lot) {
  return dlgOpt(modelShort(agent && agent.model) || modelShort(lot && lot.model), 14);
}

/** Time since the start of the agent's current request, or null at rest. */
function dlgSince(agent, now) {
  return agent && typeof agent.since === 'number' ? dlgOpt(formatDuration(now - agent.since), 8) : null;
}

/** 1.8: the thread above the event's agent, said the way a colleague would. */
function dlgManager(ctx) {
  const ev = ctx.event || null;
  const ag = ctx.agent || null;
  const pid = (ag && ag.parentId) || (ev && (ev.fromId || ev.toId || ev.parentId)) || null;
  if (!pid) return null;
  const agents = ctx.team && Array.isArray(ctx.team.agents) ? ctx.team.agents : [];
  const parent = agents.find((a) => a.id === pid) || (ctx.other && ctx.other.id === pid ? ctx.other : null);
  if (!parent) return null;
  if (parent.role === 'chef') return 'le chef';
  const service = dlgOpt(parent.service, 14);
  return parent.role === 'manager' && service ? dlgOpt('le manager ' + service, 26) : 'mon manager';
}

function dlgEventVars(ctx) {
  const ev = ctx.event || null;
  const ag = ctx.agent || null;
  const team = ctx.team || null;
  const now = dlgNow(ctx);
  const lot = ctx.lot || dlgFindLot(team, ev && ev.lotId, (ev && ev.agentId) || (ag && ag.id));
  const mission = team && team.mission ? team.mission : null;
  const isPlan = ev && ev.kind === 'plan';
  const service = isPlan ? ctx.other && ctx.other.service : ag && ag.service;

  let duree = null;
  if (ev && ev.kind === 'report') {
    const end = ag && ag.report ? ag.report.at : ev.at;
    if (ag && typeof ag.createdAt === 'number' && typeof end === 'number') duree = dlgOpt(formatDuration(end - ag.createdAt), 8);
  } else {
    duree = dlgSince(ag, now);
  }

  let rapport = null;
  if (ag && ag.report && !(ev && ev.kind === 'report' && ev.hasReport === false)) rapport = dlgOpt(dlgSentence(ag.report.text), 34);

  const waitingFor = (ev && ev.waitingFor) || (ag && ag.state === 'waiting' ? ag.waitingFor : null);
  const nlots = mission && Array.isArray(mission.lots) && mission.lots.length > 0 ? String(dlgClamp(mission.lots.length, 1, 99)) : null;

  return {
    agent: dlgOpt(ev ? ev.title : ag && ag.title, 20) || 'Agent',
    manager: dlgManager(ctx),
    service: dlgOpt(service, 14),
    lot: dlgOpt(lot && lot.title, 28),
    lotid: dlgOpt(lot && lot.id, 6),
    modele: dlgModel(ag, lot),
    duree,
    fichiers: ag && Array.isArray(ag.files) && ag.files.length > 0 ? dlgOpt(dlgFile(ag.files[0], 24), 24) : null,
    rapport,
    attente: waitingFor === 'permission' ? 'une permission' : waitingFor === 'question' ? 'une réponse' : null,
    projet: dlgOpt(team && team.projectName, 20),
    mission: dlgOpt(mission && mission.title, 26),
    nlots,
    heure: dlgClock(now),
  };
}

/** Chatter variables, from the side of the speaker (`agent`) towards `other`. */
function dlgChatVars(ctx) {
  const me = ctx.agent || null;
  const you = ctx.other || null;
  const team = ctx.team || null;
  const now = dlgNow(ctx);
  const lotMe = ctx.lot || dlgFindLot(team, null, me && me.id);
  const lotYou = ctx.otherLot || dlgFindLot(team, null, you && you.id);
  return {
    toi: dlgOpt(you && you.title, 20) || 'collègue',
    lot_moi: dlgOpt(lotMe && lotMe.title, 28),
    lot_toi: dlgOpt(lotYou && lotYou.title, 28),
    modele_moi: dlgModel(me, lotMe),
    modele_toi: dlgModel(you, lotYou),
    duree_moi: dlgSince(me, now),
    duree_toi: dlgSince(you, now),
    service_toi: dlgOpt(you && you.service, 14),
    projet: dlgOpt(team && team.projectName, 20),
    heure: dlgClock(now),
  };
}

/**
 * The values of every variable of 1.8 for a conversation; null where the variable has no value.
 * `kind` 'chat' gives the chatter set (relative to `ctx.agent`), any event kind the event set.
 */
function buildVars(kind, ctx) {
  const c = ctx || {};
  return kind === 'chat' ? dlgChatVars(c) : dlgEventVars(c);
}

/** The text of one cell with its variables filled; null when a variable has no value. */
function dlgFill(template, vars) {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (m, name, at) => {
    const v = vars[name];
    if (v == null || v === '') {
      missing = true;
      return '';
    }
    if (/[.,:;!?]/.test(template.charAt(at + m.length))) {
      const t = v.replace(/[.,:;!?]+$/, '');
      if (t !== '') return t;
    }
    return v;
  });
  return missing ? null : text;
}

/** The `si` value an event is matched on: a waiting reason, a plan phase, a departure reason. */
function dlgSi(kind, ctx) {
  const ev = ctx.event || null;
  if (kind === 'waiting') return (ev && ev.waitingFor) || (ctx.agent && ctx.agent.waitingFor) || '';
  if (kind === 'plan') return (ev && ev.phase) || '';
  if (kind === 'depart') return (ev && ev.reason) || '';
  return '';
}

/** The context seen from one speaker: in a plan, `other` is the manager who talks. */
function dlgSpeakerCtx(kind, ctx, who) {
  if (kind !== 'plan') return ctx;
  if (who === 'a') return { ...ctx, other: ctx.agent };
  if (who === 'c') return { ...ctx, other: ctx.third };
  return ctx;
}

/**
 * Draws one line of `list` (catalogue entries) among those that fit: `si` matches, not in the last 8 of
 * `recent`, every played cell filled. Returns { entry, lines } or null.
 */
function dlgDraw(list, si, whos, varsOf, seed, salt, recent) {
  const last = recent.slice(-8);
  const fit = [];
  for (const entry of list) {
    if (entry.si !== '*' && entry.si !== si) continue;
    if (last.includes(entry.id)) continue;
    const lines = [];
    let ok = true;
    for (const who of whos) {
      if (!entry[who]) continue;
      const text = dlgFill(entry[who], varsOf(who));
      if (text === null) {
        ok = false;
        break;
      }
      lines.push({ who, text });
    }
    if (ok && lines.length > 0) fit.push({ entry, lines });
  }
  if (fit.length === 0) return null;
  return fit[dlgHash(seed, salt) % fit.length];
}

/**
 * 1.7: the lines of one conversation, [{ who: 'a' | 'b' | 'c', text }], or null when nothing fits.
 * `seed`: an integer (the hash of the event id) or a string; the same seed, context and `recent` give the
 * same lines. `recent`: ids of the last lines played, kept by the caller; the ids drawn are pushed onto it
 * and it is trimmed to 8.
 */
function pickLines(kind, ctx, seed, recent) {
  const c = ctx || {};
  const log = Array.isArray(recent) ? recent : [];
  const n = dlgSeed(seed);
  const finish = (picked) => {
    if (Array.isArray(recent)) {
      for (const p of picked) recent.push(p.entry.id);
      recent.splice(0, Math.max(0, recent.length - 8));
    }
    return picked.flatMap((p) => p.lines);
  };

  if (kind === 'chat') {
    if (!c.agent) return null;
    const state = (c.other && c.other.state) || '';
    const mine = dlgChatVars(c);
    const open = dlgDraw(CATALOG.chatter, state, ['a'], () => mine, n, 0, log);
    if (!open) return null;
    const picked = [open];
    if (c.other) {
      const theirs = dlgChatVars({ ...c, agent: c.other, other: c.agent, lot: c.otherLot, otherLot: c.lot });
      const answer = dlgDraw(CATALOG.reply, state, ['b'], () => theirs, n, 1, log);
      if (answer) picked.push(answer);
    }
    return finish(picked);
  }

  if (!dlgEventKinds.includes(kind)) return null;
  const whos = ['a'];
  if (c.other) whos.push('b');
  if (c.other && c.third) whos.push('c');
  const cache = {};
  const varsOf = (who) => cache[who] || (cache[who] = dlgEventVars(dlgSpeakerCtx(kind, c, who)));
  const hit = dlgDraw(CATALOG[kind], dlgSi(kind, c), whos, varsOf, n, 0, log);
  return hit ? finish([hit]) : null;
}
