/*
 * scripts/mesure-pixel.js: frame-rate measurement of the pixel view (budget: docs/vue-pixel.md, section 2.12).
 *
 * Usage (from the repository root, the demo running with the big scene):
 *   BUREAU_DEMO=gros BUREAU_PORT=47331 bun run demo
 *   boite browser set viewport 1280 800
 *   boite browser open "http://127.0.0.1:47331/?demo=1"    # demo=1 shows the time control of the demo
 *   boite browser eval "$(cat scripts/mesure-pixel.js)"    # injects window.__mesurePixel
 *   boite browser eval "__mesurePixel.start({passes: 3})"  # returns at once, the run takes about 1 minute
 *   boite browser eval "__mesurePixel.get()"               # progress, then the table (Markdown) and the JSON
 *
 * Scenarios: floor view by day (12:00) and night (03:00) with a pan on the floor, floor-to-floor scroll (PageUp and
 * PageDown, the animated step), advanced view with the capsules in progress, and the technical plan.
 * Each run waits 1.5 s, then measures 5 s (the window of __pixel.perf()). Frame intervals come from a wrapper
 * around requestAnimationFrame ("pire image" is the longest gap between two frames); CPU per image is the mean
 * and the maximum of the update + render time from __pixel.perf(); the allocation is the growth of the JS heap
 * per frame (coarse: the browser rounds it, and only Chromium exposes it). The demo keeps changing the people
 * and the talks during the run, as it does for a visitor: nothing is frozen.
 * Options: {passes, ms, scenarios}. The median of the passes is kept.
 */
