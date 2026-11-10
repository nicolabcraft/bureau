/*
 * scripts/mesure-vue.js: frame-rate measurement of the building view (budget: docs/vue-immeuble.md, section 6).
 *
 * Usage (from the repository root, the demo running with the big scene):
 *   BUREAU_DEMO=gros BUREAU_PORT=47331 bun run demo
 *   boite browser set viewport 1280 800
 *   boite browser open "http://127.0.0.1:47331/?demo=1"        # demo=1 is required: without it the hour is the real one (setMin ignored)
 *   boite browser eval "$(cat scripts/mesure-vue.js)"      # injects window.__mesure
 *   boite browser eval "__mesure.start({passes: 3})"       # returns at once, the run takes about 1.5 minutes
 *   boite browser eval "__mesure.get()"                    # progress, then the table (Markdown) and the JSON
 *
 * Scenarios, each in day (12:00) and night (03:00): pan, zoom, rotate (overview), and pan on an open floor.
 * It uses synthetic pointer and wheel events plus requestAnimationFrame timestamps, on the real floors and agents
 * the data module put in the scene: nothing is faked. The service data is frozen while it runs
 * (__bureau.noEvents), and the median of the passes is kept. Options: {passes, ms, scenarios, hours, floor}.
 * CPU per frame is the time spent inside the frame callback; allocation is the growth of the JS heap per frame
 * (coarse: the browser rounds it); "worst frame" is the longest gap between two frames.
 */
