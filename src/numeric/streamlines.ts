import type { CompiledSystem, EquilibriumAnalysis, ManifoldBranch, StreamlineSegment, ViewportBounds } from '../core/types';
import { integrateRK45 } from './rk45';

/**
 * Jobard–Lefer seeding: rings around every equilibrium, then a separation-distance
 * queue. Manifold curves are kept out of this list so a saddle separatrix is not drawn twice.
 */
export function generateStreamlines(
  compiled: CompiledSystem,
  viewport: ViewportBounds,
  equilibria: EquilibriumAnalysis[],
  manifolds: ManifoldBranch[],
): StreamlineSegment[] {
  if (compiled.stateVars.length < 2) return [];
  const width = viewport.xMax - viewport.xMin;
  const dSep = width / 22;
  const grid = new Occupancy(viewport, dSep);
  const curves: StreamlineSegment[] = [];
  const queue: Array<{ x: number; y: number; reason: string }> = [];

  for (const branch of manifolds) {
    if (branch.kind === 'Wc') continue;
    for (const point of branch.points) grid.mark(point[0] ?? 0, point[1] ?? 0);
  }

  for (const eq of equilibria) {
    const kind = eq.classification2D ?? '';
    const around = kind.includes('node') || kind.includes('focus') || kind.includes('center');
    const count = around ? 10 : 6;
    const scale = Math.min(dSep * (around ? 1.15 : 1.6), width * 0.07);
    for (let k = 0; k < count; k += 1) {
      const angle = (2 * Math.PI * k) / count + (around ? 0 : 0.4);
      queue.push({
        x: (eq.coords[0] ?? 0) + scale * Math.cos(angle),
        y: (eq.coords[1] ?? 0) + scale * Math.sin(angle),
        reason: `Characteristic orbit near ${coordText(eq.coords)}`,
      });
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

  const room = Math.min(64, 16 + equilibria.length * 10);
  const later: Array<{ x: number; y: number; reason: string }> = [];
  let guard = 0;
  while (queue.length > 0 && curves.length < room && guard < 160) {
    guard += 1;
    const seed = queue.shift()!;
    const characteristic = seed.reason.startsWith('Characteristic');
    if (!characteristic) {
      later.push(seed);
      continue;
    }
    if (!inside(seed.x, seed.y, viewport)) continue;
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
    segment.id = `orbit-${curves.length}`;
    curves.push(segment);
    for (let index = 0; index < points.length; index += 4) {
      const point = points[index]!;
      grid.mark(point[0] ?? 0, point[1] ?? 0);
      const next = points[Math.min(points.length - 1, index + 1)]!;
      const tx = (next[0] ?? 0) - (point[0] ?? 0);
      const ty = (next[1] ?? 0) - (point[1] ?? 0);
      const norm = Math.hypot(tx, ty) || 1;
      later.push({ x: (point[0] ?? 0) + (dSep * -ty) / norm, y: (point[1] ?? 0) + (dSep * tx) / norm, reason: 'Background streamline' });
      later.push({ x: (point[0] ?? 0) - (dSep * -ty) / norm, y: (point[1] ?? 0) - (dSep * tx) / norm, reason: 'Background streamline' });
    }
  }
  while (later.length > 0 && curves.length < room && guard < 160) {
    guard += 1;
    const seed = later.shift()!;
    if (!inside(seed.x, seed.y, viewport) || grid.blocked(seed.x, seed.y)) continue;
    const forward = shoot(compiled, [seed.x, seed.y], viewport, equilibria, 1);
    const backward = shoot(compiled, [seed.x, seed.y], viewport, equilibria, -1);
    const points = [...backward.points.slice().reverse(), [seed.x, seed.y], ...forward.points];
    if (points.length < 4) continue;
    const segment = fromPoints(points, compiled, equilibria, 'background_streamline', seed.reason, forward.limitId, backward.limitId);
    segment.id = `orbit-${curves.length}`;
    curves.push(segment);
    for (let index = 0; index < points.length; index += 4) {
      const point = points[index]!;
      grid.mark(point[0] ?? 0, point[1] ?? 0);
    }
  }
  return curves.map((curve, index) => ({ ...curve, id: `stream-${index}` }));
}

/** Short orbits for 3D and higher, seeded on real eigendirections and a few interior points. */
export function generateCharacteristicOrbits(
  compiled: CompiledSystem,
  viewport: ViewportBounds,
  equilibria: EquilibriumAnalysis[],
): StreamlineSegment[] {
  const dimension = compiled.stateVars.length;
  if (dimension < 3) return [];
  const span = Math.max(
    viewport.xMax - viewport.xMin,
    viewport.yMax - viewport.yMin,
    (viewport.zMax ?? 1) - (viewport.zMin ?? -1),
  );
  const epsilon = Math.max(0.08, span * 0.035);
  const seeds: number[][] = [];
  const push = (point: number[]) => {
    if (point.length !== dimension || point.some((value) => !Number.isFinite(value))) return;
    if (seeds.some((other) => Math.hypot(...other.map((value, index) => value - (point[index] ?? 0))) < epsilon * 0.35)) return;
    seeds.push(point);
  };
  for (const equilibrium of equilibria) {
    for (const vector of equilibrium.eigenvectors) {
      const norm = Math.hypot(...vector);
      if (norm < 1e-8) continue;
      const step = vector.map((value) => (value / norm) * epsilon);
      push(equilibrium.coords.map((value, index) => value + (step[index] ?? 0)));
      push(equilibrium.coords.map((value, index) => value - (step[index] ?? 0)));
    }
  }
  const center = [
    (viewport.xMin + viewport.xMax) / 2,
    (viewport.yMin + viewport.yMax) / 2,
    ((viewport.zMin ?? -1) + (viewport.zMax ?? 1)) / 2,
  ];
  while (center.length < dimension) center.push(0);
  push(center.map((value, index) => value + (index === 0 ? epsilon : 0)));
  push(center.map((value, index) => value - (index === dimension - 1 ? epsilon : 0)));

  const curves: StreamlineSegment[] = [];
  for (const seed of seeds.slice(0, 16)) {
    const forward = shoot(compiled, seed, viewport, equilibria, 1);
    const backward = shoot(compiled, seed, viewport, equilibria, -1);
    const points = [...backward.points.slice().reverse(), seed, ...forward.points];
    if (points.length < 4) continue;
    curves.push(
      fromPoints(points, compiled, equilibria, 'characteristic_orbit', 'Characteristic orbit', forward.limitId, backward.limitId),
    );
  }
  return curves.map((curve, index) => ({ ...curve, id: `orbit-${index}` }));
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

function coordText(coords: number[]): string {
  const part = (value: number) => {
    if (!Number.isFinite(value)) return '?';
    if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return String(Number(value.toPrecision(3)));
  };
  return `(${coords.map(part).join(', ')})`;
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
