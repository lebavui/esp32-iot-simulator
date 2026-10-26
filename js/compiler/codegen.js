// Code generator: AST -> JavaScript source (async functions, so delay() can suspend).
// Static C types are tracked to reproduce integer arithmetic, float printing and String semantics.
import { CompileError } from './lexer.js';
import { FUNCS, CONSTS, OBJECTS, JSON_VALUE_TYPES, STRING_METHODS } from '../runtime/meta.js';

const T = {
  i8: { k: 'int', bits: 8, uns: false }, u8: { k: 'int', bits: 8, uns: true },
  i16: { k: 'int', bits: 16, uns: false }, u16: { k: 'int', bits: 16, uns: true },
  i32: { k: 'int', bits: 32, uns: false }, u32: { k: 'int', bits: 32, uns: true },
  i64: { k: 'int', bits: 64, uns: false }, u64: { k: 'int', bits: 64, uns: true },
  char: { k: 'char' }, bool: { k: 'bool' }, f32: { k: 'float', bits: 32 }, f64: { k: 'float', bits: 64 },
  String: { k: 'String' }, cstr: { k: 'cstr' }, void: { k: 'void' }, any: { k: 'any' }, func: { k: 'func' },
  null: { k: 'null' },
};

const isInt = (t) => t.k === 'int' || t.k === 'char' || t.k === 'bool';
const isFloat = (t) => t.k === 'float';
const isNum = (t) => isInt(t) || isFloat(t);
const isCharArr = (t) => t.k === 'array' && (t.elem.k === 'char' || (t.elem.k === 'int' && t.elem.bits === 8));
const isStrLike = (t) => t.k === 'String' || t.k === 'cstr';
// enum types of the ESP-IDF / library headers, handled as int
export const INT_TYPES = new Set(['esp_now_send_status_t', 'wifi_interface_t', 'wifi_mode_t', 'COAP_TYPE', 'COAP_METHOD',
  'COAP_RESPONSE_CODE', 'COAP_CONTENT_TYPE', 'COAP_OPTION_NUMBER']);
const isDyn = (t) => t.k === 'any' || t.k === 'class';

const ASYNC_FUNCS = new Set(['delay', 'delayMicroseconds', 'yield', 'pulseIn', 'pulseInLong', 'vTaskDelay',
  'taskYIELD', 'serializeJson', 'serializeJsonPretty', 'getLocalTime', 'esp_restart', 'vTaskDelete']);
const PRINT_METHODS = new Set(['print', 'println']);
const YIELD = 'if(++$.c>4096)await $.y();';

function typeName(t) {
  if (!t) return '?';
  switch (t.k) {
    case 'int': return (t.uns ? 'unsigned ' : '') + ({ 8: 'char', 16: 'short', 32: 'int', 64: 'long long' }[t.bits]);
    case 'float': return t.bits === 32 ? 'float' : 'double';
    case 'cstr': return 'const char*';
    case 'class': return 'class ' + t.name;
    case 'struct': return 'struct ' + t.name;
    case 'array': return typeName(t.elem) + '[]';
    default: return t.k;
  }
}

class Scope {
  constructor(parent, fn) { this.parent = parent; this.vars = new Map(); this.fn = fn || (parent && parent.fn) || null; }
  lookup(name) {
    for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    return null;
  }
}

// consts: overrides of meta.js CONSTS for the selected board (null = not defined on that board)
export function generate(ast, libs, consts) {
  return new Gen(libs, consts).program(ast);
}

class Gen {
  constructor(libs, consts) {
    this.libs = libs || {};
    this.consts = { ...CONSTS, ...consts };
    this.global = new Scope(null, null);
    this.funcs = new Map(); // name -> [{params, ret, js}]
    this.structs = new Map();
    this.typedefs = new Map();
    this.enums = new Map();
    this.warnings = [];
    this.uid = 0;
    this.statics = [];
    this.staticInit = [];
  }

  err(msg, node) { return new CompileError(msg, node ? node.line : 0, node ? node.col || 0 : 0); }
  warn(msg, node) { this.warnings.push({ msg, line: node ? node.line : 0 }); }

  // ---------- types ----------
  typeFromMeta(s) {
    if (!s) return T.any;
    if (s.startsWith('class:')) return { k: 'class', name: s.slice(6) };
    const m = { int: T.i32, long: T.i32, ulong: T.u32, u32: T.u32, u16: T.u16, u8: T.u8, i64: T.i64, float: T.f32, double: T.f64, bool: T.bool, String: T.String, char: T.char, void: T.void, cstr: T.cstr, any: T.any };
    return m[s] || T.any;
  }

  resolveType(pt, node) {
    let t;
    let ptr = pt.ptr || 0;
    if (pt.k === 'named') {
      const name = pt.name;
      if (this.typedefs.has(name)) {
        const td = this.typedefs.get(name);
        t = Object.assign({}, td);
        if (td.k === 'array') return td;
      } else if (this.structs.has(name)) t = { k: 'struct', name };
      else if (this.enums.has(name)) t = Object.assign({ enumName: name }, T.i32);
      else if (JSON_VALUE_TYPES.has(name)) t = T.any;
      else if (['TaskHandle_t', 'SemaphoreHandle_t', 'QueueHandle_t', 'TimerHandle_t', 'hw_timer_t', 'portMUX_TYPE', 'esp_err_t'].includes(name)) t = name === 'esp_err_t' ? T.i32 : T.any;
      else if (['TickType_t', 'BaseType_t', 'UBaseType_t', 'time_t'].includes(name)) t = name === 'BaseType_t' ? T.i32 : T.u32;
      else if (INT_TYPES.has(name)) t = T.i32;
      else if (this.libs[name]) t = { k: 'class', name, tmpl: pt.tmpl };
      else throw this.err(`'${name}' does not name a type` + (/^[A-Z]/.test(name) ? ` (thư viện/lớp '${name}' chưa được trình giả lập hỗ trợ)` : ''), node);
    } else {
      t = Object.assign({}, pt);
      delete t.ptr; delete t.isConst; delete t.isStatic; delete t.tmpl;
    }
    if (ptr > 0) {
      if (t.k === 'char' || (t.k === 'int' && t.bits === 8 && ptr === 1 && false)) t = ptr > 1 ? { k: 'array', elem: T.cstr } : T.cstr;
      else if (t.k === 'void') t = T.any;
      else if (t.k === 'class' || t.k === 'struct' || t.k === 'any' || t.k === 'cstr' || t.k === 'String') { if (ptr > 1) t = { k: 'array', elem: t }; }
      else t = { k: 'array', elem: t };
    }
    return t;
  }

  declType(d, baseType, node) {
    let t = this.resolveType(d.type || baseType, node);
    for (let i = d.dims.length - 1; i >= 0; i--) {
      const n = d.dims[i] ? this.constInt(d.dims[i]) : null;
      t = n != null ? { k: 'array', elem: t, len: n } : { k: 'array', elem: t };
    }
    return t;
  }

