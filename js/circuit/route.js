// Orthogonal wire router: a wire leaves each pin straight out of its part, then follows channels around the parts'
// boxes (A* over the grid of channel lines), preferring short paths with few bends that do not run along or touch
// other wires. Parts are in the editor's shape { id, type, x, y, rotate, attrs }. DOM-free.
import { partSize, partPins } from './parts.js';

const PAD = 4;        // wires keep this far from a part's box
const ESC = 8;        // first bend this far out of the box
const LANES = [14, 20, 26, 32, 38]; // channels around each box
// path costs (per bend, per px running along another wire, passing another wire's bend, crossing a wire);
// wires of the same net may share paths freely
export const COST = { bend: 40, overlap: 6, touch: 60, cross: 50, passes: 3 };

function box(part) {
  const { w, h } = partSize(part);
  const r = (part.rotate || 0) % 180 !== 0;
  const cx = part.x + w / 2, cy = part.y + h / 2;
  const bw = r ? h : w, bh = r ? w : h;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function rot(part, dx, dy) {
  const a = ((part.rotate || 0) * Math.PI) / 180;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

// world position of a pin and the direction out of its part (towards the nearest edge)
export function pinExit(part, name) {
  const pin = partPins(part).find((p) => p.name === name);
  if (!pin) return null;
  const { w, h } = partSize(part);
  const [rx, ry] = rot(part, pin.x - w / 2, pin.y - h / 2);
  const pos = [part.x + w / 2 + rx, part.y + h / 2 + ry];
  const d = [[pin.x, -1, 0], [w - pin.x, 1, 0], [pin.y, 0, -1], [h - pin.y, 0, 1]].sort((a, b) => a[0] - b[0])[0];
  const dir = rot(part, d[1], d[2]).map(Math.round);
  const b = box(part);
  const out = dir[0] ? (dir[0] < 0 ? b.x - ESC : b.x + b.w + ESC) - pos[0] : (dir[1] < 0 ? b.y - ESC : b.y + b.h + ESC) - pos[1];
  const esc = [pos[0] + dir[0] * Math.abs(out), pos[1] + dir[1] * Math.abs(out)];
  return { pos, dir, esc };
}

class Heap {
  constructor() { this.a = []; }
  push(x) {
    const a = this.a;
    a.push(x);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y) => x + ',' + y;

// Route one wire between two pin exits; used = { segs: [[x1,y1,x2,y2,net]…], points: Map('x,y' → Set(net)) }
// of the other wires, net = this wire's net
function search(A, B, rects, used, net, cross = COST.cross) {
  const rs = rects.filter((r) => !inside(r, A.esc) && !inside(r, B.esc));
  const xs = new Set([A.esc[0], B.esc[0]]), ys = new Set([A.esc[1], B.esc[1]]);
  let x0 = Math.min(A.esc[0], B.esc[0]), x1 = Math.max(A.esc[0], B.esc[0]);
  let y0 = Math.min(A.esc[1], B.esc[1]), y1 = Math.max(A.esc[1], B.esc[1]);
  for (const r of rects) {
    for (const l of LANES) { xs.add(r.x - l); xs.add(r.x + r.w + l); ys.add(r.y - l); ys.add(r.y + r.h + l); }
    x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y + r.h);
  }
  xs.add(x0 - 50); xs.add(x1 + 50); ys.add(y0 - 50); ys.add(y1 + 50);
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i]));
  const blocked = (ax, ay, bx, by) => rs.some((r) => {
    const l = r.x - PAD, t = r.y - PAD, rr = r.x + r.w + PAD, bb = r.y + r.h + PAD;
    if (ay === by) return ay > t && ay < bb && Math.max(ax, bx) > l && Math.min(ax, bx) < rr;
    return ax > l && ax < rr && Math.max(ay, by) > t && Math.min(ay, by) < bb;
  });
  const overlap = (ax, ay, bx, by) => {
    let s = 0;
    for (const [px, py, qx, qy, n] of used.segs) {
      if (n === net) continue;
      if (ay === by && py === qy && Math.abs(py - ay) < 3) s += Math.max(0, Math.min(Math.max(ax, bx), Math.max(px, qx)) - Math.max(Math.min(ax, bx), Math.min(px, qx)));
      else if (ax === bx && px === qx && Math.abs(px - ax) < 3) s += Math.max(0, Math.min(Math.max(ay, by), Math.max(py, qy)) - Math.max(Math.min(ay, by), Math.min(py, qy)));
    }
    return s;
  };
  // existing wires crossed by a segment
  const crossings = (ax, ay, bx, by) => {
    let c = 0;
    for (const [px, py, qx, qy, n] of used.segs) {
      if (n === net) continue;
      if (ay === by && px === qx && px > Math.min(ax, bx) && px < Math.max(ax, bx) && ay > Math.min(py, qy) && ay < Math.max(py, qy)) c++;
      else if (ax === bx && py === qy && py > Math.min(ay, by) && py < Math.max(ay, by) && ax > Math.min(px, qx) && ax < Math.max(px, qx)) c++;
    }
    return c;
  };
  const goal = key(B.esc[0], B.esc[1]);
  const endDir = [-B.dir[0], -B.dir[1]];
  const h = (x, y) => Math.abs(x - B.esc[0]) + Math.abs(y - B.esc[1]);
  const best = new Map();
  const heap = new Heap();
  const sd = DIRS.findIndex((d) => d[0] === A.dir[0] && d[1] === A.dir[1]);
  heap.push([h(A.esc[0], A.esc[1]), 0, xi.get(A.esc[0]), yi.get(A.esc[1]), sd, null]);
  let found = null;
  for (let n = 0; heap.size && n < 60000; n++) {
    const cur = heap.pop();
    const [, g, ix, iy, d] = cur;
    const x = X[ix], y = Y[iy];
    const k = ix + ',' + iy + ',' + d;
    if (best.has(k) && best.get(k) < g) continue;
    if (key(x, y) === goal) {
      const turn = DIRS[d][0] === endDir[0] && DIRS[d][1] === endDir[1] ? 0 : COST.bend;
      if (!found || g + turn < found[0]) found = [g + turn, cur];
      continue;
    }
    if (found && g >= found[0]) break;
    DIRS.forEach(([dx, dy], nd) => {
      if (dx === -DIRS[d][0] && dy === -DIRS[d][1]) return;
      const jx = ix + dx, jy = iy + dy;
      if (jx < 0 || jy < 0 || jx >= X.length || jy >= Y.length) return;
      const nx = X[jx], ny = Y[jy];
      if (blocked(x, y, nx, ny)) return;
      let c = Math.abs(nx - x) + Math.abs(ny - y);
      c += (nd !== d ? COST.bend : 0) + COST.overlap * overlap(x, y, nx, ny) + cross * crossings(x, y, nx, ny);
      const at = used.points.get(key(nx, ny));
      if (at && key(nx, ny) !== goal && [...at].some((n) => n !== net)) c += COST.touch;
      const ng = g + c;
      const nk = jx + ',' + jy + ',' + nd;
      if (best.has(nk) && best.get(nk) <= ng) return;
      best.set(nk, ng);
      heap.push([ng + h(nx, ny), ng, jx, jy, nd, cur]);
    });
  }
  if (!found) return null;
  const pts = [];
  for (let c = found[1]; c; c = c[5]) pts.unshift([X[c[2]], Y[c[3]]]);
  return pts;
}

