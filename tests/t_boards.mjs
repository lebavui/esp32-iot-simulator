// Board-specific behaviour: pin constants, onboard LED/BOOT wiring, chip checks (run: node tests/t_boards.mjs)
import { EXAMPLES } from '../js/examples.js';
import { compile } from '../js/compiler/compile.js';
import { Runtime } from '../js/runtime/runtime.js';
import { Circuit } from '../js/circuit/circuit.js';
import { defaultAttrs } from '../js/circuit/parts.js';
import { binToUtf8 } from '../js/runtime/format.js';

let fail = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(type, code, extraParts = [], wires = []) {
  const parts = [{ type, id: 'esp', x: 0, y: 0, rotate: 0, attrs: {} }, ...extraParts];
  const sim = new Circuit();
  sim.setDiagram(parts, wires);
  let out = '';
  const logs = [];
  const R = new Runtime({ sim, settings: {}, io: { serialWrite: (p, s, boot) => { if (!boot) out += s; }, log: (l, m) => logs.push(m), net() {}, wifi() {}, restart() {}, onStopped() {} } });
  const pr = R.start(compile(code, { board: type }).code);
  return { sim, R, parts, out: () => binToUtf8(out), logs, stop: async () => { R.stop(); await pr; } };
}

// pin constants per board (pins_arduino.h of arduino-esp32 3.3.x)
const PRINT = 'void setup(){ Serial.begin(115200); Serial.print(SDA); Serial.print(","); Serial.print(SCL); Serial.print(","); Serial.println(A0); } void loop(){ delay(1000); }';
for (const [type, want] of [['esp32-iot-esp32-devkit-v1', '21,22,36'], ['board-xiao-esp32-c3', '6,7,2'], ['board-xiao-esp32-s3', '5,6,1'], ['board-esp32-c3-supermini', '8,9,0']]) {
  const t = await start(type, PRINT);
  await wait(80);
  check(`${type}: SDA,SCL,A0`, t.out().trim() === want, t.out().trim());
  await t.stop();
}
try { compile('void setup(){ pinMode(LED_BUILTIN, OUTPUT); } void loop(){}', { board: 'board-xiao-esp32-c3' }); check('XIAO C3 has no LED_BUILTIN', false); }
catch (e) { check('XIAO C3 has no LED_BUILTIN', /LED_BUILTIN/.test(e.message), e.message); }

// SuperMini: BOOT button (GPIO9) pulls the pin low while pressed
{
  const ex = EXAMPLES.find((e) => e.id === 'supermini-boot');
  const parts = ex.diagram.parts.map((p) => ({ type: p.type, id: p.id, x: p.left, y: p.top, rotate: 0, attrs: Object.assign(defaultAttrs(p.type), p.attrs) }));
  const t = await start(parts[0].type, ex.code, parts.slice(1), ex.diagram.connections.map(([from, to]) => ({ from, to })));
  await wait(100);
  const led = t.parts.find((p) => p.id === 'led1');
  check('SuperMini: external LED off before BOOT', t.sim.V(led, 'A') === 0);
  t.parts[0].pressed = true; t.sim.invalidate();
  await wait(100);
  check('SuperMini: BOOT pressed -> LED on', t.sim.V(led, 'A') === 3.3, String(t.sim.V(led, 'A')));
  check('SuperMini: serial reports the press', /BOOT: nhấn/.test(t.out()));
  const g8 = t.sim.gpios.get(8);
  check('SuperMini: LED_BUILTIN is GPIO8 output', !!(g8 && g8.mode & 2));
  await t.stop();
}

// chip checks
{
  const t = await start('board-xiao-esp32-c3', 'void setup(){ pinMode(12, OUTPUT); Serial.println(analogRead(5)); pinMode(22, INPUT); } void loop(){ delay(1000); }');
  await wait(80);
  check('C3: flash pin warning', t.logs.some((m) => /GPIO12 .*flash/.test(m)), t.logs.join(' | '));
  check('C3: ADC2 unusable', t.logs.some((m) => /ADC2/.test(m)) && t.out().trim() === '0');
  check('C3: GPIO22 does not exist', t.logs.some((m) => /GPIO22 không tồn tại trên Seeed XIAO ESP32-C3/.test(m)));
  await t.stop();
}
{
  const t = await start('board-xiao-esp32-s3', 'void setup(){ Serial.println(ESP.getChipModel()); Serial.println(xPortGetCoreID()); pinMode(43, OUTPUT); pinMode(26, OUTPUT); } void loop(){ delay(1000); }');
  await wait(80);
  check('S3: chip model', t.out().startsWith('ESP32-S3'), t.out().trim());
  check('S3: GPIO43 valid, GPIO26 flash', !t.logs.some((m) => /GPIO43/.test(m)) && t.logs.some((m) => /GPIO26 .*flash/.test(m)), t.logs.join(' | '));
  await t.stop();
}
console.log(fail ? `${fail} lỗi` : 'Tất cả đều đạt');
process.exit(fail ? 1 : 0);
