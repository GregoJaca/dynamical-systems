/**
 * Crank–Nicolson on an interval, with a Thomas solve.
 * Two backward-Euler steps can start a nonsmooth initial trace.
 */

export interface NumericEnd {
  kind: 'dirichlet' | 'neumann' | 'robin';
  value: (t: number) => number;
  h: number;
}

export interface NumericInput {
  left: number;
  right: number;
  k: (x: number) => number;
  b: (x: number) => number;
  c: (x: number) => number;
  source: (x: number, t: number) => number;
  initial: (x: number) => number;
  leftEnd: NumericEnd;
  rightEnd: NumericEnd;
  tMax: number;
  points?: number;
  steps?: number;
  nonsmooth?: boolean;
  /** Viscous Burgers: the convective speed is the current trace, and k is ν. */
  burgers?: boolean;
}

export interface NumericGrid {
  xs: number[];
  ts: number[];
  values: number[][];
}

interface Row {
  lower: number;
  diag: number;
  upper: number;
  inhom: (t: number) => number;
}

export function crankNicolson(input: NumericInput): NumericGrid {
  const points = input.points ?? 48;
  const steps = input.steps ?? 30;
  const tMax = Math.max(input.tMax, 1e-4);
  const xs = Array.from({ length: points }, (_, index) => input.left + ((input.right - input.left) * index) / (points - 1));
  const h = xs[1] !== undefined && xs[0] !== undefined ? xs[1] - xs[0] : 1;
  const dt = tMax / steps;
  const start = input.leftEnd.kind === 'dirichlet' ? 1 : 0;
  const end = input.rightEnd.kind === 'dirichlet' ? points - 2 : points - 1;
  const width = end - start + 1;
  let full = xs.map((x, index) => boundaryValue(input, index, points, 0) ?? input.initial(x));
  const ts = [0];
  const values = [full.slice()];

  for (let step = 0; step < steps; step += 1) {
    const t0 = step * dt;
    const t1 = (step + 1) * dt;
    const theta = input.nonsmooth && step < 2 ? 1 : 0.5;
    const speed = input.burgers ? (x: number) => -sampleArray(xs, full, x) : input.b;
    const rows = xs.map((_, index) => buildRow(input, xs, h, index, speed));
    const diag = new Array<number>(width).fill(0);
    const lower = new Array<number>(width).fill(0);
    const upper = new Array<number>(width).fill(0);
    const rhs = new Array<number>(width).fill(0);
    for (let local = 0; local < width; local += 1) {
      const node = start + local;
      const row = rows[node];
      if (!row) continue;
      const leftUnknown = node - 1 >= start;
      const rightUnknown = node + 1 <= end;
      diag[local] = 1 - theta * dt * row.diag;
      if (leftUnknown) lower[local] = -theta * dt * row.lower;
      if (rightUnknown) upper[local] = -theta * dt * row.upper;
      const applied = (time: number, weight: number) => {
        const leftValue = leftUnknown ? (full[node - 1] ?? 0) : dirichletAt(input, node - 1, points, time);
        const rightValue = rightUnknown ? (full[node + 1] ?? 0) : dirichletAt(input, node + 1, points, time);
        const self = full[node] ?? 0;
        const reaction = row.lower * leftValue + row.diag * self + row.upper * rightValue + row.inhom(time) + input.source(xs[node] ?? 0, time);
        rhs[local] = (rhs[local] ?? 0) + weight * reaction;
      };
      rhs[local] = full[node] ?? 0;
      applied(t0, (1 - theta) * dt);
      const future = (time: number) => {
        const leftValue = leftUnknown ? 0 : dirichletAt(input, node - 1, points, time);
        const rightValue = rightUnknown ? 0 : dirichletAt(input, node + 1, points, time);
        return row.lower * leftValue + row.upper * rightValue + row.inhom(time) + input.source(xs[node] ?? 0, time);
      };
      rhs[local] = (rhs[local] ?? 0) + theta * dt * future(t1);
    }
    const solved = thomas(lower, diag, upper, rhs);
    const next = full.slice();
    for (let local = 0; local < width; local += 1) next[start + local] = solved[local] ?? 0;
    if (input.leftEnd.kind === 'dirichlet') next[0] = input.leftEnd.value(t1);
    if (input.rightEnd.kind === 'dirichlet') next[points - 1] = input.rightEnd.value(t1);
    full = next;
    ts.push(t1);
    values.push(full.slice());
  }
  return { xs, ts, values };
}

