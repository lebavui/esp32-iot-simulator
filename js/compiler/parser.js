// Recursive-descent parser for the Arduino C/C++ subset -> AST.
import { CompileError } from './lexer.js';

export const BASE_TYPES = new Set([
  'void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
  'byte', 'word', 'size_t', 'String', 'string', 'auto',
  'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t',
]);
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'extern', 'inline', 'constexpr', 'register', 'struct', 'class', 'enum', 'typename']);

const BIN_PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

// Normalise a list of type keywords into a canonical type descriptor.
export function canonicalType(words, name, tmpl) {
  const has = (w) => words.includes(w);
  const longs = words.filter((w) => w === 'long').length;
  const uns = has('unsigned');
  if (name) {
    if (name === 'string') return { k: 'String' };
    return { k: 'named', name, tmpl };
  }
  if (has('float')) return { k: 'float', bits: 32 };
  if (has('double')) return { k: 'float', bits: 64 };
  if (has('void')) return { k: 'void' };
  if (has('auto')) return { k: 'auto' };
  if (has('bool') || has('boolean')) return { k: 'bool' };
  if (has('String') || has('string')) return { k: 'String' };
  if (has('char')) return uns ? { k: 'int', bits: 8, uns: true } : { k: 'char' };
  if (has('byte') || has('uint8_t')) return { k: 'int', bits: 8, uns: true };
  if (has('int8_t')) return { k: 'int', bits: 8, uns: false };
  if (has('uint16_t') || has('word')) return { k: 'int', bits: 16, uns: true };
  if (has('int16_t') || has('short')) return { k: 'int', bits: 16, uns };
  if (has('uint32_t') || has('size_t')) return { k: 'int', bits: 32, uns: true };
  if (has('int32_t')) return { k: 'int', bits: 32, uns: false };
  if (has('uint64_t')) return { k: 'int', bits: 64, uns: true };
  if (has('int64_t') || longs >= 2) return { k: 'int', bits: 64, uns };
  return { k: 'int', bits: 32, uns };
}

export function parse(tokens, knownClasses) {
  return new Parser(tokens, knownClasses).parseProgram();
}

class Parser {
  constructor(tokens, knownClasses) {
    this.toks = tokens;
    this.pos = 0;
    this.types = new Set(knownClasses || []);
  }
  peek(k = 0) { return this.toks[Math.min(this.pos + k, this.toks.length - 1)]; }
  next() { return this.toks[this.pos++]; }
  is(v, k = 0) { const t = this.peek(k); return (t.t === 'op' || t.t === 'id') && t.v === v; }
  isOp(v, k = 0) { const t = this.peek(k); return t.t === 'op' && t.v === v; }
  accept(v) { if (this.is(v)) { return this.next(); } return null; }
  err(msg, tk) { tk = tk || this.peek(); return new CompileError(msg, tk.line, tk.col); }
  expect(v, what) {
    if (this.is(v)) return this.next();
    const tk = this.peek();
    throw this.err(`expected '${v}'${what ? ' ' + what : ''} before '${tk.t === 'str' ? '"' + tk.v + '"' : tk.v}'`, tk);
  }
  ident() {
    const tk = this.peek();
    if (tk.t !== 'id') throw this.err(`expected identifier before '${tk.v}'`);
    this.pos++;
    return tk.v;
  }

  isTypeName(v) { return BASE_TYPES.has(v) || this.types.has(v); }

  // Is the token sequence at offset k the beginning of a type (for declarations/casts)?
  looksLikeType(k = 0) {
    const t = this.peek(k);
    if (t.t !== 'id') return false;
    if (QUALIFIERS.has(t.v)) return true;
    if (t.v === 'std' && this.isOp('::', k + 1)) return true;
    return this.isTypeName(t.v);
  }

