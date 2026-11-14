/*
 * Characters of the pixel view: look of a person, baked sprite sheets, portrait and small props.
 * Lot L4, docs/vue-pixel.md 2.5. Shares one scope with the other web/pixel files: the public names are
 * SPRITE_W, SPRITE_H, lookFor, bakeSheet, FRAME, WORKER_LOOK, drawSprite, drawPortrait and PROPS,
 * everything else here is prefixed `spr`. Declares only, nothing runs at load: sheets and props are
 * baked on first use.
 *
 * A sheet is one canvas of FRAME.count frames of 12 x 20 px, side by side. The feet of a person are at
 * the bottom of the frame: drawSprite(g, sheet, frame, x, y) puts the last row at y. Directions are
 * down, up and side (facing right); left is the side frames mirrored (flip = true).
 */

const SPRITE_W = 12;
const SPRITE_H = 20;

/**
 * Frame indices of a sheet. down, up and side: 0 standing, 1 to 4 walking. The seated frames come in two
 * views: facing the viewer (sit, hand0, hand1, type0, type1, sleep) and seen from behind (sitUp, handUp0,
 * handUp1, typeUp0, typeUp1), because a screen turned to its user hides nobody: the person at a desk whose
 * screen shows towards the viewer is drawn from behind.
 */
const FRAME = {
  down: 0, up: 5, side: 10, sit: 15, sleep: 16, hand0: 17, hand1: 18, hold: 19, str0: 20, str1: 21, read: 22,
  type0: 23, type1: 24, sitUp: 25, typeUp0: 26, typeUp1: 27, handUp0: 28, handUp1: 29, count: 30,
};

/** Construction worker for build.js: hard hat, orange vest. */
const WORKER_LOOK = {
  role: 'worker', skin: 'skinB', hair: 'lamp', style: 'hat', beard: false, top: 'pot', pants: 'steelD', shoe: 'ink',
  glasses: false, headphones: false, accent: null, badge: false, smoker: false, gardener: false,
};

/* ------------------------------- the look of a person ------------------------------- */

const sprSkins = ['skinA', 'skinB', 'skinC'];
const sprHairs = ['ink', 'woodD', 'woodL', 'pot', 'steelL', 'lamp', 'brick'];
const sprStyles = ['short', 'long', 'crop', 'bald', 'curly', 'tail'];
const sprTops = ['steel', 'red', 'leaf', 'lamp', 'carpA', 'glass', 'pot', 'white', 'leafL', 'brick'];
const sprManagerTops = ['steel', 'carpA', 'leaf', 'white', 'glass', 'brick'];
const sprPants = ['night', 'steelD', 'woodD', 'carpB'];

/** Shade of a top colour (sleeve, side of the torso). */
const sprTopShade = { steel: 'steelD', red: 'brick', leaf: 'leafD', lamp: 'woodL', carpA: 'night', glass: 'steel', white: 'steelL', pot: 'brick', steelD: 'night', brick: 'woodD', leafL: 'leaf' };
/** Shade of a skin colour (mouth, neck shadow). */
const sprSkinShade = { skinA: 'skinB', skinB: 'skinC', skinC: 'ink' };

/** Murmur3 finalizer: spreads the bits of a FNV hash so that small moduli are fair. */
function sprMix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stable integer in [0, n) for a person and a feature. Only hash(id) feeds it: two pages draw the same person. */
function sprRoll(id, salt, n) {
  return sprMix(hash(id + '|' + salt)) % n;
}

const sprLooks = new Map(); // 'id|role' -> Look
const sprRoles = new Map(); // id -> last role seen, for drawPortrait

/**
 * Look of a thread: skin, hair, hair style, beard, top, pants, shoe, glasses, headphones, accent (the tie
 * of a manager or a chef), badge, smoker, gardener. Everything comes from hash(id); the role only picks
 * the dress (chef: dark suit and white shirt, manager: tie). The same (id, role) gives the same object.
 */
