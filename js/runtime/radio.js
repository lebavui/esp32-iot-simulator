// Radio and UDP for the simulated ESP32: LoRa (LoRa.h + SX1278 module), ESP-NOW (esp_now.h), UDP (WiFiUdp.h) and
// CoAP (coap-simple.h). All simulator instances of the same origin (other browser tabs, or several runtimes in one
// Node process) share a virtual "air" over a BroadcastChannel: LoRa packets, ESP-NOW frames and UDP datagrams on the
// virtual WiFi network (10.13.37.0/24) are broadcast, and each runtime keeps what its radio / sockets would receive.
// UDP to other addresses goes through server.js (__proxy/udp: one datagram out, the replies back).
import { Print } from './print.js';
import { bytesToBin, binToBytes, binToUtf8, utf8ToBin } from './format.js';

const AIR = 'esp32-iot-sim-air';
export const LAN_PREFIX = '10.13.37.';
const BCAST_MAC = 'FF:FF:FF:FF:FF:FF';

// ---------------------------------------------------------------- shared air
export function radioReset(R) {
  R.air = null;
  R.airHandlers = [];
  R.udpSockets = new Map();
  R.udpListening = false;
  R.espnow = null;
  R.spiPins = null;
  R.webServers = null;
  R.httpPending = null;
  R.httpListening = false;
}
function air(R) {
  if (!R.air) {
    if (typeof BroadcastChannel === 'undefined') { R.air = { postMessage() {}, close() {} }; return R.air; }
    const ch = new BroadcastChannel(AIR);
    if (ch.unref) ch.unref();
    ch.onmessage = (e) => {
      const m = e.data;
      if (R.stopped || !m) return;
      for (const [kind, fn] of R.airHandlers) if (m.kind === kind) fn(m);
    };
    R.air = ch;
    R.cleanups.push(() => { ch.close(); R.air = null; });
  }
  return R.air;
}
function airListen(R, kind, fn) { air(R); R.airHandlers.push([kind, fn]); }
function airSend(R, msg) { air(R).postMessage(msg); }
// run a library callback (receive/send done) like an ISR: at the sketch's next delay()/yield
function queueCallback(R, fn) { if (R.isrQueue.length < 64) R.isrQueue.push({ fn }); }

// one MAC per page (browser: same for every run of the tab; Node tests: one per Runtime)
let pageMac = null;
export function makeMac() {
  const gen = () => [0x24, 0x0A, 0xC4, ...Array.from({ length: 3 }, () => Math.floor(Math.random() * 256))]
    .map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(':');
  if (typeof window === 'undefined') return gen();
  return pageMac || (pageMac = gen());
}
export const macBytes = (s) => Uint8Array.from(s.split(':').map((h) => parseInt(h, 16)));
const macStr = (b) => Array.from(b, (x) => (x & 255).toString(16).toUpperCase().padStart(2, '0')).slice(0, 6).join(':');
// "DHCP" address on the virtual WiFi network, derived from the MAC so a tab keeps its IP between runs;
// 10.13.37.100–249, leaving .2–.99 for static addresses (WiFi.config)
export function lanIp(mac) { const b = macBytes(mac); return LAN_PREFIX + (100 + ((b[4] << 8 | b[5]) % 150)); }

// sketch data → bytes: packed struct, any typed array (its raw bytes), binary string or a single byte
function toBytes(R, data, len) {
  if (data == null) return null;
  let b;
  if (data.constructor && data.constructor.$L) b = R.h.pack(data);
  else if (ArrayBuffer.isView(data)) b = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (typeof data === 'string') b = binToBytes(data);
  else if (typeof data === 'number') b = Uint8Array.of(data & 255);
  else return null;
  return Uint8Array.from(b.subarray(0, len === undefined ? b.length : Math.max(0, len)));
}
// log text: printable UTF-8 in quotes, otherwise hex
function preview(bytes) {
  const n = bytes.length;
  let z = bytes.indexOf(0);
  if (z < 0) z = n;
  const text = new TextDecoder().decode(bytes.subarray(0, z));
  if (z >= n - 1 && n && !/[\u0000-\u0008\u000e-\u001f�]/.test(text)) return JSON.stringify(text.slice(0, 200));
  return Array.from(bytes.subarray(0, 32), (x) => x.toString(16).padStart(2, '0')).join(' ') + (n > 32 ? ' …' : '');
}
const b64 = (bytes) => btoa(bytesToBin(bytes));
const unb64 = (s) => binToBytes(atob(s || ''));
const ipText = (R, ip) => (ip && ip.o ? ip.toString() : binToUtf8(R.h.str(ip)));
const proxyBase = (R) => (R.settings.proxyUrl || '/__proxy').replace(/\/$/, '');

async function proxyPost(R, path, body) {
  const res = await fetch(`${proxyBase(R)}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j;
}

// DNS for WiFi.hostByName: server.js, else DNS-over-HTTPS
export async function resolveHost(R, host) {
  const lookup = async () => {
    if (R.settings.proxyAvailable && R.settings.proxy !== 'off') return (await proxyPost(R, 'dns', { host })).address;
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`);
    const j = await r.json();
    const a = (j.Answer || []).find((x) => x.type === 1);
    return a ? a.data : null;
  };
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 5000); });
  try { return await Promise.race([lookup(), timeout]); } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- SPI (pins only; the SX1278 is the only SPI part)
export class SPIClass {
  constructor(R) { this.R = R; }
  begin(sck, miso, mosi, ss) {
    if (sck !== undefined && sck >= 0) this.R.spiPins = { SCK: sck, MISO: miso, MOSI: mosi, SS: ss };
  }
  end() {}
  setFrequency() {}
  setDataMode() {}
  setBitOrder() {}
  beginTransaction() {}
  endTransaction() {}
  transfer() { return 0; }
}
SPIClass.meta = { ret: { transfer: 'u8' } };
export class SPISettings { constructor() {} }

