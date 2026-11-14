/* web/pixel/facade.js : lot L6, voir docs/vue-pixel.md (2.8) */
/*
 * The floor bar on the right of the scene (the file keeps its old name): a map of the building made of DOM buttons,
 * one band per floor, the sky strip at the top, the street at the bottom. A frame shows what is on screen, a small
 * mark shows the cab. Lot L6, contract in 2.8. Shares one scope with the other web/pixel files: the public names are
 * buildFloorBar and updateFloorBar, every other top-level name wears `fac`. Declares only, nothing runs at load.
 *
 * Choices recorded here:
 *  - The bands tile the building: floor i covers [floorTop(i) - SLAB, floorTop(i-1) - SLAB[ in world px (the slab above
 *    with the name plate, then the plate: the same thing navGoto frames); the top floor also takes the sky, the ground
 *    floor the street. The bar is scaled to its own height, so any number of floors fits.
 *  - updateFloorBar rebuilds the buttons by itself when the floors changed (count, ids, names, construction) or when the
 *    bar was resized, and otherwise writes the DOM only on change (frame and cab through transform, classes by a cached key).
 *  - Every button is a real <button>, in reading order from the top floor down, with an aria-label that says the floor,
 *    the project and who waits; the current floor carries aria-current.
 */

let facRoot = null;
let facFrame = null;
let facCab = null;
let facH = 0;                      // bar height in CSS px
let facScale = 0;                  // bar px per world px
let facBands = [];                 // { el, fl, wait, cons, on }
let facIds = [];                   // ids of the floors the bands were built for
let facNames = [];
let facCons = [];
let facFrameTop = -1;
let facFrameH = -1;
let facCabKey = -1;
let facObserver = null;
let facDirty = true;
let facAdv = false;

function facEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function facRootEl() {
  if (facRoot) return facRoot;
  facRoot = document.getElementById('etages');
  if (facRoot && typeof ResizeObserver === 'function' && !facObserver) {
    facObserver = new ResizeObserver(() => { facDirty = true; });
    facObserver.observe(facRoot);
  }
  return facRoot;
}

/** True when the floors differ from the ones the bands were built for. Allocates nothing. */
function facChanged() {
  const n = FLOORS.length;
  if (facDirty || facIds.length !== n) return true;
  for (let i = 0; i < n; i++) {
    const fl = FLOORS[i];
    if (facIds[i] !== fl.id || facNames[i] !== fl.name || facCons[i] !== (fl.p < 1)) return true;
  }
  return false;
}

/** The short name under the number: « Accueil » for the ground floor, else the project name (cut by the CSS). */
function facShortName(fl) {
  return fl.index === 0 ? 'Accueil' : fl.name;
}

/** Builds one button per floor, top floor first. */
function buildFloorBar() {
  const root = facRootEl();
  if (!root) return;
  facDirty = false;
  facH = root.clientHeight;
  const n = FLOORS.length;
  const hadFocus = facRoot.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.i : null;
  if (!facFrame) {
    facFrame = facEl('div', 'etages-cadre');
    facFrame.setAttribute('aria-hidden', 'true');
    facCab = facEl('div', 'etages-cabine');
    facCab.setAttribute('aria-hidden', 'true');
    facCab.title = 'Ascenseur';
  }
  facBands = [];
  facIds = [];
  facNames = [];
  facCons = [];
  const kids = [];
  if (n && facH > 0) {
    const total = buildingSize(n, FLOORS[0].plan ? FLOORS[0].plan.cols : COLS_MIN).h;
    facScale = facH / total;
    for (let i = n - 1; i >= 0; i--) {
      const fl = FLOORS[i];
      const top = i === n - 1 ? 0 : floorTop(i, n) - SLAB;
      const bottom = i === 0 ? total : floorTop(i - 1, n) - SLAB;
      const b = facEl('button', fl.p < 1 ? 'cons' : '');
      b.type = 'button';
      b.dataset.i = String(i);
      b.style.top = Math.round(top * facScale) + 'px';
      const bandH = Math.max(8, Math.round((bottom - top) * facScale));
      b.style.height = bandH + 'px';
      const lines = clamp(Math.floor((bandH - 34) / 12), 0, 3);   // lines of the name that fit under the number (0: none)
      if (lines) b.style.setProperty('--l', String(lines)); else b.classList.add('court');
      b.append(facEl('span', 'no', i === 0 ? 'Rez' : String(i)), facEl('span', 'na', facShortName(fl)), facEl('span', 'dot'));
      b.addEventListener('click', () => navGoto(i));
      kids.push(b);
      facBands.push({ el: b, i, wait: -1, cons: fl.p < 1, on: false, label: '' });
      facIds.push(fl.id);
      facNames.push(fl.name);
      facCons.push(fl.p < 1);
    }
    facIds.reverse();
    facNames.reverse();
    facCons.reverse();
  }
  facRoot.replaceChildren(...(kids.length ? [facFrame, facCab] : []), ...kids);
  facFrameTop = -1;
  facFrameH = -1;
  facCabKey = -1;
  if (hadFocus != null) {
    const b = facRoot.querySelector('button[data-i="' + hadFocus + '"]');
    if (b) b.focus({ preventScroll: true });
  }
  facMarks();
}

/** Classes and labels of the bands: only the ones that changed. */
function facMarks() {
  for (const band of facBands) {
    const fl = FLOORS[band.i];
    if (!fl) continue;
    const st = fl.stats || null;
    const wait = st ? st.waiting || 0 : 0;
    const on = NAV.floor === band.i;
    const cons = fl.p < 1;
    if (wait !== band.wait || on !== band.on || cons !== band.cons || !band.label) {
      band.wait = wait;
      band.on = on;
      band.cons = cons;
      band.el.classList.toggle('wait', wait > 0);
      band.el.classList.toggle('on', on);
      band.el.classList.toggle('cons', cons);
      if (on) band.el.setAttribute('aria-current', 'true'); else band.el.removeAttribute('aria-current');
      const total = st ? st.total || 0 : 0;
      const label = fl.title + ' : ' + fl.name
        + (cons ? ', chantier en cours' : ', ' + total + (total > 1 ? ' agents' : ' agent'))
        + (wait ? ', ' + wait + (wait > 1 ? ' attendent' : ' attend') : '');
      band.label = label;
      band.el.setAttribute('aria-label', label);
    }
  }
}

/** Every frame: the frame of what is on screen, the mark of the cab, the current floor, the waiting dots. */
function updateFloorBar(T) {
  if (!facRootEl()) return;
  if (facChanged()) buildFloorBar();
  if (!(facH > 0) || !FLOORS.length) return;
  const adv = NAV.mode === 'advanced';
  if (adv !== facAdv) {                      // the frame and the cab mark describe the floor view's world: hidden in the cutaway
    facAdv = adv;
    facFrame.hidden = adv;
    facCab.hidden = adv;
  }
  if (adv) { facMarks(); return; }
  const cam = floorCam, s = facScale;
  const h = Math.min(facH, Math.max(6, Math.round(cam.bh * s)));
  const top = Math.round(clamp(cam.y * s, 0, facH - h));
  if (h !== facFrameH) {
    facFrameH = h;
    facFrame.style.height = h + 'px';
  }
  if (top !== facFrameTop) {
    facFrameTop = top;
    facFrame.style.transform = 'translateY(' + top + 'px)';
  }
  const cab = Math.round((LIFT.y - 34) * s);
  if (cab !== facCabKey) {
    facCabKey = cab;
    facCab.style.transform = 'translateY(' + cab + 'px)';
  }
  facMarks();
}
