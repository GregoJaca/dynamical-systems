/**
 * Linear equations whose speed dx/dτ is affine in x, or a product of a function of τ and a function of x.
 * The picture integrates those ODEs numerically; the labels come from the concrete coefficients.
 */

import { compileMath, exprToLatex } from '../expr';
import type { CharCurve, CharProblem, PdeObject } from '../types';
import type { BuiltChar } from './solveChar';
import { constantOf, parameterValues } from './solveChar';
import { cauchyWindow, characteristicOde, prettyTex } from './formula';

type Scalar = (x: number, tau: number) => number;

interface Cauchy {
  g: (x: number) => number;
  gExpr: string;
  t0: number;
}

export function solveAffine(problem: CharProblem): BuiltChar | null {
  if (problem.quasilinear || problem.eikonal || problem.data.kind !== 'cauchy') return null;
  const params = { pi: Math.PI, e: Math.E, ...parameterValues(problem) };
  const tauName = problem.vars === 'xy' ? 'y' : 't';
  const data = readCauchy(problem, params);
  const a = compileCoeff(problem.aExpr, params, problem.vars);
  const b = compileCoeff(problem.bExpr, params, problem.vars);
  const c = compileCoeff(problem.cExpr, params, problem.vars);
  const d = compileCoeff(problem.dExpr, params, problem.vars);
  const speed = (x: number, tau: number) => {
    const bb = b(x, tau);
    if (!Number.isFinite(bb) || Math.abs(bb) < 1e-10) return Number.NaN;
    const value = a(x, tau) / bb;
    return Number.isFinite(value) ? value : Number.NaN;
  };
  const built = fitAffine(speed, data, tauName, problem, b, c, d) ?? fitProduct(speed, data, tauName, problem, b, c, d);
  if (!built) return null;
  if (!stable(built.evaluate, data)) return null;
  return built;
}

function fitAffine(
  speed: Scalar,
  data: Cauchy,
  tauName: string,
  problem: CharProblem,
  b: Scalar,
  c: Scalar,
  d: Scalar,
): BuiltChar | null {
  const times = [data.t0, data.t0 + 0.4, data.t0 + 1.1];
  for (const tau of times) {
    const samples = [-1, 0, 1, 2.5].map((x) => speed(x, tau));
    if (samples.some((value) => !Number.isFinite(value))) return null;
    const p = (samples[2] ?? 0) - (samples[1] ?? 0);
    const q = samples[1] ?? 0;
    for (const [x, value] of [-1, 0, 1, 2.5].map((point, index) => [point, samples[index] ?? 0] as const)) {
      if (Math.abs(value - (p * x + q)) > 1e-6 * (1 + Math.abs(value))) return null;
    }
  }
  const pOf = (tau: number) => speed(1, tau) - speed(0, tau);
  const qOf = (tau: number) => speed(0, tau);
  const domain = windowFor(problem, data);
  const speedOf = (x: number, tau: number) => pOf(tau) * x + qOf(tau);
  const evaluate = (x: number, tau: number) => valueAt(x, tau, data, speedOf, b, c, d);
  const curves = feet(domain, data).map((x0, index) => ({
    id: `char-${index}`,
    invariantLatex: `x(${prettyTex(data.t0)})=${prettyTex(x0)}`,
    carriedLatex: `u\\ \\text{from}\\ g(${texNum(x0)})`,
    points: trajectory(x0, data, domain.t[1], speedOf, b, c, d),
  }));
  const speedLatex = characteristicOde(problem, { pi: Math.PI, e: Math.E, ...parameterValues(problem) }, tauName);
  return pack(problem, data, domain, evaluate, curves, speedLatex, b);
}