// ---------------------------------------------------------------- LoRa (sandeepmistry/arduino-LoRa API)
const LORA_PART = 'esp32-iot-lora-ra02';
export class LoRaClass extends Print {
  constructor(R) {
    super(R);
    // LoRa.h defaults (LORA_DEFAULT_SS_PIN 10, RESET 9, DIO0 2) — ESP32 sketches call setPins()
    this.ss = 10; this.rst = 9; this.dio0 = 2;
    this.on = false;
    this.freq = 0; this.sf = 7; this.bw = 125e3; this.cr = 5; this.sw = 0x12; this.preamble = 8;
    this.crc = false; this.iq = false; this.implicit = false; this.txPower = 17;
    this.tx = null; this.rxq = []; this.cur = null; this.pos = 0; this.last = null;
    this.listening = false; this.rxCont = false; this.onRx = null; this.onTx = null;
    this.ignored = new Set();
  }
  setPins(ss, rst, dio0) {
    this.ss = ss;
    if (rst !== undefined) this.rst = rst;
    if (dio0 !== undefined) this.dio0 = dio0;
  }
  setSPI() {}
  setSPIFrequency() {}
  $spi() {
    const c = this.R.board.consts || { SCK: 18, MISO: 19, MOSI: 23 };
    return this.R.spiPins || { SCK: c.SCK, MISO: c.MISO, MOSI: c.MOSI };
  }
  async begin(freq) {
    const R = this.R;
    const fail = (msg) => { R.io.log('warn', 'LoRa.begin(): ' + msg); this.on = false; return 0; };
    for (const p of [this.ss, this.rst, this.dio0]) if (p >= 0 && !R.checkPin(p, 'LoRa.setPins')) return 0;
    const part = R.sim.findOnPin([LORA_PART], 'NSS', this.ss);
    if (!part) return fail(`không thấy module LoRa SX1278 nối với chân NSS = GPIO${this.ss} (hoặc module chưa được cấp nguồn VCC/GND). Kiểm tra LoRa.setPins(ss, rst, dio0) và dây nối.`);
    const spi = this.$spi();
    for (const n of ['SCK', 'MOSI', 'MISO']) {
      if (R.sim.findOnPin([LORA_PART], n, spi[n]) !== part) return fail(`chân ${n} của module phải nối với GPIO${spi[n]} (${n} của SPI trên ${R.board.label}).`);
    }
    if (this.rst >= 0) { R.sim.pinMode(this.rst, 0x03); R.sim.digitalWrite(this.rst, 1); }
    R.sim.pinMode(this.ss, 0x03);
    R.sim.digitalWrite(this.ss, 1);
    this.part = part;
    part.inbox = [];
    this.dio0Wired = this.dio0 >= 0 && R.sim.findOnPin([LORA_PART], 'DIO0', this.dio0) === part;
    this.freq = Number(freq) || 433e6;
    this.on = true;
    this.listening = false;
    if (!this.listened) {
      this.listened = true;
      airListen(R, 'lora', (m) => this.$air(m));
      const id = setInterval(() => this.$poll(), 50);
      R.cleanups.push(() => clearInterval(id));
    }
    R.io.net('lora', `SX1278 sẵn sàng, ${(this.freq / 1e6).toFixed(2)} MHz`);
    return 1;
  }
  end() { this.on = false; this.listening = false; this.rxCont = false; }
  $cfg() { return `${(this.freq / 1e6).toFixed(2)} MHz, SF${this.sf}, BW ${this.bw / 1e3} kHz, CR 4/${this.cr}, sync 0x${this.sw.toString(16).toUpperCase()}`; }
  // time on air (SX127x datasheet), ms
  $airtime(n) {
    const sf = this.sf, de = sf >= 11 && this.bw <= 125e3 ? 1 : 0;
    const ts = (2 ** sf) / this.bw * 1000;
    const k = Math.ceil((8 * n - 4 * sf + 28 + 16 * (this.crc ? 1 : 0) - 20 * (this.implicit ? 1 : 0)) / (4 * (sf - 2 * de)));
    return (this.preamble + 4.25) * ts + (8 + Math.max(k * this.cr, 0)) * ts;
  }
  beginPacket(implicit) {
    if (!this.on) return 0;
    this.implicit = !!implicit;
    this.tx = [];
    this.listening = false;
    this.rxCont = false;
    return 1;
  }
  async $out(s) { if (this.tx) for (let i = 0; i < s.length && this.tx.length < 255; i++) this.tx.push(s.charCodeAt(i) & 255); }
  async endPacket(async) {
    const R = this.R;
    if (!this.on || !this.tx) return 0;
    const data = Uint8Array.from(this.tx);
    this.tx = null;
    const toa = this.$airtime(data.length);
    if (this.part) this.part.txUntil = Date.now() + toa + 80;
    R.io.net('lora', `↑ TX ${preview(data)} (${data.length} byte, ${this.$cfg()}, thời gian phát ${toa.toFixed(1)} ms)`);
    const msg = { kind: 'lora', freq: this.freq, sf: this.sf, bw: this.bw, cr: this.cr, sw: this.sw, iq: this.iq, power: this.txPower, data };
    if (async) {
      const id = setTimeout(() => { airSend(R, msg); if (this.onTx) queueCallback(R, () => this.onTx()); }, toa);
      R.cleanups.push(() => clearTimeout(id));
      return 1;
    }
    await R.delay(toa);
    airSend(R, msg);
    return 1;
  }
  $air(m) {
    if (!this.on) return;
    const why = Math.abs(m.freq - this.freq) > 50e3 ? `tần số ${(m.freq / 1e6).toFixed(2)} MHz` : m.sf !== this.sf ? `SF${m.sf}` : m.bw !== this.bw ? `BW ${m.bw / 1e3} kHz`
      : m.sw !== this.sw ? `sync word 0x${m.sw.toString(16).toUpperCase()}` : m.iq !== this.iq ? 'InvertIQ' : '';
    if (why) {
      if (!this.ignored.has(why)) { this.ignored.add(why); this.R.io.net('lora', `(bỏ qua gói LoRa khác cấu hình: ${why}; board này: ${this.$cfg()})`); }
      return;
    }
    const rssi = Math.round(Math.min(-30, (m.power || 17) - 85 - Math.random() * 20));
    this.$deliver({ data: new Uint8Array(m.data), rssi, snr: Math.round((6 + Math.random() * 5) * 4) / 4 });
  }
  // test packets queued by the module's button
  $poll() {
    const p = this.part;
    if (!this.on || !p || !p.inbox || !p.inbox.length) return;
    const { text, rssi } = p.inbox.shift();
    this.$deliver({ data: binToBytes(utf8ToBin(text)), rssi, snr: Math.round(Math.max(-15, Math.min(12, (rssi + 120) / 5)) * 4) / 4 });
  }
  $deliver(pkt) {
    const R = this.R;
    if (!this.listening) {
      if (!this.ignored.has('idle')) { this.ignored.add('idle'); R.io.net('lora', '(có gói LoRa nhưng radio không ở chế độ thu — gọi LoRa.parsePacket() trong loop() hoặc LoRa.receive())'); }
      return;
    }
    if (this.part) this.part.rxUntil = Date.now() + 200;
    R.io.net('lora', `↓ RX ${preview(pkt.data)} (${pkt.data.length} byte, RSSI ${pkt.rssi} dBm, SNR ${pkt.snr} dB)`);
    if (this.onRx && this.rxCont) {
      if (!this.dio0Wired) { R.warnOnce('lora-dio0', `LoRa.onReceive(): chân DIO0 của module chưa nối với GPIO${this.dio0} — ngắt báo có gói tin không đến được ESP32.`); return; }
      queueCallback(R, async () => { this.$take(pkt); await this.onRx(pkt.data.length); });
      return;
    }
    this.rxq.push(pkt);
    if (this.rxq.length > 4) this.rxq.shift();
  }
  $take(pkt) { this.cur = pkt; this.pos = 0; this.last = pkt; }
  parsePacket() {
    if (!this.on) return 0;
    this.rxCont = false;
    this.listening = true;
    if (!this.rxq.length) return 0;
    this.$take(this.rxq.shift());
    return this.cur.data.length;
  }
  available() { return this.cur ? this.cur.data.length - this.pos : 0; }
  read() { return this.cur && this.pos < this.cur.data.length ? this.cur.data[this.pos++] : -1; }
  peek() { return this.cur && this.pos < this.cur.data.length ? this.cur.data[this.pos] : -1; }
  readString() { let s = ''; while (this.available()) s += String.fromCharCode(this.read()); return s; }
  readStringUntil(c) { let s = ''; while (this.available()) { const x = this.read(); if (x === c) break; s += String.fromCharCode(x); } return s; }
  flush() {}
  packetRssi() { return this.last ? this.last.rssi : -157; }
  packetSnr() { return this.last ? this.last.snr : 0; }
  packetFrequencyError() { return this.last ? Math.round((Math.random() - 0.5) * 2000) : 0; }
  rssi() { return -110 - Math.floor(Math.random() * 8); }
  onReceive(cb) { this.onRx = cb || null; }
  onTxDone(cb) { this.onTx = cb || null; }
  onCadDone() {}
  receive() { if (this.on) { this.listening = true; this.rxCont = true; } }
  channelActivityDetection() {}
  idle() { this.listening = false; this.rxCont = false; }
  sleep() { this.listening = false; this.rxCont = false; }
  setTxPower(p) { this.txPower = Number(p) || 17; }
  setFrequency(f) { this.freq = Number(f) || this.freq; }
  getSpreadingFactor() { return this.sf; }
  setSpreadingFactor(sf) { this.sf = Math.max(6, Math.min(12, sf | 0)); }
  getSignalBandwidth() { return this.bw; }
  setSignalBandwidth(bw) { this.bw = Number(bw) || 125e3; }
  setCodingRate4(d) { this.cr = Math.max(5, Math.min(8, d | 0)); }
  setPreambleLength(n) { this.preamble = Number(n) || 8; }
  setSyncWord(sw) { this.sw = sw & 255; }
  enableCrc() { this.crc = true; }
  disableCrc() { this.crc = false; }
  enableInvertIQ() { this.iq = true; }
  disableInvertIQ() { this.iq = false; }
  enableLowDataRateOptimize() {}
  disableLowDataRateOptimize() {}
  setOCP() {}
  setGain() {}
  random() { return Math.floor(Math.random() * 256); }
  dumpRegisters() {}
}
LoRaClass.meta = { ret: { ...Print.meta.ret, begin: 'int', beginPacket: 'int', endPacket: 'int', parsePacket: 'int', available: 'int', read: 'int', peek: 'int', packetRssi: 'int', packetSnr: 'float', packetFrequencyError: 'long', rssi: 'int', random: 'u8', readString: 'String', readStringUntil: 'String', getSpreadingFactor: 'int', getSignalBandwidth: 'long' } };