  // value of a constant integer expression (array sizes for sizeof), else null
  constInt(node) {
    switch (node.k) {
      case 'Num': return node.isFloat ? null : Number(node.v);
      case 'Ident': { const c = this.consts[node.name]; return c && c[1] === 'int' ? c[0] : null; }
      case 'Binary': {
        const a = this.constInt(node.l), b = this.constInt(node.r);
        if (a == null || b == null) return null;
        return { '+': a + b, '-': a - b, '*': a * b, '/': b ? Math.trunc(a / b) : null }[node.op] ?? null;
      }
      default: return null;
    }
  }

  arrKind(elem) {
    if (elem.k === 'int') {
      if (elem.bits === 64) return "'f64'";
      return `'${elem.uns ? 'u' : 'i'}${elem.bits}'`;
    }
    if (elem.k === 'char' || elem.k === 'bool') return "'u8'";
    if (elem.k === 'float') return elem.bits === 32 ? "'f32'" : "'f64'";
    if (elem.k === 'String') return "'str'";
    if (elem.k === 'struct') return `()=>new S_${elem.name}()`;
    if (elem.k === 'class') return `()=>$.make(${JSON.stringify(elem.name)},[])`;
    return "'any'";
  }

  packKind(t) {
    while (t.k === 'array') t = t.elem;
    switch (t.k) {
      case 'int': return `'${t.uns ? 'u' : 'i'}${t.bits}'`;
      case 'char': case 'bool': return "'u8'";
      case 'float': return t.bits === 32 ? "'f32'" : "'f64'";
      case 'struct': return `S_${t.name}`;
      case 'String': return "'str'";
      default: return "'i32'";
    }
  }

  sizeOfType(t) {
    switch (t.k) {
      case 'int': return t.bits / 8;
      case 'char': case 'bool': return 1;
      case 'float': return t.bits / 8;
      case 'String': return 16;
      case 'array': return t.len != null ? t.len * this.sizeOfType(t.elem) : 4;
      case 'struct': {
        const st = this.structs.get(t.name);
        return st ? st.fields.reduce((a, f) => a + this.sizeOfType(f.type), 0) : 4;
      }
      default: return 4;
    }
  }

  // ---------- conversions ----------
  conv(c, from, to) {
    if (!to || to.k === 'any' || to.k === 'auto' || to.k === 'void') return c;
    from = from || T.any;
    switch (to.k) {
      case 'int': {
        if (from.k === 'int' && from.bits === to.bits && from.uns === to.uns) return c;
        if ((from.k === 'char' || from.k === 'bool') && (to.bits >= 16 || (to.bits === 8 && to.uns && from.k === 'char'))) return c;
        if (from.k === 'int' && from.bits < to.bits && (!from.uns || true) && !(to.uns && !from.uns) && to.bits <= 32) return c;
        let v = isNum(from) || from.k === 'null' ? c : `$.num(${c})`;
        if (to.bits === 64) return `Math.trunc(${v})`;
        if (to.bits === 32) return to.uns ? `((${v})>>>0)` : `((${v})|0)`;
        if (to.bits === 16) return to.uns ? `((${v})&65535)` : `((${v})<<16>>16)`;
        return to.uns ? `((${v})&255)` : `((${v})<<24>>24)`;
      }
      case 'char':
        if (from.k === 'char') return c;
        return `((${isNum(from) ? c : `$.num(${c})`})&255)`;
      case 'bool':
        if (from.k === 'bool') return c;
        if (isNum(from)) return `!!(${c})`;
        return `$.t(${c})`;
      case 'float':
        if (isNum(from)) return from.k === 'bool' ? `(+${c})` : c;
        return `$.num(${c})`;
      case 'String': return this.toStr(c, from);
      case 'cstr':
        if (isStrLike(from) || isCharArr(from) || from.k === 'null') return c;
        return `$.str(${c})`;
      case 'struct':
        if (from.k === 'struct') return `(${c}).$c()`;
        return c;
      default: return c;
    }
  }

  // Convert any value to an Arduino String (binary string), formatting by static type.
  toStr(c, t, extra) {
    switch (t.k) {
      case 'String': return c;
      case 'float': return `$.ff(${c},${extra || 2})`;
      case 'char': return `$.ch(${c})`;
      case 'bool': return `((${c})?"1":"0")`;
      case 'int': return extra ? `$.fi(${c},${extra},1)` : `(""+(${c}))`;
      default: return `$.str(${c})`;
    }
  }

  // ---------- program ----------
  program(ast) {
    const out = [];
    const globals = [];
    const initCode = [];
    const funcDefs = [];

    // Pass 1: types, enums, function signatures
    for (const node of ast.body) {
      if (node.k === 'StructDef') {
        const name = node.name || '__anon' + (++this.uid);
        node.name = name;
        this.structs.set(name, { fields: [], node });
      } else if (node.k === 'EnumDef') {
        if (node.name) this.enums.set(node.name, node);
      } else if (node.k === 'Typedef') {
        this.typedefs.set(node.name, this.resolveType(node.type, node));
      }
    }
    // struct fields (after all struct names are known)
    for (const node of ast.body) {
      if (node.k !== 'StructDef') continue;
      const st = this.structs.get(node.name);
      for (const fd of node.fields) {
        for (const d of fd.decls) st.fields.push({ name: d.name, type: this.declType(d, fd.type, fd), decl: d, node: fd });
      }
    }
    // enums -> constants
    for (const node of ast.body) {
      if (node.k !== 'EnumDef') continue;
      let prev = null;
      for (const it of node.items) {
        const js = node.isClass ? `v_${node.name}$${it.name}` : `v_${it.name}`;
        const val = it.value ? this.ex(it.value, this.global)[0] : prev ? `(${prev}+1)` : '0';
        out.push(`const ${js}=${val};`);
        prev = js;
        const entry = { kind: 'var', type: Object.assign({ enumName: node.name }, T.i32), js, isConst: true };
        if (!node.isClass) this.global.vars.set(it.name, entry);
        if (node.name) this.global.vars.set(node.name + '::' + it.name, entry);
      }
    }
    // function signatures
    for (const node of ast.body) {
      if (node.k !== 'FuncDef') continue;
      const ret = this.resolveType(node.ret, node);
      const params = node.params.map((p) => ({ name: p.name, type: this.resolveType(p.type, node), ref: p.ref, def: p.def }));
      let list = this.funcs.get(node.name);
      if (!list) { list = []; this.funcs.set(node.name, list); }
      const minArgs = params.filter((p) => p.def === undefined).length;
      let sig = list.find((s) => s.params.length === params.length && s.params.every((p, i) => typeName(p.type) === typeName(params[i].type)));
      if (!sig) {
        sig = { params, ret, minArgs, name: node.name, hasBody: false };
        list.push(sig);
      } else if (sig.hasBody && node.body) {
        throw this.err(`redefinition of '${typeName(ret)} ${node.name}(...)'`, node);
      }
      if (node.body) { sig.hasBody = true; sig.node = node; sig.params = params; }
    }
    for (const [name, list] of this.funcs) {
      list.forEach((s, i) => { s.js = list.length > 1 ? `f_${name}$${i}` : `f_${name}`; });
    }

    // struct classes
    for (const [name, st] of this.structs) out.push(this.structClass(name, st));

    // Pass 2: globals and function bodies
    for (const node of ast.body) {
      if (node.k === 'VarDecl') {
        for (const d of node.decls) {
          if (this.global.vars.has(d.name) && this.global.vars.get(d.name).kind === 'var')
            throw this.err(`redefinition of '${d.name}'`, d);
          const t = this.declType(d, node.type, node);
          const js = `v_${d.name}`;
          globals.push(js);
          const entry = { kind: 'var', type: t, js, isConst: node.type.isConst };
          initCode.push(`$.L=${d.line};${js}=${this.declInit(d, t, this.global, node)};`);
          this.global.vars.set(d.name, entry);
        }
      } else if (node.k === 'FuncDef' && node.body) {
        funcDefs.push(node);
      }
    }
    for (const node of funcDefs) out.push(this.funcDef(node));

    const setup = this.funcs.get('setup');
    const loop = this.funcs.get('loop');
    if (!setup || !setup.some((s) => s.hasBody)) throw this.err("undefined reference to `setup()'", { line: 1 });
    if (!loop || !loop.some((s) => s.hasBody)) throw this.err("undefined reference to `loop()'", { line: 1 });
    for (const [name, list] of this.funcs) {
      for (const s of list) if (!s.hasBody) throw this.err(`undefined reference to \`${name}(...)'`, { line: 1 });
    }

    const code = [
      '"use strict";',
      'const $=R.h,F=R.f,O=R.o;',
      globals.length ? `let ${globals.join(',')};` : '',
      this.statics.length ? `let ${this.statics.join(',')};` : '',
      ...out,
      `return {init:async function(){${initCode.join('\n')}\n${this.staticInit.join('\n')}},setup:f_setup,loop:f_loop};`,
    ].join('\n');
    return { code, warnings: this.warnings };
  }