function inside(r, [x, y]) { return x > r.x - PAD && x < r.x + r.w + PAD && y > r.y - PAD && y < r.y + r.h + PAD; }

// drop repeated and collinear points
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1][0] === p[0] && out[out.length - 1][1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  return out;
}

function segsOf(pts, net) {
  const s = [];
  for (let i = 1; i < pts.length; i++) s.push([...pts[i - 1], ...pts[i], net]);
  return s;
}

const splitRef = (ref) => { const i = ref.indexOf(':'); return [ref.slice(0, i), ref.slice(i + 1)]; };
const exitOf = (parts, ref) => {
  const [id, pin] = splitRef(ref);
  const p = parts.find((q) => q.id === id);
  return p ? pinExit(p, pin) : null;
};

// Give a route (interior points) to every wire whose points are null; wires with points stay as they are.
// wires: [{ from, to, points }]
export function routeWires(parts, wires) {
  const rects = parts.map(box);
  // nets: pins joined by wires
  const up = new Map();
  const find = (r) => { while (up.has(r) && up.get(r) !== r) r = up.get(r); return r; };
  for (const w of wires) { const a = find(w.from), b = find(w.to); if (a !== b) up.set(a, b); }
  const netOf = (w) => find(w.from);
  const fixed = { segs: [], points: [] }; // points: [key, net]
  for (const w of wires) {
    if (!w.points) continue;
    const a = exitOf(parts, w.from), b = exitOf(parts, w.to);
    if (!a || !b) continue;
    const pts = [a.pos, ...w.points, b.pos];
    fixed.segs.push(...segsOf(pts, netOf(w)));
    for (const p of pts) fixed.points.push([key(p[0], p[1]), netOf(w)]);
  }
  const todo = wires.filter((w) => !w.points).map((w) => ({ w, net: netOf(w), a: exitOf(parts, w.from), b: exitOf(parts, w.to) }));
  // every exit point and pin stub is known up front, so earlier wires keep clear of later wires' ends
  for (const t of todo) for (const e of [t.a, t.b]) if (e) { fixed.points.push([key(e.esc[0], e.esc[1]), t.net]); fixed.segs.push([...e.pos, ...e.esc, t.net]); }
  const dist = (t) => (t.a && t.b ? Math.abs(t.a.pos[0] - t.b.pos[0]) + Math.abs(t.a.pos[1] - t.b.pos[1]) : 0);
  todo.sort((p, q) => dist(p) - dist(q));
  // first pass: one after the other, nearly direct; then each wire again with all the others in place and crossings
  // costing more each pass, so the wire that is cheapest to move out of the way moves (rip-up and reroute)
  for (let pass = 0; pass < COST.passes; pass++) {
    const cross = (COST.cross * (pass + 1)) / COST.passes;
    for (const t of todo) {
      const { a, b } = t;
      if (!a || !b) continue;
      const own = new Set([key(...a.esc), key(...b.esc)]);
      const others = todo.filter((o) => o !== t && o.path);
      const points = new Map();
      for (const [k, n] of [...fixed.points, ...others.flatMap((o) => o.path.map((p) => [key(p[0], p[1]), o.net]))]) {
        if (own.has(k)) continue;
        if (!points.has(k)) points.set(k, new Set());
        points.get(k).add(n);
      }
      const use = { segs: [...fixed.segs, ...others.flatMap((o) => segsOf(o.path, o.net))], points };
      const pts = own.size === 1 ? null : search(a, b, rects, use, t.net, cross);
      t.path = simplify(pts ? [a.pos, a.esc, ...pts, b.esc, b.pos] : [a.pos, [b.pos[0], a.pos[1]], b.pos]);
    }
  }
  for (const t of todo) t.w.points = t.path ? t.path.slice(1, -1).map(([x, y]) => [Math.round(x), Math.round(y)]) : [];
  return wires;
}
