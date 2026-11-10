import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../src/commands';
import { readRegistry } from '../src/registry';
import { startService, type Service } from '../src/service';
import { capture, cleanTempDirs, fakeCore, TOKEN, tempDir, thread, type FakeCore } from './helpers';

const cores: FakeCore[] = [];
const services: Service[] = [];
afterEach(async () => {
  for (const fake of cores.splice(0)) fake.stop();
  for (const service of services.splice(0)) await service.stop();
});
afterAll(cleanTempDirs);

const rows = [
  thread('chef', { title: 'Mission Boutique', projectId: 'p1', createdAt: 1, updatedAt: 100 }),
  thread('mgr', { title: 'Manager dev', parentThreadId: 'chef', status: 'running', runningSince: 50, createdAt: 2, updatedAt: 200 }),
  thread('agent', { title: 'Agent webhook', parentThreadId: 'mgr', status: 'waiting', model: 'claude-haiku-5-5', createdAt: 3, updatedAt: 300 }),
  thread('lone', { title: 'Autre sujet', createdAt: 4, updatedAt: 50 }),
];

// Three floors: the chef, a responsable started with `boite thread new` (no parentThreadId) and its two spawned agents.
const floors = [
  thread('chef', { title: 'Mission Boutique', projectId: 'p1', createdAt: 1, updatedAt: 100 }),
  thread('resp', { title: 'Développement : webhook', projectId: 'p1', status: 'running', runningSince: 50, createdAt: 2, updatedAt: 200 }),
  thread('ag1', { title: 'Agent webhook', parentThreadId: 'resp', status: 'running', runningSince: 60, model: 'claude-haiku-5-5', createdAt: 3, updatedAt: 300 }),
  thread('ag2', { title: 'Agent tests', parentThreadId: 'resp', model: 'claude-haiku-5-5', createdAt: 4, updatedAt: 250 }),
  thread('lone', { title: 'Autre sujet', createdAt: 5, updatedAt: 50 }),
];

function setup(caller: string | null = 'chef', threads = rows) {
  const dataDir = tempDir();
  const fake = fakeCore({ 'threads.list': () => threads, 'projects.list': () => [{ id: 'p1', name: 'Boutique', path: 'F:\\x' }] });
  cores.push(fake);
  const env: Record<string, string | undefined> = { BOITE_PLUGIN_DATA: dataDir, BOITE_CORE_URL: fake.url, BOITE_TOKEN: TOKEN };
  if (caller) env.BOITE_CALLER_THREAD_ID = caller;
  const run = async (...argv: string[]) => {
    const out = capture();
    const code = await runCommand(argv, { env, io: out.io, cwd: dataDir, version: '0.0.0' });
    return { code, out: out.out, err: out.err };
  };
  return { dataDir, fake, env, run, as: (id: string) => (env.BOITE_CALLER_THREAD_ID = id) };
}

const validPlan = {
  title: 'Refonte Boutique',
  summary: "Refaire l'espace client.",
  budget: { maxAgents: 4, models: ['claude/claude-sonnet-5-5'] },
  lots: [
    { id: 'L1', title: 'Webhook', service: 'Développement', model: 'claude/claude-sonnet-5-5' },
    { id: 'L2', title: 'Relecture', service: 'Qualité', model: 'claude/claude-opus-5-5' },
  ],
};
const writePlan = (dir: string, plan: unknown = validPlan, name = 'plan.json') => {
  writeFileSync(join(dir, name), typeof plan === 'string' ? plan : JSON.stringify(plan));
  return name;
};
const missionId = (line: string | undefined) => /(m-[a-z0-9]+)/.exec(line ?? '')![1]!;

