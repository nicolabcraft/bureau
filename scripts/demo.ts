/**
 * `bun run demo`: the real service against a fake core that holds realistic teams
 * in several projects and changes them over time. For trying the view without Boite.
 * Opens nothing: it prints the address to load (in Boite: `boite browse <url>`).
 *
 * BUREAU_DEMO=gros : 5 projects and 40 agents from the start, for measuring the view.
 * Otherwise : 3 projects and loose conversations, then a 4th project at about 30 s (its floor is built).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPage } from '../src/page';
import { createMission, declareRole, markValidated, setLotState, updateRegistry, validatePlan } from '../src/registry';
import { startService } from '../src/service';
import { fakeCore, thread, TOKEN } from '../test/helpers';
import type { ProjectRow, ThreadRow } from '../src/core-types';

const gros = process.env.BUREAU_DEMO === 'gros';
const now = Date.now();
const min = 60_000;

const rows: ThreadRow[] = [];
const byId = new Map<string, ThreadRow>();
/** Threads get a creation time one second apart, so the view seats them in the order they are listed here. */
let clock = now - 90 * min;
function add(id: string, extra: Partial<ThreadRow>): ThreadRow {
  const status = extra.status ?? 'idle';
  const row = thread(id, {
    createdAt: (clock += 1_000),
    updatedAt: now - 3_000,
    runningSince: status === 'running' || status === 'waiting' ? now - 6 * min : null,
    ...extra,
  });
  rows.push(row);
  byId.set(id, row);
  return row;
}

const projects: ProjectRow[] = [
  { id: 'dh', name: 'Boutique', path: '/work/boutique' },
  { id: 'hx', name: 'Atelier', path: '/work/atelier' },
  { id: 'mo', name: 'Application mobile', path: '/work/mobile' },
  { id: 'sv', name: 'Migration des serveurs', path: '/work/serveurs' },
  { id: 'pa', name: 'Portail partenaires', path: '/work/partenaires' },
];
/** The registry entries (roles of the managers) to write once the service is up. */
const roles: { id: string; service: string; chefId?: string }[] = [];

if (gros) {
  // 5 projects x (a chef, 3 managers, 4 agents) = 40 agents.
  const services = ['Développement', 'Qualité', 'Design'];
  const work = [
    ['Module comptes', 'Worker Stripe'],
    ['Tests portail'],
    ['Maquettes accueil'],
  ];
  const titles = ['Refonte de l’espace client', 'Correctif du panier', 'Version mobile', 'Bascule des serveurs', 'Ouverture aux partenaires'];
  projects.forEach((project, p) => {
    const chef = `${project.id}-chef`;
    add(chef, { title: titles[p]!, projectId: project.id, status: p % 2 === 0 ? 'running' : 'idle', model: 'claude-opus-5-5' });
    services.forEach((service, s) => {
      const mgr = `${project.id}-m${s}`;
      add(mgr, { title: `Manager ${service}`, projectId: project.id, parentThreadId: chef, status: s === 2 ? 'idle' : 'running', model: 'claude-sonnet-5-5' });
      roles.push({ id: mgr, service });
      work[s]!.forEach((title, k) => add(`${project.id}-a${s}${k}`, { title, projectId: project.id, parentThreadId: mgr, status: (p + s + k) % 3 === 0 ? 'idle' : 'running', model: k % 2 ? 'claude-haiku-5-5' : 'claude-sonnet-5-5' }));
    });
  });
} else {
  // Boutique: a chef, five managers (two started apart with `boite thread new`), their agents.
  add('chef', { title: 'Refonte de l’espace client', projectId: 'dh', status: 'running', model: 'claude-opus-5-5' });
  // Delegated with `boite delegate spawn`: they hang under the chef by parentThreadId.
  add('m-dev', { title: 'Manager Développement', projectId: 'dh', parentThreadId: 'chef', status: 'running', model: 'claude-sonnet-5-5' });
  add('m-arch', { title: 'Manager Architecture', projectId: 'dh', parentThreadId: 'chef', status: 'running', model: 'claude-opus-5-5' });
  add('m-design', { title: 'Manager Design', projectId: 'dh', parentThreadId: 'chef', status: 'idle', model: 'claude-sonnet-5-5' });
  // Started with `boite thread new`: no parentThreadId, attached to the chef by a chef link in the registry.
  add('m-qa', { title: 'Manager Qualité', projectId: 'dh', status: 'idle', model: 'claude-sonnet-5-5' });
  add('m-prod', { title: 'Manager Produit', projectId: 'dh', status: 'idle', model: 'claude-sonnet-5-5' });
  add('a-comptes', { title: 'Module comptes', projectId: 'dh', parentThreadId: 'm-dev', status: 'running', providerId: 'opencode', model: 'big-pickle' });
  add('a-stripe', { title: 'Worker Stripe', projectId: 'dh', parentThreadId: 'm-dev', status: 'waiting', model: 'claude-sonnet-5-5' });
  add('a-sql', { title: 'Migration SQL', projectId: 'dh', parentThreadId: 'm-dev', status: 'idle', model: 'claude-haiku-5-5' });
  add('a-schema', { title: 'Schéma des services', projectId: 'dh', parentThreadId: 'm-arch', status: 'running', model: 'claude-opus-5-5' });
  add('a-maquettes', { title: 'Maquettes accueil', projectId: 'dh', parentThreadId: 'm-design', status: 'idle', model: 'claude-sonnet-5-5' });
  add('a-tests', { title: 'Tests portail', projectId: 'dh', parentThreadId: 'm-qa', status: 'queued', model: 'claude-haiku-5-5' });
  add('a-crit', { title: 'Critères d’acceptation', projectId: 'dh', parentThreadId: 'm-prod', status: 'idle', model: 'claude-haiku-5-5' });
  roles.push(
    { id: 'm-qa', service: 'Qualité', chefId: 'chef' },
    { id: 'm-prod', service: 'Produit', chefId: 'chef' },
    { id: 'm-dev', service: 'Développement' },
    { id: 'm-arch', service: 'Architecture' },
    { id: 'm-design', service: 'Design' }
  );
  // Atelier: a small team.
  add('atelier', { title: 'Correctif du panier', projectId: 'hx', status: 'running', model: 'claude-opus-5-5' });
  add('m-at', { title: 'Manager Développement', projectId: 'hx', parentThreadId: 'atelier', status: 'running', model: 'claude-sonnet-5-5' });
  add('a-panier', { title: 'Calcul des remises', projectId: 'hx', parentThreadId: 'm-at', status: 'running', model: 'claude-sonnet-5-5' });
  add('a-stock', { title: 'Synchronisation du stock', projectId: 'hx', parentThreadId: 'm-at', status: 'idle', model: 'claude-haiku-5-5' });
  roles.push({ id: 'm-at', service: 'Développement' });
  // Application mobile: agents handed straight to the chef, no manager.
  add('mobile', { title: 'Application mobile', projectId: 'mo', status: 'running', model: 'claude-opus-5-5' });
  add('a-ecrans', { title: 'Écrans de connexion', projectId: 'mo', parentThreadId: 'mobile', status: 'running', model: 'claude-sonnet-5-5' });
  add('a-push', { title: 'Notifications', projectId: 'mo', parentThreadId: 'mobile', status: 'idle', model: 'claude-haiku-5-5' });
  // Loose conversations, in no project.
  add('conv-notes', { title: 'Notes de réunion', status: 'idle', updatedAt: now - 20 * min });
  add('conv-cache', { title: 'Question sur le cache', status: 'running', runningSince: now - min });
}

