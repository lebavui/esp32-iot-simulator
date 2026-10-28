// New sensor / relay parts and the radio libraries (LoRa, ESP-NOW, UDP, CoAP): examples are run against the circuit
// solver, two runtimes at a time share the virtual air (BroadcastChannel) like two browser tabs.
// (run: node tests/t_radio.mjs)
import { EXAMPLES } from '../js/examples.js';
import { compile } from '../js/compiler/compile.js';
import { Runtime } from '../js/runtime/runtime.js';
import { Circuit } from '../js/circuit/circuit.js';
import { PARTS, defaultAttrs } from '../js/circuit/parts.js';
import { coapEncode, coapDecode } from '../js/runtime/radio.js';
import { binToUtf8 } from '../js/runtime/format.js';

let fail = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// keep the tests offline: WiFi.hostByName("coap.me") fails at once
globalThis.fetch = async () => { throw new Error('offline (test)'); };

// start an example (or { code, diagram }) and return handles to it
function boot(ex, { code, attrs = {}, drop = [] } = {}) {
  if (typeof ex === 'string') ex = EXAMPLES.find((e) => e.id === ex);
  const parts = ex.diagram.parts.map((q) => ({ type: q.type, id: q.id, x: q.left, y: q.top, rotate: 0, attrs: Object.assign(defaultAttrs(q.type), q.attrs, attrs[q.id]) }));
  const sim = new Circuit();
  sim.setDiagram(parts, ex.diagram.connections.filter((c) => !drop.includes(c[1])).map(([from, to]) => ({ from, to })));
  let out = '';
  const logs = [];
  const R = new Runtime({
    sim, settings: {},
    io: { serialWrite: (_p, s, b) => { if (!b) out += s; }, log: (l, m) => logs.push(`${l}: ${m}`), net: (k, m) => logs.push(`${k}: ${m}`), wifi() {}, restart() {}, onStopped() {} },
  });
  const done = R.start(compile(code || ex.code).code);
  // the browser re-solves the circuit every frame (pin-change interrupts, relay contacts follow inputs)
  const frame = setInterval(() => sim.ensure(), 16);
  done.finally(() => clearInterval(frame));
  const part = (id) => parts.find((p) => p.id === id);
  return {
    R, sim, part, logs, done,
    get out() { return binToUtf8(out); },
    set(id, key, v) { part(id).attrs[key] = v; sim.invalidate(); },
    serial(s) { R.serialIn.push(...Buffer.from(s)); },
    V(id, pin) { sim.ensure(); return sim.V(part(id), pin); },
    async stop() { R.stop(); clearInterval(frame); await done; },
  };
}
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(20); } return false; };

// ---------------------------------------------------------------- comparator modules: AO / DO from the attributes
{
  const api = (vcc) => ({ powered: () => true, V: (pin) => (pin === 'VCC' ? vcc : 0) });
  for (const [type, key, lo, hi] of [['esp32-iot-flame-sensor', 'flame', 0, 100], ['esp32-iot-mq2', 'gas', 100, 9000],
    ['esp32-iot-rain-sensor', 'rain', 0, 100], ['esp32-iot-soil-moisture-sensor', 'moisture', 0, 100], ['esp32-iot-photodiode-sensor', 'lux', 0, 2000]]) {
    const p = (v) => ({ type, attrs: { ...defaultAttrs(type), [key]: v } });
    const d = (v) => Object.fromEntries(PARTS[type].drive(p(v), api(3.3)).map((x) => [x.pin, x.v]));
    const a = d(lo), b = d(hi);
    check(`${type}: DO HIGH idle, LOW when detected`, a.DO === 3.3 && b.DO === 0, `${a.DO} ${b.DO}`);
    check(`${type}: AO moves with ${key}`, Math.abs(a.AO - b.AO) > 1, `${a.AO.toFixed(2)} → ${b.AO.toFixed(2)}`);
  }
}

