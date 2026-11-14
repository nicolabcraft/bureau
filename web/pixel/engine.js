/*
 * Engine of the pixel view: low-resolution buffer, integer-zoom camera, frame loop,
 * randomness, particles. Lot L2, docs/vue-pixel.md 2.3. Shares one scope with the other
 * web/pixel files: the public names are the ones of the 2.3 signatures (makeBuffer, rect,
 * bakeRows, hash, clamp, REDUCED, seedRandom, rnd, pick, ZOOMS, Camera, presentBuffer,
 * startLoop, PART, emitParticle, tickParticles, drawParticles), everything else here is
 * prefixed `eng`. Declares only; the one thing done at load is following
 * prefers-reduced-motion, which REDUCED needs to stay up to date.
 *
 * Everything is drawn in a small canvas (the buffer: one canvas pixel = one logical pixel).
 * presentBuffer then copies it to the visible canvas at a whole number of DEVICE pixels per
 * logical pixel (Camera.zoom), so edges stay sharp at any devicePixelRatio.
 */

/** Offscreen canvas `c` and its 2d context `g`, smoothing off. */
function makeBuffer(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

/** Fills a rectangle; `colour` is a palette name or `#rrggbb`. x, y, w and h are rounded. */
function rect(g, x, y, w, h, colour) {
  g.fillStyle = palColor(colour);
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Paints a sprite from string rows: `map` gives a palette name per character, other characters stay transparent. Returns the canvas. */
function bakeRows(rows, map) {
  let w = 1;
  for (const row of rows) if (row.length > w) w = row.length;
  const { c, g } = makeBuffer(w, Math.max(1, rows.length));
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const name = map[row[x]];
      if (name) rect(g, x, y, 1, 1, name);
    }
  });
  return c;
}

/** FNV-1a of a string, an unsigned 32-bit integer. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** True when the user asks for less motion. Kept up to date. */
let REDUCED = false;
if (typeof matchMedia === 'function') {
  const engQuery = matchMedia('(prefers-reduced-motion: reduce)');
  REDUCED = !!engQuery.matches;
  if (typeof engQuery.addEventListener === 'function') engQuery.addEventListener('change', (e) => { REDUCED = !!e.matches; });
}

/* ------------------------------ randomness ------------------------------ */

let engSeed = null; // null: Math.random; a number: mulberry32 state

/** Makes rnd and pick deterministic (tests, captures). `null` goes back to Math.random. */
function seedRandom(n) {
  engSeed = n === null || n === undefined ? null : n >>> 0;
}

