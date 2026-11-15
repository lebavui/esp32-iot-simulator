// Manage the stored share links (same SHARE_* env as server.js). On the VPS:
//   docker exec esp32sim node tools/share-admin.mjs stats
// Commands:
//   stats              number of links, disk usage, age of the links
//   show <id|link>     size, last opened, project name of one link
//   rm <id|link>...    delete links (e.g. reported abuse)
//   prune [days]       delete links not opened for <days> days (default SHARE_TTL_DAYS)
// The running server re-counts the links once a day; its startup line shows the count too.
import path from 'path';
import zlib from 'zlib';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { ShareStore, shareConfig } from '../share-store.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = await new ShareStore(shareConfig(process.env, root)).init();
const [cmd, ...args] = process.argv.slice(2);
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const idOf = (s) => (/#s=([\w-]+)/.exec(s) || [null, s])[1];
const day = (t) => new Date(t).toISOString().slice(0, 10);

if (cmd === 'stats') {
  const all = await store.list();
  const { quotaBytes } = store.cfg;
  console.log(`Thư mục: ${store.cfg.dir}`);
  console.log(`Số link: ${store.count}, dung lượng: ${mb(store.bytes)}${quotaBytes ? ` / ${mb(quotaBytes)} (${(100 * store.bytes / quotaBytes).toFixed(1)}%)` : ''}`);
  const now = Date.now(), d = (n) => all.filter((f) => now - f.mtime < n * 86400000).length;
  console.log(`Mở trong 7 ngày: ${d(7)}, 30 ngày: ${d(30)}, 365 ngày: ${d(365)}`);
  if (all.length) console.log(`Lần mở cũ nhất: ${day(Math.min(...all.map((f) => f.mtime)))}, mới nhất: ${day(Math.max(...all.map((f) => f.mtime)))}`);
  console.log(`Cấu hình: tối đa ${store.cfg.maxBytes / 1024} KB/dự án, ${store.cfg.rate || '∞'} link/giờ/IP, ${store.cfg.evict ? 'đầy thì xoá link lâu không mở' : 'đầy thì từ chối'}, xoá sau ${store.cfg.ttlDays || '∞'} ngày không mở`);
} else if (cmd === 'show' && args[0]) {
  const id = idOf(args[0]);
  const file = store.file(id);
  try {
    const st = await fs.stat(file);
    const p = JSON.parse(zlib.inflateRawSync(await fs.readFile(file)).toString('utf8'));
    console.log(`${id}: ${st.size} B, mở lần cuối ${day(st.mtimeMs)}, tên "${p.name || ''}", ${p.code.split('\n').length} dòng code, ${p.diagram.parts.length} linh kiện`);
  } catch { console.log(`${id}: không có`); process.exitCode = 1; }
} else if (cmd === 'rm' && args.length) {
  for (const a of args) console.log(`${idOf(a)}: ${await store.remove(idOf(a)) ? 'đã xoá' : 'không có'}`);
} else if (cmd === 'prune') {
  const days = args[0] ? Number(args[0]) : store.cfg.ttlDays;
  if (!(days > 0)) { console.log('Cần số ngày > 0'); process.exit(1); }
  const n = await store.prune(days);
  console.log(`Đã xoá ${n} link quá ${days} ngày không mở; còn ${store.count} link, ${mb(store.bytes)}`);
} else {
  console.log('Dùng: node tools/share-admin.mjs stats | show <id> | rm <id>... | prune [ngày]');
  process.exitCode = 1;
}