(() => {
  const BUDGET = {fps: 60, worst: 34, cpuFloor: 3, cpuAdvanced: 4, allocKB: 100};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const SCEN = [
    {name: 'Étage, jour (3 étages à l’écran)', hour: 12, view: 'floor', act: 'pan', budget: 'cpuFloor'},
    {name: 'Étage, nuit (3 étages à l’écran)', hour: 3, view: 'floor', act: 'pan', budget: 'cpuFloor'},
    {name: 'Défilement d’un étage au suivant', hour: 12, view: 'floor', act: 'scroll', budget: 'cpuFloor'},
    {name: 'Vue avancée, capsules en cours', hour: 12, view: 'advanced', plan: false, act: 'rest', budget: 'cpuAdvanced'},
    {name: 'Plan technique', hour: 12, view: 'advanced', plan: true, act: 'rest', budget: 'cpuAdvanced'},
  ];

  function plan(on) {
    const b = document.getElementById('bPlanTech');
    if (b && !b.hidden && (b.getAttribute('aria-pressed') === 'true') !== on) b.click();
  }

  async function once(s, o) {
    const P = window.__pixel;
    const cv = document.getElementById('scene');
    P.hour(s.hour);
    P.view(s.view);
    plan(!!s.plan);
    await wait(1500);
    const r = cv.getBoundingClientRect(), cx = r.left + r.width / 2 + 100, cy = r.top + r.height / 2;
    const ev = (type, x, y, bt, bs) => cv.dispatchEvent(new PointerEvent(type, {pointerId: 7, bubbles: true, clientX: x, clientY: y, button: bt, buttons: bs, pointerType: 'mouse'}));
    const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true}));
    const intervals = [], heap = [];
    const raf0 = window.requestAnimationFrame.bind(window);
    let last = 0, on = true;
    window.requestAnimationFrame = (cb) => raf0((ts) => {
      cb(ts);
      if (on) {
        if (last) intervals.push(ts - last);
        heap.push(performance.memory ? performance.memory.usedJSHeapSize : 0);
      }
      last = ts;
    });
    await new Promise((res) => raf0(() => raf0(res)));
    last = 0;
    const t0 = performance.now();
    const pan = s.act === 'pan';
    if (pan) ev('pointerdown', cx, cy, 0, 1);
    let step = 0;
    await new Promise((res) => {
      const tick = () => {
        const t = performance.now() - t0;
        if (t > o.ms) { res(); return; }
        if (pan) ev('pointermove', cx + 260 * Math.sin(t / 700), cy + 150 * Math.sin(t / 1100), 0, 1);
        if (s.act === 'scroll' && t > step * 1200) { key(step % 2 ? 'PageUp' : 'PageDown'); step++; }
        raf0(tick);
      };
      raf0(tick);
    });
    if (pan) ev('pointerup', cx, cy, 0, 0);
    on = false;
    window.requestAnimationFrame = raf0;
    const perf = P.perf() || {cpuMs: 0, worstMs: 0};
    let alloc = 0;
    for (let i = 1; i < heap.length; i++) { const d = heap[i] - heap[i - 1]; if (d > 0) alloc += d; }
    const sum = intervals.reduce((x, y) => x + y, 0);
    return {
      fps: intervals.length / (sum / 1000), worst: Math.max(...intervals), cpu: perf.cpuMs, cpuMax: perf.worstMs,
      allocKB: alloc / 1024 / Math.max(1, heap.length), frames: intervals.length,
    };
  }

  async function run(opts) {
    const o = Object.assign({passes: 3, ms: 5000, scenarios: SCEN.map((s) => s.name)}, opts || {});
    if (!window.__pixel) throw new Error('window.__pixel is missing: is this the pixel view?');
    const chosen = SCEN.filter((s) => o.scenarios.includes(s.name));
    const res = {};
    const total = o.passes * chosen.length;
    let n = 0;
    for (let p = 0; p < o.passes; p++) {
      for (const s of chosen) {
        (res[s.name] = res[s.name] || []).push(await once(s, o));
        n++;
        st.label = s.name + ' passage ' + (p + 1) + '/' + o.passes + ' (' + n + '/' + total + ')';
      }
    }
    window.__pixel.hour(null);
    window.__pixel.view('floor');
    plan(false);
    const rows = chosen.map((s) => {
      const m = (f) => median(res[s.name].map((x) => x[f]));
      const row = {scenario: s.name, fps: +m('fps').toFixed(1), worstMs: +m('worst').toFixed(1), cpuMs: +m('cpu').toFixed(2),
        cpuMaxMs: +m('cpuMax').toFixed(1), allocKB: +m('allocKB').toFixed(0), frames: m('frames')};
      row.ok = row.fps >= BUDGET.fps && row.worstMs <= BUDGET.worst && row.cpuMs <= BUDGET[s.budget] && row.allocKB <= BUDGET.allocKB;
      return row;
    });
    const line = (c) => '| ' + c.join(' | ') + ' |';
    const table = [
      line(['Mesure', 'images/s', 'pire image (ms)', 'CPU/image (ms)', 'CPU max (ms)', 'Ko/image', 'budget']),
      line(['---', '---', '---', '---', '---', '---', '---']),
      ...rows.map((r) => line([r.scenario, r.fps, r.worstMs, r.cpuMs, r.cpuMaxMs, r.allocKB, r.ok ? 'tenu' : 'dépassé'])),
      '',
      'Budget : images/s au moins ' + BUDGET.fps + ', pire image au plus ' + BUDGET.worst + ' ms, CPU/image au plus ' + BUDGET.cpuFloor +
        ' ms (étage) / ' + BUDGET.cpuAdvanced + ' ms (vue avancée), Ko/image au plus ' + BUDGET.allocKB + '.',
      'Fenêtre : ' + window.innerWidth + ' x ' + window.innerHeight + ', ' + o.passes + ' passages, médiane, ' + o.ms + ' ms par passage.',
    ].join('\n');
    return {rows, table};
  }

  const st = {done: false, label: '', result: null, error: null};
  window.__mesurePixel = {
    BUDGET,
    start(opts) {
      st.done = false; st.result = null; st.error = null;
      run(opts).then((r) => { st.result = r; st.done = true; }, (e) => { st.error = String(e && e.stack || e); st.done = true; });
      return 'started';
    },
    get() { return st.error ? 'error: ' + st.error : st.done ? st.result.table + '\n\n' + JSON.stringify(st.result.rows) : 'running: ' + st.label; },
  };
  return 'ok';
})()