function engNext() {
  if (engSeed === null) return Math.random();
  engSeed = (engSeed + 0x6d2b79f5) >>> 0;
  let t = engSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Float in [a, b) for the simulation. */
function rnd(a, b) {
  return a + engNext() * (b - a);
}

/** Random item of a list. */
function pick(list) {
  return list[Math.floor(engNext() * list.length)];
}

/* -------------------------------- camera -------------------------------- */

/** Integer zoom steps: device pixels per logical pixel. */
const ZOOMS = [1, 2, 3, 4, 5, 6];

/**
 * World px -> buffer px -> device px, always whole numbers: the buffer is `bw x bh` logical pixels,
 * one logical pixel covers `zoom` device pixels. The view is measured in CSS pixels (`resize`, `fit`),
 * `dpr` converts. Positions on screen (`sx`, `sy`, anchors, pan) are CSS pixels relative to the canvas.
 * After `fit` or `clampTo` the camera remembers the world size and keeps the world visible on its own.
 */
class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.bw = 1;
    this.bh = 1;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.dpr = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.worldW = 0; // 0: no world known yet, no clamping
    this.worldH = 0;
    this.fx = 0; // unrounded x and y: slow drags add up instead of rounding to nothing
    this.fy = 0;
    this.lastX = 0; // x and y as last written here, to tell a write from outside
    this.lastY = 0;
  }

  /** Recomputes bw and bh for a view of viewW x viewH CSS pixels at pixel ratio dpr; the view keeps its centre. */
  resize(viewW, viewH, dpr) {
    const cx = this.fx + this.bw / 2;
    const cy = this.fy + this.bh / 2;
    const first = this.viewW === 0;
    this.viewW = viewW;
    this.viewH = viewH;
    this.dpr = dpr > 0 ? dpr : 1;
    this.engSize();
    if (!first) {
      this.fx = cx - this.bw / 2;
      this.fy = cy - this.bh / 2;
    }
    this.engKeep();
  }

  engSize() {
    this.bw = Math.max(1, Math.ceil((this.viewW * this.dpr) / this.zoom));
    this.bh = Math.max(1, Math.ceil((this.viewH * this.dpr) / this.zoom));
  }

  /** Largest ZOOMS entry that shows the whole world (outside the insets), else 1; centres the world. View in CSS pixels; `dpr` is optional (else the one of the last resize, 1 at first). */
  fit(worldW, worldH, viewW, viewH, dpr) {
    this.viewW = viewW;
    this.viewH = viewH;
    if (dpr > 0) this.dpr = dpr;
    const { top, right, bottom, left } = this.insets;
    let best = ZOOMS[0];
    for (const z of ZOOMS) {
      if (worldW + left + right <= (viewW * this.dpr) / z && worldH + top + bottom <= (viewH * this.dpr) / z) best = z;
    }
    this.zoom = best;
    this.engSize();
    this.fx = (worldW - this.bw) / 2 - (left - right) / 2;
    this.fy = (worldH - this.bh) / 2 - (top - bottom) / 2;
    this.lastX = this.x; // fx is the truth, not an outside write
    this.lastY = this.y;
    this.clampTo(worldW, worldH);
  }

  /** Sets the zoom to the nearest ZOOMS entry, around the screen point (ax, ay) (default: the middle of the view), which keeps its world point. */
  setZoom(z, ax, ay) {
    let next = ZOOMS[0];
    for (const step of ZOOMS) if (Math.abs(step - z) < Math.abs(next - z)) next = step;
    if (next === this.zoom) return;
    const px = ax === undefined ? this.viewW / 2 : ax;
    const py = ay === undefined ? this.viewH / 2 : ay;
    const k = this.dpr;
    const wx = this.fx + (px * k) / this.zoom;
    const wy = this.fy + (py * k) / this.zoom;
    this.zoom = next;
    this.engSize();
    this.fx = wx - (px * k) / next;
    this.fy = wy - (py * k) / next;
    this.engKeep();
  }

  /** One step up (+1) or down (-1) on ZOOMS. */
  zoomBy(step, ax, ay) {
    const i = clamp(ZOOMS.indexOf(this.zoom) + step, 0, ZOOMS.length - 1);
    this.setZoom(ZOOMS[i], ax, ay);
  }

  /** Moves the view by (dx, dy) screen pixels (positive: towards +x, +y of the world), snapped to whole logical pixels. */
  panBy(dxScreen, dyScreen) {
    this.engSync();
    this.fx += (dxScreen * this.dpr) / this.zoom;
    this.fy += (dyScreen * this.dpr) / this.zoom;
    this.engKeep();
  }

  /** Keeps the whole world reachable: it may slide until its edge meets the edge of the part of the buffer the insets leave free; a world smaller than that part is centred in it. */
  clampTo(worldW, worldH) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.engSync();
    const { top, right, bottom, left } = this.insets;
    const freeW = this.bw - left - right;
    const freeH = this.bh - top - bottom;
    this.fx = freeW >= worldW ? 0 - Math.round((freeW - worldW) / 2) - left : clamp(this.fx, 0 - left, worldW - this.bw + right);
    this.fy = freeH >= worldH ? 0 - Math.round((freeH - worldH) / 2) - top : clamp(this.fy, 0 - top, worldH - this.bh + bottom);
    this.engRound();
  }

  /** If x or y was written from outside, that value wins over the unrounded one. */
  engSync() {
    if (this.x !== this.lastX) this.fx = this.x;
    if (this.y !== this.lastY) this.fy = this.y;
  }

  engRound() {
    this.x = this.lastX = Math.round(this.fx) + 0; // + 0 turns -0 into 0
    this.y = this.lastY = Math.round(this.fy) + 0;
  }

  engKeep() {
    if (this.worldW > 0 && this.worldH > 0) this.clampTo(this.worldW, this.worldH);
    else this.engRound();
  }

  /** World position under the screen point (sx, sy), CSS pixels on the canvas. */
  screenToWorld(sx, sy) {
    return { x: (sx * this.dpr) / this.zoom + this.x, y: (sy * this.dpr) / this.zoom + this.y };
  }

  /** Screen position (CSS pixels on the canvas) of a world point. */
  worldToScreen(wx, wy) {
    return { x: ((wx - this.x) * this.zoom) / this.dpr, y: ((wy - this.y) * this.zoom) / this.dpr };
  }
}

