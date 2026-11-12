/**
 * Linear characteristic problems: constant coefficients, the dilation
 * u_t + k x u_x = 0, Euler's equation, a half-line strip, and an RK45 fallback.
 */

import { integrateRK45 } from '../../numeric/rk45';
import { compileMath, exprToLatex, mentions } from '../expr';
import type { CharCurve, CharProblem, PdeObject } from '../types';
import { solveAffine } from './affine';
import { applyFace, cauchyWindow, prettyTex } from './formula';
import type { BuiltChar } from './solveChar';
import { constantOf, parameterValues } from './solveChar';

type Scalar = (x: number, tau: number, u?: number) => number;

export function solveLinear(problem: CharProblem): BuiltChar {
  const params = parameterValues(problem);
  const built = solveLinearCore(problem);
  if (problem.data.kind !== 'cauchy') return built;
  try {
    return applyFace(problem, built, params);
  } catch {
    return built;
  }
}

function solveLinearCore(problem: CharProblem): BuiltChar {
  const params = parameterValues(problem);
  const tauName = problem.vars === 'xy' ? 'y' : 't';
  if (problem.data.kind === 'strip') return solveStrip(problem, params, tauName);
  if (problem.data.kind === 'point') return underdeterminedPoint(problem, params, tauName);

  const a = constantOf(problem.aExpr, params);
  const b = constantOf(problem.bExpr, params);
  const c = constantOf(problem.cExpr, params);
  const d = constantOf(problem.dExpr, params);
  if (a !== null && b !== null && c !== null && d !== null) {
    return solveConstant(problem, params, a, b, c, d, tauName);
  }
  if (problem.vars === 'xt') {
    const rate = coefficientOf(problem.aExpr, 'x', params);
    const bConst = constantOf(problem.bExpr, params);
    const cConst = constantOf(problem.cExpr, params);
    const dConst = constantOf(problem.dExpr, params);
    if (rate !== null && rate !== 0 && bConst !== null && Math.abs(bConst) > 1e-12 && cConst !== null && dConst !== null) {
      return solveDilation(problem, params, rate / bConst, cConst / bConst, dConst / bConst, tauName);
    }
  }
  const affine = solveAffine(problem);
  if (affine) return affine;
  if (problem.vars === 'xy') {
    const alpha = coefficientOf(problem.aExpr, 'x', params);
    const beta = coefficientOf(problem.bExpr, 'y', params);
    const cConst = constantOf(problem.cExpr, params);
    const dConst = constantOf(problem.dExpr, params);
    if (alpha !== null && beta !== null && Math.abs(alpha - beta) <= 1e-8 * (1 + Math.abs(alpha)) && Math.abs(alpha) > 1e-10 && cConst !== null && dConst !== null && Math.abs(dConst) < 1e-10) {
      return solveEuler(problem, params, alpha, cConst, tauName);
    }
  }
  return solveNumeric(problem, params, tauName);
}

function solveConstant(
  problem: CharProblem,
  params: Record<string, number>,
  a: number,
  b: number,
  c: number,
  d: number,
  tauName: string,
): BuiltChar {
  const data = cauchy(problem, params);
  const domain = windowFor(problem, data.gExpr, data.t0);
  if (Math.abs(b) < 1e-12) return characteristicData(problem, data, a, c, d, domain, tauName);

  const speed = a / b;
  const evaluate = (x: number, tau: number) => evolve(data.g(x - speed * (tau - data.t0)), tau - data.t0, b, c, d);
  const formula = closedFormLatex(speed, b, c, d, data, tauName);
  const general = generalConstantLatex(speed, b, c, d, tauName);
  const curves = straightCurves(data, speed, b, c, d, domain, 12);
  const invariant = `\\xi=x-${texNum(speed)}${tauName}`;
  const worked = [
    problem.equationLatex,
    `The coefficients are constant, with speed \\(dx/d${tauName}=a/b=${texNum(speed)}\\).`,
    `The invariant is \\(${invariant}\\). Along a characteristic, \\(du/d${tauName}=(d-cu)/b\\).`,
    `The data \\(u(x,${texNum(data.t0)})=${tex(data.gExpr)}\\) fix the profile: \\(${formula}\\).`,
  ].join(' ');
  return {
    exact: true,
    formulaLatex: formula,
    generalLatex: general,
    evaluate,
    curves,
    dataCurve: dataCurve(data, domain),
    objects: baseObjects(invariant),
    notes: [{ id: 'transport', title: 'Characteristics', latex: `Straight characteristics carry \\(${invariant}\\). \\(${formula}\\).` }],
    workedLatex: worked,
    features: [],
    warnings: [],
    transversalityLatex: `The data line \\(${tauName}=${texNum(data.t0)}\\) is transverse to the direction \\((a,b)=(${texNum(a)},${texNum(b)})\\).`,
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
  };
}

