import { compile } from 'mathjs';

function asReal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 're' in value) {
    const real = (value as { re: unknown; im?: unknown }).re;
    const imag = (value as { im?: unknown }).im;
    if (typeof real === 'number' && (imag == null || imag === 0)) return real;
  }
  return Number.NaN;
}

function scopeWithParameters(
  parameters: Record<string, number>,
  independentVar: string,
): Record<string, number> {
  return { ...parameters, [independentVar]: 0, t: 0, pi: Math.PI, e: Math.E };
}

export function compileScalarField(
  expression: string | undefined,
  stateVars: string[],
  parameters: Record<string, number>,
  independentVar = 't',
): ((x: number, y: number) => number) | null {
  if (!expression || !expression.trim()) return null;
  try {
    const evaluated = compile(expression);
    const xName = stateVars[0] ?? 'x';
    const yName = stateVars[1] ?? 'y';
    return (x: number, y: number) => {
      try {
        const scope = scopeWithParameters(parameters, independentVar);
        scope[xName] = x;
        scope[yName] = y;
        scope.x = x;
        scope.y = y;
        return asReal(evaluated.evaluate(scope));
      } catch {
        return Number.NaN;
      }
    };
  } catch {
    return null;
  }
}

export function compilePolarField(
  rExpression: string | undefined,
  thetaExpression: string | undefined,
  parameters: Record<string, number>,
): ((r: number, theta: number) => [number, number]) | null {
  if (!rExpression || !thetaExpression) return null;
  try {
    const rDot = compile(rExpression);
    const thetaDot = compile(thetaExpression);
    return (r: number, theta: number) => {
      try {
        const scope = { ...parameters, r, theta, pi: Math.PI, e: Math.E, t: 0 };
        return [asReal(rDot.evaluate(scope)), asReal(thetaDot.evaluate(scope))] as [number, number];
      } catch {
        return [Number.NaN, Number.NaN];
      }
    };
  } catch {
    return null;
  }
}