function lookFor(id, role) {
  const r = role || 'agent';
  const key = id + '|' + r;
  const known = sprLooks.get(key);
  if (known) return known;
  const roll = (salt, n) => sprRoll(id, salt, n);
  const hair = sprHairs[roll('hair', sprHairs.length)];
  let top = r === 'chef' ? 'steelD' : (r === 'manager' ? sprManagerTops : sprTops)[roll('top', r === 'manager' ? sprManagerTops.length : sprTops.length)];
  if (top === hair) top = r === 'manager' ? 'steel' : sprTops[(sprTops.indexOf(top) + 1) % sprTops.length];
  const look = {
    role: r,
    skin: sprSkins[roll('skin', sprSkins.length)],
    hair,
    style: sprStyles[roll('style', sprStyles.length)],
    beard: roll('beard', 5) === 0,
    top,
    pants: sprPants[roll('pants', sprPants.length)],
    shoe: roll('shoe', 2) ? 'ink' : 'woodD',
    glasses: roll('glasses', 3) === 0,
    headphones: roll('headphones', 5) === 0,
    accent: r === 'manager' ? (roll('accent', 2) ? 'red' : 'lamp') : r === 'chef' ? 'lamp' : null,
    badge: r === 'agent' && roll('badge', 2) === 0,
    smoker: roll('smoker', 3) === 0,
    gardener: roll('gardener', 3) === 0,
  };
  sprLooks.set(key, look);
  sprRoles.set(id, r);
  return look;
}

/* ------------------------------------- frame drawing ------------------------------------- */

/*
 * Bodies are 10 columns x 18 rows of fill only; the outline is added around them. Letters: h hair, s skin,
 * m mouth, e eye, t top, T top shade, p pants, f shoe, a accent, w white, u glasses, n dark gear.
 */
const sprBody = {
  down: ['..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', '.hhsssshh.', '.hsessesh.', '.hssssssh.', '..ssmmss..', '...ssss...', '.tttttttt.', '.tttttttt.', '.tTttttTt.', '.tTttttTt.', '.tTttttTt.', '.sTttttTs.', '..tttttt..', '..pppppp..', '..pp..pp..', '.fff..fff.'],
  up: ['..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', '.hhhhhhhh.', '.hhhhhhhh.', '.hhhhhhhh.', '..hhhhhh..', '...ssss...', '.tttttttt.', '.tttttttt.', '.tTttttTt.', '.tTttttTt.', '.tTttttTt.', '.sTttttTs.', '..tttttt..', '..pppppp..', '..pp..pp..', '.fff..fff.'],
  side: ['..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', '.hhhhssss.', '.hhhssses.', '.hhhssssss', '..hhsssms.', '....sss...', '...ttttt..', '...ttttt..', '...ttttt..', '...ttttt..', '...ttttt..', '...ttttt..', '...ttttt..', '...pppp...', '...pppp...', '...fffff..'],
};
/** The last three rows (hips and legs) of a body, per pose. */
const sprLegs = {
  down: { n: ['..pppppp..', '..pp..pp..', '.fff..fff.'], a: ['..pppppp..', '.pp....pp.', 'fff....fff'], b: ['..pppppp..', '.pp....pp.', 'fff....fff'], sit: ['..pppppp..', '.pppppppp.', '.ff....ff.'], back: ['.pppppppp.', '.pppppppp.', '..pppppp..'] },
  side: { n: ['...pppp...', '...pppp...', '...fffff..'], a: ['...pppp...', '..pp..pp..', '..ff..fff.'], b: ['...pppp...', '...pp.pp..', '..fff.ff..'] },
};

/**
 * Frames of a sheet in order: a spec each. dir: 'down' | 'up' | 'side'; legs: 'n' | 'a' | 'b' | 'sit' | 'back';
 * arms: see sprArms; dy shifts the upper body (a step bobs, a sleeper bows); eyes: 'closed'.
 */