const core = fakeCore({
  'threads.list': () => [...byId.values()],
  'projects.list': () => projects.filter((project) => liveProjects.has(project.id)),
  'ui.reveal': () => ({ delivered: 1 }),
  'turns.stop': (params: any) => {
    const row = byId.get(String(params.threadId));
    if (row) update(row.id, { status: 'idle', runningSince: null });
    return { stopped: true };
  },
  'turns.start': () => ({ id: 'turn-demo' }),
});
/** A project Boite knows about: the new one is only listed once it is created (about 30 s in). */
const liveProjects = new Set(gros ? projects.map((project) => project.id) : ['dh', 'hx', 'mo']);

function update(id: string, change: Partial<ThreadRow>): void {
  const row = { ...byId.get(id)!, ...change, updatedAt: Date.now() };
  byId.set(id, row);
  core.emit('thread.updated', row);
}
const run = (id: string) => update(id, { status: 'running', runningSince: Date.now() });
const rest = (id: string) => update(id, { status: 'idle', runningSince: null });
/** An agent waits for the user: a permission request. */
const ask = (id: string) => update(id, { status: 'waiting' });

/** A new thread: its agent walks in by the front door. */
function arrive(id: string, title: string, parent: string | null, projectId: string): void {
  const row = thread(id, { title, projectId, parentThreadId: parent, status: 'queued', createdAt: Date.now(), updatedAt: Date.now() });
  byId.set(id, row);
  core.emit('thread.created', row);
}
/** An archived thread leaves the office: its agent walks out. */
const depart = (id: string): void => update(id, { archived: true });

const dataDir = mkdtempSync(join(tmpdir(), 'bureau-demo-'));
await updateRegistry(dataDir, (registry) => {
  for (const role of roles) declareRole(registry, role.id, { role: 'manager', service: role.service, ...(role.chefId ? { chefId: role.chefId } : {}) });
  // m-prod filed its report: it is done, and goes to the cafeteria after handing the report to the chef.
  if (!gros) registry.reports['m-prod'] = { text: 'Critères d’acceptation écrits et validés.', at: Date.now() };
});
const service = await startService({ dataDir, page: readPage, version: 'demo', coreUrl: core.url, token: TOKEN, port: Number(process.env.BUREAU_PORT ?? 47318) });
console.log(`Démo Bureau : http://127.0.0.1:${service.port}/${gros ? ' (mode gros : 5 projets, 40 agents)' : ''}`);

