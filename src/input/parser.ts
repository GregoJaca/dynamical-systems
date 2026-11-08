/**
 * Plain-text ODE parser and main-thread numeric compilation.
 * Accepts bare right-hand sides, first-order equations, and second-order scalar ODEs.
 */

import {
  compile,
  derivative,
  evaluate,
  parse,
  simplify,
  type EvalFunction,
  type MathNode,
} from 'mathjs';
import type { CompiledSystem, ParameterSpec, ParseSystemInput, SystemSpec } from '../core/types';
import { isBuiltInFunction, prepareMath, readDeclaredName } from './expression';

const CONSTANTS = new Set(['e', 'E', 'pi', 'PI', 'i', 'Infinity', 'NaN', 'true', 'false']);

const GREEK: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\epsilon',
  varepsilon: '\\varepsilon',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  iota: '\\iota',
  kappa: '\\kappa',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  sigma: '\\sigma',
  tau: '\\tau',
  phi: '\\phi',
  varphi: '\\varphi',
  chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
};

export type ParseResult = { ok: true; spec: SystemSpec } | { ok: false; error: string };

const DEFAULT_VARS = ['x', 'y', 'z', 'w', 'u', 'v'];

export function tryParseSystem(input: ParseSystemInput): ParseResult {
  try {
    return { ok: true, spec: parseSystem(input) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || 'Could not parse the system.' };
  }
}

export function equationLooksSecondOrder(raw: string): boolean {
  return /''|″|‴|ẍ|Ẍ|\\ddot|d\^2|d²|d\^\(2\)/.test(raw) || raw.includes('′′');
}

export function parseSystem(input: ParseSystemInput): SystemSpec {
  const independentVar = input.independentVar?.trim() || 't';
  const secondOrder = input.mode === 'second_order_scalar' || (input.rows.length === 1 && equationLooksSecondOrder(input.rows[0] ?? ''));
  if (secondOrder) return parseSecondOrder({ ...input, mode: 'second_order_scalar' }, independentVar);
  return parseFirstOrder(input, independentVar);
}

export function compileSystemNumeric(spec: SystemSpec): CompiledSystem {
  const parameterValues: Record<string, number> = {};
  for (const [name, specParam] of Object.entries(spec.parameters)) {
    parameterValues[name] = specParam.value;
  }
  const rhsCode = spec.rhsExpressions.map((expr) => compile(expr));
  const jacobianCode = spec.rhsExpressions.map((expr) =>
    spec.stateVars.map((variable) => {
      try {
        return derivative(parse(expr), variable).compile();
      } catch {
        return null;
      }
    }),
  );

  const buildScope = (t: number, x: number[], p: Record<string, number>) => {
    const scope: Record<string, number> = { ...parameterValues, ...p, [spec.independentVar]: t };
    spec.stateVars.forEach((name, index) => {
      scope[name] = x[index] ?? 0;
    });
    return scope;
  };

  const f = (t: number, x: number[], p: Record<string, number>): number[] => {
    const scope = buildScope(t, x, p);
    return rhsCode.map((code) => numericValue(code.evaluate(scope)));
  };

  const J = (t: number, x: number[], p: Record<string, number>): number[][] => {
    const scope = buildScope(t, x, p);
    return jacobianCode.map((row, rowIndex) =>
      row.map((code, columnIndex) => {
        if (!code) return resolvedPartial(f, t, x, p, rowIndex, columnIndex, Number.NaN);
        try {
          const value = numericValue(code.evaluate(scope));
          if (Number.isFinite(value) && Math.abs(value) >= 1e-4) return value;
          // A fractional power is often undefined at an equilibrium, or it
          // evaluates to a tiny number that shrinks when the difference step grows.
          return resolvedPartial(f, t, x, p, rowIndex, columnIndex, value);
        } catch {
          return resolvedPartial(f, t, x, p, rowIndex, columnIndex, Number.NaN);
        }
      }),
    );
  };

  return { f, J, parameterValues, stateVars: [...spec.stateVars] };
}

