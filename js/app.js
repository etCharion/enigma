/**
 * app.js — UI simulátoru Enigmy I.
 * Napojeno na čisté jádro z enigma-core.js.
 * Módy: "fast" (rychlé psaní) a "observe" (cesta signálu krok za krokem).
 */
import { EnigmaMachine, ROTORS, REFLECTOR_B, ALPHABET } from './enigma-core.js';
import { swapRotorOrder, pairKey, plugMate, resolvePlugClick } from './ui-logic.js';

// ── konstanty ──────────────────────────────────────────────────────────────
const QWERTZ_ROWS = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML']; // historická klávesnice Enigmy
const SLOT_CZ = { left: 'levé kolo', middle: 'střední kolo', right: 'pravé kolo' };
const SLOT_IDX = { left: 0, middle: 1, right: 2 };
// řádky rotoru shora dolů podle toku signálu: vpravo → doleva → reflektor
const DISPLAY_ROWS = ['right', 'middle', 'left', 'reflector'];
const CABLE_COLORS = ['#d8b13c', '#c96f4a', '#7fa35a', '#5a8fa3', '#a37fc9', '#c95a8a',
  '#b8b04a', '#4aa88f', '#d18a3c', '#8a9a3c', '#b04a6a', '#6a7fc9', '#c9b23c'];
// barvy jednotlivých kroků cesty signálu (krok 1–9); stejnou barvou svítí
// obě písmenka kroku i spojnice mezi nimi
const PATH_COLORS = ['#ffd166', '#ff9b52', '#ff6b6b', '#f473c8', '#b48cff',
  '#6aa9ff', '#3fd6cf', '#7fe07a', '#d9e85a'];
const STEP_DEG = 360 / 26;
// pás drátků mezi pásy P a L: při kroku kola se celý svazek otočí o jednu
// buňku (drátek z levého kraje přejede na pravý konec), písmena pásů stojí.
const WIRE_H = 46;            // výška pásu drátků v px (stejná jako v CSS)
const WIRE_SLIDE_MS = 280;    // jak dlouho se svazek otáčí
const SVG_NS = 'http://www.w3.org/2000/svg';
const wrap26 = (n) => ((n % 26) + 26) % 26;
// Vzhled drátku je zapsaný přímo na prvku (prezentační atributy), aby drátek byl
// zlatý a rozsvěcel se i tehdy, když se CSS nenačte nebo ho přepíše něco jiného.
const WIRE_DIM = '#d6b874';   // barva měděného drátku
const WIRE_ALPHA = 0.6;       // jak je drátek vidět, když nic nesvítí
const WIRE_FADE = 0.28;       // útlum ostatních drátků, když cesta svítí
const WIRE_DIM_W = 1.2;
const WIRE_LIT_W = 2.8;

const machine = new EnigmaMachine();
const state = {
  mode: 'fast',
  obs: null,            // { res, idx, timer, done } — právě pozorovaná cesta
  selectedPlug: null,   // vybraná zdířka plugboardu (rozpracovaný kabel = čárkovaný)
  hoverPlug: null,      // zdířka pod kurzorem (náhled kabelu)
  hoverPair: null,      // kabel zvýrazněný ze seznamu ('A-S')
  freshPair: null,      // právě vytvořený kabel — krátká animace rozsvícení
  cableGlow: new Map(), // 'A-S' → barva kroku: kabel svítí cestou signálu
  angle: { left: 0, middle: 0, right: 0 }, // kumulativní rotace kotoučů (neklesá při přetečení)
  wireLit: [],          // drátky rozsvícené cestou signálu [{ slot, from, to, color }]
  history: [],          // poslední stisky [{ input, output, positionsBefore, positionsAfter }]
  trail: [],            // DOM prvky právě rozsvícené jako cesta (pro úklid)
  wires: [],            // nakreslené spojnice [{ fromEl, toEl, color, linkFrom }]
  clearTimer: null,     // časovač zhasnutí cesty v rychlém módu
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mapy DOM podle písmena
const keyEls = {}, lampEls = {}, socketEls = {};
// kontakty podle strany kola: p = pravá strana, l = levá strana.
// Reflektor má jednu sadu kontaktů (signál se vrací stejnou stranou), ale
// kreslí se také jako dva pásy: P = vstupní písmeno, L = písmeno, s kterým je
// pevně spárované — pár je tak vidět ve sloupci, stejně jako u kol.
const faceEls = {
  left: { p: {}, l: {} },
  middle: { p: {}, l: {} },
  right: { p: {}, l: {} },
  reflector: { p: {}, l: {} },
};
// buňky podle sloupce (0–25): sloupec = pozice kontaktu na pásu.
// P pás je abecední (sloupec = písmeno), L pás má ve sloupci písmeno,
// které z kola vyleze — proto se obsah L pásu při každém kroku přepočítá.
const faceCols = {
  left: { p: [], l: [] },
  middle: { p: [], l: [] },
  right: { p: [], l: [] },
  reflector: { p: [], l: [] },
};
const rowEls = {};
// pás drátků každého řádku: { svg, paths, pos, token, sliding }
const wireEls = { left: null, middle: null, right: null, reflector: null };

// ── stavba DOM ─────────────────────────────────────────────────────────────

function buildRotorOrderSelects() {
  const ids = { left: '#sel-left', middle: '#sel-middle', right: '#sel-right' };
  const slots = ['left', 'middle', 'right'];
  // všechny tři selecty vždy ukazují skutečné pořadí z jádra
  const sync = () => {
    const order = machine.getRotorOrder();
    slots.forEach((s, i) => { $(ids[s]).value = order[i]; });
  };
  for (const [slot, sel] of Object.entries(ids)) {
    const el = $(sel);
    for (const name of Object.keys(ROTORS)) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = name;
      el.appendChild(opt);
    }
    el.addEventListener('change', () => {
      // Volba vždycky zabere: rotor zvolený v této pozici se sem PŘESUNE
      // a rotor, který tu byl, jde na jeho místo (prostá výměna dvou pozic).
      // Dřív se dosazoval „volný“ rotor, takže někdy volba nic nezměnila
      // a select vypadal, že nereaguje.
      const next = swapRotorOrder(machine.getRotorOrder(), SLOT_IDX[slot], el.value);
      machine.setRotorOrder(next);
      sync();
      cancelObserve('Pořadí rotorů změněno.');
      renderRotorRows();
      renderWindows();
    });
  }
  sync();
}

