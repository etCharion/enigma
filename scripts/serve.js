/**
 * Minimální statický server bez závislostí (pro lokální vývoj).
 * Spuštění: npm run serve  →  http://localhost:8000
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..' + sep, import.meta.url));
const port = Number(process.env.PORT || 8000);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    if (file !== root && !file.startsWith(root)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — nenalezeno');
  }
}).listen(port, () => {
  console.log(`Enigma simulátor běží na http://localhost:${port}`);
});
