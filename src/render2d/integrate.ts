import type { EquilibriumAnalysis, ViewportBounds } from '../core/types';
import { integrateRK45 } from '../numeric/rk45';

/**
 * Fixed-step classical RK4.
 * `src/numeric/rk45.ts` is owned by the numeric engine and is not part of this
 * renderer. When that module is absent, droplets, polar orbits, and the
 * linearization ghost are integrated here.
 */
export type Rhs = (t: number, y: number[], params: Record<string, number>) => number[];

const EMPTY_PARAMS: Record<string, number> = {};

export function rk4Step(f: Rhs, t: number, y: number[], h: number, params: Record<string, number>): number[] {
  const add = (scale: number, slope: number[]) => y.map((value, index) => value + scale * (slope[index] ?? 0));
  const k1 = f(t, y, params);
  const k2 = f(t + h / 2, add(h / 2, k1), params);
  const k3 = f(t + h / 2, add(h / 2, k2), params);
  const k4 = f(t + h, add(h, k3), params);
  return y.map((value, index) => {
    const slope = (k1[index] ?? 0) + 2 * (k2[index] ?? 0) + 2 * (k3[index] ?? 0) + (k4[index] ?? 0);
    return value + (h / 6) * slope;
  });
}

export interface FixedIntegration {
  f: Rhs;
  y0: number[];
  t0: number;
  t1: number;
  params?: Record<string, number>;
  steps: number;
  maxNorm?: number;
}

export function integrateFixed(options: FixedIntegration): number[][] {
  const steps = Math.max(1, Math.floor(options.steps));
  const h = (options.t1 - options.t0) / steps;
  const params = options.params ?? EMPTY_PARAMS;
  const maxNorm = options.maxNorm ?? 1e6;
  let y = options.y0.slice();
  let t = options.t0;
  const path = [y.slice()];
  if (y.some((value) => !Number.isFinite(value))) return path;
  for (let step = 0; step < steps; step += 1) {
    let next: number[];
    try {
      next = rk4Step(options.f, t, y, h, params);
    } catch {
      break;
    }
    if (next.length === 0 || next.some((value) => !Number.isFinite(value))) break;
    let norm2 = 0;
    for (const value of next) norm2 += value * value;
    if (norm2 > maxNorm * maxNorm) break;
    y = next;
    t += h;
    path.push(y.slice());
  }
  return path;
}

export function linearField(equilibrium: EquilibriumAnalysis): Rhs {
  const x0 = equilibrium.coords[0] ?? 0;
  const y0 = equilibrium.coords[1] ?? 0;
  const jacobian = equilibrium.jacobianNumeric;
  const a = jacobian[0]?.[0] ?? 0;
  const b = jacobian[0]?.[1] ?? 0;
  const c = jacobian[1]?.[0] ?? 0;
  const d = jacobian[1]?.[1] ?? 0;
  return (_t, state) => {
    const dx = (state[0] ?? 0) - x0;
    const dy = (state[1] ?? 0) - y0;
    return [a * dx + b * dy, c * dx + d * dy];
  };
}

/** Short linear orbits used when the store has not supplied ghost streamlines yet. */
export function synthesizeLinearOrbits(
  equilibrium: EquilibriumAnalysis,
  viewport: ViewportBounds,
): Array<{ id: string; points: number[][] }> {
  const span = Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin);
  const radius = Math.max(span * 0.035, (equilibrium.hartmanGrobmanRadius ?? span * 0.08) * 0.35);
  const field = linearField(equilibrium);
  const cx = equilibrium.coords[0] ?? 0;
  const cy = equilibrium.coords[1] ?? 0;
  const orbits: Array<{ id: string; points: number[][] }> = [];
  for (let k = 0; k < 10; k += 1) {
    const angle = (k / 10) * Math.PI * 2;
    const y0 = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    for (const sign of [1, -1] as const) {
      const t1 = sign * Math.min(8, Math.max(1.5, span));
      let points: number[][] = [];
      try {
        const integrated = integrateRK45({
          y0,
          t0: 0,
          t1,
          f: field,
          params: EMPTY_PARAMS,
          maxSteps: 700,
          rtol: 1e-4,
          atol: 1e-6,
          viewport,
          blowUpRadius: Math.max(40, span * 8),
        });
        points = integrated.y;
      } catch {
        points = [];
      }
      if (points.length < 3) {
        points = integrateFixed({
          f: field,
          y0,
          t0: 0,
          t1,
          steps: 96,
          maxNorm: Math.max(40, span * 8),
        });
      }
      if (points.length > 2) {
        orbits.push({ id: `${equilibrium.id}:linear:${k}:${sign > 0 ? 'f' : 'b'}`, points });
      }
    }
  }
  return orbits;
}

