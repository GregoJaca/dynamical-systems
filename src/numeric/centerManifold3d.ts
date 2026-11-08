import { derivative, parse, type MathNode } from 'mathjs';
import { LuDecomposition, Matrix } from 'ml-matrix';
import type { EquilibriumAnalysis, ManifoldSurface3D, SystemSpec } from '../core/types';
import { latexNumber, substituteExpr, substituteNumbers } from './algebra';
import { symbolToLatex } from '../input/parser';

const DEGREE = 3;

/**
 * A three-dimensional equilibrium with a two-dimensional center and one attracting
 * transverse eigenvalue. The graph of the center manifold and the reduced planar
 * equation are what decide the stability.
 */
export function attachCenterManifolds3D(spec: SystemSpec, equilibria: EquilibriumAnalysis[]): ManifoldSurface3D[] {
  if (spec.dimension !== 3 || spec.stateVars.length < 3) return [];
  const surfaces: ManifoldSurface3D[] = [];
  for (const eq of equilibria) {
    const surface = oneCenterManifold(spec, eq);
    if (surface) surfaces.push(surface);
  }
  return surfaces;
}

function oneCenterManifold(spec: SystemSpec, eq: EquilibriumAnalysis): ManifoldSurface3D | null {
  const center = eq.eigenvalues
    .map((lambda, index) => ({ lambda, vector: eq.eigenvectors[index] }))
    .filter((item) => item.vector && Math.abs(item.lambda.im) > 1e-6 && item.lambda.im > 0);
  const transverse = eq.eigenvalues
    .map((lambda, index) => ({ lambda, vector: eq.eigenvectors[index] }))
    .filter((item) => item.vector && Math.abs(item.lambda.im) <= 1e-6 && Math.abs(item.lambda.re) > 1e-6);
  const pair = center[0];
  const normal = transverse.length === 1 ? transverse[0] : undefined;
  if (!pair || !normal || (normal.lambda.re ?? 0) >= -1e-6) return null;
  const real = orient(eq.eigenvectors[eq.eigenvalues.indexOf(pair.lambda)] ?? pair.vector!);
  const imagIndex = eq.eigenvalues.findIndex((lambda) => lambda !== pair.lambda && Math.abs(lambda.re - pair.lambda.re) < 1e-6 && lambda.im < 0);
  const imag = eq.eigenvectors[imagIndex];
  if (!imag || !normal.vector) return null;
  const columns = [real, orient(imag), orient(normal.vector)];
  const inverse = invert3(columns);
  if (!inverse) return null;
  const parameterValues = Object.fromEntries(Object.entries(spec.parameters).map(([name, item]) => [name, item.value]));
  const names = spec.stateVars;
  const affine: Record<string, string> = {};
  names.forEach((name, index) => {
    const shift = formatNumber(eq.coords[index] ?? 0);
    const linear = columns.map((column, axis) => `(${formatNumber(column[index] ?? 0)})*${['u', 'v', 'w'][axis]}`).join('+');
    affine[name] = `(${shift}+${linear})`;
  });
  const composed = spec.rhsExpressions.slice(0, 3).map((expr) => substituteExpr(substituteNumbers(expr, parameterValues), affine));
  const field = [0, 1, 2].map((row) => inverse[row]!.map((weight, column) => `(${formatNumber(weight)})*(${composed[column]})`).join('+'));
  const jets = field.map((expr) => taylorJet(expr));
  const graph = solveGraph(jets, normal.lambda.re);
  if (!graph) return null;
  const reduced = reduceField(jets, graph);
  const quantity = focusQuantity(reduced);
  if (quantity < -1e-4) {
    eq.stability = 'asymptotically_stable';
    eq.stabilityReasonLatex = 'On the center manifold the transverse eigenvalue is negative and the first focus quantity is negative, so the equilibrium is asymptotically stable.';
  } else if (quantity > 1e-4) {
    eq.stability = 'unstable';
    eq.stabilityReasonLatex = 'On the center manifold the first focus quantity is positive, so the equilibrium is unstable.';
  }
  const formula = graphLatex(names, eq.coords, inverse, graph);
  const mesh = graphMesh(eq.coords, columns, graph);
  return {
    id: `${eq.id}-Wc-surface`,
    equilibriumId: eq.id,
    kind: 'Wc',
    trajectories: mesh.trajectories,
    vertices: mesh.vertices,
    indices: mesh.indices,
    formulaLatex: formula,
    reducedDynamicsLatex: reducedLatex(reduced),
  };
}