// ---------------------------------------------------------------- ESP-NOW (esp_now.h)
export const ESP_NOW = {
  OK: 0, ERR_WIFI_NOT_INIT: 0x3001, NOT_INIT: 0x3065, ARG: 0x3066, NO_MEM: 0x3067, FULL: 0x3068, NOT_FOUND: 0x3069,
  INTERNAL: 0x306a, EXIST: 0x306b, IF: 0x306c,
};
const ERR_NAMES = {
  0: 'ESP_OK', [-1]: 'ESP_FAIL', 0x3001: 'ESP_ERR_WIFI_NOT_INIT', 0x3065: 'ESP_ERR_ESPNOW_NOT_INIT', 0x3066: 'ESP_ERR_ESPNOW_ARG',
  0x3067: 'ESP_ERR_ESPNOW_NO_MEM', 0x3068: 'ESP_ERR_ESPNOW_FULL', 0x3069: 'ESP_ERR_ESPNOW_NOT_FOUND', 0x306a: 'ESP_ERR_ESPNOW_INTERNAL',
  0x306b: 'ESP_ERR_ESPNOW_EXIST', 0x306c: 'ESP_ERR_ESPNOW_IF',
};

export class esp_now_peer_info_t {
  constructor() { this.peer_addr = new Uint8Array(6); this.lmk = new Uint8Array(16); this.channel = 0; this.ifidx = 0; this.encrypt = false; this.priv = null; }
}
esp_now_peer_info_t.meta = { fields: { peer_addr: 'any', lmk: 'any', channel: 'u8', ifidx: 'int', encrypt: 'bool', priv: 'any' } };
// arduino-esp32 3.x callback arguments (the 2.x ones are a plain MAC pointer — the same object indexes as one)
export class esp_now_recv_info_t { constructor() { this.src_addr = new Uint8Array(6); this.des_addr = new Uint8Array(6); this.rx_ctrl = { rssi: 0 }; } }
esp_now_recv_info_t.meta = { fields: { src_addr: 'any', des_addr: 'any', rx_ctrl: 'any' } };
export class wifi_tx_info_t { constructor() { this.des_addr = new Uint8Array(6); this.src_addr = new Uint8Array(6); } }
wifi_tx_info_t.meta = { fields: { des_addr: 'any', src_addr: 'any' } };
export class wifi_pkt_rx_ctrl_t { constructor() { this.rssi = 0; this.channel = 1; } }
wifi_pkt_rx_ctrl_t.meta = { fields: { rssi: 'int', channel: 'int' } };

