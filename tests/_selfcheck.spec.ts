import { describe, expect, it } from 'vitest';
import { compile } from 'mathjs';
import { parseSystem, compileSystemNumeric } from '../src/input/parser';
import { analyzeNumeric } from '../src/numeric/analyze';
import { integrateRK45 } from '../src/numeric/rk45';
import type { ParameterSpec, SystemSpec } from '../src/core/types';

function sys(rows: string[], extra: Partial<Parameters<typeof parseSystem>[0]> = {}): SystemSpec {
  return parseSystem({
    mode: extra.mode ?? 'autonomous',
    dimension: extra.dimension ?? rows.length,
    stateVars: extra.stateVars,
    rows,
    parameterOverrides: extra.parameterOverrides,
    userLyapunovExpr: extra.userLyapunovExpr,
    revision: 1,
  });
}

function param(name: string, value: number, latex = name): ParameterSpec {
  return { name, latex, value, min: -5, max: 40, step: 0.01 };
}

function near(coords: number[], target: number[], tol = 1e-5): boolean {
  return target.every((value, index) => Math.abs((coords[index] ?? NaN) - value) < tol);
}

describe('selfcheck', () => {
  it('covers the canonical numeric claims', () => {
    const timed = <T>(label: string, run: () => T): T => {
      const start = Date.now();
      const value = run();
      console.log(`${label} ${Date.now() - start}ms`);
      return value;
    };
    const saddle = timed('saddle', () => analyzeNumeric(sys(['x', '-y + x^2'])));
    const origin = saddle.equilibria.find((eq) => near(eq.coords, [0, 0]))!;
    expect(origin.classification2D).toBe('saddle');
    const unstable = saddle.manifolds.filter((branch) => branch.kind === 'Wu');
    const stable = saddle.manifolds.filter((branch) => branch.kind === 'Ws');
    const latex = unstable.map((branch) => branch.taylorSeriesLatex ?? '').join(' ');
    expect(latex.replace(/\s+/g, '')).toMatch(/\\frac\{1\}\{3\}|1\/3/);
    const samples = unstable.flatMap((branch) => branch.points).filter((point) => Math.abs(point[0] ?? 0) <= 1 && Math.abs(point[0] ?? 0) >= 0.05);
    expect(samples.length).toBeGreaterThan(5);
    for (const point of samples) expect(Math.abs((point[1] ?? 0) - (point[0] ?? 0) ** 2 / 3)).toBeLessThan(1e-4);
    const stableSamples = stable.flatMap((branch) => branch.points).filter((point) => Math.abs(point[1] ?? 0) <= 1 && Math.abs(point[1] ?? 0) >= 0.05);
    expect(stableSamples.length).toBeGreaterThan(4);
    for (const point of stableSamples) expect(Math.abs(point[0] ?? 0)).toBeLessThan(1e-3);

    expect(timed('jordan', () => analyzeNumeric(sys(['-x + y', '-y']))).equilibria[0]?.classification2D).toBe('stable_degenerate_node');
    const center = timed('center', () => analyzeNumeric(sys(['-y', 'x'])));
    expect(center.equilibria[0]?.classification2D).toBe('linear_center');
    expect(center.equilibria[0]?.stability).toBe('lyapunov_stable');
    expect(center.global.linearSystemExact?.matrixExponentialLatex.toLowerCase()).toMatch(/cos/);
    expect(center.global.isHamiltonian).toBe(true);

    const weak = timed('weak', () => analyzeNumeric(sys(['-y - x*(x^2+y^2)', 'x - y*(x^2+y^2)'])));
    expect(weak.equilibria[0]?.classification2D).toBe('weak_stable_focus');
    expect(weak.equilibria[0]?.isHyperbolic).toBe(false);
    expect(weak.coordinateTransforms.polar2D?.isRecommended).toBe(true);

    const reversible = timed('reversible', () => analyzeNumeric(sys(['y', '-x + x^2'])));
    expect(reversible.global.isHamiltonian).toBe(true);
    expect(reversible.global.symmetries.some((item) => item.type.startsWith('time_reversible'))).toBe(true);
    expect(reversible.equilibria.find((eq) => near(eq.coords, [0, 0]))?.classification2D).toBe('nonlinear_center');
    expect(reversible.equilibria.some((eq) => near(eq.coords, [1, 0]))).toBe(true);
    const compiled = compileSystemNumeric(reversible.spec ? reversible : sys(['y', '-x + x^2']));
    const spec = sys(['y', '-x + x^2']);
    const energy = compile(analyzeNumeric(spec).global.hamiltonianExpr!);
    const trajectory = integrateRK45({ t0: 0, t1: 10, y0: [0.2, 0], params: {}, f: compileSystemNumeric(spec).f, rtol: 1e-9, atol: 1e-11 });
    const h0 = Number(energy.evaluate({ x: trajectory.y[0]![0], y: trajectory.y[0]![1] }));
    let drift = 0;
    for (const point of trajectory.y) drift = Math.max(drift, Math.abs(Number(energy.evaluate({ x: point[0], y: point[1] })) - h0));
    expect(drift).toBeLessThan(1e-6);
    void compiled;

    const cm = timed('center-manifold', () => analyzeNumeric(sys(['x*y', '-y - x^2'])));
    const cmOrigin = cm.equilibria.find((eq) => near(eq.coords, [0, 0]))!;
    expect(cmOrigin.stability).toBe('asymptotically_stable');
    const wc = cm.manifolds.find((branch) => branch.kind === 'Wc');
    expect(wc?.reducedDynamicsLatex ?? '').toMatch(/u\^\{3\}|u\^3/);
    expect(wc?.taylorSeriesLatex ?? '').toMatch(/-x\^\{2\}|-x\^2|-u\^\{2\}/);

    const hopf = analyzeNumeric(sys(['mu*x - y - x*(x^2+y^2)', 'x + mu*y - y*(x^2+y^2)'], { parameterOverrides: { mu: param('mu', 1, '\\mu') } }));
    expect(hopf.coordinateTransforms.polar2D?.isRecommended).toBe(true);
    expect(hopf.limitCycles.some((cycle) => Math.abs((cycle.radius ?? NaN) - 1) < 1e-3)).toBe(true);
    const semi = analyzeNumeric(sys(['-y + x*(x^2+y^2 - 1)^2', 'x + y*(x^2+y^2 - 1)^2']));
    expect(semi.limitCycles.some((cycle) => cycle.stability === 'semi_stable' && Math.abs((cycle.radius ?? NaN) - 1) < 1e-3)).toBe(true);

    const competing = analyzeNumeric(sys(['x*(3 - x - 2*y)', 'y*(2 - x - y)']));
    for (const point of [[0, 0], [3, 0], [0, 2], [1, 1]]) expect(competing.equilibria.some((eq) => near(eq.coords, point))).toBe(true);
    const lotka = analyzeNumeric(sys(['x*(alpha - beta*y)', 'y*(delta*x - gamma)']));
    expect(lotka.equilibria.some((eq) => near(eq.coords, [0, 0]))).toBe(true);
    expect(lotka.equilibria.some((eq) => near(eq.coords, [1, 1]))).toBe(true);

    const pendulum = analyzeNumeric(sys(["theta'' + sin(theta) = 0"], { mode: 'second_order_scalar', dimension: 2, stateVars: ['theta', 'omega'] }));
    expect(pendulum.global.isHamiltonian).toBe(true);
    for (const point of [[-Math.PI, 0], [0, 0], [Math.PI, 0]]) expect(pendulum.equilibria.some((eq) => near(eq.coords, point))).toBe(true);
    const energyP = compile(pendulum.global.hamiltonianExpr!);
    const atRest = Number(energyP.evaluate({ theta: 0, omega: 0 }));
    const lifted = Number(energyP.evaluate({ theta: Math.PI / 2, omega: 0 }));
    expect(lifted - atRest).toBeCloseTo(1, 6);

    const duffing = analyzeNumeric(sys(['y', 'x - x^3']));
    expect(duffing.global.isHamiltonian).toBe(true);
    for (const point of [[-1, 0], [0, 0], [1, 0]]) expect(duffing.equilibria.some((eq) => near(eq.coords, point))).toBe(true);

    const wells = analyzeNumeric(sys(['x*(1-x^2)', 'y*(1-y^2)']));
    expect(wells.global.isGradientSystem).toBe(true);
    expect(wells.equilibria).toHaveLength(9);
    expect(analyzeNumeric(sys(['y', '-x - (1 + x^2 + x^4)*y'])).global.bendixsonDulac?.applies).toBe(true);
    expect(analyzeNumeric(sys(['-y - x^3', 'x - y^3'], { userLyapunovExpr: '(x^2+y^2)/2' })).global.lyapunov?.classification).toBe('strict_lyapunov');
    const cusp = analyzeNumeric(sys(['y', 'x^2']));
    expect(cusp.equilibria[0]?.classification2D).toBe('cusp');
    expect(cusp.equilibria[0]?.poincareIndex2D).toBe(0);

    const focus = analyzeNumeric(sys(['-0.5*x - 2*y', '2*x - 0.5*y', 'z'], { dimension: 3, stateVars: ['x', 'y', 'z'] }));
    expect(focus.equilibria[0]?.classification3D).toBe('saddle_focus_1_2');
    const lorenz = analyzeNumeric(
      sys(['sigma*(y-x)', 'x*(rho-z)-y', 'x*y - beta*z'], {
        dimension: 3,
        stateVars: ['x', 'y', 'z'],
        parameterOverrides: { sigma: param('sigma', 10), rho: param('rho', 28), beta: param('beta', 8 / 3) },
      }),
    );
    expect(lorenz.equilibria).toHaveLength(3);
    const wing = Math.sqrt(72);
    expect(lorenz.equilibria.some((eq) => near(eq.coords, [wing, wing, 27], 1e-4))).toBe(true);
    expect(lorenz.equilibria.some((eq) => near(eq.coords, [-wing, -wing, 27], 1e-4))).toBe(true);
    const cyl = analyzeNumeric(sys(['x*(1 - x^2 - y^2) - y', 'y*(1 - x^2 - y^2) + x', '-z'], { dimension: 3, stateVars: ['x', 'y', 'z'] }));
    expect(cyl.coordinateTransforms.cylindrical3D?.isRecommended).toBe(true);
    const coupled = analyzeNumeric(
      sys(['x2', '-x1 - 0.2*x2 + 0.1*x3', 'x4', '-2*x3 + 0.1*x1'], { dimension: 4, stateVars: ['x1', 'x2', 'x3', 'x4'] }),
    );
    expect(coupled.equilibria.some((eq) => near(eq.coords, [0, 0, 0, 0]))).toBe(true);
  }, 120_000);
});