// ---------------------------------------------------------------- sensor / actuator examples
{
  const t = boot('flame-digital');
  await wait(200);
  t.set('flame1', 'flame', 80);
  check('flame: fire detected', await until(() => t.out.includes('PHÁT HIỆN LỬA')), t.out);
  check('flame: buzzer on GPIO4', !!(t.sim.gpios.get(4) || {}).tone);
  t.set('flame1', 'flame', 0);
  check('flame: alarm off', await until(() => t.out.includes('Hết lửa')));
  await t.stop();
}
{
  const t = boot('gas-digital');
  await wait(2300);
  t.set('mq1', 'gas', 5000);
  check('gas DO: interrupt → warning', await until(() => t.out.includes('CẢNH BÁO')), t.out);
  await t.stop();
}
{
  // MQ-2 at 5 V, AO through the 10k/20k divider (after the 10 s warm-up)
  const t = boot('gas-analog', { attrs: { mq1: { gas: 2000 } } });
  await until(() => /LPG≈\s*\d+/.test(t.out), 14000);
  const ppm = Number((/LPG≈\s*(\d+)/.exec(t.out) || [])[1]);
  check('gas AO: ppm from the datasheet curve (5 V + divider)', Math.abs(ppm - 2000) < 100, `${ppm} ppm`);
  check('gas AO: no over-voltage warning with the divider', !t.logs.some((l) => l.includes('3.6 V')));
  await t.stop();
}
{
  // DO (0/5 V) wired straight to the GPIO: warned like a pin that could be damaged
  const ex = EXAMPLES.find((e) => e.id === 'gas-digital');
  const diagram = { ...ex.diagram, connections: [...ex.diagram.connections.filter((c) => !c.join().includes('rdiv')), ['mq1:DO', 'esp:D34', 'green']] };
  const t = boot({ code: ex.code, diagram });
  check('GPIO over-voltage warning (5 V sensor without divider)', await until(() => t.logs.some((l) => l.includes('GPIO34') && l.includes('3.6 V')), 5000), t.logs.find((l) => l.includes('3.6')));
  const ok = boot('gas-digital');
  await until(() => ok.out.includes('bình thường'), 5000);
  check('gas DO: no over-voltage warning with the divider', !ok.logs.some((l) => l.includes('3.6 V')));
  await ok.stop();
  await t.stop();
}
{
  const t = boot('water-level', { attrs: { wl1: { level: 90 } } });
  await until(() => t.out.includes('mực nước'));
  await wait(100);
  check('water level: 90 % → all LEDs', ['led1', 'led2', 'led3'].every((id) => t.V(id, 'A') > 3), t.out.split('\n')[0]);
  check('water level: sensor powered from GPIO27 only while measuring', t.V('wl1', 'VCC') < 0.5);
  await t.stop();
}
{
  const t = boot('soil-irrigation', { attrs: { soil1: { moisture: 10 } } });
  check('soil: dry → pump on', await until(() => t.out.includes('BẬT máy bơm')), t.out);
  check('soil: relay energized, lamp lit', await until(() => t.part('relay1').energized && Math.abs(t.V('lamp1', '1') - t.V('lamp1', '2')) > 4));
  t.set('soil1', 'moisture', 70);
  check('soil: moist → pump off', await until(() => t.out.includes('TẮT máy bơm')));
  check('soil: lamp off', await until(() => !t.part('relay1').energized && Math.abs((t.V('lamp1', '1') || 0) - (t.V('lamp1', '2') || 0)) < 0.1));
  await t.stop();
}
{
  const t = boot('relay');
  await wait(200);
  t.serial('ON\n');
  await until(() => t.out.includes('lệnh Serial'));
  check('relay: Serial ON closes COM–NO', await until(() => t.part('relay1').energized && t.V('lamp1', '1') > 4.9));
  t.part('btn1').pressed = true;
  t.sim.invalidate();
  await until(() => t.out.includes('nút nhấn'));
  t.part('btn1').pressed = false;
  t.sim.invalidate();
  check('relay: button toggles off', await until(() => !t.part('relay1').energized));
  t.part('relay1').attrs.trigger = 'low';
  t.sim.invalidate();
  check('relay: low-trigger module energized by LOW input', (t.sim.ensure(), t.part('relay1').energized));
  await t.stop();
}

