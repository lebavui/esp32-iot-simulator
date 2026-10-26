// Runtime for compiled sketches: helper functions ($), Arduino core API (F), global objects (O),
// cooperative scheduler (delay/yield/tasks/interrupts).
import { fmtFloat, fmtInt, cFormat, strftime, bytesToBin, binToBytes } from './format.js';
import { LIBS, JsonDocument, JsonSlot, DeserializationError, TmStruct, jsonSafe } from './libs.js';
import { boardInfo } from '../boards.js';
import { espNowFuncs, makeMac, radioReset } from './radio.js';

export class StopSignal { constructor() { this.stop = true; } }
export class TaskExit { constructor() { this.taskExit = true; } }
export class Panic extends Error {}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Yield to the event loop. MessageChannel is fast, but a sketch looping without delay() would then keep other
// sources waiting (messages of other simulators on the BroadcastChannel are starved in Node), so at least every
// 25 ms the yield goes through a timer instead.
let macrotask;
if (typeof MessageChannel !== 'undefined') {
  const ch = new MessageChannel();
  const q = [];
  let lastTimer = 0;
  ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
  macrotask = () => new Promise((r) => {
    if (now() - lastTimer > 25) { lastTimer = now(); setTimeout(r, 0); return; }
    q.push(r);
    ch.port2.postMessage(0);
  });
} else macrotask = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPlainJson(v) {
  return Array.isArray(v) || (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype);
}

export class Runtime {
  constructor({ sim, io, settings }) {
    this.sim = sim;
    this.io = io;
    this.settings = settings || {};
    this.running = false;
    this.h = this.makeHelpers();
    this.f = this.makeFuncs();
    this.o = {};
    this.warned = new Set();
    this.mac = makeMac();
  }

  // ---------- lifecycle ----------
  reset() {
    // board in the diagram (DevKit when the sim doesn't say, e.g. tests/harness.mjs fakeSim)
    this.board = boardInfo(this.sim.boardType ? this.sim.boardType() : null);
    this.chip = this.board.chip;
    this.t0 = now();
    this.lastYield = now();
    this.stopped = false;
    this.isrQueue = [];
    this.interrupts = new Map();
    this.interruptsEnabled = true;
    this.inIsr = false;
    this.serialIn = [];
    this.cleanups = [];
    this.tasks = 0;
    this.ledc = { channels: new Map(), pins: new Map() };
    this.adcBits = 12;
    this.pwmBits = 8;
    this.wifi = { status: 0, ssid: '', ip: '' };
    this.time = { offset: 0, synced: false, syncAt: 0 };
    radioReset(this);
    this.warned = new Set();
    this.stopPromise = new Promise((_, rej) => { this.stopReject = rej; });
    this.stopPromise.catch(() => {});
    this.o = {
      Serial: new LIBS.HardwareSerial(this, 0), Serial0: null, Serial1: new LIBS.HardwareSerial(this, 1), Serial2: new LIBS.HardwareSerial(this, 2),
      WiFi: new LIBS.WiFiClass(this), Wire: new LIBS.TwoWire(this), ESP: new LIBS.EspClass(this),
      SPI: new LIBS.SPIClass(this), LoRa: new LIBS.LoRaClass(this),
    };
    this.o.Serial0 = this.o.Serial;
  }

  async start(code) {
    this.reset();
    this.running = true;
    this.sim.onLevelChange = (pin, level, prev) => this.pinChanged(pin, level, prev);
    this.sim.start();
    let prog;
    try {
      // eslint-disable-next-line no-new-func
      prog = new Function('R', code)(this);
    } catch (e) {
      this.io.log('error', 'Lỗi nạp chương trình: ' + e.message);
      this.running = false;
      return;
    }
    this.bootBanner();
    try {
      await prog.init();
      await prog.setup();
      for (;;) {
        await prog.loop();
        await this.h.y(true);
      }
    } catch (e) {
      this.handleError(e);
    }
    // the loop task ended (vTaskDelete) – keep the simulation alive while other tasks run
  }

  handleError(e) {
    if (e instanceof StopSignal || (e && e.stop)) return;
    if (e instanceof TaskExit || (e && e.taskExit)) return;
    const line = this.h.L;
    let msg = e && e.message ? e.message : String(e);
    if (e instanceof RangeError && /call stack/i.test(msg)) msg = 'Stack overflow (đệ quy quá sâu)';
    if (e instanceof Panic) {
      this.io.serialWrite(0, `\r\nGuru Meditation Error: Core  1 panic'ed (${msg}). Exception was unhandled.\r\n`);
      this.io.log('error', `Panic tại dòng ${line}: ${msg}`, line);
    } else {
      this.io.log('error', `Lỗi runtime tại dòng ${line}: ${msg}`, line);
      if (!(e instanceof Panic) && this.settings.debug) console.error(e);
    }
    this.stop(true);
  }

  stop(fromError) {
    if (this.stopped) return;
    this.stopped = true;
    this.running = false;
    this.stopReject(new StopSignal());
    for (const fn of this.cleanups) { try { fn(); } catch { /* ignore */ } }
    this.cleanups = [];
    this.sim.stop();
    if (this.io.onStopped) this.io.onStopped(fromError);
  }

  bootBanner() { this.io.serialWrite(0, this.chip.banner, true); }