  looksLikeDecl() {
    const t = this.peek();
    if (t.t !== 'id') return false;
    if (QUALIFIERS.has(t.v)) return true;
    const n1 = this.peek(1);
    if (BASE_TYPES.has(t.v)) return !(n1.t === 'op' && (n1.v === '(' || n1.v === '.' || n1.v === '::'));
    if (t.v === 'std' && this.isOp('::', 1)) return this.peek(3).t === 'id' || this.isOp('<', 3);
    if (this.types.has(t.v)) {
      if (n1.t === 'id') return true;
      if (n1.t === 'op' && (n1.v === '*' || n1.v === '&')) return this.peek(2).t === 'id';
      if (n1.t === 'op' && n1.v === '<') return true;
      return false;
    }
    // Unknown identifier followed by identifier: declaration with an unknown type
    if (n1.t === 'id' && !['return', 'else', 'case', 'goto', 'delete', 'new'].includes(t.v)) return true;
    return false;
  }

  parseTypeSpec() {
    const start = this.peek();
    const words = [];
    let name = null, tmpl = null, isConst = false, isStatic = false;
    for (;;) {
      const t = this.peek();
      if (t.t !== 'id') break;
      if (t.v === 'const' || t.v === 'constexpr') { isConst = true; this.pos++; continue; }
      if (t.v === 'static') { isStatic = true; this.pos++; continue; }
      if (['volatile', 'extern', 'inline', 'register', 'struct', 'class', 'enum', 'typename'].includes(t.v)) { this.pos++; continue; }
      if (t.v === 'std' && this.isOp('::', 1)) { this.pos += 2; continue; }
      if (BASE_TYPES.has(t.v) && !name) {
        // `long` etc. may combine; String/auto stand alone
        words.push(t.v); this.pos++; continue;
      }
      if (!name && words.length === 0) {
        name = t.v; this.pos++;
        if (this.isOp('<')) tmpl = this.parseTemplateArgs();
        while (this.isOp('::') && this.peek(1).t === 'id') { this.pos++; name = name + '::' + this.next().v; }
        continue;
      }
      break;
    }
    if (!words.length && !name) throw this.err(`expected type-specifier before '${start.v}'`, start);
    const type = canonicalType(words, name, tmpl);
    type.isConst = isConst;
    type.isStatic = isStatic;
    type.ptr = 0;
    while (this.isOp('*') || (this.is('const') && this.isOp('*', -1))) {
      if (this.accept('const')) continue;
      this.pos++; type.ptr++;
    }
    return type;
  }

  parseTemplateArgs() {
    this.expect('<');
    const args = [];
    let depth = 0;
    let cur = [];
    for (;;) {
      const t = this.next();
      if (t.t === 'eof') throw this.err('unterminated template argument list', t);
      if (t.t === 'op' && t.v === '<') depth++;
      if (t.t === 'op' && (t.v === '>' || t.v === '>>')) {
        if (depth === 0) { args.push(cur); break; }
        depth--;
      }
      if (t.t === 'op' && t.v === ',' && depth === 0) { args.push(cur); cur = []; continue; }
      cur.push(t);
    }
    return args.map((a) => {
      if (a.length === 1 && a[0].t === 'num') return { num: a[0].v };
      const words = a.filter((x) => x.t === 'id').map((x) => x.v);
      const named = words.filter((w) => !BASE_TYPES.has(w) && w !== 'const' && w !== 'std');
      return canonicalType(words.filter((w) => BASE_TYPES.has(w)), named[0] || null);
    });
  }

  parseProgram() {
    const body = [];
    while (this.peek().t !== 'eof') {
      if (this.accept(';')) continue;
      body.push(...this.parseTopLevel());
    }
    return { k: 'Program', body };
  }

  skipStatement() {
    while (!this.isOp(';') && this.peek().t !== 'eof') this.pos++;
    this.accept(';');
  }

