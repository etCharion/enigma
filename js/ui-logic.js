/**
 * ui-logic.js — čistá (na DOM nezávislá) logika uživatelského rozhraní.
 * Díky tomu jde testovat v Node (`node --test`) stejně jako jádro.
 *
 * Dvě věci, které se v UI snadno rozbijí, proto jsou tady a mají testy:
 *   1) volba rotoru v jednom ze tří selectů (pořadí kol),
 *   2) klikání na zdířky plugboardu (výběr → kabel, bez duplicit).
 */

/**
 * Pořadí rotorů po volbě `name` v pozici `slotIndex`.
 *
 * Pořadí je vždy PERMUTACE rotorů I/II/III, takže volba musí vždycky zabrat:
 * rotor, který v cílové pozici byl, se přestěhuje na místo, odkud `name` přišel
 * (prostá výměna dvou pozic). Dřívější varianta „dosaď volný rotor“ u některých
 * kombinací nezměnila nic — select se zdál neklikatelný.
 *
 * @param {string[]} order      aktuální pořadí [levý, střední, pravý]
 * @param {number}   slotIndex  0 = levé, 1 = střední, 2 = pravé
 * @param {string}   name       rotor, který uživatel v pozici zvolil
 * @returns {string[]} nové pořadí [levý, střední, pravý]
 */
export function swapRotorOrder(order, slotIndex, name) {
  const next = [...order];
  if (slotIndex < 0 || slotIndex >= next.length) return next;
  const from = next.indexOf(name);
  if (from === -1 || from === slotIndex) return next;
  next[from] = next[slotIndex];
  next[slotIndex] = name;
  return next;
}

/** Klíč kabelu nezávislý na pořadí písmen: A + S → "A-S". */
export function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Písmeno, se kterým je `letter` propojené (nebo undefined). */
export function plugMate(pairs, letter) {
  for (const [a, b] of pairs) {
    if (a === letter) return b;
    if (b === letter) return a;
  }
  return undefined;
}

/**
 * Co znamená klik na zdířku `letter`, když je rozvybraná zdířka `selected`
 * (nebo nic, je-li `selected` prázdné)?
 *
 * Vrací `action`:
 *   - `select`   — první písmeno kabelu je vybrané (čárkovaný náhled),
 *   - `deselect` — klik na totéž písmeno výběr ruší,
 *   - `connect`  — druhé písmeno je volné → vznikne kabel,
 *   - `plugged`  — klik na písmeno, které už kabel má (nic nevybíráme),
 *   - `conflict` — druhé písmeno už kabel má → kabel nevznikne.
 *
 * `pairs` se vrací nezměněné; nový pár je v `pairs` jen u `connect`.
 * Každé písmeno smí mít jen JEDEN kabel — proto se nikdy nevytvoří
 * druhé spojení mezi stejnými písmenky.
 *
 * @param {string[][]} pairs    páry plugboardu, např. [['A','S']]
 * @param {string|null} selected  rozvybraná zdířka
 * @param {string} letter       kliknutá zdířka
 */
export function resolvePlugClick(pairs, selected, letter) {
  if (selected == null) {
    const mate = plugMate(pairs, letter);
    if (mate) return { action: 'plugged', selected: null, pairs, conflict: letter, mate };
    return { action: 'select', selected: letter, pairs };
  }
  if (selected === letter) return { action: 'deselect', selected: null, pairs };
  const mate = plugMate(pairs, letter);
  if (mate) return { action: 'conflict', selected, pairs, conflict: letter, mate };
  return { action: 'connect', selected: null, pairs: [...pairs, [selected, letter]] };
}
