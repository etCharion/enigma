# Plán projektu: Enigma I — interaktivní simulátor

Lokální webová aplikace (později hostovaná na GitHubu / GitHub Pages), která simuluje
šifrovací stroj **Enigma I**: rotory **I, II, III**, **reflektor B (UKW-B)** a **plugboard**.

## 1. Cíl a funkce

- 3 kola (I, II, III) + reflektor typu B + plugboard.
- Nastavitelné: **počáteční pozice kol** (Grundstellung), **pořadí kol**, **zapojení plugboardu**.
- **Kódování i dekódování** (Enigma je reciproční — jedna operace obojí).
- **Vizualizace cesty signálu**: po stisku písmena se rozsvítí celá cesta přes plugboard,
  rotory a reflektor až k výslednému písmenu na lampovníku.
- **Rychlý mód**: stisk → posun kol, rozsvícení cesty, rozsvícení výstupní lampy, znak do výstupu.
- **Pozorovací mód**: po stisku lze cestu projít **krok za krokem** (tlačítka Krok / Přehrát / Reset)
  s vysvětlujícím popiskem každého kroku.
- **Zjednodušené krokování bez double-stepping anomálie** (viz kapitola 4).
- Historický vzhled (bakelit, mosaz, žárovky), ale přehledné rozložení komponent.

## 2. Technologie a důvod

| Volba | Důvod |
|---|---|
| Vanilla HTML/CSS/JS (ES modules), **žádné závislosti, žádný build** | GitHub Pages funguje po prostém pushi; lokálně stačí statický server |
| Testy přes vestavěný `node --test` (Node ≥ 18; zde Node 24) | `npm test` bez jakéhokoli `npm install` |
| Čisté jádro `js/enigma-core.js` oddělené od UI | testovatelné v Node, znovupoužitelné |
| Čistá logika ovládání `js/ui-logic.js` (bez DOM) | i rozhodování UI má testy: volba pořadí kol a kabely plugboardu |

## 3. Struktura projektu

```
Enigma/
├── index.html                  # rozložení komponent
├── css/style.css               # historický vzhled (bakelit/mosaz/žárovky)
├── js/
│   ├── enigma-core.js          # čistá logika: rotory, reflektor, plugboard, krokování, cesta signálu
│   ├── ui-logic.js             # čistá logika ovládání: volba pořadí kol, klikání na plugboard
│   └── app.js                  # UI: komponenty, módy, animace
├── tests/
│   ├── enigma-core.test.js     # unit testy jádra (node:test)
│   ├── ui-logic.test.js        # testy logiky ovládání (pořadí kol, kabely plugboardu)
│   ├── differential.test.js    # diff test proti referenční implementaci (přeskočí se bez vectors.json)
│   └── vectors.json            # vygeneruje subagent (nezávislá reference), commituje se
├── scripts/serve.js            # lokální statický server bez závislostí (npm run serve)
├── PLAN.md                     # tento dokument
└── README.md
```

## 4. Jádro (`js/enigma-core.js`) — pravidla a API

- Data: `ROTORS` (I/II/III: `wiring` + `notch`), `REFLECTOR_B`, `ALPHABET`, `EnigmaError`.
- `class EnigmaMachine({ rotorOrder = ['I','II','III'], positions = 'AAA', plugboard = [] })`
  - `rotorOrder` = pořadí **[levý, střední, pravý]**; `positions` = 3 písmena; `plugboard` = `'AB CD EF'` nebo pole párů.
- Metody: `getRotorOrder/setRotorOrder`, `getPositions/setPositions/reset`, `getPlugboard/setPlugboard`,
  `step()`, `encryptChar(ch) -> { input, output, positionsBefore, positionsAfter, path }`, `encryptText(text)`.
- **Krokování (zjednodušené, bez double-stepu)** — vše podle pozic PŘED krokem, každé kolo max 1 krok za stisk:
  - pravé kolo vždy +1;
  - střední kolo +1, je-li pravé na notch **nebo** samo střední na notch;
  - levé kolo +1, je-li střední na notch.
  - Notch: I = Q, II = E, III = V. Ring setting fixně A.
- **Cesta signálu** (`path`, 9 uzlů): `plugboard-in → rotor(right) → rotor(middle) → rotor(left) → reflector → rotor(left) → rotor(middle) → rotor(right) → plugboard-out`;
  uzel rotoru nese `{ stage, direction, rotor, slot, position, from, to }`.

## 5. Testovací strategie (`tests/`)

1. **Známý vektor**: I-II-III, UKW-B, AAA, bez plugboardu: `AAAAA → BDZGO`.
2. **Reciprocita**: 30 seedovaných náhodných konfigurací (pořadí, pozice, plugboard) — encrypt(encrypt(x)) = x.
3. **Žádné pevné body**: výstup ≠ vstup pro všech 26 písmen.
4. **Krokování**: `AAA→AAB`; 26 stisků `AAA→ABA`; `AAZ→AAA`; `AAV→ABW` (notch III=V);
   `AEV→BFW` a `AEZ→BFA` — zamyká **absenci double-stepu** (každé kolo max jednou).
