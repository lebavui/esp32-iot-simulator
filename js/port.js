// Move a project (sketch + diagram) to another board: board GPIOs are re-assigned on the new board (I2C to its
// SDA/SCL, analog inputs to ADC1 pins, the rest kept when possible), wires are moved to the new header pins, pin
// numbers in the sketch are rewritten, a missing on-board LED / BOOT button is replaced by an external part, and the
// moved wires are routed again around the parts (circuit/route.js).
// DOM-free (used by main.js and tests/t_port.mjs).
import { BOARDS, isBoard } from './boards.js';
import { PARTS, defaultAttrs } from './circuit/parts.js';
import { routeWires, pinExit } from './circuit/route.js';
import { CONSTS } from './runtime/meta.js';

const ANALOG_PINS = { 'esp32-iot-potentiometer': ['SIG'], 'esp32-iot-photoresistor-sensor': ['AO'] };
// calls whose first argument is a GPIO (Servo.attach, DHTesp.setup included)
const PIN_CALL = /\b(pinMode|digitalWrite|digitalRead|analogRead|analogReadMilliVolts|analogWrite|ledcAttach|ledcAttachPin|ledcAttachChannel|ledcDetach|tone|noTone|touchRead|pulseIn|pulseInLong|digitalPinToInterrupt|detachInterrupt|attach|setup|rgbLedWrite|neopixelWrite)\s*\(\s*([A-Za-z_]\w*|\d+)\s*(?=[,)\[])/g;
const CTOR_PIN = /\b(?:DHT|OneWire)\s+\w+\s*\(\s*([A-Za-z_]\w*|\d+)\s*(?=[,)])|\bAdafruit_NeoPixel\s+\w+\s*\(\s*[^,()]+,\s*([A-Za-z_]\w*|\d+)\s*(?=[,)])/g;
const WIRE_BEGIN = /\bWire\s*\.\s*begin\s*\(\s*([A-Za-z_]\w*|\d+)\s*,\s*([A-Za-z_]\w*|\d+)\s*(?=[,)])/g;

// A0…/D0…/T0… constants of a board → GPIO
function pinNames(type) {
  const b = BOARDS[type];
  const src = b.consts || Object.fromEntries(Object.entries(CONSTS).map(([k, v]) => [k, v[0]]));
  return Object.fromEntries(Object.entries(src).filter(([k]) => /^[ADT]\d+$/.test(k)));
}
const pinOf = (b, gpio) => Object.keys(b.gpio).find((n) => b.gpio[n] === gpio);
const powerPins = (b, v) => Object.keys(b.power).filter((n) => b.power[n] === v);

// comments and string/char literals blanked out (same length), so the regexes only see code
function maskCode(code) {
  return code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => m.replace(/[^\n]/g, ' '));
}