describe('unknown command and usage', () => {
  test('an unknown command exits 2 and lists the commands', async () => {
    const { run } = setup();
    const result = await run('bureau-nope');
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('bureau-role');
  });

  test('a usage error exits 2 with the usage line', async () => {
    const { run } = setup();
    const result = await run('bureau-role', 'patron');
    expect(result.code).toBe(2);
    expect(result.err[0]).toBe('Le rôle doit être chef, manager ou agent.');
    expect(result.err[1]).toContain('Usage : boite bureau-role <chef|manager|agent>');
    expect((await run('bureau-role', 'agent', '--bogus')).code).toBe(2);
    expect((await run('bureau-role', 'agent', '--service')).code).toBe(2);
    expect((await run('bureau-mission', 'extra')).code).toBe(2);
    expect((await run('bureau-rapport')).code).toBe(2);
    expect((await run('bureau-plan')).code).toBe(2);
  });

  test('a command run outside Boite says what is missing', async () => {
    const out = capture();
    const code = await runCommand(['bureau-role', 'agent'], { env: {}, io: out.io });
    expect(code).toBe(1);
    expect(out.err.join('\n')).toContain('BOITE_PLUGIN_DATA');
    const { run, env } = setup(null);
    expect(env.BOITE_CALLER_THREAD_ID).toBeUndefined();
    const result = await run('bureau-rapport', 'x');
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain('fil appelant est inconnu');
  });
});

describe('bureau', () => {
  test('says the service is not running when there is no port file', async () => {
    const { run } = setup();
    const result = await run('bureau');
    expect(result.code).toBe(1);
    expect(result.err).toEqual(['Le service Bureau ne tourne pas.', 'Démarre-le : Réglages > Plugins > Bureau > Démarrer.']);
  });

  test('says so too when the port file points at nothing that answers', async () => {
    const { run, dataDir } = setup();
    writeFileSync(join(dataDir, 'port'), '1');
    expect((await run('bureau')).code).toBe(1);
  });

  test('prints the address and the browse line when the service answers', async () => {
    const { run, dataDir } = setup();
    const service = await startService({ dataDir, page: '<p>x</p>', version: '0.0.0', port: 0, log: () => {} });
    services.push(service);
    const result = await run('bureau');
    expect(result.code).toBe(0);
    expect(result.out).toEqual([`Adresse : http://127.0.0.1:${service.port}/`, `Pour l'ouvrir dans Boite : boite browse http://127.0.0.1:${service.port}/`]);
  });
});

