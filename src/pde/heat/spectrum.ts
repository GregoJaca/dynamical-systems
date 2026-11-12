/**
 * Sturm–Liouville modes for the constant-coefficient heat equation on an interval.
 * Robin roots are bracketed, then polished by Newton.
 */

import { integrateAgainstTrig, simpson } from './quadrature';

export type EndKind = 'dirichlet' | 'neumann' | 'robin';

export interface IntervalEnds {
  left: EndKind;
  right: EndKind;
  /** Robin coefficient in u_x + h u = 0, at the end that is Robin. */
  hLeft?: number;
  hRight?: number;
}

export interface SpectralMode {
  n: number;
  mu: number;
  lambda: number;
  norm: number;
  family: 'sin' | 'cos' | 'sinh' | 'fourier-sin' | 'fourier-cos' | 'const';
  phi: (x: number) => number;
  dphi: (x: number) => number;
  phiLatex: string;
  growing: boolean;
}

export interface Projection {
  amplitude: number;
  exact: boolean;
}

const KEEP = 1e-9;

export function intervalSpectrum(k: number, left: number, right: number, ends: IntervalEnds, count: number): SpectralMode[] {
  const length = right - left;
  if (!(length > 0) || count <= 0) return [];
  if (ends.left === 'dirichlet' && ends.right === 'dirichlet') return dirichletDirichlet(k, left, length, count);
  if (ends.left === 'neumann' && ends.right === 'neumann') return neumannNeumann(k, left, length, count);
  if (ends.left === 'dirichlet' && ends.right === 'neumann') return halfRange(k, left, length, count, 'sin');
  if (ends.left === 'neumann' && ends.right === 'dirichlet') return halfRange(k, left, length, count, 'cos');
  if (ends.left === 'dirichlet' && ends.right === 'robin') return dirichletRobin(k, left, length, count, ends.hRight ?? 0, 'right');
  if (ends.left === 'robin' && ends.right === 'dirichlet') return dirichletRobin(k, left, length, count, ends.hLeft ?? 0, 'left');
  if (ends.left === 'robin' && ends.right === 'neumann') return robinNeumann(k, left, length, count, ends.hLeft ?? 0);
  if (ends.left === 'neumann' && ends.right === 'robin') return robinNeumann(k, left, length, count, ends.hRight ?? 0, true);
  return [];
}

/** u_x + h u = 0 at the left (or at the right when `flip` is set) and u_x = 0 at the other end. */
function robinNeumann(k: number, left: number, length: number, count: number, h: number, flip = false): SpectralMode[] {
  const modes: SpectralMode[] = [];
  const mus = robinNeumannMu(h, length, count);
  mus.forEach((mu, index) => {
    const phi = (x: number) => {
      const z = flip ? left + length - x : x - left;
      return Math.cos(mu * z) - (h / mu) * Math.sin(mu * z);
    };
    const norm = simpson((x) => phi(x) * phi(x), left, left + length);
    if (!(norm > 1e-8)) return;
    modes.push({
      n: index + 1,
      mu,
      lambda: k * mu * mu,
      norm,
      family: 'sinh',
      phi,
      dphi: (x) => {
        const z = flip ? left + length - x : x - left;
        const sign = flip ? -1 : 1;
        return sign * (-mu * Math.sin(mu * z) - h * Math.cos(mu * z));
      },
      phiLatex: robinPhiLatex(flip, left, length),
      growing: false,
    });
  });
  return modes;
}

