import { describe, expect, it } from 'vitest';
import { solveHeat } from '../src/pde/heat/solveHeat';
import { parseProblem } from '../src/pde/parse';

describe('PDE problem parser', () => {
  it('reads a Dirichlet heat problem and its diffusivity', () => {
    const problem = parseProblem(['u_t = k u_xx', '0 < x < pi', 'u(0, t) = 0', 'u(pi, t) = 0', 'u(x, 0) = sin(x)', 'k = 1']);
    expect(problem.family).toBe('heat');
    if (problem.family !== 'heat') return;
    expect(problem.kExpr).toBe('k');
    expect(problem.bExpr).toBe('0');
    expect(problem.sourceExpr).toBe('0');
    expect(problem.burgers).toBe(false);
    expect(problem.domain.kind).toBe('interval');
    expect(problem.initialExpr).toBe('sin(x)');
    expect(problem.parameters.k?.value).toBe(1);
  });

  it('recognises viscous Burgers and a Robin end', () => {
    const burgers = parseProblem(['u_t + u u_x = nu u_xx', 'x in R', 'u(x, 0) = heaviside(-x)', 'nu = 0.05']);
    expect(burgers.family).toBe('heat');
    if (burgers.family !== 'heat') return;
    expect(burgers.burgers).toBe(true);
    expect(burgers.kExpr).toBe('nu');
    expect(burgers.domain.kind).toBe('line');

    const robin = parseProblem([
      'u_t = u_xx',
      '0 < x < 1',
      'u(0, t) = 0',
      'u_x(1, t) + h*u(1, t) = 0',
      'u(x, 0) = x',
      'h = 2',
    ]);
    if (robin.family !== 'heat' || robin.domain.kind !== 'interval') throw new Error('expected an interval');
    expect(robin.domain.right.kind).toBe('robin');
    expect(robin.domain.right.hExpr).toBe('h');
    expect(robin.parameters.h?.value).toBe(2);
  });

  it('keeps an unspecified initial function and does not invent a slope parameter', () => {
    const problem = parseProblem([
      'ut - 3 uxx = 0',
      '0 < x < pi',
      'u(x,0) = g(x)',
      'ux(0,t) - alpha u(0,t) = 0',
      't > 0',
      'ux(pi,0) = 0',
    ]);
    expect(problem.family).toBe('heat');
    if (problem.family !== 'heat' || problem.domain.kind !== 'interval') throw new Error('expected an interval');
    expect(problem.initialExpr).toBe('g(x)');
    expect(problem.parameters.g).toBeUndefined();
    expect(problem.parameters.ux).toBeUndefined();
    expect(problem.parameters.alpha).toBeTruthy();
    expect(problem.domain.left.kind).toBe('robin');
    if (problem.domain.left.kind === 'robin') expect(problem.domain.left.hExpr.replace(/[()\s]/g, '')).toBe('-alpha');
    expect(problem.domain.right.kind).toBe('neumann');
    const solution = solveHeat(problem);
    expect(solution.showGraph).toBe(false);
    expect(solution.formulaLatex).toContain('g(x)');
  });

  it('reads a linear transport equation and an eikonal point problem', () => {
    const transport = parseProblem(['u_t + a u_x = 0', 'x in R', 'u(x, 0) = sin(x)', 'a = 1']);
    expect(transport.family).toBe('characteristics');
    if (transport.family !== 'characteristics') return;
    expect(transport.aExpr).toBe('a');
    expect(transport.bExpr).toBe('1');
    expect(transport.quasilinear).toBe(false);
    expect(transport.data.kind).toBe('cauchy');

    const cone = parseProblem(['u_x^2 + u_y^2 = 1', 'x in R', 'u(0, 0) = 0']);
    if (cone.family !== 'characteristics') throw new Error('expected characteristics');
    expect(cone.eikonal).toBe(true);
    expect(cone.data.kind).toBe('point');
  });
});
