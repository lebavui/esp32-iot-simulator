// Diagram editor: parts placement, wiring, pan/zoom, selection, property inspector.
import { PARTS, partSize, partPins, defaultAttrs } from './parts.js';
import { routeWires } from './route.js';

const ID_PREFIX = {
  'esp32-iot-esp32-devkit-v1': 'esp', 'esp32-iot-led': 'led', 'esp32-iot-resistor': 'r', 'esp32-iot-pushbutton': 'btn',
  'esp32-iot-slide-switch': 'sw', 'esp32-iot-potentiometer': 'pot', 'esp32-iot-rgb-led': 'rgb', 'esp32-iot-buzzer': 'bz',
  'esp32-iot-photoresistor-sensor': 'ldr', 'esp32-iot-dht22': 'dht', 'esp32-iot-dht11': 'dht', 'esp32-iot-hc-sr04': 'ultrasonic',
  'esp32-iot-pir-motion-sensor': 'pir', 'esp32-iot-servo': 'servo', 'esp32-iot-7segment': 'sevseg', 'esp32-iot-lcd1602': 'lcd',
  'esp32-iot-ssd1306': 'oled', 'esp32-iot-neopixel-strip': 'strip',
};
export const WIRE_COLORS = ['green', 'red', 'black', 'blue', 'yellow', 'orange', 'purple', 'gray', 'white', 'brown', 'cyan', 'magenta'];
const SVGNS = 'http://www.w3.org/2000/svg';

function defaultWireColor(a, b) {
  const s = (a + ' ' + b).toUpperCase();
  if (/:GND|:VSS|:COM|:C\b|:-/.test(s) && /GND/.test(s)) return 'black';
  if (/:(3V3|VIN|VCC|V\+|VDD)\b/.test(s)) return 'red';
  if (/GND|VSS/.test(s)) return 'black';
  return 'green';
}