function robinNeumannMu(h: number, length: number, count: number): number[] {
  if (count <= 0 || !(length > 0) || Math.abs(h) < 1e-12) return [];
  const f = (theta: number) => theta * Math.sin(theta) + h * length * Math.cos(theta);
  const df = (theta: number) => Math.sin(theta) + theta * Math.cos(theta) - h * length * Math.sin(theta);
  const roots: number[] = [];
  const limit = (count + 2) * Math.PI;
  const steps = Math.max(2400, count * 500);
  let previous = 1e-4;
  let previousValue = f(previous);
  for (let i = 1; i <= steps && roots.length < count; i += 1) {
    const theta = (limit * i) / steps;
    const value = f(theta);
    if (Number.isFinite(previousValue) && Number.isFinite(value) && previousValue * value < 0) {
      roots.push(newtonInBracket(f, df, previous, theta));
    }
    previous = theta;
    previousValue = value;
  }
  return roots.map((theta) => theta / length);
}

export function periodicSpectrum(k: number, left: number, length: number, count: number): SpectralMode[] {
  const modes: SpectralMode[] = [constantMode(length)];
  for (let n = 1; n <= count; n += 1) {
    const mu = (2 * Math.PI * n) / length;
    const lambda = k * mu * mu;
    modes.push(makeMode(n, mu, lambda, length / 2, 'fourier-cos', left, `\\cos\\left(${waveLatex(mu, left)}\\right)`, false));
    modes.push(makeMode(n, mu, lambda, length / 2, 'fourier-sin', left, `\\sin\\left(${waveLatex(mu, left)}\\right)`, false));
  }
  return modes;
}

export function projectMode(g: (x: number) => number, mode: SpectralMode, left: number, right: number): Projection {
  if (mode.family === 'const') {
    const integral = integrateAgainstTrig(g, 'cos', 0, left, right);
    return { amplitude: integral.value / (right - left), exact: integral.exact };
  }
  const kind = trigKind(mode);
  if (kind && alignedWithAxis(mode, left, right, kind)) {
    const integral = integrateAgainstTrig(g, kind, mode.mu, left, right);
    return { amplitude: mode.norm === 0 ? 0 : integral.value / mode.norm, exact: integral.exact };
  }
  const value = simpson((x) => g(x) * mode.phi(x), left, right);
  return { amplitude: mode.norm === 0 ? 0 : value / mode.norm, exact: false };
}

/**
 * Exact coefficients when g is a trigonometric polynomial in this family.
 * Returns null when the partial sum through `count` does not reproduce g.
 */
export function exactTrigProjection(
  g: (x: number) => number,
  modes: readonly SpectralMode[],
  left: number,
  right: number,
): Projection[] | null {
  if (modes.length === 0) return null;
  const family = modes[0]?.family;
  if (family !== 'sin' && family !== 'cos' && family !== 'const' && family !== 'fourier-sin' && family !== 'fourier-cos') return null;
  const length = right - left;
  const pure = modes.every((mode) => mode.family === 'sin' || mode.family === 'cos' || mode.family === 'const');
  const periodic = modes.some((mode) => mode.family === 'fourier-sin' || mode.family === 'fourier-cos');
  if (!pure && !periodic) return null;
  const highest = modes.reduce((max, mode) => Math.max(max, mode.n), 0);
  const grid = Math.max(128, 4 * highest + 8);
  const coefficients = pure
    ? family === 'sin'
      ? sineGrid(g, left, length, grid, highest)
      : cosineGrid(g, left, length, grid, highest)
    : fourierGrid(g, left, length, grid, highest);
  const byKey = new Map<string, number>();
  for (const row of coefficients) byKey.set(row.key, row.amplitude);
  const projected = modes.map((mode) => ({
    amplitude: byKey.get(modeKey(mode)) ?? 0,
    exact: true,
  }));
  let scale = 0;
  let error = 0;
  for (let i = 1; i <= 24; i += 1) {
    const x = left + (length * i) / 25;
    const actual = g(x);
    let recon = 0;
    for (let index = 0; index < modes.length; index += 1) {
      recon += (projected[index]?.amplitude ?? 0) * (modes[index]?.phi(x) ?? 0);
    }
    scale = Math.max(scale, Math.abs(actual));
    error = Math.max(error, Math.abs(recon - actual));
  }
  if (error > 1e-7 * (1 + scale)) return null;
  return projected.map((row) => ({ ...row, amplitude: Math.abs(row.amplitude) < KEEP ? 0 : row.amplitude }));
}