function fitProduct(
  speed: Scalar,
  data: Cauchy,
  tauName: string,
  problem: CharProblem,
  b: Scalar,
  c: Scalar,
  d: Scalar,
): BuiltChar | null {
  const xRef = 0.4;
  const tRef = data.t0 + 0.5;
  const origin = speed(xRef, tRef);
  if (!Number.isFinite(origin) || Math.abs(origin) < 1e-8) return null;
  const h = (x: number) => speed(x, tRef) / origin;
  const f = (tau: number) => speed(xRef, tau);
  for (const x of [-0.5, 0.4, 1.7]) {
    for (const tau of [data.t0 + 0.2, data.t0 + 0.9]) {
      const actual = speed(x, tau);
      const split = f(tau) * h(x);
      if (!Number.isFinite(actual) || !Number.isFinite(split)) return null;
      if (Math.abs(actual - split) > 1e-5 * (1 + Math.abs(actual))) return null;
    }
  }
  if ([-0.5, 0.4, 1.7].every((x) => Math.abs(h(x) - h(xRef)) < 1e-8)) return null;
  const domain = windowFor(problem, data);
  const speedOf = (x: number, tau: number) => f(tau) * h(x);
  const evaluate = (x: number, tau: number) => valueAt(x, tau, data, speedOf, b, c, d);
  const curves: CharCurve[] = feet(domain, data).map((x0, index) => ({
    id: `char-${index}`,
    invariantLatex: `x(${prettyTex(data.t0)})=${prettyTex(x0)}`,
    carriedLatex: `u\\ \\text{from}\\ g(${texNum(x0)})`,
    points: trajectory(x0, data, domain.t[1], speedOf, b, c, d),
  }));
  const speedLatex = characteristicOde(problem, { pi: Math.PI, e: Math.E, ...parameterValues(problem) }, tauName);
  return pack(problem, data, domain, evaluate, curves, speedLatex, b);
}

function pack(
  problem: CharProblem,
  data: Cauchy,
  domain: { x: [number, number]; t: [number, number] },
  evaluate: (x: number, tau: number) => number,
  curves: CharCurve[],
  speedLatex: string,
  b: Scalar,
): BuiltChar {
  const transverse = samples(domain.x[0], domain.x[1], 5).every((x) => Math.abs(b(x, data.t0)) > 1e-8);
  const dataLatex = `u(x,${texNum(data.t0)})=${tex(data.gExpr)}`;
  const objects: PdeObject[] = [
    { id: 'characteristics', label: 'Characteristics', formulaLatex: speedLatex, group: 'characteristic', defaultOn: true },
    { id: 'data', label: 'Initial line', formulaLatex: dataLatex, group: 'boundary', defaultOn: true },
  ];
  const worked = [
    problem.equationLatex,
    `The characteristic ODE is \\(${speedLatex}\\).`,
    `The initial line is \\(${dataLatex}\\).`,
    transverse ? '' : 'The initial line is not transverse.',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    exact: true,
    formulaLatex: speedLatex,
    generalLatex: speedLatex,
    evaluate,
    curves,
    dataCurve: samples(domain.x[0], domain.x[1], 24).map((x) => ({ x, t: data.t0, u: data.g(x) })),
    objects,
    notes: [
      { id: 'ode', title: 'Characteristic ODE', latex: speedLatex },
      { id: 'data', title: 'Initial line', latex: dataLatex },
      ...(transverse
        ? []
        : [{ id: 'transverse', title: 'Not transverse', latex: 'The initial line is not transverse.' }]),
    ],
    workedLatex: worked,
    features: [],
    warnings: transverse ? [] : ['The initial line is not transverse.'],
    transversalityLatex: transverse ? speedLatex : 'The initial line is not transverse.',
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
  };
}

function valueAt(x: number, tau: number, data: Cauchy, speed: Scalar, b: Scalar, c: Scalar, d: Scalar): number {
  if (Math.abs(tau - data.t0) < 1e-10) return data.g(x);
  const xi = marchX(x, tau, data.t0, speed);
  if (!Number.isFinite(xi)) return Number.NaN;
  const end = march(xi, data.g(xi), data.t0, tau, speed, b, c, d, 1);
  return end[end.length - 1]?.u ?? Number.NaN;
}

function trajectory(x0: number, data: Cauchy, t1: number, speed: Scalar, b: Scalar, c: Scalar, d: Scalar): Array<{ x: number; t: number; u: number }> {
  return march(x0, data.g(x0), data.t0, t1, speed, b, c, d, 16);
}

/** Midpoint step of dx/dτ = speed and du/dτ = (d − c u) / b. One pass, no nested integrals. */
function march(
  x0: number,
  u0: number,
  t0: number,
  t1: number,
  speed: Scalar,
  b: Scalar,
  c: Scalar,
  d: Scalar,
  keep: number,
): Array<{ x: number; t: number; u: number }> {
  const steps = 240;
  const h = (t1 - t0) / steps;
  const points: Array<{ x: number; t: number; u: number }> = [{ x: x0, t: t0, u: u0 }];
  if (h === 0) return points;
  let x = x0;
  let u = u0;
  let t = t0;
  const stride = Math.max(1, Math.floor(steps / keep));
  for (let i = 1; i <= steps; i += 1) {
    const next = step(x, u, t, h, speed, b, c, d);
    if (!next) return points;
    x = next.x;
    u = next.u;
    t += h;
    if (i % stride === 0 || i === steps) points.push({ x, t, u });
  }
  return points;
}