describe('bureau-role', () => {
  test('declares the role of the calling thread, one fact per line', async () => {
    const { run, dataDir } = setup('mgr');
    const result = await run('bureau-role', 'manager', '--service', 'Développement', '--files', 'src/a.ts, src/b.ts');
    expect(result).toMatchObject({ code: 0, out: ['Rôle déclaré : manager', 'Service : Développement', 'Fichiers : src/a.ts, src/b.ts', 'Fil : mgr'] });
    expect(readRegistry(dataDir).roles.mgr).toMatchObject({ role: 'manager', service: 'Développement', files: ['src/a.ts', 'src/b.ts'] });
  });

  test('a later declaration keeps the service it does not change', async () => {
    const { run, dataDir } = setup('mgr');
    await run('bureau-role', 'manager', '--service', 'Qualité');
    await run('bureau-role', 'agent');
    expect(readRegistry(dataDir).roles.mgr).toMatchObject({ role: 'agent', service: 'Qualité' });
  });

  test('--thread declares the role of a thread that exists, and refuses one that does not', async () => {
    const { run, dataDir, fake } = setup('mgr');
    const ok = await run('bureau-role', 'agent', '--service', 'Design', '--thread', 'agent');
    expect(ok.code).toBe(0);
    expect(ok.out.at(-1)).toBe('Fil : agent');
    expect(readRegistry(dataDir).roles.agent?.service).toBe('Design');
    expect(fake.calls.map((call) => call.method)).toEqual(['threads.list']);
    const missing = await run('bureau-role', 'agent', '--thread', 'thr_ghost');
    expect(missing.code).toBe(1);
    expect(missing.err[0]).toContain("Le fil thr_ghost n'existe pas");
    expect(readRegistry(dataDir).roles.thr_ghost).toBeUndefined();
  });

  test('its own thread needs no core', async () => {
    const { run, env } = setup('mgr');
    env.BOITE_CORE_URL = 'http://127.0.0.1:1';
    expect((await run('bureau-role', 'agent')).code).toBe(0);
  });

  test('--chef attaches the calling manager to its chef, and prints the link', async () => {
    const { run, dataDir } = setup('resp', floors);
    const result = await run('bureau-role', 'manager', '--service', 'Développement', '--chef', 'chef');
    expect(result).toMatchObject({ code: 0, out: ['Rôle déclaré : manager', 'Service : Développement', 'Chef : chef', 'Fil : resp'] });
    expect(readRegistry(dataDir).roles.resp).toMatchObject({ role: 'manager', service: 'Développement', chefId: 'chef' });
  });

  test('the chef can attach a manager it started: --thread with --chef', async () => {
    const { run, dataDir } = setup('chef', floors);
    const result = await run('bureau-role', 'manager', '--service', 'Qualité', '--thread', 'resp', '--chef', 'chef');
    expect(result.code).toBe(0);
    expect(result.out.at(-1)).toBe('Fil : resp');
    expect(readRegistry(dataDir).roles.resp).toMatchObject({ service: 'Qualité', chefId: 'chef' });
    expect(readRegistry(dataDir).roles.chef).toBeUndefined();
  });

  test('a later declaration keeps the chef link while the thread stays a manager', async () => {
    const { run, dataDir } = setup('resp', floors);
    await run('bureau-role', 'manager', '--chef', 'chef');
    await run('bureau-role', 'manager', '--service', 'Design');
    expect(readRegistry(dataDir).roles.resp).toMatchObject({ service: 'Design', chefId: 'chef' });
    await run('bureau-role', 'agent');
    expect(readRegistry(dataDir).roles.resp?.chefId).toBeUndefined();
  });

  test('--chef refuses unknown ids, itself and an empty value, and writes nothing', async () => {
    const { run, dataDir } = setup('resp', floors);
    const ghostChef = await run('bureau-role', 'manager', '--chef', 'thr_ghost');
    expect(ghostChef.code).toBe(1);
    expect(ghostChef.err[0]).toContain("Le chef thr_ghost n'existe pas");
    expect(ghostChef.err[0]).toContain('boite where');
    const ghostThread = await run('bureau-role', 'manager', '--thread', 'thr_ghost', '--chef', 'chef');
    expect(ghostThread.code).toBe(1);
    expect(ghostThread.err[0]).toContain("Le fil thr_ghost n'existe pas");
    const self = await run('bureau-role', 'manager', '--chef', 'resp');
    expect(self.code).toBe(1);
    expect(self.err[0]).toContain('son propre chef');
    const empty = await run('bureau-role', 'manager', '--chef', ' ');
    expect(empty.code).toBe(2);
    expect(empty.err.at(-1)).toContain('--chef <id-du-chef>');
    expect(readRegistry(dataDir).roles).toEqual({});
  });

  test('--chef only goes with the manager role', async () => {
    const { run, dataDir } = setup('resp', floors);
    for (const role of ['agent', 'chef']) {
      const result = await run('bureau-role', role, '--chef', 'chef');
      expect(result.code).toBe(2);
      expect(result.err[0]).toContain("--chef ne va qu'avec le rôle manager");
    }
    expect(readRegistry(dataDir).roles).toEqual({});
  });

  test('--chef refuses a loop: a chef under its own manager or under one of its agents', async () => {
    const { run, as, dataDir } = setup('resp', floors);
    expect((await run('bureau-role', 'manager', '--chef', 'chef')).code).toBe(0);
    // The chef under its own manager.
    as('chef');
    const direct = await run('bureau-role', 'manager', '--chef', 'resp');
    expect(direct.code).toBe(1);
    expect(direct.err[0]).toContain('ferait une boucle');
    // The chef under an agent of that manager (two floors down).
    const deep = await run('bureau-role', 'manager', '--chef', 'ag1');
    expect(deep.code).toBe(1);
    expect(deep.err[0]).toContain('ferait une boucle');
    // Same through --thread.
    as('ag1');
    expect((await run('bureau-role', 'manager', '--thread', 'chef', '--chef', 'ag2')).code).toBe(1);
    expect(readRegistry(dataDir).roles.chef).toBeUndefined();
    // Moving the manager elsewhere is not a loop.
    as('resp');
    expect((await run('bureau-role', 'manager', '--chef', 'lone')).code).toBe(0);
    expect(readRegistry(dataDir).roles.resp?.chefId).toBe('lone');
  });
});

