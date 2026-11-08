import { describe, expect, it } from 'vitest';
import { exampleById } from '../src/examples/perkoExamples';
import { algebraicZeroSet } from '../src/numeric/algebraicCurve';
import { fieldAngle, light, withManifolds } from './light';
import { generateStreamlines } from '../src/numeric/streamlines';

const window = { xMin: -4, xMax: 4, yMin: -4, yMax: 4 };

function nearest(polylines: number[][][], point: number[]): number {
  let best = Infinity;
  for (const branch of polylines) {
    for (let index = 0; index < branch.length; index += 1) {
      const sample = branch[index] ?? [];
      best = Math.min(best, Math.hypot((sample[0] ?? 0) - (point[0] ?? 0), (sample[1] ?? 0) - (point[1] ?? 0)));
      const next = branch[index + 1];
      if (!next) continue;
      const dx = (next[0] ?? 0) - (sample[0] ?? 0);
      const dy = (next[1] ?? 0) - (sample[1] ?? 0);
      const length = dx * dx + dy * dy;
      const t = length < 1e-18 ? 0 : Math.min(1, Math.max(0, (((point[0] ?? 0) - (sample[0] ?? 0)) * dx + ((point[1] ?? 0) - (sample[1] ?? 0)) * dy) / length));
      best = Math.min(best, Math.hypot((sample[0] ?? 0) + t * dx - (point[0] ?? 0), (sample[1] ?? 0) + t * dy - (point[1] ?? 0)));
    }
  }
  return best;
}

function maxAbs(polylines: number[][][], valueAt: (x: number, y: number) => number): number {
  let worst = 0;
  for (const branch of polylines) {
    for (const sample of branch) worst = Math.max(worst, Math.abs(valueAt(sample[0] ?? 0, sample[1] ?? 0)));
  }
  return worst;
}

describe('exact planar curves', () => {
  it('draws exercise 17 nullclines through the tangencies and the outer saddles', () => {
    const y = algebraicZeroSet('(4 * x^2 + y^2 - 1) * (x^2 + 4 * y^2 - 4)', ['x', 'y'], {}, window);
    expect(y?.exact).toBe(true);
    for (const point of [
      [2, 0],
      [-2, 0],
      [0.5, 0],
      [-0.5, 0],
      [0, 1],
      [0, -1],
    ]) {
      expect(nearest(y?.polylines ?? [], point)).toBeLessThan(1e-6);
    }
    const expanded = algebraicZeroSet('4 * x^4 + 17 * x^2 * y^2 + 4 * y^4 - 17 * x^2 - 8 * y^2 + 4', ['x', 'y'], {}, window);
    expect(expanded?.exact).toBe(true);
    expect(nearest(expanded?.polylines ?? [], [2, 0])).toBeLessThan(1e-6);
    expect(nearest(expanded?.polylines ?? [], [0, 1])).toBeLessThan(1e-6);
    expect(nearest(expanded?.polylines ?? [], [0, -1])).toBeLessThan(1e-6);
  });

  it('draws the exercise 19 circle nullcline and keeps the copied vector field', () => {
    const example = exampleById('exam-19');
    expect(example?.rows[0]).toBe('2 * u - u^3 - u * v^2');
    const circle = algebraicZeroSet('2 * u - u^3 - u * v^2', ['u', 'v'], {}, window);
    expect(circle?.exact).toBe(true);
    expect(nearest(circle?.polylines ?? [], [Math.SQRT2, 0])).toBeLessThan(1e-6);
    expect(nearest(circle?.polylines ?? [], [0, 0])).toBeLessThan(1e-6);
    expect(nearest(circle?.polylines ?? [], [1, 1])).toBeLessThan(1e-6);
    expect(maxAbs(circle?.polylines ?? [], (u, v) => u * (2 - u * u - v * v))).toBeLessThan(1e-8);
    const analysis = light('exam-19');
    expect(analysis.equilibria.map((eq) => eq.coords.map((value) => Number(value.toFixed(4))))).toEqual(
      expect.arrayContaining([
        [-1, 1],
        [0, 0],
        [1, 1],
      ]),
    );
    const origin = analysis.equilibria.find((eq) => Math.hypot(eq.coords[0] ?? 1, eq.coords[1] ?? 1) < 1e-6);
    expect(origin?.classification2D).toBe('unstable_improper_node');
  });

  it('draws parabolas, crossing lines, and the two branches of a hyperbola', () => {
    const parabola = algebraicZeroSet('y - x^2', ['x', 'y'], {}, window);
    expect(parabola?.exact).toBe(true);
    expect(maxAbs(parabola?.polylines ?? [], (x, y) => y - x * x)).toBeLessThan(1e-8);
    expect(nearest(parabola?.polylines ?? [], [1, 1])).toBeLessThan(1e-3);
    const lines = algebraicZeroSet('x^2 - 2 * y^2', ['x', 'y'], {}, window);
    expect(lines?.exact).toBe(true);
    expect(nearest(lines?.polylines ?? [], [Math.SQRT2, 1])).toBeLessThan(1e-6);
    expect(nearest(lines?.polylines ?? [], [Math.SQRT2, -1])).toBeLessThan(1e-6);
    const right = algebraicZeroSet('x^2 - y^2 - 1', ['x', 'y'], {}, window);
    const left = algebraicZeroSet('x^2 - y^2 + 1', ['x', 'y'], {}, window);
    expect(nearest(right?.polylines ?? [], [1, 0])).toBeLessThan(1e-4);
    expect(nearest(left?.polylines ?? [], [0, 1])).toBeLessThan(1e-4);
    expect(nearest(right?.polylines ?? [], [0, 1])).toBeGreaterThan(0.2);
  });
});

describe('separatrices and foci', () => {
  it('keeps the outer saddles of exercise 17 on curves that follow the vector field', () => {
    const { compiled, equilibria, manifolds } = withManifolds('exam-17');
    for (const eq of equilibria.filter((item) => Math.abs(Math.abs(item.coords[0] ?? 0) - 2) < 1e-6)) {
      const branches = manifolds.filter((branch) => branch.equilibriumId === eq.id && (branch.kind === 'Wu' || branch.kind === 'Ws'));
      expect(branches.length).toBe(4);
      for (const branch of branches) expect(fieldAngle(compiled, branch.points)).toBeLessThan(0.35);
    }
  });

  it('carries a stable focus into the equilibrium', () => {
    const study = light('weak-focus');
    const streamlines = generateStreamlines(study.compiled, study.viewport, study.equilibria, []);
    const origin = study.equilibria[0]?.coords ?? [];
    const gaps = streamlines.map((segment) => {
      const ends = [segment.points[0] ?? [], segment.points[segment.points.length - 1] ?? []];
      return Math.min(...ends.map((point) => Math.hypot((point[0] ?? 0) - (origin[0] ?? 0), (point[1] ?? 0) - (origin[1] ?? 0))));
    });
    expect(Math.max(...gaps)).toBeLessThan(1e-6);
  }, 60_000);
});