  parseTopLevel() {
    const t = this.peek();
    if (t.t === 'id') {
      if (t.v === 'using' || t.v === 'namespace') { this.skipStatement(); return []; }
      if (t.v === 'template') throw this.err('templates are not supported by the simulator');
      if (t.v === 'typedef') return this.parseTypedef();
      if ((t.v === 'struct' || t.v === 'class') && (this.isOp('{', 1) || (this.peek(1).t === 'id' && (this.isOp('{', 2) || this.isOp(':', 2)))))
        return this.parseStructDef();
      if (t.v === 'enum') {
        const k = this.is('class', 1) || this.is('struct', 1) ? 2 : 1;
        if (this.isOp('{', k) || (this.peek(k).t === 'id' && (this.isOp('{', k + 1) || this.isOp(':', k + 1)))) return this.parseEnumDef();
      }
    }
    if (!this.looksLikeDecl() && !(t.t === 'id' && this.peek(1).t === 'op' && this.peek(1).v === '(')) {
      throw this.err(`expected unqualified-id before '${t.v}'`);
    }
    // `setup() {...}` without return type is an error in C++
    const type = this.parseTypeSpec();
    return [this.parseDeclRest(type, true)];
  }

  parseTypedef() {
    const line = this.next().line;
    if ((this.is('struct') || this.is('class')) && (this.isOp('{', 1) || this.isOp('{', 2))) {
      const st = this.parseStructDef(true);
      const alias = this.ident();
      this.expect(';');
      st[0].name = st[0].name || alias;
      this.types.add(alias);
      if (st[0].name !== alias) return [...st, { k: 'Typedef', name: alias, type: { k: 'named', name: st[0].name }, line }];
      return st;
    }
    if (this.is('enum')) {
      const en = this.parseEnumDef(true);
      const alias = this.ident();
      this.expect(';');
      this.types.add(alias);
      en[0].name = en[0].name || alias;
      return en;
    }
    const type = this.parseTypeSpec();
    const name = this.ident();
    this.expect(';');
    this.types.add(name);
    return [{ k: 'Typedef', name, type, line }];
  }

  parseStructDef(noDecl) {
    const line = this.next().line; // struct / class
    let name = null;
    if (this.peek().t === 'id') name = this.ident();
    if (name) this.types.add(name);
    if (this.accept(':')) { while (!this.isOp('{')) this.pos++; }
    this.expect('{');
    const fields = [];
    while (!this.isOp('}')) {
      if (this.accept(';')) continue;
      if ((this.is('public') || this.is('private') || this.is('protected')) && this.isOp(':', 1)) { this.pos += 2; continue; }
      const type = this.parseTypeSpec();
      if (this.isOp('(') || (this.peek().t === 'id' && this.isOp('(', 1))) {
        throw this.err('member functions / constructors in struct/class are not supported by the simulator');
      }
      const decl = this.parseDeclRest(type, false);
      if (decl.k !== 'VarDecl') throw this.err('unsupported struct member');
      fields.push(decl);
    }
    this.expect('}');
    const res = [{ k: 'StructDef', name, fields, line }];
    if (!noDecl) {
      if (this.peek().t === 'id' && name) {
        res.push(this.parseDeclRest({ k: 'named', name, ptr: 0 }, true));
      } else this.expect(';', 'after struct definition');
    }
    return res;
  }

  parseEnumDef(noDecl) {
    const line = this.next().line;
    let isClass = false;
    if (this.accept('class') || this.accept('struct')) isClass = true;
    let name = null;
    if (this.peek().t === 'id') name = this.ident();
    if (name) this.types.add(name);
    if (this.accept(':')) this.parseTypeSpec();
    this.expect('{');
    const items = [];
    while (!this.isOp('}')) {
      const iname = this.ident();
      let value = null;
      if (this.accept('=')) value = this.parseAssign();
      items.push({ name: iname, value });
      if (!this.accept(',')) break;
    }
    this.expect('}');
    const res = [{ k: 'EnumDef', name, items, isClass, line }];
    if (!noDecl) {
      if (this.peek().t === 'id' && name) res.push(this.parseDeclRest({ k: 'named', name, ptr: 0 }, true));
      else this.expect(';', 'after enum definition');
    }
    return res;
  }