  structClass(name, st) {
    const scope = this.global;
    const ctor = st.fields.map((f) => `this.${f.name}=${this.declInit(f.decl, f.type, scope, f.node)};`).join('');
    const clone = st.fields.map((f) => {
      if (f.type.k === 'struct') return `o.${f.name}=this.${f.name}.$c();`;
      if (f.type.k === 'array') return `o.${f.name}=$.clone(this.${f.name});`;
      return `o.${f.name}=this.${f.name};`;
    }).join('');
    const from = st.fields.map((f, i) => `if(a.length>${i})o.${f.name}=a[${i}];`).join('');
    // byte layout for memcpy()/esp_now_send() of the struct ($.pack / $.unpack); a getter, as nested struct
    // classes may be defined later
    const layout = st.fields.map((f) => `[${JSON.stringify(f.name)},${this.packKind(f.type)}]`).join(',');
    return `class S_${name}{constructor(){${ctor}}$c(){const o=new S_${name}();${clone}return o;}static $from(a){const o=new S_${name}();${from}return o;}static get $L(){return [${layout}];}}`;
  }

  // Initial value expression for a declarator of type t
  declInit(d, t, scope, node) {
    if (t.k === 'array') return this.arrayInit(d, t, scope, node);
    if (t.k === 'struct') {
      if (d.init && d.init.k === 'InitList') {
        const st = this.structs.get(t.name);
        const items = d.init.items.map((it, i) => {
          const f = st.fields[i];
          if (!f) throw this.err(`too many initializers for '${t.name}'`, d);
          return this.initValue(it, f.type, scope);
        });
        return `S_${t.name}.$from([${items.join(',')}])`;
      }
      if (d.init) { const [c, ct] = this.ex(d.init, scope); return this.conv(c, ct, t); }
      return `new S_${t.name}()`;
    }
    if (t.k === 'class') {
      if (d.init) return this.ex(d.init, scope)[0];
      const args = (d.ctorArgs || []).map((a) => this.ex(a, scope)[0]);
      return `$.make(${JSON.stringify(t.name)},[${args.join(',')}])`;
    }
    if (d.ctorArgs) {
      // String s("abc"); int x(5);
      if (t.k === 'String' && d.ctorArgs.length) return this.stringCtor(d.ctorArgs, scope, d)[0];
      if (d.ctorArgs.length === 1) { const [c, ct] = this.ex(d.ctorArgs[0], scope); return this.conv(c, ct, t); }
    }
    if (d.init) {
      if (d.init.k === 'InitList') {
        if (t.k === 'any') return this.ex(d.init, scope)[0];
        if (d.init.items.length === 0) return this.defaultValue(t);
        const [c, ct] = this.ex(d.init.items[0], scope);
        return this.conv(c, ct, t);
      }
      const [c, ct] = this.ex(d.init, scope);
      if (t.k === 'auto') { d.autoType = ct; return c; }
      if (isStrLike(ct) && isNum(t) && t.k !== 'bool') throw this.err(`invalid conversion from '${typeName(ct)}' to '${typeName(t)}'`, d);
      return this.conv(c, ct, t);
    }
    return this.defaultValue(t);
  }

  defaultValue(t) {
    switch (t.k) {
      case 'int': case 'char': case 'float': return '0';
      case 'bool': return 'false';
      case 'String': return '""';
      default: return 'null';
    }
  }

  initValue(it, t, scope) {
    // array member of a struct initializer: a real (typed) array of the declared size
    if (t.k === 'array' && t.len != null && (it.k === 'InitList' || (it.k === 'Str' && isCharArr(t)))) {
      const dims = [];
      for (let a = t; a.k === 'array'; a = a.elem) {
        if (a.len == null) { dims.length = 0; break; }
        dims.push({ k: 'Num', v: a.len, line: it.line });
      }
      if (dims.length) return this.arrayInit({ init: it, dims }, t, scope, it);
    }
    if (it.k === 'InitList') {
      if (t.k === 'struct') return this.declInit({ init: it, dims: [] }, t, scope, it);
      if (t.k === 'array') return '[' + it.items.map((x) => this.initValue(x, t.elem, scope)).join(',') + ']';
      if (t.k === 'class' || t.k === 'any') return this.ex(it, scope)[0];
      return it.items.length ? this.initValue(it.items[0], t, scope) : this.defaultValue(t);
    }
    const [c, ct] = this.ex(it, scope);
    return this.conv(c, ct, t);
  }

  arrayInit(d, t, scope, node) {
    const dims = [];
    let el = t;
    while (el.k === 'array') { dims.push(el); el = el.elem; }
    const dimCodes = d.dims.map((x) => (x ? this.conv(this.ex(x, scope)[0], this.ex(x, scope)[1], T.i32) : 'null'));
    if (!d.dims.length) {
      // pointer variable: char* p = buf; int* p = arr;
      if (d.init) { const [c, ct] = this.ex(d.init, scope); return this.conv(c, ct, t); }
      return 'null';
    }
    let init = 'null';
    if (d.init) {
      if (d.init.k === 'Str' && isCharArr(t)) return `$.carr(${dimCodes[0]},${JSON.stringify(d.init.v)})`;
      if (d.init.k === 'InitList') {
        const build = (il, depthT) => {
          if (depthT.k !== 'array') return this.initValue(il, depthT, scope);
          if (il.k === 'Str' && isCharArr(depthT)) return `$.carr(null,${JSON.stringify(il.v)})`;
          if (il.k !== 'InitList') return this.initValue(il, depthT.elem, scope);
          return '[' + il.items.map((x) => build(x, depthT.elem)).join(',') + ']';
        };
        init = build(d.init, t);
      } else {
        const [c, ct] = this.ex(d.init, scope);
        return this.conv(c, ct, t);
      }
    }
    return `$.arr(${this.arrKind(el)},[${dimCodes.join(',')}],${init})`;
  }

