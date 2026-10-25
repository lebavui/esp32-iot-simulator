import { EXAMPLES } from '../js/examples.js';
import { compile } from '../js/compiler/compile.js';
let fail = 0;
for (const ex of EXAMPLES) {
  const board = ex.diagram.parts.find((p) => /esp32|xiao/.test(p.type));
  try { const r = compile(ex.code, { board: board && board.type }); console.log('OK  ', ex.id, r.warnings.map((w) => w.line + ':' + w.msg).join(' | ')); }
  catch (e) { fail++; console.log('FAIL', ex.id, e.line + ':' + e.col, e.message); }
}
process.exit(fail ? 1 : 0);
