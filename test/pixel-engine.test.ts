import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const FILES = ['palette.js', 'font.js', 'engine.js'] as const;
type File = (typeof FILES)[number];
const sources = Object.fromEntries(FILES.map((name) => [name, readFileSync(join(root, 'web', 'pixel', name), 'utf8')])) as Record<File, string>;

// Public names of docs/vue-pixel.md 2.3; every other top-level name wears the prefix of its file.
const PUBLIC: Record<File, string[]> = {
  'palette.js': ['PALETTE', 'rgb'],
  'font.js': ['FONT_H', 'textWidth', 'drawText', 'wrapText'],
  'engine.js': ['makeBuffer', 'rect', 'bakeRows', 'hash', 'clamp', 'REDUCED', 'seedRandom', 'rnd', 'pick', 'ZOOMS', 'Camera', 'presentBuffer', 'startLoop', 'PART', 'emitParticle', 'tickParticles', 'drawParticles'],
};
const PREFIX: Record<File, string> = { 'palette.js': 'pal', 'font.js': 'fnt', 'engine.js': 'eng' };

// 2.3: A-Z a-z 0-9, . , : ; ! ? ' ( ) / + - %, \u00e9 \u00e8 \u00ea \u00eb \u00e0 \u00e2 \u00f4 \u00fb \u00f9 \u00ee \u00ef \u00e7 \u00c9 \u00c8 \u00ca \u00c0 \u00c7, \u0153 \u0152 \u00ab \u00bb \u2019 \u00fc, space.
const CONTRACT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  ".,:;!?'()/+-%" +
  '\u00e9\u00e8\u00ea\u00eb\u00e0\u00e2\u00f4\u00fb\u00f9\u00ee\u00ef\u00e7\u00c9\u00c8\u00ca\u00c0\u00c7' +
  '\u0153\u0152\u00ab\u00bb\u2019\u00fc ';

type Ctx = { fillStyle: string; imageSmoothingEnabled: boolean; calls: any[][]; fillRect(...a: any[]): void; drawImage(...a: any[]): void };
type Env = {
  api: any;
  win: { devicePixelRatio: number };
  doc: { hidden: boolean; listeners: Record<string, (() => void)[]> };
  raf: { queue: Map<number, (t: number) => void>; step(ts: number): void; pending(): number };
  perf: { t: number };
  media: { fire(matches: boolean): void };
  canvases: any[];
};

