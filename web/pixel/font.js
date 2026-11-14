/*
 * Bitmap font of the pixel view: 5x7 letters, proportional, in a cell 11 rows high
 * (marks on rows 0-2, capitals on rows 2-8, descenders on rows 9-10).
 * Lot L2, docs/vue-pixel.md 2.3 and 1.9. Shares one scope with the other web/pixel files:
 * public names are FONT_H, textWidth, drawText and wrapText, everything else here is
 * prefixed `fnt`. Declares only, nothing runs at load (the glyph table and the colour
 * atlases are built on first use). Non-ASCII characters are written as \u escapes.
 */
const FONT_H = 11;

/** Every character of the font, the space included (a blank glyph 3 wide: with the 1 pixel gap a space advances 4). */
const fntChars =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  '\u00e9\u00e8\u00ea\u00e0\u00e2\u00e7\u00f4\u00fb\u00f9\u00ee\u00ef\u00c9\u00c8\u00ca\u00c0\u00c7' +
  ".,:;!?'()/+-%" +
  '\u00ab\u00bb\u2019\u0153\u0152\u00eb\u00fc' +
  ' ';

function fntBuild() {
  const table = Object.create(null);
  const blank = (w) => Array.from({ length: FONT_H }, () => '.'.repeat(w));
  // Plain glyphs: "char|rows separated by spaces", definitions separated by `~`, first row given once per call.
  const plain = (y0, defs) => {
    for (const def of defs.split('~')) {
      const [ch, spec] = def.split('|');
      const rows = spec.split(' ');
      const g = blank(rows[0].length);
      rows.forEach((row, j) => { g[y0 + j] = row; });
      table[ch] = { w: rows[0].length, rows: g };
    }
  };
  plain(2,
    'A|.###. #...# #...# ##### #...# #...# #...#~B|####. #...# #...# ####. #...# #...# ####.~C|.###. #...# #.... #.... #.... #...# .###.~' +
    'D|####. #...# #...# #...# #...# #...# ####.~E|##### #.... #.... ####. #.... #.... #####~F|##### #.... #.... ####. #.... #.... #....~' +
    'G|.###. #...# #.... #.### #...# #...# .###.~H|#...# #...# #...# ##### #...# #...# #...#~I|### .#. .#. .#. .#. .#. ###~' +
    'J|...# ...# ...# ...# ...# #..# .##.~K|#..# #.#. ##.. ##.. #.#. #..# #..#~L|#... #... #... #... #... #... ####~' +
    'M|#...# ##.## #.#.# #.#.# #...# #...# #...#~N|#...# ##..# #.#.# #..## #...# #...# #...#~O|.###. #...# #...# #...# #...# #...# .###.~' +
    'P|####. #...# #...# ####. #.... #.... #....~Q|.###. #...# #...# #...# #.#.# #..#. .##.#~R|####. #...# #...# ####. #.#.. #..#. #...#~' +
    'S|.#### #.... #.... .###. ....# ....# ####.~T|##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..~U|#...# #...# #...# #...# #...# #...# .###.~' +
    'V|#...# #...# #...# #...# #...# .#.#. ..#..~W|#...# #...# #...# #.#.# #.#.# ##.## #...#~X|#...# #...# .#.#. ..#.. .#.#. #...# #...#~' +
    'Y|#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..~Z|##### ....# ...#. ..#.. .#... #.... #####~' +
    '\u0152|.###### #..#... #..#... #..#### #..#... #..#... .######~' +
    'b|#.... #.... ####. #...# #...# #...# ####.~d|....# ....# .#### #...# #...# #...# .####~f|.## #.. ### #.. #.. #.. #..~' +
    'h|#.... #.... ####. #...# #...# #...# #...#~k|#... #... #..# #.#. ##.. #.#. #..#~l|##. .#. .#. .#. .#. .#. .##~' +
    'i|# . # # # # #~j|.# .. .# .# .# .# .# .# #.~' +
    '0|.###. #...# #..## #.#.# ##..# #...# .###.~1|.#. ##. .#. .#. .#. .#. ###~2|.###. #...# ....# ...#. ..#.. .#... #####~' +
    '3|####. ....# ....# .###. ....# ....# ####.~4|...#. ..##. .#.#. #..#. ##### ...#. ...#.~5|##### #.... ####. ....# ....# #...# .###.~' +
    '6|.###. #.... #.... ####. #...# #...# .###.~7|##### ....# ...#. ..#.. ..#.. ..#.. ..#..~8|.###. #...# #...# .###. #...# #...# .###.~' +
    '9|.###. #...# #...# .#### ....# ....# .###.~?|.###. #...# ....# ..##. ..#.. ..... ..#..~!|# # # # # . #~' +
    '(|.# #. #. #. #. #. .#~)|#. .# .# .# .# .# #.~/|..# ..# .#. .#. .#. #.. #..~' +
    "'|# #~\u2019|# #~" +
    '%|##..# ##..# ...#. ..#.. .#... #..## #..##');
  plain(4,
    'a|.###. ....# .#### #...# .####~c|.###. #...# #.... #...# .###.~e|.###. #...# ##### #.... .###.~m|##.#. #.#.# #.#.# #.#.# #.#.#~' +
    'n|####. #...# #...# #...# #...#~o|.###. #...# #...# #...# .###.~r|#.## ##.. #... #... #...~s|.#### #.... .###. ....# ####.~' +
    'u|#...# #...# #...# #...# .####~v|#...# #...# #...# .#.#. ..#..~w|#...# #...# #.#.# #.#.# .#.#.~x|#...# .#.#. ..#.. .#.#. #...#~' +
    'z|##### ...#. ..#.. .#... #####~g|.#### #...# #...# #...# .#### ....# .###.~p|####. #...# #...# #...# ####. #.... #....~' +
    'q|.#### #...# #...# #...# .#### ....# ....#~y|#...# #...# #...# .#### ....# ....# .###.~' +
    '\u0153|.##.##. #..#..# #..#### #..#... .##.###');
  plain(3, 't|.#.. ###. .#.. .#.. .#.. ..##');
  plain(5, ':|# . . #~;|# . . # #~\u00ab|.#.#. #.#.. .#.#.~\u00bb|.#.#. ..#.# .#.#.~+|.#. ### .#.');
  plain(6, '-|###');
  plain(8, '.|#~,|# #');
  // Accented letters: a base glyph plus a mark. Lowercase marks sit on rows 1-2 (row 3 stays empty so they read as marks),
  // capital marks on rows 0-1. A mark is 5 wide, so only 5-wide bases take it.
  const MARKS = {
    acute: ['...#.', '..#..'], grave: ['.#...', '..#..'], circ: ['..#..', '.#.#.'], dia: ['.#.#.'],
  };
  const compose = (ch, base, mark) => {
    const g = table[base].rows.map((row) => row.split(''));
    const up = base === base.toUpperCase();
    if (mark === 'ced') {
      g[9][2] = '#'; g[10][1] = '#'; g[10][2] = '#';
    } else {
      const top = mark === 'dia' ? (up ? 1 : 2) : up ? 0 : 1;
      MARKS[mark].forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === '#') g[top + j][i] = '#'; });
    }
    table[ch] = { w: 5, rows: g.map((r) => r.join('')) };
  };
  [
    ['\u00e9', 'e', 'acute'], ['\u00e8', 'e', 'grave'], ['\u00ea', 'e', 'circ'], ['\u00eb', 'e', 'dia'],
    ['\u00e0', 'a', 'grave'], ['\u00e2', 'a', 'circ'], ['\u00f4', 'o', 'circ'], ['\u00fb', 'u', 'circ'],
    ['\u00f9', 'u', 'grave'], ['\u00fc', 'u', 'dia'], ['\u00e7', 'c', 'ced'],
    ['\u00c9', 'E', 'acute'], ['\u00c8', 'E', 'grave'], ['\u00ca', 'E', 'circ'], ['\u00c0', 'A', 'grave'], ['\u00c7', 'C', 'ced'],
  ].forEach(([ch, base, mark]) => compose(ch, base, mark));
  // i with a circumflex or a diaeresis: 3 wide, drawn by hand.
  plain(2, '\u00ee|.#. #.# .#. .#. .#. .#. .#.~\u00ef|#.# ... .#. .#. .#. .#. .#.');
  table[' '] = { w: 3, rows: blank(3) };
  for (const ch in table) Object.freeze(table[ch]);
  return table;
}