function characteristicData(
  problem: CharProblem,
  data: Cauchy,
  a: number,
  c: number,
  d: number,
  domain: Window,
  tauName: string,
): BuiltChar {
  const samples = linspace(domain.x[0], domain.x[1], 9).slice(1, -1);
  const gaps = samples.map((x) => {
    const slope = (data.g(x + 1e-4) - data.g(x - 1e-4)) / 2e-4;
    return a * slope + c * data.g(x) - d;
  });
  const compatible = gaps.every((gap) => Math.abs(gap) < 1e-5);
  const evaluate = (x: number) => data.g(x);
  const warning = 'The data line is characteristic (vertical in the (t, x) plane). A solution exists only under a compatibility condition and is not unique.';
  return {
    exact: false,
    formulaLatex: compatible ? `u=${tex(data.gExpr)}` : 'u\\ \\text{not unique}',
    generalLatex: `b=0\\Rightarrow a u_x+c u=d. \\text{ The general solution is determined only up to data off the characteristic.}`,
    evaluate: (x) => evaluate(x),
    curves: samples.map((x, index) => ({
      id: `char-${index}`,
      invariantLatex: `x=${texNum(x)}`,
      carriedLatex: 'u=g(x)',
      points: linspace(domain.t[0], domain.t[1], 8).map((tau) => ({ x, t: tau, u: data.g(x) })),
    })),
    dataCurve: dataCurve(data, domain),
    objects: baseObjects('x'),
    notes: [{ id: 'compatibility', title: 'Characteristic data', latex: warning }],
    workedLatex: `${problem.equationLatex} Since \\(b=0\\), the direction \\((a,b)\\) is parallel to the data line \\(${tauName}=${texNum(data.t0)}\\). Compatibility asks \\(a g'+c g=d\\), which ${compatible ? 'holds' : 'fails'} on the sampled line. The solution is not unique off that line.`,
    features: [],
    warnings: [warning],
    transversalityLatex: 'The data line is not transverse: it is itself a characteristic.',
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
  };
}

function solveDilation(
  problem: CharProblem,
  params: Record<string, number>,
  k: number,
  rate: number,
  source: number,
  tauName: string,
): BuiltChar {
  const data = cauchy(problem, params);
  const domain = windowFor(problem, data.gExpr, data.t0);
  const foot = (x: number, tau: number) => x * Math.exp(-k * (tau - data.t0));
  const evaluate = (x: number, tau: number) => {
    const dt = tau - data.t0;
    return evolveRates(data.g(foot(x, tau)), dt, rate, source);
  };
  const formula = `u(x,${tauName})=e^{-${texNum(rate)}(${tauName}-${texNum(data.t0)})} g\\big(x e^{-${texNum(k)}(${tauName}-${texNum(data.t0)})}\\big)${sourceTerm(rate, source, tauName, data.t0)}`;
  const curves = dilationCurves(data, k, rate, source, domain);
  const worked = [
    problem.equationLatex,
    `The characteristic ODE is \\(dx/d${tauName}=${texNum(k)} x\\).`,
    `With \\(u(x,${texNum(data.t0)})=${tex(data.gExpr)}\\), \\(${formula}\\).`,
  ].join(' ');
  return {
    exact: true,
    formulaLatex: formula,
    generalLatex: `x e^{-${texNum(k)} ${tauName}}=\\text{const},\\quad u=e^{-${texNum(rate)} ${tauName}} F(x e^{-${texNum(k)} ${tauName}})${sourceTerm(rate, source, tauName, 0)}`,
    evaluate,
    curves,
    dataCurve: dataCurve(data, domain),
    objects: baseObjects(`x e^{-${texNum(k)} ${tauName}}`),
    notes: [{ id: 'dilation', title: 'Characteristic ODE', latex: `\\frac{dx}{d${tauName}}=${texNum(k)} x` }],
    workedLatex: worked,
    features: [],
    warnings: [],
    transversalityLatex: `\\(b\\neq 0\\), so the line \\(${tauName}=${texNum(data.t0)}\\) is transverse to \\(dx/d${tauName}=${texNum(k)} x\\).`,
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
  };
}

