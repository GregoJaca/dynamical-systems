import { describe, expect, it } from 'vitest';
import { algebraicMath, latexNumber } from '../src/numeric/algebra';
import { cyclesFromPolar } from '../src/numeric/globalAnalysis';
import { complexLatex } from '../src/ui/format';
import { reduceTrigPolynomial } from '../src/numeric/trigReduce';
import { decompose } from '../src/numeric/linearAlgebra';
import type { EquilibriumAnalysis, PolarAnalysis } from '../src/core/types';
import { light } from './light';

describe('exact printed forms', () => {
  it('prints quadratic irrationals, square roots, and multiples of π', () => {
    expect(latexNumber((1 + Math.sqrt(5)) / 2)).toBe('\\frac{1 + \\sqrt{5}}{2}');
    expect(latexNumber((Math.sqrt(5) - 1) / 2)).toBe('\\frac{\\sqrt{5} - 1}{2}');
    expect(latexNumber((1 - Math.sqrt(5)) / 2)).toBe('\\frac{1 - \\sqrt{5}}{2}');
    expect(latexNumber(1 + Math.sqrt(2))).toBe('1 + \\sqrt{2}');
    expect(latexNumber(-(1 + Math.sqrt(2)))).toBe('-(1 + \\sqrt{2})');
    expect(latexNumber(Math.sqrt(72))).toBe('6\\sqrt{2}');
    expect(latexNumber(Math.sqrt(2) / 2)).toBe('\\frac{\\sqrt{2}}{2}');
    expect(latexNumber(Math.PI)).toBe('\\pi');
    expect(latexNumber(-Math.PI)).toBe('-\\pi');
    expect(latexNumber(2 * Math.PI)).toBe('2\\pi');
    expect(latexNumber(Math.PI / 2)).toBe('\\frac{\\pi}{2}');
    expect(latexNumber(-3 * Math.PI / 2)).toBe('-\\frac{3\\pi}{2}');
    expect(algebraicMath((1 + Math.sqrt(5)) / 2)).toBe('((1 + sqrt(5)) / 2)');
    expect(algebraicMath(Math.PI)).toBe('pi');
    expect(algebraicMath(-1)).toBeNull();
    expect(latexNumber((-1 + Math.sqrt(65)) / 8)).toBe('\\frac{\\sqrt{65} - 1}{8}');
    expect(latexNumber((-11 + Math.sqrt(1201)) / 2)).toBe('\\frac{\\sqrt{1201} - 11}{2}');
    expect(latexNumber(-16 / 15)).toBe('-\\frac{16}{15}');
    expect(latexNumber(Math.sqrt(209) / 15)).toBe('\\frac{\\sqrt{209}}{15}');
    expect(latexNumber(1 / Math.sqrt(30))).toBe('\\frac{\\sqrt{30}}{30}');
  });

  it('cancels sin² + cos² in a polar polynomial', () => {
    expect(reduceTrigPolynomial('((r * cos(theta))^2 + (r * sin(theta))^2) / r')).toBe('r');
    const radial = reduceTrigPolynomial(
      '(((r * cos(theta)) * (-(r * sin(theta)) - (r * cos(theta)) * ((r * cos(theta))^2 + (r * sin(theta))^2)) + (r * sin(theta)) * ((r * cos(theta)) - (r * sin(theta)) * ((r * cos(theta))^2 + (r * sin(theta))^2))) / r)',
    );
    expect(radial?.replace(/\s/g, '')).toBe('-r^3');
  });

  it('leaves a generic decimal as a decimal', () => {
    const printed = latexNumber(1.234567890123);
    expect(printed).not.toContain('\\sqrt');
    expect(printed).not.toContain('\\pi');
    expect(printed).toMatch(/^1\.2345/);
    expect(latexNumber(Math.E)).toMatch(/^2\.7182/);
  });

  it('prints the golden eigenvector without a decimal expansion', () => {
    const spectrum = decompose([
      [1, 1],
      [1, 0],
    ]);
    const printed = spectrum.eigenvectors.map((vector) => vector.map((entry) => latexNumber(entry)).join(' ')).join(' | ');
    expect(printed).toContain('\\sqrt{5}');
    expect(printed).not.toMatch(/\d\.\d{3,}/);
    const roots = spectrum.eigenvalues.map((lambda) => latexNumber(lambda.re));
    expect(roots).toContain('\\frac{1 + \\sqrt{5}}{2}');
    expect(roots).toContain('\\frac{1 - \\sqrt{5}}{2}');
  });

  it('prints exercise spectra and polar equations without leftover decimals or trig', () => {
    const focus = study('weak-focus');
    expect(focus.polar?.rDotLatex).not.toMatch(/sin|cos/i);
    expect(focus.polar?.thetaDotLatex).not.toMatch(/sin|cos/i);
    const hopf = study('hopf');
    expect(hopf.polar?.rDotLatex).toContain('\\mu');
    expect(hopf.polar?.rDotLatex).not.toMatch(/sin|cos/i);
    const damped = study('damped-pendulum');
    const saddle = damped.equilibria.find((eq) => Math.abs(Math.abs(eq.coords[0] ?? 0) - Math.PI) < 1e-6);
    expect(saddle?.eigenvalues.map((lambda) => lambda.exactLatex).join(' ')).toContain('\\sqrt{65}');
    const species = study('competing-species');
    const source = species.equilibria.find((eq) => eq.coords.every((value) => Math.abs(value) < 1e-8));
    expect(source?.eigenvalues.map((lambda) => lambda.exactLatex).sort()).toEqual(['2', '3']);
    const exam6 = study('exam-6');
    const offOrigin = exam6.equilibria.find((eq) => Math.abs(eq.coords[0] ?? 0) > 0.2);
    expect(offOrigin?.coordsExactLatex?.join(' ')).not.toContain('\\sqrt');
    const exam16 = study('exam-16');
    expect(exam16.equilibria).toHaveLength(1);
    expect(exam16.equilibria[0]?.stability).toBe('asymptotically_stable');
    const exam25 = study('exam-25');
    expect(exam25.equilibria[0]?.eigenvalues.every((lambda) => Math.abs(lambda.im) < 1e-8)).toBe(true);
    expect(exam25.polar?.rDotLatex).toBe('\\dot r = - r');
    expect(exam25.polar?.thetaDotLatex).toBe('\\dot\\theta = { r}^{\\left(\\frac{2}{3}\\right)}');
    const exam17 = study('exam-17');
    const axial = exam17.equilibria.find((eq) => Math.abs(eq.coords[0] ?? 1) < 1e-8 && Math.abs(Math.abs(eq.coords[1] ?? 0) - 1) < 1e-6);
    expect(axial?.eigenvalues.some((lambda) => Math.abs(lambda.re) < 1e-7 && Math.abs(lambda.im) < 1e-7)).toBe(true);
    expect(axial?.classification2D).toBe('saddle_node');
    const far = exam17.equilibria.find((eq) => Math.abs(Math.abs(eq.coords[0] ?? 0) - 2) < 1e-6 && Math.abs(eq.coords[1] ?? 0) < 1e-6);
    expect(far?.eigenvalues.map((lambda) => lambda.exactLatex).sort()).toEqual(['-2\\sqrt{30}', '2\\sqrt{30}']);
    const shifted = equilibriaOf('exam-20').find((eq) => Math.abs(eq.coords[2] ?? 0) < 1e-6);
    expect(shifted?.stability).toBe('unstable');
  });

  it('prints the pendulum and Lorenz equilibria in closed form', () => {
    const pendulum = equilibriaOf('undamped-pendulum').map((eq) => eq.coordsExactLatex?.join(', '));
    expect(pendulum).toEqual(expect.arrayContaining(['-\\pi, 0', '0, 0', '\\pi, 0']));
    const lorenz = equilibriaOf('lorenz');
    expect(lorenz.map((eq) => eq.coordsExactLatex?.join(', '))).toEqual(expect.arrayContaining(['0, 0, 0', '6\\sqrt{2}, 6\\sqrt{2}, 27', '-6\\sqrt{2}, -6\\sqrt{2}, 27']));
    const origin = lorenz.find((eq) => eq.coords.every((value) => Math.abs(value) < 1e-8));
    const spectrum = origin?.eigenvalues.map((lambda) => complexLatex(lambda)).join(' ');
    expect(spectrum).toContain('\\frac{\\sqrt{1201} - 11}{2}');
    expect(spectrum).toContain('-\\frac{11 + \\sqrt{1201}}{2}');
    expect(spectrum).toContain('-\\frac{8}{3}');
  });

  it('rejects a limit cycle read off one angle of a theta-dependent field', () => {
    expect(cyclesFromPolar(study('exam-10').polar!)).toHaveLength(0);
    expect(cyclesFromPolar(study('exam-19').polar!)).toHaveLength(0);
    const hopfCycles = cyclesFromPolar(study('hopf').polar!);
    const unit = hopfCycles.find((cycle) => Math.abs((cycle.radius ?? 0) - 1) < 1e-3);
    expect(unit).toBeTruthy();
    for (const point of unit?.points ?? []) {
      expect(Math.abs((point[0] ?? 0) ** 2 + (point[1] ?? 0) ** 2 - 1)).toBeLessThan(1e-9);
    }
    const samples = unit?.points ?? [];
    for (let index = 1; index < samples.length; index += 1) {
      const left = samples[index - 1] ?? [];
      const right = samples[index] ?? [];
      const chord = Math.hypot((right[0] ?? 0) - (left[0] ?? 0), (right[1] ?? 0) - (left[1] ?? 0));
      const gap = 1 - Math.sqrt(Math.max(0, 1 - (chord / 2) ** 2));
      expect(gap).toBeLessThan(6e-4);
    }
  });
});

function study(id: string): { polar?: PolarAnalysis; equilibria: EquilibriumAnalysis[] } {
  const loaded = light(id);
  return { polar: loaded.bundle.polar, equilibria: loaded.equilibria };
}

function equilibriaOf(id: string): EquilibriumAnalysis[] {
  return light(id).equilibria;
}