function buildPositions() {
  const ids = ['#pos-left', '#pos-middle', '#pos-right'];
  ids.forEach((sel, i) => {
    const el = $(sel);
    el.value = machine.getPositions()[i];
    el.addEventListener('change', () => {
      const v = el.value.toUpperCase();
      if (!/^[A-Z]$/.test(v)) { el.value = machine.getPositions()[i]; return; }
      const pos = machine.getPositions().split('');
      pos[i] = v;
      machine.setPositions(pos.join(''));
      cancelObserve('Pozice kol změněny ručně.');
      state.angle = { left: 0, middle: 0, right: 0 };
      renderWindows(true);
    });
  });
  $$('.pos-ctl').forEach((ctl) => {
    const i = Number(ctl.dataset.slot);
    ctl.querySelector('.pos-up').addEventListener('click', () => bumpPosition(i, +1));
    ctl.querySelector('.pos-down').addEventListener('click', () => bumpPosition(i, -1));
  });
  $('#btn-reset-pos').addEventListener('click', () => {
    machine.reset('AAA');
    state.angle = { left: 0, middle: 0, right: 0 };
    cancelObserve('Pozice resetovány na AAA.');
    syncPositionInputs();
    renderWindows(true);
  });
}

function bumpPosition(i, dir) {
  const pos = machine.getPositions().split('');
  const cur = pos[i].charCodeAt(0) - 65;
  pos[i] = ALPHABET[((cur + dir) % 26 + 26) % 26];
  machine.setPositions(pos.join(''));
  cancelObserve('Pozice kol změněny ručně.');
  state.angle = { left: 0, middle: 0, right: 0 };
  syncPositionInputs();
  renderWindows(true);
}

function syncPositionInputs() {
  const p = machine.getPositions();
  $('#pos-left').value = p[0];
  $('#pos-middle').value = p[1];
  $('#pos-right').value = p[2];
}

function buildRotorRows() {
  const stack = $('#rotor-stack');
  stack.innerHTML = '';
  for (const slot of DISPLAY_ROWS) {
    const isReflector = slot === 'reflector';
    const row = document.createElement('div');
    row.className = 'rotor-row' + (isReflector ? ' reflector-row' : '');
    row.dataset.slot = slot;

    const head = document.createElement('div');
    head.className = 'rotor-head';
    // pořadí průchodu signálem — pravé kolo je vždy první, i když je na něm rotor III
    const orderNo = DISPLAY_ROWS.indexOf(slot) + 1;
    const badge = `<span class="step-badge" title="Pořadí, ve kterém tudy signál prochází (dolů k reflektoru a zpět)">`
      + `${isReflector ? '&#8597;' : orderNo}</span>`;
    if (isReflector) {
      head.innerHTML = `${badge}<div class="rotor-name"><b>UKW&nbsp;B</b>reflektor</div>`;
    } else {
      head.innerHTML = `
        ${badge}
        <div class="drum"><div class="drum-inner"></div></div>
        <div class="window">A</div>
        <div class="rotor-name"><b></b>${SLOT_CZ[slot]}</div>`;
    }
    row.appendChild(head);

    // Každé kolo má DVĚ sady kontaktů A–Z (strana P = vstup, strana L = výstup)
    // a mezi nimi svazek 26 drátků. Reflektor má propojky pevné (neotáčí se).
    const titles = {
      p: isReflector
        ? 'Strana P reflektoru — sem signál přichází od kol. Písmena jsou v abecedním pořadí.'
        : 'Pravá strana kola — sem signál vstupuje (cesta dolů k reflektoru). Písmena jsou tu v abecedním pořadí, aby se hledalo jako na klávesnici.',
      w: isReflector
        ? 'Propojky reflektoru: 26 pevných drátků, které signál vracejí zpátky. Reflektor se neotáčí, takže drátky stojí.'
        : 'Drátky uvnitř kola: každý vede ze zdířky na straně P na zdířku na straně L. Při kroku se celý svazek otočí o jednu buňku — písmena obou pásů přitom zůstávají na místě, takže se nikdy nic nepřemístí.',
      l: isReflector
        ? 'Strana L reflektoru — odtud se signál vrací zpátky nahoru. Sloupec ukazuje, kam ho propojka pustí.'
        : 'Levá strana kola — odtud signál vystupuje (cesta dolů k reflektoru). Kam přesně, to ukazuje drátek z pásu P.',
    };

    const faces = document.createElement('div');
    faces.className = 'faces';

    const addFace = (side) => {
      const face = document.createElement('div');
      face.className = `face face-${side}`;
      face.title = titles[side];

      const lab = document.createElement('span');
      lab.className = 'face-label';
      lab.innerHTML = side === 'p' ? '<b>P</b> vstup'
        : isReflector ? '<b>L</b> zpět' : '<b>L</b> výstup';
      face.appendChild(lab);

      const cells = document.createElement('div');
      cells.className = 'cells';
      faceCols[slot][side] = [];
      ALPHABET.split('').forEach((ch, col) => {
        const c = document.createElement('span');
        c.className = 'cell';
        c.dataset.letter = ch;
        c.dataset.col = String(col);
        c.textContent = ch;
        cells.appendChild(c);
        faceEls[slot][side][ch] = c;
        faceCols[slot][side][col] = c;
      });
      face.appendChild(cells);
      faces.appendChild(face);
    };

    const addWireFace = () => {
      const face = document.createElement('div');
      face.className = 'face face-w';
      face.title = titles.w;

      const lab = document.createElement('span');
      lab.className = 'face-label';
      lab.innerHTML = isReflector ? 'propojky' : 'drátky';
      face.appendChild(lab);

      const host = document.createElement('div');
      host.className = 'wires';
      host.style.height = WIRE_H + 'px';
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', String(WIRE_H));
      svg.style.display = 'block';
      host.appendChild(svg);
      face.appendChild(host);
      faces.appendChild(face);
      wireEls[slot] = { svg, paths: [], pos: 0, token: 0, sliding: false };
    };

    addFace('p');
    addWireFace();
    addFace('l');

    row.appendChild(faces);
    stack.appendChild(row);
    rowEls[slot] = row;
  }
}