function solveEuler(problem: CharProblem, params: Record<string, number>, alpha: number, c: number, tauName: string): BuiltChar {
  const data = cauchy(problem, params);
  const y0 = data.t0 === 0 ? 1 : data.t0;
  const domain = windowFor(problem, data.gExpr, y0);
  const power = c / alpha;
  const evaluate = (x: number, y: number): number => {
    if (!Number.isFinite(y) || Math.abs(y) < 1e-10) return 0;
    const x0 = (x * y0) / y;
    const ratio = Math.abs(x) > 1e-12 ? x0 / x : y0 / y;
    const base = data.g(x0);
    if (Math.abs(power) < 1e-12) return base;
    const scaled = base * Math.pow(ratio, power);
    return Number.isFinite(scaled) ? scaled : 0;
  };
  const formula = `u(x,${tauName})=g\\!\\left(\\frac{x\\, ${texNum(y0)}}{${tauName}}\\right)\\left(\\frac{${texNum(y0)}}{${tauName}}\\right)^{${texNum(power)}}`;
  const curves = eulerCurves(data, y0, power, domain);
  const worked = [
    problem.equationLatex,
    `The rays of \\(x u_x+${tauName} u_{${tauName}}\\) are the lines \\(${tauName}/x=\\text{const}\\).`,
    `Writing \\(u=x^{-c/\\alpha} F(${tauName}/x)\\) with \\(\\alpha=${texNum(alpha)}\\) and \\(c=${texNum(c)}\\) separates the ODE \\(du/ds= -c u\\) from \\(dx/ds=\\alpha x\\).`,
    `The data \\(u(x,${texNum(y0)})=${tex(data.gExpr)}\\) give \\(${formula}\\).`,
  ].join(' ');
  return {
    exact: true,
    formulaLatex: formula,
    generalLatex: `u=x^{-${texNum(power)}} F(${tauName}/x)`,
    evaluate,
    curves,
    dataCurve: dataCurve(data, { x: domain.x, t: [y0, y0] }),
    objects: baseObjects(`${tauName}/x`),
    notes: [{ id: 'euler', title: 'Homogeneous solution', latex: `The general solution is \\(u=x^{-${texNum(power)}} F(${tauName}/x)\\).` }],
    workedLatex: worked,
    features: [],
    warnings: [],
    transversalityLatex: `The line \\(${tauName}=${texNum(y0)}\\) meets each ray \\(${tauName}/x=\\text{const}\\) once.`,
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
  };
}

