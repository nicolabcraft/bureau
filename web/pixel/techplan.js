/* web/pixel/techplan.js : lot L10, voir docs/vue-pixel.md (2.9, 2.12) */
/*
 * The « Plan technique » of the advanced view: a blueprint of the cutaway, the delegation tree from desk to desk (chef,
 * managers, agents), the model under each desk and the state of each one. Drawn into the buffer of the advanced view,
 * over the cutaway, when NAV.plan is true. Lot L10, contract in 2.9. Shares one scope with the other web/pixel files:
 * the public names are drawTechPlan and techPlanLabels, every other top-level name wears `tec`. Declares only, nothing
 * runs at load. No DOM: the buffer `g` comes from boot.js and the plan's own canvases are made with makeBuffer.
 *
 * World. The plan uses the world of the cutaway (advLayout: floor bands, desk slots, towers), so the camera, the zoom and
 * the scroll of advanced.js apply as they are. renderAdvanced leaves an identity transform: the plan draws the world with
 * translate(-advCam.x, -advCam.y) itself.
 *
 * Built once, drawn from a cache: tecBuild turns the layout and the people into nodes (one per occupied desk), edges
 * (parent to child, same floor) and labels (the pure part, no canvas: techPlanLabels reads it); tecBake paints the lines,
 * the delegation tree and every label into one canvas the size of the world. Rebuilt only when the layout, a name, a
 * parent or a model changed (a signature compared each frame, nothing allocated). Each frame: the paper (a canvas of dots,
 * moved by whole cells), the cache, then the markers (state colours), the flow dots on the edges of running agents and the
 * rings of the people the journal highlights.
 *
 * Labels. Every label is a plate (the text with 1 px around it): floor names, the title and the legend, and the model
 * under each desk. The models go in three staggered rows under the markers; a floor uses the longest wording that every
 * desk of it can have ("Sonnet 5.5", then "Sonnet", then 4 letters, then 1), and a plate never touches another one (1 px
 * apart at least), so no text covers another. Colours are the closed palette only.
 */

const tecPaper = 'carpB';
const tecDot = 'carpA';
const tecMain = 'glassHi';
const tecSide = 'steelL';
const tecFaint = 'steel';
const tecRows = [19, 29, 39];                    // top of the model plates, from the top of the band
const tecState = { running: 'screen', waiting: 'lamp', error: 'red', queued: 'steelL', idle: 'steel', done: 'wallMid' };
const tecStateLabel = [['running', 'Actif'], ['waiting', 'Attend'], ['error', 'Erreur'], ['queued', 'En file'], ['idle', 'Au repos'], ['done', 'Fini']];
const tecGX = 3;                                 // least gap between two plates on a row
const tecGap = 8;                                // cell of the dotted paper

let tecModel = null;                             // { lay, nodes, edges, labels, floors }
let tecSigA = [];
let tecSigB = [];
let tecCv = null;                                // { c, g } the cache, the size of the world
let tecCvModel = null;
let tecBg = null;                                // { c, g } the paper
const tecInkCache = new Map();

/* ------------------------------ small things ------------------------------ */

function tecDims() {
  return {
    ih: typeof advIH === 'number' ? advIH : 50,
    bx: typeof advBX === 'number' ? advBX : 6,
    balc: typeof advBalc === 'number' ? advBalc : 20,
  };
}

function tecClean(s) {
  s = String(s === undefined || s === null ? '' : s);
  return typeof fntSanitize === 'function' ? fntSanitize(s).trim() : s;
}

/** Rows of the font cell that carry ink for a character: [top, bottom], or null for a blank one. */
function tecCharInk(ch) {
  let r = tecInkCache.get(ch);
  if (r !== undefined) return r;
  r = null;
  const gl = typeof fntGlyph === 'function' ? fntGlyph(ch) : null;
  if (gl) {
    for (let y = 0; y < gl.rows.length; y++) {
      if (gl.rows[y].indexOf('#') >= 0) { if (!r) r = [y, y]; else r[1] = y; }
    }
  }
  tecInkCache.set(ch, r);
  return r;
}

