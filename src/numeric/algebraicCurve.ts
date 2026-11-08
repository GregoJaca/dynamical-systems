import { EigenvalueDecomposition, Matrix } from 'ml-matrix';
import { parse, type MathNode } from 'mathjs';
import type { ViewportBounds } from '../core/types';
import { rationalize, substituteNumbers, toPolynomial, type Poly } from './algebra';

/**
 * Zero sets of planar expressions.
 * Polynomials are factored and drawn from the closed form (lines, conics, univariate roots).
 * Anything else is an adaptive implicit curve whose chord stays within a fraction of the frame.
 */

type Bounds = Pick<ViewportBounds, 'xMin' | 'xMax' | 'yMin' | 'yMax'>;

export function algebraicZeroSet(
  expression: string,
  vars: [string, string],
  parameters: Record<string, number>,
  bounds: Bounds,
): { polylines: number[][][]; exact: boolean } | null {
  let substituted = expression;
  try {
    substituted = substituteNumbers(expression, parameters);
  } catch {
    return null;
  }
  const factors = multiplicativeFactors(substituted);
  const polylines: number[][][] = [];
  let exact = true;
  for (const factor of factors) {
    const drawn = drawFactor(factor, vars, bounds);
    if (!drawn) {
      const traced = traceExpression(factor, vars, bounds);
      if (traced.length === 0) exact = false;
      polylines.push(...traced);
      exact = false;
      continue;
    }
    polylines.push(...drawn.polylines);
    exact &&= drawn.exact;
  }
  return { polylines, exact };
}

export function traceImplicit(
  valueAt: (x: number, y: number) => number,
  bounds: Bounds,
  tolerance: number,
): number[][][] {
  const segments: Array<[number, number, number, number]> = [];
  let evaluations = 0;
  const budget = 14_000;
  const cached = new Map<string, number>();
  const at = (x: number, y: number): number => {
    const key = `${x.toFixed(8)},${y.toFixed(8)}`;
    const hit = cached.get(key);
    if (hit !== undefined) return hit;
    evaluations += 1;
    let value = Number.NaN;
    try {
      value = valueAt(x, y);
    } catch {
      value = Number.NaN;
    }
    if (!Number.isFinite(value)) value = Number.NaN;
    cached.set(key, value);
    return value;
  };

  const stack: Array<{ x0: number; x1: number; y0: number; y1: number; depth: number }> = [];
  const nx = 16;
  const ny = 16;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      stack.push({
        x0: bounds.xMin + ((bounds.xMax - bounds.xMin) * i) / nx,
        x1: bounds.xMin + ((bounds.xMax - bounds.xMin) * (i + 1)) / nx,
        y0: bounds.yMin + ((bounds.yMax - bounds.yMin) * j) / ny,
        y1: bounds.yMin + ((bounds.yMax - bounds.yMin) * (j + 1)) / ny,
        depth: 0,
      });
    }
  }

  let cells = 0;
  while (stack.length > 0 && cells < 5000 && evaluations < budget) {
    const cell = stack.pop()!;
    cells += 1;
    const corners = [
      [cell.x0, cell.y0, at(cell.x0, cell.y0)],
      [cell.x1, cell.y0, at(cell.x1, cell.y0)],
      [cell.x1, cell.y1, at(cell.x1, cell.y1)],
      [cell.x0, cell.y1, at(cell.x0, cell.y1)],
    ] as Array<[number, number, number]>;
    if (corners.some((corner) => !Number.isFinite(corner[2]))) continue;
    const hits = cellRoots(at, corners);
    const diagonal = Math.hypot(cell.x1 - cell.x0, cell.y1 - cell.y0);
    const coarse = diagonal > tolerance * 2 && cell.depth < 7 && evaluations < budget;
    if (hits.length >= 2 && coarse && hits.some((hit, index) => index > 0 && chordFar(at, hits[0]!, hit, tolerance))) {
      split(stack, cell);
      continue;
    }
    if (hits.length < 2 && coarse && grazes(corners, at, cell)) {
      split(stack, cell);
      continue;
    }
    pairRoots(hits, at((cell.x0 + cell.x1) / 2, (cell.y0 + cell.y1) / 2)).forEach(([a, b]) => {
      segments.push([a[0], a[1], b[0], b[1]]);
    });
  }
  return stitch(segments, tolerance);
}

function drawFactor(
  factor: string,
  vars: [string, string],
  bounds: Bounds,
): { polylines: number[][][]; exact: boolean } | null {
  const poly = toPolynomial(factor, vars);
  if (!poly) return null;
  const pieces = factorPolynomial(poly);
  const polylines: number[][][] = [];
  let exact = true;
  for (const piece of pieces) {
    const drawn = drawPolynomial(piece, bounds);
    polylines.push(...drawn.polylines);
    exact &&= drawn.exact;
  }
  return { polylines, exact };
}

function drawPolynomial(poly: Poly, bounds: Bounds): { polylines: number[][][]; exact: boolean } {
  const coeff = (i: number, j: number) => poly.get(i === 0 && j === 0 ? '' : `${i},${j}`) ?? 0;
  const degree = totalDegree(poly);
  if (degree <= 0) return { polylines: [], exact: true };
  const onlyX = [...poly.keys()].every((key) => !key || (key.split(',')[1] ?? '0') === '0');
  const onlyY = [...poly.keys()].every((key) => !key || (key.split(',')[0] ?? '0') === '0');
  if (onlyX || onlyY) {
    const roots = univariateRoots(poly, onlyX ? 0 : 1, onlyX ? bounds.xMin : bounds.yMin, onlyX ? bounds.xMax : bounds.yMax);
    const lines = roots.map((root) => (onlyX ? vertical(root, bounds) : horizontal(root, bounds))).filter((line): line is number[][] => line != null);
    return { polylines: lines, exact: degree <= 4 };
  }
  if (degree === 1) {
    const line = clipInfiniteLine(coeff(1, 0), coeff(0, 1), coeff(0, 0), bounds);
    return { polylines: line ? [line] : [], exact: true };
  }
  if (degree === 2) {
    const conic = drawConic(coeff(2, 0), coeff(1, 1), coeff(0, 2), coeff(1, 0), coeff(0, 1), coeff(0, 0), bounds);
    if (conic) return { polylines: conic, exact: true };
  }
  if (degree <= 4) {
    const swept = sweepPolynomial(poly, bounds);
    if (swept.length > 0) return { polylines: swept, exact: false };
  }
  const tolerance = spanOf(bounds) / 2000;
  const polylines = traceImplicit((x, y) => evaluatePoly(poly, x, y), bounds, tolerance);
  return { polylines, exact: false };
}

