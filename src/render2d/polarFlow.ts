import { finitePair } from './geometry';
import { rk4Step, type Rhs } from './integrate';

/**
 * Orbits drawn on the polar chart are integrated in (r, θ), not copied from
 * the cartesian portrait. A set of curves that is evenly spaced in the plane
 * is usually bunched or torn after r = √(x² + y²), θ = atan2(y, x).
 */
export function foldPolar(path: number[][]): number[][][] {
  const parts: number[][][] = [];
  let current: number[][] = [];
  let previous: number | null = null;
  for (const point of path) {
    const r = point[0] ?? 0;
    const theta = point[1] ?? 0;
    const folded = Math.atan2(Math.sin(theta), Math.cos(theta));
    if (previous != null && Math.abs(folded - previous) > 2.4) {
      if (current.length > 1) parts.push(current);
      current = [];
    }
    current.push([r, folded]);
    previous = folded;
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

export function cartesianToPolar(points: number[][], origin: number[] = [0, 0]): number[][][] {
  const unwrapped: number[][] = [];
  let previous = 0;
  let accumulated = 0;
  let started = false;
  const ox = origin[0] ?? 0;
  const oy = origin[1] ?? 0;
  for (const point of points) {
    if (!finitePair(point)) continue;
    const x = point[0] - ox;
    const y = point[1] - oy;
    const r = Math.hypot(x, y);
    const theta = Math.atan2(y, x);
    if (!started) {
      accumulated = theta;
      started = true;
    } else {
      let delta = theta - previous;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      accumulated += delta;
    }
    previous = theta;
    unwrapped.push([r, accumulated]);
  }
  return foldPolar(unwrapped);
}

function integratePolarOrbit(
  field: Rhs,
  r0: number,
  theta0: number,
  direction: 1 | -1,
  rMax: number,
  params: Record<string, number>,
): number[][] {
  let r = r0;
  let theta = theta0;
  const path: number[][] = [[r, theta]];
  for (let step = 0; step < 720; step += 1) {
    let velocity: number[];
    try {
      velocity = field(0, [r, theta], params);
    } catch {
      break;
    }
    const rDot = velocity[0] ?? 0;
    const thetaDot = velocity[1] ?? 0;
    const speed = Math.hypot(rDot / Math.max(rMax, 0.4), thetaDot);
    if (!Number.isFinite(speed) || speed < 1e-7) break;
    const h = (direction * 0.05) / Math.max(speed, 0.2);
    let next: number[];
    try {
      next = rk4Step(field, 0, [r, theta], h, params);
    } catch {
      break;
    }
    r = next[0] ?? r;
    theta = next[1] ?? theta;
    if (r < 0) {
      r = -r;
      theta += Math.PI;
    }
    if (!Number.isFinite(r) || !Number.isFinite(theta) || r > rMax * 1.08 || r < 1e-4) break;
    if (Math.abs(theta - theta0) > Math.PI * 2.05) break;
    path.push([r, theta]);
  }
  return path;
}

function joinBranches(backward: number[][], forward: number[][]): number[][] {
  if (backward.length === 0) return forward;
  if (forward.length === 0) return [...backward].reverse();
  return [...[...backward].reverse().slice(0, -1), ...forward];
}

class PolarOccupancy {
  private readonly cells = new Set<string>();

  constructor(
    private readonly rCell: number,
    private readonly thCell: number,
  ) {}

  private key(r: number, theta: number): string {
    const folded = Math.atan2(Math.sin(theta), Math.cos(theta));
    return `${Math.floor(r / this.rCell)}:${Math.floor(folded / this.thCell)}`;
  }

  free(r: number, theta: number): boolean {
    return !this.cells.has(this.key(r, theta));
  }

  mark(path: number[][]): void {
    for (const point of path) this.cells.add(this.key(point[0] ?? 0, point[1] ?? 0));
  }
}

export function seedPolarOrbits(
  field: Rhs,
  rMax: number,
  thetaDepends: boolean,
  radialEquilibria: number[],
  params: Record<string, number>,
): number[][][] {
  const thetas = thetaDepends ? [-2.5, -1.25, 0, 1.25, 2.5] : [-Math.PI + 0.08];
  const count = thetaDepends ? 6 : 9;
  const radii: number[] = [];
  for (let index = 1; index <= count; index += 1) radii.push((index / (count + 1)) * rMax);
  for (const cycle of radialEquilibria) {
    if (!(cycle > 0.04) || cycle > rMax * 1.05) continue;
    radii.push(Math.max(0.05, cycle * 0.62), Math.min(rMax * 0.98, cycle * 1.28));
  }
  radii.sort((a, b) => a - b);
  const unique = radii.filter((radius, index) => index === 0 || radius - radii[index - 1]! > rMax * 0.04);
  const grid = new PolarOccupancy(Math.max(rMax / 16, 0.08), thetaDepends ? 0.55 : Math.PI);
  const pieces: number[][][] = [];
  for (const radius of unique) {
    for (const theta of thetas) {
      if (!grid.free(radius, theta)) continue;
      const forward = integratePolarOrbit(field, radius, theta, 1, rMax, params);
      const backward = integratePolarOrbit(field, radius, theta, -1, rMax, params);
      const joined = joinBranches(backward, forward);
      if (joined.length < 4) continue;
      const folded = foldPolar(joined);
      let kept = false;
      for (const piece of folded) {
        if (piece.length < 4) continue;
        pieces.push(piece);
        grid.mark(piece);
        kept = true;
      }
      if (kept) grid.mark([[radius, theta]]);
    }
  }
  return pieces;
}