  // Are we looking at a parameter list (function) rather than constructor arguments?
  looksLikeParams() {
    // current token is '('
    if (this.isOp(')', 1)) return true;
    if (this.is('void', 1) && this.isOp(')', 2)) return true;
    const t = this.peek(1);
    if (t.t !== 'id') return false;
    if (QUALIFIERS.has(t.v) || BASE_TYPES.has(t.v)) return true;
    if (this.types.has(t.v)) {
      const n = this.peek(2);
      return n.t === 'id' || (n.t === 'op' && (n.v === '*' || n.v === '&' || n.v === '<' || n.v === ')' || n.v === ','));
    }
    return this.peek(2).t === 'id' && (this.isOp(',', 3) || this.isOp(')', 3) || this.isOp('=', 3) || this.isOp('[', 3));
  }

  // After a type spec: function definition/prototype or variable declarators.
  parseDeclRest(type, allowFunc) {
    const line = this.peek().line;
    // declarator
    const first = this.parseDeclarator(type);
    if (allowFunc && this.isOp('(') && this.looksLikeParams()) {
      const params = this.parseParams();
      while (this.is('const') || this.is('override') || this.is('noexcept')) this.pos++;
      if (this.accept(';')) return { k: 'FuncDef', ret: first.type, name: first.name, params, body: null, line };
      const body = this.parseBlock();
      return { k: 'FuncDef', ret: first.type, name: first.name, params, body, line };
    }
    const decls = [this.finishDeclarator(first)];
    while (this.accept(',')) decls.push(this.finishDeclarator(this.parseDeclarator(type)));
    this.expect(';', 'after declaration');
    return { k: 'VarDecl', type, decls, line };
  }

  parseDeclarator(baseType) {
    const type = Object.assign({}, baseType);
    while (this.isOp('*') || this.is('const')) { if (this.next().v === '*') type.ptr = (type.ptr || 0) + 1; }
    let ref = false;
    if (this.accept('&')) ref = true;
    const tk = this.peek();
    const name = this.ident();
    const dims = [];
    while (this.isOp('[')) {
      this.next();
      if (this.isOp(']')) { this.next(); dims.push(null); continue; }
      dims.push(this.parseExpr());
      this.expect(']');
    }
    return { name, type, ref, dims, line: tk.line, col: tk.col };
  }

  finishDeclarator(d) {
    if (this.accept('=')) {
      d.init = this.isOp('{') ? this.parseInitList() : this.parseAssign();
    } else if (this.isOp('(')) {
      this.next();
      d.ctorArgs = [];
      if (!this.isOp(')')) {
        do { d.ctorArgs.push(this.parseAssign()); } while (this.accept(','));
      }
      this.expect(')');
    } else if (this.isOp('{')) {
      const il = this.parseInitList();
      if (d.type.k === 'named') d.ctorArgs = il.items; else d.init = il.items.length === 1 && !d.dims.length ? il.items[0] : il;
    }
    return d;
  }

  parseInitList() {
    const line = this.expect('{').line;
    const items = [];
    while (!this.isOp('}')) {
      if (this.isOp('.') && this.peek(1).t === 'id' && this.isOp('=', 2)) this.pos += 3; // designated init
      items.push(this.isOp('{') ? this.parseInitList() : this.parseAssign());
      if (!this.accept(',')) break;
    }
    this.expect('}');
    return { k: 'InitList', items, line };
  }