function factorPolynomial(poly: Poly): Poly[] {
  let current = cleanup(poly);
  const factors: Poly[] = [];
  for (let guard = 0; guard < 8; guard += 1) {
    if (totalDegree(current) < 2) break;
    const linear = findLinearFactor(current);
    if (linear) {
      factors.push(linear.factor);
      current = linear.quotient;
      continue;
    }
    const quadratic = findQuadraticFactor(current);
    if (!quadratic) break;
    factors.push(quadratic.factor);
    current = quadratic.quotient;
  }
  if (totalDegree(current) > 0) factors.push(current);
  return factors.length > 0 ? factors : [poly];
}

/** A degree-4 polynomial with small integer coefficients may be a product of two conics. */
function findQuadraticFactor(poly: Poly): { factor: Poly; quotient: Poly } | null {
  const integer = integerPoly(poly);
  if (!integer || totalDegree(integer) < 4 || totalDegree(integer) > 4) return null;
  const swap = axisDegree(integer, 1) > axisDegree(integer, 0);
  const oriented = swap ? transposePoly(integer) : integer;
  const split = splitAlongX(oriented);
  if (!split) return null;
  const factor = swap ? transposePoly(split.factor) : split.factor;
  const quotient = swap ? transposePoly(split.quotient) : split.quotient;
  return samePoly(multiplyPoly(factor, quotient), integer) ? { factor, quotient } : null;
}

function splitAlongX(poly: Poly): { factor: Poly; quotient: Poly } | null {
  const degree = axisDegree(poly, 0);
  const coeffs = Array.from({ length: degree + 1 }, (_, power) => yCoeffs(poly, power));
  if (degree === 4) return splitQuarticInX(coeffs);
  if (degree === 2) return splitQuadraticInX(coeffs);
  return null;
}

function splitQuarticInX(coeffs: number[][]): { factor: Poly; quotient: Poly } | null {
  const leadRow = coeffs[4] ?? [];
  if (degreeOf(leadRow) > 0) return null;
  const lead = leadRow[0] ?? 0;
  const splits = univariateSplits(coeffs[0] ?? [0]);
  for (const a of positiveDivisors(lead)) {
    const other = lead / a;
    for (const [leftConstant, rightConstant] of splits) {
      if (degreeOf(leftConstant) > 2 || degreeOf(rightConstant) > 2) continue;
      const solved = solveCrossTerms(a, other, leftConstant, rightConstant, coeffs);
      if (!solved) continue;
      const [b, c, bp, cp] = solved;
      const factor = quadraticPoly(a, b, c, leftConstant);
      const quotient = quadraticPoly(other, bp, cp, rightConstant);
      return { factor, quotient };
    }
  }
  return null;
}

function splitQuadraticInX(coeffs: number[][]): { factor: Poly; quotient: Poly } | null {
  const leadRow = coeffs[2] ?? [];
  if (degreeOf(leadRow) > 0) return null;
  const lead = leadRow[0] ?? 0;
  for (const a of positiveDivisors(lead)) {
    const other = lead / a;
    for (const [leftConstant, rightConstant] of univariateSplits(coeffs[0] ?? [0])) {
      if (degreeOf(leftConstant) > 2 || degreeOf(rightConstant) > 2) continue;
      const cross = addSeries(scaleSeries(rightConstant, a), scaleSeries(leftConstant, other));
      if (!sameSeries(cross, coeffs[1] ?? [0])) continue;
      return {
        factor: quadraticPoly(0, 0, a, leftConstant),
        quotient: quadraticPoly(0, 0, other, rightConstant),
      };
    }
  }
  return null;
}

function solveCrossTerms(a: number, other: number, left: number[], right: number[], coeffs: number[][]): number[] | null {
  const cubic = coeffs[3] ?? [];
  const linear = coeffs[1] ?? [];
  if (degreeOf(cubic) > 1 || degreeOf(linear) > 3) return null;
  const rows: number[][] = [];
  const push = (b: number, c: number, bp: number, cp: number, rhs: number) => rows.push([b, c, bp, cp, rhs]);
  push(other, 0, a, 0, cubic[1] ?? 0);
  push(0, other, 0, a, cubic[0] ?? 0);
  for (let power = 0; power <= 3; power += 1) {
    push(right[power - 1] ?? 0, right[power] ?? 0, left[power - 1] ?? 0, left[power] ?? 0, linear[power] ?? 0);
  }
  const solved = uniqueIntegerSolution(rows);
  if (!solved) return null;
  const [b, c, bp, cp] = solved;
  const product = addSeries(
    addSeries(scaleSeries(right, a), scaleSeries(left, other)),
    [c * cp, b * cp + c * bp, b * bp],
  );
  return sameSeries(product, coeffs[2] ?? [0]) ? solved : null;
}

function quadraticPoly(x2: number, xy: number, x: number, constant: number[]): Poly {
  const poly: Poly = new Map();
  if (x2 !== 0) addTerm(poly, 2, 0, x2);
  if (xy !== 0) addTerm(poly, 1, 1, xy);
  if (x !== 0) addTerm(poly, 1, 0, x);
  constant.forEach((coeff, power) => addTerm(poly, 0, power, coeff));
  return poly;
}

function univariateSplits(coeffs: number[]): Array<[number[], number[]]> {
  const series = trimSeries(coeffs);
  const degree = series.length - 1;
  const pairs: Array<[number[], number[]]> = [];
  if (degree === 0) {
    for (const factor of divisors(series[0] ?? 1)) pairs.push([[factor], [(series[0] ?? 1) / factor]]);
    return pairs;
  }
  if (degree === 4) {
    for (const lead of divisors(series[4] ?? 0)) {
      for (const tail of divisors(series[0] ?? 0)) {
        const otherLead = (series[4] ?? 0) / lead;
        const otherTail = (series[0] ?? 0) / tail;
        for (const [e, ep] of middleCoefficients(lead, otherLead, tail, otherTail, series)) {
          pairs.push([
            [tail, e, lead],
            [otherTail, ep, otherLead],
          ]);
        }
      }
    }
  }
  if (degree > 0 && degree <= 2) pairs.push([[1], series]);
  return pairs;
}

