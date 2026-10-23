// Application glue: code editor, diagram editor, simulation control, serial monitor, persistence.
import { compile } from './compiler/compile.js';
import { Runtime } from './runtime/runtime.js';
import { Circuit } from './circuit/circuit.js';
import { DiagramEditor, WIRE_COLORS } from './circuit/editor.js';
import { PARTS, defaultAttrs } from './circuit/parts.js';
import { EXAMPLES } from './examples.js';
import { DEFAULT_BROKERS } from './runtime/libs.js';
import { binToBytes, utf8ToBin } from './runtime/format.js';
import { MqttPanel } from './mqttpanel.js';
import { HELP_HTML } from './help.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'esp32sim.project';
const SETTINGS_KEY = 'esp32sim.settings';

const BLANK_CODE = `void setup() {
  // put your setup code here, to run once:
  Serial.begin(115200);
  Serial.println("Hello, ESP32!");
}

void loop() {
  // put your main code here, to run repeatedly:
  delay(10);
}
`;
const BLANK_DIAGRAM = { version: 1, parts: [{ type: 'wokwi-esp32-devkit-v1', id: 'esp', top: 0, left: 0, attrs: {} }], connections: [] };

// ---------------------------------------------------------------- settings
const settings = Object.assign({ proxy: 'auto', brokers: {}, sound: true, timestamps: false }, safeJson(localStorage.getItem(SETTINGS_KEY)) || {});
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ proxy: settings.proxy, brokers: settings.brokers, sound: settings.sound, timestamps: settings.timestamps })); }
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------------------------------------------------------------- code editor
const cm = CodeMirror.fromTextArea($('codeArea'), {
  mode: 'text/x-c++src', theme: 'material-darker', lineNumbers: true, indentUnit: 2, tabSize: 2,
  matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true, indentWithTabs: false,
  extraKeys: {
    'Ctrl-Enter': () => run(), 'Cmd-Enter': () => run(),
    'Ctrl-S': () => { saveLocal(); toast('Đã lưu vào trình duyệt'); }, 'Cmd-S': () => { saveLocal(); toast('Đã lưu vào trình duyệt'); },
    Tab: (c) => c.execCommand(c.somethingSelected() ? 'indentMore' : 'insertSoftTab'),
  },
});
const sketchDoc = cm.getDoc();
const diagramDoc = CodeMirror.Doc('', 'application/json');
let activeCodeTab = 'sketch';
cm.on('cursorActivity', () => { const c = cm.getCursor(); $('cursorPos').textContent = `Dòng ${c.line + 1}, Cột ${c.ch + 1}`; });
cm.on('change', () => { if (activeCodeTab === 'sketch') { clearMarks(); scheduleSave(); } });

// ---------------------------------------------------------------- circuit + diagram editor
const circuit = new Circuit();
let runtime = null;
let running = false;
let needsRender = true;
const editor = new DiagramEditor($('canvas'), circuit, {
  onChange: () => { needsRender = true; scheduleSave(); if (activeCodeTab === 'diagram' && !cm.hasFocus()) diagramDoc.setValue(diagramText()); },
  onSelect: (item) => renderInspector(item),
  isRunning: () => running,
  onInteract: (part, phase) => interact(part, phase),
  toast,
});
circuit.onShort = (shorts) => sysLog('warn', `⚠ Ngắn mạch: ${shorts.map((s) => `${s.a} ↔ ${s.b}`).join(', ')}`);

function interact(part, phase) {
  if (part.type === 'wokwi-pushbutton') {
    // keep very short clicks pressed for at least 120 ms so polling/debounce code can see them
    if (phase === 'down') { part.pressed = true; part.pressedAt = performance.now(); }
    else {
      const left = 120 - (performance.now() - (part.pressedAt || 0));
      if (left > 0) { setTimeout(() => interact(part, 'up'), left); return; }
      part.pressed = false;
    }
  }
  else if (part.type === 'wokwi-slide-switch' && phase === 'down') part.attrs.value = String(part.attrs.value) === '1' ? '0' : '1';
  else if (part.type === 'wokwi-pir-motion-sensor' && phase === 'down') triggerMotion(part);
  circuit.invalidate();
  circuit.ensure();
  needsRender = true;
  if (editor.sel === part) renderInspector(part);
}
function triggerMotion(part) {
  part.motionUntil = Date.now() + 5000;
  circuit.invalidate();
  setTimeout(() => { circuit.invalidate(); circuit.ensure(); needsRender = true; }, 5050);
}