const sprSpecs = (() => {
  const list = [];
  for (const dir of ['down', 'up', 'side']) {
    list.push({ dir });
    list.push({ dir, legs: 'a', arms: 'swA' });
    list.push({ dir, legs: 'n', arms: 'swB', dy: -1 });
    list.push({ dir, legs: 'b', arms: 'swB' });
    list.push({ dir, legs: 'n', arms: 'swA', dy: -1 });
  }
  list.push({ dir: 'down', legs: 'sit' });                                   // sit
  list.push({ dir: 'down', legs: 'sit', eyes: 'closed', dy: 1, arms: 'rest' }); // sleep
  list.push({ dir: 'down', legs: 'sit', arms: 'up0' });                      // hand0
  list.push({ dir: 'down', legs: 'sit', arms: 'up1' });                      // hand1
  list.push({ dir: 'down', arms: 'hold' });                                  // hold
  list.push({ dir: 'down', arms: 'str' });                                   // str0
  list.push({ dir: 'down', arms: 'str', dy: -1, eyes: 'closed' });           // str1
  list.push({ dir: 'down', arms: 'read' });                                  // read
  list.push({ dir: 'down', legs: 'sit', arms: 'ty0' });                      // type0
  list.push({ dir: 'down', legs: 'sit', arms: 'ty1' });                      // type1
  list.push({ dir: 'up', legs: 'back', dy: 1 });                             // sitUp
  list.push({ dir: 'up', legs: 'back', dy: 1, arms: 'tyU0' });               // typeUp0
  list.push({ dir: 'up', legs: 'back', dy: 1, arms: 'tyU1' });               // typeUp1
  list.push({ dir: 'up', legs: 'back', dy: 1, arms: 'up0' });                // handUp0
  list.push({ dir: 'up', legs: 'back', dy: 1, arms: 'up1' });                // handUp1
  return list;
})();

/** Draws hair styles, beard, glasses, headphones and the dress of a role onto the rows of a frame. */
function sprDress(rows, set, look, dir) {
  const st = look.style;
  const row = (s) => s.split('');
  if (st === 'hat') {
    ['..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', 'hhhhhhhhhh'].forEach((s, i) => { rows[i] = row(dir === 'side' && i === 3 ? '.hhhhhhhhh' : s); });
  } else if (st === 'crop' && dir !== 'side') {
    rows[0] = row('...hhhh...');
  } else if (st === 'bald') {
    ['..ssssss..', '.ssssssss.', '.ssssssss.'].forEach((s, i) => { rows[i] = row(dir === 'up' ? s.replace(/s/g, 'h') : s); });
    if (dir === 'down') rows[3] = row('.hssssssh.');
  } else if (st === 'long') {
    if (dir === 'down') { rows[6] = row('.hssmmssh.'); rows[7] = row('.h.ssss.h.'); }
    else if (dir === 'up') { rows[6] = row('.hhhhhhhh.'); rows[7] = row('.h.hhhh.h.'); }
    else { rows[6] = row('.hhhsssms.'); rows[7] = row('.hhh.sss..'); }
  } else if (st === 'curly') {
    if (dir === 'side') { rows[3] = row('hhhhhssss.'); rows[4] = row('hhhhsssses'); rows[5] = row('.hhhssssss'); }
    else { rows[1] = row('hhhhhhhhhh'); rows[2] = row('hhhhhhhhhh'); rows[3] = row(dir === 'down' ? 'hhhsssshhh' : 'hhhhhhhhhh'); }
  } else if (st === 'tail') {
    if (dir === 'side') { rows[3] = row('hhhhhssss.'); rows[4] = row('hhhhsssses'); rows[5] = row('.hhhssssss'); rows[6] = row('.hhhhsssms'); rows[7] = row('.hh..sss..'); }
    else if (dir === 'up') { rows[6] = row('..hhhhhh..'); rows[7] = row('...hhhh...'); rows[8] = row('.tthhhhtt.'); }
  }
  if (look.beard && dir !== 'up') {
    if (dir === 'down') { rows[5] = row('.hsshhssh.'); rows[6] = row('..shhhhs..'); }
    else { rows[5] = row('.hhhshhhss'); rows[6] = row('..hhhhhhs.'); }
  }
  if (dir === 'down') {
    if (look.glasses) rows[4] = row('.hueuueuh.');
    if (look.headphones) { rows[1] = row('.nhhhhhhn.'); for (const r of [3, 4, 5]) { set(r, 1, 'n'); set(r, 8, 'n'); } }
    if (look.role === 'chef') {
      for (let r = 8; r <= 9; r++) { set(r, 4, 'w'); set(r, 5, 'w'); }
      for (let r = 10; r <= 12; r++) { set(r, 4, 'a'); set(r, 5, 'a'); }
    } else if (look.badge) {
      set(8, 4, 'n'); set(8, 5, 'n'); set(9, 4, 'n'); set(9, 5, 'n'); set(10, 5, 'n'); set(11, 5, 'w'); set(11, 6, 'a');
    } else if (look.accent) {
      set(8, 4, 'a'); set(8, 5, 'a');
      for (let r = 9; r <= 12; r++) set(r, 4 + (r % 2), 'a');
    }
  } else if (dir === 'up') {
    if (look.headphones) { rows[1] = row('.nhhhhhhn.'); for (const r of [3, 4, 5]) { set(r, 1, 'n'); set(r, 8, 'n'); } }
  } else {
    if (look.glasses) { set(4, 9, 'u'); set(4, 7, 'u'); }
    if (look.headphones) { for (const r of [2, 3, 4]) set(r, 3, 'n'); set(1, 3, 'n'); }
    if (look.role === 'chef') { for (let r = 8; r <= 12; r++) set(r, 7, r < 10 ? 'w' : 'a'); }
    else if (look.accent) { for (let r = 8; r <= 11; r++) set(r, 7, 'a'); }
  }
}