type Poly = Map<string, number>;

function solveGraph(jets: Poly[], transverse: number): Poly | null {
  const graph: Poly = new Map();
  for (let degree = 2; degree <= DEGREE; degree += 1) {
    const monomials = pairs(degree);
    const base = coefficients(invariance(jets, graph), degree);
    const matrix = monomials.map((monom) => {
      const trial = new Map(graph);
      trial.set(key(monom.i, monom.j), (trial.get(key(monom.i, monom.j)) ?? 0) + 1);
      const column = coefficients(invariance(jets, trial), degree);
      return column.map((value, index) => value - (base[index] ?? 0));
    });
    const rows = transpose(matrix);
    const solved = leastSquares(rows, base.map((value) => -value));
    if (!solved) break;
    const scale = Math.max(...[...graph.values()].map((value) => Math.abs(value)), 1);
    if (solved.some((value) => Math.abs(value) > 40 * scale)) break;
    monomials.forEach((monom, index) => {
      const value = solved[index] ?? 0;
      if (Math.abs(value) > 1e-8) graph.set(key(monom.i, monom.j), value);
    });
    if (Math.abs(transverse) < 1e-8) break;
  }
  return graph.size > 0 ? graph : null;
}

function invariance(jets: Poly[], graph: Poly): Poly {
  const composed = jets.map((jet) => substituteHeight(jet, graph));
  const hu = differentiate(graph, 'u');
  const hv = differentiate(graph, 'v');
  return subtract(add(multiply(hu, composed[0]!), multiply(hv, composed[1]!)), composed[2]!);
}

function reduceField(jets: Poly[], graph: Poly): { fu: Poly; fv: Poly } {
  return { fu: trim(substituteHeight(jets[0]!, graph)), fv: trim(substituteHeight(jets[1]!, graph)) };
}

function substituteHeight(jet: Poly, graph: Poly): Poly {
  let total: Poly = new Map();
  for (const [id, coeff] of jet) {
    const [i, j, k] = id.split(',').map(Number);
    let height: Poly = new Map([['0,0', 1]]);
    for (let power = 0; power < (k ?? 0); power += 1) height = multiply(height, graph);
    total = add(total, scale(shift(height, i ?? 0, j ?? 0), coeff));
  }
  return trim(total);
}

function coefficients(poly: Poly, degree: number): number[] {
  return pairs(degree).map((monom) => poly.get(key(monom.i, monom.j)) ?? 0);
}

function multiply(left: Poly, right: Poly): Poly {
  const out: Poly = new Map();
  for (const [a, ca] of left) {
    const [ai, aj] = a.split(',').map(Number);
    for (const [b, cb] of right) {
      const [bi, bj] = b.split(',').map(Number);
      const i = (ai ?? 0) + (bi ?? 0);
      const j = (aj ?? 0) + (bj ?? 0);
      if (i + j > DEGREE) continue;
      const id = key(i, j);
      out.set(id, (out.get(id) ?? 0) + ca * cb);
    }
  }
  return out;
}

function shift(poly: Poly, i: number, j: number): Poly {
  const out: Poly = new Map();
  for (const [id, coeff] of poly) {
    const [pi, pj] = id.split(',').map(Number);
    const nextI = (pi ?? 0) + i;
    const nextJ = (pj ?? 0) + j;
    if (nextI + nextJ > DEGREE) continue;
    out.set(key(nextI, nextJ), coeff);
  }
  return out;
}

function add(left: Poly, right: Poly): Poly {
  const out = new Map(left);
  for (const [id, coeff] of right) out.set(id, (out.get(id) ?? 0) + coeff);
  return out;
}

function subtract(left: Poly, right: Poly): Poly {
  return add(left, scale(right, -1));
}

function scale(poly: Poly, factor: number): Poly {
  const out: Poly = new Map();
  for (const [id, coeff] of poly) out.set(id, coeff * factor);
  return out;
}