function solveStrip(problem: CharProblem, params: Record<string, number>, tauName: string): BuiltChar {
  const data = problem.data.kind === 'strip' ? problem.data : null;
  if (!data) return solveNumeric(problem, params, tauName);
  const a = constantOf(problem.aExpr, params);
  const b = constantOf(problem.bExpr, params);
  const c = constantOf(problem.cExpr, params);
  const d = constantOf(problem.dExpr, params);
  const g = compileMath(data.gExpr, ['x', 't', 'y']);
  const boundary = compileMath(data.left.valueExpr, ['t', 'x', 'y']);
  const gAt = (x: number) => g({ ...params, x, t: 0, y: 0 });
  const bAt = (t: number) => boundary({ ...params, t, x: 0, y: 0 });
  const domain: Window = { x: [0, 4], t: [0, 2] };
  const warnings: string[] = [];
  if (a === null || b === null || c === null || d === null || Math.abs(b) < 1e-12) {
    warnings.push('The strip needs constant coefficients with b ≠ 0; the picture falls back to a numeric trace of the initial line.');
    return { ...solveNumeric(problem, params, tauName), warnings, features: ['boundary-regions'] };
  }
  const speed = a / b;
  if (speed < 0) warnings.push('The speed is negative, so prescribing the left boundary overdetermines the initial-value problem.');
  const cornerGap = gAt(0) - bAt(0);
  if (Math.abs(cornerGap) > 1e-6) {
    warnings.push(`Corner values differ: g(0) = ${trim(gAt(0))} but the boundary value at ${tauName}=0 is ${trim(bAt(0))}.`);
  }
  const evaluate = (x: number, tau: number): number => {
    if (speed < 0) return evolve(gAt(x - speed * tau), tau, b, c, d);
    const foot = x - speed * tau;
    if (foot >= 0) return evolve(gAt(foot), tau, b, c, d);
    const departure = tau - x / speed;
    return evolve(bAt(departure), tau - departure, b, c, d);
  };
  const initialLatex = `u=${tex(data.gExpr)}\\ (x>${texNum(speed)}\\, ${tauName})`;
  const boundaryLatex = `u=${tex(data.left.valueExpr)}\\text{ at }${tauName}-x/${texNum(speed)}\\ (x<${texNum(speed)}\\, ${tauName})`;
  const regions =
    speed > 0
      ? [
          {
            id: 'region-initial',
            label: 'Initial data',
            formulaLatex: initialLatex,
            polygon: stripPolygon('initial', speed, domain),
          },
          {
            id: 'region-boundary',
            label: 'Left boundary',
            formulaLatex: boundaryLatex,
            polygon: stripPolygon('boundary', speed, domain),
          },
        ]
      : [
          {
            id: 'region-initial',
            label: 'Initial data',
            formulaLatex: `u=${tex(data.gExpr)}\\ (x-${texNum(speed)}${tauName})`,
            polygon: [
              [0, 0],
              [domain.x[1], 0],
              [domain.x[1], domain.t[1]],
              [0, domain.t[1]],
            ],
          },
        ];
  const curves = stripCurves(gAt, bAt, speed, b, c, d, domain);
  const formula = speed > 0 ? `\\begin{cases} ${initialLatex} \\\\ ${boundaryLatex} \\end{cases}` : `u=g(x-${texNum(speed)}${tauName})`;
  const objects: PdeObject[] = [
    ...baseObjects(`x-${texNum(speed)}${tauName}`),
    ...regions.map((region) => ({ id: region.id, label: region.label, formulaLatex: region.formulaLatex, group: 'region' as const, defaultOn: true })),
  ];
  return {
    exact: true,
    formulaLatex: formula,
    generalLatex: `u=e^{-(c/b)${tauName}} F(x-${texNum(speed)}${tauName})`,
    evaluate,
    curves,
    dataCurve: [
      ...linspace(0, domain.x[1], 12).map((x) => ({ x, t: 0, u: gAt(x) })),
      ...linspace(0, domain.t[1], 8).map((t) => ({ x: 0, t, u: bAt(t) })),
    ],
    objects,
    notes: [{ id: 'regions', title: 'Two regions', latex: `The characteristic \\(x=${texNum(speed)} ${tauName}\\) separates data from \\(${tauName}=0\\) and data from \\(x=0\\).` }],
    workedLatex: [
      problem.equationLatex,
      `Speed \\(a/b=${texNum(speed)}\\). For \\(x>${texNum(speed)} ${tauName}\\) the trace meets the initial line; for \\(x<${texNum(speed)} ${tauName}\\) it meets the left boundary.`,
      speed < 0 ? 'Because the speed is negative, characteristics leave through x=0 and the boundary condition overdetermines the problem.' : `Separating line: \\(x=${texNum(speed)} ${tauName}\\).`,
      `Corner values: g(0)=${texNum(gAt(0))}, and the boundary at 0 is ${texNum(bAt(0))}.`,
    ].join(' '),
    features: ['boundary-regions'],
    warnings,
    transversalityLatex:
      speed > 0
        ? `Both the initial line and the boundary x=0 are transverse to dx/d${tauName}=${texNum(speed)}. They meet at the corner.`
        : `Characteristics exit through x=0, so the left boundary is not an inflow.`,
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
    regions,
  };
}

