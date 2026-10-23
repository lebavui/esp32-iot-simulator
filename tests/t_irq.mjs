import { EXAMPLES } from '../js/examples.js';
import { compile } from '../js/compiler/compile.js';
import { Runtime } from '../js/runtime/runtime.js';
import { Circuit } from '../js/circuit/circuit.js';
import { defaultAttrs } from '../js/circuit/parts.js';
import { binToUtf8 } from '../js/runtime/format.js';
const ex = EXAMPLES.find((e) => e.id === 'pir-interrupt');
const parts = ex.diagram.parts.map((p) => ({ type: p.type, id: p.id, x: p.left, y: p.top, attrs: Object.assign(defaultAttrs(p.type), p.attrs) }));
const sim = new Circuit();
sim.setDiagram(parts, ex.diagram.connections.map(([from, to]) => ({ from, to })));
let out = '';
const R = new Runtime({ sim, settings: {}, io: { serialWrite: (p, s, b) => { if (!b) out += s; }, log: (l, m) => console.log(l, m), net() {}, wifi() {}, restart() {}, onStopped() {} } });
R.start(compile(ex.code).code);
const pir = parts.find((p) => p.id === 'pir1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);
for (let i = 0; i < 2; i++) {
  pir.motionUntil = Date.now() + 300; sim.invalidate(); sim.ensure();
  await sleep(400); sim.invalidate(); sim.ensure(); await sleep(200);
}
R.stop();
console.log(binToUtf8(out));
process.exit(0);
