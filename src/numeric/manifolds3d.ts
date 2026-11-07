import type { CompiledSystem, EquilibriumAnalysis, ManifoldSurface3D, ViewportBounds } from '../core/types';
import { integrateRK45 } from './rk45';

/** One-dimensional orbits and two-dimensional ribbon fans in a three-dimensional phase space. */
export function computeManifoldSurfaces(
  compiled: CompiledSystem,
  equilibria: EquilibriumAnalysis[],
  viewport: ViewportBounds,
): ManifoldSurface3D[] {
  if ((compiled.f(0, equilibria[0]?.coords ?? [0, 0, 0], compiled.parameterValues).length ?? 0) < 3 && (equilibria[0]?.coords.length ?? 0) < 3) {
    return [];
  }
  const surfaces: ManifoldSurface3D[] = [];
  for (const eq of equilibria) {
    if (eq.coords.length < 3) continue;
    for (const subspace of eq.subspaces) {
      if (subspace.kind === 'Ec') continue;
      const kind = subspace.kind === 'Es' ? 'Ws' : 'Wu';
      if (subspace.dimension === 1 && subspace.basisVectors[0]) {
        surfaces.push(traceCurve(compiled, eq, subspace.basisVectors[0], kind, viewport));
      } else if (subspace.dimension >= 2 && subspace.basisVectors[0] && subspace.basisVectors[1]) {
        surfaces.push(traceRibbon(compiled, eq, subspace.basisVectors[0], subspace.basisVectors[1], kind, viewport));
      }
    }
  }
  return surfaces;
}

function traceCurve(
  compiled: CompiledSystem,
  eq: EquilibriumAnalysis,
  direction: number[],
  kind: 'Ws' | 'Wu',
  viewport: ViewportBounds,
): ManifoldSurface3D {
  const trajectories = ([1, -1] as const).map((sign) => shoot(compiled, eq.coords, direction.map((value) => sign * value), kind, viewport));
  return {
    id: `${eq.id}-${kind}-curve`,
    equilibriumId: eq.id,
    kind,
    trajectories,
    vertices: trajectories.flat(2),
    indices: [],
  };
}

function traceRibbon(
  compiled: CompiledSystem,
  eq: EquilibriumAnalysis,
  first: number[],
  second: number[],
  kind: 'Ws' | 'Wu',
  viewport: ViewportBounds,
): ManifoldSurface3D {
  const count = 36;
  const epsilon = 1e-3;
  const lengthScale = Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin, (viewport.zMax ?? 1) - (viewport.zMin ?? -1));
  const trajectories: number[][][] = [];
  for (let k = 0; k < count; k += 1) {
    const angle = (2 * Math.PI * k) / count;
    const direction = first.map((value, index) => epsilon * (Math.cos(angle) * value + Math.sin(angle) * (second[index] ?? 0)));
    trajectories.push(shoot(compiled, eq.coords, direction, kind, viewport));
  }
  const vertices: number[] = [];
  const indices: number[] = [];
  const widths = trajectories.map((trajectory) => trajectory.length);
  const minWidth = Math.min(...widths);
  trajectories.forEach((trajectory) => {
    for (const point of trajectory) vertices.push(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
  });
  const stride = minWidth;
  for (let curve = 0; curve < count; curve += 1) {
    const next = (curve + 1) % count;
    for (let row = 0; row < stride - 1; row += 1) {
      const a = curve * stride + row;
      const b = next * stride + row;
      const c = curve * stride + row + 1;
      const d = next * stride + row + 1;
      const pa = trajectories[curve]?.[row];
      const pb = trajectories[next]?.[row];
      if (!pa || !pb) continue;
      if (Math.hypot((pa[0] ?? 0) - (pb[0] ?? 0), (pa[1] ?? 0) - (pb[1] ?? 0), (pa[2] ?? 0) - (pb[2] ?? 0)) > 0.25 * lengthScale) continue;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { id: `${eq.id}-${kind}-surface`, equilibriumId: eq.id, kind, trajectories, vertices, indices };
}

function shoot(
  compiled: CompiledSystem,
  origin: number[],
  offset: number[],
  kind: 'Ws' | 'Wu',
  viewport: ViewportBounds,
): number[][] {
  const seed = origin.map((value, index) => value + (offset[index] ?? 0));
  const result = integrateRK45({
    t0: 0,
    t1: kind === 'Ws' ? -12 : 12,
    y0: seed,
    params: compiled.parameterValues,
    f: compiled.f,
    rtol: 1e-5,
    atol: 1e-7,
    maxSteps: 600,
    viewport,
    viewportMargin: 0.1,
    sampleDistance: 0.08,
  });
  return [origin.slice(), ...result.y];
}