/**
 * Copies `buffer` (a canvas, or the `{ c, g }` of makeBuffer) onto `canvas` with every pixel enlarged to a
 * whole `zoom` x `zoom` block of device pixels, no smoothing. Sets the backing size (buffer x zoom) and the
 * CSS size (backing / dpr). `zoom` is Camera.zoom; left out, it is worked out from the size of the canvas's parent.
 */
function presentBuffer(canvas, buffer, zoom) {
  const src = buffer.c || buffer;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  let k = zoom;
  if (!k) {
    const box = canvas.parentElement;
    k = box && box.clientWidth ? Math.round((box.clientWidth * dpr) / src.width) : 1;
  }
  k = Math.max(1, Math.round(k));
  const w = src.width * k;
  const h = src.height * k;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${w / dpr}px`;
  canvas.style.height = `${h / dpr}px`;
  canvas.style.imageRendering = 'pixelated';
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false; // a resize resets the context state
  g.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
}

/* ------------------------------- frame loop ------------------------------ */

const engStatsWindow = 5000; // ms
const engRing = 1024; // frames kept for stats(): 5 s at 200 fps

/**
 * Frame loop on requestAnimationFrame: `update(dt)` then `render(T)`, dt capped at 0.05 s, T the seconds
 * since the start (hidden time excluded). Paused while the tab is hidden. Allocates nothing per frame.
 * `stats()` gives { fps, cpuMs, worstMs, frames } over the last 5 s (cpuMs: mean, worstMs: slowest
 * update + render; frames: images drawn since the start).
 */
function startLoop(update, render) {
  const stamps = new Float64Array(engRing);
  const costs = new Float64Array(engRing);
  const out = { fps: 0, cpuMs: 0, worstMs: 0, frames: 0 };
  const hasDoc = typeof document !== 'undefined' && typeof document.addEventListener === 'function';
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  let head = 0;
  let count = 0;
  let frames = 0;
  let raf = 0;
  let last = -1;
  let T = 0;
  let running = true;

  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    T += dt;
    const t0 = clock();
    update(dt);
    render(T);
    costs[head] = clock() - t0;
    stamps[head] = now;
    head = (head + 1) % engRing;
    if (count < engRing) count++;
    frames++;
  };
  const onVisibility = () => {
    if (!running) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      last = -1; // no jump after the pause
      raf = requestAnimationFrame(tick);
    }
  };
  if (hasDoc) document.addEventListener('visibilitychange', onVisibility);
  if (!(hasDoc && document.hidden)) raf = requestAnimationFrame(tick);

  return {
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (hasDoc) document.removeEventListener('visibilitychange', onVisibility);
    },
    stats() {
      const now = clock();
      let n = 0;
      let first = Infinity;
      let latest = -Infinity;
      let sum = 0;
      let worst = 0;
      for (let i = 0; i < count; i++) {
        if (now - stamps[i] > engStatsWindow) continue;
        n++;
        if (stamps[i] < first) first = stamps[i];
        if (stamps[i] > latest) latest = stamps[i];
        sum += costs[i];
        if (costs[i] > worst) worst = costs[i];
      }
      out.fps = n > 1 && latest > first ? ((n - 1) * 1000) / (latest - first) : 0;
      out.cpuMs = n ? sum / n : 0;
      out.worstMs = worst;
      out.frames = frames;
      return out;
    },
  };
}

/* ------------------------------- particles ------------------------------- */

const PART = { steam: 0, smoke: 1, drop: 2, ash: 3, zzz: 4, puff: 5, spark: 6, dust: 7 };

const engParts = 256;
const engPx = new Float32Array(engParts);
const engPy = new Float32Array(engParts);
const engPvx = new Float32Array(engParts);
const engPvy = new Float32Array(engParts);
const engPage = new Float32Array(engParts);
const engPlife = new Float32Array(engParts); // 0: slot free
const engPkind = new Uint8Array(engParts);
const engPlayer = new Int16Array(engParts);
let engPnext = 0;

/** Starts a particle at world (x, y) moving at (vx, vy) px/s for `life` seconds. `layer`: floor index, or -1 for the advanced view. The pool holds 256: the oldest is overwritten. */
function emitParticle(layer, kind, x, y, vx, vy, life) {
  const i = engPnext;
  engPnext = (engPnext + 1) % engParts;
  engPx[i] = x;
  engPy[i] = y;
  engPvx[i] = vx;
  engPvy[i] = vy;
  engPage[i] = 0;
  engPlife[i] = life > 0 ? life : 0.001;
  engPkind[i] = kind;
  engPlayer[i] = layer;
}

/** Moves and ages every particle. */
function tickParticles(dt) {
  for (let i = 0; i < engParts; i++) {
    if (engPlife[i] === 0) continue;
    engPage[i] += dt;
    if (engPage[i] >= engPlife[i]) { engPlife[i] = 0; continue; }
    const kind = engPkind[i];
    if (kind === PART.drop) engPvy[i] += 90 * dt; // falls
    else if (kind === PART.spark) engPvy[i] += 40 * dt;
    else if (kind === PART.steam || kind === PART.smoke || kind === PART.dust || kind === PART.puff) {
      const drag = Math.max(0, 1 - 1.5 * dt);
      engPvx[i] *= drag;
      if (kind === PART.puff || kind === PART.dust) engPvy[i] *= drag;
    }
    engPx[i] += engPvx[i] * dt;
    engPy[i] += engPvy[i] * dt;
  }
}

// Thresholds of a 2x2 ordered dither: a pixel is drawn while the particle's opacity beats its threshold.
const engDither = [0.0, 0.5, 0.75, 0.25];
const engZ = ['###', '.#.', '###'];

/** A `size` x `size` square of one colour, dithered by opacity. */
function engDot(g, x, y, size, opacity, colour) {
  g.fillStyle = palColor(colour);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (opacity > engDither[((x + c) & 1) + 2 * ((y + r) & 1)]) g.fillRect(x + c, y + r, 1, 1);
    }
  }
}

/**
 * Draws the particles of `layer` into `g`, in the coordinate space `g` currently has (translate by the camera first).
 * Shape and colour come from the kind; the fade is a dither, never a smooth alpha. `T` (seconds) sways steam and smoke.
 */
function drawParticles(g, layer, T) {
  for (let i = 0; i < engParts; i++) {
    if (engPlife[i] === 0 || engPlayer[i] !== layer) continue;
    const age = engPage[i] / engPlife[i];
    const opacity = 1 - age;
    const kind = engPkind[i];
    const x = Math.round(engPx[i] + (kind === PART.steam || kind === PART.smoke ? Math.sin(T * 3 + i) * (0.5 + age) : 0));
    const y = Math.round(engPy[i]);
    if (kind === PART.steam) engDot(g, x, y, age < 0.5 ? 1 : 2, opacity, 'white');
    else if (kind === PART.smoke) engDot(g, x, y, age > 0.5 ? 3 : 2, opacity * 0.9, 'concD');
    else if (kind === PART.drop) { engDot(g, x, y, 1, opacity, 'glass'); engDot(g, x, y + 1, 1, opacity, 'glassHi'); }
    else if (kind === PART.ash) engDot(g, x, y, 1, opacity, 'steelD');
    else if (kind === PART.dust) engDot(g, x, y, 1, opacity, 'wallMid');
    else if (kind === PART.spark) { engDot(g, x, y, 1, opacity, 'lampHi'); engDot(g, x, y - 1, 1, opacity * 0.6, 'lamp'); }
    else if (kind === PART.puff) { const s = 1 + Math.floor(age * 3); engDot(g, x - (s >> 1), y - (s >> 1), s, opacity * 0.9, 'wallHi'); }
    else if (kind === PART.zzz) {
      g.fillStyle = palColor('white');
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (engZ[r][c] === '#' && opacity > engDither[((x + c) & 1) + 2 * ((y + r) & 1)]) g.fillRect(x + c, y + r, 1, 1);
        }
      }
    }
  }
}
