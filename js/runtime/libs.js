// Simulated Arduino libraries. Every class is constructed as `new Cls(R, ...ctorArgs)`.
// `static meta.ret` gives return types to the compiler (so floats print with 2 decimals, etc.).
import { strftime, bytesToBin, binToBytes, binToUtf8, utf8ToBin } from './format.js';
import { glyph } from '../font5x7.js';
import { Print } from './print.js';
import { RADIO_LIBS, lanIp, macBytes, resolveHost, isLanHost, lanHttp } from './radio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPlain = (v) => Array.isArray(v) || (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype);

// ---------------------------------------------------------------- Serial
export class HardwareSerial extends Print {
  constructor(R, port) { super(R); this.port = port | 0; this.timeout = 1000; this.baud = 0; }
  async $out(s) {
    if (!this.baud && this.port === 0) this.R.warnOnce('serialbegin', 'Serial.print() được gọi trước Serial.begin() — trên ESP32 thật dữ liệu vẫn ra UART0 nhưng nên gọi Serial.begin(115200).');
    this.R.serialOut(this.port, s);
  }
  begin(baud) { this.baud = baud; if (this.port === 0 && baud !== 115200) this.R.io.log('info', `Serial.begin(${baud}) — Serial Monitor tự khớp tốc độ.`); }
  end() {}
  flush() {}
  setDebugOutput() {}
  setTimeout(ms) { this.timeout = ms; }
  setRxBufferSize() { return 256; }
  availableForWrite() { return 128; }
  __bool() { return true; }
  get $in() { return this.port === 0 ? this.R.serialIn : []; }
  available() { return this.$in.length; }
  read() { return this.$in.length ? this.$in.shift() : -1; }
  peek() { return this.$in.length ? this.$in[0] : -1; }
  async $waitByte() {
    const end = this.R.millis() + this.timeout;
    while (!this.$in.length) {
      if (this.R.millis() >= end) return -1;
      await this.R.delay(5);
    }
    return this.$in.shift();
  }
  async readString() {
    let s = '';
    for (;;) { const c = await this.$waitByte(); if (c < 0) break; s += String.fromCharCode(c); }
    return s;
  }
  async readStringUntil(term) {
    let s = '';
    for (;;) { const c = await this.$waitByte(); if (c < 0 || c === term) break; s += String.fromCharCode(c); }
    return s;
  }
  async readBytes(buf, len) {
    let n = 0;
    while (n < len) { const c = await this.$waitByte(); if (c < 0) break; buf[n++] = c; }
    return n;
  }
  async readBytesUntil(term, buf, len) {
    let n = 0;
    while (n < len) { const c = await this.$waitByte(); if (c < 0 || c === term) break; buf[n++] = c; }
    return n;
  }
  async $parseNum(float) {
    let c;
    // skip until a digit / sign
    for (;;) {
      while (this.$in.length && !/[-0-9.]/.test(String.fromCharCode(this.$in[0]))) this.$in.shift();
      if (this.$in.length) break;
      c = await this.$waitByte();
      if (c < 0) return 0;
      if (/[-0-9.]/.test(String.fromCharCode(c))) { this.$in.unshift(c); break; }
    }
    let s = '';
    for (;;) {
      if (!this.$in.length) {
        const end = this.R.millis() + 20;
        while (!this.$in.length && this.R.millis() < end) await this.R.delay(2);
        if (!this.$in.length) break;
      }
      const ch = String.fromCharCode(this.$in[0]);
      if (!(/[0-9]/.test(ch) || (ch === '-' && !s) || (float && ch === '.' && !s.includes('.')))) break;
      s += ch; this.$in.shift();
    }
    const v = float ? parseFloat(s) : parseInt(s, 10);
    return Number.isNaN(v) ? 0 : v;
  }
  parseInt() { return this.$parseNum(false); }
  parseFloat() { return this.$parseNum(true); }
}
HardwareSerial.meta = { ret: { ...Print.meta.ret, available: 'int', read: 'int', peek: 'int', readString: 'String', readStringUntil: 'String', parseInt: 'long', parseFloat: 'float', readBytes: 'u32', readBytesUntil: 'u32', availableForWrite: 'int' } };

// ---------------------------------------------------------------- IPAddress
export class IPAddress {
  constructor(R, a, b, c, d) {
    this.R = R;
    if (typeof a === 'string') this.o = a.split('.').map(Number);
    else if (a instanceof IPAddress) this.o = a.o.slice();
    else this.o = [a | 0, b | 0, c | 0, d | 0];
  }
  toString() { return this.o.join('.'); }
  fromString(s) { this.o = this.R.h.str(s).split('.').map(Number); return this.o.length === 4; }
  $idx(i) { return this.o[i]; }
  valueOf() { return ((this.o[0] << 24) | (this.o[1] << 16) | (this.o[2] << 8) | this.o[3]) >>> 0; }
}
IPAddress.meta = { ret: { toString: 'String', fromString: 'bool' } };

// ---------------------------------------------------------------- WiFi
export class WiFiClass {
  constructor(R) { this.R = R; this.hostname = 'esp32-arduino'; this.$mode = 1; }
  get st() { return this.R.wifi; }
  mode(m) { this.$mode = m; return true; }
  getMode() { return this.$mode; }
  begin(ssid, pass) {
    const R = this.R;
    ssid = ssid === undefined ? this.st.ssid : R.h.str(ssid);
    this.st.ssid = ssid;
    this.st.status = 6;
    R.io.net('wifi', `Đang kết nối WiFi "${binToUtf8(ssid)}"...`);
    const id = setTimeout(() => {
      if (R.stopped) return;
      this.st.status = 3;
      this.st.ip = this.$static || lanIp(R.mac);
      R.io.net('wifi', `WiFi đã kết nối (AP ảo "${binToUtf8(ssid)}"), IP ${this.st.ip}`);
      R.io.wifi(true);
    }, 900 + Math.random() * 600);
    R.cleanups.push(() => clearTimeout(id));
    void pass;
    return this.st.status;
  }
  status() { return this.st.status; }
  isConnected() { return this.st.status === 3; }
  disconnect() { this.st.status = 6; this.R.io.net('wifi', 'WiFi ngắt kết nối'); this.R.io.wifi(false); return true; }
  reconnect() { return this.begin(); }
  setAutoReconnect() { return true; }
  setAutoConnect() { return true; }
  persistent() {}
  setSleep() { return true; }
  setTxPower() { return true; }
  onEvent() { return 0; }
  // static IP (WiFi.config(ip, gateway, subnet, dns…)): used on the virtual network 10.13.37.0/24
  config(ip) {
    const s = ip && ip.o ? ip.toString() : '0.0.0.0';
    this.$static = s === '0.0.0.0' ? null : s;
    if (this.$static && !this.$static.startsWith('10.13.37.')) this.R.io.log('info', `WiFi.config(${s}): AP ảo dùng mạng 10.13.37.0/24 — các board trong tab khác chỉ liên lạc được với địa chỉ 10.13.37.x.`);
    return true;
  }
  async hostByName(host, result) {
    const R = this.R;
    const h = binToUtf8(R.h.str(host));
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) { result.o = h.split('.').map(Number); return 1; }
    if (this.st.status !== 3) return 0;
    try {
      const ip = await R.wait(resolveHost(R, h));
      if (!ip) { R.io.net('dns', `✗ Không phân giải được ${h}`, 'err'); return 0; }
      result.o = ip.split('.').map(Number);
      R.io.net('dns', `${h} → ${ip}`);
      return 1;
    } catch (e) {
      if (e && e.stop) throw e;
      R.io.net('dns', `✗ DNS ${h}: ${e.message}`, 'err');
      return 0;
    }
  }
  broadcastIP() { return new IPAddress(this.R, this.st.status === 3 ? '10.13.37.255' : '255.255.255.255'); }
  setHostname(h) { this.hostname = this.R.h.str(h); return true; }
  getHostname() { return this.hostname; }
  localIP() { return new IPAddress(this.R, this.st.status === 3 ? this.st.ip : '0.0.0.0'); }
  gatewayIP() { return new IPAddress(this.R, this.st.status === 3 ? '10.13.37.1' : '0.0.0.0'); }
  subnetMask() { return new IPAddress(this.R, '255.255.255.0'); }
  dnsIP() { return new IPAddress(this.R, '8.8.8.8'); }
  macAddress(buf) {
    if (buf instanceof Uint8Array) { buf.set(macBytes(this.R.mac)); return buf; }
    return this.R.mac;
  }
  BSSIDstr() { return '42:13:37:55:AA:01'; }
  SSID(i) { return i === undefined ? this.st.ssid : (this.$scan && this.$scan[i] ? this.$scan[i][0] : ''); }
  RSSI(i) { return i === undefined ? (this.st.status === 3 ? -50 - Math.floor(Math.random() * 6) : 0) : (this.$scan && this.$scan[i] ? this.$scan[i][1] : 0); }
  encryptionType(i) { return this.$scan && this.$scan[i] ? this.$scan[i][2] : 0; }
  channel(i) { return i === undefined ? 6 : [6, 1, 11, 6][i] || 1; }
  async scanNetworks() {
    await this.R.delay(1500);
    this.$scan = [['ESP32-IoT-GUEST', -42, 0], ['ESP32-Lab', -58, 3], ['IoT-Class', -67, 3], ['CafeWiFi', -80, 3]];
    return this.$scan.length;
  }
  scanDelete() { this.$scan = null; }
  softAP(ssid) { this.R.io.net('wifi', `SoftAP "${binToUtf8(this.R.h.str(ssid))}" khởi tạo (giả lập)`); return true; }
  softAPIP() { return new IPAddress(this.R, '192.168.4.1'); }
  softAPConfig() { return true; }
}
WiFiClass.meta = { ret: { status: 'int', isConnected: 'bool', localIP: 'class:IPAddress', gatewayIP: 'class:IPAddress', subnetMask: 'class:IPAddress', dnsIP: 'class:IPAddress', softAPIP: 'class:IPAddress', macAddress: 'String', SSID: 'String', RSSI: 'int', scanNetworks: 'int', encryptionType: 'int', channel: 'int', getHostname: 'cstr', BSSIDstr: 'String', hostByName: 'int', broadcastIP: 'class:IPAddress', config: 'bool', begin: 'int', mode: 'bool', getMode: 'int', disconnect: 'bool' } };

