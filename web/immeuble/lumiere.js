/* web/immeuble/lumiere.js: part of the building view, owned by the « ville » module (see docs/vue-immeuble.md). */
/* ================================================================ palette and light */
const PAL = {
  arch:   {floor:'#383A60', grid:'#3D3F68', line:'#4D4F7E', wall:'#8F95D8'},
  design: {floor:'#4B3659', grid:'#523C61', line:'#614774', wall:'#AE8FCC'},
  dev:    {floor:'#2D4569', grid:'#314C72', line:'#3F5780', wall:'#6C8EBF'},
  qual:   {floor:'#364C3A', grid:'#3B5340', line:'#4A6450', wall:'#7FB77E'},
  prod:   {floor:'#2E4B4E', grid:'#32524F', line:'#43686A', wall:'#69A596'},
  data:   {floor:'#553E36', grid:'#5C433A', line:'#6D5045', wall:'#D98F5B'},
  chef:   {floor:'#5A4A40', grid:'#62514A', line:'#7A6458', wall:'#C79A6B'},
  hall:   {floor:'#394254', grid:'#3D475A', line:'#4B566C', wall:'#8794AD'},
  lobby:  {floor:'#414B60', grid:'#454F65', line:'#55607A', wall:'#8794AD'},
  cafe:   {floor:'#5B4636', grid:'#634C3A', line:'#6D5045', wall:'#D0B25E'}
};
const CONC = '#3A4357';
const KEYS = [
  {h:0,    w:[8,14,44,.60],     lamp:1,   day:0,   t:'#070b1d', b:'#141c36'},
  {h:5,    w:[8,14,44,.58],     lamp:1,   day:0,   t:'#0a0f26', b:'#18213f'},
  {h:6.5,  w:[250,150,110,.16], lamp:.7,  day:.35, t:'#33406e', b:'#c98a68'},
  {h:8,    w:[255,225,190,.04], lamp:.15, day:.85, t:'#3e5f90', b:'#c7a47c'},
  {h:11,   w:[255,255,255,0],   lamp:0,   day:1,   t:'#365a86', b:'#6f93b5'},
  {h:16,   w:[255,235,200,.03], lamp:0,   day:1,   t:'#3a5c88', b:'#7b98b4'},
  {h:18.3, w:[255,130,90,.16],  lamp:.5,  day:.5,  t:'#323c6c', b:'#b9694f'},
  {h:19.8, w:[40,40,100,.38],   lamp:.9,  day:.15, t:'#1b2250', b:'#5b4470'},
  {h:21.5, w:[8,14,44,.58],     lamp:1,   day:0,   t:'#0a0f26', b:'#18213f'},
  {h:24,   w:[8,14,44,.60],     lamp:1,   day:0,   t:'#070b1d', b:'#141c36'}
];
const LT = {h:12, w:'rgba(0,0,0,0)', lamp:0, day:1, t:'#365a86', b:'#6f93b5', wa:0, wr:0, wg:0, wb:0, hf:.5};
function lightAt(h){
  let i = 0; while(i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = clamp((h - a.h) / (b.h - a.h), 0, 1);
  LT.h = h; LT.lamp = lerp(a.lamp, b.lamp, t); LT.day = lerp(a.day, b.day, t);
  LT.t = mx(a.t, b.t, t); LT.b = mx(a.b, b.b, t); LT.hf = clamp((h - 6) / 12, 0, 1);
  const w = a.w.map((v, k) => lerp(v, b.w[k], t));
  LT.wa = w[3]; LT.wr = w[0]; LT.wg = w[1]; LT.wb = w[2];
  LT.w = 'rgba(' + (w[0] | 0) + ',' + (w[1] | 0) + ',' + (w[2] | 0) + ',' + w[3].toFixed(3) + ')';
}
let manualMin = null, fast = false, fastMin = 12 * 60;
const DT = new Date();
function realMin(){ DT.setTime(Date.now()); return DT.getHours() * 60 + DT.getMinutes() + DT.getSeconds() / 60 + DT.getMilliseconds() / 60000; }
/* real time, always; the manual time (and the fast day) only exist behind ?demo=1 */
function curMin(){ return DEMO && fast ? fastMin : DEMO && manualMin != null ? manualMin : realMin(); }
function phaseOf(h){ return h >= 5 && h < 11 ? 'Matin' : h >= 11 && h < 18 ? 'Journée' : h >= 18 && h < 22 ? 'Soir' : 'Nuit'; }
let T = 0;

function lightsFor(fl){
  ZB = fl.z0; ZL = fl.lift;
  const L = LT.lamp, night = clamp(1 - LT.day * 1.3, 0, 1);
  const done = !fl.plot || fl.plot.done;
  if(!done && T - fl.plot.start < 8200) return;
  for(const d of fl.desks){
    const ag = d.agent ? agentById(d.agent) : null; if(!ag || ag.mode !== 'sit' || ag.fl !== fl.i) continue;
    glow(d.x + 1, d.y + 1.5, 0, 74, '255,206,130', .26 * L, true);
    glow(d.x + .3, d.y + .65, 40, 18, '255,226,160', .45 * L);
    glow(d.x + 1.4, d.y + .4, 28, 30, '143,217,196', .10 + .34 * night);
    if(night > .1) glow(d.x + 1.45, d.y + 1.25, 0, 40, '143,217,196', .24 * night, true);
  }
  for(const f of fl.fix){
    if(f.kind === 'lamp'){ glow(f.x, f.y, 50, 74, '255,214,140', .7 * L); glow(f.x, f.y, 0, 90, '255,206,130', .35 * L, true); }
    else if(f.kind === 'vend') glow(f.x, f.y + .5, 30, 56, f.c === '#7fd0ff' ? '127,208,255' : '255,155,208', .16 + .22 * L);
    else if(f.kind === 'coffee') glow(f.x, f.y + .5, 38, 20, '143,217,196', .25 + .2 * L);
    else if(f.kind === 'elev' && fl.eo > .05) glow(f.x, f.y + .5, 30, 50, '255,240,200', .35 * fl.eo, false);
  }
  if(L > .05) for(const a of fl.areas) glow((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, 0, 130, '255,230,190', .06 * L, true);
  if(fl.i === 0) glow(DOORX + 1, D + .6, 0, 80, '255,225,170', .18 * L, true);
}
const GS = new Map();
function glowSprite(col){
  let c = GS.get(col); if(c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(' + col + ',1)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128); GS.set(col, c); return c;
}
function glow(x, y, zz, r, col, a, flat){
  if(a <= .01) return;
  const p = pp(x, y, zz), spr = glowSprite(col);
  g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, a); g.drawImage(spr, p[0] - r, p[1] - (flat ? r * .5 : r), r * 2, flat ? r : r * 2); g.restore();
}
