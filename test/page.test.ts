import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemblePage, readPage, SCENE_FILES, SCRIPTS_MARK } from '../src/page';

const root = join(import.meta.dir, '..');
const page = readPage();
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);

describe('the assembled page', () => {
  test('has the scene then the app glue, and no mark left', () => {
    expect(page.includes(SCRIPTS_MARK)).toBe(false);
    expect(scripts.length).toBe(2);
    for (const name of SCENE_FILES) expect(scripts[0]!.includes(`/* ---- ${name} */`)).toBe(true);
  });

  test('every script parses (a name declared twice in the scene scope fails here)', () => {
    for (const code of scripts) expect(() => new Function(code)).not.toThrow();
  });

  test('no top-level function is declared twice in the scene (the last one would win silently)', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const name of SCENE_FILES) {
      const text = readFileSync(join(root, 'web', 'immeuble', name), 'utf8');
      for (const match of text.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/gm)) {
        const fn = match[1]!;
        if (seen.has(fn)) twice.push(`${fn} (${seen.get(fn)}, ${name})`);
        else seen.set(fn, name);
      }
    }
    expect(twice).toEqual([]);
  });

  test('loads nothing from the network', () => {
    expect(page).not.toMatch(/\b(?:src|href)\s*=\s*["']?https?:/i);
    expect(page).not.toMatch(/\burl\(\s*["']?https?:/i);
    expect(page).not.toMatch(/\bfetch\(\s*["'`]https?:/i);
  });

  test('has no em or en dash and no emoji', () => {
    expect(page).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
    expect(page).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('every scene module exists and is listed once', () => {
    expect(new Set(SCENE_FILES).size).toBe(SCENE_FILES.length);
    for (const name of SCENE_FILES) expect(readFileSync(join(root, 'web', 'immeuble', name), 'utf8').length).toBeGreaterThan(0);
  });
});

describe('assemblePage', () => {
  test('refuses a shell without the mark', () => {
    expect(() => assemblePage('<p></p>', [], '')).toThrow();
  });

  test('refuses a module that would close the script tag', () => {
    expect(() => assemblePage(SCRIPTS_MARK, [{ name: 'x.js', text: 'const s = "</script>";' }], '')).toThrow();
  });

  test('keeps a $ in the code as it is', () => {
    expect(assemblePage(SCRIPTS_MARK, [{ name: 'x.js', text: "const t = '$&$1';" }], '')).toContain("const t = '$&$1';");
  });
});