function macArg(mac, src, dst, rssi) {
  const a = macBytes(mac);
  a.src_addr = macBytes(src);
  a.des_addr = macBytes(dst);
  a.rx_ctrl = { rssi: rssi || -50, channel: 1 };
  return a;
}

function espNowFrame(R, m) {
  const s = R.espnow;
  if (!s || (m.dst !== R.mac && m.dst !== BCAST_MAC)) return;
  if (m.dst !== BCAST_MAC) airSend(R, { kind: 'espnow-ack', to: m.src, seq: m.seq });
  const data = new Uint8Array(m.data);
  const rssi = -35 - Math.floor(Math.random() * 30);
  R.io.net('espnow', `↓ từ ${m.src}${m.dst === BCAST_MAC ? ' (broadcast)' : ''}: ${preview(data)} (${data.length} byte, RSSI ${rssi} dBm)`);
  if (s.recv) { const cb = s.recv; queueCallback(R, () => cb(macArg(m.src, m.src, m.dst, rssi), data, data.length)); }
}

export function espNowFuncs(R) {
  const st = () => R.espnow;
  const F = {
    esp_now_init() {
      if (R.o.WiFi.$mode === 0) { R.warnOnce('espnow-wifi', 'esp_now_init(): WiFi đang tắt — gọi WiFi.mode(WIFI_STA) trước.'); return ESP_NOW.ERR_WIFI_NOT_INIT; }
      if (!R.espnow) {
        R.espnow = { peers: new Map(), recv: null, sent: null, seq: 0, pending: new Set() };
        if (!R.espnowListening) {
          R.espnowListening = true;
          airListen(R, 'espnow', (m) => espNowFrame(R, m));
          airListen(R, 'espnow-ack', (m) => { if (R.espnow && m.to === R.mac) R.espnow.pending.delete(m.seq); });
          R.cleanups.push(() => { R.espnowListening = false; });
        }
        R.io.net('espnow', `ESP-NOW đã khởi tạo, MAC của board: ${R.mac}`);
      }
      return ESP_NOW.OK;
    },
    esp_now_deinit() { R.espnow = null; return ESP_NOW.OK; },
    esp_now_register_recv_cb(fn) { if (!st()) return ESP_NOW.NOT_INIT; st().recv = fn; return ESP_NOW.OK; },
    esp_now_register_send_cb(fn) { if (!st()) return ESP_NOW.NOT_INIT; st().sent = fn; return ESP_NOW.OK; },
    esp_now_unregister_recv_cb() { if (st()) st().recv = null; return ESP_NOW.OK; },
    esp_now_unregister_send_cb() { if (st()) st().sent = null; return ESP_NOW.OK; },
    esp_now_add_peer(p) {
      const s = st();
      if (!s) return ESP_NOW.NOT_INIT;
      if (!p || !p.peer_addr) return ESP_NOW.ARG;
      const mac = macStr(p.peer_addr);
      if (s.peers.has(mac)) return ESP_NOW.EXIST;
      if (s.peers.size >= 20) return ESP_NOW.FULL;
      s.peers.set(mac, { channel: p.channel | 0, encrypt: !!p.encrypt });
      R.io.net('espnow', `Thêm peer ${mac}${mac === BCAST_MAC ? ' (broadcast)' : ''}`);
      return ESP_NOW.OK;
    },
    esp_now_mod_peer(p) { const s = st(); if (!s) return ESP_NOW.NOT_INIT; const mac = macStr(p.peer_addr); if (!s.peers.has(mac)) return ESP_NOW.NOT_FOUND; s.peers.set(mac, { channel: p.channel | 0, encrypt: !!p.encrypt }); return ESP_NOW.OK; },
    esp_now_del_peer(mac) { const s = st(); if (!s) return ESP_NOW.NOT_INIT; return s.peers.delete(macStr(mac)) ? ESP_NOW.OK : ESP_NOW.NOT_FOUND; },
    esp_now_is_peer_exist(mac) { const s = st(); return !!(s && s.peers.has(macStr(mac))); },
    esp_now_send(mac, data, len) {
      const s = st();
      if (!s) return ESP_NOW.NOT_INIT;
      const bytes = toBytes(R, data, len);
      if (!bytes || len > 250) return ESP_NOW.ARG;
      const dests = mac == null ? [...s.peers.keys()] : [macStr(mac)];
      if (mac != null && !s.peers.has(dests[0])) {
        R.warnOnce('espnow-peer', `esp_now_send(): ${dests[0]} chưa được thêm bằng esp_now_add_peer().`);
        return ESP_NOW.NOT_FOUND;
      }
      for (const dst of dests) {
        const seq = ++s.seq;
        airSend(R, { kind: 'espnow', src: R.mac, dst, seq, data: bytes });
        R.io.net('espnow', `↑ tới ${dst}${dst === BCAST_MAC ? ' (broadcast)' : ''}: ${preview(bytes)} (${bytes.length} byte)`);
        // unicast waits for the receiver's ACK (another simulator with that MAC); broadcast is never acknowledged
        if (dst !== BCAST_MAC) s.pending.add(seq);
        const id = setTimeout(() => {
          if (R.espnow !== s) return;
          const failed = s.pending.delete(seq);
          if (failed) R.io.net('espnow', `✗ ${dst} không phản hồi ACK (không có board nào với MAC này đang chạy ESP-NOW)`, 'err');
          if (s.sent) { const cb = s.sent; queueCallback(R, () => cb(macArg(dst, R.mac, dst), failed ? 1 : 0)); }
        }, dst === BCAST_MAC ? 3 : 40);
        R.cleanups.push(() => clearTimeout(id));
      }
      return ESP_NOW.OK;
    },
    esp_err_to_name(code) { return ERR_NAMES[code] || 'ERROR'; },
    esp_wifi_get_mac(ifx, buf) { if (buf) buf.set(macBytes(R.mac)); return ESP_NOW.OK; },
    esp_read_mac(buf) { if (buf) buf.set(macBytes(R.mac)); return ESP_NOW.OK; },
  };
  return F;
}