function renderRotorRows() {
  const order = machine.getRotorOrder(); // [levý, střední, pravý]
  for (const slot of ['left', 'middle', 'right']) {
    const name = slot === 'left' ? order[0] : slot === 'middle' ? order[1] : order[2];
    rowEls[slot].querySelector('.rotor-name b').textContent = name;
  }
}

// ── drátky: geometrie, kreslení, otáčení ──────────────────────────────────

/** Rozteč buněk pásu v px — drátky musí sedět přesně na sloupcích písmen. */
function bandMetrics(slot) {
  const cellsEl = faceCols[slot].p[0].parentElement;
  const width = cellsEl.clientWidth;
  const gap = parseFloat(getComputedStyle(cellsEl).columnGap) || 0;
  const cw = (width - 25 * gap) / 26;
  return { width, cw, pitch: cw + gap };
}

/**
 * Drátky jednoho kola: drátek k sedí vpředu na zdířce (k − pozice) a vzadu na
 * zdířce (wiring[k] − pozice) — oba konce se otáčejí s válcem, proto se svazek
 * při kroku posune jako celek. Reflektor se neotáčí: drátek i spojuje sloupec i
 * se sloupcem REFLECTOR_B[i].
 */
function wirePairs(slot, pos = null) {
  if (slot === 'reflector') {
    return ALPHABET.split('').map((_, i) => ({ top: i, bottom: ALPHABET.indexOf(REFLECTOR_B[i]) }));
  }
  const i = SLOT_IDX[slot];
  const p = pos == null ? ALPHABET.indexOf(machine.getPositions()[i]) : pos;
  const wiring = ROTORS[machine.getRotorOrder()[i]].wiring;
  return wiring.split('').map((ch, k) => ({
    top: wrap26(k - p),
    bottom: wrap26(ALPHABET.indexOf(ch) - p),
  }));
}

/**
 * Drátek jde od zdířky nahoře ke zdířce dole. Skutečný rotor má dráty vedené
 * rovně (šikmo válcem), proto je drátek přímka — je hned vidět, která zdířka
 * je s kterou spojená, a svazek se při otáčení posouvá jako skutečný.
 */
function wirePathD(x0, x1) {
  return `M ${x0.toFixed(1)} 0 L ${x1.toFixed(1)} ${WIRE_H}`;
}

/**
 * Vzhled drátku zapsaný přímo na prvku — drátek je zlatý, i kdyby CSS chybělo.
 * `faded` = v kole právě svítí cesta, takže ostatní drátky se ztlumí.
 */
function wireBaseStyle(path, faded = false) {
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', WIRE_DIM);
  path.setAttribute('stroke-width', String(WIRE_DIM_W));
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-opacity', String(faded ? WIRE_FADE : WIRE_ALPHA));
  path.classList.remove('lit');
  path.style.removeProperty('--step');
  path.style.removeProperty('filter');
}

/** Nakreslí svazek drátků podle aktuální pozice kola (bez animace). */
function drawWireField(slot) {
  const w = wireEls[slot];
  if (!w) return;
  const { width, cw, pitch } = bandMetrics(slot);
  w.svg.setAttribute('viewBox', `0 0 ${width} ${WIRE_H}`);
  w.svg.textContent = '';
  w.paths = wirePairs(slot).map(({ top, bottom }) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'wire');
    path.setAttribute('d', wirePathD(top * pitch + cw / 2, bottom * pitch + cw / 2));
    wireBaseStyle(path);
    w.svg.appendChild(path);
    return path;
  });
  w.pos = slot === 'reflector' ? 0 : ALPHABET.indexOf(machine.getPositions()[SLOT_IDX[slot]]);
  w.sliding = false;
  paintWireLights(slot);
}

function drawAllWireFields() {
  for (const slot of DISPLAY_ROWS) drawWireField(slot);
}

