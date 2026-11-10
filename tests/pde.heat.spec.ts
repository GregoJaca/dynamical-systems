import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/pde/check';
import { parseProblem } from '../src/pde/parse';
import { solveHeat } from '../src/pde/heat/solveHeat';
import type { HeatProblem, HeatSolution } from '../src/pde/types';

function heat(lines: string[]): { problem: HeatProblem; solution: HeatSolution } {
  const problem = parseProblem(lines);
  if (problem.family !== 'heat') throw new Error('expected a heat problem');
  return { problem, solution: solveHeat(problem) };
}

describe('heat solvers', () => {
  it('reproduces the first Dirichlet eigenmode on (0, pi)', () => {
    const { solution } = heat(['u_t = u_xx', '0 < x < pi', 'u(0, t) = 0', 'u(pi, t) = 0', 'u(x, 0) = sin(x)']);
    expect(solution.features).toContain('separation');
    expect(solution.frames[0]?.id).toBe('original');
    for (const t of [0, 0.3, 0.8]) {
      for (const x of [0.4, 1.2, 2.2]) {
        const expected = Math.exp(-t) * Math.sin(x);
        expect(Math.abs(solution.frames[0].evaluate(x, t) - expected)).toBeLessThan(1e-6);
      }
    }
    expect(solution.residual.pde).toBeLessThan(1e-6);
    expect(solution.residual.initial).toBeLessThan(1e-6);
    expect(solution.residual.boundary).toBeLessThan(1e-6);
  });

  it('keeps the Neumann constant mode', () => {
    const { solution } = heat([
      'u_t = u_xx',
      '0 < x < pi',
      'u_x(0, t) = 0',
      'u_x(pi, t) = 0',
      'u(x, 0) = 2+cos(x)',
    ]);
    for (const t of [0, 0.4, 1]) {
      for (const x of [0.2, 1, 2.4]) {
        const expected = 2 + Math.exp(-t) * Math.cos(x);
        expect(Math.abs(solution.frames[0].evaluate(x, t) - expected)).toBeLessThan(1e-6);
      }
    }
  });

  it('spreads a gaussian on the line', () => {
    const { solution } = heat(['u_t = u_xx', 'x in R', 'u(x, 0) = exp(-x^2)']);
    const sigma2 = 0.5;
    const t = 1;
    const factor = Math.sqrt(sigma2 / (sigma2 + 2 * t));
    const expected = (x: number) => factor * Math.exp(-(x * x) / (2 * (sigma2 + 2 * t)));
    for (const x of [0, 0.3, -0.8, 1.1]) {
      expect(Math.abs(solution.frames[0].evaluate(x, t) - expected(x))).toBeLessThan(1e-3);
    }
  });

  it('conserves the mass of a rectangle indicator', () => {
    const { solution } = heat(['u_t = u_xx', 'x in R', 'u(x, 0) = rect(x,-1,1)']);
    const u = solution.frames[0].evaluate;
    expect(u(0, 0.5)).toBeGreaterThan(0);
    const a = -10;
    const b = 10;
    const n = 400;
    const h = (b - a) / n;
    let mass = u(a, 0.5) + u(b, 0.5);
    for (let i = 1; i < n; i += 1) mass += (i % 2 === 0 ? 2 : 4) * u(a + i * h, 0.5);
    mass = (mass * h) / 3;
    expect(mass).toBeCloseTo(2, 1);
  });

  it('enforces Dirichlet data on the half-line by an odd extension', () => {
    const { solution } = heat(['u_t = u_xx', 'x > 0', 'u(0, t) = 0', 'u(x, 0) = sin(x)']);
    expect(solution.method).toBe('images');
    expect(Math.abs(solution.frames[0].evaluate(0, 0.3))).toBeLessThan(1e-3);
    expect(Math.abs(solution.frames[0].evaluate(0.02, 0.4))).toBeLessThan(0.05);
  });

  it('removes constant convection before separating variables', () => {
    const { solution } = heat([
      'u_t = u_xx + 2 u_x',
      '0 < x < pi',
      'u(0, t) = 0',
      'u(pi, t) = 0',
      'u(x, 0) = sin(x)',
    ]);
    expect(solution.features).toContain('convection');
    expect(solution.residual.pde).toBeLessThan(1e-2);
  });

  it('finds the Robin eigenvalues, including a growing mode when h is negative', () => {
    const positive = heat([
      'u_t = u_xx',
      '0 < x < 1',
      'u(0, t) = 0',
      'u_x(1, t) + h*u(1, t) = 0',
      'u(x, 0) = x',
      'h = 2',
    ]);
    const h = 2;
    const mu = Math.sqrt(positive.solution.modes.find((mode) => mode.lambda > 0)?.lambda ?? Number.NaN);
    expect(Math.abs(Math.tan(mu) + mu / h)).toBeLessThan(1e-3);
    expect(positive.solution.features).toContain('robin');

    const negative = heat([
      'u_t = u_xx',
      '0 < x < 1',
      'u(0, t) = 0',
      'u_x(1, t) + h*u(1, t) = 0',
      'u(x, 0) = x',
      'h = -3',
    ]);
    expect(negative.solution.modes.some((mode) => mode.lambda < 0)).toBe(true);
  });

  it('accepts the sine mode and rejects a cosine or a factor-of-two mistake', () => {
    const { problem, solution } = heat(['u_t = u_xx', '0 < x < pi', 'u(0, t) = 0', 'u(pi, t) = 0', 'u(x, 0) = sin(x)']);
    const good = checkAnswer(problem, solution, 'exp(-t)*sin(x)');
    expect(good.ok).toBe(true);
    const cosine = checkAnswer(problem, solution, 'exp(-t)*cos(x)');
    expect(cosine.ok).toBe(false);
    const twice = checkAnswer(problem, solution, '2*exp(-t)*sin(x)');
    expect(twice.ok).toBe(false);
    expect(twice.diagnoses.join(' ')).toMatch(/2\/L|1\/L|factor of 2/);
  });

  it('records the corner jump of a constant initial trace', () => {
    const { solution } = heat(['u_t = u_xx', '0 < x < pi', 'u(0, t) = 0', 'u(pi, t) = 0', 'u(x, 0) = 1']);
    expect(solution.features).toContain('compatibility');
    expect(solution.compatibility?.jump).toBeCloseTo(1, 1);
    expect(solution.compatibility?.decayLatex ?? '').toMatch(/1\/n/);
    expect(solution.compatibility?.decayLatex ?? '').not.toMatch(/1\/n\^2|n\^2/);
  });

  it('solves a viscous Riemann problem by Cole–Hopf and records the entropy shock', () => {
    const { solution } = heat(['u_t + u u_x = nu u_xx', 'x in R', 'u(x, 0) = heaviside(-x)', 'nu = 0.05']);
    expect(solution.features).toContain('cole-hopf');
    const entropy = solution.burgers?.entropy;
    if (!entropy) throw new Error('missing entropy solution');
    const atShockTime = entropy(0, 1);
    expect(atShockTime).toBeGreaterThanOrEqual(0);
    expect(atShockTime).toBeLessThanOrEqual(1);
    expect(entropy(-1, 1)).toBeCloseTo(1, 2);
    expect(entropy(1, 1)).toBeCloseTo(0, 2);
    expect(solution.residual.pde).toBeLessThan(1e-2);
  });
});