// ---------------------------------------------------------------- project persistence
function currentProject() {
  return { name: $('projectName').value, code: activeCodeTab === 'sketch' ? sketchDoc.getValue() : sketchDoc.getValue(), diagram: editor.serialize() };
}
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 600); }
function saveLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify(currentProject())); } catch { /* quota */ } }
function loadProject(p) {
  stop();
  $('projectName').value = p.name || 'Dự án ESP32';
  sketchDoc.setValue(p.code || BLANK_CODE);
  editor.load(p.diagram || BLANK_DIAGRAM);
  if (activeCodeTab === 'diagram') diagramDoc.setValue(diagramText());
  clearMarks();
  showProblems([]);
  requestAnimationFrame(() => editor.fit());
  needsRender = true;
  saveLocal();
}
function diagramText() {
  const d = editor.serialize();
  const parts = d.parts.map((p) => '    ' + JSON.stringify(p)).join(',\n');
  const conns = d.connections.map((c) => '    ' + JSON.stringify(c)).join(',\n');
  return `{\n  "version": 1,\n  "author": ${JSON.stringify(d.author)},\n  "editor": "esp32-iot-sim",\n  "parts": [\n${parts}\n  ],\n  "connections": [\n${conns}\n  ]\n}\n`;
}
function applyDiagramText() {
  const d = safeJson(diagramDoc.getValue());
  if (!d || !Array.isArray(d.parts)) { toast('diagram.json không hợp lệ — giữ nguyên sơ đồ hiện tại'); return false; }
  const before = JSON.stringify(editor.serialize());
  if (JSON.stringify(d) !== before) { editor.load(d); needsRender = true; scheduleSave(); }
  return true;
}

// tabs (sketch / diagram)
for (const t of $('codeTabs').querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    const tab = t.dataset.tab;
    if (tab === activeCodeTab) return;
    if (activeCodeTab === 'diagram') applyDiagramText();
    activeCodeTab = tab;
    $('codeTabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    if (tab === 'diagram') { diagramDoc.setValue(diagramText()); cm.swapDoc(diagramDoc); }
    else cm.swapDoc(sketchDoc);
    cm.focus();
  });
}
diagramDoc.on('change', () => {
  clearTimeout(diagramDoc.t);
  diagramDoc.t = setTimeout(() => { if (activeCodeTab === 'diagram' && safeJson(diagramDoc.getValue())) applyDiagramText(); }, 900);
});

// ---------------------------------------------------------------- problems panel
let marked = [];
function clearMarks() {
  for (const m of marked) sketchDoc.removeLineClass(m.line, 'background', m.cls);
  marked = [];
}
function markLine(line, cls) {
  if (!line || line < 1 || line > sketchDoc.lineCount()) return;
  sketchDoc.addLineClass(line - 1, 'background', cls);
  marked.push({ line: line - 1, cls });
}
function showProblems(list) {
  const box = $('problems');
  const ul = $('problemsList');
  ul.innerHTML = '';
  clearMarks();
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;
  const errs = list.filter((p) => p.type === 'error').length;
  $('problemsTitle').textContent = errs ? `Lỗi (${errs})` : `Cảnh báo (${list.length})`;
  for (const p of list) {
    const d = document.createElement('div');
    d.className = 'problem ' + p.type;
    d.innerHTML = `<span class="ln">${p.line ? 'sketch.ino:' + p.line + (p.col ? ':' + p.col : '') : ''}</span>`;
    d.append(document.createTextNode((p.type === 'error' ? 'error: ' : 'warning: ') + p.msg));
    d.onclick = () => gotoLine(p.line, p.col);
    ul.append(d);
    markLine(p.line, p.type === 'error' ? 'cm-error-line' : 'cm-warn-line');
  }
}
function gotoLine(line, col) {
  if (!line) return;
  if (activeCodeTab !== 'sketch') $('codeTabs').querySelector('[data-tab=sketch]').click();
  cm.setCursor({ line: line - 1, ch: Math.max(0, (col || 1) - 1) });
  cm.scrollIntoView(null, 120);
  cm.focus();
}
$('problemsClose').onclick = () => { $('problems').hidden = true; };

