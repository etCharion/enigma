/**
 * Testy čisté logiky UI (node --test).
 * Pokrývají dvě místa, která se v ovládání snadno rozbijí:
 *   1) volba rotoru v selectu pořadí kol (dřív se někdy „nezaklaplo“),
 *   2) klikání na zdířky plugboardu (jeden kabel na písmeno, žádné duplicity).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  swapRotorOrder,
  pairKey,
  plugMate,
  resolvePlugClick,
} from '../js/ui-logic.js';
import { ALPHABET } from '../js/enigma-core.js';

const PERMUTATIONS = [
  ['I', 'II', 'III'], ['I', 'III', 'II'],
  ['II', 'I', 'III'], ['II', 'III', 'I'],
  ['III', 'I', 'II'], ['III', 'II', 'I'],
];

test('volba rotoru vždy zabere: zvolený rotor skončí v cílové pozici', () => {
  for (const order of PERMUTATIONS) {
    for (let slot = 0; slot < 3; slot++) {
      for (const name of ['I', 'II', 'III']) {
        const next = swapRotorOrder(order, slot, name);
        assert.equal(next[slot], name, `pořadí ${order} + ${name} do slotu ${slot}`);
      }
    }
  }
});

test('pořadí rotorů zůstane permutací (žádný rotor nezmizí ani se nezdvojí)', () => {
  for (const order of PERMUTATIONS) {
    for (let slot = 0; slot < 3; slot++) {
      for (const name of ['I', 'II', 'III']) {
        const next = swapRotorOrder(order, slot, name);
        assert.deepEqual([...next].sort(), ['I', 'II', 'III']);
      }
    }
  }
});

test('volba rotoru prohodí dvě pozice — nic jiného se nemění', () => {
  // konkrétní případ z hlášení: prostřední pozice = III, když je III vlevo
  assert.deepEqual(swapRotorOrder(['III', 'II', 'I'], 1, 'III'), ['II', 'III', 'I']);
  assert.deepEqual(swapRotorOrder(['III', 'I', 'II'], 1, 'III'), ['I', 'III', 'II']);
  // a tentýž krok zpátky
  assert.deepEqual(swapRotorOrder(['II', 'III', 'I'], 0, 'III'), ['III', 'II', 'I']);
});

test('volba stejného rotoru nic nemění a vstup se neupravuje', () => {
  const order = ['II', 'III', 'I'];
  const copy = [...order];
  assert.deepEqual(swapRotorOrder(order, 1, 'III'), order);
  assert.deepEqual(order, copy);
  // i po dvojím prohození se vracíme tam, kde jsme byli
  const there = swapRotorOrder(order, 1, 'I');
  assert.deepEqual(swapRotorOrder(there, 1, 'III'), order);
});

test('pairKey je nezávislý na pořadí písmen', () => {
  assert.equal(pairKey('S', 'A'), pairKey('A', 'S'));
  assert.equal(pairKey('A', 'S'), 'A-S');
});

test('plugMate najde druhý konec kabelu', () => {
  const pairs = [['A', 'S'], ['C', 'D']];
  assert.equal(plugMate(pairs, 'A'), 'S');
  assert.equal(plugMate(pairs, 'S'), 'A');
  assert.equal(plugMate(pairs, 'D'), 'C');
  assert.equal(plugMate(pairs, 'Q'), undefined);
});

test('plugboard: výběr, zrušení a vznik kabelu', () => {
  const start = resolvePlugClick([], null, 'A');
  assert.equal(start.action, 'select');
  assert.equal(start.selected, 'A');

  const cancel = resolvePlugClick([], 'A', 'A');
  assert.equal(cancel.action, 'deselect');
  assert.equal(cancel.selected, null);

  const made = resolvePlugClick([], 'A', 'S');
  assert.equal(made.action, 'connect');
  assert.deepEqual(made.pairs, [['A', 'S']]);
  assert.equal(made.selected, null);
});

test('plugboard: mezi stejnými písmenky nevznikne druhé spojení', () => {
  const pairs = [['A', 'S']];
  // klik na už propojené písmeno nic nevybírá, jen poradí, kde kabel je
  const plugged = resolvePlugClick(pairs, null, 'S');
  assert.equal(plugged.action, 'plugged');
  assert.equal(plugged.mate, 'A');
  assert.equal(plugged.selected, null);

  // a když je něco vybrané, kabel nevznikne
  const conflict = resolvePlugClick(pairs, 'Q', 'A');
  assert.equal(conflict.action, 'conflict');
  assert.deepEqual(conflict.pairs, pairs);
  assert.equal(conflict.selected, 'Q', 'výběr zůstává, aby šlo vybrat jiné písmeno');
});

test('plugboard: každé písmeno má nejvýš jeden kabel (invariant po každém kliku)', () => {
  let pairs = [];
  let selected = null;
  // proklikej celou abecedu několikrát — jako by uživatel klikal bez rozmyslu
  const clicks = [...ALPHABET, ...ALPHABET, ...[...ALPHABET].reverse()];
  for (const letter of clicks) {
    const r = resolvePlugClick(pairs, selected, letter);
    pairs = r.pairs;
    selected = r.selected;
    const used = pairs.flat();
    assert.equal(new Set(used).size, used.length, `písmeno použité dvakrát: ${JSON.stringify(pairs)}`);
    for (const [a, b] of pairs) assert.notEqual(a, b, 'kabel nesmí spojovat písmeno samo se sebou');
  }
  assert.ok(pairs.length >= 13, 'proklikáním vznikne plnohodnotné zapojení');
});
