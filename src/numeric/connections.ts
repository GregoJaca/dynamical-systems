import type { EquilibriumAnalysis, ManifoldBranch } from '../core/types';

/**
 * A manifold branch that leaves its equilibrium and arrives at an equilibrium
 * is a homoclinic orbit when it returns, and a heteroclinic orbit when it arrives somewhere else.
 */
export function linkConnections(manifolds: ManifoldBranch[], equilibria: EquilibriumAnalysis[]): void {
  for (const branch of manifolds) {
    const home = equilibria.find((eq) => eq.id === branch.equilibriumId);
    const end = branch.points[branch.points.length - 1];
    if (!home || !end || branch.points.length < 6) continue;
    const departure = branch.points.reduce((farthest, point) => Math.max(farthest, distance(point, home.coords)), 0);
    if (departure < 0.25) continue;
    let nearest: EquilibriumAnalysis | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const eq of equilibria) {
      const gap = distance(end, eq.coords);
      if (gap < nearestDistance) {
        nearest = eq;
        nearestDistance = gap;
      }
    }
    if (!nearest || nearestDistance > 0.12) continue;
    branch.connectionToEquilibriumId = nearest.id;
    branch.connectionType = nearest.id === home.id ? 'homoclinic' : 'heteroclinic';
  }
}

function distance(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}
