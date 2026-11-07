import { describe, expect, it } from 'vitest';
import { exampleToSpec, PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { analyzeNumeric } from '../src/numeric/analyze';
import { levelContours } from '../src/render2d/contours';
import { compileScalarField } from '../src/render2d/scalars';

function study(id: string) {
  const example = PERKO_EXAMPLES.find((item) => item.id === id);
  if (!example) throw new Error(id);
  return analyzeNumeric(exampleToSpec(example));
}

function span(points: number[][]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0] ?? 0);
    maxX = Math.max(maxX, point[0] ?? 0);
    minY = Math.min(minY, point[1] ?? 0);
    maxY = Math.max(maxY, point[1] ?? 0);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

describe('portrait quality', () => {
  it('shifts polar coordinates onto a unique center away from the origin', () => {
    const analysis = study('exam-2');
    const polar = analysis.coordinateTransforms.polar2D;
    expect(polar?.isRecommended).toBe(true);
    expect(polar?.origin?.[0]).toBeCloseTo(-1, 5);
    expect(polar?.origin?.[1]).toBeCloseTo(0, 5);
  }, 60_000);

  it('keeps the stable-focus eigenvalues as exact square roots', () => {
    const analysis = study('exam-10');
    const origin = analysis.equilibria.find((eq) => Math.hypot(eq.coords[0] ?? 0, eq.coords[1] ?? 0) < 1e-6);
    expect(origin?.classification2D).toBe('stable_focus');
    const formulas = (origin?.eigenvalues ?? []).map((lambda) => lambda.exactLatex ?? '').join(' ');
    expect(formulas).toContain('\\sqrt{15}');
    expect(origin?.trace.exactLatex).toBe('-1');
    expect(origin?.determinant.exactLatex).toBe('4');
  }, 60_000);

  it('carries the saddle separatrix onto the saddle-node it approaches', () => {
    const analysis = study('exam-22');
    const saddle = analysis.equilibria.find((eq) => Math.hypot((eq.coords[0] ?? 0) + 1, (eq.coords[1] ?? 0) + 1) < 0.05);
    const branch = analysis.manifolds.find((item) => item.equilibriumId === saddle?.id && item.kind === 'Ws');
    const end = branch?.points.at(-1) ?? [];
    expect(Math.hypot(end[0] ?? 1, end[1] ?? 1)).toBeLessThan(0.08);
  }, 60_000);

  it('draws the saddle unstable manifold far enough to leave a neighborhood of the saddle', () => {
    const analysis = study('exam-23');
    const saddle = analysis.equilibria.find((eq) => Math.hypot((eq.coords[0] ?? 0) - 1, eq.coords[1] ?? 0) < 0.05);
    const branches = analysis.manifolds.filter((item) => item.equilibriumId === saddle?.id && item.kind === 'Wu');
    expect(branches.length).toBeGreaterThan(0);
    expect(Math.max(...branches.map((branch) => span(branch.points)))).toBeGreaterThan(1.5);
  }, 60_000);

  it('draws nested level curves of the Lyapunov function', () => {
    for (const id of ['exam-13', 'exam-16']) {
      const analysis = study(id);
      expect(analysis.global.lyapunov?.classification).toBe('strict_lyapunov');
      const field = compileScalarField(analysis.global.lyapunov?.vExpr, ['x', 'y'], {}, 't');
      expect(field).not.toBeNull();
      const levels = levelContours(field!, -2.5, 2.5, -2.5, 2.5);
      expect(levels.length).toBeGreaterThan(3);
      const longest = Math.max(...levels.map((path) => span(path)));
      expect(longest).toBeGreaterThan(0.4);
    }
  }, 60_000);

  it('seeds trajectories around every equilibrium', () => {
    const analysis = study('exam-11');
    for (const eq of analysis.equilibria) {
      const nearby = analysis.streamlines.some((curve) =>
        curve.points.some((point) => Math.hypot((point[0] ?? 0) - (eq.coords[0] ?? 0), (point[1] ?? 0) - (eq.coords[1] ?? 0)) < 0.45),
      );
      expect(nearby, eq.coords.join(',')).toBe(true);
    }
  }, 60_000);
});