export function robinMu(h: number, length: number, count: number): number[] {
  if (count <= 0 || h === 0 || !(length > 0)) return [];
  const roots: number[] = [];
  const f = (theta: number) => Math.sin(theta) + (theta / (h * length)) * Math.cos(theta);
  const df = (theta: number) =>
    Math.cos(theta) + (1 / (h * length)) * Math.cos(theta) - (theta / (h * length)) * Math.sin(theta);
  const limit = (count + 1) * Math.PI;
  const steps = Math.max(2000, count * 400);
  let previous = 1e-6;
  let previousValue = f(previous);
  for (let i = 1; i <= steps && roots.length < count; i += 1) {
    const theta = (limit * i) / steps;
    const value = f(theta);
    if (Number.isFinite(previousValue) && Number.isFinite(value) && previousValue * value < 0) {
      roots.push(newtonInBracket(f, df, previous, theta));
    }
    previous = theta;
    previousValue = value;
  }
  return roots.map((theta) => theta / length);
}

/** Positive γ with γ coth(γ L) = |h|, when |h| > 1/L. */
export function robinGamma(h: number, length: number): number | null {
  const height = Math.abs(h);
  if (!(height > 1 / length + 1e-12) || !(length > 0)) return null;
  const f = (gamma: number) => gamma * Math.cosh(gamma * length) - height * Math.sinh(gamma * length);
  const df = (gamma: number) =>
    Math.cosh(gamma * length) + gamma * length * Math.sinh(gamma * length) - height * length * Math.cosh(gamma * length);
  let lo = 1e-8;
  let hi = Math.max(1, height);
  let flo = f(lo);
  while (f(hi) <= 0 && hi < 1e6) hi *= 2;
  if (flo > 0) return null;
  for (let i = 0; i < 40; i += 1) {
    const mid = 0.5 * (lo + hi);
    const slope = df(mid);
    const value = f(mid);
    const newton = Math.abs(slope) > 1e-12 ? mid - value / slope : mid;
    const next = newton > lo && newton < hi ? newton : 0.5 * (lo + hi);
    if (f(lo) * f(next) <= 0) hi = next;
    else lo = next;
    if (Math.abs(hi - lo) < 1e-12 * (1 + hi)) break;
  }
  return 0.5 * (lo + hi);
}

function dirichletDirichlet(k: number, left: number, length: number, count: number): SpectralMode[] {
  const modes: SpectralMode[] = [];
  for (let n = 1; n <= count; n += 1) {
    const mu = (n * Math.PI) / length;
    modes.push(makeMode(n, mu, k * mu * mu, length / 2, 'sin', left, sineLatex(n, left, length), false));
  }
  return modes;
}

function neumannNeumann(k: number, left: number, length: number, count: number): SpectralMode[] {
  const modes: SpectralMode[] = [constantMode(length)];
  for (let n = 1; n <= count; n += 1) {
    const mu = (n * Math.PI) / length;
    modes.push(makeMode(n, mu, k * mu * mu, length / 2, 'cos', left, cosineLatex(n, left, length), false));
  }
  return modes;
}

function halfRange(k: number, left: number, length: number, count: number, family: 'sin' | 'cos'): SpectralMode[] {
  const modes: SpectralMode[] = [];
  for (let n = 0; n < count; n += 1) {
    const mu = ((n + 0.5) * Math.PI) / length;
    const latex = family === 'sin' ? `\\sin\\left(${waveLatex(mu, left)}\\right)` : `\\cos\\left(${waveLatex(mu, left)}\\right)`;
    modes.push(makeMode(n, mu, k * mu * mu, length / 2, family, left, latex, false));
  }
  return modes;
}

