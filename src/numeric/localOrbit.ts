import type { CompiledSystem, EquilibriumAnalysis, ViewportBounds } from '../core/types';
import { solveLinear } from './linearAlgebra';
import { integrateRK45 } from './rk45';

/**
 * Orbits of a focus reach the equilibrium only as t → ∞. A finite integration therefore
 * stops in mid-air. Once the state is inside the region where the linearization (or the
 * cubic focus normal form) is faithful, this appends that exact local model until the
 * curve disappears into the equilibrium marker.
 */

export function flowOrbit(
  compiled: CompiledSystem,
  y0: number[],
  viewport: ViewportBounds,
  equilibria: EquilibriumAnalysis[],
  direction: 1 | -1,
  budget = 80,
): { points: number[][]; limitId: string } {
  const span = viewportSpan(viewport);
  const pixel = span / 160;
  const stopRadius = Math.min(0.045, Math.max(span / 450, 1e-4));
  const pieces: number[][] = [];
  let y = y0.slice();
  let spent = 0;
  let limitId = 'unresolved';
  let status: string = 'tmax';
  while (spent < budget) {
    const step = Math.min(28, budget - spent);
    const result = integrateRK45({
      t0: 0,
      t1: direction * step,
      y0: y,
      params: compiled.parameterValues,
      f: compiled.f,
      rtol: 1e-5,
      atol: 1e-7,
      maxSteps: 1800,
      viewport,
      viewportMargin: 0.04,
      equilibria: equilibriumStops(equilibria),
      equilibriumRadius: stopRadius,
      velocityStop: 1e-8,
      sampleDistance: span / 160,
      blowUpRadius: 1e4,
      detectPeriodic: equilibria.some((eq) => (eq.classification2D ?? '').includes('center')),
    });
    const fresh = result.y.slice(1);
    pieces.push(...fresh);
    spent += step;
    status = result.status;
    if (result.equilibriumId) limitId = result.equilibriumId;
    if (status === 'periodicOrbitDetected') limitId = 'limit_cycle';
    if (status === 'viewportExit' || status === 'blowUp') limitId = 'infinity';
    if (status !== 'tmax' && status !== 'maxSteps') break;
    const last = fresh[fresh.length - 1] ?? pieces[pieces.length - 1];
    if (!last) break;
    y = last;
    if (!movingCloser(y0, last, equilibria, direction)) break;
  }
  const completed = completeArrival(pieces, 'end', compiled, equilibria, pixel, direction);
  if (completed.equilibriumId) limitId = completed.equilibriumId;
  return { points: completed.points, limitId };
}

export function completeArrival(
  points: number[][],
  which: 'start' | 'end',
  compiled: CompiledSystem,
  equilibria: EquilibriumAnalysis[],
  pixel: number,
  timeSign: 1 | -1,
): { points: number[][]; equilibriumId?: string } {
  if (points.length === 0) return { points };
  const index = which === 'end' ? points.length - 1 : 0;
  const point = points[index];
  if (!point) return { points };
  const candidates = equilibria
    .filter((eq) => canAttract(eq, timeSign))
    .map((eq) => ({ eq, gap: dist(point, eq.coords) }))
    .filter((item) => item.gap < 0.65)
    .sort((a, b) => a.gap - b.gap);
  for (const candidate of candidates) {
    if (isSaddleLike(candidate.eq)) {
      if (candidate.gap < 0.03 && closingCosine(compiled, candidate.eq, point, timeSign) > 0.9) {
        const next = which === 'end' ? [...points, candidate.eq.coords.slice()] : [candidate.eq.coords.slice(), ...points];
        return { points: next, equilibriumId: candidate.eq.id };
      }
      continue;
    }
    const tail = exactTail(compiled, candidate.eq, point, pixel, timeSign);
    if (!tail || tail.length < 2) continue;
    const body = tail.slice(1);
    const next = which === 'end' ? [...points, ...body] : [...[...body].reverse(), ...points];
    return { points: next, equilibriumId: candidate.eq.id };
  }
  return { points };
}

export function equilibriumStops(equilibria: EquilibriumAnalysis[]): Array<{ id: string; coords: number[]; role: 'sink' | 'saddle' }> {
  return equilibria.map((eq) => ({ id: eq.id, coords: eq.coords, role: isSaddleLike(eq) ? 'saddle' : 'sink' }));
}

function isSaddleLike(eq: EquilibriumAnalysis): boolean {
  const name = `${eq.classification2D ?? ''} ${eq.classification3D ?? ''}`;
  if (name.includes('saddle')) return true;
  const real = eq.eigenvalues.filter((lambda) => Math.abs(lambda.im) < 1e-6).map((lambda) => lambda.re);
  return real.some((value) => value > 1e-6) && real.some((value) => value < -1e-6);
}

