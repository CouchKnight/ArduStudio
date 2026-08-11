// Math expressions for If Math Expression and Loop While Math Expression.
//
// Parsing happens here, at compile time only — the device never sees a parser.
// An expression compiles to reverse Polish bytes that both runtimes evaluate on
// a small integer stack, so the whole runtime cost is a ~25-line loop.
//
// Grammar (loosest to tightest):
//   or      := and ('||' and)*
//   and     := cmp ('&&' cmp)*
//   cmp     := sum (('=='|'!='|'<'|'>'|'<='|'>=') sum)*
//   sum     := term (('+'|'-') term)*
//   term    := unary (('*'|'/'|'%') unary)*
//   unary   := ('-'|'!') unary | atom
//   atom    := number | $variable | '(' or ')' | func '(' args ')'

// Byte codes. Values below OP_BASE are reserved for the two operand forms.
export const EX = {
  PUSH_CONST: 0,  // followed by lo, hi — a signed 16-bit literal
  PUSH_VAR: 1,    // followed by the variable index
  ADD: 2,
  SUB: 3,
  MUL: 4,
  DIV: 5,
  MOD: 6,
  NEG: 7,
  NOT: 8,
  EQ: 9,
  NE: 10,
  LT: 11,
  GT: 12,
  LE: 13,
  GE: 14,
  AND: 15,
  OR: 16,
  MIN: 17,
  MAX: 18,
  ABS: 19,
  RND: 20,
};

// Deepest the evaluation stack can get. Both runtimes allocate this many
// int16 slots, so the parser refuses anything that would overflow it.
export const EXPR_STACK = 16;
// Longest compiled expression, so an expression can never dominate a script.
export const MAX_EXPR_BYTES = 64;

const FUNCS = {
  min: { arity: 2, op: EX.MIN },
  max: { arity: 2, op: EX.MAX },
  abs: { arity: 1, op: EX.ABS },
  rnd: { arity: 1, op: EX.RND },
};

const BINARY = [
  // Tightest last; each row is one precedence level.
  [['||', EX.OR]],
  [['&&', EX.AND]],
  [['==', EX.EQ], ['!=', EX.NE], ['<=', EX.LE], ['>=', EX.GE], ['<', EX.LT], ['>', EX.GT]],
  [['+', EX.ADD], ['-', EX.SUB]],
  [['*', EX.MUL], ['/', EX.DIV], ['%', EX.MOD]],
];

class ParseError extends Error {}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      tokens.push({ kind: 'num', value: parseInt(src.slice(i, j), 10), at: i });
      i = j;
      continue;
    }
    if (ch === '$') {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      if (j === i + 1) throw new ParseError('"$" with no variable name after it');
      tokens.push({ kind: 'var', value: src.slice(i + 1, j), at: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ kind: 'name', value: src.slice(i, j).toLowerCase(), at: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ kind: 'op', value: two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/%<>!(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, at: i });
      i++;
      continue;
    }
    throw new ParseError(`unexpected character "${ch}"`);
  }
  return tokens;
}

// Compile `src` to expression bytes. `varIndex` maps a variable name to its
// slot. Throws ParseError with a human-readable message; callers turn that into
// a compiler warning rather than letting it escape.
export function compileExpression(src, varIndex) {
  const text = String(src || '').trim();
  if (!text) throw new ParseError('the expression is empty');
  const tokens = tokenize(text);
  let pos = 0;
  const out = [];

  const peek = () => tokens[pos];
  const isOp = (v) => peek() && peek().kind === 'op' && peek().value === v;
  const eat = (v) => { if (!isOp(v)) throw new ParseError(`expected "${v}"`); pos++; };

  function parseBinary(level) {
    if (level >= BINARY.length) return parseUnary();
    parseBinary(level + 1);
    for (;;) {
      const hit = BINARY[level].find(([sym]) => isOp(sym));
      if (!hit) return;
      pos++;
      parseBinary(level + 1);
      out.push(hit[1]);
    }
  }

  function parseUnary() {
    if (isOp('-')) { pos++; parseUnary(); out.push(EX.NEG); return; }
    if (isOp('!')) { pos++; parseUnary(); out.push(EX.NOT); return; }
    if (isOp('+')) { pos++; parseUnary(); return; }
    parseAtom();
  }

  function parseAtom() {
    const t = peek();
    if (!t) throw new ParseError('the expression ends too early');
    if (t.kind === 'num') {
      pos++;
      if (t.value > 32767) throw new ParseError(`${t.value} is larger than 32767`);
      out.push(EX.PUSH_CONST, t.value & 0xff, (t.value >> 8) & 0xff);
      return;
    }
    if (t.kind === 'var') {
      pos++;
      const idx = varIndex.get(t.value);
      if (idx === undefined) throw new ParseError(`there is no variable called "$${t.value}"`);
      out.push(EX.PUSH_VAR, idx);
      return;
    }
    if (t.kind === 'name') {
      const fn = FUNCS[t.value];
      if (!fn) throw new ParseError(`unknown function "${t.value}"`);
      pos++;
      eat('(');
      parseBinary(0);
      for (let i = 1; i < fn.arity; i++) { eat(','); parseBinary(0); }
      eat(')');
      out.push(fn.op);
      return;
    }
    if (isOp('(')) { pos++; parseBinary(0); eat(')'); return; }
    throw new ParseError(`unexpected "${t.value}"`);
  }

  parseBinary(0);
  if (pos < tokens.length) throw new ParseError(`unexpected "${tokens[pos].value}" after the end of the expression`);
  if (out.length > MAX_EXPR_BYTES) {
    throw new ParseError(`the expression compiles to ${out.length} bytes, over the ${MAX_EXPR_BYTES}-byte limit`);
  }
  const depth = stackDepth(out);
  if (depth > EXPR_STACK) {
    throw new ParseError(`the expression nests too deeply (needs ${depth} stack slots, limit is ${EXPR_STACK})`);
  }
  return out;
}