// ---------------------------------------------------------------- catalog sensors: rain/photodiode DO, DS18B20, DHT11, AHT10
{
  const t = boot('rain-digital');
  await wait(200);
  t.set('rain1', 'rain', 60);
  check('rain DO: wet → alarm, LED on', await until(() => t.out.includes('bắt đầu mưa') && t.V('led1', 'A') > 2), t.out);
  t.set('rain1', 'rain', 0);
  check('rain DO: dry → stopped', await until(() => t.out.includes('Tạnh mưa')));
  await t.stop();
}
{
  const t = boot('photodiode-digital');
  await wait(200);
  for (let i = 0; i < 2; i++) { t.set('pd1', 'lux', 20); await wait(120); t.set('pd1', 'lux', 1500); await wait(120); }
  check('photodiode DO: interrupt counts beam breaks', await until(() => t.out.includes('Tổng số lần: 2')), t.out);
  await t.stop();
}
{
  const t = boot('photodiode-analog', { attrs: { pd1: { lux: 800 } } });
  await until(() => /lux≈\s*[\d.]+/.test(t.out));
  const lux = Number((/lux≈\s*([\d.]+)/.exec(t.out) || [])[1]);
  check('photodiode AO: lux from the linear photocurrent', Math.abs(lux - 800) < 30, `${lux} lux`);
  await t.stop();
}
{
  const t = boot('ds18b20', { attrs: { ds1: { temperature: 22.3 }, ds2: { temperature: -5 } } });
  check('DS18B20: 2 sensors found on the bus', await until(() => t.out.includes('Tìm thấy 2 cảm biến')), t.out);
  check('DS18B20: 12-bit readings (0.0625 °C steps)', await until(() => t.out.includes('#0: 22.31 °C') && t.out.includes('#1: -5.00 °C'), 3000), t.out);
  check('DS18B20: ROM codes start with family 0x28', /#0 mã ROM: 28[0-9A-F]{14}/.test(t.out));
  await t.stop();
  const np = boot('ds18b20', { drop: ['rpu:1'] });
  check('DS18B20 without the 4.7 kΩ pull-up: not found + warning', await until(() => np.out.includes('Tìm thấy 0 cảm biến')) && np.logs.some((l) => l.includes('4.7 kΩ')), np.logs.join(' | '));
  await np.stop();
}
{
  const t = boot('dht11', { attrs: { dht1: { temperature: 31.6, humidity: 55.4 } } });
  check('DHT11: whole-degree readings', await until(() => t.out.includes('Nhiệt độ: 32 °C  Độ ẩm: 55 %')), t.out);
  await t.stop();
}
{
  const t = boot('aht10', { attrs: { aht1: { temperature: 24.2, humidity: 48 } } });
  check('AHT10: I2C scan sees AHT (0x38) and OLED (0x3C)', await until(() => t.out.includes('0x38 0x3C')), t.out);
  check('AHT10: getEvent() values', await until(() => t.out.includes('Nhiệt độ: 24.20 °C  Độ ẩm: 48.00 %RH')), t.out);
  await t.stop();
}

// ---------------------------------------------------------------- WebServer ↔ HTTPClient on the virtual network
{
  const srv = boot('webserver-config');
  await until(() => srv.out.includes('HTTP server đã chạy'));
  const cli = boot({ diagram: { parts: [{ type: 'esp32-iot-esp32-devkit-v1', id: 'esp', top: 0, left: 0, attrs: {} }], connections: [] }, code: `
#include <WiFi.h>
#include <HTTPClient.h>
void req(const char* method, const char* url, String body) {
  HTTPClient http;
  http.begin(url);
  if (body.length()) http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  int code = String(method) == "POST" ? http.POST(body) : http.GET();
  Serial.printf("%s %s -> %d %s\\n", method, url, code, http.getString().c_str());
  http.end();
}
void setup() {
  Serial.begin(115200);
  WiFi.begin("x", "");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  req("GET", "http://10.13.37.60/api/status", "");
  req("GET", "http://10.13.37.60/led?state=on", "");
  req("POST", "http://10.13.37.60/save", "name=Phong+ngu&interval=3&limit=25.5");
  req("GET", "http://10.13.37.60/nope", "");
  req("GET", "http://10.13.37.99/", "");
  req("GET", "http://10.13.37.60/", "");
}
void loop() { delay(100); }` });
  check('WebServer: GET /api/status → JSON', await until(() => /api\/status -> 200 \{"name":"ESP32 Phòng khách","temperature":28.5/.test(cli.out), 6000), cli.out);
  check('WebServer: /led?state=on drives the LED', await until(() => cli.out.includes('"led":true') && srv.V('led1', 'A') > 2), cli.out);
  check('WebServer: POST form → arguments, 303 + Location', await until(() => cli.out.includes('/save -> 303')) && srv.out.includes('tên="Phong ngu", chu kỳ=3 s, ngưỡng=25.5'), srv.out);
  check('WebServer: onNotFound → 404', await until(() => cli.out.includes('/nope -> 404 Không tìm thấy: /nope')));
  check('HTTPClient: nobody at that address → error', await until(() => cli.out.includes('10.13.37.99/ -> -1'), 8000), cli.out);
  check('WebServer: page has the saved name filled in', await until(() => cli.out.includes('<title>Phong ngu</title>'), 4000));
  await cli.stop();
  await srv.stop();
}

// ---------------------------------------------------------------- LoRa
{
  const rx = boot('lora-receiver');
  await until(() => rx.out.includes('đang chờ'));
  const lit = () => { const st = rx.part('oled1').state; return st ? st.fb.reduce((x, y) => x + y, 0) : 0; };
  await wait(100);
  const idle = lit();
  const tx = boot('lora-sender');
  check('LoRa: packet received by the other node', await until(() => rx.out.includes('T=28.5C H=65%')), rx.out.slice(-200));
  check('LoRa: RSSI/SNR reported', /RSSI=-\d+ dBm\s+SNR=\d/.test(rx.out));
  check('LoRa: OLED shows the packet', await until(() => lit() > idle + 200), `${idle} → ${lit()}`);
  rx.part('lora1').inbox.push({ text: 'Thu tu nut bam', rssi: -88 });
  check('LoRa: test packet from the module button', await until(() => rx.out.includes('"Thu tu nut bam"  RSSI=-88')), rx.out.slice(-200));
  await tx.stop();
  // a sender with another sync word is not heard
  const other = boot('lora-sender', { code: EXAMPLES.find((e) => e.id === 'lora-sender').code.replace('0xF3', '0x34') });
  check('LoRa: other sync word ignored', await until(() => rx.logs.some((l) => l.includes('sync word 0x34'))));
  await other.stop();
  await rx.stop();
  const bad = boot('lora-sender', { drop: ['lora1:MISO'] });
  check('LoRa: begin() fails without MISO wire', await until(() => bad.out.includes('thất bại')) && bad.logs.some((l) => /MISO/.test(l)));
  await bad.stop();
}

// ---------------------------------------------------------------- ESP-NOW
{
  const rx = boot('espnow-receiver');
  await until(() => rx.out.includes('Đang chờ'));
  const tx = boot('espnow-sender');
  check('ESP-NOW: struct received', await until(() => /#0 "Gói số 0" pot=20\d\d \(1\.6\d V\) nút=thả/.test(rx.out)), rx.out.slice(-300));
  const mac = /MAC của board gửi: ([0-9A-F:]{17})/.exec(tx.out);
  check('ESP-NOW: receiver sees the sender MAC', !!mac && rx.out.includes('Từ ' + mac[1]), mac && mac[1]);
  check('ESP-NOW: send callback (broadcast)', await until(() => tx.out.includes('gửi thành công')));
  tx.part('btn1').pressed = true;
  tx.sim.invalidate();
  check('ESP-NOW: button → LED_BUILTIN of the receiver', await until(() => rx.out.includes('nút=NHẤN') && (rx.R.sim.gpios.get(2) || {}).out === 1));
  check('ESP-NOW: pot → LED PWM', Math.abs(((rx.sim.gpios.get(4) || {}).pwm || 0) - 0.5) < 0.05);
  await tx.stop();
  // unicast: ACK from the receiver's MAC, failure for a MAC nobody has
  const rmac = /MAC của board nhận: ([0-9A-F:]{17})/.exec(rx.out)[1];
  const hex = (m) => m.split(':').map((x) => '0x' + x).join(', ');
  const uni = (m) => `#include <WiFi.h>
#include <esp_now.h>
uint8_t addr[] = {${hex(m)}};
esp_now_peer_info_t peer;
void sent(const uint8_t *mac, esp_now_send_status_t st) { Serial.println(st == ESP_NOW_SEND_SUCCESS ? "ACK" : "NOACK"); }
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  esp_now_init();
  esp_now_register_send_cb(sent);
  memcpy(peer.peer_addr, addr, 6);
  esp_now_add_peer(&peer);
  uint8_t msg[] = "hi";
  esp_now_send(addr, msg, 3);
}
void loop() { delay(100); }`;
  const ok = boot('espnow-sender', { code: uni(rmac) });
  check('ESP-NOW: unicast acknowledged', await until(() => ok.out.includes('ACK')) && !ok.out.includes('NOACK'), ok.out);
  await ok.stop();
  const lost = boot('espnow-sender', { code: uni('12:34:56:78:9A:BC') });
  check('ESP-NOW: unicast to an absent MAC fails', await until(() => lost.out.includes('NOACK')), lost.out);
  await lost.stop();
  await rx.stop();
}

// ---------------------------------------------------------------- struct ↔ bytes
{
  const t = boot('espnow-receiver', { code: `struct Inner { int16_t a; uint8_t b; };
struct Msg { int id; float f; char name[8]; bool ok; Inner in; double d; };
void setup() {
  Serial.begin(115200);
  Msg m = {-7, 2.5, "abc", true, {-300, 200}, 1.25};
  uint8_t buf[64];
  memcpy(buf, &m, sizeof(m));
  Msg n;
  memcpy(&n, buf, sizeof(n));
  Serial.printf("%d %d %.2f %s %d %d %d %.2f %d\\n", sizeof(m), n.id, n.f, n.name, n.ok, n.in.a, n.in.b, n.d, buf[0]);
}
void loop() { delay(100); }` });
  await until(() => t.out.includes('\n'));
  check('struct pack/unpack round trip', t.out.trim() === '28 -7 2.50 abc 1 -300 200 1.25 249', t.out.trim());
  await t.stop();
}

// ---------------------------------------------------------------- CoAP
{
  const enc = coapEncode({ type: 0, code: 1, messageid: 0x1234, token: Uint8Array.of(9), options: [{ number: 11, buffer: Uint8Array.from(Buffer.from('a-rather-long-path-segment')) }, { number: 3, buffer: Uint8Array.from(Buffer.from('h')) }], payload: Uint8Array.of(1, 2) });
  const dec = coapDecode(enc);
  check('CoAP: encode/decode', dec && dec.messageid === 0x1234 && dec.options.map((o) => o.number).join() === '3,11' && Buffer.from(dec.options[1].buffer).toString() === 'a-rather-long-path-segment' && dec.payload.join() === '1,2');

  const srv = boot('coap-server');
  await until(() => srv.out.includes('CoAP server đang chạy'));
  check('CoAP: static IP 10.13.37.50', srv.out.includes('IP: 10.13.37.50'));
  const cli = boot('coap-client');
  check('CoAP: GET /temp → JSON', await until(() => cli.out.includes('Phản hồi 2.05 từ 10.13.37.50') && cli.out.includes('{"t":28.5,"h":65}'), 8000), cli.out.slice(-300));
  cli.part('btn1').pressed = true;
  cli.sim.invalidate();
  check('CoAP: PUT toggle → server LED on', await until(() => srv.out.includes('-> LED BẬT') && srv.V('led1', 'A') > 1), srv.out.slice(-200));
  check('CoAP: client mirrors the state', await until(() => (cli.sim.gpios.get(2) || {}).out === 1));
  check('CoAP: hostByName offline → 0 (no crash)', !cli.out.includes('coap.me ='));
  await cli.stop();
  // raw UDP client asking for an unknown resource and the discovery list
  const raw = boot('coap-client', { code: `#include <WiFi.h>
#include <WiFiUdp.h>
#include <coap-simple.h>
WiFiUDP udp;
Coap coap(udp);
void resp(CoapPacket &p, IPAddress ip, int port) {
  char s[p.payloadlen + 1];
  memcpy(s, p.payload, p.payloadlen);
  s[p.payloadlen] = 0;
  Serial.printf("%d.%02d [%s]\\n", p.code >> 5, p.code & 31, s);
}
void setup() {
  Serial.begin(115200);
  WiFi.begin("x", "");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  coap.response(resp);
  coap.start(5700);
  coap.get(IPAddress(10, 13, 37, 50), 5683, "nope");
  delay(200);
  coap.loop();
  coap.get(IPAddress(10, 13, 37, 50), 5683, ".well-known/core");
}
void loop() { coap.loop(); delay(20); }` });
  check('CoAP: unknown resource → 4.04', await until(() => raw.out.includes('4.04 []')), raw.out);
  check('CoAP: /.well-known/core lists resources', await until(() => raw.out.includes('2.05 [</led>,</temp>]')), raw.out);
  await raw.stop();
  await srv.stop();
}

console.log(fail ? `${fail} lỗi` : 'Tất cả đều đạt');
process.exit(fail ? 1 : 0);
