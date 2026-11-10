/**
 * Eikonal equation u_x^2 + u_y^2 = 1.
 * A point datum is a circular wave; flat Cauchy data is |y-y_0|.
 * Any other Cauchy line is integrated with Charpit's equations.
 */

import { integrateRK45 } from '../../numeric/rk45';
import { compileMath, exprToLatex } from '../expr';
import type { CharCurve, CharProblem } from '../types';
import type { BuiltChar } from './solveChar';
import { constantOf, parameterValues } from './solveChar';

export function solveEikonal(problem: CharProblem): BuiltChar {
  const params = parameterValues(problem);
  if (problem.data.kind === 'point') return solvePoint(problem, params);
  return solveCauchy(problem, params);
}

function solvePoint(problem: CharProblem, params: Record<string, number>): BuiltChar {
  const data = problem.data.kind === 'point' ? problem.data : { xExpr: '0', yExpr: '0', uExpr: '0' };
  const x0 = constantOf(data.xExpr, params) ?? 0;
  const y0 = constantOf(data.yExpr, params) ?? 0;
  const u0 = constantOf(data.uExpr, params) ?? 0;
  const evaluate = (x: number, y: number) => u0 + Math.hypot(x - x0, y - y0);
  const domain: [number, number] = [-2, 6];
  const rays = rayBundle(12).map((angle, index) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const points = linspace(0, 5, 16).map((radius) => [x0 + radius * cosine, y0 + radius * sine]);
    return {
      points,
      latex: `\\theta=${texNum(angle)}`,
      curve: {
        id: `ray-${index}`,
        invariantLatex: `\\theta=${texNum(angle)}`,
        carriedLatex: `u=${texNum(u0)}+r`,
        points: points.map(([x, y]) => ({ x: x ?? 0, t: y ?? 0, u: u0 + Math.hypot((x ?? 0) - x0, (y ?? 0) - y0) })),
      } satisfies CharCurve,
    };
  });
  const wavefronts = [1, 2, 3, 4].map((radius) => ({
    latex: `u=${texNum(u0 + radius)}`,
    points: linspace(0, 2 * Math.PI, 48).map((angle) => [x0 + radius * Math.cos(angle), y0 + radius * Math.sin(angle)]),
  }));
  return {
    exact: true,
    formulaLatex: `u=${texNum(u0)}+\\sqrt{(x-${texNum(x0)})^2+(y-${texNum(y0)})^2}`,
    generalLatex: `u=u_0+\\operatorname{dist}((x,y),(x_0,y_0))`,
    evaluate,
    curves: rays.map((ray) => ray.curve),
    dataCurve: [{ x: x0, t: y0, u: u0 }],
    objects: [
      { id: 'rays', label: 'Rays', formulaLatex: '(x-x_0,y-y_0)\\parallel (\\cos\\theta,\\sin\\theta)', group: 'ray', defaultOn: true },
      { id: 'data', label: 'Data', formulaLatex: `u(${texNum(x0)},${texNum(y0)})=${texNum(u0)}`, group: 'boundary', defaultOn: true },
    ],
    notes: [{ id: 'cone', title: 'Distance solution', latex: 'Rays leave the point in every direction and the wavefronts are circles.' }],
    workedLatex: [
      problem.equationLatex,
      `Charpit's equations for \\(F=p^2+q^2-1\\) are \\(dx/ds=2p\\), \\(dy/ds=2q\\), \\(du/ds=2\\), with \\(p\\) and \\(q\\) constant.`,
      `From a point the rays are straight and \\(u\\) grows with arc length, so \\(u=${texNum(u0)}+\\sqrt{(x-${texNum(x0)})^2+(y-${texNum(y0)})^2}\\).`,
      `Data: \\(u(${texNum(x0)},${texNum(y0)})=${texNum(u0)}\\).`,
      `Check: \\(u(3,4)=${texNum(evaluate(3, 4))}\\), and \\(u_x^2+u_y^2=1\\) off the point.`,
    ].join(' '),
    features: ['eikonal'],
    warnings: [],
    transversalityLatex: 'A point datum is transverse to every ray.',
    domainX: [x0 + domain[0], x0 + domain[1]],
    domainT: [y0 + domain[0], y0 + domain[1]],
    residualKind: 'eikonal',
    singularX: x0,
    singularT: y0,
    rays: rays.map(({ points, latex }) => ({ points, latex })),
    wavefronts,
  };
}