let fntTable = null;

/** `{ w, rows }` (rows: FONT_H strings of `#` and `.`, w wide), or null when the character is not in the font. */
function fntGlyph(ch) {
  if (!fntTable) fntTable = fntBuild();
  return fntTable[ch] || null;
}

/** Pixel width of `s`: glyphs 1 pixel apart. Characters outside the font count for nothing. */
function textWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const g = fntGlyph(s[i]);
    if (g) w += g.w + 1;
  }
  return Math.max(0, w - 1);
}

const fntAtlases = new Map();

// One strip per colour: every glyph of the font side by side, 1 pixel apart.
function fntAtlas(hex) {
  let a = fntAtlases.get(hex);
  if (a) return a;
  const offsets = Object.create(null);
  let total = 0;
  for (const ch of fntChars) { offsets[ch] = total; total += fntGlyph(ch).w + 1; }
  const { c, g } = makeBuffer(total, FONT_H);
  g.fillStyle = hex;
  for (const ch of fntChars) {
    fntGlyph(ch).rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(offsets[ch] + x, y, 1, 1);
    });
  }
  a = { c, offsets };
  fntAtlases.set(hex, a);
  return a;
}

/** Draws `s` with its top left at (x, y) in `g`, in a palette name (or `#rrggbb`). Characters outside the font are skipped. */
function drawText(g, s, x, y, colour) {
  const a = fntAtlas(palColor(colour).toLowerCase());
  x = Math.round(x);
  y = Math.round(y);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const off = a.offsets[ch];
    if (off === undefined) continue;
    const w = fntGlyph(ch).w;
    if (ch !== ' ') g.drawImage(a.c, off, 0, w, FONT_H, x, y, w, FONT_H);
    x += w + 1;
  }
}

/** Greedy word wrap on single spaces; a word wider than `maxW` is cut by characters. Always returns at least one line. */
function wrapText(s, maxW) {
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    let w = word;
    while (textWidth(w) > maxW && w.length > 1) {
      if (line) { out.push(line); line = ''; }
      let n = 1;
      while (n < w.length && textWidth(w.slice(0, n + 1)) <= maxW) n++;
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    const t = line ? `${line} ${w}` : w;
    if (line && textWidth(t) > maxW) { out.push(line); line = w; } else line = t;
  }
  out.push(line);
  return out;
}

/** Makes text drawable: dashes become `-`, the curly apostrophe a straight one, whitespace runs one space, anything outside the font is removed (emoji included). Never cuts. */
function fntSanitize(s) {
  let out = '';
  for (const ch of String(s).replace(/[\u2013\u2014]/g, '-').replace(/\u2019/g, "'")) {
    if (/\s/.test(ch)) out += ' ';
    else if (ch !== ' ' && fntChars.includes(ch)) out += ch;
  }
  return out.replace(/ {2,}/g, ' ');
}