describe('bureau-plan', () => {
  test('submits a plan: a proposed mission, its id and the wait for validation', async () => {
    const { run, dataDir } = setup();
    const result = await run('bureau-plan', writePlan(dataDir));
    expect(result.code).toBe(0);
    const [created, lots, waiting] = result.out;
    expect(created).toMatch(/^Mission m-[a-z0-9]+ créée : Refonte Boutique$/);
    expect(lots).toBe('Lots : 2');
    expect(waiting).toBe("En attente de la validation de l'utilisateur.");
    const mission = readRegistry(dataDir).missions[missionId(created)]!;
    expect(mission).toMatchObject({ chefId: 'chef', status: 'proposed', validatedAt: null, validatedVia: null });
    expect(mission.lots.map((lot) => [lot.id, lot.state, lot.agentId])).toEqual([
      ['L1', 'todo', null],
      ['L2', 'todo', null],
    ]);
  });

  test('refuses a second proposed plan unless --remplacer', async () => {
    const { run, dataDir } = setup();
    const first = await run('bureau-plan', writePlan(dataDir));
    const second = await run('bureau-plan', 'plan.json');
    expect(second.code).toBe(1);
    expect(second.err[0]).toContain('--remplacer');
    expect(Object.keys(readRegistry(dataDir).missions)).toHaveLength(1);
    const third = await run('bureau-plan', 'plan.json', '--remplacer');
    expect(third.code).toBe(0);
    const ids = Object.keys(readRegistry(dataDir).missions);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(missionId(third.out[0]));
    expect(ids[0]).not.toBe(missionId(first.out[0]));
  });

  test('an invalid plan lists every problem and writes nothing', async () => {
    const { run, dataDir } = setup();
    const result = await run('bureau-plan', writePlan(dataDir, { title: 'T', lots: [] }));
    expect(result.code).toBe(1);
    expect(result.err[0]).toMatch(/^Plan invalide : 2 problèmes à corriger/);
    expect(result.err).toHaveLength(3);
    expect(Object.keys(readRegistry(dataDir).missions)).toEqual([]);
  });

  test('a missing file and broken JSON say what to do', async () => {
    const { run, dataDir } = setup();
    const missing = await run('bureau-plan', 'absent.json');
    expect(missing.code).toBe(1);
    expect(missing.err[0]).toContain('Fichier introuvable : absent.json');
    const broken = await run('bureau-plan', writePlan(dataDir, '{nope', 'casse.json'));
    expect(broken.code).toBe(1);
    expect(broken.err[0]).toContain("n'est pas du JSON valide");
  });

  test('the chef validates in the chat; nobody else can, and only once', async () => {
    const { run, dataDir, as } = setup();
    const id = missionId((await run('bureau-plan', writePlan(dataDir))).out[0]);
    expect((await run('bureau-plan', 'valider', id)).code).toBe(2);
    as('mgr');
    const stranger = await run('bureau-plan', 'valider', id, '--chat');
    expect(stranger.code).toBe(1);
    expect(stranger.err[0]).toContain('Seul le chef');
    as('chef');
    const ok = await run('bureau-plan', 'valider', id, '--chat');
    expect(ok).toMatchObject({ code: 0, out: [`Mission ${id} validée dans le chat.`, 'Tu peux lancer les lots.'] });
    expect(readRegistry(dataDir).missions[id]).toMatchObject({ status: 'validated', validatedVia: 'chat' });
    expect(readRegistry(dataDir).missions[id]!.validatedAt).toBeGreaterThan(0);
    expect((await run('bureau-plan', 'valider', id, '--chat')).code).toBe(1);
    expect((await run('bureau-plan', 'valider', 'm-none', '--chat')).err[0]).toContain('Mission inconnue : m-none');
  });

  test('lots move only once the plan is validated, and agents cannot move them', async () => {
    const { run, dataDir, as } = setup();
    const id = missionId((await run('bureau-plan', writePlan(dataDir))).out[0]);
    const early = await run('bureau-plan', 'lot', id, 'L1', 'running');
    expect(early.code).toBe(1);
    expect(early.err[0]).toContain("n'est pas validé");
    await run('bureau-plan', 'valider', id, '--chat');
    const running = await run('bureau-plan', 'lot', id, 'L1', 'running', '--agent', 'agent');
    expect(running).toMatchObject({ code: 0, out: [`Lot L1 : running (mission ${id})`, 'Agent : agent'] });
    expect(readRegistry(dataDir).missions[id]!.lots[0]).toMatchObject({ state: 'running', agentId: 'agent' });
    expect((await run('bureau-plan', 'lot', id, 'L9', 'done')).err[0]).toContain('Lot inconnu : L9. Lots de la mission : L1, L2.');
    expect((await run('bureau-plan', 'lot', id, 'L1', 'fini')).code).toBe(2);
    as('agent');
    await run('bureau-role', 'agent');
    const refused = await run('bureau-plan', 'lot', id, 'L1', 'done');
    expect(refused.code).toBe(1);
    expect(refused.err[0]).toContain('Seuls le chef et les managers');
  });

  test('fini ends a validated mission, only for its chef', async () => {
    const { run, dataDir, as } = setup();
    const id = missionId((await run('bureau-plan', writePlan(dataDir))).out[0]);
    expect((await run('bureau-plan', 'fini', id)).err[0]).toContain('pas été validé');
    await run('bureau-plan', 'valider', id, '--chat');
    as('mgr');
    expect((await run('bureau-plan', 'fini', id)).err[0]).toContain('Seul le chef');
    as('chef');
    expect(await run('bureau-plan', 'fini', id)).toMatchObject({ code: 0, out: [`Mission ${id} terminée.`] });
    expect(readRegistry(dataDir).missions[id]!.status).toBe('done');
    expect((await run('bureau-plan', 'fini', id)).code).toBe(1);
    expect((await run('bureau-plan', 'lot', id, 'L1', 'done')).err[0]).toContain('est terminée');
  });
});

