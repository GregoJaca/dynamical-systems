/**
 * One symbolic pass for a linear characteristic problem: the concrete ODE,
 * and a closed form when polynomials, exponentials, and their products integrate.
 * The picture keeps the numerical evaluate already built by the solver.
 */

import { derivative, parse, rationalize, simplify, type MathNode } from 'mathjs';
import { compileMath, exprToLatex, mentions } from '../expr';
import type { CharProblem, NoteBlock, PdeObject } from '../types';
import type { BuiltChar } from './solveChar';

const RULES = [
  { l: 'exp(log(n))', r: 'n' },
  { l: 'exp(-log(n))', r: '1/n' },
  { l: 'exp(-(log(n)))', r: '1/n' },
  { l: 'log(exp(n))', r: 'n' },
  { l: 'log(1)', r: '0' },
  { l: 'exp(0)', r: '1' },
  { l: 'exp(n1)*exp(n2)', r: 'exp(n1+n2)' },
  { l: 'exp(n1)*n2', r: 'n2*exp(n1)' },
  { l: 'n/n', r: '1' },
  { l: 'n*1', r: 'n' },
  { l: '1*n', r: 'n' },
  { l: 'n+0', r: 'n' },
  { l: '0+n', r: 'n' },
];

interface OpNode extends MathNode {
  op: string;
  args: MathNode[];
}

interface Term {
  sign: 1 | -1;
  expr: string;
}

interface Geometry {
  foot: string;
  xAlong: string;
}

interface IntegralForm {
  gFoot: string;
  lambda: string;
  integrand: string;
}

export function prettyTex(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude < 1e-12) return '0';
  const inPi = magnitude / Math.PI;
  for (const den of [1, 2, 3, 4, 6]) {
    const num = Math.round(inPi * den);
    if (num !== 0 && Math.abs(inPi - num / den) < 1e-8) {
      const divisor = gcd(num, den);
      const n = num / divisor;
      const d = den / divisor;
      const body = d === 1 ? (n === 1 ? '\\pi' : `${n}\\pi`) : `\\frac{${n}}{${d}}\\pi`;
      return sign + body;
    }
  }
  const nearest = Math.round(magnitude);
  if (Math.abs(magnitude - nearest) < 1e-8) return sign + String(nearest);
  for (let den = 2; den <= 12; den += 1) {
    const num = Math.round(magnitude * den);
    if (Math.abs(magnitude - num / den) < 1e-8) {
      const divisor = gcd(num, den);
      return `${sign}\\frac{${num / divisor}}{${den / divisor}}`;
    }
  }
  return sign + String(Math.round(magnitude * 1e6) / 1e6);
}

export function cauchyWindow(problem: CharProblem, t0: number, gExpr: string): { x: [number, number]; t: [number, number] } {
  const tau = problem.vars === 'xy' ? 'y' : 't';
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (const line of problem.lines) {
    const match = line.trim().match(/^([xyt])\s*(>=|<=|>|<)\s*(.+)$/i);
    if (!match || match[1] !== tau) continue;
    const value = boundValue(match[3] ?? '');
    if (value === null) continue;
    if (match[2] === '>' || match[2] === '>=') lower = Math.max(lower, value);
    else upper = Math.min(upper, value);
  }
  let tLo = t0;
  let tHi = t0 + 2;
  if (Number.isFinite(lower)) tLo = Math.max(tLo, lower);
  if (Number.isFinite(upper)) tHi = Math.min(tHi, upper);
  if (!(tHi - tLo > 0.5)) {
    const onUpper = Number.isFinite(upper) && Math.abs(upper - t0) < 1e-8;
    const onLower = Number.isFinite(lower) && Math.abs(lower - t0) < 1e-8;
    if (onUpper) {
      tHi = t0;
      tLo = t0 - 2;
    } else if (onLower) {
      tLo = t0;
      tHi = t0 + 2;
    } else if (Number.isFinite(upper)) {
      tHi = Math.min(t0, upper);
      tLo = tHi - 2;
    } else {
      tLo = t0;
      tHi = t0 + 2;
    }
  }
  const trig = /(^|[^a-zA-Z])(sin|cos|tan)([^a-zA-Z]|$)/.test(gExpr);
  const x: [number, number] = trig ? [-Math.PI, Math.PI] : [-2, 2];
  return { x, t: [tLo, tHi] };
}

export function applyFace(problem: CharProblem, built: BuiltChar, paramsIn: Record<string, number>): BuiltChar {
  if (problem.data.kind !== 'cauchy') return built;
  const params = { pi: Math.PI, e: Math.E, ...paramsIn };
  const tau = problem.vars === 'xy' ? 'y' : 't';
  const t0 = readTime(problem, params);
  const g = bind(problem.data.gExpr, params);
  const ode = characteristicOde(problem, params, tau);
  const dataLine = `u(x,${prettyTex(t0)})=${expressionTex(g)}`;
  const transverse = isTransverse(problem, params, t0);
  let solution: string | null = null;
  let math: string | null = null;
  if (!problem.quasilinear && !blocked(problem)) {
    try {
      const found = closedForm(problem, built, params, tau, t0, g);
      solution = found?.tex ?? null;
      math = found?.math ?? null;
    } catch {
      solution = null;
      math = null;
    }
  }
  if (!solution && transverse && existingFormula(built.formulaLatex)) solution = built.formulaLatex;
  const formulaLatex = solution ?? ode;
  const objects: PdeObject[] = [
    { id: 'characteristics', label: 'Characteristics', formulaLatex: ode, group: 'characteristic', defaultOn: true },
  ];
  if (solution) objects.push({ id: 'solution', label: 'Solution', formulaLatex: solution, group: 'field', defaultOn: true });
  objects.push({ id: 'data', label: 'Initial line', formulaLatex: dataLine, group: 'boundary', defaultOn: true });
  for (const object of built.objects) {
    if (object.id === 'characteristics' || object.id === 'data' || object.id === 'solution') continue;
    objects.push(object);
  }
  const notes: NoteBlock[] = [
    { id: 'ode', title: 'Characteristic ODE', latex: ode },
    ...(solution ? [{ id: 'solution', title: 'Solution', latex: solution }] : []),
    { id: 'data', title: 'Initial line', latex: dataLine },
  ];
  const worked = [
    problem.equationLatex,
    `The characteristic ODE is \\(${ode}\\).`,
    solution ? `The solution is \\(${solution}\\).` : '',
    `The initial line is \\(${dataLine}\\).`,
    transverse ? '' : 'The initial line is not transverse.',
  ]
    .filter(Boolean)
    .join(' ');
  const warnings = built.warnings.filter((warning) => !/foot|p\(t\)|numerically|RK45/i.test(warning) && !(transverse && /transverse/i.test(warning)));
  if (!transverse && !warnings.some((warning) => /transverse/i.test(warning))) {
    warnings.push('The initial line is not transverse.');
  }
  const evaluate = math ? exactEvaluate(math, params, tau, built.evaluate) : built.evaluate;
  return {
    ...built,
    evaluate,
    fastField: Boolean(math),
    formulaLatex,
    generalLatex: formulaLatex,
    objects,
    notes,
    workedLatex: worked,
    transversalityLatex: transverse ? ode : 'The initial line is not transverse.',
    warnings,
  };
}

