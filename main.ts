// Tiny stack VM for make.fun's tiny-stack-vm-01: a complete interpreter of the
// kit's ISA (program/generator/subject/ISA.md), including every trap code, the
// unsigned operations, exact 32-bit multiplication and the step/output limits
// that the house baseline plain-vm 1.0.0 skips.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ip = 0, pc = 0, steps = 0;
  const n = p.length;
  const done = (code: number) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
    const valid =
      op <= 7 || (op >= 0x10 && op <= 0x22 && op !== 0x1f) || (op >= 0x30 && op <= 0x34) ||
      op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53);
    if (!valid) return done(5);
    if (imm && pc + imm >= n) return done(9);
    steps++;
    const next = pc + 1 + imm;
    pc = next;
    // Binary arithmetic / logic / comparison ops: 0x10-0x22 except NEG, NOT, and the gap 0x1f.
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b && op !== 0x1f) {
      if (sp < 2) return done(2);
      const b = D[sp - 1], a = D[sp - 2];
      let r: number;
      switch (op) {
        case 0x10: r = (a + b) | 0; break;
        case 0x11: r = (a - b) | 0; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13:
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0; break;
        case 0x14:
          if (b === 0) return done(4);
          r = b === -1 ? 0 : a % b; break;
        case 0x15:
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
        case 0x16:
          if (b === 0) return done(4);
          r = ((a >>> 0) % (b >>> 0)) | 0; break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = (a >>> (b & 31)) | 0; break;
        case 0x20: r = a === b ? 1 : 0; break;
        case 0x21: r = a < b ? 1 : 0; break;
        default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break; // 0x22 LTU
      }
      D[sp - 2] = r;
      sp--;
      continue;
    }
    switch (op) {
      case 0x00: return done(0);
      case 0x01:
        if (sp >= 256) return done(3);
        D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 0x02:
        if (sp >= 256) return done(3);
        D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 0x03:
        if (sp < 1) return done(2);
        sp--; break;
      case 0x04:
        if (sp < 1) return done(2);
        if (sp >= 256) return done(3);
        D[sp] = D[sp - 1]; sp++; break;
      case 0x05: {
        if (sp < 2) return done(2);
        const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break;
      }
      case 0x06:
        if (sp < 2) return done(2);
        if (sp >= 256) return done(3);
        D[sp] = D[sp - 2]; sp++; break;
      case 0x07: {
        if (sp < 3) return done(2);
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break;
      }
      case 0x17:
        if (sp < 1) return done(2);
        D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b:
        if (sp < 1) return done(2);
        D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          if (sp < 1) return done(2);
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp >= 64) return done(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8); break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp]; break;
      case 0x40: {
        if (sp < 1) return done(2);
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return done(6);
        D[sp - 1] = M[addr]; break;
      }
      case 0x41: {
        if (sp < 2) return done(2);
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return done(6);
        M[addr] = D[sp - 2];
        sp -= 2; break;
      }
      case 0x50: {
        if (sp < 1) return done(2);
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (sp < 1) return done(2);
        if (olen >= 65536) return done(11);
        out[olen++] = D[--sp] & 255; break;
      case 0x52:
        if (sp >= 256) return done(3);
        D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53:
        if (sp < 1) return done(2);
        return done(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
