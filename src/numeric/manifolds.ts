/**
 * Local stable, unstable, and center manifolds.
 * Power series solve the invariance equation in real eigen-coordinates.
 * For x' = x, y' = -y + x^2 the unstable series is y = x^2/3 and the stable series is x = 0.
 */

import { derivative, parse, type MathNode } from 'mathjs';
import type { CompiledSystem, EquilibriumAnalysis, ManifoldBranch, SystemSpec, ViewportBounds } from '../core/types';
import { latexNumber, seriesMonomialLatex, substituteExpr, substituteNumbers } from './algebra';
import { symbolToLatex } from '../input/parser';
import { invert2 } from './linearAlgebra';
import { integrateRK45 } from './rk45';

const SERIES_DEGREE = 5;

export function computeManifolds(
  spec: SystemSpec,
  compiled: CompiledSystem,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
): ManifoldBranch[] {
  if (spec.dimension !== 2 || spec.stateVars.length < 2) return [];
  const branches: ManifoldBranch[] = [];
  for (const eq of equilibria) {
    const real = realDirections(eq);
    if (real.length < 2) continue;
    for (const tangent of real) {
      const transverse = real.find((other) => other !== tangent);
      if (!transverse) continue;
      const kind = kindOf(tangent.re);
      if (!kind) continue;
      if (kind !== 'Wc' && Math.abs(transverse.re) < 1e-7 && Math.abs(tangent.re) > 1e-7) {
        /* A hyperbolic direction paired only with a center is still a valid graph. */
      }
      const series = manifoldSeries(spec, eq, tangent.vector, tangent.re, transverse.vector, transverse.re);
      if (!series) continue;
      const signs: Array<1 | -1> = [1, -1];
      for (const sign of signs) {
        const points = traceBranch(compiled, eq, tangent.vector, sign, kind, viewport, equilibria);
        const length = polylineLength(points);
        branches.push({
          id: `${eq.id}-${kind}-${sign > 0 ? 'p' : 'm'}`,
          equilibriumId: eq.id,
          kind,
          sign,
          points,
          arclength: length,
          taylorSeriesLatex: series.taylorLatex,
          reducedDynamicsLatex: kind === 'Wc' ? series.reducedLatex : undefined,
        });
      }
      if (kind === 'Wc' && series.reduced) {
        applyCenterStability(eq, series.reduced, transverse.re);
      }
    }
  }
  return branches;
}

interface Direction {
  re: number;
  vector: number[];
}

function realDirections(eq: EquilibriumAnalysis): Direction[] {
  const directions: Direction[] = [];
  eq.eigenvalues.forEach((lambda, index) => {
    if (Math.abs(lambda.im) > 1e-7) return;
    const vector = eq.eigenvectors[index];
    if (!vector) return;
    directions.push({ re: lambda.re, vector });
  });
  return directions;
}

function kindOf(realPart: number): 'Ws' | 'Wu' | 'Wc' | null {
  if (realPart > 1e-7) return 'Wu';
  if (realPart < -1e-7) return 'Ws';
  if (Math.abs(realPart) <= 1e-7) return 'Wc';
  return null;
}

interface SeriesResult {
  taylorLatex: string;
  reducedLatex?: string;
  reduced?: { degree: number; coeff: number };
}