function solveNumeric(problem: CharProblem, params: Record<string, number>, tauName: string): BuiltChar {
  const data = problem.data.kind === 'cauchy' ? cauchy(problem, params) : { g: () => 0, gExpr: '0', t0: 0 };
  const domain = windowFor(problem, data.gExpr, data.t0);
  const aFn = coefficientFunction(problem.aExpr, params, problem.vars);
  const bFn = coefficientFunction(problem.bExpr, params, problem.vars);
  const cFn = coefficientFunction(problem.cExpr, params, problem.vars);
  const dFn = coefficientFunction(problem.dExpr, params, problem.vars);
  const evaluate = (x: number, tau: number): number => traceValue(x, tau, data, aFn, bFn, cFn, dFn);
  const curves = numericCurves(data, domain, aFn, bFn, cFn, dFn);
  const warning = `The curves solve dx/d${tauName}=a/b and du/d${tauName}=(d-cu)/b numerically.`;
  const ode = `\\frac{dx}{d${tauName}}=\\frac{a}{b},\\quad \\frac{du}{d${tauName}}=\\frac{d-cu}{b}`;
  return {
    exact: false,
    formulaLatex: ode,
    generalLatex: ode,
    evaluate,
    curves,
    dataCurve: dataCurve(data, domain),
    objects: baseObjects(ode, `u(x,${texNum(data.t0)})=${tex(data.gExpr)}`),
    notes: [{ id: 'numeric', title: 'Characteristic ODEs', latex: `${ode}.\\ ${warning}` }],
    workedLatex: [
      problem.equationLatex,
      `The characteristic ODE is \\(dx/d${tauName}=a/b\\), and \\(du/d${tauName}=(d-cu)/b\\).`,
      `Data: \\(u(x,${texNum(data.t0)})=${tex(data.gExpr)}\\).`,
    ].join(' '),
    features: [],
    warnings: [warning],
    transversalityLatex: `The initial line is transverse where \\(b\\neq 0\\). The curves themselves are numeric.`,
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'linear',
  };
}

function underdeterminedPoint(problem: CharProblem, params: Record<string, number>, tauName: string): BuiltChar {
  const point = problem.data.kind === 'point' ? problem.data : { xExpr: '0', yExpr: '0', uExpr: '0' };
  const x0 = constantOf(point.xExpr, params) ?? 0;
  const y0 = constantOf(point.yExpr, params) ?? 0;
  const u0 = constantOf(point.uExpr, params) ?? 0;
  const warning = 'A single point does not determine a linear characteristic problem.';
  return {
    exact: false,
    formulaLatex: 'u\\ \\text{not determined}',
    generalLatex: `a u_x+b u_{${tauName}}+c u=d`,
    evaluate: () => u0,
    curves: [],
    dataCurve: [{ x: x0, t: y0, u: u0 }],
    objects: [{ id: 'data', label: 'Data', formulaLatex: `(${texNum(x0)},${texNum(y0)})`, group: 'boundary', defaultOn: true }],
    notes: [{ id: 'point', title: 'Point datum', latex: warning }],
    workedLatex: `${problem.equationLatex} ${warning}`,
    features: [],
    warnings: [warning],
    transversalityLatex: 'A point datum does not define a data line.',
    domainX: [x0 - 2, x0 + 2],
    domainT: [y0 - 2, y0 + 2],
    residualKind: 'linear',
  };
}

interface Cauchy {
  g: (x: number) => number;
  gExpr: string;
  t0: number;
}

interface Window {
  x: [number, number];
  t: [number, number];
}

function cauchy(problem: CharProblem, params: Record<string, number>): Cauchy {
  if (problem.data.kind !== 'cauchy') return { g: () => 0, gExpr: '0', t0: 0 };
  const gExpr = problem.data.gExpr;
  const fn = compileMath(gExpr, ['x', 't', 'y']);
  const t0 = constantOf(problem.data.timeExpr, params) ?? 0;
  return {
    gExpr,
    t0,
    g: (x: number) => {
      const value = fn({ ...params, x, t: t0, y: t0 });
      return Number.isFinite(value) ? value : 0;
    },
  };
}