// ---------------------------------------------------------------- serial monitor
const serialOut = $('serialOut');
let serialQueue = [];
let decoder = new TextDecoder('utf-8');
let atLineStart = true;
function serialWrite(port, s, boot) {
  const text = decoder.decode(binToBytes(s), { stream: true });
  if (text) serialQueue.push([boot ? 'boot' : '', text]);
}
function sysLog(level, msg) {
  serialQueue.push([level === 'error' ? 'err' : level === 'warn' ? 'warn' : 'sys', (atLineStartAfterQueue() ? '' : '\n') + msg + '\n']);
}
function atLineStartAfterQueue() {
  if (serialQueue.length) { const last = serialQueue[serialQueue.length - 1][1]; return last.endsWith('\n'); }
  return atLineStart;
}
function flushSerial() {
  if (!serialQueue.length) return;
  const frag = document.createDocumentFragment();
  for (const [cls, text0] of serialQueue) {
    let text = text0.replace(/\r\n/g, '\n').replace(/\r/g, '');
    if (settings.timestamps && !cls) {
      const t = runtime ? (runtime.millis() / 1000).toFixed(3) : '0.000';
      let out = '';
      for (const ch of text) { if (atLineStart) { frag.append(document.createTextNode(out)); out = ''; const sp = document.createElement('span'); sp.className = 'ts'; sp.textContent = `[${t}] `; frag.append(sp); } out += ch; atLineStart = ch === '\n'; }
      frag.append(document.createTextNode(out));
      continue;
    }
    if (cls) { const sp = document.createElement('span'); sp.className = cls; sp.textContent = text; frag.append(sp); }
    else frag.append(document.createTextNode(text));
    if (text) atLineStart = text.endsWith('\n');
  }
  serialQueue = [];
  serialOut.append(frag);
  while (serialOut.childNodes.length > 4000) serialOut.removeChild(serialOut.firstChild);
  if ($('autoscroll').checked) serialOut.scrollTop = serialOut.scrollHeight;
}
function sendSerial() {
  const inp = $('serialInput');
  const text = inp.value + $('lineEnding').value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  if (!runtime || !running) { toast('Hãy chạy mô phỏng trước khi gửi dữ liệu'); return; }
  runtime.serialIn.push(...binToBytes(utf8ToBin(text)));
  inp.value = '';
}
$('serialSend').onclick = sendSerial;
$('serialInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendSerial(); });
// line-ending select uses escaped values in markup
for (const o of $('lineEnding').options) o.value = o.value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

// ---------------------------------------------------------------- network log
const netLogEl = $('netLog');
let netUnread = 0;
function netLog(kind, msg, level) {
  const d = document.createElement('div');
  d.className = 'log-line' + (level === 'err' ? ' err' : msg.startsWith('↓') || msg.startsWith('←') ? ' in' : msg.startsWith('↑') || msg.startsWith('→') ? ' out' : '');
  const t = runtime ? (runtime.millis() / 1000).toFixed(2) + 's' : '';
  d.innerHTML = `<span class="t">${t}</span><span class="k">${kind.toUpperCase()}</span>`;
  d.append(document.createTextNode(msg));
  netLogEl.append(d);
  while (netLogEl.childNodes.length > 1500) netLogEl.removeChild(netLogEl.firstChild);
  if ($('autoscroll').checked) netLogEl.scrollTop = netLogEl.scrollHeight;
  if (activeBottom !== 'net') { netUnread++; $('netBadge').hidden = false; $('netBadge').textContent = netUnread; }
  if (level === 'err') sysLog('warn', `[${kind}] ${msg}`);
}

// bottom tabs
let activeBottom = 'serial';
for (const t of $('bottomTabs').querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    activeBottom = t.dataset.tab;
    $('bottomTabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.bottom .panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === activeBottom));
    if (activeBottom === 'net') { netUnread = 0; $('netBadge').hidden = true; }
  });
}
$('btnClear').onclick = () => {
  if (activeBottom === 'serial') serialOut.innerHTML = '';
  else if (activeBottom === 'net') netLogEl.innerHTML = '';
  else mqttPanel.clear();
};