export class WiFiClient {
  constructor(R) { this.R = R; }
  async connect(host) {
    this.R.warnOnce('tcp', `WiFiClient.connect(${this.R.h.str(host)}): socket TCP thô không khả dụng trong trình duyệt — hãy dùng HTTPClient hoặc PubSubClient.`);
    return 0;
  }
  connected() { return 0; }
  available() { return 0; }
  read() { return -1; }
  stop() {}
  setInsecure() {}
  setCACert() {}
  setCertificate() {}
  setPrivateKey() {}
  setTimeout() {}
  print() { return 0; }
  println() { return 0; }
  write() { return 0; }
  __bool() { return false; }
}
WiFiClient.meta = { ret: { connect: 'int', connected: 'u8', available: 'int', read: 'int' } };
export class WiFiClientSecure extends WiFiClient {}

// ---------------------------------------------------------------- HTTP
async function httpRequest(R, method, url, headers, body) {
  const s = R.settings;
  const u = /^http:\/\/(\d+\.\d+\.\d+\.\d+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?/.exec(url);
  if (u && isLanHost(u[1])) {
    const hdrs = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return lanHttp(R, { host: u[1], port: Number(u[2] || 80), method, path: utf8ToBin(u[3] || '/'), query: u[4] || '', headers: hdrs, body }, 5000);
  }
  const bodyBytes = body == null ? null : binToBytes(body);
  const tryProxy = s.proxyAvailable && s.proxy !== 'off';
  if (tryProxy) {
    const res = await fetch(s.proxyUrl || '/__proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, url, headers, body: body == null ? null : btoa(body) }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return { status: j.status, body: atob(j.body || ''), headers: j.headers || {} };
  }
  const res = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : bodyBytes });
  const buf = new Uint8Array(await res.arrayBuffer());
  const hdrs = {};
  res.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
  return { status: res.status, body: bytesToBin(buf), headers: hdrs };
}

export class HTTPClient {
  constructor(R) { this.R = R; this.headers = {}; this.url = ''; this.resp = null; this.timeout = 5000; }
  begin(a, b, c, d) {
    const h = this.R.h;
    const args = [a, b, c, d].filter((x) => x !== undefined && !(x instanceof WiFiClient));
    if (args.length === 1) this.url = h.str(args[0]);
    else if (args.length >= 2) {
      const host = h.str(args[0]);
      const port = Number(args[1]) || 80;
      const uri = args[2] !== undefined ? h.str(args[2]) : '/';
      this.url = `${port === 443 ? 'https' : 'http'}://${host}${port === 80 || port === 443 ? '' : ':' + port}${uri}`;
    }
    this.headers = {};
    this.resp = null;
    return true;
  }
  addHeader(k, v) { this.headers[binToUtf8(this.R.h.str(k))] = binToUtf8(this.R.h.str(v)); }
  setAuthorization(u, p) {
    if (p === undefined) this.headers.Authorization = 'Basic ' + this.R.h.str(u);
    else this.headers.Authorization = 'Basic ' + btoa(this.R.h.str(u) + ':' + this.R.h.str(p));
  }
  setTimeout(ms) { this.timeout = ms; }
  setConnectTimeout() {}
  setReuse() {}
  setFollowRedirects() {}
  setUserAgent(ua) { this.headers['User-Agent'] = this.R.h.str(ua); }
  collectHeaders() {}
  useHTTP10() {}
  async GET() { return this.sendRequest('GET'); }
  async POST(body, len) { return this.sendRequest('POST', body, len); }
  async PUT(body, len) { return this.sendRequest('PUT', body, len); }
  async PATCH(body, len) { return this.sendRequest('PATCH', body, len); }
  async sendRequest(method, body, len) {
    const R = this.R;
    method = R.h.str(method);
    let b = null;
    if (body !== undefined) b = body instanceof Uint8Array ? bytesToBin(len !== undefined ? body.subarray(0, len) : body) : R.h.str(body);
    if (R.wifi.status !== 3) { R.io.net('http', `✗ ${method} ${this.url}: WiFi chưa kết nối`, 'err'); return -1; }
    if (!this.url) return -1;
    const url = binToUtf8(this.url);
    R.io.net('http', `→ ${method} ${url}${b ? '  body: ' + binToUtf8(b).slice(0, 200) : ''}`);
    const t0 = R.millis();
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), Math.max(this.timeout, 15000)));
      const res = await R.wait(Promise.race([httpRequest(R, method, url, this.headers, b), timeout]));
      this.resp = res;
      R.io.net('http', `← ${res.status} (${res.body.length} byte, ${R.millis() - t0} ms) ${binToUtf8(res.body).slice(0, 300).replace(/\s+/g, ' ')}`);
      return res.status;
    } catch (e) {
      if (e && e.stop) throw e;
      this.resp = null;
      const hint = R.settings.proxyAvailable || /^http:\/\/10\.13\.37\./.test(url) ? '' : ' — trình duyệt có thể chặn do CORS/mixed-content; hãy chạy "node server.js" để bật proxy HTTP.';
      R.io.net('http', `✗ ${method} ${url}: ${e.message}${hint}`, 'err');
      return e.message === 'timeout' ? -11 : -1;
    }
  }
  getString() { return this.resp ? this.resp.body : ''; }
  getSize() { return this.resp ? this.resp.body.length : -1; }
  header(name) { return this.resp ? utf8ToBin(this.resp.headers[this.R.h.str(name).toLowerCase()] || '') : ''; }
  hasHeader(name) { return !!(this.resp && this.resp.headers[this.R.h.str(name).toLowerCase()]); }
  getLocation() { return this.header('location'); }
  connected() { return false; }
  end() { this.resp = null; }
  errorToString(code) {
    const m = { '-1': 'connection refused', '-2': 'send header failed', '-3': 'send payload failed', '-4': 'not connected', '-5': 'connection lost', '-6': 'no stream', '-7': 'no HTTP server', '-8': 'too less ram', '-9': 'Transfer-Encoding not supported', '-10': 'Stream write error', '-11': 'read Timeout' };
    return m[String(code)] || '';
  }
}
HTTPClient.meta = { ret: { begin: 'bool', GET: 'int', POST: 'int', PUT: 'int', PATCH: 'int', sendRequest: 'int', getString: 'String', getSize: 'int', errorToString: 'String', header: 'String', hasHeader: 'bool', getLocation: 'String', connected: 'bool' } };

// ---------------------------------------------------------------- MQTT
export const DEFAULT_BROKERS = {
  'broker.hivemq.com': 'wss://broker.hivemq.com:8884/mqtt',
  'test.mosquitto.org': 'wss://test.mosquitto.org:8081',
  'broker.emqx.io': 'wss://broker.emqx.io:8084/mqtt',
  'mqtt.eclipseprojects.io': 'wss://mqtt.eclipseprojects.io:443/mqtt',
  'public.cloud.shiftr.io': 'wss://public.cloud.shiftr.io',
};