function evolve(g0: number, dt: number, b: number, c: number, d: number): number {
  if (!Number.isFinite(g0) || Math.abs(b) < 1e-14) return g0;
  return evolveRates(g0, dt, c / b, d / b);
}

function evolveRates(g0: number, dt: number, rate: number, source: number): number {
  if (Math.abs(rate) < 1e-14) return g0 + source * dt;
  const decay = Math.exp(-rate * dt);
  return g0 * decay + (source / rate) * (1 - decay);
}

function coefficientOf(expr: string, variable: 'x' | 'y', params: Record<string, number>): number | null {
  const blocked = ['t', 'u', 'U', 'UX', 'UY', 'UT', variable === 'x' ? 'y' : 'x'];
  if (blocked.some((name) => mentions(expr, name))) return null;
  const fn = compileMath(expr, ['x', 'y', 't', 'u']);
  const at = (value: number) => fn({ ...params, x: variable === 'x' ? value : 0, y: variable === 'y' ? value : 0, t: 0, u: 0 });
  const f0 = at(0);
  const f1 = at(1);
  const f3 = at(3);
  if (![f0, f1, f3].every(Number.isFinite)) return null;
  if (Math.abs(f0) > 1e-7) return null;
  if (Math.abs(f3 - 3 * f1) > 1e-6 * (1 + Math.abs(f1))) return null;
  return f1;
}

function coefficientFunction(expr: string, params: Record<string, number>, vars: 'xt' | 'xy'): Scalar {
  let fn: ((scope: Record<string, number>) => number) | null = null;
  try {
    fn = compileMath(expr, ['x', 't', 'y', 'u', 'U', 'UX', 'UY', 'UT']);
  } catch {
    return () => Number.NaN;
  }
  return (x, tau, u = 0) => {
    const value = fn?.({
      ...params,
      x,
      t: vars === 'xt' ? tau : 0,
      y: vars === 'xy' ? tau : 0,
      u,
      U: u,
      UX: 0,
      UY: 0,
      UT: 0,
    });
    return Number.isFinite(value) ? value : 0;
  };
}

function traceValue(x: number, tau: number, data: Cauchy, aFn: Scalar, bFn: Scalar, cFn: Scalar, dFn: Scalar): number {
  if (Math.abs(tau - data.t0) < 1e-10) return data.g(x);
  const back = integrateRK45({
    t0: tau,
    t1: data.t0,
    y0: [x],
    rtol: 1e-6,
    atol: 1e-8,
    maxSteps: 160,
    params: {},
    f: (s, y) => {
      const xx = y[0] ?? 0;
      const bb = bFn(xx, s, 0);
      if (Math.abs(bb) < 1e-10) return [0];
      return [aFn(xx, s, 0) / bb];
    },
  });
  const foot = back.y[back.y.length - 1]?.[0] ?? x;
  const carried = data.g(foot);
  if (Math.abs(tau - data.t0) < 1e-10) return carried;
  const forward = integrateRK45({
    t0: data.t0,
    t1: tau,
    y0: [foot, carried],
    rtol: 1e-6,
    atol: 1e-8,
    maxSteps: 160,
    blowUpRadius: 1e4,
    params: {},
    f: (s, y) => {
      const xx = y[0] ?? 0;
      const uu = y[1] ?? 0;
      const bb = bFn(xx, s, uu);
      if (Math.abs(bb) < 1e-10) return [0, 0];
      return [aFn(xx, s, uu) / bb, (dFn(xx, s, uu) - cFn(xx, s, uu) * uu) / bb];
    },
  });
  const value = forward.y[forward.y.length - 1]?.[1] ?? carried;
  if (!Number.isFinite(value) || Math.abs(value) > 1e4) return Number.NaN;
  return value;
}