// ---------------------------------------------------------------- audio (buzzer)
let audio = null;
const oscs = new Map();
function ensureAudio() {
  if (!audio && (window.AudioContext || window.webkitAudioContext)) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio && audio.state === 'suspended') audio.resume();
}
function sound(part, freq) {
  let o = oscs.get(part.id);
  if (!freq || !settings.sound || !running || !audio) {
    if (o) { o.osc.stop(); oscs.delete(part.id); }
    return;
  }
  if (!o) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    o = { osc, gain };
    oscs.set(part.id, o);
  }
  if (Math.abs(o.osc.frequency.value - freq) > 0.5) o.osc.frequency.setValueAtTime(freq, audio.currentTime);
}
function stopSounds() { for (const o of oscs.values()) o.osc.stop(); oscs.clear(); }

// ---------------------------------------------------------------- simulation control
async function detectProxy() {
  try {
    const r = await fetch('__proxy/ping', { cache: 'no-store' });
    settings.proxyAvailable = r.ok && (await r.text()).includes('esp32sim');
  } catch { settings.proxyAvailable = false; }
  settings.proxyUrl = '__proxy';
  $('proxyStatus').textContent = settings.proxyAvailable ? '✓ Đã phát hiện proxy của server.js' : '✗ Không có proxy (đang mở bằng server tĩnh khác) — một số API có thể bị CORS chặn.';
}

function setRunningUI(on, label, cls) {
  running = on;
  $('btnRun').disabled = false;
  $('btnRun').textContent = on ? '⟳' : '▶';
  $('btnRun').title = on ? 'Biên dịch lại và chạy (Ctrl+Enter)' : 'Biên dịch và chạy (Ctrl+Enter)';
  $('btnStop').disabled = !on;
  $('btnRestart').disabled = !on;
  $('simStatus').textContent = label;
  $('simStatus').className = 'sim-status ' + (cls || '');
  if (!on) $('wifiBadge').hidden = true;
  needsRender = true;
}

function run() {
  if (activeCodeTab === 'diagram' && !applyDiagramText()) return;
  stop(true);
  saveLocal();
  const src = sketchDoc.getValue();
  $('simStatus').textContent = 'Đang biên dịch…';
  let res;
  try {
    res = compile(src);
  } catch (e) {
    showProblems([{ type: 'error', line: e.line, col: e.col, msg: e.message }]);
    setRunningUI(false, 'Lỗi biên dịch', 'error');
    if (!e.line) console.error(e);
    return;
  }
  showProblems(res.warnings.map((w) => ({ type: 'warn', line: w.line, msg: w.msg })));
  if (!circuit.board()) { toast('Sơ đồ chưa có ESP32 — hãy thêm "ESP32 DevKit V1"'); setRunningUI(false, 'Thiếu ESP32', 'error'); return; }
  ensureAudio();
  serialOut.innerHTML = '';
  serialQueue = [];
  decoder = new TextDecoder('utf-8');
  atLineStart = true;
  for (const p of editor.parts) { p.pressed = p.pressed && p.type === 'wokwi-pushbutton' ? p.pressed : false; }
  const rt = new Runtime({
    sim: circuit,
    settings: { proxy: settings.proxy, proxyAvailable: settings.proxyAvailable, proxyUrl: settings.proxyUrl, brokers: settings.brokers },
    io: {
      serialWrite,
      log: (level, msg, line) => {
        sysLog(level, msg);
        if (level === 'error' && line) { showProblems([{ type: 'error', line, msg }]); }
      },
      net: netLog,
      wifi: (on) => { $('wifiBadge').hidden = !on; },
      restart: () => setTimeout(() => { sysLog('info', '— ESP32 khởi động lại —'); run(); }, 50),
      onStopped: (fromError) => { if (rt === runtime) { setRunningUI(false, fromError ? 'Dừng do lỗi' : 'Đã dừng', fromError ? 'error' : ''); stopSounds(); } },
    },
  });
  runtime = rt;
  setRunningUI(true, 'Đang chạy', 'running');
  rt.start(res.code);
}

