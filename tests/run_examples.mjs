import { EXAMPLES } from '../js/examples.js';
import { compile } from '../js/compiler/compile.js';
import { Runtime } from '../js/runtime/runtime.js';
import { Circuit } from '../js/circuit/circuit.js';
import { defaultAttrs } from '../js/circuit/parts.js';
import { binToUtf8 } from '../js/runtime/format.js';

const only = process.argv[2];
const ms = Number(process.argv[3] || 1500);
for (const ex of EXAMPLES) {
  if (only && ex.id !== only) continue;
  const parts = ex.diagram.parts.map((p) => ({ type: p.type, id: p.id, x: p.left, y: p.top, rotate: 0, attrs: Object.assign(defaultAttrs(p.type), p.attrs) }));
  const wires = ex.diagram.connections.map(([from, to]) => ({ from, to }));
  const sim = new Circuit();
  sim.setDiagram(parts, wires);
  let out = '';
  const logs = [];
  const R = new Runtime({ sim, settings: {}, io: { serialWrite: (p, s, boot) => { if (!boot) out += s; }, log: (l, m) => logs.push(l + ': ' + m), net: (k, m) => logs.push(k + ': ' + m), wifi() {}, restart() {}, onStopped() {} } });
  const { code } = compile(ex.code);
  const pr = R.start(code);
  const snaps = [];
  const iv = setInterval(() => {
    sim.ensure();
    const vals = parts.filter((p) => /led|7seg|servo/.test(p.type)).map((p) => {
      if (p.type === 'wokwi-led') return p.id + '=' + (sim.V(p, 'A') ?? '-') + '/' + (sim.V(p, 'C') ?? '-');
      if (p.type === 'wokwi-7segment') return 'seg:' + ['A','B','C','D','E','F','G'].map((s) => (sim.V(p, s) > 1.5 ? 1 : 0)).join('');
      if (p.type === 'wokwi-servo') return 'servo=' + (sim.gpioOnNet(p, 'PWM') || {}).servo;
      return '';
    });
    snaps.push(vals.join(' ') + (process.env.DBG ? ' g4=' + JSON.stringify(sim.gpios.get(4)) : ''));
  }, ms / 4);
  await new Promise((r) => setTimeout(r, ms));
  clearInterval(iv);
  // poke inputs for some examples
  const lcd = parts.find((p) => p.type === 'wokwi-lcd1602');
  R.stop();
  await pr;
  console.log('=== ' + ex.id);
  console.log(binToUtf8(out).split('\n').slice(0, 6).join('\n'));
  if (logs.length) console.log('LOGS:', logs.slice(0, 5).join(' || '));
  console.log('SNAP:', [...new Set(snaps)].slice(0, 4).join(' | '));
  if (lcd && lcd.state) console.log('LCD:', [0, 0x40].map((a) => String.fromCharCode(...lcd.state.ddram.slice(a, a + 16))).join(' / '));
  const oled = parts.find((p) => p.type === 'wokwi-ssd1306');
  if (oled) console.log('OLED pixels on:', oled.state ? oled.state.fb.reduce((a, b) => a + b, 0) : 'no state');
  const strip = parts.find((p) => p.type === 'wokwi-neopixel-strip');
  if (strip) console.log('STRIP:', strip.state ? JSON.stringify(strip.state.colors.slice(0, 2).map((c) => c.map(Math.round))) : 'none');
}
process.exit(0);
