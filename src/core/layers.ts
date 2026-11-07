import type { LayerVisibility, NumericAnalysis } from './types';

export function defaultLayers(): LayerVisibility {
  return {
    streamlines: true,
    particles: true,
    manifoldsWuWs: false,
    centerManifoldWc: false,
    linearSubspaces: false,
    nullclines: false,
    basins: false,
    lyapunov: false,
    hamiltonianContours: false,
    polarSplit: false,
    traceDetMinimap: true,
    equilibria: true,
    separatrices: true,
    limitCycles: true,
    vectorField: false,
    timeSeries: false,
  };
}

/** Scene director: turn on the layers that make this system legible. */
export function directScene(analysis: NumericAnalysis, current: LayerVisibility): LayerVisibility {
  const next = { ...current };
  const equilibria = analysis.equilibria;
  if (equilibria.some((eq) => eq.classification2D === 'saddle' || eq.classification3D?.startsWith('saddle'))) {
    next.manifoldsWuWs = true;
    next.separatrices = true;
  }
  if (equilibria.some((eq) => !eq.isHyperbolic)) {
    next.centerManifoldWc = true;
  }
  if (analysis.global.isHamiltonian) {
    next.hamiltonianContours = true;
  }
  if (analysis.global.lyapunov && analysis.global.lyapunov.classification !== 'indefinite') {
    next.lyapunov = true;
  }
  if (analysis.limitCycles.length > 0) {
    next.limitCycles = true;
  }
  const linear = analysis.global.linearSystemExact;
  if (linear) {
    next.linearSubspaces = true;
  }
  return next;
}
