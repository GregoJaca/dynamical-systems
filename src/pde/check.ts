/**
 * Compare a candidate expression with the PDE and with the solver's original frame.
 * Diagnoses are emitted only when the corresponding mistake is actually present.
 */

import { compileMath, evalMath, makeField } from './expr';
import type { CharProblem, CheckReport, EndCondition, HeatProblem, PdeProblem, PdeSolution } from './types';

const PDE_TOL = 1e-2;
const IC_TOL = 5e-2;

export function checkAnswer(problem: PdeProblem, solution: PdeSolution, userExpr: string): CheckReport {
  const params = parameterScope(problem);
  let compiled: (scope: Record<string, number>) => number;
  try {
    compiled = compileMath(userExpr, ['x', 't', 'y', 'r', 'u']);
  } catch {
    return { ok: false, pdeResidual: Number.POSITIVE_INFINITY, initialResidual: Number.POSITIVE_INFINITY, boundaryResidual: Number.POSITIVE_INFINITY, differenceFromTool: Number.POSITIVE_INFINITY, diagnoses: [] };
  }
  const user = (x: number, t: number, y = 0) => {
    const value = compiled({ ...params, x, t, y, r: problem.family === 'heat' && problem.spatial === 'radial' ? x : Math.hypot(x, y), u: 0 });
    return Number.isFinite(value) ? value : 0;
  };
  const tool = solution.frames[0]?.evaluate ?? (() => Number.NaN);
  const samples = samplePoints(problem, solution);
  const pdeResidual = maxOf(samples.pde, (x, t, y) => Math.abs(pdeAt(problem, params, user, x, t, y)));
  const initialResidual = initialError(problem, params, user);
  const boundaryResidual = boundaryError(problem, params, user);
  const differenceFromTool = maxOf(samples.compare, (x, t, y) => Math.abs(user(x, t, y) - tool(x, t, y)));
  const diagnoses = diagnose(problem, solution, user, tool, differenceFromTool);
  const difference = problem.family === 'classify' ? 0 : differenceFromTool;
  const ok = pdeResidual < PDE_TOL && boundaryResidual < PDE_TOL && initialResidual < IC_TOL && difference < PDE_TOL;
  return { ok, pdeResidual, initialResidual, boundaryResidual, differenceFromTool: difference, diagnoses: ok ? [] : diagnoses };
}

function diagnose(
  problem: PdeProblem,
  _solution: PdeSolution,
  user: (x: number, t: number, y?: number) => number,
  tool: (x: number, t: number, y?: number) => number,
  difference: number,
): string[] {
  if (problem.family !== 'heat' || problem.domain.kind !== 'interval' || difference < PDE_TOL) return robinDiagnosis(problem, user);
  const found: string[] = [];
  const params = parameterScope(problem);
  const left = evalMath(problem.domain.leftExpr, params);
  const right = evalMath(problem.domain.rightExpr, params);
  const xs = interior(left, right, 24);
  const dot = (p: (x: number) => number, q: (x: number) => number) => xs.reduce((sum, x) => sum + p(x) * q(x), 0);
  const tool0 = (x: number) => tool(x, 0);
  const user0 = (x: number) => user(x, 0);
  const toolNorm = dot(tool0, tool0);
  if (toolNorm > 1e-8) {
    const alpha = dot(user0, tool0) / toolNorm;
    const scaled = xs.reduce((sum, x) => sum + (user0(x) - alpha * tool0(x)) ** 2, 0);
    const userNorm = dot(user0, user0);
    if ((Math.abs(alpha - 2) < 0.15 || Math.abs(alpha - 0.5) < 0.15) && scaled < 0.02 * Math.max(userNorm, 1e-8)) {
      found.push('The normalization is off by a factor of 2, which is what happens when 2/L is used in place of 1/L or the other way around.');
    }
  }
  const length = right - left;
  const sine = (x: number) => Math.sin((Math.PI * (x - left)) / length);
  const cosine = (x: number) => Math.cos((Math.PI * (x - left)) / length);
  const sineEnergy = Math.abs(dot(user0, sine));
  const cosineEnergy = Math.abs(dot(user0, cosine));
  const dirichlet = problem.domain.left.kind === 'dirichlet' && problem.domain.right.kind === 'dirichlet';
  const neumann = problem.domain.left.kind === 'neumann' && problem.domain.right.kind === 'neumann';
  if (dirichlet && cosineEnergy > 2 * sineEnergy && cosineEnergy > 0.2 * Math.sqrt(dot(user0, user0) + 1e-8)) {
    found.push('These boundary conditions use sine modes, but the answer follows the cosine family.');
  }
  if (neumann && sineEnergy > 2 * cosineEnergy && sineEnergy > 0.2 * Math.sqrt(dot(user0, user0) + 1e-8)) {
    found.push('These boundary conditions use cosine modes, but the answer follows the sine family.');
  }
  if (neumann || problem.domain.periodic) {
    const meanTool = xs.reduce((sum, x) => sum + tool0(x), 0) / xs.length;
    const meanUser = xs.reduce((sum, x) => sum + user0(x), 0) / xs.length;
    const shift = meanTool - meanUser;
    const shifted = xs.reduce((sum, x) => sum + (user0(x) + shift - tool0(x)) ** 2, 0);
    const scale = xs.reduce((sum, x) => sum + tool0(x) ** 2, 0);
    if (Math.abs(shift) > 0.2 * Math.max(1, Math.abs(meanTool)) && shifted < 0.02 * Math.max(scale, 1e-8)) {
      found.push('The Neumann constant mode is missing; the mean of the initial data does not decay.');
    }
  }
  found.push(...robinDiagnosis(problem, user));
  return found;
}

