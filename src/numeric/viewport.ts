import type { EquilibriumAnalysis, LimitCycle, SystemSpec, ViewportBounds } from '../core/types';

export function chooseViewport(spec: SystemSpec, equilibria: EquilibriumAnalysis[], cycles: LimitCycle[]): ViewportBounds {
  const periodicX = spec.dimension >= 1 && mentionsAngle(spec.rhsExpressions, spec.stateVars[0] ?? 'x');
  const periodicY = spec.dimension >= 2 && mentionsAngle(spec.rhsExpressions, spec.stateVars[1] ?? 'y');
  const points = [
    ...equilibria.map((eq) => eq.coords),
    ...cycles.flatMap((cycle) => cycle.points),
  ];
  let half = 2.5;
  if (points.length === 0) half = 2.5;
  else if (points.length === 1 && cycles.length === 0) {
    const eq = equilibria[0];
    const rates = eq?.eigenvalues.map((lambda) => Math.abs(lambda.re)).filter((value) => value > 1e-6) ?? [];
    const smallest = rates.length ? Math.min(...rates) : 0;
    half = smallest > 0 ? clamp(2.5 / smallest, 0.8, 12) : 2.5;
  } else {
    const xs = points.map((point) => point[0] ?? 0);
    const ys = points.map((point) => point[1] ?? 0);
    const zs = points.map((point) => point[2] ?? 0);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const ySpan = points.some((point) => point.length > 1) ? Math.max(...ys) - Math.min(...ys) : xSpan;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = points.some((point) => point.length > 1) ? (Math.max(...ys) + Math.min(...ys)) / 2 : 0;
    const cz = points.some((point) => point.length > 2) ? (Math.max(...zs) + Math.min(...zs)) / 2 : 0;
    const pad = 0.45 * Math.max(xSpan, ySpan, 0.5);
    half = Math.max(xSpan, ySpan) / 2 + pad;
    return finish(cx, cy, cz, Math.max(half, 1), spec.dimension, periodicX, periodicY, points);
  }
  const center = points[0] ?? [0, 0, 0];
  return finish(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0, half, spec.dimension, periodicX, periodicY, points);
}

function finish(
  cx: number,
  cy: number,
  cz: number,
  half: number,
  dimension: number,
  periodicX: boolean,
  periodicY: boolean,
  points: number[][],
): ViewportBounds {
  const nice = niceStep(half);
  const bounds: ViewportBounds = {
    xMin: roundOut(cx - nice, nice),
    xMax: roundOut(cx + nice, nice, true),
    yMin: roundOut(cy - nice, nice),
    yMax: roundOut(cy + nice, nice, true),
    isPiScaledX: periodicX,
    isPiScaledY: periodicY,
  };
  if (dimension >= 3) {
    const zs = points.map((point) => point[2] ?? 0);
    const zHalf = points.length ? Math.max(nice, (Math.max(...zs) - Math.min(...zs)) / 2 + nice * 0.4) : nice;
    bounds.zMin = roundOut(cz - zHalf, nice);
    bounds.zMax = roundOut(cz + zHalf, nice, true);
  }
  if (bounds.xMax - bounds.xMin < 1e-6) {
    bounds.xMin -= 1;
    bounds.xMax += 1;
  }
  if (bounds.yMax - bounds.yMin < 1e-6) {
    bounds.yMin -= 1;
    bounds.yMax += 1;
  }
  return bounds;
}

function mentionsAngle(rhs: string[], variable: string): boolean {
  return rhs.some((expr) => new RegExp(`\\b(sin|cos|tan)\\(\\s*${variable}\\b`).test(expr));
}

function niceStep(span: number): number {
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, Math.PI, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40];
  return steps.find((step) => step >= span * 0.95) ?? span;
}

function roundOut(value: number, step: number, up = false): number {
  const units = value / step;
  const rounded = up ? Math.ceil(units - 1e-9) : Math.floor(units + 1e-9);
  return Number((rounded * step).toPrecision(8));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