function dirichletRobin(
  k: number,
  left: number,
  length: number,
  count: number,
  h: number,
  robinEnd: 'left' | 'right',
): SpectralMode[] {
  const modes: SpectralMode[] = [];
  const mus = robinMu(robinEnd === 'right' ? h : -h, length, count);
  mus.forEach((mu, index) => {
    const norm = sineNorm(mu, length);
    const latex =
      robinEnd === 'right'
        ? `\\sin\\left(${waveLatex(mu, left)}\\right)`
        : `\\sin\\left(${reflectedAngle(mu, left, length)}\\right)`;
    if (robinEnd === 'right') {
      modes.push(makeMode(index + 1, mu, k * mu * mu, norm, 'sin', left, latex, false));
    } else {
      modes.push(reflectedSine(index + 1, mu, k * mu * mu, norm, left, length, latex));
    }
  });
  if (h < 0 && robinEnd === 'right') {
    const gamma = robinGamma(h, length);
    if (gamma !== null) modes.push(growingSinh(k, left, length, gamma));
  }
  return modes;
}

function growingSinh(k: number, left: number, length: number, gamma: number): SpectralMode {
  const norm = Math.sinh(2 * gamma * length) / (4 * gamma) - length / 2;
  const phi = (x: number) => Math.sinh(gamma * (x - left));
  const dphi = (x: number) => gamma * Math.cosh(gamma * (x - left));
  return {
    n: 0,
    mu: gamma,
    lambda: -k * gamma * gamma,
    norm,
    family: 'sinh',
    phi,
    dphi,
    phiLatex: `\\sinh\\left(${muLatex(gamma)}(x-${formatPlace(left)})\\right)`,
    growing: true,
  };
}

function reflectedSine(n: number, mu: number, lambda: number, norm: number, left: number, length: number, latex: string): SpectralMode {
  const right = left + length;
  return {
    n,
    mu,
    lambda,
    norm,
    family: 'sin',
    phi: (x) => Math.sin(mu * (right - x)),
    dphi: (x) => -mu * Math.cos(mu * (right - x)),
    phiLatex: latex,
    growing: false,
  };
}

function constantMode(length: number): SpectralMode {
  return {
    n: 0,
    mu: 0,
    lambda: 0,
    norm: length,
    family: 'const',
    phi: () => 1,
    dphi: () => 0,
    phiLatex: '1',
    growing: false,
  };
}

function trigKind(mode: SpectralMode): 'sin' | 'cos' | null {
  if (mode.family === 'sin' || mode.family === 'fourier-sin') return 'sin';
  if (mode.family === 'cos' || mode.family === 'fourier-cos') return 'cos';
  return null;
}

function alignedWithAxis(mode: SpectralMode, left: number, right: number, kind: 'sin' | 'cos'): boolean {
  const mid = 0.5 * (left + right);
  const expected = kind === 'sin' ? Math.sin(mode.mu * (mid - left)) : Math.cos(mode.mu * (mid - left));
  return Math.abs(mode.phi(mid) - expected) <= 1e-8 * (1 + Math.abs(expected));
}

function makeMode(
  n: number,
  mu: number,
  lambda: number,
  norm: number,
  family: SpectralMode['family'],
  left: number,
  phiLatex: string,
  growing: boolean,
): SpectralMode {
  const sine = family === 'sin' || family === 'fourier-sin';
  return {
    n,
    mu,
    lambda,
    norm,
    family,
    phi: (x) => (sine ? Math.sin(mu * (x - left)) : Math.cos(mu * (x - left))),
    dphi: (x) => (sine ? mu * Math.cos(mu * (x - left)) : -mu * Math.sin(mu * (x - left))),
    phiLatex,
    growing,
  };
}

function sineNorm(mu: number, length: number): number {
  if (Math.abs(mu) < 1e-14) return 0;
  return length / 2 - Math.sin(2 * mu * length) / (4 * mu);
}

