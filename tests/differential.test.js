/**
 * Diferenční test proti NEZÁVISLÉ referenční implementaci.
 *
 * Soubor tests/vectors.json generuje subagent (viz PLAN.md krok 4) — vlastní
 * implementace Enigmy napsaná od nuly podle specifikace, která vyrobí N náhodných
 * konfigurací (seedované) a k nim očekávané výstupy.
 *
 * Pokud vectors.json neexistuje, test se přeskočí (běžný `npm test` na čistém repu).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EnigmaMachine } from '../js/enigma-core.js';

const vectorsPath = fileURLToPath(new URL('./vectors.json', import.meta.url));
const missing = !existsSync(vectorsPath);

test(
  'diferenční test: JS jádro souhlasí s referenční implementací na všech vektorech',
  { skip: missing && 'přeskočeno — chybí tests/vectors.json (vygeneruje ho referenční implementace, viz PLAN.md)' },
  () => {
    const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
    assert.ok(Array.isArray(vectors) && vectors.length >= 100, 'očekáváno alespoň 100 vektorů');
    for (const v of vectors) {
      const m = new EnigmaMachine(v.config);
      assert.equal(m.encryptText(v.input), v.expected, `vektor ${JSON.stringify(v)}`);
    }
  },
);
