/*
 * Closed palette of the pixel view: 39 named colours, nothing else is ever drawn.
 * Lot L2, docs/vue-pixel.md 2.3. Shares one scope with the other web/pixel files:
 * public names are PALETTE and rgb, everything else here is prefixed `pal`.
 * Declares only, nothing runs at load.
 */
const PALETTE = Object.freeze({
  // outline and night mask
  ink: '#1A212E', night: '#2A3447',
  // walls
  wallHi: '#F2EDE3', wall: '#E3DCCF', wallMid: '#C9C0B0', wallSh: '#8A7F70', base: '#6B6155',
  // floors
  parqA: '#B98A5E', parqB: '#A97C52', parqLn: '#8F6A45', carpA: '#4B5B78', carpB: '#425170',
  tileA: '#D6D2C6', tileB: '#BFBBAE', conc: '#98A0AA', concD: '#7F8792',
  // furniture
  wood: '#9A6B4B', woodD: '#6E4A33', woodL: '#B88660', steel: '#7C879A', steelD: '#4F5A6E', steelL: '#AEB8C8',
  // lights and screens
  screen: '#8FD9C4', screenD: '#2F6B64', lamp: '#F0C36A', lampHi: '#FFE9B0',
  // plants, brick, glass, accents
  leaf: '#5E8C5A', leafD: '#3F6B44', leafL: '#86B06E', pot: '#B5654A', brick: '#7A4E45',
  glass: '#9CC7D8', glassHi: '#D5EBF2', red: '#E0645A', white: '#F5F5F0',
  // skin tones and sky
  skinA: '#F1C9A5', skinB: '#C68A60', skinC: '#7E513A', sky: '#86B8DE',
});

/** True: an unknown colour name throws (development). Set it to false in production: unknown names then draw magenta. */
let palStrict = true;

const palHex = /^#[0-9a-f]{6}$/i;
const palMagenta = '#FF00FF';

/** Hex string of a palette name; a `#rrggbb` string passes through. An unknown name throws, or gives magenta when `palStrict` is false. */
function palColor(name) {
  if (typeof name === 'string') {
    if (Object.prototype.hasOwnProperty.call(PALETTE, name)) return PALETTE[name];
    if (palHex.test(name)) return name;
  }
  if (palStrict) throw new Error(`unknown colour: ${String(name)}`);
  return palMagenta;
}

const palCache = new Map();

/** `[r, g, b]` of a palette name or `#rrggbb`. Memoised and frozen: never mutate the result. */
function rgb(name) {
  const known = palCache.get(name);
  if (known) return known;
  const h = palColor(name);
  const v = Object.freeze([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  if (h !== palMagenta) palCache.set(name, v); // the fallback is never cached: a later strict call must still throw
  return v;
}