function middleCoefficients(lead: number, otherLead: number, tail: number, otherTail: number, series: number[]): Array<[number, number]> {
  const cubic = series[3] ?? 0;
  const linear = series[1] ?? 0;
  const target = (series[2] ?? 0) - lead * otherTail - otherLead * tail;
  const det = otherLead * tail - lead * otherTail;
  const accept = (e: number, ep: number) => isInteger(e) && isInteger(ep) && Math.abs(otherTail * e + tail * ep - linear) <= 1e-6;
  if (Math.abs(det) >= 1e-9) {
    const e = (tail * cubic - lead * linear) / det;
    const ep = (otherLead * linear - otherTail * cubic) / det;
    return Math.abs(e * ep - target) <= 1e-6 && accept(e, ep) ? [[Math.round(e), Math.round(ep)]] : [];
  }
  if (Math.abs(lead) < 1e-9) return [];
  const discriminant = cubic * cubic - 4 * otherLead * lead * target;
  if (discriminant < -1e-8) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const candidates = Math.abs(otherLead) < 1e-9 ? [cubic === 0 ? 0 : target / cubic] : [(cubic + root) / (2 * otherLead), (cubic - root) / (2 * otherLead)];
  const found: Array<[number, number]> = [];
  for (const e of candidates) {
    if (!Number.isFinite(e)) continue;
    const ep = (cubic - otherLead * e) / lead;
    if (Math.abs(e * ep - target) > 1e-6 || !accept(e, ep)) continue;
    found.push([Math.round(e), Math.round(ep)]);
  }
  return found;
}

function uniqueIntegerSolution(rows: number[][]): number[] | null {
  const matrix = rows.map((row) => row.slice());
  const unknown = 4;
  const pivotRow = Array(unknown).fill(-1);
  let row = 0;
  for (let column = 0; column < unknown && row < matrix.length; column += 1) {
    let pivot = row;
    for (let index = row + 1; index < matrix.length; index += 1) {
      if (Math.abs(matrix[index]?.[column] ?? 0) > Math.abs(matrix[pivot]?.[column] ?? 0)) pivot = index;
    }
    if (Math.abs(matrix[pivot]?.[column] ?? 0) < 1e-9) continue;
    const chosen = matrix[pivot];
    const current = matrix[row];
    if (!chosen || !current) return null;
    matrix[pivot] = current;
    matrix[row] = chosen;
    const scale = chosen[column] ?? 1;
    for (let entry = column; entry <= unknown; entry += 1) chosen[entry] = (chosen[entry] ?? 0) / scale;
    for (const other of matrix) {
      if (other === chosen) continue;
      const factor = other[column] ?? 0;
      for (let entry = column; entry <= unknown; entry += 1) other[entry] = (other[entry] ?? 0) - factor * (chosen[entry] ?? 0);
    }
    pivotRow[column] = row;
    row += 1;
  }
  for (const line of matrix) {
    const coefficients = line.slice(0, unknown).every((value) => Math.abs(value) < 1e-8);
    if (coefficients && Math.abs(line[unknown] ?? 0) > 1e-6) return null;
  }
  if (pivotRow.some((index) => index < 0)) return null;
  const solution = pivotRow.map((index) => matrix[index]?.[unknown] ?? 0);
  if (solution.some((value) => !isInteger(value))) return null;
  return solution.map((value) => Math.round(value));
}

function integerPoly(poly: Poly): Poly | null {
  const denominators: number[] = [];
  for (const value of poly.values()) {
    const rational = rationalize(value, 48);
    if (!rational) return null;
    denominators.push(rational.d);
  }
  const common = denominators.reduce((left, right) => (left * right) / gcd(left, right), 1);
  if (!Number.isFinite(common) || common > 240) return null;
  const scaled: Poly = new Map();
  for (const [key, value] of poly) {
    const next = Math.round(value * common);
    if (Math.abs(value * common - next) > 1e-6) return null;
    if (next !== 0) scaled.set(key, next);
  }
  return scaled;
}

function axisDegree(poly: Poly, axis: 0 | 1): number {
  let degree = 0;
  for (const [key, coeff] of poly) {
    if (Math.abs(coeff) < 1e-9) continue;
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    degree = Math.max(degree, axis === 0 ? (i ?? 0) : (j ?? 0));
  }
  return degree;
}

function yCoeffs(poly: Poly, powerX: number): number[] {
  const coeffs: number[] = [];
  for (const [key, coeff] of poly) {
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    if ((i ?? 0) !== powerX) continue;
    coeffs[j ?? 0] = (coeffs[j ?? 0] ?? 0) + coeff;
  }
  return trimSeries(coeffs);
}

function transposePoly(poly: Poly): Poly {
  const swapped: Poly = new Map();
  for (const [key, coeff] of poly) {
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    addTerm(swapped, j ?? 0, i ?? 0, coeff);
  }
  return swapped;
}

function multiplyPoly(left: Poly, right: Poly): Poly {
  const product: Poly = new Map();
  for (const [leftKey, leftCoeff] of left) {
    const [li, lj] = leftKey ? leftKey.split(',').map(Number) : [0, 0];
    for (const [rightKey, rightCoeff] of right) {
      const [ri, rj] = rightKey ? rightKey.split(',').map(Number) : [0, 0];
      addTerm(product, (li ?? 0) + (ri ?? 0), (lj ?? 0) + (rj ?? 0), leftCoeff * rightCoeff);
    }
  }
  return product;
}

function samePoly(left: Poly, right: Poly): boolean {
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) if (Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0)) > 1e-6) return false;
  return true;
}

function positiveDivisors(value: number): number[] {
  return divisors(value).filter((divisor) => divisor > 0);
}

function divisors(value: number): number[] {
  const rounded = Math.round(value);
  if (rounded === 0 || Math.abs(rounded) > 240) return [];
  const out: number[] = [];
  const magnitude = Math.abs(rounded);
  for (let divisor = 1; divisor <= magnitude; divisor += 1) {
    if (magnitude % divisor === 0) out.push(divisor, -divisor);
  }
  return out;
}

function degreeOf(coeffs: number[]): number {
  let degree = -1;
  coeffs.forEach((coeff, power) => {
    if (Math.abs(coeff) > 1e-9) degree = power;
  });
  return degree;
}

function trimSeries(coeffs: number[]): number[] {
  const copy = coeffs.slice();
  while (copy.length > 0 && Math.abs(copy[copy.length - 1] ?? 0) < 1e-9) copy.pop();
  return copy;
}

function scaleSeries(coeffs: number[], factor: number): number[] {
  return coeffs.map((coeff) => coeff * factor);
}

function addSeries(left: number[], right: number[]): number[] {
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, index) => (left[index] ?? 0) + (right[index] ?? 0));
}

function sameSeries(left: number[], right: number[]): boolean {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) > 1e-6) return false;
  }
  return true;
}

function isInteger(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-6;
}

function findLinearFactor(poly: Poly): { factor: Poly; quotient: Poly } | null {
  for (let p = -10; p <= 10; p += 1) {
    for (let q = -10; q <= 10; q += 1) {
      if (p < 0 || (p === 0 && q < 0)) continue;
      for (let r = -10; r <= 10; r += 1) {
        if (p === 0 && q === 0) continue;
        if (gcd3(p, q, r) !== 1) continue;
        const quotient = divideLinear(poly, p, q, r);
        if (!quotient) continue;
        return { factor: linearPoly(p, q, r), quotient };
      }
    }
  }
  return null;
}