/** First and last inked rows of a text, in the font cell. */
function tecInk(s) {
  let top = 99, bottom = -1;
  for (let i = 0; i < s.length; i++) {
    const r = tecCharInk(s[i]);
    if (r) { if (r[0] < top) top = r[0]; if (r[1] > bottom) bottom = r[1]; }
  }
  return bottom < 0 ? { top: 2, bottom: 8 } : { top, bottom };
}

/** A one-line plate at (x, y): the text plus 1 px around it. `cell` is where drawText puts the glyph cell. `flat`: the plate keeps the height of the capitals (rows 2 to 8), a descender hangs into the gap below it. */
function tecLabel(text, x, y, fg, kind, flat) {
  const ink = flat ? { top: 2, bottom: 8 } : tecInk(text);
  return { x, y, w: textWidth(text) + 2, h: ink.bottom - ink.top + 3, text, kind, fg, cell: y + 1 - ink.top, lines: null };
}

/** A plate over several lines (pitch 11, the cell of the font), `text` being the whole label. */
function tecBlock(lines, x, y, fg, kind, text) {
  const pitch = 11;
  let w = 0, top = 99, bottom = -1;
  for (let k = 0; k < lines.length; k++) {
    w = Math.max(w, textWidth(lines[k]));
    const ink = tecInk(lines[k]);
    if (k === 0) top = ink.top;
    if (k === lines.length - 1) bottom = (lines.length - 1) * pitch + ink.bottom;
  }
  return { x, y, w: w + 2, h: bottom - top + 3, text, kind, fg, cell: y + 1 - top, lines, pitch };
}