export interface DropletFrame {
  time: number;
  ring: number[][];
}

export interface DropletCache {
  frames: DropletFrame[];
  area0: number;
}

/** Integrate the circular droplet once across [-T, T] so scrubbing only samples. */
export function precomputeDroplet(options: {
  f: Rhs;
  params: Record<string, number>;
  cx: number;
  cy: number;
  radius: number;
  timeMax: number;
  samples?: number;
}): DropletCache | null {
  const count = 60;
  const radius = options.radius;
  if (!(radius > 0) || !Number.isFinite(options.cx) || !Number.isFinite(options.cy)) return null;
  const seeds: number[][] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    seeds.push([options.cx + radius * Math.cos(angle), options.cy + radius * Math.sin(angle)]);
  }
  const timeMax = Math.max(0, options.timeMax);
  const requested = options.samples ?? 160;
  const steps = timeMax === 0 ? 0 : Math.max(1, Math.min(360, Math.floor(requested / 2)));
  const h = steps === 0 ? 0 : timeMax / steps;
  const advance = (states: number[][], t: number, step: number) => {
    for (let k = 0; k < states.length; k += 1) {
      const current = states[k];
      if (!current) continue;
      try {
        const next = rk4Step(options.f, t, current, step, options.params);
        if (next.every(Number.isFinite) && Math.hypot(next[0] ?? 0, next[1] ?? 0) < 1e6) states[k] = next;
      } catch {
        /* hold the last finite point */
      }
    }
  };
  const ringOf = (states: number[][]) => states.map((state) => [state[0] ?? 0, state[1] ?? 0]);
  const backward = seeds.map((seed) => seed.slice());
  const backFrames: DropletFrame[] = [];
  for (let index = 1; index <= steps; index += 1) {
    advance(backward, -(index - 1) * h, -h);
    backFrames.push({ time: -index * h, ring: ringOf(backward) });
  }
  const forward = seeds.map((seed) => seed.slice());
  const frames: DropletFrame[] = backFrames.reverse();
  frames.push({ time: 0, ring: ringOf(seeds) });
  for (let index = 1; index <= steps; index += 1) {
    advance(forward, (index - 1) * h, h);
    frames.push({ time: index * h, ring: ringOf(forward) });
  }
  let area0 = 0;
  const zero = frames.find((frame) => frame.time === 0);
  if (zero) {
    let acc = 0;
    const ring = zero.ring;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!a || !b) continue;
      acc += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
    }
    area0 = Math.abs(acc) / 2;
  }
  return { frames, area0 };
}

export function sampleDroplet(cache: DropletCache, time: number): number[][] {
  const frames = cache.frames;
  if (frames.length === 0) return [];
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return [];
  if (time <= first.time) return first.ring;
  if (time >= last.time) return last.ring;
  let hi = 1;
  while (hi < frames.length && (frames[hi]?.time ?? 0) < time) hi += 1;
  const right = frames[hi] ?? last;
  const left = frames[hi - 1] ?? first;
  const span = right.time - left.time;
  const t = span === 0 ? 0 : (time - left.time) / span;
  const ring: number[][] = [];
  const n = Math.min(left.ring.length, right.ring.length);
  for (let i = 0; i < n; i += 1) {
    const a = left.ring[i];
    const b = right.ring[i];
    if (!a || !b) continue;
    ring.push([(a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t, (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * t]);
  }
  return ring;
}