// Peak stack depth of a compiled expression, so a program that would overflow
// the runtime's fixed stack is rejected here rather than misbehaving on device.
export function stackDepth(bytes) {
  let depth = 0, peak = 0;
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    if (op === EX.PUSH_CONST) { i += 2; depth++; }
    else if (op === EX.PUSH_VAR) { i += 1; depth++; }
    else if (op === EX.NEG || op === EX.NOT || op === EX.ABS || op === EX.RND) { /* 1 in, 1 out */ }
    else depth--; // every other op folds two values into one
    if (depth > peak) peak = depth;
  }
  return peak;
}

// Evaluate compiled expression bytes. `vars` is the variable array and `rnd(n)`
// draws from `rand`. Mirrors the C++ evalExpression() exactly, including the
// int16 wrapping and the divide-by-zero rule.
export function evalExpression(bytes, offset, length, vars, rand) {
  const stack = new Int16Array(EXPR_STACK);
  let sp = 0;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    const op = bytes[i];
    switch (op) {
      case EX.PUSH_CONST:
        stack[sp++] = bytes[i + 1] | (bytes[i + 2] << 8);
        i += 2;
        break;
      case EX.PUSH_VAR:
        stack[sp++] = vars[bytes[++i]];
        break;
      case EX.NEG: stack[sp - 1] = -stack[sp - 1]; break;
      case EX.NOT: stack[sp - 1] = stack[sp - 1] ? 0 : 1; break;
      case EX.ABS: stack[sp - 1] = Math.abs(stack[sp - 1]); break;
      case EX.RND: {
        const n = stack[sp - 1];
        stack[sp - 1] = n > 0 ? rand(n) : 0;
        break;
      }
      default: {
        const b = stack[--sp];
        const a = stack[sp - 1];
        let r;
        switch (op) {
          case EX.ADD: r = a + b; break;
          case EX.SUB: r = a - b; break;
          case EX.MUL: r = a * b; break;
          // Dividing by zero yields 0 rather than trapping the device.
          case EX.DIV: r = b === 0 ? 0 : Math.trunc(a / b); break;
          case EX.MOD: r = b === 0 ? 0 : a % b; break;
          case EX.EQ: r = a === b ? 1 : 0; break;
          case EX.NE: r = a !== b ? 1 : 0; break;
          case EX.LT: r = a < b ? 1 : 0; break;
          case EX.GT: r = a > b ? 1 : 0; break;
          case EX.LE: r = a <= b ? 1 : 0; break;
          case EX.GE: r = a >= b ? 1 : 0; break;
          case EX.AND: r = (a && b) ? 1 : 0; break;
          case EX.OR: r = (a || b) ? 1 : 0; break;
          case EX.MIN: r = Math.min(a, b); break;
          case EX.MAX: r = Math.max(a, b); break;
          default: r = 0;
        }
        stack[sp - 1] = r; // Int16Array truncates, matching the C++ int16_t
        break;
      }
    }
  }
  return sp > 0 ? stack[sp - 1] : 0;
}

export { ParseError };