function newtonInBracket(f: (x: number) => number, df: (x: number) => number, lo: number, hi: number): number {
  let left = lo;
  let right = hi;
  let valueLeft = f(left);
  let z = 0.5 * (left + right);
  for (let i = 0; i < 25; i += 1) {
    const value = f(z);
    const slope = df(z);
    const step = Math.abs(slope) > 1e-14 ? value / slope : right - left;
    const next = z - step;
    if (next > left && next < right && Math.abs(step) < 0.5 * (right - left + 1)) z = next;
    else z = 0.5 * (left + right);
    const fz = f(z);
    if (valueLeft * fz <= 0) right = z;
    else {
      left = z;
      valueLeft = fz;
    }
    if (Math.abs(right - left) < 1e-12) break;
  }
  return 0.5 * (left + right);
}

function sineGrid(g: (x: number) => number, left: number, length: number, grid: number, highest: number): Array<{ key: string; amplitude: number }> {
  const acc = new Array<number>(highest + 1).fill(0);
  for (let j = 1; j < grid; j += 1) {
    const value = g(left + (j * length) / grid);
    for (let n = 1; n <= highest; n += 1) acc[n] = (acc[n] ?? 0) + value * Math.sin((n * Math.PI * j) / grid);
  }
  const rows: Array<{ key: string; amplitude: number }> = [];
  for (let n = 1; n <= highest; n += 1) {
    rows.push({ key: `sin:${n}`, amplitude: (2 / grid) * (acc[n] ?? 0) });
  }
  return rows;
}

function cosineGrid(g: (x: number) => number, left: number, length: number, grid: number, highest: number): Array<{ key: string; amplitude: number }> {
  const samples = new Array<number>(grid + 1);
  for (let j = 0; j <= grid; j += 1) samples[j] = g(left + (j * length) / grid);
  let mean = ((samples[0] ?? 0) + (samples[grid] ?? 0)) / 2;
  for (let j = 1; j < grid; j += 1) mean += samples[j] ?? 0;
  const rows: Array<{ key: string; amplitude: number }> = [{ key: 'const:0', amplitude: mean / grid }];
  for (let n = 1; n <= highest; n += 1) {
    let sum = ((samples[0] ?? 0) + (samples[grid] ?? 0) * (n % 2 === 0 ? 1 : -1)) / 2;
    for (let j = 1; j < grid; j += 1) sum += (samples[j] ?? 0) * Math.cos((n * Math.PI * j) / grid);
    rows.push({ key: `cos:${n}`, amplitude: (2 / grid) * sum });
  }
  return rows;
}

function fourierGrid(g: (x: number) => number, left: number, length: number, grid: number, highest: number): Array<{ key: string; amplitude: number }> {
  const samples = new Array<number>(grid);
  for (let j = 0; j < grid; j += 1) samples[j] = g(left + (j * length) / grid);
  let mean = 0;
  for (const value of samples) mean += value;
  const rows: Array<{ key: string; amplitude: number }> = [{ key: 'const:0', amplitude: mean / grid }];
  for (let n = 1; n <= highest; n += 1) {
    let cosine = 0;
    let sine = 0;
    for (let j = 0; j < grid; j += 1) {
      const angle = (2 * Math.PI * n * j) / grid;
      cosine += (samples[j] ?? 0) * Math.cos(angle);
      sine += (samples[j] ?? 0) * Math.sin(angle);
    }
    rows.push({ key: `fourier-cos:${n}`, amplitude: (2 / grid) * cosine });
    rows.push({ key: `fourier-sin:${n}`, amplitude: (2 / grid) * sine });
  }
  return rows;
}

function modeKey(mode: SpectralMode): string {
  if (mode.family === 'const') return 'const:0';
  if (mode.family === 'fourier-sin') return `fourier-sin:${mode.n}`;
  if (mode.family === 'fourier-cos') return `fourier-cos:${mode.n}`;
  return `${mode.family}:${mode.n}`;
}

function sineLatex(n: number, left: number, length: number): string {
  return `\\sin(${trigAngle(n, left, length)})`;
}

