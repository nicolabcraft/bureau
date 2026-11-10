import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestProblems } from '../scripts/check-manifest';
import { parseSkill } from '../scripts/pack';

const manifestText = readFileSync(join(import.meta.dir, '..', 'boite-plugin.json'), 'utf8');
const edit = (change: (manifest: any) => void) => {
  const manifest = JSON.parse(manifestText);
  change(manifest);
  return manifestProblems(JSON.stringify(manifest));
};

describe('the real manifest', () => {
  test('passes the checks', () => {
    expect(manifestProblems(manifestText)).toEqual([]);
  });

  test('declares the commands, the prompt and the two slash commands of the spec', () => {
    const { provides, permissions } = JSON.parse(manifestText);
    expect(provides.commands.map((command: { name: string }) => command.name)).toEqual(['bureau', 'bureau-role', 'bureau-plan', 'bureau-mission', 'bureau-rapport', 'bureau-archive']);
    expect(provides.slashCommands.map((command: { name: string }) => command.name)).toEqual(['bureau', 'mission']);
    expect(provides.prompt.length).toBeLessThanOrEqual(1000);
    expect(provides.service).toEqual({});
    expect(permissions).toEqual(['threads.read', 'threads.write', 'ui.reveal']);
  });
});

describe('check-manifest limits', () => {
  test('an unknown field at any depth is refused', () => {
    expect(edit((m) => (m.extra = 1)).join('\n')).toContain('extra');
    expect(edit((m) => (m.provides.commands[0].shout = true)).join('\n')).toContain('provides.commands[0].shout');
    expect(edit((m) => (m.artifacts.any.size = 3)).join('\n')).toContain('artifacts.any.size');
  });

  test('names are lowercase words joined by hyphens, 40 characters at most', () => {
    expect(edit((m) => (m.provides.commands[0].name = 'Bureau')).length).toBeGreaterThan(0);
    expect(edit((m) => (m.provides.commands[0].name = 'a'.repeat(41))).length).toBeGreaterThan(0);
    expect(edit((m) => (m.provides.commands[0].name = 'a--b')).length).toBeGreaterThan(0);
    expect(edit((m) => (m.provides.commands[0].name = 'a'.repeat(40))).length).toBe(0);
  });

  test('descriptions stop at 200 characters, the prompt at 1000, usage at 200', () => {
    expect(edit((m) => (m.provides.commands[0].description = 'x'.repeat(201))).join('\n')).toContain('description');
    expect(edit((m) => (m.provides.commands[0].description = 'x'.repeat(200))).length).toBe(0);
    expect(edit((m) => (m.provides.prompt = 'x'.repeat(1001))).join('\n')).toContain('provides.prompt');
    expect(edit((m) => (m.provides.commands[0].usage = 'x'.repeat(201))).join('\n')).toContain('usage');
  });

  test('at most 20 commands, skills and slash commands', () => {
    const many = (n: number, entry: object) => Array.from({ length: n }, (_, i) => ({ ...entry, name: `n${i}` }));
    expect(edit((m) => (m.provides.commands = many(21, { description: 'd' }))).join('\n')).toContain('at most 20');
    expect(edit((m) => (m.provides.commands = many(20, { description: 'd' }))).length).toBe(0);
    expect(edit((m) => (m.provides.skills = many(21, { description: 'd', body: 'b' }))).join('\n')).toContain('provides.skills');
    expect(edit((m) => (m.provides.slashCommands = many(21, { description: 'd', prompt: 'p' }))).join('\n')).toContain('provides.slashCommands');
  });

  test('permissions must be known and distinct', () => {
    expect(edit((m) => m.permissions.push('threads.admin')).join('\n')).toContain('permissions[3]');
    expect(edit((m) => m.permissions.push('ui.reveal')).join('\n')).toContain('distinct');
  });

  test('a bun plugin has exactly one artifact, "any", with a 64 hex digest', () => {
    expect(edit((m) => (m.artifacts = { 'win32-x64': m.artifacts.any })).join('\n')).toContain('artifacts');
    expect(edit((m) => (m.artifacts.any.sha256 = 'ABC')).join('\n')).toContain('artifacts.any.sha256');
    expect(edit((m) => (m.artifacts.any.url = 'http://example.com/x.js')).join('\n')).toContain('artifacts.any.url');
  });

  test('service is an empty object, a skill body stops at 32 KB, dashes are refused', () => {
    expect(edit((m) => (m.provides.service = { port: 1 })).join('\n')).toContain('provides.service');
    expect(edit((m) => (m.provides.skills = [{ name: 'a', description: 'd', body: 'x'.repeat(32 * 1024 + 1) }])).join('\n')).toContain('32 KB');
    expect(edit((m) => (m.provides.prompt = `un tiret ${String.fromCharCode(0x2014)} cadratin`)).join('\n')).toContain('dashes');
    expect(edit((m) => (m.provides.commands[0].description = `demi ${String.fromCharCode(0x2013)} cadratin`)).join('\n')).toContain('dashes');
  });

  test('not JSON and not an object are reported', () => {
    expect(manifestProblems('{')[0]).toContain('not JSON');
    expect(manifestProblems('[]')[0]).toContain('must be a JSON object');
  });
});

describe('pack: skill files', () => {
  test('takes the description from the front matter and the body without it', () => {
    const skill = parseSkill('bureau-chef', '---\nname: bureau-chef\ndescription: "Lancer une mission : plan, validation."\n---\n\n# Chef\n\nTexte.\n');
    expect(skill).toEqual({ description: 'Lancer une mission : plan, validation.', body: '# Chef\n\nTexte.\n' });
  });

  test('handles CRLF files and a folded description', () => {
    const skill = parseSkill('x', '---\r\nname: x\r\ndescription: >\r\n  Première ligne\r\n  seconde ligne\r\n---\r\nCorps\r\n');
    expect(skill).toEqual({ description: 'Première ligne seconde ligne', body: 'Corps\n' });
  });

  test('a missing front matter or description is an error in French', () => {
    expect(() => parseSkill('x', '# Sans front matter')).toThrow('front matter');
    expect(() => parseSkill('x', '---\nname: x\n---\nCorps')).toThrow('description');
    expect(() => parseSkill('x', '---\ndescription: d\n---\n')).toThrow('vide');
  });
});
