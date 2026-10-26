// Circuit model + DC solver.
// Wires and closed switches merge pins into nets (union-find). Strong drivers (power pins, GPIO outputs,
// sensor outputs) fix net voltages; resistors / pull-ups / potentiometers form a linear network that is
// solved exactly (nodal analysis). Nets with no path to a driver are floating (null).
import { PARTS, partPins } from './parts.js';
import { BOARDS, isBoard } from '../boards.js';

const PULL_R = 45000;

export class Circuit {
  constructor() {
    this.parts = [];
    this.wires = [];
    this.running = false;
    this.gpios = new Map();
    this.dirty = true;
    this.netOf = new Map();
    this.netV = [];
    this.levels = new Map();
    this.onLevelChange = null;
    this.onShort = null;
    this.shorts = [];
  }

  setDiagram(parts, wires) {
    this.parts = parts;
    this.wires = wires;
    this.invalidate();
  }

  // the microcontroller board (one per diagram) and its header pin → GPIO map
  board() { return this.parts.find((p) => isBoard(p.type)); }
  boardType() { const b = this.board(); return b ? b.type : null; }
  boardGpio() { const b = this.board(); return b ? BOARDS[b.type].gpio : {}; }
  boardPinOfGpio(gpio) {
    for (const [name, g] of Object.entries(this.boardGpio())) if (g === gpio) return name;
    return null;
  }

  // ---------------- runtime interface ----------------
  start() {
    this.running = true;
    this.gpios = new Map();
    this.levels = new Map();
    for (const p of this.parts) { p.state = null; p.angle = null; }
    this.invalidate();
    this.ensure();
  }
  stop() {
    this.running = false;
    for (const g of this.gpios.values()) g.tone = null;
    this.invalidate();
  }
  gpio(pin) {
    let g = this.gpios.get(pin);
    if (!g) { g = { mode: 0, out: 0, pwm: null, freq: 0, servo: null, tone: null, lastRise: 0 }; this.gpios.set(pin, g); }
    return g;
  }
  pinMode(pin, mode) {
    const g = this.gpio(pin);
    g.mode = mode;
    if (!(mode & 2)) { g.pwm = null; }
    this.invalidate();
  }
  digitalWrite(pin, v) {
    const g = this.gpio(pin);
    if (g.pwm != null) g.pwm = null;
    if (v && !g.out) g.lastRise = performance.now();
    if (g.out !== v) { g.out = v; this.invalidate(); }
  }
  setPwm(pin, duty, freq) {
    const g = this.gpio(pin);
    g.pwm = duty;
    g.freq = freq || 0;
    if (duty != null) g.mode |= 2;
    this.invalidate();
  }
  setTone(pin, freq) {
    const g = this.gpio(pin);
    g.tone = freq;
    if (freq) g.mode |= 2;
    this.invalidate();
  }
  setServo(pin, angle) {
    const g = this.gpio(pin);
    g.servo = angle;
    if (angle != null) g.mode |= 2;
    this.invalidate();
  }
  readVoltage(pin) {
    this.ensure();
    const name = this.boardPinOfGpio(pin);
    const b = this.board();
    if (!name || !b) return null;
    return this.V(b, name);
  }
  digitalRead(pin) {
    const g = this.gpio(pin);
    if (g.mode & 2) return g.out ? 1 : 0;
    const v = this.readVoltage(pin);
    if (v == null) return 0;
    return v > 1.65 ? 1 : 0;
  }
  pulseIn(pin, state) {
    this.ensure();
    const b = this.board();
    const name = this.boardPinOfGpio(pin);
    if (!b || !name || state !== 1) return 0;
    const net = this.net(b, name);
    for (const p of this.parts) {
      if (p.type !== 'esp32-iot-hc-sr04' || this.net(p, 'ECHO') !== net || !this.isPowered(p)) continue;
      const trigNet = this.net(p, 'TRIG');
      let triggered = false;
      for (const [gp, g] of this.gpios) {
        const bn = this.boardPinOfGpio(gp);
        if (bn && this.net(b, bn) === trigNet && performance.now() - g.lastRise < 200) triggered = true;
      }
      if (!triggered) return 0;
      return Math.max(2, Math.min(400, Number(p.attrs.distance) || 0)) * 58.3;
    }
    return 0;
  }
  findOnPin(types, pinName, gpio) {
    this.ensure();
    const b = this.board();
    const name = this.boardPinOfGpio(gpio);
    if (!b || !name) return null;
    const net = this.net(b, name);
    return this.parts.find((p) => types.includes(p.type) && this.net(p, pinName) === net && net != null && this.isPowered(p)) || null;
  }
  findI2C(kind, addr) {
    this.ensure();
    const b = this.board();
    if (!b) return null;
    const c = BOARDS[b.type].consts;
    const i2c = this.i2cPins || (c ? { sda: c.SDA, scl: c.SCL } : { sda: 21, scl: 22 });
    const sdaNet = this.net(b, this.boardPinOfGpio(i2c.sda));
    const sclNet = this.net(b, this.boardPinOfGpio(i2c.scl));
    return this.parts.find((p) => {
      const d = PARTS[p.type];
      if (!d.i2c || (kind && d.i2c !== kind)) return false;
      if (parseInt(p.attrs.address, 16) !== addr) return false;
      return sdaNet != null && sclNet != null && this.net(p, 'SDA') === sdaNet && this.net(p, 'SCL') === sclNet && this.isPowered(p);
    }) || null;
  }
  isPowered(part, pins) {
    const [vcc, gnd] = pins || PARTS[part.type].power || ['VCC', 'GND'];
    const v = this.V(part, vcc), g = this.V(part, gnd);
    return v != null && g != null && v - g >= 2.5;
  }