function closingCosine(compiled: CompiledSystem, eq: EquilibriumAnalysis, point: number[], timeSign: 1 | -1): number {
  let velocity: number[];
  try {
    velocity = compiled.f(0, point, compiled.parameterValues);
  } catch {
    return 0;
  }
  let dot = 0;
  let speed = 0;
  let gap = 0;
  for (let index = 0; index < point.length; index += 1) {
    const toward = (eq.coords[index] ?? 0) - (point[index] ?? 0);
    const component = timeSign * (velocity[index] ?? 0);
    dot += component * toward;
    speed += component * component;
    gap += toward * toward;
  }
  const denom = Math.sqrt(speed * gap);
  if (denom < 1e-14) return 1;
  return dot / denom;
}

function movingCloser(start: number[], last: number[], equilibria: EquilibriumAnalysis[], direction: 1 | -1): boolean {
  const attractors = equilibria.filter((eq) => canAttract(eq, direction));
  if (attractors.length === 0) return false;
  const before = Math.min(...attractors.map((eq) => dist(start, eq.coords)));
  const after = Math.min(...attractors.map((eq) => dist(last, eq.coords)));
  return after < before * 0.98;
}

function canAttract(eq: EquilibriumAnalysis, timeSign: 1 | -1): boolean {
  if (eq.radialCubic != null && Math.abs(eq.radialCubic) > 1e-4 && eq.radialCubic * timeSign < 0) return true;
  return eq.eigenvalues.some((lambda) => lambda.re * timeSign < -1e-6);
}

function exactTail(
  compiled: CompiledSystem,
  eq: EquilibriumAnalysis,
  point: number[],
  pixel: number,
  timeSign: 1 | -1,
): number[][] | null {
  const offset = point.map((value, index) => value - (eq.coords[index] ?? 0));
  const radius = Math.hypot(...offset);
  if (!(radius > pixel)) return [point, eq.coords.slice()];
  const capture = Math.max(eq.hartmanGrobmanRadius ?? 0, eq.radialCubic != null ? 0.55 : 0.22);
  if (radius > capture && fieldResidual(compiled, eq, point) > 0.4) return null;

  const solved = coefficientsOf(eq, offset);
  if (!solved) return null;
  const { modes, coeffs } = solved;
  let shrinking = 0;
  let growing = 0;
  for (const mode of modes) {
    const size = amplitude(mode, coeffs);
    if (modeShrinks(mode, eq, timeSign)) shrinking = Math.max(shrinking, size);
    else if (mode.re * timeSign > 1e-6) growing += size;
  }
  if (shrinking < pixel && !(eq.radialCubic != null && Math.abs(eq.radialCubic) > 1e-4)) return null;
  if (growing > 0.22 * shrinking + 6 * pixel) return null;

  const kept = coeffs.map((coeff, index) => {
    const mode = modeAt(modes, index);
    if (!mode) return 0;
    if (mode.re * timeSign > 1e-6 && !modeShrinks(mode, eq, timeSign)) return 0;
    return coeff;
  });

  const marker = Math.max(pixel, radius / 80);
  const out: number[][] = [point.slice()];
  let previous = radius;
  let travelled = 0;
  const beta = Math.max(...modes.filter((mode) => mode.kind === 'plane').map((mode) => Math.abs(mode.im)), 0);
  for (let step = 0; step < 640; step += 1) {
    const rate = Math.max(
      ...modes.map((mode) => (modeShrinks(mode, eq, timeSign) ? Math.abs(mode.re) : 0)),
      eq.radialCubic != null ? Math.abs(eq.radialCubic) * previous * previous : 0,
      1e-4,
    );
    const byAngle = beta > 1e-6 ? 0.2 / beta : 0.12;
    const byRadius = 0.1 / rate;
    const ds = Math.min(byAngle, Math.max(byRadius, 1e-4));
    travelled += ds;
    const tau = timeSign * travelled;
    const next = reconstruct(eq, modes, kept, tau);
    if (!next || next.some((value) => !Number.isFinite(value))) break;
    if (step === 0 && fieldAngle(compiled, point, next) > 0.4) return null;
    const gap = dist(next, eq.coords);
    if (gap > previous * 1.2 && step > 3) return null;
    out.push(next);
    previous = gap;
    if (gap <= marker) {
      out.push(eq.coords.slice());
      return out;
    }
    if (travelled > 900) break;
  }
  if (previous <= marker * 1.6) out.push(eq.coords.slice());
  return out.length > 2 ? out : null;
}

interface Mode {
  kind: 'real' | 'plane';
  re: number;
  im: number;
  /** Column index of the first coefficient. A plane uses two. */
  index: number;
  vectors: number[][];
}

function coefficientsOf(
  eq: EquilibriumAnalysis,
  offset: number[],
): { modes: Mode[]; coeffs: number[] } | null {
  const modes: Mode[] = [];
  const columns: number[][] = [];
  eq.eigenvalues.forEach((lambda, index) => {
    const vector = eq.eigenvectors[index];
    if (!vector) return;
    if (Math.abs(lambda.im) < 1e-7) {
      modes.push({ kind: 'real', re: lambda.re, im: 0, index: columns.length, vectors: [vector] });
      columns.push(vector);
      return;
    }
    if (lambda.im > 0) {
      const imag = eq.eigenvectors[index + 1];
      if (!imag) return;
      modes.push({ kind: 'plane', re: lambda.re, im: lambda.im, index: columns.length, vectors: [vector, imag] });
      columns.push(vector, imag);
    }
  });
  if (columns.length !== offset.length || columns.length === 0) return null;
  const matrix = offset.map((_, row) => columns.map((column) => column[row] ?? 0));
  const coeffs = solveLinear(matrix, offset);
  if (!coeffs || coeffs.length !== columns.length) return null;
  return { modes, coeffs };
}

