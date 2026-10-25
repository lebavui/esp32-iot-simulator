// Lexer + minimal C preprocessor for the Arduino/C++ subset.
// Strings are kept as "binary strings" (one char per UTF-8 byte), like a real MCU sees them.

export class CompileError extends Error {
  constructor(msg, line = 0, col = 0) {
    super(msg);
    this.line = line;
    this.col = col;
  }
}

const PUNCT = [
  '>>=', '<<=', '...', '::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.',
  '(', ')', '[', ']', '{', '}',
];

export function utf8ToBinary(s) {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

// Macros predefined by the Arduino-ESP32 core.
const PREDEFINED = `
#define ESP32 1
#define ARDUINO 10819
#define ARDUINO_ARCH_ESP32 1
#define ESP_ARDUINO_VERSION_MAJOR 3
#define IRAM_ATTR
#define ICACHE_RAM_ATTR
#define PROGMEM
#define DRAM_ATTR
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitToggle(value, bit) ((value) ^= (1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))
#define bit(b) (1UL << (b))
#define lowByte(w) ((uint8_t) ((w) & 0xff))
#define highByte(w) ((uint8_t) ((w) >> 8))
#define sq(x) ((x)*(x))
#define radians(deg) ((deg)*DEG_TO_RAD)
#define degrees(rad) ((rad)*RAD_TO_DEG)
#define pgm_read_byte(addr) (*(addr))
`;

function isIdStart(c) { return /[A-Za-z_]/.test(c); }
function isIdChar(c) { return /[A-Za-z0-9_]/.test(c); }

// Raw tokenizer for one chunk of source. Does not know about directives.
function lexChunk(src, lineBase, out) {
  let i = 0, line = lineBase, col = 1;
  const n = src.length;
  const push = (t, v, extra) => out.push(Object.assign({ t, v, line, col }, extra));
  while (i < n) {
    const c = src[i];
    if (c === '\n') { i++; line++; col = 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; col++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; col = 1; } i++; }
      i += 2; continue;
    }
    const startCol = col;
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      // Raw/prefixed string literals: u8"..", L"..", R"(..)"
      if ((word === 'u8' || word === 'L' || word === 'u' || word === 'U') && src[j] === '"') { col += j - i; i = j; continue; }
      if (word === 'R' && src[j] === '"') {
        const open = src.indexOf('(', j);
        const delim = src.slice(j + 1, open);
        const close = src.indexOf(')' + delim + '"', open);
        if (open < 0 || close < 0) throw new CompileError('unterminated raw string literal', line, col);
        const raw = src.slice(open + 1, close);
        out.push({ t: 'str', v: utf8ToBinary(raw), line, col: startCol });
        for (const ch of src.slice(i, close + delim.length + 2)) if (ch === '\n') { line++; col = 1; }
        i = close + delim.length + 2; continue;
      }
      out.push({ t: 'id', v: word, line, col: startCol });
      col += j - i; i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      let j = i, isFloat = false, value;
      if (c === '0' && /[xX]/.test(src[i + 1])) {
        j = i + 2; while (j < n && /[0-9a-fA-F']/.test(src[j])) j++;
        value = parseInt(src.slice(i + 2, j).replace(/'/g, ''), 16);
      } else if (c === '0' && /[bB]/.test(src[i + 1])) {
        j = i + 2; while (j < n && /[01']/.test(src[j])) j++;
        value = parseInt(src.slice(i + 2, j).replace(/'/g, ''), 2);
      } else {
        while (j < n && /[0-9']/.test(src[j])) j++;
        if (src[j] === '.') { isFloat = true; j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        if (/[eE]/.test(src[j]) && /[-+0-9]/.test(src[j + 1])) {
          isFloat = true; j++; if (/[-+]/.test(src[j])) j++; while (j < n && /[0-9]/.test(src[j])) j++;
        }
        const text = src.slice(i, j).replace(/'/g, '');
        if (!isFloat && text.length > 1 && text[0] === '0') value = parseInt(text, 8);
        else value = isFloat ? parseFloat(text) : parseInt(text, 10);
      }
      let unsigned = false, long = false;
      while (j < n && /[uUlLfF]/.test(src[j])) {
        const s = src[j].toLowerCase();
        if (s === 'u') unsigned = true; else if (s === 'l') long = true; else if (s === 'f') isFloat = true;
        j++;
      }
      if (j < n && isIdChar(src[j])) throw new CompileError(`invalid suffix "${src.slice(j).match(/^\w+/)[0]}" on integer constant`, line, startCol);
      out.push({ t: 'num', v: value, isFloat, unsigned, long, line, col: startCol });
      col += j - i; i = j; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1, s = '';
      while (j < n && src[j] !== q) {
        if (src[j] === '\n') throw new CompileError('missing terminating ' + q + ' character', line, startCol);
        if (src[j] === '\\') {
          j++;
          const e = src[j];
          const map = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v', '?': '?', e: '\x1b' };
          if (e === 'x') {
            let k = j + 1; while (k < n && /[0-9a-fA-F]/.test(src[k]) && k < j + 3) k++;
            s += String.fromCharCode(parseInt(src.slice(j + 1, k), 16)); j = k; continue;
          }
          if (/[0-7]/.test(e)) {
            let k = j; while (k < n && /[0-7]/.test(src[k]) && k < j + 3) k++;
            s += String.fromCharCode(parseInt(src.slice(j, k), 8) & 255); j = k; continue;
          }
          if (e === '\n') { j++; line++; continue; }
          s += map[e] !== undefined ? map[e] : e; j++; continue;
        }
        const cp = src.codePointAt(j);
        const chs = String.fromCodePoint(cp);
        s += cp < 128 ? chs : utf8ToBinary(chs); j += chs.length;
      }
      if (j >= n) throw new CompileError('missing terminating ' + q + ' character', line, startCol);
      const bin = s;
      if (q === '"') out.push({ t: 'str', v: bin, line, col: startCol });
      else {
        if (bin.length === 0) throw new CompileError('empty character constant', line, startCol);
        out.push({ t: 'char', v: bin.charCodeAt(bin.length - 1), line, col: startCol });
      }
      col += j + 1 - i; i = j + 1; continue;
    }
    let p = null;
    for (const op of PUNCT) if (src.startsWith(op, i)) { p = op; break; }
    if (!p) throw new CompileError(`stray '${c}' in program`, line, startCol);
    out.push({ t: 'op', v: p, line, col: startCol });
    i += p.length; col += p.length;
  }
}

// Evaluate a #if expression (after macro expansion) to a number.
function evalCondition(tokens, defines, line) {
  const parts = [];
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === 'id' && tk.v === 'defined') {
      let name, paren = tokens[k + 1] && tokens[k + 1].v === '(';
      name = tokens[k + (paren ? 2 : 1)];
      parts.push(defines.has(name && name.v) ? '1' : '0');
      k += paren ? 3 : 1;
      continue;
    }
    if (tk.t === 'id') {
      const d = defines.get(tk.v);
      if (d && !d.params && d.body.length === 1 && d.body[0].t === 'num') parts.push(String(d.body[0].v));
      else parts.push(tk.v === 'true' ? '1' : '0');
      continue;
    }
    if (tk.t === 'num' || tk.t === 'char') { parts.push(String(tk.v)); continue; }
    if (tk.t === 'op' && /^(\(|\)|!|&&|\|\||==|!=|<|>|<=|>=|\+|-|\*|\/|%|\?|:|&|\||\^|~|<<|>>)$/.test(tk.v)) { parts.push(tk.v); continue; }
    throw new CompileError('invalid token in #if expression', line);
  }
  try {
    // eslint-disable-next-line no-new-func
    return Number(new Function('return (' + (parts.join(' ') || '0') + ');')());
  } catch {
    throw new CompileError('invalid #if expression', line);
  }
}

function expandMacros(tokens, defines) {
  const out = [];
  const expand = (list, hide) => {
    const res = [];
    for (let k = 0; k < list.length; k++) {
      const tk = list[k];
      const def = tk.t === 'id' && !hide.has(tk.v) ? defines.get(tk.v) : null;
      if (!def) { res.push(tk); continue; }
      const retag = (b) => Object.assign({}, b, { line: tk.line, col: tk.col });
      if (!def.params) {
        const h = new Set(hide); h.add(tk.v);
        res.push(...expand(def.body.map(retag), h));
        continue;
      }
      if (!list[k + 1] || list[k + 1].v !== '(') { res.push(tk); continue; }
      // collect arguments
      const args = []; let cur = [], depth = 0, j = k + 2;
      for (; j < list.length; j++) {
        const a = list[j];
        if (a.t === 'op' && (a.v === '(' || a.v === '[' || a.v === '{')) depth++;
        if (a.t === 'op' && (a.v === ')' || a.v === ']' || a.v === '}')) {
          if (depth === 0 && a.v === ')') break;
          depth--;
        }
        if (a.t === 'op' && a.v === ',' && depth === 0) { args.push(cur); cur = []; continue; }
        cur.push(a);
      }
      if (j >= list.length) throw new CompileError(`unterminated argument list invoking macro "${tk.v}"`, tk.line, tk.col);
      if (cur.length || args.length) args.push(cur);
      if (args.length !== def.params.length && !(def.params.length === 0 && args.length === 0))
        throw new CompileError(`macro "${tk.v}" requires ${def.params.length} arguments, but ${args.length} given`, tk.line, tk.col);
      const body = [];
      for (const b of def.body) {
        const pi = b.t === 'id' ? def.params.indexOf(b.v) : -1;
        if (pi >= 0) body.push(...args[pi]); else body.push(retag(b));
      }
      const h = new Set(hide); h.add(tk.v);
      res.push(...expand(body, h));
      k = j;
    }
    return res;
  };
  out.push(...expand(tokens, new Set()));
  return out;
}

// extraDefines: board-specific predefined macros (e.g. CONFIG_IDF_TARGET_ESP32C3)
export function preprocessAndTokenize(source, extraDefines = '') {
  const defines = new Map();
  const includes = [];
  const all = [];
  const run = (src, isPrelude) => {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const cond = []; // stack of {active, taken, parentActive}
    const active = () => cond.every((c) => c.active);
    let chunk = [], chunkStart = 1;
    const flush = (nextLine) => {
      if (chunk.length) {
        const toks = [];
        lexChunk(chunk.join('\n'), chunkStart, toks);
        if (!isPrelude) all.push(...toks);
      }
      chunk = []; chunkStart = nextLine;
    };
    let inBlockComment = false;
    for (let li = 0; li < lines.length; li++) {
      let text = lines[li];
      const lineNo = li + 1;
      const trimmed = text.trim();
      if (!inBlockComment && trimmed.startsWith('#')) {
        flush(lineNo + 1);
        let full = trimmed;
        while (full.endsWith('\\') && li + 1 < lines.length) { full = full.slice(0, -1) + ' ' + lines[++li].trim(); chunkStart = li + 2; }
        full = full.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        const m = full.match(/^#\s*(\w+)\s*(.*)$/);
        if (!m) continue;
        const [, dir, rest] = m;
        if (dir === 'ifdef' || dir === 'ifndef') {
          const has = defines.has(rest.trim().split(/\s+/)[0]);
          const v = dir === 'ifdef' ? has : !has;
          cond.push({ active: v, taken: v });
        } else if (dir === 'if') {
          const v = active() ? !!evalIf(rest, lineNo, defines) : false;
          cond.push({ active: v, taken: v });
        } else if (dir === 'elif') {
          const top = cond[cond.length - 1];
          if (!top) throw new CompileError('#elif without #if', lineNo);
          if (top.taken) top.active = false;
          else { top.active = !!evalIf(rest, lineNo, defines); top.taken = top.active; }
        } else if (dir === 'else') {
          const top = cond[cond.length - 1];
          if (!top) throw new CompileError('#else without #if', lineNo);
          top.active = !top.taken; top.taken = true;
        } else if (dir === 'endif') {
          if (!cond.length) throw new CompileError('#endif without #if', lineNo);
          cond.pop();
        } else if (!active()) {
          continue;
        } else if (dir === 'define') {
          const dm = rest.match(/^(\w+)(\(([^)]*)\))?\s*(.*)$/);
          if (!dm) throw new CompileError('macro names must be identifiers', lineNo);
          const params = dm[2] !== undefined ? dm[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
          defines.set(dm[1], { params, body: lexLine(dm[4], lineNo) });
        } else if (dir === 'undef') {
          defines.delete(rest.trim());
        } else if (dir === 'include') {
          includes.push({ name: rest.replace(/[<>"]/g, '').trim(), line: lineNo });
        } else if (dir === 'error') {
          throw new CompileError('#error ' + rest, lineNo);
        } // #pragma, #warning, #line: ignored
        continue;
      }
      if (!active()) { flush(lineNo + 1); continue; }
      // track block comments spanning lines so '#' inside them is not a directive
      let k = 0, inStr = null;
      while (k < text.length) {
        const ch = text[k];
        if (inBlockComment) { if (ch === '*' && text[k + 1] === '/') { inBlockComment = false; k++; } }
        else if (inStr) { if (ch === '\\') k++; else if (ch === inStr) inStr = null; }
        else if (ch === '"' || ch === "'") inStr = ch;
        else if (ch === '/' && text[k + 1] === '/') break;
        else if (ch === '/' && text[k + 1] === '*') { inBlockComment = true; k++; }
        k++;
      }
      if (!chunk.length) chunkStart = lineNo;
      chunk.push(text);
    }
    flush(lines.length + 1);
    if (cond.length) throw new CompileError('unterminated #if', lines.length);
  };
  run(PREDEFINED + extraDefines, true);
  run(source, false);
  // Arduino's F() macro and similar wrappers are handled as functions; expand user macros.
  const expanded = expandMacros(all, defines);
  // join adjacent string literals
  const tokens = [];
  for (const tk of expanded) {
    const prev = tokens[tokens.length - 1];
    if (tk.t === 'str' && prev && prev.t === 'str') { prev.v += tk.v; continue; }
    tokens.push(tk);
  }
  const last = tokens[tokens.length - 1];
  tokens.push({ t: 'eof', v: '<eof>', line: last ? last.line : 1, col: 1 });
  return { tokens, includes, defines };
}

function lexLine(text, line) {
  const toks = [];
  lexChunk(text, line, toks);
  return toks;
}

// `defined X` must be resolved before macro expansion.
function evalIf(rest, line, defines) {
  const raw = lexLine(rest, line);
  const toks = [];
  for (let k = 0; k < raw.length; k++) {
    const tk = raw[k];
    if (tk.t === 'id' && tk.v === 'defined') {
      const paren = raw[k + 1] && raw[k + 1].v === '(';
      const name = raw[k + (paren ? 2 : 1)];
      toks.push({ t: 'num', v: defines.has(name && name.v) ? 1 : 0, line });
      k += paren ? 3 : 1;
      continue;
    }
    toks.push(tk);
  }
  return evalCondition(expandMacros(toks, defines), defines, line);
}
