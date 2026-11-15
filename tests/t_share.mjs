// Short share links: ShareStore limits (dedup, size, rate, quota, expiry) and the server.js endpoints (run: node tests/t_share.mjs)
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { ShareStore, ShareError, shareConfig } from '../share-store.js';

let fail = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fail++; };
const project = (n) => zlib.deflateRawSync(JSON.stringify({ name: 'P' + n, code: `void setup(){} // ${n}`, diagram: { parts: [] } }));
const status = async (p) => { try { await p; return 0; } catch (e) { return e instanceof ShareError ? e.status : String(e); } };
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'esp32share-'));
const store = async (env) => new ShareStore(shareConfig({ SHARE_DIR: tmp + '/' + Math.random().toString(36).slice(2), ...env })).init();

{
  const s = await store({});
  const a = await s.create(project(1), 'ip1');
  const b = await s.create(project(1), 'ip2');
  check('create: 10-char id', /^[\w-]{10}$/.test(a.id) && a.created, a.id);
  check('same project -> same link, no new file', b.id === a.id && !b.created && s.count === 1);
  const got = await s.get(a.id);
  check('get returns the stored data', got && JSON.parse(zlib.inflateRawSync(got)).name === 'P1');
  check('unknown / malformed id -> null', (await s.get('AAAAAAAAAA')) === null && (await s.get('../../etc')) === null);
  check('not compressed -> 400', (await status(s.create(Buffer.from('hello')))) === 400);
  check('not a project -> 400', (await status(s.create(zlib.deflateRawSync('{"a":1}')))) === 400);
  check('zip bomb -> 400', (await status(s.create(zlib.deflateRawSync(Buffer.alloc(5e6, 32))))) === 400);
}
{
  const s = await store({ SHARE_MAX_KB: 1 });
  const big = zlib.deflateRawSync(JSON.stringify({ code: Array.from({ length: 400 }, (_, i) => Math.random().toString(36) + i).join(''), diagram: { parts: [] } }));
  check('over SHARE_MAX_KB -> 413', (await status(s.create(big))) === 413, big.length + ' B');
}
{
  const s = await store({ SHARE_RATE: 3 });
  for (let i = 0; i < 3; i++) await s.create(project(i), 'ip1');
  check('4th new link in an hour -> 429', (await status(s.create(project(9), 'ip1'))) === 429);
  check('existing link does not count', (await status(s.create(project(0), 'ip1'))) === 0);
  check('other IP not limited', (await status(s.create(project(9), 'ip2'))) === 0);
}
{
  // quota of 10 blocks (40 KB) full: the 11th link brings usage down to 90% (36 KB incl. the new one)
  // by deleting the 2 least recently opened links (link i last opened i days ago)
  const s = await store({ SHARE_QUOTA_MB: 40 / 1024, SHARE_RATE: 0 });
  const ids = [];
  for (let i = 0; i < 10; i++) {
    ids.push((await s.create(project(i))).id);
    const t = new Date(Date.now() - i * 86400000 - 1000);
    await fs.utimes(s.file(ids[i]), t, t);
  }
  await s.create(project(10));
  const left = [];
  for (const id of ids) left.push(!!(await fs.stat(s.file(id)).catch(() => null)));
  check('over quota: the 2 least recently opened links deleted', left.join() === [...Array(8).fill(true), false, false].join() && s.count === 9, `count ${s.count}`);
  const r = await store({ SHARE_QUOTA_MB: 8 / 1024, SHARE_EVICT: '0', SHARE_RATE: 0 });
  await r.create(project(1)); await r.create(project(2));
  check('SHARE_EVICT=0: full -> 507', (await status(r.create(project(3)))) === 507);
}
{
  const s = await store({ SHARE_TTL_DAYS: 30, SHARE_RATE: 0 });
  const a = (await s.create(project(1))).id, b = (await s.create(project(2))).id;
  const old = new Date(Date.now() - 40 * 86400000);
  await fs.utimes(s.file(a), old, old);
  const n = await s.prune();
  check('prune: link not opened for 40 days deleted', n === 1 && !(await s.get(a)) && !!(await s.get(b)));
  await fs.utimes(s.file(b), old, old);
  await s.get(b);
  check('opening a link refreshes it', (await fs.stat(s.file(b))).mtimeMs > Date.now() - 60000);
}

// HTTP endpoints of server.js
{
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn(process.execPath, ['server.js', String(port)], { cwd: root, env: { ...process.env, SHARE_DIR: tmp + '/http', SHARE_RATE: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !/Link chia sẻ/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  const base = `http://127.0.0.1:${port}`;
  const post = (body, headers = {}) => fetch(base + '/__share', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', ...headers } });
  try {
    const r = await post(project(1));
    const { id } = await r.json();
    check('POST /__share -> id', r.ok && /^[\w-]{10}$/.test(id), id);
    const g = await fetch(`${base}/__share/${id}`);
    check('GET /__share/<id> -> project', g.ok && JSON.parse(zlib.inflateRawSync(Buffer.from(await g.arrayBuffer()))).name === 'P1');
    check('GET unknown id -> 404', (await fetch(`${base}/__share/AAAAAAAAAA`)).status === 404);
    const bad = await post('xyz');
    check('POST garbage -> 400 with message', bad.status === 400 && /hợp lệ/.test((await bad.json()).error));
    await post(project(2), { 'X-Real-IP': '203.0.113.5' });
    const lim = await post(project(3), { 'X-Real-IP': '203.0.113.6' });
    check('X-Real-IP from local proxy is used for the rate limit', lim.ok);
    await post(project(4), { 'X-Real-IP': '203.0.113.5' });
    check('3rd link from one IP with SHARE_RATE=2 -> 429', (await post(project(5), { 'X-Real-IP': '203.0.113.5' })).status === 429);
    check('data dir not served as static files', (await fetch(`${base}/data/share/`)).status === 403);
    check('server logs new links', /\[share\] \+ /.test(log));
  } finally { const done = new Promise((r) => srv.once('exit', r)); srv.kill(); await done; }
}

await fs.rm(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} lỗi` : 'Tất cả đều đạt');
process.exitCode = fail ? 1 : 0;
