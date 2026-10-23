// printf / strftime / number formatting helpers (Arduino semantics, binary strings).

export function bytesToBin(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
export function binToBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}
export function binToUtf8(s) {
  return new TextDecoder('utf-8').decode(binToBytes(s));
}
export function utf8ToBin(s) {
  return bytesToBin(new TextEncoder().encode(String(s)));
}

// Arduino Print::printFloat
export function fmtFloat(x, digits) {
  x = Number(x);
  digits = digits === undefined ? 2 : Math.max(0, Math.min(20, Number(digits) | 0));
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x > 4294967040.0 || x < -4294967040.0) return 'ovf';
  let s = x.toFixed(digits);
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return s;
}

export function fmtInt(x, base, lower) {
  x = Number(x);
  base = Number(base);
  if (base === 10 || !base) return String(Math.trunc(x));
  if (base < 2 || base > 36) return String(Math.trunc(x));
  let v = Math.trunc(x);
  if (v < 0) v = v >>> 0;
  const s = v.toString(base);
  return lower ? s : s.toUpperCase();
}

const pad = (s, width, left, zero) => {
  if (s.length >= width) return s;
  if (left) return s + ' '.repeat(width - s.length);
  if (zero) {
    const sign = /^[-+ ]/.test(s) ? s[0] : '';
    const body = sign ? s.slice(1) : s;
    const pre = /^0[xX]/.test(body) ? body.slice(0, 2) : '';
    return sign + pre + '0'.repeat(width - s.length) + body.slice(pre.length);
  }
  return ' '.repeat(width - s.length) + s;
};

