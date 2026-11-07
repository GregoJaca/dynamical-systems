import type { LayerVisibility, NumericAnalysis, StreamlineSegment } from '../core/types';
import { closestPolylineDistance, finitePair, worldToScreen, type ViewRect } from './geometry';

export function hitTestPhase(
  view: ViewRect,
  sx: number,
  sy: number,
  analysis: NumericAnalysis,
  userOrbits: StreamlineSegment[],
  layers: LayerVisibility,
): string | null {
  let bestId: string | null = null;
  let bestScore = Infinity;
  const consider = (id: string, distance: number, priority: number, threshold: number) => {
    if (distance > threshold) return;
    const score = priority * 1000 + distance;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  };

  if (layers.equilibria) {
    for (const equilibrium of analysis.equilibria) {
      if (!finitePair(equilibrium.coords)) continue;
      const [x, y] = worldToScreen(view, equilibrium.coords[0], equilibrium.coords[1]);
      consider(equilibrium.id, Math.hypot(sx - x, sy - y), 0, 14);
    }
  }
  if (layers.linearSubspaces) {
    for (const equilibrium of analysis.equilibria) {
      for (const subspace of equilibrium.subspaces) {
        const basis = subspace.basisVectors[0];
        if (!basis || !finitePair(equilibrium.coords)) continue;
        const far = [equilibrium.coords[0] + basis[0], equilibrium.coords[1] + (basis[1] ?? 0)];
        const near = [equilibrium.coords[0] - basis[0], equilibrium.coords[1] - (basis[1] ?? 0)];
        consider(
          `${equilibrium.id}:${subspace.kind}`,
          closestPolylineDistance(view, [near, equilibrium.coords, far], sx, sy),
          1,
          8,
        );
      }
    }
  }
  if (layers.manifoldsWuWs || layers.centerManifoldWc) {
    for (const manifold of analysis.manifolds) {
      const visible =
        (manifold.kind === 'Wc' && layers.centerManifoldWc) ||
        (manifold.kind !== 'Wc' && layers.manifoldsWuWs);
      if (!visible) continue;
      consider(manifold.id, closestPolylineDistance(view, manifold.points, sx, sy), 2, 8);
    }
  }
  if (layers.separatrices) {
    for (const segment of analysis.streamlines) {
      if (segment.category !== 'separatrix') continue;
      consider(segment.id, closestPolylineDistance(view, segment.points, sx, sy), 3, 8);
    }
  }
  if (layers.limitCycles) {
    for (const cycle of analysis.limitCycles) {
      consider(cycle.id, closestPolylineDistance(view, cycle.points, sx, sy), 4, 8);
    }
  }
  if (layers.nullclines) {
    for (const nullcline of analysis.nullclines) {
      let distance = Infinity;
      for (const branch of nullcline.points) {
        distance = Math.min(distance, closestPolylineDistance(view, branch, sx, sy));
      }
      consider(nullcline.id, distance, 5, 8);
    }
  }
  for (const orbit of userOrbits) {
    consider(orbit.id, closestPolylineDistance(view, orbit.points, sx, sy), 6, 8);
  }
  if (layers.streamlines) {
    for (const segment of analysis.streamlines) {
      if (segment.category === 'separatrix') continue;
      consider(segment.id, closestPolylineDistance(view, segment.points, sx, sy), 7, 7);
    }
  }
  return bestId;
}