export class PubSubClient {
  constructor(R, a, b, c) {
    this.R = R;
    this.cl = null;
    this.cb = null;
    this.queue = [];
    this.st = -1;
    if (typeof a === 'string' || a instanceof IPAddress) this.setServer(a, b);
    void c;
  }
  setServer(host, port) { this.host = host instanceof IPAddress ? host.toString() : this.R.h.str(host); this.port = Number(port) || 1883; return this; }
  setCallback(fn) { this.cb = fn; return this; }
  setClient() { return this; }
  setBufferSize() { return true; }
  setKeepAlive() { return this; }
  setSocketTimeout() { return this; }
  brokerUrl() {
    const map = Object.assign({}, DEFAULT_BROKERS, this.R.settings.brokers || {});
    const h = binToUtf8(this.host || '');
    if (/^wss?:\/\//.test(h)) return h;
    return map[h] || `wss://${h}:8884/mqtt`;
  }
  async connect(id, user, pass, willTopic, willQos, willRetain, willMsg, clean) {
    const R = this.R;
    const h = R.h;
    if (R.wifi.status !== 3) { this.st = -2; R.io.net('mqtt', '✗ MQTT connect: WiFi chưa kết nối', 'err'); return false; }
    if (!this.host) { this.st = -2; R.io.net('mqtt', '✗ MQTT: chưa gọi setServer()', 'err'); return false; }
    const g = typeof globalThis !== 'undefined' ? globalThis.mqtt : null;
    if (!g) { this.st = -2; R.io.net('mqtt', '✗ Thư viện mqtt.js chưa được nạp', 'err'); return false; }
    if (this.cl) { try { this.cl.end(true); } catch { /* */ } }
    const url = this.brokerUrl();
    const opts = { clientId: binToUtf8(h.str(id)), reconnectPeriod: 0, connectTimeout: 10000, clean: clean === undefined ? true : !!clean, keepalive: 15 };
    if (user != null && typeof user !== 'number') opts.username = binToUtf8(h.str(user));
    if (pass != null && typeof pass !== 'number') opts.password = binToUtf8(h.str(pass));
    if (typeof user === 'string' && willTopic === undefined && pass !== undefined && typeof pass === 'number') {
      // connect(id, willTopic, willQos, willRetain, willMessage)
      delete opts.username; delete opts.password;
    }
    if (willTopic != null && willMsg != null) opts.will = { topic: binToUtf8(h.str(willTopic)), payload: binToUtf8(h.str(willMsg)), qos: willQos | 0, retain: !!willRetain };
    R.io.net('mqtt', `Kết nối MQTT ${this.host}:${this.port} qua ${url} (clientId=${opts.clientId})...`);
    const cl = g.connect(url, opts);
    this.cl = cl;
    R.cleanups.push(() => { try { cl.end(true); } catch { /* */ } });
    cl.on('message', (topic, payload) => {
      if (this.queue.length > 200) this.queue.shift();
      this.queue.push([utf8ToBin(topic), new Uint8Array(payload)]);
    });
    cl.on('close', () => { if (this.st === 0) { this.st = -3; R.io.net('mqtt', 'Mất kết nối MQTT', 'err'); } });
    cl.on('error', (e) => { R.io.net('mqtt', 'Lỗi MQTT: ' + (e && e.message), 'err'); });
    const ok = await R.wait(new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 10000);
      cl.once('connect', () => { clearTimeout(t); resolve(true); });
      cl.once('error', () => { clearTimeout(t); resolve(false); });
      cl.once('close', () => { clearTimeout(t); resolve(false); });
    }));
    if (ok) { this.st = 0; R.io.net('mqtt', '✓ MQTT đã kết nối'); } else { this.st = -2; R.io.net('mqtt', '✗ Kết nối MQTT thất bại', 'err'); try { cl.end(true); } catch { /* */ } }
    return ok;
  }
  connected() { return !!(this.cl && this.cl.connected && this.st === 0); }
  state() { return this.st; }
  disconnect() { if (this.cl) this.cl.end(); this.st = -1; }
  publish(topic, payload, a, b) {
    const R = this.R;
    if (!this.connected()) return false;
    let retained = false;
    let bytes;
    if (payload instanceof Uint8Array) {
      const len = typeof a === 'number' && b !== undefined ? a : typeof a === 'number' && a > 1 ? a : undefined;
      bytes = len !== undefined ? payload.subarray(0, len) : (payload.indexOf(0) >= 0 ? payload.subarray(0, payload.indexOf(0)) : payload);
      retained = !!(b !== undefined ? b : (len === undefined ? a : false));
    } else {
      bytes = binToBytes(R.h.str(payload));
      if (typeof a === 'number' && b !== undefined) { bytes = bytes.subarray(0, a); retained = !!b; } else retained = !!a;
    }
    const t = binToUtf8(R.h.str(topic));
    const text = new TextDecoder().decode(bytes);
    this.cl.publish(t, text, { retain: retained, qos: 0 });
    R.io.net('mqtt', `↑ PUB ${t}: ${text.slice(0, 300)}${retained ? ' (retained)' : ''}`);
    return true;
  }
  subscribe(topic, qos) {
    if (!this.connected()) return false;
    const t = binToUtf8(this.R.h.str(topic));
    this.cl.subscribe(t, { qos: Math.min(1, qos | 0) });
    this.R.io.net('mqtt', `SUB ${t}`);
    return true;
  }
  unsubscribe(topic) { if (!this.connected()) return false; this.cl.unsubscribe(binToUtf8(this.R.h.str(topic))); return true; }
  async loop() {
    while (this.queue.length) {
      const [topic, payload] = this.queue.shift();
      this.R.io.net('mqtt', `↓ MSG ${binToUtf8(topic)}: ${new TextDecoder().decode(payload).slice(0, 300)}`);
      if (this.cb) await this.cb(topic, payload, payload.length);
    }
    return this.connected();
  }
}
PubSubClient.meta = { ret: { connect: 'bool', connected: 'bool', state: 'int', publish: 'bool', subscribe: 'bool', unsubscribe: 'bool', loop: 'bool', setBufferSize: 'bool' } };

// ---------------------------------------------------------------- ArduinoJson
export function jsonSafe(v) {
  if (v instanceof Uint8Array) { const z = v.indexOf(0); return bytesToBin(z < 0 ? v : v.subarray(0, z)); }
  if (v instanceof JsonSlot || v === undefined) return null;
  if (v instanceof JsonDocument) return jsonClone(v.root);
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}
function jsonClone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }

export class JsonSlot {
  constructor(parent, key) { this.parent = parent; this.key = key; }
  materialize(kind) {
    const c = kind === 'array' ? [] : {};
    const p = this.parent;
    if (p instanceof JsonDocument) { if (p.root == null) p.root = typeof this.key === 'number' ? [] : {}; p.root[this.key] = c; }
    else if (p instanceof JsonSlot) { const pc = p.materialize(typeof this.key === 'number' ? 'array' : 'object'); pc[this.key] = c; }
    else p[this.key] = c;
    return c;
  }
  set(v) {
    const p = this.parent;
    v = jsonSafe(v);
    if (p instanceof JsonDocument) p.$set(this.key, v);
    else if (p instanceof JsonSlot) p.materialize(typeof this.key === 'number' ? 'array' : 'object')[this.key] = v;
    else p[this.key] = v;
    return true;
  }
  toString() { return 'null'; }
}

export class DeserializationError {
  constructor(R, code) { this.R = R; this.$code = code || 'Ok'; }
  c_str() { return this.$code; }
  f_str() { return this.$code; }
  code() { return this.$code; }
  __bool() { return this.$code !== 'Ok'; }
  toString() { return this.$code; }
}
DeserializationError.Ok = 'Ok';
DeserializationError.InvalidInput = 'InvalidInput';
DeserializationError.IncompleteInput = 'IncompleteInput';
DeserializationError.EmptyInput = 'EmptyInput';
DeserializationError.NoMemory = 'NoMemory';
DeserializationError.meta = { ret: { c_str: 'cstr', f_str: 'cstr', code: 'any' } };

function asType(v, t, R) {
  if (v instanceof JsonSlot) v = null;
  switch (t) {
    case 'float': case 'double': return typeof v === 'number' ? v : typeof v === 'boolean' ? +v : typeof v === 'string' ? (parseFloat(v) || 0) : 0;
    case 'bool': return v === true || (typeof v === 'number' && v !== 0);
    case 'String': return v == null ? 'null' : typeof v === 'string' ? v : R.h.str(v);
    case 'cstr': return typeof v === 'string' ? v : null;
    case 'JsonObject': return isPlain(v) && !Array.isArray(v) ? v : null;
    case 'JsonArray': return Array.isArray(v) ? v : null;
    case 'any': case 'JsonVariant': return v;
    default:
      if (/^[iu]\d+$/.test(t) || t === 'char') return typeof v === 'number' ? Math.trunc(v) : typeof v === 'boolean' ? +v : typeof v === 'string' ? (parseInt(v, 10) || 0) : 0;
      return v;
  }
}
function isType(v, t) {
  if (v instanceof JsonSlot) v = null;
  switch (t) {
    case 'float': case 'double': return typeof v === 'number';
    case 'bool': return typeof v === 'boolean';
    case 'String': case 'cstr': return typeof v === 'string';
    case 'JsonObject': return isPlain(v) && !Array.isArray(v);
    case 'JsonArray': return Array.isArray(v);
    default: if (/^[iu]\d+$/.test(t)) return typeof v === 'number' && Number.isInteger(v); return v != null;
  }
}