function divideLinear(poly: Poly, p: number, q: number, r: number): Poly | null {
  const rest: Poly = new Map(poly);
  const quotient: Poly = new Map();
  for (let guard = 0; guard < 24; guard += 1) {
    const lead = leading(rest);
    if (!lead) return quotient;
    let i = lead.i;
    let j = lead.j;
    let scale = 0;
    if (lead.i > 0 && Math.abs(p) > 1e-12) {
      i = lead.i - 1;
      scale = lead.c / p;
    } else if (lead.j > 0 && Math.abs(q) > 1e-12) {
      j = lead.j - 1;
      scale = lead.c / q;
    } else return null;
    addTerm(quotient, i, j, scale);
    addTerm(rest, i + 1, j, -scale * p);
    addTerm(rest, i, j + 1, -scale * q);
    addTerm(rest, i, j, -scale * r);
  }
  return null;
}

function drawConic(a: number, b: number, c: number, d: number, e: number, f: number, bounds: Bounds): number[][][] | null {
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), Math.abs(e), Math.abs(f));
  const theta = 0.5 * Math.atan2(b, a - c);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const l1 = (a + c) / 2 + Math.hypot((a - c) / 2, b / 2);
  const l2 = (a + c) / 2 - Math.hypot((a - c) / 2, b / 2);
  const d1 = d * cos + e * sin;
  const e1 = -d * sin + e * cos;
  const eps = 1e-9 * scale;
  const toWorld = (x: number, y: number) => [cos * x - sin * y, sin * x + cos * y] as [number, number];
  if (Math.abs(l1) <= eps || Math.abs(l2) <= eps) return drawParabola(l1, l2, d1, e1, f, toWorld, cos, sin, bounds, scale);

  const cx = -d1 / (2 * l1);
  const cy = -e1 / (2 * l2);
  const rhs = (d1 * d1) / (4 * l1) + (e1 * e1) / (4 * l2) - f;
  const shift = (x: number, y: number) => toWorld(cx + x, cy + y);
  if (Math.abs(rhs) <= eps) {
    if (l1 * l2 > 0) return [];
    return crossingLines(l1, l2, shift, bounds);
  }
  const r1 = rhs / l1;
  const r2 = rhs / l2;
  if (r1 > 1e-12 && r2 > 1e-12) return clipPolyline(sampleEllipse(Math.sqrt(r1), Math.sqrt(r2), shift, bounds), bounds);
  if (r1 > 1e-12 && r2 < -1e-12) return hyperbola(Math.sqrt(r1), Math.sqrt(-r2), shift, bounds);
  if (r1 < -1e-12 && r2 > 1e-12) return hyperbola(Math.sqrt(r2), Math.sqrt(-r1), (x, y) => shift(y, x), bounds);
  return [];
}

function drawParabola(
  l1: number,
  l2: number,
  d1: number,
  e1: number,
  f: number,
  toWorld: (x: number, y: number) => [number, number],
  cos: number,
  sin: number,
  bounds: Bounds,
  scale: number,
): number[][][] {
  const eps = 1e-9 * scale;
  if (Math.abs(l1) <= eps && Math.abs(l2) <= eps) {
    if (Math.hypot(d1, e1) <= eps) return [];
    const origin = toWorld(0, 0);
    const tip = toWorld(-e1, d1);
    return directedLine(origin, tip, bounds);
  }
  const quadraticOnY = Math.abs(l1) <= eps;
  const lq = quadraticOnY ? l2 : l1;
  const linearCross = quadraticOnY ? d1 : e1;
  const linearAlong = quadraticOnY ? e1 : d1;
  if (Math.abs(linearCross) <= eps) {
    const roots = quadraticFormula(lq, linearAlong, f);
    return roots.flatMap((root) => {
      const origin = quadraticOnY ? toWorld(0, root) : toWorld(root, 0);
      const tip = quadraticOnY ? toWorld(1, root) : toWorld(root, 1);
      return directedLine(origin, tip, bounds);
    });
  }
  const range = parameterRange(bounds, cos, sin, quadraticOnY ? 1 : 0);
  const at = (t: number): [number, number] => {
    const along = -(lq * t * t + linearAlong * t + f) / linearCross;
    return quadraticOnY ? toWorld(along, t) : toWorld(t, along);
  };
  return renderGraph(at, range[0], range[1], bounds);
}

function crossingLines(
  l1: number,
  l2: number,
  shift: (x: number, y: number) => [number, number],
  bounds: Bounds,
): number[][][] {
  const s = Math.sqrt(Math.abs(l2 / l1));
  return [directedFromShift(shift, s, 1, bounds), directedFromShift(shift, -s, 1, bounds)].flat();
}

function directedFromShift(
  shift: (x: number, y: number) => [number, number],
  dx: number,
  dy: number,
  bounds: Bounds,
): number[][][] {
  return directedLine(shift(0, 0), shift(dx, dy), bounds);
}

function directedLine(origin: [number, number], tip: [number, number], bounds: Bounds): number[][][] {
  const vx = tip[0] - origin[0];
  const vy = tip[1] - origin[1];
  const line = clipInfiniteLine(vy, -vx, -vy * origin[0] + vx * origin[1], bounds);
  return line ? [line] : [];
}

function parameterRange(bounds: Bounds, cos: number, sin: number, axis: 0 | 1): [number, number] {
  const corners = [
    [bounds.xMin, bounds.yMin],
    [bounds.xMax, bounds.yMin],
    [bounds.xMax, bounds.yMax],
    [bounds.xMin, bounds.yMax],
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of corners) {
    const preX = cos * (x ?? 0) + sin * (y ?? 0);
    const preY = -sin * (x ?? 0) + cos * (y ?? 0);
    const value = axis === 0 ? preX : preY;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const pad = 0.08 * Math.max(max - min, 1e-3);
  return [min - pad, max + pad];
}

function sampleEllipse(
  rx: number,
  ry: number,
  map: (x: number, y: number) => [number, number],
  bounds: Bounds,
): number[][] {
  const knots = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI];
  const points: number[][] = [];
  for (let index = 0; index < knots.length - 1; index += 1) {
    const piece = sampleGraph((angle) => map(rx * Math.cos(angle), ry * Math.sin(angle)), knots[index] ?? 0, knots[index + 1] ?? 0, bounds);
    if (points.length > 0) piece.shift();
    points.push(...piece);
  }
  return points;
}

function hyperbola(
  semiX: number,
  semiY: number,
  map: (x: number, y: number) => [number, number],
  bounds: Bounds,
): number[][][] {
  const reach = spanOf(bounds) * 1.6;
  const limit = Math.asinh(Math.max(reach / Math.max(semiY, 1e-6), 1));
  const branches: number[][][] = [];
  for (const sign of [1, -1]) {
    branches.push(...renderGraph((t) => map(sign * semiX * Math.cosh(t), semiY * Math.sinh(t)), -limit, limit, bounds));
  }
  return branches;
}

