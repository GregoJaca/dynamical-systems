import type { CompiledSystem, EquilibriumAnalysis, LimitCycle, ViewportBounds } from '../core/types';
import { integrateRK45 } from './rk45';

/**
 * Isolated closed orbits that are not circles r = constant.
 * A return map on a ray from a focus finds a fixed point. A center's period annulus,
 * a homoclinic loop, and a trajectory that runs into a saddle are rejected.
 */
export function findIsolatedCycles(
  compiled: CompiledSystem,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
): LimitCycle[] {
  const foci = equilibria.filter((eq) => (eq.classification2D ?? '').includes('focus') && eq.coords.length >= 2);
  const cycles: LimitCycle[] = [];
  for (const focus of foci.slice(0, 2)) {
    const found = returnMap(compiled, focus, equilibria, viewport);
    if (found) cycles.push(found);
  }
  return cycles.map((cycle, index) => ({ ...cycle, id: `lc-return-${index}` }));
}

function returnMap(
  compiled: CompiledSystem,
  focus: EquilibriumAnalysis,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
): LimitCycle | null {
  const origin = focus.coords.slice(0, 2);
  const reach = Math.min(6, Math.max(viewport.xMax - (origin[0] ?? 0), (origin[0] ?? 0) - viewport.xMin, 2));
  const samples = [0.35, 0.7, 1.1, 1.6, 2.2, 3, 4.2].filter((radius) => radius < reach);
  const returns = samples.map((radius) => ({ radius, returned: firstReturn(compiled, origin, radius, equilibria, viewport) }));
  const finite = returns.filter((sample): sample is { radius: number; returned: number } => sample.returned !== null);
  if (finite.length < 3) return null;
  if (finite.every((sample) => Math.abs(sample.returned - sample.radius) < 0.03 * (1 + sample.radius))) return null;
  for (let index = 0; index < finite.length - 1; index += 1) {
    const left = finite[index]!;
    const right = finite[index + 1]!;
    const leftGap = left.returned - left.radius;
    const rightGap = right.returned - right.radius;
    if (leftGap === 0) return orbit(compiled, origin, left.radius, equilibria, viewport, leftGap);
    if (leftGap * rightGap < 0) {
      const radius = bisect(compiled, origin, left.radius, right.radius, equilibria, viewport);
      if (radius === null) continue;
      return orbit(compiled, origin, radius, equilibria, viewport, leftGap);
    }
  }
  return null;
}

function orbit(
  compiled: CompiledSystem,
  origin: number[],
  radius: number,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
  approach: number,
): LimitCycle | null {
  const loop = trace(compiled, origin, radius, equilibria, viewport, true);
  if (!loop || loop.points.length < 12) return null;
  const inside = firstReturn(compiled, origin, radius * 0.85, equilibria, viewport);
  const outside = firstReturn(compiled, origin, radius * 1.15, equilibria, viewport);
  let stability: LimitCycle['stability'] = 'unknown';
  if (inside !== null && outside !== null) {
    const inGap = inside - radius * 0.85;
    const outGap = outside - radius * 1.15;
    if (inGap > 0.02 && outGap < -0.02) stability = 'stable';
    else if (inGap < -0.02 && outGap > 0.02) stability = 'unstable';
    else stability = 'semi_stable';
  } else if (approach > 0) stability = 'stable';
  return {
    id: 'lc-return',
    points: loop.points,
    period: loop.period,
    stability,
    formulaLatex: 'Closed orbit',
  };
}

function bisect(
  compiled: CompiledSystem,
  origin: number[],
  left: number,
  right: number,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
): number | null {
  let lo = left;
  let hi = right;
  let gapLo = (firstReturn(compiled, origin, lo, equilibria, viewport) ?? lo) - lo;
  for (let step = 0; step < 8; step += 1) {
    const mid = 0.5 * (lo + hi);
    const returned = firstReturn(compiled, origin, mid, equilibria, viewport);
    if (returned === null) return null;
    const gap = returned - mid;
    if (Math.abs(gap) < 0.02 * (1 + mid)) return mid;
    if (gap * gapLo < 0) hi = mid;
    else {
      lo = mid;
      gapLo = gap;
    }
  }
  return 0.5 * (lo + hi);
}

function firstReturn(
  compiled: CompiledSystem,
  origin: number[],
  radius: number,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
): number | null {
  const traced = trace(compiled, origin, radius, equilibria, viewport, false);
  return traced?.returned ?? null;
}

function trace(
  compiled: CompiledSystem,
  origin: number[],
  radius: number,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
  keep: boolean,
): { returned: number; points: number[][]; period?: number } | null {
  const seed = [origin[0]! + radius, origin[1] ?? 0];
  const result = integrateRK45({
    t0: 0,
    t1: 28,
    y0: seed,
    params: compiled.parameterValues,
    f: compiled.f,
    rtol: 1e-5,
    atol: 1e-7,
    maxSteps: 1600,
    viewport,
    viewportMargin: 0.05,
    sampleDistance: 0.05,
  });
  const points = result.y;
  if (points.length < 8) return null;
  const leavingDown = (compiled.f(0, seed, compiled.parameterValues)[1] ?? 0) < 0;
  const saddleRadius = 0.08;
  for (const point of points) {
    for (const eq of equilibria) {
      if (eq.id === equilibria.find((item) => item.coords === origin)?.id) continue;
      if ((eq.classification2D ?? '').includes('saddle') || (eq.classification2D ?? '') === 'saddle_node') {
        const gap = Math.hypot((point[0] ?? 0) - (eq.coords[0] ?? 0), (point[1] ?? 0) - (eq.coords[1] ?? 0));
        if (gap < saddleRadius) return null;
      }
    }
  }
  let previous = points[0]!;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const y0 = (previous[1] ?? 0) - (origin[1] ?? 0);
    const y1 = (point[1] ?? 0) - (origin[1] ?? 0);
    const crossed = leavingDown
      ? y0 > 0 && y1 <= 0 && (point[0] ?? 0) > (origin[0] ?? 0) + 0.05
      : y0 <= 0 && y1 > 0 && (point[0] ?? 0) > (origin[0] ?? 0) + 0.05;
    const travelled = index > 6;
    if (crossed && travelled) {
      const alpha = y1 === y0 ? 0 : y0 / (y0 - y1);
      const x = (previous[0] ?? 0) + alpha * ((point[0] ?? 0) - (previous[0] ?? 0));
      const returned = x - (origin[0] ?? 0);
      if (!(returned > 0.08)) return null;
      const loop = keep ? [...points.slice(0, index + 1), seed] : [];
      return { returned, points: loop, period: result.t[index] };
    }
    previous = point;
  }
  return null;
}