// ---- Scripted life: a timeline, then a loop that keeps the floors busy -------------------
const at = (seconds: number, action: () => void | Promise<void>) => setTimeout(() => void action(), seconds * 1000);

/** The chef proposes a plan; a few seconds later it is validated, and its lots start. */
async function missionLife(chefId: string, firstAgent: string, proposeAt: number, validateAt: number): Promise<void> {
  const plan = validatePlan({
    title: 'Refonte du parcours client',
    summary: 'Reprendre l’inscription, le panier et la facturation, avec une recette complète avant la mise en ligne.',
    budget: { maxAgents: 6, models: ['claude/claude-sonnet-5-5'] },
    lots: [
      { id: 'L1', title: 'Comptes et authentification', service: 'Développement', model: 'claude/claude-sonnet-5-5' },
      { id: 'L2', title: 'Recette du portail', service: 'Qualité', model: 'claude/claude-haiku-5-5' },
    ],
  });
  if (!plan.ok) throw new Error(plan.errors.join(' '));
  let missionId = '';
  at(proposeAt, () => updateRegistry(dataDir, (registry) => void (missionId = createMission(registry, chefId, plan.plan).id)));
  at(validateAt, () =>
    updateRegistry(dataDir, (registry) => {
      const mission = registry.missions[missionId];
      if (!mission || mission.status !== 'proposed') return;
      markValidated(mission, 'bureau');
      setLotState(mission, 'L1', 'running', firstAgent);
    })
  );
}

if (gros) {
  await missionLife('dh-chef', 'dh-a00', 12, 26);
  // Every few seconds one agent of the building changes: at rest, at work, waiting for the user.
  const agentsIds = [...byId.values()].filter((row) => row.parentThreadId && !row.id.includes('-m')).map((row) => row.id);
  const flips: (() => void)[] = [];
  agentsIds.forEach((id, i) => flips.push(i % 5 === 0 ? () => ask(id) : i % 2 ? () => rest(id) : () => run(id)));
  let n = 0;
  setInterval(() => {
    flips[n % flips.length]!();
    n += 1;
  }, 2_500);
  at(34, () => depart('sv-a20'));
} else {
  at(3, () => run('a-tests'));
  at(6, () => rest('a-comptes'));
  at(9, () => run('m-qa'));
  await missionLife('chef', 'a-comptes', 12, 26);
  at(14, () => ask('a-tests'));
  at(16, () => arrive('a-export', 'Export des factures', 'm-dev', 'dh'));
  at(19, () => run('a-export'));
  at(21, () => run('a-tests'));
  // An agent changes project: Critères d’acceptation goes from the Boutique to the Atelier, under its manager.
  at(23, () => update('a-crit', { projectId: 'hx', parentThreadId: 'm-at' }));
  at(24, () => rest('conv-cache'));
  // A new project: a floor is built on top, then its team arrives.
  at(30, () => {
    liveProjects.add('pa');
    const row = thread('portail', { title: 'Ouverture du portail partenaires', projectId: 'pa', status: 'running', runningSince: Date.now(), model: 'claude-opus-5-5', createdAt: Date.now(), updatedAt: Date.now() });
    byId.set('portail', row);
    core.emit('thread.created', row);
  });
  at(34, () => depart('a-sql'));
  // The team of the new floor shows up once the chantier is over (about 11 s).
  at(44, () => arrive('m-portail', 'Manager Développement', 'portail', 'pa'));
  at(45, async () => {
    await updateRegistry(dataDir, (registry) => declareRole(registry, 'm-portail', { role: 'manager', service: 'Développement' }));
    run('m-portail');
  });
  at(47, () => arrive('a-api', 'API partenaires', 'm-portail', 'pa'));
  at(48, () => arrive('a-doc', 'Documentation', 'm-portail', 'pa'));
  at(50, () => run('a-api'));
  at(52, () => run('a-doc'));
  // Then it goes on: one change every 4 seconds.
  const loop: (() => void)[] = [
    () => ask('a-stripe'),
    () => rest('a-export'),
    () => run('a-maquettes'),
    () => run('a-comptes'),
    () => rest('a-api'),
    () => run('a-ecrans'),
    () => rest('a-maquettes'),
    () => run('a-push'),
    () => run('conv-cache'),
    () => rest('a-ecrans'),
    () => ask('a-panier'),
    () => run('a-stripe'),
    () => rest('a-schema'),
    () => run('a-export'),
    () => rest('conv-cache'),
    () => run('a-schema'),
  ];
  let step = 0;
  at(56, () =>
    void setInterval(() => {
      loop[step % loop.length]!();
      step += 1;
    }, 4_000)
  );
}
