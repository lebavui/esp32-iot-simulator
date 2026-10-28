// Service worker: lets a browser tab open web pages served by simulated boards (WebServer.h).
// http://<simulator>/__dev/10.13.37.x[:port]/path is sent over the simulator's virtual air (the BroadcastChannel
// every runtime of this origin listens on, see js/runtime/radio.js) as an 'http-req' and answered by the board's
// 'http-resp'. Absolute links of a device page ("/save", form actions, fetch('/api')) are redirected back under its
// /__dev/<ip>/ prefix.
const AIR = 'esp32-iot-sim-air';
const TIMEOUT = 5000;
const base = new URL(self.registration.scope).pathname;            // '/' (or the folder the simulator is served from)
const DEV = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '__dev/(10\\.13\\.37\\.\\d{1,3})(?::(\\d+))?(/.*)?$');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const air = new BroadcastChannel(AIR);
const pending = new Map();
air.onmessage = (e) => {
  const m = e.data;
  if (m && m.kind === 'http-resp' && pending.has(m.id)) pending.get(m.id)(m);
};

const toBin = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };
const fromBin = (s) => Uint8Array.from(s || '', (c) => c.charCodeAt(0));
const page = (status, title, text) => new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5"><h2>${title}</h2><p>${text}</p></body>`,
{ status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const m = DEV.exec(url.pathname);
  if (m) { e.respondWith(forward(e.request, m[1], Number(m[2] || 80), m[3] || '/', url.search.slice(1))); return; }
  // "/save" requested from a device page → the same path on that device
  const ref = e.request.referrer ? new URL(e.request.referrer) : null;
  const rm = ref && ref.origin === location.origin ? DEV.exec(ref.pathname) : null;
  if (rm && !url.pathname.startsWith(base + '__dev/')) {
    const target = `${base}__dev/${rm[1]}${rm[2] ? ':' + rm[2] : ''}${url.pathname}${url.search}`;
    e.respondWith(Response.redirect(target, e.request.method === 'GET' || e.request.method === 'HEAD' ? 302 : 307));
  }
});

async function forward(req, ip, port, path, query) {
  const headers = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  headers.host = ip + (port === 80 ? '' : ':' + port);
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : toBin(await req.arrayBuffer());
  const id = 'sw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  let rawPath;
  try { rawPath = toBin(new TextEncoder().encode(decodeURIComponent(path))); } catch { rawPath = path; }
  const res = await new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, TIMEOUT);
    pending.set(id, (r) => { clearTimeout(timer); pending.delete(id); resolve(r); });
    air.postMessage({ kind: 'http-req', id, src: 'browser', dst: ip, port, method: req.method, path: rawPath, query, headers, body });
  });
  if (!res) {
    return page(504, 'Không kết nối được board',
      `Không có board nào ở <b>${ip}:${port}</b> trả lời. Hãy chạy một sketch dùng <code>WebServer</code> (gọi <code>server.handleClient()</code> trong <code>loop()</code>) ở một tab trình giả lập khác, đã kết nối WiFi với địa chỉ này.`);
  }
  const h = new Headers();
  for (const [k, v] of Object.entries(res.headers || {})) { try { h.set(k, v); } catch { /* invalid header */ } }
  // boards usually send "text/html" without a charset: their strings are UTF-8
  const ct = h.get('content-type');
  if (ct && /^text\/|json|javascript/i.test(ct) && !/charset/i.test(ct)) h.set('content-type', ct + '; charset=utf-8');
  if (h.has('location')) {
    const loc = h.get('location');
    if (loc.startsWith('/')) h.set('location', `${base}__dev/${ip}${port === 80 ? '' : ':' + port}${loc}`);
  }
  const status = res.status >= 200 && res.status <= 599 ? res.status : 500;
  return new Response(status === 204 || status === 304 || req.method === 'HEAD' ? null : fromBin(res.body), { status, headers: h });
}
