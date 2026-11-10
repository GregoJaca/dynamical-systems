/**
 * Scalar expressions for PDE Lab. Parsing goes through the shared expression rewriter.
 * Nothing here reimplements juxtaposition, Greek names, or implicit multiplication.
 */

import { compile, erf, parse, type MathNode } from 'mathjs';
import { paintSymbolLatex } from '../input/parser';
import { prepareMath } from '../input/expression';

const KNOWN_BASE = ['x', 'y', 't', 'u', 'r', 'pi', 'U', 'UT', 'UX', 'UY', 'UXX', 'UYY', 'UXY', 'UTT'];

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 're' in value && typeof (value as { re: number }).re === 'number') {
    const imag = 'im' in value ? (value as { im?: number }).im ?? 0 : 0;
    if (imag === 0) return (value as { re: number }).re;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

const extras: Record<string, (...args: number[]) => number> = {
  heaviside: (x) => (x > 0 ? 1 : x < 0 ? 0 : 0.5),
  rect: (x, a, b) => (x >= Math.min(a, b) && x <= Math.max(a, b) ? 1 : 0),
  dirac: () => 0,
  erfc: (x) => 1 - asNumber(erf(x)),
  sign: (x) => Math.sign(x),
};

export function toMath(raw: string, known: readonly string[] = []): string {
  return prepareMath(raw, [...KNOWN_BASE, ...known]);
}

export function compileMath(raw: string, known: readonly string[] = []): (scope: Record<string, number>) => number {
  let prepared = raw.trim();
  try {
    prepared = toMath(raw, known);
  } catch {
    prepared = raw.trim();
  }
  let fn: { evaluate: (scope: Record<string, unknown>) => unknown };
  try {
    fn = compile(prepared);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not compile';
    throw new Error(`Could not read "${raw}": ${message}`);
  }
  return (scope) => asNumber(fn.evaluate({ ...extras, ...scope }));
}

export function evalMath(raw: string, scope: Record<string, number>, known: readonly string[] = []): number {
  return compileMath(raw, known)(scope);
}

export function exprToLatex(raw: string, known: readonly string[] = []): string {
  const prepared = toMath(raw, known);
  return paintSymbolLatex(parse(prepared).toTex({ parenthesis: 'auto' }), [...KNOWN_BASE, ...known]);
}

export function mentions(expr: string, name: string): boolean {
  try {
    let found = false;
    parse(expr).traverse((node: MathNode) => {
      if (node.type === 'SymbolNode' && (node as MathNode & { name: string }).name === name) found = true;
    });
    return found;
  } catch {
    return new RegExp(`\\b${name}\\b`).test(expr);
  }
}

export function makeField(
  raw: string,
  vars: readonly string[],
  params: Record<string, number>,
): (...args: number[]) => number {
  const fn = compileMath(raw, [...vars]);
  return (...args) => {
    const scope: Record<string, number> = { ...params };
    vars.forEach((name, index) => {
      scope[name] = args[index] ?? 0;
    });
    const value = fn(scope);
    return Number.isFinite(value) ? value : 0;
  };
}

/** A centred Dirac mass `dirac(x-a)`. Returns the centre, or null when the expression is not a pure delta. */
export function diracCenter(raw: string): number | null {
  const prepared = toMath(raw).replace(/\s+/g, '');
  const match = prepared.match(/^dirac\((x|y)(?:-([+-]?(?:\d+\.?\d*|\d*\.?\d+)))?\)$/);
  if (!match) {
    if (prepared === 'dirac(x)' || prepared === 'dirac(y)') return 0;
    return null;
  }
  return match[2] ? Number(match[2]) : 0;
}
