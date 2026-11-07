import type { CompiledSystem, EquilibriumAnalysis, ManifoldBranch, StreamlineSegment, ViewportBounds } from '../core/types';
import { integrateRK45 } from './rk45';

/**
 * Jobard–Lefer seeding: separatrices first, then eigendirection rings, then a
 * separation-distance queue. Integration itself is adaptive RK45.
 */
export function generateStreamlines(
  compiled: CompiledSystem,
  viewport: ViewportBounds,
  equilibria: EquilibriumAnalysis[],
  manifolds: ManifoldBranch[],
): StreamlineSegment[] {
  if (compiled.stateVars.length < 2) return [];
  const width = viewport.xMax - viewport.xMin;
  const dSep = width / 28;
  const grid = new Occupancy(viewport, dSep);
  const curves: StreamlineSegment[] = [];
  const queue: Array<{ x: number; y: number; reason: string }> = [];

  for (const branch of manifolds) {
    if (branch.kind === 'Wc' || branch.points.length < 2) continue;
    const segment = fromPoints(branch.points, compiled, equilibria, 'separatrix', `${branch.kind} separatrix of ${branch.equilibriumId}`);
    curves.push(segment);
    for (const point of segment.points) grid.mark(point[0] ?? 0, point[1] ?? 0);
  }

  for (const eq of equilibria) {
    const kind = eq.classification2D ?? '';
    if (kind.includes('node') || kind.includes('focus') || kind.includes('center')) {
      const scale = Math.min(dSep * 1.4, width * 0.08);
      for (let k = 0; k < 8; k += 1) {
        const angle = (2 * Math.PI * k) / 8;
        queue.push({
          x: (eq.coords[0] ?? 0) + scale * Math.cos(angle),
          y: (eq.coords[1] ?? 0) + scale * Math.sin(angle),
          reason: `Characteristic orbit near ${eq.id}`,
        });
      }
    }
  }

  const nx = 6;
  const ny = 6;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      queue.push({
        x: viewport.xMin + ((i + 0.5) * width) / nx,
        y: viewport.yMin + ((j + 0.5) * (viewport.yMax - viewport.yMin)) / ny,
        reason: 'Background streamline',
      });
    }
  }

  let guard = 0;
  while (queue.length > 0 && curves.length < 18 && guard < 40) {
    guard += 1;
    const seed = queue.shift()!;
    if (!inside(seed.x, seed.y, viewport) || grid.blocked(seed.x, seed.y)) continue;
    const forward = shoot(compiled, [seed.x, seed.y], viewport, equilibria, 1);
    const backward = shoot(compiled, [seed.x, seed.y], viewport, equilibria, -1);
    const points = [...backward.points.slice().reverse(), [seed.x, seed.y], ...forward.points];
    if (points.length < 4) continue;
    const segment = fromPoints(
      points,
      compiled,
      equilibria,
      seed.reason.startsWith('Characteristic') ? 'characteristic_orbit' : 'background_streamline',
      seed.reason,
      forward.limitId,
      backward.limitId,
    );
    curves.push(segment);
    for (let index = 0; index < points.length; index += 4) {
      const point = points[index]!;
      grid.mark(point[0] ?? 0, point[1] ?? 0);
      const next = points[Math.min(points.length - 1, index + 1)]!;
      const tx = (next[0] ?? 0) - (point[0] ?? 0);
      const ty = (next[1] ?? 0) - (point[1] ?? 0);
      const norm = Math.hypot(tx, ty) || 1;
      queue.push({ x: (point[0] ?? 0) + (dSep * -ty) / norm, y: (point[1] ?? 0) + (dSep * tx) / norm, reason: 'Background streamline' });
      queue.push({ x: (point[0] ?? 0) - (dSep * -ty) / norm, y: (point[1] ?? 0) - (dSep * tx) / norm, reason: 'Background streamline' });
    }
  }
  return curves.map((curve, index) => ({ ...curve, id: `stream-${index}` }));
}

function shoot(
  compiled: CompiledSystem,
  y0: number[],
  viewport: ViewportBounds,
  equilibria: EquilibriumAnalysis[],
  direction: 1 | -1,
): { points: number[][]; limitId: string } {
  const result = integrateRK45({
    t0: 0,
    t1: direction * 30,
    y0,
    params: compiled.parameterValues,
    f: compiled.f,
    rtol: 1e-4,
    atol: 1e-6,
    maxSteps: 280,
    viewport,
    viewportMargin: 0.02,
    equilibria: equilibria.map((eq) => ({ id: eq.id, coords: eq.coords })),
    sampleDistance: (viewport.xMax - viewport.xMin) / 80,
  });
  const limitId = result.equilibriumId ?? (result.status === 'viewportExit' || result.status === 'blowUp' ? 'infinity' : result.status === 'periodicOrbitDetected' ? 'limit_cycle_0' : 'unresolved');
  return { points: result.y.slice(1), limitId };
}

function fromPoints(
  points: number[][],
  compiled: CompiledSystem,
  equilibria: EquilibriumAnalysis[],
  category: StreamlineSegment['category'],
  reason: string,
  forwardLimitId?: string,
  backwardLimitId?: string,
): StreamlineSegment {
  const velocities = points.map((point) => Math.hypot(...compiled.f(0, point, compiled.parameterValues)));
  return {
    id: 'stream',
    points,
    velocities,
    forwardLimitId: forwardLimitId ?? nearestLimit(points[points.length - 1] ?? [], equilibria),
    backwardLimitId: backwardLimitId ?? nearestLimit(points[0] ?? [], equilibria),
    category,
    reasonTag: reason,
    formulaOrDescriptionLatex: reason,
  };
}

function nearestLimit(point: number[], equilibria: EquilibriumAnalysis[]): string {
  let best = 'unresolved';
  let bestDist = 0.15;
  for (const eq of equilibria) {
    const dist = Math.hypot(...eq.coords.map((value, index) => value - (point[index] ?? 0)));
    if (dist < bestDist) {
      best = eq.id;
      bestDist = dist;
    }
  }
  return best;
}

function inside(x: number, y: number, viewport: ViewportBounds): boolean {
  return x >= viewport.xMin && x <= viewport.xMax && y >= viewport.yMin && y <= viewport.yMax;
}

class Occupancy {
  private readonly cells = new Set<string>();
  constructor(
    private readonly viewport: ViewportBounds,
    private readonly size: number,
  ) {}

  mark(x: number, y: number): void {
    this.cells.add(this.key(x, y));
  }

  blocked(x: number, y: number): boolean {
    const [i, j] = this.index(x, y);
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (this.cells.has(`${i + di}:${j + dj}`)) return true;
      }
    }
    return false;
  }

  private key(x: number, y: number): string {
    const [i, j] = this.index(x, y);
    return `${i}:${j}`;
  }

  private index(x: number, y: number): [number, number] {
    return [Math.floor((x - this.viewport.xMin) / this.size), Math.floor((y - this.viewport.yMin) / this.size)];
  }
}
