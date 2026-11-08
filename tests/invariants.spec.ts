import { describe, expect, it } from 'vitest';
import { compile, type EvalFunction } from 'mathjs';
import { exampleToSpec, PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { compileSystemNumeric } from '../src/input/parser';
import { cyclesFromPolar } from '../src/numeric/globalAnalysis';
import { integrateRK45 } from '../src/numeric/rk45';
import { light, withManifolds } from './light';
import type { EquilibriumAnalysis, NumericAnalysis, SystemSpec } from '../src/core/types';

function byId(id: string) {
  const example = PERKO_EXAMPLES.find((item) => item.id === id);
  if (!example) throw new Error(`Missing example ${id}`);
  return example;
}

function analyzeId(id: string) {
  const study = light(id);
  return {
    spec: study.spec,
    compiled: study.compiled,
    analysis: {
      equilibria: study.equilibria,
      global: study.bundle.global,
      limitCycles: study.bundle.polar ? cyclesFromPolar(study.bundle.polar) : [],
      coordinateTransforms: {
        polar2D: study.bundle.polar,
        cylindrical3D: study.bundle.cylindrical,
        spherical3D: study.bundle.spherical,
      },
    },
  };
}

function near(coords: number[], target: number[], tol = 1e-5): boolean {
  return target.every((value, index) => Math.abs((coords[index] ?? NaN) - value) < tol);
}

function hasEquilibrium(equilibria: EquilibriumAnalysis[], target: number[], tol = 1e-5): boolean {
  return equilibria.some((eq) => near(eq.coords, target, tol));
}

function residualInf(spec: SystemSpec, coords: number[]): number {
  const compiled = compileSystemNumeric(spec);
  const value = compiled.f(0, coords, compiled.parameterValues);
  return value.reduce((max, entry) => Math.max(max, Math.abs(entry)), 0);
}

function compileExpr(expr: string): EvalFunction {
  return compile(expr);
}

describe('integrator', () => {
  it('preserves the harmonic oscillator over one period', () => {
    const result = integrateRK45({
      t0: 0,
      t1: Math.PI * 2,
      y0: [1, 0],
      params: {},
      rtol: 1e-9,
      atol: 1e-11,
      f: (_t, y) => [-y[1]!, y[0]!],
    });
    const last = result.y[result.y.length - 1]!;
    expect(result.status).toBe('tmax');
    expect(last[0]).toBeCloseTo(1, 6);
    expect(last[1]).toBeCloseTo(0, 6);
  });
});

describe('equilibrium invariants', () => {
  it.each(PERKO_EXAMPLES.map((example) => [example.id, example] as const))(
    '%s has tiny residuals, a consistent spectrum, and a coherent 2D index',
    (id) => {
      const spec = exampleToSpec(byId(String(id)));
      const study = light(String(id));
      expect(study.equilibria.length).toBeGreaterThan(0);

      for (const eq of study.equilibria) {
        expect(residualInf(spec, eq.coords)).toBeLessThan(1e-8);
        const trace = eq.jacobianNumeric.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
        expect(eq.eigenvalues.reduce((sum, lambda) => sum + lambda.re, 0)).toBeCloseTo(trace, 8);
        expect(eq.trace.value).toBeCloseTo(trace, 8);

        if (spec.dimension === 2 && eq.eigenvalues.length >= 2) {
          const det =
            (eq.jacobianNumeric[0]?.[0] ?? 0) * (eq.jacobianNumeric[1]?.[1] ?? 0) -
            (eq.jacobianNumeric[0]?.[1] ?? 0) * (eq.jacobianNumeric[1]?.[0] ?? 0);
          const product =
            eq.eigenvalues[0]!.re * eq.eigenvalues[1]!.re - eq.eigenvalues[0]!.im * eq.eigenvalues[1]!.im;
          expect(product).toBeCloseTo(det, 7);
          expect(eq.determinant.value).toBeCloseTo(det, 7);
          if (eq.isHyperbolic && eq.poincareIndex2D !== undefined) {
            expect(eq.poincareIndex2D).toBe(det < 0 ? -1 : 1);
          }
        }
      }
    },
  );
});

describe('canonical phase portraits', () => {
  it('finds the curved unstable manifold of the hyperbolic saddle', () => {
    const study = withManifolds('saddle-separatrix');
    const analysis = { equilibria: study.equilibria, manifolds: study.manifolds };
    expect(hasEquilibrium(analysis.equilibria, [0, 0])).toBe(true);
    const origin = analysis.equilibria.find((eq) => near(eq.coords, [0, 0]))!;
    expect(origin.classification2D).toBe('saddle');
    expect(origin.poincareIndex2D).toBe(-1);
    expect(origin.isHyperbolic).toBe(true);

    const unstable = analysis.manifolds.filter((branch) => branch.kind === 'Wu' && branch.equilibriumId === origin.id);
    const stable = analysis.manifolds.filter((branch) => branch.kind === 'Ws' && branch.equilibriumId === origin.id);
    expect(unstable.length).toBeGreaterThan(0);
    expect(stable.length).toBeGreaterThan(0);

    const latex = unstable.map((branch) => branch.taylorSeriesLatex ?? '').join(' ');
    expect(latex.replace(/\s+/g, '')).toMatch(/\\frac\{1\}\{3\}|1\/3/);

    const samples = unstable.flatMap((branch) => branch.points).filter((point) => Math.abs(point[0] ?? 0) <= 1 && Math.abs(point[0] ?? 0) >= 0.05);
    expect(samples.length).toBeGreaterThan(5);
    for (const point of samples) {
      expect(Math.abs((point[1] ?? 0) - (point[0] ?? 0) ** 2 / 3)).toBeLessThan(1e-4);
    }

    const stableSamples = stable
      .flatMap((branch) => branch.points)
      .filter((point) => Math.abs(point[1] ?? 0) <= 1 && Math.abs(point[1] ?? 0) >= 0.05);
    expect(stableSamples.length).toBeGreaterThan(4);
    for (const point of stableSamples) {
      expect(Math.abs(point[0] ?? 0)).toBeLessThan(1e-3);
    }

    for (const branch of [...unstable, ...stable]) {
      expect(branch.points.length).toBeGreaterThan(2);
      const start = branch.points[0]!;
      const next = branch.points[1]!;
      expect(near(start, origin.coords, 1e-6)).toBe(true);
      const tangent = [next[0]! - start[0]!, next[1]! - start[1]!];
      const norm = Math.hypot(tangent[0]!, tangent[1]!);
      expect(norm).toBeGreaterThan(0);
      const dots = origin.eigenvectors.map((vector) => {
        const vNorm = Math.hypot(vector[0] ?? 0, vector[1] ?? 0);
        if (vNorm < 1e-12) return 0;
        return Math.abs(((tangent[0] ?? 0) * (vector[0] ?? 0) + (tangent[1] ?? 0) * (vector[1] ?? 0)) / (norm * vNorm));
      });
      expect(Math.max(...dots)).toBeGreaterThan(0.999);
    }
  });

  it('classifies the Jordan node, the linear center, and the weak focus', () => {
    expect(analyzeId('jordan-node').analysis.equilibria[0]?.classification2D).toBe('stable_degenerate_node');
    const center = analyzeId('linear-center');
    expect(center.spec.isLinear).toBe(true);
    expect(center.analysis.equilibria[0]?.classification2D).toBe('linear_center');
    expect(center.analysis.equilibria[0]?.stability).toBe('lyapunov_stable');
    expect(center.analysis.global.linearSystemExact?.matrixExponentialLatex.toLowerCase()).toMatch(/cos/);
    expect(center.analysis.global.isHamiltonian).toBe(true);

    const weak = analyzeId('weak-focus');
    expect(weak.analysis.equilibria[0]?.classification2D).toBe('weak_stable_focus');
    expect(weak.analysis.equilibria[0]?.isHyperbolic).toBe(false);
    expect(weak.analysis.equilibria[0]?.hartmanGrobmanApplies).toBe(false);
    expect(weak.analysis.coordinateTransforms.polar2D?.isRecommended).toBe(true);
  });

  it('conserves the Hamiltonian of the reversible center', () => {
    const { spec, analysis } = analyzeId('reversible-center');
    expect(hasEquilibrium(analysis.equilibria, [0, 0])).toBe(true);
    expect(hasEquilibrium(analysis.equilibria, [1, 0])).toBe(true);
    expect(analysis.global.isHamiltonian).toBe(true);
    expect(analysis.global.hamiltonianExpr).toBeTruthy();
    expect(analysis.global.symmetries.some((item) => item.type.startsWith('time_reversible'))).toBe(true);
    const origin = analysis.equilibria.find((eq) => near(eq.coords, [0, 0]))!;
    expect(origin.classification2D).toBe('nonlinear_center');

    const compiled = compileSystemNumeric(spec);
    const energy = compileExpr(analysis.global.hamiltonianExpr!);
    const trajectory = integrateRK45({
      t0: 0,
      t1: 10,
      y0: [0.2, 0],
      params: compiled.parameterValues,
      f: compiled.f,
      rtol: 1e-9,
      atol: 1e-11,
    });
    const scopeOf = (point: number[]) => Object.fromEntries(spec.stateVars.map((name, index) => [name, point[index] ?? 0]));
    const h0 = Number(energy.evaluate(scopeOf(trajectory.y[0]!)));
    let drift = 0;
    for (const point of trajectory.y) {
      drift = Math.max(drift, Math.abs(Number(energy.evaluate(scopeOf(point))) - h0));
    }
    expect(drift).toBeLessThan(1e-6);
  });

  it('reduces the asymptotically stable center manifold', () => {
    const study = withManifolds('center-manifold-stable');
    const analysis = { equilibria: study.equilibria, manifolds: study.manifolds };
    const origin = analysis.equilibria.find((eq) => near(eq.coords, [0, 0]))!;
    expect(origin.stability).toBe('asymptotically_stable');
    const center = analysis.manifolds.find((branch) => branch.kind === 'Wc' && branch.equilibriumId === origin.id);
    expect(center?.reducedDynamicsLatex ?? center?.taylorSeriesLatex ?? '').toMatch(/x\^3|x\^\{3\}|u\^3|u\^\{3\}/);
    expect(center?.taylorSeriesLatex ?? '').toMatch(/-x\^2|-x\^\{2\}|-u\^2|-u\^\{2\}/);
  });

  it('recommends polar coordinates and locates the Hopf and semi-stable cycles', () => {
    for (const id of ['weak-focus', 'hopf', 'semi-stable-cycle'] as const) {
      const { spec, analysis } = analyzeId(id);
      const polar = analysis.coordinateTransforms.polar2D;
      expect(polar?.isRecommended).toBe(true);
      expect(polar?.rDotExpr).toBeTruthy();
      expect(polar?.thetaDotExpr).toBeTruthy();
      const compiled = compileSystemNumeric(spec);
      const rDot = compileExpr(polar!.rDotExpr);
      const thetaDot = compileExpr(polar!.thetaDotExpr);
      for (let sample = 0; sample < 20; sample += 1) {
        const x = Math.cos(sample) * (0.2 + (sample % 5) * 0.3);
        const y = Math.sin(sample * 1.7) * (0.25 + (sample % 4) * 0.2);
        const radius = Math.hypot(x, y);
        const theta = Math.atan2(y, x);
        const velocity = compiled.f(0, [x, y], compiled.parameterValues);
        const scope = { r: radius, theta, ...compiled.parameterValues };
        expect(Number(rDot.evaluate(scope))).toBeCloseTo((x * velocity[0]! + y * velocity[1]!) / radius, 8);
        expect(Number(thetaDot.evaluate(scope))).toBeCloseTo((x * velocity[1]! - y * velocity[0]!) / radius ** 2, 8);
      }
    }

    const hopf = analyzeId('hopf').analysis;
    expect(hopf.limitCycles.some((cycle) => Math.abs((cycle.radius ?? NaN) - 1) < 1e-3)).toBe(true);
    const semi = analyzeId('semi-stable-cycle').analysis;
    expect(semi.limitCycles.some((cycle) => cycle.stability === 'semi_stable' && Math.abs((cycle.radius ?? NaN) - 1) < 1e-3)).toBe(true);
  });

  it('locates the textbook equilibria of the population, pendulum, and potential models', () => {
    const competing = analyzeId('competing-species').analysis;
    for (const point of [
      [0, 0],
      [3, 0],
      [0, 2],
      [1, 1],
    ]) {
      expect(hasEquilibrium(competing.equilibria, point)).toBe(true);
    }

    const lotka = analyzeId('lotka-volterra').analysis;
    expect(hasEquilibrium(lotka.equilibria, [0, 0])).toBe(true);
    expect(hasEquilibrium(lotka.equilibria, [1, 1])).toBe(true);

    const pendulum = analyzeId('undamped-pendulum');
    expect(pendulum.analysis.global.isHamiltonian).toBe(true);
    for (const point of [
      [-Math.PI, 0],
      [0, 0],
      [Math.PI, 0],
    ]) {
      expect(hasEquilibrium(pendulum.analysis.equilibria, point, 1e-5)).toBe(true);
    }
    const energy = compileExpr(pendulum.analysis.global.hamiltonianExpr!);
    const names = pendulum.spec.stateVars;
    const atRest = Number(energy.evaluate(Object.fromEntries(names.map((name, index) => [name, [0, 0][index] ?? 0]))));
    const lifted = Number(energy.evaluate(Object.fromEntries(names.map((name, index) => [name, [Math.PI / 2, 0][index] ?? 0]))));
    expect(lifted - atRest).toBeCloseTo(1, 6);

    const duffing = analyzeId('duffing');
    expect(duffing.analysis.global.isHamiltonian).toBe(true);
    for (const point of [
      [-1, 0],
      [0, 0],
      [1, 0],
    ]) {
      expect(hasEquilibrium(duffing.analysis.equilibria, point)).toBe(true);
    }

    const wells = analyzeId('gradient-wells').analysis;
    expect(wells.global.isGradientSystem).toBe(true);
    expect(wells.equilibria).toHaveLength(9);

    expect(analyzeId('bendixson').analysis.global.bendixsonDulac?.applies).toBe(true);
    expect(analyzeId('lyapunov-strict').analysis.global.lyapunov?.classification).toBe('strict_lyapunov');
    expect(analyzeId('nilpotent-cusp').analysis.equilibria[0]?.classification2D).toBe('cusp');
    expect(analyzeId('nilpotent-cusp').analysis.equilibria[0]?.poincareIndex2D).toBe(0);
  });

  it('finds the Lorenz equilibria and the 3D saddle-focus', () => {
    const focus = analyzeId('saddle-focus-3d').analysis.equilibria[0]!;
    expect(focus.classification3D).toBe('saddle_focus_1_2');
    expect(focus.eigenvalues.some((lambda) => lambda.re > 0 && Math.abs(lambda.im) < 1e-8)).toBe(true);
    expect(focus.eigenvalues.some((lambda) => lambda.re < 0 && Math.abs(lambda.im) > 0.5)).toBe(true);

    const lorenz = analyzeId('lorenz').analysis;
    expect(lorenz.equilibria).toHaveLength(3);
    expect(hasEquilibrium(lorenz.equilibria, [0, 0, 0], 1e-5)).toBe(true);
    const wing = Math.sqrt(72);
    expect(hasEquilibrium(lorenz.equilibria, [wing, wing, 27], 1e-4)).toBe(true);
    expect(hasEquilibrium(lorenz.equilibria, [-wing, -wing, 27], 1e-4)).toBe(true);

    expect(analyzeId('cylindrical-3d').analysis.coordinateTransforms.cylindrical3D?.isRecommended).toBe(true);
    expect(analyzeId('coupled-4d').spec.dimension).toBe(4);
    expect(analyzeId('coupled-4d').analysis.equilibria.some((eq) => near(eq.coords, [0, 0, 0, 0]))).toBe(true);
  });
});