describe('bureau-rapport', () => {
  test('files the text of the calling thread', async () => {
    const { run, dataDir, as } = setup('agent');
    const result = await run('bureau-rapport', 'Webhook', 'fait', 'et', 'testé.');
    expect(result.code).toBe(0);
    expect(result.out).toEqual(['Rapport déposé (23 octets).', 'Il apparaît dans ta fiche et sur le bureau de ton manager.']);
    expect(readRegistry(dataDir).reports.agent!.text).toBe('Webhook fait et testé.');
    as('mgr');
    await run('bureau-rapport', 'autre');
    expect(Object.keys(readRegistry(dataDir).reports).sort()).toEqual(['agent', 'mgr']);
  });

  test('reads a file with --file, relative to the current folder', async () => {
    const { run, dataDir } = setup('agent');
    writeFileSync(join(dataDir, 'rapport.md'), '## Fait\nTout.\n');
    expect((await run('bureau-rapport', '--file', 'rapport.md')).code).toBe(0);
    expect(readRegistry(dataDir).reports.agent!.text).toBe('## Fait\nTout.');
    expect((await run('bureau-rapport', '--file', 'absent.md')).err[0]).toContain('Fichier introuvable');
    expect((await run('bureau-rapport', '--file', 'rapport.md', 'et du texte')).code).toBe(2);
  });

  test('refuses an empty report and one over 64 KB', async () => {
    const { run, dataDir } = setup('agent');
    expect((await run('bureau-rapport', '   ')).err[0]).toContain('Le rapport est vide');
    const big = await run('bureau-rapport', 'x'.repeat(64 * 1024 + 1));
    expect(big.code).toBe(1);
    expect(big.err[0]).toContain('Rapport trop long');
    expect(readRegistry(dataDir).reports).toEqual({});
    expect((await run('bureau-rapport', 'x'.repeat(64 * 1024))).code).toBe(0);
  });
});

