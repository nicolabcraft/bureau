import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMission, declareRole, readRegistry, updateRegistry, validatePlan } from '../src/registry';
import { startService, type Service } from '../src/service';
import type { OfficeState } from '../src/model';
import { cleanTempDirs, fakeCore, rawHttp, TOKEN, tempDir, thread, waitFor, type FakeCore } from './helpers';

const PAGE = '<!doctype html><title>Bureau</title>';
const services: Service[] = [];
const cores: FakeCore[] = [];

async function start(extra: Partial<Parameters<typeof startService>[0]> = {}) {
  const dataDir = tempDir();
  const service = await startService({ dataDir, page: PAGE, version: '0.0.0', port: 0, debounceMs: 20, pollMs: 100, log: () => {}, ...extra });
  services.push(service);
  return { service, dataDir };
}
function core(handlers: Parameters<typeof fakeCore>[0] = {}) {
  const fake = fakeCore(handlers);
  cores.push(fake);
  return fake;
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const fake of cores.splice(0)) fake.stop();
});
afterAll(cleanTempDirs);

const post = (service: Service, path: string, body: unknown = {}, headers: Record<string, string> = { 'X-Bureau': '1' }) =>
  fetch(`${service.url.slice(0, -1)}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('without a core', () => {
  test('serves the page and a state that says the core is disconnected', async () => {
    const { service, dataDir } = await start();
    const page = await fetch(service.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toBe(PAGE);
    const state = (await (await fetch(`${service.url}api/state`)).json()) as OfficeState;
    expect(state).toMatchObject({ teams: [], waitingCount: 0, core: 'disconnected' });
    expect(readFileSync(join(dataDir, 'port'), 'utf8')).toBe(String(service.port));
  });

  test('takes the next free port when the first is busy, and removes the port file on stop', async () => {
    const first = await start();
    const dataDir = tempDir();
    const second = await startService({ dataDir, page: PAGE, version: '0.0.0', port: first.service.port, log: () => {} });
    services.push(second);
    expect(second.port).toBeGreaterThan(first.service.port);
    expect(readFileSync(join(dataDir, 'port'), 'utf8')).toBe(String(second.port));
    await second.stop();
    expect(existsSync(join(dataDir, 'port'))).toBe(false);
  });
});

describe('HTTP security', () => {
  test('a foreign Host is refused on every route, with no CORS header', async () => {
    const { service } = await start();
    for (const path of ['/', '/api/state', '/api/events']) {
      const response = await rawHttp(service.port, [`GET ${path} HTTP/1.1`, 'Host: evil.example:80', 'Connection: close']);
      expect(response.status).toBe(403);
      expect(response.head.toLowerCase()).not.toContain('access-control-');
    }
    const wrongPort = await rawHttp(service.port, ['GET /api/state HTTP/1.1', `Host: 127.0.0.1:${service.port + 1}`, 'Connection: close']);
    expect(wrongPort.status).toBe(403);
    const localhost = await rawHttp(service.port, ['GET /api/state HTTP/1.1', `Host: localhost:${service.port}`, 'Connection: close']);
    expect(localhost.status).toBe(403);
    const good = await rawHttp(service.port, ['GET /api/state HTTP/1.1', `Host: 127.0.0.1:${service.port}`, 'Connection: close']);
    expect(good.status).toBe(200);
  });

  test('a POST without X-Bureau is refused', async () => {
    const { service } = await start();
    const response = await post(service, '/api/reveal', { threadId: 'x' }, {});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'En-tête X-Bureau: 1 manquant.' });
    expect((await post(service, '/api/reveal', { threadId: 'x' }, { 'X-Bureau': '0' })).status).toBe(403);
  });

  test('a POST with a foreign Origin is refused, the page\'s own Origin is accepted', async () => {
    const { service } = await start();
    const foreign = await post(service, '/api/reveal', { threadId: 'x' }, { 'X-Bureau': '1', Origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    const sameHostOtherPort = await post(service, '/api/reveal', { threadId: 'x' }, { 'X-Bureau': '1', Origin: `http://127.0.0.1:${service.port + 1}` });
    expect(sameHostOtherPort.status).toBe(403);
    const own = await post(service, '/api/reveal', { threadId: 'x' }, { 'X-Bureau': '1', Origin: `http://127.0.0.1:${service.port}` });
    // Past the guards: the thread is unknown, which is a 404, not a 403.
    expect(own.status).toBe(404);
  });

  test('no response carries a CORS header, and other methods are refused', async () => {
    const { service } = await start();
    for (const response of [await fetch(service.url), await fetch(`${service.url}api/state`), await post(service, '/api/reveal', {}, {})]) {
      expect([...response.headers.keys()].filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
    expect((await fetch(`${service.url}api/state`, { method: 'OPTIONS' })).status).toBe(405);
    expect((await fetch(`${service.url}api/state`, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(`${service.url}nope`)).status).toBe(404);
  });

  test('bad bodies are 400, a missing mission is 404', async () => {
    const { service } = await start();
    const broken = await fetch(`${service.url}api/reveal`, { method: 'POST', headers: { 'X-Bureau': '1' }, body: '{nope' });
    expect(broken.status).toBe(400);
    expect((await post(service, '/api/reveal', { threadId: 3 })).status).toBe(400);
    expect((await post(service, '/api/missions/m-none/validate')).status).toBe(404);
  });
});

describe('events', () => {
  test('SSE sends a full snapshot first and another one when the registry changes', async () => {
    const { service, dataDir } = await start();
    const response = await fetch(`${service.url}api/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events = async (count: number) => {
      while ((buffer.match(/event: state/g) ?? []).length < count) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer.split('\n\n').filter((chunk) => chunk.startsWith('event: state')).map((chunk) => JSON.parse(chunk.split('data: ')[1]!) as OfficeState);
    };
    expect((await events(1))[0]).toMatchObject({ core: 'disconnected', teams: [] });
    // Another process (a command) writes the registry: the page hears of it.
    const plan = validatePlan({ title: 'T', summary: 'S', lots: [{ id: 'L1', title: 't', service: 's', model: 'm' }] });
    if (!plan.ok) throw new Error('plan');
    await updateRegistry(dataDir, (registry) => void createMission(registry, 'chef', plan.plan));
    const later = await events(2);
    expect(later.length).toBeGreaterThanOrEqual(2);
    await reader.cancel();
  });
});

describe('with a core', () => {
  const rows = [
    thread('chef', { title: 'Chef', status: 'idle', updatedAt: 10 }),
    thread('kid', { parentThreadId: 'chef', status: 'running', runningSince: 5, updatedAt: 20 }),
  ];

  async function connected(chef = rows[0]!) {
    const fake = core({
      'threads.list': () => [chef, rows[1]],
      'projects.list': () => [],
      'ui.reveal': () => ({ delivered: 1 }),
      'turns.stop': () => ({ stopped: true }),
      'turns.start': () => ({ id: 'turn' }),
    });
    const started = await start({ coreUrl: fake.url, token: TOKEN });
    await waitFor(() => started.service.snapshot().core === 'connected', 'the core to connect');
    return { fake, ...started };
  }

  test('loads threads and projects at the start, then follows created, updated and removed events', async () => {
    const { fake, service } = await connected();
    expect(fake.calls.map((call) => call.method).sort()).toEqual(['projects.list', 'threads.list']);
    expect(service.snapshot().teams[0]!.agents.map((agent) => agent.id)).toEqual(['chef', 'kid']);
    fake.emit('thread.created', thread('new', { updatedAt: Date.now() }));
    await waitFor(() => service.snapshot().teams.some((team) => team.id === 'new'), 'thread.created');
    fake.emit('thread.updated', { ...rows[1], status: 'waiting', updatedAt: 120 });
    await waitFor(() => service.snapshot().waitingCount === 1, 'thread.updated');
    fake.emit('thread.removed', { threadId: 'new' });
    await waitFor(() => !service.snapshot().teams.some((team) => team.id === 'new'), 'thread.removed');
  });

  test('puts the projects in the state without their path, and asks again for one a new thread brings', async () => {
    let list = [{ id: 'p1', name: 'Boutique', path: '/work/boutique' }];
    const fake = core({ 'threads.list': () => [thread('chef', { projectId: 'p1', updatedAt: Date.now() })], 'projects.list': () => list });
    const { service } = await start({ coreUrl: fake.url, token: TOKEN });
    await waitFor(() => service.snapshot().core === 'connected', 'the core to connect');
    expect(service.snapshot().projects).toEqual([{ id: 'p1', name: 'Boutique' }]);
    expect(service.snapshot().teams[0]).toMatchObject({ projectId: 'p1', projectName: 'Boutique' });
    list = [...list, { id: 'p2', name: 'Atelier', path: '/work/atelier' }];
    fake.emit('thread.created', thread('solo', { projectId: 'p2', updatedAt: Date.now() }));
    await waitFor(() => service.snapshot().teams.find((team) => team.id === 'solo')?.projectName === 'Atelier', 'the new project');
    const state = (await (await fetch(`${service.url}api/state`)).json()) as OfficeState;
    expect(state.projects.map((project) => project.id)).toEqual(['p1', 'p2']);
    expect(JSON.stringify(state)).not.toContain('/work/');
    // A project the core does not know is asked about once, not at every event.
    const asked = () => fake.calls.filter((call) => call.method === 'projects.list').length;
    fake.emit('thread.created', thread('lost', { projectId: 'gone', updatedAt: Date.now() }));
    await waitFor(() => asked() === 3, 'one more projects.list');
    fake.emit('thread.updated', thread('lost', { projectId: 'gone', status: 'running', updatedAt: Date.now() + 1 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(asked()).toBe(3);
  });

  test('a responsable started apart joins the chef team as soon as it declares its chef', async () => {
    const now = Date.now();
    const chef = thread('chef', { title: 'Chef', updatedAt: now });
    const resp = thread('resp', { title: 'Développement : webhook', status: 'running', runningSince: 5, createdAt: 2, updatedAt: now });
    const agent = thread('ag', { title: 'Agent', parentThreadId: 'resp', createdAt: 3, updatedAt: now });
    const fake = core({ 'threads.list': () => [chef, resp, agent], 'projects.list': () => [] });
    const { service, dataDir } = await start({ coreUrl: fake.url, token: TOKEN });
    await waitFor(() => service.snapshot().core === 'connected', 'the core to connect');
    expect(service.snapshot().teams.map((team) => team.id).sort()).toEqual(['chef', 'resp']);
    await updateRegistry(dataDir, (registry) => declareRole(registry, 'resp', { role: 'manager', service: 'Développement', chefId: 'chef' }));
    await waitFor(() => service.snapshot().teams.length === 1, 'the registry change');
    const state = (await (await fetch(`${service.url}api/state`)).json()) as OfficeState;
    expect(state.teams.map((team) => team.id)).toEqual(['chef']);
    expect(state.teams[0]!.agents.map((entry) => [entry.id, entry.parentId, entry.role, entry.service])).toEqual([
      ['chef', null, 'chef', null],
      ['resp', 'chef', 'manager', 'Développement'],
      ['ag', 'resp', 'agent', 'Développement'],
    ]);
  });

  test('reveal calls ui.reveal and stop calls turns.stop', async () => {
    const { fake, service } = await connected();
    const revealed = await post(service, '/api/reveal', { threadId: 'kid' });
    expect(await revealed.json()).toEqual({ ok: true, delivered: 1 });
    expect(fake.calls.find((call) => call.method === 'ui.reveal')!.params).toEqual({ target: { kind: 'thread', threadId: 'kid' } });
    const stopped = await post(service, '/api/stop', { threadId: 'kid' });
    expect(await stopped.json()).toEqual({ ok: true, stopped: true });
    expect(fake.calls.find((call) => call.method === 'turns.stop')!.params).toEqual({ threadId: 'kid' });
    expect((await post(service, '/api/stop', { threadId: 'ghost' })).status).toBe(404);
  });

  test('a refusal by the core is a 502 that carries its message', async () => {
    const { fake, service } = await connected();
    fake.on('turns.stop', () => {
      throw new Error('refusé par le test');
    });
    const response = await post(service, '/api/stop', { threadId: 'kid' });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain('refusé par le test');
  });

  async function propose(dataDir: string, chefId: string): Promise<string> {
    const plan = validatePlan({ title: 'T', summary: 'S', lots: [{ id: 'L1', title: 't', service: 's', model: 'm' }] });
    if (!plan.ok) throw new Error('plan');
    return updateRegistry(dataDir, (registry) => createMission(registry, chefId, plan.plan).id);
  }

  test('validate marks the mission and sends the chef the notice at once when it is idle', async () => {
    const { fake, service, dataDir } = await connected();
    const id = await propose(dataDir, 'chef');
    const response = await post(service, `/api/missions/${id}/validate`);
    expect(await response.json()).toEqual({ ok: true, notified: true });
    const mission = readRegistry(dataDir).missions[id]!;
    expect(mission).toMatchObject({ status: 'validated', validatedVia: 'bureau' });
    expect(fake.calls.filter((call) => call.method === 'turns.start').map((call) => call.params)).toEqual([
      { threadId: 'chef', prompt: `Le plan ${id} a été validé dans Bureau. Lance les lots.` },
    ]);
    expect(readRegistry(dataDir).pendingNotices).toEqual([]);
    // Validating twice does not tell the chef twice.
    expect(await (await post(service, `/api/missions/${id}/validate`)).json()).toEqual({ ok: true, notified: true });
    expect(fake.calls.filter((call) => call.method === 'turns.start')).toHaveLength(1);
  });

  test('a busy chef keeps the notice pending until it is idle again', async () => {
    const { fake, service, dataDir } = await connected({ ...rows[0]!, status: 'running' });
    const id = await propose(dataDir, 'chef');
    const response = await post(service, `/api/missions/${id}/validate`);
    expect(await response.json()).toEqual({ ok: true, notified: false });
    expect(readRegistry(dataDir).pendingNotices).toHaveLength(1);
    expect(fake.calls.some((call) => call.method === 'turns.start')).toBe(false);
    fake.emit('thread.updated', { ...rows[0], status: 'idle', updatedAt: 50 });
    await waitFor(() => fake.calls.some((call) => call.method === 'turns.start'), 'the notice to be sent');
    await waitFor(() => readRegistry(dataDir).pendingNotices.length === 0, 'the notice to be cleared');
  });

  test('a refused turns.start leaves the notice for the next idle event', async () => {
    const { fake, service, dataDir } = await connected();
    let refuse = true;
    fake.on('turns.start', () => {
      if (refuse) throw new Error('un tour est déjà en cours');
      return { id: 'turn' };
    });
    const id = await propose(dataDir, 'chef');
    expect(await (await post(service, `/api/missions/${id}/validate`)).json()).toEqual({ ok: true, notified: false });
    refuse = false;
    fake.emit('thread.updated', { ...rows[0], status: 'idle', updatedAt: 60 });
    await waitFor(() => readRegistry(dataDir).pendingNotices.length === 0, 'the retried notice');
  });

  test('without a core, validate keeps the notice pending', async () => {
    const { service, dataDir } = await start();
    const id = await propose(dataDir, 'chef');
    expect(await (await post(service, `/api/missions/${id}/validate`)).json()).toEqual({ ok: true, notified: false });
    expect(readRegistry(dataDir).missions[id]!.status).toBe('validated');
    expect(readRegistry(dataDir).pendingNotices).toHaveLength(1);
  });

  test('says the core is disconnected when it goes away, and keeps the last known threads', async () => {
    const { fake, service } = await connected();
    expect(fake.clients()).toBe(1);
    fake.stop();
    await waitFor(() => service.snapshot().core === 'disconnected', 'the core to be seen as gone');
    expect(service.snapshot().teams).toHaveLength(1);
    const response = await post(service, '/api/reveal', { threadId: 'kid' });
    expect(response.status).toBe(503);
  });
});