function robinDiagnosis(problem: PdeProblem, user: (x: number, t: number) => number): string[] {
  if (problem.family !== 'heat' || problem.domain.kind !== 'interval') return [];
  const params = parameterScope(problem);
  const ends: Array<{ end: EndCondition; at: number; sign: number }> = [
    { end: problem.domain.left, at: evalMath(problem.domain.leftExpr, params), sign: 1 },
    { end: problem.domain.right, at: evalMath(problem.domain.rightExpr, params), sign: -1 },
  ];
  for (const item of ends) {
    if (item.end.kind !== 'robin' || !item.end.hExpr) continue;
    const h = evalMath(item.end.hExpr, params);
    let plus = 0;
    let minus = 0;
    for (let i = 1; i <= 4; i += 1) {
      const t = 0.2 * i;
      const slope = oneSided(user, item.at, t, item.sign);
      const value = evalMath(item.end.valueExpr, { ...params, t });
      const trace = user(item.at, t);
      plus = Math.max(plus, Math.abs(slope + h * trace - value));
      minus = Math.max(minus, Math.abs(slope - h * trace - value));
    }
    if (plus > PDE_TOL && minus < PDE_TOL) {
      return ['The Robin condition is u_x + h u, but the answer matches u_x - h u.'];
    }
  }
  return [];
}

