import { describe, expect, it } from 'vitest';
import { parseProblem } from '../src/pde/parse';
import { solveChar } from '../src/pde/char/solveChar';
import type { CharProblem, CharSolution } from '../src/pde/types';

function solve(lines: string[]): CharSolution {
  const problem = parseProblem(lines);
  if (problem.family !== 'characteristics') throw new Error('expected a characteristic problem');
  return solveChar(problem);
}

function field(solution: CharSolution): (x: number, t: number) => number {
  const frame = solution.frames[0];
  if (!frame) throw new Error('missing frame');
  return (x, t) => frame.evaluate(x, t);
}

describe('method of characteristics', () => {
  it('transports a sine wave at speed 1', () => {
    const solution = solve(['u_t + u_x = 0', 'x in R', 'u(x, 0) = sin(x)']);
    const u = field(solution);
    for (const [x, t] of [[0, 0], [1, 0.3], [-2, 1], [0.5, 2]] as const) {
      expect(Math.abs(u(x, t) - Math.sin(x - t))).toBeLessThan(1e-6);
    }
    expect(solution.exact).toBe(true);
    expect(solution.residual.pde).toBeLessThan(1e-6);
    expect(solution.residual.data).toBeLessThan(1e-6);
    expect(solution.features).toContain('characteristics');
    expect(solution.curves.length).toBeGreaterThanOrEqual(8);
    expect(solution.dataCurve.length).toBeGreaterThan(4);
  });

  it('carries a damped sine wave', () => {
    const solution = solve(['u_t + 2 u_x + 3 u = 0', 'x in R', 'u(x,0)=sin(x)']);
    const u = field(solution);
    for (const [x, t] of [[0.4, 0.2], [-1, 0.5], [1.2, 0]] as const) {
      expect(Math.abs(u(x, t) - Math.sin(x - 2 * t) * Math.exp(-3 * t))).toBeLessThan(1e-6);
    }
    expect(solution.exact).toBe(true);
    expect(solution.residual.pde).toBeLessThan(1e-6);
  });

  it('integrates a constant source', () => {
    const solution = solve(['u_t + u_x = 1', 'x in R', 'u(x,0)=0']);
    const u = field(solution);
    for (const t of [0, 0.4, 1.5, 2]) expect(Math.abs(u(0.3, t) - t)).toBeLessThan(1e-6);
    expect(solution.residual.pde).toBeLessThan(1e-6);
    expect(solution.residual.data).toBeLessThan(1e-6);
  });

  it('solves the Euler equation in the plane', () => {
    const solution = solve(['x u_x + y u_y = u', 'x in R', 'u(x, 1) = x^2']);
    expect(solution.vars).toBe('xy');
    const u = field(solution);
    expect(Math.abs(u(2, 4) - 1)).toBeLessThan(1e-6);
    expect(solution.residual.pde).toBeLessThan(1e-6);
    expect(solution.residual.data).toBeLessThan(1e-6);
    expect(solution.exact).toBe(true);
  });

  it('selects the entropy shock for a downward jump', () => {
    const solution = solve(['u_t + u u_x = 0', 'x in R', 'u(x,0)=heaviside(-x)']);
    const u = field(solution);
    expect(u(-1, 1)).toBeCloseTo(1, 5);
    expect(u(0.2, 1)).toBeCloseTo(1, 5);
    expect(u(0.8, 1)).toBeCloseTo(0, 5);
    expect(u(2, 1)).toBeCloseTo(0, 5);
    expect(solution.features).toContain('shock');
    expect(solution.features).toContain('cole-hopf');
    expect(solution.shock).toBeTruthy();
    expect(Math.abs((solution.equalArea?.areaGap ?? 1))).toBeLessThan(1e-6);
  });

  it('opens a rarefaction for an upward jump', () => {
    const solution = solve(['u_t + u u_x = 0', 'x in R', 'u(x,0)=heaviside(x)']);
    const u = field(solution);
    expect(Math.abs(u(0, 1))).toBeLessThan(1e-6);
    expect(Math.abs(u(0.5, 1) - 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(u(2, 1) - 1)).toBeLessThan(1e-6);
    expect(solution.features).toContain('rarefaction');
    expect(solution.features).not.toContain('shock');
  });

  it('breaks the compression wave u=-x at time 1', () => {
    const solution = solve(['u_t + u u_x = 0', 'x in R', 'u(x,0)=-x']);
    expect(solution.breaking).toBeTruthy();
    expect(Math.abs((solution.breaking?.t ?? 0) - 1)).toBeLessThan(0.02);
  });

  it('solves the eikonal point problem by distance', () => {
    const solution = solve(['u_x^2 + u_y^2 = 1', 'x in R', 'u(0,0)=0']);
    const u = field(solution);
    expect(Math.abs(u(3, 4) - 5)).toBeLessThan(1e-6);
    expect(solution.features).toContain('eikonal');
    expect(solution.exact).toBe(true);
    expect(solution.rays?.length).toBeGreaterThanOrEqual(8);
    expect(solution.residual.pde).toBeLessThan(1e-6);
    expect(solution.residual.data).toBeLessThan(1e-6);
  });

  it('splits a half-line problem into inflow regions', () => {
    const solution = solve(['u_t + u_x = 0', 'x > 0', 'u(x,0)=0', 'u(0,t)=1']);
    const u = field(solution);
    expect(u(0.5, 1)).toBeCloseTo(1, 5);
    expect(u(2, 1)).toBeCloseTo(0, 5);
    expect(solution.features).toContain('boundary-regions');
    expect(solution.regions?.length).toBe(2);
    expect(solution.residual.pde).toBeLessThan(1e-6);
  });

  it('keeps the dilation foot exact', () => {
    const solution = solve(['u_t + k*x*u_x = 0', 'x in R', 'u(x,0)=sin(x)', 'k=1']);
    const u = field(solution);
    const t = Math.log(2);
    expect(Math.abs(u(1, t) - Math.sin(0.5))).toBeLessThan(1e-6);
    expect(solution.exact).toBe(true);
  });
});

describe('parsed characteristic problems stay on the char family', () => {
  it('accepts the lines the lab writes', () => {
    const problem = parseProblem(['u_t + u_x = 0', 'x in R', 'u(x, 0) = sin(x)']);
    const char = problem as CharProblem;
    expect(char.family).toBe('characteristics');
    expect(char.aExpr).toBe('1');
    expect(char.bExpr).toBe('1');
  });
});