  warnOnce(key, msg) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.io.log('warn', msg, this.h.L);
  }

  millis() { return Math.floor(now() - this.t0); }

  // Wait for a promise but abort when the simulation stops
  wait(p) { return Promise.race([p, this.stopPromise]); }

  checkStop() { if (this.stopped) throw new StopSignal(); }

  async delay(ms) {
    ms = Number(ms) || 0;
    const end = now() + ms;
    for (;;) {
      this.checkStop();
      if (this.isrQueue.length) await this.runIsrs();
      const rem = end - now();
      if (rem <= 0) break;
      await sleep(Math.min(rem, 20));
    }
    this.checkStop();
    this.h.c = 0;
    this.lastYield = now();
  }

  // ---------- interrupts / tasks ----------
  pinChanged(pin, level, prev) {
    const it = this.interrupts.get(pin);
    if (!it || level === prev) return;
    const fire = it.mode === 3 || (it.mode === 1 && level === 1) || (it.mode === 2 && level === 0) ||
      (it.mode === 4 && level === 0) || (it.mode === 5 && level === 1);
    if (fire && this.isrQueue.length < 64) this.isrQueue.push(it);
  }

  async runIsrs() {
    if (this.inIsr || !this.interruptsEnabled) return;
    this.inIsr = true;
    try {
      while (this.isrQueue.length) {
        const it = this.isrQueue.shift();
        await (it.arg !== undefined ? it.fn(it.arg) : it.fn());
      }
    } finally { this.inIsr = false; }
  }

  startTask(fn, param, name) {
    this.tasks++;
    (async () => {
      await macrotask();
      try {
        await fn(param);
        this.io.log('warn', `Task "${name}" đã return — trên ESP32 thật điều này gây crash (cần vTaskDelete).`);
      } catch (e) {
        if (!(e instanceof TaskExit)) this.handleError(e);
      }
    })();
    return 1;
  }

  // ---------- helpers used by generated code ----------
  makeHelpers() {
    const R = this;
    const $ = {
      L: 0, c: 0,
      async y(force) {
        $.c = 0;
        if (R.stopped) throw new StopSignal();
        if (R.isrQueue.length) await R.runIsrs();
        const t = now();
        if (t - R.lastYield > 12 || (force && t - R.lastYield > 12)) {
          await macrotask();
          R.lastYield = now();
          if (R.stopped) throw new StopSignal();
        }
      },
      num(v) {
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return +v;
        if (typeof v === 'string') { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; }
        if (v == null || v instanceof JsonSlot) return 0;
        if (typeof v === 'object' && typeof v.valueOf === 'function' && typeof v.valueOf() === 'number') return v.valueOf();
        return 0;
      },
      str(v) {
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (v == null || v instanceof JsonSlot) return 'null';
        if (v instanceof Uint8Array) { const z = v.indexOf(0); return bytesToBin(z < 0 ? v : v.subarray(0, z)); }
        if (ArrayBuffer.isView(v)) return '0x3ffb2000';
        if (v instanceof JsonDocument) return JSON.stringify(jsonSafe(v.root));
        if (isPlainJson(v)) return JSON.stringify(jsonSafe(v));
        if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) return v.toString();
        return '[object]';
      },
      ff: fmtFloat,
      fi: (x, base, lower) => fmtInt(x, base, lower),
      ch: (c) => (typeof c === 'string' ? c.slice(0, 1) : String.fromCharCode(Number(c) & 255)),
      idiv(a, b) {
        if (b === 0 || b === false) throw new Panic('IntegerDivideByZero');
        return Math.trunc(a / b);
      },
      imod(a, b) {
        if (b === 0 || b === false) throw new Panic('IntegerDivideByZero');
        return a % b;
      },
      padd(s, n) {
        if (s instanceof Uint8Array) return s.subarray(Math.max(0, n));
        s = $.str(s);
        return n >= s.length ? '' : s.slice(Math.max(0, n));
      },
      ci(s, i) {
        if (s == null) throw new Panic('LoadProhibited');
        if (typeof s === 'string') return i < s.length ? s.charCodeAt(i) : 0;
        return s[i] || 0;
      },
      setChar(s, i, v) {
        if (s == null) throw new Panic('StoreProhibited');
        if (typeof s === 'string') return i < s.length ? s.slice(0, i) + String.fromCharCode(v & 255) + s.slice(i + 1) : s;
        s[i] = v;
        return s;
      },
      t(v) {
        if (v == null || v instanceof JsonSlot) return false;
        if (typeof v === 'object' && typeof v.__bool === 'function') return !!v.__bool();
        if (typeof v === 'string' || typeof v === 'object') return true;
        return !!v;
      },
      jv(v) { return v instanceof JsonSlot ? null : v; },
      jor(l, r) {
        l = $.jv(l);
        if (l == null) return r;
        if (typeof r === 'number') return typeof l === 'number' ? l : typeof l === 'boolean' ? +l : r;
        if (typeof r === 'string') return typeof l === 'string' ? l : r;
        if (typeof r === 'boolean') return typeof l === 'boolean' ? l : r;
        return l;
      },
      idx(o, k) {
        if (o instanceof JsonDocument) return o.get(k);
        if (o instanceof JsonSlot) return new JsonSlot(o, k);
        if (isPlainJson(o)) {
          if (typeof k === 'string' && Array.isArray(o)) return new JsonSlot(o, k);
          const v = o[k];
          return v === undefined ? new JsonSlot(o, k) : v;
        }
        if (typeof o === 'string') return $.ci(o, k);
        if (o == null) throw new Panic('LoadProhibited');
        if (typeof o.$idx === 'function') return o.$idx(k);
        return o[k];
      },
      setIdx(o, k, v) {
        v = jsonSafe(v);
        if (o instanceof JsonDocument) return o.$set(k, v);
        if (o instanceof JsonSlot) { const c = o.materialize(typeof k === 'number' ? 'array' : 'object'); c[k] = v; return v; }
        if (o == null) throw new Panic('StoreProhibited');
        if (Array.isArray(o) && typeof k === 'number') { while (o.length < k) o.push(null); }
        o[k] = v;
        return v;
      },
      prop(o, p) {
        if (o == null) throw new Panic('LoadProhibited');
        const v = o[p];
        if (v === undefined) throw new Error(`không có thành viên '${p}'`);
        return v;
      },
      sm(s, m, a) { return R.stringMethod(s, m, a); },
      async call(o, m, a, t) { return R.dynCall(o, m, a, t); },
      make(name, args) {
        const C = LIBS[name];
        if (!C) throw new Error(`lớp '${name}' chưa được hỗ trợ`);
        return new C(R, ...args);
      },
      lib(name) { return LIBS[name]; },
      arr(kind, dims, init) { return R.makeArray(kind, dims, init); },
      carr(n, s) {
        const len = n == null ? s.length + 1 : n;
        if (s.length + 1 > len && n != null && s.length > len) throw new Error('initializer-string for char array is too long');
        const a = new Uint8Array(len);
        for (let i = 0; i < Math.min(s.length, len); i++) a[i] = s.charCodeAt(i);
        return a;
      },
      clone(a) {
        if (ArrayBuffer.isView(a)) return a.slice();
        if (Array.isArray(a)) return a.map((x) => (x && typeof x === 'object' ? (x.$c ? x.$c() : $.clone(x)) : x));
        return a;
      },
      // struct ↔ bytes (little-endian, no padding — as sizeof() counts): S_x.$L = [[field, kind | struct class], …]
      pack(o) {
        const out = [];
        const dv = new DataView(new ArrayBuffer(8));
        const put = (kind, v) => {
          if (typeof kind === 'function') { walk(v); return; }
          if (Array.isArray(v) || ArrayBuffer.isView(v)) { for (const x of v) put(kind, x); return; }
          if (kind === 'str') { R.warnOnce('packstr', 'String trong struct không gửi/sao chép được dạng byte (trên ESP32 chỉ là con trỏ) — hãy dùng mảng char.'); out.push(...new Array(16).fill(0)); return; }
          const n = Number(v) || 0;
          const size = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8, i64: 8, u64: 8 }[kind] || 4;
          if (kind === 'f32') dv.setFloat32(0, n, true);
          else if (kind === 'f64') dv.setFloat64(0, n, true);
          else if (size === 8) dv.setBigInt64(0, BigInt(Math.trunc(n)), true);
          else if (size === 4) dv.setInt32(0, n | 0, true);
          else if (size === 2) dv.setInt16(0, n | 0, true);
          else dv.setInt8(0, (n | 0) << 24 >> 24);
          for (let i = 0; i < size; i++) out.push(dv.getUint8(i));
        };
        const walk = (s) => { for (const [f, kind] of s.constructor.$L) put(kind, s[f]); };
        walk(o);
        return Uint8Array.from(out);
      },
      unpack(o, bytes, n) {
        const end = Math.min(bytes.length, n === undefined ? bytes.length : n);
        let pos = 0;
        const dv = new DataView(new ArrayBuffer(8));
        const get = (kind) => {
          const size = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8, i64: 8, u64: 8, str: 16 }[kind] || 4;
          if (pos + size > end) { pos = end; return undefined; }
          for (let i = 0; i < size; i++) dv.setUint8(i, bytes[pos++]);
          switch (kind) {
            case 'str': return undefined;
            case 'f32': return dv.getFloat32(0, true);
            case 'f64': return dv.getFloat64(0, true);
            case 'i64': case 'u64': return Number(dv.getBigInt64(0, true));
            case 'u32': return dv.getUint32(0, true);
            case 'i32': return dv.getInt32(0, true);
            case 'u16': return dv.getUint16(0, true);
            case 'i16': return dv.getInt16(0, true);
            case 'i8': return dv.getInt8(0);
            default: return dv.getUint8(0);
          }
        };
        const fill = (kind, v, set) => {
          if (typeof kind === 'function') { if (Array.isArray(v)) v.forEach((x) => walk(x)); else walk(v); return; }
          if (Array.isArray(v) || ArrayBuffer.isView(v)) {
            for (let i = 0; i < v.length; i++) {
              if (Array.isArray(v[i]) || ArrayBuffer.isView(v[i])) fill(kind, v[i]);
              else { const x = get(kind); if (x !== undefined) v[i] = x; }
            }
            return;
          }
          const x = get(kind);
          if (x !== undefined) set(typeof v === 'boolean' ? !!x : x);
        };
        const walk = (s) => { for (const [f, kind] of s.constructor.$L) fill(kind, s[f], (x) => { s[f] = x; }); };
        walk(o);
        return o;
      },
      iter(v) {
        if (v == null || v instanceof JsonSlot) return [];
        if (v instanceof JsonDocument) return $.iter(v.root);
        if (Array.isArray(v) || ArrayBuffer.isView(v)) return v;
        if (typeof v === 'string') return Array.from(v, (c) => c.charCodeAt(0));
        if (isPlainJson(v)) return Object.keys(v).map((key) => ({ key: () => key, value: () => v[key] }));
        if (typeof v[Symbol.iterator] === 'function') return v;
        throw new Error('đối tượng không thể duyệt (range-for)');
      },
      sizeofArr(a, es) {
        if (ArrayBuffer.isView(a)) return a.byteLength;
        if (Array.isArray(a)) return a.reduce((s, x) => s + (Array.isArray(x) || ArrayBuffer.isView(x) ? $.sizeofArr(x, es) : es), 0);
        return 4;
      },
      view(a, i) { return ArrayBuffer.isView(a) ? a.subarray(i) : a.slice(i); },
      deref(p) {
        if (p == null) throw new Panic('LoadProhibited');
        if (typeof p === 'string') return p.length ? p.charCodeAt(0) : 0;
        if (ArrayBuffer.isView(p) || Array.isArray(p)) return p[0];
        if (typeof p === 'object' && 'v' in p) return p.v;
        return p;
      },
      setDeref(p, v) {
        if (p == null) throw new Panic('StoreProhibited');
        if (ArrayBuffer.isView(p) || Array.isArray(p)) { p[0] = v; return v; }
        if (typeof p === 'object' && 'v' in p) { p.v = v; return v; }
        throw new Error('không thể ghi qua con trỏ này');
      },
      serJ(doc, pretty) {
        const root = doc instanceof JsonDocument ? doc.root : jsonSafe(doc);
        return pretty ? JSON.stringify(jsonSafe(root), null, 2).replace(/\n/g, '\r\n') : JSON.stringify(jsonSafe(root));
      },
      bit64(op, a, b) {
        const A = BigInt(Math.trunc(a)), B = BigInt(Math.trunc(b));
        return Number(op === '&' ? A & B : op === '|' ? A | B : A ^ B);
      },
      // format a runtime value for Print::print(value[, base])
      pfmt(v, base) {
        if (typeof v === 'number') {
          if (base !== undefined && Number.isInteger(v)) return fmtInt(v, base);
          if (base !== undefined) return fmtFloat(v, base);
          return String(v);
        }
        if (typeof v === 'boolean') return v ? '1' : '0';
        if (v instanceof TmStruct) return strftime(base !== undefined ? $.str(base) : '%c', v);
        return $.str(v);
      },
    };
    return $;
  }

  makeArray(kind, dims, init) {
    const n0 = dims[0] == null ? (init ? init.length : 0) : dims[0];
    if (dims.length > 1) {
      const out = new Array(n0);
      for (let i = 0; i < n0; i++) out[i] = this.makeArray(kind, dims.slice(1), init ? init[i] : null);
      return out;
    }
    if (n0 < 0 || n0 > 1e6) throw new Error('kích thước mảng không hợp lệ: ' + n0);
    let a;
    switch (kind) {
      case 'i8': a = new Int8Array(n0); break;
      case 'u8': a = new Uint8Array(n0); break;
      case 'i16': a = new Int16Array(n0); break;
      case 'u16': a = new Uint16Array(n0); break;
      case 'i32': a = new Int32Array(n0); break;
      case 'u32': a = new Uint32Array(n0); break;
      case 'f32': a = new Float32Array(n0); break;
      case 'f64': a = new Float64Array(n0); break;
      case 'str': a = new Array(n0).fill(''); break;
      case 'any': a = new Array(n0).fill(null); break;
      default:
        if (typeof kind === 'function') { a = new Array(n0); for (let i = 0; i < n0; i++) a[i] = kind(); }
        else a = new Array(n0).fill(null);
    }
    if (init) {
      if (init.length > n0) throw new Error('too many initializers for array');
      for (let i = 0; i < init.length; i++) {
        const v = init[i];
        if (typeof kind === 'function' && Array.isArray(v) && a[i] && a[i].constructor.$from) a[i] = a[i].constructor.$from(v);
        else a[i] = v;
      }
    }
    return a;
  }

  stringMethod(s, m, a) {
    const $ = this.h;
    if (s == null) throw new Panic('LoadProhibited');
    if (typeof s !== 'string') s = $.str(s);
    const S = (x) => (typeof x === 'number' ? String.fromCharCode(x & 255) : $.str(x));
    switch (m) {
      case 'length': return s.length;
      case 'charAt': return a[0] < s.length ? s.charCodeAt(a[0]) : 0;
      case 'substring': {
        let from = Math.max(0, a[0] | 0);
        let to = a.length > 1 ? Math.max(0, a[1] | 0) : s.length;
        if (from > to) [from, to] = [to, from];
        return from >= s.length ? '' : s.substring(from, to);
      }
      case 'indexOf': return s.indexOf(S(a[0]), a[1] || 0);
      case 'lastIndexOf': return a.length > 1 ? s.lastIndexOf(S(a[0]), a[1]) : s.lastIndexOf(S(a[0]));
      case 'startsWith': return s.startsWith(S(a[0]), a[1] || 0);
      case 'endsWith': return s.endsWith(S(a[0]));
      case 'equals': return s === S(a[0]);
      case 'equalsIgnoreCase': return s.toLowerCase() === S(a[0]).toLowerCase();
      case 'compareTo': { const o = S(a[0]); return s < o ? -1 : s > o ? 1 : 0; }
      case 'toInt': { const v = parseInt(s.trim(), 10); return Number.isNaN(v) ? 0 : v | 0; }
      case 'toFloat': case 'toDouble': { const v = parseFloat(s.trim()); return Number.isNaN(v) ? 0 : v; }
      case 'c_str': case 'begin': return s;
      case 'isEmpty': return s.length === 0;
      case 'trim': return s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');
      case 'toUpperCase': return s.replace(/[a-z]+/g, (x) => x.toUpperCase());
      case 'toLowerCase': return s.replace(/[A-Z]+/g, (x) => x.toLowerCase());
      case 'replace': { const f = S(a[0]); return f ? s.split(f).join(S(a[1])) : s; }
      case 'remove': return a.length > 1 ? s.slice(0, a[0]) + s.slice(a[0] + a[1]) : s.slice(0, a[0]);
      case 'concat': return s + S(a[0]);
      case 'setCharAt': return $.setChar(s, a[0], a[1]);
      case 'reserve': return true;
      case 'getBytes': case 'toCharArray': {
        const buf = a[0];
        const n = Math.min(a[1] === undefined ? buf.length : a[1], buf.length);
        if (!n) return undefined;
        let i = 0;
        for (; i < Math.min(s.length, n - 1); i++) buf[i] = s.charCodeAt(i);
        buf[i] = 0;
        return undefined;
      }
      default: throw new Error(`String::${m}() chưa được hỗ trợ`);
    }
  }

  async dynCall(o, m, a, t) {
    const $ = this.h;
    if (typeof o === 'string' && m !== 'as' && m !== 'is' && m !== 'isNull' && m !== 'to') return this.stringMethod(o, m, a);
    if (o != null && typeof o === 'object' && !isPlainJson(o) && !(o instanceof JsonSlot)) {
      if (t && typeof o[m + '$T'] === 'function') return o[m + '$T'](t, ...a);
      if (typeof o[m] === 'function') return o[m](...a);
      throw new Error(`đối tượng không có phương thức '${m}()'`);
    }
    if (o != null && typeof o === 'object' && typeof o[m] === 'function' && !Array.isArray(o)) return o[m](...a);
    return JsonDocument.valueMethod(o, m, a, t, $);
  }

  // ---------- Arduino core functions ----------
  checkPin(pin, what) {
    if (!this.chip.gpios.includes(pin)) {
      if (this.chip.flash.includes(pin)) this.warnOnce('flash' + pin, `GPIO${pin} được nối với flash SPI — không dùng được trên ${this.chip.name}.`);
      else this.warnOnce('pin' + pin, `GPIO${pin} không tồn tại trên ${this.board.label} (${what}).`);
      return false;
    }
    return true;
  }

  makeFuncs() {
    const R = this;
    const $ = () => R.h;
    const str = (v) => R.h.str(v);
    const writeBuf = (buf, s, max) => {
      if (!(buf instanceof Uint8Array)) throw new Error('đích phải là mảng char');
      const n = Math.min(s.length, (max === undefined ? buf.length : max) - 1, buf.length - 1);
      for (let i = 0; i < n; i++) buf[i] = s.charCodeAt(i);
      if (n >= 0) buf[Math.max(0, n)] = 0;
      return buf;
    };
    const ledcApply = (pin, duty, res, freq) => {
      const max = (1 << res) - 1;
      R.sim.setPwm(pin, Math.max(0, Math.min(1, duty / (max || 1))), freq);
    };
    const tm = () => {
      const d = new Date(Date.now() + R.time.offset * 1000);
      return d;
    };
    // ESP32 GPIOs take at most VDD + 0.3 V (3.6 V): a 5 V sensor output needs a divider / level shifter
    const overVolt = (pin, v) => {
      if (v != null && v > 3.6) R.warnOnce('ov' + pin, `GPIO${pin} đang nhận ${v.toFixed(2)} V — vượt mức tối đa 3.6 V của ${R.chip.name}, trên board thật chân này có thể hỏng. Dùng cầu phân áp (vd. 10 kΩ nối tiếp + 20 kΩ xuống GND) hoặc mạch chuyển mức.`);
    };
    const F = {
      pinMode(pin, mode) {
        if (!R.checkPin(pin, 'pinMode')) return;
        if ((mode & 0x02) && R.chip.inputOnly.includes(pin)) R.warnOnce('in' + pin, `GPIO${pin} chỉ là chân INPUT — không thể cấu hình OUTPUT.`);
        if ((mode === 0x05 || mode === 0x09) && R.chip.inputOnly.includes(pin)) R.warnOnce('pu' + pin, `GPIO${pin} không có điện trở kéo lên/xuống nội.`);
        R.sim.pinMode(pin, mode);
      },
      digitalWrite(pin, val) {
        if (!R.checkPin(pin, 'digitalWrite')) return;
        const g = R.sim.gpio(pin);
        if (!(g.mode & 0x02) && !g.pwm) R.warnOnce('dw' + pin, `digitalWrite(${pin}) nhưng chân chưa được pinMode(${pin}, OUTPUT).`);
        R.sim.digitalWrite(pin, val ? 1 : 0);
      },
      digitalRead(pin) {
        if (!R.checkPin(pin, 'digitalRead')) return 0;
        if (!(R.sim.gpio(pin).mode & 2)) overVolt(pin, R.sim.readVoltage(pin));
        return R.sim.digitalRead(pin);
      },
      analogRead(pin) {
        const { adc1, adc2, adc2Note, name } = R.chip;
        const adc1Range = `${adc1[0]}–${adc1[adc1.length - 1]}`;
        if (!adc1.includes(pin) && !adc2.includes(pin)) { R.warnOnce('adc' + pin, `GPIO${pin} không phải chân ADC của ${name} (ADC1: GPIO${adc1Range}).`); return 0; }
        if (adc2.includes(pin) && adc2Note === 'unusable') { R.warnOnce('adc2' + pin, `GPIO${pin} thuộc ADC2 — ${name} không đọc được ADC2 (lỗi phần cứng), analogRead trả về 0. Dùng chân ADC1 (GPIO${adc1Range}).`); return 0; }
        if (adc2.includes(pin) && R.wifi.status === 3) {
          R.warnOnce('adc2' + pin, adc2Note === 'wifi' ? `GPIO${pin} thuộc ADC2 — trên ${name} thật không đọc được khi WiFi đang bật. Nên dùng chân ADC1 (GPIO${adc1Range}).`
            : `GPIO${pin} thuộc ADC2 — trên ${name} thật đọc ADC2 có thể thất bại khi WiFi đang bật. Nên dùng chân ADC1 (GPIO${adc1Range}).`);
        }
        const v = R.sim.readVoltage(pin);
        overVolt(pin, v);
        const max = (1 << R.adcBits) - 1;
        if (v == null) return Math.round(Math.random() * 40);
        return Math.max(0, Math.min(max, Math.round((v / 3.3) * max)));
      },
      analogReadMilliVolts(pin) { const v = R.sim.readVoltage(pin); overVolt(pin, v); return v == null ? 0 : Math.round(Math.min(3.3, v) * 1000); },
      analogReadResolution(bits) { R.adcBits = Math.max(9, Math.min(12, bits)); },
      analogSetWidth(bits) { R.adcBits = Math.max(9, Math.min(12, bits)); },
      analogSetAttenuation() {}, analogSetPinAttenuation() {}, analogWriteFrequency() {},
      analogWriteResolution(bits) { R.pwmBits = bits; },
      analogWrite(pin, val) {
        if (!R.checkPin(pin, 'analogWrite')) return;
        if (R.chip.inputOnly.includes(pin)) { R.warnOnce('aw' + pin, `GPIO${pin} không xuất PWM được.`); return; }
        ledcApply(pin, val, R.pwmBits, 1000);
      },
      ledcSetup(ch, freq, res) { R.ledc.channels.set(ch, { freq, res, pins: new Set(), duty: 0 }); return freq; },
      ledcAttachPin(pin, ch) {
        const c = R.ledc.channels.get(ch);
        if (!c) { R.warnOnce('ledc' + ch, `ledcAttachPin: kênh ${ch} chưa ledcSetup().`); return; }
        c.pins.add(pin);
        ledcApply(pin, c.duty, c.res, c.freq);
      },
      ledcDetachPin(pin) { for (const c of R.ledc.channels.values()) c.pins.delete(pin); R.sim.setPwm(pin, null); },
      ledcAttach(pin, freq, res) { R.ledc.pins.set(pin, { freq, res, duty: 0 }); ledcApply(pin, 0, res, freq); return true; },
      ledcAttachChannel(pin, freq, res, ch) { return F.ledcAttach(pin, freq, res, ch); },
      ledcDetach(pin) { R.ledc.pins.delete(pin); R.sim.setPwm(pin, null); return true; },
      ledcWrite(x, duty) {
        if (R.ledc.pins.has(x)) { const p = R.ledc.pins.get(x); p.duty = duty; ledcApply(x, duty, p.res, p.freq); return; }
        const c = R.ledc.channels.get(x);
        if (c) { c.duty = duty; for (const pin of c.pins) ledcApply(pin, duty, c.res, c.freq); return; }
        R.warnOnce('lw' + x, `ledcWrite(${x}): chân/kênh chưa được cấu hình (ledcAttach hoặc ledcSetup + ledcAttachPin).`);
      },
      ledcRead(x) { const p = R.ledc.pins.get(x) || R.ledc.channels.get(x); return p ? p.duty : 0; },
      ledcReadFreq(x) { const p = R.ledc.pins.get(x) || R.ledc.channels.get(x); return p ? p.freq : 0; },
      ledcChangeFrequency(x, freq, res) { const p = R.ledc.pins.get(x); if (p) { p.freq = freq; p.res = res; } return freq; },
      ledcWriteTone(x, freq) {
        const pins = R.ledc.pins.has(x) ? [x] : R.ledc.channels.has(x) ? [...R.ledc.channels.get(x).pins] : [];
        for (const pin of pins) R.sim.setTone(pin, freq > 0 ? freq : null);
        return freq;
      },
      ledcWriteNote(x, note, octave) {
        const n = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11][note] || 0;
        const f = 440 * Math.pow(2, (n - 9) / 12 + (octave - 4));
        return F.ledcWriteTone(x, f);
      },
      tone(pin, freq, duration) {
        R.sim.setTone(pin, freq > 0 ? freq : null);
        if (duration) {
          const id = setTimeout(() => R.sim.setTone(pin, null), duration);
          R.cleanups.push(() => clearTimeout(id));
        }
      },
      noTone(pin) { R.sim.setTone(pin, null); },
      delay: (ms) => R.delay(ms),
      async delayMicroseconds(us) { if (us >= 2000) await R.delay(us / 1000); },
      async yield() { await R.h.y(true); },
      millis: () => R.millis() >>> 0,
      micros: () => Math.floor((now() - R.t0) * 1000) >>> 0,
      random(a, b) {
        if (b === undefined) { b = a; a = 0; }
        a = Math.trunc(a); b = Math.trunc(b);
        if (b <= a) return a;
        return a + Math.floor(Math.random() * (b - a));
      },
      randomSeed() {},
      esp_random: () => (Math.random() * 4294967296) >>> 0,
      map(x, a, b, c, d) {
        [x, a, b, c, d] = [x, a, b, c, d].map(Math.trunc);
        if (b === a) return -1;
        return Math.trunc(((x - a) * (d - c)) / (b - a)) + c;
      },
      constrain: (x, a, b) => (x < a ? a : x > b ? b : x),
      min: (a, b) => (a < b ? a : b),
      max: (a, b) => (a > b ? a : b),
      abs: (x) => (x < 0 ? -x : x),
      sqrt: Math.sqrt, pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
      atan: Math.atan, atan2: Math.atan2, exp: Math.exp, log: Math.log, log10: Math.log10, floor: Math.floor,
      ceil: Math.ceil, round: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)), fabs: Math.abs, fmod: (a, b) => a % b,
      fmin: Math.min, fmax: Math.max, trunc: Math.trunc, hypot: Math.hypot, cbrt: Math.cbrt,
      sqrtf: Math.sqrt, powf: Math.pow, floorf: Math.floor, ceilf: Math.ceil, roundf: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)),
      fabsf: Math.abs, lround: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)),
      isnan: (x) => Number.isNaN(Number(x)), isinf: (x) => Math.abs(Number(x)) === Infinity, isfinite: (x) => Number.isFinite(Number(x)),
      async pulseIn(pin, state, timeout) {
        const tmo = timeout === undefined ? 1000000 : Number(timeout);
        const us = R.sim.pulseIn(pin, state ? 1 : 0);
        if (us > 0 && us <= tmo) {
          if (us > 2000) await R.delay(us / 1000);
          return Math.round(us);
        }
        await R.delay(Math.min(tmo / 1000, 1000));
        return 0;
      },
      pulseInLong(pin, state, timeout) { return F.pulseIn(pin, state, timeout); },
      shiftOut(dataPin, clockPin, order, val) {
        for (let i = 0; i < 8; i++) {
          const bit = order === 0 ? (val >> i) & 1 : (val >> (7 - i)) & 1;
          R.sim.digitalWrite(dataPin, bit);
          R.sim.digitalWrite(clockPin, 1);
          R.sim.digitalWrite(clockPin, 0);
        }
      },
      shiftIn(dataPin, clockPin, order) {
        let v = 0;
        for (let i = 0; i < 8; i++) {
          R.sim.digitalWrite(clockPin, 1);
          const b = R.sim.digitalRead(dataPin);
          v |= order === 0 ? b << i : b << (7 - i);
          R.sim.digitalWrite(clockPin, 0);
        }
        return v;
      },
      attachInterrupt(pin, fn, mode) {
        if (!R.checkPin(pin, 'attachInterrupt')) return;
        R.interrupts.set(pin, { fn, mode });
      },
      attachInterruptArg(pin, fn, arg, mode) { R.interrupts.set(pin, { fn, mode, arg }); },
      detachInterrupt(pin) { R.interrupts.delete(pin); },
      digitalPinToInterrupt: (p) => p,
      interrupts() { R.interruptsEnabled = true; },
      noInterrupts() { R.interruptsEnabled = false; },
      isDigit: (c) => c >= 48 && c <= 57,
      isAlpha: (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
      isAlphaNumeric: (c) => F.isDigit(c) || F.isAlpha(c),
      isSpace: (c) => c === 32 || (c >= 9 && c <= 13),
      isWhitespace: (c) => c === 32 || c === 9,
      isUpperCase: (c) => c >= 65 && c <= 90,
      isLowerCase: (c) => c >= 97 && c <= 122,
      isPunct: (c) => c > 32 && c < 127 && !F.isAlphaNumeric(c),
      isHexadecimalDigit: (c) => F.isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
      isPrintable: (c) => c >= 32 && c < 127,
      isGraph: (c) => c > 32 && c < 127,
      isControl: (c) => c < 32 || c === 127,
      isAscii: (c) => c < 128,
      isdigit: (c) => +F.isDigit(c), isalpha: (c) => +F.isAlpha(c), isspace: (c) => +F.isSpace(c),
      toupper: (c) => (c >= 97 && c <= 122 ? c - 32 : c),
      tolower: (c) => (c >= 65 && c <= 90 ? c + 32 : c),
      sprintf(buf, fmt, ...args) { const s = cFormat(fmt, args, str); writeBuf(buf, s, buf.length); return s.length; },
      snprintf(buf, size, fmt, ...args) { const s = cFormat(fmt, args, str); if (size > 0) writeBuf(buf, s, size); return s.length; },
      strcpy(dst, src) { return writeBuf(dst, str(src)); },
      strncpy(dst, src, n) { const s = str(src).slice(0, n); for (let i = 0; i < n && i < dst.length; i++) dst[i] = i < s.length ? s.charCodeAt(i) : 0; return dst; },
      strcat(dst, src) { return writeBuf(dst, str(dst) + str(src)); },
      strncat(dst, src, n) { return writeBuf(dst, str(dst) + str(src).slice(0, n)); },
      strlen: (s) => str(s).length,
      strcmp(a, b) { a = str(a); b = str(b); return a < b ? -1 : a > b ? 1 : 0; },
      strncmp(a, b, n) { return F.strcmp(str(a).slice(0, n), str(b).slice(0, n)); },
      strcasecmp(a, b) { return F.strcmp(str(a).toLowerCase(), str(b).toLowerCase()); },
      strstr(h, n) { h = str(h); const i = h.indexOf(str(n)); return i < 0 ? null : h.slice(i); },
      strchr(h, c) { h = str(h); const i = h.indexOf(String.fromCharCode(c)); return i < 0 ? null : h.slice(i); },
      atoi(s) { const v = parseInt(str(s).trim(), 10); return Number.isNaN(v) ? 0 : v | 0; },
      atol(s) { return F.atoi(s); },
      atof(s) { const v = parseFloat(str(s).trim()); return Number.isNaN(v) ? 0 : v; },
      strtol(s, end, base) { const v = parseInt(str(s).trim(), base || 10); return Number.isNaN(v) ? 0 : v; },
      strtoul(s, end, base) { return F.strtol(s, end, base) >>> 0; },
      strtof(s) { return F.atof(s); },
      strtod(s) { return F.atof(s); },
      itoa(v, buf, base) { return writeBuf(buf, fmtInt(v, base || 10, true).replace(/^(\d+)$/, (x) => (base === 10 || !base ? String(Math.trunc(v)) : x))); },
      ltoa(v, buf, base) { return F.itoa(v, buf, base); },
      utoa(v, buf, base) { return writeBuf(buf, (v >>> 0).toString(base || 10)); },
      ultoa(v, buf, base) { return F.utoa(v, buf, base); },
      dtostrf(v, width, prec, buf) {
        let s = Number.isNaN(v) ? 'nan' : Number(v).toFixed(prec);
        const w = Math.abs(width);
        if (s.length < w) s = width < 0 ? s.padEnd(w) : s.padStart(w);
        return writeBuf(buf, s);
      },
      memset(buf, v, n) { if (ArrayBuffer.isView(buf)) buf.fill(v, 0, n === undefined ? buf.length : Math.min(n, buf.length)); return buf; },
      memcpy(dst, src, n) {
        // structs are copied as their packed bytes (struct ↔ uint8_t buffer, e.g. ESP-NOW payloads)
        if (src && src.constructor && src.constructor.$L) src = R.h.pack(src);
        if (dst && dst.constructor && dst.constructor.$L) { R.h.unpack(dst, typeof src === 'string' ? binToBytes(src) : src, n); return dst; }
        const s = typeof src === 'string' ? binToBytes(src) : src;
        for (let i = 0; i < n && i < dst.length && i < s.length; i++) dst[i] = s[i];
        return dst;
      },
      memcmp(a, b, n) { for (let i = 0; i < n; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; },
      F: (s) => s, PSTR: (s) => s,
      temperatureRead: () => 48.9,
      hallRead() { if (!R.chip.hall) R.warnOnce('hall', `${R.chip.name} không có cảm biến Hall — hallRead() không dùng được.`); return 0; },
      touchRead() { if (!R.chip.touch) R.warnOnce('touch', `${R.chip.name} không có chân cảm ứng (touch) — touchRead() không dùng được.`); return 72; },
      xTaskCreate(fn, name, stack, param, prio, handle) {
        if (handle && typeof handle === 'object' && 'v' in handle) handle.v = { task: str(name) };
        return R.startTask(fn, param, str(name));
      },
      xTaskCreatePinnedToCore(fn, name, stack, param, prio, handle) { return F.xTaskCreate(fn, name, stack, param, prio, handle); },
      vTaskDelay: (ticks) => R.delay(ticks === 0xffffffff ? 1e9 : ticks),
      async vTaskDelete(h) { if (h == null) { R.checkStop(); throw new TaskExit(); } },
      vTaskSuspend() {}, vTaskResume() {},
      pdMS_TO_TICKS: (ms) => ms,
      xPortGetCoreID: () => (R.chip.cores > 1 ? 1 : 0),
      uxTaskGetStackHighWaterMark: () => 1024,
      xTaskGetTickCount: () => R.millis() >>> 0,
      async taskYIELD() { await R.h.y(true); },
      async serializeJson(doc, out, size) {
        const s = R.h.serJ(doc, false);
        if (out instanceof Uint8Array) { writeBuf(out, s, size); return s.length; }
        if (out && typeof out.print === 'function') { await out.print(s); return s.length; }
        throw new Error('serializeJson: đích không hợp lệ');
      },
      async serializeJsonPretty(doc, out, size) {
        const s = R.h.serJ(doc, true);
        if (out instanceof Uint8Array) { writeBuf(out, s, size); return s.length; }
        if (out && typeof out.print === 'function') { await out.print(s); return s.length; }
        throw new Error('serializeJsonPretty: đích không hợp lệ');
      },
      measureJson(doc) { return R.h.serJ(doc, false).length; },
      deserializeJson(doc, input, len) {
        let s = input instanceof Uint8Array ? bytesToBin(len !== undefined ? input.subarray(0, len) : input) : str(input);
        if (len !== undefined && typeof input === 'string') s = s.slice(0, len);
        return doc.$parse(s);
      },
      configTime(gmt, dst) {
        R.time.offset = (Number(gmt) || 0) + (Number(dst) || 0);
        R.time.syncAt = R.millis() + 800;
        R.io.net('ntp', `configTime: GMT${R.time.offset >= 0 ? '+' : ''}${R.time.offset / 3600}h — đồng bộ NTP...`);
      },
      configTzTime(tz) {
        const m = /^[A-Za-z<>+\-0-9]*?([+-]?\d+)(?::(\d+))?/.exec(str(tz).replace(/^[A-Za-z]+/, ''));
        const h = m ? -Number(m[1]) : 0;
        F.configTime(h * 3600, 0);
      },
      async getLocalTime(t, timeout) {
        const tmo = timeout === undefined ? 5000 : timeout;
        if (!R.time.syncAt) { await R.delay(Math.min(tmo, 10)); return false; }
        if (R.wifi.status !== 3) { await R.delay(Math.min(tmo, 1000)); return false; }
        if (R.millis() < R.time.syncAt) {
          const wait = R.time.syncAt - R.millis();
          if (wait > tmo) { await R.delay(tmo); return false; }
          await R.delay(wait);
        }
        if (!R.time.synced) { R.time.synced = true; R.io.net('ntp', 'Đã đồng bộ thời gian NTP'); }
        t.setFromDate(tm());
        return true;
      },
      time(p) {
        const v = R.time.synced ? Math.floor(Date.now() / 1000) : Math.floor(R.millis() / 1000);
        if (p && typeof p === 'object' && 'v' in p) p.v = v;
        return v;
      },
      strftime(buf, max, fmt, t) { const s = strftime(str(fmt), t); writeBuf(buf, s, max); return Math.min(s.length, max - 1); },
      async esp_restart() { R.io.restart(); throw new StopSignal(); },
      esp_get_free_heap_size: () => 245000,
      esp_timer_get_time: () => Math.floor((now() - R.t0) * 1000),
      rgbLedWrite() {}, neopixelWrite() {},
      ...espNowFuncs(R),
    };
    void $;
    return F;
  }

  // Serial output from libraries
  serialOut(port, s) { this.io.serialWrite(port, s); }
}

export { DeserializationError };
