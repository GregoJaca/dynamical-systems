import type {
  CompiledSystem,
  EquilibriumAnalysis,
  Rk45Result,
  StreamlineSegment,
  ViewportBounds,
} from '../core/types';
import { integrateRK45 } from '../numeric/rk45';

function limitId(result: Rk45Result, direction: 'forward' | 'backward'): string {
  if (result.equilibriumId) return result.equilibriumId;
  if (result.status === 'periodicOrbitDetected') return 'limit_cycle';
  if (result.status === 'blowUp' || result.status === 'viewportExit') return 'infinity';
  return direction === 'forward' ? 'unresolved' : 'unresolved';
}

function joinBranches(backward: number[][], forward: number[][]): number[][] {
  if (backward.length === 0) return forward;
  if (forward.length === 0) return [...backward].reverse();
  return [...[...backward].reverse().slice(0, -1), ...forward];
}

function velocities(field: CompiledSystem['f'], points: number[][], params: Record<string, number>): number[] {
  return points.map((point) => {
    try {
      return Math.hypot(...field(0, point, params));
    } catch {
      return 0;
    }
  });
}

function integrateSafe(
  field: CompiledSystem['f'],
  params: Record<string, number>,
  y0: number[],
  t1: number,
  viewport: ViewportBounds,
  equilibria: Array<{ id: string; coords: number[] }>,
): Rk45Result | null {
  try {
    return integrateRK45({
      t0: 0,
      t1,
      y0,
      params,
      f: field,
      rtol: 1e-6,
      atol: 1e-8,
      maxSteps: 2400,
      viewport,
      viewportMargin: 0.2,
      equilibria,
      equilibriumRadius: 1e-2,
      velocityStop: 1e-6,
      blowUpRadius: 1e5,
    });
  } catch {
    return null;
  }
}

export function traceUserOrbit(
  compiled: CompiledSystem,
  point: number[],
  viewport: ViewportBounds,
  equilibria: Array<{ id: string; coords: number[] }>,
  id: string,
): StreamlineSegment | null {
  const forward = integrateSafe(compiled.f, compiled.parameterValues, point, 18, viewport, equilibria);
  const backward = integrateSafe(compiled.f, compiled.parameterValues, point, -18, viewport, equilibria);
  const points = joinBranches(backward?.y ?? [], forward?.y ?? []);
  if (points.length < 2) return null;
  return {
    id,
    points,
    velocities: velocities(compiled.f, points, compiled.parameterValues),
    forwardLimitId: forward ? limitId(forward, 'forward') : 'unresolved',
    backwardLimitId: backward ? limitId(backward, 'backward') : 'unresolved',
    category: 'user_traced',
    reasonTag: 'Clicked orbit',
    formulaOrDescriptionLatex: '\\text{Orbit through the chosen initial condition}',
  };
}

function linearField(eq: EquilibriumAnalysis): CompiledSystem['f'] {
  return (_t, point) => {
    const dim = eq.coords.length;
    const out = Array.from({ length: dim }, () => 0);
    for (let row = 0; row < dim; row += 1) {
      let sum = 0;
      for (let column = 0; column < dim; column += 1) {
        sum += (eq.jacobianNumeric[row]?.[column] ?? 0) * ((point[column] ?? 0) - (eq.coords[column] ?? 0));
      }
      out[row] = sum;
    }
    return out;
  };
}

function seedsAround(eq: EquilibriumAnalysis): number[][] {
  const dim = eq.coords.length;
  const radius = Math.min(1.25, Math.max(0.2, eq.hartmanGrobmanRadius ?? 0.7));
  const offsets: number[][] = [];
  for (const vector of eq.eigenvectors) {
    const norm = Math.hypot(...vector);
    if (norm < 1e-8) continue;
    offsets.push(vector.map((entry) => (entry / norm) * radius));
    offsets.push(vector.map((entry) => (-entry / norm) * radius));
  }
  if (offsets.length === 0) {
    for (let axis = 0; axis < dim; axis += 1) {
      const plus = Array.from({ length: dim }, () => 0);
      const minus = Array.from({ length: dim }, () => 0);
      plus[axis] = radius;
      minus[axis] = -radius;
      offsets.push(plus, minus);
    }
  }
  return offsets.slice(0, 8).map((offset) => eq.coords.map((value, index) => value + (offset[index] ?? 0)));
}

export function computeLinearStreamlines(
  compiled: CompiledSystem,
  eq: EquilibriumAnalysis,
  viewport: ViewportBounds,
): StreamlineSegment[] {
  const field = linearField(eq);
  const params = compiled.parameterValues;
  const segments: StreamlineSegment[] = [];
  seedsAround(eq).forEach((seed, index) => {
    const forward = integrateSafe(field, params, seed, 3.5, viewport, []);
    const backward = integrateSafe(field, params, seed, -3.5, viewport, []);
    const points = joinBranches(backward?.y ?? [], forward?.y ?? []);
    if (points.length < 2) return;
    segments.push({
      id: `lin-${eq.id}-${index}`,
      points,
      velocities: velocities(field, points, params),
      forwardLimitId: eq.id,
      backwardLimitId: 'unresolved',
      category: 'characteristic_orbit',
      reasonTag: `Linearization at ${eq.id}`,
      formulaOrDescriptionLatex: `\\dot{\\xi} = J(${eq.id})\\,\\xi`,
    });
  });
  return segments;
}
