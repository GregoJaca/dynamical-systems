/**
 * Method of characteristics. Closed forms stay exact; variable projections and
 * Charpit rays call integrateRK45 rather than a second integrator.
 */

import { derivative, simplify } from 'mathjs';
import { compileMath, mentions } from '../expr';
import type { CharCurve, CharProblem, CharSolution, FieldFrame, NoteBlock, PdeObject, PdeTag } from '../types';
import { solveEikonal } from './eikonal';
import { solveBurgers } from './lax';
import { solveLinear } from './linear';

export interface BuiltChar {
  exact: boolean;
  formulaLatex: string;
  generalLatex: string;
  evaluate: (x: number, tau: number) => number;
  curves: CharCurve[];
  dataCurve: Array<{ x: number; t: number; u: number }>;
  objects: PdeObject[];
  notes: NoteBlock[];
  workedLatex: string;
  features: PdeTag[];
  warnings: string[];
  transversalityLatex: string;
  domainX: [number, number];
  domainT: [number, number];
  residualKind: 'linear' | 'burgers' | 'eikonal';
  /** Centre to avoid when differencing a point-source eikonal solution. */
  singularX?: number;
  singularT?: number;
  shock?: CharSolution['shock'];
  envelope?: CharSolution['envelope'];
  rarefactionLatex?: string;
  breaking?: CharSolution['breaking'];
  regions?: CharSolution['regions'];
  rays?: CharSolution['rays'];
  wavefronts?: CharSolution['wavefronts'];
  equalArea?: CharSolution['equalArea'];
  viscous?: CharSolution['viscous'];
}

export function solveChar(problem: CharProblem): CharSolution {
  const built = problem.eikonal ? solveEikonal(problem) : isConservation(problem) ? solveBurgers(problem) : solveLinear(problem);
  return finish(problem, built);
}

function finish(problem: CharProblem, built: BuiltChar): CharSolution {
  const tauName = problem.vars === 'xy' ? 'y' : 't';
  const frame: FieldFrame = {
    id: 'original',
    name: 'u',
    formulaLatex: built.formulaLatex,
    xName: 'x',
    tName: tauName,
    ...(problem.vars === 'xy' ? { yName: 'y' } : {}),
    xMin: built.domainX[0],
    xMax: built.domainX[1],
    tMin: built.domainT[0],
    tMax: built.domainT[1],
    unbounded: true,
    evaluate: (x, tau) => built.evaluate(x, tau),
  };
  const features = dedupe(['characteristics', ...built.features]);
  const residual = measureResidual(problem, built);
  return {
    family: 'characteristics',
    exact: built.exact,
    formulaLatex: built.formulaLatex,
    generalLatex: built.generalLatex,
    frames: [frame],
    curves: built.curves,
    dataCurve: built.dataCurve,
    objects: built.objects,
    notes: built.notes,
    workedLatex: built.workedLatex,
    features,
    warnings: built.warnings,
    vars: problem.vars,
    ...(built.shock ? { shock: built.shock } : {}),
    ...(built.envelope ? { envelope: built.envelope } : {}),
    ...(built.rarefactionLatex ? { rarefactionLatex: built.rarefactionLatex } : {}),
    ...(built.breaking ? { breaking: built.breaking } : {}),
    ...(built.regions ? { regions: built.regions } : {}),
    ...(built.rays ? { rays: built.rays } : {}),
    ...(built.wavefronts ? { wavefronts: built.wavefronts } : {}),
    ...(built.equalArea ? { equalArea: built.equalArea } : {}),
    ...(built.viscous ? { viscous: built.viscous } : {}),
    domainX: built.domainX,
    domainT: built.domainT,
    residual,
    transversalityLatex: built.transversalityLatex,
  };
}

function measureResidual(problem: CharProblem, built: BuiltChar): { pde: number; data: number } {
  const pde = pdeResidual(problem, built);
  const data = dataResidual(problem, built);
  return { pde, data };
}

function pdeResidual(problem: CharProblem, built: BuiltChar): number {
  const [x0, x1] = built.domainX;
  const [t0, t1] = built.domainT;
  const samples: number[] = [];
  for (let i = 1; i <= 4; i += 1) {
    for (let j = 1; j <= 4; j += 1) {
      const x = x0 + ((x1 - x0) * i) / 5;
      const tau = t0 + ((t1 - t0) * j) / 5;
      const value = localResidual(problem, built, x, tau);
      if (value !== null) samples.push(value);
    }
  }
  if (samples.length === 0) return 0;
  return Math.max(...samples);
}