function closedForm(
  problem: CharProblem,
  built: BuiltChar,
  params: Record<string, number>,
  tau: string,
  t0: number,
  g: string,
): { tex: string; math?: string } | null {
  const a = bind(problem.aExpr, params);
  const b = bind(problem.bExpr, params);
  const c = bind(problem.cExpr, params);
  const d = bind(problem.dExpr, params);
  if (isZero(b) || blockedExpr(a) || blockedExpr(b) || blockedExpr(c) || blockedExpr(d)) return null;
  const speed = rewrite(`(${a})/(${b})`);
  if (depends(speed, 'u') || speed.length > 400) return null;
  const t0s = numberToMath(t0);
  const geom = geometry(speed, tau, t0s, t0, params);
  if (!geom) return null;
  const form = transport(b, c, d, g, tau, t0s, geom);
  if (!form) return null;
  if (form.math) {
    let shown = rewrite(form.math);
    if (shown.length < 180 && shown.includes('exp')) {
      try {
        const expanded = rewrite(expandToSum(shown));
        if (!depends(expanded, 'xi') && !depends(expanded, 's')) shown = expanded;
      } catch {
        /* the compact form is already usable */
      }
    }
    if (depends(shown, 'xi') || depends(shown, 's') || shown.length > 650) return null;
    const tex = `u=${expressionTex(shown)}`;
    return matches(shown, built.evaluate, built, t0, tau, params) ? { tex, math: shown } : null;
  }
  if (!form.integral) return null;
  if (!matchesIntegral(form.integral, built.evaluate, built, t0, tau, params)) return null;
  return { tex: integralTex(form.integral, tau, t0) };
}

function exactEvaluate(
  math: string,
  params: Record<string, number>,
  tau: string,
  fallback: (x: number, tau: number) => number,
): (x: number, tau: number) => number {
  let fn: ((scope: Record<string, number>) => number) | null = null;
  try {
    fn = compileMath(math, ['x', 't', 'y']);
  } catch {
    fn = null;
  }
  if (!fn) return fallback;
  const compiled = fn;
  return (x, tauValue) => {
    try {
      const value = compiled(scopeAt(params, x, tauValue, tau));
      return Number.isFinite(value) ? value : Number.NaN;
    } catch {
      return fallback(x, tauValue);
    }
  };
}

function geometry(speed: string, tau: string, t0s: string, t0: number, params: Record<string, number>): Geometry | null {
  let slope = '';
  try {
    slope = simplify(derivative(speed, 'x')).toString();
  } catch {
    return null;
  }
  if (!depends(slope, 'x')) {
    const rest = rewrite(`(${speed})-(${slope})*x`);
    if (depends(rest, 'x')) return null;
    return affineGeometry(slope, rest, tau, t0s);
  }
  return productGeometry(speed, tau, t0s, t0, params);
}

function affineGeometry(slope: string, rest: string, tau: string, t0s: string): Geometry | null {
  const pS = substitute(slope, tau, 's');
  const qS = substitute(rest, tau, 's');
  const gained = isZero(pS) ? '0' : integralFrom(pS, 's', t0s);
  if (gained === null) return null;
  let carried = '0';
  if (!isZero(qS)) {
    const integrand = rewrite(`(${qS})*exp(-(${gained}))`);
    const piece = integralFrom(integrand, 's', t0s);
    if (piece === null) return null;
    carried = piece;
  }
  const atTau = substitute(gained, 's', tau);
  const carriedTau = substitute(carried, 's', tau);
  const foot = rewrite(`x*exp(-(${atTau}))-(${carriedTau})`);
  const xAlong = rewrite(`exp(${gained})*(xi+(${carried}))`);
  if (foot.length > 420 || xAlong.length > 420) return null;
  return { foot, xAlong };
}

function productGeometry(speed: string, tau: string, t0s: string, t0: number, params: Record<string, number>): Geometry | null {
  const split = splitSpeed(speed, tau);
  if (!split) return null;
  const inv = rewrite(`1/(${split.h})`);
  const potential = antiderivative(inv, 'x');
  if (!potential) return null;
  try {
    const back = simplify(derivative(potential, 'x')).toString();
    if (!isZero(`(${back})-(${inv})`)) return null;
  } catch {
    return null;
  }
  const clock = antiderivative(split.f, tau);
  if (!clock) return null;
  const delta = rewrite(`(${clock})-(${substitute(clock, tau, `(${t0s})`)})`);
  const rhs = rewrite(`(${potential})-(${delta})`);
  const degree = polynomialDerivatives(potential, 'x');
  if (degree && degree.length > 2) return null;
  const foot = invertPotential(potential, rhs, tau, t0, params, 'x');
  if (!foot) return null;
  const deltaS = rewrite(`(${substitute(clock, tau, 's')})-(${substitute(clock, tau, `(${t0s})`)})`);
  const rhsS = rewrite(`(${substitute(potential, 'x', 'xi')})+(${deltaS})`);
  const xAlong = invertPotential(potential, rhsS, 's', t0, params, 'xi');
  if (!xAlong) return null;
  const geometryFoot = rewrite(foot);
  const geometryAlong = rewrite(xAlong);
  if (geometryFoot.length > 420 || geometryAlong.length > 420) return null;
  return { foot: geometryFoot, xAlong: geometryAlong };
}

function invertPotential(
  potential: string,
  rhs: string,
  free: string,
  t0: number,
  params: Record<string, number>,
  expect: 'x' | 'xi',
): string | null {
  const coeffs = polynomialDerivatives(potential, 'x');
  if (coeffs && coeffs.length <= 3) {
    const a0 = taylor(coeffs, 0);
    const a1 = taylor(coeffs, 1);
    const a2 = coeffs.length > 2 ? taylor(coeffs, 2) : '0';
    if (isZero(a2)) {
      if (isZero(a1)) return null;
      const solved = rewrite(`((${rhs})-(${a0}))/(${a1})`);
      return recovers(solved, free, t0, params, expect) ? solved : null;
    }
    const disc = polish(`(${a1})^2-4*(${a2})*((${a0})-(${rhs}))`);
    const plus = polish(`((-(${a1}))+sqrt(${disc}))/(2*(${a2}))`);
    const minus = polish(`((-(${a1}))-sqrt(${disc}))/(2*(${a2}))`);
    return pickRoot([plus, minus], free, t0, params, expect);
  }
  const logged = logPotential(potential);
  if (!logged) return null;
  const solved = rewrite(`(exp((${rhs})/(${logged.coeff}))-(${logged.b}))/(${logged.a})`);
  return recovers(solved, free, t0, params, expect) ? solved : null;
}

