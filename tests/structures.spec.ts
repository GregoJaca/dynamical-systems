import { describe, expect, it } from 'vitest';
import type { NumericAnalysis } from '../src/core/types';
import { attachCenterManifolds3D } from '../src/numeric/centerManifold3d';
import { cyclesFromPolar } from '../src/numeric/globalAnalysis';
import { findIsolatedCycles } from '../src/numeric/isolatedCycles';
import { poincareTheorem } from '../src/numeric/poincareReport';
import { light, withManifolds } from './light';

describe('orbits and center manifolds', () => {
  it('writes the center manifold of exercise 8 as the quadratic graph and reads its stability', () => {
    const study = light('exam-8');
    const surface = attachCenterManifolds3D(study.spec, study.equilibria).find((item) => item.kind === 'Wc');
    expect(surface?.formulaLatex).toBe('y = -\\frac{12}{5}\\left(x_{2}\\right)^{2}-\\frac{2}{5}\\left(x_{1}\\right)\\left(x_{2}\\right)-\\frac{13}{5}\\left(x_{1}\\right)^{2}');
    expect(surface?.reducedDynamicsLatex).toContain('\\dot u');
    const origin = study.equilibria.find((eq) => eq.coords.every((value) => Math.abs(value) < 1e-6));
    expect(origin?.stability).toBe('asymptotically_stable');
  });

  it('finds the van der Pol cycle and the homoclinic and heteroclinic connections', () => {
    const vdp = light('van-der-pol');
    const cycle = findIsolatedCycles(vdp.compiled, vdp.equilibria, vdp.viewport)[0];
    expect(cycle?.stability).toBe('stable');
    expect(cycle && cycle.points.length).toBeGreaterThan(20);
    const xs = cycle?.points.map((point) => point[0] ?? 0) ?? [];
    const ys = cycle?.points.map((point) => point[1] ?? 0) ?? [];
    expect(Math.max(...xs.map((value) => Math.abs(value)))).toBeLessThan(4);
    expect(Math.max(...ys.map((value) => Math.abs(value)))).toBeLessThan(5);

    expect(withManifolds('reversible-center').manifolds.some((branch) => branch.connectionType === 'homoclinic')).toBe(true);
    expect(withManifolds('duffing').manifolds.some((branch) => branch.connectionType === 'homoclinic')).toBe(true);
    const pendulum = withManifolds('damped-pendulum');
    expect(pendulum.manifolds.some((branch) => branch.connectionType === 'heteroclinic')).toBe(true);
    expect(pendulum.bundle.polar?.isRecommended).toBe(false);
    expect(light('undamped-pendulum').bundle.polar?.isRecommended).toBe(false);
  });

  it('states the Poincaré index only when it constrains the phase portrait', () => {
    expect(theorem('saddle-separatrix')).toBeNull();
    expect(theorem('linear-center')).toBeNull();
    const cusp = theorem('nilpotent-cusp');
    expect(cusp).not.toBeNull();
    expect(cusp?.applicationToSystemLatex).toContain('0');
    expect(theorem('competing-species')).not.toBeNull();
  });

  it('reduces the radial sink to rho dot = -rho', () => {
    const spherical = light('radial-sink-3d').bundle.spherical;
    expect(spherical?.isRecommended).toBe(true);
    expect(spherical?.rhoDotLatex).toContain('-\\rho');
  });
});

function theorem(id: string) {
  const study = light(id);
  const analysis = {
    equilibria: study.equilibria,
    limitCycles: study.bundle.polar ? cyclesFromPolar(study.bundle.polar) : [],
    manifolds: [],
    streamlines: [],
    nullclines: [],
    manifoldSurfaces: [],
    coordinateTransforms: {},
    global: study.bundle.global,
    viewport: study.viewport,
    revision: study.spec.revision,
  } as NumericAnalysis;
  return poincareTheorem(analysis);
}