function cosineLatex(n: number, left: number, length: number): string {
  return `\\cos(${trigAngle(n, left, length)})`;
}

function trigAngle(n: number, left: number, length: number): string {
  if (nearly(left, 0) && nearly(length, Math.PI)) return n === 1 ? 'x' : `${n}x`;
  const tail = shifted(left, length);
  const freq = n === 1 ? '\\pi' : `${n}\\pi`;
  if (tail === 'x') return `${freq} x`;
  return `${freq} ${tail}`;
}

function robinPhiLatex(flip: boolean, left: number, length: number): string {
  const spatial = robinSpatial(flip, left, length);
  const arg = spatial === 'x' ? '\\mu_n x' : `\\mu_n ${spatial}`;
  return `\\cos(${arg})-(h/\\mu_n)\\sin(${arg})`;
}

function robinSpatial(flip: boolean, left: number, length: number): string {
  if (!flip) {
    if (nearly(left, 0)) return 'x';
    return `(x-${formatPlace(left)})`;
  }
  return `(${formatPlace(left + length)}-x)`;
}

function reflectedAngle(mu: number, left: number, length: number): string {
  const factor = muLatex(mu).trim();
  const right = formatPlace(left + length);
  if (uglyMu(factor)) return `\\mu_n(${right}-x)`;
  if (factor === '') return `(${right}-x)`;
  return `${factor}(${right}-x)`;
}

function shifted(left: number, length: number): string {
  const place = formatPlace(left);
  const span = formatPlace(length);
  if (place === '0' && span === '1') return 'x';
  if (place === '0') return `x/${span}`;
  if (span === '1') return `(x-${place})`;
  return `(x-${place})/${span}`;
}

function waveLatex(mu: number, left: number): string {
  const factor = muLatex(mu).trim();
  const place = formatPlace(left);
  if (uglyMu(factor)) return place === '0' ? '\\mu_n x' : `\\mu_n(x-${place})`;
  if (factor === '') return place === '0' ? 'x' : `(x-${place})`;
  if (place === '0') return /^-?\d+$/.test(factor) ? `${factor}x` : `${factor} x`;
  return `${factor}(x-${place})`;
}

function muLatex(mu: number): string {
  if (nearly(mu, 1)) return '';
  const ratio = exactNumberLatex(mu / Math.PI);
  if (ratio === '1') return '\\pi ';
  if (ratio) return `${ratio}\\pi `;
  const plain = exactNumberLatex(mu);
  if (plain) return `${plain} `;
  return `${trimNumber(mu)} `;
}

function uglyMu(factor: string): boolean {
  return /\d+\.\d/.test(factor);
}

export function exactNumberLatex(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) < 1e-12) return '0';
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= 1e-8 * (1 + Math.abs(rounded))) return String(rounded);
  for (let den = 2; den <= 12; den += 1) {
    const num = Math.round(value * den);
    if (Math.abs(num) > 80) continue;
    if (Math.abs(value * den - num) <= 1e-7 * den) {
      const divisor = gcd(Math.abs(num), den);
      const n = num / divisor;
      const d = den / divisor;
      if (d === 1) return String(n);
      if (n < 0) return `-\\frac{${Math.abs(n)}}{${d}}`;
      return `\\frac{${n}}{${d}}`;
    }
  }
  return null;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

export function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1e-12) return '0';
  if (nearly(value, Math.PI)) return '\\pi';
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= 1e-7 * (1 + Math.abs(value))) return String(rounded);
  const text = value.toPrecision(8).replace(/\.?0+$/, '');
  return text;
}

function formatPlace(value: number): string {
  if (nearly(value, 0)) return '0';
  if (nearly(value, Math.PI)) return '\\pi';
  if (nearly(value, 2 * Math.PI)) return '2\\pi';
  return trimNumber(value);
}

function nearly(value: number, target: number): boolean {
  return Math.abs(value - target) <= 1e-9 * (1 + Math.abs(target));
}
