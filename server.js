// ESP32 IoT Simulator – local server (no dependencies).
// Serves the web app and provides an HTTP proxy (/__proxy) so simulated HTTPClient requests
// are not blocked by browser CORS / mixed-content rules, plus DNS (/__proxy/dns) and a UDP relay (/__proxy/udp:
// one datagram out, the replies collected for a moment) for WiFi.hostByName / WiFiUDP / CoAP.
// Usage: node server.js [port]      (default 8080, listens on 127.0.0.1 only)
// Env: HOST (bind address), PORT, PROXY_BLOCK_PRIVATE=1 (proxy refuses loopback/private/link-local
// targets — set this when the server is public, e.g. in Docker, so /__proxy cannot reach internal hosts),
// UDP_PORTS (destination ports the UDP relay allows, default "5683" = CoAP).
import http from 'http';
import fs from 'fs';
import path from 'path';
import net from 'net';
import dns from 'dns/promises';
import dgram from 'dgram';
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
const BLOCK_PRIVATE = /^(1|true|yes|on)$/i.test(process.env.PROXY_BLOCK_PRIVATE || '');
const MAX_REDIRECTS = 5;
const UDP_PORTS = (process.env.UDP_PORTS || '5683').split(/[\s,]+/).filter(Boolean).map(Number);
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    // '::…' covers ::, ::1 and IPv4-mapped/compatible forms (URL parsing turns ::ffff:127.0.0.1 into ::ffff:7f00:1)
    return a.startsWith('::') || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

// Throws when the URL's host is (or resolves to) a non-public address.
async function checkTarget(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('Địa chỉ nội bộ bị chặn');
}

// fetch() that re-checks every redirect hop when BLOCK_PRIVATE is on.
async function proxyFetch(url, opts) {
  if (!BLOCK_PRIVATE) return fetch(url, { ...opts, redirect: 'follow' });
  for (let hop = 0; ; hop++) {
    await checkTarget(url);
    const r = await fetch(url, { ...opts, redirect: 'manual' });
    const loc = r.headers.get('location');
    if (r.status < 300 || r.status >= 400 || !loc) return r;
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
    url = new URL(loc, url).href;
    if (!/^https?:\/\//i.test(url)) throw new Error('URL không hợp lệ');
    if (r.status === 303 || ((r.status === 301 || r.status === 302) && opts.method.toUpperCase() === 'POST')) opts = { ...opts, method: 'GET', body: undefined };
  }
}

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
    const r = await proxyFetch(url, {
      method,
      headers,
      body: body != null && !['GET', 'HEAD'].includes(method.toUpperCase()) ? Buffer.from(body, 'base64') : undefined,
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

async function lookup4(host) {
  if (net.isIPv4(host)) return host;
  if (!HOSTNAME.test(host)) throw new Error('Tên miền không hợp lệ');
  return (await dns.lookup(host, { family: 4 })).address;
}

async function handleDns(req, res) {
  const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const { host } = JSON.parse((await readBody(req)).toString('utf8'));
    const address = await lookup4(String(host || ''));
    if (BLOCK_PRIVATE && isPrivateIp(address)) return send({ error: 'Địa chỉ nội bộ bị chặn' });
    send({ address });
  } catch (e) { send({ error: (e && e.code) || e.message }); }
}

async function handleUdp(req, res) {
  const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  let sock;
  try {
    const { host, port, data, timeout = 3000 } = JSON.parse((await readBody(req)).toString('utf8'));
    if (!UDP_PORTS.includes(Number(port))) return send({ error: `cổng UDP ${port} không được phép (UDP_PORTS=${UDP_PORTS.join(',')})` });
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length || buf.length > 1472) return send({ error: 'kích thước gói UDP không hợp lệ' });
    const address = await lookup4(String(host || ''));
    if (BLOCK_PRIVATE && isPrivateIp(address)) return send({ error: 'Địa chỉ nội bộ bị chặn' });
    sock = dgram.createSocket('udp4');
    const replies = [];
    await new Promise((resolve, reject) => {
      let grace = null;
      const done = setTimeout(resolve, Math.max(100, Math.min(5000, Number(timeout) || 3000)));
      sock.on('message', (msg, rinfo) => {
        if (rinfo.address !== address || rinfo.port !== Number(port) || replies.length >= 8) return;
        replies.push({ data: msg.toString('base64'), address, port: rinfo.port });
        // more datagrams may follow (e.g. an empty ACK, then the response)
        clearTimeout(grace);
        grace = setTimeout(() => { clearTimeout(done); resolve(); }, 250);
      });
      sock.on('error', reject);
      sock.send(buf, Number(port), address, (err) => { if (err) reject(err); });
    });
    console.log(`[udp] ${address}:${port} ${buf.length} B -> ${replies.length} reply`);
    send({ replies });
  } catch (e) {
    send({ error: (e && e.code) || e.message });
  } finally {
    if (sock) try { sock.close(); } catch { /* closed */ }
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/__proxy/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('esp32sim-proxy'); return; }
  if (u.pathname === '/__proxy' && req.method === 'POST') { await handleProxy(req, res); return; }
  if (u.pathname === '/__proxy/dns' && req.method === 'POST') { await handleDns(req, res); return; }
  if (u.pathname === '/__proxy/udp' && req.method === 'POST') { await handleUdp(req, res); return; }
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
  console.log(`HTTP proxy đang bật tại /__proxy${BLOCK_PRIVATE ? ' (chặn địa chỉ nội bộ)' : ' (chỉ cho máy cục bộ)'}.`);
});