  // ---------------- solver ----------------
  invalidate() { this.dirty = true; }
  key(part, pin) { return part.id + ':' + pin; }
  net(part, pin) { this.ensure(); const n = this.netOf.get(this.key(part, pin)); return n === undefined ? null : n; }
  V(part, pin) { const n = this.net(part, pin); return n == null ? null : this.netV[n]; }

  ensure() {
    if (!this.dirty) return;
    this.dirty = false;
    // parts whose links depend on solved voltages (relay contacts) settle over a few passes
    for (let pass = 0; pass < 4; pass++) {
      this.solve();
      if (!this.settle()) break;
    }
    this.afterSolve();
  }

  settle() {
    let changed = false;
    for (const p of this.parts) {
      const d = PARTS[p.type];
      if (d.settle && d.settle(p, { V: (pin) => this.V(p, pin), powered: (pins) => this.isPowered(p, pins) })) changed = true;
    }
    return changed;
  }

  solve() {
    // 1. index pins
    const idx = new Map();
    const pinList = [];
    const partById = new Map();
    for (const p of this.parts) {
      partById.set(p.id, p);
      for (const pin of partPins(p)) {
        const k = this.key(p, pin.name);
        idx.set(k, pinList.length);
        pinList.push(k);
      }
    }
    const parent = pinList.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (const w of this.wires) {
      const a = idx.get(w.from), b = idx.get(w.to);
      if (a !== undefined && b !== undefined) union(a, b);
    }
    const resistors = [];
    for (const p of this.parts) {
      const d = PARTS[p.type];
      if (!d.links) continue;
      for (const [x, y, r] of d.links(p)) {
        const a = idx.get(this.key(p, x)), b = idx.get(this.key(p, y));
        if (a === undefined || b === undefined) continue;
        if (r === 0) union(a, b); else resistors.push([a, b, r]);
      }
    }
    // 2. nets
    const rootToNet = new Map();
    const netOf = new Map();
    pinList.forEach((k, i) => {
      const r = find(i);
      if (!rootToNet.has(r)) rootToNet.set(r, rootToNet.size);
      netOf.set(k, rootToNet.get(r));
    });
    const N = rootToNet.size;
    this.netOf = netOf;
    const fixed = new Array(N).fill(null);
    const fixedSrc = new Array(N).fill(null);
    const shorts = [];
    const drive = (net, v, src) => {
      if (net == null) return;
      if (fixed[net] != null && Math.abs(fixed[net] - v) > 0.2) {
        shorts.push({ net, a: fixedSrc[net], b: src });
        fixed[net] = Math.min(fixed[net], v);
        return;
      }
      fixed[net] = v;
      fixedSrc[net] = src;
    };
    const pulls = []; // [net, voltage, R]
    const b = this.board();
    // 3. strong drivers: board power + GPIO
    if (b && this.running) {
      for (const d of PARTS[b.type].drive(b, { running: true })) drive(netOf.get(this.key(b, d.pin)), d.v, `${b.id}:${d.pin}`);
      for (const [gp, g] of this.gpios) {
        const name = this.boardPinOfGpio(gp);
        if (!name) continue;
        const net = netOf.get(this.key(b, name));
        if (g.mode & 2) {
          let v = g.out ? 3.3 : 0;
          if (g.pwm != null) v = 3.3 * g.pwm;
          if (g.tone) v = 1.65;
          if (g.servo != null) v = 3.3 * ((544 + (g.servo / 180) * 1856) / 20000);
          drive(net, v, `GPIO${gp}`);
        } else if (g.mode === 0x05) pulls.push([net, 3.3, PULL_R]);
        else if (g.mode === 0x09) pulls.push([net, 0, PULL_R]);
      }
    }
    // 4. part drivers (sensors) – may depend on power nets
    const tmpV = (p, pin) => { const n = netOf.get(this.key(p, pin)); return n == null ? null : fixed[n]; };
    const api = {
      running: this.running,
      V: null,
      powered: (part, pins) => {
        const [vcc, gnd] = pins || PARTS[part.type].power || ['VCC', 'GND'];
        const v = tmpV(part, vcc), g = tmpV(part, gnd);
        return v != null && g != null && v - g >= 2.5;
      },
    };
    for (const p of this.parts) {
      const d = PARTS[p.type];
      if (!d.drive || p === b) continue;
      api.V = (pin) => tmpV(p, pin);
      for (const dr of d.drive(p, api)) drive(netOf.get(this.key(p, dr.pin)), dr.v, `${p.id}:${dr.pin}`);
    }
    // 5. resistive network
    const V = fixed.slice();
    const unknown = [];
    const uIndex = new Map();
    const adj = new Map();
    const addAdj = (n, e) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(e); };
    for (const [a, bb, r] of resistors) {
      const na = netOf.get(pinList[a]), nb = netOf.get(pinList[bb]);
      if (na === nb) continue;
      addAdj(na, { to: nb, g: 1 / r });
      addAdj(nb, { to: na, g: 1 / r });
    }
    for (const [net, v, r] of pulls) addAdj(net, { fixedV: v, g: 1 / r });
    // nets reachable from a fixed node through resistors
    const reach = new Set();
    const stack = [];
    for (let n = 0; n < N; n++) {
      if (fixed[n] != null) { reach.add(n); stack.push(n); }
      else if ((adj.get(n) || []).some((e) => e.fixedV !== undefined)) { reach.add(n); stack.push(n); }
    }
    while (stack.length) {
      const n = stack.pop();
      for (const e of adj.get(n) || []) if (e.to !== undefined && !reach.has(e.to)) { reach.add(e.to); stack.push(e.to); }
    }
    for (let n = 0; n < N; n++) if (fixed[n] == null && reach.has(n)) { uIndex.set(n, unknown.length); unknown.push(n); }
    const M = unknown.length;
    if (M) {
      const A = Array.from({ length: M }, () => new Float64Array(M + 1));
      unknown.forEach((n, i) => {
        for (const e of adj.get(n) || []) {
          A[i][i] += e.g;
          if (e.fixedV !== undefined) A[i][M] += e.g * e.fixedV;
          else if (fixed[e.to] != null) A[i][M] += e.g * fixed[e.to];
          else A[i][uIndex.get(e.to)] -= e.g;
        }
      });
      // Gaussian elimination with partial pivoting
      for (let c = 0; c < M; c++) {
        let piv = c;
        for (let r = c + 1; r < M; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        [A[c], A[piv]] = [A[piv], A[c]];
        const d = A[c][c];
        if (Math.abs(d) < 1e-15) continue;
        for (let r = 0; r < M; r++) {
          if (r === c) continue;
          const f = A[r][c] / d;
          if (f) for (let k = c; k <= M; k++) A[r][k] -= f * A[c][k];
        }
      }
      unknown.forEach((n, i) => { V[n] = Math.abs(A[i][i]) < 1e-15 ? null : A[i][M] / A[i][i]; });
    }
    this.netV = V;
    this.shorts = shorts;
  }

