import { describe, expect, it } from 'vitest';
import { latexNumber, polynomialSign, toPolynomial } from '../src/numeric/algebra';
import { normalize } from '../src/numeric/linearAlgebra';
import { light, withManifolds } from './light';

describe('claims that have to be exact', () => {
  it('recognizes a negative definite quadratic form with a cross term', () => {
    const poly = toPolynomial('-x^2 + x*y - y^2', ['x', 'y']);
    expect(poly).not.toBeNull();
    expect(polynomialSign(poly!, 2)).toBe('negative');
  });

  it('keeps the Jordan Lyapunov function and does not invent one for the saddle', () => {
    expect(light('jordan-node').bundle.global.lyapunov?.classification).toBe('strict_lyapunov');
    const saddleKind = light('saddle-separatrix').bundle.global.lyapunov?.classification;
    expect(saddleKind === 'strict_lyapunov' || saddleKind === 'weak_lyapunov_lasalle').toBe(false);
  });

  it('writes the saddle separatrix as y = x^2/3', () => {
    const formulas = withManifolds('saddle-separatrix').manifolds.map((branch) => branch.taylorSeriesLatex).join(' ');
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
