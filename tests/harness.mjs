// Node test harness: compiles a sketch and runs it against a minimal fake circuit.
import fs from 'fs';
import { compile } from '../js/compiler/compile.js';
import { Runtime } from '../js/runtime/runtime.js';
import { binToUtf8 } from '../js/runtime/format.js';

export function fakeSim(opts = {}) {
  const g = new Map();
  const sim = {
    inputs: opts.inputs || {},
    gpio(p) { if (!g.has(p)) g.set(p, { mode: 0, out: 0, pwm: null }); return g.get(p); },
    start() {}, stop() {},
    pinMode(p, m) { sim.gpio(p).mode = m; },
    digitalWrite(p, v) { const s = sim.gpio(p); if (s.out !== v) { s.out = v; (opts.onWrite || (() => {}))(p, v); } },
    digitalRead(p) { const s = sim.gpio(p); return (s.mode & 2) ? s.out : (sim.inputs[p] ?? ((s.mode === 5) ? 1 : 0)); },
    readVoltage(p) { return sim.inputs[p] ?? null; },
    setPwm(p, d) { sim.gpio(p).pwm = d; },
    setTone() {}, setServo(p, a) { sim.gpio(p).servo = a; },
    pulseIn() { return opts.pulse || 0; },
    findI2C: (kind, addr) => (opts.i2c && opts.i2c[addr]) || null,
    findOnPin: (types) => (opts.parts && opts.parts.find((p) => types.includes(p.type))) || null,
  };
  return sim;
}

export async function run(src, { ms = 300, sim, input, log = false } = {}) {
  let out = '';
  const logs = [];
  const { code, warnings } = compile(src);
  if (log) console.log(code);
  const R = new Runtime({
    sim: sim || fakeSim(),
    settings: {},
    io: {
      serialWrite: (port, s, boot) => { if (!boot) out += s; },
      log: (lvl, m) => logs.push(lvl + ': ' + m),
      net: (k, m) => logs.push(k + ': ' + m),
      wifi() {}, restart() {}, onStopped() {},
    },
  });
  const p = R.start(code);
  if (input) setTimeout(() => R.serialIn.push(...Buffer.from(input)), 50);
  await new Promise((r) => setTimeout(r, ms));
  R.stop();
  await p;
  return { out: binToUtf8(out), logs, warnings, R };
}

if (process.argv[2]) {
  const r = await run(fs.readFileSync(process.argv[2], 'utf8'), { ms: Number(process.argv[3] || 500), log: process.argv[4] === 'v' });
  console.log(r.out);
  console.log(r.logs.join('\n'));
  console.log(r.warnings);
  process.exit(0);
}
