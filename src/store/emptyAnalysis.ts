import type { NumericAnalysis, ViewportBounds } from '../core/types';

export function emptyAnalysis(revision: number, viewport?: ViewportBounds): NumericAnalysis {
  const frame = viewport ?? { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };
  return {
    revision,
    equilibria: [],
    streamlines: [],
    manifolds: [],
    manifoldSurfaces: [],
    nullclines: [],
    limitCycles: [],
    coordinateTransforms: {},
    global: {
      symbolicJacobianLatex: '',
      divergenceLatex: '',
      divergenceExpr: '0',
      isDivergenceFree: false,
      isGradientSystem: false,
      isHamiltonian: false,
      symmetries: [],
      applicableTheorems: [],
    },
    viewport: frame,
  };
}