/** Arms of a frame, drawn over the torso (see sprSpecs for the names). Side views only know the walking swing. */
function sprArms(rows, set, dir, arms) {
  if (!arms) return;
  if (dir === 'side') {
    if (arms === 'swA' || arms === 'swB') {
      const dx = arms === 'swA' ? -1 : 1;
      for (let r = 9; r <= 12; r++) { set(r, 4 + dx, 'T'); set(r, 5 + dx, 'T'); }
      set(13, 4 + dx, 's'); set(13, 5 + dx, 's');
    }
    return;
  }
  const clearRight = () => { for (let r = 10; r <= 13; r++) set(r, 8, '.'); };
  if (arms === 'swA') set(13, 1, 'T');
  else if (arms === 'swB') set(13, 8, 'T');
  else if (arms === 'up0' || arms === 'up1') {
    clearRight();
    for (let r = 5; r <= 9; r++) set(r, 9, 'T');
    const y = arms === 'up0' ? 3 : 2;
    set(y, 9, 's'); set(y + 1, 9, 's');
  } else if (arms === 'hold') {
    clearRight();
    set(9, 9, 'T'); set(10, 9, 'T'); set(8, 9, 's'); set(7, 9, 's');
  } else if (arms === 'str') {
    for (const c of [1, 8]) for (let r = 10; r <= 13; r++) set(r, c, '.');
    for (const c of [0, 9]) {
      for (let r = 3; r <= 9; r++) set(r, c, 'T');
      set(2, c, 's'); set(1, c, 's');
    }
  } else if (arms === 'read') {
    for (const c of [1, 8]) for (let r = 11; r <= 13; r++) set(r, c, '.');
    set(10, 2, 'T'); set(10, 7, 'T'); set(11, 3, 'T'); set(11, 6, 'T'); set(12, 3, 's'); set(12, 6, 's');
  } else if (arms === 'rest') {
    for (const c of [1, 8]) set(13, c, 'T');
    set(13, 3, 's'); set(13, 6, 's');
  } else if (arms === 'ty0' || arms === 'ty1') {
    set(13, 1, 'T'); set(13, 8, 'T');
    const a = arms === 'ty0';
    set(a ? 13 : 14, 3, 's'); set(a ? 14 : 13, 6, 's');
  } else if (arms === 'tyU0' || arms === 'tyU1') {
    const a = arms === 'tyU0';
    set(13, 1, 'T'); set(13, 8, 'T');
    set(a ? 12 : 13, 0, 'T'); set(a ? 13 : 12, 9, 'T');
  }
}

const sprW = SPRITE_W;
const sprH = SPRITE_H;

/**
 * One frame as a palette name per cell (12 x 20, row by row, null = transparent), outline included.
 * The outline is selective: each outline cell takes a dark tone of the cell it touches, bottom and
 * right neighbours winning. The variants recolour the outline (amber, red) or fade the fill with a sparse light dither (done).
 */
