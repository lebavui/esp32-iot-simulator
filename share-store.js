// Short share links: projects stored on the server as files, addressed by a hash of their content.
// Used by server.js (POST /__share, GET /__share/<id>) and tools/share-admin.mjs.
// A stored file is the deflate-raw compressed project JSON exactly as the browser sent it
// (the browser decompresses it with DecompressionStream, like the old #p= links).
// Layout: <dir>/<first 2 chars of id>/<id>; the file's mtime is the last time the link was opened.
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

const BLOCK = 4096;                         // disk usage is counted in filesystem blocks
const MAX_JSON = 2 * 1024 * 1024;           // limit on the decompressed size (zip bombs)
const ID_RE = /^[A-Za-z0-9_-]{10,22}$/;
const DAY = 86400000;
const diskSize = (n) => Math.ceil(n / BLOCK) * BLOCK;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export class ShareError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function shareConfig(env = process.env, root = process.cwd()) {
  return {
    dir: path.resolve(root, env.SHARE_DIR || 'data/share'),
    maxBytes: num(env.SHARE_MAX_KB, 64) * 1024,          // size of one compressed project
    rate: num(env.SHARE_RATE, 30),                       // new links per IP per hour (0 = unlimited)
    quotaBytes: num(env.SHARE_QUOTA_MB, 1024) * 1048576, // total disk usage (0 = unlimited)
    evict: !/^(0|false|no|off)$/i.test(env.SHARE_EVICT || ''),   // over quota: delete least recently opened links, else refuse
    ttlDays: num(env.SHARE_TTL_DAYS, 365),               // delete links not opened for this many days (0 = keep)
  };
}

export class ShareStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.count = 0;
    this.bytes = 0;
    this.hits = new Map();   // ip -> timestamps of links created in the last hour
  }

  file(id) { return path.join(this.cfg.dir, id.slice(0, 2), id); }

  // every stored link: { id, file, size, mtime }
  async list() {
    const out = [];
    let subs;
    try { subs = await fs.readdir(this.cfg.dir, { withFileTypes: true }); } catch { return out; }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const sub = path.join(this.cfg.dir, s.name);
      for (const name of await fs.readdir(sub).catch(() => [])) {
        if (!ID_RE.test(name)) continue;
        const file = path.join(sub, name);
        try { const st = await fs.stat(file); out.push({ id: name, file, size: st.size, mtime: st.mtimeMs }); } catch { /* removed meanwhile */ }
      }
    }
    return out;
  }

  async init() {
    await fs.mkdir(this.cfg.dir, { recursive: true });
    const all = await this.list();
    this.count = all.length;
    this.bytes = all.reduce((s, f) => s + diskSize(f.size), 0);
    return this;
  }

  stats() { return { count: this.count, bytes: this.bytes, quotaBytes: this.cfg.quotaBytes }; }

  // true when the IP may create another link now (counts the attempt)
  allow(ip) {
    if (!this.cfg.rate) return true;
    const now = Date.now();
    const t = (this.hits.get(ip) || []).filter((x) => now - x < 3600000);
    if (t.length >= this.cfg.rate) { this.hits.set(ip, t); return false; }
    t.push(now);
    this.hits.set(ip, t);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((x) => now - x < 3600000)) this.hits.delete(k);
    return true;
  }

  tooLarge() { return `Dự án quá lớn (tối đa ${Math.round(this.cfg.maxBytes / 1024)} KB sau khi nén)`; }

  // decompresses and checks that the data is a project; returns its JSON text
  validate(buf) {
    if (!buf.length) throw new ShareError(400, 'Dữ liệu rỗng');
    if (buf.length > this.cfg.maxBytes) throw new ShareError(413, this.tooLarge());
    let text, p;
    try { text = zlib.inflateRawSync(buf, { maxOutputLength: MAX_JSON }).toString('utf8'); p = JSON.parse(text); }
    catch { throw new ShareError(400, 'Dữ liệu không phải dự án hợp lệ'); }
    if (!p || typeof p !== 'object' || typeof p.code !== 'string' || !p.diagram || !Array.isArray(p.diagram.parts)) throw new ShareError(400, 'Dữ liệu không phải dự án hợp lệ');
    return text;
  }

  // stores a compressed project; returns { id, created }
  async create(buf, ip = '') {
    const text = this.validate(buf);
    const hash = crypto.createHash('sha256').update(text).digest('base64url');
    for (let len = 10; len <= 22; len += 4) {
      const id = hash.slice(0, len);
      const file = this.file(id);
      const old = await fs.readFile(file).catch(() => null);
      if (old) {
        let same = false;
        try { same = zlib.inflateRawSync(old, { maxOutputLength: MAX_JSON }).toString('utf8') === text; } catch { /* damaged file */ }
        if (same) { await this.touch(file); return { id, created: false }; }
        continue;   // a different project with the same short id: use a longer one
      }
      if (!this.allow(ip)) throw new ShareError(429, `Đã tạo quá nhiều link (tối đa ${this.cfg.rate} link/giờ), hãy thử lại sau`);
      if (this.cfg.quotaBytes && this.bytes + diskSize(buf.length) > this.cfg.quotaBytes) {
        if (!this.cfg.evict) throw new ShareError(507, 'Kho lưu link chia sẻ đã đầy');
        await this.evict(this.cfg.quotaBytes * 0.9 - diskSize(buf.length));
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file);
      this.count++;
      this.bytes += diskSize(buf.length);
      return { id, created: true };
    }
    throw new ShareError(500, 'Không tạo được mã link');
  }

  // compressed project, or null; marks the link as recently opened
  async get(id) {
    if (!ID_RE.test(id)) return null;
    const file = this.file(id);
    const buf = await fs.readFile(file).catch(() => null);
    if (buf) await this.touch(file);
    return buf;
  }

  async touch(file) {
    try {
      const st = await fs.stat(file);
      if (Date.now() - st.mtimeMs > DAY) { const now = new Date(); await fs.utimes(file, now, now); }
    } catch { /* gone */ }
  }

  async remove(id) {
    if (!ID_RE.test(id)) return false;
    const file = this.file(id);
    try {
      const st = await fs.stat(file);
      await fs.unlink(file);
      this.count--;
      this.bytes -= diskSize(st.size);
      await fs.rmdir(path.dirname(file)).catch(() => {});   // only succeeds when empty
      return true;
    } catch { return false; }
  }

  // deletes links not opened for `days` days; returns how many
  async prune(days = this.cfg.ttlDays) {
    if (!days) return 0;
    const limit = Date.now() - days * DAY;
    let n = 0;
    for (const f of await this.list()) if (f.mtime < limit && await this.remove(f.id)) n++;
    return n;
  }

  // deletes the least recently opened links until the usage is at most `target` bytes; returns how many
  async evict(target) {
    const all = (await this.list()).sort((a, b) => a.mtime - b.mtime);
    let n = 0;
    for (const f of all) {
      if (this.bytes <= target) break;
      if (await this.remove(f.id)) n++;
    }
    return n;
  }
}
