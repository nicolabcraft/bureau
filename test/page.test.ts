import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemblePage, PIXEL_FILES, readIsoPage, readPage, SCENE_FILES, SCRIPTS_MARK } from '../src/page';

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const scriptsOf = (html: string) => html.split('<script>').slice(1).map((part) => part.split('</script>')[0]!);

/* Size of the assembled pixel page at L8: about 523 Ko (noted, no hard threshold). */

const page = readPage();
const pixelScripts = scriptsOf(page);

describe('the assembled pixel page (readPage)', () => {
  test('is assembled: the mark is replaced, one script for the module group, one for app.js', () => {
    expect(page.includes(SCRIPTS_MARK)).toBe(false);
    expect(pixelScripts.length).toBe(2);
    for (const name of PIXEL_FILES) expect(pixelScripts[0]!.includes(`/* ---- ${name} */`)).toBe(true);
    expect(pixelScripts[1]!.includes('window.Pixel')).toBe(true);
  });

  test('every script parses, without being run', () => {
    for (const code of pixelScripts) expect(() => new Function(code)).not.toThrow();
  });

  test('no top-level name is declared twice in web/pixel/ (app.js is its own script)', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const name of PIXEL_FILES) {
      const text = read(`web/pixel/${name}`).split('\r\n').join('\n');
      for (const match of text.matchAll(/^(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) {
        const id = match[1]!;
        if (seen.has(id)) twice.push(`${id} (${seen.get(id)}, ${name})`);
        else seen.set(id, name);
      }
    }
    expect(twice).toEqual([]);
  });

  test('loads nothing from the network (licence comments and local addresses aside)', () => {
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const remote = code.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"'`)]*/gi) ?? [];
    expect(remote).toEqual([]);
    expect(code).not.toMatch(/@import/);
    expect(code).not.toMatch(/\bsrc\s*=\s*["']?\s*\/\//i);
    expect(code).not.toMatch(/\bsrc\s*=\s*["']?https?:/i);
    expect(code).not.toMatch(/\bfetch\(\s*["'`]https?:/i);
  });

  test('has no em dash, no en dash and no emoji', () => {
    expect(page).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
    expect(page).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('every id of the table in docs/vue-pixel.md 2.10 exists in shell.html', () => {
    const shell = read('web/pixel/shell.html');
    const ids = ['scene', 'texte', 'etages', 'zoom', 'pan', 'puce', 'bVueAvancee', 'bPlanTech', 'dialog', 'journal',
      'fiche', 'bAttente', 'bPlan', 'bandeau', 'toast', 'pied'];
    const missing = ids.filter((id) => !shell.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  test('PIXEL_FILES lists 22 distinct modules, each one present', () => {
    expect(PIXEL_FILES.length).toBe(22);
    expect(new Set(PIXEL_FILES).size).toBe(PIXEL_FILES.length);
    for (const name of PIXEL_FILES) expect(read(`web/pixel/${name}`).length).toBeGreaterThan(0);
  });
});

describe('the isometric page (readIsoPage, kept and tested, not served)', () => {
  const isoPage = readIsoPage();
  const isoScripts = scriptsOf(isoPage);

  test('has the scene then the app glue, and no mark left', () => {
    expect(isoPage.includes(SCRIPTS_MARK)).toBe(false);
    expect(isoScripts.length).toBe(2);
    for (const name of SCENE_FILES) expect(isoScripts[0]!.includes(`/* ---- ${name} */`)).toBe(true);
  });

  test('every script parses (a name declared twice in the scene scope fails here)', () => {
    for (const code of isoScripts) expect(() => new Function(code)).not.toThrow();
  });

  test('no top-level function is declared twice in the scene (the last one would win silently)', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const name of SCENE_FILES) {
      const text = read(`web/immeuble/${name}`);
      for (const match of text.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/gm)) {
        const fn = match[1]!;
        if (seen.has(fn)) twice.push(`${fn} (${seen.get(fn)}, ${name})`);
        else seen.set(fn, name);
      }
    }
    expect(twice).toEqual([]);
  });

  test('loads nothing from the network', () => {
    expect(isoPage).not.toMatch(/\b(?:src|href)\s*=\s*["']?https?:/i);
    expect(isoPage).not.toMatch(/\burl\(\s*["']?https?:/i);
    expect(isoPage).not.toMatch(/\bfetch\(\s*["'`]https?:/i);
  });

  test('has no em or en dash and no emoji', () => {
    expect(isoPage).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
    expect(isoPage).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('every scene module exists and is listed once', () => {
    expect(new Set(SCENE_FILES).size).toBe(SCENE_FILES.length);
    for (const name of SCENE_FILES) expect(read(`web/immeuble/${name}`).length).toBeGreaterThan(0);
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