  // ---------- functions ----------
  funcDef(node) {
    const list = this.funcs.get(node.name);
    const sig = list.find((s) => s.node === node);
    const fnInfo = { ret: sig.ret, name: node.name };
    const scope = new Scope(this.global, fnInfo);
    const params = sig.params.map((p, i) => {
      if (!p.name) return `$p${i}`;
      const js = `v_${p.name}`;
      const byRef = p.ref && (isNum(p.type) || p.type.k === 'String' || p.type.k === 'cstr');
      scope.vars.set(p.name, { kind: 'var', type: p.type, js: byRef ? js + '.v' : js });
      return p.def !== undefined ? `${js}=${this.conv(...this.ex(p.def, this.global), p.type)}` : js;
    });
    const body = this.block(node.body, scope, true);
    return `async function ${sig.js}(${params.join(',')})${body}`;
  }

  // ---------- statements ----------
  block(node, scope, reuseScope) {
    const s = reuseScope ? scope : new Scope(scope);
    return '{\n' + node.body.map((st) => this.stmt(st, s)).join('\n') + '\n}';
  }

  stmt(node, scope) {
    const L = `$.L=${node.line};`;
    switch (node.k) {
      case 'Block': return this.block(node, scope);
      case 'Empty': return ';';
      case 'ExprStmt': return L + this.ex(node.expr, scope)[0] + ';';
      case 'VarDecl': return L + this.localDecl(node, scope);
      case 'If': {
        let s = `${L}if(${this.test(node.test, scope)})${this.sub(node.cons, scope)}`;
        if (node.alt) s += `else ${this.sub(node.alt, scope)}`;
        return s;
      }
      case 'While':
        return `${L}while(${this.test(node.test, scope)}){${YIELD}${this.sub(node.body, scope)}}`;
      case 'Do':
        return `${L}do{${YIELD}${this.sub(node.body, scope)}}while(${this.test(node.test, scope)});`;
      case 'For': {
        const s = new Scope(scope);
        let init = '';
        if (node.init) init = node.init.k === 'VarDecl' ? this.localDecl(node.init, s).replace(/;$/, '') : this.ex(node.init.expr, s)[0];
        const test = node.test ? this.test(node.test, s) : '';
        const upd = node.update ? this.ex(node.update, s)[0] : '';
        return `${L}for(${init};${test};${upd}){${YIELD}${this.sub(node.body, s)}}`;
      }
      case 'ForRange': {
        const s = new Scope(scope);
        const [c, ct] = this.ex(node.expr, s);
        let vt = node.decl.type.k === 'auto' ? (ct.k === 'array' ? ct.elem : T.any) : this.resolveType(node.decl.type, node);
        if (vt.k === 'class' && JSON_VALUE_TYPES.has(vt.name)) vt = T.any;
        s.vars.set(node.decl.name, { kind: 'var', type: vt, js: `v_${node.decl.name}` });
        return `${L}for(let v_${node.decl.name} of $.iter(${c})){${YIELD}${this.sub(node.body, s)}}`;
      }
      case 'Switch': {
        const s = new Scope(scope);
        const [dc, dt] = this.ex(node.disc, scope);
        let code = `${L}switch(${dt.k === 'bool' ? `(${dc})?1:0` : dc}){`;
        for (const cs of node.cases) {
          if (!cs.test) code += 'default:';
          else if (cs.hi) {
            const lo = this.constEval(cs.test), hi = this.constEval(cs.hi);
            if (lo === null || hi === null || hi - lo > 1024) throw this.err('case range must be a small constant range', cs);
            for (let v = lo; v <= hi; v++) code += `case ${v}:`;
          } else code += `case ${this.ex(cs.test, scope)[0]}:`;
          code += cs.body.map((st) => this.stmt(st, s)).join('\n');
        }
        return code + '}';
      }
      case 'Break': return L + 'break;';
      case 'Continue': return L + 'continue;';
      case 'Return': {
        const fn = scope.fn;
        if (!node.arg) return L + 'return;';
        const [c, ct] = this.ex(node.arg, scope);
        if (fn && fn.ret && fn.ret.k === 'void') throw this.err("return-statement with a value, in function returning 'void'", node);
        return L + `return ${fn ? this.conv(c, ct, fn.ret) : c};`;
      }
      case 'FuncDef': throw this.err('a function-definition is not allowed here before \'{\' token', node);
      default: throw this.err('unsupported statement ' + node.k, node);
    }
  }

  sub(node, scope) {
    // statement as body of a control structure – always wrapped in a block
    if (node.k === 'Block') return this.block(node, scope);
    return '{' + this.stmt(node, new Scope(scope)) + '}';
  }

  localDecl(node, scope) {
    const parts = [];
    for (const d of node.decls) {
      if (scope.vars.has(d.name)) throw this.err(`redeclaration of '${d.name}'`, d);
      let t = this.declType(d, node.type, node);
      if (node.type.isStatic) {
        const js = `s${++this.uid}_${d.name}`;
        this.statics.push(js);
        // static locals are initialised once, at load time
        this.staticInit.push(`${js}=${this.declInit(d, t, this.global.fn ? this.global : scope, node)};`);
        scope.vars.set(d.name, { kind: 'var', type: t, js });
        continue;
      }
      const js = `v_${d.name}`;
      const init = this.declInit(d, t, scope, node);
      if (t.k === 'auto') t = d.autoType || T.any;
      scope.vars.set(d.name, { kind: 'var', type: t, js, isConst: node.type.isConst });
      parts.push(`${js}=${init}`);
    }
    return parts.length ? `let ${parts.join(',')};` : ';';
  }

  test(node, scope) {
    const [c, t] = this.ex(node, scope);
    if (isDyn(t) || t.k === 'String' || t.k === 'struct') return `$.t(${c})`;
    return c;
  }

  constEval(node) {
    if (node.k === 'Num' || node.k === 'Char') return node.v;
    if (node.k === 'Unary' && node.op === '-') { const v = this.constEval(node.arg); return v === null ? null : -v; }
    return null;
  }

