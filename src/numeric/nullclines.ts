import type { CompiledSystem, Nullcline, ViewportBounds } from '../core/types';
import { symbolToLatex } from '../input/parser';

export function computeNullclines(compiled: CompiledSystem, viewport: ViewportBounds, resolution = 36): Nullcline[] {
  if (compiled.stateVars.length < 2) return [];
  const curves: Nullcline[] = [];
  for (const component of [0, 1]) {
    const segments = marchingSquares(compiled, viewport, component, resolution);
    curves.push({
      id: `nullcline-${component}`,
      component,
      variableLatex: symbolToLatex(compiled.stateVars[component] ?? 'x'),
      points: segments,
      formulaLatex: `\\dot{${symbolToLatex(compiled.stateVars[component] ?? 'x')}} = 0`,
    });
  }
  return curves;
}

function marchingSquares(compiled: CompiledSystem, viewport: ViewportBounds, component: number, resolution: number): number[][][] {
  const values: number[][] = [];
  for (let j = 0; j <= resolution; j += 1) {
    const row: number[] = [];
    const y = viewport.yMin + ((viewport.yMax - viewport.yMin) * j) / resolution;
    for (let i = 0; i <= resolution; i += 1) {
      const x = viewport.xMin + ((viewport.xMax - viewport.xMin) * i) / resolution;
      const velocity = compiled.f(0, [x, y], compiled.parameterValues);
      row.push(velocity[component] ?? 0);
    }
    values.push(row);
  }
  const segments: number[][][] = [];
  for (let j = 0; j < resolution; j += 1) {
    for (let i = 0; i < resolution; i += 1) {
      const corners = [
        values[j]?.[i] ?? 0,
        values[j]?.[i + 1] ?? 0,
        values[j + 1]?.[i + 1] ?? 0,
        values[j + 1]?.[i] ?? 0,
      ];
      const hits = cellCrossings(viewport, resolution, i, j, corners);
      if (hits.length === 2) segments.push(hits);
    }
  }
  return segments;
}

function cellCrossings(viewport: ViewportBounds, resolution: number, i: number, j: number, corners: number[]): number[][] {
  const x0 = viewport.xMin + ((viewport.xMax - viewport.xMin) * i) / resolution;
  const x1 = viewport.xMin + ((viewport.xMax - viewport.xMin) * (i + 1)) / resolution;
  const y0 = viewport.yMin + ((viewport.yMax - viewport.yMin) * j) / resolution;
  const y1 = viewport.yMin + ((viewport.yMax - viewport.yMin) * (j + 1)) / resolution;
  const edges: Array<[number, number, number, number, number, number]> = [
    [x0, y0, x1, y0, corners[0] ?? 0, corners[1] ?? 0],
    [x1, y0, x1, y1, corners[1] ?? 0, corners[2] ?? 0],
    [x1, y1, x0, y1, corners[2] ?? 0, corners[3] ?? 0],
    [x0, y1, x0, y0, corners[3] ?? 0, corners[0] ?? 0],
  ];
  const points: number[][] = [];
  for (const [ax, ay, bx, by, va, vb] of edges) {
    if (va === 0) points.push([ax, ay]);
    else if (va * vb < 0) {
      const t = va / (va - vb);
      points.push([ax + t * (bx - ax), ay + t * (by - ay)]);
    }
  }
  const unique: number[][] = [];
  for (const point of points) {
    if (!unique.some((other) => Math.hypot((other[0] ?? 0) - (point[0] ?? 0), (other[1] ?? 0) - (point[1] ?? 0)) < 1e-9)) unique.push(point);
  }
  return unique.slice(0, 2);
}