function numericCurves(data: Cauchy, domain: Window, aFn: Scalar, bFn: Scalar, cFn: Scalar, dFn: Scalar): CharCurve[] {
  return linspace(domain.x[0], domain.x[1], 12).map((x0, index) => {
    const traced = integrateRK45({
      t0: data.t0,
      t1: domain.t[1],
      y0: [x0, data.g(x0)],
      rtol: 1e-4,
      atol: 1e-6,
      maxSteps: 120,
      blowUpRadius: 1e4,
      sampleDistance: 0.25,
      params: {},
      viewport: { xMin: domain.x[0] - 4, xMax: domain.x[1] + 4, yMin: -1e6, yMax: 1e6 },
      f: (s, y) => {
        const xx = y[0] ?? 0;
        const uu = y[1] ?? 0;
        const bb = bFn(xx, s, uu);
        if (Math.abs(bb) < 1e-10) return [0, 0];
        return [aFn(xx, s, uu) / bb, (dFn(xx, s, uu) - cFn(xx, s, uu) * uu) / bb];
      },
    });
    return {
      id: `char-${index}`,
      invariantLatex: `x(${texNum(data.t0)})=${texNum(x0)}`,
      carriedLatex: 'du/d\\tau=(d-cu)/b',
      points: traced.t.map((tau, point) => ({
        x: traced.y[point]?.[0] ?? x0,
        t: tau,
        u: traced.y[point]?.[1] ?? data.g(x0),
      })),
    };
  });
}

function straightCurves(data: Cauchy, speed: number, b: number, c: number, d: number, domain: Window, count: number): CharCurve[] {
  const times = linspace(domain.t[0], domain.t[1], 16);
  return linspace(domain.x[0], domain.x[1], count).map((x0, index) => ({
    id: `char-${index}`,
    invariantLatex: `x-${texNum(speed)}\\tau=${texNum(x0 - speed * data.t0)}`,
    carriedLatex: 'u\\ \\text{from the data}',
    points: times.map((tau) => {
      const x = x0 + speed * (tau - data.t0);
      return { x, t: tau, u: evolve(data.g(x0), tau - data.t0, b, c, d) };
    }),
  }));
}

function dilationCurves(data: Cauchy, k: number, rate: number, source: number, domain: Window): CharCurve[] {
  const times = linspace(domain.t[0], domain.t[1], 16);
  return linspace(domain.x[0], domain.x[1], 12).map((x0, index) => ({
    id: `char-${index}`,
    invariantLatex: `x e^{-${texNum(k)}\\tau}`,
    carriedLatex: 'u',
    points: times.map((tau) => ({
      x: x0 * Math.exp(k * (tau - data.t0)),
      t: tau,
      u: evolveRates(data.g(x0), tau - data.t0, rate, source),
    })),
  }));
}

function eulerCurves(data: Cauchy, y0: number, power: number, domain: Window): CharCurve[] {
  const feet = linspace(-3.6, 3.6, 12).filter((x0) => Math.abs(x0) > 0.2);
  const ys = linspace(domain.t[0], domain.t[1], 16);
  return feet.map((x0, index) => ({
    id: `char-${index}`,
    invariantLatex: `${'y'}/x=${texNum(y0 / x0)}`,
    carriedLatex: `u=x^{-${texNum(power)}} F(y/x)`,
    points: ys.map((y) => {
      const x = (x0 * y) / y0;
      const ratio = x0 / x;
      const u = Math.abs(power) < 1e-12 ? data.g(x0) : data.g(x0) * Math.pow(ratio, power);
      return { x, t: y, u: Number.isFinite(u) ? u : 0 };
    }),
  }));
}

