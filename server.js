// ESP32 IoT Simulator – local server (no dependencies).
// Serves the web app and provides an HTTP proxy (/__proxy) so simulated HTTPClient requests
// are not blocked by browser CORS / mixed-content rules, plus DNS (/__proxy/dns) and a UDP relay (/__proxy/udp:
// one datagram out, the replies collected for a moment) for WiFi.hostByName / WiFiUDP / CoAP, and a
// WebSocket → TCP bridge (/__proxy/mqtt?host=…&port=…) for MQTT brokers that only listen on plain TCP.
// Usage: node server.js [port]      (default 8090, listens on 127.0.0.1 only)
// Env: HOST (bind address), PORT, PROXY_BLOCK_PRIVATE=1 (proxy refuses loopback/private/link-local
// targets — set this when the server is public, e.g. in Docker, so /__proxy cannot reach internal hosts),
// UDP_PORTS (destination ports the UDP relay allows, default "5683" = CoAP),
// MQTT_PORTS (destination ports the MQTT bridge allows, default "1883").
// Short share links (POST /__share, GET /__share/<id>, see share-store.js): SHARE_DIR (default data/share),
// SHARE_MAX_KB (64), SHARE_RATE (new links per IP per hour, 30), SHARE_QUOTA_MB (1024), SHARE_EVICT (1: over quota
// delete the least recently opened links, 0: refuse new ones), SHARE_TTL_DAYS (delete links not opened for N days, 365).
import http from 'http';
import fs from 'fs';
import path from 'path';
import net from 'net';
import dns from 'dns/promises';
import dgram from 'dgram';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ShareStore, ShareError, shareConfig } from './share-store.js';

const PORT = Number(process.argv[2] || process.env.PORT || 8090);
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
const MQTT_PORTS = (process.env.MQTT_PORTS || '1883').split(/[\s,]+/).filter(Boolean).map(Number);
const share = new ShareStore(shareConfig(process.env, ROOT));
// a share directory that cannot be written only disables short links (the page falls back to #p= links)
await share.init().catch((e) => console.log(`[share] không dùng được ${share.cfg.dir}: ${e.code || e.message}`));
const HOSTNAME =/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

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
        // a CoAP empty ACK announces a separate response that may take a while: keep waiting for the full timeout
        if (msg.length === 4 && ((msg[0] >> 4) & 3) === 2 && msg[1] === 0) return;
        // more datagrams may follow (e.g. a piggybacked response and its duplicate)
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