export class DiagramEditor {
  constructor(root, circuit, cb) {
    this.root = root;
    this.circuit = circuit;
    this.cb = cb; // { onChange(), onSelect(item), isRunning(), onInteract(part) }
    this.parts = [];
    this.wires = [];
    this.view = { x: 40, y: 40, z: 1.4 };
    this.sel = null;
    this.wiring = null;
    this.world = document.createElement('div');
    this.world.className = 'world';
    this.partsLayer = document.createElement('div');
    this.partsLayer.className = 'parts-layer';
    this.wireSvg = document.createElementNS(SVGNS, 'svg');
    this.wireSvg.classList.add('wires-layer');
    this.pinsLayer = document.createElement('div');
    this.pinsLayer.className = 'pins-layer';
    this.world.append(this.partsLayer, this.wireSvg, this.pinsLayer);
    this.tip = document.createElement('div');
    this.tip.className = 'pin-tip';
    root.append(this.world, this.tip);
    // shared SVG filters
    const defs = document.createElementNS(SVGNS, 'svg');
    defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
    defs.innerHTML = `<defs><filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="glow2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
    root.append(defs);
    this.bindEvents();
    this.applyView();
  }

  // ---------------- model ----------------
  load(diagram) {
    this.partsLayer.innerHTML = '';
    this.pinsLayer.innerHTML = '';
    this.wireSvg.innerHTML = '';
    this.parts = [];
    this.wires = [];
    this.sel = null;
    for (const p of diagram.parts || []) {
      const type = String(p.type).replace(/^wokwi-/, 'esp32-iot-');   // part ids of projects saved before the rename
      if (!PARTS[type]) continue;
      this.addPart(type, p.left || 0, p.top || 0, { id: p.id, rotate: p.rotate || 0, attrs: Object.assign(defaultAttrs(type), p.attrs || {}) }, true);
    }
    for (const c of diagram.connections || []) {
      const [from, to, color, points] = c;
      if (!this.pinExists(from) || !this.pinExists(to)) continue;
      this.wires.push({ from, to, color: color || defaultWireColor(from, to), points: Array.isArray(points) ? points.filter((pt) => Array.isArray(pt)) : null });
    }
    // connections without a route are routed around the parts
    routeWires(this.parts, this.wires);
    this.sync();
    this.select(null);
  }

  serialize() {
    return {
      version: 1,
      author: 'ESP32 IoT Simulator',
      editor: 'esp32-iot-sim',
      parts: this.parts.map((p) => ({ type: p.type, id: p.id, top: Math.round(p.y), left: Math.round(p.x), rotate: p.rotate || 0, attrs: Object.assign({}, p.attrs) })),
      connections: this.wires.map((w) => [w.from, w.to, w.color, w.points.map(([x, y]) => [Math.round(x), Math.round(y)])]),
    };
  }

  pinExists(ref) {
    const [id, pin] = splitRef(ref);
    const p = this.parts.find((x) => x.id === id);
    return !!(p && partPins(p).some((q) => q.name === pin));
  }

  newId(type) {
    const pre = ID_PREFIX[type] || 'part';
    if (PARTS[type].board && !this.parts.some((p) => p.id === 'esp')) return 'esp';
    let i = 1;
    while (this.parts.some((p) => p.id === pre + i)) i++;
    return pre + i;
  }

  addPart(type, x, y, opts = {}, silent) {
    const def = PARTS[type];
    if (def.unique && this.parts.some((p) => p.type === type)) { this.cb.toast && this.cb.toast('Chỉ được có một ' + def.label); return null; }
    const other = def.board && this.parts.find((p) => PARTS[p.type].board);
    if (other && !silent) { this.cb.toast && this.cb.toast(`Sơ đồ chỉ được có một board vi điều khiển — hãy xóa ${PARTS[other.type].label} trước`); return null; }
    const part = { type, id: opts.id || this.newId(type), x, y, rotate: opts.rotate || 0, attrs: opts.attrs || defaultAttrs(type), state: null };
    this.parts.push(part);
    this.renderPart(part);
    if (!silent) { this.sync(); this.select(part); this.changed(); }
    return part;
  }

  // Find a position near (x, y) where a w×h part does not overlap existing parts
  freeSpot(x, y, w, h) {
    const hit = (px, py) => this.parts.some((p) => {
      const sz = partSize(p);
      return px < p.x + sz.w + 15 && px + w + 15 > p.x && py < p.y + sz.h + 15 && py + h + 15 > p.y;
    });
    for (let r = 0; r < 40; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
        const px = x + dx * 25, py = y + dy * 25;
        if (!hit(px, py)) return [Math.round(px / 5) * 5, Math.round(py / 5) * 5];
      }
    }
    return [x, y];
  }

  renderPart(part) {
    const def = PARTS[part.type];
    const { w, h } = partSize(part);
    let el = part.el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'part';
      el.dataset.id = part.id;
      this.partsLayer.append(el);
      part.el = el;
    }
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="${SVGNS}">${def.render(part)}</svg>`;
    if (def.canvas) {
      const c = def.canvas(part);
      const cv = document.createElement('canvas');
      cv.width = c.w * c.scale; cv.height = c.h * c.scale;
      Object.assign(cv.style, { position: 'absolute', left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
      el.append(cv);
      part.canvas = cv;
      part.drawKey = null;
    } else part.canvas = null;
    if (def.interactive) el.classList.add('interactive');
    this.placePart(part);
  }

  placePart(part) {
    const el = part.el;
    el.style.left = part.x + 'px';
    el.style.top = part.y + 'px';
    el.style.transform = part.rotate ? `rotate(${part.rotate}deg)` : '';
    el.classList.toggle('selected', this.sel === part);
  }

  pinPos(part, pinName) {
    const pin = partPins(part).find((p) => p.name === pinName);
    if (!pin) return null;
    return this.localToWorld(part, pin.x, pin.y);
  }

  localToWorld(part, lx, ly) {
    const { w, h } = partSize(part);
    const cx = part.x + w / 2, cy = part.y + h / 2;
    const a = ((part.rotate || 0) * Math.PI) / 180;
    const dx = lx - w / 2, dy = ly - h / 2;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  refPos(ref) {
    const [id, pin] = splitRef(ref);
    const p = this.parts.find((x) => x.id === id);
    return p ? this.pinPos(p, pin) : null;
  }

  // Rebuild pins overlay + wires and push the model to the circuit
  sync() {
    this.pinsLayer.innerHTML = '';
    for (const part of this.parts) {
      for (const pin of partPins(part)) {
        const [x, y] = this.localToWorld(part, pin.x, pin.y);
        const d = document.createElement('div');
        d.className = 'pin';
        d.style.left = x + 'px';
        d.style.top = y + 'px';
        d.dataset.ref = part.id + ':' + pin.name;
        this.pinsLayer.append(d);
      }
    }
    this.drawWires();
    this.circuit.setDiagram(this.parts, this.wires);
  }

  drawWires() {
    this.wireSvg.innerHTML = '';
    this.wires.forEach((w, i) => {
      const a = this.refPos(w.from), b = this.refPos(w.to);
      if (!a || !b) return;
      const pts = [a, ...w.points, b];
      const d = 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
      const g = document.createElementNS(SVGNS, 'g');
      g.classList.add('wire');
      if (this.sel === w) g.classList.add('selected');
      g.dataset.idx = i;
      g.innerHTML = `<path class="wire-hit" d="${d}"/><path class="wire-outline" d="${d}"/><path class="wire-line" d="${d}" stroke="${cssColor(w.color)}"/>` +
        `<circle cx="${a[0]}" cy="${a[1]}" r="2.2" fill="${cssColor(w.color)}"/><circle cx="${b[0]}" cy="${b[1]}" r="2.2" fill="${cssColor(w.color)}"/>`;
      if (this.sel === w) w.points.forEach((p, k) => { g.innerHTML += `<circle class="wp" data-k="${k}" cx="${p[0]}" cy="${p[1]}" r="3.5"/>`; });
      this.wireSvg.append(g);
    });
    if (this.wiring) {
      const pts = [this.refPos(this.wiring.from), ...this.wiring.points, this.wiring.cursor];
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', 'M' + pts.map((p) => p[0] + ' ' + p[1]).join(' L'));
      path.setAttribute('class', 'wire-temp');
      this.wireSvg.append(path);
    }
  }

  changed() { this.cb.onChange && this.cb.onChange(); }

  select(item) {
    const prev = this.sel;
    this.sel = item;
    if (prev && prev.el) prev.el.classList.remove('selected');
    if (item && item.el) item.el.classList.add('selected');
    this.drawWires();
    this.cb.onSelect && this.cb.onSelect(item);
  }

  deleteSelected() {
    const s = this.sel;
    if (!s) return;
    if (s.el) {
      this.parts = this.parts.filter((p) => p !== s);
      s.el.remove();
      this.wires = this.wires.filter((w) => splitRef(w.from)[0] !== s.id && splitRef(w.to)[0] !== s.id);
    } else this.wires = this.wires.filter((w) => w !== s);
    this.select(null);
    this.sync();
    this.changed();
  }

  // wires of a moved/rotated part get a new route, except ones whose bends were edited by hand
  reroute(part) {
    let n = 0;
    for (const w of this.wires) {
      if (w.manual || (splitRef(w.from)[0] !== part.id && splitRef(w.to)[0] !== part.id)) continue;
      w.points = null;
      n++;
    }
    if (n) routeWires(this.parts, this.wires);
  }

  rotateSelected() {
    const s = this.sel;
    if (!s || !s.el) return;
    s.rotate = ((s.rotate || 0) + 90) % 360;
    this.placePart(s);
    this.reroute(s);
    this.sync();
    this.changed();
  }

  setAttr(part, key, value, live) {
    part.attrs[key] = value;
    const def = PARTS[part.type];
    const meta = (def.attrs || []).find((a) => a.key === key);
    if (!(meta && meta.live)) {
      this.renderPart(part);
      // drop wires to pins that no longer exist
      this.wires = this.wires.filter((w) => this.pinExists(w.from) && this.pinExists(w.to));
      this.sync();
    } else this.circuit.invalidate();
    if (!live) this.changed();
  }

  // ---------------- view ----------------
  applyView() {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.z})`;
    this.root.style.backgroundSize = `${20 * this.view.z}px ${20 * this.view.z}px`;
    this.root.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
  }
  zoomAt(factor, cx, cy) {
    const z = Math.max(0.25, Math.min(5, this.view.z * factor));
    const k = z / this.view.z;
    this.view.x = cx - (cx - this.view.x) * k;
    this.view.y = cy - (cy - this.view.y) * k;
    this.view.z = z;
    this.applyView();
  }
  fit() {
    if (!this.parts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.parts) {
      const { w, h } = partSize(p);
      const r = (p.rotate || 0) % 180 !== 0;
      const cw = r ? h : w, ch = r ? w : h;
      const cx = p.x + w / 2, cy = p.y + h / 2;
      x0 = Math.min(x0, cx - cw / 2); y0 = Math.min(y0, cy - ch / 2); x1 = Math.max(x1, cx + cw / 2); y1 = Math.max(y1, cy + ch / 2);
    }
    for (const w of this.wires) for (const [x, y] of w.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const R = this.root.getBoundingClientRect();
    const pad = 40;
    const z = Math.max(0.3, Math.min(2.5, Math.min((R.width - pad * 2) / (x1 - x0), (R.height - pad * 2) / (y1 - y0))));
    this.view.z = z;
    this.view.x = (R.width - (x1 - x0) * z) / 2 - x0 * z;
    this.view.y = (R.height - (y1 - y0) * z) / 2 - y0 * z;
    this.applyView();
  }
  toWorld(clientX, clientY) {
    const R = this.root.getBoundingClientRect();
    return [(clientX - R.left - this.view.x) / this.view.z, (clientY - R.top - this.view.y) / this.view.z];
  }
  center() {
    const R = this.root.getBoundingClientRect();
    return this.toWorld(R.left + R.width / 2, R.top + R.height / 2);
  }

  // ---------------- events ----------------
  bindEvents() {
    const root = this.root;
    let drag = null;
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const R = root.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - R.left, e.clientY - R.top);
    }, { passive: false });

    root.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { if (this.wiring) { this.wiring = null; this.drawWires(); } return; }
      if (e.button !== 0 && e.button !== 1) return;
      const pinEl = e.target.closest('.pin');
      const wpEl = e.target.closest('.wp');
      const wireEl = e.target.closest('.wire');
      const partEl = e.target.closest('.part');
      const [wx, wy] = this.toWorld(e.clientX, e.clientY);
      if (e.button === 1) { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y }; root.setPointerCapture(e.pointerId); return; }
      if (pinEl) {
        e.stopPropagation();
        const ref = pinEl.dataset.ref;
        if (!this.wiring) {
          this.wiring = { from: ref, points: [], cursor: [wx, wy] };
          this.drawWires();
        } else {
          if (ref !== this.wiring.from) {
            const exists = this.wires.some((w) => (w.from === this.wiring.from && w.to === ref) || (w.to === this.wiring.from && w.from === ref));
            if (!exists) {
              const w = { from: this.wiring.from, to: ref, color: defaultWireColor(this.wiring.from, ref), points: this.wiring.points.length ? this.wiring.points : null, manual: this.wiring.points.length > 0 };
              this.wires.push(w);
              if (!w.points) routeWires(this.parts, this.wires);
              this.wiring = null;
              this.sync();
              this.select(w);
              this.changed();
              return;
            }
          }
          this.wiring = null;
          this.drawWires();
        }
        return;
      }
      if (this.wiring) {
        // add a waypoint (snapped to grid)
        this.wiring.points.push([Math.round(wx / 5) * 5, Math.round(wy / 5) * 5]);
        this.drawWires();
        return;
      }
      if (wpEl) {
        const w = this.wires[Number(wpEl.closest('.wire').dataset.idx)];
        drag = { kind: 'wp', w, k: Number(wpEl.dataset.k) };
        w.manual = true;
        root.setPointerCapture(e.pointerId);
        return;
      }
      if (wireEl) {
        const w = this.wires[Number(wireEl.dataset.idx)];
        this.select(w);
        if (e.detail === 2) {
          // double click: insert a waypoint at this position
          const pts = [this.refPos(w.from), ...w.points, this.refPos(w.to)];
          let best = 0, bd = Infinity;
          for (let i = 0; i < pts.length - 1; i++) { const d = distSeg([wx, wy], pts[i], pts[i + 1]); if (d < bd) { bd = d; best = i; } }
          w.points.splice(best, 0, [Math.round(wx), Math.round(wy)]);
          w.manual = true;
          this.drawWires();
          this.changed();
        }
        return;
      }
      if (partEl) {
        const part = this.parts.find((p) => p.el === partEl);
        if (!part) return;
        const def = PARTS[part.type];
        if (this.cb.isRunning() && def.interactive) {
          this.cb.onInteract(part, 'down');
          const up = () => { this.cb.onInteract(part, 'up'); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointerup', up);
          this.select(part);
          return;
        }
        this.select(part);
        drag = { kind: 'part', part, ox: wx - part.x, oy: wy - part.y, moved: false };
        root.setPointerCapture(e.pointerId);
        return;
      }
      this.select(null);
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
      root.setPointerCapture(e.pointerId);
    });

    root.addEventListener('pointermove', (e) => {
      const [wx, wy] = this.toWorld(e.clientX, e.clientY);
      if (this.wiring) { this.wiring.cursor = [wx, wy]; this.drawWires(); }
      const pinEl = e.target.closest && e.target.closest('.pin');
      if (pinEl && !drag) {
        const R = root.getBoundingClientRect();
        this.tip.textContent = pinEl.dataset.ref;
        this.tip.style.display = 'block';
        this.tip.style.left = e.clientX - R.left + 12 + 'px';
        this.tip.style.top = e.clientY - R.top - 26 + 'px';
      } else this.tip.style.display = 'none';
      if (!drag) return;
      if (drag.kind === 'pan') {
        this.view.x = drag.vx + e.clientX - drag.sx;
        this.view.y = drag.vy + e.clientY - drag.sy;
        this.applyView();
      } else if (drag.kind === 'part') {
        const nx = Math.round((wx - drag.ox) / 5) * 5, ny = Math.round((wy - drag.oy) / 5) * 5;
        if (nx !== drag.part.x || ny !== drag.part.y) {
          drag.part.x = nx; drag.part.y = ny; drag.moved = true;
          this.placePart(drag.part);
          this.updatePinsAndWires();
        }
      } else if (drag.kind === 'wp') {
        drag.w.points[drag.k] = [Math.round(wx / 5) * 5, Math.round(wy / 5) * 5];
        drag.moved = true;
        this.drawWires();
      }
    });
    root.addEventListener('pointerup', () => {
      if (drag && drag.kind === 'part' && drag.moved) this.reroute(drag.part);
      if (drag && (drag.kind === 'part' || drag.kind === 'wp') && drag.moved) { this.sync(); this.changed(); }
      drag = null;
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('dblclick', (e) => {
      const wpEl = e.target.closest('.wp');
      if (wpEl) {
        const w = this.wires[Number(wpEl.closest('.wire').dataset.idx)];
        w.points.splice(Number(wpEl.dataset.k), 1);
        w.manual = true;
        this.drawWires();
        this.changed();
      }
    });
    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (document.activeElement && document.activeElement.closest('.CodeMirror'))) return;
      if (e.key === 'Escape' && this.wiring) { this.wiring = null; this.drawWires(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSelected(); }
      if ((e.key === 'r' || e.key === 'R') && this.sel && this.sel.el && !e.ctrlKey) this.rotateSelected();
    });
  }

  updatePinsAndWires() {
    // fast path while dragging: move pin hotspots and redraw wires without touching the circuit
    const pins = this.pinsLayer.children;
    for (const d of pins) {
      const pos = this.refPos(d.dataset.ref);
      if (pos) { d.style.left = pos[0] + 'px'; d.style.top = pos[1] + 'px'; }
    }
    this.drawWires();
  }
}

export function splitRef(ref) {
  const i = ref.indexOf(':');
  return [ref.slice(0, i), ref.slice(i + 1)];
}

function cssColor(c) {
  return { green: '#18a33a', red: '#e02424', black: '#222', blue: '#2b64e0', yellow: '#e8c400', orange: '#ff8a00', purple: '#8e3fe0', gray: '#888', white: '#f4f4f4', brown: '#8b4513', cyan: '#00b8d4', magenta: '#d81b9c', violet: '#8e3fe0', gold: '#d4af37' }[c] || c;
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
