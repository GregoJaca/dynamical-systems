import { parse, type MathNode } from 'mathjs';
import { rationalize, trySimplify } from './algebra';

/**
 * Expand a polynomial in r and sin/cos of one angle and reduce it with sin²+cos² = 1.
 * Returns a mathjs expression, or null when the input is not that kind of polynomial.
 */

type Ast = MathNode & {
  name: string;
  value: number | string;
  content: Ast;
  op: string;
  fn: Ast | string;
  args: Ast[];
  isUnary?: () => boolean;
};

interface Term {
  coeff: number;
  r: number;
  c: number;
  s: number;
  extra: string;
}

const ANGLE = 'theta';

export function reduceTrigPolynomial(expr: string): string | null {
  try {
    return reduceNode(parse(expr));
  } catch {
    return null;
  }
}

function reduceNode(node: MathNode): string | null {
  const terms = collect(node as Ast);
  if (!terms) return null;
  const reduced = reduceAngles(terms);
  if (reduced.length === 0) return '0';
  return trySimplify(formatTerms(reduced));
}

function collect(node: Ast): Term[] | null {
  if (node.type === 'ParenthesisNode') return collect(node.content);
  if (node.type === 'OperatorNode' && (node.fn === 'unaryMinus' || (node.op === '-' && node.args.length === 1))) {
    const inner = collect(node.args[0]!);
    return inner?.map((term) => ({ ...term, coeff: -term.coeff })) ?? null;
  }
  if (node.type === 'OperatorNode' && node.op === '+') {
    const parts = node.args.map((arg) => collect(arg));
    if (parts.some((part) => !part)) return null;
    return parts.flatMap((part) => part!);
  }
  if (node.type === 'OperatorNode' && node.op === '-' && node.args.length === 2) {
    const left = collect(node.args[0]!);
    const right = collect(node.args[1]!);
    if (!left || !right) return null;
    return [...left, ...right.map((term) => ({ ...term, coeff: -term.coeff }))];
  }
  if (node.type === 'OperatorNode' && node.op === '*') {
    return node.args.reduce<Term[] | null>((product, arg) => {
      if (!product) return null;
      const factor = collect(arg);
      return factor ? multiply(product, factor) : null;
    }, [unit()]);
  }
  if (node.type === 'OperatorNode' && node.op === '/' && node.args.length === 2) {
    const numerator = collect(node.args[0]!);
    const denominator = collect(node.args[1]!);
    if (!numerator || !denominator) return null;
    const inverse = reciprocal(denominator);
    return inverse ? multiply(numerator, inverse) : null;
  }
  if (node.type === 'OperatorNode' && node.op === '^' && node.args.length === 2) {
    const exponent = rationalPower(node.args[1]!);
    const base = collect(node.args[0]!);
    if (exponent === null || !base) return null;
    const radial = collapseRadial(base);
    if (radial) {
      const powered = raiseRadial(radial, exponent);
      if (powered) return powered;
    }
    if (!Number.isInteger(exponent)) return null;
    const power = exponent;
    if (power === 0) return [unit()];
    if (power < 0) {
      const inverse = reciprocal(base);
      return inverse ? raise(inverse, -power) : null;
    }
    return raise(base, power);
  }
  const single = singleTerm(node);
  return single ? [single] : null;
}

function raise(base: Term[], power: number): Term[] | null {
  if (base.length === 1) {
    const term = base[0]!;
    if (term.extra && power !== 1) return null;
    return [{
      coeff: term.coeff ** power,
      r: term.r * power,
      c: term.c * power,
      s: term.s * power,
      extra: term.extra,
    }];
  }
  if (power > 8) return null;
  let acc = [unit()];
  for (let index = 0; index < power; index += 1) acc = multiply(acc, base);
  return acc;
}

function reciprocal(terms: Term[]): Term[] | null {
  if (terms.length !== 1) return null;
  const term = terms[0]!;
  if (term.extra || Math.abs(term.coeff) < 1e-15) return null;
  return [{ coeff: 1 / term.coeff, r: -term.r, c: -term.c, s: -term.s, extra: '' }];
}

function multiply(left: Term[], right: Term[]): Term[] {
  const out: Term[] = [];
  for (const a of left) {
    for (const b of right) {
      out.push({
        coeff: a.coeff * b.coeff,
        r: a.r + b.r,
        c: a.c + b.c,
        s: a.s + b.s,
        extra: [a.extra, b.extra].filter(Boolean).sort().join('*'),
      });
    }
  }
  return out;
}

function unit(): Term {
  return { coeff: 1, r: 0, c: 0, s: 0, extra: '' };
}

function singleTerm(node: Ast): Term | null {
  if (node.type === 'ConstantNode') {
    const value = Number(node.value);
    return Number.isFinite(value) ? { coeff: value, r: 0, c: 0, s: 0, extra: '' } : null;
  }
  if (node.type === 'SymbolNode') {
    if (node.name === 'r' || node.name === 'rho') return { coeff: 1, r: 1, c: 0, s: 0, extra: '' };
    if (node.name === ANGLE || node.name === 'phi') return null;
    return { coeff: 1, r: 0, c: 0, s: 0, extra: node.name };
  }
  if (node.type === 'FunctionNode') {
    const name = typeof node.fn === 'string' ? node.fn : node.fn.name;
    const arg = node.args[0];
    if (!arg || arg.type !== 'SymbolNode' || arg.name !== ANGLE) return null;
    if (name === 'cos') return { coeff: 1, r: 0, c: 1, s: 0, extra: '' };
    if (name === 'sin') return { coeff: 1, r: 0, c: 0, s: 1, extra: '' };
    return null;
  }
  return null;
}

