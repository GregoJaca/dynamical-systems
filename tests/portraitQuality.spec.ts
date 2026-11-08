import { describe, expect, it } from 'vitest';
import { levelContours } from '../src/render2d/contours';
import { compileScalarField } from '../src/render2d/scalars';
import { generateStreamlines } from '../src/numeric/streamlines';
import { fieldAngle, light, withManifolds } from './light';

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
    const polar = light('exam-2').bundle.polar;
    expect(polar?.isRecommended).toBe(true);
    expect(polar?.origin?.[0]).toBeCloseTo(-1, 5);
    expect(polar?.origin?.[1]).toBeCloseTo(0, 5);
  }, 60_000);

  it('keeps the stable-focus eigenvalues as exact square roots', () => {
    const origin = light('exam-10').equilibria.find((eq) => Math.hypot(eq.coords[0] ?? 0, eq.coords[1] ?? 0) < 1e-6);
    expect(origin?.classification2D).toBe('stable_focus');
    const formulas = (origin?.eigenvalues ?? []).map((lambda) => lambda.exactLatex ?? '').join(' ');
    expect(formulas).toContain('\\sqrt{15}');
    expect(origin?.trace.exactLatex).toBe('-1');
    expect(origin?.determinant.exactLatex).toBe('4');
  }, 60_000);

  it('carries the saddle separatrix onto the saddle-node it approaches', () => {
    const study = withManifolds('exam-22');
    const saddle = study.equilibria.find((eq) => Math.hypot((eq.coords[0] ?? 0) + 1, (eq.coords[1] ?? 0) + 1) < 0.05);
    const branch = study.manifolds.find((item) => item.equilibriumId === saddle?.id && item.kind === 'Ws');
    const end = branch?.points.at(-1) ?? [];
    expect(Math.hypot(end[0] ?? 1, end[1] ?? 1)).toBeLessThan(0.08);
  }, 60_000);

  it('follows the field out of a neighborhood of the saddle along its unstable manifold', () => {
    const study = withManifolds('exam-23');
    const saddle = study.equilibria.find((eq) => Math.hypot((eq.coords[0] ?? 0) - 1, eq.coords[1] ?? 0) < 0.05);
    const branches = study.manifolds.filter((item) => item.equilibriumId === saddle?.id && item.kind === 'Wu');
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) {
      const end = branch.points.at(-1) ?? [];
      expect(Math.hypot((end[0] ?? 0) - (saddle?.coords[0] ?? 0), (end[1] ?? 0) - (saddle?.coords[1] ?? 0))).toBeGreaterThan(0.5);
      expect(fieldAngle(study.compiled, branch.points)).toBeLessThan(0.35);
    }
  });

  it('draws nested level curves of the Lyapunov function', () => {
    for (const id of ['exam-13', 'exam-16']) {
      const study = light(id);
      expect(study.bundle.global.lyapunov?.classification).toBe('strict_lyapunov');
      const field = compileScalarField(study.bundle.global.lyapunov?.vExpr, ['x', 'y'], {}, 't');
      expect(field).not.toBeNull();
      const levels = levelContours(field!, -2.5, 2.5, -2.5, 2.5);
      expect(levels.length).toBeGreaterThan(3);
      const longest = Math.max(...levels.map((path) => span(path)));
      expect(longest).toBeGreaterThan(0.4);
    }
  }, 60_000);

  it('seeds trajectories around every equilibrium', () => {
    const study = light('exam-11');
    const streamlines = generateStreamlines(study.compiled, study.viewport, study.equilibria, []);
    for (const eq of study.equilibria) {
      const nearby = streamlines.some((curve) =>
        curve.points.some((point) => Math.hypot((point[0] ?? 0) - (eq.coords[0] ?? 0), (point[1] ?? 0) - (eq.coords[1] ?? 0)) < 0.45),
      );
      expect(nearby, eq.coords.join(',')).toBe(true);
    }
  }, 60_000);
});
