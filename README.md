# ENIGMA I — interaktivní simulátor

Statická webová aplikace simulující šifrovací stroj **Enigma I**: rotory **I / II / III**,
**reflektor B (UKW-B)**, **plugboard**, nastavitelné počáteční pozice kol a pořadí kol.
Kódování i dekódování, vizualizace cesty signálu, rychlý mód i pozorování krok za krokem.
Krokování rotorů je zjednodušené — bez double-stepping anomálie.

Viz [PLAN.md](PLAN.md) — kompletní plán projektu, pravidla jádra, testovací strategie a rozdělení práce.

## Jak je vidět cesta signálu

- **Každé kolo má dvě sady kontaktů**: stranu **P** (pravá — signál sem vstupuje) a stranu
  **L** (levá — signál odtud vystupuje). Dolů k reflektoru jde cesta `P → L`, zpět nahoru
  `L → P`. Je proto hned vidět, že se písmeno **uvnitř jednoho kola** změní — a na zpáteční
  cestě ještě jednou.
- **Pásy P a L jsou abecední, mezi nimi vedou drátky**: každé kolo má 26 drátků, každý
  spojuje jednu zdířku strany P (vstup) s jednou zdířkou strany L (výstup). Dvojici přečteš
  tak, že z písmene sjedeš po drátku dolů — drátek se po stisku rozsvítí barvou kroku.
- **Krok kola je vidět jako skutečné otočení**: celý svazek drátků ujede o jednu buňku doleva
  a drátek z levého kraje se objeví vpravo (kolo je válec). Písmena obou pásů přitom
  **zůstávají na místě**, takže se nikdy nic nepřemístí a studenti vidí, že se otáčí válce,
  ne tabulka. Ruční změna pozice kolečka drátky jen překreslí (bez animace).
- Reflektor má jednu sadu kontaktů (signál se vrací stejnou stranou), ale kreslí se
  stejně jako kolo **dvěma pásy a propojkami** mezi nimi: pás **P** = písmeno, které k němu
  dorazí, pás **L** = kam ho propojka pustí zpět nahoru. Propojky jsou **pevné** — reflektor
  se neotáčí, takže jeho drátky stojí.
- **Každý z 9 kroků cesty má svou barvu**: obě rozsvícená písmenka kroku svítí stejnou barvou
  a stejnou barvou je dokreslena i zářivá spojnice mezi nimi (plná = průchod součástí,
  přerušovaná = přechod mezi součástmi). V pozorovacím módu se spojnice přidávají krok za krokem,
  v rychlém módu celá cesta problikne.
- **Číslo u každého řádku** (`1`, `2`, `3`, `↕`) udává pořadí, v jakém tudy signál prochází.

## Ovládání, které má být samozřejmé

- **Pořadí kol**: volba v kterémkoli ze tří selectů vždycky zabere — zvolený rotor se do
  pozice **přesune** a rotor, který tam byl, jde na jeho místo (výměna dvou pozic).
- **Krokování**: žádný prázdný „krok 0“ — prvním kliknutím na **Další krok** se hned rozsvítí
  první písmeno na plugboardu. Posun kol před stiskem je vidět na okénkách a v popisku.
- **Plugboard**: každé písmeno má nejvýš **jeden** kabel. Rozpracovaný kabel je **čárkovaný**
  (vybraná zdířka + náhled k druhému písmenu, červeně = tam to nejde), hotový kabel je **plný
  a rozsvítí se**. Když cesta signálu vede kabelem, kabel se rozsvítí barvou kroku — druhá
  spojnice mezi stejnými písmenky se nekreslí. `Esc` ruší rozpracovaný kabel.

## Proč jde signál nejdřív přes rotor III a ne přes rotor I?

Čísla **I / II / III** jsou jen označení *zapojení* (jak je v kolu propojeno 26 kontaktů),
ne pořadí, ve kterém signál prochází. Pořadí je dáno **mechanicky** — signál do stroje vždy
vstupuje **pravým kolem**, to se jako jediné posouvá při každém stisku (nejrychlejší kolo),
a teprve pak jde středním a levým ke reflektoru a zpět. Ve výchozím nastavení `I–II–III`
(zleva doprava) je v pravém slotu **rotor III**, proto je „první" právě on; rotor I je naopak
to nejpomalejší kolo, které signál potká jako poslední. Když v aplikaci pořadí přehodíš,
změní se zapojení, ale pořadí průchodu zůstává: **1 = pravé kolo, 2 = střední, 3 = levé,
4 = reflektor**.

## Spuštění lokálně

```bash
npm test        # testy jádra (node --test, bez instalace čehokoli)
npm run serve   # statický server → http://localhost:8000
```

Žádné závislosti, žádný build — stačí otevřít `http://localhost:8000` v prohlížeči.

## Jediný soubor pro offline použití

`enigma-offline.html` je celá aplikace (HTML + CSS + oba JS moduly) v jednom souboru.
Otevře se **dvojklikem** — bez serveru, bez internetu, klidně z USB disku nebo z OneDrive.

```bash
npm run build:offline   # přegeneruje enigma-offline.html ze zdrojů
```

Proč je potřeba generátor: prohlížeč z `file://` nenačte ES moduly (`import`), proto
aplikace jinak potřebuje server. Generátor moduly slije do jednoho klasického skriptu
a CSS vloží inline. **`enigma-offline.html` needituj ručně** — uprav `index.html`, `css/`
nebo `js/` a spusť `npm run build:offline`. Skript si sám ověří, že v souboru nezůstala
žádná externí reference a že se kód vložil 1:1.

Stejný postup použij před sdílením: zdroje jsou zdroj pravdy, offline soubor je artefakt.

## Nasazení na GitHub (Pages)

1. `git init && git add -A && git commit -m "Enigma I simulator"` → push na GitHub.
2. V repu: **Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save**.
3. Aplikace poběží na `https://<uzivatel>.github.io/<nazev-repa>/`.

## Struktura

```
index.html               rozložení komponent
css/style.css            historický vzhled (bakelit, mosaz, žárovky)
js/enigma-core.js        čistá logika Enigmy (testovatelná v Node)
js/ui-logic.js           čistá logika ovládání: pořadí kol, klikání na plugboard
js/app.js                UI, módy, animace
tests/                   node --test: unit testy + diferenční test proti referenční implementaci
scripts/serve.js         lokální statický server
scripts/build-single-file.js  generátor enigma-offline.html (jeden soubor pro offline)
enigma-offline.html      GENEROVANÝ — celá aplikace v jednom souboru
```

## Rychlý test správnosti

Výchozí nastavení (I-II-III, pozice AAA, bez plugboardu): stisk `AAAAA` musí dát **`BDZGO`**.