export class JsonDocument {
  constructor(R) { this.R = R; this.root = null; }
  get(k) {
    if (this.root == null) return new JsonSlot(this, k);
    if (typeof k === 'string' && Array.isArray(this.root)) return new JsonSlot(this, k);
    const v = this.root[k];
    return v === undefined ? new JsonSlot(this, k) : v;
  }
  $set(k, v) {
    if (this.root == null || typeof this.root !== 'object') this.root = typeof k === 'number' ? [] : {};
    if (Array.isArray(this.root) && typeof k === 'number') while (this.root.length < k) this.root.push(null);
    this.root[k] = v;
    return v;
  }
  $parse(s) {
    if (!s || !s.trim()) { this.root = null; return new DeserializationError(this.R, 'EmptyInput'); }
    try {
      this.root = JSON.parse(s);
      return new DeserializationError(this.R, 'Ok');
    } catch (e) {
      this.root = null;
      return new DeserializationError(this.R, /end of (JSON )?input|Unterminated/i.test(e.message) ? 'IncompleteInput' : 'InvalidInput');
    }
  }
  clear() { this.root = null; }
  size() { return this.root == null ? 0 : Array.isArray(this.root) ? this.root.length : typeof this.root === 'object' ? Object.keys(this.root).length : 0; }
  containsKey(k) { return !!(this.root && typeof this.root === 'object' && Object.prototype.hasOwnProperty.call(this.root, this.R.h.str(k))); }
  remove(k) { if (this.root && typeof this.root === 'object') { if (Array.isArray(this.root)) this.root.splice(k, 1); else delete this.root[this.R.h.str(k)]; } }
  isNull() { return this.root == null; }
  add(v) { if (!Array.isArray(this.root)) this.root = []; this.root.push(jsonSafe(v)); return true; }
  add$T(t) { if (!Array.isArray(this.root)) this.root = []; const c = t === 'JsonArray' ? [] : {}; this.root.push(c); return c; }
  createNestedObject(k) { const o = {}; if (k === undefined) { if (!Array.isArray(this.root)) this.root = []; this.root.push(o); } else this.$set(this.R.h.str(k), o); return o; }
  createNestedArray(k) { const a = []; if (k === undefined) { if (!Array.isArray(this.root)) this.root = []; this.root.push(a); } else this.$set(this.R.h.str(k), a); return a; }
  to$T(t) { this.root = t === 'JsonArray' ? [] : t === 'JsonObject' ? {} : null; return this.root; }
  as$T(t) { return asType(this.root, t, this.R); }
  is$T(t) { return isType(this.root, t); }
  set(v) { this.root = jsonSafe(v); return true; }
  memoryUsage() { return JSON.stringify(this.root || null).length; }
  capacity() { return 1024; }
  overflowed() { return false; }
  shrinkToFit() {}
  garbageCollect() { return true; }
  nesting() { return 0; }
  toString() { return JSON.stringify(this.root); }

  // Methods called on plain JSON values (JsonObject / JsonArray / JsonVariant)
  static valueMethod(v, m, a, t, $) {
    const slot = v instanceof JsonSlot ? v : null;
    const val = slot ? null : v;
    switch (m) {
      case 'as': return asType(val, t, $.R || { h: $ });
      case 'is': return isType(val, t);
      case 'isNull': return val == null;
      case 'size': return Array.isArray(val) ? val.length : isPlain(val) ? Object.keys(val).length : typeof val === 'string' ? val.length : 0;
      case 'containsKey': return isPlain(val) && Object.prototype.hasOwnProperty.call(val, $.str(a[0]));
      case 'add': {
        const arr = slot ? slot.materialize('array') : val;
        if (!Array.isArray(arr)) return false;
        if (t) { const c = t === 'JsonArray' ? [] : {}; arr.push(c); return c; }
        if (a.length === 0) { const c = {}; arr.push(c); return c; }
        arr.push(jsonSafe(a[0]));
        return true;
      }
      case 'remove':
        if (Array.isArray(val)) val.splice(a[0], 1); else if (isPlain(val)) delete val[$.str(a[0])];
        return undefined;
      case 'clear':
        if (Array.isArray(val)) val.length = 0; else if (isPlain(val)) for (const k of Object.keys(val)) delete val[k];
        return undefined;
      case 'createNestedObject': case 'createNestedArray': {
        const c = m === 'createNestedObject' ? {} : [];
        const target = slot ? slot.materialize(a.length ? 'object' : 'array') : val;
        if (a.length) target[$.str(a[0])] = c; else target.push(c);
        return c;
      }
      case 'to': {
        if (slot) return slot.materialize(t === 'JsonArray' ? 'array' : 'object');
        if (t === 'JsonArray' && Array.isArray(val)) { val.length = 0; return val; }
        if (t === 'JsonObject' && isPlain(val) && !Array.isArray(val)) { for (const k of Object.keys(val)) delete val[k]; return val; }
        throw new Error('to<>() trên giá trị không hợp lệ');
      }
      case 'set': if (slot) return slot.set(a[0]); return false;
      case 'c_str': return typeof val === 'string' ? val : null;
      case 'nesting': return 0;
      default: throw new Error(`JsonVariant::${m}() chưa được hỗ trợ`);
    }
  }
}
JsonDocument.meta = { ret: { size: 'u32', containsKey: 'bool', isNull: 'bool', add: 'bool', memoryUsage: 'u32', capacity: 'u32', overflowed: 'bool', createNestedObject: 'class:JsonObject', createNestedArray: 'class:JsonArray' } };
export class StaticJsonDocument extends JsonDocument {}
export class DynamicJsonDocument extends JsonDocument {}

// ---------------------------------------------------------------- time
export class TmStruct {
  constructor(R) { this.R = R; this.tm_sec = 0; this.tm_min = 0; this.tm_hour = 0; this.tm_mday = 1; this.tm_mon = 0; this.tm_year = 70; this.tm_wday = 4; this.tm_yday = 0; this.tm_isdst = 0; }
  setFromDate(d) {
    this.tm_sec = d.getUTCSeconds(); this.tm_min = d.getUTCMinutes(); this.tm_hour = d.getUTCHours();
    this.tm_mday = d.getUTCDate(); this.tm_mon = d.getUTCMonth(); this.tm_year = d.getUTCFullYear() - 1900;
    this.tm_wday = d.getUTCDay();
    this.tm_yday = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
  }
  toString() { return strftime('%c', this); }
}
TmStruct.meta = { fields: { tm_sec: 'int', tm_min: 'int', tm_hour: 'int', tm_mday: 'int', tm_mon: 'int', tm_year: 'int', tm_wday: 'int', tm_yday: 'int', tm_isdst: 'int' } };

// ---------------------------------------------------------------- Wire / ESP / Preferences
export class TwoWire {
  // default pins: SDA/SCL of the board's pins_arduino.h (21/22 on the ESP32 DevKit)
  constructor(R) { this.R = R; this.addr = 0; this.$pins(this.$def('SDA', 21), this.$def('SCL', 22)); }
  $def(name, fallback) { const c = this.R.board && this.R.board.consts; return c && c[name] != null ? c[name] : fallback; }
  $pins(sda, scl) { this.R.i2c = { sda, scl }; if (this.R.sim) this.R.sim.i2cPins = this.R.i2c; }
  begin(sda, scl) { if (sda !== undefined && sda >= 0) this.$pins(sda, scl === undefined ? this.$def('SCL', 22) : scl); return true; }
  setPins(sda, scl) { this.$pins(sda, scl); return true; }
  setClock() {}
  end() { return true; }
  beginTransmission(a) { this.addr = a; }
  write() { return 1; }
  endTransmission() { return this.R.sim.findI2C(null, this.addr) ? 0 : 2; }
  requestFrom() { return 0; }
  available() { return 0; }
  read() { return -1; }
}
TwoWire.meta = { ret: { endTransmission: 'u8', requestFrom: 'u8', available: 'int', read: 'int', begin: 'bool' } };