function renderGraph(at: (t: number) => [number, number], t0: number, t1: number, bounds: Bounds): number[][][] {
  const tolerance = spanOf(bounds) / 4000;
  const pieces: number[][][] = [];
  let current: number[][] = [];
  const flush = () => {
    if (current.length > 1) pieces.push(current);
    current = [];
  };
  const rec = (left: number, right: number, depth: number) => {
    const a = at(left);
    const b = at(right);
    const midT = (left + right) / 2;
    const mid = at(midT);
    const aIn = inBounds(a, bounds);
    const bIn = inBounds(b, bounds);
    const midIn = inBounds(mid, bounds);
    const error = pointSegmentDistance(mid, a, b);
    const straight = depth > 16 || error <= tolerance;
    if (!aIn && !bIn && midIn) {
      rec(left, midT, depth + 1);
      rec(midT, right, depth + 1);
      return;
    }
    if (straight && !aIn && !bIn && !midIn) return;
    if (!straight) {
      rec(left, midT, depth + 1);
      rec(midT, right, depth + 1);
      return;
    }
    if (aIn && bIn) {
      if (current.length === 0) current.push(a);
      current.push(b);
      return;
    }
    const hit = boundaryParameter(at, left, right, bounds);
    const point = at(hit);
    if (aIn) {
      if (current.length === 0) current.push(a);
      current.push(point);
      flush();
      return;
    }
    flush();
    current = [point];
    if (bIn) current.push(b);
    else flush();
  };
  rec(t0, t1, 0);
  flush();
  return pieces;
}

function boundaryParameter(at: (t: number) => [number, number], left: number, right: number, bounds: Bounds): number {
  const startInside = inBounds(at(left), bounds);
  let lo = left;
  let hi = right;
  for (let step = 0; step < 40; step += 1) {
    const mid = (lo + hi) / 2;
    if (inBounds(at(mid), bounds) === startInside) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function sampleGraph(at: (t: number) => [number, number], t0: number, t1: number, bounds: Bounds): number[][] {
  const tolerance = spanOf(bounds) / 3500;
  const points: number[][] = [at(t0)];
  const visit = (left: number, right: number, depth: number) => {
    const a = at(left);
    const b = at(right);
    const midT = (left + right) / 2;
    const mid = at(midT);
    const error = pointSegmentDistance(mid, a, b);
    if (depth > 14 || error <= tolerance) return;
    visit(left, midT, depth + 1);
    points.push(mid);
    visit(midT, right, depth + 1);
  };
  visit(t0, t1, 0);
  points.push(at(t1));
  return points;
}

function pointSegmentDistance(point: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-14) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const cross = (point[0] - a[0]) * dy - (point[1] - a[1]) * dx;
  return Math.abs(cross) / length;
}

function quadraticFormula(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-14) {
    if (Math.abs(b) < 1e-14) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < -1e-12) return [];
  if (disc <= 1e-12) return [-b / (2 * a)];
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function sweepPolynomial(poly: Poly, bounds: Bounds): number[][][] {
  const tolerance = spanOf(bounds) / 2500;
  const count = 72;
  const xs: number[] = [];
  for (let index = 0; index <= count; index += 1) xs.push(bounds.xMin + ((bounds.xMax - bounds.xMin) * index) / count);
  if (bounds.xMin < 0 && bounds.xMax > 0) xs.push(0);
  xs.sort((left, right) => left - right);
  let samples = dedupeStations(xs).map((x) => ({ x, roots: rootsAt(poly, x, bounds) }));
  samples = insertTurns(samples, poly, bounds);
  const finished: number[][][] = [];
  let active: Array<{ y: number; points: number[][] }> = [];
  for (const sample of samples) {
    const roots = sample.roots;
    const used = new Set<number>();
    const next: Array<{ y: number; points: number[][] }> = [];
    const sortedActive = active.slice().sort((left, right) => left.y - right.y);
    if (sortedActive.length === roots.length && roots.length > 0) {
      sortedActive.forEach((branch, index) => {
        const y = roots[index] ?? branch.y;
        branch.points.push([sample.x, y]);
        branch.y = y;
        next.push(branch);
        used.add(index);
      });
    } else {
      for (const branch of sortedActive) {
        let best = -1;
        let bestDist = Infinity;
        roots.forEach((y, index) => {
          if (used.has(index)) return;
          const dist = Math.abs(y - branch.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = index;
          }
        });
        const limit = Math.max((bounds.yMax - bounds.yMin) / 18, tolerance * 80);
        if (best >= 0 && bestDist <= limit) {
          used.add(best);
          const y = roots[best] ?? branch.y;
          branch.points.push([sample.x, y]);
          branch.y = y;
          next.push(branch);
        } else if (branch.points.length > 1) finished.push(branch.points);
      }
      roots.forEach((y, index) => {
        if (!used.has(index)) next.push({ y, points: [[sample.x, y]] });
      });
    }
    active = next;
  }
  for (const branch of active) if (branch.points.length > 1) finished.push(branch.points);
  return finished.map((branch) => refineSweep(poly, branch, bounds, tolerance)).filter((branch) => branch.length > 1);
}

function insertTurns(samples: Array<{ x: number; roots: number[] }>, poly: Poly, bounds: Bounds): Array<{ x: number; roots: number[] }> {
  const extra: Array<{ x: number; roots: number[] }> = [];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const left = samples[index];
    const right = samples[index + 1];
    if (!left || !right) continue;
    if (left.roots.length === right.roots.length && gapOf(left.roots) > spanOf(bounds) / 80 && gapOf(right.roots) > spanOf(bounds) / 80) continue;
    let lo = left.x;
    let hi = right.x;
    for (let step = 0; step < 18; step += 1) {
      const mid = (lo + hi) / 2;
      const roots = rootsAt(poly, mid, bounds);
      extra.push({ x: mid, roots });
      if (roots.length === left.roots.length) lo = mid;
      else hi = mid;
    }
  }
  const merged = [...samples, ...extra].sort((left, right) => left.x - right.x);
  const unique: Array<{ x: number; roots: number[] }> = [];
  for (const sample of merged) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last.x - sample.x) < 1e-7) unique[unique.length - 1] = sample;
    else unique.push(sample);
  }
  return unique;
}

