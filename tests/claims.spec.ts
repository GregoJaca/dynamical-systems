import { describe, expect, it } from 'vitest';
import { exampleToSpec, PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { latexNumber, polynomialSign, toPolynomial } from '../src/numeric/algebra';
import { analyzeNumeric } from '../src/numeric/analyze';
import { normalize } from '../src/numeric/linearAlgebra';

describe('claims that have to be exact', () => {
  it('recognizes a negative definite quadratic form with a cross term', () => {
    const poly = toPolynomial('-x^2 + x*y - y^2', ['x', 'y']);
    expect(poly).not.toBeNull();
    expect(polynomialSign(poly!, 2)).toBe('negative');
  });

  it('keeps the Jordan Lyapunov function and does not invent one for the saddle', () => {
    const jordan = PERKO_EXAMPLES.find((example) => example.id === 'jordan-node');
    const saddle = PERKO_EXAMPLES.find((example) => example.id === 'saddle-separatrix');
    if (!jordan || !saddle) throw new Error('missing example');
    expect(analyzeNumeric(exampleToSpec(jordan)).global.lyapunov?.classification).toBe('strict_lyapunov');
    const saddleKind = analyzeNumeric(exampleToSpec(saddle)).global.lyapunov?.classification;
    expect(saddleKind === 'strict_lyapunov' || saddleKind === 'weak_lyapunov_lasalle').toBe(false);
  }, 60_000);

  it('writes the saddle separatrix as y = x^2/3', () => {
    const example = PERKO_EXAMPLES.find((item) => item.id === 'saddle-separatrix');
    if (!example) throw new Error('missing example');
    const formulas = analyzeNumeric(exampleToSpec(example)).manifolds.map((branch) => branch.taylorSeriesLatex).join(' ');
    expect(formulas).toContain('\\frac{1}{3}');
    expect(formulas).toContain('x^{2}');
    expect(formulas).not.toContain('v =');
    expect(formulas).not.toMatch(/\d+\.\d{3,}/);
  }, 60_000);

  it('prints square roots and scales an eigenvector to small integers', () => {
    expect(latexNumber(Math.sqrt(2) / 2)).toBe('\\frac{\\sqrt{2}}{2}');
    expect(normalize([Math.SQRT1_2, Math.SQRT1_2])).toEqual([1, 1]);
  });
});