function stop(silent) {
  if (runtime && !runtime.stopped) runtime.stop();
  stopSounds();
  if (!silent) setRunningUI(false, 'Đã dừng');
  for (const p of editor.parts) p.pressed = false;
  needsRender = true;
}

$('btnRun').onclick = run;
$('btnStop').onclick = () => stop();
$('btnRestart').onclick = run;

// ---------------------------------------------------------------- render loop
function partCtx(part) {
  return {
    running,
    V: (pin) => (running ? circuit.V(part, pin) : null),
    powered: (pins) => running && circuit.isPowered(part, pins),
    servoAngle: (pin) => {
      const g = circuit.gpioOnNet(part, pin);
      if (!g || !running) return null;
      if (g.servo != null) return g.servo;
      if (g.pwm != null && g.freq >= 40 && g.freq <= 400) {
        const us = (g.pwm * 1e6) / g.freq;
        return Math.max(0, Math.min(180, ((us - 544) / 1856) * 180));
      }
      return null;
    },
    toneOn: (plus, minus) => {
      if (!running) return 0;
      const g = circuit.gpioOnNet(part, plus);
      const vm = circuit.V(part, minus);
      if (!g || vm == null || vm > 0.5) return 0;
      return g.tone || 0;
    },
    sound,
  };
}
let lastBlink = 0;
function frame() {
  requestAnimationFrame(frame);
  flushSerial();
  if (running && runtime) {
    const ms = runtime.millis();
    $('simTime').textContent = `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  }
  const blink = Math.floor(performance.now() / 500);
  if (!running && !needsRender) return;
  needsRender = false;
  circuit.ensure();
  for (const part of editor.parts) {
    const def = PARTS[part.type];
    if (!part.el) continue;
    const ctx = partCtx(part);
    if (def.update) def.update(part, ctx);
    if (def.draw && part.canvas) {
      const powered = running && circuit.isPowered(part);
      const st = part.state;
      const wantsBlink = st && (st.blink) && blink !== lastBlink;
      if (part.drawKey !== powered || (st && st.dirty) || wantsBlink || part.drawnState !== st) {
        def.draw(part, part.canvas.getContext('2d'), powered);
        part.drawKey = powered;
        part.drawnState = st;
        if (st) st.dirty = false;
      }
    }
  }
  lastBlink = blink;
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- inspector
function renderInspector(item) {
  const box = $('inspector');
  box.innerHTML = '';
  if (!item) { box.hidden = true; return; }
  box.hidden = false;
  if (!item.el) {
    // wire
    box.innerHTML = `<h4>Dây nối</h4><div class="sub">${item.from} → ${item.to}</div><div class="field">Màu dây<div class="swatches"></div></div>
      <div class="field" style="font-size:11px">Nháy đúp lên dây để thêm điểm gấp, nháy đúp điểm gấp để xóa, kéo điểm gấp để chỉnh.</div>
      <div class="row"><button class="danger" id="insDel">🗑 Xóa dây</button></div>`;
    const sw = box.querySelector('.swatches');
    for (const c of WIRE_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (item.color === c ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => { item.color = c; editor.drawWires(); editor.changed(); renderInspector(item); };
      sw.append(b);
    }
    $('insDel').onclick = () => editor.deleteSelected();
    return;
  }
  const def = PARTS[item.type];
  box.innerHTML = `<h4>${def.label}</h4><div class="sub">id: ${item.id}${item.type === 'wokwi-esp32-devkit-v1' ? ' • LED_BUILTIN = GPIO2' : ''}</div>`;
  for (const a of def.attrs || []) {
    const f = document.createElement('label');
    f.className = 'field';
    const val = item.attrs[a.key] !== undefined ? item.attrs[a.key] : a.default;
    let input;
    if (a.type === 'select') {
      input = document.createElement('select');
      for (const o of a.options) { const op = document.createElement('option'); op.value = o; op.textContent = o; input.append(op); }
      input.value = String(val);
      input.onchange = () => { editor.setAttr(item, a.key, input.value); needsRender = true; };
      f.append(a.label, input);
    } else if (a.type === 'range') {
      const out = document.createElement('span');
      out.className = 'val';
      out.textContent = val;
      input = document.createElement('input');
      Object.assign(input, { type: 'range', min: a.min, max: a.max, step: a.step || 1, value: val });
      const num = document.createElement('input');
      Object.assign(num, { type: 'number', min: a.min, max: a.max, step: a.step || 1, value: val });
      num.style.width = '90px';
      input.oninput = () => { num.value = input.value; editor.setAttr(item, a.key, Number(input.value), true); needsRender = true; };
      input.onchange = () => editor.changed();
      num.onchange = () => { input.value = num.value; editor.setAttr(item, a.key, Number(num.value)); needsRender = true; };
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center';
      row.append(input, num);
      f.append(a.label, row);
    } else if (a.type === 'button') {
      input = document.createElement('button');
      input.textContent = a.text;
      input.type = 'button';
      input.onclick = (e) => { e.preventDefault(); if (!running) { toast('Hãy chạy mô phỏng trước'); return; } triggerMotion(item); needsRender = true; };
      f.append(a.label, input);
    } else {
      input = document.createElement('input');
      input.type = a.type === 'number' ? 'number' : 'text';
      input.value = val;
      input.onchange = () => { editor.setAttr(item, a.key, a.type === 'number' ? Number(input.value) : input.value); needsRender = true; };
      f.append(a.label, input);
    }
    box.append(f);
  }
  if (item.type === 'wokwi-pushbutton') box.insertAdjacentHTML('beforeend', '<div class="field" style="font-size:11px">Khi đang chạy: nhấn giữ chuột lên nút để nhấn.</div>');
  if (item.type === 'wokwi-slide-switch') box.insertAdjacentHTML('beforeend', '<div class="field" style="font-size:11px">Khi đang chạy: bấm lên công tắc để gạt.</div>');
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<button id="insRot" title="Xoay (R)">⟳ Xoay</button><button class="danger" id="insDel" title="Xóa (Delete)">🗑 Xóa</button>';
  box.append(row);
  $('insRot').onclick = () => editor.rotateSelected();
  $('insDel').onclick = () => editor.deleteSelected();
}

// ---------------------------------------------------------------- part palette
function openPalette() {
  const grid = $('partGrid');
  grid.innerHTML = '';
  const q = $('partSearch').value.trim().toLowerCase();
  const cats = {};
  for (const [type, def] of Object.entries(PARTS)) {
    if (q && !(def.label.toLowerCase().includes(q) || type.includes(q))) continue;
    (cats[def.category] = cats[def.category] || []).push([type, def]);
  }
  for (const [cat, list] of Object.entries(cats)) {
    const h = document.createElement('div');
    h.className = 'part-cat';
    h.textContent = cat;
    grid.append(h);
    for (const [type, def] of list) {
      const card = document.createElement('div');
      card.className = 'part-card';
      const fake = { type, id: 'x', attrs: defaultAttrs(type) };
      const { w, h: hh } = def.size(fake.attrs);
      card.innerHTML = `<div class="thumb"><svg viewBox="-4 -4 ${w + 8} ${hh + 8}" width="${Math.min(130, w * 1.2)}">${def.render(fake)}</svg></div><span>${def.label}</span>`;
      card.onclick = () => {
        const [cx, cy] = editor.center();
        const [px, py] = editor.freeSpot(cx - w / 2, cy - hh / 2, w, hh);
        const p = editor.addPart(type, px, py);
        if (p) { $('partModal').hidden = true; needsRender = true; }
      };
      grid.append(card);
    }
  }
}
$('btnAddPart').onclick = () => { $('partSearch').value = ''; openPalette(); $('partModal').hidden = false; $('partSearch').focus(); };
$('partSearch').oninput = openPalette;

// ---------------------------------------------------------------- toolbar / top bar
$('btnZoomIn').onclick = () => { const r = $('canvas').getBoundingClientRect(); editor.zoomAt(1.2, r.width / 2, r.height / 2); };
$('btnZoomOut').onclick = () => { const r = $('canvas').getBoundingClientRect(); editor.zoomAt(1 / 1.2, r.width / 2, r.height / 2); };
$('btnFit').onclick = () => editor.fit();

const exSel = $('exampleSelect');
let lastCat = null;
let group = null;
for (const ex of EXAMPLES) {
  if (ex.category !== lastCat) { group = document.createElement('optgroup'); group.label = ex.category; exSel.append(group); lastCat = ex.category; }
  const o = document.createElement('option');
  o.value = ex.id;
  o.textContent = ex.name;
  group.append(o);
}
exSel.onchange = () => {
  const ex = EXAMPLES.find((e) => e.id === exSel.value);
  exSel.value = '';
  if (!ex) return;
  if (!confirmReplace()) return;
  loadProject({ name: ex.name.replace(/^\d+\.\s*/, ''), code: ex.code, diagram: JSON.parse(JSON.stringify(ex.diagram)) });
  toast('Đã mở ví dụ: ' + ex.name);
};
function confirmReplace() {
  const saved = safeJson(localStorage.getItem(STORE_KEY));
  if (!saved) return true;
  const isExample = EXAMPLES.some((e) => e.code === saved.code) || saved.code === BLANK_CODE;
  return isExample || window.confirm('Thay thế dự án hiện tại? (Hãy "Lưu" trước nếu cần giữ lại)');
}
$('btnNew').onclick = () => { if (confirmReplace()) loadProject({ name: 'Dự án mới', code: BLANK_CODE, diagram: BLANK_DIAGRAM }); };
$('btnSave').onclick = (e) => {
  const p = currentProject();
  const name = (p.name || 'esp32-project').replace(/[^\w\-À-ỹ ]+/g, '').trim() || 'esp32-project';
  if (e.shiftKey) download(name + '.ino', p.code, 'text/plain');
  else download(name + '.json', JSON.stringify(p, null, 2), 'application/json');
  saveLocal();
};
$('btnOpen').onclick = () => $('fileInput').click();
$('fileInput').onchange = async () => {
  const f = $('fileInput').files[0];
  $('fileInput').value = '';
  if (!f) return;
  const text = await f.text();
  if (/\.(ino|txt)$/i.test(f.name)) { sketchDoc.setValue(text); toast('Đã mở ' + f.name); return; }
  const j = safeJson(text);
  if (!j) { toast('File không hợp lệ'); return; }
  if (j.code !== undefined) loadProject(j);
  else if (Array.isArray(j.parts)) { editor.load(j); editor.fit(); toast('Đã nạp diagram.json'); }
  else toast('Không nhận dạng được định dạng file');
};
$('btnShare').onclick = async () => {
  try {
    const json = JSON.stringify(currentProject());
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = location.origin + location.pathname + '#p=' + b64;
    history.replaceState(null, '', '#p=' + b64);
    try { await navigator.clipboard.writeText(url); toast('Đã sao chép link chia sẻ vào clipboard'); } catch { window.prompt('Link chia sẻ:', url); }
  } catch (e) { toast('Không tạo được link: ' + e.message); }
};
async function loadFromHash() {
  const m = /#p=([\w-]+)/.exec(location.hash);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  } catch { toast('Link chia sẻ bị lỗi'); return null; }
}
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('projectName').onchange = scheduleSave;

// modals
for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('pointerdown', (e) => { if (e.target === m) m.hidden = true; });
  m.querySelector('.modal-close').onclick = () => { m.hidden = true; };
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});
$('btnSettings').onclick = () => {
  $('setProxy').value = settings.proxy;
  const map = Object.assign({}, DEFAULT_BROKERS, settings.brokers);
  $('setBrokers').value = Object.entries(map).map(([h, u]) => `${h} = ${u}`).join('\n');
  $('setSound').checked = settings.sound;
  $('setTimestamps').checked = settings.timestamps;
  $('settingsModal').hidden = false;
};
$('settingsSave').onclick = () => {
  settings.proxy = $('setProxy').value;
  const map = {};
  for (const line of $('setBrokers').value.split('\n')) {
    const m = /^\s*([^=\s]+)\s*=\s*(\S+)\s*$/.exec(line);
    if (m && DEFAULT_BROKERS[m[1]] !== m[2]) map[m[1]] = m[2];
  }
  settings.brokers = map;
  settings.sound = $('setSound').checked;
  settings.timestamps = $('setTimestamps').checked;
  saveSettings();
  if (!settings.sound) stopSounds();
  $('settingsModal').hidden = true;
  toast('Đã lưu cài đặt (áp dụng cho lần chạy tiếp theo)');
};
$('btnHelp').onclick = () => { $('helpBody').innerHTML = HELP_HTML; $('helpModal').hidden = false; };

// ---------------------------------------------------------------- splitters
function dragSplit(gutter, onMove) {
  gutter.addEventListener('pointerdown', (e) => {
    gutter.setPointerCapture(e.pointerId);
    const move = (ev) => { onMove(ev); cm.refresh(); };
    const up = () => { gutter.removeEventListener('pointermove', move); gutter.removeEventListener('pointerup', up); };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
  });
}
dragSplit($('gutterV'), (e) => { $('codePane').style.width = Math.max(240, Math.min(window.innerWidth - 320, e.clientX)) + 'px'; });
dragSplit($('gutterH'), (e) => {
  const r = $('simPane').getBoundingClientRect();
  $('bottom').style.height = Math.max(70, Math.min(r.height - 160, r.bottom - e.clientY)) + 'px';
});

// ---------------------------------------------------------------- toast
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- MQTT panel
const mqttPanel = new MqttPanel({
  brokerSelect: $('mqttBroker'), url: $('mqttUrl'), connect: $('mqttConnect'), state: $('mqttState'),
  subTopic: $('mqttSubTopic'), sub: $('mqttSub'), subs: $('mqttSubs'),
  pubTopic: $('mqttPubTopic'), pubMsg: $('mqttPubMsg'), retain: $('mqttRetain'), pub: $('mqttPub'),
  log: $('mqttLog'), autoscroll: $('autoscroll'), brokers: () => Object.assign({}, DEFAULT_BROKERS, settings.brokers),
});

// ---------------------------------------------------------------- startup
(async () => {
  detectProxy();
  const shared = await loadFromHash();
  const saved = safeJson(localStorage.getItem(STORE_KEY));
  if (shared) { loadProject(shared); toast('Đã mở dự án từ link chia sẻ'); history.replaceState(null, '', location.pathname); }
  else if (saved && saved.diagram) loadProject(saved);
  else { const ex = EXAMPLES[0]; loadProject({ name: ex.name.replace(/^\d+\.\s*/, ''), code: ex.code, diagram: JSON.parse(JSON.stringify(ex.diagram)) }); }
  setTimeout(() => editor.fit(), 50);
})();
window.addEventListener('resize', () => cm.refresh());
window.__sim = { circuit, editor, get runtime() { return runtime; } };
