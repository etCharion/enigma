/**
 * Testy čistého jádra Enigmy (node --test). Viz PLAN.md, kapitola "Testovací strategie".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EnigmaMachine,
  ROTORS,
  REFLECTOR_B,
  ALPHABET,
  EnigmaError,
} from '../js/enigma-core.js';

/** Deterministický PRNG (LCG), aby testy byly reprodukovatelné. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32);
}

function randomConfig(rand) {
  const order = ['I', 'II', 'III'];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const positions = Array.from({ length: 3 }, () => ALPHABET[Math.floor(rand() * 26)]).join('');
  const letters = [...ALPHABET];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const nPairs = Math.floor(rand() * 11); // 0..10 kabelů
  const plugboard = [];
  for (let i = 0; i < nPairs; i++) plugboard.push([letters[2 * i], letters[2 * i + 1]]);
  return { rotorOrder: order, positions, plugboard };
}

function randomText(rand, len) {
  return Array.from({ length: len }, () => ALPHABET[Math.floor(rand() * 26)]).join('');
}

// ---------- 1. Známé vektory ----------

test('známý vektor: I-II-III, UKW-B, pozice AAA, bez plugboardu: AAAAA -> BDZGO', () => {
  const m = new EnigmaMachine();
  assert.equal(m.encryptText('AAAAA'), 'BDZGO');
});

test('první stisk A z AAA dá výstup B a posune rotory na AAB', () => {
  const m = new EnigmaMachine();
  const r = m.encryptChar('A');
  assert.equal(r.output, 'B');
  assert.equal(r.positionsBefore, 'AAA');
  assert.equal(r.positionsAfter, 'AAB');
  assert.equal(m.getPositions(), 'AAB');
});

test('jiné pořadí rotorů dává jiný výstup', () => {
  const m = new EnigmaMachine({ rotorOrder: ['III', 'II', 'I'], positions: 'AAA' });
  assert.notEqual(m.encryptText('AAAAA'), 'BDZGO');
});

// ---------- 2. Vlastnosti šifry ----------

test('reciprocita: zašifrování pak dešifrování = původní text (30 náhodných konfigurací)', () => {
  const rand = lcg(20260101);
  for (let i = 0; i < 30; i++) {
    const cfg = randomConfig(rand);
    const msg = randomText(rand, 60);
    const enc = new EnigmaMachine(cfg).encryptText(msg);
    const dec = new EnigmaMachine(cfg).encryptText(enc);
    assert.equal(dec, msg, `konfigurace ${JSON.stringify(cfg)}`);
  }
});

test('žádné pevné body: výstup nikdy není roven vstupu (ani s plugboardem)', () => {
  const rand = lcg(42);
  for (let i = 0; i < 20; i++) {
    const m = new EnigmaMachine(randomConfig(rand));
    for (const ch of ALPHABET) {
      assert.notEqual(m.encryptChar(ch).output, ch);
    }
  }
});

// ---------- 3. Krokování rotorů (zjednodušené, bez double-stepu) ----------

test('krokování: AAA -> AAB (pravé kolo vždy)', () => {
  const m = new EnigmaMachine({ positions: 'AAA' });
  assert.equal(m.step(), 'AAB');
  assert.equal(m.getPositions(), 'AAB');
});

test('krokování: 26 stisků z AAA -> ABA (přetečení pravého kola přes Z)', () => {
  const m = new EnigmaMachine({ positions: 'AAA' });
  for (let i = 0; i < 26; i++) m.encryptChar('A');
  assert.equal(m.getPositions(), 'ABA');
});

test('krokování: AAZ -> AAA (přetečení přes Z bez notch)', () => {
  const m = new EnigmaMachine({ positions: 'AAZ' });
  const r = m.encryptChar('A');
  assert.equal(r.positionsAfter, 'AAA');
});

test('notch pravého rotoru III (V): AAV -> ABW (posune se i střední)', () => {
  const m = new EnigmaMachine({ positions: 'AAV' });
  const r = m.encryptChar('A');
  assert.equal(r.positionsBefore, 'AAV');
  assert.equal(r.positionsAfter, 'ABW');
});

test('notch středního rotoru II (E) + notch pravého: AEV -> BFW, střední jen JEDNOU (bez double-stepu)', () => {
  const m = new EnigmaMachine({ positions: 'AEV' });
  const r = m.encryptChar('A');
  // kdyby se simuloval double-step, bylo by to AGX/AGW — my očekáváme nejvýše 1 krok na kolo
  assert.equal(r.positionsAfter, 'BFW');
});

test('notch středního rotoru II (E) bez notch pravého: AEZ -> BFA (střední i levé, každé jen jednou)', () => {
  const m = new EnigmaMachine({ positions: 'AEZ' });
  const r = m.encryptChar('A');
  assert.equal(r.positionsAfter, 'BFA');
});

// ---------- 4. Struktura cesty signálu (pro pozorovací mód) ----------

test('struktura cesty: 9 uzlů ve správném pořadí, návaznost, výstup = poslední uzel', () => {
  const m = new EnigmaMachine(); // I-II-III, AAA
  const r = m.encryptChar('A');
  assert.equal(r.input, 'A');
  assert.deepEqual(
    r.path.map((n) => n.stage),
    ['plugboard-in', 'rotor', 'rotor', 'rotor', 'reflector', 'rotor', 'rotor', 'rotor', 'plugboard-out'],
  );
  // vpřed jde signál zprava doleva: III, II, I
  const fwd = r.path.filter((n) => n.stage === 'rotor' && n.direction === 'forward');
  assert.deepEqual(fwd.map((n) => n.rotor), ['III', 'II', 'I']);
  assert.deepEqual(fwd.map((n) => n.slot), ['right', 'middle', 'left']);
  // zpět: I, II, III
  const bwd = r.path.filter((n) => n.stage === 'rotor' && n.direction === 'backward');
  assert.deepEqual(bwd.map((n) => n.rotor), ['I', 'II', 'III']);
  // pozice pravého rotoru v uzlu = pozice po kroku (AAB -> 1)
  assert.equal(fwd.find((n) => n.slot === 'right').position, 1);
  // reflektor odpovídá tabulce UKW-B
  const refl = r.path.find((n) => n.stage === 'reflector');
  assert.equal(refl.to, REFLECTOR_B[refl.from.charCodeAt(0) - 65]);
  // návaznost: výstup každého uzlu je vstupem dalšího
  for (let i = 1; i < r.path.length; i++) {
    assert.equal(r.path[i].from, r.path[i - 1].to, `uzel ${i}`);
  }
  // poslední uzel dává výstupní písmeno
  assert.equal(r.path.at(-1).to, r.output);
  assert.equal(r.output, 'B');
});

// ---------- 5. Plugboard ----------

test('plugboard: řetězec "AB CD EF" se naparsuje a normalizuje', () => {
  const m = new EnigmaMachine({ plugboard: 'AB CD EF' });
  assert.deepEqual(m.getPlugboard(), [['A', 'B'], ['C', 'D'], ['E', 'F']]);
});

test('plugboard: pole párů, prohození a řazení', () => {
  const m = new EnigmaMachine({ plugboard: [['B', 'A'], ['D', 'C']] });
  assert.deepEqual(m.getPlugboard(), [['A', 'B'], ['C', 'D']]);
});

test('plugboard: první uzel cesty vede přes kabel', () => {
  const m = new EnigmaMachine({ plugboard: [['A', 'B']] });
  const r = m.encryptChar('A');
  assert.equal(r.path[0].stage, 'plugboard-in');
  assert.equal(r.path[0].from, 'A');
  assert.equal(r.path[0].to, 'B');
  // a poslední uzel přes plugboard ven
  const last = r.path.at(-1);
  assert.equal(last.stage, 'plugboard-out');
  assert.equal(last.to, r.output);
});

test('plugboard: bez kabelu prochází písmeno přímo (from === to)', () => {
  const m = new EnigmaMachine();
  const r = m.encryptChar('A');
  assert.equal(r.path[0].from, 'A');
  assert.equal(r.path[0].to, 'A');
});

test('plugboard: validace — stejné písmeno, opakované písmeno, neplatné písmeno hází EnigmaError', () => {
  assert.throws(() => new EnigmaMachine({ plugboard: [['A', 'A']] }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ plugboard: [['A', 'B'], ['B', 'C']] }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ plugboard: [['A', '1']] }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ plugboard: 'ABC' }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ plugboard: 42 }), EnigmaError);
});

// ---------- 6. Validace konfigurace ----------

test('validace pořadí rotorů', () => {
  assert.throws(() => new EnigmaMachine({ rotorOrder: ['I', 'I', 'II'] }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ rotorOrder: ['I', 'II', 'IV'] }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ rotorOrder: ['I', 'II'] }), EnigmaError);
  const m = new EnigmaMachine();
  m.setRotorOrder(['III', 'I', 'II']);
  assert.deepEqual(m.getRotorOrder(), ['III', 'I', 'II']);
  assert.throws(() => m.setRotorOrder(['I', 'I', 'II']), EnigmaError);
});

test('validace pozic: 3 písmena, malá písmena OK, jiná délka/znaky ne', () => {
  assert.throws(() => new EnigmaMachine({ positions: 'AB' }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ positions: 'ABCD' }), EnigmaError);
  assert.throws(() => new EnigmaMachine({ positions: 'A1C' }), EnigmaError);
  const m = new EnigmaMachine({ positions: 'abz' });
  assert.equal(m.getPositions(), 'ABZ');
});

test('výchozí konfigurace: I-II-III, AAA, bez plugboardu', () => {
  const m = new EnigmaMachine();
  assert.deepEqual(m.getRotorOrder(), ['I', 'II', 'III']);
  assert.equal(m.getPositions(), 'AAA');
  assert.deepEqual(m.getPlugboard(), []);
});

test('reset a změna nastavení za běhu', () => {
  const m = new EnigmaMachine();
  m.encryptText('AAAAA');
  m.reset('AAA');
  assert.equal(m.encryptText('AAAAA'), 'BDZGO');
  m.setPositions('XYZ');
  assert.equal(m.getPositions(), 'XYZ');
});

test('encryptChar: neplatný vstup hází EnigmaError', () => {
  const m = new EnigmaMachine();
  assert.throws(() => m.encryptChar('1'), EnigmaError);
  assert.throws(() => m.encryptChar('AB'), EnigmaError);
  assert.throws(() => m.encryptChar(''), EnigmaError);
});

// ---------- 7. encryptText ----------

test('encryptText: ignoruje ne-písmena a převádí na velká písmena', () => {
  const a = new EnigmaMachine();
  const b = new EnigmaMachine();
  assert.equal(a.encryptText('Hello, World! 123'), b.encryptText('HELLOWORLD'));
  assert.equal(new EnigmaMachine().encryptText(''), '');
});

// ---------- 8. Integrita dat rotorů a reflektoru ----------

test('všechna rotora jsou permutace abecedy s platným notch; reflektor je involuce bez pevných bodů', () => {
  for (const [name, def] of Object.entries(ROTORS)) {
    assert.equal(def.wiring.length, 26, `rotor ${name}`);
    assert.equal(new Set(def.wiring).size, 26, `rotor ${name} musí být permutace`);
    assert.ok(ALPHABET.includes(def.notch), `rotor ${name} notch`);
  }
  assert.equal(REFLECTOR_B.length, 26);
  assert.equal(new Set(REFLECTOR_B).size, 26);
  for (let i = 0; i < 26; i++) {
    const j = REFLECTOR_B.charCodeAt(i) - 65;
    assert.notEqual(j, i, 'reflektor nesmí mít pevný bod');
    assert.equal(REFLECTOR_B.charCodeAt(j) - 65, i, 'reflektor musí být involuce');
  }
});
