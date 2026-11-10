/* web/immeuble/noyau.js: part of the building view, owned by the « moteur » module (see docs/vue-immeuble.md). */
/* ================================================================ utils */
const $ = (s) => document.querySelector(s);
const DEMO = /[?&]demo=1(&|$)/.test(location.search);
{ const pied = $('#pied'); if(DEMO && pied) pied.hidden = false; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const eo3 = (t) => 1 - Math.pow(1 - t, 3);
const eio = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const eob = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function mul32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const RND = new Uint8Array(256); { const rr = mul32(4242); for(let i = 0; i < 256; i++) RND[i] = (rr() * 100) | 0; }
function hashS(s){ let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const RCC = {};
function rgb(h){ let v = RCC[h]; if(!v){ const n = parseInt(h.slice(1), 16); v = RCC[h] = [n >> 16, (n >> 8) & 255, n & 255]; } return v; }
function hx(r, g, b){ return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
const SCo = new Map();
function sh(h, t){
  const ti = Math.round(t * 40); let o = SCo.get(h); if(!o){ o = []; SCo.set(h, o); }
  let v = o[ti + 80]; if(v !== undefined) return v;
  const tt = ti / 40, c = rgb(h), f = (u) => tt < 0 ? u * (1 + tt) : u + (255 - u) * tt;
  return o[ti + 80] = hx(f(c[0]), f(c[1]), f(c[2]));
}
function mx(a, b, t){ const x = rgb(a), y = rgb(b); return hx(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }

const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = RMQ.matches;
RMQ.addEventListener && RMQ.addEventListener('change', (e) => { reduced = e.matches; });

/* ================================================================ orientation and projection */
const SQ = Math.SQRT1_2;
let RA = 0, RAt = 0, RC = 1, RS = 0, ZB = 0, ZL = 0;
const PV = {x: 7.5, y: 8};
const FV = {px: true, mx: false, py: true, my: false};
const NS = {px: -.3, mx: -.04, py: -.04, my: -.3};
const CUT = {N: 0, W: 0, S: 1, E: 1};
/* screen x and y of the unit vector (nx, ny) once rotated: written in OX / OY, no allocation */
let OX = 0, OY = 0;
function orientVec(nx, ny){ const rx = nx * RC - ny * RS, ry = nx * RS + ny * RC; OX = (rx - ry) * SQ; OY = (rx + ry) * SQ; }
function orient(){
  RC = Math.cos(RA); RS = Math.sin(RA);
  FV.px = RC + RS > .03; FV.mx = RC + RS < -.03; FV.py = RC - RS > .03; FV.my = RC - RS < -.03;
  orientVec(1, 0); NS.px = -.17 - .18 * OX; CUT.E = smooth((OY + .2) / .45);
  orientVec(-1, 0); NS.mx = -.17 - .18 * OX; CUT.W = smooth((OY + .2) / .45);
  orientVec(0, 1); NS.py = -.17 - .18 * OX; CUT.S = smooth((OY + .2) / .45);
  orientVec(0, -1); NS.my = -.17 - .18 * OX; CUT.N = smooth((OY + .2) / .45);
}
const PRING = Array.from({length: 1024}, () => [0, 0]); let pri = 0;
const pp = (x, y, z = 0) => { const dx = x - PV.x, dy = y - PV.y, o = PRING[pri = (pri + 1) & 1023]; o[0] = (dx * RC - dy * RS - dx * RS - dy * RC) * 32; o[1] = (dx * RC - dy * RS + dx * RS + dy * RC) * 16 - z - ZB - ZL; return o; };
const dep = (x, y) => { const dx = x - PV.x, dy = y - PV.y; return dx * RC - dy * RS + dx * RS + dy * RC; };
let g;
function poly(a, fill, lineC){
  g.beginPath(); g.moveTo(a[0][0], a[0][1]);
  for(let i = 1; i < a.length; i++) g.lineTo(a[i][0], a[i][1]);
  g.closePath();
  if(fill){ g.fillStyle = fill; g.fill(); if(lineC){ g.strokeStyle = lineC; g.lineWidth = .8; g.lineJoin = 'round'; g.stroke(); } }
  else if(lineC){ g.strokeStyle = lineC; g.lineWidth = 1; g.stroke(); }
}
const QRING = Array.from({length: 128}, () => [null, null, null, null]); let qri = 0;
const q4 = (a, b, c, d) => { const o = QRING[qri = (qri + 1) & 127]; o[0] = a; o[1] = b; o[2] = c; o[3] = d; return o; };
const quadY = (x0, x1, y, z0, z1) => q4(pp(x0, y, z0), pp(x1, y, z0), pp(x1, y, z1), pp(x0, y, z1));
const quadX = (x, y0, y1, z0, z1) => q4(pp(x, y0, z0), pp(x, y1, z0), pp(x, y1, z1), pp(x, y0, z1));
const topQ = (x, y, w, d, z) => q4(pp(x, y, z), pp(x + w, y, z), pp(x + w, y + d, z), pp(x, y + d, z));
const CB = new Float64Array(8);
function setC(i, x, y){ const dx = x - PV.x, dy = y - PV.y; CB[2 * i] = (dx * RC - dy * RS - dx * RS - dy * RC) * 32; CB[2 * i + 1] = (dx * RC - dy * RS + dx * RS + dy * RC) * 16; }
function fq(i, j, zb, zt, col){
  g.beginPath(); g.moveTo(CB[2 * i], CB[2 * i + 1] - zb); g.lineTo(CB[2 * j], CB[2 * j + 1] - zb); g.lineTo(CB[2 * j], CB[2 * j + 1] - zt); g.lineTo(CB[2 * i], CB[2 * i + 1] - zt); g.closePath();
  g.fillStyle = col; g.fill();
}
function box(x, y, w, d, z, h, c, k = 1){
  const zb = z + ZB + ZL, zt = zb + h * k;
  setC(0, x, y); setC(1, x + w, y); setC(2, x + w, y + d); setC(3, x, y + d);
  if(FV.py) fq(3, 2, zb, zt, sh(c, NS.py));
  if(FV.my) fq(0, 1, zb, zt, sh(c, NS.my));
  if(FV.px) fq(1, 2, zb, zt, sh(c, NS.px));
  if(FV.mx) fq(0, 3, zb, zt, sh(c, NS.mx));
  const col = sh(c, .14);
  g.beginPath(); g.moveTo(CB[0], CB[1] - zt); g.lineTo(CB[2], CB[3] - zt); g.lineTo(CB[4], CB[5] - zt); g.lineTo(CB[6], CB[7] - zt); g.closePath();
  g.fillStyle = col; g.fill();
}
function line(a, b, col, w){ g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.stroke(); }
function ell(x, y, rx, ry, col){ g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fillStyle = col; g.fill(); }
function rrect(x, y, w, h, r, col){ g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = col; g.fill(); }
const FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
const TW = new Map();
// text on a vertical plane, along the segment (x,y) + t * (tx,ty), reading left to right on screen
function textOn(s, x, y, tx, ty, span, off, z, size, col, weight = 600){
  g.font = weight + ' ' + size + 'px ' + FONT;
  const tk = s + size + weight; let wt = TW.get(tk); if(wt === undefined){ wt = g.measureText(s).width / 32; TW.set(tk, wt); }
  let sx = x, sy = y, dx = tx, dy = ty, o = off;
  const A = pp(x, y, z), B = pp(x + tx * span, y + ty * span, z);
  if(B[0] < A[0]){ sx = x + tx * span; sy = y + ty * span; dx = -tx; dy = -ty; o = span - off - wt; }
  const P = pp(sx + dx * o, sy + dy * o, z), Q = pp(sx + dx * (o + 1), sy + dy * (o + 1), z);
  g.save(); g.transform((Q[0] - P[0]) / 32, (Q[1] - P[1]) / 32, 0, 1, P[0], P[1]);
  g.fillStyle = col; g.textAlign = 'left'; g.fillText(s, 0, 0); g.restore();
}
// affine frame on a vertical plane with tangent (tx,ty), unit = 1 px = 1/32 tile; returns true if drawable
function plane(x, y, z, tx, ty){
  const P = pp(x, y, z), Q = pp(x + tx, y + ty, z);
  if(Q[0] < P[0]){ tx = -tx; ty = -ty; }
  const P2 = pp(x, y, z), Q2 = pp(x + tx, y + ty, z);
  g.transform((Q2[0] - P2[0]) / 32, (Q2[1] - P2[1]) / 32, 0, 1, P2[0], P2[1]);
}