// ---------------------------------------------------------------- UDP (WiFiUdp.h)
const isBcastIp = (ip) => ip === '255.255.255.255' || ip === LAN_PREFIX + '255';
const isLan = (ip) => ip.startsWith(LAN_PREFIX) || isBcastIp(ip);

function udpListen(R) {
  if (R.udpListening) return;
  R.udpListening = true;
  R.cleanups.push(() => { R.udpListening = false; });
  airListen(R, 'udp', (m) => {
    if (R.wifi.status !== 3 || (m.dst !== R.wifi.ip && !isBcastIp(m.dst)) || m.src === R.wifi.ip) return;
    const s = R.udpSockets.get(m.dport);
    if (s) s.$push({ data: new Uint8Array(m.data), ip: m.src, port: m.sport });
  });
}

function udpSend(R, sock, ip, port, bytes) {
  if (R.wifi.status !== 3) { R.io.net('udp', `✗ UDP tới ${ip}:${port}: WiFi chưa kết nối`, 'err'); return 0; }
  if (isLan(ip)) {
    if (ip === R.wifi.ip) { const s = R.udpSockets.get(port); if (s) s.$push({ data: bytes, ip, port: sock.port }); }
    else airSend(R, { kind: 'udp', src: R.wifi.ip, sport: sock.port, dst: ip, dport: port, data: bytes });
    return 1;
  }
  if (!R.settings.proxyAvailable || R.settings.proxy === 'off') {
    R.io.net('udp', `✗ UDP tới ${ip}:${port}: trình duyệt không gửi được UDP ra Internet — hãy chạy "node server.js" (proxy UDP). Các board trong mạng ảo ${LAN_PREFIX}x (tab khác) vẫn liên lạc được.`, 'err');
    return 0;
  }
  proxyPost(R, 'udp', { host: ip, port, data: b64(bytes), timeout: 3000 }).then((j) => {
    if (R.stopped) return;
    for (const r of j.replies || []) sock.$push({ data: unb64(r.data), ip: r.address || ip, port: r.port || port });
  }).catch((e) => { if (!R.stopped) R.io.net('udp', `✗ UDP tới ${ip}:${port}: ${e.message}`, 'err'); });
  return 1;
}

export class WiFiUDP extends Print {
  constructor(R) { super(R); this.port = 0; this.rx = []; this.cur = null; this.pos = 0; this.tx = null; this.$quiet = false; }
  begin(a, b) {
    const port = (b === undefined ? a : b) | 0;
    this.stop();
    const R = this.R;
    if (R.udpSockets.has(port)) R.udpSockets.get(port).port = 0;
    this.port = port;
    R.udpSockets.set(port, this);
    udpListen(R);
    return 1;
  }
  beginMulticast(ip, port) { return this.begin(port); }
  stop() { if (this.port && this.R.udpSockets.get(this.port) === this) this.R.udpSockets.delete(this.port); this.port = 0; this.rx = []; }
  beginPacket(ip, port) { this.tx = { ip: ipText(this.R, ip), port: port | 0, data: [] }; return 1; }
  async $out(s) { if (this.tx) for (let i = 0; i < s.length; i++) this.tx.data.push(s.charCodeAt(i) & 255); }
  async endPacket() {
    if (!this.tx) return 0;
    const { ip, port, data } = this.tx;
    this.tx = null;
    return this.$send(ip, port, Uint8Array.from(data));
  }
  $send(ip, port, bytes) {
    if (!this.port) this.begin(49152 + Math.floor(Math.random() * 16000));
    if (!this.$quiet) this.R.io.net('udp', `↑ tới ${ip}:${port}: ${preview(bytes)} (${bytes.length} byte)`);
    return udpSend(this.R, this, ip, port, bytes);
  }
  $push(pkt) {
    if (this.rx.length >= 16) return;
    this.rx.push(pkt);
    if (!this.$quiet) this.R.io.net('udp', `↓ từ ${pkt.ip}:${pkt.port}: ${preview(pkt.data)} (${pkt.data.length} byte)`);
  }
  parsePacket() {
    if (!this.rx.length) { this.cur = null; return 0; }
    this.cur = this.rx.shift();
    this.pos = 0;
    return this.cur.data.length;
  }
  available() { return this.cur ? this.cur.data.length - this.pos : 0; }
  read(buf, len) {
    if (buf === undefined) return this.cur && this.pos < this.cur.data.length ? this.cur.data[this.pos++] : -1;
    let n = 0;
    while (n < len && this.available()) buf[n++] = this.cur.data[this.pos++];
    return n;
  }
  peek() { return this.cur && this.pos < this.cur.data.length ? this.cur.data[this.pos] : -1; }
  readString() { let s = ''; while (this.available()) s += String.fromCharCode(this.read()); return s; }
  flush() {}
  remoteIP() { return this.R.h.make('IPAddress', [this.cur ? this.cur.ip : '0.0.0.0']); }
  remotePort() { return this.cur ? this.cur.port : 0; }
}
WiFiUDP.meta = { ret: { ...Print.meta.ret, begin: 'u8', beginMulticast: 'u8', beginPacket: 'int', endPacket: 'int', parsePacket: 'int', available: 'int', read: 'int', peek: 'int', readString: 'String', remoteIP: 'class:IPAddress', remotePort: 'u16' } };

// ---------------------------------------------------------------- CoAP (hirotakaster/CoAP-simple-library API)
const COAP = { CON: 0, NON: 1, ACK: 2, RST: 3, GET: 1, POST: 2, PUT: 3, DELETE: 4, CONTENT: 69, NOT_FOUND: 132, URI_HOST: 3, URI_PATH: 11, CONTENT_FORMAT: 12, URI_QUERY: 15 };
const TYPE_NAMES = ['CON', 'NON', 'ACK', 'RST'];
const METHODS = ['', 'GET', 'POST', 'PUT', 'DELETE'];
const RESP_NAMES = { 65: 'Created', 66: 'Deleted', 67: 'Valid', 68: 'Changed', 69: 'Content', 128: 'Bad Request', 129: 'Unauthorized', 131: 'Forbidden', 132: 'Not Found', 133: 'Method Not Allowed', 160: 'Internal Server Error', 161: 'Not Implemented' };
const codeText = (c) => (c >= 1 && c <= 4 ? METHODS[c] : `${c >> 5}.${String(c & 31).padStart(2, '0')}${RESP_NAMES[c] ? ' ' + RESP_NAMES[c] : ''}`);
const uintBytes = (v) => { const out = []; for (let x = v >>> 0; x; x >>>= 8) out.unshift(x & 255); return Uint8Array.from(out); };

