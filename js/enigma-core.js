/**
 * enigma-core.js — čistá logika simulátoru šifrovacího stroje Enigma I.
 * Žádné závislosti, žádný DOM: běží v Node (testy) i v prohlížeči (ES module).
 *
 * Konfigurace: rotory I, II, III (pořadí volitelné), reflektor B (UKW-B), plugboard.
 * Ring setting je fixně A (Grundstellung = počáteční pozice se zadává přímo).
 *
 * ZJEDNODUŠENÉ KROKOVÁNÍ (bez double-stepping anomálie):
 *   - pravé kolo se před každým stiskem posune vždy o 1,
 *   - střední kolo se posune, bylo-li PŘED krokem pravé kolo na notch,
 *   - střední kolo se posune také, je-li samo na svém notch (a tehdy posune i levé),
 *   - levé kolo se posune, bylo-li PŘED krokem střední kolo na notch.
 *   Každé kolo se tedy za jeden stisk posune nejvýše jednou — speciální
 *   "přeskakování" (double-step) středního kola se vědomě nesimuluje.
 *
 * Notch pozice: I = Q, II = E, III = V.
 */

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const ROTORS = {
  I:   { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' },
  II:  { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' },
  III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' },
};

export const REFLECTOR_B = 'YRUHQSLDPXNGOKMIEBFZCWVJAT';

export class EnigmaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnigmaError';
  }
}

const A = 65; // 'A'
const mod26 = (n) => ((n % 26) + 26) % 26;
const letter = (i) => String.fromCharCode(A + mod26(i));
const index = (ch) => ch.charCodeAt(0) - A;

/** Dopředný průchod rotorem: vstup na absolutním kontaktu x (0-25), rotor otočen na pozici pos. */
function rotorForward(wiring, pos, x) {
  return mod26(index(wiring[mod26(x + pos)]) - pos);
}

/** Zpětný průchod rotorem (inverzní křivka). */
function rotorInverse(wiring, pos, x) {
  return mod26(wiring.indexOf(letter(mod26(x + pos))) - pos);
}

function parsePositions(positions) {
  if (typeof positions !== 'string' || !/^[A-Za-z]{3}$/.test(positions)) {
    throw new EnigmaError(`Pozice rotorů musí být 3 písmena A-Z, dostáno: ${JSON.stringify(positions)}`);
  }
  return positions.toUpperCase().split('').map(index); // [levý, střední, pravý]
}

function parseRotorOrder(order) {
  if (!Array.isArray(order) || order.length !== 3) {
    throw new EnigmaError('Pořadí rotorů musí být pole 3 názvů, např. ["I","II","III"]');
  }
  const names = order.map(String);
  for (const n of names) {
    if (!ROTORS[n]) throw new EnigmaError(`Neznámý rotor ${JSON.stringify(n)} — dostupné jsou I, II, III`);
  }
  if (new Set(names).size !== 3) throw new EnigmaError('Každý rotor smí být ve stroji pouze jednou');
  return names; // [levý, střední, pravý]
}

/** Plugboard přijme pole párů [["A","B"],...] nebo řetězec "AB CD EF". Vrací normalizované seřazené páry. */
function parsePlugboard(input) {
  let pairs;
  if (input == null || input === '') {
    pairs = [];
  } else if (typeof input === 'string') {
    pairs = input.trim().split(/[\s,;]+/).filter(Boolean).map((tok) => {
      if (!/^[A-Za-z]{2}$/.test(tok)) {
        throw new EnigmaError(`Neplatný pár plugboardu ${JSON.stringify(tok)} — očekáváno např. "AB"`);
      }
      return [tok[0].toUpperCase(), tok[1].toUpperCase()];
    });
  } else if (Array.isArray(input)) {
    pairs = input.map((p) => {
      if (!Array.isArray(p) || p.length !== 2) {
        throw new EnigmaError('Plugboard musí být pole párů [písmeno, písmeno] nebo řetězec "AB CD"');
      }
      return [String(p[0]).toUpperCase(), String(p[1]).toUpperCase()];
    });
  } else {
    throw new EnigmaError('Plugboard musí být pole párů nebo řetězec "AB CD EF"');
  }

  const used = new Map();
  const norm = [];
  for (const [a, b] of pairs) {
    if (!/^[A-Z]$/.test(a) || !/^[A-Z]$/.test(b)) {
      throw new EnigmaError(`Neplatná písmena v páru plugboardu: ${JSON.stringify([a, b])}`);
    }
    if (a === b) throw new EnigmaError(`Písmeno ${a} nelze propojit samo se sebou`);
    for (const ch of [a, b]) {
      if (used.has(ch)) throw new EnigmaError(`Písmeno ${ch} je už propojeno s ${used.get(ch)}`);
    }
    used.set(a, b);
    used.set(b, a);
    norm.push(a < b ? [a, b] : [b, a]);
  }
  norm.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
  return norm;
}

