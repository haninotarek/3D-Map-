#!/usr/bin/env node
// Local twin of the Vercel deployment: serves the static viewer and runs api/*.js the way Vercel does.
// Usage: node dev-server.mjs [port]      (default 8080)
// Settings come from viewer/.env.local (not committed), e.g.  ADMIN_PASSWORD_HASH=scrypt$…
// Without Upstash variables the data is kept in viewer/.data/midterm-store.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* no .env.local */ }

const port = Number(process.argv[2]) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };

async function api(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
  const file = path.join(ROOT, 'api', `${name}.js`);
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 4.5e6) { res.writeHead(413); return res.end(); } chunks.push(c); }
  const raw = Buffer.concat(chunks).toString();
  req.query = Object.fromEntries(url.searchParams);
  try { req.body = /json/.test(req.headers['content-type'] || '') && raw ? JSON.parse(raw) : raw; } catch { res.writeHead(400); return res.end('bad json'); }
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  const mod = await import(`${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}`);
  await mod.default(req, res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT) || /[\\/](\.data|\.env|api[\\/]_lib)/.test(p.slice(ROOT.length))) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, () => console.log(`EPNU viewer + midterm API at http://localhost:${port}/  (admin: /admin.html)`));