export function coapEncode(p) {
  const token = p.token || new Uint8Array(0);
  const out = [0x40 | ((p.type & 3) << 4) | (token.length & 15), p.code & 255, (p.messageid >> 8) & 255, p.messageid & 255, ...token];
  let last = 0;
  const nib = (x) => (x < 13 ? x : x < 269 ? 13 : 14);
  for (const o of [...p.options].sort((a, b) => a.number - b.number)) {
    const d = o.number - last;
    last = o.number;
    const v = o.buffer;
    out.push((nib(d) << 4) | nib(v.length));
    for (const x of [d, v.length]) {
      if (x >= 269) out.push(((x - 269) >> 8) & 255, (x - 269) & 255);
      else if (x >= 13) out.push(x - 13);
    }
    out.push(...v);
  }
  if (p.payload && p.payload.length) out.push(0xff, ...p.payload);
  return Uint8Array.from(out);
}
export function coapDecode(b) {
  if (b.length < 4 || b[0] >> 6 !== 1) return null;
  const tkl = b[0] & 15;
  if (tkl > 8) return null;
  const p = { type: (b[0] >> 4) & 3, code: b[1], messageid: (b[2] << 8) | b[3], token: b.slice(4, 4 + tkl), options: [], payload: new Uint8Array(0) };
  let i = 4 + tkl, num = 0;
  while (i < b.length) {
    if (b[i] === 0xff) { p.payload = b.slice(i + 1); break; }
    let d = b[i] >> 4, L = b[i] & 15;
    i++;
    if (d === 15 || L === 15) return null;
    const ext = (x) => { if (x === 13) return 13 + b[i++]; if (x === 14) { const v = 269 + ((b[i] << 8) | b[i + 1]); i += 2; return v; } return x; };
    d = ext(d);
    L = ext(L);
    num += d;
    p.options.push({ number: num, length: L, buffer: b.slice(i, i + L) });
    i += L;
  }
  return p;
}
const optText = (o) => new TextDecoder().decode(o.buffer);
const uriOf = (p) => p.options.filter((o) => o.number === COAP.URI_PATH).map(optText).join('/');

export class CoapPacket {
  constructor(R) {
    this.R = R;
    this.type = 0; this.code = 0; this.messageid = 0;
    this.token = new Uint8Array(0); this.tokenlen = 0;
    this.payload = new Uint8Array(0); this.payloadlen = 0;
    this.options = []; this.optionnum = 0;
  }
  $from(d) {
    Object.assign(this, { type: d.type, code: d.code, messageid: d.messageid, token: d.token, tokenlen: d.token.length, payload: d.payload, payloadlen: d.payload.length, options: d.options, optionnum: d.options.length });
    return this;
  }
  addOption(number, length, buf) {
    const b = toBytes(this.R, buf, length) || new Uint8Array(0);
    this.options.push({ number, length: b.length, buffer: b });
    this.optionnum = this.options.length;
  }
  setUriHost(host) { const s = this.R.h.str(host); this.addOption(COAP.URI_HOST, s.length, s); }
  setUriPath(url) { for (const seg of this.R.h.str(url).split('/')) if (seg) this.addOption(COAP.URI_PATH, seg.length, seg); }
}
CoapPacket.meta = { fields: { type: 'u8', code: 'u8', messageid: 'u16', token: 'any', tokenlen: 'u8', payload: 'any', payloadlen: 'u32', options: 'any', optionnum: 'u8' } };

export class Coap {
  constructor(R, udp) {
    this.R = R;
    this.udp = udp instanceof WiFiUDP ? udp : new WiFiUDP(R);
    this.udp.$quiet = true;
    this.res = new Map();
    this.resp = null;
    this.mid = Math.floor(Math.random() * 0xffff);
    this.req = null;
  }
  start(port) { this.udp.begin(port === undefined ? 5683 : port); return true; }
  server(cb, url) { this.res.set(binToUtf8(this.R.h.str(url)), cb); }
  response(cb) { this.resp = cb; }
  get(ip, port, url) { return this.send(ip, port, url, COAP.CON, COAP.GET, null, 0, null, 0); }
  put(ip, port, url, payload, len) { const s = payload == null ? '' : this.R.h.str(payload); return this.send(ip, port, url, COAP.CON, COAP.PUT, null, 0, s, len === undefined ? s.length : len); }
  post(ip, port, url, payload, len) { const s = payload == null ? '' : this.R.h.str(payload); return this.send(ip, port, url, COAP.CON, COAP.POST, null, 0, s, len === undefined ? s.length : len); }
  send(ip, port, url, type, method, token, tokenlen, payload, payloadlen, contentType, query) {
    const R = this.R;
    const host = ipText(R, ip);
    const path = binToUtf8(R.h.str(url));
    const p = new CoapPacket(R);
    p.type = type; p.code = method;
    p.token = toBytes(R, token, tokenlen) || new Uint8Array(0);
    p.payload = toBytes(R, payload, payloadlen) || new Uint8Array(0);
    this.mid = (this.mid + 1) & 0xffff;
    p.messageid = this.mid;
    p.setUriHost(utf8ToBin(host));
    p.setUriPath(utf8ToBin(path));
    if (contentType != null && contentType >= 0) p.addOption(COAP.CONTENT_FORMAT, 0, uintBytes(contentType));
    if (query != null) { const q = R.h.str(query); p.addOption(COAP.URI_QUERY, q.length, q); }
    R.io.net('coap', `→ ${TYPE_NAMES[type & 3]} ${codeText(method)} coap://${host}:${port}/${path}${p.payload.length ? '  payload: ' + preview(p.payload) : ''} (mid ${p.messageid})`);
    this.udp.$send(host, port, coapEncode(p));
    return p.messageid;
  }
  sendResponse(ip, port, messageid, payload, payloadlen, code, contentType, token, tokenlen) {
    const R = this.R;
    const host = ipText(R, ip);
    const p = new CoapPacket(R);
    p.type = COAP.ACK;
    p.code = code === undefined ? COAP.CONTENT : code;
    p.messageid = messageid;
    p.payload = toBytes(R, payload == null ? '' : R.h.str(payload), payloadlen) || new Uint8Array(0);
    // answering the request being handled: echo its token (the library sends none, which strict clients reject)
    p.token = token != null ? toBytes(R, token, tokenlen) : this.req && this.req.messageid === messageid ? this.req.token : new Uint8Array(0);
    const ct = contentType === undefined ? 0 : contentType;
    if (ct >= 0) p.addOption(COAP.CONTENT_FORMAT, 0, uintBytes(ct));
    R.io.net('coap', `← trả lời ${codeText(p.code)} tới ${host}:${port}${p.payload.length ? '  payload: ' + preview(p.payload) : ''} (mid ${messageid})`);
    this.udp.$send(host, port, coapEncode(p));
    return messageid;
  }
  async loop() {
    const R = this.R;
    const u = this.udp;
    while (u.parsePacket() > 0) {
      const { data, ip, port } = u.cur;
      u.cur = null;
      const d = coapDecode(data);
      if (!d) { R.io.net('coap', `(bỏ qua gói UDP không phải CoAP từ ${ip}:${port})`); continue; }
      const pk = new CoapPacket(R).$from(d);
      const ipObj = R.h.make('IPAddress', [ip]);
      if (d.code >= 1 && d.code < 32) {
        const uri = uriOf(d);
        R.io.net('coap', `↓ ${TYPE_NAMES[d.type]} ${codeText(d.code)} /${uri} từ ${ip}:${port}${d.payload.length ? '  payload: ' + preview(d.payload) : ''}`);
        this.req = d;
        try {
          if (uri === '.well-known/core') {
            const links = [...this.res.keys()].map((r) => `</${r}>`).join(',');
            this.sendResponse(ipObj, port, d.messageid, links, links.length, COAP.CONTENT, 40, d.token, d.token.length);
          } else if (this.res.has(uri)) await this.res.get(uri)(pk, ipObj, port);
          else this.sendResponse(ipObj, port, d.messageid, null, 0, COAP.NOT_FOUND, -1, d.token, d.token.length);
        } finally { this.req = null; }
      } else {
        if (d.type === COAP.CON) this.udp.$send(ip, port, coapEncode({ type: COAP.ACK, code: 0, messageid: d.messageid, options: [] }));
        if (d.code === 0) continue; // empty ACK / RST
        R.io.net('coap', `↓ ${codeText(d.code)} từ ${ip}:${port}${d.payload.length ? '  payload: ' + preview(d.payload) : ''} (mid ${d.messageid})`);
        if (this.resp) await this.resp(pk, ipObj, port);
      }
    }
    return true;
  }
}
Coap.meta = { ret: { start: 'bool', get: 'u16', put: 'u16', post: 'u16', send: 'u16', sendResponse: 'u16', loop: 'bool' } };