export class EnigmaMachine {
  /**
   * @param {object} cfg
   * @param {string[]} [cfg.rotorOrder] pořadí [levý, střední, pravý], výchozí ['I','II','III']
   * @param {string}   [cfg.positions]  počáteční pozice 3 písmena, výchozí 'AAA'
   * @param {string|string[][]} [cfg.plugboard] páry, např. 'AB CD EF' nebo [['A','B'],...]
   */
  constructor({ rotorOrder = ['I', 'II', 'III'], positions = 'AAA', plugboard = [] } = {}) {
    this.rotorOrder = parseRotorOrder(rotorOrder);
    this.pos = parsePositions(positions); // [levý, střední, pravý], 0-25
    this.setPlugboard(plugboard);
  }

  getRotorOrder() { return [...this.rotorOrder]; }
  setRotorOrder(order) { this.rotorOrder = parseRotorOrder(order); }

  getPositions() { return this.pos.map(letter).join(''); }
  setPositions(positions) { this.pos = parsePositions(positions); }
  reset(positions = 'AAA') { this.setPositions(positions); }

  getPlugboard() { return this.plugboard.map((p) => [...p]); }
  setPlugboard(input) {
    this.plugboard = parsePlugboard(input);
    this.plug = new Map();
    for (const [a, b] of this.plugboard) {
      this.plug.set(a, b);
      this.plug.set(b, a);
    }
  }

  /**
   * Jeden krok rotorů před stiskem klávesy (zjednodušený, bez double-stepu).
   * Vrací pozice po kroku ve formátu "ABC".
   */
  step() {
    const rightNotch = index(ROTORS[this.rotorOrder[2]].notch);
    const middleNotch = index(ROTORS[this.rotorOrder[1]].notch);
    const wasRightAtNotch = this.pos[2] === rightNotch;
    const wasMiddleAtNotch = this.pos[1] === middleNotch;
    this.pos[2] = mod26(this.pos[2] + 1);
    if (wasRightAtNotch || wasMiddleAtNotch) this.pos[1] = mod26(this.pos[1] + 1);
    if (wasMiddleAtNotch) this.pos[0] = mod26(this.pos[0] + 1);
    return this.getPositions();
  }

  /**
   * Zašifruje jedno písmeno (A-Z, malá se převedou na velká).
   * Nejprve posune rotory, pak vede signál:
   *   plugboard-in → pravý → střední → levý rotor → reflektor → levý → střední → pravý → plugboard-out.
   *
   * @returns {{input: string, output: string, positionsBefore: string, positionsAfter: string,
   *            path: Array<object>}} — path obsahuje po jednom uzlu každý průchod kontaktem.
   */
  encryptChar(ch) {
    if (typeof ch !== 'string' || !/^[A-Za-z]$/.test(ch)) {
      throw new EnigmaError(`encryptChar očekává právě jedno písmeno, dostáno: ${JSON.stringify(ch)}`);
    }
    const input = ch.toUpperCase();
    const positionsBefore = this.getPositions();
    this.step();
    const positionsAfter = this.getPositions();

    const SLOT_IDX = { left: 0, middle: 1, right: 2 };
    const path = [];
    let cur = input;

    let nxt = this.plug.get(cur) ?? cur;
    path.push({ stage: 'plugboard-in', from: cur, to: nxt });
    cur = nxt;

    // vpřed: zprava doleva
    const namesFwd = [this.rotorOrder[2], this.rotorOrder[1], this.rotorOrder[0]];
    const slotsFwd = ['right', 'middle', 'left'];
    for (let i = 0; i < 3; i++) {
      const name = namesFwd[i];
      const slot = slotsFwd[i];
      const p = this.pos[SLOT_IDX[slot]];
      const out = letter(rotorForward(ROTORS[name].wiring, p, index(cur)));
      path.push({ stage: 'rotor', direction: 'forward', rotor: name, slot, position: p, from: cur, to: out });
      cur = out;
    }

    const refOut = REFLECTOR_B[index(cur)];
    path.push({ stage: 'reflector', from: cur, to: refOut });
    cur = refOut;

    // zpět: zleva doprava
    const namesBwd = [this.rotorOrder[0], this.rotorOrder[1], this.rotorOrder[2]];
    const slotsBwd = ['left', 'middle', 'right'];
    for (let i = 0; i < 3; i++) {
      const name = namesBwd[i];
      const slot = slotsBwd[i];
      const p = this.pos[SLOT_IDX[slot]];
      const out = letter(rotorInverse(ROTORS[name].wiring, p, index(cur)));
      path.push({ stage: 'rotor', direction: 'backward', rotor: name, slot, position: p, from: cur, to: out });
      cur = out;
    }

    nxt = this.plug.get(cur) ?? cur;
    path.push({ stage: 'plugboard-out', from: cur, to: nxt });

    return { input, output: nxt, positionsBefore, positionsAfter, path };
  }

  /**
   * Zašifruje/dešifruje text: zpracuje jen písmena A-Z (převede na velká), ostatní znaky přeskočí.
   * Enigma je reciproční — stejná operace šifruje i dešifruje.
   */
  encryptText(text) {
    if (typeof text !== 'string') throw new EnigmaError('encryptText očekává řetězec');
    let out = '';
    for (const ch of text) {
      if (/[A-Za-z]/.test(ch)) out += this.encryptChar(ch).output;
    }
    return out;
  }
}