export function sampleGrid(grid: NumericGrid, x: number, t: number): number {
  const { xs, ts, values } = grid;
  if (xs.length === 0 || ts.length === 0) return 0;
  const time = Math.min(Math.max(t, ts[0] ?? 0), ts[ts.length - 1] ?? 0);
  let hi = 1;
  while (hi < ts.length - 1 && (ts[hi] ?? 0) < time) hi += 1;
  const lo = Math.max(0, hi - 1);
  const tLo = ts[lo] ?? 0;
  const tHi = ts[hi] ?? tLo;
  const span = tHi - tLo;
  const weight = span > 0 ? (time - tLo) / span : 0;
  const left = sampleArray(xs, values[lo] ?? [], x);
  const right = sampleArray(xs, values[hi] ?? [], x);
  return left + weight * (right - left);
}

function buildRow(input: NumericInput, xs: number[], h: number, index: number, b: (x: number) => number): Row {
  const x = xs[index] ?? 0;
  const last = xs.length - 1;
  const kk = Math.max(input.k(x), 0);
  const bb = b(x);
  const cc = input.c(x);
  const diffusion = kk / (h * h);
  const drift = bb / (2 * h);
  if (index > 0 && index < last) {
    return { lower: diffusion - drift, diag: -2 * diffusion + cc, upper: diffusion + drift, inhom: () => 0 };
  }
  if (index === 0) return boundaryRow(input.leftEnd, kk, bb, cc, h, 'left');
  return boundaryRow(input.rightEnd, kk, bb, cc, h, 'right');
}

function boundaryRow(end: NumericEnd, k: number, b: number, c: number, h: number, side: 'left' | 'right'): Row {
  const diffusion = k / (h * h);
  if (end.kind === 'dirichlet') return { lower: 0, diag: 0, upper: 0, inhom: (t) => end.value(t) };
  const robin = end.kind === 'robin' ? end.h : 0;
  const sign = side === 'left' ? 1 : -1;
  const diag = -2 * diffusion + c + sign * ((2 * k * robin) / h) - b * robin;
  const couple = 2 * diffusion;
  const inhom = (t: number) => {
    const flux = end.value(t);
    const second = side === 'left' ? (-2 * k * flux) / h : (2 * k * flux) / h;
    return second + b * flux;
  };
  if (side === 'left') return { lower: 0, diag, upper: couple, inhom };
  return { lower: couple, diag, upper: 0, inhom };
}

function boundaryValue(input: NumericInput, index: number, points: number, t: number): number | null {
  if (index === 0 && input.leftEnd.kind === 'dirichlet') return input.leftEnd.value(t);
  if (index === points - 1 && input.rightEnd.kind === 'dirichlet') return input.rightEnd.value(t);
  return null;
}

function dirichletAt(input: NumericInput, index: number, points: number, t: number): number {
  return boundaryValue(input, index, points, t) ?? 0;
}

function sampleArray(xs: number[], values: number[], x: number): number {
  if (xs.length === 0) return 0;
  if (x <= (xs[0] ?? 0)) return values[0] ?? 0;
  const last = xs.length - 1;
  if (x >= (xs[last] ?? 0)) return values[last] ?? 0;
  let hi = 1;
  while (hi < last && (xs[hi] ?? 0) < x) hi += 1;
  const lo = hi - 1;
  const x0 = xs[lo] ?? 0;
  const x1 = xs[hi] ?? x0;
  const span = x1 - x0;
  const weight = span > 0 ? (x - x0) / span : 0;
  return (values[lo] ?? 0) + weight * ((values[hi] ?? 0) - (values[lo] ?? 0));
}

function thomas(lower: number[], diag: number[], upper: number[], rhs: number[]): number[] {
  const n = diag.length;
  const next = new Array<number>(n).fill(0);
  const right = new Array<number>(n).fill(0);
  let pivot = diag[0] ?? 0;
  if (Math.abs(pivot) < 1e-18) pivot = 1e-18;
  next[0] = (upper[0] ?? 0) / pivot;
  right[0] = (rhs[0] ?? 0) / pivot;
  for (let i = 1; i < n; i += 1) {
    const denom = (diag[i] ?? 0) - (lower[i] ?? 0) * (next[i - 1] ?? 0);
    const safe = Math.abs(denom) < 1e-18 ? 1e-18 : denom;
    next[i] = i + 1 < n ? (upper[i] ?? 0) / safe : 0;
    right[i] = ((rhs[i] ?? 0) - (lower[i] ?? 0) * (right[i - 1] ?? 0)) / safe;
  }
  const solution = new Array<number>(n).fill(0);
  solution[n - 1] = right[n - 1] ?? 0;
  for (let i = n - 2; i >= 0; i -= 1) solution[i] = (right[i] ?? 0) - (next[i] ?? 0) * (solution[i + 1] ?? 0);
  return solution;
}