function differentiate(poly: Poly, variable: 'u' | 'v'): Poly {
  const out: Poly = new Map();
  for (const [id, coeff] of poly) {
    const [i, j] = id.split(',').map(Number);
    const power = variable === 'u' ? i ?? 0 : j ?? 0;
    if (power === 0) continue;
    const nextI = variable === 'u' ? power - 1 : i ?? 0;
    const nextJ = variable === 'v' ? power - 1 : j ?? 0;
    out.set(key(nextI, nextJ), (out.get(key(nextI, nextJ)) ?? 0) + power * coeff);
  }
  return out;
}

function trim(poly: Poly): Poly {
  const out: Poly = new Map();
  for (const [id, coeff] of poly) {
    if (Math.abs(coeff) > 1e-8) out.set(id, coeff);
  }
  return out;
}

function transpose(columns: number[][]): number[][] {
  const rows = columns[0]?.length ?? 0;
  return Array.from({ length: rows }, (_, row) => columns.map((column) => column[row] ?? 0));
}

function focusQuantity(reduced: { fu: Poly; fv: Poly }): number {
  const radius = 0.05;
  let total = 0;
  const samples = 36;
  for (let index = 0; index < samples; index += 1) {
    const angle = (2 * Math.PI * index) / samples;
    const u = radius * Math.cos(angle);
    const v = radius * Math.sin(angle);
    total += (u * evaluate(reduced.fu, u, v) + v * evaluate(reduced.fv, u, v)) / radius ** 4;
  }
  return total / samples;
}

function taylorJet(expr: string): Poly {
  const jet: Poly = new Map();
  let alongU: MathNode = parse(expr);
  for (let i = 0; i <= DEGREE; i += 1) {
    if (i > 0) alongU = derivative(alongU, 'u');
    let alongV = alongU;
    for (let j = 0; j <= DEGREE - i; j += 1) {
      if (j > 0) alongV = derivative(alongV, 'v');
      let alongW = alongV;
      for (let k = 0; k <= DEGREE - i - j; k += 1) {
        if (k > 0) alongW = derivative(alongW, 'w');
        const value = Number(alongW.evaluate({ u: 0, v: 0, w: 0 }));
        const coeff = value / (factorial(i) * factorial(j) * factorial(k));
        if (Number.isFinite(coeff) && Math.abs(coeff) > 1e-12) jet.set(`${i},${j},${k}`, coeff);
      }
    }
  }
  return jet;
}

function evaluate(poly: Poly, u: number, v: number): number {
  let total = 0;
  for (const [id, coeff] of poly) {
    const [i, j] = id.split(',').map(Number);
    total += coeff * u ** (i ?? 0) * v ** (j ?? 0);
  }
  return total;
}

function pairs(degree: number): Array<{ i: number; j: number }> {
  const out: Array<{ i: number; j: number }> = [];
  for (let i = 0; i <= degree; i += 1) out.push({ i, j: degree - i });
  return out;
}

function leastSquares(matrix: number[][], rhs: number[]): number[] | null {
  if (matrix.length === 0 || matrix[0]?.length === 0) return [];
  const columns = matrix[0]!.length;
  const normal = Array.from({ length: columns }, () => Array(columns).fill(0));
  const vector = Array(columns).fill(0);
  for (let row = 0; row < matrix.length; row += 1) {
    for (let i = 0; i < columns; i += 1) {
      vector[i] += (matrix[row]?.[i] ?? 0) * (rhs[row] ?? 0);
      for (let j = 0; j < columns; j += 1) normal[i]![j] += (matrix[row]?.[i] ?? 0) * (matrix[row]?.[j] ?? 0);
    }
  }
  try {
    const lu = new LuDecomposition(new Matrix(normal));
    if (lu.isSingular()) return null;
    return lu.solve(Matrix.columnVector(vector)).to1DArray();
  } catch {
    return null;
  }
}