function manifoldSeries(
  spec: SystemSpec,
  eq: EquilibriumAnalysis,
  tangent: number[],
  lambdaTangent: number,
  transverse: number[],
  lambdaTransverse: number,
): SeriesResult | null {
  const [xName, yName] = spec.stateVars;
  if (!xName || !yName) return null;
  const P = [
    [tangent[0] ?? 0, transverse[0] ?? 0],
    [tangent[1] ?? 0, transverse[1] ?? 0],
  ];
  const inverse = invert2(P);
  if (!inverse) return null;
  const parameterValues = Object.fromEntries(Object.entries(spec.parameters).map(([name, item]) => [name, item.value]));
  const affine: Record<string, string> = {
    [xName]: `(${formatOffset(eq.coords[0] ?? 0)} + (${formatOffset(P[0]?.[0] ?? 0)}) * u + (${formatOffset(P[0]?.[1] ?? 0)}) * v)`,
    [yName]: `(${formatOffset(eq.coords[1] ?? 0)} + (${formatOffset(P[1]?.[0] ?? 0)}) * u + (${formatOffset(P[1]?.[1] ?? 0)}) * v)`,
  };
  const composed = spec.rhsExpressions.slice(0, 2).map((expr) => substituteExpr(substituteNumbers(expr, parameterValues), affine));
  const f1 = `((${formatOffset(inverse[0]?.[0] ?? 0)}) * (${composed[0]}) + (${formatOffset(inverse[0]?.[1] ?? 0)}) * (${composed[1]}))`;
  const f2 = `((${formatOffset(inverse[1]?.[0] ?? 0)}) * (${composed[0]}) + (${formatOffset(inverse[1]?.[1] ?? 0)}) * (${composed[1]}))`;
  const coeff1 = taylorCoefficients(f1);
  const coeff2 = taylorCoefficients(f2);
  if (!coeff1 || !coeff2) return null;
  if (Math.abs((coeff1[1]?.[0] ?? 0) - lambdaTangent) > 5e-2 && Math.abs(lambdaTangent) > 1e-6) return null;
  if (Math.abs((coeff2[0]?.[1] ?? 0) - lambdaTransverse) > 5e-2 && Math.abs(lambdaTransverse) > 1e-6) return null;

  const max = SERIES_DEGREE;
  const h: number[] = Array(max + 1).fill(0);
  for (let degree = 2; degree <= max; degree += 1) {
    const left = composeField(coeff1, h, max);
    const right = composeField(coeff2, h, max);
    const derivativeSeries = differentiateSeries(h, max);
    const product = multiplySeries(derivativeSeries, left, max);
    const denom = degree * lambdaTangent - lambdaTransverse;
    if (Math.abs(denom) < 1e-8) {
      h[degree] = 0;
      continue;
    }
    h[degree] = ((right[degree] ?? 0) - (product[degree] ?? 0)) / denom;
  }
  const reducedSeries = composeField(coeff1, h, max);
  const taylorLatex = graphLatex(spec.stateVars, eq.coords, tangent, transverse, h);
  let reduced: { degree: number; coeff: number } | undefined;
  for (let degree = 2; degree <= max; degree += 1) {
    if (Math.abs(reducedSeries[degree] ?? 0) > 1e-8) {
      reduced = { degree, coeff: reducedSeries[degree] ?? 0 };
      break;
    }
  }
  const printedDegree = reducedSeries.reduce((last, value, index) => (Math.abs(value) > 1e-8 ? index : last), 0);
  const reducedLatex = reduced
    ? `\\dot{u} = ${seriesMonomialLatex(reducedSeries, 'u')}${higherRemainder(reducedSeries, printedDegree)}`
    : undefined;
  return { taylorLatex, reducedLatex, reduced };
}

function taylorCoefficients(expr: string): number[][] | null {
  const degree = SERIES_DEGREE;
  const table: number[][] = Array.from({ length: degree + 1 }, () => Array(degree + 1).fill(0));
  const parsed = parse(expr);
  let current: MathNode = Array.isArray(parsed) ? parsed[0]! : parsed;
  const uDerivatives = [current];
  for (let i = 1; i <= degree; i += 1) {
    try {
      current = derivative(current, 'u');
    } catch {
      return null;
    }
    uDerivatives.push(current);
  }
  for (let i = 0; i <= degree; i += 1) {
    let node = uDerivatives[i]!;
    for (let j = 0; j <= degree - i; j += 1) {
      try {
        const value = Number(node.evaluate({ u: 0, v: 0 }));
        if (!Number.isFinite(value)) return null;
        table[i]![j] = value / (factorial(i) * factorial(j));
      } catch {
        return null;
      }
      if (j < degree - i) {
        try {
          node = derivative(node, 'v');
        } catch {
          return null;
        }
      }
    }
  }
  return table;
}