function parseFirstOrder(input: ParseSystemInput, independentVar: string): SystemSpec {
  const dimension = input.dimension;
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new Error('Dimension must be a positive integer.');
  }
  const stateVars = resolveStateVars(input.stateVars, dimension, independentVar);
  if (input.rows.length !== dimension) {
    throw new Error(`Expected ${dimension} equation${dimension === 1 ? '' : 's'}, received ${input.rows.length}.`);
  }
  const parsed = input.rows.map((row, index) => parseFirstOrderRow(row, stateVars[index] ?? `x${index + 1}`, index, stateVars));
  const rhsExpressions = stateVars.map((name, index) => {
    const named = parsed.find((row) => row.variable === name && row.explicit);
    return (named ?? parsed[index]).rhs;
  });
  return finishSpec(input, stateVars, rhsExpressions, independentVar);
}

function parseSecondOrder(input: ParseSystemInput, independentVar: string): SystemSpec {
  const rawPosition = input.stateVars?.[0]?.trim() ?? '';
  const rawVelocity = input.stateVars?.[1]?.trim() ?? '';
  const position = rawPosition ? readDeclaredName(rawPosition) : 'x';
  const velocity = rawVelocity ? readDeclaredName(rawVelocity) : position === 'v' ? 'w' : 'v';
  const stateVars = [position, velocity];
  assertStateNames(stateVars, independentVar);
  const row = input.rows[0];
  if (row === undefined || input.rows.length === 0) {
    throw new Error('Equation 1 is empty.');
  }
  if (!row.trim()) throw new Error('Equation 1 is empty.');
  const rhsExpressions = expandSecondOrder(row, position, velocity, stateVars);
  return finishSpec(input, stateVars, rhsExpressions, independentVar, 2);
}

function finishSpec(
  input: ParseSystemInput,
  stateVars: string[],
  rhsExpressions: string[],
  independentVar: string,
  dimension = input.dimension,
): SystemSpec {
  const userLyapunovExpr = canonicalizeOptional(input.userLyapunovExpr, 'Lyapunov function', stateVars);
  const symbols = new Set<string>();
  for (const expr of rhsExpressions) collectSymbols(parse(expr), symbols);
  if (userLyapunovExpr) collectSymbols(parse(userLyapunovExpr), symbols);
  const reserved = new Set<string>([...stateVars, independentVar, ...CONSTANTS]);
  const parameters: Record<string, ParameterSpec> = {};
  for (const name of symbols) {
    if (reserved.has(name)) continue;
    parameters[name] = {
      name,
      latex: symbolToLatex(name),
      value: 1,
      min: -5,
      max: 5,
      step: 0.01,
    };
  }
  // Overrides only restore a slider the user already tuned. A name that the
  // current equations and Lyapunov function no longer mention is gone.
  if (input.parameterOverrides) {
    for (const [name, patch] of Object.entries(input.parameterOverrides)) {
      const current = parameters[name];
      if (!current) continue;
      parameters[name] = {
        ...current,
        ...patch,
        name: patch.name ?? current.name,
        latex: patch.latex ?? current.latex,
      };
    }
  }
  const parameterNames = Object.keys(parameters);
  const isAutonomous = !rhsExpressions.some((expr) => expressionDependsOn(expr, independentVar));
  const isLinear = rhsExpressions.every((expr) => secondDerivativesVanish(expr, stateVars));
  const latexEquations = stateVars.map(
    (name, index) => `\\dot{${symbolToLatex(name)}} = ${expressionToLatex(rhsExpressions[index] ?? '0', [...stateVars, ...parameterNames])}`,
  );
  return {
    id: input.id ?? hashId(rhsExpressions.join(';')),
    revision: input.revision ?? 0,
    mode: input.mode,
    dimension,
    stateVars,
    independentVar,
    rawEquations: [...input.rows],
    rhsExpressions,
    latexEquations,
    parameters,
    isAutonomous,
    isLinear,
    userLyapunovExpr,
  };
}

function parseFirstOrderRow(raw: string, fallbackVar: string, index: number, known: readonly string[]): { variable: string; rhs: string; explicit: boolean } {
  const label = `Equation ${index + 1}`;
  if (!raw || !raw.trim()) throw new Error(`${label} is empty.`);
  const normalized = normalizeMath(raw, known);
  if (!normalized) throw new Error(`${label} is empty.`);
  const eq = indexOfTopLevelEquals(normalized);
  if (eq < 0) {
    if (normalized.includes("'")) {
      throw new Error(`${label} has a derivative but no right-hand side. Use x' = ... or a bare expression.`);
    }
    return { variable: fallbackVar, rhs: canonicalize(normalized), explicit: false };
  }
  const lhs = normalized.slice(0, eq).replace(/\s+/g, '');
  const rhs = normalized.slice(eq + 1).trim();
  if (!rhs) throw new Error(`${label} is missing a right-hand side.`);
  const match = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*)(''|')?$/);
  if (!match) {
    throw new Error(`${label} has an unreadable left-hand side "${lhs}".`);
  }
  if (match[2] === "''") {
    throw new Error(`${label} is second order. Switch the system mode to a second-order scalar ODE.`);
  }
  return { variable: match[1] ?? fallbackVar, rhs: canonicalize(rhs), explicit: true };
}

