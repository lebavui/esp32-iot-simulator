// Moving projects between boards (js/port.js): every example on every board must compile, wire only existing pins,
// route no wire through a part and run without chip warnings; a few behaviours are checked on the new board
// (run: node tests/t_port.mjs)
import { EXAMPLES } from '../js/examples.js';
import { BOARDS } from '../js/boards.js';
import { portProject } from '../js/port.js';
import { compile } from '../js/compiler/compile.js';
import { Runtime } from '../js/runtime/runtime.js';
import { Circuit } from '../js/circuit/circuit.js';
import { defaultAttrs, partPins, partSize } from '../js/circuit/parts.js';
import { pinExit, routeWires } from '../js/circuit/route.js';
import { binToUtf8 } from '../js/runtime/format.js';

let fail = 0;
const check = (name, ok, info = '') => { if (!ok || process.env.V) console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (t) => t.replace(/^(esp32-iot|board)-/, '');

// wire segments running through a part's box (a wire's first/last segment leaves its own part)
function wiresThroughParts(diagram) {
  const parts = diagram.parts.map((q) => ({ id: q.id, type: q.type, x: q.left, y: q.top, rotate: q.rotate || 0, attrs: Object.assign(defaultAttrs(q.type), q.attrs) }));
  const bad = [];
  for (const c of diagram.connections) {
    const ends = c.slice(0, 2).map((r) => { const [id, pin] = r.split(':'); const p = parts.find((q) => q.id === id); return { p, pos: pinExit(p, pin).pos }; });
    const pts = [ends[0].pos, ...(c[3] || []), ends[1].pos];
    for (const p of parts) {
      const { w, h } = partSize(p);
      pts.slice(1).forEach(([x2, y2], i) => {
        const [x1, y1] = pts[i];
        if ((i === 0 && p === ends[0].p) || (i === pts.length - 2 && p === ends[1].p)) return;
        if (Math.max(x1, x2) > p.x && Math.min(x1, x2) < p.x + w && Math.max(y1, y2) > p.y && Math.min(y1, y2) < p.y + h) bad.push(`${c[0]}-${c[1]} qua ${p.id}`);
      });
    }
  }
  return bad;
}

async function run(p, board, ms, poke) {
  const parts = p.diagram.parts.map((q) => ({ type: q.type, id: q.id, x: q.left, y: q.top, rotate: 0, attrs: Object.assign(defaultAttrs(q.type), q.attrs) }));
  const sim = new Circuit();
  sim.setDiagram(parts, p.diagram.connections.map(([from, to]) => ({ from, to })));
  let out = '';
  const logs = [];
  const R = new Runtime({ sim, settings: {}, io: { serialWrite: (_p, s, boot) => { if (!boot) out += s; }, log: (l, m) => logs.push([l, m]), net() {}, wifi() {}, restart() {}, onStopped() {} } });
  const pr = R.start(compile(p.code, { board }).code);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await wait(20); sim.ensure(); if (poke) seen.push(poke(parts, sim, Date.now() - t0)); }
  R.stop();
  await pr;
  return { parts, sim, logs, out: binToUtf8(out), seen };
}

for (const ex of EXAMPLES) {
  const own = ex.diagram.parts[0].type;
  check(`${ex.id}: same board unchanged`, !portProject(ex, own).changed);
  for (const board of Object.keys(BOARDS)) {
    if (board === own) continue;
    const name = `${ex.id} → ${short(board)}`;
    const p = portProject(ex, board);
    check(`${name}: board swapped`, p.diagram.parts.filter((q) => BOARDS[q.type]).map((q) => q.type).join() === board);
    check(`${name}: no lost pins/wires`, !p.lost.length && !p.dropped, `${p.lost} ${p.dropped}`);
    const byId = Object.fromEntries(p.diagram.parts.map((q) => [q.id, q]));
    const bad = p.diagram.connections.flat().filter((r) => typeof r === 'string' && r.includes(':')).filter((r) => {
      const [id, pin] = r.split(':');
      return !byId[id] || !partPins({ type: byId[id].type, attrs: Object.assign(defaultAttrs(byId[id].type), byId[id].attrs) }).some((q) => q.name === pin);
    });
    check(`${name}: wires on existing pins`, !bad.length, bad.join(' '));
    const through = wiresThroughParts(p.diagram);
    check(`${name}: no wire through a part`, !through.length, through.join(', '));
    try { compile(p.code, { board }); } catch (e) { check(`${name}: compiles`, false, e.message); continue; }
    const r = await run(p, board, 150);
    const warn = r.logs.filter(([l, m]) => l !== 'info' && /GPIO|ADC|chân/i.test(m));
    check(`${name}: no pin warnings`, !warn.length, warn.map((w) => w[1]).join(' | '));
  }
}