function composeField(coeff: number[][], h: number[], max: number): number[] {
  const powers: number[][] = [[1]];
  for (let power = 1; power <= max; power += 1) powers.push(multiplySeries(powers[power - 1]!, h, max));
  const acc = Array(max + 1).fill(0);
  for (let i = 0; i < coeff.length; i += 1) {
    for (let j = 0; j < (coeff[i]?.length ?? 0); j += 1) {
      const weight = coeff[i]?.[j] ?? 0;
      if (Math.abs(weight) < 1e-15) continue;
      const monomial = Array(max + 1).fill(0);
      if (i <= max) monomial[i] = 1;
      const term = multiplySeries(monomial, powers[j] ?? [1], max);
      for (let k = 0; k <= max; k += 1) acc[k] += weight * (term[k] ?? 0);
    }
  }
  return acc;
}

function multiplySeries(a: number[], b: number[], max: number): number[] {
  const out = Array(max + 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length && i + j <= max; j += 1) out[i + j] += (a[i] ?? 0) * (b[j] ?? 0);
  }
  return out;
}

function differentiateSeries(h: number[], max: number): number[] {
  const out = Array(max + 1).fill(0);
  for (let i = 1; i < h.length && i - 1 <= max; i += 1) out[i - 1] = i * (h[i] ?? 0);
  return out;
}

function graphLatex(vars: string[], coords: number[], tangent: number[], transverse: number[], h: number[]): string {
  const xLatex = symbolToLatex(vars[0] ?? 'x');
  const yLatex = symbolToLatex(vars[1] ?? 'y');
  const axis = axisAligned(tangent, transverse);
  const polynomial = seriesMonomialLatex(h, 'u');
  if (axis === 'horizontal') {
    const along = Math.abs(coords[0] ?? 0) < 1e-5 ? xLatex : `(${xLatex}-${latexNumber(coords[0] ?? 0)})`;
    const shifted = retargetSeries(polynomial, along);
    const scale = transverse[1] ?? 1;
    const expression = Math.abs(scale - 1) < 1e-8 ? shifted : scaleExpression(shifted, scale);
    if (Math.abs(coords[1] ?? 0) < 1e-5) return `${yLatex} = ${expression}`;
    return `${yLatex} = ${latexNumber(coords[1] ?? 0)}+${expression}`;
  }
  if (axis === 'vertical') {
    if (polynomial === '0') return `${xLatex} = ${latexNumber(coords[0] ?? 0)}`;
    const along = Math.abs(coords[1] ?? 0) < 1e-5 ? yLatex : `(${yLatex}-${latexNumber(coords[1] ?? 0)})`;
    const shifted = retargetSeries(polynomial, along);
    const scale = transverse[0] ?? 1;
    const expression = Math.abs(scale - 1) < 1e-8 ? shifted : scaleExpression(shifted, scale);
    return `${xLatex} = ${expression}`;
  }
  return `v = ${polynomial}`;
}

function retargetSeries(polynomial: string, along: string): string {
  return polynomial.replace(/u\^\{(\d+)\}/g, `${along}^{$1}`).replace(/u/g, along);
}

function scaleExpression(expression: string, scale: number): string {
  if (expression === '0') return '0';
  return `${latexNumber(scale)}\\left(${expression}\\right)`;
}

function axisAligned(tangent: number[], transverse: number[]): 'horizontal' | 'vertical' | 'tilted' {
  const t = [tangent[0] ?? 0, tangent[1] ?? 0];
  const n = [transverse[0] ?? 0, transverse[1] ?? 0];
  if (Math.abs(t[0]!) > 0.98 && Math.abs(t[1]!) < 0.05 && Math.abs(n[1]!) > 0.98 && Math.abs(n[0]!) < 0.05) return 'horizontal';
  if (Math.abs(t[1]!) > 0.98 && Math.abs(t[0]!) < 0.05 && Math.abs(n[0]!) > 0.98 && Math.abs(n[1]!) < 0.05) return 'vertical';
  return 'tilted';
}