function sprFrame(look, spec, variant) {
  const dir = spec.dir;
  const rows = sprBody[dir].map((s) => s.split(''));
  const set = (r, c, v) => { if (rows[r] && c >= 0 && c < 10) rows[r][c] = v; };
  sprDress(rows, set, look, dir);
  if (spec.eyes === 'closed' && dir === 'down') rows[4] = rows[4].map((c) => (c === 'e' || c === 'u' ? 'm' : c));
  const legs = (dir === 'side' ? sprLegs.side : sprLegs.down)[spec.legs || 'n'];
  legs.forEach((s, i) => { rows[15 + i] = s.split(''); });
  sprArms(rows, set, dir, spec.arms);
  const grid = new Array(sprW * sprH).fill(null);
  const dy = spec.dy || 0;
  const paint = (ch) => {
    switch (ch) {
      case 'h': return look.hair;
      case 's': return look.skin;
      case 'm': return sprSkinShade[look.skin];
      case 'e': return 'ink';
      case 't': return look.top;
      case 'T': return sprTopShade[look.top] || 'night';
      case 'p': return look.pants;
      case 'f': return look.shoe;
      case 'a': return look.accent || 'lamp';
      case 'w': return 'white';
      case 'u': return 'steelL';
      case 'n': return 'night';
      default: return null;
    }
  };
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const k = paint(row[c]);
      if (!k) continue;
      const y = 1 + r + (r <= 14 ? dy : 0);
      if (y >= 0 && y < sprH) grid[y * sprW + c + 1] = k;
    }
  });
  const out = grid.slice();
  const tone = variant === 'amber' ? 'lamp' : variant === 'red' ? 'red' : null;
  for (let y = 0; y < sprH; y++) {
    for (let x = 0; x < sprW; x++) {
      if (grid[y * sprW + x]) continue;
      let n = null;
      if (y > 0 && grid[(y - 1) * sprW + x]) n = grid[(y - 1) * sprW + x];
      if (x > 0 && grid[y * sprW + x - 1]) n = grid[y * sprW + x - 1];
      if (x < sprW - 1 && grid[y * sprW + x + 1]) n = grid[y * sprW + x + 1];
      if (y < sprH - 1 && grid[(y + 1) * sprW + x]) n = grid[(y + 1) * sprW + x];
      if (n) out[y * sprW + x] = tone || sprOutline(n, look);
    }
  }
  if (variant === 'done') {
    for (let y = 0; y < sprH; y++) {
      for (let x = 0; x < sprW; x++) {
        if (out[y * sprW + x] && grid[y * sprW + x] && y % 2 === 0 && (x + y) % 4 === 0) out[y * sprW + x] = 'steelL';
      }
    }
  }
  return out;
}

/** Outline tone for the fill colour it touches: skin gets a darker skin, tops with a shade get night, the rest ink. */
function sprOutline(fill, look) {
  if (fill === look.skin) return fill === 'skinC' ? 'ink' : fill === 'skinA' ? 'skinC' : 'ink';
  return sprTopShade[fill] ? 'night' : 'ink';
}

/* ------------------------------------- sheets ------------------------------------- */

const sprSheets = new WeakMap(); // Look -> { base, amber, red, done } canvases
const sprMirrors = new WeakMap(); // sheet -> mirrored sheet

/**
 * Sheet of a look: FRAME.count frames of 12 x 20, baked on first use and kept per look and variant.
 * variant: null | 'amber' (waiting: amber outline) | 'red' (error: red outline) | 'done' (greyed).
 */