function pdeAt(problem: PdeProblem, params: Record<string, number>, user: (x: number, t: number, y?: number) => number, x: number, t: number, y: number): number {
  const h = 1e-4;
  if (problem.family === 'classify') {
    const A = evalMath(problem.aExpr, params);
    const B = evalMath(problem.bExpr, params);
    const C = evalMath(problem.cExpr, params);
    const uxx = (user(x + h, 0, y) - 2 * user(x, 0, y) + user(x - h, 0, y)) / (h * h);
    const uyy = (user(x, 0, y + h) - 2 * user(x, 0, y) + user(x, 0, y - h)) / (h * h);
    const uxy = (user(x + h, 0, y + h) - user(x + h, 0, y - h) - user(x - h, 0, y + h) + user(x - h, 0, y - h)) / (4 * h * h);
    return A * uxx + B * uxy + C * uyy;
  }
  if (problem.family === 'heat') {
    const ut = (user(x, t + h, y) - user(x, t - h, y)) / (2 * h);
    const ux = (user(x + h, t, y) - user(x - h, t, y)) / (2 * h);
    const uxx = (user(x + h, t, y) - 2 * user(x, t, y) + user(x - h, t, y)) / (h * h);
    if (problem.burgers) {
      const nu = evalMath(problem.kExpr, { ...params, x, t, y });
      return ut + user(x, t, y) * ux - nu * uxx;
    }
    const k = evalMath(problem.kExpr, { ...params, x, t, y });
    const b = evalMath(problem.bExpr, { ...params, x, t, y });
    const c = evalMath(problem.cExpr, { ...params, x, t, y });
    const source = evalMath(problem.sourceExpr, { ...params, x, t, y });
    const uyy = problem.domain.kind === 'rectangle' ? (user(x, t, y + h) - 2 * user(x, t, y) + user(x, t, y - h)) / (h * h) : 0;
    const radial = problem.domain.kind === 'disk' && Math.abs(x) > 5 * h;
    const laplacian = radial ? uxx + ux / x : uxx + uyy;
    return ut - k * laplacian - b * ux - c * user(x, t, y) - source;
  }
  if (problem.eikonal) {
    const ux = (user(x + h, t, y) - user(x - h, t, y)) / (2 * h);
    const uy = (user(x, t, y + h) - user(x, t, y - h)) / (2 * h);
    return ux * ux + uy * uy - 1;
  }
  const trace = user(x, t, y);
  const scope = { ...params, x, t, y, u: trace };
  const a = evalMath(problem.aExpr, scope);
  const b = evalMath(problem.bExpr, scope);
  const c = evalMath(problem.cExpr, scope);
  const d = evalMath(problem.dExpr, scope);
  if (problem.vars === 'xy') {
    const ux = (user(x + h, 0, t + h) - user(x - h, 0, t - h)) / (2 * h);
    const uy = (user(x, 0, t + h) - user(x, 0, t - h)) / (2 * h);
    return a * ux + b * uy + c * trace - d;
  }
  const ux = (user(x + h, t, y) - user(x - h, t, y)) / (2 * h);
  const ut = (user(x, t + h, y) - user(x, t - h, y)) / (2 * h);
  return a * ux + b * ut + c * trace - d;
}

function initialError(problem: PdeProblem, params: Record<string, number>, user: (x: number, t: number, y?: number) => number): number {
  if (problem.family === 'classify') return 0;
  if (problem.family === 'heat') {
    const g = makeField(problem.initialExpr, ['x', 'y', 't', 'r'], params);
    if (problem.domain.kind === 'rectangle') {
      const x0 = evalMath(problem.domain.x0, params);
      const x1 = evalMath(problem.domain.x1, params);
      const y0 = evalMath(problem.domain.y0, params);
      const y1 = evalMath(problem.domain.y1, params);
      return maxOf(grid(x0, x1, y0, y1), (x, _t, y) => Math.abs(user(x, 0, y) - g(x, y, 0, x)));
    }
    const [a, b] = spatialWindow(problem, params);
    return maxOf(interior(a, b, 16).map((x) => ({ x, t: 0, y: 0 })), (x) => Math.abs(user(x, 0, 0) - g(x, 0, 0, x)));
  }
  if (problem.data.kind === 'cauchy') {
    const time = evalMath(problem.data.timeExpr, params);
    const g = makeField(problem.data.gExpr, ['x', 'y', 't'], params);
    const [a, b] = solutionWindow(problem);
    return maxOf(interior(a, b, 12).map((x) => ({ x, t: time, y: 0 })), (x, t) => Math.abs(user(x, t, 0) - g(x, 0, t)));
  }
  if (problem.data.kind === 'point') {
    const x = evalMath(problem.data.xExpr, params);
    const y = evalMath(problem.data.yExpr, params);
    const value = evalMath(problem.data.uExpr, params);
    return Math.abs(user(x, 0, y) - value);
  }
  const g = makeField(problem.data.gExpr, ['x', 't'], params);
  return maxOf(interior(0, 2, 8).map((x) => ({ x, t: 0, y: 0 })), (x) => Math.abs(user(x, 0) - g(x, 0)));
}