/** Otočení svazku o jeden zub: drátky ujedou o buňku doleva, krajní přejede naproti. */
function slideWireField(slot) {
  const w = wireEls[slot];
  if (!w || !w.paths.length) { drawWireField(slot); return; }
  const i = SLOT_IDX[slot];
  const nextP = ALPHABET.indexOf(machine.getPositions()[i]);
  const prevP = w.pos;
  if (prevP === nextP) { drawWireField(slot); return; }
  const { cw, pitch, width } = bandMetrics(slot);
  const prev = wirePairs(slot, prevP);
  const next = wirePairs(slot, nextP);
  const token = (w.token += 1);
  w.sliding = true;
  w.pos = nextP;
  w.svg.setAttribute('viewBox', `0 0 ${width} ${WIRE_H}`);
  w.paths.forEach((path, k) => {
    const overEdge = prev[k].top === 0 || prev[k].bottom === 0;
    if (!overEdge) {
      path.classList.add('v-slide');
      path.style.transform = `translateX(${-pitch}px)`;
      return;
    }
    // drátek přejíždí přes okraj válce: vlevo zhasne a objeví se vpravo
    path.classList.add('v-fade');
    path.style.opacity = '0';
    const twin = path.cloneNode();
    twin.setAttribute('class', 'wire v-fade');
    twin.setAttribute('d', wirePathD(next[k].top * pitch + cw / 2, next[k].bottom * pitch + cw / 2));
    twin.style.opacity = '0';
    w.svg.appendChild(twin);
    requestAnimationFrame(() => { twin.style.opacity = '1'; });
  });
  setTimeout(() => {
    if (token !== w.token) return; // mezitím přišel další krok — ten si to dokreslí sám
    drawWireField(slot);
  }, WIRE_SLIDE_MS + 20);
}

/**
 * Index drátku, kterým signál prošel. Drátek je jeden fyzický spoj — záleží
 * jen na obou koncích, ne na směru cesty (reflektor kreslí oba směry zrcadlově).
 */
function wireIndexOf(slot, from, to) {
  const geo = wirePairs(slot);
  const a = ALPHABET.indexOf(from);
  const b = ALPHABET.indexOf(to);
  let k = geo.findIndex(({ top, bottom }) => top === a && bottom === b);
  if (k < 0) k = geo.findIndex(({ top, bottom }) => top === b && bottom === a);
  return k;
}

/**
 * Rozsvítí drátky, kterými signál prošel — barvou příslušného kroku cesty.
 * Drátek se pozná podle pořadí ve válci, takže svítí i během otáčení svazku
 * a po překreslení na novou pozici zůstane svítit stejný drátek.
 */
function paintWireLights(slot) {
  const w = wireEls[slot];
  if (!w || !w.paths.length) return;
  const litHere = state.wireLit.filter((lit) => lit.slot === slot);
  w.paths.forEach((path) => wireBaseStyle(path, litHere.length > 0));
  for (const lit of litHere) {
    const path = w.paths[lit.k];
    if (!path) continue;
    path.classList.add('lit');
    path.style.setProperty('--step', lit.color);
    path.setAttribute('stroke', lit.color);
    path.setAttribute('stroke-width', String(WIRE_LIT_W));
    path.setAttribute('stroke-opacity', '1');
    path.style.filter = `drop-shadow(0 0 4px ${lit.color})`;
  }
}

function renderWindows(instant = false, anim = null) {
  const pos = machine.getPositions();
  for (const slot of ['left', 'middle', 'right']) {
    const row = rowEls[slot];
    const win = row.querySelector('.window');
    win.textContent = pos[SLOT_IDX[slot]];
    const drum = row.querySelector('.drum-inner');
    if (instant) drum.style.transition = 'none';
    drum.style.transform = `rotate(${state.angle[slot]}deg)`;
    if (instant) {
      void drum.offsetWidth; // reflow
      drum.style.transition = '';
    }
  }
  if (anim) {
    // pásy drátků se u kol, která se pohnula, otočí o zub
    for (const slot of ['left', 'middle', 'right']) {
      const i = SLOT_IDX[slot];
      if (anim.positionsBefore[i] !== anim.positionsAfter[i]) slideWireField(slot);
    }
  } else {
    drawAllWireFields();
  }
}

function animateRotorStep(res) {
  // posun kotoučů a okének podle rozdílu pozic před/po; pásy drátků se otočí
  const before = res.positionsBefore, after = res.positionsAfter;
  for (const slot of ['left', 'middle', 'right']) {
    const i = SLOT_IDX[slot];
    if (before[i] !== after[i]) {
      state.angle[slot] += STEP_DEG;
      const win = rowEls[slot].querySelector('.window');
      win.classList.remove('bump');
      void win.offsetWidth;
      win.classList.add('bump');
    }
  }
  renderWindows(false, res);
}

// ── plugboard ──────────────────────────────────────────────────────────────
// Pravidla, která drží plugboard přehledný:
//   • čárkovaně = rozpracovaný kabel (vybraná zdířka + náhled k druhému písmenu),
//   • plně a se září = hotový kabel,
//   • každé písmeno má jen JEDEN kabel → mezi stejnými písmenky nikdy nevznikne
//     druhé spojení a cesta signálu kabel jen rozsvítí (nekreslí druhou linku).

function buildPlugboard() {
  const board = $('#plugboard');
  for (const ch of ALPHABET) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'socket';
    s.dataset.letter = ch;
    s.textContent = ch;
    s.setAttribute('aria-label', `Zdířka ${ch}`);
    s.addEventListener('click', () => onSocketClick(ch));
    s.addEventListener('pointerenter', () => setHoverPlug(ch)); // náhled kabelu
    board.appendChild(s);
    socketEls[ch] = s;
  }
  board.addEventListener('pointerleave', () => setHoverPlug(null));
  renderPlugboard();
  // po změně velikosti okna je potřeba překreslit kabely i spojnice cesty
  window.addEventListener('resize', () => { drawAllWireFields(); drawCables(); drawWires(); });
  // Esc zruší rozpracovaný kabel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedPlug) {
      state.selectedPlug = null;
      setCaption('Výběr zrušen.');
      renderPlugboard();
    }
  });
}

function setHoverPlug(ch) {
  if (state.hoverPlug === ch) return;
  state.hoverPlug = ch;
  updateSocketClasses();
  drawCables();
}