  // ---------- expressions: return [code, type] ----------
  ex(node, scope) {
    switch (node.k) {
      case 'Num': {
        const v = node.v;
        if (node.isFloat) return [String(v).includes('e') || String(v).includes('.') ? String(v) : String(v) + '.0', T.f64];
        let t = node.unsigned ? T.u32 : T.i32;
        if (v > 0x7fffffff) t = v > 0xffffffff ? T.i64 : T.u32;
        return [String(v), t];
      }
      case 'Str': return [JSON.stringify(node.v), T.cstr];
      case 'Char': return [String(node.v), T.char];
      case 'Bool': return [node.v ? 'true' : 'false', T.bool];
      case 'Null': return ['null', T.null];
      case 'Ident': return this.ident(node, scope);
      case 'Scoped': return this.scoped(node, scope);
      case 'Binary': return this.binary(node, scope);
      case 'Unary': return this.unary(node, scope);
      case 'Update': return this.update(node, scope);
      case 'Assign': return this.assign(node, scope);
      case 'Cond': {
        const test = this.test(node.test, scope);
        let [a, at] = this.ex(node.cons, scope);
        let [b, bt] = this.ex(node.alt, scope);
        let t = at;
        if (at.k === 'String' || bt.k === 'String') { t = T.String; a = this.toStr(a, at); b = this.toStr(b, bt); }
        else if (isFloat(at) || isFloat(bt)) t = isFloat(at) ? at : bt;
        else if (at.k === 'null') t = bt;
        return [`((${test})?${a}:${b})`, t];
      }
      case 'Comma': {
        const parts = node.exprs.map((e) => this.ex(e, scope));
        return [`(${parts.map((p) => p[0]).join(',')})`, parts[parts.length - 1][1]];
      }
      case 'Call': return this.call(node, scope);
      case 'Member': return this.member(node, scope);
      case 'Index': return this.index(node, scope);
      case 'Cast': {
        const [c, ct] = this.ex(node.arg, scope);
        const t = this.resolveType(node.type, node);
        if (t.k === 'array' || t.k === 'cstr') return [c, t.k === 'cstr' && ct.k === 'array' ? ct : t];
        if (t.k === 'class' || t.k === 'struct' || t.k === 'void' || t.k === 'any') return [c, t.k === 'void' ? T.void : t];
        return [this.conv(c, ct, t), t];
      }
      case 'SizeofType': return [String(this.sizeOfType(this.resolveType(node.type, node))), T.u32];
      case 'SizeofExpr': {
        const [c, t] = this.ex(node.arg, scope);
        if (node.arg.k === 'Str') return [String(node.arg.v.length + 1), T.u32];
        if (t.k === 'array') {
          let el = t;
          while (el.k === 'array') el = el.elem;
          return [`$.sizeofArr(${c},${this.sizeOfType(el)})`, T.u32];
        }
        return [String(this.sizeOfType(t)), T.u32];
      }
      case 'AddrOf': {
        const [c, t] = this.ex(node.arg, scope);
        if (isNum(t) || t.k === 'String' || t.k === 'cstr') {
          if (node.arg.k === 'Index' && this.ex(node.arg.obj, scope)[1].k === 'array') {
            // &arr[i] -> view into the array
            const [oc] = this.ex(node.arg.obj, scope);
            const [ic] = this.ex(node.arg.index, scope);
            return [`$.view(${oc},${ic})`, { k: 'array', elem: t }];
          }
          const lv = this.lvalue(node.arg, scope);
          return [`{get v(){return ${lv.get}},set v($n){${lv.set('$n')}}}`, { k: 'ref', elem: t }];
        }
        return [c, t];
      }
      case 'Deref': {
        const [c, t] = this.ex(node.arg, scope);
        const et = t.k === 'array' || t.k === 'ref' ? t.elem : t.k === 'cstr' ? T.char : T.any;
        return [`$.deref(${c})`, et];
      }
      case 'InitList': {
        // JSON-ish brace list in expression context
        const items = node.items.map((it) => this.ex(it, scope)[0]);
        return [`[${items.join(',')}]`, T.any];
      }
      case 'Lambda': {
        const s = new Scope(scope, { ret: node.ret ? this.resolveType(node.ret, node) : T.any, name: 'lambda' });
        const params = node.params.map((p, i) => {
          const pt = this.resolveType(p.type, node);
          const js = p.name ? `v_${p.name}` : `$p${i}`;
          if (p.name) s.vars.set(p.name, { kind: 'var', type: pt, js });
          return js;
        });
        return [`(async(${params.join(',')})=>${this.block(node.body, s, true)})`, T.func];
      }
      default:
        throw this.err('unsupported expression ' + node.k, node);
    }
  }

  ident(node, scope) {
    const name = node.name;
    const v = scope.lookup(name);
    if (v) return [v.js, v.type];
    if (this.funcs.has(name)) {
      const list = this.funcs.get(name);
      return [list[0].js, T.func];
    }
    if (this.consts[name]) {
      const [val, ty] = this.consts[name];
      const code = Number.isNaN(val) ? 'NaN' : val === Infinity ? 'Infinity' : String(val);
      return [code, this.typeFromMeta(ty)];
    }
    if (OBJECTS[name]) return [`O.${name}`, { k: 'class', name: OBJECTS[name] }];
    if (FUNCS[name]) return [`F.${name}`, T.func];
    if (/^B[01]{1,8}$/.test(name)) return [String(parseInt(name.slice(1), 2)), T.i32];
    throw this.err(`'${name}' was not declared in this scope`, node);
  }

  scoped(node, scope) {
    const full = node.parts.join('::');
    const v = scope.lookup(full);
    if (v) return [v.js, v.type];
    const [cls, prop] = [node.parts.slice(0, -1).join('::'), node.parts[node.parts.length - 1]];
    const lib = this.libs[cls];
    if (lib && lib[prop] !== undefined && typeof lib[prop] !== 'function') return [JSON.stringify(lib[prop]), typeof lib[prop] === 'number' ? T.i32 : T.any];
    const v2 = scope.lookup(prop);
    if (v2 && this.enums.has(cls)) return [v2.js, v2.type];
    throw this.err(`'${full}' has not been declared`, node);
  }

  arith(t1, t2) {
    if (isFloat(t1) || isFloat(t2)) return (t1.bits === 64 || t2.bits === 64 || !isFloat(t1) || !isFloat(t2)) ? T.f64 : T.f32;
    const p = (t) => (t.k === 'int' ? t : T.i32);
    const a = p(t1), b = p(t2);
    if (a.bits === 64 || b.bits === 64) return T.i64;
    if ((a.bits === 32 && a.uns) || (b.bits === 32 && b.uns)) return T.u32;
    return T.i32;
  }