  parseParams() {
    this.expect('(');
    const params = [];
    if (this.is('void') && this.isOp(')', 1)) this.next();
    while (!this.isOp(')')) {
      const type = this.parseTypeSpec();
      const p = { type: Object.assign({}, type), name: null, ref: false, dims: [] };
      while (this.isOp('*') || this.is('const')) { if (this.next().v === '*') p.type.ptr++; }
      if (this.accept('&')) p.ref = true;
      if (this.peek().t === 'id') p.name = this.ident();
      while (this.isOp('[')) { this.next(); if (!this.isOp(']')) this.parseExpr(); this.expect(']'); p.type.ptr++; }
      if (this.accept('=')) p.def = this.parseAssign();
      params.push(p);
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return params;
  }

  // ---------- statements ----------
  parseBlock() {
    const line = this.expect('{').line;
    const body = [];
    while (!this.isOp('}')) {
      if (this.peek().t === 'eof') throw this.err("expected '}' at end of input");
      body.push(this.parseStatement());
    }
    this.next();
    return { k: 'Block', body, line };
  }

  parseStatement() {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'op' && t.v === '{') return this.parseBlock();
    if (t.t === 'op' && t.v === ';') { this.next(); return { k: 'Empty', line }; }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('(');
          const test = this.parseExpr(); this.expect(')');
          const cons = this.parseStatement();
          let alt = null;
          if (this.accept('else')) alt = this.parseStatement();
          return { k: 'If', test, cons, alt, line };
        }
        case 'while': {
          this.next(); this.expect('(');
          const test = this.parseExpr(); this.expect(')');
          return { k: 'While', test, body: this.parseStatement(), line };
        }
        case 'do': {
          this.next();
          const body = this.parseStatement();
          this.expect('while'); this.expect('(');
          const test = this.parseExpr(); this.expect(')'); this.expect(';');
          return { k: 'Do', body, test, line };
        }
        case 'for': return this.parseFor();
        case 'switch': return this.parseSwitch();
        case 'break': this.next(); this.expect(';'); return { k: 'Break', line };
        case 'continue': this.next(); this.expect(';'); return { k: 'Continue', line };
        case 'return': {
          this.next();
          const arg = this.isOp(';') ? null : this.parseExpr();
          this.expect(';');
          return { k: 'Return', arg, line };
        }
        case 'goto': throw this.err("'goto' is not supported by the simulator");
        case 'case': case 'default': throw this.err(`'${t.v}' label not within a switch statement`);
        case 'struct': case 'class':
          if (this.isOp('{', 2) || this.isOp('{', 1)) throw this.err('struct definitions must be at global scope in the simulator');
          break;
        case 'typedef': throw this.err('typedef must be at global scope in the simulator');
        default: break;
      }
    }
    if (this.looksLikeDecl()) {
      const type = this.parseTypeSpec();
      return this.parseDeclRest(type, false);
    }
    const expr = this.parseExpr();
    this.expect(';', 'after expression');
    return { k: 'ExprStmt', expr, line };
  }

  parseFor() {
    const line = this.next().line;
    this.expect('(');
    let init = null;
    if (!this.isOp(';')) {
      if (this.looksLikeDecl()) {
        const type = this.parseTypeSpec();
        const d = this.parseDeclarator(type);
        if (this.accept(':')) {
          const expr = this.parseExpr();
          this.expect(')');
          return { k: 'ForRange', decl: d, expr, body: this.parseStatement(), line };
        }
        const decls = [this.finishDeclarator(d)];
        while (this.accept(',')) decls.push(this.finishDeclarator(this.parseDeclarator(type)));
        init = { k: 'VarDecl', type, decls, line };
      } else init = { k: 'ExprStmt', expr: this.parseExpr(), line };
    }
    this.expect(';');
    const test = this.isOp(';') ? null : this.parseExpr();
    this.expect(';');
    const update = this.isOp(')') ? null : this.parseExpr();
    this.expect(')');
    return { k: 'For', init, test, update, body: this.parseStatement(), line };
  }

  parseSwitch() {
    const line = this.next().line;
    this.expect('(');
    const disc = this.parseExpr();
    this.expect(')');
    this.expect('{');
    const cases = [];
    let cur = null;
    while (!this.isOp('}')) {
      if (this.is('case')) {
        const cl = this.next().line;
        const test = this.parseConditional();
        if (this.accept('...')) { // GNU case range
          const hi = this.parseConditional();
          this.expect(':');
          cur = { test, hi, body: [], line: cl };
        } else { this.expect(':'); cur = { test, body: [], line: cl }; }
        cases.push(cur);
        continue;
      }
      if (this.is('default')) {
        const cl = this.next().line;
        this.expect(':');
        cur = { test: null, body: [], line: cl };
        cases.push(cur);
        continue;
      }
      if (!cur) throw this.err('statement before first case label');
      cur.body.push(this.parseStatement());
    }
    this.next();
    return { k: 'Switch', disc, cases, line };
  }

  // ---------- expressions ----------
  parseExpr() {
    const first = this.parseAssign();
    if (!this.isOp(',')) return first;
    const exprs = [first];
    while (this.accept(',')) exprs.push(this.parseAssign());
    return { k: 'Comma', exprs, line: first.line };
  }

  parseAssign() {
    const left = this.parseConditional();
    const t = this.peek();
    if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
      this.next();
      const value = this.isOp('{') ? this.parseInitList() : this.parseAssign();
      return { k: 'Assign', op: t.v, target: left, value, line: t.line };
    }
    return left;
  }

  parseConditional() {
    const test = this.parseBinary(1);
    if (this.isOp('?')) {
      const line = this.next().line;
      const cons = this.parseExpr();
      this.expect(':');
      const alt = this.parseAssign();
      return { k: 'Cond', test, cons, alt, line };
    }
    return test;
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (!prec || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { k: 'Binary', op: t.v, l: left, r: right, line: t.line };
    }
    return left;
  }

  isCastAhead() {
    if (!this.isOp('(')) return false;
    if (!this.looksLikeType(1)) return false;
    // scan to matching ')' and make sure it contains only type tokens
    let k = 1, depth = 0;
    for (;; k++) {
      const t = this.peek(k);
      if (t.t === 'eof') return false;
      if (t.t === 'op' && t.v === '<') depth++;
      else if (t.t === 'op' && t.v === '>') depth--;
      else if (t.t === 'op' && t.v === ')' && depth <= 0) break;
      else if (t.t === 'op' && !['*', '&', '::', ','].includes(t.v)) return false;
      else if (t.t !== 'op' && t.t !== 'id' && !(t.t === 'num' && depth > 0)) return false;
    }
    const after = this.peek(k + 1);
    // `(int)(x)`, `(char)y`, `(float)-x`
    if (after.t === 'op' && [')', ';', ',', ']', '}', '?', ':', '=', '==', '!=', '<', '>', '|', '^', '/', '%', '||', '&&', '.', '->'].includes(after.v)) return false;
    return true;
  }

  parseUnary() {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'op') {
      if (t.v === '++' || t.v === '--') { this.next(); return { k: 'Update', op: t.v, prefix: true, arg: this.parseUnary(), line }; }
      if (['-', '+', '!', '~'].includes(t.v)) { this.next(); return { k: 'Unary', op: t.v, arg: this.parseUnary(), line }; }
      if (t.v === '*') { this.next(); return { k: 'Deref', arg: this.parseUnary(), line }; }
      if (t.v === '&') { this.next(); return { k: 'AddrOf', arg: this.parseUnary(), line }; }
      if (t.v === '(' && this.isCastAhead()) {
        this.next();
        const type = this.parseTypeSpec();
        while (this.accept('&')) { /* reference cast */ }
        this.expect(')');
        return { k: 'Cast', type, arg: this.parseUnary(), line };
      }
    }
    if (t.t === 'id') {
      if (t.v === 'sizeof') {
        this.next();
        if (this.isOp('(') && this.looksLikeType(1) && !(this.peek(1).t === 'id' && !QUALIFIERS.has(this.peek(1).v) && !this.isTypeName(this.peek(1).v))) {
          // sizeof(type) – but a variable named like a type is unlikely
          const save = this.pos;
          this.next();
          try {
            const type = this.parseTypeSpec();
            if (this.accept(')')) return { k: 'SizeofType', type, line };
          } catch { /* fallthrough */ }
          this.pos = save;
        }
        return { k: 'SizeofExpr', arg: this.parseUnary(), line };
      }
      if (t.v === 'new' || t.v === 'delete') throw this.err(`'${t.v}' (dynamic memory) is not supported by the simulator`);
    }
    return this.parsePostfix(this.parsePrimary());
  }

  parseArgs() {
    this.expect('(');
    const args = [];
    if (!this.isOp(')')) {
      do { args.push(this.isOp('{') ? this.parseInitList() : this.parseAssign()); } while (this.accept(','));
    }
    this.expect(')');
    return args;
  }

  parsePostfix(expr) {
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') break;
      if (t.v === '(') { expr = { k: 'Call', callee: expr, args: this.parseArgs(), line: t.line }; continue; }
      if (t.v === '[') {
        this.next();
        const index = this.parseExpr();
        this.expect(']');
        expr = { k: 'Index', obj: expr, index, line: t.line };
        continue;
      }
      if (t.v === '.' || t.v === '->') {
        this.next();
        const nameTk = this.peek();
        const prop = this.ident();
        let tmpl = null;
        if (this.isOp('<') && this.looksLikeType(1)) {
          const save = this.pos;
          try {
            tmpl = this.parseTemplateArgs();
            if (!this.isOp('(')) { this.pos = save; tmpl = null; }
          } catch { this.pos = save; tmpl = null; }
        }
        expr = { k: 'Member', obj: expr, prop, tmpl, line: nameTk.line };
        continue;
      }
      if (t.v === '++' || t.v === '--') { this.next(); expr = { k: 'Update', op: t.v, prefix: false, arg: expr, line: t.line }; continue; }
      break;
    }
    return expr;
  }

  parsePrimary() {
    const t = this.next();
    const line = t.line;
    switch (t.t) {
      case 'num': return { k: 'Num', v: t.v, isFloat: t.isFloat, unsigned: t.unsigned, long: t.long, line };
      case 'str': return { k: 'Str', v: t.v, line };
      case 'char': return { k: 'Char', v: t.v, line };
      case 'id': {
        if (t.v === 'true' || t.v === 'false') return { k: 'Bool', v: t.v === 'true', line };
        if (t.v === 'nullptr' || t.v === 'NULL') return { k: 'Null', line };
        if (['static_cast', 'reinterpret_cast', 'const_cast', 'dynamic_cast'].includes(t.v)) {
          const ta = this.parseTemplateArgs();
          this.expect('(');
          const arg = this.parseExpr();
          this.expect(')');
          return { k: 'Cast', type: Object.assign({ ptr: 0 }, ta[0]), arg, line };
        }
        let name = t.v;
        if (name === 'std' && this.isOp('::')) { this.next(); name = this.ident(); }
        // template function call, e.g. min<int>(a,b) – ignore the template args
        if (this.isOp('<') && this.looksLikeType(1) && ['min', 'max', 'constrain', 'abs'].includes(name)) this.parseTemplateArgs();
        if (this.isOp('::')) {
          const parts = [name];
          while (this.accept('::')) parts.push(this.ident());
          return { k: 'Scoped', parts, line, col: t.col };
        }
        // functional cast for base types: int(x), float(x), uint8_t(x)
        if (BASE_TYPES.has(name) && name !== 'String' && this.isOp('(')) {
          const args = this.parseArgs();
          return { k: 'Cast', type: Object.assign({ ptr: 0 }, canonicalType([name], null)), arg: args[0], line };
        }
        return { k: 'Ident', name, line, col: t.col };
      }
      case 'op':
        if (t.v === '(') {
          const e = this.parseExpr();
          this.expect(')');
          return e;
        }
        if (t.v === '[') return this.parseLambda(t);
        if (t.v === '{') { this.pos--; return this.parseInitList(); }
        if (t.v === '::') return this.parsePrimary();
        break;
      default: break;
    }
    throw this.err(`expected primary-expression before '${t.t === 'eof' ? 'end of input' : t.v}'`, t);
  }

  parseLambda(t) {
    while (!this.isOp(']')) { if (this.peek().t === 'eof') throw this.err('bad lambda'); this.pos++; }
    this.next();
    const params = this.isOp('(') ? this.parseParams() : [];
    let ret = null;
    if (this.accept('->')) ret = this.parseTypeSpec();
    const body = this.parseBlock();
    return { k: 'Lambda', params, ret, body, line: t.line };
  }
}