// Tokens of the sketch that denote a GPIO: { pos, text, gpio, analog }
function findPinRefs(code, srcType) {
  const m = maskCode(code);
  const names = pinNames(srcType);
  const refs = new Map();
  const pinIds = new Map(); // identifier used as a pin → analog?
  const add = (pos, text, analog) => {
    if (/^\d+$/.test(text)) refs.set(pos, { pos, text, gpio: Number(text), analog: analog || (refs.get(pos) || {}).analog });
    else if (names[text] != null) refs.set(pos, { pos, text, gpio: names[text], analog: analog || (refs.get(pos) || {}).analog });
    else pinIds.set(text, pinIds.get(text) || !!analog);
  };
  const at = (r, i) => r.index + r[0].lastIndexOf(r[i]);
  for (const r of m.matchAll(PIN_CALL)) add(at(r, 2), r[2], /^analogRead/.test(r[1]));
  for (const r of m.matchAll(CTOR_PIN)) { const i = r[1] ? 1 : 2; add(r.index + r[0].lastIndexOf(r[i]), r[i]); }
  for (const r of m.matchAll(WIRE_BEGIN)) { add(r.index + r[0].indexOf(r[1], r[0].indexOf('(')), r[1]); add(at(r, 2), r[2]); }
  // follow identifiers to their #define / initializer values (repeat for chains like #define A B)
  const done = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, analog] of [...pinIds]) {
      if (done.has(id + analog)) continue;
      done.add(id + analog);
      changed = true;
      const e = id.replace(/\$/g, '\\$');
      for (const r of m.matchAll(new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${e}[ \\t]+([A-Za-z_]\\w*|\\d+)[ \\t]*$`, 'gm'))) add(at(r, 1), r[1], analog);
      for (const r of m.matchAll(new RegExp(`(?<![\\w.>])${e}\\s*=(?!=)\\s*([A-Za-z_]\\w*|\\d+)\\s*(?=[,;)])`, 'g'))) add(at(r, 1), r[1], analog);
      for (const r of m.matchAll(new RegExp(`(?<![\\w.>])${e}\\s*\\[[^\\]]*\\]\\s*=\\s*\\{([^}]*)\\}`, 'g'))) {
        const base = r.index + r[0].lastIndexOf(r[1]);
        for (const t of r[1].matchAll(/[A-Za-z_]\w*|\d+/g)) add(base + t.index, t[0], analog);
      }
    }
  }
  // A0/D10/T3… anywhere are pins
  for (const r of m.matchAll(/\b[ADT]\d+\b/g)) if (names[r[0]] != null && !refs.has(r.index)) add(r.index, r[0]);
  return [...refs.values()].filter((r) => r.gpio != null);
}

// route: false skips wire routing (when only the sketch is needed)
export function portProject(project, target, { route = true } = {}) {
  const tgt = BOARDS[target];
  const diagram = JSON.parse(JSON.stringify(project.diagram || { version: 1, parts: [], connections: [] }));
  let code = project.code || '';
  const out = { code, diagram, changed: false, moves: [], added: [], lost: [], dropped: 0 };
  if (!tgt) return out;
  const bp = diagram.parts.find((p) => isBoard(p.type));
  if (!bp) {
    diagram.parts.unshift({ type: target, id: 'esp', top: 0, left: 0, attrs: {} });
    out.changed = true;
    return out;
  }
  if (bp.type === target) return out;
  const srcType = bp.type;
  const src = BOARDS[srcType];
  const id = bp.id;
  const partOf = (ref) => diagram.parts.find((p) => p.id === ref.split(':')[0]);
  const pinName = (ref) => ref.slice(ref.indexOf(':') + 1);
  const onBoard = (ref) => ref.split(':')[0] === id;

  const sz = (type, attrs) => PARTS[type].size(Object.assign(defaultAttrs(type), attrs || {}));
  const o = sz(srcType);
  const n = sz(target);
  // ---- what each source GPIO is used for
  const use = new Map(); // gpio → { wired, analog, sda, scl, side: < 0 parts on the left of the board, > 0 on the right }
  const u = (g) => { if (!use.has(g)) use.set(g, {}); return use.get(g); };
  const srcConsts = src.consts || { SDA: 21, SCL: 22 };
  for (const [a, b] of diagram.connections) {
    for (const [mine, other] of [[a, b], [b, a]]) {
      if (!onBoard(mine) || onBoard(other)) continue;
      const g = src.gpio[pinName(mine)];
      if (g == null) continue;
      const op = partOf(other);
      const opin = pinName(other);
      const x = u(g);
      x.wired = true;
      if (op) x.side = (x.side || 0) + (op.left + sz(op.type, op.attrs).w / 2 < bp.left + o.w / 2 ? -1 : 1);
      if (op && ANALOG_PINS[op.type] && ANALOG_PINS[op.type].includes(opin)) x.analog = true;
      if (op && PARTS[op.type] && PARTS[op.type].i2c && (opin === 'SDA' || opin === 'SCL') && g === srcConsts[opin]) x[opin.toLowerCase()] = true;
    }
  }
  const refs = findPinRefs(code, srcType);
  const toLed = []; // literal GPIO of the source on-board LED → LED_BUILTIN
  let bootUsed = false;
  for (const r of refs) {
    const x = use.get(r.gpio);
    if (!x && src.led && r.gpio === src.led.gpio && /^\d+$/.test(r.text)) { toLed.push(r); continue; }
    if (!x && src.boot && r.gpio === src.boot.gpio) bootUsed = true;
    u(r.gpio).analog = use.get(r.gpio).analog || r.analog;
  }

  // ---- assign target GPIOs
  const map = new Map();
  const taken = new Set();
  const usesI2C = [...use.values()].some((x) => x.sda || x.scl);
  const tc = tgt.consts || { SDA: 21, SCL: 22 };
  const reserved = new Set([tgt.led && tgt.led.gpio, tgt.boot && tgt.boot.gpio, ...(usesI2C ? [tc.SDA, tc.SCL] : [])].filter((g) => g != null));
  const give = (g, t) => { map.set(g, t); taken.add(t); };
  for (const [g, x] of use) {
    if (x.sda) give(g, tc.SDA);
    else if (x.scl) give(g, tc.SCL);
  }
  let needButton = false;
  if (bootUsed) {
    if (tgt.boot) give(src.boot.gpio, tgt.boot.gpio);
    else needButton = true; // gets a generic pin + an external push button
  }
  const onHeader = new Set(Object.values(tgt.gpio));
  // a pin on the header side facing the wired parts keeps the wires short
  const sideOk = (t, side) => !side || (tgt.left.includes(pinOf(tgt, t)) ? -1 : 1) === Math.sign(side);
  const avail = (t) => onHeader.has(t) && !taken.has(t) && !reserved.has(t);
  const free = (list, side) => list.find((t) => avail(t) && sideOk(t, side)) ?? list.find(avail);
  for (const kind of ['analog', 'digital']) {
    const list = tgt.prefer[kind];
    const pending = [...use].filter(([g, x]) => !map.has(g) && !(needButton && g === src.boot.gpio) && !!x.analog === (kind === 'analog')).map(([g]) => g);
    // same header position on a board of the same family (XIAO ↔ XIAO), else the same GPIO number
    const ok = (t, side) => t != null && list.includes(t) && !taken.has(t) && !reserved.has(t) && sideOk(t, side);
    const sameFamily = src.left.join() === tgt.left.join();
    const rest = pending.filter((g) => {
      const t = sameFamily ? tgt.gpio[pinOf(src, g)] : g;
      if (ok(t, use.get(g).side)) { give(g, t); return false; }
      return true;
    });
    for (const g of rest) {
      const side = use.get(g).side;
      const t = free(list, side) ?? (kind === 'analog' ? free(tgt.prefer.digital, side) : undefined);
      if (t == null) out.lost.push(g);
      else give(g, t);
    }
  }

  // keep the top-to-bottom order of the wired pins on each side of the new header (parts stay in the same order)
  const pinY = (type, name) => (PARTS[type].pins({}).find((q) => q.name === name) || {}).y;
  for (const kind of [true, false]) {
    for (const side of ['left', 'right']) {
      const gs = [...map.keys()].filter((g) => {
        const x = use.get(g);
        return x && x.wired && !x.sda && !x.scl && !!x.analog === kind && tgt[side].includes(pinOf(tgt, map.get(g)));
      });
      const ts = gs.map((g) => map.get(g)).sort((a, b) => pinY(target, pinOf(tgt, a)) - pinY(target, pinOf(tgt, b)));
      gs.sort((a, b) => pinY(srcType, pinOf(src, a)) - pinY(srcType, pinOf(src, b)));
      gs.forEach((g, i) => map.set(g, ts[i]));
    }
  }

  // ---- diagram: swap the board, move parts beside it, re-attach wires
  const ed = (p) => ({ id: p.id, type: p.type, x: p.left, y: p.top, rotate: p.rotate || 0, attrs: Object.assign(defaultAttrs(p.type), p.attrs || {}) });
  const pinXY = (ref) => { const p = partOf(ref); const e = p && pinExit(ed(p), pinName(ref)); return e ? e.pos : null; };
  // wires drawn straight across from a board pin to a part (aligned rows) in the original
  const straight = new Set();
  diagram.connections.forEach((c, i) => {
    if (Array.isArray(c[3]) && c[3].length) return;
    if (onBoard(c[0]) === onBoard(c[1])) return;
    const a = pinXY(c[0]), b = pinXY(c[1]);
    if (a && b && Math.abs(a[1] - b[1]) < 1) straight.add(i);
  });
  const shift = new Map();
  for (const p of diagram.parts) {
    if (p === bp) continue;
    const s = sz(p.type, p.attrs);
    let dx = 0, dy = 0;
    if (p.left + s.w / 2 > bp.left + o.w / 2) dx = n.w - o.w;
    if (p.top >= bp.top + o.h && p.left < bp.left + o.w && p.left + s.w > bp.left) dy = n.h - o.h;
    if (dx || dy) { p.left += dx; p.top += dy; }
    shift.set(p.id, [dx, dy]);
  }
  bp.type = target;
  bp.attrs = {};
  const sideOf = (ref) => {
    const p = partOf(ref);
    return p && p.left + sz(p.type, p.attrs).w / 2 < bp.left + n.w / 2 ? 'left' : 'right';
  };
  const powerFor = (srcPin, other) => {
    const v = src.power[srcPin];
    const cands = powerPins(tgt, v);
    if (cands.length < 2) return cands[0];
    const side = sideOf(other);
    return cands.find((c) => tgt[side].includes(c)) || cands[0];
  };
  // board ends moved to the new header
  const moved = diagram.connections.map((c) => {
    const ends = [c[0], c[1]];
    for (let i = 0; i < 2; i++) {
      if (!onBoard(ends[i])) continue;
      const p = pinName(ends[i]);
      let np = null;
      if (src.gpio[p] != null) { const t = map.get(src.gpio[p]); np = t != null ? pinOf(tgt, t) : null; }
      else if (src.power[p] != null) np = powerFor(p, ends[1 - i]);
      if (!np) return null;
      ends[i] = `${id}:${np}`;
    }
    return ends;
  });
  // keep straight wires straight: move the part, with the parts wired to it (not through the board), up/down to its
  // new pin's row when they fit there
  const boxOf = (p) => { const s = sz(p.type, p.attrs); return { x: p.left, y: p.top, w: s.w, h: s.h }; };
  // distance between two boxes (0 when they touch or overlap)
  const gap = (a, b) => Math.max(0, Math.max(b.x - a.x - a.w, a.x - b.x - b.w, b.y - a.y - a.h, a.y - b.y - b.h));
  const overlapping = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // moved by dy, q stays clear of r (as far as it was, up to 6 px — parts drawn touching may stay touching)
  const fits = (q, r, dy) => { const a = boxOf(q), b = boxOf(r), m = { ...a, y: a.y + dy }; return !overlapping(m, b) && gap(m, b) >= Math.min(6, gap(a, b)); };
  const groupOf = (p) => {
    const g = new Set([p]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of diagram.connections) {
        if (onBoard(c[0]) || onBoard(c[1])) continue;
        const [a, b] = [partOf(c[0]), partOf(c[1])];
        if (a && b && g.has(a) !== g.has(b)) { g.add(g.has(a) ? b : a); grew = true; }
      }
    }
    return g;
  };
  const aligned = new Set();
  for (const i of straight) {
    const ends = moved[i];
    if (!ends) continue;
    const [bref, pref] = onBoard(ends[0]) ? ends : [ends[1], ends[0]];
    const p = partOf(pref);
    if (aligned.has(p)) continue;
    const g = groupOf(p);
    for (const q of g) aligned.add(q);
    const dy = pinXY(bref)[1] - pinXY(pref)[1];
    if (!dy || [...g].some((q) => diagram.parts.some((r) => !g.has(r) && !fits(q, r, dy)))) continue;
    for (const q of g) {
      q.top += dy;
      const sh = shift.get(q.id) || [0, 0];
      shift.set(q.id, [sh[0], sh[1] + dy]);
    }
  }
  const conns = [];
  for (const [i, c] of diagram.connections.entries()) {
    const ends = moved[i];
    if (!ends) { out.dropped++; continue; }
    if (onBoard(c[0]) || onBoard(c[1])) conns.push([ends[0], ends[1], c[2]]); // routed again below
    else {
      const [s1, s2] = [shift.get(c[0].split(':')[0]) || [0, 0], shift.get(c[1].split(':')[0]) || [0, 0]];
      const same = s1[0] === s2[0] && s1[1] === s2[1];
      conns.push(same && Array.isArray(c[3]) ? [c[0], c[1], c[2], c[3].map(([x, y]) => [x + s1[0], y + s1[1]])] : [c[0], c[1], c[2]]);
    }
  }
  diagram.connections = conns;

  // free spot left of the board for an added group of parts (w×h)
  const place = (w, h) => {
    const hit = (x, y) => diagram.parts.some((p) => {
      const s = sz(p.type, p.attrs);
      return x < p.left + s.w + 15 && x + w + 15 > p.left && y < p.top + s.h + 15 && y + h + 15 > p.top;
    });
    for (let r = 0; r < 60; r++) {
      for (const [x, y] of [[bp.left - w - 40 - r * 20, bp.top + 10], [bp.left - w - 40, bp.top + 10 + r * 20], [bp.left - w - 40 - r * 20, bp.top + 10 + r * 20]]) {
        if (!hit(x, y)) return [Math.round(x / 5) * 5, Math.round(y / 5) * 5];
      }
    }
    return [bp.left - w - 40, bp.top];
  };
  const newId = (pre) => { let i = 1; while (diagram.parts.some((p) => p.id === pre + i)) i++; return pre + i; };
  const gnd = powerPins(tgt, 0).find((g) => tgt.left.includes(g)) || powerPins(tgt, 0)[0];
  const free2 = () => free(tgt.prefer.digital, -1); // added parts go left of the board

  // ---- sketch: rewrite pin numbers (from the end so positions stay valid)
  const tNames = pinNames(target);
  const edits = [];
  for (const r of refs) {
    if (toLed.includes(r)) { edits.push([r.pos, r.text, 'LED_BUILTIN']); continue; }
    const t = map.get(r.gpio);
    if (t == null) continue;
    let text = String(t);
    if (!/^\d+$/.test(r.text)) text = Object.keys(tNames).find((k) => k[0] === r.text[0] && tNames[k] === t) || text;
    if (text !== r.text) edits.push([r.pos, r.text, text]);
  }
  if (needButton) {
    const t = free2();
    if (t == null) out.lost.push(src.boot.gpio);
    else {
      give(src.boot.gpio, t);
      for (const r of refs) if (r.gpio === src.boot.gpio && !use.get(r.gpio).wired) edits.push([r.pos, r.text, String(t)]);
      const [x, y] = place(36, 48);
      const bid = newId('btn');
      diagram.parts.push({ type: 'esp32-iot-pushbutton', id: bid, top: y, left: x, attrs: { color: 'black' } });
      diagram.connections.push([`${id}:${pinOf(tgt, t)}`, `${bid}:1`, 'blue'], [`${bid}:2`, `${id}:${gnd}`, 'black']);
      out.added.push(`nút nhấn ${bid} thay nút BOOT (${pinOf(tgt, t)})`);
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [pos, from, to] of edits) code = code.slice(0, pos) + to + code.slice(pos + from.length);

  // on-board LED: an external LED + resistor on a free pin when the new board has none
  const m = maskCode(code);
  if (!tgt.led && /\b(LED_BUILTIN|BUILTIN_LED)\b/.test(m) && !/#\s*define\s+(LED_BUILTIN|BUILTIN_LED)\b/.test(m)) {
    const t = free2();
    if (t != null) {
      taken.add(t);
      const pn = pinOf(tgt, t);
      const [x, y] = place(100, 90);
      const lid = newId('led'), rid = newId('r');
      diagram.parts.push({ type: 'esp32-iot-led', id: lid, top: y, left: x, attrs: { color: 'yellow' } },
        { type: 'esp32-iot-resistor', id: rid, top: y + 70, left: x + 36, attrs: { value: '220' } });
      diagram.connections.push([`${id}:${pn}`, `${rid}:2`, 'green'], [`${rid}:1`, `${lid}:A`, 'green'], [`${lid}:C`, `${id}:${gnd}`, 'black']);
      const line = `#define LED_BUILTIN ${pn === String(t) ? t : pn}   // ${tgt.label} không có LED trên board: dùng LED ngoài ở GPIO${t}\n#define BUILTIN_LED LED_BUILTIN\n`;
      // after the leading comment block / includes
      const lines = code.split('\n');
      let k = 0;
      while (k < lines.length && /^\s*(\/\/|#\s*include|$)/.test(lines[k])) k++;
      lines.splice(k, 0, line.trimEnd());
      code = lines.join('\n');
      out.added.push(`LED ${lid} thay LED_BUILTIN (${pn})`);
    }
  }

  for (const [g, t] of [...map].sort((a, b) => a[0] - b[0])) {
    const a = pinOf(src, g) || `GPIO${g}`, b = pinOf(tgt, t) || `GPIO${t}`;
    const label = (bn, gg) => (/^\d+$/.test(bn) ? `GPIO${gg}` : bn === `D${gg}` ? bn : `${bn} (GPIO${gg})`);
    if (label(a, g) !== label(b, t)) out.moves.push(`${label(a, g)} → ${label(b, t)}`);
  }
  for (const r of toLed) out.moves.push(`GPIO${r.gpio} → LED_BUILTIN`);
  // a kept path that now runs through a part (parts moved by different amounts) is routed again
  diagram.connections = diagram.connections.map((c) => {
    if (!Array.isArray(c[3])) return c;
    const a = pinXY(c[0]), b = pinXY(c[1]);
    if (!a || !b) return c;
    const pts = [a, ...c[3], b];
    const own = [c[0], c[1]].map((r) => partOf(r));
    const through = diagram.parts.some((p) => {
      const r = boxOf(p);
      return pts.slice(1).some(([x2, y2], i) => {
        const [x1, y1] = pts[i];
        if ((i === 0 && p === own[0]) || (i === pts.length - 2 && p === own[1])) return false; // leaving its own pin
        return Math.max(x1, x2) > r.x && Math.min(x1, x2) < r.x + r.w && Math.max(y1, y2) > r.y && Math.min(y1, y2) < r.y + r.h;
      });
    });
    return through ? [c[0], c[1], c[2]] : c;
  });
  // route every wire left without a path around the parts
  const eparts = diagram.parts.map((p) => ({ id: p.id, type: p.type, x: p.left, y: p.top, rotate: p.rotate || 0, attrs: Object.assign(defaultAttrs(p.type), p.attrs || {}) }));
  const ws = (route ? routeWires : (_, w) => w)(eparts, diagram.connections.map((c) => ({ from: c[0], to: c[1], points: Array.isArray(c[3]) ? c[3] : null })));
  diagram.connections = diagram.connections.map((c, i) => [c[0], c[1], c[2], ws[i].points]);
  out.code = code;
  out.changed = true;
  return out;
}
