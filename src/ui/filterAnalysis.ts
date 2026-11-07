import type { NumericAnalysis } from '../core/types';

export function hideObjects(analysis: NumericAnalysis, hiddenIds: readonly string[]): NumericAnalysis {
  if (hiddenIds.length === 0) return analysis;
  const hidden = new Set(hiddenIds);
  return {
    ...analysis,
    equilibria: analysis.equilibria
      .filter((eq) => !hidden.has(eq.id))
      .map((eq) => ({
        ...eq,
        subspaces: eq.subspaces.filter((space) => !hidden.has(`${eq.id}:${space.kind}`)),
      })),
    manifolds: analysis.manifolds.filter((branch) => !hidden.has(branch.id)),
    manifoldSurfaces: analysis.manifoldSurfaces.filter((surface) => !hidden.has(surface.id)),
    streamlines: analysis.streamlines.filter((segment) => !hidden.has(segment.id)),
    nullclines: analysis.nullclines.filter((curve) => !hidden.has(curve.id)),
    limitCycles: analysis.limitCycles.filter((cycle) => !hidden.has(cycle.id)),
  };
}