function localResidual(problem: CharProblem, built: BuiltChar, x: number, tau: number): number | null {
  const h = 1e-4;
  const f = built.evaluate;
  const centre = f(x, tau);
  if (!Number.isFinite(centre)) return null;
  const uxL = (centre - f(x - h, tau)) / h;
  const uxR = (f(x + h, tau) - centre) / h;
  const utL = (centre - f(x, tau - h)) / h;
  const utR = (f(x, tau + h) - centre) / h;
  if (![uxL, uxR, utL, utR].every(Number.isFinite)) return null;
  if (Math.abs(uxL - uxR) > 2e-2 || Math.abs(utL - utR) > 2e-2) return null;
  const ux = 0.5 * (uxL + uxR);
  const ut = 0.5 * (utL + utR);
  if (built.residualKind === 'eikonal') {
    const radius = Math.hypot(x - (built.singularX ?? 0), tau - (built.singularT ?? 0));
    if (built.singularX !== undefined && radius < 0.25) return null;
    if (built.singularX === undefined && Math.abs(tau) < 0.2) return null;
    return Math.abs(ux * ux + ut * ut - 1);
  }
  if (built.residualKind === 'burgers') {
    if (Math.abs(tau) < 1e-3) return null;
    return Math.abs(ut + centre * ux);
  }
  const scope = coefficientScope(problem, x, tau, centre);
  const a = readCoeff(problem.aExpr, scope);
  const b = readCoeff(problem.bExpr, scope);
  const c = readCoeff(problem.cExpr, scope);
  const d = readCoeff(problem.dExpr, scope);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return Math.abs(a * ux + b * ut + c * centre - d);
}

function dataResidual(problem: CharProblem, built: BuiltChar): number {
  const data = problem.data;
  const params = parameterValues(problem);
  if (data.kind === 'point') {
    const x = readCoeff(data.xExpr, params);
    const y = readCoeff(data.yExpr, params);
    const u = readCoeff(data.uExpr, params);
    return Math.abs(built.evaluate(x, y) - u);
  }
  if (data.kind === 'strip') {
    const g = compileMath(data.gExpr, ['x', 't', 'y']);
    const boundary = compileMath(data.left.valueExpr, ['t', 'x', 'y']);
    let worst = 0;
    for (const x of [0.25, 0.8, 1.5, 2.5]) {
      const gap = Math.abs(built.evaluate(x, 0) - g({ ...params, x, t: 0, y: 0 }));
      if (Number.isFinite(gap)) worst = Math.max(worst, gap);
    }
    for (const t of [0.25, 0.8, 1.5]) {
      const gap = Math.abs(built.evaluate(0, t) - boundary({ ...params, t, x: 0, y: 0 }));
      if (Number.isFinite(gap)) worst = Math.max(worst, gap);
    }
    return worst;
  }
  const t0 = readCoeff(data.timeExpr, params);
  const g = compileMath(data.gExpr, ['x', 't', 'y']);
  const [x0, x1] = built.domainX;
  let worst = 0;
  for (let index = 0; index < 8; index += 1) {
    const x = x0 + ((x1 - x0) * (index + 0.5)) / 8;
    const gap = Math.abs(built.evaluate(x, t0) - g({ ...params, x, t: t0, y: t0 }));
    if (Number.isFinite(gap)) worst = Math.max(worst, gap);
  }
  return worst;
}

function isConservation(problem: CharProblem): boolean {
  if (problem.eikonal || problem.vars !== 'xt') return false;
  if (problem.fluxExpr) return true;
  if (!problem.quasilinear) return false;
  const params = parameterValues(problem);
  const b = constantOf(problem.bExpr, params);
  const d = constantOf(problem.dExpr, params);
  if (b === null || Math.abs(b) < 1e-12 || d === null || Math.abs(d) > 1e-10) return false;
  if (mentions(problem.aExpr, 'x') || mentions(problem.aExpr, 't') || mentions(problem.aExpr, 'y')) return false;
  if (!mentions(problem.aExpr, 'U') && !mentions(problem.aExpr, 'u')) return false;
  return artifactOnly(problem.aExpr, problem.cExpr, params);
}

function artifactOnly(aExpr: string, cExpr: string, params: Record<string, number>): boolean {
  try {
    const slope = derivative(aExpr, 'U').toString();
    const gap = simplify(`(${cExpr}) - (${slope}) * UX`).toString();
    if (gap === '0' || gap === '-0') return true;
    const fn = compileMath(gap, ['U', 'UX', 'x', 't', 'y', 'u']);
    for (const U of [0, 0.5, 1, -1, 2]) {
      const value = fn({ ...params, U, u: U, UX: 1, x: 0.3, t: 0.2, y: 0.2 });
      if (!Number.isFinite(value) || Math.abs(value) > 1e-6) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function coefficientScope(problem: CharProblem, x: number, tau: number, u: number): Record<string, number> {
  return {
    ...parameterValues(problem),
    x,
    t: tau,
    y: tau,
    u,
    U: u,
  };
}

function readCoeff(expr: string, scope: Record<string, number>): number {
  try {
    const value = compileMath(expr, ['x', 't', 'y', 'u', 'U', 'UX'])(scope);
    return Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function parameterValues(problem: CharProblem): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [name, spec] of Object.entries(problem.parameters)) values[name] = spec.value;
  return values;
}

export function constantOf(expr: string, params: Record<string, number>): number | null {
  if (['x', 'y', 't', 'u', 'U', 'UX', 'UY', 'UT'].some((name) => mentions(expr, name))) return null;
  try {
    const value = compileMath(expr, [])(params);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function dedupe(tags: PdeTag[]): PdeTag[] {
  const seen = new Set<PdeTag>();
  const out: PdeTag[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