function rationalPower(node: Ast): number | null {
  if (node.type === 'ParenthesisNode') return rationalPower(node.content);
  if (node.type === 'OperatorNode' && (node.fn === 'unaryMinus' || (node.op === '-' && node.args.length === 1))) {
    const inner = rationalPower(node.args[0]!);
    return inner === null ? null : -inner;
  }
  if (node.type === 'ConstantNode') {
    const value = Number(node.value);
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return value;
    const rational = rationalize(value, 12);
    if (!rational || Math.abs(value - rational.n / rational.d) > 1e-12) return null;
    return rational.n / rational.d;
  }
  if (node.type === 'OperatorNode' && node.op === '/' && node.args.length === 2) {
    const numerator = rationalPower(node.args[0]!);
    const denominator = rationalPower(node.args[1]!);
    if (numerator === null || denominator === null || denominator === 0) return null;
    if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || Math.abs(denominator) > 12) return null;
    return numerator / denominator;
  }
  return null;
}

/** A trig polynomial that is really a power of r, such as r²(cos²θ + sin²θ). */
function collapseRadial(terms: Term[]): Term | null {
  const reduced = reduceAngles(terms);
  if (reduced.length !== 1) return null;
  const term = reduced[0]!;
  if (term.c !== 0 || term.s !== 0 || term.extra) return null;
  return term;
}

function raiseRadial(term: Term, exponent: number): Term[] | null {
  if (term.c !== 0 || term.s !== 0 || term.extra) return null;
  if (Math.abs(exponent) < 1e-15) return Math.abs(term.coeff) < 1e-15 ? null : [unit()];
  if (term.coeff < 0 && !Number.isInteger(exponent)) return null;
  const coeff = term.coeff ** exponent;
  if (!Number.isFinite(coeff)) return null;
  return [{ coeff, r: term.r * exponent, c: 0, s: 0, extra: '' }];
}

function reduceAngles(terms: Term[]): Term[] {
  const bucket = new Map<string, Term>();
  for (const term of terms) {
    const pairs = term.s < 0 ? [{ ...term }] : expandSin(term);
    for (const piece of pairs) addTerm(bucket, piece);
  }
  return [...bucket.values()].filter((term) => Math.abs(term.coeff) > 1e-10);
}

function expandSin(term: Term): Term[] {
  const half = Math.floor(Math.abs(term.s) / 2);
  const rest = term.s - 2 * half;
  if (half === 0) return [term];
  const out: Term[] = [];
  for (let index = 0; index <= half; index += 1) {
    const choose = binomial(half, index);
    out.push({
      coeff: term.coeff * choose * (index % 2 === 0 ? 1 : -1),
      r: term.r,
      c: term.c + 2 * index,
      s: rest,
      extra: term.extra,
    });
  }
  return out;
}

function addTerm(bucket: Map<string, Term>, term: Term): void {
  const radial = rationalize(term.r, 24);
  const rKey = radial && Math.abs(term.r - radial.n / radial.d) <= 1e-12 ? `${radial.n}/${radial.d}` : term.r.toPrecision(12);
  const key = `${rKey}|${term.c}|${term.s}|${term.extra}`;
  const existing = bucket.get(key);
  if (existing) existing.coeff += term.coeff;
  else bucket.set(key, { ...term });
}

function formatTerms(terms: Term[]): string {
  const pieces = terms
    .slice()
    .sort((a, b) => a.r - b.r || a.c - b.c || a.s - b.s || a.extra.localeCompare(b.extra))
    .map((term) => formatTerm(term));
  return pieces.reduce((sum, piece, index) => {
    if (index === 0) return piece;
    return piece.startsWith('-') ? `${sum} - ${piece.slice(1)}` : `${sum} + ${piece}`;
  }, '');
}

function formatTerm(term: Term): string {
  const factors: string[] = [];
  if (term.extra) factors.push(term.extra.includes('*') ? `(${term.extra})` : term.extra);
  if (term.r !== 0) factors.push(power('r', term.r));
  if (term.c !== 0) factors.push(power(`cos(${ANGLE})`, term.c));
  if (term.s !== 0) factors.push(power(`sin(${ANGLE})`, term.s));
  const magnitude = rationalText(Math.abs(term.coeff));
  const body = factors.length === 0 ? magnitude : magnitude === '1' ? factors.join(' * ') : `${magnitude} * ${factors.join(' * ')}`;
  return term.coeff < 0 ? `-${body}` : body;
}

function power(base: string, exponent: number): string {
  const atom = base.includes('(') ? `(${base})` : base;
  if (Math.abs(exponent - 1) < 1e-12) return atom;
  const rational = rationalize(exponent, 12);
  const text = rational && Math.abs(exponent - rational.n / rational.d) <= 1e-12
    ? rational.d === 1 ? String(rational.n) : `(${rational.n}/${rational.d})`
    : String(exponent);
  return `(${atom} ^ ${text})`;
}

function rationalText(value: number): string {
  const rational = rationalize(value, 24);
  if (!rational) return String(value);
  return rational.d === 1 ? String(rational.n) : `(${rational.n}/${rational.d})`;
}

function binomial(n: number, k: number): number {
  let value = 1;
  for (let index = 1; index <= k; index += 1) value = (value * (n - k + index)) / index;
  return value;
}
