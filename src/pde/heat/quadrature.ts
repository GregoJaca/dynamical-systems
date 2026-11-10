/**
 * Integrals for Fourier coefficients.
 * A polynomial of degree at most 4 times sin or cos is integrated by parts.
 * Anything else uses Simpson's rule on 160 panels.
 */

export const SIMPSON_PANELS = 160;

export function simpson(f: (x: number) => number, a: number, b: number, panels = SIMPSON_PANELS): number {
  if (!(b > a)) return 0;
  const n = panels % 2 === 0 ? panels : panels + 1;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i += 1) {
    const weight = i % 2 === 0 ? 2 : 4;
    sum += weight * f(a + i * h);
  }
  return (sum * h) / 3;
}

/** Coefficients of τ^j on τ ∈ [0, 1], where τ = (x - left) / (right - left). */
export function fitPolynomial(
  f: (x: number) => number,
  left: number,
  right: number,
  degree = 4,
): number[] | null {
  const length = right - left;
  if (!(length > 0) || degree < 0) return null;
  const nodes = degree + 1;
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let row = 0; row < nodes; row += 1) {
    const tau = row / degree;
    const coeffs = new Array<number>(nodes).fill(0);
    let power = 1;
    for (let col = 0; col < nodes; col += 1) {
      coeffs[col] = power;
      power *= tau;
    }
    matrix.push(coeffs);
    rhs.push(f(left + tau * length));
  }
  const solved = solveLinear(matrix, rhs);
  if (!solved) return null;
  const samples = 8;
  let scale = 0;
  let error = 0;
  for (let i = 0; i < samples; i += 1) {
    const tau = (i + 0.5) / samples;
    const predicted = evaluatePolynomial(solved, tau);
    const actual = f(left + tau * length);
    scale = Math.max(scale, Math.abs(actual));
    error = Math.max(error, Math.abs(predicted - actual));
  }
  if (error > 1e-8 * (1 + scale)) return null;
  let trimmed = solved.length;
  while (trimmed > 1 && Math.abs(solved[trimmed - 1] ?? 0) < 1e-10 * (1 + scale)) trimmed -= 1;
  return solved.slice(0, trimmed);
}

export function evaluatePolynomial(coeffs: readonly number[], tau: number): number {
  let value = 0;
  for (let i = coeffs.length - 1; i >= 0; i -= 1) value = value * tau + (coeffs[i] ?? 0);
  return value;
}

/**
 * ∫_left^right p(x) sin(μ (x-left)) dx or cos, with p of degree ≤ 4 in τ = (x-left)/L.
 * `coeffs` are the coefficients of τ^j.
 */
export function integratePolynomialTimesTrig(
  coeffs: readonly number[],
  kind: 'sin' | 'cos',
  mu: number,
  length: number,
): number {
  if (!(length > 0) || coeffs.length === 0) return 0;
  const moments = trigMoments(mu * length, coeffs.length - 1, kind);
  let sum = 0;
  for (let j = 0; j < coeffs.length; j += 1) sum += (coeffs[j] ?? 0) * (moments[j] ?? 0);
  return sum * length;
}

export function integrateAgainstTrig(
  f: (x: number) => number,
  kind: 'sin' | 'cos',
  mu: number,
  left: number,
  right: number,
): { value: number; exact: boolean } {
  const length = right - left;
  const polynomial = fitPolynomial(f, left, right, 4);
  if (polynomial) {
    return { value: integratePolynomialTimesTrig(polynomial, kind, mu, length), exact: true };
  }
  const value = simpson((x) => f(x) * (kind === 'sin' ? Math.sin(mu * (x - left)) : Math.cos(mu * (x - left))), left, right);
  return { value, exact: false };
}

/** Definite moments ∫_0^1 τ^k sin(ω τ) dτ or cos, through degree `degree`. */
function trigMoments(omega: number, degree: number, kind: 'sin' | 'cos'): number[] {
  const sine = new Array<number>(degree + 1).fill(0);
  const cosine = new Array<number>(degree + 1).fill(0);
  if (Math.abs(omega) < 1e-14) {
    for (let k = 0; k <= degree; k += 1) cosine[k] = 1 / (k + 1);
    return kind === 'cos' ? cosine : sine;
  }
  const sinEnd = Math.sin(omega);
  const cosEnd = Math.cos(omega);
  sine[0] = (1 - cosEnd) / omega;
  cosine[0] = sinEnd / omega;
  for (let k = 1; k <= degree; k += 1) {
    sine[k] = -(cosEnd / omega) + (k / omega) * (cosine[k - 1] ?? 0);
    cosine[k] = sinEnd / omega - (k / omega) * (sine[k - 1] ?? 0);
  }
  return kind === 'sin' ? sine : cosine;
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = a[pivot];
    const colRow = a[col];
    if (!pivotRow || !colRow || Math.abs(pivotRow[col] ?? 0) < 1e-14) return null;
    if (pivot !== col) {
      a[pivot] = colRow;
      a[col] = pivotRow;
    }
    const diag = a[col]?.[col] ?? 0;
    for (let row = col + 1; row < n; row += 1) {
      const factor = (a[row]?.[col] ?? 0) / diag;
      for (let k = col; k <= n; k += 1) {
        const line = a[row];
        if (line) line[k] = (line[k] ?? 0) - factor * (a[col]?.[k] ?? 0);
      }
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row]?.[n] ?? 0;
    for (let col = row + 1; col < n; col += 1) sum -= (a[row]?.[col] ?? 0) * (solution[col] ?? 0);
    const diag = a[row]?.[row] ?? 0;
    if (Math.abs(diag) < 1e-14) return null;
    solution[row] = sum / diag;
  }
  return solution;
}
