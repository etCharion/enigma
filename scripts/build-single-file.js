/**
 * build-single-file.js — slije aplikaci do jediného souboru enigma-offline.html.
 *
 * Proč: ES moduly (`import`) prohlížeč z `file://` nenačte (CORS), proto aplikace
 * potřebuje server. Tento skript z HTML, CSS a obou JS modulů udělá jeden soubor,
 * který jde otevřít dvojklikem — bez serveru a bez internetu.
 *
 * Zdroj pravdy zůstávají původní soubory (index.html, css/, js/); výsledný soubor
 * je generovaný, tak ho neupravuj ručně.
 *
 * Spuštění: npm run build:offline   (nebo node scripts/build-single-file.js)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [html, css, core, uiLogic, app] = await Promise.all([
  read('index.html'),
  read('css/style.css'),
  read('js/enigma-core.js'),
  read('js/ui-logic.js'),
  read('js/app.js'),
]);

// 1) ESM → klasický skript: pryč s `export` a se všemi `import` v app.js
const stripExports = (src) => src.replace(/^export\s+(?=(?:const|let|var|function|class)\s)/gm, '');
const withoutExports = stripExports(core);
const uiLogicNoExport = stripExports(uiLogic);
const appNoImport = app.replace(/^import\s[^;]*;[ \t]*\r?\n/gm, '');
if (/^\s*(import|export)\s/m.test(appNoImport + withoutExports + uiLogicNoExport)) {
  throw new Error('V bundlu zůstal import/export — zkontroluj transformaci.');
}

// 2) celý skript do IIFE (kvůli 'use strict' a izolaci od globálního scope)
//    Pořadí je stejné jako u modulů: jádro → logika UI → app.
const bundle = [
  '(function () {',
  "'use strict';",
  '',
  '// ── js/enigma-core.js ─────────────────────────────────────────────',
  withoutExports.trim(),
  '',
  '// ── js/ui-logic.js ────────────────────────────────────────────────',
  uiLogicNoExport.trim(),
  '',
  '// ── js/app.js ─────────────────────────────────────────────────────',
  appNoImport.trim(),
  '})();',
].join('\n');

// 2b) syntaktická kontrola svazku — odhalí i kolizi jmen mezi moduly
//     (moduly mají vlastní scope, slépený svazek ne: dvě `const mod26` spadnou)
new Script(bundle);

// 3) vložit CSS a JS přímo do HTML
// Pozor: náhrada musí být funkce — v řetězci by prohlížeč `$$` v kódu přeložil jako escape.
const out = html
  .replace(
    /[ \t]*<link rel="stylesheet" href="css\/style\.css(?:\?[^"]*)?">\r?\n/,
    () => `<style>\n${css.trim()}\n</style>\n`,
  )
  .replace(
    /[ \t]*<script type="module" src="js\/app\.js"><\/script>\r?\n/,
    () => `<script>\n${bundle.replace(/<\/script/gi, '<\\/script')}\n</script>\n`,
  )
  .replace(
    '<head>',
    () => '<head>\n<!-- Vygenerováno skriptem scripts/build-single-file.js z index.html + css/ + js/.\n     Tento soubor needituj ručně — uprav zdroje a spusť: npm run build:offline -->',
  );

if (/<link[^>]+href="(?!data:)|<script[^>]+src=/.test(out)) {
  throw new Error('V souboru zůstala externí reference — bundl by nebyl soběstačný.');
}
// kontrola, že se skript do HTML vložil 1:1 (odhalí např. rozbité `$$` v náhradě)
const inline = bundle.replace(/<\/script/gi, '<\\/script');
if (!out.includes(`<script>\n${inline}\n</script>`)) {
  throw new Error('Vložený skript se neshoduje se zdrojem — bundl je poškozený.');
}

const target = new URL('enigma-offline.html', root);
await writeFile(target, out, 'utf8');
console.log(`enigma-offline.html: ${(Buffer.byteLength(out) / 1024).toFixed(1)} kB`);