function marchX(x0: number, t0: number, t1: number, speed: Scalar): number {
  const steps = 240;
  const h = (t1 - t0) / steps;
  let x = x0;
  let t = t0;
  for (let i = 0; i < steps; i += 1) {
    const k1 = speed(x, t);
    if (!Number.isFinite(k1)) return Number.NaN;
    const k2 = speed(x + 0.5 * h * k1, t + 0.5 * h);
    if (!Number.isFinite(k2)) return Number.NaN;
    x += h * k2;
    t += h;
    if (!Number.isFinite(x) || Math.abs(x) > 1e6) return Number.NaN;
  }
  return x;
}

function step(
  x: number,
  u: number,
  t: number,
  h: number,
  speed: Scalar,
  b: Scalar,
  c: Scalar,
  d: Scalar,
): { x: number; u: number } | null {
  const rate = (xx: number, uu: number, s: number) => {
    const bb = b(xx, s);
    if (!Number.isFinite(bb) || Math.abs(bb) < 1e-10) return null;
    const slope = speed(xx, s);
    const grew = (d(xx, s) - c(xx, s) * uu) / bb;
    if (!Number.isFinite(slope) || !Number.isFinite(grew)) return null;
    return { slope, grew };
  };
  const first = rate(x, u, t);
  if (!first) return null;
  const mid = rate(x + 0.5 * h * first.slope, u + 0.5 * h * first.grew, t + 0.5 * h);
  if (!mid) return null;
  const nextX = x + h * mid.slope;
  const nextU = u + h * mid.grew;
  if (!Number.isFinite(nextX) || !Number.isFinite(nextU) || Math.abs(nextU) > 1e6) return null;
  return { x: nextX, u: nextU };
}

function stable(evaluate: (x: number, tau: number) => number, data: Cauchy): boolean {
  const probes = [0.3, -0.4, 1.1];
  for (const x of probes) {
    const back = evaluate(x, data.t0);
    if (!Number.isFinite(back) || Math.abs(back - data.g(x)) > 1e-2 * (1 + Math.abs(data.g(x)))) return false;
    const later = evaluate(x, data.t0 + 0.35);
    if (!Number.isFinite(later)) return false;
  }
  return true;
}

function readCauchy(problem: CharProblem, params: Record<string, number>): Cauchy {
  const data = problem.data;
  if (data.kind !== 'cauchy') return { g: () => 0, gExpr: '0', t0: 0 };
  const fn = compileMath(data.gExpr, ['x', 't', 'y']);
  const t0 = constantOf(data.timeExpr, params) ?? 0;
  return {
    gExpr: data.gExpr,
    t0,
    g: (x) => {
      const value = fn({ ...params, x, t: t0, y: t0 });
      return Number.isFinite(value) ? value : 0;
    },
  };
}

function compileCoeff(expr: string, params: Record<string, number>, vars: CharProblem['vars']): Scalar {
  try {
    const fn = compileMath(expr, ['x', 't', 'y', 'u', 'U', 'UX', 'UY', 'UT']);
    return (x, tau) => {
      try {
        const value = fn({ ...params, x, t: vars === 'xy' ? 0 : tau, y: vars === 'xy' ? tau : 0, u: 0, U: 0, UX: 0, UY: 0, UT: 0 });
        return Number.isFinite(value) ? value : Number.NaN;
      } catch {
        return Number.NaN;
      }
    };
  } catch {
    return () => Number.NaN;
  }
}

function windowFor(problem: CharProblem, data: Cauchy): { x: [number, number]; t: [number, number] } {
  return cauchyWindow(problem, data.t0, data.gExpr);
}

function feet(domain: { x: [number, number] }, data: Cauchy): number[] {
  return linspace(domain.x[0], domain.x[1], 9).filter((x) => Number.isFinite(data.g(x)));
}

function samples(start: number, end: number, count: number): number[] {
  return linspace(start, end, count);
}

function linspace(start: number, end: number, count: number): number[] {
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

function tex(expr: string): string {
  try {
    return exprToLatex(expr);
  } catch {
    return expr;
  }
}

function texNum(value: number): string {
  return prettyTex(value);
}