function transport(b: string, c: string, d: string, g: string, tau: string, t0s: string, geom: Geometry): { math?: string; integral?: IntegralForm } | null {
  if (isZero(c) && isZero(d)) return { math: rewrite(substitute(g, 'x', geom.foot)) };
  const beta0 = rewrite(`(${c})/(${b})`);
  const alpha0 = rewrite(`(${d})/(${b})`);
  const beta = rewrite(substitute(substitute(beta0, 'x', geom.xAlong), tau, 's'));
  const alpha = rewrite(substitute(substitute(alpha0, 'x', geom.xAlong), tau, 's'));
  if (beta.length > 420 || alpha.length > 420) return null;
  const lambdaS = isZero(beta) ? '0' : integralFrom(beta, 's', t0s);
  if (lambdaS === null) return null;
  const gXi = substitute(g, 'x', 'xi');
  const weight = isZero(alpha) ? '0' : rewrite(`(${alpha})*exp(${lambdaS})`);
  const accumulated = isZero(weight) ? '0' : integralFrom(weight, 's', t0s);
  const lambdaT = substitute(lambdaS, 's', tau);
  if (accumulated !== null) {
    const accumulatedTau = substitute(accumulated, 's', tau);
    const along = rewrite(`((${gXi})+(${accumulatedTau}))*exp(-(${lambdaT}))`);
    const math = rewrite(substitute(along, 'xi', geom.foot));
    if (!depends(math, 'xi') && !depends(math, 's') && math.length < 1500) return { math };
  }
  const gFoot = rewrite(substitute(gXi, 'xi', geom.foot));
  const lambda = rewrite(substitute(lambdaT, 'xi', geom.foot));
  const integrand = rewrite(substitute(weight, 'xi', geom.foot));
  if ([gFoot, lambda].some((part) => depends(part, 'xi') || depends(part, 's'))) return null;
  if (depends(integrand, 'xi')) return null;
  if (integrand.length > 320 || gFoot.length > 320 || lambda.length > 320) return null;
  return { integral: { gFoot, lambda, integrand } };
}

function matches(
  math: string,
  evaluate: (x: number, tau: number) => number,
  built: BuiltChar,
  t0: number,
  tau: string,
  params: Record<string, number>,
): boolean {
  let fn: (scope: Record<string, number>) => number;
  try {
    fn = compileMath(math, ['x', 't', 'y']);
  } catch {
    return false;
  }
  let agreed = 0;
  for (const point of probes(built, t0)) {
    const numeric = evaluate(point.x, point.t);
    let symbolic = Number.NaN;
    try {
      symbolic = fn(scopeAt(params, point.x, point.t, tau));
    } catch {
      return false;
    }
    if (!Number.isFinite(numeric) && !Number.isFinite(symbolic)) continue;
    if (!agrees(symbolic, numeric)) return false;
    agreed += 1;
  }
  return agreed >= 4;
}

function matchesIntegral(
  form: IntegralForm,
  evaluate: (x: number, tau: number) => number,
  built: BuiltChar,
  t0: number,
  tau: string,
  params: Record<string, number>,
): boolean {
  let agreed = 0;
  for (const point of probes(built, t0)) {
    const numeric = evaluate(point.x, point.t);
    const symbolic = evalIntegral(form, point.x, point.t, t0, tau, params);
    if (!Number.isFinite(numeric) && !Number.isFinite(symbolic)) continue;
    if (!agrees(symbolic, numeric)) return false;
    agreed += 1;
  }
  return agreed >= 4;
}

function evalIntegral(form: IntegralForm, x: number, tauVal: number, t0: number, tau: string, params: Record<string, number>): number {
  try {
    const scope = scopeAt(params, x, tauVal, tau);
    const profile = compileMath(form.gFoot, ['x', 't', 'y'])(scope);
    const decay = isZero(form.lambda) ? 0 : compileMath(form.lambda, ['x', 't', 'y'])(scope);
    let area = 0;
    if (!isZero(form.integrand)) {
      const fn = compileMath(form.integrand, ['x', 't', 'y', 's']);
      const steps = 40;
      const h = (tauVal - t0) / steps;
      if (h !== 0) {
        for (let i = 0; i <= steps; i += 1) {
          const weight = i === 0 || i === steps ? 1 : i % 2 === 0 ? 2 : 4;
          area += weight * fn({ ...scope, s: t0 + i * h });
        }
        area *= h / 3;
      }
    }
    if (![profile, decay, area].every(Number.isFinite)) return Number.NaN;
    return Math.exp(-decay) * (profile + area);
  } catch {
    return Number.NaN;
  }
}

function probes(built: BuiltChar, t0: number): Array<{ x: number; t: number }> {
  const [x0, x1] = built.domainX;
  const xs = [0.42, 0.62, 0.8].map((frac) => x0 + (x1 - x0) * frac);
  const span = built.domainT[1] - t0;
  const later = t0 + Math.min(0.4, Math.max(0.2, 0.35 * Math.abs(span) || 0.4)) * Math.sign(span || 1);
  return xs.flatMap((x) => [t0, later].map((t) => ({ x, t })));
}

function scopeAt(params: Record<string, number>, x: number, tauVal: number, tau: string): Record<string, number> {
  return { ...params, x, t: tau === 't' ? tauVal : 0, y: tau === 'y' ? tauVal : 0, pi: Math.PI, e: Math.E };
}

function agrees(symbolic: number, numeric: number): boolean {
  return Number.isFinite(symbolic) && Number.isFinite(numeric) && Math.abs(symbolic - numeric) <= 5e-3 * (1 + Math.abs(numeric));
}

function integralTex(form: IntegralForm, tau: string, t0: number): string {
  const profile = isZero(form.gFoot) ? '' : expressionTex(form.gFoot);
  const integrand = expressionTex(form.integrand, ['s']);
  const integral = `\\int_{${prettyTex(t0)}}^{${tau}} ${integrand}\\,ds`;
  const body = !profile ? integral : isZero(form.integrand) ? profile : `${profile}+${integral}`;
  if (isZero(form.lambda)) return `u=${body}`;
  return `u=\\exp\\left(-\\left(${expressionTex(form.lambda)}\\right)\\right)\\left(${body}\\right)`;
}