export class EspClass {
  constructor(R) { this.R = R; }
  async restart() { this.R.io.restart(); await this.R.delay(1e9); }
  getFreeHeap() { return 245000 + Math.floor(Math.random() * 400); }
  getHeapSize() { return 327680; }
  getMinFreeHeap() { return 236000; }
  getMaxAllocHeap() { return 110580; }
  getFreePsram() { return 0; }
  getPsramSize() { return 0; }
  getChipModel() { return this.R.chip.model; }
  getChipRevision() { return this.R.chip.revision; }
  getChipCores() { return this.R.chip.cores; }
  getCpuFreqMHz() { return this.R.chip.mhz; }
  getFlashChipSize() { return 4194304; }
  getFlashChipSpeed() { return 40000000; }
  getSketchSize() { return 286720; }
  getFreeSketchSpace() { return 1310720; }
  getSdkVersion() { return 'v5.1.4'; }
  getEfuseMac() { return 0x1001C40A24; }
  getCycleCount() { return Math.floor(this.R.millis() * this.R.chip.mhz * 1000) >>> 0; }
  deepSleep(us) { this.R.io.log('info', `ESP.deepSleep(${us}) — mô phỏng bằng khởi động lại.`); this.R.io.restart(); }
}
EspClass.meta = { ret: { getFreeHeap: 'u32', getHeapSize: 'u32', getMinFreeHeap: 'u32', getMaxAllocHeap: 'u32', getChipModel: 'cstr', getChipRevision: 'u8', getChipCores: 'u8', getCpuFreqMHz: 'u32', getFlashChipSize: 'u32', getSketchSize: 'u32', getFreeSketchSpace: 'u32', getSdkVersion: 'cstr', getEfuseMac: 'i64', getCycleCount: 'u32', getFlashChipSpeed: 'u32', getFreePsram: 'u32', getPsramSize: 'u32' } };

const memStore = new Map();
const store = {
  get(k) { try { return globalThis.localStorage ? globalThis.localStorage.getItem(k) : memStore.get(k) ?? null; } catch { return memStore.get(k) ?? null; } },
  set(k, v) { try { if (globalThis.localStorage) globalThis.localStorage.setItem(k, v); else memStore.set(k, v); } catch { memStore.set(k, v); } },
};
export class Preferences {
  constructor(R) { this.R = R; this.ns = null; }
  get $key() { return 'esp32sim.nvs.' + this.ns; }
  $load() { try { return JSON.parse(store.get(this.$key) || '{}'); } catch { return {}; } }
  $save(d) { store.set(this.$key, JSON.stringify(d)); }
  begin(ns, ro) { this.ns = this.R.h.str(ns); this.ro = !!ro; return true; }
  end() { this.ns = null; }
  clear() { this.$save({}); return true; }
  remove(k) { const d = this.$load(); delete d[this.R.h.str(k)]; this.$save(d); return true; }
  isKey(k) { return Object.prototype.hasOwnProperty.call(this.$load(), this.R.h.str(k)); }
  freeEntries() { return 500; }
  $put(k, v) { if (!this.ns || this.ro) return 0; const d = this.$load(); d[this.R.h.str(k)] = v; this.$save(d); return 4; }
  $get(k, def) { if (!this.ns) return def; const d = this.$load(); const key = this.R.h.str(k); return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : def; }
}
for (const [name, conv] of [['Char', (v) => v | 0], ['UChar', (v) => v & 255], ['Short', (v) => v | 0], ['UShort', (v) => v & 65535], ['Int', (v) => v | 0], ['UInt', (v) => v >>> 0], ['Long', (v) => v | 0], ['ULong', (v) => v >>> 0], ['Long64', Math.trunc], ['ULong64', Math.trunc], ['Float', Number], ['Double', Number], ['Bool', (v) => !!v]]) {
  Preferences.prototype['put' + name] = function (k, v) { return this.$put(k, conv(v)); };
  Preferences.prototype['get' + name] = function (k, def) { return this.$get(k, def === undefined ? (name === 'Bool' ? false : 0) : def); };
}
Preferences.prototype.putString = function (k, v) { return this.$put(k, this.R.h.str(v)); };
Preferences.prototype.getString = function (k, def) { return this.$get(k, def === undefined ? '' : this.R.h.str(def)); };
Preferences.meta = { ret: { begin: 'bool', getInt: 'int', getUInt: 'u32', getLong: 'int', getULong: 'u32', getShort: 'i16', getUShort: 'u16', getChar: 'char', getUChar: 'u8', getFloat: 'float', getDouble: 'double', getBool: 'bool', getString: 'String', isKey: 'bool', freeEntries: 'u32', putString: 'u32', putInt: 'u32', putFloat: 'u32', putBool: 'u32' } };

// ---------------------------------------------------------------- sensors / actuators
export class DHT {
  constructor(R, pin, type) { this.R = R; this.pin = pin; this.type = type; }
  begin() {}
  $part() { return this.R.sim.findOnPin(['esp32-iot-dht22', 'esp32-iot-dht11'], 'SDA', this.pin); }
  read() { return !!this.$part(); }
  readTemperature(f) {
    const p = this.$part();
    if (!p) return NaN;
    let t = Number(p.attrs.temperature);
    if (p.type === 'esp32-iot-dht11') t = Math.round(t);
    return f ? t * 1.8 + 32 : t;
  }
  readHumidity() {
    const p = this.$part();
    if (!p) return NaN;
    const h = Number(p.attrs.humidity);
    return p.type === 'esp32-iot-dht11' ? Math.round(h) : h;
  }
  computeHeatIndex(t, h, isF) { return heatIndex(t, h, isF === undefined ? true : isF); }
  convertCtoF(c) { return c * 1.8 + 32; }
  convertFtoC(f) { return (f - 32) / 1.8; }
}
function heatIndex(t, h, isF) {
  const tf = isF ? t : t * 1.8 + 32;
  let hi = 0.5 * (tf + 61.0 + (tf - 68.0) * 1.2 + h * 0.094);
  if (hi > 79) {
    hi = -42.379 + 2.04901523 * tf + 10.14333127 * h - 0.22475541 * tf * h - 0.00683783 * tf * tf - 0.05481717 * h * h + 0.00122874 * tf * tf * h + 0.00085282 * tf * h * h - 0.00000199 * tf * tf * h * h;
    if (h < 13 && tf >= 80 && tf <= 112) hi -= ((13 - h) * 0.25) * Math.sqrt((17 - Math.abs(tf - 95)) * 0.05882);
    else if (h > 85 && tf >= 80 && tf <= 87) hi += ((h - 85) * 0.1) * ((87 - tf) * 0.2);
  }
  return isF ? hi : (hi - 32) / 1.8;
}
DHT.meta = { ret: { readTemperature: 'float', readHumidity: 'float', computeHeatIndex: 'float', convertCtoF: 'float', convertFtoC: 'float', read: 'bool' } };

export class TempAndHumidity {
  constructor(R, t, h) { this.temperature = t === undefined ? NaN : t; this.humidity = h === undefined ? NaN : h; }
}
TempAndHumidity.meta = { fields: { temperature: 'float', humidity: 'float' } };

export class DHTesp {
  constructor(R) { this.R = R; this.dht = null; }
  setup(pin, model) { this.dht = new DHT(this.R, pin, model); }
  getTemperature() { return this.dht ? this.dht.readTemperature() : NaN; }
  getHumidity() { return this.dht ? this.dht.readHumidity() : NaN; }
  getTempAndHumidity() { return new TempAndHumidity(this.R, this.getTemperature(), this.getHumidity()); }
  getStatus() { return this.dht && this.dht.$part() ? 0 : 2; }
  getStatusString() { return this.getStatus() ? 'TIMEOUT' : 'OK'; }
  getMinimumSamplingPeriod() { return 2000; }
  computeHeatIndex(t, h, isF) { return heatIndex(t, h, !!isF); }
  toFahrenheit(c) { return c * 1.8 + 32; }
  toCelsius(f) { return (f - 32) / 1.8; }
  computeDewPoint(t, h) { const a = 17.271, b = 237.7; const g = (a * t) / (b + t) + Math.log(h / 100); return (b * g) / (a - g); }
}
DHTesp.AUTO_DETECT = 0; DHTesp.DHT11 = 1; DHTesp.DHT22 = 2; DHTesp.AM2302 = 3; DHTesp.RHT03 = 4;
DHTesp.meta = { ret: { getTemperature: 'float', getHumidity: 'float', getTempAndHumidity: 'class:TempAndHumidity', getStatus: 'int', getStatusString: 'cstr', computeHeatIndex: 'float', toFahrenheit: 'float', toCelsius: 'float', computeDewPoint: 'float', getMinimumSamplingPeriod: 'int' } };

