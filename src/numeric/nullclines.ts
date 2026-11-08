import type { CompiledSystem, Nullcline, ViewportBounds } from '../core/types';
import { symbolToLatex } from '../input/parser';
import { algebraicZeroSet, traceImplicit } from './algebraicCurve';

export function computeNullclines(
  compiled: CompiledSystem,
  viewport: ViewportBounds,
  expressions?: string[],
): Nullcline[] {
  if (compiled.stateVars.length < 2) return [];
  const curves: Nullcline[] = [];
  const xName = compiled.stateVars[0] ?? 'x';
  const yName = compiled.stateVars[1] ?? 'y';
  for (const component of [0, 1]) {
    const expression = expressions?.[component];
    const algebraic = expression
      ? algebraicZeroSet(expression, [xName, yName], compiled.parameterValues, viewport)
      : null;
    const points =
      algebraic && algebraic.polylines.length > 0
        ? algebraic.polylines
        : traceImplicit((x, y) => componentOf(compiled, component, x, y), viewport, span(viewport) / 650);
    const symbol = symbolToLatex(compiled.stateVars[component] ?? 'x');
    curves.push({
      id: `nullcline-${component}`,
      component,
      variableLatex: symbol,
      points,
      formulaLatex: `\\dot{${symbol}} = 0`,
      expression,
      variables: [xName, yName],
    });
  }
  return curves;
}

function componentOf(compiled: CompiledSystem, component: number, x: number, y: number): number {
  try {
    const velocity = compiled.f(0, [x, y], compiled.parameterValues);
    const value = velocity[component] ?? 0;
    return Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function span(viewport: ViewportBounds): number {
  return Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin, 1e-3);
}

/** Redraw stored nullclines in the window the user is actually looking at. */
export function projectNullclines(
  curves: Nullcline[],
  viewport: ViewportBounds,
  parameters: Record<string, number>,
): Nullcline[] {
  return curves.map((curve) => {
    if (!curve.expression || !curve.variables) return curve;
    const algebraic = algebraicZeroSet(curve.expression, curve.variables, parameters, viewport);
    if (!algebraic || algebraic.polylines.length === 0) return curve;
    return { ...curve, points: algebraic.polylines };
  });
}
