// Arduino Print base class (Serial, LCD, OLED, LoRa, UDP… derive from it): subclasses implement $out(binary string).
import { cFormat, bytesToBin } from './format.js';

export class Print {
  constructor(R) { this.R = R; }
  async $out(s) { /* override */ void s; }
  async print(v, base) { const s = this.R.h.pfmt(v, base); await this.$out(s); return s.length; }
  async println(v, base) {
    const s = (v === undefined ? '' : this.R.h.pfmt(v, base)) + '\r\n';
    await this.$out(s);
    return s.length;
  }
  async printf(fmt, ...args) { const s = cFormat(fmt, args, (x) => this.R.h.str(x)); await this.$out(s); return s.length; }
  async write(v, len) {
    let s;
    if (typeof v === 'number') s = String.fromCharCode(v & 255);
    else if (v instanceof Uint8Array) s = bytesToBin(len !== undefined ? v.subarray(0, len) : v);
    else s = this.R.h.str(v).slice(0, len === undefined ? undefined : len);
    await this.$out(s);
    return s.length;
  }
}
Print.meta = { ret: { print: 'u32', println: 'u32', printf: 'u32', write: 'u32' } };