function refineSweep(poly: Poly, points: number[][], bounds: Bounds, tolerance: number): number[][] {
  let current = points.map((point) => point.slice());
  for (let pass = 0; pass < 6; pass += 1) {
    const next: number[][] = [];
    let changed = false;
    for (let index = 0; index < current.length - 1; index += 1) {
      const left = current[index];
      const right = current[index + 1];
      if (!left || !right) continue;
      next.push(left);
      const midX = ((left[0] ?? 0) + (right[0] ?? 0)) / 2;
      const guess = ((left[1] ?? 0) + (right[1] ?? 0)) / 2;
      const root = closestRoot(poly, midX, guess, bounds);
      if (root == null) continue;
      const error = pointSegmentDistance([midX, root], [left[0] ?? 0, left[1] ?? 0], [right[0] ?? 0, right[1] ?? 0]);
      if (error > tolerance) {
        next.push([midX, root]);
        changed = true;
      }
    }
    const last = current[current.length - 1];
    if (last) next.push(last);
    current = next;
    if (!changed || current.length > 900) break;
  }
  return current;
}

function closestRoot(poly: Poly, x: number, guess: number, bounds: Bounds): number | null {
  const roots = rootsAt(poly, x, bounds);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const root of roots) {
    const dist = Math.abs(root - guess);
    if (dist < bestDist) {
      bestDist = dist;
      best = root;
    }
  }
  if (best == null || bestDist > (bounds.yMax - bounds.yMin) / 8) return null;
  return best;
}

function gapOf(roots: number[]): number {
  if (roots.length < 2) return Infinity;
  let gap = Infinity;
  for (let index = 1; index < roots.length; index += 1) gap = Math.min(gap, Math.abs((roots[index] ?? 0) - (roots[index - 1] ?? 0)));
  return gap;
}

function dedupeStations(xs: number[]): number[] {
  const sorted = xs.slice().sort((left, right) => left - right);
  const out: number[] = [];
  for (const x of sorted) {
    if (!out.some((other) => Math.abs(other - x) < 1e-9)) out.push(x);
  }
  return out;
}

function rootsAt(poly: Poly, x: number, bounds: Bounds): number[] {
  const coeffs: number[] = [];
  for (const [key, coeff] of poly) {
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    const power = j ?? 0;
    coeffs[power] = (coeffs[power] ?? 0) + coeff * (x ** (i ?? 0));
  }
  return realPolynomialRoots(coeffs)
    .filter((root) => root >= bounds.yMin - 1e-8 && root <= bounds.yMax + 1e-8)
    .sort((left, right) => left - right);
}

function realPolynomialRoots(coeffs: number[]): number[] {
  const cleaned = coeffs.slice();
  while (cleaned.length > 1 && Math.abs(cleaned[cleaned.length - 1] ?? 0) < 1e-12) cleaned.pop();
  const degree = cleaned.length - 1;
  if (degree <= 0) return [];
  if (degree === 1) {
    const a = cleaned[1] ?? 0;
    if (Math.abs(a) < 1e-14) return [];
    return [-(cleaned[0] ?? 0) / a];
  }
  if (degree === 2) return quadraticFormula(cleaned[2] ?? 0, cleaned[1] ?? 0, cleaned[0] ?? 0);
  const lead = cleaned[degree] ?? 1;
  if (Math.abs(lead) < 1e-14) return [];
  const n = degree;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let row = 1; row < n; row += 1) matrix[row]![row - 1] = 1;
  for (let column = 0; column < n; column += 1) matrix[column]![n - 1] = -(cleaned[column] ?? 0) / lead;
  let real: number[] = [];
  let imag: number[] = [];
  try {
    const evd = new EigenvalueDecomposition(new Matrix(matrix));
    real = evd.realEigenvalues;
    imag = evd.imaginaryEigenvalues;
  } catch {
    return [];
  }
  const roots: number[] = [];
  for (let index = 0; index < real.length; index += 1) {
    const re = real[index] ?? 0;
    const im = imag[index] ?? 0;
    if (Math.abs(im) > 1e-6 * (1 + Math.abs(re))) continue;
    roots.push(polishRoot(cleaned, re));
  }
  return dedupeRoots(roots);
}

function polishRoot(coeffs: number[], seed: number): number {
  let x = seed;
  for (let step = 0; step < 8; step += 1) {
    let value = 0;
    let derivative = 0;
    for (let power = coeffs.length - 1; power >= 0; power -= 1) {
      derivative = derivative * x + value;
      value = value * x + (coeffs[power] ?? 0);
    }
    if (Math.abs(derivative) < 1e-14) break;
    const next = x - value / derivative;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - x) < 1e-14) return next;
    x = next;
  }
  return x;
}

function univariateRoots(poly: Poly, axis: 0 | 1, min = -12, max = 12): number[] {
  const coeffs: number[] = [];
  for (const [key, coeff] of poly) {
    const parts = key ? key.split(',').map(Number) : [0, 0];
    const power = parts[axis] ?? 0;
    coeffs[power] = (coeffs[power] ?? 0) + coeff;
  }
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1] ?? 0) < 1e-12) coeffs.pop();
  const degree = coeffs.length - 1;
  if (degree <= 0) return [];
  if (degree === 1) {
    const a = coeffs[1] ?? 0;
    if (Math.abs(a) < 1e-14) return [];
    return [-(coeffs[0] ?? 0) / a];
  }
  if (degree === 2) {
    const a = coeffs[2] ?? 0;
    const b = coeffs[1] ?? 0;
    const c = coeffs[0] ?? 0;
    const disc = b * b - 4 * a * c;
    if (disc < -1e-12 || Math.abs(a) < 1e-14) return [];
    if (disc <= 1e-12) return [-b / (2 * a)].filter((root) => root >= min - 1e-8 && root <= max + 1e-8);
    const root = Math.sqrt(disc);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((value) => value >= min - 1e-8 && value <= max + 1e-8);
  }
  return realPolynomialRoots(coeffs).filter((root) => root >= min - 1e-8 && root <= max + 1e-8);
}

function bracketRoots(fn: (x: number) => number, min: number, max: number): number[] {
  const steps = 360;
  const roots: number[] = [];
  let previous = fn(min);
  let prevX = min;
  for (let i = 1; i <= steps; i += 1) {
    const x = min + ((max - min) * i) / steps;
    const value = fn(x);
    if (Number.isFinite(previous) && Number.isFinite(value) && previous * value < 0) {
      roots.push(bisect(fn, prevX, x, previous));
    } else if (Number.isFinite(value) && Math.abs(value) <= 1e-10) roots.push(x);
    previous = value;
    prevX = x;
  }
  return dedupeRoots(roots);
}

function bisect(fn: (x: number) => number, a: number, b: number, fa: number): number {
  let left = a;
  let right = b;
  let fLeft = fa;
  for (let i = 0; i < 50; i += 1) {
    const mid = (left + right) / 2;
    const fMid = fn(mid);
    if (Math.abs(fMid) < 1e-12 || right - left < 1e-12) return mid;
    if (fLeft * fMid <= 0) {
      right = mid;
    } else {
      left = mid;
      fLeft = fMid;
    }
  }
  return (left + right) / 2;
}