function expandSecondOrder(raw: string, position: string, velocity: string, known: readonly string[]): [string, string] {
  let text = normalizeMath(raw, known);
  const second = '__second';
  const first = '__first';
  text = text.replace(new RegExp(`\\b${escapeRegExp(position)}''`, 'g'), second);
  text = text.replace(new RegExp(`\\b${escapeRegExp(position)}'`, 'g'), first);
  const eq = indexOfTopLevelEquals(text);
  const zero = eq < 0 ? text : `(${text.slice(0, eq).trim()}) - (${text.slice(eq + 1).trim() || '0'})`;
  const withVelocity = zero.replace(new RegExp(first, 'g'), `(${velocity})`);
  let coeff: string;
  try {
    coeff = simplify(derivative(parse(withVelocity), second)).toString();
  } catch {
    throw new Error(`Could not isolate ${position}'' in "${raw}".`);
  }
  if (!expressionDependsOn(withVelocity, second)) {
    throw new Error(`Could not find ${position}'' in the second-order equation.`);
  }
  const rest = simplify(parse(`(${withVelocity}) - (${coeff}) * (${second})`)).toString();
  let solved: string;
  try {
    solved = simplify(parse(`-(${rest}) / (${coeff})`)).toString();
  } catch {
    throw new Error(`Could not solve for ${position}''.`);
  }
  if (expressionDependsOn(solved, second)) {
    throw new Error(`The second derivative ${position}'' appears nonlinearly and could not be isolated.`);
  }
  return [velocity, canonicalize(solved)];
}

function normalizeMath(raw: string, known: readonly string[]): string {
  return prepareMath(raw, known);
}

function canonicalizeOptional(raw: string | undefined, label: string, known: readonly string[]): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return canonicalize(prepareMath(trimmed, known));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

function canonicalize(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error('An equation is empty.');
  try {
    parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse "${trimmed}": ${message}`);
  }
  try {
    return simplify(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function secondDerivativesVanish(expr: string, stateVars: string[]): boolean {
  for (const first of stateVars) {
    let once: MathNode;
    try {
      once = derivative(parse(expr), first);
    } catch {
      return false;
    }
    for (const second of stateVars) {
      try {
        const twice = simplify(derivative(once, second)).toString();
        if (twice !== '0' && twice !== '0.0') return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

function expressionDependsOn(expr: string, name: string): boolean {
  let found = false;
  parse(expr).traverse((node) => {
    const symbol = node as MathNode & { name?: string };
    if (node.type === 'SymbolNode' && symbol.name === name) found = true;
  });
  return found;
}

function collectSymbols(node: MathNode, into: Set<string>): void {
  node.traverse((child, _path, parent) => {
    if (child.type !== 'SymbolNode') return;
    const symbol = child as MathNode & { name: string };
    const owner = parent as (MathNode & { fn?: MathNode }) | undefined;
    if (parent?.type === 'FunctionNode' && owner?.fn === child) return;
    if (isBuiltInFunction(symbol.name)) {
      throw new Error(`"${symbol.name}" is a function and needs an argument, for example ${symbol.name}(x).`);
    }
    into.add(symbol.name);
  });
}

function expressionToLatex(expr: string, symbols: string[]): string {
  return paintSymbolLatex(parse(expr).toTex(), symbols);
}

export function paintSymbolLatex(tex: string, symbols: string[]): string {
  let output = tex;
  const greekNames = Object.keys(GREEK).sort((a, b) => b.length - a.length);
  for (const name of greekNames) {
    const command = GREEK[name] ?? name;
    output = output.replaceAll(`\\mathrm{${name}}`, command);
    output = output.replaceAll(`\\operatorname{${name}}`, command);
    output = output.replaceAll(`\\text{${name}}`, command);
    output = output.replace(new RegExp(`(?<![A-Za-z\\\\])\\{${name}\\}(?![A-Za-z])`, 'g'), command);
    output = output.replace(new RegExp(`(?<![A-Za-z\\\\])${name}(?![A-Za-z])`, 'g'), command);
  }
  const ordered = [...new Set(symbols)].sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    if (GREEK[name]) continue;
    const latex = symbolToLatex(name);
    if (latex === name) continue;
    output = output.replaceAll(`\\mathrm{${name}}`, latex);
    output = output.replaceAll(`\\operatorname{${name}}`, latex);
    output = output.replace(new RegExp(`(?<![A-Za-z\\\\{])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'g'), latex);
  }
  return output;
}