function reducedMonomial(coeff: number, degree: number): string {
  const coeffs = Array(Math.max(degree, 0) + 1).fill(0) as number[];
  if (degree >= 1) coeffs[degree] = coeff;
  return seriesMonomialLatex(coeffs, 'u');
}

function higherRemainder(series: number[], leading: number): string {
  const next = series.findIndex((value, index) => index > leading && Math.abs(value) > 1e-8);
  if (next < 0) return '';
  return ` + O(u^{${next}})`;
}

function applyCenterStability(eq: EquilibriumAnalysis, reduced: { degree: number; coeff: number }, transverseReal: number): void {
  if (transverseReal > 1e-7) {
    eq.stability = 'unstable';
    eq.stabilityReasonLatex = 'The transverse eigenvalue is positive, so the equilibrium is unstable.';
    return;
  }
  if (reduced.degree % 2 === 1 && reduced.coeff < 0 && transverseReal < -1e-7) {
    eq.stability = 'asymptotically_stable';
    eq.classification2D = eq.classification2D === 'saddle_node' ? 'unknown_non_hyperbolic' : eq.classification2D;
    eq.stabilityReasonLatex = `On the center manifold, \\(\\dot{u} = ${reducedMonomial(reduced.coeff, reduced.degree)}\\) with a stable transverse eigenvalue, so the equilibrium is asymptotically stable.`;
    return;
  }
  if (reduced.degree % 2 === 0) {
    eq.stability = 'semi_stable';
    eq.classification2D = 'saddle_node';
    eq.stabilityReasonLatex = `The reduced center dynamics \\(\\dot{u} = ${reducedMonomial(reduced.coeff, reduced.degree)}\\) have even degree, so the equilibrium is semi-stable.`;
    return;
  }
  if (reduced.coeff > 0) {
    eq.stability = 'unstable';
    eq.stabilityReasonLatex = 'The leading center-manifold coefficient is positive, so the equilibrium is unstable.';
  }
}

function traceBranch(
  compiled: CompiledSystem,
  eq: EquilibriumAnalysis,
  direction: number[],
  sign: 1 | -1,
  kind: 'Ws' | 'Wu' | 'Wc',
  viewport: ViewportBounds,
  equilibria: EquilibriumAnalysis[],
): number[][] {
  const epsilon = 1e-4;
  const seed = eq.coords.map((value, index) => value + sign * epsilon * (direction[index] ?? 0));
  const span = Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin, 1);
  const time = kind === 'Ws' ? -180 : 180;
  const targets = equilibria.filter((other) => other.id !== eq.id);
  const result = integrateRK45({
    t0: 0,
    t1: time,
    y0: seed,
    params: compiled.parameterValues,
    f: compiled.f,
    rtol: 1e-8,
    atol: 1e-10,
    maxSteps: 12_000,
    viewport,
    viewportMargin: 1.2,
    equilibria: targets.map((other) => ({ id: other.id, coords: other.coords })),
    equilibriumRadius: Math.max(0.03, span * 0.02),
    velocityStop: 1e-3,
    sampleDistance: Math.max(span / 180, 0.015),
    blowUpRadius: 1e4,
  });
  const points = [eq.coords.slice(), ...result.y];
  const arrival = targets.find((other) => other.id === result.equilibriumId);
  if (arrival) points.push(arrival.coords.slice());
  return dedupePoints(points);
}

function dedupePoints(points: number[][]): number[][] {
  const out: number[][] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(...point.map((value, index) => value - (last[index] ?? 0))) > 1e-8) out.push(point);
  }
  return out;
}

function polylineLength(points: number[][]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(...(points[i] ?? []).map((value, index) => value - (points[i - 1]?.[index] ?? 0)));
  }
  return length;
}

function factorial(n: number): number {
  let value = 1;
  for (let i = 2; i <= n; i += 1) value *= i;
  return value;
}

function formatOffset(value: number): string {
  if (Math.abs(value) < 1e-12) return '0';
  const text = Number(value.toPrecision(12)).toString();
  return text.startsWith('-') ? `(${text})` : text;
}