function bakeSheet(look, variant) {
  let byVariant = sprSheets.get(look);
  if (!byVariant) { byVariant = {}; sprSheets.set(look, byVariant); }
  const key = variant || 'base';
  if (byVariant[key]) return byVariant[key];
  const w = sprW * FRAME.count;
  const { c, g } = makeBuffer(w, sprH);
  const img = g.createImageData(w, sprH);
  const d = img.data;
  sprSpecs.forEach((spec, i) => {
    const cells = sprFrame(look, spec, variant || null);
    for (let y = 0; y < sprH; y++) {
      for (let x = 0; x < sprW; x++) {
        const name = cells[y * sprW + x];
        if (!name) continue;
        const o = (y * w + i * sprW + x) * 4;
        const col = rgb(name);
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
  });
  g.putImageData(img, 0, 0);
  byVariant[key] = c;
  return c;
}

/** Mirrored copy of a sheet, made on first flip: drawing a flipped frame is then one plain drawImage. */
function sprMirror(sheet) {
  let m = sprMirrors.get(sheet);
  if (m) return m;
  const { c, g } = makeBuffer(sheet.width, sheet.height);
  g.translate(sheet.width, 0);
  g.scale(-1, 1);
  g.drawImage(sheet, 0, 0);
  m = c;
  sprMirrors.set(sheet, m);
  return m;
}

/** Draws a frame with its feet at (x, y) (rounded); flip mirrors it (left-facing side frames). */
function drawSprite(g, sheet, frame, x, y, flip) {
  const dx = Math.round(x) - sprW / 2;
  const dy = Math.round(y) - (sprH - 1);
  if (flip) g.drawImage(sprMirror(sheet), sheet.width - (frame + 1) * sprW, 0, sprW, sprH, dx, dy, sprW, sprH);
  else g.drawImage(sheet, frame * sprW, 0, sprW, sprH, dx, dy, sprW, sprH);
}

/**
 * Face and bust of a person on a canvas the caller sized (the card, the dialog box). The portrait is the top
 * of the standing front frame, scaled by the largest whole factor that fits, centred on a carpet. `role`
 * is optional: without it the role last given to lookFor for that id is used.
 */
function drawPortrait(canvas, id, role) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const sheet = bakeSheet(lookFor(id, role || sprRoles.get(id) || 'agent'), null);
  const bustH = 12;
  const k = Math.max(1, Math.floor(Math.min(canvas.width / sprW, canvas.height / bustH)));
  g.fillStyle = palColor('carpB');
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = palColor('carpA');
  g.fillRect(0, 0, canvas.width, Math.round(canvas.height * 0.62));
  const x = Math.floor((canvas.width - sprW * k) / 2);
  const y = canvas.height - bustH * k;
  g.drawImage(sheet, 0, 1, sprW, bustH, x, y, sprW * k, bustH * k);
}

/* -------------------------------------- props -------------------------------------- */

/*
 * Small sprites held or used by people: rows and colour map, baked with bakeRows on first access.
 * Letters are local to each prop: its map names the palette colours.
 */
const sprPropDefs = {
  cup: { rows: ['wwww..', 'wwwwww', 'wwwwWw', '.wwww.'], map: { w: 'white', W: 'steelL' } },
  paper: { rows: ['wwwwwwww', 'WWWWWWWW', 'wsssswww', 'wwwwwwww', 'wsssssww', 'wwwwwwww'], map: { w: 'white', W: 'steelL', s: 'steel' } },
  bowl: { rows: ['YYYYY', 'ooooo', '.ooo.'], map: { Y: 'lampHi', o: 'pot' } },
  can: { rows: ['..ssss', '.s..ss', 'ssss.s', 'ssssss', 'ssssss'], map: { s: 'steelL' } },
  phone: { rows: ['kkk', 'kgk', 'kgk', 'kgk', 'kkk'], map: { k: 'ink', g: 'screen' } },
  cigarette: { rows: ['wwwwy'], map: { w: 'white', y: 'red' } },
  hourglass: { rows: ['yyyyy', '.yyy.', '..y..', '.yyy.', 'yyyyy'], map: { y: 'lamp' } },
  folder: { rows: ['yyy....', 'yyyyyyy', 'YYYYYYY', 'yyyyyyy', 'yyyyyyy', 'yyyyyyy'], map: { y: 'lamp', Y: 'lampHi' } },
  book: { rows: ['bbbbbbb', 'bwwwwwb', 'bwdddwb', 'bwwwwwb', 'bbbbbbb'], map: { b: 'brick', w: 'white', d: 'steel' } },
  glass: { rows: ['c.c', 'ccc', 'GGG', 'GGG', '.G.'], map: { c: 'glassHi', G: 'glass' } },
  marker: { rows: ['k', 'r', 'r', 'r'], map: { k: 'ink', r: 'red' } },
};

const sprPropCache = {};
function sprProp(name) {
  return sprPropCache[name] || (sprPropCache[name] = bakeRows(sprPropDefs[name].rows, sprPropDefs[name].map));
}

/** Prop canvases by name, baked on first access (reading PROPS.cup is the only moment a canvas is made). */
const PROPS = {
  get cup() { return sprProp('cup'); },
  get paper() { return sprProp('paper'); },
  get bowl() { return sprProp('bowl'); },
  get can() { return sprProp('can'); },
  get phone() { return sprProp('phone'); },
  get cigarette() { return sprProp('cigarette'); },
  get hourglass() { return sprProp('hourglass'); },
  get folder() { return sprProp('folder'); },
  get book() { return sprProp('book'); },
  get glass() { return sprProp('glass'); },
  get marker() { return sprProp('marker'); },
};
