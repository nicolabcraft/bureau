import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lot, OfficeAgent, OfficeEvent, Team } from '../src/model';

const source = readFileSync(join(import.meta.dir, '..', 'web', 'pixel', 'dialogues.js'), 'utf8');

// docs/vue-pixel.md 2.6: the public names; every other top-level name wears the prefix `dlg`.
const PUBLIC = ['CATALOG', 'cleanValue', 'modelShort', 'formatDuration', 'buildVars', 'pickLines'];

type Line = { who: 'a' | 'b' | 'c'; text: string };
type Entry = { id: string; si: string; a: string; b: string; c: string };
type Api = {
  CATALOG: Record<string, Entry[]>;
  cleanValue(text: unknown, max?: number): string;
  modelShort(model: unknown): string | null;
  formatDuration(ms: number): string;
  buildVars(kind: string, ctx: any): Record<string, string | null>;
  pickLines(kind: string, ctx: any, seed: number | string, recent?: string[]): Line[] | null;
};

// The file alone, in its own scope: no other file, no DOM (the same way test/plan.test.ts loads plan.js).
const A = new Function(`"use strict";\n${source}\nreturn { ${PUBLIC.join(', ')} };`)() as Api;
const { CATALOG } = A;

function topLevelNames(text: string): string[] {
  return [...text.matchAll(/^(?:(?:const|let|var|class)\s+|(?:async\s+)?function\s*\*?\s*)([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
}

// 1.8: maximum length of every variable.
const EVENT_MAX: Record<string, number> = {
  agent: 20, manager: 26, service: 14, lot: 28, lotid: 6, modele: 14, duree: 8, fichiers: 24, rapport: 34,
  attente: 14, projet: 20, mission: 26, nlots: 2, heure: 7,
};
const CHAT_MAX: Record<string, number> = {
  toi: 20, lot_moi: 28, lot_toi: 28, modele_moi: 14, modele_toi: 14, duree_moi: 8, duree_toi: 8, service_toi: 14, projet: 20, heure: 7,
};
const ALWAYS = ['agent', 'toi', 'heure'];
const GENRES = Object.keys(CATALOG);
const CHAT_GENRES = ['chatter', 'reply'];
const maxOf = (genre: string) => (CHAT_GENRES.includes(genre) ? CHAT_MAX : EVENT_MAX);
const cellsOf = (e: Entry) => [e.a, e.b, e.c].filter((t) => t !== '');
const varsIn = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

// 1.9: A-Z a-z 0-9, the accents of the brief, . , : ; ! ? ' ( ) / + - %, space.
const ALLOWED = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
    '\u00e9\u00e8\u00ea\u00e0\u00e2\u00e7\u00f4\u00fb\u00f9\u00ee\u00ef\u00c9\u00c8\u00c0\u00c7' +
    ".,:;!?'()/+-% ",
);

describe('the file stands alone', () => {
  test('every top-level name is public (2.6) or prefixed dlg, and each name is declared once', () => {
    const names = topLevelNames(source);
    for (const n of names) expect(PUBLIC.includes(n) || n.startsWith('dlg')).toBe(true);
    for (const n of PUBLIC) expect(names).toContain(n);
    expect(names.length).toBe(new Set(names).size);
  });

  test('no DOM, no other file, no random or clock source of its own, LF only, no dash or emoji in the source', () => {
    expect(source).not.toMatch(/\b(document|window|canvas|localStorage|requestAnimationFrame)\b/);
    expect(source).not.toMatch(/\b(hash|clamp|rnd|pick|seedRandom|rgb|drawText|wrapText)\(/);
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('\r');
    expect(source).not.toContain('\u2014');
    expect(source).not.toContain('\u2013');
    expect(source).not.toMatch(/[\ud800-\udfff]/);
  });

  test('declares the ten genres of 2.6', () => {
    expect(GENRES.sort()).toEqual(['answered', 'arrive', 'blocked', 'chatter', 'delegate', 'depart', 'plan', 'reply', 'report', 'waiting'].sort());
  });
});

describe('catalogue checks of 1.12', () => {
  test('1. with every variable at its maximum, each line is 59 characters or fewer', () => {
    for (const genre of GENRES) {
      const max = maxOf(genre);
      for (const e of CATALOG[genre]!) {
        for (const cell of cellsOf(e)) {
          const full = cell.replace(/\{(\w+)\}/g, (_m, name: string) => 'x'.repeat(max[name] ?? 999));
          expect(full.length).toBeLessThanOrEqual(59);
        }
      }
    }
  });

  test('2. nothing outside the font set: no U+2014, U+2013, emoji or ellipsis', () => {
    for (const genre of GENRES) {
      for (const e of CATALOG[genre]!) {
        for (const cell of cellsOf(e)) {
          for (const ch of cell.replace(/\{\w+\}/g, '')) expect(ALLOWED.has(ch)).toBe(true);
        }
      }
    }
  });

  test('3. every variable used exists in the table of 1.8 for its genre', () => {
    for (const genre of GENRES) {
      const max = maxOf(genre);
      for (const e of CATALOG[genre]!) {
        for (const cell of cellsOf(e)) {
          for (const name of varsIn(cell)) expect(max[name]).toBeDefined();
        }
      }
    }
  });

  test('4. each genre and each si value has 2 lines without optional variable', () => {
    const siValues: Record<string, string[]> = {
      waiting: ['permission', 'question'],
      plan: ['proposed', 'validated', 'done'],
      depart: ['archived', 'gone'],
      chatter: ['running', 'waiting', 'error', 'done', 'queued', 'idle'],
      reply: ['running', 'waiting', 'error', 'done', 'queued', 'idle'],
    };
    for (const genre of GENRES) {
      const free = (e: Entry) => cellsOf(e).every((c) => varsIn(c).every((v) => ALWAYS.includes(v)));
      for (const si of siValues[genre] ?? ['*']) {
        const fit = CATALOG[genre]!.filter((e) => (e.si === '*' || e.si === si) && free(e));
        expect(fit.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('5. at least 6 lines per genre and 30 chatter openers', () => {
    for (const genre of GENRES) expect(CATALOG[genre]!.length).toBeGreaterThanOrEqual(6);
    expect(CATALOG.chatter!.length).toBeGreaterThanOrEqual(30);
  });

  test('6. ids are unique', () => {
    const ids = GENRES.flatMap((g) => CATALOG[g]!.map((e) => e.id));
    expect(ids.length).toBe(new Set(ids).size);
  });

  test('shape: si is known, a speaks (b for a reply), c only in a plan, an answer has no b', () => {
    const SI = new Set(['*', 'permission', 'question', 'proposed', 'validated', 'done', 'archived', 'gone', 'running', 'waiting', 'error', 'queued', 'idle']);
    for (const genre of GENRES) {
      for (const e of CATALOG[genre]!) {
        expect(SI.has(e.si)).toBe(true);
        expect(Object.keys(e).sort()).toEqual(['a', 'b', 'c', 'id', 'si']);
        if (genre === 'reply') expect(e.b).not.toBe('');
        else expect(e.a).not.toBe('');
        if (genre !== 'plan') expect(e.c).toBe('');
        if (['waiting', 'answered', 'chatter'].includes(genre)) expect(e.b).toBe('');
        if (genre === 'plan' && e.si === 'proposed') expect(e.b).toBe('');
      }
    }
  });

  test('some copied lines are word for word', () => {
    const byId = (id: string) => GENRES.flatMap((g) => CATALOG[g]!).find((e) => e.id === id)!;
    expect(byId('d01').a).toBe('Le lot {lotid} est pour toi : {lot}.');
    expect(byId('d01').b).toBe("Reçu, je lis le fichier d'échange.");
    expect(byId('p04').b).toBe('{service}, ça me va.');
    expect(byId('f05').c).toBe('À la prochaine mission.');
    expect(byId('x09').b).toBe('Étrange, mais bon voyage.');
    expect(byId('c22').a).toBe('Tu as fini ? Tu as de la chance !');
    expect(byId('y11').b).toBe("Une erreur têtue, mais je m'accroche.");
    expect(GENRES.flatMap((g) => CATALOG[g]!).length).toBe(10 + 8 + 8 + 9 + 20 + 8 + 9 + 6 + 30 + 17);
  });
});

describe('cleanValue', () => {
  test('dashes become a hyphen, curly apostrophe straight, guillemets dropped, oe ë ü folded', () => {
    expect(A.cleanValue('a \u2014 b \u2013 c')).toBe('a - b - c');
    expect(A.cleanValue('l\u2019\u00e9t\u00e9')).toBe("l'\u00e9t\u00e9");
    expect(A.cleanValue('\u00abhello\u00bb world')).toBe('hello world');
    expect(A.cleanValue('c\u0153ur \u0152uvre No\u00ebl \u00fcber')).toBe('coeur Oeuvre Noel uber');
  });

  test('emoji and characters outside the font are removed', () => {
    expect(A.cleanValue('ok \ud83d\ude80 go')).toBe('ok go');
    expect(A.cleanValue('a\ud83d\ude00')).toBe('a');
    expect(A.cleanValue('x\u2764\ufe0fy')).toBe('xy');
    expect(A.cleanValue('\u4e2d\u6587 fin')).toBe('fin');
    expect(A.cleanValue('pas\u2026 fini')).toBe('pas fini');
    expect(A.cleanValue('{x} [y] <z> "q" a_b')).toBe('x y z q ab');
  });

  test('keeps accents and punctuation of the font', () => {
    expect(A.cleanValue("\u00c7a (v1.2): 50% + 3/4 ok! ok?")).toBe("\u00c7a (v1.2): 50% + 3/4 ok! ok?");
  });

  test('spaces collapse to one, ends are trimmed, null and numbers are safe', () => {
    expect(A.cleanValue('  a   b\n\t c \u00a0 ')).toBe('a b c');
    expect(A.cleanValue(null)).toBe('');
    expect(A.cleanValue(undefined, 5)).toBe('');
    expect(A.cleanValue(42, 5)).toBe('42');
  });

  test('cuts at the last space when it keeps 8 characters or more, else cuts clean', () => {
    expect(A.cleanValue('abcd efghij klmn', 12)).toBe('abcd efghij');
    expect(A.cleanValue('abc defghijklmnop', 10)).toBe('abc defghi');
    expect(A.cleanValue('abcdefghijklmnop qr', 10)).toBe('abcdefghij');
    expect(A.cleanValue('abcdefghij klm', 10)).toBe('abcdefghij');
    expect(A.cleanValue('abcdefgh ijkl', 10)).toBe('abcdefgh');
    expect(A.cleanValue('\u00c9crire les dialogues pour la vue', 18)).toBe('\u00c9crire les');
    expect(A.cleanValue('\u00c9crire les dialogues pour la vue', 20)).toBe('\u00c9crire les dialogues');
    expect(A.cleanValue('court', 20)).toBe('court');
    expect(A.cleanValue('a'.repeat(50))).toHaveLength(50);
  });

  test('trailing , : ; ( \' - are removed, a final dot or ! stays, no ellipsis', () => {
    expect(A.cleanValue('Fix bug, (wip', 10)).toBe('Fix bug');
    expect(A.cleanValue("rapport :; ( ' -")).toBe('rapport');
    expect(A.cleanValue('Fini.')).toBe('Fini.');
    expect(A.cleanValue('Fini !')).toBe('Fini !');
    expect(A.cleanValue('une phrase assez longue pour couper', 18)).not.toContain('.');
  });

  test('the result never exceeds max', () => {
    const wild = 'Titre \u2014 tr\u00e8s \ud83d\ude80 long, avec  des   espaces (et des signes) : ok; fin';
    for (let max = 1; max < 40; max++) expect(A.cleanValue(wild, max).length).toBeLessThanOrEqual(max);
  });
});

describe('modelShort', () => {
  test('Claude ids become a name and a version', () => {
    expect(A.modelShort('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(A.modelShort('claude-opus-5-5')).toBe('Opus 5.5');
    expect(A.modelShort('claude-haiku-5-5')).toBe('Haiku 5.5');
    expect(A.modelShort('claude-fable-5-2')).toBe('Fable 5.2');
    expect(A.modelShort('claude-opus-4')).toBe('Opus 4');
    expect(A.modelShort('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(A.modelShort('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(A.modelShort('claude/claude-haiku-5-5')).toBe('Haiku 5.5');
  });

  test('other ids stay as they are, nothing gives null', () => {
    expect(A.modelShort('big-pickle')).toBe('big-pickle');
    expect(A.modelShort('opencode/big-pickle')).toBe('big-pickle');
    expect(A.modelShort('gpt-5-codex')).toBe('gpt-5-codex');
    expect(A.modelShort('claude-weird')).toBe('claude-weird');
    expect(A.modelShort(null)).toBeNull();
    expect(A.modelShort('')).toBeNull();
    expect(A.modelShort('  ')).toBeNull();
    expect(A.modelShort(7)).toBeNull();
  });
});

describe('formatDuration', () => {
  test('seconds, minutes, hours', () => {
    expect(A.formatDuration(0)).toBe('0 s');
    expect(A.formatDuration(45_000)).toBe('45 s');
    expect(A.formatDuration(59_999)).toBe('59 s');
    expect(A.formatDuration(60_000)).toBe('1 min');
    expect(A.formatDuration(12 * 60_000 + 30_000)).toBe('12 min');
    expect(A.formatDuration(59 * 60_000 + 59_999)).toBe('59 min');
    expect(A.formatDuration(3_600_000)).toBe('1 h 00');
    expect(A.formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 05');
    expect(A.formatDuration(10 * 3_600_000 + 45 * 60_000)).toBe('10 h 45');
  });

  test('negative or unusable input is 0 s', () => {
    expect(A.formatDuration(-5000)).toBe('0 s');
    expect(A.formatDuration(NaN)).toBe('0 s');
    expect(A.formatDuration(undefined as unknown as number)).toBe('0 s');
  });
});

// A real state, built with the types of src/model.ts.
const NOW = new Date(2026, 10, 12, 14, 20, 0).getTime();
const MIN = 60_000;

function agent(id: string, extra: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Fil ${id}`,
    role: 'agent',
    roleSource: 'declared',
    service: null,
    parentId: null,
    model: null,
    provider: 'claude',
    state: 'running',
    waitingFor: null,
    since: null,
    updatedAt: NOW,
    createdAt: NOW - 90 * MIN,
    report: null,
    files: [],
    ...extra,
  };
}

const LOT_A: Lot = { id: 'L5', title: 'Discussions, partie pure', service: 'Développement', model: 'claude/claude-haiku-5-5', agentId: 'ag', state: 'running' };
const LOT_B: Lot = { id: 'L6', title: 'Interface', service: 'Design', model: 'claude/claude-opus-5-5', agentId: 'ag2', state: 'running' };

const chef = agent('chef', { title: 'Chef Bureau', role: 'chef', state: 'idle' });
const manager = agent('mgr', { title: 'Resp. Dev', role: 'manager', service: 'Développement', parentId: 'chef', state: 'done' });
const manager2 = agent('mgr2', { title: 'Resp. Design', role: 'manager', service: 'Design', parentId: 'chef', state: 'done' });
const worker = agent('ag', {
  title: '\u00c9crire les dialogues',
  parentId: 'mgr',
  model: 'claude-sonnet-5-5',
  state: 'running',
  since: NOW - 12 * MIN,
  files: ['web/pixel/dialogues.js', 'test/dialogues.test.ts'],
  report: { text: '**Fait** : dialogues.js \u00e9crit. Reste les tests', at: NOW - 3 * MIN },
});
const worker2 = agent('ag2', { title: 'Maquette', parentId: 'mgr2', model: 'big-pickle', state: 'waiting', waitingFor: 'question', since: NOW - 90_000 });
const team: Team = {
  id: 'chef',
  title: 'Chef Bureau',
  projectId: 'p1',
  projectName: 'Bureau',
  agents: [chef, manager, manager2, worker, worker2],
  mission: {
    id: 'm1',
    chefId: 'chef',
    title: 'Vue pixel',
    summary: '',
    budget: { maxAgents: 6, models: [] },
    lots: [LOT_A, LOT_B],
    status: 'validated',
    createdAt: NOW - 100 * MIN,
    validatedAt: NOW - 95 * MIN,
    validatedVia: 'bureau',
  },
  lastActivity: NOW,
};
const base = { teamId: 'chef', at: NOW - 1000 };

const evDelegate: OfficeEvent = { ...base, id: `${NOW}-0`, kind: 'delegate', agentId: 'ag', title: worker.title, fromId: 'mgr', lotId: 'L5' };
const evReport: OfficeEvent = { ...base, id: `${NOW}-1`, kind: 'report', agentId: 'ag', title: worker.title, toId: 'mgr', lotId: 'L5', hasReport: true };
const evBlocked: OfficeEvent = { ...base, id: `${NOW}-2`, kind: 'blocked', agentId: 'ag', title: worker.title, toId: 'mgr' };
const evWaiting: OfficeEvent = { ...base, id: `${NOW}-3`, kind: 'waiting', agentId: 'ag2', title: worker2.title, waitingFor: 'permission' };
const evPlan: OfficeEvent = { ...base, id: `${NOW}-4`, kind: 'plan', agentId: 'chef', title: chef.title, phase: 'validated', missionId: 'm1' };
const evArrive: OfficeEvent = { ...base, id: `${NOW}-5`, kind: 'arrive', agentId: 'ag', title: worker.title, parentId: 'mgr' };
const evDepart: OfficeEvent = { ...base, id: `${NOW}-6`, kind: 'depart', agentId: 'ag', title: worker.title, reason: 'archived' };
const evAnswered: OfficeEvent = { ...base, id: `${NOW}-7`, kind: 'answered', agentId: 'ag2', title: worker2.title };

const ctxFor = (event: OfficeEvent, ag: OfficeAgent | null, other: OfficeAgent | null, extra: Record<string, unknown> = {}) => ({
  event, agent: ag, other, team, lot: null, now: NOW, ...extra,
});

const ctxs: Record<string, any> = {
  delegate: ctxFor(evDelegate, worker, manager),
  report: ctxFor(evReport, worker, manager),
  blocked: ctxFor(evBlocked, worker, manager),
  waiting: ctxFor(evWaiting, worker2, null),
  plan: ctxFor(evPlan, chef, manager, { third: manager2 }),
  arrive: ctxFor(evArrive, worker, manager),
  depart: ctxFor(evDepart, worker, manager),
  answered: ctxFor(evAnswered, worker2, null),
};

describe('buildVars', () => {
  test('delegate: every variable of 1.8 from a real state', () => {
    expect(A.buildVars('delegate', ctxs.delegate)).toEqual({
      agent: '\u00c9crire les dialogues',
      manager: 'le manager D\u00e9veloppement',
      service: null,
      lot: 'Discussions, partie pure',
      lotid: 'L5',
      modele: 'Sonnet 5.5',
      duree: '12 min',
      fichiers: 'web/pixel/dialogues.js',
      rapport: 'Fait : dialogues.js \u00e9crit',
      attente: null,
      projet: 'Bureau',
      mission: 'Vue pixel',
      nlots: '2',
      heure: '14 h 20',
    });
  });

  test('service is the one of the agent of the event', () => {
    const svc = agent('ag', { ...worker, service: 'Qualit\u00e9' });
    expect(A.buildVars('delegate', ctxFor(evDelegate, svc, manager)).service).toBe('Qualit\u00e9');
  });

  test('the key sets are the tables of 1.8, for events and for chatter', () => {
    expect(Object.keys(A.buildVars('delegate', ctxs.delegate)).sort()).toEqual(Object.keys(EVENT_MAX).sort());
    const chat = { event: null, agent: worker, other: worker2, team, lot: null, now: NOW };
    expect(Object.keys(A.buildVars('chat', chat)).sort()).toEqual(Object.keys(CHAT_MAX).sort());
  });

  test('report: duration from creation to the report, rapport is the first sentence; no new report means no rapport', () => {
    const v = A.buildVars('report', ctxs.report);
    expect(v.duree).toBe('1 h 27');
    expect(v.rapport).toBe('Fait : dialogues.js \u00e9crit');
    expect(A.buildVars('report', ctxFor({ ...evReport, hasReport: false }, worker, manager)).rapport).toBeNull();
    const noDate = agent('x', { createdAt: NOW - 5 * MIN });
    expect(A.buildVars('report', ctxFor({ ...evReport, agentId: 'x', hasReport: false, at: NOW }, noDate, null)).duree).toBe('5 min');
  });

  test('blocked: duration since the current request; the manager comes from the thread above', () => {
    const v = A.buildVars('blocked', ctxs.blocked);
    expect(v.duree).toBe('12 min');
    expect(v.manager).toBe('le manager D\u00e9veloppement');
    expect(v.attente).toBeNull();
    const rootCtx = ctxFor({ ...evBlocked, agentId: 'chef', toId: null }, chef, null);
    expect(A.buildVars('blocked', rootCtx).manager).toBeNull();
    expect(A.buildVars('blocked', rootCtx).duree).toBeNull();
  });

  test('manager wording: chef, manager with or without service, unknown parent', () => {
    const under = (parent: OfficeAgent, child: OfficeAgent) =>
      A.buildVars('blocked', ctxFor({ ...evBlocked, agentId: child.id, toId: parent.id }, child, parent, { team: { ...team, agents: [parent, child] } })).manager;
    expect(under(chef, agent('c1', { parentId: 'chef' }))).toBe('le chef');
    expect(under(agent('m0', { role: 'manager', service: null }), agent('c2', { parentId: 'm0' }))).toBe('mon manager');
    expect(under(agent('m1', { role: 'manager', service: 'Qualit\u00e9' }), agent('c3', { parentId: 'm1' }))).toBe('le manager Qualit\u00e9');
    expect(A.buildVars('blocked', ctxFor({ ...evBlocked, toId: 'ghost' }, agent('c4', { parentId: 'ghost' }), null)).manager).toBeNull();
  });

  test('waiting: attente from the event, from the agent when the event lacks it', () => {
    expect(A.buildVars('waiting', ctxs.waiting).attente).toBe('une permission');
    expect(A.buildVars('waiting', ctxFor({ ...evWaiting, waitingFor: 'question' }, worker2, null)).attente).toBe('une r\u00e9ponse');
    expect(A.buildVars('waiting', ctxs.waiting).duree).toBe('1 min');
    expect(A.buildVars('delegate', ctxs.delegate).attente).toBeNull();
    // the planned model of the lot is the fallback of {modele}; big-pickle stays as it is
    expect(A.buildVars('waiting', ctxs.waiting).modele).toBe('big-pickle');
    expect(A.buildVars('waiting', ctxs.waiting).lot).toBe('Interface');
  });

  test('plan: mission, lots, project; service of the manager who talks', () => {
    const v = A.buildVars('plan', ctxs.plan);
    expect(v.agent).toBe('Chef Bureau');
    expect(v.mission).toBe('Vue pixel');
    expect(v.nlots).toBe('2');
    expect(v.projet).toBe('Bureau');
    expect(v.service).toBe('D\u00e9veloppement');
    expect(v.manager).toBeNull();
    expect(v.lot).toBeNull();
    expect(A.buildVars('plan', ctxFor(evPlan, chef, manager2)).service).toBe('Design');
  });

  test('plan without mission or lots: no mission, no nlots', () => {
    const bare = { ...team, mission: null };
    const v = A.buildVars('plan', ctxFor(evPlan, chef, manager, { team: bare }));
    expect(v.mission).toBeNull();
    expect(v.nlots).toBeNull();
    const empty = { ...team, mission: { ...team.mission!, lots: [] } };
    expect(A.buildVars('plan', ctxFor(evPlan, chef, manager, { team: empty })).nlots).toBeNull();
    const many = { ...team, mission: { ...team.mission!, lots: Array.from({ length: 120 }, (_, i) => ({ ...LOT_A, id: `L${i}`, agentId: null })) } };
    expect(A.buildVars('plan', ctxFor(evPlan, chef, manager, { team: many })).nlots).toBe('99');
  });

  test('arrive: manager from the parent; a project-less team has no projet', () => {
    expect(A.buildVars('arrive', ctxs.arrive).manager).toBe('le manager D\u00e9veloppement');
    const v = A.buildVars('arrive', ctxFor(evArrive, worker, manager, { team: { ...team, projectName: null } }));
    expect(v.projet).toBeNull();
  });

  test('depart: a leaver the team no longer knows still has its title; nothing else', () => {
    const v = A.buildVars('depart', { event: evDepart, agent: null, other: null, team: null, lot: null, now: NOW });
    expect(v.agent).toBe('\u00c9crire les dialogues');
    for (const [name, value] of Object.entries(v)) if (!['agent', 'heure'].includes(name)) expect(value).toBeNull();
  });

  test('answered: the lot is found by agentId when ctx.lot is null; a given lot wins', () => {
    expect(A.buildVars('answered', ctxs.answered).lot).toBe('Interface');
    const other: Lot = { ...LOT_B, id: 'L9', title: 'Autre lot' };
    const v = A.buildVars('answered', ctxFor(evAnswered, worker2, null, { lot: other }));
    expect(v.lot).toBe('Autre lot');
    expect(v.lotid).toBe('L9');
  });

  test('the lot of a delegate is looked up by the lotId of the event first', () => {
    const v = A.buildVars('delegate', ctxFor({ ...evDelegate, lotId: 'L6' }, worker, manager));
    expect(v.lotid).toBe('L6');
  });

  test('long and hostile values are cleaned and cut to their maximum', () => {
    const wild = agent('w', {
      title: 'T\u00e2che \u2014 \ud83d\ude80 tr\u00e8s tr\u00e8s tr\u00e8s longue',
      service: 'Service tr\u00e8s long du batiment',
      files: ['C:\\Users\\nicol\\Dev\\Bureau\\web\\pixel\\dialogues.js'],
      report: { text: '## Titre\n\n- **Gros** `code` [lien](http://x.y) \u2014 fin: tout. Suite', at: NOW },
      model: 'un-modele-vraiment-trop-long',
    });
    const v = A.buildVars('report', ctxFor({ ...evReport, agentId: 'w', title: wild.title }, wild, manager));
    for (const [name, value] of Object.entries(v)) if (value !== null) expect(value.length).toBeLessThanOrEqual(EVENT_MAX[name]!);
    expect(v.agent).not.toMatch(/[\u2014\ud83d]/);
    expect(v.fichiers).toBe('web/pixel/dialogues.js');
    expect(v.rapport).toBe('Gros code lien - fin: tout');
    expect(v.service).toBe('Service tr\u00e8s');
  });

  test('chat: names are relative to the speaker', () => {
    const chat = { event: null, agent: worker, other: worker2, team, lot: null, now: NOW };
    const v = A.buildVars('chat', chat);
    expect(v).toEqual({
      toi: 'Maquette',
      lot_moi: 'Discussions, partie pure',
      lot_toi: 'Interface',
      modele_moi: 'Sonnet 5.5',
      modele_toi: 'big-pickle',
      duree_moi: '12 min',
      duree_toi: '1 min',
      service_toi: null,
      projet: 'Bureau',
      heure: '14 h 20',
    });
    const back = A.buildVars('chat', { ...chat, agent: worker2, other: manager });
    expect(back.toi).toBe('Resp. Dev');
    expect(back.service_toi).toBe('D\u00e9veloppement');
    expect(back.lot_moi).toBe('Interface');
    expect(back.lot_toi).toBeNull();
    expect(back.duree_toi).toBeNull();
    expect(A.buildVars('chat', { ...chat, otherLot: LOT_A, other: manager }).lot_toi).toBe('Discussions, partie pure');
  });

  test('the clock has no padding on the hour and 2 digits on the minutes', () => {
    expect(A.buildVars('answered', ctxFor(evAnswered, worker2, null, { now: new Date(2026, 0, 1, 9, 5).getTime() })).heure).toBe('9 h 05');
  });
});

describe('pickLines', () => {
  const idsOf = (lines: Line[] | null) => (lines ?? []).map((l) => l.text);

  test('is deterministic: same seed, same context, same lines; the seed moves the draw', () => {
    for (const kind of Object.keys(ctxs)) {
      const one = A.pickLines(kind, ctxs[kind], 1234, []);
      expect(A.pickLines(kind, ctxs[kind], 1234, [])).toEqual(one);
    }
    expect(A.pickLines('delegate', ctxs.delegate, 'evt-1', [])).toEqual(A.pickLines('delegate', ctxs.delegate, 'evt-1', []));
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(idsOf(A.pickLines('delegate', ctxs.delegate, seed, [])).join('|'));
    expect(seen.size).toBeGreaterThan(4);
  });

  test('at most 3 bubbles, who is a, b or c in order, every text filled and within 59 characters', () => {
    for (const kind of Object.keys(ctxs)) {
      for (let seed = 0; seed < 80; seed++) {
        const lines = A.pickLines(kind, ctxs[kind], seed, [])!;
        expect(lines).not.toBeNull();
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(3);
        expect(lines.map((l) => l.who)).toEqual(['a', 'b', 'c'].slice(0, lines.length) as any);
        for (const l of lines) {
          expect(l.text).not.toMatch(/[{}]/);
          expect(l.text.length).toBeLessThanOrEqual(59);
          expect(l.text.length).toBeGreaterThan(0);
          for (const ch of l.text) expect(ALLOWED.has(ch) || ch === '\u00ca').toBe(true);
        }
      }
    }
  });

  test('a plan with two managers plays three bubbles; proposed and waiting play only a', () => {
    const lens = new Set<number>();
    for (let seed = 0; seed < 40; seed++) lens.add(A.pickLines('plan', ctxs.plan, seed, [])!.length);
    expect([...lens]).toEqual([3]);
    const proposed = ctxFor({ ...evPlan, phase: 'proposed' }, chef, manager, { third: manager2 });
    for (let seed = 0; seed < 40; seed++) expect(A.pickLines('plan', proposed, seed, [])!.map((l) => l.who)).toEqual(['a']);
    for (let seed = 0; seed < 40; seed++) expect(A.pickLines('waiting', ctxs.waiting, seed, [])!.map((l) => l.who)).toEqual(['a']);
    for (let seed = 0; seed < 40; seed++) expect(A.pickLines('answered', ctxs.answered, seed, [])!.map((l) => l.who)).toEqual(['a']);
  });

  test('a plan without a second manager plays a and b', () => {
    const one = ctxFor(evPlan, chef, manager);
    for (let seed = 0; seed < 40; seed++) expect(A.pickLines('plan', one, seed, [])!.map((l) => l.who)).toEqual(['a', 'b']);
  });

  test('plan: each speaker uses its own service', () => {
    let found = false;
    for (let seed = 0; seed < 300 && !found; seed++) {
      const recent: string[] = [];
      const lines = A.pickLines('plan', ctxs.plan, seed, recent)!;
      if (recent[0] === 'p04') {
        found = true;
        expect(lines[1]!.text).toBe('D\u00e9veloppement, \u00e7a me va.');
      }
    }
    expect(found).toBe(true);
    let found2 = false;
    const sw = { ...ctxs.plan, other: manager2, third: manager };
    for (let seed = 0; seed < 300 && !found2; seed++) {
      const recent: string[] = [];
      const lines = A.pickLines('plan', sw, seed, recent)!;
      if (recent[0] === 'p04') {
        found2 = true;
        expect(lines[1]!.text).toBe('Design, \u00e7a me va.');
      }
    }
    expect(found2).toBe(true);
  });

  test('without an interlocutor only the line a is played', () => {
    for (const kind of ['delegate', 'report', 'blocked', 'arrive', 'depart']) {
      for (let seed = 0; seed < 40; seed++) {
        const lines = A.pickLines(kind, { ...ctxs[kind], other: null }, seed, [])!;
        expect(lines.map((l) => l.who)).toEqual(['a']);
      }
    }
  });

  test('the condition si selects: permission, question, phase, reason', () => {
    const ids = (kind: string, ctx: any) => {
      const set = new Set<string>();
      for (let seed = 0; seed < 200; seed++) {
        const recent: string[] = [];
        A.pickLines(kind, ctx, seed, recent);
        set.add(recent[0]!);
      }
      return set;
    };
    const perm = ids('waiting', ctxs.waiting);
    for (const id of perm) expect(['w01', 'w02', 'w04', 'w05', 'w06', 'w08', 'w09']).toContain(id);
    expect(perm.has('w02') && perm.has('w05')).toBe(true);
    const question = ids('waiting', ctxFor({ ...evWaiting, waitingFor: 'question' }, worker2, null));
    for (const id of question) expect(['w01', 'w03', 'w04', 'w06', 'w07', 'w08']).toContain(id);
    expect(question.has('w07')).toBe(true);
    for (const id of ids('plan', ctxFor({ ...evPlan, phase: 'proposed' }, chef, manager))) expect(id.startsWith('q')).toBe(true);
    for (const id of ids('plan', ctxFor({ ...evPlan, phase: 'done' }, chef, manager, { third: manager2 }))) expect(id.startsWith('f')).toBe(true);
    for (const id of ids('depart', ctxFor({ ...evDepart, reason: 'gone' }, worker, manager))) expect(['x01', 'x02', 'x03', 'x05', 'x06', 'x07', 'x09']).toContain(id);
    for (const id of ids('depart', ctxs.depart)) expect(['x01', 'x02', 'x03', 'x04', 'x06', 'x07', 'x08']).toContain(id);
  });

  test('a line whose variable has no value is excluded: with a bare agent only variable-free lines play', () => {
    const bare = agent('bare', { title: 'Nu' });
    const ctx = { event: { ...evDelegate, agentId: 'bare', title: 'Nu', fromId: 'x', lotId: null }, agent: bare, other: agent('x'), team: { ...team, mission: null, projectName: null }, lot: null, now: NOW };
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const recent: string[] = [];
      const lines = A.pickLines('delegate', ctx, seed, recent)!;
      seen.add(recent[0]!);
      for (const l of lines) expect(l.text).not.toMatch(/[{}]/);
    }
    expect([...seen].sort()).toEqual(['d06', 'd07', 'd10']);
  });

  test('no manager above, no line with {manager}; no report, no line with {rapport}', () => {
    const rootCtx = ctxFor({ ...evBlocked, agentId: 'chef', toId: null }, chef, null);
    for (let seed = 0; seed < 200; seed++) {
      const recent: string[] = [];
      A.pickLines('blocked', rootCtx, seed, recent);
      expect(recent[0]).not.toBe('b06');
    }
    const noReport = ctxFor({ ...evReport, hasReport: false }, worker, manager);
    for (let seed = 0; seed < 200; seed++) {
      const recent: string[] = [];
      const lines = A.pickLines('report', noReport, seed, recent)!;
      expect(['r01', 'r08']).not.toContain(recent[0]!);
      expect(lines.length).toBe(2);
    }
  });

  test('the variable ends are glued: no double dot after a lot title that ends with a dot', () => {
    const dotted = ctxFor(evDelegate, worker, manager, { lot: { ...LOT_A, title: 'Finir le test.' } });
    let hit = false;
    for (let seed = 0; seed < 300; seed++) {
      const recent: string[] = [];
      const lines = A.pickLines('delegate', dotted, seed, recent)!;
      if (recent[0] === 'd02') {
        hit = true;
        expect(lines[0]!.text).toBe('Ton lot : Finir le test. Bonne chance.');
      }
      if (recent[0] === 'd01') {
        hit = true;
        expect(lines[0]!.text).toBe('Le lot L5 est pour toi : Finir le test.');
      }
      for (const l of lines) expect(l.text).not.toContain('..');
    }
    expect(hit).toBe(true);
  });

  test('never plays one of the last 8 lines, and keeps recent at 8 or fewer', () => {
    const recent: string[] = [];
    const kinds = ['delegate', 'blocked', 'arrive', 'report', 'delegate', 'depart'];
    let drawn = 0;
    for (let i = 0; i < 120; i++) {
      const before = recent.slice(-8);
      const kind = kinds[i % kinds.length]!;
      const lines = A.pickLines(kind, ctxs[kind], 1000 + i * 7, recent);
      if (lines === null) continue;
      drawn++;
      expect(before).not.toContain(recent[recent.length - 1]!);
      expect(recent.length).toBeLessThanOrEqual(8);
    }
    expect(drawn).toBeGreaterThan(100);
  });

  test('chat: the same rule across many draws, one id for the opener and one for the reply', () => {
    const chat = { event: null, agent: worker, other: manager, team, lot: null, now: NOW };
    const recent: string[] = [];
    for (let i = 0; i < 100; i++) {
      const before = recent.slice(-8);
      const lines = A.pickLines('chat', chat, i * 31, recent)!;
      expect(lines.map((l) => l.who)).toEqual(['a', 'b']);
      const [open, answer] = recent.slice(-2);
      expect(open).toMatch(/^c\d\d$/);
      expect(answer).toMatch(/^y\d\d$/);
      expect(before).not.toContain(open!);
      expect(before).not.toContain(answer!);
      expect(recent.length).toBeLessThanOrEqual(8);
    }
  });

  test('chat: si follows the state of the interlocutor; variables follow the speaker', () => {
    const talk = (other: OfficeAgent, seed: number) => {
      const recent: string[] = [];
      const lines = A.pickLines('chat', { event: null, agent: worker, other, team, lot: null, now: NOW }, seed, recent)!;
      return { lines, recent };
    };
    const err = agent('e', { title: 'Panne', state: 'error' });
    const seenOpen = new Set<string>();
    const seenReply = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const { recent } = talk(err, seed);
      seenOpen.add(recent[0]!);
      seenReply.add(recent[1]!);
    }
    expect(seenOpen.has('c19') && seenOpen.has('c20')).toBe(true);
    for (const id of seenOpen) expect(['c15', 'c16', 'c17', 'c18', 'c21', 'c22', 'c23', 'c24'].includes(id)).toBe(false);
    expect(seenReply.has('y11') && seenReply.has('y12')).toBe(true);
    for (const id of seenReply) expect(['y07', 'y08', 'y09', 'y10', 'y13', 'y14', 'y15', 'y16'].includes(id)).toBe(false);

    // c06 names the lot of the one who speaks, c15 the lot of the one who listens
    const lot = (id: string, seed0 = 0) => {
      for (let seed = seed0; seed < seed0 + 600; seed++) {
        const { lines, recent } = talk(worker2, seed);
        if (recent[0] === id) return lines[0]!.text;
      }
      return null;
    };
    expect(lot('c06')).toBe('De mon c\u00f4t\u00e9, je suis sur Discussions, partie pure.');
    expect(lot('c26')).toBe('Tu tournes sous big-pickle, c\'est agr\u00e9able ?');
    expect(lot('c02')).toBe('D\u00e9j\u00e0 14 h 20 ? Le temps file.');
  });

  test('chat without an interlocutor plays the opener alone', () => {
    const lines = A.pickLines('chat', { event: null, agent: worker, other: null, team, lot: null, now: NOW }, 5, [])!;
    expect(lines.map((l) => l.who)).toEqual(['a']);
    expect(A.pickLines('chat', { event: null, agent: null, other: null, team, lot: null, now: NOW }, 5, [])).toBeNull();
  });

  test('chat: a speaker without anything to say about work still has lines', () => {
    const nobody = agent('n', { title: 'N', state: 'idle' });
    const you = agent('m', { title: 'M', state: 'idle' });
    const ctx = { event: null, agent: nobody, other: you, team: { ...team, mission: null, projectName: null }, lot: null, now: NOW };
    for (let seed = 0; seed < 200; seed++) {
      const recent: string[] = [];
      const lines = A.pickLines('chat', ctx, seed, recent)!;
      expect(lines.length).toBe(2);
      for (const l of lines) expect(l.text).not.toMatch(/[{}]/);
    }
  });

  test('returns null when nothing is eligible or the kind is unknown', () => {
    const all = CATALOG.answered!.map((e) => e.id);
    expect(A.pickLines('answered', ctxs.answered, 1, [...all])).toBeNull();
    expect(A.pickLines('nope', ctxs.delegate, 1, [])).toBeNull();
    expect(A.pickLines('delegate', undefined, 1, [])).not.toBeUndefined();
  });

  test('only the last 8 ids of recent count; a missing recent is tolerated', () => {
    const old = CATALOG.answered!.map((e) => e.id);
    const recent = [...old, 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'z8'];
    expect(A.pickLines('answered', ctxs.answered, 1, recent)).not.toBeNull();
    expect(recent.length).toBe(8);
    expect(recent[7]).toMatch(/^n\d\d$/);
    expect(A.pickLines('answered', ctxs.answered, 1)).not.toBeNull();
  });

  test('the caller owns recent: a draw is reproducible from a copy of it', () => {
    const recent = ['d01', 'd02', 'd03'];
    const copy = [...recent];
    const one = A.pickLines('delegate', ctxs.delegate, 77, recent);
    expect(A.pickLines('delegate', ctxs.delegate, 77, copy)).toEqual(one);
    expect(recent).toEqual(copy);
    expect(recent.length).toBe(4);
  });
});
