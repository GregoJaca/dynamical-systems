import type { LayerVisibility, NumericAnalysis } from './types';

export function defaultLayers(): LayerVisibility {
  return {
    streamlines: true,
    particles: false,
    manifoldsWuWs: false,
    centerManifoldWc: false,
    linearSubspaces: false,
    nullclines: false,
    basins: false,
    lyapunov: false,
    hamiltonianContours: false,
    polarSplit: false,
    traceDetMinimap: false,
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
  if (!lyapunovCurvesAvailable(analysis)) next.lyapunov = false;
  if (analysis.limitCycles.length > 0) {
    next.limitCycles = true;
  }
  const linear = analysis.global.linearSystemExact;
  if (linear) {
    next.linearSubspaces = true;
  }
  return next;
}

/** Level curves are drawn only for a proved strict or weak Lyapunov function, and they start hidden. */
export function lyapunovCurvesAvailable(analysis: NumericAnalysis): boolean {
  const kind = analysis.global.lyapunov?.classification;
  return (kind === 'strict_lyapunov' || kind === 'weak_lyapunov_lasalle') && Boolean(analysis.global.lyapunov?.vExpr);
}
