import { describe, expect, it } from 'vitest';
import { compileSystemNumeric, parseSystem } from '../src/input/parser';

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
