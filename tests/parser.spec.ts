import { describe, expect, it } from 'vitest';
import { prepareMath } from '../src/input/expression';
import { compileSystemNumeric, parseSystem, tryParseSystem } from '../src/input/parser';

describe('parser', () => {
  it('accepts bare right-hand sides and detects a parameter', () => {
    const spec = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['mu * x - y', 'x + mu * y - (x^2 + y^2) * y'],
      revision: 3,
    });
    expect(spec.revision).toBe(3);
    expect(spec.isAutonomous).toBe(true);
    expect(spec.isLinear).toBe(false);
    expect(spec.parameters.mu).toBeDefined();
    expect(spec.rhsExpressions).toHaveLength(2);
    expect(spec.latexEquations[0]).toMatch(/\\dot\{x\}|\\dot x/);
    const compiled = compileSystemNumeric(spec);
    const value = compiled.f(0, [0, 0], { mu: 1 });
    expect(value[0]).toBeCloseTo(0, 10);
    expect(value[1]).toBeCloseTo(0, 10);
  });

  it('drops a parameter that the current equations no longer mention', () => {
    const glued = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['xy', '-y'],
    });
    expect(Object.keys(glued.parameters)).toEqual(['xy']);

    const product = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['x*y', '-y'],
      parameterOverrides: glued.parameters,
    });
    expect(product.parameters).toEqual({});

    const tuned = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['mu*x', '-y'],
      parameterOverrides: {
        mu: { value: 0.3, min: -1, max: 1, step: 0.05 },
        xy: { value: 4, min: -5, max: 5, step: 0.01 },
      },
    });
    expect(Object.keys(tuned.parameters)).toEqual(['mu']);
    expect(tuned.parameters.mu?.value).toBe(0.3);
    expect(tuned.parameters.mu?.min).toBe(-1);
  });

  it('treats a Lyapunov symbol as a parameter and drops it when the function is cleared', () => {
    const withPotential = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['-y', 'x'],
      userLyapunovExpr: 'a*(x^2 + y^2)/2',
    });
    expect(Object.keys(withPotential.parameters)).toEqual(['a']);

    const cleared = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['-y', 'x'],
      parameterOverrides: withPotential.parameters,
    });
    expect(cleared.parameters).toEqual({});
  });

  it('expands a second-order scalar equation using the requested state names', () => {
    const spec = parseSystem({
      mode: 'second_order_scalar',
      dimension: 2,
      stateVars: ['theta', 'omega'],
      rows: ["theta'' + gamma*theta' + sin(theta) = 0"],
      parameterOverrides: {
        gamma: { name: 'gamma', latex: '\\gamma', value: 0.25, min: 0, max: 2, step: 0.01 },
      },
    });
    expect(spec.dimension).toBe(2);
    expect(spec.stateVars).toEqual(['theta', 'omega']);
    expect(spec.isLinear).toBe(false);
    const compiled = compileSystemNumeric(spec);
    const f = compiled.f(0, [0, 1], compiled.parameterValues);
    expect(f[0]).toBeCloseTo(1, 8);
    expect(f[1]).toBeCloseTo(-0.25, 8);
  });

  it('recognizes a linear center and a non-autonomous forcing term', () => {
    const linear = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['-y', 'x'],
    });
    expect(linear.isLinear).toBe(true);
    expect(linear.isAutonomous).toBe(true);

    const forced = parseSystem({
      mode: 'autonomous',
      dimension: 1,
      stateVars: ['x'],
      rows: ['x - x^3 + 0.3*cos(t)'],
    });
    expect(forced.isAutonomous).toBe(false);
  });

  it('accepts ** as a power', () => {
    const spec = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['x**2', '-y + x**2'],
    });
    const compiled = compileSystemNumeric(spec);
    expect(compiled.f(0, [2, 1], {})[0]).toBeCloseTo(4, 8);
    expect(compiled.f(0, [2, 1], {})[1]).toBeCloseTo(3, 8);
  });

  it('strips a written left-hand side', () => {
    const spec = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ["x' = y", "y' = -x + x^2"],
    });
    const compiled = compileSystemNumeric(spec);
    expect(compiled.f(0, [1, 2], {})).toEqual([2, 0]);
  });

  it('returns a readable error for an empty equation instead of throwing from tryParse', async () => {
    const parser = await import('../src/input/parser');
    expect(typeof parser.tryParseSystem).toBe('function');
    const result = parser.tryParseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['y', ''],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

function scalar(row: string) {
  return parseSystem({ mode: 'autonomous', dimension: 1, stateVars: ['x'], rows: [row] });
}

function valueAt(row: string, x: number, parameters: Record<string, number> = {}) {
  const spec = scalar(row);
  return compileSystemNumeric(spec).f(0, [x], { ...compileSystemNumeric(spec).parameterValues, ...parameters })[0];
}

describe('calculator-style expressions', () => {
  it('treats inverse trig and spaced calls as functions, not parameters', () => {
    const spec = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['mu * arctan(x) - sin y', 'alpha + cos(y)'],
    });
    expect(Object.keys(spec.parameters).sort()).toEqual(['alpha', 'mu']);
    expect(spec.latexEquations.join(' ')).not.toMatch(/mathrm\{(sin|cos|arctan)\}/);
    const compiled = compileSystemNumeric(spec);
    const at = compiled.f(0, [1, 0], { mu: 2, alpha: 0 });
    expect(at[0]).toBeCloseTo(2 * Math.atan(1), 10);
    expect(at[1]).toBeCloseTo(1, 10);
  });

  it.each([
    ['arctan(x)', 1, Math.atan(1)],
    ['arctan x', 1, Math.atan(1)],
    ['arctanx', 1, Math.atan(1)],
    ['sin x', Math.PI / 2, 1],
    ['sinx', Math.PI / 2, 1],
    ['sin 2x', Math.PI / 4, 1],
    ['sin2x', Math.PI / 4, 1],
    ['ln(x)', Math.E, 1],
    ['ln x', Math.E, 1],
    ['log(100, 10)', 1, 2],
    ['log10(100)', 1, 2],
    ['lg(100)', 1, 2],
    ['log_2(8)', 1, 3],
    ['sqrt x', 9, 3],
    ['√x', 9, 3],
    ['|x|', -2, 2],
    ['|-3|', 0, 3],
    ['|x^2 - 1|', 0, 1],
    ['||x| - 3|', 2, 1],
    ['sin^2(x)', Math.PI / 2, 1],
    ['sin^2 x', Math.PI / 2, 1],
    ['sin^2x', Math.PI / 2, 1],
    ['cos^2(x) + sin^2(x)', 0.4, 1],
    ['sin^-1(1)', 0, Math.PI / 2],
    ['sin^{-1}(1)', 0, Math.PI / 2],
    ['asin(1)', 0, Math.PI / 2],
    ['sinh(1)', 0, Math.sinh(1)],
    ['sinhx', 1, Math.sinh(1)],
    ['tg(pi / 4)', 0, 1],
    ['sgn(x)', -4, -1],
    ['floor(x)', 2.9, 2],
    ['2sin(x)', Math.PI / 2, 2],
    ['2(x + 1)', 3, 8],
    ['(x + 1)(x - 1)', 3, 8],
    ['1/2x', 4, 1 / 8],
    ['1/2*x', 4, 2],
    ['2e-3', 0, 0.002],
    ['2*e - 3', 0, 2 * Math.E - 3],
    ['90°', 0, Math.PI / 2],
    ['sin(90°)', 0, 1],
    ['\\arctan(x)', 1, Math.atan(1)],
    ['\\sin x', Math.PI / 2, 1],
    ['\\frac{x}{2}', 4, 2],
    ['\\sqrt{x+1}', 8, 3],
    ['min(x, 2)', 5, 2],
    ['atan2(x, 1)', 1, Math.atan2(1, 1)],
    ['mod(x, 2)', 5, 1],
    ['x % 2', 5, 1],
  ])('evaluates %s', (row, x, expected) => {
    expect(valueAt(row, x)).toBeCloseTo(expected, 8);
    expect(scalar(row).parameters.sin).toBeUndefined();
    expect(scalar(row).parameters.arctan).toBeUndefined();
    expect(scalar(row).parameters.atan).toBeUndefined();
    expect(scalar(row).parameters.cos).toBeUndefined();
    expect(scalar(row).parameters.ln).toBeUndefined();
    expect(scalar(row).parameters.sqrt).toBeUndefined();
  });

  it('keeps multi-letter parameters and does not split unknown words', () => {
    const pendulum = parseSystem({
      mode: 'second_order_scalar',
      dimension: 2,
      stateVars: ['theta', 'omega'],
      rows: ["theta'' + gamma*theta' + sin theta = 0"],
    });
    expect(Object.keys(pendulum.parameters)).toEqual(['gamma']);
    const compiled = compileSystemNumeric(pendulum);
    expect(compiled.f(0, [Math.PI / 2, 1], { gamma: 0.5 })).toEqual([1, expect.closeTo(-0.5 - 1, 8)]);

    const custom = scalar('singular * x + eps');
    expect(Object.keys(custom.parameters).sort()).toEqual(['eps', 'singular']);
    expect(valueAt('mu * x', 3, { mu: 2 })).toBeCloseTo(6, 8);
  });

  it('applies a function to a neighboring product and keeps an unknown glued word', () => {
    const spaced = parseSystem({
      mode: 'autonomous',
      dimension: 2,
      stateVars: ['x', 'y'],
      rows: ['sin x y', 'sin x cos y'],
    });
    expect(spaced.parameters).toEqual({});
    const compiled = compileSystemNumeric(spaced);
    expect(compiled.f(0, [2, 2], {})[0]).toBeCloseTo(Math.sin(4), 8);
    expect(compiled.f(0, [Math.PI / 2, 0], {})[1]).toBeCloseTo(1, 8);

    const glued = scalar('sinxy');
    expect(glued.parameters.sinxy).toBeDefined();
    expect(compileSystemNumeric(glued).f(0, [2], {})[0]).toBeCloseTo(1, 8);
  });

  it('asks for an argument instead of inventing a slider', () => {
    const result = tryParseSystem({
      mode: 'autonomous',
      dimension: 1,
      stateVars: ['x'],
      rows: ['sin'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain('sin');
  });

  it('canonicalizes a lyapunov expression that omits parentheses', () => {
    const spec = scalar('x');
    const withV = parseSystem({
      mode: 'autonomous',
      dimension: 1,
      stateVars: ['x'],
      rows: ['-x'],
      userLyapunovExpr: '1 - cos x',
    });
    expect(withV.userLyapunovExpr).toBe('1 - cos(x)');
    expect(spec.parameters).toEqual({});
  });

  it('prepares implicit products without turning greek names into letters', () => {
    expect(prepareMath('sin 2theta')).toContain('sin');
    expect(prepareMath('sin 2theta')).toContain('theta');
    expect(prepareMath('mux')).toBe('mux');
    expect(prepareMath('arctan x + mu')).toContain('atan');
    expect(prepareMath('arctan x + mu')).toContain('mu');
  });
});