/** Vzhled zdířek: propojená písmena, vybraná zdířka a náhled cíle. */
function updateSocketClasses() {
  const pairs = machine.getPlugboard();
  const sel = state.selectedPlug;
  const hov = state.hoverPlug;
  // co by klik na zdířku pod kurzorem udělal — jen kvůli barvě náhledu
  const preview = sel && hov && hov !== sel ? resolvePlugClick(pairs, sel, hov).action : null;
  for (const ch of ALPHABET) {
    const s = socketEls[ch];
    s.classList.toggle('plugged', plugMate(pairs, ch) !== undefined);
    s.classList.toggle('selected', sel === ch);
    s.classList.toggle('preview-ok', preview === 'connect' && hov === ch);
    s.classList.toggle('preview-bad', (preview === 'conflict' || preview === 'plugged') && hov === ch);
    s.classList.toggle('pairmate', !!hov && hov !== ch && plugMate(pairs, hov) === ch);
  }
}

function onSocketClick(ch) {
  if (state.obs) { setCaption('Nejprve projdi aktuální cestu (nebo Reset cesty).'); return; }
  state.hoverPair = null;
  const r = resolvePlugClick(machine.getPlugboard(), state.selectedPlug, ch);
  switch (r.action) {
    case 'connect': {
      const a = state.selectedPlug;
      machine.setPlugboard(r.pairs);
      flashFreshPair(pairKey(a, ch));
      setCaption(`Kabel <b class="mono">${a}&ndash;${ch}</b> přidán — hotové spojení je plné, čárkovaný je jen kabel, který teprve vyrábíš.`);
      break;
    }
    case 'plugged':
      state.hoverPair = pairKey(ch, r.mate);
      setCaption(`Písmeno <b>${ch}</b> už má kabel <b class="mono">${ch}&ndash;${r.mate}</b> — každé písmeno smí mít jen jeden. Odebrat ho můžeš kliknutím na kabel v seznamu.`);
      break;
    case 'conflict':
      state.hoverPair = pairKey(r.conflict, r.mate);
      setCaption(`<span class="warn">Nelze:</span> písmeno <b>${r.conflict}</b> už má kabel <b class="mono">${r.conflict}&ndash;${r.mate}</b>. Vyber jiné písmeno, nebo kabel nejdřív odeber.`);
      break;
    case 'deselect':
      setCaption('Výběr zrušen.');
      break;
    default:
      setCaption(`Vybraná zdířka <b>${ch}</b> — klikni na druhé písmeno, kabel se rozsvítí. <span class="hintInline">Esc ruší výběr</span>`);
  }
  state.selectedPlug = r.selected;
  renderPlugboard();
}

/** Krátce poblikne nově vytvořený kabel, aby bylo vidět, co se stalo. */
function flashFreshPair(key) {
  state.freshPair = key;
  drawCables();
  setTimeout(() => {
    if (state.freshPair === key) { state.freshPair = null; drawCables(); }
  }, 700);
}

function removeCable(a, b) {
  machine.setPlugboard(machine.getPlugboard().filter(([x, y]) => !(x === a && y === b)));
  state.hoverPair = null;
  cancelObserve();
  setCaption(`Kabel <b class="mono">${a}&ndash;${b}</b> odebrán.`);
  renderPlugboard();
}

function renderPlugboard() {
  updateSocketClasses();
  const list = $('#plug-list');
  list.innerHTML = '';
  for (const [a, b] of machine.getPlugboard()) {
    const key = pairKey(a, b);
    const li = document.createElement('li');
    li.textContent = `${a}–${b}`;
    li.title = 'Klikni pro odebrání kabelu';
    // najetí na kabel v seznamu zvýrazní právě ten kabel na desce
    li.addEventListener('pointerenter', () => { state.hoverPair = key; drawCables(); });
    li.addEventListener('pointerleave', () => {
      if (state.hoverPair === key) { state.hoverPair = null; drawCables(); }
    });
    li.addEventListener('click', () => removeCable(a, b));
    list.appendChild(li);
  }
  drawCables();
}

/** Rozvěšený kabel mezi dvěma středy zdířek (souřadnice desky). */
function cablePath(a, b) {
  const sag = 26 + Math.abs(b.x - a.x) * 0.12;
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`;
}

function drawCables() {
  const svg = $('#cables');
  const board = $('#plugboard');
  const bb = board.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${bb.width} ${bb.height}`);
  svg.innerHTML = '';

  const centerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - bb.left + r.width / 2, y: r.top - bb.top + r.height / 2 };
  };
  const add = (d, stroke, cls) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', stroke);
    p.setAttribute('class', cls);
    svg.appendChild(p);
    return p;
  };

  const pairs = machine.getPlugboard();
  pairs.forEach(([a, b], i) => {
    const key = pairKey(a, b);
    const d = cablePath(centerOf(socketEls[a]), centerOf(socketEls[b]));
    const glow = state.cableGlow.get(key);   // kabelem právě prochází signál
    if (glow) add(d, glow, 'cable-halo');
    const p = add(d, glow || CABLE_COLORS[i % CABLE_COLORS.length], 'cable');
    if (glow) p.classList.add('is-lit');
    if (state.hoverPair === key) p.classList.add('is-hover');
    if (state.freshPair === key) p.classList.add('is-fresh');
  });

  // čárkovaný náhled: vybraná zdířka → zdířka pod kurzorem
  const sel = state.selectedPlug;
  const hov = state.hoverPlug;
  if (sel && hov && hov !== sel) {
    const ok = resolvePlugClick(pairs, sel, hov).action === 'connect';
    add(
      cablePath(centerOf(socketEls[sel]), centerOf(socketEls[hov])),
      ok ? '#ffd166' : '#ff8a72',
      ok ? 'cable-preview' : 'cable-preview is-bad',
    );
  }
}

// ── klávesnice a lampovník ─────────────────────────────────────────────────

