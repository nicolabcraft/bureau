import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquireLock,
  declareRole,
  emptyRegistry,
  lockPath,
  parseRegistry,
  readRegistry,
  registryPath,
  RegistryError,
  updateRegistry,
  validatePlan,
} from '../src/registry';
import { cleanTempDirs, tempDir } from './helpers';

afterAll(cleanTempDirs);

describe('read and write', () => {
  test('a missing file is an empty registry', () => {
    expect(readRegistry(tempDir())).toEqual({ version: 1, roles: {}, missions: {}, reports: {}, pendingNotices: [] });
  });

  test('an update is written atomically and leaves no temporary file or lock', async () => {
    const dir = tempDir();
    await updateRegistry(dir, (registry) => declareRole(registry, 't1', { role: 'manager', service: 'Design' }, 5));
    expect(readRegistry(dir).roles.t1).toEqual({ role: 'manager', service: 'Design', files: [], at: 5 });
    expect(readdirSync(dir).sort()).toEqual(['registre.json']);
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  test('a chef link is stored, kept by a later declaration of a manager and cleared for another role', () => {
    const registry = emptyRegistry();
    declareRole(registry, 't1', { role: 'manager', service: 'Design', chefId: 'boss' }, 1);
    expect(registry.roles.t1).toEqual({ role: 'manager', service: 'Design', files: [], at: 1, chefId: 'boss' });
    declareRole(registry, 't1', { role: 'manager', files: ['a.ts'] }, 2);
    expect(registry.roles.t1).toMatchObject({ service: 'Design', files: ['a.ts'], chefId: 'boss' });
    declareRole(registry, 't1', { role: 'agent' }, 3);
    expect(registry.roles.t1).not.toHaveProperty('chefId');
    expect(parseRegistry(JSON.stringify({ version: 1, roles: { x: { role: 'manager', service: null, files: [], at: 1, chefId: 'boss' } } })).roles.x?.chefId).toBe('boss');
  });

  test('a change that throws writes nothing and frees the lock', async () => {
    const dir = tempDir();
    await updateRegistry(dir, (registry) => declareRole(registry, 'keep', { role: 'agent' }));
    const before = readFileSync(registryPath(dir), 'utf8');
    await expect(
      updateRegistry(dir, (registry) => {
        declareRole(registry, 'lost', { role: 'chef' });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(readFileSync(registryPath(dir), 'utf8')).toBe(before);
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  test('a corrupt or foreign file is a French error that says what to do', () => {
    expect(() => parseRegistry('{nope')).toThrow(RegistryError);
    expect(() => parseRegistry('{nope')).toThrow(/Supprime ce fichier/);
    expect(() => parseRegistry('{"version":2}')).toThrow(/version inconnue/);
  });
});

describe('lock', () => {
  test('parallel writers lose no update', async () => {
    const dir = tempDir();
    await Promise.all(Array.from({ length: 25 }, (_, index) => updateRegistry(dir, (registry) => declareRole(registry, `t${index}`, { role: 'agent' }))));
    expect(Object.keys(readRegistry(dir).roles)).toHaveLength(25);
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  test('a held lock makes the next writer wait, then give up with a message', async () => {
    const dir = tempDir();
    const release = await acquireLock(dir);
    const started = Date.now();
    await expect(acquireLock(dir, { waitMs: 200 })).rejects.toThrow(/verrouillé/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    release();
    const again = await acquireLock(dir, { waitMs: 200 });
    again();
  });

  test('a waiting writer gets the lock once it is released', async () => {
    const dir = tempDir();
    const release = await acquireLock(dir);
    setTimeout(release, 80);
    const next = await acquireLock(dir, { waitMs: 2_000 });
    expect(existsSync(lockPath(dir))).toBe(true);
    next();
  });

  test('a lock older than 30 seconds is taken over', async () => {
    const dir = tempDir();
    writeFileSync(lockPath(dir), 'dead 0\n');
    const old = new Date(Date.now() - 31_000);
    utimesSync(lockPath(dir), old, old);
    await updateRegistry(dir, (registry) => declareRole(registry, 'x', { role: 'chef' }), { waitMs: 300 });
    expect(readRegistry(dir).roles.x?.role).toBe('chef');
  });

  test('a fresh lock is not taken over', async () => {
    const dir = tempDir();
    writeFileSync(lockPath(dir), 'alive\n');
    await expect(acquireLock(dir, { waitMs: 150 })).rejects.toThrow(RegistryError);
  });
});

describe('plan validation', () => {
  const good = () => ({
    title: 'Refonte',
    summary: 'Deux lignes.',
    budget: { maxAgents: 8, models: ['claude/claude-sonnet-5-5'] },
    lots: [
      { id: 'L1', title: 'Webhook', service: 'Développement', model: 'claude/claude-sonnet-5-5' },
      { id: 'L2', title: 'Relecture', service: 'Qualité', model: 'claude/claude-opus-5-5' },
    ],
  });

  test('accepts the plan of the spec and fills the budget when absent', () => {
    const result = validatePlan(good());
    expect(result.ok).toBe(true);
    const { budget: _budget, ...bare } = good();
    const bareResult = validatePlan(bare);
    expect(bareResult.ok && bareResult.plan.budget).toEqual({ maxAgents: null, models: [] });
  });

  test('reports every problem at once, in French, with the field to fix', () => {
    const result = validatePlan({ title: '', summary: 3, lots: [{ id: 'bad id!', title: 'x', service: 'Dev' }], extra: true });
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.errors;
    expect(errors.join('\n')).toContain('Champ inconnu « extra »');
    expect(errors.join('\n')).toContain('« title » doit être');
    expect(errors.join('\n')).toContain('« summary » doit être');
    expect(errors.join('\n')).toContain('« lots[0].id » doit faire 1 à 20 caractères');
    expect(errors.join('\n')).toContain('« lots[0].model »');
  });

  test('refuses a duplicate lot id and names it', () => {
    const plan = good();
    plan.lots[1]!.id = 'L1';
    const result = validatePlan(plan);
    expect(result.ok ? '' : result.errors.join('\n')).toContain('l\'id « L1 » est déjà pris');
  });

  test('refuses zero lots, more than 40 lots and a lots that is not a list', () => {
    const none = validatePlan({ ...good(), lots: [] });
    expect(none.ok ? '' : none.errors[0]).toContain('de 1 à 40 lots (il en contient 0)');
    const many = validatePlan({ ...good(), lots: Array.from({ length: 41 }, (_, i) => ({ id: `L${i}`, title: 't', service: 's', model: 'm' })) });
    expect(many.ok ? '' : many.errors[0]).toContain('(il en contient 41)');
    const notList = validatePlan({ ...good(), lots: 'L1' });
    expect(notList.ok ? '' : notList.errors[0]).toContain('« lots » doit être une liste');
  });

  test('refuses a bad budget', () => {
    const result = validatePlan({ ...good(), budget: { maxAgents: 0, models: [3], more: 1 } });
    const text = result.ok ? '' : result.errors.join('\n');
    expect(text).toContain('budget.maxAgents');
    expect(text).toContain('budget.models');
    expect(text).toContain('budget.more');
  });

  test('refuses what is not an object', () => {
    for (const value of [null, [], 'plan', 3]) expect(validatePlan(value).ok).toBe(false);
  });

  test('accepts a lot id of 20 characters and refuses 21', () => {
    const plan = good();
    plan.lots[0]!.id = 'a'.repeat(20);
    expect(validatePlan(plan).ok).toBe(true);
    plan.lots[0]!.id = 'a'.repeat(21);
    expect(validatePlan(plan).ok).toBe(false);
  });
});