// Client address; behind the nginx reverse proxy (connection from a local/private address) it is in X-Real-IP.
function clientIp(req) {
  const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const fwd = String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]).trim();
  return fwd && (!net.isIP(a) || isPrivateIp(a)) ? fwd : a;
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
async function handleShareCreate(req, res) {
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const ip = clientIp(req);
  try {
    if (Number(req.headers['content-length'] || 0) > share.cfg.maxBytes) throw new ShareError(413, share.tooLarge());
    const buf = await readBody(req);
    const { id, created } = await share.create(buf, ip);
    if (created) console.log(`[share] + ${id} ${buf.length} B from ${ip} (${share.count} link, ${mb(share.bytes)})`);
    send(200, { id });
  } catch (e) {
    const status = e instanceof ShareError ? e.status : 500;
    console.log(`[share] ${status} from ${ip}: ${e.message}`);
    send(status, { error: e instanceof ShareError ? e.message : 'Lỗi server' });
  }
}
async function handleShareGet(id, res) {
  const buf = await share.get(id);
  if (!buf) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Link không tồn tại hoặc đã hết hạn'); return; }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
  res.end(buf);
}
// daily: delete links not opened for SHARE_TTL_DAYS, then re-count (tools/share-admin.mjs may have changed the files)
async function shareMaintenance() {
  try {
    const n = await share.prune();
    await share.init();
    if (n) console.log(`[share] đã xoá ${n} link quá ${share.cfg.ttlDays} ngày không mở (còn ${share.count} link, ${mb(share.bytes)})`);
  } catch (e) { console.log(`[share] lỗi khi dọn dẹp: ${e.message}`); }
}
setTimeout(shareMaintenance, 60000).unref();
setInterval(shareMaintenance, 86400000).unref();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/__proxy/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('esp32sim-proxy'); return; }
  if (u.pathname === '/__proxy' && req.method === 'POST') { await handleProxy(req, res); return; }
  if (u.pathname === '/__proxy/dns' && req.method === 'POST') { await handleDns(req, res); return; }
  if (u.pathname === '/__proxy/udp' && req.method === 'POST') { await handleUdp(req, res); return; }
  if (u.pathname === '/__share' && req.method === 'POST') { await handleShareCreate(req, res); return; }
  if (u.pathname.startsWith('/__share/') && req.method === 'GET') { await handleShareGet(u.pathname.slice(9), res); return; }
  // web pages of simulated boards are served by sw.js; reaching the server means it is not installed yet
  if (u.pathname.startsWith('/__dev/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Đang kết nối board…</title><p style="font-family:sans-serif">Đang cài trình chuyển tiếp tới board ảo…</p>
<script>navigator.serviceWorker ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => location.reload())
  : document.body.textContent = 'Trình duyệt không hỗ trợ Service Worker (cần http://localhost hoặc https).';</script>`);
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/](node_modules|tests|data|\.git)[\\/]/.test(file)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---- MQTT bridge: a minimal WebSocket server (RFC 6455, binary frames) relaying bytes to a TCP broker.
// MQTT is a byte stream, so frame boundaries do not matter: every data frame's payload is written to the socket.
function wsFrame(op, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}

async function handleMqttBridge(req, sock, head) {
  const reject = (code, msg) => { sock.end(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); };
  const u = new URL(req.url, 'http://x');
  const host = String(u.searchParams.get('host') || '');
  const port = Number(u.searchParams.get('port') || 1883);
  const key = req.headers['sec-websocket-key'];
  if (!key || !/websocket/i.test(req.headers.upgrade || '')) return reject(400, 'Bad Request');
  if (!MQTT_PORTS.includes(port)) return reject(403, 'Port Not Allowed');
  let address;
  try {
    address = await lookup4(host);
    if (BLOCK_PRIVATE && isPrivateIp(address)) return reject(403, 'Forbidden');
  } catch { return reject(502, 'Bad Gateway'); }
  const tcp = net.connect(port, address);
  let open = false;
  tcp.setTimeout(10000, () => { if (!open) tcp.destroy(); });
  tcp.once('error', (e) => { console.log(`[mqtt] ${host}:${port} ${e.code || e.message}`); if (!open) reject(502, 'Bad Gateway'); else sock.destroy(); });
  tcp.once('connect', () => {
    open = true;
    tcp.setTimeout(0);
    const proto = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim()).find((p) => /^mqtt/i.test(p));
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? `Sec-WebSocket-Protocol: ${proto}\r\n` : ''}\r\n`);
    console.log(`[mqtt] bridge → ${host}:${port}`);
    tcp.on('data', (d) => sock.write(wsFrame(2, d)));
    tcp.on('close', () => { if (!sock.destroyed) sock.end(wsFrame(8, Buffer.alloc(0))); });
    let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    const pump = () => {
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15, masked = buf[1] & 128;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (len > MAX_BODY) { sock.destroy(); tcp.destroy(); return; }
        const mask = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const data = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(off + len);
        if (op === 8) { sock.end(wsFrame(8, Buffer.alloc(0))); tcp.end(); return; }
        if (op === 9) sock.write(wsFrame(10, data));
        else if (op === 0 || op === 1 || op === 2) tcp.write(data);
      }
    };
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
    sock.on('close', () => tcp.destroy());
    sock.on('error', () => tcp.destroy());
    pump();
  });
}

server.on('upgrade', (req, sock, head) => {
  sock.on('error', () => {});
  if (new URL(req.url, 'http://x').pathname === '/__proxy/mqtt') handleMqttBridge(req, sock, head);
  else sock.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`ESP32 IoT Simulator: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  console.log(`HTTP proxy đang bật tại /__proxy${BLOCK_PRIVATE ? ' (chặn địa chỉ nội bộ)' : ' (chỉ cho máy cục bộ)'}.`);
  console.log(`Link chia sẻ: ${share.count} link, ${mb(share.bytes)} tại ${share.cfg.dir}`);
});