export function symbolToLatex(name: string): string {
  if (GREEK[name]) return GREEK[name];
  const greekIndexed = name.match(/^([a-z]+)(\d+)$/);
  if (greekIndexed && GREEK[greekIndexed[1]!]) return `${GREEK[greekIndexed[1]!]}_{${greekIndexed[2]}}`;
  const indexed = name.match(/^([A-Za-z])(\d+)$/);
  if (indexed) return `${GREEK[indexed[1]!] ?? indexed[1]}_{${indexed[2]}}`;
  return /^[A-Za-z]$/.test(name) ? name : `\\mathrm{${name}}`;
}

function resolveStateVars(requested: string[] | undefined, dimension: number, independentVar: string): string[] {
  const vars: string[] = [];
  for (const name of requested ?? []) {
    if (!name.trim()) continue;
    vars.push(readDeclaredName(name));
  }
  while (vars.length < dimension) {
    const fallback = DEFAULT_VARS[vars.length] ?? `x${vars.length + 1}`;
    vars.push(vars.includes(fallback) ? `x${vars.length + 1}` : fallback);
  }
  const chosen = vars.slice(0, dimension);
  assertStateNames(chosen, independentVar);
  return chosen;
}

function assertStateNames(names: string[], independentVar: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`"${name}" names more than one variable. x_1 and x₁ are the same name.`);
    seen.add(name);
    if (isBuiltInFunction(name)) throw new Error(`"${name}" is a function. Use it in an equation, for example ${name}(x).`);
    if (CONSTANTS.has(name) || name === independentVar) {
      throw new Error(`"${name}" is reserved. ${independentVar} is time, and pi and e are constants.`);
    }
  }
}

function indexOfTopLevelEquals(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === '=' && depth === 0 && text[i + 1] !== '=' && text[i - 1] !== '<' && text[i - 1] !== '>' && text[i - 1] !== '!' && text[i - 1] !== '=') {
      return i;
    }
  }
  return -1;
}

function numericValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 're' in value && typeof (value as { re: number }).re === 'number' && !('im' in value && (value as { im: number }).im)) {
    return (value as { re: number }).re;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function resolvedPartial(
  f: (t: number, x: number[], p: Record<string, number>) => number[],
  t: number,
  x: number[],
  p: Record<string, number>,
  row: number,
  column: number,
  symbolic: number,
): number {
  const fine = numericPartial(f, t, x, p, row, column, 1e-6);
  const coarse = numericPartial(f, t, x, p, row, column, 1e-3);
  if (Math.abs(fine) < 1e-3 && Math.abs(coarse) < 0.25 && Math.abs(coarse) > 20 * Math.max(Math.abs(fine), 1e-8)) return 0;
  if (Number.isFinite(symbolic)) return symbolic;
  return fine;
}

function numericPartial(
  f: (t: number, x: number[], p: Record<string, number>) => number[],
  t: number,
  x: number[],
  p: Record<string, number>,
  row: number,
  column: number,
  stepScale = 1e-7,
): number {
  const step = stepScale * (1 + Math.abs(x[column] ?? 0));
  const plus = x.slice();
  const minus = x.slice();
  plus[column] = (plus[column] ?? 0) + step;
  minus[column] = (minus[column] ?? 0) - step;
  return ((f(t, plus, p)[row] ?? 0) - (f(t, minus, p)[row] ?? 0)) / (2 * step);
}

function hashId(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sys-${(hash >>> 0).toString(16)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Used by numeric global analysis to keep parameter substitution consistent with the parser. */
export function evaluateExpression(expr: string, scope: Record<string, number>): number {
  return numericValue(evaluate(expr, scope));
}

export type { EvalFunction };
