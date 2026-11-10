/**
 * Cole–Hopf overlay for inviscid Burgers.
 * w_t = ν w_xx, w_0 = exp(−∫ u_0 /(2ν)), u = −2ν (ln w)_x.
 * The heat kernel is applied with a Gauss–Hermite rule, not a second solver.
 */

export interface ViscousField {
  nu: number;
  evaluate: (x: number, t: number) => number;
  latex: string;
}

interface Node {
  z: number;
  w: number;
}

let hermiteCache: Node[] | null = null;

export function coleHopf(g: (x: number) => number, nu: number): ViscousField {
  const safeNu = nu > 1e-8 ? nu : 1e-8;
  const grid = buildIntegral(g, -40, 40, 1601);
  const nodes = hermiteNodes(16);

  const evaluate = (x: number, t: number): number => {
    if (!(t > 1e-8)) return g(x);
    const sigma = 2 * Math.sqrt(safeNu * t);
    let maxLog = Number.NEGATIVE_INFINITY;
    const terms: Array<{ log: number; u: number }> = [];
    for (const node of nodes) {
      const y = x - sigma * node.z;
      const logW = Math.log(node.w) - grid.integralFrom0(y) / (2 * safeNu);
      if (!Number.isFinite(logW)) continue;
      terms.push({ log: logW, u: g(y) });
      if (logW > maxLog) maxLog = logW;
    }
    if (terms.length === 0 || !Number.isFinite(maxLog)) return g(x);
    let numerator = 0;
    let denominator = 0;
    for (const term of terms) {
      const weight = Math.exp(term.log - maxLog);
      numerator += weight * term.u;
      denominator += weight;
    }
    return denominator > 0 ? numerator / denominator : g(x);
  };

  return {
    nu: safeNu,
    evaluate,
    latex: `u=-2\\nu(\\ln w)_{x},\\quad w_{0}=\\exp\\left(-\\frac{1}{2\\nu}\\int^{x} u_{0}(s)\\,ds\\right),\\quad \\nu=${trim(safeNu)}`,
  };
}

function buildIntegral(g: (x: number) => number, xMin: number, xMax: number, count: number): { integralFrom0: (x: number) => number } {
  const xs = Array.from({ length: count }, (_, index) => xMin + ((xMax - xMin) * index) / (count - 1));
  const prefix = [0];
  for (let index = 1; index < xs.length; index += 1) {
    const width = (xs[index] ?? 0) - (xs[index - 1] ?? 0);
    const trap = 0.5 * (g(xs[index - 1] ?? 0) + g(xs[index] ?? 0)) * width;
    prefix.push((prefix[index - 1] ?? 0) + (Number.isFinite(trap) ? trap : 0));
  }
  const origin = readPrefix(xs, prefix, 0);
  return {
    integralFrom0: (x: number) => readPrefix(xs, prefix, x) - origin,
  };
}

function readPrefix(xs: number[], prefix: number[], x: number): number {
  if (x <= (xs[0] ?? 0)) return prefix[0] ?? 0;
  const last = xs.length - 1;
  if (x >= (xs[last] ?? 0)) return prefix[last] ?? 0;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo] ?? 0;
  const x1 = xs[hi] ?? x0;
  const span = x1 - x0 || 1;
  const blend = (x - x0) / span;
  return (prefix[lo] ?? 0) * (1 - blend) + (prefix[hi] ?? 0) * blend;
}

/** Nodes and weights for π^{−1/2} ∫ e^{−z^2} f(z) dz, so the weights sum to 1. */
function hermiteNodes(count: number): Node[] {
  if (hermiteCache && hermiteCache.length === count) return hermiteCache;
  const jacobi = hermiteJacobi(count);
  if (jacobi) {
    hermiteCache = jacobi;
    return jacobi;
  }
  const fallback = trapezoidHermite(Math.max(count, 64));
  hermiteCache = fallback;
  return fallback;
}