// ---------------------------------------------------------------- 1-Wire: OneWire.h + DallasTemperature.h (DS18B20)
const DS18B20 = 'esp32-iot-ds18b20';
export class OneWire {
  constructor(R, pin) { this.R = R; this.pin = pin; if (pin !== undefined) R.sim.pinMode(pin, 0x01); }
  begin(pin) { this.pin = pin; this.R.sim.pinMode(pin, 0x01); }
  // sensors answering on the bus: powered DS18B20s on the pin, and only when DQ idles HIGH (4.7 kΩ pull-up)
  $devices() {
    const sim = this.R.sim;
    const all = sim.findAllOnPin ? sim.findAllOnPin([DS18B20], 'DQ', this.pin) : [sim.findOnPin([DS18B20], 'DQ', this.pin)].filter(Boolean);
    if (all.length && sim.findAllOnPin && !(sim.readVoltage(this.pin) > 2)) {
      this.R.warnOnce('ow-pullup' + this.pin, `1-Wire trên GPIO${this.pin}: đường DQ không được kéo lên — cần điện trở 4.7 kΩ nối DQ với VDD (3.3 V), nếu không DS18B20 không trả lời.`);
      return [];
    }
    return all;
  }
  reset() { return this.$devices().length ? 1 : 0; }
  reset_search() { this.$si = 0; }
  search(addr) {
    const d = this.$devices();
    const i = this.$si || 0;
    if (i >= d.length) return false;
    this.$si = i + 1;
    if (addr) addr.set(romCode(d[i]));
    return true;
  }
  select() {}
  skip() {}
  write() {}
  write_bytes() {}
  read() { return 0xff; }
  read_bytes() {}
  depower() {}
  static crc8(addr, len) {
    let crc = 0;
    for (let i = 0; i < len; i++) {
      let b = addr[i];
      for (let j = 0; j < 8; j++) { const mix = (crc ^ b) & 1; crc >>= 1; if (mix) crc ^= 0x8c; b >>= 1; }
    }
    return crc;
  }
}
OneWire.meta = { ret: { reset: 'u8', search: 'bool', read: 'u8', crc8: 'u8' } };
// 64-bit ROM code: family 0x28, a serial derived from the part id, CRC
function romCode(part) {
  let h = 0x811c9dc5;
  for (const c of part.id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  const rom = Uint8Array.of(0x28, h & 255, (h >> 8) & 255, (h >> 16) & 255, (h >> 24) & 255, 0, 0, 0);
  rom[7] = OneWire.crc8(rom, 7);
  return rom;
}

export class DallasTemperature {
  constructor(R, wire) { this.R = R; this.wire = wire || null; this.res = 12; this.wait = true; this.latched = new Map(); this.readyAt = 0; }
  setOneWire(w) { this.wire = w; }
  begin() { this.$list(); }
  $list() { return this.wire ? this.wire.$devices() : []; }
  getDeviceCount() { return this.$list().length; }
  getDS18Count() { return this.getDeviceCount(); }
  isParasitePowerMode() { return false; }
  setResolution(a, b) { const bits = b === undefined ? a : b; this.res = Math.max(9, Math.min(12, bits | 0)); return true; }
  getResolution() { return this.res; }
  setWaitForConversion(w) { this.wait = !!w; }
  getWaitForConversion() { return this.wait; }
  // conversion time from the datasheet: 93.75 ms at 9 bit … 750 ms at 12 bit
  $convMs() { return 750 / (1 << (12 - this.res)); }
  async requestTemperatures() {
    const step = 0.0625 * (1 << (12 - this.res));
    this.latched = new Map(this.$list().map((p) => [p.id, Math.round(Math.max(-55, Math.min(125, Number(p.attrs.temperature) || 0)) / step) * step]));
    this.readyAt = this.R.millis() + this.$convMs();
    if (this.wait) await this.R.delay(this.$convMs());
    return true;
  }
  async requestTemperaturesByIndex() { return this.requestTemperatures(); }
  async requestTemperaturesByAddress() { return this.requestTemperatures(); }
  isConversionComplete() { return this.R.millis() >= this.readyAt; }
  millisToWaitForConversion() { return this.$convMs(); }
  $temp(part) {
    if (!part || !this.latched.has(part.id)) return -127;
    // read before the conversion ended: the scratchpad still holds the power-on value 85 °C
    return this.R.millis() < this.readyAt ? 85 : this.latched.get(part.id);
  }
  getTempCByIndex(i) { return this.$temp(this.$list()[i]); }
  getTempFByIndex(i) { const c = this.getTempCByIndex(i); return c === -127 ? -196.6 : c * 1.8 + 32; }
  getAddress(addr, i) { const p = this.$list()[i]; if (!p || !addr) return false; addr.set(romCode(p)); return true; }
  $byAddr(addr) { return this.$list().find((p) => romCode(p).every((b, k) => b === addr[k])); }
  isConnected(addr) { return !!this.$byAddr(addr); }
  getTempC(addr) { return this.$temp(this.$byAddr(addr)); }
  getTempF(addr) { const c = this.getTempC(addr); return c === -127 ? -196.6 : c * 1.8 + 32; }
  validAddress(addr) { return OneWire.crc8(addr, 7) === addr[7]; }
  validFamily(addr) { return addr[0] === 0x28 || addr[0] === 0x10 || addr[0] === 0x22; }
  static toFahrenheit(c) { return c * 1.8 + 32; }
  static toCelsius(f) { return (f - 32) / 1.8; }
}
DallasTemperature.meta = { ret: { getDeviceCount: 'u8', getDS18Count: 'u8', isParasitePowerMode: 'bool', setResolution: 'bool', getResolution: 'u8', getWaitForConversion: 'bool', requestTemperatures: 'bool', isConversionComplete: 'bool', millisToWaitForConversion: 'u16', getTempCByIndex: 'float', getTempFByIndex: 'float', getAddress: 'bool', isConnected: 'bool', getTempC: 'float', getTempF: 'float', validAddress: 'bool', validFamily: 'bool', toFahrenheit: 'float', toCelsius: 'float' } };

// ---------------------------------------------------------------- AHT10 / AHT20 (Adafruit_AHTX0.h)
export class sensors_event_t {
  constructor() { this.version = 1; this.sensor_id = 0; this.type = 0; this.timestamp = 0; this.temperature = 0; this.relative_humidity = 0; }
}
sensors_event_t.meta = { fields: { version: 'int', sensor_id: 'int', type: 'int', timestamp: 'u32', temperature: 'float', relative_humidity: 'float' } };

export class Adafruit_AHTX0 {
  constructor(R) { this.R = R; this.addr = 0x38; this.part = null; }
  begin(wire, id, addr) {
    if (addr !== undefined) this.addr = addr;
    this.part = this.R.sim.findI2C('aht', this.addr);
    if (!this.part) this.R.warnOnce('aht' + this.addr, `AHT10/AHT20 địa chỉ 0x${this.addr.toString(16).toUpperCase()} không tìm thấy (kiểm tra dây SDA→GPIO${this.R.i2c.sda}, SCL→GPIO${this.R.i2c.scl}, VIN, GND).`);
    return !!this.part;
  }
  getStatus() { return this.part ? 0x18 : 0xff; }
  // one measurement: trigger, ~80 ms conversion, 20-bit humidity/temperature
  async getEvent(hum, temp) {
    const p = this.R.sim.findI2C('aht', this.addr);
    if (!p) return false;
    await this.R.delay(80);
    const t = Math.round(((Number(p.attrs.temperature) + 50) / 200) * 1048576) / 1048576 * 200 - 50;
    const h = Math.round((Math.max(0, Math.min(100, Number(p.attrs.humidity))) / 100) * 1048576) / 1048576 * 100;
    const ts = this.R.millis();
    if (hum) Object.assign(hum, { type: 12, timestamp: ts, relative_humidity: h });
    if (temp) Object.assign(temp, { type: 13, timestamp: ts, temperature: t });
    return true;
  }
}
Adafruit_AHTX0.meta = { ret: { begin: 'bool', getStatus: 'u8', getEvent: 'bool' } };

export class Servo {
  constructor(R) { this.R = R; this.pin = -1; this.angle = 90; this.min = 544; this.max = 2400; }
  attach(pin, min, max) {
    this.pin = pin;
    if (min !== undefined) this.min = min;
    if (max !== undefined) this.max = max;
    this.R.sim.setServo(pin, this.angle);
    return 0;
  }
  setPeriodHertz() {}
  detach() { if (this.pin >= 0) this.R.sim.setServo(this.pin, null); this.pin = -1; }
  attached() { return this.pin >= 0; }
  write(v) {
    if (v >= this.min / 2 && v > 180) return this.writeMicroseconds(v);
    this.angle = Math.max(0, Math.min(180, Math.round(v)));
    if (this.pin >= 0) this.R.sim.setServo(this.pin, this.angle);
  }
  writeMicroseconds(us) {
    us = Math.max(this.min, Math.min(this.max, us));
    this.angle = Math.round(((us - this.min) * 180) / (this.max - this.min));
    if (this.pin >= 0) this.R.sim.setServo(this.pin, this.angle);
  }
  read() { return this.angle; }
  readMicroseconds() { return Math.round(this.min + (this.angle * (this.max - this.min)) / 180); }
}
Servo.meta = { ret: { attach: 'int', attached: 'bool', read: 'int', readMicroseconds: 'int' } };
export class ESP32PWM { constructor() {} }
ESP32PWM.allocateTimer = () => {};

// ---------------------------------------------------------------- LCD 1602/2004 (I2C)
export class LiquidCrystal_I2C extends Print {
  constructor(R, addr, cols, rows) {
    super(R);
    this.addr = addr === undefined ? 0x27 : addr;
    this.cols = cols || 16;
    this.rows = rows || 2;
    this.part = null;
    this.s = LiquidCrystal_I2C.blank(this.cols, this.rows);
  }
  static blank(cols, rows) {
    return { kind: 'lcd', ddram: new Uint8Array(128).fill(0x20), cgram: Array.from({ length: 8 }, () => new Uint8Array(8)), addr: 0, backlight: false, on: false, cursor: false, blink: false, shift: 0, ltr: true, cols, rows, dirty: true };
  }
  $attach() {
    this.part = this.R.sim.findI2C('lcd', this.addr);
    if (this.part) {
      this.part.state = this.s;
    } else {
      this.R.warnOnce('lcd' + this.addr, `LCD I2C địa chỉ 0x${this.addr.toString(16).toUpperCase()} không tìm thấy (kiểm tra địa chỉ, dây SDA→GPIO${this.R.i2c.sda}, SCL→GPIO${this.R.i2c.scl}, VCC, GND).`);
    }
  }
  $touch() { this.s.dirty = true; }
  init() { this.begin(); }
  begin(cols, rows) {
    if (cols) this.s.cols = this.cols = cols;
    if (rows) this.s.rows = this.rows = rows;
    this.$attach();
    this.s.on = true;
    this.clear();
  }
  clear() { this.s.ddram.fill(0x20); this.s.addr = 0; this.s.shift = 0; this.$touch(); }
  home() { this.s.addr = 0; this.s.shift = 0; this.$touch(); }
  setCursor(c, r) {
    const off = [0x00, 0x40, 0x14, 0x54];
    r = Math.max(0, Math.min(this.rows - 1, r | 0));
    this.s.addr = (off[r] + (c | 0)) & 0x7f;
    this.$touch();
  }
  async $out(s) {
    for (let i = 0; i < s.length; i++) this.$putc(s.charCodeAt(i));
    this.$touch();
  }
  $putc(c) {
    const st = this.s;
    st.ddram[st.addr] = c & 255;
    if (st.ltr) {
      st.addr++;
      if (st.addr === 0x28) st.addr = 0x40; else if (st.addr >= 0x68) st.addr = 0x00;
    } else {
      st.addr--;
      if (st.addr < 0) st.addr = 0x67; else if (st.addr === 0x3f) st.addr = 0x27;
    }
  }
  backlight() { this.s.backlight = true; this.$touch(); }
  noBacklight() { this.s.backlight = false; this.$touch(); }
  setBacklight(v) { this.s.backlight = !!v; this.$touch(); }
  display() { this.s.on = true; this.$touch(); }
  noDisplay() { this.s.on = false; this.$touch(); }
  cursor() { this.s.cursor = true; this.$touch(); }
  noCursor() { this.s.cursor = false; this.$touch(); }
  cursor_on() { this.cursor(); }
  cursor_off() { this.noCursor(); }
  blink() { this.s.blink = true; this.$touch(); }
  noBlink() { this.s.blink = false; this.$touch(); }
  blink_on() { this.blink(); }
  blink_off() { this.noBlink(); }
  scrollDisplayLeft() { this.s.shift = (this.s.shift + 1) % 40; this.$touch(); }
  scrollDisplayRight() { this.s.shift = (this.s.shift + 39) % 40; this.$touch(); }
  leftToRight() { this.s.ltr = true; }
  rightToLeft() { this.s.ltr = false; }
  autoscroll() {}
  noAutoscroll() {}
  createChar(n, data) { const g = this.s.cgram[n & 7]; for (let i = 0; i < 8; i++) g[i] = data[i] || 0; this.$touch(); }
  load_custom_character(n, d) { this.createChar(n, d); }
  async write(v) { if (typeof v === 'number') { this.$putc(v); this.$touch(); return 1; } return super.write(v); }
}
LiquidCrystal_I2C.meta = { ret: { ...Print.meta.ret } };

// ---------------------------------------------------------------- SSD1306 OLED + Adafruit GFX
export class Adafruit_SSD1306 extends Print {
  constructor(R, w, h) {
    super(R);
    this.W = w || 128;
    this.H = h || 64;
    this.buf = new Uint8Array(this.W * this.H);
    this.cx = 0; this.cy = 0; this.ts = 1; this.tsy = 1; this.fg = 1; this.bg = -1; this.wrap = true; this.rot = 0;
    this.part = null;
    this.s = { kind: 'oled', fb: new Uint8Array(this.W * this.H), w: this.W, h: this.H, inverted: false, on: false, dirty: true };
  }
  begin(vcc, addr) {
    this.addr = addr === undefined ? 0x3c : addr;
    this.part = this.R.sim.findI2C('oled', this.addr);
    if (this.part) this.part.state = this.s;
    else this.R.warnOnce('oled' + this.addr, `OLED SSD1306 địa chỉ 0x${this.addr.toString(16).toUpperCase()} không tìm thấy (kiểm tra dây SDA→GPIO${this.R.i2c.sda}, SCL→GPIO${this.R.i2c.scl}, VCC, GND).`);
    this.s.on = true;
    this.clearDisplay();
    return true;
  }
  width() { return this.rot & 1 ? this.H : this.W; }
  height() { return this.rot & 1 ? this.W : this.H; }
  setRotation(r) { this.rot = r & 3; }
  getRotation() { return this.rot; }
  display() { this.s.fb.set(this.buf); this.s.dirty = true; }
  clearDisplay() { this.buf.fill(0); this.cx = 0; this.cy = 0; }
  invertDisplay(i) { this.s.inverted = !!i; this.s.dirty = true; }
  dim() {}
  ssd1306_command() {}
  startscrollright() {} startscrollleft() {} startscrolldiagright() {} startscrolldiagleft() {} stopscroll() {}
  drawPixel(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    switch (this.rot) {
      case 1: [x, y] = [this.W - 1 - y, x]; break;
      case 2: [x, y] = [this.W - 1 - x, this.H - 1 - y]; break;
      case 3: [x, y] = [y, this.H - 1 - x]; break;
      default: break;
    }
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (c === 2) this.buf[i] ^= 1; else this.buf[i] = c ? 1 : 0;
  }
  getPixel(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H ? !!this.buf[y * this.W + x] : false; }
  writePixel(x, y, c) { this.drawPixel(x, y, c); }
  fillScreen(c) { for (let y = 0; y < this.height(); y++) for (let x = 0; x < this.width(); x++) this.drawPixel(x, y, c); }
  drawFastHLine(x, y, w, c) { for (let i = 0; i < w; i++) this.drawPixel(x + i, y, c); }
  drawFastVLine(x, y, h, c) { for (let i = 0; i < h; i++) this.drawPixel(x, y + i, c); }
  drawLine(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 4096; n++) {
      this.drawPixel(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  drawRect(x, y, w, h, c) { this.drawFastHLine(x, y, w, c); this.drawFastHLine(x, y + h - 1, w, c); this.drawFastVLine(x, y + 1, h - 2, c); this.drawFastVLine(x + w - 1, y + 1, h - 2, c); }
  fillRect(x, y, w, h, c) { for (let j = 0; j < h; j++) this.drawFastHLine(x, y + j, w, c); }
  $circlePts(x0, y0, r, cb) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r;
    cb(x0, y0 + r); cb(x0, y0 - r); cb(x0 + r, y0); cb(x0 - r, y0);
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      cb(x0 + x, y0 + y); cb(x0 - x, y0 + y); cb(x0 + x, y0 - y); cb(x0 - x, y0 - y);
      cb(x0 + y, y0 + x); cb(x0 - y, y0 + x); cb(x0 + y, y0 - x); cb(x0 - y, y0 - x);
    }
  }
  drawCircle(x0, y0, r, c) { this.$circlePts(x0, y0, r, (x, y) => this.drawPixel(x, y, c)); }
  fillCircle(x0, y0, r, c) {
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
      this.drawFastHLine(x0 - w, y0 + y, 2 * w + 1, c);
    }
  }
  drawRoundRect(x, y, w, h, r, c) {
    r = Math.min(r, Math.floor(Math.min(w, h) / 2));
    this.drawFastHLine(x + r, y, w - 2 * r, c); this.drawFastHLine(x + r, y + h - 1, w - 2 * r, c);
    this.drawFastVLine(x, y + r, h - 2 * r, c); this.drawFastVLine(x + w - 1, y + r, h - 2 * r, c);
    this.$circlePts(0, 0, r, (dx, dy) => {
      const px = dx < 0 ? x + r + dx : x + w - 1 - r + dx;
      const py = dy < 0 ? y + r + dy : y + h - 1 - r + dy;
      if ((dx !== 0 || true) && (dy !== 0 || true)) this.drawPixel(px, py, c);
    });
  }
  fillRoundRect(x, y, w, h, r, c) {
    r = Math.min(r, Math.floor(Math.min(w, h) / 2));
    for (let j = 0; j < h; j++) {
      let inset = 0;
      if (j < r) inset = r - Math.floor(Math.sqrt(r * r - (r - j) * (r - j)) + 0.5);
      else if (j >= h - r) inset = r - Math.floor(Math.sqrt(r * r - (j - (h - r - 1)) * (j - (h - r - 1))) + 0.5);
      this.drawFastHLine(x + inset, y + j, w - 2 * inset, c);
    }
  }
  drawTriangle(x0, y0, x1, y1, x2, y2, c) { this.drawLine(x0, y0, x1, y1, c); this.drawLine(x1, y1, x2, y2, c); this.drawLine(x2, y2, x0, y0, c); }
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    const edges = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (const [ax, ay, bx, by] of edges) {
        if (ay === by) { if (y === ay) xs.push(ax, bx); continue; }
        if ((y >= Math.min(ay, by)) && (y <= Math.max(ay, by))) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      if (xs.length) { const a = Math.round(Math.min(...xs)), b = Math.round(Math.max(...xs)); this.drawFastHLine(a, y, b - a + 1, c); }
    }
  }
  drawBitmap(x, y, bmp, w, h, c, bg) {
    const bw = (w + 7) >> 3;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const on = (bmp[j * bw + (i >> 3)] << (i & 7)) & 0x80;
      if (on) this.drawPixel(x + i, y + j, c); else if (bg !== undefined) this.drawPixel(x + i, y + j, bg);
    }
  }
  drawXBitmap(x, y, bmp, w, h, c) {
    const bw = (w + 7) >> 3;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((bmp[j * bw + (i >> 3)] >> (i & 7)) & 1) this.drawPixel(x + i, y + j, c);
  }
  setTextSize(s, sy) { this.ts = Math.max(1, s | 0); this.tsy = sy === undefined ? this.ts : Math.max(1, sy | 0); }
  setTextColor(fg, bg) { this.fg = fg; this.bg = bg === undefined ? -1 : bg; }
  setCursor(x, y) { this.cx = x | 0; this.cy = y | 0; }
  getCursorX() { return this.cx; }
  getCursorY() { return this.cy; }
  setTextWrap(w) { this.wrap = !!w; }
  cp437() {}
  setFont(f) { if (f) this.R.warnOnce('font', 'setFont(): font tùy chỉnh chưa được hỗ trợ, dùng font mặc định 5x7.'); }
  drawChar(x, y, ch, c, bg, sx, sy) {
    sy = sy === undefined ? sx : sy;
    const g = glyph(ch, 'gfx');
    for (let i = 0; i < 6; i++) {
      const col = i < 5 ? g[i] : 0;
      for (let j = 0; j < 8; j++) {
        const on = (col >> j) & 1;
        if (on || (bg !== -1 && bg !== undefined && bg !== c)) {
          const color = on ? c : bg;
          if (sx === 1 && sy === 1) this.drawPixel(x + i, y + j, color);
          else this.fillRect(x + i * sx, y + j * sy, sx, sy, color);
        }
      }
    }
  }
  async $out(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 10) { this.cx = 0; this.cy += 8 * this.tsy; continue; }
      if (c === 13) continue;
      if (this.wrap && this.cx + 6 * this.ts > this.width()) { this.cx = 0; this.cy += 8 * this.tsy; }
      this.drawChar(this.cx, this.cy, c, this.fg, this.bg, this.ts, this.tsy);
      this.cx += 6 * this.ts;
    }
  }
  getTextBounds(str, x, y, x1, y1, w, h) {
    const s = this.R.h.str(str);
    const lines = s.split('\n');
    const set = (r, v) => { if (r && typeof r === 'object' && 'v' in r) r.v = v; };
    set(x1, x); set(y1, y);
    set(w, Math.max(...lines.map((l) => l.replace(/\r/g, '').length)) * 6 * this.ts);
    set(h, lines.length * 8 * this.tsy);
  }
}
Adafruit_SSD1306.meta = { ret: { ...Print.meta.ret, begin: 'bool', width: 'i16', height: 'i16', getCursorX: 'i16', getCursorY: 'i16', getPixel: 'bool', getRotation: 'u8' } };