5. **Struktura cesty**: pořadí 9 uzlů, návaznost from/to, reflektor podle tabulky, výstup = poslední uzel.
6. **Plugboard**: parsování/normalizace, první/poslední uzel cesty, validace (duplicita, neplatná písmena).
7. **Validace konfigurace**: pořadí rotorů, pozice, vstup `encryptChar`.
8. **Integrita dat**: rotory jsou permutace, reflektor je involuce bez pevných bodů.
9. **Diferenční test**: `tests/vectors.json` (≥ 300 seedovaných vektorů) generuje **nezávislá referenční
   implementace** (subagent, viz kapitola 7); bez souboru se test přeskočí.

## 6. UI — komponenty a rozložení

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              ENIGMA I                                    │
├───────────────┬──────────────────────────────────┬───────────────────────┤
│ Nastavení   ? │  Rotory + reflektor (řádky)    ? │  Plugboard          ? │
│ ⚡ Rychlý mód │  každý řádek: číslo pořadí,       │  26 zdířek (2×13)     │
│ 🔍 Pozorování │  kotouč, okénko, pás P (abecední)│  + SVG kabely         │
│ • pořadí kol  │  a pás L + drátky mezi nimi      │  + seznam párů        │
│ • pozice kol  │                                  │                       │
├───────────────┴───────┬──────────────────────────┴───────────────────────┤
│ Vstup                 │  Lampovník (26 lamp, QWERTZ)      │ Krokování     │
│ (text k zašifrování)  │  Klávesnice (3 řady QWERTZ)       │ ▶ Krok        │
│ Pozorování cesty      │                                   │ ⏵ Přehrát     │
│ (popis kroku)         │                                   │ ↺ Reset cesty │
│ Výstup                │                                   │ Historie      │
└───────────────────────┴───────────────────────────────────┴───────────────┘
```

- **Horní lišta nese jen název**: `ENIGMA I` na středu, žádný podtitulek — popis aplikace
  nepatří do hlavičky.
- **Přepínač módu sedí v panelu Nastavení stroje** (hned pod titulkem, dva pod sebe
  zarovnané přepínače). Hlavička tak zůstává prázdná a přepínač je u ostatního nastavení.
- **Vysvětlující texty nejsou v rozhraní nastrčené**: každý panel má v záhlaví **otazník**
  s rozklikávací nápovědou (`<details class="help">` → plovoucí `.help-body`, `z-index` nad
  overlayem cesty). V UI zůstávají jen **dynamické** popisky — popis kroku, historie,
  placeholder vstupu. Statický výklad (význam P/L, drátky, double-step, kontrola `AAAAA` =
  `BDZGO`) je celý v nápovědě, ne v odstavcích pod panely.
- **Malé boxy po stranách klávesnice**: vlevo **Vstup** (text k zašifrování), **Pozorování cesty**
  (popis kroku) a **Výstup**; vpravo **Krokování** (Krok / Přehrát / Reset cesty) a **Historie**.
  Ovládání je hned u klávesnice a nestojí celý blok na dně stránky. Pod 1000 px se boxy
  přeskládají pod klávesnici, na malých displejích se zmenší klávesy.
- **Klávesnice QWERTZ** (historicky věrné); fyzická klávesnice mapuje `e.key` přímo.
- **Dvě sady kontaktů a drátky mezi nimi**: v řádku kola jsou dva pásy A–Z — `P` (pravá
  strana, signál sem vstupuje) a `L` (levá strana, signál odtud vystupuje) — a mezi nimi
  **svazek 26 drátků** (`wirePairs()` v `app.js`: drátek `k` sedí vpředu na zdířce
  `(k − pozice)`, vzadu na `(wiring[k] − pozice)`). Dvojici vstup → výstup přečteš tak, že
  z písmene sjedeš po drátku dolů; **reflektor** má propojky pevné (neotáčí se) a kreslí se
  stejně: `P` = co dorazí, `L` = kam propojka pustí signál zpět.
  **Krok kola = skutečné otočení svazku**: při stisku celý svazek ujede o jednu buňku doleva
  (`slideWireField()`, 280 ms) a drátek z levého kraje se objeví vpravo — `w.pos` drží
  pozici nakreslené geometrie, takže se animuje jen jednou; drátky přes okraj se krátce
  prolijí (`.v-fade`), ostatní plynule ujedou (`.v-slide`). **Písmena obou pásů zůstávají
  na místě**, takže se v pásu nikdy nic nepřemístí. Ruční změna pozice drátky jen překreslí.
  **Zvýraznění cesty**: krok přes kolo/reflektor rozsvítí příslušný drátek barvou kroku
  (`wireIndexOf()` + `paintWireLights()`), spojnice v overlayi se uvnitř kola nekreslí
  (`skipArc`) — drátek je vidět přímo v pásu.
- **Číslo pořadí u řádku** (`1`–`3`, `↕` u reflektoru) ukazuje, v jakém pořadí tudy signál
  prochází — začíná se vždy **pravým kolem** (ve výchozím nastavení rotor III). Čísla I/II/III
  jsou označení zapojení, ne pořadí průchodu.
- **Barevné spojnice cesty**: každý z 9 uzlů cesty má vlastní barvu z `PATH_COLORS`;
  obě písmenka uzlu svítí touto barvou. Krok přes kolo nebo reflektor rozsvítí **drátek**
  v pásu kola (uvnitř součásti se linka v overlayi nekreslí), mezi součástmi je přerušovaná
  (animovaná) linka v SVG overlayi nad celým rozložením (`#path-overlay` v `.layout`).
  Overlay i pásy drátků se překreslují při změně velikosti okna a při každém kroku.