(() => {
  const BUDGET = {fps: 60, worst: 34, cpuOverview: 3, cpuOpen: 4, allocKB: 150};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const SCEN = {
    pan: {focus: -1}, zoom: {focus: -1}, rotate: {focus: -1}, panOpen: {focus: 1, zoom: 1.5},
  };
  const HOURS = {day: 720, night: 180};

  async function once(B, cv, scen, hour, o) {
    const def = SCEN[scen];
    B.setMin(HOURS[hour]);
    const floor = def.focus < 0 ? -1 : Math.min(o.floor != null ? o.floor : def.focus, B.floors.length - 1);
    B.setFocus(floor);
    await wait(2000);                      // the floors finish opening or closing, the camera settles
    if (def.zoom) B.setZoom(def.zoom);
    await wait(300);
    const r = cv.getBoundingClientRect(), cx = r.left + r.width / 2 + 100, cy = r.top + r.height / 2;
    const P = (type, x, y, b, bs) => cv.dispatchEvent(new PointerEvent(type, {pointerId: 7, bubbles: true, clientX: x, clientY: y, button: b, buttons: bs, pointerType: 'mouse'}));
    const cpu = [], iv = [], hp = [];
    const raf0 = window.requestAnimationFrame.bind(window);
    let lastTs = 0, on = true;
    window.requestAnimationFrame = (cb) => raf0((ts) => { const t = performance.now(); cb(ts); if (on) { cpu.push(performance.now() - t); hp.push(performance.memory ? performance.memory.usedJSHeapSize : 0); if (lastTs) iv.push(ts - lastTs); } lastTs = ts; });
    await new Promise((res) => raf0(() => raf0(res)));   // one frame so that the wrapper is in place
    lastTs = 0;
    const t0 = performance.now();
    const btn = scen === 'rotate' ? 2 : 0, bs = scen === 'rotate' ? 2 : 1;
    const dragging = scen !== 'zoom';
    if (dragging) P('pointerdown', cx, cy, btn, bs);
    await new Promise((res) => {
      const step = () => {
        const t = performance.now() - t0;
        if (t > o.ms) { res(); return; }
        if (scen === 'pan' || scen === 'panOpen') P('pointermove', cx + 260 * Math.sin(t / 700), cy + 150 * Math.sin(t / 1100), btn, bs);
        else if (scen === 'rotate') P('pointermove', cx + 300 * Math.sin(t / 900), cy, btn, bs);
        else cv.dispatchEvent(new WheelEvent('wheel', {deltaY: -60 * Math.sin(t / 500) - 4 * Math.cos(t / 500), clientX: cx, clientY: cy, bubbles: true, cancelable: true}));
        raf0(step);
      };
      raf0(step);
    });
    if (dragging) P('pointerup', cx, cy, btn, 0);
    on = false;
    window.requestAnimationFrame = raf0;
    let alloc = 0;
    for (let i = 1; i < hp.length; i++) { const d = hp[i] - hp[i - 1]; if (d > 0) alloc += d; }
    const sum = iv.reduce((x, y) => x + y, 0);
    return {
      fps: iv.length / (sum / 1000), worst: Math.max(...iv), over25: iv.filter((x) => x > 25).length,
      cpu: cpu.reduce((x, y) => x + y, 0) / cpu.length, cpuMax: Math.max(...cpu), allocKB: alloc / 1024 / Math.max(1, hp.length), frames: iv.length,
    };
  }

  async function run(opts) {
    const o = Object.assign({passes: 3, ms: 3500, scenarios: Object.keys(SCEN), hours: Object.keys(HOURS), floor: null}, opts || {});
    const B = window.__bureau, cv = document.getElementById('cv');
    if (!B) throw new Error('window.__bureau is missing: is this the building view?');
    cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {};
    B.noEvents(true);
    const info = {floors: B.floors.length, agents: B.agents.filter((a) => a.role !== 'worker').length, canvas: cv.width + 'x' + cv.height, dpr: B.size.dpr, ua: navigator.userAgent.slice(-24)};
    const res = {};
    st.progress = 0;
    const total = o.passes * o.scenarios.length * o.hours.length;
    for (let p = 0; p < o.passes; p++) {
      for (const sc of o.scenarios) for (const h of o.hours) {
        const key = sc + ' ' + h;
        (res[key] = res[key] || []).push(await once(B, cv, sc, h, o));
        st.progress++; st.label = key + ' pass ' + (p + 1) + '/' + o.passes + ' (' + st.progress + '/' + total + ')';
      }
    }
    delete cv.setPointerCapture; delete cv.releasePointerCapture;
    B.setFocus(-1); B.setMin(null); B.noEvents(false);
    const rows = Object.keys(res).map((k) => {
      const m = (f) => median(res[k].map((x) => x[f]));
      const open = k.startsWith('panOpen');
      const row = {scenario: k, fps: +m('fps').toFixed(1), worstMs: +m('worst').toFixed(1), cpuMs: +m('cpu').toFixed(2), cpuMaxMs: +m('cpuMax').toFixed(1), allocKB: +m('allocKB').toFixed(0), over25: m('over25')};
      row.ok = row.fps >= BUDGET.fps && row.worstMs <= BUDGET.worst && row.cpuMs <= (open ? BUDGET.cpuOpen : BUDGET.cpuOverview) && row.allocKB <= BUDGET.allocKB;
      return row;
    });
    const line = (c) => '| ' + c.join(' | ') + ' |';
    const table = [
      line(['Scenario', 'images/s', 'pire image (ms)', 'CPU/image (ms)', 'CPU max (ms)', 'Ko/image', 'budget']),
      line(['---', '---', '---', '---', '---', '---', '---']),
      ...rows.map((r) => line([r.scenario, r.fps, r.worstMs, r.cpuMs, r.cpuMaxMs, r.allocKB, r.ok ? 'tenu' : 'depasse'])),
      '',
      'Budget: images/s >= ' + BUDGET.fps + ', pire image <= ' + BUDGET.worst + ' ms, CPU/image <= ' + BUDGET.cpuOverview + ' ms (ensemble) / ' + BUDGET.cpuOpen + ' ms (etage ouvert), alloue <= ' + BUDGET.allocKB + ' Ko/image.',
      'Scene: ' + JSON.stringify(info) + ', ' + o.passes + ' passes, median.',
    ].join('\n');
    return {info, rows, table};
  }

  const st = {done: false, progress: 0, label: '', result: null, error: null};
  window.__mesure = {
    BUDGET,
    start(opts) { st.done = false; st.result = null; st.error = null; run(opts).then((r) => { st.result = r; st.done = true; }, (e) => { st.error = String(e && e.stack || e); st.done = true; }); return 'started'; },
    get() { return st.error ? 'error: ' + st.error : st.done ? st.result.table + '\n\n' + JSON.stringify(st.result.rows) : 'running: ' + st.label; },
  };
  return 'ok';
})()