function hermiteJacobi(count: number): Node[] | null {
  const diagonal = Array(count).fill(0) as number[];
  const off = Array.from({ length: count - 1 }, (_, index) => Math.sqrt((index + 1) / 2));
  const matrix = Array.from({ length: count }, () => Array(count).fill(0) as number[]);
  const vectors = Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, column) => (row === column ? 1 : 0)));
  for (let index = 0; index < count; index += 1) matrix[index]![index] = diagonal[index] ?? 0;
  for (let index = 0; index < count - 1; index += 1) {
    matrix[index]![index + 1] = off[index] ?? 0;
    matrix[index + 1]![index] = off[index] ?? 0;
  }
  for (let sweep = 0; sweep < 12 * count; sweep += 1) {
    let pivot = 0;
    let p = 0;
    let q = 1;
    for (let row = 0; row < count; row += 1) {
      for (let column = row + 1; column < count; column += 1) {
        const magnitude = Math.abs(matrix[row]?.[column] ?? 0);
        if (magnitude > pivot) {
          pivot = magnitude;
          p = row;
          q = column;
        }
      }
    }
    if (pivot < 1e-14) break;
    jacobiRotate(matrix, vectors, p, q);
  }
  const nodes: Node[] = [];
  for (let index = 0; index < count; index += 1) {
    const weight = (vectors[0]?.[index] ?? 0) ** 2;
    nodes.push({ z: matrix[index]?.[index] ?? 0, w: weight });
  }
  const mass = nodes.reduce((sum, node) => sum + node.w, 0);
  const second = nodes.reduce((sum, node) => sum + node.w * node.z * node.z, 0);
  if (Math.abs(mass - 1) > 1e-6 || Math.abs(second - 0.5) > 1e-5) return null;
  nodes.sort((left, right) => left.z - right.z);
  return nodes;
}

function jacobiRotate(matrix: number[][], vectors: number[][], p: number, q: number): void {
  const app = matrix[p]?.[p] ?? 0;
  const aqq = matrix[q]?.[q] ?? 0;
  const apq = matrix[p]?.[q] ?? 0;
  if (apq === 0) return;
  const tau = (aqq - app) / (2 * apq);
  const tangent = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
  const cosine = 1 / Math.sqrt(1 + tangent * tangent);
  const sine = tangent * cosine;
  if (matrix[p]) matrix[p]![p] = app - tangent * apq;
  if (matrix[q]) matrix[q]![q] = aqq + tangent * apq;
  if (matrix[p]) matrix[p]![q] = 0;
  if (matrix[q]) matrix[q]![p] = 0;
  const n = matrix.length;
  for (let column = 0; column < n; column += 1) {
    if (column === p || column === q) continue;
    const aik = matrix[p]?.[column] ?? 0;
    const aqk = matrix[q]?.[column] ?? 0;
    const nextP = cosine * aik - sine * aqk;
    const nextQ = sine * aik + cosine * aqk;
    if (matrix[p]) matrix[p]![column] = nextP;
    if (matrix[column]) matrix[column]![p] = nextP;
    if (matrix[q]) matrix[q]![column] = nextQ;
    if (matrix[column]) matrix[column]![q] = nextQ;
  }
  for (let row = 0; row < n; row += 1) {
    const vip = vectors[row]?.[p] ?? 0;
    const viq = vectors[row]?.[q] ?? 0;
    if (vectors[row]) {
      vectors[row]![p] = cosine * vip - sine * viq;
      vectors[row]![q] = sine * vip + cosine * viq;
    }
  }
}

function trapezoidHermite(count: number): Node[] {
  const zMin = -6;
  const zMax = 6;
  const raw = Array.from({ length: count }, (_, index) => {
    const z = zMin + ((zMax - zMin) * index) / (count - 1);
    return { z, density: Math.exp(-z * z) };
  });
  const width = (zMax - zMin) / (count - 1);
  let mass = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const trap = index === 0 || index === raw.length - 1 ? 0.5 : 1;
    mass += trap * (raw[index]?.density ?? 0) * width;
  }
  const scale = mass > 0 ? 1 / mass : 1;
  return raw.map((node, index) => {
    const trap = index === 0 || index === raw.length - 1 ? 0.5 : 1;
    return { z: node.z, w: trap * node.density * width * scale };
  });
}

function trim(value: number): string {
  const rounded = Math.round(value * 1e8) / 1e8;
  return String(rounded);
}
