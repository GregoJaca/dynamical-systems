/** J0 and J1 by power series, and the first zeros of J0. */

const SERIES_TERMS = 80;

export function besselJ0(z: number): number {
  const half = z / 2;
  const quarter = half * half;
  let term = 1;
  let sum = 1;
  for (let m = 1; m < SERIES_TERMS; m += 1) {
    term *= -quarter / (m * m);
    sum += term;
    if (Math.abs(term) < 1e-16 * Math.max(1, Math.abs(sum))) break;
  }
  return sum;
}

export function besselJ1(z: number): number {
  const half = z / 2;
  const quarter = half * half;
  let term = half;
  let sum = half;
  for (let m = 1; m < SERIES_TERMS; m += 1) {
    term *= -quarter / (m * (m + 1));
    sum += term;
    if (Math.abs(term) < 1e-16 * Math.max(1, Math.abs(sum))) break;
  }
  return sum;
}

/** First `count` positive zeros of J0. The first is near 2.4048. */
export function j0Zeros(count: number): number[] {
  const zeros: number[] = [];
  for (let n = 1; n <= count; n += 1) {
    const guess = (n - 0.25) * Math.PI;
    const lo = (n - 0.5) * Math.PI;
    const hi = n * Math.PI;
    zeros.push(bracketNewton(besselJ0, (z) => -besselJ1(z), lo, hi, guess));
  }
  return zeros;
}

/** Positive zeros of J1, skipping the root at the origin. */
export function j1Zeros(count: number): number[] {
  const zeros: number[] = [];
  for (let n = 1; n <= count; n += 1) {
    const lo = (n + 0.1) * Math.PI;
    const hi = (n + 0.9) * Math.PI;
    const guess = (n + 0.25) * Math.PI;
    zeros.push(bracketNewton(besselJ1, (z) => 0.5 * (besselJ0(z) - besselJ(2, z)), lo, hi, guess));
  }
  return zeros;
}

function besselJ(order: number, z: number): number {
  if (order === 0) return besselJ0(z);
  if (order === 1) return besselJ1(z);
  const half = z / 2;
  let term = half ** order / factorial(order);
  let sum = term;
  const quarter = half * half;
  for (let m = 1; m < SERIES_TERMS; m += 1) {
    term *= -quarter / (m * (m + order));
    sum += term;
    if (Math.abs(term) < 1e-16 * Math.max(1, Math.abs(sum))) break;
  }
  return sum;
}

function factorial(n: number): number {
  let value = 1;
  for (let i = 2; i <= n; i += 1) value *= i;
  return value;
}

function bracketNewton(
  f: (z: number) => number,
  df: (z: number) => number,
  lo: number,
  hi: number,
  guess: number,
): number {
  let left = Math.min(lo, hi);
  let right = Math.max(lo, hi);
  let flo = f(left);
  let fri = f(right);
  if (flo * fri > 0) {
    const span = right - left;
    left = Math.max(0.1, guess - span);
    right = guess + span;
    flo = f(left);
    fri = f(right);
  }
  let z = guess;
  for (let i = 0; i < 30; i += 1) {
    const value = f(z);
    const slope = df(z);
    if (!Number.isFinite(value) || !Number.isFinite(slope) || Math.abs(slope) < 1e-14) break;
    const step = value / slope;
    const next = z - step;
    if (next > left && next < right) z = next;
    else z = 0.5 * (left + right);
    if (Math.abs(step) < 1e-12 * (1 + Math.abs(z))) return z;
    const fz = f(z);
    if (flo * fz <= 0) {
      right = z;
      fri = fz;
    } else {
      left = z;
      flo = fz;
    }
  }
  for (let i = 0; i < 60 && right - left > 1e-12; i += 1) {
    const mid = 0.5 * (left + right);
    const fm = f(mid);
    if (flo * fm <= 0) {
      right = mid;
    } else {
      left = mid;
      flo = fm;
    }
  }
  return 0.5 * (left + right);
}