// ---------------------------------------------------------------- NeoPixel
export class Adafruit_NeoPixel {
  constructor(R, n, pin) { this.R = R; this.n = n || 0; this.pin = pin === undefined ? -1 : pin; this.px = Array.from({ length: this.n }, () => [0, 0, 0]); this.bright = 255; }
  begin() {}
  setPin(p) { this.pin = p; }
  updateLength(n) { this.n = n; this.px = Array.from({ length: n }, () => [0, 0, 0]); }
  numPixels() { return this.n; }
  setBrightness(b) { this.bright = b & 255; }
  getBrightness() { return this.bright; }
  setPixelColor(i, r, g, b) {
    if (i < 0 || i >= this.n) return;
    if (g === undefined) { const c = r >>> 0; this.px[i] = [(c >> 16) & 255, (c >> 8) & 255, c & 255]; } else this.px[i] = [r & 255, g & 255, b & 255];
  }
  getPixelColor(i) { const p = this.px[i]; return p ? ((p[0] << 16) | (p[1] << 8) | p[2]) >>> 0 : 0; }
  fill(c, first, count) { first = first || 0; count = count || this.n - first; for (let i = first; i < first + count; i++) this.setPixelColor(i, c); }
  clear() { for (const p of this.px) p.fill(0); }
  show() {
    const part = this.R.sim.findOnPin(['esp32-iot-neopixel-strip'], 'DIN', this.pin);
    if (!part) { this.R.warnOnce('neo' + this.pin, `NeoPixel trên GPIO${this.pin} không tìm thấy (nối DIN, VDD, VSS).`); return; }
    const k = this.bright / 255;
    part.state = { kind: 'neopixel', colors: this.px.map(([r, g, b]) => [r * k, g * k, b * k]), dirty: true };
  }
  canShow() { return true; }
  Color(r, g, b) { return Adafruit_NeoPixel.Color(r, g, b); }
  ColorHSV(h, s, v) { return Adafruit_NeoPixel.ColorHSV(h, s, v); }
  gamma32(c) { return Adafruit_NeoPixel.gamma32(c); }
}
Adafruit_NeoPixel.Color = (r, g, b) => (((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
Adafruit_NeoPixel.ColorHSV = (h = 0, s = 255, v = 255) => {
  h = ((h & 65535) / 65536) * 6;
  const i = Math.floor(h), f = h - i;
  const S = s / 255, V = v / 255;
  const p = V * (1 - S), q = V * (1 - S * f), t = V * (1 - S * (1 - f));
  const [r, g, b] = [[V, t, p], [q, V, p], [p, V, t], [p, q, V], [t, p, V], [V, p, q]][i % 6];
  return Adafruit_NeoPixel.Color(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
};
Adafruit_NeoPixel.gamma32 = (c) => c;
Adafruit_NeoPixel.meta = { ret: { Color: 'u32', ColorHSV: 'u32', gamma32: 'u32', getPixelColor: 'u32', numPixels: 'u16', getBrightness: 'u8', canShow: 'bool' } };

export const LIBS = {
  HardwareSerial, WiFiClass, IPAddress, WiFiClient, WiFiClientSecure, HTTPClient, PubSubClient,
  JsonDocument, StaticJsonDocument, DynamicJsonDocument, DeserializationError,
  tm: TmStruct, TwoWire, EspClass, Preferences,
  DHT, DHTesp, TempAndHumidity, Servo, ESP32PWM, OneWire, DallasTemperature, Adafruit_AHTX0, sensors_event_t,
  LiquidCrystal_I2C, Adafruit_SSD1306, Adafruit_NeoPixel,
  ...RADIO_LIBS,
};