// C printf. `str` converts a runtime value to a binary string.
export function cFormat(fmt, args, str) {
  fmt = str(fmt);
  let out = '';
  let ai = 0;
  const next = () => args[ai++];
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    const m = /^%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|L|z|j|t)?([diouxXfFeEgGcsp%])/.exec(fmt.slice(i));
    if (!m) { out += c; continue; }
    i += m[0].length - 1;
    const flags = m[1] || '';
    let width = m[2] === '*' ? Number(next()) : m[2] ? Number(m[2]) : 0;
    let prec = m[3] === '*' ? Number(next()) : m[3] !== undefined ? Number(m[3]) : undefined;
    const conv = m[5];
    const left = flags.includes('-') || width < 0;
    if (width < 0) width = -width;
    const zero = flags.includes('0') && !left;
    const plus = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    let s;
    switch (conv) {
      case '%': s = '%'; break;
      case 'd': case 'i': {
        let v = Math.trunc(Number(next()) || 0);
        if (m[4] === 'hh') v = (v << 24) >> 24; else if (m[4] === 'h') v = (v << 16) >> 16;
        else if (m[4] !== 'll' && Math.abs(v) <= 0xffffffff) v = v | 0;
        s = (v < 0 ? '-' : plus) + Math.abs(v).toString();
        if (prec !== undefined) s = s.replace(/\d+/, (d) => d.padStart(prec, '0'));
        break;
      }
      case 'u': case 'x': case 'X': case 'o': {
        let v = Math.trunc(Number(next()) || 0);
        if (m[4] !== 'll') v = v >>> 0; else if (v < 0) v = 2 ** 64 + v;
        if (m[4] === 'hh') v &= 255; else if (m[4] === 'h') v &= 65535;
        const base = conv === 'u' ? 10 : conv === 'o' ? 8 : 16;
        s = v.toString(base);
        if (conv === 'X') s = s.toUpperCase();
        if (prec !== undefined) s = s.padStart(prec, '0');
        if (flags.includes('#') && v !== 0) s = (conv === 'o' ? '0' : conv === 'x' ? '0x' : conv === 'X' ? '0X' : '') + s;
        break;
      }
      case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
        const v = Number(next());
        const p = prec === undefined ? 6 : prec;
        if (Number.isNaN(v)) s = 'nan';
        else if (!Number.isFinite(v)) s = (v < 0 ? '-' : plus) + 'inf';
        else if (conv === 'f' || conv === 'F') s = (v < 0 || Object.is(v, -0) ? '-' : plus) + Math.abs(v).toFixed(p);
        else if (conv === 'e' || conv === 'E') {
          s = (v < 0 ? '-' : plus) + Math.abs(v).toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        } else {
          const P = p === 0 ? 1 : p;
          const exp = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)));
          if (exp < -4 || exp >= P) s = Math.abs(v).toExponential(P - 1).replace(/e([+-])(\d)$/, 'e$10$2');
          else s = Math.abs(v).toFixed(Math.max(0, P - 1 - exp));
          if (!flags.includes('#')) s = s.replace(/(\.\d*?)0+(e|$)/, '$1$2').replace(/\.(e|$)/, '$1');
          s = (v < 0 ? '-' : plus) + s;
        }
        if (conv === 'E' || conv === 'G') s = s.toUpperCase();
        break;
      }
      case 'c': { const v = next(); s = typeof v === 'string' ? v.slice(0, 1) : String.fromCharCode(Number(v) & 255); break; }
      case 's': { s = str(next()); if (prec !== undefined) s = s.slice(0, prec); break; }
      case 'p': s = '0x3ffb' + ((Math.random() * 0xffff) | 0).toString(16).padStart(4, '0'); break;
      default: s = '';
    }
    out += pad(s, width, left, zero && !'sc%'.includes(conv));
  }
  return out;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function strftime(fmt, tm) {
  const p2 = (n) => String(n).padStart(2, '0');
  return fmt.replace(/%([a-zA-Z%])/g, (_, c) => {
    switch (c) {
      case 'Y': return String(tm.tm_year + 1900);
      case 'y': return p2((tm.tm_year + 1900) % 100);
      case 'm': return p2(tm.tm_mon + 1);
      case 'd': return p2(tm.tm_mday);
      case 'e': return String(tm.tm_mday).padStart(2, ' ');
      case 'H': return p2(tm.tm_hour);
      case 'I': return p2(tm.tm_hour % 12 || 12);
      case 'M': return p2(tm.tm_min);
      case 'S': return p2(tm.tm_sec);
      case 'p': return tm.tm_hour < 12 ? 'AM' : 'PM';
      case 'A': return DAYS[tm.tm_wday];
      case 'a': return DAYS[tm.tm_wday].slice(0, 3);
      case 'B': return MONTHS[tm.tm_mon];
      case 'b': case 'h': return MONTHS[tm.tm_mon].slice(0, 3);
      case 'j': return String(tm.tm_yday + 1).padStart(3, '0');
      case 'w': return String(tm.tm_wday);
      case 'u': return String(tm.tm_wday || 7);
      case 'D': return `${p2(tm.tm_mon + 1)}/${p2(tm.tm_mday)}/${p2((tm.tm_year + 1900) % 100)}`;
      case 'F': return `${tm.tm_year + 1900}-${p2(tm.tm_mon + 1)}-${p2(tm.tm_mday)}`;
      case 'T': return `${p2(tm.tm_hour)}:${p2(tm.tm_min)}:${p2(tm.tm_sec)}`;
      case 'R': return `${p2(tm.tm_hour)}:${p2(tm.tm_min)}`;
      case 'c': return `${DAYS[tm.tm_wday].slice(0, 3)} ${MONTHS[tm.tm_mon].slice(0, 3)} ${String(tm.tm_mday).padStart(2, ' ')} ${p2(tm.tm_hour)}:${p2(tm.tm_min)}:${p2(tm.tm_sec)} ${tm.tm_year + 1900}`;
      case 'Z': return 'UTC';
      case 'z': return '+0000';
      case 'n': return '\n';
      case 't': return '\t';
      case '%': return '%';
      default: return '%' + c;
    }
  });
}