function buildKeyboardAndLamps() {
  const kb = $('#keyboard'), lb = $('#lampboard');
  for (const rowStr of QWERTZ_ROWS) {
    const kr = document.createElement('div'); kr.className = 'kb-row';
    const lr = document.createElement('div'); lr.className = 'kb-row';
    for (const ch of rowStr) {
      const k = document.createElement('button');
      k.type = 'button';
      k.className = 'key';
      k.dataset.letter = ch;
      k.textContent = ch;
      k.setAttribute('aria-label', `Klávesa ${ch}`);
      k.addEventListener('click', () => onKey(ch));
      kr.appendChild(k);
      keyEls[ch] = k;

      const l = document.createElement('div');
      l.className = 'lamp';
      l.dataset.letter = ch;
      l.textContent = ch;
      lr.appendChild(l);
      lampEls[ch] = l;
    }
    kb.appendChild(kr);
    lb.appendChild(lr);
  }
}

function flashKey(ch) {
  const k = keyEls[ch];
  if (!k) return;
  k.classList.add('pressed');
  setTimeout(() => k.classList.remove('pressed'), 140);
}

function lightLamp(ch, holdMs = 600) {
  const l = lampEls[ch];
  if (!l) return;
  l.classList.add('lit');
  clearTimeout(l._t);
  l._t = setTimeout(() => l.classList.remove('lit'), holdMs);
}

// ── výstup, historie, popisky ──────────────────────────────────────────────

function appendOutput(ch) {
  const out = $('#text-output');
  out.value += ch;
  out.scrollTop = out.scrollHeight;
}

function addHistory(res) {
  state.history.unshift(res);
  if (state.history.length > 40) state.history.pop();
  const ul = $('#history');
  ul.innerHTML = '';
  for (const h of state.history) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${h.input}</b> &rarr; <b>${h.output}</b> <span class="pos">[${h.positionsBefore}&rarr;${h.positionsAfter}]</span>`;
    ul.appendChild(li);
  }
}

function setCaption(html) {
  $('#step-caption').innerHTML = html;
}

/** Barevný vzorek kroku do popisku — stejná barva jako obě písmenka a spojnice. */
function swatchFor(i) {
  return `<span class="swatch" style="--step:${PATH_COLORS[i % PATH_COLORS.length]}"></span>`;
}

// ── zvýraznění cesty + zářivé spojnice ────────────────────────────────────

/**
 * Které dva DOM prvky (písmenka) jeden uzel cesty spojuje?
 * U rotoru záleží na směru: cesta dolů jde ze strany P na L, zpátky z L na P.
 */
function nodeElements(node) {
  if (node.stage === 'plugboard-in' || node.stage === 'plugboard-out') {
    return { fromEl: socketEls[node.from], toEl: socketEls[node.to] };
  }
  // reflektor i kolo: písmeno na pásu P a písmeno na pásu L ve svém vlastním
  // sloupci — spojení mezi nimi kreslí drátek uvnitř kola
  const slot = node.stage === 'reflector' ? 'reflector' : node.slot;
  const sides = node.direction === 'backward' ? ['l', 'p'] : ['p', 'l'];
  return {
    fromEl: faceEls[slot][sides[0]][node.from],
    toEl: faceEls[slot][sides[1]][node.to],
  };
}

function markHit(el, color) {
  if (!el) return;
  el.classList.add('hit');
  el.style.setProperty('--step', color);
  if (!state.trail.includes(el)) state.trail.push(el);
}

function clearPathHighlights() {
  for (const el of state.trail) {
    el.classList.remove('hit');
    el.style.removeProperty('--step');
  }
  state.trail = [];
  state.wires = [];
  if (state.wireLit.length) {
    state.wireLit = [];
    for (const slot of DISPLAY_ROWS) paintWireLights(slot); // drátky v kolech zhasnou
  }
  if (state.cableGlow.size) {
    state.cableGlow.clear();
    drawCables(); // kabely na plugboardu zase zhasnou
  }
  drawWires();
}

/** Po chvíli cestu zhasne — nový stisk předchozí časovač zruší. */
function schedulePathClear(ms = 900) {
  clearTimeout(state.clearTimer);
  state.clearTimer = setTimeout(clearPathHighlights, ms);
}

/**
 * Rozsvítí obě písmenka jednoho kroku cesty stejnou barvou a spojí je
 * zářivou linkou téže barvy. Volá se postupně pro kroky 1–9.
 *
 * Když krok vede přes hotový kabel plugboardu, další linka se NEkreslí —
 * kabel mezi stejnými písmenky už na desce visí, takže se jen rozsvítí.
 * Dvě spojnice mezi stejnými písmenky působily jako zmatek.
 */
function showPathStep(node, i) {
  const color = PATH_COLORS[i % PATH_COLORS.length];
  const { fromEl, toEl } = nodeElements(node);
  markHit(fromEl, color);
  markHit(toEl, color);
  const linkFrom = state.wires.length ? state.wires[state.wires.length - 1].toEl : null;
  const isPlug = node.stage === 'plugboard-in' || node.stage === 'plugboard-out';
  const overCable = isPlug && node.from !== node.to;
  if (overCable) {
    state.cableGlow.set(pairKey(node.from, node.to), color);
    drawCables();
  }
  // přes kolo (i reflektor) vede signál po drátku: rozsvítí se drátek barvou kroku
  // a spojnice v overlayi se nekreslí — drátek je vidět přímo v pásu kola
  const overWire = !isPlug;
  if (overWire) {
    const slot = node.stage === 'reflector' ? 'reflector' : node.slot;
    const k = wireIndexOf(slot, node.from, node.to);
    if (k >= 0) {
      state.wireLit.push({ slot, k, color });
      paintWireLights(slot);
    }
  }
  state.wires.push({ fromEl, toEl, color, linkFrom, skipArc: overCable || overWire });
  drawWires();
}

/** Překreslí všechny spojnice aktuální cesty (volá se i při změně velikosti okna). */
function drawWires() {
  const svg = $('#path-overlay');
  const group = $('#wires');
  if (!svg || !group) return;
  const host = svg.parentElement; // main.layout
  const hb = host.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${Math.round(hb.width)} ${Math.round(hb.height)}`);
  group.textContent = '';
  if (!state.wires.length) return;

  const center = (el) => {
    const r = el.getBoundingClientRect();
    return {
      cx: r.left - hb.left + r.width / 2,
      cy: r.top - hb.top + r.height / 2,
      w: r.width,
      h: r.height,
    };
  };
  // spojnice vychází z okraje písmenka (nahoru/dolů, případně do stran),
  // aby nevedla přes písmeno
  const exitPoint = (box, other) => {
    const dy = other.cy - box.cy;
    if (Math.abs(dy) >= box.h * 0.7) {
      return { x: box.cx, y: box.cy + Math.sign(dy) * (box.h / 2 + 1) };
    }
    return { x: box.cx + Math.sign(other.cx - box.cx) * (box.w / 2 + 1), y: box.cy };
  };
  const add = (aBox, bBox, color, cls) => {
    const a = exitPoint(aBox, bBox);
    const b = exitPoint(bBox, aBox);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(26, len * 0.14) * (cls.includes('link') ? 1 : 0.5);
    const cx = (a.x + b.x) / 2 - (dy / len) * bow;
    const cy = (a.y + b.y) / 2 + (dx / len) * bow;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    p.setAttribute('stroke', color);
    p.setAttribute('class', cls);
    group.appendChild(p);
  };
  const dot = (pt, color) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', pt.x.toFixed(1));
    c.setAttribute('cy', pt.y.toFixed(1));
    c.setAttribute('r', '2.6');
    c.setAttribute('fill', color);
    c.setAttribute('class', 'wire-dot');
    group.appendChild(c);
  };

  for (const w of state.wires) {
    if (!w.fromEl || !w.toEl) continue;
    const a = center(w.fromEl);
    const b = center(w.toEl);
    const prev = w.linkFrom ? center(w.linkFrom) : null;
    if (prev) add(prev, a, w.color, 'wire-link'); // propojení mezi dvěma součástmi
    if (w.skipArc) continue; // plugboard: kabel na desce už spojení ukazuje
    if (Math.hypot(b.cx - a.cx, b.cy - a.cy) > 3) {
      add(a, b, w.color, 'wire-halo');  // rozostřené světlo
      add(a, b, w.color, 'wire');       // ostrá linka
      dot(exitPoint(a, b), w.color);
      dot(exitPoint(b, a), w.color);
    }
  }
}