/** A text cut to n characters, "..." at the end when something was left out (n of 5 at least). */
function tecAbbr(s, n) {
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

/**
 * The wordings of a model, from the longest: "Sonnet 5.5", "Sonnet", "Son.", "S.". A model that is not a Claude one
 * ("big-pickle", "qwen3-coder-480b") is cut at its first separator with "..." ("big...") and then abridged the same way.
 */
function tecVariants(model) {
  const full = tecClean((typeof modelShort === 'function' && modelShort(model)) || '?') || '?';
  const first = full.split(' ')[0];
  const seg = first.split(/[-_/.]/)[0];
  const spaced = full.indexOf(' ') >= 0;
  const word = spaced ? tecAbbr(first, 8) : seg.length >= 3 && seg.length < first.length ? seg + '...' : tecAbbr(first, 8);
  const stem = spaced || seg.length < 3 ? first : seg;
  const small = stem.length <= 4 ? stem : stem.slice(0, 3) + '.';
  return [tecAbbr(full, 14), word, small, stem.slice(0, 1) + (stem.length > 1 ? '.' : '')];
}

/** Do two plates come closer than the minimum (3 px sideways, so 5 px of ink between two texts; 1 px above and below)? */
function tecHit(ax, ay, aw, ah, b) {
  return !(ax + aw + tecGX <= b.x || b.x + b.w + tecGX <= ax || ay + ah + 1 <= b.y || b.y + b.h + 1 <= ay);
}

/* ------------------------------ the model of the plan (pure) ------------------------------ */

/** Name, parent and model of a person, for the plan. */
function tecInfoOf(id) {
  const p = id && typeof personById === 'function' ? personById(id) : null;
  const i = p && p.info;
  return i ? { parentId: i.parentId || null, model: i.model || null, state: i.state || '' } : null;
}

function tecFloorTitle(fl) {
  const no = fl.index === 0 ? 'Rez' : 'Étage ' + fl.index;
  const name = tecClean(fl.name);
  return name ? no + ' : ' + name + (fl.p < 1 ? ' (chantier)' : '') : no + (fl.p < 1 ? ' (chantier)' : '');
}

/**
 * Places the model plate of every node of a floor at the given wording level. Returns the plates, or null when one does not fit.
 * anchored: each plate hangs from its marker (it starts at the marker's column, the rows go down from one marker to the next, so
 * the leaders stay in the clear); else the plates are packed to the left as far as their row allows, then moved back towards
 * their marker. The search only chooses the row of each plate.
 */
function tecPlaceFloor(lf, nodes, level, anchored, obstacles, minX, maxX, dims) {
  const n = nodes.length, bottomMax = lf.ty + dims.ih;
  const labs = nodes.map((nd) => tecLabel(nd.variants[Math.min(level, nd.variants.length - 1)], 0, 0, tecMain, 'model', true));
  const lo = nodes.map((nd, i) => Math.max(minX, nd.x - labs[i].w + 3));    // a plate always covers the column of its marker
  const hi = nodes.map((nd, i) => Math.min(maxX - labs[i].w, nd.x - 1));
  const blocked = (x, y, lab) => {
    for (let k = 0; k < obstacles.length; k++) if (tecHit(x, y, lab.w, lab.h, obstacles[k])) return true;
    return false;
  };
  const attempt = () => {
    const row = new Array(n).fill(-1);
    const at = new Array(n).fill(0);
    const edge = tecRows.map(() => minX);                                     // where the next plate of a row may start
    const gap = tecGX;
    const failed = new Set();
    let budget = 60000;
    const dfs = (i) => {
      if (i === n) return true;
      if (--budget < 0) return false;
      const key = i + ':' + edge.join(',');
      if (failed.has(key)) return false;
      const lab = labs[i];
      for (let k = 0; k < tecRows.length; k++) {
        const r = anchored ? (tecRows.length - 1 - (i % tecRows.length) + k) % tecRows.length : k;
        const y = lf.ty + tecRows[r];
        if (y + lab.h > bottomMax) continue;
        const x = anchored ? hi[i] : Math.max(lo[i], edge[r]);
        if (x > hi[i] || x < lo[i] || x < edge[r] || blocked(x, y, lab)) continue;
        const keep = edge[r];
        edge[r] = x + lab.w + gap;
        row[i] = r; at[i] = x;
        if (dfs(i + 1)) return true;
        edge[r] = keep;
      }
      failed.add(key);
      return false;
    };
    if (!dfs(0)) return false;
    for (let i = 0; i < n; i++) { labs[i].x = at[i]; labs[i].y = lf.ty + tecRows[row[i]]; labs[i].cell = labs[i].y - 1; }
    return true;
  };
  if (!attempt()) return null;
  if (!anchored) {
    // polish: each plate moves back towards the middle of its marker while the place is free
    for (let i = 0; i < n; i++) {
      const lab = labs[i], c0 = Math.max(lo[i], Math.min(hi[i], Math.round(nodes[i].x - lab.w / 2)));
      let best = lab.x;
      for (let d = 0; d <= hi[i] - lo[i]; d++) {
        let found = false;
        for (let s = 0; s < 2 && !found; s++) {
          if (d === 0 && s === 1) continue;
          const x = s === 0 ? c0 - d : c0 + d;
          if (x < lo[i] || x > hi[i]) continue;
          let free = !blocked(x, lab.y, lab);
          for (let k = 0; k < n && free; k++) if (k !== i && tecHit(x, lab.y, lab.w, lab.h, labs[k])) free = false;
          if (free) { best = x; found = true; }
        }
        if (found) break;
      }
      lab.x = best;
    }
  }
  return labs;
}

/**
 * Nodes, edges and labels of the plan from a layout (advLayout) and `infoOf(id)` -> { parentId, model, state } | null.
 * Pure: nothing is drawn. Every label of `labels` is { x, y, w, h, text, kind, ... } in world px.
 */
function tecBuild(lay, infoOf) {
  const dims = tecDims();
  const m = { lay, nodes: [], edges: [], labels: [], floors: [], byId: new Map() };
  for (const lf of lay.floors) {
    const fm = { lf, nodes: [], name: null };
    m.floors.push(fm);
    if (lf.fl && lf.fl.p < 1) continue;
    for (const dl of lf.deskList) {
      const info = infoOf(dl.ownerId);
      if (!info) continue;
      const n = { id: dl.ownerId, x: dl.x, lf, kind: dl.kind, parentId: info.parentId, depth: 0, label: null, variants: tecVariants(info.model), level: 0 };
      fm.nodes.push(n);
      m.nodes.push(n);
      m.byId.set(n.id, n);
    }
  }
  for (const n of m.nodes) {
    let cur = n, d = 0;
    while (cur.parentId && d < 8) {
      const p = m.byId.get(cur.parentId);
      if (!p || p === n) break;
      cur = p;
      d++;
    }
    n.depth = d;
  }
  for (const n of m.nodes) {
    const p = n.parentId ? m.byId.get(n.parentId) : null;
    if (p && p !== n && p.lf === n.lf) m.edges.push({ a: p, b: n, by: n.lf.ty + 4 + 2 * Math.min(p.depth, 2) });
  }
  // floor names, in the break corner of each band
  for (const fm of m.floors) {
    const lf = fm.lf;
    if (!lf.fl) continue;
    const text = tecFloorTitle(lf.fl);
    let lines = wrapText(text, 108);
    if (lines.length > 3) {
      let last = lines.slice(2).join(' ');
      while (last.length > 1 && textWidth(last) > 108) last = last.slice(0, -1);
      lines = [lines[0], lines[1], last.replace(/[ ,.:;'-]+$/, '')];
    }
    const lab = tecBlock(lines, (lf.cafeX || lay.ix + lay.iw - 124) + 3, lf.ty + 4, 'white', 'floor', text);
    fm.name = lab;
    m.labels.push(lab);
  }
  // models: one way for the whole building when there is one (hanging from the markers first, the longest wording first: a shorter
  // hanging one is better than a full packed one); else each floor takes the plainest one it can
  const ladder = [[0, true], [1, true], [2, true], [3, true], [0, false], [1, false], [2, false], [3, false]];
  const floorsWith = m.floors.filter((fm) => fm.nodes.length);
  for (const fm of floorsWith) {
    fm.sorted = fm.nodes.slice().sort((x, y) => x.x - y.x || x.depth - y.depth);
    fm.obstacles = fm.name ? [fm.name] : [];
  }
  const tryFloor = (fm, k) => tecPlaceFloor(fm.lf, fm.sorted, ladder[k][0], ladder[k][1], fm.obstacles, lay.ix + 1, lay.e0 - 2, dims);
  let all = -1;
  for (let k = 0; k < ladder.length && all < 0; k++) if (floorsWith.every((fm) => tryFloor(fm, k))) all = k;
  for (const fm of floorsWith) {
    let placed = null, level = 3;
    for (let k = Math.max(0, all); k < ladder.length && !placed; k++) {
      placed = tryFloor(fm, k);
      if (placed) level = ladder[k][0];
    }
    if (!placed) placed = [];
    fm.sorted.forEach((n, i) => { n.label = placed[i] || null; n.level = level; });
    for (const lab of placed) m.labels.push(lab);
  }
  // The title and the legend are kept in view by drawTechPlan (tecPlaceHud moves them sideways, so they are never cut by the
  // edge of the screen); here they get their place in the world, the title over the roof line, the legend in the street.
  const topTy = lay.n ? lay.floors[lay.n - 1].ty : 32;
  const ty0 = Math.max(1, topTy - 17), right = lay.w - 6;
  const t1 = tecLabel('Plan technique', dims.bx, ty0, 'white', 'title');
  const t2 = tecLabel('Délégation de poste à poste', t1.x + t1.w + 8, ty0, tecSide, 'title');
  m.labels.push(t1, t2);
  const hud = { t1, t2, t2On: true, bx: dims.bx, items: [], edge: null, gx0: 1e9, gx1: -1e9 };
  m.hud = hud;
  const items = [{ edge: true, name: 'Délégation' }].concat(tecStateLabel.map(([state, name]) => ({ state, name })));
  for (const it of items) {
    const lab = tecLabel(it.name, 0, 0, tecMain, 'legend', true);
    hud.items.push({ lab, state: it.edge ? null : it.state, edge: !!it.edge, x: 0, bx: 0, y: 0, on: false });
  }
  hud.key = -1;
  tecLegendFlow(m, lay.w - 12);
  return m;
}

/** Fills `out` with what the model depends on: the layout and, per desk, the person, parent and model. Nothing is allocated. */
function tecSignature(lay, out) {
  out.length = 0;
  out.push(lay.ver);
  for (const lf of lay.floors) {
    out.push(lf.fl ? lf.fl.name : '', lf.fl && lf.fl.p < 1 ? 0 : 1);
    for (const dl of lf.deskList) {
      const i = tecInfoOf(dl.ownerId);
      out.push(dl.ownerId, i ? i.parentId : null, i ? i.model : null);
    }
  }
  return out;
}

function tecSame(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The model of the current layout, rebuilt when it is stale. Null when the advanced view is not there. */
function tecEnsure() {
  if (typeof advLayout !== 'function' || typeof FLOORS === 'undefined') return null;
  let lay = typeof advLay !== 'undefined' ? advLay : null;
  if (!lay || (typeof advStale === 'function' && advStale())) lay = advLayout(FLOORS);
  if (!lay) return null;
  tecSignature(lay, tecSigB);
  if (!tecModel || tecModel.lay !== lay || !tecSame(tecSigA, tecSigB)) {
    tecModel = tecBuild(lay, tecInfoOf);
    const t = tecSigA; tecSigA = tecSigB; tecSigB = t;
  }
  return tecModel;
}

/* ------------------------------ painting ------------------------------ */

function tecH(g, x, y, w, c) { rect(g, x, y, w, 1, c); }
function tecV(g, x, y, h, c) { rect(g, x, y, 1, h, c); }

function tecPaintFloor(g, lay, lf, dims) {
  const ty = lf.ty, ih = dims.ih, x0 = dims.bx, x1 = lay.wallR + 2;
  // ceiling, floor, slab, and the walls of the towers
  tecH(g, x0, ty, x1 - x0, tecMain);
  tecH(g, x0, ty + ih, x1 - x0, tecMain);
  tecH(g, x0, ty + ih + 3, x1 - x0, tecMain);
  for (const x of [lay.ix - 1, lay.stairX0, lay.stairX1, lay.e0, lay.e1, lay.wallR]) tecV(g, x, ty, ih, tecMain);
  tecH(g, x0, ty + ih - 12, dims.balc, tecMain);
  tecV(g, x0, ty + ih - 12, 12, tecMain);
  tecV(g, lay.ix - 1, ty - 2, 3, tecMain);
  tecV(g, lay.stairX0, ty - 2, 3, tecMain);
  if (!lf.fl || lf.fl.p < 1) {
    // a floor in the works: a dashed outline only
    for (let x = lay.ix; x < lay.e0; x += 6) tecH(g, x, ty + 12, 3, tecFaint);
    return;
  }
  // stairs, alternating flights
  const up = lf.index % 2 === 0, sx0 = lay.stairX0 + 1, sw = lay.stairX1 - lay.stairX0 - 2;
  for (let k = 0; k < 9; k++) {
    const x = up ? sx0 + Math.floor((k * sw) / 9) : sx0 + sw - Math.ceil(((k + 1) * sw) / 9), y = ty + ih - 5 * (k + 1);
    tecH(g, x, y, 4, tecSide);
    tecV(g, x, y, 5, tecSide);
  }
  // lift shaft: cable and cab
  const lc = Math.round((lay.e0 + lay.e1) / 2);
  for (let y = ty + 2; y < ty + ih - 14; y += 4) tecV(g, lc, y, 2, tecFaint);
  tecH(g, lay.e0 + 3, ty + ih - 14, lay.e1 - lay.e0 - 5, tecSide);
  tecH(g, lay.e0 + 3, ty + ih - 2, lay.e1 - lay.e0 - 5, tecSide);
  tecV(g, lay.e0 + 3, ty + ih - 14, 12, tecSide);
  tecV(g, lay.e1 - 3, ty + ih - 14, 12, tecSide);
  // offices of the chefs, partitions of the rooms
  for (const o of lf.offices) tecV(g, o.x + o.w, ty + 10, ih - 10, tecSide);
  for (const rl of lf.rooms) tecV(g, rl.x0, ty + 10, ih - 10, tecFaint);
  // the break corner
  if (lf.cafe) {
    const c = lf.cafe;
    for (const [x, w] of [[c.coffee, 10], [c.micro, 14], [c.fountain, 8], [c.printer, 14], [c.couch, 24]]) {
      tecH(g, x, ty + 40, w, tecFaint);
      tecV(g, x, ty + 40, ih - 40, tecFaint);
      tecV(g, x + w - 1, ty + 40, ih - 40, tecFaint);
    }
  }
  // desks
  for (const dl of lf.deskList) {
    tecH(g, dl.x - 5, ty + ih - 2, 11, tecSide);
    tecV(g, dl.x - 5, ty + ih - 1, 1, tecSide);
    tecV(g, dl.x + 5, ty + ih - 1, 1, tecSide);
  }
}

function tecPaintEdge(g, e) {
  const ty = e.a.lf.ty, xa = e.a.x, xb = e.b.x, by = e.by;
  tecV(g, xa, by, ty + 11 - by + 1, 'lamp');
  tecH(g, Math.min(xa, xb), by, Math.abs(xa - xb) + 1, 'lamp');
  tecV(g, xb, by, ty + 10 - by + 1, 'lamp');
  tecH(g, xb - 1, ty + 10, 3, 'lamp');
  tecV(g, xb, ty + 11, 1, 'lamp');
}

function tecPaintLabel(g, lab) {
  rect(g, lab.x, lab.y, lab.w, lab.h, tecPaper);
  if (lab.lines) for (let k = 0; k < lab.lines.length; k++) drawText(g, lab.lines[k], lab.x + 1, lab.cell + k * lab.pitch, lab.fg);
  else drawText(g, lab.text, lab.x + 1, lab.cell, lab.fg);
}

function tecBake(m) {
  const lay = m.lay;
  const w = Math.max(1, lay.w), h = Math.max(1, lay.h);
  if (!tecCv || tecCv.c.width !== w || tecCv.c.height !== h) tecCv = makeBuffer(w, h);
  const g = tecCv.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  const dims = tecDims();
  // the ground and the roof line
  tecH(g, 0, lay.gy, w, tecMain);
  for (let x = 0; x < w; x += 5) tecH(g, x, lay.gy + 1, 3, tecSide);
  if (lay.n) tecH(g, dims.bx, lay.floors[lay.n - 1].ty - 4, lay.wallR + 2 - dims.bx, tecMain);
  for (const lf of lay.floors) tecPaintFloor(g, lay, lf, dims);
  for (const e of m.edges) tecPaintEdge(g, e);
  // the leaders from a marker down to its model plate
  for (const n of m.nodes) if (n.label && n.label.y > n.lf.ty + 19) tecV(g, n.x, n.lf.ty + 19, n.label.y - n.lf.ty - 19, tecSide);
  for (const lab of m.labels) if (lab.kind !== 'title' && lab.kind !== 'legend') tecPaintLabel(g, lab);
  tecCvModel = m;
}

function tecDrawPaper(g, cam) {
  const w = cam.bw + tecGap, h = cam.bh + tecGap;
  if (!tecBg || tecBg.c.width !== w || tecBg.c.height !== h) {
    tecBg = makeBuffer(w, h);
    rect(tecBg.g, 0, 0, w, h, tecPaper);
    for (let y = 0; y < h; y += tecGap) for (let x = 0; x < w; x += tecGap) rect(tecBg.g, x, y, 1, 1, tecDot);
  }
  const ox = -(((Math.round(cam.x) % tecGap) + tecGap) % tecGap), oy = -(((Math.round(cam.y) % tecGap) + tecGap) % tecGap);
  g.drawImage(tecBg.c, ox, oy);
}

/** A 5 x 5 marker (7 x 7 for a chef) centred on x, its top at `top`, in the colour of a state. */
function tecMarker(g, x, ty, kind, col) {
  if (kind === 'chef') { rect(g, x - 3, ty + 12, 7, 7, 'ink'); rect(g, x - 2, ty + 13, 5, 5, col); }
  else { rect(g, x - 2, ty + 13, 5, 5, 'ink'); rect(g, x - 1, ty + 14, 3, 3, col); }
}

function tecRing(g, x, ty, kind, c) {
  const r = kind === 'chef' ? 5 : 4, y = ty + (kind === 'chef' ? 15 : 15) - r, s = r * 2 + 1;
  rect(g, x - r, y, s, 1, c); rect(g, x - r, y + s - 1, s, 1, c); rect(g, x - r, y, 1, s, c); rect(g, x + r, y, 1, s, c);
}

/**
 * Lays the legend out on one row, or two when `avail` px are not enough (the street is two rows high); what still does not fit
 * is left out. Items keep their place in m.labels only while they are shown.
 */
function tecLegendFlow(m, avail) {
  const h = m.hud, lay = m.lay, bx = h.bx, limit = Math.max(40, Math.min(avail, lay.w - 12));
  let lx = bx, ly = lay.gy + 1;
  h.gx0 = 1e9;
  h.gx1 = -1e9;
  for (let i = 0; i < h.items.length; i++) {
    const it = h.items[i], lab = it.lab, lead = it.edge ? 17 : 8, need = lead + lab.w;
    if (lx + need - bx > limit && lx > bx) { lx = bx; ly += 10; }
    const on = ly + lab.h <= lay.h;
    const at = m.labels.indexOf(lab);
    if (on && at < 0) m.labels.push(lab);
    else if (!on && at >= 0) m.labels.splice(at, 1);
    it.on = on;
    it.bx = lx;
    it.x = lx;
    it.y = ly + (it.edge ? 4 : 2);
    lab.y = ly;
    lab.cell = ly - 1;
    lab.bx = lx + lead;
    lab.x = lab.bx;
    if (on) {
      h.gx0 = Math.min(h.gx0, lx);
      h.gx1 = Math.max(h.gx1, lab.bx + lab.w);
    }
    lx += need + 10;
  }
  h.key = avail;
}

/**
 * Keeps the title and the legend inside the part of the view that is free (the camera, minus its insets): each block slides
 * sideways as little as needed, the subtitle goes when the title and it together do not fit. The labels of the model move with
 * them, so techPlanLabels says exactly what is drawn.
 */
function tecPlaceHud(m, cam) {
  const h = m.hud, ins = cam.insets;
  const vx0 = Math.round(cam.x) + ins.left + 4, vx1 = Math.round(cam.x) + cam.bw - ins.right - 4;
  const both = h.t1.w + 8 + h.t2.w, on = both <= vx1 - vx0;
  if (on !== h.t2On) {
    h.t2On = on;
    if (on) m.labels.push(h.t2);
    else { const i = m.labels.indexOf(h.t2); if (i >= 0) m.labels.splice(i, 1); }
  }
  const tdx = Math.max(Math.min(0, vx1 - (h.bx + (on ? both : h.t1.w))), vx0 - h.bx);
  h.t1.x = h.bx + tdx;
  h.t2.x = h.t1.x + h.t1.w + 8;
  if (vx1 - vx0 !== h.key) tecLegendFlow(m, vx1 - vx0);
  const ldx = Math.max(Math.min(0, vx1 - h.gx1), vx0 - h.gx0);
  for (let i = 0; i < h.items.length; i++) {
    const it = h.items[i];
    if (!it.on) continue;
    it.x = it.bx + ldx;
    it.lab.x = it.lab.bx + ldx;
  }
}

function tecDrawHud(g, m) {
  const h = m.hud;
  tecPaintLabel(g, h.t1);
  if (h.t2On) tecPaintLabel(g, h.t2);
  for (let i = 0; i < h.items.length; i++) {
    const it = h.items[i];
    if (!it.on) continue;
    tecPaintLabel(g, it.lab);
    if (it.state) {
      rect(g, it.x, it.y, 5, 5, 'ink');
      rect(g, it.x + 1, it.y + 1, 3, 3, tecState[it.state]);
    } else {
      tecH(g, it.x, it.y, 12, 'lamp');
      tecH(g, it.x + 9, it.y - 1, 1, 'lamp');
      tecH(g, it.x + 9, it.y + 1, 1, 'lamp');
    }
  }
}

/** The plan over the cutaway, in the buffer `g` of the advanced view. Leaves an identity transform. */
function drawTechPlan(g, T) {
  const m = tecEnsure();
  const cam = advCam;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  tecDrawPaper(g, cam);
  if (!m || !m.lay.n) return;
  if (tecCvModel !== m) tecBake(m);
  g.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
  g.drawImage(tecCv.c, 0, 0);
  const hl = typeof advHl !== 'undefined' ? advHl : null;
  const sel = typeof pplSelected !== 'undefined' ? pplSelected : null;
  // markers in the colour of the state, a ring on a waiting one, on the selected one and on the highlighted ones
  for (let i = 0; i < m.nodes.length; i++) {
    const n = m.nodes[i], p = personById(n.id), st = p && p.info ? p.info.state : '';
    if (st === 'waiting') tecRing(g, n.x, n.lf.ty, n.kind, 'lampHi');
    if (n.id === sel || (hl && hl.length && hl.indexOf(n.id) >= 0)) tecRing(g, n.x, n.lf.ty, n.kind, 'white');
    tecMarker(g, n.x, n.lf.ty, n.kind, tecState[st] || 'steel');
  }
  tecPlaceHud(m, cam);
  tecDrawHud(g, m);
  // flow along the edges to the agents that work
  if (!REDUCED) {
    for (let i = 0; i < m.edges.length; i++) {
      const e = m.edges[i], p = personById(e.b.id);
      if (!p || !p.info || p.info.state !== 'running') continue;
      const ty = e.a.lf.ty, a = ty + 11 - e.by, b = Math.abs(e.b.x - e.a.x), c = ty + 8 - e.by, L = a + b + c;
      const s = (T * 24 + (hash(e.b.id) % 97)) % L, dir = e.b.x >= e.a.x ? 1 : -1;
      let x, y;
      if (s < a) { x = e.a.x; y = ty + 11 - s; }
      else if (s < a + b) { x = e.a.x + dir * (s - a); y = e.by; }
      else { x = e.b.x; y = e.by + (s - a - b); }
      rect(g, x - 1, y - 1, 2, 2, 'lampHi');
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** Every label of the plan, [{ x, y, w, h, text }] in world px: floor names, models, title, legend. One plate each, none over another. */
function techPlanLabels() {
  const m = tecEnsure();
  return m ? m.labels : [];
}