function graphLatex(names: string[], origin: number[], inverse: number[][], graph: Poly): string {
  const linear = (row: number) =>
    names
      .map((name, index) => {
        const weight = inverse[row]?.[index] ?? 0;
        if (Math.abs(weight) < 1e-8) return '';
        const symbol = Math.abs(origin[index] ?? 0) < 1e-6 ? symbolToLatex(name) : `\\left(${symbolToLatex(name)}-${latexNumber(origin[index] ?? 0)}\\right)`;
        const factor = latexNumber(weight);
        return factor === '1' ? symbol : factor === '-1' ? `-${symbol}` : `${factor}${symbol}`;
      })
      .filter(Boolean)
      .join('+') || '0';
  const polynomial = bivariateLatex(graph, linear(0), linear(1));
  return `${linear(2)} = ${polynomial}`;
}

function bivariateLatex(poly: Poly, u: string, v: string): string {
  const ordered = [...poly.entries()]
    .filter(([, coeff]) => Math.abs(coeff) > 1e-8)
    .sort((left, right) => keyDegree(right[0]) - keyDegree(left[0]) || left[0].localeCompare(right[0]));
  const terms: string[] = [];
  for (const [id, coeff] of ordered) {
    const [i, j] = id.split(',').map(Number);
    const factors = `${monomial(u, i ?? 0)}${monomial(v, j ?? 0)}`;
    const magnitude = latexNumber(Math.abs(coeff));
    const body = factors ? (magnitude === '1' ? factors : `${magnitude}${factors}`) : magnitude;
    terms.push(!terms.length ? (coeff < 0 ? `-${body}` : body) : coeff < 0 ? `-${body}` : `+${body}`);
  }
  return terms.join('') || '0';
}

function monomial(symbol: string, power: number): string {
  if (power <= 0) return '';
  const base = symbol.length > 1 ? `\\left(${symbol}\\right)` : symbol;
  return power === 1 ? base : `${base}^{${power}}`;
}

function keyDegree(id: string): number {
  const [i, j] = id.split(',').map(Number);
  return (i ?? 0) + (j ?? 0);
}

function reducedLatex(reduced: { fu: Poly; fv: Poly }): string {
  return `\\dot u = ${bivariateLatex(reduced.fu, 'u', 'v')},\\quad \\dot v = ${bivariateLatex(reduced.fv, 'u', 'v')}`;
}

function graphMesh(origin: number[], columns: number[][], graph: Poly): { trajectories: number[][][]; vertices: number[]; indices: number[] } {
  const count = 11;
  const span = 0.45;
  const grid: number[][] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const u = -span + (2 * span * column) / (count - 1);
      const v = -span + (2 * span * row) / (count - 1);
      const w = evaluate(graph, u, v);
      const point = origin.map((value, index) => value + u * (columns[0]?.[index] ?? 0) + v * (columns[1]?.[index] ?? 0) + w * (columns[2]?.[index] ?? 0));
      grid.push(point);
    }
  }
  const vertices = grid.flatMap((point) => [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0]);
  const indices: number[] = [];
  for (let row = 0; row < count - 1; row += 1) {
    for (let column = 0; column < count - 1; column += 1) {
      const a = row * count + column;
      indices.push(a, a + 1, a + count, a + 1, a + count + 1, a + count);
    }
  }
  return { trajectories: [grid], vertices, indices };
}

function orient(vector: number[]): number[] {
  const lead = vector.find((value) => Math.abs(value) > 1e-8) ?? 0;
  return lead < 0 ? vector.map((value) => -value) : vector.slice();
}

function invert3(columns: number[][]): number[][] | null {
  const matrix = [0, 1, 2].map((row) => columns.map((column) => column[row] ?? 0));
  try {
    const lu = new LuDecomposition(new Matrix(matrix));
    if (lu.isSingular()) return null;
    return lu.solve(Matrix.eye(3, 3)).to2DArray();
  } catch {
    return null;
  }
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 1e-10) return '0';
  const text = mathLiteralSafe(value);
  return text.startsWith('-') || text.includes('/') ? `(${text})` : text;
}

function mathLiteralSafe(value: number): string {
  for (let den = 1; den <= 24; den += 1) {
    const num = Math.round(value * den);
    if (Math.abs(value - num / den) <= 1e-8 * Math.max(1, Math.abs(value))) {
      return den === 1 ? String(num) : `${num}/${den}`;
    }
  }
  return value.toPrecision(12);
}

function key(i: number, j: number): string {
  return `${i},${j}`;
}

function factorial(value: number): number {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}