function traceExpression(expression: string, vars: [string, string], bounds: Bounds): number[][][] {
  let compiled: { evaluate: (scope: Record<string, number>) => unknown };
  try {
    compiled = parse(expression).compile();
  } catch {
    return [];
  }
  const value = (x: number, y: number) => {
    const out = Number(compiled.evaluate({ [vars[0]]: x, [vars[1]]: y }));
    return Number.isFinite(out) ? out : Number.NaN;
  };
  const xOnly = !depends(expression, vars[1]);
  const yOnly = !depends(expression, vars[0]);
  if (xOnly) return bracketRoots((x) => value(x, 0), bounds.xMin, bounds.xMax).map((root) => vertical(root, bounds)).filter((line): line is number[][] => line != null);
  if (yOnly) return bracketRoots((y) => value(0, y), bounds.yMin, bounds.yMax).map((root) => horizontal(root, bounds)).filter((line): line is number[][] => line != null);
  return traceImplicit(value, bounds, spanOf(bounds) / 650);
}

function multiplicativeFactors(expression: string): string[] {
  try {
    return flattenFactors(parse(expression) as Ast);
  } catch {
    return [expression];
  }
}

type Ast = MathNode & { op: string; fn?: string; args: Ast[]; value: number | string; content: Ast; name: string };

function flattenFactors(node: Ast): string[] {
  if (node.type === 'ParenthesisNode') return flattenFactors(node.content);
  if (node.type === 'OperatorNode' && node.op === '*' && node.args?.length) {
    return node.args.flatMap((arg) => flattenFactors(arg));
  }
  if (node.type === 'OperatorNode' && (node.fn === 'unaryMinus' || (node.op === '-' && node.args?.length === 1))) {
    return flattenFactors(node.args[0]!);
  }
  if (node.type === 'OperatorNode' && node.op === '^' && node.args?.length === 2) {
    const power = Number(node.args[1]!.type === 'ConstantNode' ? node.args[1]!.value : Number.NaN);
    if (Number.isInteger(power) && power > 0) return flattenFactors(node.args[0]!);
  }
  const text = node.toString();
  if (text === '1' || text === '-1') return [];
  return [text];
}

function depends(expression: string, variable: string): boolean {
  let found = false;
  try {
    parse(expression).traverse((node) => {
      const symbol = node as Ast;
      if (node.type === 'SymbolNode' && symbol.name === variable) found = true;
    });
  } catch {
    return true;
  }
  return found;
}

function cellRoots(at: (x: number, y: number) => number, corners: Array<[number, number, number]>): Array<[number, number]> {
  const edges: Array<[[number, number, number], [number, number, number]]> = [
    [corners[0]!, corners[1]!],
    [corners[1]!, corners[2]!],
    [corners[2]!, corners[3]!],
    [corners[3]!, corners[0]!],
  ];
  const hits: Array<[number, number]> = [];
  for (const [a, b] of edges) {
    if (a[2] === 0) hits.push([a[0], a[1]]);
    else if (a[2] * b[2] < 0) {
      const root = bisectEdge(at, a, b);
      if (root) hits.push(root);
    }
  }
  const unique: Array<[number, number]> = [];
  for (const hit of hits) {
    if (!unique.some((other) => Math.hypot(other[0] - hit[0], other[1] - hit[1]) < 1e-9)) unique.push(hit);
  }
  return unique.slice(0, 4);
}

function bisectEdge(
  at: (x: number, y: number) => number,
  a: [number, number, number],
  b: [number, number, number],
): [number, number] | null {
  let left = a;
  let right = b;
  for (let i = 0; i < 40; i += 1) {
    const mid: [number, number, number] = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, 0];
    mid[2] = at(mid[0], mid[1]);
    if (!Number.isFinite(mid[2])) return null;
    if (Math.abs(mid[2]) < 1e-12) return [mid[0], mid[1]];
    if (left[2] * mid[2] <= 0) right = mid;
    else left = mid;
  }
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function pairRoots(hits: Array<[number, number]>, center: number): Array<[[number, number], [number, number]]> {
  if (hits.length < 2) return [];
  if (hits.length === 2) return [[hits[0]!, hits[1]!]];
  if (hits.length >= 4) {
    // Saddle cell: join along the center's sign the way marching squares does, as two disjoint chords.
    const first: [[number, number], [number, number]] = center >= 0 ? [hits[0]!, hits[1]!] : [hits[0]!, hits[3]!];
    const second: [[number, number], [number, number]] = center >= 0 ? [hits[2]!, hits[3]!] : [hits[1]!, hits[2]!];
    return [first, second];
  }
  return [[hits[0]!, hits[1]!]];
}

function chordFar(at: (x: number, y: number) => number, a: [number, number], b: [number, number], tolerance: number): boolean {
  for (const t of [0.25, 0.5, 0.75]) {
    const mx = a[0] + t * (b[0] - a[0]);
    const my = a[1] + t * (b[1] - a[1]);
    const value = at(mx, my);
    const step = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.05, 1e-6);
    const gx = at(mx + step, my) - at(mx - step, my);
    const gy = at(mx, my + step) - at(mx, my - step);
    const gradient = Math.hypot(gx, gy) / (2 * step);
    if (gradient < 1e-10) {
      if (Math.abs(value) > 1e-6) return true;
      continue;
    }
    if (Math.abs(value) / gradient > tolerance) return true;
  }
  return false;
}

function grazes(corners: Array<[number, number, number]>, at: (x: number, y: number) => number, cell: { x0: number; x1: number; y0: number; y1: number }): boolean {
  const signs = corners.map((corner) => Math.sign(corner[2]));
  if (signs.some((sign, index) => index > 0 && sign !== signs[0] && sign !== 0 && signs[0] !== 0)) return false;
  const mid = at((cell.x0 + cell.x1) / 2, (cell.y0 + cell.y1) / 2);
  const scale = Math.max(...corners.map((corner) => Math.abs(corner[2])), 1e-8);
  return Number.isFinite(mid) && Math.abs(mid) < scale * 0.15;
}

function split(stack: Array<{ x0: number; x1: number; y0: number; y1: number; depth: number }>, cell: { x0: number; x1: number; y0: number; y1: number; depth: number }): void {
  const mx = (cell.x0 + cell.x1) / 2;
  const my = (cell.y0 + cell.y1) / 2;
  const depth = cell.depth + 1;
  stack.push(
    { x0: cell.x0, x1: mx, y0: cell.y0, y1: my, depth },
    { x0: mx, x1: cell.x1, y0: cell.y0, y1: my, depth },
    { x0: cell.x0, x1: mx, y0: my, y1: cell.y1, depth },
    { x0: mx, x1: cell.x1, y0: my, y1: cell.y1, depth },
  );
}