export function characteristicOde(problem: CharProblem, params: Record<string, number>, tau: string): string {
  const a = bind(problem.aExpr, params);
  const b = bind(problem.bExpr, params);
  if (isZero(b)) {
    const d = bind(problem.dExpr, params);
    return `${expressionTex(a)}\\,u_x=${expressionTex(d)}`;
  }
  try {
    const speed = rewrite(`(${a})/(${b})`);
    if (!depends(speed, 'u') && speed.length < 240) return `\\frac{dx}{d${tau}}=${expressionTex(speed)}`;
  } catch {
    /* fall through to the quotient of the two coefficients */
  }
  return `\\frac{dx}{d${tau}}=\\frac{${expressionTex(a)}}{${expressionTex(b)}}`;
}

function existingFormula(formula: string): boolean {
  const text = formula.trim();
  if (!/^u\b/.test(text)) return false;
  return !/foot|p\(|q\(|\\xi|\\mu|Solution along/i.test(text);
}

function isTransverse(problem: CharProblem, params: Record<string, number>, t0: number): boolean {
  try {
    const coeff = compileMath(problem.bExpr, ['x', 't', 'y', 'u']);
    const tau = problem.vars === 'xy' ? 'y' : 't';
    for (const x of [-1, -0.25, 0.4, 1]) {
      const value = coeff(scopeAt(params, x, t0, tau));
      if (Number.isFinite(value) && Math.abs(value) > 1e-8) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function blocked(problem: CharProblem): boolean {
  return [problem.aExpr, problem.bExpr, problem.cExpr, problem.dExpr].some(blockedExpr);
}

function blockedExpr(expr: string): boolean {
  return ['u', 'U', 'UX', 'UY', 'UT'].some((name) => mentions(expr, name));
}

function readTime(problem: CharProblem, params: Record<string, number>): number {
  if (problem.data.kind !== 'cauchy') return 0;
  try {
    const value = compileMath(problem.data.timeExpr, [])(params);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function splitSpeed(speed: string, tau: string): { f: string; h: string } | null {
  let node: MathNode;
  try {
    node = unwrap(parse(rewrite(speed)));
  } catch {
    return null;
  }
  const factors = flattenFactors(node);
  const alongX: Array<{ invert: boolean; expr: string }> = [];
  const alongT: Array<{ invert: boolean; expr: string }> = [];
  for (const factor of factors) {
    const onX = depends(factor.expr, 'x');
    const onT = depends(factor.expr, tau);
    if (onX && onT) return null;
    if (onX) alongX.push(factor);
    else alongT.push(factor);
  }
  if (alongX.length === 0) return null;
  return { h: productString(alongX), f: productString(alongT) };
}

function logPotential(potential: string): { coeff: string; a: string; b: string } | null {
  const node = unwrap(parse(rewrite(potential)));
  const name = fnName(node);
  if (name === 'log') {
    const inside = linearOf(argsOf(node)[0]?.toString() ?? '', 'x');
    if (!inside || isZero(inside.a)) return null;
    return { coeff: '1', a: inside.a, b: inside.b };
  }
  const factors = flattenFactors(node);
  const logs = factors.filter((factor) => !factor.invert && fnName(unwrap(parse(factor.expr))) === 'log');
  if (logs.length !== 1) return null;
  const coeff = productString(factors.filter((factor) => factor !== logs[0]));
  if (depends(coeff, 'x')) return null;
  const inside = linearOf(argsOf(unwrap(parse(logs[0]!.expr)))[0]?.toString() ?? '', 'x');
  if (!inside || isZero(inside.a)) return null;
  return { coeff, a: inside.a, b: inside.b };
}

function pickRoot(candidates: string[], free: string, t0: number, params: Record<string, number>, expect: 'x' | 'xi'): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = recoveryError(candidate, free, t0, params, expect);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best !== null && bestScore < 5e-2 ? best : null;
}

function recovers(expr: string, free: string, t0: number, params: Record<string, number>, expect: 'x' | 'xi'): boolean {
  return recoveryError(expr, free, t0, params, expect) < 5e-2;
}

function recoveryError(expr: string, free: string, t0: number, params: Record<string, number>, expect: 'x' | 'xi'): number {
  let fn: (scope: Record<string, number>) => number;
  try {
    fn = compileMath(expr, ['x', 't', 'y', 's', 'xi']);
  } catch {
    return Infinity;
  }
  const samples = expect === 'x' ? [0.7, -0.4, 1.4] : [0.7, -0.4, 1.4];
  let error = 0;
  for (const value of samples) {
    const scope: Record<string, number> = {
      ...params,
      x: expect === 'x' ? value : 0.3,
      xi: value,
      s: t0,
      t: free === 'y' ? 0 : t0,
      y: free === 'y' ? t0 : 0,
      pi: Math.PI,
      e: Math.E,
    };
    scope[free] = t0;
    let got = Number.NaN;
    try {
      got = fn(scope);
    } catch {
      return Infinity;
    }
    if (!Number.isFinite(got)) return Infinity;
    error += Math.abs(got - value);
  }
  return error;
}

function integralFrom(integrand: string, variable: string, lower: string): string | null {
  if (isZero(integrand)) return '0';
  const primitive = antiderivative(integrand, variable);
  if (primitive === null) return null;
  try {
    const upper = rewrite(primitive);
    const lowerValue = rewrite(substitute(primitive, variable, `(${lower})`));
    if (isZero(lowerValue)) return upper;
    return rewrite(`(${upper})-(${lowerValue})`);
  } catch {
    return null;
  }
}

function antiderivative(expr: string, variable: string): string | null {
  if (expr.length > 240) return null;
  let expanded = expr;
  try {
    expanded = expandToSum(rewrite(expr));
  } catch {
    return null;
  }
  if (expanded.length > 1600) return null;
  return integrateSum(expanded, variable, 0);
}

function integrateSum(expr: string, variable: string, depth: number): string | null {
  if (depth > 10 || expr.length > 1600) return null;
  const node = unwrap(parse(expr));
  if (isSum(node)) {
    const parts: string[] = [];
    for (const term of sumTerms(node)) {
      const inner = integrateSum(term.expr, variable, depth + 1);
      if (inner === null) return null;
      parts.push(term.sign < 0 ? `-(${inner})` : `(${inner})`);
    }
    return rewrite(parts.join('+') || '0');
  }
  const direct = integrateTerm(rewrite(expr), variable);
  return direct === null ? null : rewrite(direct);
}

function integrateTerm(expr: string, variable: string): string | null {
  if (isZero(expr)) return '0';
  let node: MathNode;
  try {
    node = unwrap(parse(expr));
  } catch {
    return null;
  }
  const unary = asOp(node);
  if (unary?.op === '-' && unary.args.length === 1) {
    const inner = integrateTerm(unary.args[0]!.toString(), variable);
    return inner === null ? null : `-(${inner})`;
  }
  if (!hasSpecial(expr) && !expr.includes('/')) {
    const polynomial = polynomialIntegral(expr, variable);
    if (polynomial !== null) return polynomial;
  }
  const powered = powerIntegral(expr, variable);
  if (powered) return powered;
  const quotient = quotientIntegral(expr, variable);
  if (quotient) return quotient;
  const rooted = sqrtIntegral(expr, variable);
  if (rooted) return rooted;
  return productIntegral(expr, variable);
}

function polynomialIntegral(expr: string, variable: string): string | null {
  const derivs = polynomialDerivatives(expr, variable);
  if (!derivs) return null;
  const terms: string[] = [];
  for (let k = 0; k < derivs.length; k += 1) {
    const coeff = taylor(derivs, k);
    if (isZero(coeff)) continue;
    terms.push(`(${coeff})*(${variable}^${k + 1})/${k + 1}`);
  }
  return terms.length === 0 ? '0' : terms.join('+');
}

function polynomialDerivatives(expr: string, variable: string): string[] | null {
  if (hasSpecial(expr) || expr.length > 300) return null;
  const derivs: string[] = [];
  let current = expr;
  for (let k = 0; k <= 6; k += 1) {
    let at = current;
    try {
      at = simplify(substitute(current, variable, '0')).toString();
    } catch {
      return null;
    }
    if (depends(at, variable) || at.length > 240) return null;
    derivs.push(at);
    let next = '0';
    try {
      next = simplify(derivative(current, variable)).toString();
    } catch {
      return null;
    }
    if (isZero(next)) return derivs;
    if (next.length > 400) return null;
    current = next;
  }
  return null;
}

function taylor(derivs: string[], k: number): string {
  const raw = derivs[k] ?? '0';
  let fact = 1;
  for (let i = 1; i <= k; i += 1) fact *= i;
  if (fact === 1) return raw;
  return rewrite(`(${raw})/${fact}`);
}

function powerIntegral(expr: string, variable: string): string | null {
  const node = unwrap(parse(expr));
  const op = asOp(node);
  if (!op || op.op !== '^') return null;
  const base = op.args[0]?.toString() ?? '';
  const exp = op.args[1]?.toString() ?? '';
  if (depends(exp, variable)) return null;
  const linear = linearOf(base, variable);
  if (!linear || isZero(linear.a)) return null;
  if (isNegOne(exp)) return `(1/(${linear.a}))*log(${base})`;
  return `((${base})^((${exp})+1))/(((${exp})+1)*(${linear.a}))`;
}

function quotientIntegral(expr: string, variable: string): string | null {
  const op = asOp(unwrap(parse(expr)));
  if (!op || op.op !== '/') return null;
  const numerator = op.args[0]?.toString() ?? '';
  const denominator = op.args[1]?.toString() ?? '';
  if (fnName(unwrap(parse(denominator))) === 'sqrt') return sqrtIntegral(expr, variable);
  if (depends(denominator, variable)) {
    const linear = linearOf(denominator, variable);
    const coeffs = polynomialDerivatives(numerator, variable);
    if (linear && !isZero(linear.a) && coeffs && coeffs.length === 1) {
      return `((${coeffs[0]})/(${linear.a}))*log(${denominator})`;
    }
    return null;
  }
  const inner = integrateTerm(numerator, variable);
  if (inner === null || isZero(denominator)) return null;
  return `(${inner})/(${denominator})`;
}

function sqrtIntegral(expr: string, variable: string): string | null {
  if (expr.length > 100) return null;
  const node = unwrap(parse(expr));
  const name = fnName(node);
  if (name === 'sqrt') {
    const quad = evenQuadratic(argsOf(node)[0]?.toString() ?? '', variable);
    return quad ? sqrtPrimitive(quad, variable) : null;
  }
  const op = asOp(node);
  if (!op || op.op !== '/') return null;
  const denominator = unwrap(parse(op.args[1]?.toString() ?? ''));
  if (fnName(denominator) !== 'sqrt') return null;
  const quad = evenQuadratic(argsOf(denominator)[0]?.toString() ?? '', variable);
  if (!quad) return null;
  const coeffs = polynomialDerivatives(op.args[0]?.toString() ?? '', variable);
  if (!coeffs || coeffs.length > 3) return null;
  const p0 = taylor(coeffs, 0);
  const p1 = coeffs.length > 1 ? taylor(coeffs, 1) : '0';
  const p2 = coeffs.length > 2 ? taylor(coeffs, 2) : '0';
  const parts: string[] = [];
  if (!isZero(p0)) parts.push(`(${p0})*(${reciprocalSqrt(quad, variable)})`);
  if (!isZero(p1)) parts.push(`(${p1})*(${linearOverSqrt(quad, variable)})`);
  if (!isZero(p2)) parts.push(`(${p2})*(${squareOverSqrt(quad, variable)})`);
  return parts.length === 0 ? '0' : parts.join('+');
}

interface Quad {
  A: string;
  B: string;
}

function evenQuadratic(expr: string, variable: string): Quad | null {
  try {
    const d1 = simplify(derivative(expr, variable)).toString();
    const d2 = simplify(derivative(d1, variable)).toString();
    const d3 = simplify(derivative(d2, variable)).toString();
    if (!isZero(d3)) return null;
    if (!isZero(simplify(substitute(d1, variable, '0')).toString())) return null;
    const B = simplify(`(${substitute(d2, variable, '0')})/2`).toString();
    const A = simplify(substitute(expr, variable, '0')).toString();
    if (isZero(B) || depends(A, variable) || depends(B, variable)) return null;
    return { A, B };
  } catch {
    return null;
  }
}

function radical(quad: Quad, variable: string): string {
  return `sqrt((${quad.A})+(${quad.B})*(${variable})^2)`;
}

function logPair(quad: Quad, variable: string): string {
  return `log((${variable})*sqrt(${quad.B})+${radical(quad, variable)})`;
}

function reciprocalSqrt(quad: Quad, variable: string): string {
  return `(${logPair(quad, variable)})/sqrt(${quad.B})`;
}

function sqrtPrimitive(quad: Quad, variable: string): string {
  return `(${variable})/2*${radical(quad, variable)}+(${quad.A})/(2*sqrt(${quad.B}))*(${logPair(quad, variable)})`;
}

function linearOverSqrt(quad: Quad, variable: string): string {
  return `(${radical(quad, variable)})/(${quad.B})`;
}

function squareOverSqrt(quad: Quad, variable: string): string {
  return `(1/(${quad.B}))*(${sqrtPrimitive(quad, variable)})-((${quad.A})/(${quad.B}))*(${reciprocalSqrt(quad, variable)})`;
}

function productIntegral(expr: string, variable: string): string | null {
  const factors = flattenFactors(unwrap(parse(expr)));
  let expArg: string | null = null;
  let trig: { kind: 'sin' | 'cos'; arg: string } | null = null;
  const rest: Array<{ invert: boolean; expr: string }> = [];
  for (const factor of factors) {
    const node = unwrap(parse(factor.expr));
    const name = fnName(node);
    if (!factor.invert && (name === 'exp' || name === 'sin' || name === 'cos')) {
      const arg = argsOf(node)[0]?.toString() ?? '';
      const linear = linearOf(arg, variable);
      if (!linear || isZero(linear.a)) {
        rest.push(factor);
        continue;
      }
      if (name === 'exp') {
        if (expArg) return null;
        expArg = arg;
      } else {
        if (trig) return null;
        trig = { kind: name, arg };
      }
      continue;
    }
    const powered = factor.invert ? null : poweredExp(node, variable);
    if (powered) {
      if (expArg) return null;
      expArg = powered;
    } else rest.push(factor);
  }
  const poly = productString(rest);
  if (hasSpecial(poly)) return null;
  const derivs = polynomialDerivatives(poly === '1' ? '1' : poly, variable);
  if (!derivs) return null;
  if (expArg) {
    const linear = linearOf(expArg, variable);
    if (!linear) return null;
    return combineSeries(derivs, (k) => monomialExp(k, linear.a, linear.b, variable));
  }
  if (trig) {
    const linear = linearOf(trig.arg, variable);
    if (!linear) return null;
    return combineSeries(derivs, (k) => monomialTrig(trig.kind, k, linear.a, linear.b, variable));
  }
  return null;
}

function poweredExp(node: MathNode, variable: string): string | null {
  const op = asOp(unwrap(node));
  if (!op || op.op !== '^') return null;
  const base = unwrap(op.args[0]!);
  if (fnName(base) !== 'exp') return null;
  const exponent = op.args[1]?.toString() ?? '';
  if (depends(exponent, variable)) return null;
  const arg = argsOf(base)[0]?.toString() ?? '';
  if (!linearOf(arg, variable)) return null;
  return `(${arg})*(${exponent})`;
}

function combineSeries(derivs: string[], piece: (k: number) => string): string {
  const terms: string[] = [];
  for (let k = 0; k < derivs.length; k += 1) {
    const coeff = taylor(derivs, k);
    if (isZero(coeff)) continue;
    terms.push(`(${coeff})*(${piece(k)})`);
  }
  return terms.length === 0 ? '0' : terms.join('+');
}

function monomialExp(k: number, a: string, b: string, variable: string): string {
  const kernel = `exp((${a})*(${variable})+(${b}))`;
  if (k === 0) return `(${kernel})/(${a})`;
  return `((${variable})^${k}*(${kernel}))/(${a})-(${k})/(${a})*(${monomialExp(k - 1, a, b, variable)})`;
}

function monomialTrig(kind: 'sin' | 'cos', k: number, a: string, b: string, variable: string): string {
  const arg = `((${a})*(${variable})+(${b}))`;
  if (kind === 'sin') {
    if (k === 0) return `(-cos(${arg}))/(${a})`;
    return `(-((${variable})^${k})*cos(${arg}))/(${a})+(${k})/(${a})*(${monomialTrig('cos', k - 1, a, b, variable)})`;
  }
  if (k === 0) return `(sin(${arg}))/(${a})`;
  return `((${variable})^${k}*sin(${arg}))/(${a})-(${k})/(${a})*(${monomialTrig('sin', k - 1, a, b, variable)})`;
}

function linearOf(expr: string, variable: string): { a: string; b: string } | null {
  if (!depends(expr, variable)) return { a: '0', b: rewrite(expr) };
  try {
    const slope = simplify(derivative(expr, variable)).toString();
    if (depends(slope, variable)) return null;
    const intercept = simplify(substitute(expr, variable, '0')).toString();
    if (!isZero(`(${expr})-((${slope})*(${variable})+(${intercept}))`)) return null;
    return { a: slope, b: intercept };
  } catch {
    return null;
  }
}

function expandToSum(expr: string): string {
  const terms = expandTerms(expr, 0);
  if (terms.length > 40) return expr;
  return terms
    .map((term) => {
      const body = safeSimplify(term.expr);
      return term.sign < 0 ? `-(${body})` : `(${body})`;
    })
    .join('+');
}

function expandTerms(expr: string, depth: number): Term[] {
  if (depth > 8) return [{ sign: 1, expr }];
  let node: MathNode;
  try {
    node = unwrap(parse(expr));
  } catch {
    return [{ sign: 1, expr }];
  }
  if (isSum(node)) {
    return sumTerms(node).flatMap((term) =>
      expandTerms(term.expr, depth + 1).map((inner) => ({
        sign: (term.sign * inner.sign) as 1 | -1,
        expr: inner.expr,
      })),
    );
  }
  const op = asOp(node);
  if (op && (op.op === '*' || op.op === '/')) {
    const factors = flattenFactors(node);
    const index = factors.findIndex((factor) => !factor.invert && isSumString(factor.expr));
    if (index === -1) return [{ sign: 1, expr }];
    const chosen = factors[index];
    if (!chosen) return [{ sign: 1, expr }];
    const rest = productString(factors.filter((_, i) => i !== index));
    const out: Term[] = [];
    for (const term of sumTerms(unwrap(parse(chosen.expr)))) {
      const piece = rest === '1' ? term.expr : `(${term.expr})*(${rest})`;
      for (const inner of expandTerms(piece, depth + 1)) {
        out.push({ sign: (term.sign * inner.sign) as 1 | -1, expr: inner.expr });
        if (out.length > 40) return [{ sign: 1, expr }];
      }
    }
    return out;
  }
  return [{ sign: 1, expr }];
}

function flattenFactors(node: MathNode): Array<{ invert: boolean; expr: string }> {
  node = unwrap(node);
  const op = asOp(node);
  if (op?.op === '*') return op.args.flatMap((arg) => flattenFactors(arg));
  if (op?.op === '/' && op.args.length === 2) {
    const denominator = flattenFactors(op.args[1]!).map((factor) => ({ invert: !factor.invert, expr: factor.expr }));
    return [...flattenFactors(op.args[0]!), ...denominator];
  }
  if (op?.op === '-' && op.args.length === 1) {
    return [{ invert: false, expr: '-1' }, ...flattenFactors(op.args[0]!)];
  }
  if (op?.op === '^' && (op.args[1]?.toString() === '-1' || op.args[1]?.toString() === '(-1)')) {
    return [{ invert: true, expr: op.args[0]!.toString() }];
  }
  return [{ invert: false, expr: node.toString() }];
}

function productString(factors: Array<{ invert: boolean; expr: string }>): string {
  if (factors.length === 0) return '1';
  const numerator = factors.filter((factor) => !factor.invert).map((factor) => `(${factor.expr})`);
  const denominator = factors.filter((factor) => factor.invert).map((factor) => `(${factor.expr})`);
  const over = numerator.length > 0 ? numerator.join('*') : '1';
  if (denominator.length === 0) return over;
  return `(${over})/(${denominator.join('*')})`;
}

function sumTerms(node: MathNode): Term[] {
  node = unwrap(node);
  const op = asOp(node);
  if (op?.op === '+') return op.args.flatMap((arg) => sumTerms(arg));
  if (op?.op === '-' && op.args.length === 2) {
    const right = sumTerms(op.args[1]!).map((term) => ({ sign: (term.sign === 1 ? -1 : 1) as 1 | -1, expr: term.expr }));
    return [...sumTerms(op.args[0]!), ...right];
  }
  if (op?.op === '-' && op.args.length === 1) {
    return sumTerms(op.args[0]!).map((term) => ({ sign: (term.sign === 1 ? -1 : 1) as 1 | -1, expr: term.expr }));
  }
  return [{ sign: 1, expr: node.toString() }];
}

function isSum(node: MathNode): boolean {
  const op = asOp(unwrap(node));
  return op?.op === '+' || (op?.op === '-' && op.args.length === 2);
}

function isSumString(expr: string): boolean {
  try {
    return isSum(parse(expr));
  } catch {
    return false;
  }
}

function polish(expr: string): string {
  const rewritten = rewrite(expr);
  if (rewritten.length > 500 || hasSpecial(rewritten)) return rewritten;
  try {
    return rewrite(expandToSum(rewritten));
  } catch {
    return rewritten;
  }
}

function rewrite(expr: string): string {
  if (expr.includes('sqrt')) return expr;
  if (expr.length > 150) return foldConstants(expr);
  let current = safeSimplify(expr);
  for (let i = 0; i < 2; i += 1) {
    const next = safeRules(current);
    if (next === current) return current;
    current = safeSimplify(next);
  }
  return current;
}

function foldConstants(expr: string): string {
  try {
    return foldNode(parse(expr)).toString();
  } catch {
    return expr;
  }
}

function foldNode(node: MathNode): MathNode {
  const current = unwrap(node);
  const name = fnName(current);
  let rebuilt = current;
  if (name) {
    const args = argsOf(current).map((arg) => foldNode(arg).toString());
    rebuilt = parse(`${name}(${args.join(',')})`);
  } else {
    const op = asOp(current);
    if (op?.op === '-' && op.args.length === 1) rebuilt = parse(`-(${foldNode(op.args[0]!).toString()})`);
    else if (op?.op === '^') {
      const base = foldNode(op.args[0]!).toString();
      const exponent = foldNode(op.args[1]!).toString();
      const baseNode = unwrap(parse(base));
      rebuilt =
        fnName(baseNode) === 'exp' && /^-?\d+$/.test(exponent)
          ? parse(`exp((${argsOf(baseNode)[0]?.toString() ?? '0'})*(${exponent}))`)
          : parse(`(${base})^(${exponent})`);
    } else if (op && (op.op === '+' || (op.op === '-' && op.args.length === 2))) {
      rebuilt = foldSum(current);
    } else if (op && (op.op === '*' || op.op === '/')) {
      const args = op.args.map((arg) => `(${foldNode(arg).toString()})`);
      rebuilt = parse(args.join(op.op));
    }
  }
  const text = rebuilt.toString();
  if (['x', 't', 'y', 's', 'xi'].some((symbol) => depends(text, symbol))) return rebuilt;
  try {
    const value = compileMath(text, [])({ pi: Math.PI, e: Math.E });
    if (Number.isFinite(value)) return parse(numberToMath(value));
  } catch {
    /* a symbolic constant stays as it is */
  }
  return rebuilt;
}

function foldSum(node: MathNode): MathNode {
  let constant = 0;
  const parts: string[] = [];
  for (const term of sumTerms(node)) {
    const folded = foldNode(parse(term.expr)).toString();
    const value = constantValue(folded);
    if (value !== null) {
      constant += term.sign * value;
      continue;
    }
    parts.push(term.sign < 0 ? `-(${folded})` : `(${folded})`);
  }
  if (Math.abs(constant) > 1e-12) {
    const text = numberToMath(constant);
    parts.push(text.startsWith('-') ? `-(${text.slice(1)})` : `(${text})`);
  }
  return parse(parts.join('+') || '0');
}

function constantValue(expr: string): number | null {
  if (['x', 't', 'y', 's', 'xi'].some((symbol) => depends(expr, symbol))) return null;
  try {
    const value = compileMath(expr, [])({ pi: Math.PI, e: Math.E });
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeSigns(expr: string): string {
  try {
    let node = parse(expr);
    for (let pass = 0; pass < 3; pass += 1) node = node.transform((child) => liftProductSign(child));
    return node.toString();
  } catch {
    return expr;
  }
}

function isOneFactor(node: MathNode): boolean {
  const text = unwrap(node).toString();
  return text === '1' || text === '(1)';
}

function liftProductSign(node: MathNode): MathNode {
  const op = asOp(unwrap(node));
  if (!op || (op.op !== '*' && op.op !== '/')) return node;
  let negative = false;
  const args = op.args.map((arg) => {
    const unary = asOp(unwrap(arg));
    if (unary?.op === '-' && unary.args.length === 1) {
      negative = !negative;
      return unary.args[0]!;
    }
    return arg;
  });
  if (op.op === '*') {
    const kept = args.filter((arg) => !isOneFactor(arg));
    if (!negative && kept.length === args.length) return node;
    const factors = kept.length > 0 ? kept : [parse('1')];
    const body = factors.map((arg) => `(${arg.toString()})`).join('*');
    return parse(negative ? `-(${body})` : body);
  }
  const numerator = args[0]!;
  const denominator = args[1]!;
  if (isOneFactor(denominator)) return parse(negative ? `-(${numerator.toString()})` : numerator.toString());
  if (!negative) return node;
  return parse(`-((${numerator.toString()})/(${denominator.toString()}))`);
}

function safeSimplify(expr: string): string {
  try {
    return simplify(expr).toString();
  } catch {
    return expr;
  }
}

function safeRules(expr: string): string {
  try {
    return simplify(expr, RULES).toString();
  } catch {
    return expr;
  }
}

function substitute(expr: string, name: string, replacement: string): string {
  if (!depends(expr, name)) return expr;
  const inserted = parse(replacement);
  const out = parse(expr).transform((node) => {
    if (node.type === 'SymbolNode' && symName(node) === name) return inserted.clone();
    return node;
  });
  return out.toString();
}

function bind(expr: string, params: Record<string, number>): string {
  const reserved = new Set(['x', 'y', 't', 'u', 'e', 'pi', 's', 'xi']);
  try {
    const out = parse(expr).transform((node) => {
      const name = symName(node);
      if (name && !reserved.has(name) && Object.prototype.hasOwnProperty.call(params, name)) {
        return parse(numberToMath(params[name] ?? 0));
      }
      return node;
    });
    return out.toString();
  } catch {
    return expr;
  }
}

function expressionTex(raw: string, extra: string[] = []): string {
  try {
    return exprToLatex(displayMath(raw), extra)
      .replaceAll('\\mathrm{t}', 't')
      .replaceAll('\\mathrm{x}', 'x')
      .replaceAll('\\mathrm{y}', 'y')
      .replaceAll('\\mathrm{s}', 's')
      .replaceAll('\\mathrm{u}', 'u')
      .replace(/\{\s*([xytus])\s*\}(?=\^)/g, '$1')
      .replaceAll('\\cdot', ' ')
      .replace(/\{ /g, '{')
      .replace(/\+\s*-/g, '-')
      .replace(/[ ]{2,}/g, ' ')
      .trim();
  } catch {
    return raw;
  }
}

function displayMath(expr: string): string {
  const signed = normalizeSigns(foldConstants(expandPolynomial(expr)));
  try {
    return flattenNode(parse(signed)).toString();
  } catch {
    return signed;
  }
}

/** Expand a polynomial in x, t, y and combine like terms. Leave exp, sin, and log alone. */
function expandPolynomial(expr: string): string {
  if (expr.length > 160 || /[a-zA-Z]{3,}/.test(expr)) return expr;
  try {
    const flat = rationalize(expr).toString();
    const combined = simplify(flat).toString();
    if (/\d\.\d{4,}/.test(combined)) return expr;
    return combined;
  } catch {
    return expr;
  }
}

function flattenNode(node: MathNode): MathNode {
  const current = unwrap(node);
  const name = fnName(current);
  if (name) {
    const args = argsOf(current).map((arg) => flattenNode(arg).toString());
    return parse(`${name}(${args.join(',')})`);
  }
  const op = asOp(current);
  if (!op) return current;
  if (op.op === '+' || (op.op === '-' && op.args.length === 2)) {
    const terms = sumTerms(current).map((term) => ({
      sign: term.sign,
      expr: flattenNode(parse(term.expr)).toString(),
    }));
    const first = terms[0];
    if (!first) return current;
    let acc = first.sign < 0 ? `-(${first.expr})` : `(${first.expr})`;
    for (const term of terms.slice(1)) acc = term.sign < 0 ? `${acc}-(${term.expr})` : `${acc}+(${term.expr})`;
    return parse(acc);
  }
  if (op.op === '-' && op.args.length === 1) return parse(`-(${flattenNode(op.args[0]!).toString()})`);
  if (op.op === '^') return parse(`(${flattenNode(op.args[0]!).toString()})^(${flattenNode(op.args[1]!).toString()})`);
  if (op.op === '*' || op.op === '/') {
    const factors = flattenFactors(current).map((factor) => ({
      invert: factor.invert,
      expr: flattenNode(parse(factor.expr)).toString(),
    }));
    const numeric = (factor: { expr: string }) => /^-?\d+(\.\d+)?$/.test(factor.expr);
    factors.sort((a, b) => Number(numeric(b)) - Number(numeric(a)));
    return parse(productString(factors));
  }
  return current;
}

function depends(expr: string, name: string): boolean {
  return mentions(expr, name);
}

function isZero(expr: string): boolean {
  try {
    const text = simplify(expr).toString();
    if (text === '0' || text === '-0') return true;
    if (!/[a-zA-Z]/.test(text)) {
      const value = compileMath(text, [])({});
      return Number.isFinite(value) && Math.abs(value) < 1e-10;
    }
    return false;
  } catch {
    return false;
  }
}

function isNegOne(expr: string): boolean {
  const text = safeSimplify(expr);
  return text === '-1' || text === '(-1)';
}

function hasSpecial(expr: string): boolean {
  return /\b(exp|log|ln|sin|cos|tan|sqrt|abs)\b/.test(expr);
}

function boundValue(raw: string): number | null {
  try {
    const value = compileMath(raw.trim(), [])({ pi: Math.PI, e: Math.E });
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function numberToMath(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude < 1e-12) return '0';
  const inPi = magnitude / Math.PI;
  for (const den of [1, 2, 3, 4, 6]) {
    const num = Math.round(inPi * den);
    if (num !== 0 && Math.abs(inPi - num / den) < 1e-8) {
      const divisor = gcd(num, den);
      const n = num / divisor;
      const d = den / divisor;
      const body = d === 1 ? (n === 1 ? 'pi' : `${n}*pi`) : `(${n}*pi/${d})`;
      return sign + body;
    }
  }
  const nearest = Math.round(magnitude);
  if (Math.abs(magnitude - nearest) < 1e-10) return sign + String(nearest);
  for (let den = 2; den <= 12; den += 1) {
    const num = Math.round(magnitude * den);
    if (Math.abs(magnitude - num / den) < 1e-10) {
      const divisor = gcd(num, den);
      return `${sign}(${num / divisor}/${den / divisor})`;
    }
  }
  return String(value);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = y;
    y = x % y;
    x = next;
  }
  return x || 1;
}

function unwrap(node: MathNode): MathNode {
  let current = node;
  while (current.type === 'ParenthesisNode') current = (current as MathNode & { content: MathNode }).content;
  return current;
}

function asOp(node: MathNode): OpNode | null {
  if (node.type !== 'OperatorNode') return null;
  return node as OpNode;
}

function fnName(node: MathNode): string | null {
  if (node.type !== 'FunctionNode') return null;
  const fn = (node as MathNode & { fn?: { name?: string } | string }).fn;
  if (typeof fn === 'string') return fn;
  return fn?.name ?? null;
}

function argsOf(node: MathNode): MathNode[] {
  return (node as MathNode & { args?: MathNode[] }).args ?? [];
}

function symName(node: MathNode): string | null {
  if (node.type !== 'SymbolNode') return null;
  return (node as MathNode & { name?: string }).name ?? null;
}