function solveCauchy(problem: CharProblem, params: Record<string, number>): BuiltChar {
  const gExpr = problem.data.kind === 'cauchy' ? problem.data.gExpr : '0';
  const y0 = problem.data.kind === 'cauchy' ? (constantOf(problem.data.timeExpr, params) ?? 0) : 0;
  const gFn = compileMath(gExpr, ['x', 't', 'y']);
  const g = (x: number) => {
    const value = gFn({ ...params, x, t: y0, y: y0 });
    return Number.isFinite(value) ? value : 0;
  };
  const probe = linspace(-4, 4, 17).map((x) => g(x));
  const level = probe[0] ?? 0;
  const flat = probe.every((value) => Math.abs(value - level) < 1e-8);
  const domainX: [number, number] = [-5, 5];
  const domainT: [number, number] = [y0 - 3, y0 + 3];
  if (flat) {
    const evaluate = (x: number, y: number) => (Number.isFinite(x) ? level + Math.abs(y - y0) : Number.NaN);
    const feet = linspace(-4, 4, 6);
    const curves: CharCurve[] = feet.flatMap((x0, index) =>
      [-1, 1].map((sign) => ({
        id: `ray-${index}-${sign > 0 ? 'up' : 'down'}`,
        invariantLatex: `x=${texNum(x0)}`,
        carriedLatex: `u=${texNum(level)}+|y-${texNum(y0)}|`,
        points: linspace(0, 3, 10).map((radius) => ({ x: x0, t: y0 + sign * radius, u: level + radius })),
      })),
    );
    return {
      exact: true,
      formulaLatex: `u=${texNum(level)}+|y-${texNum(y0)}|`,
      generalLatex: `u=c+|y-y_0|`,
      evaluate,
      curves,
      dataCurve: linspace(domainX[0], domainX[1], 20).map((x) => ({ x, t: y0, u: level })),
      objects: [
        { id: 'rays', label: 'Rays', formulaLatex: 'x=\\mathrm{const}', group: 'ray', defaultOn: true },
        { id: 'data', label: 'Data', formulaLatex: `u(x,${texNum(y0)})=${texNum(level)}`, group: 'boundary', defaultOn: true },
      ],
      notes: [{ id: 'flat', title: 'Plane waves', latex: `Constant data on \\(y=${texNum(y0)}\\) produce vertical rays and the solution \\(u=${texNum(level)}+|y-${texNum(y0)}|\\).` }],
      workedLatex: [
        problem.equationLatex,
        `On \\(y=${texNum(y0)}\\), \\(u_x=0\\), so \\(u_y=\\pm 1\\).`,
        `Charpit keeps \\(p=0\\) and \\(q=\\pm 1\\), hence vertical rays.`,
        `Data \\(u(x,${texNum(y0)})=${tex(gExpr)}\\) give \\(u=${texNum(level)}+|y-${texNum(y0)}|\\).`,
        `Check: \\(u_x^2+u_y^2=1\\) for \\(y\\neq ${texNum(y0)}\\).`,
      ].join(' '),
      features: ['eikonal'],
      warnings: [],
      transversalityLatex: `The line \\(y=${texNum(y0)}\\) is transverse to the vertical rays.`,
      domainX,
      domainT,
      residualKind: 'eikonal',
      rays: curves.map((curve) => ({ points: curve.points.map((point) => [point.x, point.t]), latex: curve.invariantLatex })),
      wavefronts: [1, 2].flatMap((radius) => [
        { points: linspace(domainX[0], domainX[1], 12).map((x) => [x, y0 + radius]), latex: `y=${texNum(y0 + radius)}` },
        { points: linspace(domainX[0], domainX[1], 12).map((x) => [x, y0 - radius]), latex: `y=${texNum(y0 - radius)}` },
      ]),
    };
  }
  return solveCharpit(problem, g, gExpr, y0, domainX, domainT);
}

