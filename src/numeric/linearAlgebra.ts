import { EigenvalueDecomposition, LuDecomposition, Matrix, SingularValueDecomposition } from 'ml-matrix';
import type { ComplexEigenvalue, SubspaceInfo } from '../core/types';
import { latexNumber } from './algebra';

export interface RealEigenPair {
  re: number;
  im: number;
  /** Real vector. For a complex pair this is the real or imaginary part, shared by the conjugate. */
  vector: number[];
  complexPart: 'real' | 'imag' | 'none';
}

export interface Spectrum {
  eigenvalues: ComplexEigenvalue[];
  eigenvectors: number[][];
  pairs: RealEigenPair[];
}

const EIG_TOL = 1e-8;

export function decompose(matrix: number[][]): Spectrum {
  const n = matrix.length;
  if (n === 0) return { eigenvalues: [], eigenvectors: [], pairs: [] };
  const evd = new EigenvalueDecomposition(new Matrix(matrix), { assumeSymmetric: false });
  const re = evd.realEigenvalues;
  const im = evd.imaginaryEigenvalues;
  const columns = evd.eigenvectorMatrix.to2DArray();
  const pairs: RealEigenPair[] = [];
  const eigenvalues: ComplexEigenvalue[] = [];
  const eigenvectors: number[][] = [];

  for (let index = 0; index < n; index += 1) {
    const real = re[index] ?? 0;
    const imag = im[index] ?? 0;
    eigenvalues.push({ re: real, im: imag, multiplicity: 1 });
    if (Math.abs(imag) < EIG_TOL) {
      const vector = normalize(column(columns, index));
      pairs.push({ re: real, im: 0, vector, complexPart: 'none' });
      eigenvectors.push(vector);
    } else if (imag > 0) {
      const oriented = orientComplexPair(column(columns, index), column(columns, index + 1));
      pairs.push({ re: real, im: imag, vector: oriented.real, complexPart: 'real' });
      pairs.push({ re: real, im: -imag, vector: oriented.imag, complexPart: 'imag' });
      eigenvectors.push(oriented.real, oriented.imag);
    }
  }
  return { eigenvalues, eigenvectors, pairs };
}

export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  if (matrix.length === 0) return [];
  try {
    const lu = new LuDecomposition(new Matrix(matrix));
    if (!lu.isSingular()) {
      const solution = lu.solve(Matrix.columnVector(rhs)).to1DArray();
      if (solution.every((value) => Number.isFinite(value))) return solution;
    }
  } catch {
    /* Fall through to a damped least-squares step. */
  }
  return levenberg(matrix, rhs, 1e-8);
}

export function matrixRank(matrix: number[][], tol = 1e-8): number {
  if (matrix.length === 0 || matrix[0]?.length === 0) return 0;
  try {
    const svd = new SingularValueDecomposition(new Matrix(matrix), { autoTranspose: true });
    return svd.diagonal.filter((value) => value > tol * Math.max(1, svd.diagonal[0] ?? 1)).length;
  } catch {
    return 0;
  }
}

export function isDiagonalizableReal(jacobian: number[][], eigenvalue: number, algebraic: number): boolean {
  const shifted = jacobian.map((row, i) => row.map((value, j) => value - (i === j ? eigenvalue : 0)));
  const geo = jacobian.length - matrixRank(shifted);
  return geo >= algebraic;
}

export function traceOf(matrix: number[][]): number {
  return matrix.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
}

export function det2(matrix: number[][]): number {
  return (matrix[0]?.[0] ?? 0) * (matrix[1]?.[1] ?? 0) - (matrix[0]?.[1] ?? 0) * (matrix[1]?.[0] ?? 0);
}

export function determinant(matrix: number[][]): number {
  if (matrix.length === 2) return det2(matrix);
  try {
    return new LuDecomposition(new Matrix(matrix)).determinant;
  } catch {
    return 0;
  }
}

export function multiplyMatVec(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

export function invert2(matrix: number[][]): number[][] | null {
  const d = det2(matrix);
  if (Math.abs(d) < 1e-14) return null;
  return [
    [(matrix[1]?.[1] ?? 0) / d, -(matrix[0]?.[1] ?? 0) / d],
    [-(matrix[1]?.[0] ?? 0) / d, (matrix[0]?.[0] ?? 0) / d],
  ];
}

export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const m = b[0]?.length ?? 0;
  const p = b.length;
  const out = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < p; k += 1) {
      const aik = a[i]?.[k] ?? 0;
      for (let j = 0; j < m; j += 1) out[i]![j] += aik * (b[k]?.[j] ?? 0);
    }
  }
  return out;
}

export function transpose(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let i = 0; i < rows; i += 1) for (let j = 0; j < cols; j += 1) out[j]![i] = matrix[i]?.[j] ?? 0;
  return out;
}

