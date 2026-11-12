import { describe, expect, it } from 'vitest';
import { PDE_EXAMPLES } from '../src/pde/examples/corpus';
import { parseProblem, preprocess } from '../src/pde/parse';
import { solveProblem } from '../src/pde/solve';
import type { PdeSolution } from '../src/pde/types';

describe('course problems', () => {
  it('reads an exam block with cases, greek letters, and a Robin condition', () => {
    const pasted = String.raw`\begin{cases} u_{xx} + \alpha u_{yy} + 4 u_{xy} = 0 \end{cases}`;
    const problem = parseProblem(preprocess(pasted) + '\nalpha = 1');
    expect(problem.family).toBe('classify');
    const robin = parseProblem(['u_t = u_xx', '0 < x < pi', 'u_x(0, t) - alpha u(0, t) = 0', 'u_x(pi, t) = 0', 'u(x, 0) = 1', 'alpha = 1']);
    expect(robin.family).toBe('heat');
    if (robin.family !== 'heat' || robin.domain.kind !== 'interval') throw new Error('expected an interval');
    expect(robin.domain.left.kind).toBe('robin');
    expect(robin.domain.left.hExpr?.replace(/\s+/g, '')).toMatch(/alpha/);
    expect(robin.domain.left.hExpr).toContain('-');
  });

  it('classifies the midterm equation and changes type with alpha', () => {
    const at = (alpha: number) => {
      const problem = parseProblem(['u_xx + alpha u_yy + 4 u_xy = 0', `alpha = ${alpha}`]);
      const solution = solveProblem(problem);
      if (solution.family !== 'classify') throw new Error('expected classification');
      return solution;
    };
    const hyperbolic = at(1);
    expect(hyperbolic.type).toBe('hyperbolic');
    expect(hyperbolic.generalLatex).toContain('f(');
    expect(hyperbolic.notes.map((note) => note.id)).toEqual(
      expect.arrayContaining(['discriminant', 'type', 'cancel', 'general']),
    );
    expect(at(4).type).toBe('parabolic');
    expect(at(5).type).toBe('elliptic');
    expect(at(5).canonicalLatex).toContain('u_{\\xi\\xi}');
  });

  it('matches the closed forms on the sheets', () => {
    const checks: Array<{ id: string; scope: Record<string, number>; expected: number }> = [
      { id: 'midterm-cauchy', scope: { x: 0.4, y: -1, t: -1 }, expected: 0.4 * Math.exp(-7) },
      { id: 'midterm-two-sines', scope: { x: 0.5, t: 0.1 }, expected: Math.exp(-4.8) * Math.sin(2) + 5 * Math.exp(-1.2) * Math.sin(1) },
      { id: 'hw1-9', scope: { x: 0.8, t: 0.4 }, expected: 1.6 },
      { id: 'hw2-2', scope: { x: 0.25, t: 0.05 }, expected: 5 * Math.exp(-4 * Math.PI * Math.PI * 0.05) * Math.sin(Math.PI * 0.25) },
      { id: 'hw2-7', scope: { x: 0.5, t: 0.2 }, expected: ((Math.exp(-0.2) - Math.exp(-Math.PI * Math.PI * 0.2)) / (Math.PI * Math.PI - 1)) * Math.sin(Math.PI * 0.5) },
      { id: 'hw2-9', scope: { x: 0.3, t: 0.7 }, expected: 0.6 },
    ];
    for (const check of checks) {
      const example = PDE_EXAMPLES.find((item) => item.id === check.id);
      if (!example) throw new Error(check.id);
      const solution = solveProblem(parseProblem(example.lines));
      const value = solution.frames[0]?.evaluate(check.scope.x ?? 0, check.scope.t ?? check.scope.y ?? 0, check.scope.y);
      expect(Math.abs((value ?? NaN) - check.expected), `${check.id} got ${value}`).toBeLessThan(2e-2);
    }
  }, 120000);

  it('solves every visible example within 8 seconds, without throwing', () => {
    const started = Date.now();
    for (const example of PDE_EXAMPLES) {
      if (example.parked) continue;
      const problem = parseProblem(example.lines);
      let solution: PdeSolution;
      const one = Date.now();
      expect(() => {
        solution = solveProblem(problem);
      }, example.id).not.toThrow();
      expect(Date.now() - one, example.id).toBeLessThan(8000);
      const frame = solution!.frames[0];
      expect(frame, example.id).toBeTruthy();
      const sample = frame!.evaluate(0.4, Math.min(frame!.tMax, Math.max(frame!.tMin + 0.05, 0.2)), frame!.yMin != null ? (frame!.yMin + (frame!.yMax ?? frame!.yMin)) / 2 : 0);
      expect(Number.isFinite(sample) || example.id.startsWith('hw1-'), `${example.id} sample ${sample}`).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(120_000);
  }, 120000);
});