/** Runs the three files in ONE scope (like the page does) against a fake browser. */
function load(): Env {
  const canvases: any[] = [];
  const newCanvas = () => {
    const ctx: Ctx = {
      fillStyle: '#000000',
      imageSmoothingEnabled: true,
      calls: [],
      fillRect(...a) { this.calls.push(['fillRect', this.fillStyle, ...a]); },
      drawImage(...a) { this.calls.push(['drawImage', ...a.slice(1)]); },
    };
    let width = 300;
    let height = 150;
    const canvas: any = {
      style: {},
      ctx,
      getContext: () => ctx,
      get width() { return width; },
      set width(v: number) { width = v; ctx.imageSmoothingEnabled = true; ctx.calls = []; },
      get height() { return height; },
      set height(v: number) { height = v; ctx.imageSmoothingEnabled = true; ctx.calls = []; },
    };
    canvases.push(canvas);
    return canvas;
  };
  const doc = {
    hidden: false,
    listeners: {} as Record<string, (() => void)[]>,
    createElement: () => newCanvas(),
    addEventListener(type: string, fn: () => void) { (doc.listeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: () => void) { doc.listeners[type] = (doc.listeners[type] ?? []).filter((f) => f !== fn); },
  };
  const win = { devicePixelRatio: 1 };
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();
  const raf = {
    queue,
    step(ts: number) { const fns = [...queue.values()]; queue.clear(); for (const f of fns) f(ts); },
    pending: () => queue.size,
  };
  const requestAnimationFrame = (fn: (t: number) => void) => { const id = nextId++; queue.set(id, fn); return id; };
  const cancelAnimationFrame = (id: number) => { queue.delete(id); };
  const perf = { t: 0 };
  const performance = { now: () => perf.t };
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const matchMedia = () => ({ matches: false, addEventListener: (_: string, fn: any) => { listener = fn; } });
  const code = `'use strict';\n${FILES.map((f) => sources[f]).join('\n')}
return { PALETTE, rgb, palColor, setStrict(v) { palStrict = v; }, FONT_H, fntChars, fntGlyph, fntSanitize, textWidth, drawText, wrapText,
  makeBuffer, rect, bakeRows, hash, clamp, get REDUCED() { return REDUCED; }, seedRandom, rnd, pick, ZOOMS, Camera, presentBuffer, startLoop,
  PART, emitParticle, tickParticles, drawParticles };`;
  const api = new Function('document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', code)(
    doc, win, matchMedia, requestAnimationFrame, cancelAnimationFrame, performance);
  return { api, win, doc, raf, perf, canvases, media: { fire: (matches) => listener?.({ matches }) } };
}

const env = load();
const A = env.api;

function topLevelNames(text: string): string[] {
  return [...text.matchAll(/^(?:(?:const|let|var|class)\s+|(?:async\s+)?function\s*\*?\s*)([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
}

describe('the three files share one scope', () => {
  test('every top-level name is public (2.3) or wears the prefix of its file', () => {
    for (const f of FILES) {
      for (const name of topLevelNames(sources[f])) {
        expect(PUBLIC[f].includes(name) || name.startsWith(PREFIX[f])).toBe(true);
      }
    }
  });

  test('every public name is declared, in its own file', () => {
    for (const f of FILES) for (const name of PUBLIC[f]) expect(topLevelNames(sources[f])).toContain(name);
  });

  test('no top-level name is declared twice across the files', () => {
    const all = FILES.flatMap((f) => topLevelNames(sources[f]));
    expect(all.length).toBe(new Set(all).size);
  });

  test('they run together under strict mode and export every public name', () => {
    for (const f of FILES) for (const name of PUBLIC[f]) expect(A[name]).toBeDefined();
  });

  test('nothing is drawn or scheduled at load', () => {
    const fresh = load();
    expect(fresh.canvases.length).toBe(0);
    expect(fresh.raf.pending()).toBe(0);
    expect(Object.keys(fresh.doc.listeners)).toEqual([]);
  });

  test('no remote resource, no em or en dash, no emoji', () => {
    for (const f of FILES) {
      expect(sources[f]).not.toMatch(/https?:\/\//i);
      expect(sources[f]).not.toMatch(/\b(?:fetch|XMLHttpRequest|import)\b\s*\(/);
      expect(sources[f]).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
      expect(sources[f]).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('palette', () => {
  const names = Object.keys(A.PALETTE);
  test('has the 39 colours of the mockup, with unique names and valid hex', () => {
    expect(names.length).toBe(39);
    expect(new Set(names).size).toBe(39);
    for (const n of names) expect(A.PALETTE[n]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const n of ['ink', 'night', 'wallHi', 'base', 'parqLn', 'steelL', 'lampHi', 'leafL', 'glassHi', 'white', 'skinC', 'sky']) expect(names).toContain(n);
    expect(new Set(Object.values(A.PALETTE).map((h: any) => h.toLowerCase())).size).toBe(39);
  });

  test('palColor accepts a name or a #rrggbb and throws on the rest (strict)', () => {
    expect(A.palColor('ink')).toBe('#1A212E');
    expect(A.palColor('#12abEF')).toBe('#12abEF');
    for (const bad of ['nope', '#abc', 'toString', '', undefined]) expect(() => A.palColor(bad)).toThrow();
  });

  test('rgb gives [r, g, b], memoised', () => {
    expect([...A.rgb('ink')]).toEqual([0x1a, 0x21, 0x2e]);
    expect([...A.rgb('#ff0080')]).toEqual([255, 0, 128]);
    expect(A.rgb('sky')).toBe(A.rgb('sky'));
    expect(() => A.rgb('nope')).toThrow();
  });

  test('in production (palStrict false) an unknown name gives magenta, and strict mode comes back', () => {
    const fresh = load().api;
    fresh.setStrict(false);
    expect([...fresh.rgb('nope')]).toEqual([255, 0, 255]);
    expect(fresh.palColor('nope')).toBe('#FF00FF');
    fresh.setStrict(true);
    expect(() => fresh.rgb('nope')).toThrow();
  });
});

describe('font', () => {
  const chars = [...A.fntChars] as string[];
  const inked = (ch: string): number[] => A.fntGlyph(ch).rows.map((r: string, i: number) => (r.includes('#') ? i : -1)).filter((i: number) => i >= 0);

  test('draws exactly the character set of 2.3', () => {
    expect(chars.length).toBe(new Set(chars).size);
    expect([...chars].sort()).toEqual([...CONTRACT_CHARS].sort());
    expect(A.FONT_H).toBe(11);
  });

  test('every character of the set has a glyph, none outside it has one', () => {
    for (const ch of chars) expect(A.fntGlyph(ch)).not.toBeNull();
    for (let cp = 0; cp < 0x3000; cp++) {
      const ch = String.fromCharCode(cp);
      if (!chars.includes(ch)) expect(A.fntGlyph(ch)).toBeNull();
    }
    expect(A.fntGlyph('')).toBeNull();
    expect(A.fntGlyph('\ud83d\ude00')).toBeNull();
  });

  test('glyphs are FONT_H rows of w columns made of # and ., inked unless it is the space', () => {
    for (const ch of chars) {
      const g = A.fntGlyph(ch);
      expect(g.rows.length).toBe(11);
      for (const row of g.rows) expect(row).toMatch(new RegExp(`^[#.]{${g.w}}$`));
      expect(g.rows.join('').includes('#')).toBe(ch !== ' ');
    }
    expect(A.fntGlyph(' ').w).toBe(3);
  });

  test('letters sit on the right rows (capitals 2-8, marks above, descenders below)', () => {
    expect(inked('H')).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(inked('x')).toEqual([4, 5, 6, 7, 8]);
    expect(Math.max(...inked('g'))).toBe(10);
    for (const ch of '\u00c9\u00c8\u00ca\u00c0') expect(Math.min(...inked(ch))).toBe(0);
    for (const ch of '\u00e9\u00e8\u00ea\u00e0\u00e2\u00f4\u00fb\u00f9\u00eb\u00fc\u00ee\u00ef') expect(Math.min(...inked(ch))).toBeLessThan(4);
    for (const ch of '\u00e7\u00c7') expect(Math.max(...inked(ch))).toBe(10);
    expect(Math.max(...inked(';'))).toBe(9);
  });

  test('lowercase k is not a small K: bare stem on rows 2-3, branches only from the x-height row', () => {
    const k = A.fntGlyph('k').rows;
    expect(k[2]).toBe('#...');
    expect(k[3]).toBe('#...');
    expect(k.slice(4, 9).every((r: string) => r.replace(/\./g, '').length >= 2)).toBe(true);
    expect(k.join('/')).not.toBe(A.fntGlyph('K').rows.join('/'));
    expect(A.fntGlyph('K').rows[2]).not.toBe(k[2]); // K has a leg from its first row
  });

  test('glyphs stay distinct: no two characters look the same (except the two apostrophes)', () => {
    const seen = new Map<string, string>();
    for (const ch of chars) {
      const key = A.fntGlyph(ch).rows.join('/');
      const other = seen.get(key);
      if (other) expect(new Set([ch, other])).toEqual(new Set(["'", '\u2019']));
      seen.set(key, ch);
    }
  });

  test('textWidth: glyphs 1 pixel apart, a space advances 4, unknown characters count for nothing', () => {
    expect(A.textWidth('')).toBe(0);
    expect(A.textWidth('H')).toBe(5);
    expect(A.textWidth('HH')).toBe(11);
    expect(A.textWidth('H H')).toBe(5 + 1 + 3 + 1 + 5); // H, gap, space glyph (3), gap, H
    expect(A.textWidth('i')).toBe(1);
    expect(A.textWidth('\u0153')).toBe(A.fntGlyph('\u0153').w);
    expect(A.textWidth('\ud83d\ude00')).toBe(0);
    expect(A.textWidth('H\ud83d\ude00H')).toBe(11);
  });

  test('fntSanitize', () => {
    expect(A.fntSanitize('a\u2014b\u2013c')).toBe('a-b-c');
    expect(A.fntSanitize('l\u2019\u00e9t\u00e9')).toBe("l'\u00e9t\u00e9");
    expect(A.fntSanitize('a   b \t\n c')).toBe('a b c');
    expect(A.fntSanitize('a \ud83d\ude80 b')).toBe('a b');
    expect(A.fntSanitize('ok\ud83d\ude00')).toBe('ok');
    expect(A.fntSanitize('\u00ab \u0153uvre \u0152, \u00fc, \u00eb \u00bb')).toBe('\u00ab \u0153uvre \u0152, \u00fc, \u00eb \u00bb');
    expect(A.fntSanitize('100% (ok); non: oui? !/+-')).toBe('100% (ok); non: oui? !/+-');
    expect(A.fntSanitize('\u4e2d\u6587 x')).toBe(' x');
    const long = 'abc '.repeat(100);
    expect(A.fntSanitize(long)).toBe(long);
    expect(A.fntSanitize(CONTRACT_CHARS).length).toBe(CONTRACT_CHARS.length); // the curly apostrophe becomes a straight one, same length
    for (const ch of A.fntSanitize('T\u00eat\u00e9 \u2014 \u201cquote\u201d \u2026 na\u00efve \u2764\ufe0f caf\u00e9 \u0153')) expect(A.fntGlyph(ch)).not.toBeNull();
  });

  test('wrapText keeps every word, wraps within maxW and never returns nothing', () => {
    const s = 'le lot est pour toi : refaire la page des etages';
    for (const maxW of [60, 90, 200]) {
      const lines = A.wrapText(s, maxW);
      expect(lines.join(' ')).toBe(s);
      for (const l of lines) expect(A.textWidth(l)).toBeLessThanOrEqual(maxW);
    }
    expect(A.wrapText('', 50)).toEqual(['']);
    const cut = A.wrapText('abcdefghijklmnopqrstuvwxyz', 30);
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.join('')).toBe('abcdefghijklmnopqrstuvwxyz');
    for (const l of cut) expect(A.textWidth(l)).toBeLessThanOrEqual(30);
  });

  test('drawText blits one glyph per drawable character at the right x, skips unknown characters, one atlas per colour', () => {
    const { g } = A.makeBuffer(100, 20);
    g.calls = [];
    const before = env.canvases.length;
    A.drawText(g, 'Hi \ud83d\ude00!', 10.4, 3.6, 'ink');
    const blits = g.calls.filter((c: any[]) => c[0] === 'drawImage');
    expect(blits.length).toBe(3); // H, i, ! (the space and the emoji draw nothing)
    expect(blits.map((c: any[]) => c[5])).toEqual([10, 16, 22]); // H 5 + 1, i 1 + 1, space 3 + 1
    expect(blits.map((c: any[]) => c[3])).toEqual([5, 1, 1]);
    for (const c of blits) { expect(c[8]).toBe(11); expect(c[2]).toBe(0); expect(c[6]).toBe(4); }
    expect(env.canvases.length).toBe(before + 1); // the atlas of ink
    A.drawText(g, 'Hello', 0, 0, 'ink');
    expect(env.canvases.length).toBe(before + 1);
    A.drawText(g, 'Hello', 0, 0, 'red');
    expect(env.canvases.length).toBe(before + 2);
    expect(() => A.drawText(g, 'x', 0, 0, 'nope')).toThrow();
  });
});

describe('engine helpers', () => {
  test('makeBuffer gives { c, g } of the size with smoothing off', () => {
    const { c, g } = A.makeBuffer(7, 5);
    expect([c.width, c.height]).toEqual([7, 5]);
    expect(g.imageSmoothingEnabled).toBe(false);
  });

  test('rect rounds and resolves palette names', () => {
    const { g } = A.makeBuffer(10, 10);
    g.calls = [];
    A.rect(g, 1.4, 2.6, 3, 4, 'red');
    A.rect(g, 0, 0, 1, 1, '#010203');
    expect(g.calls).toEqual([['fillRect', '#E0645A', 1, 3, 3, 4], ['fillRect', '#010203', 0, 0, 1, 1]]);
  });

  test('hash is FNV-1a, unsigned', () => {
    expect(A.hash('')).toBe(2166136261);
    expect(A.hash('a')).toBe(0xe40c292c);
    expect(A.hash('foobar')).toBe(0xbf9cf968);
    expect(A.hash('\u00e9\u00e8\u00ea').toString()).toMatch(/^\d+$/);
  });

  test('clamp', () => {
    expect([A.clamp(5, 0, 3), A.clamp(-1, 0, 3), A.clamp(2, 0, 3)]).toEqual([3, 0, 2]);
  });

  test('seedRandom makes rnd and pick repeatable; unseeded they are random', () => {
    A.seedRandom(42);
    const xs = Array.from({ length: 1000 }, () => A.rnd(0, 1));
    const ps = Array.from({ length: 50 }, () => A.pick(['a', 'b', 'c']));
    A.seedRandom(42);
    expect(Array.from({ length: 1000 }, () => A.rnd(0, 1))).toEqual(xs);
    expect(Array.from({ length: 50 }, () => A.pick(['a', 'b', 'c']))).toEqual(ps);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = xs.reduce((s, v) => s + v, 0) / 1000;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(new Set(ps)).toEqual(new Set(['a', 'b', 'c']));
    A.seedRandom(1);
    const one = A.rnd(5, 6);
    A.seedRandom(2);
    expect(A.rnd(5, 6)).not.toBe(one);
    expect(one).toBeGreaterThanOrEqual(5);
    expect(one).toBeLessThan(6);
    A.seedRandom(null);
    expect(A.rnd(0, 1)).not.toBe(A.rnd(0, 1));
  });

  test('bakeRows paints a sprite from letters and leaves other characters empty', () => {
    const cv = A.bakeRows(['ab.', 'b a'], { a: 'ink', b: 'red' });
    expect([cv.width, cv.height]).toEqual([3, 2]);
    expect(cv.ctx.calls).toEqual([
      ['fillRect', '#1A212E', 0, 0, 1, 1], ['fillRect', '#E0645A', 1, 0, 1, 1],
      ['fillRect', '#E0645A', 0, 1, 1, 1], ['fillRect', '#1A212E', 2, 1, 1, 1],
    ]);
  });

  test('REDUCED follows prefers-reduced-motion', () => {
    expect(A.REDUCED).toBe(false);
    env.media.fire(true);
    expect(A.REDUCED).toBe(true);
    env.media.fire(false);
    expect(A.REDUCED).toBe(false);
  });
});

describe('Camera', () => {
  const DPRS = [1, 1.5, 2, 3];
  const VIEWS = [[1, 1], [20, 30], [333, 517], [390, 844], [844, 390], [1280, 800], [1919, 1079], [3000, 2000]];
  const make = (viewW: number, viewH: number, world = { w: 320, h: 200 }, dpr = 1) => {
    const cam = new A.Camera();
    cam.resize(viewW, viewH, dpr);
    cam.fit(world.w, world.h, viewW, viewH);
    return cam;
  };

  test('the zoom is one of ZOOMS and covers whole device pixels, at any view and dpr', () => {
    expect(A.ZOOMS).toEqual([1, 2, 3, 4, 5, 6]);
    for (const dpr of DPRS) {
      for (const [w, h] of VIEWS) {
        for (const world of [{ w: 100, h: 60 }, { w: 320, h: 200 }, { w: 1500, h: 900 }]) {
          const cam = make(w!, h!, world, dpr);
          for (let step = 0; step < 14; step++) {
            expect(A.ZOOMS).toContain(cam.zoom);
            expect(Number.isInteger(cam.bw) && Number.isInteger(cam.bh)).toBe(true);
            expect(cam.bw * cam.zoom).toBeGreaterThanOrEqual(w! * dpr - 1e-9); // the buffer covers the view...
            expect((cam.bw - 1) * cam.zoom).toBeLessThan(w! * dpr); // ...by less than one logical pixel too much
            expect(cam.bh * cam.zoom).toBeGreaterThanOrEqual(h! * dpr - 1e-9);
            expect(Number.isInteger(cam.x) && Number.isInteger(cam.y)).toBe(true);
            cam.zoomBy(step < 7 ? 1 : -1);
            cam.panBy(13.7, -9.1);
          }
        }
      }
    }
  });

  test('fit picks the largest zoom that shows the whole world, minimum 1', () => {
    expect(make(1280, 800).zoom).toBe(4); // 320x200 -> 1280x800
    expect(make(1279, 800).zoom).toBe(3);
    expect(make(1280, 799).zoom).toBe(3);
    expect(make(390, 844).zoom).toBe(1);
    expect(make(390, 844, { w: 800, h: 600 }).zoom).toBe(1); // too big at zoom 1: stays 1 and pans
    expect(make(2560, 1600, { w: 320, h: 200 }, 1).zoom).toBe(6); // capped by ZOOMS (8 would fit)
    expect(make(1280, 800, { w: 320, h: 200 }, 2).zoom).toBe(6); // 2560 x 1600 device pixels: 8 would fit, capped
    expect(make(1280, 800, { w: 320, h: 200 }, 1.5).zoom).toBe(6); // 1920 x 1200 device pixels
    expect(make(1000, 800, { w: 320, h: 200 }, 1.5).zoom).toBe(4); // 1500 x 1200: 4 * 320 = 1280 <= 1500
  });

  test('fit takes an optional dpr and the insets into account', () => {
    const cam = new A.Camera();
    cam.fit(320, 200, 640, 400, 2);
    expect([cam.dpr, cam.zoom]).toEqual([2, 4]); // 1280 x 800 device pixels
    const inset = new A.Camera();
    inset.insets = { top: 0, right: 0, bottom: 100, left: 0 }; // a dialog box of 100 logical px at the bottom
    inset.fit(320, 200, 1280, 800);
    expect(inset.zoom).toBe(2); // (200 + 100) * 3 = 900 > 800
  });

  test('a world smaller than the view is centred, on both axes, and stays centred', () => {
    const cam = make(1300, 900);
    expect(cam.zoom).toBe(4);
    const mid = cam.screenToWorld(1300 / 2, 900 / 2);
    expect(Math.abs(mid.x - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(mid.y - 100)).toBeLessThanOrEqual(1);
    cam.panBy(500, -500);
    expect([cam.x, cam.y]).toEqual([-Math.round((cam.bw - 320) / 2), -Math.round((cam.bh - 200) / 2)]);
  });

  test('a world bigger than the view pans (phone) and stays inside it', () => {
    const cam = make(390, 844, { w: 800, h: 1200 });
    expect(cam.zoom).toBe(1);
    expect(cam.bw).toBe(390);
    cam.panBy(-5000, -5000);
    expect([cam.x, cam.y]).toEqual([0, 0]);
    cam.panBy(100, 150);
    expect([cam.x, cam.y]).toEqual([100, 150]);
    cam.panBy(9999, 9999);
    expect([cam.x, cam.y]).toEqual([800 - 390, 1200 - 844]);
    cam.panBy(-9999, -9999);
    expect([cam.x, cam.y]).toEqual([0, 0]);
  });

  test('the insets leave room: the world may slide until its edge meets the free part of the buffer', () => {
    const cam = new A.Camera();
    cam.insets = { top: 0, right: 0, bottom: 50, left: 0 };
    cam.resize(390, 844, 1);
    cam.fit(800, 1200, 390, 844);
    cam.panBy(0, 99999);
    expect(cam.y).toBe(1200 - 844 + 50);
    cam.panBy(0, -99999);
    expect(cam.y).toBe(0);
  });

  test('panBy snaps to whole logical pixels but slow drags add up', () => {
    const cam = make(390, 844, { w: 800, h: 1200 });
    cam.zoomBy(3); // zoom 4: 0.25 logical pixel per CSS pixel
    const x0 = cam.x;
    for (let i = 0; i < 40; i++) cam.panBy(1, 0);
    expect(cam.x).toBe(x0 + 10);
    cam.panBy(0, 7); // 1.75 logical px
    expect(Number.isInteger(cam.y)).toBe(true);
  });

  test('clampTo keeps the world reachable and reads x and y written from outside', () => {
    const cam = make(390, 844, { w: 800, h: 1200 });
    cam.x = 5000;
    cam.y = -5000;
    cam.clampTo(800, 1200);
    expect([cam.x, cam.y]).toEqual([800 - 390, 0]);
    cam.x = 17;
    cam.clampTo(800, 1200);
    cam.panBy(4, 0);
    expect(cam.x).toBe(21);
    cam.clampTo(300, 300); // a smaller world: centred
    expect(cam.x).toBe(-Math.round((390 - 300) / 2));
  });

  test('screenToWorld and worldToScreen are inverses, whatever the dpr', () => {
    for (const dpr of DPRS) {
      const cam = make(500, 400, { w: 900, h: 700 }, dpr);
      cam.zoomBy(1);
      cam.panBy(37, 91);
      for (const [px, py] of [[0, 0], [123.5, 77], [499, 399]]) {
        const w = cam.screenToWorld(px!, py!);
        const s = cam.worldToScreen(w.x, w.y);
        expect(s.x).toBeCloseTo(px!, 6);
        expect(s.y).toBeCloseTo(py!, 6);
      }
      expect(cam.worldToScreen(cam.x, cam.y)).toEqual({ x: 0, y: 0 });
      const one = cam.worldToScreen(cam.x + 1, cam.y);
      expect(one.x * dpr).toBeCloseTo(cam.zoom, 9); // a logical pixel is `zoom` device pixels
    }
  });

  test('zoomBy keeps the world point under the anchor (within a logical pixel)', () => {
    for (const dpr of [1, 2]) {
      const cam = make(400, 300, { w: 3000, h: 3000 }, dpr);
      cam.zoomBy(1);
      cam.panBy(500, 500);
      for (const [ax, ay] of [[100, 120], [0, 0], [399, 299]]) {
        const before = cam.screenToWorld(ax!, ay!);
        cam.zoomBy(1, ax, ay);
        const after = cam.screenToWorld(ax!, ay!);
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
        cam.zoomBy(-1, ax, ay);
      }
    }
  });

  test('setZoom snaps to the nearest step; zoom stays within ZOOMS', () => {
    const cam = make(400, 300, { w: 3000, h: 3000 });
    cam.zoomBy(-1);
    expect(cam.zoom).toBe(1);
    for (let i = 0; i < 20; i++) cam.zoomBy(1);
    expect(cam.zoom).toBe(6);
    cam.setZoom(3.4);
    expect(cam.zoom).toBe(3);
    cam.setZoom(99);
    expect(cam.zoom).toBe(6);
    cam.setZoom(-3);
    expect(cam.zoom).toBe(1);
  });

  test('resize keeps the centre of the view and follows a change of dpr', () => {
    const cam = make(400, 300, { w: 3000, h: 3000 });
    cam.panBy(700, 400);
    const c = cam.screenToWorld(200, 150);
    cam.resize(640, 480, 1);
    expect(cam.bw).toBe(640);
    const c2 = cam.screenToWorld(320, 240);
    expect(Math.abs(c2.x - c.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c2.y - c.y)).toBeLessThanOrEqual(1);
    cam.resize(640, 480, 2);
    expect(cam.bw).toBe(1280); // zoom 1: 1280 device pixels
    cam.zoomBy(1);
    expect(cam.bw).toBe(640);
  });
});

describe('presentBuffer', () => {
  test('copies the buffer at a whole zoom, sets the backing and CSS sizes, smoothing off', () => {
    const e = load();
    const buf = e.api.makeBuffer(100, 50);
    const canvas = e.api.makeBuffer(1, 1).c;
    for (const [dpr, zoom] of [[1, 1], [1, 4], [2, 3], [1.5, 2]]) {
      e.win.devicePixelRatio = dpr!;
      e.api.presentBuffer(canvas, buf, zoom);
      expect([canvas.width, canvas.height]).toEqual([100 * zoom!, 50 * zoom!]);
      expect(canvas.style.width).toBe(`${(100 * zoom!) / dpr!}px`);
      expect(canvas.style.height).toBe(`${(50 * zoom!) / dpr!}px`);
      expect(canvas.style.imageRendering).toBe('pixelated');
      expect(canvas.ctx.imageSmoothingEnabled).toBe(false);
      expect(canvas.ctx.calls.at(-1)).toEqual(['drawImage', 0, 0, 100, 50, 0, 0, 100 * zoom!, 50 * zoom!]);
    }
  });

  test('takes a canvas as well as the { c, g } of makeBuffer, and works out the zoom from the parent when none is given', () => {
    const e = load();
    const buf = e.api.makeBuffer(100, 50);
    const canvas = e.api.makeBuffer(1, 1).c;
    canvas.parentElement = { clientWidth: 399 }; // a buffer of ceil(399 / 4) = 100 at zoom 4
    e.api.presentBuffer(canvas, buf.c);
    expect(canvas.width).toBe(400);
    e.win.devicePixelRatio = 2;
    canvas.parentElement = { clientWidth: 150 }; // 300 device pixels
    e.api.presentBuffer(canvas, buf);
    expect(canvas.width).toBe(300);
  });
});

describe('startLoop', () => {
  test('runs update(dt) then render(T), caps dt at 0.05, counts frames', () => {
    const { api, raf } = load();
    const log: string[] = [];
    const dts: number[] = [];
    const ts: number[] = [];
    const loop = api.startLoop((dt: number) => { log.push('u'); dts.push(dt); }, (t: number) => { log.push('r'); ts.push(t); });
    expect(raf.pending()).toBe(1);
    raf.step(1000);
    raf.step(1016);
    raf.step(9000);
    expect(log.join('')).toBe('ururur');
    expect(dts).toEqual([0, 0.016, 0.05]);
    expect(ts[2]).toBeCloseTo(0.066, 9);
    expect(loop.stats().frames).toBe(3);
    expect(raf.pending()).toBe(1);
    loop.stop();
    expect(raf.pending()).toBe(0);
  });

  test('stats: fps over the last 5 s, cpu cost per frame, worst frame', () => {
    const { api, raf, perf } = load();
    const loop = api.startLoop(() => { perf.t += 2; }, () => { perf.t += 1; }); // each frame costs 3 ms
    for (let i = 0; i < 120; i++) { perf.t = i * (1000 / 60); raf.step(perf.t); }
    const s = loop.stats();
    expect(s.fps).toBeGreaterThan(59);
    expect(s.fps).toBeLessThan(61);
    expect(s.cpuMs).toBeCloseTo(3, 6);
    expect(s.worstMs).toBeCloseTo(3, 6);
    expect(s.frames).toBe(120);
    perf.t += 6000;
    expect(loop.stats().fps).toBe(0);
    loop.stop();
  });

  test('pauses while the tab is hidden and resumes without a jump', () => {
    const { api, raf, doc } = load();
    const dts: number[] = [];
    const loop = api.startLoop((dt: number) => dts.push(dt), () => {});
    raf.step(100);
    raf.step(116);
    doc.hidden = true;
    for (const f of doc.listeners.visibilitychange!) f();
    expect(raf.pending()).toBe(0);
    doc.hidden = false;
    for (const f of doc.listeners.visibilitychange!) f();
    expect(raf.pending()).toBe(1);
    raf.step(60000);
    expect(dts).toEqual([0, 0.016, 0]);
    loop.stop();
    expect(doc.listeners.visibilitychange).toEqual([]);
    expect(raf.pending()).toBe(0);
  });

  test('allocates nothing per frame: one frame function, the same stats object', () => {
    const { api, raf } = load();
    const loop = api.startLoop(() => {}, () => {});
    const first = [...raf.queue.values()][0];
    raf.step(0);
    expect([...raf.queue.values()][0]).toBe(first);
    raf.step(16);
    expect([...raf.queue.values()][0]).toBe(first);
    expect(loop.stats()).toBe(loop.stats());
  });
});

describe('particles', () => {
  const draw = (e: any, layer: number, T = 0) => {
    const { g } = e.makeBuffer(64, 64);
    g.calls = [];
    e.drawParticles(g, layer, T);
    return g.calls as any[][];
  };

  test('PART has the eight kinds', () => {
    expect(A.PART).toEqual({ steam: 0, smoke: 1, drop: 2, ash: 3, zzz: 4, puff: 5, spark: 6, dust: 7 });
  });

  test('a particle is drawn on its layer only, moves, and dies after its life', () => {
    const e = load().api;
    e.emitParticle(2, e.PART.spark, 10, 20, 0, 0, 1);
    expect(draw(e, 2).length).toBeGreaterThan(0);
    expect(draw(e, 3)).toEqual([]);
    expect(draw(e, -1)).toEqual([]);
    e.emitParticle(-1, e.PART.dust, 5, 5, 10, 0, 1);
    expect(draw(e, -1).length).toBeGreaterThan(0);
    e.tickParticles(0.5);
    e.tickParticles(0.6);
    expect(draw(e, 2)).toEqual([]);
    expect(draw(e, -1)).toEqual([]);
  });

  test('every kind draws something, only palette colours, only whole pixels', () => {
    const e = load().api;
    const hexes = new Set(Object.values(e.PALETTE).map((h: any) => h.toLowerCase()));
    for (const kind of Object.values(e.PART) as number[]) {
      e.emitParticle(0, kind, 20, 20, 0, 0, 1);
      const calls = draw(e, 0, 1.3);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(hexes.has(String(c[1]).toLowerCase())).toBe(true);
        for (const v of c.slice(2)) expect(Number.isInteger(v)).toBe(true);
      }
      e.tickParticles(2);
    }
  });

  test('the fade is a dither: fewer pixels as the particle ages, never an alpha', () => {
    const e = load().api;
    const counts: number[] = [];
    for (const age of [0, 0.4, 0.6, 0.9]) {
      e.emitParticle(1, e.PART.zzz, 20, 20, 0, 0, 10);
      e.tickParticles(10 * age);
      counts.push(draw(e, 1).length);
      e.tickParticles(100);
    }
    expect(counts[0]!).toBe(7);
    expect(counts[3]!).toBeLessThan(counts[0]!);
    expect(counts[3]!).toBeGreaterThan(0);
  });

  test('the pool holds 256: the oldest is overwritten', () => {
    const e = load().api;
    for (let i = 0; i < 300; i++) e.emitParticle(0, e.PART.ash, i % 60, 5 + Math.floor(i / 60) * 2, 0, 0, 100);
    expect(draw(e, 0).length).toBeGreaterThan(0);
    // 300 emitted, 256 kept: the first 44 slots hold the newest, so the oldest 44 are gone
    let alive = 0;
    for (let probe = 0; probe < 300; probe++) {
      const x = probe % 60;
      const y = 5 + Math.floor(probe / 60) * 2;
      if (draw(e, 0).some((c) => c[2] === x && c[3] === y)) alive++;
    }
    expect(alive).toBeLessThanOrEqual(256);
    expect(alive).toBeGreaterThan(200);
  });

  test('drops fall', () => {
    const e = load().api;
    e.emitParticle(0, e.PART.drop, 30, 10, 0, 0, 5);
    const y0 = draw(e, 0)[0]![3];
    e.tickParticles(0.5);
    expect(draw(e, 0)[0]![3]).toBeGreaterThan(y0);
  });
});