function solveCharpit(
  problem: CharProblem,
  g: (x: number) => number,
  gExpr: string,
  y0: number,
  domainX: [number, number],
  domainT: [number, number],
): BuiltChar {
  const slope = (x: number) => (g(x + 1e-4) - g(x - 1e-4)) / 2e-4;
  const steep = linspace(domainX[0], domainX[1], 21).some((x) => Math.abs(slope(x)) > 1 + 1e-6);
  const warnings = steep ? ['The initial slope exceeds 1, so the eikonal strip condition has no real direction at those feet.'] : [];
  const feet = linspace(domainX[0], domainX[1], 6);
  const curves: CharCurve[] = [];
  const rays: Array<{ points: number[][]; latex: string }> = [];
  for (const x0 of feet) {
    const p0 = clamp(slope(x0), -0.999, 0.999);
    const qAbs = Math.sqrt(Math.max(0, 1 - p0 * p0));
    for (const sign of [-1, 1]) {
      const traced = integrateRK45({
        t0: 0,
        t1: 2.5,
        y0: [x0, y0, g(x0), p0, sign * qAbs],
        rtol: 1e-5,
        atol: 1e-7,
        maxSteps: 300,
        sampleDistance: 0.3,
        params: {},
        viewport: { xMin: domainX[0] - 2, xMax: domainX[1] + 2, yMin: domainT[0] - 2, yMax: domainT[1] + 2 },
        f: (s, state) => {
          void s;
          const p = state[3] ?? 0;
          const q = state[4] ?? 0;
          return [2 * p, 2 * q, 2 * (p * p + q * q), 0, 0];
        },
      });
      const points = traced.y.map((state) => ({
        x: state[0] ?? x0,
        t: state[1] ?? y0,
        u: state[2] ?? g(x0),
      }));
      curves.push({
        id: `ray-${curves.length}`,
        invariantLatex: `p=${texNum(p0)},\\ q=${texNum(sign * qAbs)}`,
        carriedLatex: 'F=p^2+q^2-1',
        points,
      });
      rays.push({ points: points.map((point) => [point.x, point.t]), latex: `p=${texNum(p0)}` });
    }
  }
  const evaluate = (x: number, y: number) => viscosity(x, y, y0, g);
  return {
    exact: false,
    formulaLatex: 'u=\\min_{x_0}\\big(g(x_0)+\\sqrt{(x-x_0)^2+(y-y_0)^2}\\big)',
    generalLatex: `F=p^2+q^2-1,\\quad dx/ds=2p,\\ dy/ds=2q,\\ du/ds=2`,
    evaluate,
    curves: curves.slice(0, 12),
    dataCurve: linspace(domainX[0], domainX[1], 20).map((x) => ({ x, t: y0, u: g(x) })),
    objects: [
      { id: 'rays', label: 'Rays', formulaLatex: 'dx:dy:du=p:q:1', group: 'ray', defaultOn: true },
      { id: 'data', label: 'Data', formulaLatex: `u(x,${texNum(y0)})=${tex(gExpr)}`, group: 'boundary', defaultOn: true },
    ],
    notes: [{ id: 'charpit', title: 'Charpit', latex: "Rays are the projections of Charpit's equations for \\(F=p^2+q^2-1\\), integrated with RK45." }],
    workedLatex: [
      problem.equationLatex,
      `Differentiate \\(F=p^2+q^2-1\\): \\(dx/ds=F_p=2p\\), \\(dy/ds=2q\\), \\(du/ds=2p^2+2q^2=2\\), and \\(p,q\\) are constant.`,
      `The strip condition on \\(y=${texNum(y0)}\\) gives \\(p=g'(x)\\) and \\(q=\\pm\\sqrt{1-p^2}\\).`,
      `Data \\(u(x,${texNum(y0)})=${tex(gExpr)}\\). The viscosity solution keeps the minimising foot.`,
      `Check at one interior point: \\(u(0.3,${texNum(y0 + 0.4)})=${texNum(evaluate(0.3, y0 + 0.4))}\\).`,
    ].join(' '),
    features: ['eikonal'],
    warnings,
    transversalityLatex: steep
      ? 'Where |g\'|>1 the initial line is not a non-characteristic strip for F=p^2+q^2-1.'
      : `The line y=${texNum(y0)} is transverse to the rays as long as |g'|<1.`,
    domainX,
    domainT,
    residualKind: 'eikonal',
    rays: rays.slice(0, 12),
  };
}

function viscosity(x: number, y: number, y0: number, g: (x0: number) => number): number {
  if (Math.abs(y - y0) < 1e-12) return g(x);
  const cost = (x0: number) => g(x0) + Math.hypot(x - x0, y - y0);
  let best = Number.POSITIVE_INFINITY;
  let bestX = x;
  for (const x0 of linspace(x - 6, x + 6, 121)) {
    const value = cost(x0);
    if (value < best) {
      best = value;
      bestX = x0;
    }
  }
  const step = 0.1;
  let left = bestX - step;
  let right = bestX + step;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = right - ratio * (right - left);
  let d = left + ratio * (right - left);
  let fc = cost(c);
  let fd = cost(d);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    if (fc < fd) {
      right = d;
      d = c;
      fd = fc;
      c = right - ratio * (right - left);
      fc = cost(c);
    } else {
      left = c;
      c = d;
      fc = fd;
      d = left + ratio * (right - left);
      fd = cost(d);
    }
  }
  return Math.min(fc, fd);
}

function rayBundle(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (2 * Math.PI * index) / count);
}

function linspace(start: number, end: number, count: number): number[] {
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function tex(expr: string): string {
  try {
    return exprToLatex(expr);
  } catch {
    return expr;
  }
}

function texNum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}
