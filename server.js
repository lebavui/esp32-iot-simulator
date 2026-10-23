// ESP32 IoT Simulator – local server (no dependencies).
// Serves the web app and provides an HTTP proxy (/__proxy) so simulated HTTPClient requests
// are not blocked by browser CORS / mixed-content rules.
// Usage: node server.js [port]      (default 8080, listens on 127.0.0.1 only)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.ino': 'text/plain; charset=utf-8',
};
const MAX_BODY = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleProxy(req, res) {
  const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const { method = 'GET', url, headers = {}, body } = JSON.parse((await readBody(req)).toString('utf8'));
    if (!/^https?:\/\//i.test(url || '')) return send({ error: 'URL không hợp lệ' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, {
      method,
      headers,
      body: body != null && !['GET', 'HEAD'].includes(method.toUpperCase()) ? Buffer.from(body, 'base64') : undefined,
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    clearTimeout(timer);
    const hdrs = {};
    r.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
    console.log(`[proxy] ${method} ${url} -> ${r.status} (${buf.length} B)`);
    send({ status: r.status, headers: hdrs, body: buf.toString('base64') });
  } catch (e) {
    console.log(`[proxy] error: ${e.message}`);
    send({ error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/__proxy/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('esp32sim-proxy'); return; }
  if (u.pathname === '/__proxy' && req.method === 'POST') { await handleProxy(req, res); return; }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/](node_modules|tests|\.git)[\\/]/.test(file)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ESP32 IoT Simulator: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  console.log('HTTP proxy đang bật tại /__proxy (chỉ cho máy cục bộ).');
});
