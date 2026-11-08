import { describe, expect, it } from 'vitest';
import { exampleById, exampleToSpec } from '../src/examples/perkoExamples';
import { analyzeNumeric } from '../src/numeric/analyze';

function study(id: string) {
  const example = exampleById(id);
  if (!example) throw new Error(id);
  return analyzeNumeric(exampleToSpec(example));
}

describe('orbits and center manifolds', () => {
  it('writes the center manifold of exercise 8 as the quadratic graph and reads its stability', () => {
    const analysis = study('exam-8');
    const surface = analysis.manifoldSurfaces.find((item) => item.kind === 'Wc');
    expect(surface?.formulaLatex).toBe('y = -\\frac{12}{5}\\left(x_{2}\\right)^{2}-\\frac{2}{5}\\left(x_{1}\\right)\\left(x_{2}\\right)-\\frac{13}{5}\\left(x_{1}\\right)^{2}');
    expect(surface?.reducedDynamicsLatex).toContain('\\dot u');
    const origin = analysis.equilibria.find((eq) => eq.coords.every((value) => Math.abs(value) < 1e-6));
    expect(origin?.stability).toBe('asymptotically_stable');
  }, 30_000);

  it('finds the van der Pol cycle and the homoclinic and heteroclinic connections', () => {
    const cycle = study('van-der-pol').limitCycles[0];
    expect(cycle?.stability).toBe('stable');
    expect(cycle && cycle.points.length).toBeGreaterThan(20);
    const xs = cycle?.points.map((point) => point[0] ?? 0) ?? [];
    const ys = cycle?.points.map((point) => point[1] ?? 0) ?? [];
    expect(Math.max(...xs.map((value) => Math.abs(value)))).toBeLessThan(4);
    expect(Math.max(...ys.map((value) => Math.abs(value)))).toBeLessThan(5);

    const loop = study('reversible-center');
    expect(loop.manifolds.some((branch) => branch.connectionType === 'homoclinic')).toBe(true);

    expect(study('duffing').manifolds.some((branch) => branch.connectionType === 'homoclinic')).toBe(true);

    const pendulum = study('damped-pendulum');
    expect(pendulum.manifolds.some((branch) => branch.connectionType === 'heteroclinic')).toBe(true);
    expect(pendulum.coordinateTransforms.polar2D?.isRecommended).toBe(false);
    expect(study('undamped-pendulum').coordinateTransforms.polar2D?.isRecommended).toBe(false);
  }, 60_000);

  it('states the Poincaré index only when it constrains the phase portrait', () => {
    expect(study('saddle-separatrix').global.applicableTheorems.some((theorem) => theorem.id === 'poincare-index')).toBe(false);
    expect(study('linear-center').global.applicableTheorems.some((theorem) => theorem.id === 'poincare-index')).toBe(false);
    const cusp = study('nilpotent-cusp');
    expect(cusp.global.applicableTheorems.some((theorem) => theorem.id === 'poincare-index')).toBe(true);
    expect(cusp.global.applicableTheorems.find((theorem) => theorem.id === 'poincare-index')?.applicationToSystemLatex).toContain('0');
    expect(study('competing-species').global.applicableTheorems.some((theorem) => theorem.id === 'poincare-index')).toBe(true);
  }, 60_000);

  it('reduces the radial sink to rho dot = -rho', () => {
    const analysis = study('radial-sink-3d');
    expect(analysis.coordinateTransforms.spherical3D?.isRecommended).toBe(true);
    expect(analysis.coordinateTransforms.spherical3D?.rhoDotLatex).toContain('-\\rho');
  }, 30_000);
});