function boundaryError(problem: PdeProblem, params: Record<string, number>, user: (x: number, t: number) => number): number {
  if (problem.family === 'classify') return 0;
  if (problem.family === 'heat') {
    if (problem.domain.kind === 'interval' && !problem.domain.periodic) {
      const left = evalMath(problem.domain.leftExpr, params);
      const right = evalMath(problem.domain.rightExpr, params);
      return Math.max(endError(problem.domain.left, user, left, params, 1), endError(problem.domain.right, user, right, params, -1));
    }
    if (problem.domain.kind === 'half') return endError(problem.domain.bc, user, 0, params, 1);
    return 0;
  }
  if (problem.data.kind === 'strip') return endError(problem.data.left, user, 0, params, 1);
  return 0;
}

function endError(end: EndCondition, user: (x: number, t: number) => number, at: number, params: Record<string, number>, sign: number): number {
  let worst = 0;
  for (let i = 1; i <= 4; i += 1) {
    const t = 0.25 * i;
    const value = evalMath(end.valueExpr, { ...params, t });
    if (end.kind === 'dirichlet') worst = Math.max(worst, Math.abs(user(at, t) - value));
    else {
      const slope = oneSided(user, at, t, sign);
      const h = end.hExpr ? evalMath(end.hExpr, { ...params, t }) : 0;
      const residual = end.kind === 'neumann' ? slope - value : slope + h * user(at, t) - value;
      worst = Math.max(worst, Math.abs(residual));
    }
  }
  return worst;
}

function oneSided(user: (x: number, t: number) => number, x: number, t: number, sign: number): number {
  const h = 1e-4;
  const direction = sign >= 0 ? 1 : -1;
  const u0 = user(x, t);
  const u1 = user(x + direction * h, t);
  const u2 = user(x + direction * 2 * h, t);
  return (direction * (-1.5 * u0 + 2 * u1 - 0.5 * u2)) / h;
}

function samplePoints(problem: PdeProblem, solution: PdeSolution): { pde: Array<{ x: number; t: number; y: number }>; compare: Array<{ x: number; t: number; y: number }> } {
  const frame = solution.frames[0];
  const x0 = frame?.xMin ?? 0;
  const x1 = frame?.xMax ?? 1;
  const tMax = Math.max(frame?.tMax ?? 1, 0.2);
  const y0 = frame?.yMin ?? 0;
  const y1 = frame?.yMax ?? 0;
  const compare = grid(x0, x1, y0, y1, tMax);
  const pde = compare.filter((point) => point.t > 0.05 * tMax);
  return { pde, compare };
  void problem;
}

function grid(x0: number, x1: number, y0: number, y1: number, tMax = 0): Array<{ x: number; t: number; y: number }> {
  const points: Array<{ x: number; t: number; y: number }> = [];
  const xs = interior(x0, x1, 8);
  const ys = y1 > y0 ? interior(y0, y1, 4) : [0];
  const ts = tMax > 0 ? [0, 0.3 * tMax, 0.7 * tMax] : [0];
  for (const x of xs) {
    for (const y of ys) {
      for (const t of ts) points.push({ x, t, y });
    }
  }
  return points;
}

function interior(a: number, b: number, count: number): number[] {
  const points: number[] = [];
  const span = b - a;
  for (let i = 0; i < count; i += 1) {
    const s = 0.08 + (0.84 * (i + 0.5)) / count;
    points.push(a + span * s);
  }
  return points;
}

function spatialWindow(problem: HeatProblem, params: Record<string, number>): [number, number] {
  const domain = problem.domain;
  if (domain.kind === 'interval') return [evalMath(domain.leftExpr, params), evalMath(domain.rightExpr, params)];
  if (domain.kind === 'half') return [0, 4];
  if (domain.kind === 'disk') return [0, evalMath(domain.radiusExpr, params)];
  return [-3, 3];
}

function solutionWindow(problem: CharProblem): [number, number] {
  void problem;
  return [-2, 2];
}

function parameterScope(problem: PdeProblem): Record<string, number> {
  const scope: Record<string, number> = { pi: Math.PI, e: Math.E };
  for (const [name, spec] of Object.entries(problem.parameters)) scope[name] = spec.value;
  return scope;
}

function maxOf(points: Array<{ x: number; t: number; y: number }>, value: (x: number, t: number, y: number) => number): number {
  let worst = 0;
  for (const point of points) {
    const next = value(point.x, point.t, point.y);
    if (Number.isFinite(next)) worst = Math.max(worst, next);
  }
  return worst;
}