  // shorts + GPIO level changes (interrupts) of the settled solution
  afterSolve() {
    const shorts = this.shorts;
    const b = this.board();
    const V = this.netV;
    if (shorts.length && this.running) {
      const sig = shorts.map((s) => s.a + '/' + s.b).join(',');
      if (sig !== this.lastShort && this.onShort) this.onShort(shorts);
      this.lastShort = sig;
    } else this.lastShort = '';
    if (b && this.running) {
      for (const [name, gp] of Object.entries(BOARDS[b.type].gpio)) {
        const n = this.netOf.get(this.key(b, name));
        const g = this.gpios.get(gp);
        let lvl;
        if (g && g.mode & 2) lvl = g.out ? 1 : 0;
        else lvl = n != null && V[n] != null && V[n] > 1.65 ? 1 : 0;
        const prev = this.levels.get(gp);
        this.levels.set(gp, lvl);
        if (prev !== undefined && prev !== lvl && this.onLevelChange) this.onLevelChange(gp, lvl, prev);
      }
    }
  }

  // Which GPIO (if any) drives a given part pin's net – used for servo / buzzer visuals
  gpioOnNet(part, pin) {
    const b = this.board();
    const n = this.net(part, pin);
    if (!b || n == null) return null;
    for (const [gp, g] of this.gpios) {
      const name = this.boardPinOfGpio(gp);
      if (name && this.net(b, name) === n) return g;
    }
    return null;
  }
}