export function buildSubspaces(
  coords: number[],
  pairs: RealEigenPair[],
  variableLatex: string[],
): SubspaceInfo[] {
  const groups: Array<{ kind: 'Es' | 'Eu' | 'Ec'; vectors: number[][] }> = [
    { kind: 'Es', vectors: [] },
    { kind: 'Eu', vectors: [] },
    { kind: 'Ec', vectors: [] },
  ];
  const consumed = new Set<number>();
  pairs.forEach((pair, index) => {
    if (consumed.has(index)) return;
    if (pair.complexPart === 'imag') return;
    const kind = pair.re < -EIG_TOL ? 'Es' : pair.re > EIG_TOL ? 'Eu' : 'Ec';
    const bucket = groups.find((group) => group.kind === kind)!;
    bucket.vectors.push(pair.vector);
    if (pair.complexPart === 'real' && pairs[index + 1]) {
      bucket.vectors.push(pairs[index + 1]!.vector);
      consumed.add(index + 1);
    }
  });
  return groups
    .filter((group) => group.vectors.length > 0)
    .map((group) => ({
      kind: group.kind,
      dimension: group.vectors.length,
      basisVectors: group.vectors,
      basisExactLatex: group.vectors.map((vector) => vectorLatex(vector)),
      cartesianFormulaLatex: cartesianFormula(group.kind, coords, group.vectors, variableLatex),
    }));
}

function cartesianFormula(kind: string, coords: number[], vectors: number[][], names: string[]): string {
  const label = kind === 'Es' ? 'E^s' : kind === 'Eu' ? 'E^u' : 'E^c';
  if (vectors.length === 1 && coords.length >= 2 && (vectors[0]?.length ?? 0) >= 2) {
    const vx = vectors[0]?.[0] ?? 0;
    const vy = vectors[0]?.[1] ?? 0;
    const x = names[0] ?? 'x';
    const y = names[1] ?? 'y';
    return `${label}: ${latexNumber(vy)}(${x} - ${latexNumber(coords[0] ?? 0)}) + ${latexNumber(-vx)}(${y} - ${latexNumber(coords[1] ?? 0)}) = 0`;
  }
  if (vectors.length >= 2 && coords.length >= 3) {
    const normal = cross(vectors[0] ?? [], vectors[1] ?? []);
    const terms = normal
      .slice(0, 3)
      .map((coeff, index) => `${latexNumber(coeff)}(${names[index] ?? `x_${index + 1}`} - ${latexNumber(coords[index] ?? 0)})`);
    return `${label}: ${terms.join(' + ')} = 0`;
  }
  if (vectors.length >= coords.length) return `${label}: \\mathbb{R}^{${coords.length}}`;
  return `${label}: \\operatorname{span}\\{${vectors.map((vector) => vectorLatex(vector)).join(', ')}\\}`;
}

function vectorLatex(vector: number[]): string {
  return `\\begin{pmatrix} ${vector.map((value) => latexNumber(value)).join(' \\\\ ')} \\end{pmatrix}`;
}

function cross(a: number[], b: number[]): number[] {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function column(matrix: number[][], index: number): number[] {
  return matrix.map((row) => row[index] ?? 0);
}

export function normalize(vector: number[]): number[] {
  const flipped = orient(vector);
  const length = Math.hypot(...flipped);
  if (length < 1e-14) return flipped.map(() => 0);
  return flipped.map((value) => value / length);
}

function orient(vector: number[]): number[] {
  const pivot = vector.find((value) => Math.abs(value) > 1e-10);
  if (pivot !== undefined && pivot < 0) return vector.map((value) => -value);
  return vector.slice();
}

/** Flip and scale a conjugate pair together so it stays an eigenvector. */
function orientComplexPair(realIn: number[], imagIn: number[]): { real: number[]; imag: number[] } {
  let real = realIn.slice();
  let imag = imagIn.slice();
  const realPivot = real.find((value) => Math.abs(value) > 1e-8);
  const imagPivot = imag.find((value) => Math.abs(value) > 1e-8);
  const flip = (realPivot !== undefined && realPivot < 0) || (realPivot === undefined && imagPivot !== undefined && imagPivot < 0);
  if (flip) {
    real = real.map((value) => -value);
    imag = imag.map((value) => -value);
  }
  const scale = Math.hypot(Math.hypot(...real), Math.hypot(...imag));
  if (scale < 1e-14) return { real, imag };
  return { real: real.map((value) => value / scale), imag: imag.map((value) => value / scale) };
}

function levenberg(matrix: number[][], rhs: number[], lambda: number): number[] | null {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const gram = Array.from({ length: cols }, () => Array(cols).fill(0));
  const proj = Array(cols).fill(0);
  for (let i = 0; i < rows; i += 1) {
    for (let a = 0; a < cols; a += 1) {
      proj[a] += (matrix[i]?.[a] ?? 0) * (rhs[a] === undefined ? rhs[i] ?? 0 : rhs[i] ?? 0);
      for (let b = 0; b < cols; b += 1) gram[a]![b] += (matrix[i]?.[a] ?? 0) * (matrix[i]?.[b] ?? 0);
    }
  }
  for (let a = 0; a < cols; a += 1) gram[a]![a] += lambda;
  try {
    const lu = new LuDecomposition(new Matrix(gram));
    if (lu.isSingular()) return null;
    return lu.solve(Matrix.columnVector(proj)).to1DArray();
  } catch {
    return null;
  }
}