/** Popis jednoho kroku cesty; `n` = 1–9 = pořadí uzlu cesty (1 = první písmeno na plugboardu). */
function describeStep(res, n) {
  const node = res.path[n - 1];
  const m = (s) => `<b class="mono">${s}</b>`;
  switch (node.stage) {
    case 'plugboard-in':
      return `Krok ${n} &mdash; plugboard (vstup): ${m(node.from)} &rarr; ${m(node.to)}`
        + `${node.from === node.to ? ' — žádný kabel, jde přímo' : ' — přes kabel'}`;
    case 'rotor': {
      const sides = node.direction === 'forward' ? ['P', 'L'] : ['L', 'P'];
      return `Krok ${n} &mdash; rotor <b>${node.rotor}</b> (${SLOT_CZ[node.slot]}), pozice <b>${ALPHABET[node.position]}</b>: `
        + `strana ${sides[0]} ${m(node.from)} &rarr; strana ${sides[1]} ${m(node.to)} `
        + `(${node.direction === 'forward' ? 'vpřed, dolů' : 'zpět, nahoru'})`;
    }
    case 'reflector':
      return `Krok ${n} &mdash; reflektor <b>UKW&nbsp;B</b>: strana P ${m(node.from)} &rarr; strana L ${m(node.to)}`
        + ' — pár vrací signál zpátky nahoru';
    case 'plugboard-out':
      return `Krok ${n} &mdash; plugboard (výstup): ${m(node.from)} &rarr; ${m(node.to)} &mdash; rozsvítí se lampa <b>${node.to}</b>`;
    default:
      return `Krok ${n}`;
  }
}

/** Posun kol před stiskem — do úvodního popisku pozorovacího módu. */
function describeRotorMove(res) {
  const slots = ['left', 'middle', 'right'];
  const order = machine.getRotorOrder();
  const moved = slots
    .filter((slot) => res.positionsBefore[SLOT_IDX[slot]] !== res.positionsAfter[SLOT_IDX[slot]])
    .map((slot) => `${SLOT_CZ[slot]} <b>${order[SLOT_IDX[slot]]}</b>`);
  return moved.length ? moved.join(', ') : 'žádné kolo se neposunulo';
}

// ── vstup: klávesa ─────────────────────────────────────────────────────────

function onKey(ch) {
  ch = ch.toUpperCase();
  if (!/^[A-Z]$/.test(ch)) return;
  flashKey(ch);
  if (state.obs) {
    setCaption('Nejprve projdi aktuální cestu — <b>Další krok</b> / <b>Přehrát</b> / <b>Reset cesty</b>.');
    return;
  }
  const res = machine.encryptChar(ch);
  addHistory(res);
  if (state.mode === 'fast') {
    // rychlý mód: okamžitý výstup, vizuál jen problikne
    animateRotorStep(res);
    clearPathHighlights();
    res.path.forEach((n, i) => showPathStep(n, i));
    schedulePathClear(900);
    lightLamp(res.output, 550);
    appendOutput(res.output);
    setCaption(`<b>${res.input}</b> &rarr; <b>${res.output}</b> &nbsp; <span class="mono">[${res.positionsBefore}&rarr;${res.positionsAfter}]</span>`);
  } else {
    startObserve(res);
  }
}

