import { evaluate } from 'mathjs';
import type { EquilibriumAnalysis } from '../core/types';
import { differentiate, latexNumber, substituteExpr, trySimplify } from './algebra';

/** Fill trace, determinant, and eigenvalues with exact expressions when the equilibrium is rational. */
export function attachExactSpectrum(eq: EquilibriumAnalysis, rhs: string[], vars: string[]): void {
  if (vars.length < 2 || rhs.length < 2) return;
  const snapped = eq.coords.slice(0, vars.length).map(rationalText);
  if (snapped.some((value) => value == null)) return;
  const map = Object.fromEntries(vars.map((name, index) => [name, snapped[index]!]));
  let entries: string[][];
  try {
    entries = rhs.slice(0, vars.length).map((expr) => vars.map((variable) => trySimplify(substituteExpr(differentiate(expr, variable), map))));
  } catch {
    return;
  }
  if (entries.some((row) => row.some((entry) => /[A-Za-z_]/.test(entry)))) return;
  if (vars.length !== 2) return;
  const trace = trySimplify(`(${entries[0]?.[0] ?? '0'})+(${entries[1]?.[1] ?? '0'})`);
  const det = trySimplify(`((${entries[0]?.[0] ?? '0'})*(${entries[1]?.[1] ?? '0'}))-((${entries[0]?.[1] ?? '0'})*(${entries[1]?.[0] ?? '0'}))`);
  const disc = trySimplify(`((${trace})^2)-(4*(${det}))`);
  if ([trace, det, disc].some((expr) => /[A-Za-z_]/.test(expr))) return;
  eq.jacobianExactLatex = `\\begin{pmatrix} ${entries
    .slice(0, 2)
    .map((row) => row.slice(0, 2).map((entry) => texConstant(entry)).join(' & '))
    .join(' \\\\ ')} \\end{pmatrix}`;
  eq.trace.exactLatex = texConstant(trace);
  eq.determinant.exactLatex = texConstant(det);
  if (eq.discriminant2D) eq.discriminant2D.exactLatex = texConstant(disc);
  const roots = quadraticRoots(trace, disc);
  if (!roots) return;
  const used = new Set<number>();
  for (const lambda of eq.eigenvalues) {
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    roots.forEach((root, index) => {
      if (used.has(index)) return;
      const dist = Math.hypot(root.re - lambda.re, root.im - lambda.im);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    const scale = 1 + Math.hypot(lambda.re, lambda.im);
    if (best >= 0 && bestDist < 1e-5 * scale) {
      used.add(best);
      lambda.exactLatex = roots[best]?.latex;
    }
  }
}

function rationalText(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) < 1e-9) return '0';
  for (let den = 1; den <= 12; den += 1) {
    const num = Math.round(value * den);
    if (Math.abs(value - num / den) < 1e-8) return den === 1 ? String(num) : `${num}/${den}`;
  }
  return null;
}

function texConstant(expr: string): string {
  try {
    return latexNumber(Number(evaluate(expr)));
  } catch {
    return expr;
  }
}

function asFraction(value: number): { n: number; d: number } | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) < 1e-10) return { n: 0, d: 1 };
  for (let d = 1; d <= 24; d += 1) {
    const n = Math.round(value * d);
    if (Math.abs(value - n / d) < 1e-8) return { n, d };
  }
  return null;
}

function quadraticRoots(traceExpr: string, discExpr: string): Array<{ re: number; im: number; latex: string }> | null {
  let trace: number;
  let disc: number;
  try {
    trace = Number(evaluate(traceExpr));
    disc = Number(evaluate(discExpr));
  } catch {
    return null;
  }
  const tr = asFraction(trace);
  const delta = asFraction(disc);
  if (!tr || !delta || !Number.isFinite(trace) || !Number.isFinite(disc)) return null;
  if (delta.n === 0) {
    const latex = fractionTex(tr.n, tr.d * 2);
    const re = trace / 2;
    return [
      { re, im: 0, latex },
      { re, im: 0, latex },
    ];
  }
  const magnitude = sqrtOverTwo(Math.abs(delta.n), delta.d);
  if (!magnitude) return null;
  const halfTrace = fractionTex(tr.n, tr.d * 2);
  if (delta.n > 0) {
    const plus = combine(halfTrace, magnitude, '+');
    const minus = combine(halfTrace, magnitude, '-');
    const root = Math.sqrt(disc);
    return [
      { re: (trace + root) / 2, im: 0, latex: plus },
      { re: (trace - root) / 2, im: 0, latex: minus },
    ];
  }
  const positive = combineImaginary(halfTrace, magnitude, '+');
  const negative = combineImaginary(halfTrace, magnitude, '-');
  const root = Math.sqrt(-disc);
  return [
    { re: trace / 2, im: root / 2, latex: positive },
    { re: trace / 2, im: -root / 2, latex: negative },
  ];
}

function combine(left: string, right: string, sign: '+' | '-'): string {
  if (left === '0') return sign === '-' ? `-${parenthesize(right)}` : right;
  return `${left} ${sign} ${right}`;
}

function combineImaginary(left: string, right: string, sign: '+' | '-'): string {
  const imag = right === '1' ? 'i' : `${right} i`;
  if (left === '0') return sign === '-' ? `-${imag}` : imag;
  return `${left} ${sign} ${imag}`;
}

function parenthesize(tex: string): string {
  return tex.includes('+') || tex.includes('-') ? `(${tex})` : tex;
}

function fractionTex(numerator: number, denominator: number): string {
  if (denominator < 0) return fractionTex(-numerator, -denominator);
  const g = gcd(Math.abs(numerator), denominator);
  const n = numerator / g;
  const d = denominator / g;
  if (d === 1) return String(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}\\frac{${Math.abs(n)}}{${d}}`;
}

/** √(numerator/denominator) / 2, with square factors pulled out of the radical. */
function sqrtOverTwo(numerator: number, denominator: number): string | null {
  if (numerator < 0 || denominator <= 0) return null;
  const g = gcd(numerator, denominator);
  const n = numerator / g;
  const d = denominator / g;
  const top = stripSquare(n * d);
  const bottom = 2 * d;
  const shared = gcd(top.outside, bottom);
  const outside = top.outside / shared;
  const den = bottom / shared;
  if (top.inside === 0) return '0';
  const radical = top.inside === 1 ? String(outside) : outside === 1 ? `\\sqrt{${top.inside}}` : `${outside}\\sqrt{${top.inside}}`;
  if (den === 1) return radical;
  return `\\frac{${radical}}{${den}}`;
}

function stripSquare(value: number): { outside: number; inside: number } {
  let outside = 1;
  let inside = value;
  for (let prime = 2; prime * prime <= inside; prime += 1) {
    while (inside % (prime * prime) === 0) {
      outside *= prime;
      inside /= prime * prime;
    }
  }
  return { outside, inside };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}