function stitch(segments: Array<[number, number, number, number]>, tolerance: number): number[][][] {
  const unused = segments.map((segment) => ({ segment, used: false }));
  const key = (x: number, y: number) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`;
  const lines: number[][][] = [];
  for (const entry of unused) {
    if (entry.used) continue;
    entry.used = true;
    const [ax, ay, bx, by] = entry.segment;
    const poly: number[][] = [
      [ax, ay],
      [bx, by],
    ];
    let grew = true;
    while (grew) {
      grew = false;
      const ends = [poly[0], poly[poly.length - 1]];
      for (const end of ends) {
        if (!end) continue;
        const endKey = key(end[0] ?? 0, end[1] ?? 0);
        const atStart = end === poly[0];
        for (const other of unused) {
          if (other.used) continue;
          const [cx, cy, dx, dy] = other.segment;
          const head = key(cx, cy) === endKey;
          const tail = key(dx, dy) === endKey;
          if (!head && !tail) continue;
          other.used = true;
          const attach: [number, number] = head ? [dx, dy] : [cx, cy];
          if (atStart) poly.unshift(attach);
          else poly.push(attach);
          grew = true;
          break;
        }
      }
    }
    if (poly.length > 1) lines.push(poly);
  }
  return lines;
}

function clipInfiniteLine(p: number, q: number, r: number, bounds: Bounds): number[][] | null {
  const hits: Array<[number, number]> = [];
  const consider = (x: number, y: number) => {
    if (x >= bounds.xMin - 1e-9 && x <= bounds.xMax + 1e-9 && y >= bounds.yMin - 1e-9 && y <= bounds.yMax + 1e-9) hits.push([x, y]);
  };
  if (Math.abs(q) > 1e-14) {
    consider(bounds.xMin, (-r - p * bounds.xMin) / q);
    consider(bounds.xMax, (-r - p * bounds.xMax) / q);
  }
  if (Math.abs(p) > 1e-14) {
    consider((-r - q * bounds.yMin) / p, bounds.yMin);
    consider((-r - q * bounds.yMax) / p, bounds.yMax);
  }
  const unique: Array<[number, number]> = [];
  for (const hit of hits) {
    if (!unique.some((other) => Math.hypot(other[0] - hit[0], other[1] - hit[1]) < 1e-8)) unique.push(hit);
  }
  if (unique.length < 2) return null;
  return [unique[0]!, unique[1]!];
}

function clipPolyline(points: number[][], bounds: Bounds): number[][][] {
  const pieces: number[][][] = [];
  let current: number[][] = [];
  points.forEach((point, index) => {
    const inside = inBounds(point, bounds);
    if (inside) current.push(point);
    const next = points[index + 1];
    if (next && inside !== inBounds(next, bounds)) {
      const hit = segmentHit(point, next, bounds);
      if (hit) current.push(hit);
    }
    if (!inside || !next) {
      if (current.length > 1) pieces.push(current);
      current = [];
    }
  });
  return pieces;
}

function segmentHit(a: number[], b: number[], bounds: Bounds): number[] | null {
  const edges = [
    [bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMin],
    [bounds.xMax, bounds.yMin, bounds.xMax, bounds.yMax],
    [bounds.xMax, bounds.yMax, bounds.xMin, bounds.yMax],
    [bounds.xMin, bounds.yMax, bounds.xMin, bounds.yMin],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    const hit = intersect(a[0] ?? 0, a[1] ?? 0, b[0] ?? 0, b[1] ?? 0, x1 ?? 0, y1 ?? 0, x2 ?? 0, y2 ?? 0);
    if (hit) return hit;
  }
  return null;
}

function intersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const den = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
  if (Math.abs(den) < 1e-14) return null;
  const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / den;
  const u = ((ax - cx) * (ay - by) - (ay - cy) * (ax - bx)) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [ax + t * (bx - ax), ay + t * (by - ay)];
}

function inBounds(point: number[], bounds: Bounds): boolean {
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  return x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;
}

function vertical(x: number, bounds: Bounds): number[][] | null {
  if (x < bounds.xMin || x > bounds.xMax) return null;
  return [
    [x, bounds.yMin],
    [x, bounds.yMax],
  ];
}

function horizontal(y: number, bounds: Bounds): number[][] | null {
  if (y < bounds.yMin || y > bounds.yMax) return null;
  return [
    [bounds.xMin, y],
    [bounds.xMax, y],
  ];
}

function evaluatePoly(poly: Poly, x: number, y: number): number {
  let total = 0;
  for (const [key, coeff] of poly) {
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    total += coeff * x ** (i ?? 0) * y ** (j ?? 0);
  }
  return total;
}

function totalDegree(poly: Poly): number {
  let degree = 0;
  for (const [key, coeff] of poly) {
    if (Math.abs(coeff) < 1e-12) continue;
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    degree = Math.max(degree, (i ?? 0) + (j ?? 0));
  }
  return degree;
}

function leading(poly: Poly): { i: number; j: number; c: number } | null {
  let best: { i: number; j: number; c: number } | null = null;
  let score = -1;
  for (const [key, coeff] of poly) {
    if (Math.abs(coeff) < 1e-9) continue;
    const [i, j] = key ? key.split(',').map(Number) : [0, 0];
    const rank = ((i ?? 0) + (j ?? 0)) * 40 + (i ?? 0);
    if (rank > score) {
      score = rank;
      best = { i: i ?? 0, j: j ?? 0, c: coeff };
    }
  }
  return best;
}

function addTerm(poly: Poly, i: number, j: number, coeff: number): void {
  if (Math.abs(coeff) < 1e-14) return;
  const key = i === 0 && j === 0 ? '' : `${i},${j}`;
  const next = (poly.get(key) ?? 0) + coeff;
  if (Math.abs(next) < 1e-9) poly.delete(key);
  else poly.set(key, next);
}

function linearPoly(p: number, q: number, r: number): Poly {
  const poly: Poly = new Map();
  if (r !== 0) poly.set('', r);
  if (p !== 0) poly.set('1,0', p);
  if (q !== 0) poly.set('0,1', q);
  return poly;
}

function cleanup(poly: Poly): Poly {
  const out: Poly = new Map();
  for (const [key, coeff] of poly) if (Math.abs(coeff) > 1e-12) out.set(key, coeff);
  return out;
}

function gcd3(a: number, b: number, c: number): number {
  return gcd(gcd(Math.abs(a), Math.abs(b)), Math.abs(c));
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function spanOf(bounds: Bounds): number {
  return Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin, 1e-3);
}

function dedupeRoots(roots: number[]): number[] {
  const out: number[] = [];
  for (const root of roots.sort((a, b) => a - b)) {
    if (!out.some((other) => Math.abs(other - root) < 1e-6)) out.push(root);
  }
  return out;
}