// router: a wire between two parts with a third one in the way goes around it
{
  const parts = [
    { id: 'r1', type: 'esp32-iot-resistor', x: 0, y: 0, rotate: 0, attrs: defaultAttrs('esp32-iot-resistor') },
    { id: 'lcd', type: 'esp32-iot-lcd1602', x: 100, y: -40, rotate: 0, attrs: defaultAttrs('esp32-iot-lcd1602') },
    { id: 'r2', type: 'esp32-iot-resistor', x: 400, y: 0, rotate: 0, attrs: defaultAttrs('esp32-iot-resistor') },
  ];
  const wires = routeWires(parts, [{ from: 'r1:2', to: 'r2:1', points: null }]);
  const d = { parts: parts.map((p) => ({ ...p, left: p.x, top: p.y })), connections: wires.map((w) => [w.from, w.to, 'green', w.points]) };
  const t = wiresThroughParts(d);
  check('router: goes around a part in the way', !t.length && wires[0].points.length >= 2, JSON.stringify(wires[0].points) + ' ' + t.join());
}

// behaviour after moving
const ex = (id) => EXAMPLES.find((e) => e.id === id);
{
  const p = portProject(ex('blink'), 'board-xiao-esp32-c3');
  const r = await run(p, 'board-xiao-esp32-c3', 1300, (parts, sim) => parts.filter((q) => q.type === 'esp32-iot-led').map((q) => sim.V(q, 'A') > 1 ? 1 : 0).join(''));
  check('blink → XIAO C3: both LEDs blink', ['0', '1'].every((v) => r.seen.some((s) => s[0] === v) && r.seen.some((s) => s[1] === v)), [...new Set(r.seen)].join(','));
}
{
  const p = portProject(ex('pir-interrupt'), 'board-xiao-esp32-c3');
  check('pir → XIAO C3: LED_BUILTIN replaced by an external LED', /#define LED_BUILTIN D\d+/.test(p.code) && p.added.length === 1, p.added.join());
}
for (const board of ['board-xiao-esp32-c3', 'board-esp32-c3-supermini', 'esp32-iot-esp32-devkit-v1']) {
  const src = board === 'esp32-iot-esp32-devkit-v1' ? 'xiao-s3-oled' : 'oled';
  const p = portProject(ex(src), board);
  const r = await run(p, board, 600);
  const oled = r.parts.find((q) => q.type === 'esp32-iot-ssd1306');
  check(`${src} → ${short(board)}: OLED on the board's I2C pins draws`, oled.state && oled.state.fb.some((v) => v), r.logs.map((l) => l[1]).join(' | '));
}
{
  const p = portProject(ex('pot-pwm'), 'board-esp32-c3-supermini');
  check('pot-pwm → SuperMini: pot on an ADC1 pin', /const int POT_PIN = [0-4];/.test(p.code), p.code.split('\n').find((l) => /POT_PIN =/.test(l)));
  const r = await run(p, 'board-esp32-c3-supermini', 500);
  check('pot-pwm → SuperMini: reads the pot', /\b20[0-9]{2}\b/.test(r.out), r.out.split('\n')[0]);
}
{
  const p = portProject(ex('supermini-boot'), 'esp32-iot-esp32-devkit-v1');
  const btn = p.diagram.parts.find((q) => q.type === 'esp32-iot-pushbutton');
  check('supermini-boot → DevKit: BOOT replaced by a push button', !!btn);
  const r = await run(p, 'esp32-iot-esp32-devkit-v1', 400, (parts, sim, t) => {
    const b = parts.find((q) => q.type === 'esp32-iot-pushbutton');
    if (t > 200 && !b.pressed) { b.pressed = true; sim.invalidate(); }
    return sim.V(parts.find((q) => q.id === 'led1'), 'A') > 1 ? 'on' : 'off';
  });
  check('supermini-boot → DevKit: button lights the LED', r.seen[0] === 'off' && r.seen.at(-1) === 'on' && /BOOT: nhấn/.test(r.out));
}
{
  const p = portProject(ex('xiao-c3-pot'), 'board-xiao-esp32-s3');
  check('xiao-c3-pot → XIAO S3: keeps D0/D10', p.code === ex('xiao-c3-pot').code && p.diagram.connections.some((c) => c[0] === 'esp:D10'));
}
console.log(fail ? `${fail} lỗi` : 'Tất cả đều đạt');
process.exit(fail ? 1 : 0);
