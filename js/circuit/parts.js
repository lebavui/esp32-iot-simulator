// Part definitions: geometry, pins, attributes, SVG visuals and electrical behaviour.
import { glyph } from '../font5x7.js';
import { BOARDS, ESP32_LEFT, ESP32_RIGHT } from '../boards.js';

const LED_COLORS = { red: '#ff3030', green: '#30e050', blue: '#3d7dff', yellow: '#ffe030', white: '#f4f4ff', orange: '#ff8a1a', purple: '#b04dff' };

export function parseOhms(v) {
  const m = /^\s*([\d.]+)\s*([kKmMrR]?)/.exec(String(v));
  if (!m) return 1000;
  let n = parseFloat(m[1]);
  if (m[2] === 'k' || m[2] === 'K') n *= 1e3;
  if (m[2] === 'M') n *= 1e6;
  return Math.max(0.1, n);
}

function resistorBands(ohms) {
  const colors = ['#000', '#7a4a1a', '#e02020', '#ff8c00', '#ffd700', '#20a020', '#2050e0', '#8a2be2', '#888', '#fff'];
  let exp = 0;
  let v = Math.round(ohms);
  if (v < 10) return [colors[0], colors[v] || colors[0], '#d4af37'];
  while (v >= 100) { v = Math.round(v / 10); exp++; }
  return [colors[Math.floor(v / 10)], colors[v % 10], colors[exp] || '#000'];
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Helper: pins on a straight row
const rowPins = (names, x0, dx, y) => names.map((n, i) => ({ name: n, x: x0 + i * dx, y }));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// LM393 comparator sensor module, pins VCC GND DO AO on the right (like the LDR module). sense(part) gives
// { ao: AO as a fraction of VCC, on: detected → DO pulled LOW and DO-LED lit }. The sensing element is drawn by
// `element` on the left of the 90×38 board, or by `probe` in a pw×ph area left of the board (rain plate, soil fork);
// `look(part)` updates its visuals from the attributes.
function comparatorModule({ label, attrs, sense, element = '', pw = 0, ph = 38, probe, look }) {
  const h = Math.max(38, ph);
  const by = Math.round((h - 38) / 2);
  const names = ['VCC', 'GND', 'DO', 'AO'];
  return {
    label, category: 'Cảm biến', power: ['VCC', 'GND'], analog: ['AO'], attrs,
    size: () => ({ w: pw + 98, h }),
    pins: () => names.map((name, i) => ({ name, x: pw + 96, y: by + 7 + i * 8 })),
    render(part) {
      return `${probe ? probe(part, h, by) : ''}<g transform="translate(${pw} ${by})">
      <rect x="0" y="0" width="90" height="38" rx="3" fill="#1e3f8a"/>
      ${names.map((n, i) => `<line x1="84" y1="${7 + i * 8}" x2="98" y2="${7 + i * 8}" stroke="#d4af37" stroke-width="2"/><text x="81" y="${9 + i * 8}" text-anchor="end" font-size="5" fill="#fff">${n}</text>`).join('')}
      ${element}
      <rect x="38" y="7" width="12" height="9" rx="1" fill="#222"/><text x="44" y="21" text-anchor="middle" font-size="3.5" fill="#cfd8ea">LM393</text>
      <rect x="54" y="6" width="12" height="12" fill="#2d6bd6" stroke="#ccc"/><circle cx="60" cy="12" r="3" fill="#eee"/>
      <rect x="42" y="27" width="5" height="3" fill="#e22"/><rect class="doled" x="54" y="27" width="5" height="3" fill="#300"/></g>`;
    },
    drive(part, api) {
      if (!api.powered(part)) return [];
      const vcc = api.V('VCC');
      const s = sense(part);
      return [{ pin: 'AO', v: vcc * clamp01(s.ao) }, { pin: 'DO', v: s.on ? api.V('GND') : vcc }];
    },
    update(part, ctx) {
      part.el.querySelector('.doled').setAttribute('fill', ctx.powered() && sense(part).on ? '#2f2' : '#300');
      if (look) look(part, ctx);
    },
  };
}

// ---------------------------------------------------------------- microcontroller boards (pin maps in boards.js)
// Common behaviour: power pins, the on-board LED (drawn from the GPIO state, so it also works for LEDs that are not
// on the header) and the BOOT button, which shorts its GPIO to GND while pressed (click the board while running).
function boardBehaviour(type) {
  const B = BOARDS[type];
  const bootPin = B.boot && Object.keys(B.gpio).find((n) => B.gpio[n] === B.boot.gpio);
  return {
    label: B.label, category: 'Vi điều khiển', unique: true, board: true, interactive: !!bootPin,
    drive(part, api) { return api.running ? Object.entries(B.power).map(([pin, v]) => ({ pin, v })) : []; },
    links: bootPin ? (part) => (part.pressed ? [[bootPin, 'GND', 0]] : []) : undefined,
    update(part, ctx) {
      const pwr = part.el.querySelector('.pwr-led');
      if (pwr) pwr.setAttribute('fill', ctx.running ? '#ff2020' : '#600');
      const led = part.el.querySelector('.b-led');
      if (!led || !B.led) return;
      const g = ctx.gpio(B.led.gpio);
      let lit = 0;
      if (g && g.mode & 2) {
        const level = g.pwm != null ? g.pwm : g.out ? 1 : 0;
        lit = B.led.activeLow ? 1 - level : level;
      }
      led.setAttribute('fill', lit > 0.02 ? led.dataset.on : led.dataset.off);
      led.setAttribute('opacity', lit > 0.02 ? (0.35 + 0.65 * lit).toFixed(2) : 1);
    },
  };
}

// Small boards with two castellated headers (XIAO, SuperMini): pins at x=8 / w-8, from y=26 every 12 px
function smallBoard(type, { w, h, pcb, title, sub, shield, antenna, leds }) {
  const B = BOARDS[type];
  const xr = w - 8;
  const pinY = (i) => 26 + i * 12;
  return {
    ...boardBehaviour(type),
    size: () => ({ w, h }),
    pins: () => [...B.left.map((n, i) => ({ name: n, x: 8, y: pinY(i) })), ...B.right.map((n, i) => ({ name: n, x: xr, y: pinY(i) }))],
    render() {
      const lbl = (n, x, y, anchor) => `<text x="${x}" y="${y + 2}" text-anchor="${anchor}" class="pl" font-size="5">${/^\d+$/.test(n) ? 'IO' + n : n}</text>`;
      const cx = w / 2;
      let s = `<rect x="0" y="8" width="${w}" height="${h - 8}" rx="6" fill="${pcb}"/>
      <rect x="${cx - 16}" y="0" width="32" height="15" rx="3" fill="#c0c4cc" stroke="#888"/><rect x="${cx - 11}" y="4" width="22" height="6" rx="2" fill="#555"/>
      <rect x="14" y="11" width="9" height="7" rx="1" fill="#ddd" stroke="#999"/><text x="25" y="16.5" font-size="3.5" fill="#bbb">B</text>
      <rect x="${w - 23}" y="11" width="9" height="7" rx="1" fill="#ddd" stroke="#999"/><text x="${w - 25}" y="16.5" text-anchor="end" font-size="3.5" fill="#bbb">R</text>`;
      if (shield) {
        s += `<rect x="28" y="30" width="${w - 56}" height="46" rx="2" fill="#c9ced6" stroke="#8b9099"/>
        <text x="${cx}" y="48" text-anchor="middle" font-size="6" fill="#444" font-family="monospace" font-weight="bold">XIAO</text>
        <text x="${cx}" y="58" text-anchor="middle" font-size="4.6" fill="#555" font-family="monospace">${shield}</text>
        <text x="${cx}" y="68" text-anchor="middle" font-size="3.6" fill="#666" font-family="sans-serif">Seeed Studio</text>`;
      } else {
        s += `<rect x="${cx - 13}" y="40" width="26" height="26" rx="1.5" fill="#2a2d33" stroke="#555"/>
        <text x="${cx}" y="55" text-anchor="middle" font-size="4" fill="#bbb" font-family="monospace">C3</text>`;
      }
      s += `<text x="${cx}" y="${shield ? 88 : 80}" text-anchor="middle" font-size="6" fill="#e0e0e0" font-family="sans-serif" font-weight="bold">${title}</text>
      <text x="${cx}" y="${shield ? 96 : 88}" text-anchor="middle" font-size="4" fill="#aaa" font-family="sans-serif">${sub}</text>`;
      if (antenna) s += `<rect x="${cx - 22}" y="${h - 18}" width="44" height="10" rx="1" fill="#d8d2c4" stroke="#a49c8a"/><text x="${cx}" y="${h - 11.5}" text-anchor="middle" font-size="3.6" fill="#665">ANT</text>`;
      for (const l of leds || []) {
        s += `<rect x="${l.x}" y="${l.y}" width="6" height="4" rx="0.8" fill="${l.off}" ${l.pwr ? 'class="pwr-led"' : `class="b-led" data-on="${l.on}" data-off="${l.off}"`}/>
        ${l.textRight ? `<text x="${l.x + 8}" y="${l.y + 3.5}" font-size="3.5" fill="#999">${l.text}</text>` : `<text x="${l.x + 3}" y="${l.y + 9}" text-anchor="middle" font-size="3.5" fill="#999">${l.text}</text>`}`;
      }
      B.left.forEach((n, i) => { s += `<circle cx="8" cy="${pinY(i)}" r="3.4" fill="#d4af37"/><circle cx="8" cy="${pinY(i)}" r="1.6" fill="#222"/>` + lbl(n, 14, pinY(i), 'start'); });
      B.right.forEach((n, i) => { s += `<circle cx="${xr}" cy="${pinY(i)}" r="3.4" fill="#d4af37"/><circle cx="${xr}" cy="${pinY(i)}" r="1.6" fill="#222"/>` + lbl(n, xr - 6, pinY(i), 'end'); });
      return s;
    },
  };
}

export const PARTS = {
  // ---------------------------------------------------------------- ESP32
  'esp32-iot-esp32-devkit-v1': {
    ...boardBehaviour('esp32-iot-esp32-devkit-v1'),
    size: () => ({ w: 124, h: 262 }),
    pins: () => [
      ...ESP32_LEFT.map((n, i) => ({ name: n, x: 8, y: 60 + i * 12 })),
      ...ESP32_RIGHT.map((n, i) => ({ name: n, x: 116, y: 60 + i * 12 })),
    ],
    render() {
      const lbl = (n, x, y, anchor) => `<text x="${x}" y="${y + 2}" text-anchor="${anchor}" class="pl">${n.replace(/\.\d$/, '')}</text>`;
      let s = `<rect x="0" y="0" width="124" height="262" rx="4" fill="#20232a"/>
      <rect x="30" y="4" width="64" height="104" rx="2" fill="#2b2f36"/>
      <path d="M36 9h6v10h4V9h6v10h4V9h6v10h4V9h6v12H36z" fill="none" stroke="#c9a227" stroke-width="1.6"/>
      <rect x="32" y="26" width="60" height="80" rx="2" fill="#b9bec6" stroke="#8b9099"/>
      <text x="62" y="52" text-anchor="middle" font-size="7" fill="#444" font-family="monospace">ESP32-WROOM</text>
      <text x="62" y="62" text-anchor="middle" font-size="5" fill="#555" font-family="monospace">WiFi + BT</text>
      <circle cx="62" cy="86" r="7" fill="none" stroke="#999"/><text x="62" y="88.5" text-anchor="middle" font-size="5.5" fill="#777">ESP</text>
      <text x="62" y="140" text-anchor="middle" font-size="7" fill="#d8d8d8" font-family="sans-serif" font-weight="bold">ESP32</text>
      <text x="62" y="150" text-anchor="middle" font-size="5" fill="#aaa" font-family="sans-serif">DEVKIT V1</text>
      <rect x="44" y="246" width="36" height="16" rx="2" fill="#c0c4cc" stroke="#888"/>
      <rect x="14" y="238" width="14" height="10" rx="2" fill="#444"/><circle cx="21" cy="243" r="3" fill="#111"/>
      <rect x="96" y="238" width="14" height="10" rx="2" fill="#444"/><circle cx="103" cy="243" r="3" fill="#111"/>
      <text x="21" y="256" text-anchor="middle" font-size="4.5" fill="#bbb">EN</text><text x="103" y="256" text-anchor="middle" font-size="4.5" fill="#bbb">BOOT</text>
      <rect x="36" y="232" width="6" height="4" fill="#600" class="pwr-led"/><text x="39" y="242" text-anchor="middle" font-size="4" fill="#999">PWR</text>
      <rect x="82" y="232" width="6" height="4" fill="#123" class="b-led" data-on="#3da5ff" data-off="#123"/><text x="85" y="242" text-anchor="middle" font-size="4" fill="#999">D2</text>`;
      ESP32_LEFT.forEach((n, i) => { s += `<rect x="3" y="${55 + i * 12}" width="10" height="10" fill="#111" rx="1"/><circle cx="8" cy="${60 + i * 12}" r="2.6" fill="#d4af37"/>` + lbl(n, 16, 60 + i * 12, 'start'); });
      ESP32_RIGHT.forEach((n, i) => { s += `<rect x="111" y="${55 + i * 12}" width="10" height="10" fill="#111" rx="1"/><circle cx="116" cy="${60 + i * 12}" r="2.6" fill="#d4af37"/>` + lbl(n, 108, 60 + i * 12, 'end'); });
      return s;
    },
  },
  'board-xiao-esp32-c3': smallBoard('board-xiao-esp32-c3', { w: 92, h: 110, pcb: '#1d1f24', title: 'XIAO', sub: 'ESP32-C3', shield: 'ESP32-C3' }),
  'board-xiao-esp32-s3': smallBoard('board-xiao-esp32-s3', {
    w: 92, h: 110, pcb: '#1d1f24', title: 'XIAO', sub: 'ESP32-S3', shield: 'ESP32-S3',
    leds: [{ x: 40, y: 19, on: '#ffb020', off: '#5a4410', text: 'L', textRight: true }],
  }),
  'board-esp32-c3-supermini': smallBoard('board-esp32-c3-supermini', {
    w: 92, h: 136, pcb: '#23262c', title: 'C3 SuperMini', sub: 'ESP32-C3', antenna: true,
    leds: [{ x: 30, y: 28, pwr: true, off: '#600', text: 'PWR' }, { x: 56, y: 28, on: '#3d8bff', off: '#13233f', text: 'IO8' }],
  }),

  // ---------------------------------------------------------------- passive / basic
  'esp32-iot-led': {
    label: 'LED', category: 'Cơ bản',
    attrs: [{ key: 'color', label: 'Màu', type: 'select', options: Object.keys(LED_COLORS), default: 'red' }],
    size: () => ({ w: 30, h: 66 }),
    pins: () => [{ name: 'A', x: 10, y: 64 }, { name: 'C', x: 20, y: 64 }],
    render(part) {
      const c = LED_COLORS[part.attrs.color] || LED_COLORS.red;
      return `<circle class="glow" cx="15" cy="17" r="15" fill="${c}" opacity="0" filter="url(#glow)"/>
      <line x1="20" y1="36" x2="20" y2="64" stroke="#9aa" stroke-width="1.8"/>
      <path d="M10 36v6l-3 4v18" stroke="#9aa" stroke-width="1.8" fill="none" transform="translate(3 0)"/>
      <text x="4" y="62" font-size="5" fill="#888">+</text>
      <path d="M5 36V15a10 10 0 0 1 20 0v21z" fill="${c}" opacity="0.55" stroke="${c}" stroke-width="0.6" class="body"/>
      <rect x="3" y="33" width="24" height="4" rx="1" fill="${c}" opacity="0.7"/>
      <path d="M9 10a6 6 0 0 1 6-4" stroke="#fff" stroke-width="1.4" fill="none" opacity="0.6"/>`;
    },
    update(part, ctx) {
      const va = ctx.V('A'), vc = ctx.V('C');
      let b = 0;
      if (va != null && vc != null) b = Math.max(0, Math.min(1, (va - vc - 0.3) / 2.5));
      part.el.querySelector('.glow').setAttribute('opacity', (b * 0.95).toFixed(2));
      part.el.querySelector('.body').setAttribute('opacity', (0.55 + b * 0.45).toFixed(2));
    },
  },
  'esp32-iot-resistor': {
    label: 'Điện trở', category: 'Cơ bản',
    attrs: [{ key: 'value', label: 'Giá trị (Ω)', type: 'text', default: '220' }],
    size: () => ({ w: 64, h: 12 }),
    pins: () => [{ name: '1', x: 2, y: 6 }, { name: '2', x: 62, y: 6 }],
    render(part) {
      const [b1, b2, b3] = resistorBands(parseOhms(part.attrs.value));
      return `<line x1="0" y1="6" x2="64" y2="6" stroke="#9aa" stroke-width="1.8"/>
      <rect x="16" y="1" width="32" height="10" rx="4" fill="#d9bf8f"/>
      <rect x="21" y="1" width="3" height="10" fill="${b1}"/><rect x="27" y="1" width="3" height="10" fill="${b2}"/>
      <rect x="33" y="1" width="3" height="10" fill="${b3}"/><rect x="41" y="1" width="3" height="10" fill="#d4af37"/>`;
    },
    links: (part) => [['1', '2', parseOhms(part.attrs.value)]],
  },
  'esp32-iot-pushbutton': {
    label: 'Nút nhấn', category: 'Cơ bản',
    attrs: [{ key: 'color', label: 'Màu', type: 'select', options: ['red', 'green', 'blue', 'yellow', 'white', 'black'], default: 'red' }],
    size: () => ({ w: 36, h: 48 }),
    pins: () => [{ name: '1', x: 8, y: 46 }, { name: '2', x: 28, y: 46 }],
    render(part) {
      const c = { red: '#d42020', green: '#1fa83a', blue: '#2060d0', yellow: '#e8c020', white: '#eee', black: '#222' }[part.attrs.color] || '#d42020';
      return `<line x1="8" y1="30" x2="8" y2="48" stroke="#9aa" stroke-width="1.8"/><line x1="28" y1="30" x2="28" y2="48" stroke="#9aa" stroke-width="1.8"/>
      <rect x="2" y="2" width="32" height="32" rx="3" fill="#2a2d33" stroke="#111"/>
      <circle cx="6" cy="6" r="1.6" fill="#555"/><circle cx="30" cy="6" r="1.6" fill="#555"/><circle cx="6" cy="30" r="1.6" fill="#555"/><circle cx="30" cy="30" r="1.6" fill="#555"/>
      <circle class="cap" cx="18" cy="18" r="10" fill="${c}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>`;
    },
    interactive: true,
    links: (part) => (part.pressed ? [['1', '2', 0]] : []),
    update(part) {
      const cap = part.el.querySelector('.cap');
      cap.setAttribute('r', part.pressed ? 8.5 : 10);
      cap.setAttribute('stroke-width', part.pressed ? 3 : 1.5);
    },
  },
  'esp32-iot-slide-switch': {
    label: 'Công tắc gạt', category: 'Cơ bản',
    attrs: [{ key: 'value', label: 'Vị trí', type: 'select', options: ['0', '1'], default: '0', live: true }],
    size: () => ({ w: 40, h: 44 }),
    pins: () => rowPins(['1', '2', '3'], 8, 12, 42),
    render() {
      return `<line x1="8" y1="26" x2="8" y2="44" stroke="#9aa" stroke-width="1.8"/><line x1="20" y1="26" x2="20" y2="44" stroke="#9aa" stroke-width="1.8"/><line x1="32" y1="26" x2="32" y2="44" stroke="#9aa" stroke-width="1.8"/>
      <rect x="2" y="8" width="36" height="18" rx="2" fill="#3a3f48" stroke="#222"/><rect x="5" y="12" width="30" height="10" rx="1" fill="#1d2025"/>
      <rect class="knob" x="6" y="4" width="13" height="18" rx="2" fill="#e8e8e8" stroke="#888"/>`;
    },
    interactive: true,
    links: (part) => (String(part.attrs.value) === '1' ? [['2', '3', 0]] : [['1', '2', 0]]),
    update(part) { part.el.querySelector('.knob').setAttribute('x', String(part.attrs.value) === '1' ? 21 : 6); },
  },
  'esp32-iot-potentiometer': {
    label: 'Biến trở', category: 'Cơ bản', analog: ['SIG'],
    attrs: [{ key: 'value', label: 'Giá trị (0–1023)', type: 'range', min: 0, max: 1023, step: 1, default: 512, live: true }],
    size: () => ({ w: 56, h: 70 }),
    pins: () => rowPins(['GND', 'SIG', 'VCC'], 12, 16, 68),
    render() {
      return `<line x1="12" y1="52" x2="12" y2="70" stroke="#9aa" stroke-width="1.8"/><line x1="28" y1="52" x2="28" y2="70" stroke="#9aa" stroke-width="1.8"/><line x1="44" y1="52" x2="44" y2="70" stroke="#9aa" stroke-width="1.8"/>
      <rect x="4" y="4" width="48" height="48" rx="4" fill="#1f5fbf" stroke="#174a94"/>
      <circle cx="28" cy="28" r="17" fill="#c9ccd2" stroke="#888"/><circle cx="28" cy="28" r="12" fill="#e2e4e8"/>
      <g class="knob"><rect x="26.5" y="13" width="3" height="11" rx="1" fill="#333"/></g>`;
    },
    links: (part) => {
      const v = Math.max(0, Math.min(1023, Number(part.attrs.value) || 0)) / 1023;
      return [['VCC', 'SIG', Math.max(1, 10000 * (1 - v))], ['SIG', 'GND', Math.max(1, 10000 * v)]];
    },
    update(part) {
      const v = Math.max(0, Math.min(1023, Number(part.attrs.value) || 0)) / 1023;
      part.el.querySelector('.knob').setAttribute('transform', `rotate(${-135 + v * 270} 28 28)`);
    },
  },
  'esp32-iot-rgb-led': {
    label: 'LED RGB', category: 'Cơ bản',
    attrs: [{ key: 'common', label: 'Chân chung', type: 'select', options: ['cathode', 'anode'], default: 'cathode' }],
    size: () => ({ w: 40, h: 66 }),
    pins: () => rowPins(['R', 'COM', 'G', 'B'], 8, 8, 64),
    render() {
      return `<circle class="glow" cx="20" cy="17" r="16" fill="#000" opacity="0" filter="url(#glow)"/>
      ${[8, 16, 24, 32].map((x) => `<line x1="${x}" y1="36" x2="${x}" y2="66" stroke="#9aa" stroke-width="1.6"/>`).join('')}
      <path d="M8 36V16a12 12 0 0 1 24 0v20z" fill="#eef" opacity="0.7" stroke="#bbc" class="body"/>
      <rect x="6" y="33" width="28" height="4" rx="1" fill="#dde" opacity="0.8"/>`;
    },
    update(part, ctx) {
      const com = ctx.V('COM');
      const ch = (p) => {
        const v = ctx.V(p);
        if (v == null || com == null) return 0;
        const d = part.attrs.common === 'anode' ? com - v : v - com;
        return Math.max(0, Math.min(1, (d - 0.3) / 2.5));
      };
      const r = ch('R'), g = ch('G'), b = ch('B');
      const m = Math.max(r, g, b);
      const col = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      part.el.querySelector('.glow').setAttribute('fill', col);
      part.el.querySelector('.glow').setAttribute('opacity', (m * 0.95).toFixed(2));
      part.el.querySelector('.body').setAttribute('fill', m > 0.02 ? col : '#eef');
    },
  },
  // kitPin: the signal pin goes to the board's buzzer GPIO (BOARDS[…].buzzer) when a project is moved to another board
  'esp32-iot-buzzer': {
    label: 'Còi (buzzer)', category: 'Cơ bản', kitPin: '2',
    size: () => ({ w: 40, h: 52 }),
    pins: () => [{ name: '1', x: 15, y: 50 }, { name: '2', x: 25, y: 50 }],
    render() {
      return `<line x1="15" y1="34" x2="15" y2="52" stroke="#9aa" stroke-width="1.8"/><line x1="25" y1="34" x2="25" y2="52" stroke="#9aa" stroke-width="1.8"/>
      <circle cx="20" cy="20" r="17" fill="#1b1b1b" stroke="#000"/><circle cx="20" cy="20" r="4" fill="#333"/>
      <text x="29" y="10" font-size="7" fill="#ddd">+</text>
      <g class="waves" opacity="0" stroke="#4aa3ff" fill="none" stroke-width="1.5"><path d="M34 8a16 16 0 0 1 0 24"/><path d="M38 4a22 22 0 0 1 0 32"/></g>`;
    },
    update(part, ctx) {
      const f = ctx.toneOn('2', '1');
      part.el.querySelector('.waves').setAttribute('opacity', f ? 1 : 0);
      ctx.sound(part, f);
    },
  },

  // ---------------------------------------------------------------- sensors
  'esp32-iot-photoresistor-sensor': {
    label: 'Cảm biến ánh sáng (LDR)', category: 'Cảm biến', power: ['VCC', 'GND'], analog: ['AO'],
    attrs: [{ key: 'lux', label: 'Độ sáng (lux)', type: 'range', min: 1, max: 2000, step: 1, default: 500, live: true },
      { key: 'threshold', label: 'Ngưỡng DO (lux)', type: 'number', default: 100 }],
    size: () => ({ w: 98, h: 38 }),
    pins: () => [{ name: 'VCC', x: 96, y: 7 }, { name: 'GND', x: 96, y: 15 }, { name: 'DO', x: 96, y: 23 }, { name: 'AO', x: 96, y: 31 }],
    render() {
      return `<rect x="0" y="0" width="90" height="38" rx="3" fill="#1e3f8a"/>
      ${['VCC', 'GND', 'DO', 'AO'].map((n, i) => `<line x1="84" y1="${7 + i * 8}" x2="98" y2="${7 + i * 8}" stroke="#d4af37" stroke-width="2"/><text x="81" y="${9 + i * 8}" text-anchor="end" font-size="5" fill="#fff">${n}</text>`).join('')}
      <circle cx="15" cy="19" r="10" fill="#e8d9a8" stroke="#a88"/><path d="M9 15h12M9 19h12M9 23h12" stroke="#a33" stroke-width="1.2"/>
      <rect x="34" y="9" width="12" height="12" fill="#2d6bd6" stroke="#ccc"/><circle cx="40" cy="15" r="3" fill="#eee"/>
      <rect class="doled" x="52" y="27" width="5" height="3" fill="#300"/><rect x="52" y="20" width="5" height="3" fill="#e22"/>`;
    },
    drive(part, api) {
      if (!api.powered(part)) return [];
      const vcc = api.V('VCC');
      const lux = Math.max(0.1, Number(part.attrs.lux) || 0.1);
      const R = 50000 * Math.pow(10 / lux, 0.7); // RL10 = 50kΩ, gamma 0.7
      const ao = (vcc * R) / (R + 10000);
      const dark = lux < Number(part.attrs.threshold || 100);
      return [{ pin: 'AO', v: ao }, { pin: 'DO', v: dark ? vcc : 0 }];
    },
    update(part, ctx) { part.el.querySelector('.doled').setAttribute('fill', ctx.powered() && Number(part.attrs.lux) >= Number(part.attrs.threshold || 100) ? '#2f2' : '#300'); },
  },
  'esp32-iot-dht22': {
    label: 'DHT22 (nhiệt độ/độ ẩm)', category: 'Cảm biến', power: ['VCC', 'GND'],
    attrs: [{ key: 'temperature', label: 'Nhiệt độ (°C)', type: 'range', min: -40, max: 80, step: 0.1, default: 24, live: true },
      { key: 'humidity', label: 'Độ ẩm (%)', type: 'range', min: 0, max: 100, step: 0.5, default: 40, live: true }],
    size: () => ({ w: 40, h: 72 }),
    pins: () => rowPins(['VCC', 'SDA', 'NC', 'GND'], 8, 8, 70),
    render() {
      let holes = '';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) holes += `<rect x="${7 + c * 7}" y="${7 + r * 6}" width="5" height="3.5" rx="1" fill="#9fa6b0"/>`;
      return `${[8, 16, 24, 32].map((x) => `<line x1="${x}" y1="52" x2="${x}" y2="72" stroke="#9aa" stroke-width="1.6"/>`).join('')}
      <rect x="2" y="2" width="36" height="52" rx="3" fill="#f2f4f6" stroke="#bbb"/>${holes}
      <text x="20" y="49" text-anchor="middle" font-size="6" fill="#666" font-weight="bold">DHT22</text>`;
    },
  },
  'esp32-iot-dht11': {
    label: 'DHT11 (nhiệt độ/độ ẩm)', category: 'Cảm biến', power: ['VCC', 'GND'],
    attrs: [{ key: 'temperature', label: 'Nhiệt độ (°C)', type: 'range', min: 0, max: 50, step: 1, default: 25, live: true },
      { key: 'humidity', label: 'Độ ẩm (%)', type: 'range', min: 20, max: 90, step: 1, default: 50, live: true }],
    size: () => ({ w: 40, h: 72 }),
    pins: () => rowPins(['VCC', 'SDA', 'NC', 'GND'], 8, 8, 70),
    render() {
      let holes = '';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) holes += `<rect x="${7 + c * 7}" y="${7 + r * 6}" width="5" height="3.5" rx="1" fill="#1d4f9a"/>`;
      return `${[8, 16, 24, 32].map((x) => `<line x1="${x}" y1="52" x2="${x}" y2="72" stroke="#9aa" stroke-width="1.6"/>`).join('')}
      <rect x="2" y="2" width="36" height="52" rx="3" fill="#3b8ae6" stroke="#246"/>${holes}
      <text x="20" y="49" text-anchor="middle" font-size="6" fill="#fff" font-weight="bold">DHT11</text>`;
    },
  },
  'esp32-iot-hc-sr04': {
    label: 'HC-SR04 (siêu âm)', category: 'Cảm biến', power: ['VCC', 'GND'],
    attrs: [{ key: 'distance', label: 'Khoảng cách (cm)', type: 'range', min: 2, max: 400, step: 1, default: 100, live: true }],
    size: () => ({ w: 112, h: 62 }),
    pins: () => rowPins(['VCC', 'TRIG', 'ECHO', 'GND'], 41, 10, 60),
    render() {
      const tr = (x) => `<circle cx="${x}" cy="24" r="18" fill="#c8ccd2" stroke="#888"/><circle cx="${x}" cy="24" r="13" fill="#3a3d42"/><circle cx="${x}" cy="24" r="10" fill="none" stroke="#555" stroke-dasharray="1.5 1.5"/>`;
      return `${[41, 51, 61, 71].map((x) => `<line x1="${x}" y1="46" x2="${x}" y2="62" stroke="#d4af37" stroke-width="1.8"/>`).join('')}
      <rect x="0" y="2" width="112" height="46" rx="3" fill="#1d5fb0"/>${tr(26)}${tr(86)}
      <rect x="49" y="8" width="14" height="8" fill="#ccc"/>
      ${['VCC', 'Trig', 'Echo', 'GND'].map((n, i) => `<text x="${41 + i * 10}" y="44" text-anchor="middle" font-size="4.2" fill="#fff">${n}</text>`).join('')}`;
    },
  },
  'esp32-iot-pir-motion-sensor': {
    label: 'Cảm biến chuyển động PIR', category: 'Cảm biến', power: ['VCC', 'GND'],
    attrs: [{ key: 'motion', label: 'Chuyển động', type: 'button', text: 'Mô phỏng chuyển động (5 giây)', live: true }],
    size: () => ({ w: 64, h: 66 }),
    pins: () => rowPins(['VCC', 'OUT', 'GND'], 22, 10, 64),
    render() {
      return `${[22, 32, 42].map((x) => `<line x1="${x}" y1="52" x2="${x}" y2="66" stroke="#d4af37" stroke-width="1.8"/>`).join('')}
      <rect x="2" y="2" width="60" height="52" rx="3" fill="#2e7d32"/>
      <circle class="dome" cx="32" cy="28" r="22" fill="#f4f4f4" stroke="#ccc"/>
      <path d="M14 28h36M32 10v36M19 15l26 26M45 15L19 41" stroke="#ddd" stroke-width="0.8"/>`;
    },
    interactive: true,
    drive(part, api) {
      if (!api.powered(part)) return [];
      const on = part.motionUntil && part.motionUntil > Date.now();
      return [{ pin: 'OUT', v: on ? api.V('VCC') : 0 }];
    },
    update(part) {
      const on = part.motionUntil && part.motionUntil > Date.now();
      part.el.querySelector('.dome').setAttribute('fill', on ? '#ffe0b0' : '#f4f4f4');
    },
  },
  // IR flame sensor: more flame → lower AO; DO LOW when the flame exceeds the trimmer threshold
  'esp32-iot-flame-sensor': comparatorModule({
    label: 'Cảm biến lửa (IR)',
    attrs: [{ key: 'flame', label: 'Cường độ lửa (%)', type: 'range', min: 0, max: 100, step: 1, default: 0, live: true },
      { key: 'threshold', label: 'Ngưỡng DO (%)', type: 'number', default: 40 }],
    sense: (p) => ({ ao: 0.98 - 0.9 * num(p.attrs.flame) / 100, on: num(p.attrs.flame) >= num(p.attrs.threshold, 40) }),
    pw: 24,
    probe: () => `<path class="fire" d="M12 30C3 27 3 18 9 10c0 6 4 6 4 2 5 4 8 9 6 14-1 3-3 4-7 4z" fill="#ff7a1a" stroke="#ffd23f" stroke-width="1.2" opacity="0"/>`,
    element: `<line x1="0" y1="17" x2="8" y2="17" stroke="#ccc" stroke-width="1.4"/><line x1="0" y1="21" x2="8" y2="21" stroke="#ccc" stroke-width="1.4"/>
      <rect x="8" y="12" width="10" height="14" fill="#111"/><path d="M18 12h6a7 7 0 0 1 0 14h-6z" fill="#151515" stroke="#333"/>`,
    look(part) { part.el.querySelector('.fire').setAttribute('opacity', (num(part.attrs.flame) / 100).toFixed(2)); },
  }),
  // MQ-2 gas/smoke sensor: sensing resistance Rs follows the datasheet's LPG curve, log(Rs/R0) = -0.455·log(ppm) + 1.251
  // (Rs/R0 = 9.83 in clean air), R0 = 10 kΩ, load resistor RL = 5 kΩ on the module: AO = VCC·RL/(RL+Rs) rises with the
  // concentration; DO LOW above the threshold
  'esp32-iot-mq2': comparatorModule({
    label: 'Cảm biến khí gas MQ-2',
    attrs: [{ key: 'gas', label: 'Nồng độ khí (ppm)', type: 'range', min: 0, max: 10000, step: 10, default: 300, live: true },
      { key: 'threshold', label: 'Ngưỡng DO (ppm)', type: 'number', default: 2000 }],
    sense: (p) => {
      const g = Math.max(0, num(p.attrs.gas));
      const ratio = g > 0 ? Math.min(9.83, 10 ** (-0.455 * Math.log10(g) + 1.251)) : 9.83;
      return { ao: 5 / (5 + 10 * ratio), on: g >= num(p.attrs.threshold, 2000) };
    },
    element: `<circle cx="18" cy="19" r="16" fill="#b8bcc4" stroke="#7c828c"/><circle class="mesh" cx="18" cy="19" r="11.5" fill="#8d939b"/>
      <path d="M8 14h20M7 19h22M8 24h20M13 9v20M18 8v22M23 9v20" stroke="#6b7079" stroke-width="0.7"/>`,
    look(part) {
      const k = clamp01(num(part.attrs.gas) / 10000);
      part.el.querySelector('.mesh').setAttribute('fill', `rgb(${Math.round(141 - k * 60)},${Math.round(147 - k * 80)},${Math.round(155 - k * 110)})`);
    },
  }),
  // rain sensor: plate + comparator board; wetter plate → lower AO; DO LOW when wet
  'esp32-iot-rain-sensor': comparatorModule({
    label: 'Cảm biến mưa',
    attrs: [{ key: 'rain', label: 'Mức mưa (%)', type: 'range', min: 0, max: 100, step: 1, default: 0, live: true },
      { key: 'threshold', label: 'Ngưỡng DO (%)', type: 'number', default: 30 }],
    sense: (p) => ({ ao: 0.98 - 0.85 * num(p.attrs.rain) / 100, on: num(p.attrs.rain) >= num(p.attrs.threshold, 30) }),
    pw: 76, ph: 56,
    probe: (part, h, by) => {
      let comb = '';
      for (let i = 0; i < 6; i++) comb += `<path d="M${i % 2 ? 60 : 6} ${10 + i * 7}H${i % 2 ? 12 : 54}" stroke="#d8dde3" stroke-width="2.2"/>`;
      let drops = '';
      for (const [x, y] of [[14, 14], [40, 9], [28, 30], [50, 40], [18, 44], [56, 22]]) drops += `<ellipse class="drop" cx="${x}" cy="${y}" rx="3" ry="4" fill="#5fb4ff" opacity="0"/>`;
      return `<rect x="0" y="0" width="66" height="${h}" rx="3" fill="#1f3b70"/>
        <path d="M5 4V52M61 4V52" stroke="#d8dde3" stroke-width="2.2"/>${comb}${drops}
        <path d="M66 ${by + 16}H76M66 ${by + 22}H76" stroke="#555" stroke-width="1.6"/>`;
    },
    look(part) {
      const r = num(part.attrs.rain) / 100;
      part.el.querySelectorAll('.drop').forEach((d, i) => d.setAttribute('opacity', r > i / 6 ? 0.9 : 0));
    },
  }),
  // soil moisture probe (resistive fork): moister soil → lower AO; DO LOW when moist (HIGH = dry, needs water)
  'esp32-iot-soil-moisture-sensor': comparatorModule({
    label: 'Cảm biến độ ẩm đất',
    attrs: [{ key: 'moisture', label: 'Độ ẩm đất (%)', type: 'range', min: 0, max: 100, step: 1, default: 35, live: true },
      { key: 'threshold', label: 'Ngưỡng DO (%)', type: 'number', default: 40 }],
    sense: (p) => ({ ao: 0.95 - 0.7 * num(p.attrs.moisture) / 100, on: num(p.attrs.moisture) >= num(p.attrs.threshold, 40) }),
    pw: 46, ph: 84,
    probe: (part, h, by) => `<rect class="soil" x="0" y="34" width="38" height="${h - 34}" rx="3" fill="#8a6a45"/>
      <rect x="4" y="2" width="30" height="18" rx="2" fill="#1f3b70"/>
      <path d="M7 20V74l3.5 8 3.5-8V20zM24 20V74l3.5 8 3.5-8V20z" fill="#c9cfd6" stroke="#8a929c" stroke-width="0.8"/>
      <path d="M34 ${by + 16}H46M34 ${by + 22}H46" stroke="#555" stroke-width="1.6"/>`,
    look(part) {
      const m = clamp01(num(part.attrs.moisture) / 100);
      part.el.querySelector('.soil').setAttribute('fill', `rgb(${Math.round(160 - m * 95)},${Math.round(125 - m * 75)},${Math.round(85 - m * 50)})`);
    },
  }),
  // water level sensor (exposed traces): output S rises with the immersed length
  'esp32-iot-water-level-sensor': {
    label: 'Cảm biến mực nước', category: 'Cảm biến', power: ['VCC', 'GND'], analog: ['S'],
    attrs: [{ key: 'level', label: 'Mực nước (%)', type: 'range', min: 0, max: 100, step: 1, default: 30, live: true }],
    size: () => ({ w: 40, h: 100 }),
    pins: () => rowPins(['S', 'VCC', 'GND'], 12, 8, 2),
    render() {
      let traces = '';
      for (let i = 0; i < 10; i++) traces += `<rect x="${7 + i * 2.6}" y="${i % 2 ? 36 : 40}" width="1.4" height="${i % 2 ? 54 : 54}" fill="#d9c27a"/>`;
      return `${[12, 20, 28].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="12" stroke="#d4af37" stroke-width="1.8"/>`).join('')}
      <rect x="4" y="10" width="32" height="88" rx="3" fill="#c62b2b"/>
      ${['S', '+', '−'].map((n, i) => `<text x="${12 + i * 8}" y="19" text-anchor="middle" font-size="5" fill="#fff">${n}</text>`).join('')}
      <circle cx="20" cy="27" r="2" fill="#e22"/>${traces}
      <rect class="water" x="0" y="98" width="40" height="0" fill="#3d8bff" opacity="0.45"/>`;
    },
    drive(part, api) {
      if (!api.powered(part)) return [];
      return [{ pin: 'S', v: api.V('VCC') * 0.85 * clamp01(num(part.attrs.level) / 100) }];
    },
    update(part) {
      const hgt = 60 * clamp01(num(part.attrs.level) / 100);
      const w = part.el.querySelector('.water');
      w.setAttribute('y', (98 - hgt).toFixed(1));
      w.setAttribute('height', hgt.toFixed(1));
    },
  },

  // ---------------------------------------------------------------- actuators / displays
  'esp32-iot-servo': {
    label: 'Động cơ Servo', category: 'Chấp hành',
    size: () => ({ w: 124, h: 52 }),
    pins: () => [{ name: 'GND', x: 2, y: 18 }, { name: 'V+', x: 2, y: 26 }, { name: 'PWM', x: 2, y: 34 }],
    render() {
      return `<line x1="0" y1="18" x2="22" y2="18" stroke="#6b3e1d" stroke-width="2.5"/><line x1="0" y1="26" x2="22" y2="26" stroke="#d22" stroke-width="2.5"/><line x1="0" y1="34" x2="22" y2="34" stroke="#f90" stroke-width="2.5"/>
      <rect x="22" y="8" width="80" height="36" rx="3" fill="#2463b8" stroke="#16457f"/>
      <rect x="14" y="20" width="8" height="12" fill="#2463b8"/><rect x="102" y="20" width="8" height="12" fill="#2463b8"/>
      <circle cx="80" cy="26" r="11" fill="#1d4f94"/>
      <g class="horn"><path d="M80 22 L116 24 a2.5 2.5 0 0 1 0 4 L80 30 z" fill="#f2f2f2" stroke="#999"/><circle cx="80" cy="26" r="6" fill="#f2f2f2" stroke="#999"/></g>
      <circle cx="80" cy="26" r="2" fill="#777"/>`;
    },
    update(part, ctx) {
      const a = ctx.servoAngle('PWM');
      if (a != null && ctx.powered(['V+', 'GND'])) part.angle = a;
      const ang = part.angle == null ? 90 : part.angle;
      part.el.querySelector('.horn').setAttribute('transform', `rotate(${90 - ang} 80 26)`);
    },
  },
  // 1-channel relay module: coil driven from IN (active HIGH or LOW), contacts COM–NO closed while energized,
  // COM–NC otherwise. The contact state depends on solved voltages, so the solver settles it (see circuit.js).
  'esp32-iot-relay-module': {
    label: 'Module relay 1 kênh', category: 'Chấp hành', power: ['VCC', 'GND'],
    attrs: [{ key: 'trigger', label: 'Mức kích', type: 'select', options: ['high', 'low'], default: 'high' }],
    size: () => ({ w: 112, h: 56 }),
    pins: () => [{ name: 'VCC', x: 2, y: 16 }, { name: 'GND', x: 2, y: 28 }, { name: 'IN', x: 2, y: 40 },
      { name: 'NO', x: 110, y: 13 }, { name: 'COM', x: 110, y: 28 }, { name: 'NC', x: 110, y: 43 }],
    render(part) {
      return `${[16, 28, 40].map((y) => `<line x1="0" y1="${y}" x2="12" y2="${y}" stroke="#d4af37" stroke-width="2"/>`).join('')}
      ${[13, 28, 43].map((y) => `<line x1="98" y1="${y}" x2="112" y2="${y}" stroke="#bbb" stroke-width="2"/>`).join('')}
      <rect x="8" y="2" width="94" height="52" rx="3" fill="#1d5fb0"/>
      ${['VCC', 'GND', 'IN'].map((n, i) => `<text x="14" y="${18 + i * 12}" font-size="5" fill="#fff">${n}</text>`).join('')}
      <rect x="28" y="7" width="40" height="42" rx="2" fill="#2148c9" stroke="#15308a"/>
      <text x="48" y="14" text-anchor="middle" font-size="4" fill="#dfe6ff">SRD-05VDC</text>
      <text x="48" y="47" text-anchor="middle" font-size="4" fill="#dfe6ff">${part.attrs.trigger === 'low' ? 'LOW' : 'HIGH'} trigger</text>
      <circle cx="36" cy="28" r="1.8" fill="#fff"/><circle cx="60" cy="19" r="1.8" fill="#fff"/><circle cx="60" cy="37" r="1.8" fill="#fff"/>
      <line class="arm" x1="36" y1="28" x2="59" y2="37" stroke="#fff" stroke-width="1.6"/>
      <rect x="76" y="5" width="22" height="46" rx="2" fill="#2e8bd8" stroke="#1a5f99"/>
      ${[13, 28, 43].map((y) => `<circle cx="87" cy="${y}" r="5" fill="#ccd" stroke="#889"/><path d="M84 ${y}h6" stroke="#556" stroke-width="1.2"/>`).join('')}
      ${['NO', 'COM', 'NC'].map((n, i) => `<text x="74" y="${15 + i * 15}" text-anchor="end" font-size="4.5" fill="#fff">${n}</text>`).join('')}
      <rect x="15" y="44" width="5" height="3" fill="#e22"/><rect class="act" x="15" y="6" width="5" height="3" fill="#030"/>`;
    },
    links: (part) => (part.energized ? [['COM', 'NO', 0]] : [['COM', 'NC', 0]]),
    settle(part, api) {
      const vin = api.V('IN'), gnd = api.V('GND');
      let on = false;
      if (api.powered() && vin != null) on = part.attrs.trigger === 'low' ? vin - gnd < 1.0 : vin - gnd >= 1.5;
      if (on === !!part.energized) return false;
      part.energized = on;
      return true;
    },
    update(part) {
      part.el.querySelector('.arm').setAttribute('y2', part.energized ? 19 : 37);
      part.el.querySelector('.act').setAttribute('fill', part.energized ? '#2f2' : '#030');
    },
  },
  'esp32-iot-lamp': {
    label: 'Bóng đèn', category: 'Chấp hành',
    attrs: [{ key: 'volt', label: 'Điện áp định mức (V)', type: 'number', default: 5 }],
    size: () => ({ w: 40, h: 62 }),
    pins: () => [{ name: '1', x: 14, y: 60 }, { name: '2', x: 26, y: 60 }],
    render() {
      return `<circle class="glow" cx="20" cy="18" r="17" fill="#ffd54a" opacity="0" filter="url(#glow)"/>
      <line x1="14" y1="44" x2="14" y2="62" stroke="#9aa" stroke-width="1.8"/><line x1="26" y1="44" x2="26" y2="62" stroke="#9aa" stroke-width="1.8"/>
      <circle class="bulb" cx="20" cy="18" r="15" fill="#f2f2e8" opacity="0.75" stroke="#bbb"/>
      <path d="M15 32v-8l3-6 2 4 2-4 3 6v8" stroke="#8a7a5a" stroke-width="1" fill="none"/>
      <rect x="12" y="32" width="16" height="12" rx="2" fill="#a8adb4" stroke="#7a8088"/><path d="M12 36h16M12 40h16" stroke="#7a8088"/>`;
    },
    links: () => [['1', '2', 30]],
    update(part, ctx) {
      const a = ctx.V('1'), b = ctx.V('2');
      const k = a == null || b == null ? 0 : clamp01(Math.abs(a - b) / Math.max(0.5, num(part.attrs.volt, 5)));
      part.el.querySelector('.glow').setAttribute('opacity', (k * 0.95).toFixed(2));
      part.el.querySelector('.bulb').setAttribute('fill', k > 0.05 ? `rgb(255,${Math.round(225 + 25 * k)},${Math.round(150 - 60 * k)})` : '#f2f2e8');
    },
  },
  'esp32-iot-7segment': {
    label: 'LED 7 đoạn', category: 'Hiển thị',
    attrs: [{ key: 'common', label: 'Loại', type: 'select', options: ['cathode', 'anode'], default: 'cathode' },
      { key: 'color', label: 'Màu', type: 'select', options: ['red', 'green', 'blue', 'yellow', 'white'], default: 'red' }],
    size: () => ({ w: 60, h: 92 }),
    pins: () => [...rowPins(['G', 'F', 'COM.1', 'A', 'B'], 10, 10, 2), ...rowPins(['E', 'D', 'COM.2', 'C', 'DP'], 10, 10, 90)],
    render() {
      const seg = {
        A: 'M20 17h20', B: 'M42 19v22', C: 'M42 49v22', D: 'M20 73h20', E: 'M18 49v22', F: 'M18 19v22', G: 'M20 45h20',
      };
      return `${[10, 20, 30, 40, 50].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="8" stroke="#d4af37" stroke-width="1.8"/><line x1="${x}" y1="84" x2="${x}" y2="92" stroke="#d4af37" stroke-width="1.8"/>`).join('')}
      <rect x="2" y="7" width="56" height="78" rx="2" fill="#2a2a2a"/>
      <g transform="skewX(-6) translate(5 0)">${Object.entries(seg).map(([k, d]) => `<path class="s${k}" d="${d}" stroke="#4a2020" stroke-width="5" stroke-linecap="round"/>`).join('')}
      <circle class="sDP" cx="50" cy="74" r="2.8" fill="#4a2020"/></g>`;
    },
    links: () => [['COM.1', 'COM.2', 0]],
    update(part, ctx) {
      const on = { red: '#ff2a2a', green: '#2aff4a', blue: '#4a8aff', yellow: '#ffe02a', white: '#fff' }[part.attrs.color] || '#ff2a2a';
      const off = '#3a2222';
      const com = ctx.V('COM.1');
      for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']) {
        const v = ctx.V(s);
        let lit = false;
        if (v != null && com != null) lit = part.attrs.common === 'anode' ? com - v > 1.5 : v - com > 1.5;
        const el = part.el.querySelector('.s' + s);
        el.setAttribute(s === 'DP' ? 'fill' : 'stroke', lit ? on : off);
        el.setAttribute('filter', lit ? 'url(#glow2)' : '');
      }
    },
  },
  'esp32-iot-lcd1602': {
    label: 'LCD 16x2 / 20x4 (I2C)', category: 'Hiển thị', power: ['VCC', 'GND'], i2c: 'lcd',
    attrs: [{ key: 'size', label: 'Kích thước', type: 'select', options: ['16x2', '20x4'], default: '16x2' },
      { key: 'address', label: 'Địa chỉ I2C', type: 'select', options: ['0x27', '0x3F'], default: '0x27' },
      { key: 'color', label: 'Màu nền', type: 'select', options: ['green', 'blue'], default: 'green' }],
    size(attrs) { const [c, r] = (attrs.size || '16x2').split('x').map(Number); return { w: c * 12 + 60, h: r * 19 + 48 }; },
    pins(attrs) { const h = this.size(attrs).h; return rowPins(['GND', 'VCC', 'SDA', 'SCL'], 0, 0, 0).map((p, i) => ({ name: p.name, x: 3, y: h / 2 - 15 + i * 10 })); },
    render(part) {
      const { w, h } = this.size(part.attrs);
      const [c, r] = (part.attrs.size || '16x2').split('x').map(Number);
      const sw = c * 12 + 8, sh = r * 19 + 8;
      const pinsY = this.pins(part.attrs);
      return `<rect x="8" y="0" width="${w - 8}" height="${h}" rx="3" fill="#1b6b2a"/>
      ${[[14, 4], [w - 6, 4], [14, h - 4], [w - 6, h - 4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#ccc"/>`).join('')}
      ${pinsY.map((p) => `<line x1="0" y1="${p.y}" x2="14" y2="${p.y}" stroke="#d4af37" stroke-width="2"/><text x="17" y="${p.y + 2}" font-size="5" fill="#fff">${p.name}</text>`).join('')}
      <rect x="${(w + 8 - sw) / 2 - 8}" y="${(h - sh) / 2 - 8}" width="${sw + 16}" height="${sh + 16}" rx="2" fill="#111"/>`;
    },
    canvas(part) {
      const { w, h } = this.size(part.attrs);
      const [c, r] = (part.attrs.size || '16x2').split('x').map(Number);
      const sw = c * 12 + 8, sh = r * 19 + 8;
      return { x: (w + 8 - sw) / 2, y: (h - sh) / 2, w: sw, h: sh, scale: 3 };
    },
    draw(part, ctx2d, powered) {
      const [cols, rows] = (part.attrs.size || '16x2').split('x').map(Number);
      const blue = part.attrs.color === 'blue';
      const st = part.state;
      const lit = powered && st && st.backlight;
      const bg = blue ? (lit ? '#2f5cff' : '#0e1f6b') : (lit ? '#9fd341' : '#4d6b1c');
      const on = blue ? '#e8f0ff' : '#1d2a0a';
      const offPix = blue ? (lit ? '#3a68ff' : '#13267a') : (lit ? '#93c63b' : '#4a6619');
      const S = 3;
      ctx2d.fillStyle = bg;
      ctx2d.fillRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);
      const off = [0x00, 0x40, 0x14, 0x54];
      const blinkOn = Math.floor(Date.now() / 500) % 2 === 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let code = 0x20;
          let isCursor = false;
          if (powered && st && st.on) {
            const base = off[r];
            const lineStart = base >= 0x40 ? 0x40 : 0x00;
            const col = (((base - lineStart) + c + (st.shift || 0)) % 40);
            const addr = lineStart + col;
            code = st.ddram[addr];
            isCursor = addr === st.addr;
          }
          const x0 = (4 + c * 12) * S, y0 = (4 + r * 19) * S;
          let rowsBits;
          if (code < 16) rowsBits = Array.from(st ? st.cgram[code & 7] : new Uint8Array(8));
          else {
            const g = glyph(code, 'lcd');
            rowsBits = [];
            for (let y = 0; y < 8; y++) { let b = 0; for (let x = 0; x < 5; x++) if ((g[x] >> y) & 1) b |= 1 << (4 - x); rowsBits.push(b); }
          }
          for (let y = 0; y < 8; y++) {
            let bits = rowsBits[y] || 0;
            if (isCursor && st.cursor && y === 7) bits = 0x1f;
            if (isCursor && st.blink && blinkOn) bits = 0x1f;
            for (let x = 0; x < 5; x++) {
              ctx2d.fillStyle = (bits >> (4 - x)) & 1 ? on : offPix;
              ctx2d.fillRect(x0 + x * 2 * S + S * 0.15, y0 + y * 2 * S + S * 0.15, 2 * S - S * 0.3, 2 * S - S * 0.3);
            }
          }
        }
      }
    },
  },
  'esp32-iot-ssd1306': {
    label: 'OLED SSD1306 128x64 (I2C)', category: 'Hiển thị', power: ['VCC', 'GND'], i2c: 'oled',
    attrs: [{ key: 'address', label: 'Địa chỉ I2C', type: 'select', options: ['0x3C', '0x3D'], default: '0x3C' }],
    size: () => ({ w: 140, h: 100 }),
    pins: () => rowPins(['GND', 'VCC', 'SCL', 'SDA'], 49, 14, 3),
    render() {
      return `<rect x="0" y="0" width="140" height="100" rx="4" fill="#1a3b8c"/>
      ${[6, 134].map((x) => [6, 94].map((y) => `<circle cx="${x}" cy="${y}" r="3" fill="#dde"/>`).join('')).join('')}
      ${['GND', 'VCC', 'SCL', 'SDA'].map((n, i) => `<circle cx="${49 + i * 14}" cy="3" r="2.6" fill="#d4af37"/><text x="${49 + i * 14}" y="13" text-anchor="middle" font-size="5" fill="#fff">${n}</text>`).join('')}
      <rect x="4" y="16" width="132" height="80" rx="1" fill="#0b0b0b"/>`;
    },
    canvas: () => ({ x: 6, y: 24, w: 128, h: 64, scale: 2 }),
    draw(part, ctx2d, powered) {
      const st = part.state;
      const W = 128, H = 64, S = 2;
      ctx2d.fillStyle = '#05070a';
      ctx2d.fillRect(0, 0, W * S, H * S);
      if (!powered || !st || !st.on) return;
      ctx2d.fillStyle = '#9ad8ff';
      const inv = st.inverted;
      if (inv) { ctx2d.fillRect(0, 0, W * S, H * S); ctx2d.fillStyle = '#05070a'; }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (st.fb[y * st.w + x]) ctx2d.fillRect(x * S, y * S, S, S);
    },
  },
  'esp32-iot-neopixel-strip': {
    label: 'NeoPixel (WS2812) dải LED', category: 'Hiển thị', power: ['VDD', 'VSS'],
    attrs: [{ key: 'pixels', label: 'Số LED', type: 'number', default: 8, min: 1, max: 32 }],
    size: (a) => ({ w: 18 + Math.max(1, Math.min(32, Number(a.pixels) || 8)) * 24, h: 38 }),
    pins: () => [{ name: 'DIN', x: 2, y: 11 }, { name: 'VDD', x: 2, y: 19 }, { name: 'VSS', x: 2, y: 27 }],
    render(part) {
      const n = Math.max(1, Math.min(32, Number(part.attrs.pixels) || 8));
      const w = 18 + n * 24;
      let s = `<rect x="6" y="2" width="${w - 6}" height="34" rx="3" fill="#ececec" stroke="#bbb"/>
      ${['DIN', 'VDD', 'VSS'].map((nm, i) => `<line x1="0" y1="${11 + i * 8}" x2="10" y2="${11 + i * 8}" stroke="#d4af37" stroke-width="2"/>`).join('')}`;
      for (let i = 0; i < n; i++) s += `<rect x="${14 + i * 24}" y="8" width="20" height="20" rx="2" fill="#fafafa" stroke="#ccc"/><circle class="px${i}" cx="${24 + i * 24}" cy="18" r="6" fill="#ddd"/>`;
      return s;
    },
    update(part, ctx) {
      const n = Math.max(1, Math.min(32, Number(part.attrs.pixels) || 8));
      const st = part.state;
      const pw = ctx.powered();
      for (let i = 0; i < n; i++) {
        const c = pw && st && st.colors[i] ? st.colors[i] : [0, 0, 0];
        const m = Math.max(...c);
        const el = part.el.querySelector('.px' + i);
        if (!el) continue;
        el.setAttribute('fill', m > 2 ? `rgb(${c.map((x) => Math.min(255, Math.round(x * (255 / Math.max(m, 1)) * Math.min(1, 0.4 + m / 160)))).join(',')})` : '#ddd');
        el.setAttribute('filter', m > 2 ? 'url(#glow2)' : '');
      }
    },
  },

  // ---------------------------------------------------------------- communication
  // SX1278 LoRa module on SPI (LoRa.h). Packets go over the simulator's virtual radio (other open tabs);
  // the button queues a test packet as if received from another node (part.inbox, read by LoRaClass).
  'esp32-iot-lora-ra02': {
    label: 'LoRa SX1278 (Ra-02)', category: 'Truyền thông', power: ['VCC', 'GND'], spi: true,
    attrs: [{ key: 'msg', label: 'Gói tin thử', type: 'text', default: 'Xin chao tu node LoRa!' },
      { key: 'rssi', label: 'RSSI gói thử (dBm)', type: 'range', min: -120, max: -30, step: 1, default: -70 },
      { key: 'inject', label: 'Khi đang chạy', type: 'button', text: 'Nhận gói tin thử' }],
    size: () => ({ w: 86, h: 92 }),
    pins: () => ['VCC', 'GND', 'NSS', 'SCK', 'MOSI', 'MISO', 'RST', 'DIO0'].map((name, i) => ({ name, x: 2, y: 11 + i * 10 })),
    render() {
      const names = ['VCC', 'GND', 'NSS', 'SCK', 'MOSI', 'MISO', 'RST', 'DIO0'];
      return `${names.map((n, i) => `<line x1="0" y1="${11 + i * 10}" x2="12" y2="${11 + i * 10}" stroke="#d4af37" stroke-width="2"/><text x="14" y="${13 + i * 10}" font-size="4.6" fill="#fff">${n}</text>`).join('')}
      <rect x="8" y="2" width="76" height="88" rx="3" fill="#20262e"/>
      <path d="M70 18V12l-4-2 8-2-8-2 8-2-8-2" stroke="#d4af37" stroke-width="1.3" fill="none"/>
      <rect x="34" y="16" width="44" height="58" rx="2" fill="#c8ccd2" stroke="#8d939b"/>
      <text x="56" y="34" text-anchor="middle" font-size="7" font-weight="bold" fill="#3a3f48">Ra-02</text>
      <text x="56" y="45" text-anchor="middle" font-size="5" fill="#3a3f48">SX1278</text>
      <text x="56" y="54" text-anchor="middle" font-size="5" fill="#3a3f48">433MHz LoRa</text>
      <rect class="tx" x="40" y="80" width="6" height="4" fill="#300"/><text x="48" y="84" font-size="4" fill="#ccc">TX</text>
      <rect class="rx" x="60" y="80" width="6" height="4" fill="#030"/><text x="68" y="84" font-size="4" fill="#ccc">RX</text>`;
    },
    onButton(part) {
      (part.inbox = part.inbox || []).push({ text: String(part.attrs.msg ?? ''), rssi: num(part.attrs.rssi, -70) });
    },
    update(part) {
      const t = Date.now();
      part.el.querySelector('.tx').setAttribute('fill', part.txUntil > t ? '#f33' : '#300');
      part.el.querySelector('.rx').setAttribute('fill', part.rxUntil > t ? '#3f3' : '#030');
    },
  },
};

export function partDef(type) { return PARTS[type]; }
export function partSize(part) { return PARTS[part.type].size(part.attrs); }
export function partPins(part) { return PARTS[part.type].pins(part.attrs); }
export function defaultAttrs(type) {
  const o = {};
  for (const a of PARTS[type].attrs || []) if (a.default !== undefined) o[a.key] = a.default;
  return o;
}
export { esc };