// ── pozorovací mód ─────────────────────────────────────────────────────────

function startObserve(res) {
  animateRotorStep(res);
  clearPathHighlights();
  // idx = kolik uzlů cesty už je rozsvícených; žádný „krok 0“ — prvním
  // kliknutím se hned rozsvítí první písmeno na plugboardu.
  state.obs = { res, idx: 0, timer: null, done: false };
  setObserveButtons(true);
  setCaption(
    `Stisknuto <b>${res.input}</b> — kola se posunula <b class="mono">${res.positionsBefore} &rarr; ${res.positionsAfter}</b> `
    + `(${describeRotorMove(res)}). Krok 1 rozsvítí <b>${res.path[0].from}</b> na plugboardu. `
    + 'Klikni <b>Další krok</b> nebo <b>Přehrát</b>.',
  );
}

function setObserveButtons(on) {
  $('#btn-step').disabled = !on;
  $('#btn-play').disabled = !on;
  $('#btn-reset-path').disabled = !on;
}

function stepOnce() {
  const obs = state.obs;
  if (!obs) return;
  const total = obs.res.path.length;
  if (obs.idx >= total) { finishObserve(); return; }
  const i = obs.idx; // index uzlu cesty = 0–8
  obs.idx++;
  showPathStep(obs.res.path[i], i);
  setCaption(swatchFor(i) + describeStep(obs.res, i + 1));
  if (obs.idx >= total) finishObserve(true);
}

/**
 * Konec cesty: rozsvítí se lampa a znak se připíše do výstupu.
 * `keepCaption` = nechat popisek posledního kroku (jinak shrnutí).
 */
function finishObserve(keepCaption = false) {
  const obs = state.obs;
  if (!obs || obs.done) return;
  obs.done = true;
  stopPlayTimer();
  lightLamp(obs.res.output, 1500);
  appendOutput(obs.res.output);
  const result = `Hotovo: <b>${obs.res.input}</b> &rarr; <b>${obs.res.output}</b> `
    + `&nbsp;<span class="mono">[${obs.res.positionsBefore}&rarr;${obs.res.positionsAfter}]</span> — lampa svítí.`;
  setCaption(keepCaption ? `${$('#step-caption').innerHTML}<br>${result}` : result);
  state.obs = null;
  setObserveButtons(false);
}

function stopPlayTimer() {
  if (state.obs?.timer) { clearInterval(state.obs.timer); state.obs.timer = null; }
}

function cancelObserve(note) {
  if (state.obs) {
    stopPlayTimer();
    state.obs = null;
    setObserveButtons(false);
  }
  clearPathHighlights();
  if (note) setCaption(note);
}

function resetPath() {
  const obs = state.obs;
  if (!obs) return;
  stopPlayTimer();
  obs.idx = 0;
  clearPathHighlights();
  setCaption(`Cesta smazána. Pozice kol zůstávají <b class="mono">${obs.res.positionsAfter}</b>. Klikni <b>Další krok</b>.`);
}

// ── módy a ostatní tlačítka ────────────────────────────────────────────────

function setMode(mode) {
  state.mode = mode;
  $('#mode-fast').classList.toggle('active', mode === 'fast');
  $('#mode-observe').classList.toggle('active', mode === 'observe');
  $('#mode-fast').setAttribute('aria-selected', String(mode === 'fast'));
  $('#mode-observe').setAttribute('aria-selected', String(mode === 'observe'));
  cancelObserve();
  setCaption(mode === 'fast'
    ? 'Stiskni písmeno…'
    : 'Stiskni písmeno a projdi cestu <b>Další krok</b>.');
}

function onEncryptText() {
  if (state.obs) { setCaption('Nejprve projdi aktuální cestu (nebo Reset cesty).'); return; }
  const text = $('#text-input').value;
  if (!text) return;
  let last = null;
  let out = '';
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) {
      last = machine.encryptChar(ch);
      out += last.output;
      addHistory(last);
    }
  }
  if (!last) return;
  animateRotorStep(last);
  if (state.mode === 'fast') {
    clearPathHighlights();
    last.path.forEach((n, i) => showPathStep(n, i));
    schedulePathClear(900);
  }
  lightLamp(last.output, 800);
  appendOutput(out);
  $('#text-input').value = '';
  setCaption(`Text zpracován: <b class="mono">${out.length}</b> písmen, koncová pozice <b class="mono">${machine.getPositions()}</b>.`);
}

// ── init ───────────────────────────────────────────────────────────────────

function init() {
  buildRotorOrderSelects();
  buildPositions();
  buildRotorRows();
  renderRotorRows();
  renderWindows(true);
  buildPlugboard();
  buildKeyboardAndLamps();

  $('#mode-fast').addEventListener('click', () => setMode('fast'));
  $('#mode-observe').addEventListener('click', () => setMode('observe'));
  $('#btn-step').addEventListener('click', stepOnce);
  $('#btn-play').addEventListener('click', () => {
    const obs = state.obs;
    if (!obs || obs.timer) return;
    obs.timer = setInterval(stepOnce, 750);
  });
  $('#btn-reset-path').addEventListener('click', resetPath);
  $('#btn-encrypt-text').addEventListener('click', onEncryptText);
  $('#btn-clear').addEventListener('click', () => { $('#text-output').value = ''; });

  // fyzická klávesnice (QWERTZ — české rozložení pasuje přímo)
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      onKey(e.key);
    }
  });

  setMode('fast');

  // pomocné pro ladění / automatické testy
  window.__enigma = { machine, state, onKey };
}

init();