  binop(op, a, at, b, bt, node) {
    // String concatenation
    if (op === '+' && (at.k === 'String' || bt.k === 'String')) {
      return [`(${this.toStr(a, at)}+${this.toStr(b, bt)})`, T.String];
    }
    if ((op === '+' || op === '-') && (at.k === 'cstr' || isCharArr(at)) && isInt(bt)) {
      this.warn('phép cộng con trỏ chuỗi (pointer arithmetic) — có phải bạn muốn dùng String(...) + ... ?', node);
      return [`$.padd(${a},${op === '-' ? '-' : ''}(${b}))`, T.cstr];
    }
    if (op === '+' && isStrLike(at) && isStrLike(bt)) throw this.err("invalid operands of types 'const char*' and 'const char*' to binary 'operator+'", node);
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      if ((at.k === 'cstr' && bt.k === 'cstr') && node.l && node.l.k !== 'Str' && node.r && node.r.k === 'Str') {
        this.warn('so sánh char* với chuỗi hằng — nên dùng strcmp() hoặc String', node);
      }
      if ((isStrLike(at) || isCharArr(at)) !== (isStrLike(bt) || isCharArr(bt)) || isCharArr(at) || isCharArr(bt)) {
        if (isCharArr(at) || at.k === 'cstr') a = `$.str(${a})`;
        if (isCharArr(bt) || bt.k === 'cstr') b = `$.str(${b})`;
      } else if (isStrLike(at) && isStrLike(bt)) {
        if (at.k === 'cstr') a = `$.str(${a})`;
        if (bt.k === 'cstr') b = `$.str(${b})`;
      }
      if (isDyn(at) && at.k === 'any') a = `$.jv(${a})`;
      if (isDyn(bt) && bt.k === 'any') b = `$.jv(${b})`;
      // IPAddress compares by value (valueOf = the 32-bit address)
      if (at.k === 'class' && at.name === 'IPAddress') a = `(+${a})`;
      if (bt.k === 'class' && bt.name === 'IPAddress') b = `(+${b})`;
      const jsop = op === '==' ? '==' : op === '!=' ? '!=' : op;
      return [`(${a}${jsop}${b})`, T.bool];
    }
    if (op === '&&' || op === '||') return [`(${this.truth(a, at)}${op}${this.truth(b, bt)})`, T.bool];
    if (op === '|' && at.k === 'any') return [`$.jor(${a},${b})`, bt];
    if (!isNum(at) && !isDyn(at) && at.k !== 'null') throw this.err(`invalid operands of types '${typeName(at)}' and '${typeName(bt)}' to binary 'operator${op}'`, node);
    if (at.k === 'any') a = `$.num(${a})`;
    if (bt.k === 'any') b = `$.num(${b})`;
    const rt = this.arith(at, bt);
    const bothInt = isInt(at) && isInt(bt);
    switch (op) {
      case '/':
        if (bothInt) return [`$.idiv(${a},${b})`, rt];
        return [`(${a}/${b})`, rt];
      case '%':
        if (bothInt) return [`$.imod(${a},${b})`, rt];
        if (isFloat(at) || isFloat(bt)) throw this.err(`invalid operands of types '${typeName(at)}' and '${typeName(bt)}' to binary 'operator%'`, node);
        return [`(${a}%${b})`, rt];
      case '*':
        if (rt === T.i32 && bothInt) return [`Math.imul(${a},${b})`, rt];
        if (rt === T.u32 && bothInt) return [`(Math.imul(${a},${b})>>>0)`, rt];
        return [`(${a}*${b})`, rt];
      case '+': case '-':
        if (rt === T.i32 && bothInt) return [`((${a}${op}${b})|0)`, rt];
        if (rt === T.u32 && bothInt) return [`((${a}${op}${b})>>>0)`, rt];
        return [`(${a}${op}${b})`, rt];
      case '<<': {
        const lt = at.k === 'int' && at.bits >= 32 ? at : T.i32;
        if (lt.bits === 64) return [`(${a}*Math.pow(2,${b}))`, lt];
        return [lt.uns ? `((${a}<<${b})>>>0)` : `(${a}<<${b})`, lt];
      }
      case '>>': {
        const lt = at.k === 'int' && at.bits >= 32 ? at : T.i32;
        if (lt.bits === 64) return [`Math.floor(${a}/Math.pow(2,${b}))`, lt];
        return [lt.uns ? `(${a}>>>${b})` : `(${a}>>${b})`, lt];
      }
      case '&': case '|': case '^':
        if (rt.bits === 64) return [`$.bit64(${JSON.stringify(op)},${a},${b})`, rt];
        return [rt.uns ? `((${a}${op}${b})>>>0)` : `(${a}${op}${b})`, rt];
      default: throw this.err('unsupported operator ' + op, node);
    }
  }

  truth(c, t) { return isDyn(t) || t.k === 'String' ? `$.t(${c})` : `!!(${c})`; }

  binary(node, scope) {
    const [a, at] = this.ex(node.l, scope);
    const [b, bt] = this.ex(node.r, scope);
    return this.binop(node.op, a, at, b, bt, node);
  }

  unary(node, scope) {
    const [c, t] = this.ex(node.arg, scope);
    switch (node.op) {
      case '!': return [isDyn(t) || t.k === 'String' ? `(!$.t(${c}))` : `(!${c})`, T.bool];
      case '-':
        if (t.k === 'int' && t.uns && t.bits === 32) return [`((-${c})>>>0)`, t];
        return [`(-${isNum(t) ? c : `$.num(${c})`})`, isFloat(t) ? t : t.k === 'int' && t.bits >= 32 ? t : T.i32];
      case '+': return [`(+${c})`, isFloat(t) ? t : T.i32];
      case '~': {
        const rt = t.k === 'int' && t.bits === 32 ? t : T.i32;
        return [rt.uns ? `((~${c})>>>0)` : `(~${c})`, rt];
      }
      default: throw this.err('unsupported unary ' + node.op, node);
    }
  }

  // Build an lvalue accessor: {get, set(v), t}
  lvalue(node, scope) {
    switch (node.k) {
      case 'Ident': {
        const v = scope.lookup(node.name);
        if (!v) {
          if (this.funcs.has(node.name) || this.consts[node.name] || OBJECTS[node.name]) throw this.err('lvalue required as left operand of assignment', node);
          throw this.err(`'${node.name}' was not declared in this scope`, node);
        }
        if (v.isConst) throw this.err(`assignment of read-only variable '${node.name}'`, node);
        return { get: v.js, set: (x) => `${v.js}=${x}`, t: v.type, simple: true };
      }
      case 'Index': {
        const [oc, ot] = this.ex(node.obj, scope);
        const [ic, it] = this.ex(node.index, scope);
        if (ot.k === 'array') return { get: `${oc}[${ic}]`, set: (x) => `${oc}[${ic}]=${x}`, t: ot.elem, typed: true };
        if (ot.k === 'String' || ot.k === 'cstr') {
          const base = this.lvalue(node.obj, scope);
          return { get: `$.ci(${oc},${ic})`, set: (x) => base.set(`$.setChar(${base.get},${ic},${x})`), t: T.char };
        }
        if (ot.k === 'ref') return { get: `${oc}.v`, set: (x) => `${oc}.v=${x}`, t: ot.elem };
        return { get: `$.idx(${oc},${it.k === 'cstr' ? oc === '' ? ic : ic : ic})`, set: (x) => `$.setIdx(${oc},${ic},${x})`, t: T.any, dyn: true };
      }
      case 'Member': {
        const [oc, ot] = this.ex(node.obj, scope);
        const ft = this.fieldType(ot, node);
        if (ft) return { get: `${oc}.${node.prop}`, set: (x) => `${oc}.${node.prop}=${x}`, t: ft };
        return { get: `$.prop(${oc},${JSON.stringify(node.prop)})`, set: (x) => `$.setIdx(${oc},${JSON.stringify(node.prop)},${x})`, t: T.any, dyn: true };
      }
      case 'Deref': {
        const [c, t] = this.ex(node.arg, scope);
        const et = t.k === 'array' || t.k === 'ref' ? t.elem : T.any;
        return { get: `$.deref(${c})`, set: (x) => `$.setDeref(${c},${x})`, t: et };
      }
      case 'Cast': return this.lvalue(node.arg, scope);
      default: throw this.err('lvalue required as left operand of assignment', node);
    }
  }

  fieldType(ot, node) {
    if (ot.k === 'struct') {
      const st = this.structs.get(ot.name);
      const f = st && st.fields.find((x) => x.name === node.prop);
      if (!f) throw this.err(`'struct ${ot.name}' has no member named '${node.prop}'`, node);
      return f.type;
    }
    if (ot.k === 'class') {
      const cls = this.libs[ot.name];
      const fm = cls && cls.meta && cls.meta.fields;
      if (fm && fm[node.prop]) return this.typeFromMeta(fm[node.prop]);
      throw this.err(`'class ${ot.name}' has no member named '${node.prop}'`, node);
    }
    return null;
  }

  assign(node, scope) {
    const lv = this.lvalue(node.target, scope);
    const t = lv.t;
    if (node.op === '=') {
      if (node.value.k === 'InitList') {
        return [`(${lv.set(this.initValue(node.value, t, scope))})`, t];
      }
      const [c, ct] = this.ex(node.value, scope);
      if (t.k === 'array' && !(ct.k === 'array' || ct.k === 'null' || ct.k === 'cstr')) throw this.err(`invalid array assignment`, node);
      if (t.k === 'array' && ct.k === 'cstr' && node.value.k === 'Str') throw this.err("incompatible types in assignment of 'const char*' to 'char[]' (dùng strcpy())", node);
      if (lv.dyn) return [`(${lv.set(isCharArr(ct) || ct.k === 'cstr' ? `$.str(${c})` : ct.k === 'float' ? c : isInt(ct) && ct.k === 'bool' ? `(!!${c})` : c)})`, t];
      return [`(${lv.set(this.conv(c, ct, t))})`, t];
    }
    const op = node.op.slice(0, -1);
    const [c, ct] = this.ex(node.value, scope);
    if (t.k === 'String') {
      if (op !== '+') throw this.err(`no match for 'operator${node.op}' on String`, node);
      return [`(${lv.set(`${lv.get}+${this.toStr(c, ct)}`)})`, t];
    }
    const [rc, rt] = this.binop(op, lv.get, t, c, ct, node);
    return [`(${lv.set(lv.dyn ? rc : this.conv(rc, rt, t))})`, t];
  }

  update(node, scope) {
    const lv = this.lvalue(node.arg, scope);
    const t = lv.t;
    const op = node.op;
    const d = op === '++' ? '+' : '-';
    if (t.k === 'String' || t.k === 'struct' || t.k === 'class') throw this.err(`no match for 'operator${op}'`, node);
    const native = isFloat(t) || (t.k === 'int' && t.bits === 32 && !t.uns) || (lv.typed && t.k !== 'bool') || t.k === 'ref';
    if (native && !lv.dyn) return [node.prefix ? `(${op}${lv.get})` : `(${lv.get}${op})`, t];
    if (lv.dyn) {
      const nv = `(${lv.set(`$.num(${lv.get})${d}1`)})`;
      return [node.prefix ? nv : `(${nv}${d === '+' ? '-' : '+'}1)`, T.any];
    }
    const nv = `(${lv.set(this.conv(`(${lv.get}${d}1)`, T.f64, t.k === 'bool' ? T.bool : t))})`;
    if (node.prefix) return [nv, t];
    return [`(${nv},${this.conv(`(${lv.get}${d === '+' ? '-' : '+'}1)`, T.f64, t.k === 'bool' ? T.bool : t)})`, t];
  }

  index(node, scope) {
    const [oc, ot] = this.ex(node.obj, scope);
    const [ic, it] = this.ex(node.index, scope);
    if (ot.k === 'array') return [`${oc}[${ic}]`, ot.elem];
    if (ot.k === 'String' || ot.k === 'cstr') return [`$.ci(${oc},${ic})`, T.char];
    if (ot.k === 'ref') return [`${oc}.v`, ot.elem];
    return [`$.idx(${oc},${it.k === 'char' ? `$.ch(${ic})` : ic})`, T.any];
  }

  member(node, scope) {
    const [oc, ot] = this.ex(node.obj, scope);
    const ft = this.fieldType(ot, node);
    if (ft) return [`${oc}.${node.prop}`, ft];
    if (ot.k === 'String' || ot.k === 'cstr') throw this.err(`invalid use of member function 'String::${node.prop}' (did you forget the '()' ?)`, node);
    return [`$.prop(${oc},${JSON.stringify(node.prop)})`, T.any];
  }

  // ---------- calls ----------
  args(list, scope) { return list.map((a) => this.ex(a, scope)); }

  printArgs(args) {
    if (!args.length) return '';
    const [a0, t0] = args[0];
    const rest = args.slice(1).map((a) => a[0]);
    if (isFloat(t0)) return `$.ff(${a0},${args[1] ? args[1][0] : 2})`;
    if ((t0.k === 'int' || t0.k === 'bool') && args[1]) return `$.fi(${a0},${args[1][0]})`;
    if (t0.k === 'char') return `$.ch(${a0})`;
    if (t0.k === 'bool') return `((${a0})?1:0)`;
    return [a0, ...rest].join(',');
  }

  stringCtor(argNodes, scope, node) {
    const args = this.args(argNodes, scope);
    if (!args.length) return ['""', T.String];
    const [c, t] = args[0];
    const extra = args[1] ? args[1][0] : null;
    if (t.k === 'int' && extra) return [`$.fi(${c},${extra},1)`, T.String];
    return [this.toStr(c, t, extra), T.String];
  }

  call(node, scope) {
    const callee = node.callee;
    if (callee.k === 'Ident') {
      const name = callee.name;
      const local = scope.lookup(name);
      if (local) {
        // function pointer / lambda variable
        const args = this.args(node.args, scope).map((a) => a[0]);
        return [`(await ${local.js}(${args.join(',')}))`, T.any];
      }
      if (this.funcs.has(name)) return this.userCall(name, node, scope);
      if (name === 'String') return this.stringCtor(node.args, scope, node);
      if (this.libs[name] && !FUNCS[name]) {
        const args = this.args(node.args, scope).map((a) => a[0]);
        return [`$.make(${JSON.stringify(name)},[${args.join(',')}])`, { k: 'class', name }];
      }
      if (FUNCS[name]) return this.builtinCall(name, node, scope);
      throw this.err(`'${name}' was not declared in this scope`, callee);
    }
    if (callee.k === 'Member') return this.methodCall(node, scope);
    if (callee.k === 'Scoped') {
      const full = callee.parts.join('::');
      const args = this.args(node.args, scope).map((a) => a[0]);
      const cls = callee.parts[0];
      if (this.libs[cls] && typeof this.libs[cls][callee.parts[1]] === 'function')
        return [`(await $.lib(${JSON.stringify(cls)}).${callee.parts[1]}(${args.join(',')}))`, T.any];
      throw this.err(`'${full}' has not been declared`, callee);
    }
    const [fc] = this.ex(callee, scope);
    const args = this.args(node.args, scope).map((a) => a[0]);
    return [`(await (${fc})(${args.join(',')}))`, T.any];
  }

  userCall(name, node, scope) {
    const list = this.funcs.get(name);
    const n = node.args.length;
    let cands = list.filter((s) => n <= s.params.length && n >= s.minArgs);
    if (!cands.length) {
      const s = list[0];
      throw this.err(`${n > s.params.length ? 'too many' : 'too few'} arguments to function '${typeName(s.ret)} ${name}(${s.params.map((p) => typeName(p.type)).join(', ')})'`, node);
    }
    const args = this.args(node.args, scope);
    if (cands.length > 1) {
      // pick best match by argument kinds
      const score = (s) => s.params.reduce((acc, p, i) => {
        if (!args[i]) return acc;
        const at = args[i][1], pt = p.type;
        if (at.k === pt.k) return acc + 2;
        if (isNum(at) && isNum(pt)) return acc + 1;
        if (isStrLike(at) && isStrLike(pt)) return acc + 1;
        return acc;
      }, 0);
      cands = cands.sort((x, y) => score(y) - score(x));
    }
    const sig = cands[0];
    const codes = args.map(([c, t], i) => {
      const p = sig.params[i];
      if (p.ref && (isNum(p.type) || p.type.k === 'String' || p.type.k === 'cstr')) {
        const lv = this.lvalue(node.args[i], scope);
        return `{get v(){return ${lv.get}},set v($n){${lv.set('$n')}}}`;
      }
      if (p.type.k === 'struct' && t.k === 'struct' && !p.ref) return `(${c}).$c()`;
      return this.conv(c, t, p.type);
    });
    return [`(await ${sig.js}(${codes.join(',')}))`, sig.ret];
  }

  builtinCall(name, node, scope) {
    const args = this.args(node.args, scope);
    const codes = args.map((a) => a[0]);
    const retMeta = FUNCS[name];
    let rt;
    if (retMeta === 'arg0') rt = args[0] ? args[0][1] : T.any;
    else if (retMeta === 'mix') rt = args.some((a) => isFloat(a[1])) ? T.f64 : args.length ? this.arith(args[0][1], (args[1] || args[0])[1]) : T.i32;
    else rt = this.typeFromMeta(retMeta);
    if (name === 'abs' && args[0] && !isNum(args[0][1])) rt = T.f64;
    if ((name === 'constrain') && args.some((a) => isFloat(a[1]))) rt = T.f64;
    if (name === 'F' || name === 'PSTR') return [codes[0], args[0][1]];
    if ((name === 'serializeJson' || name === 'serializeJsonPretty') && args[1] && args[1][1].k === 'String') {
      const lv = this.lvalue(node.args[1], scope);
      return [`(${lv.set(`$.serJ(${codes[0]},${name === 'serializeJsonPretty'})`)}).length`, T.u32];
    }
    if (name === 'random' && args.length === 0) throw this.err("no matching function for call to 'random()'", node);
    const aw = ASYNC_FUNCS.has(name) ? 'await ' : '';
    return [`(${aw}F.${name}(${codes.join(',')}))`, rt];
  }

  methodCall(node, scope) {
    const m = node.callee;
    const [oc, ot] = this.ex(m.obj, scope);
    const args = this.args(node.args, scope);
    const tmpl = m.tmpl ? this.tmplType(m.tmpl[0], m) : null;
    const tmplCode = tmpl ? JSON.stringify(tmpl.k === 'class' ? tmpl.name : tmpl.k === 'int' ? (tmpl.uns ? 'u' : 'i') + tmpl.bits : tmpl.k) : null;

    if (ot.k === 'String' || ot.k === 'cstr' || isCharArr(ot)) {
      const ret = STRING_METHODS[m.prop];
      if (!ret) throw this.err(`'class String' has no member named '${m.prop}'`, m);
      const codes = args.map(([c, t]) => (t.k === 'char' && ['indexOf', 'lastIndexOf', 'replace', 'concat', 'startsWith', 'endsWith', 'equals'].includes(m.prop) ? `$.ch(${c})` : t.k === 'float' && m.prop === 'concat' ? `$.ff(${c},2)` : c));
      const call = `$.sm(${oc},${JSON.stringify(m.prop)},[${codes.join(',')}])`;
      if (ret === 'self') {
        const lv = this.lvalue(m.obj, scope);
        return [`(${lv.set(call)},undefined)`, T.void];
      }
      return [call, this.typeFromMeta(ret)];
    }
    if (ot.k === 'struct') throw this.err(`'struct ${ot.name}' has no member named '${m.prop}'`, m);
    if (ot.k === 'array') throw this.err(`request for member '${m.prop}' in an array`, m);
    if (isNum(ot)) throw this.err(`request for member '${m.prop}' in non-class type '${typeName(ot)}'`, m);

    let codes;
    if (PRINT_METHODS.has(m.prop)) codes = this.printArgs(args);
    else codes = args.map(([c, t]) => (t.k === 'char' && ['write', 'add', 'set'].includes(m.prop) ? c : t.k === 'bool' ? `(${c}?1:0)` : c)).join(',');

    if (ot.k === 'class') {
      const cls = this.libs[ot.name];
      if (!cls) throw this.err(`'${ot.name}' was not declared in this scope`, m);
      const mname = tmpl ? m.prop + '$T' : m.prop;
      if (typeof cls.prototype[mname] !== 'function') {
        throw this.err(`'class ${ot.name}' has no member named '${m.prop}'` + (tmpl ? '<>' : '') + ' (hoặc chưa được trình giả lập hỗ trợ)', m);
      }
      const retMeta = cls.meta && cls.meta.ret && cls.meta.ret[m.prop];
      let rt = tmpl || this.typeFromMeta(retMeta);
      if (JSON_VALUE_TYPES.has(rt.name)) rt = T.any;
      const callArgs = tmpl ? [tmplCode, codes].filter(Boolean).join(',') : codes;
      return [`(await ${oc}.${mname}(${callArgs}))`, rt];
    }
    // dynamic (JSON values etc.)
    let rt = tmpl || T.any;
    if (rt.k === 'class' && JSON_VALUE_TYPES.has(rt.name)) rt = T.any;
    return [`(await $.call(${oc},${JSON.stringify(m.prop)},[${codes}],${tmplCode}))`, rt];
  }

  tmplType(ta, node) {
    if (!ta || ta.num !== undefined) return null;
    if (ta.k === 'named' && JSON_VALUE_TYPES.has(ta.name)) return { k: 'class', name: ta.name };
    if (ta.k === 'named' && (ta.name === 'const' || ta.name === 'char')) return T.cstr;
    if (ta.k === 'char') return T.cstr; // as<char*>
    return this.resolveType(Object.assign({ ptr: 0 }, ta), node);
  }
}