function stripCurves(
  gAt: (x: number) => number,
  bAt: (t: number) => number,
  speed: number,
  b: number,
  c: number,
  d: number,
  domain: Window,
): CharCurve[] {
  const times = linspace(0, domain.t[1], 12);
  const fromInitial = linspace(0.2, domain.x[1], 6).map((x0, index) => ({
    id: `char-i-${index}`,
    invariantLatex: `x-${texNum(speed)} t=${texNum(x0)}`,
    carriedLatex: 'initial data',
    points: times
      .map((t) => ({ x: x0 + speed * t, t, u: evolve(gAt(x0), t, b, c, d) }))
      .filter((point) => point.x >= -0.05 && point.x <= domain.x[1] + 0.2),
  }));
  const fromBoundary = (speed > 0 ? linspace(0.15, domain.t[1], 6) : []).map((t0, index) => ({
    id: `char-b-${index}`,
    invariantLatex: `t-x/${texNum(speed)}=${texNum(t0)}`,
    carriedLatex: 'boundary data',
    points: linspace(0, Math.min(domain.x[1], Math.max(speed, 0) * (domain.t[1] - t0) || domain.x[1]), 10).map((x) => {
      const t = t0 + (speed === 0 ? 0 : x / speed);
      return { x, t, u: evolve(bAt(t0), t - t0, b, c, d) };
    }),
  }));
  return [...fromInitial, ...fromBoundary].slice(0, 12);
}

function stripPolygon(kind: 'initial' | 'boundary', speed: number, domain: Window): number[][] {
  const X = domain.x[1];
  const T = domain.t[1];
  const hit = speed * T;
  if (kind === 'boundary') {
    if (hit >= X) return [[0, 0], [0, T], [X, T], [X, X / speed]];
    return [[0, 0], [0, T], [hit, T]];
  }
  if (hit >= X) return [[X, 0], [X, X / speed], [0, 0]];
  return [[0, 0], [hit, T], [X, T], [X, 0]];
}

function dataCurve(data: Cauchy, domain: Window): Array<{ x: number; t: number; u: number }> {
  return linspace(domain.x[0], domain.x[1], 24).map((x) => ({ x, t: data.t0, u: data.g(x) }));
}

function baseObjects(invariant: string, dataLatex = 'u\\ \\text{on the initial line}'): PdeObject[] {
  return [
    { id: 'characteristics', label: 'Characteristics', formulaLatex: invariant, group: 'characteristic', defaultOn: true },
    { id: 'data', label: 'Initial line', formulaLatex: dataLatex, group: 'boundary', defaultOn: true },
  ];
}

function windowFor(problem: CharProblem, gExpr: string, t0: number): Window {
  return cauchyWindow(problem, t0, gExpr);
}

function closedFormLatex(speed: number, b: number, c: number, d: number, data: Cauchy, tauName: string): string {
  const arg = `x-${texNum(speed)}(${tauName}-${texNum(data.t0)})`;
  const profile = profileLatex(data.gExpr, arg);
  if (Math.abs(c) < 1e-14 && Math.abs(d) < 1e-14) return `u=${profile}`;
  const decay = `e^{-${texNum(c / b)}(${tauName}-${texNum(data.t0)})}`;
  if (Math.abs(c) < 1e-14) return `u=${profile}+${texNum(d / b)}(${tauName}-${texNum(data.t0)})`;
  return `u=${profile}\\,${decay}+${texNum(d / c)}\\big(1-${decay}\\big)`;
}

function profileLatex(gExpr: string, arg: string): string {
  if (gExpr.replace(/\s+/g, '') === '0') return '0';
  try {
    const latex = exprToLatex(gExpr);
    return latex.replace(/x/g, `\\left(${arg}\\right)`);
  } catch {
    return `g\\left(${arg}\\right)`;
  }
}

function generalConstantLatex(speed: number, b: number, c: number, d: number, tauName: string): string {
  if (Math.abs(c) < 1e-14 && Math.abs(d) < 1e-14) return `u=F(x-${texNum(speed)}${tauName})`;
  if (Math.abs(c) < 1e-14) return `u=F(x-${texNum(speed)}${tauName})+${texNum(d / b)}${tauName}`;
  return `u=e^{-${texNum(c / b)}${tauName}} F(x-${texNum(speed)}${tauName})+${texNum(d / c)}`;
}

function sourceTerm(rate: number, source: number, tauName: string, t0: number): string {
  if (Math.abs(source) < 1e-14) return '';
  if (Math.abs(rate) < 1e-14) return `+${texNum(source)}(${tauName}-${texNum(t0)})`;
  return `+${texNum(source / rate)}\\big(1-e^{-${texNum(rate)}(${tauName}-${texNum(t0)})}\\big)`;
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

function trim(value: number): string {
  return texNum(value);
}