describe('bureau-mission', () => {
  test("prints the org chart of the caller's team, one fact per line", async () => {
    const { run, dataDir, as } = setup('agent');
    await run('bureau-role', 'manager', '--service', 'Développement', '--thread', 'mgr');
    await run('bureau-rapport', 'Webhook livré.\nDétails ensuite.');
    as('chef');
    const id = missionId((await run('bureau-plan', writePlan(dataDir))).out[0]);
    await run('bureau-plan', 'valider', id, '--chat');
    const result = await run('bureau-mission');
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      'Équipe : Mission Boutique (projet Boutique)',
      'Fil appelant : chef',
      `Mission ${id} : Refonte Boutique (validée)`,
      "Résumé : Refaire l'espace client.",
      'Budget : 4 agents au plus ; modèles : claude/claude-sonnet-5-5',
      'Organigramme :',
      'chef (deviné) | Mission Boutique | au repos | modèle : claude-sonnet-5-5 | id : chef',
      '  manager Développement | Manager dev | au travail | modèle : claude-sonnet-5-5 | id : mgr',
      "    agent Développement (deviné) | Agent webhook | attend l'utilisateur (permission) | modèle : claude-haiku-5-5 | id : agent",
      'Lots :',
      'L1 | todo | Développement | Webhook | claude/claude-sonnet-5-5 | agent : aucun',
      'L2 | todo | Qualité | Relecture | claude/claude-opus-5-5 | agent : aucun',
      'Rapports :',
      'agent | Agent webhook : Webhook livré.',
    ]);
  });

  test('chef, responsable and agent all see the same three-floor team, rooted at the chef', async () => {
    const { run, as, dataDir } = setup('resp', floors);
    expect((await run('bureau-role', 'manager', '--service', 'Développement', '--chef', 'chef')).code).toBe(0);
    await run('bureau-role', 'agent', '--service', 'Développement', '--files', 'src/hook.ts', '--thread', 'ag1');
    as('chef');
    const id = missionId((await run('bureau-plan', writePlan(dataDir))).out[0]);
    await run('bureau-plan', 'valider', id, '--chat');
    const seen: Record<string, string[]> = {};
    for (const caller of ['chef', 'resp', 'ag1']) {
      as(caller);
      const result = await run('bureau-mission');
      expect(result.code).toBe(0);
      seen[caller] = result.out;
    }
    expect(seen.chef).toEqual([
      'Équipe : Mission Boutique (projet Boutique)',
      'Fil appelant : chef',
      `Mission ${id} : Refonte Boutique (validée)`,
      "Résumé : Refaire l'espace client.",
      'Budget : 4 agents au plus ; modèles : claude/claude-sonnet-5-5',
      'Organigramme :',
      'chef (deviné) | Mission Boutique | au repos | modèle : claude-sonnet-5-5 | id : chef',
      '  manager Développement | Développement : webhook | au travail | modèle : claude-sonnet-5-5 | id : resp',
      '    agent Développement | Agent webhook | au travail | modèle : claude-haiku-5-5 | id : ag1',
      '    agent Développement (deviné) | Agent tests | terminé | modèle : claude-haiku-5-5 | id : ag2',
      'Lots :',
      'L1 | todo | Développement | Webhook | claude/claude-sonnet-5-5 | agent : aucun',
      'L2 | todo | Qualité | Relecture | claude/claude-opus-5-5 | agent : aucun',
      'Rapports : aucun',
    ]);
    // Same team, same lines; only the caller line changes.
    const sansAppelant = (lines: string[]) => lines.filter((line) => !line.startsWith('Fil appelant'));
    for (const caller of ['resp', 'ag1']) {
      expect(sansAppelant(seen[caller]!)).toEqual(sansAppelant(seen.chef!));
      expect(seen[caller]![1]).toBe(`Fil appelant : ${caller}`);
    }
    type Json = { team: { id: string; agents: { id: string; parentId: string | null; role: string }[] } };
    const json = JSON.parse((await run('bureau-mission', '--json')).out[0]!) as Json;
    expect(json.team.id).toBe('chef');
    expect(json.team.agents.map((agent) => [agent.id, agent.parentId, agent.role])).toEqual([
      ['chef', null, 'chef'],
      ['resp', 'chef', 'manager'],
      ['ag1', 'resp', 'agent'],
      ['ag2', 'resp', 'agent'],
    ]);
  });

  test('before the link, the responsable is a team of its own', async () => {
    const { run } = setup('resp', floors);
    const alone = JSON.parse((await run('bureau-mission', '--json')).out[0]!) as { team: { id: string; agents: { id: string }[] } };
    expect(alone.team.id).toBe('resp');
    expect(alone.team.agents.map((agent) => agent.id)).toEqual(['resp', 'ag1', 'ag2']);
  });

  test('--json gives the team and the caller; a lone thread sees only itself', async () => {
    const { run, as } = setup('agent');
    const result = await run('bureau-mission', '--json');
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(1);
    const data = JSON.parse(result.out[0]!) as { caller: string; team: { id: string; agents: { id: string }[]; mission: unknown } };
    expect(data.caller).toBe('agent');
    expect(data.team.id).toBe('chef');
    expect(data.team.agents.map((agent) => agent.id)).toEqual(['chef', 'mgr', 'agent']);
    expect(data.team.mission).toBeNull();
    as('lone');
    const lone = JSON.parse((await run('bureau-mission', '--json')).out[0]!) as { team: { agents: { id: string }[] } };
    expect(lone.team.agents.map((agent) => agent.id)).toEqual(['lone']);
    const text = await run('bureau-mission');
    expect(text.out).toContain('Mission : aucune. Le chef en propose une avec `boite bureau-plan <plan.json>`.');
    expect(text.out).toContain('Rapports : aucun');
  });

  test('a thread that is in no team and an unreachable core are errors that say what to do', async () => {
    const { run, as, env } = setup('ghost');
    const ghost = await run('bureau-mission');
    expect(ghost.code).toBe(1);
    expect(ghost.err[0]).toContain("n'apparaît dans aucune équipe");
    as('chef');
    env.BOITE_CORE_URL = 'http://127.0.0.1:1';
    const down = await run('bureau-mission');
    expect(down.code).toBe(1);
    expect(down.err[0]).toContain('Boite est injoignable');
  });

  test('a wrong token is refused by the core and reported', async () => {
    const { run, env } = setup('chef');
    env.BOITE_TOKEN = 'wrong';
    const result = await run('bureau-mission');
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain('Boite est injoignable');
  });
});

describe('as a process', () => {
  test('bun src/main.ts runs a command and exits with its code', () => {
    const dataDir = tempDir();
    mkdirSync(dataDir, { recursive: true });
    const run = (...args: string[]) =>
      Bun.spawnSync([process.execPath, join(import.meta.dir, '..', 'src', 'main.ts'), ...args], {
        env: { ...process.env, BOITE_PLUGIN_DATA: dataDir, BOITE_CALLER_THREAD_ID: 'agent' },
        stdout: 'pipe',
        stderr: 'pipe',
      });
    const filed = run('bureau-rapport', 'Fait.');
    expect(filed.exitCode).toBe(0);
    expect(filed.stdout.toString()).toContain('Rapport déposé (5 octets).');
    expect(run('bureau-role', 'patron').exitCode).toBe(2);
    expect(run('bureau').exitCode).toBe(1);
  });
});