- **Rychlý mód**: stisk → animace posunu kotoučů/okének → rychlé proběhnutí cesty (~90 ms/uzel)
  → lampa výstupu → znak do výstupu + historie.
- **Pozorovací mód**: stisk se uloží, klávesnice se zamkne. Posun kol (`positionsBefore →
  positionsAfter`) se animuje hned při stisku a je v úvodním popisku — **žádný prázdný „krok 0“**:
  krok 1 hned rozsvítí první písmeno na plugboardu, kroky 1–9 = uzly cesty s popiskem
  („Rotor III (pravý), pozice B: kontakt E → K“); **Přehrát** = auto ~800 ms/krok;
  na konci se rozsvítí lampa a připíše výstup. **Reset cesty** přehraje vizualizaci znovu.
- **Pořadí kol**: volba v selectu vždycky zabere — zvolený rotor se do pozice přesune a rotor,
  který tam byl, jde na jeho místo (`swapRotorOrder()` v `ui-logic.js`, testováno).
- **Plugboard**: každé písmeno má nejvýš jeden kabel. Rozpracovaný kabel je **čárkovaný**
  (vybraná zdířka + náhled k druhému písmenu, červeně když to nejde), hotový kabel je **plný**.
  Když cesta signálu vede kabelem, rozsvítí se kabel barvou kroku a **druhá spojnice mezi
  stejnými písmenky se nekreslí** (`showPathStep()` → `skipArc`, `state.cableGlow`).
- Vzhled: tmavý bakelit, mosazné rámečky, krémový text, žluté žárovky se září; fonty Georgia/Courier New (bez externích zdrojů → funguje offline).

## 7. Rozdělení práce: já vs. subagenti

| Krok | Kdo | Poznámka |
|---|---|---|
| Architektura, plán, jádro, unit testy | **já** | hotovo, 24 testů zelených |
| Logika ovládání `js/ui-logic.js` + testy | **já** | swap pořadí kol, kabely plugboardu (10 testů) |
| Nezávislá referenční implementace + `tests/vectors.json` + diff test | **subagent `verify-enigma`** | vlastní implementace od nuly (Python/JS), self-check BDZGO, ≥300 vektorů; ověří, že jádro neobsahuje chybu |
| UI (všechny komponenty, oba módy, animace) | **já** | `index.html`, `css/style.css`, `js/app.js` |
| End-to-end ověření v prohlížeči (klikání, screenshoty, BDZGO) | **já** (Playwright) | vizualní kontrola |
| Případný code review UI | subagent později | až po první verzi UI |

## 8. Kroky vývoje

1. ✅ Plán + testy + jádro (testy zelené, vektor BDZGO ověřen).
2. ⏳ Subagent: referenční implementace → `tests/vectors.json` → diferenční test zelený.
3. UI kostra: `index.html`, `css/style.css`, statické komponenty.
4. UI + jádro: nastavení (pořadí, pozice, plugboard), klávesnice, lampovník, rychlý mód.
5. Pozorovací mód: krok za krokem, přehrání, animace posunu kol.
6. End-to-end test v prohlížeči: `AAAAA → BDZGO` naklikat, screenshoty obou módů.
7. README + instrukce pro GitHub Pages, finální úklid.

## 9. Rizika a rozhodnutí

- **Double-step** — vědomě vynechán, pravidlo je zamknuto testy (`AEV→BFW`).
- **Správnost vektorů** — kromě BDZGO ještě diferenční test proti nezávislé implementaci.
- **ES modules přes `file://`** — nejde; lokálně vždy přes `npm run serve` (statický server), na GitHub Pages automaticky přes HTTPS.
- **Ring setting** — fixně A (později lze rozšířit; API na to počítá jen v `positions`).

## 10. Spuštění

```bash
npm test          # unit + diferenční testy (node --test)
npm run serve     # lokální server → http://localhost:8000
```

**GitHub Pages**: push na `main` → Settings → Pages → *Deploy from a branch* → `main` / root → aplikace běží na `https://<user>.github.io/<repo>/`. Žádný build krok není potřeba.