function modeAt(modes: Mode[], coeffIndex: number): Mode | null {
  return modes.find((mode) => coeffIndex >= mode.index && coeffIndex < mode.index + mode.vectors.length) ?? null;
}

function amplitude(mode: Mode, coeffs: number[]): number {
  if (mode.kind === 'real') return Math.abs(coeffs[mode.index] ?? 0);
  return Math.hypot(coeffs[mode.index] ?? 0, coeffs[mode.index + 1] ?? 0);
}

function modeShrinks(mode: Mode, eq: EquilibriumAnalysis, timeSign: 1 | -1): boolean {
  if (mode.re * timeSign < -1e-6) return true;
  return mode.kind === 'plane' && Math.abs(mode.re) <= 1e-5 && eq.radialCubic != null && eq.radialCubic * timeSign < -1e-4;
}

function reconstruct(eq: EquilibriumAnalysis, modes: Mode[], coeffs: number[], tau: number): number[] | null {
  const dim = eq.coords.length;
  const acc = Array(dim).fill(0) as number[];
  for (const mode of modes) {
    if (mode.kind === 'real') {
      const vector = mode.vectors[0];
      if (!vector) return null;
      const scale = (coeffs[mode.index] ?? 0) * Math.exp(mode.re * tau);
      for (let i = 0; i < dim; i += 1) acc[i] += scale * (vector[i] ?? 0);
      continue;
    }
    const vr = mode.vectors[0];
    const vi = mode.vectors[1];
    if (!vr || !vi) return null;
    const c1 = coeffs[mode.index] ?? 0;
    const c2 = coeffs[mode.index + 1] ?? 0;
    const xi = vr.map((value, i) => c1 * value + c2 * (vi[i] ?? 0));
    let evolved = evolvePlane(eq.jacobianNumeric, xi, mode.re, mode.im, tau);
    if (Math.abs(mode.re) <= 1e-5 && eq.radialCubic != null && Math.abs(eq.radialCubic) > 1e-8) {
      const r0 = Math.hypot(...xi);
      const denom = 1 - 2 * eq.radialCubic * r0 * r0 * tau;
      if (!(denom > 0.02) || !(r0 > 0)) return eq.coords.slice();
      const factor = 1 / Math.sqrt(denom);
      evolved = evolved.map((value) => value * factor);
    }
    for (let i = 0; i < dim; i += 1) acc[i] += evolved[i] ?? 0;
  }
  return acc.map((value, index) => (eq.coords[index] ?? 0) + value);
}

/** Exact flow of ξ' = Jξ on a focus plane: e^{ατ}(cos βτ ξ + sin(βτ)/β (J − αI)ξ). */
function evolvePlane(jacobian: number[][], xi: number[], alpha: number, beta: number, tau: number): number[] {
  const image = apply(jacobian, xi);
  const shifted = image.map((value, index) => value - alpha * (xi[index] ?? 0));
  const envelope = Math.exp(alpha * tau);
  const cosine = Math.cos(beta * tau);
  const sine = Math.abs(beta) < 1e-8 ? tau : Math.sin(beta * tau) / beta;
  return xi.map((value, index) => envelope * (cosine * value + sine * (shifted[index] ?? 0)));
}

function apply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function fieldAngle(compiled: CompiledSystem, from: number[], to: number[]): number {
  let velocity: number[];
  try {
    velocity = compiled.f(0, from, compiled.parameterValues);
  } catch {
    return Math.PI;
  }
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < from.length; index += 1) {
    const chord = (to[index] ?? 0) - (from[index] ?? 0);
    const component = velocity[index] ?? 0;
    dot += component * chord;
    left += component * component;
    right += chord * chord;
  }
  const denom = Math.sqrt(left * right);
  if (denom < 1e-14) return 0;
  return Math.acos(Math.min(1, Math.max(-1, Math.abs(dot / denom))));
}

function fieldResidual(compiled: CompiledSystem, eq: EquilibriumAnalysis, point: number[]): number {
  const xi = point.map((value, index) => value - (eq.coords[index] ?? 0));
  let velocity: number[];
  try {
    velocity = compiled.f(0, point, compiled.parameterValues);
  } catch {
    return 1;
  }
  const linear = apply(eq.jacobianNumeric, xi);
  const gap = dist(velocity, linear);
  return gap / Math.max(Math.hypot(...velocity), Math.hypot(...linear), 1e-8);
}

function viewportSpan(viewport: ViewportBounds): number {
  return Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin, (viewport.zMax ?? 1) - (viewport.zMin ?? -1), 1e-3);
}

function dist(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