// ---------------------------------------------------------------- HTTP on the virtual WiFi network
// Requests to 10.13.37.x travel over the air as { kind: 'http-req', id, dst, port, method, path, query, headers, body }
// and are answered by { kind: 'http-resp', id, status, headers, body } (bodies are binary strings). They come from
// HTTPClient in another runtime, or from a browser tab via sw.js (http://<simulator>/__dev/10.13.37.x/…).
export const isLanHost = (host) => host.startsWith(LAN_PREFIX);
function httpListen(R) {
  if (R.httpListening) return;
  R.httpListening = true;
  R.cleanups.push(() => { R.httpListening = false; });
  airListen(R, 'http-req', (m) => httpDispatch(R, m));
  airListen(R, 'http-resp', (m) => { const p = R.httpPending && R.httpPending.get(m.id); if (p) p(m); });
}
function httpDispatch(R, m) {
  if (R.wifi.status !== 3 || m.dst !== R.wifi.ip) return;
  const srv = R.webServers && R.webServers.get(m.port);
  if (srv) srv.$queue(m);
}
// HTTPClient → a board on the virtual network: { status, body, headers }, rejects on timeout
export function lanHttp(R, { host, port, method, path, query, headers, body }, timeout) {
  httpListen(R);
  const id = `${R.mac}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!R.httpPending) R.httpPending = new Map();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { R.httpPending.delete(id); reject(new Error(`không có board nào ở ${host}:${port} trả lời (WebServer chưa chạy?)`)); }, timeout);
    R.httpPending.set(id, (m) => { clearTimeout(timer); R.httpPending.delete(id); resolve({ status: m.status, body: m.body || '', headers: m.headers || {} }); });
    const msg = { kind: 'http-req', id, src: R.wifi.ip, dst: host, port, method, path, query, headers, body: body || '' };
    if (host === R.wifi.ip) httpDispatch(R, msg);
    else airSend(R, msg);
  });
}
function httpReply(R, req, res) {
  const m = { kind: 'http-resp', id: req.id, ...res };
  if (req.src === R.wifi.ip && R.httpPending && R.httpPending.has(req.id)) R.httpPending.get(req.id)(m);
  else airSend(R, m);
}

const HTTP_METHODS = { DELETE: 0, GET: 1, HEAD: 2, POST: 3, PUT: 4, OPTIONS: 6, PATCH: 28 };
export const HTTP_ANY = 255;
const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error', 503: 'Service Unavailable' };
// application/x-www-form-urlencoded → [[name, value]] (binary strings)
function parseForm(s) {
  const out = [];
  for (const part of s.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const dec = (x) => { try { return utf8ToBin(decodeURIComponent(x.replace(/\+/g, ' '))); } catch { return x; } };
    out.push([dec(i < 0 ? part : part.slice(0, i)), dec(i < 0 ? '' : part.slice(i + 1))]);
  }
  return out;
}

// WebServer.h (arduino-esp32): handlers run inside handleClient(), one request per call
export class WebServer {
  constructor(R, port) {
    this.R = R;
    this.port = port === undefined ? 80 : port | 0;
    this.routes = [];
    this.notFound = null;
    this.q = [];
    this.req = null;
    this.res = null;
    this.on_ = false;
    this.collect = [];
  }
  on(uri, a, b) {
    const fn = b === undefined ? a : b;
    this.routes.push({ uri: binToUtf8(this.R.h.str(uri)), method: b === undefined ? HTTP_ANY : a, fn });
  }
  onNotFound(fn) { this.notFound = fn; }
  collectHeaders() {}
  enableCORS(on) { this.cors = on !== false; }
  enableDelay() {}
  begin(port) {
    const R = this.R;
    if (port !== undefined) this.port = port | 0;
    if (!R.webServers) R.webServers = new Map();
    R.webServers.set(this.port, this);
    httpListen(R);
    this.on_ = true;
    const announce = () => {
      const base = typeof location !== 'undefined' ? new URL('__dev/', location.href).href : '/__dev/';
      R.io.net('http', `WebServer chạy ở http://${R.wifi.ip}${this.port === 80 ? '' : ':' + this.port}/ — mở ${base}${R.wifi.ip}${this.port === 80 ? '' : ':' + this.port}/ trong tab mới để truy cập`);
    };
    if (R.wifi.status === 3) announce();
    else {
      R.io.net('http', `WebServer (cổng ${this.port}) chờ WiFi kết nối...`);
      const id = setInterval(() => { if (R.wifi.status === 3) { clearInterval(id); announce(); } }, 200);
      R.cleanups.push(() => clearInterval(id));
    }
  }
  close() { this.on_ = false; if (this.R.webServers) this.R.webServers.delete(this.port); }
  stop() { this.close(); }
  $queue(m) {
    if (!this.on_) return;
    if (this.q.length >= 8) { httpReply(this.R, m, { status: 503, headers: { 'content-type': 'text/plain' }, body: 'busy' }); return; }
    this.q.push(m);
  }
  async handleClient() {
    const R = this.R;
    const m = this.q.shift();
    if (!m) return;
    const method = HTTP_METHODS[m.method] ?? 1;
    const ctype = (m.headers && (m.headers['content-type'] || '')) || '';
    const args = parseForm(m.query || '');
    // form posts become arguments; any other body is the argument "plain" (server.arg("plain"))
    if (m.body) args.push(...(/x-www-form-urlencoded/i.test(ctype) ? parseForm(m.body) : [['plain', m.body]]));
    this.req = { ...m, methodCode: method, args, path: binToUtf8(m.path || '/') };
    this.res = null;
    this.outHeaders = {};
    this.collect = null;
    R.io.net('http', `↓ ${m.method} ${this.req.path}${m.query ? '?' + m.query : ''} từ ${m.src || 'trình duyệt'}${m.body ? '  body: ' + binToUtf8(m.body).slice(0, 200) : ''}`);
    const route = this.routes.find((r) => r.uri === this.req.path && (r.method === HTTP_ANY || r.method === method));
    try {
      if (route) await route.fn();
      else if (this.notFound) await this.notFound();
      else this.send(404, 'text/plain', 'Not found: ' + this.req.path);
    } finally {
      if (this.collect) this.$finish(this.collect.code, this.collect.type, this.collect.body);
      if (!this.res) this.$finish(500, 'text/plain', 'handler không gọi server.send()');
      httpReply(R, m, this.res);
      R.io.net('http', `↑ ${this.res.status} ${STATUS_TEXT[this.res.status] || ''} (${this.res.body.length} byte)`);
      this.req = null;
    }
  }
  $finish(code, type, body) {
    if (this.res) return;
    const headers = { ...this.outHeaders };
    if (type) headers['content-type'] = type;
    if (this.cors) headers['access-control-allow-origin'] = '*';
    this.res = { status: code, headers, body };
  }
  send(code, type, content) {
    if (!this.req) return;
    const body = content === undefined ? '' : content instanceof Uint8Array ? bytesToBin(content) : this.R.h.str(content);
    if (this.collect) { this.collect = { code, type: type === undefined ? 'text/html' : this.R.h.str(type), body }; return; }
    this.$finish(code, type === undefined ? null : this.R.h.str(type), body);
  }
  send_P(code, type, content, len) { this.send(code, type, len === undefined ? content : this.R.h.str(content).slice(0, len)); }
  // chunked responses: setContentLength(CONTENT_LENGTH_UNKNOWN); send(200, type, ""); sendContent(…)…
  setContentLength(n) { if (n === -1 && this.req) this.collect = { code: 200, type: 'text/html', body: '' }; }
  sendContent(s) { if (this.collect) this.collect.body += this.R.h.str(s); }
  sendContent_P(s) { this.sendContent(s); }
  sendHeader(name, value) { this.outHeaders[binToUtf8(this.R.h.str(name)).toLowerCase()] = binToUtf8(this.R.h.str(value)); }
  redirect(url) { this.sendHeader('Location', url); this.send(302, 'text/plain', ''); }
  $args() { return this.req ? this.req.args : []; }
  arg(k) {
    const a = this.$args();
    if (typeof k === 'number') return a[k] ? a[k][1] : '';
    const key = this.R.h.str(k);
    const f = a.find(([n]) => n === key);
    return f ? f[1] : '';
  }
  argName(i) { const a = this.$args()[i]; return a ? a[0] : ''; }
  args() { return this.$args().length; }
  hasArg(k) { const key = this.R.h.str(k); return this.$args().some(([n]) => n === key); }
  header(name) { const h = this.req && this.req.headers; return h ? utf8ToBin(h[binToUtf8(this.R.h.str(name)).toLowerCase()] || '') : ''; }
  hasHeader(name) { const h = this.req && this.req.headers; return !!(h && h[binToUtf8(this.R.h.str(name)).toLowerCase()] != null); }
  headers() { return this.req && this.req.headers ? Object.keys(this.req.headers).length : 0; }
  uri() { return this.req ? utf8ToBin(this.req.path) : ''; }
  method() { return this.req ? this.req.methodCode : 1; }
  hostHeader() { return this.header('host'); }
  authenticate(user, pass) {
    const a = binToUtf8(this.header('authorization'));
    return a === 'Basic ' + btoa(this.R.h.str(user) + ':' + this.R.h.str(pass));
  }
  requestAuthentication() { this.sendHeader('WWW-Authenticate', 'Basic realm="Login Required"'); this.send(401, 'text/plain', 'Unauthorized'); }
}
WebServer.meta = { ret: { arg: 'String', argName: 'String', args: 'int', hasArg: 'bool', header: 'String', hasHeader: 'bool', headers: 'int', uri: 'String', method: 'int', hostHeader: 'String', authenticate: 'bool' } };

export const RADIO_LIBS = {
  SPIClass, SPISettings, LoRaClass, esp_now_peer_info_t, esp_now_recv_info_t, wifi_tx_info_t, esp_now_send_info_t: wifi_tx_info_t, wifi_pkt_rx_ctrl_t,
  WiFiUDP, Coap, CoapPacket, WebServer,
};
