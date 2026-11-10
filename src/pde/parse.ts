/**
 * Plain-text PDE problems. Derivative notation is recognised here; the scalar
 * pieces are handed to the shared expression rewriter and to mathjs.
 */

import { derivative, parse, simplify, type MathNode } from 'mathjs';
import type { ParameterSpec } from '../core/types';
import { symbolToLatex } from '../input/parser';
import { isBuiltInFunction } from '../input/expression';
import { evalMath, mentions, toMath } from './expr';
import type { CharProblem, EndCondition, HeatProblem, PdeProblem } from './types';

const FIELD = ['UXX', 'UYY', 'UXY', 'UTT', 'UX', 'UY', 'UT', 'U'];
const RESERVED = new Set(['x', 'y', 't', 'u', 'r', 'pi', 'e', 'E', 'i', ...FIELD]);

interface LineBag {
  equation?: string;
  domain?: string;
  periodic: boolean;
  conditions: string[];
  assignments: Array<{ name: string; value: number }>;
}

export function parseProblem(input: string[] | string, overrides?: Record<string, Partial<ParameterSpec>>): PdeProblem {
  const lines = (Array.isArray(input) ? input : input.split(/\r?\n/)).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const bag = classifyLines(lines);
  if (!bag.equation) throw new Error('Write the PDE on its own line, for example u_t = k u_xx.');
  if (!bag.domain) throw new Error('Write the domain on its own line, for example 0 < x < pi, or x in R.');

  const shielded = shieldDerivatives(bag.equation);
  const prepared = toMath(shielded, FIELD);
  const eq = indexOfEquals(prepared);
  if (eq < 0) throw new Error('The PDE needs two sides, separated by =.');
  const zero = safeSimplify(`(${prepared.slice(0, eq)}) - (${prepared.slice(eq + 1)})`);
  const coefficients = {
    ut: diff(zero, 'UT'),
    ux: diff(zero, 'UX'),
    uy: diff(zero, 'UY'),
    uxx: diff(zero, 'UXX'),
    uyy: diff(zero, 'UYY'),
    u: diff(zero, 'U'),
  };
  const remainder = substitute(zero, { UT: '0', UX: '0', UY: '0', UXX: '0', UYY: '0', U: '0' });
  const second = !isZero(coefficients.uxx) || !isZero(coefficients.uyy);
  const eikonal = !second && isZero(coefficients.ut) && mentions(coefficients.ux, 'UX') && mentions(coefficients.uy, 'UY');
  const heat = second;
  const domain = readDomain(bag.domain);

  const parameters = collectParameters(bag, zero, domain.expressions, bag.conditions, overrides);

  if (heat) {
    return finishHeat(bag, lines, coefficients, remainder, domain, parameters, bag.equation);
  }
  if (eikonal || !isZero(coefficients.ux) || !isZero(coefficients.uy) || !isZero(coefficients.ut) || !isZero(coefficients.u)) {
    return finishChar(bag, lines, coefficients, remainder, domain, parameters, bag.equation, eikonal);
  }
  throw new Error('The equation has no derivative of u. Write u_t, u_x, or u_xx.');
}

function finishHeat(
  bag: LineBag,
  lines: string[],
  coefficients: Record<string, string>,
  remainder: string,
  domain: DomainRead,
  parameters: Record<string, ParameterSpec>,
  original: string,
): HeatProblem {
  const ut = coefficients.ut ?? '0';
  if (isZero(ut)) throw new Error('A heat equation needs u_t.');
  const scale = (coeff: string) => safeSimplify(`-(${coeff}) / (${ut})`);
  const kExpr = scale(coefficients.uxx ?? '0');
  const bExpr = scale(coefficients.ux ?? '0');
  const cExpr = scale(coefficients.u ?? '0');
  const sourceExpr = scale(remainder);
  const convectionDependsOnU = mentions(coefficients.ux ?? '', 'U');
  const burgers = convectionDependsOnU && !mentions(kExpr, 'U') && isZero(coefficients.uyy ?? '0') && !isZero(kExpr);
  const nonlinear = mentions(kExpr, 'U') || convectionDependsOnU;
  const kDependsOnX = mentions(kExpr, 'x') || mentions(kExpr, 'y');
  const conditions = bag.conditions.map(readCondition);
  const initial = conditions.find((item) => item.role === 'initial');
  if (!initial) throw new Error('Write the initial value, for example u(x, 0) = sin(x).');

  let spatial: HeatProblem['spatial'] = domain.kind === 'disk' ? 'radial' : domain.kind === 'rectangle' ? 'xy' : 'x';
  if (!isZero(coefficients.uyy ?? '0') && domain.kind !== 'disk') spatial = 'xy';

  const problem: HeatProblem = {
    family: 'heat',
    kExpr,
    bExpr: burgers ? '0' : bExpr,
    cExpr: burgers ? '0' : cExpr,
    sourceExpr: isZero(sourceExpr) ? '0' : sourceExpr,
    spatial,
    domain: heatDomain(domain, conditions, bag.periodic),
    initialExpr: initial.expr,
    burgers,
    numericOnly: (kDependsOnX || nonlinear) && !burgers,
    parameters,
    lines,
    equationLatex: equationLatex(original),
  };
  return problem;
}

function finishChar(
  bag: LineBag,
  lines: string[],
  coefficients: Record<string, string>,
  remainder: string,
  domain: DomainRead,
  parameters: Record<string, ParameterSpec>,
  original: string,
  eikonal: boolean,
): CharProblem {
  const usesY = !isZero(coefficients.uy ?? '0') || domain.kind === 'rectangle';
  const vars: CharProblem['vars'] = usesY && isZero(coefficients.ut ?? '0') ? 'xy' : 'xt';
  const bExpr = vars === 'xy' ? (coefficients.uy ?? '0') : (coefficients.ut ?? '0');
  const aExpr = coefficients.ux ?? '0';
  const cExpr = coefficients.u ?? '0';
  const dExpr = safeSimplify(`-(${remainder})`);
  const quasilinear = mentions(aExpr, 'U') || mentions(bExpr, 'U') || mentions(cExpr, 'U');
  const conditions = bag.conditions.map(readCondition);
  const data = readCharData(conditions, domain);

  return {
    family: 'characteristics',
    vars,
    aExpr,
    bExpr,
    cExpr,
    dExpr,
    quasilinear,
    fluxExpr: fluxOf(aExpr, bExpr, cExpr, dExpr, quasilinear),
    eikonal,
    data,
    parameters,
    lines,
    equationLatex: equationLatex(original),
  };
}

function fluxOf(aExpr: string, bExpr: string, cExpr: string, dExpr: string, quasilinear: boolean): string | undefined {
  if (!quasilinear || !isZero(cExpr) || !isZero(dExpr)) return undefined;
  if (!isConstant(bExpr) || mentions(aExpr, 'x') || mentions(aExpr, 't') || mentions(aExpr, 'y')) return undefined;
  const speed = safeSimplify(`(${aExpr}) / (${bExpr})`);
  const antiderivative = polynomialAntiderivative(speed);
  return antiderivative ?? undefined;
}

/** Integral of a polynomial in U. Returns an expression in u, or null. */
function polynomialAntiderivative(exprInU: string): string | null {
  const expr = exprInU.replaceAll('U', 'u');
  try {
    const node = parse(expr);
    if (node.type === 'SymbolNode' && (node as MathNode & { name: string }).name === 'u') return '(u^2)/2';
    if (node.type === 'OperatorNode' && (node as MathNode & { op: string }).op === '^') {
      const args = (node as MathNode & { args: MathNode[] }).args;
      const base = args[0];
      const power = args[1];
      if (base?.type === 'SymbolNode' && power?.type === 'ConstantNode') {
        const n = Number((power as MathNode & { value: number }).value);
        if (Number.isFinite(n)) return `(u^${n + 1})/${n + 1}`;
      }
    }
    const value = simplify(expr).toString();
    if (value === 'u') return '(u^2)/2';
  } catch {
    return null;
  }
  return null;
}

function heatDomain(domain: DomainRead, conditions: Condition[], periodic: boolean): HeatProblem['domain'] {
  if (domain.kind === 'line') return { kind: 'line' };
  if (domain.kind === 'disk') return { kind: 'disk', radiusExpr: domain.radius, bc: domain.bc };
  if (domain.kind === 'rectangle') return { kind: 'rectangle', x0: domain.x0, x1: domain.x1, y0: domain.y0, y1: domain.y1, bc: domain.bc };
  if (domain.kind === 'half') {
    const bc = conditions.find((item) => item.role === 'boundary');
    if (!bc?.end) throw new Error('A half-line needs a boundary condition at 0, for example u(0, t) = 0.');
    return { kind: 'half', bc: bc.end };
  }
  const ends = conditions.filter((item) => item.role === 'boundary' && item.end);
  if (periodic) {
    const dummy: EndCondition = { kind: 'dirichlet', valueExpr: '0', at: domain.left };
    return { kind: 'interval', leftExpr: domain.left, rightExpr: domain.right, left: dummy, right: { ...dummy, at: domain.right }, periodic: true };
  }
  const left = ends.find((item) => samePlace(item.end!.at, domain.left)) ?? ends[0];
  const right = ends.find((item) => samePlace(item.end!.at, domain.right)) ?? ends[1];
  if (!left?.end || !right?.end) {
    throw new Error('Write a boundary condition at each end, for example u(0, t) = 0 and u(pi, t) = 0.');
  }
  return { kind: 'interval', leftExpr: domain.left, rightExpr: domain.right, left: left.end, right: right.end, periodic: false };
}

function readCharData(conditions: Condition[], domain: DomainRead): CharProblem['data'] {
  const point = conditions.find((item) => item.role === 'point');
  if (point?.point) return { kind: 'point', ...point.point };
  const initial = conditions.find((item) => item.role === 'initial');
  const boundary = conditions.find((item) => item.role === 'boundary');
  if (domain.kind === 'half' && initial && boundary?.end) {
    return { kind: 'strip', gExpr: initial.expr, left: boundary.end };
  }
  if (!initial) throw new Error('Write the data, for example u(x, 0) = sin(x).');
  return { kind: 'cauchy', timeExpr: initial.timeExpr ?? '0', gExpr: initial.expr };
}

interface Condition {
  role: 'initial' | 'boundary' | 'point';
  expr: string;
  timeExpr?: string;
  end?: EndCondition;
  point?: { xExpr: string; yExpr: string; uExpr: string };
}

function readCondition(line: string): Condition {
  const eq = indexOfEquals(line);
  if (eq < 0) throw new Error(`"${line}" should set a value with =.`);
  const left = line.slice(0, eq).trim();
  const right = line.slice(eq + 1).trim();
  const robin = left.match(/^u_?x\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*([+-].+)$/i);
  if (robin) {
    const at = toMath(robin[1] ?? '0');
    const hExpr = robinCoefficient(robin[3] ?? '', robin[1] ?? '');
    return { role: 'boundary', expr: right, end: { kind: 'robin', valueExpr: toMath(right), hExpr, at } };
  }
  const neumann = left.match(/^u_?x\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
  if (neumann) {
    return { role: 'boundary', expr: right, end: { kind: 'neumann', valueExpr: toMath(right), at: toMath(neumann[1] ?? '0') } };
  }
  const call = left.match(/^u\s*\(([^)]*)\)$/i);
  if (!call) throw new Error(`Could not read "${line}". Use u(x, 0) = … or u(0, t) = ….`);
  const args = splitArgs(call[1] ?? '');
  if (args.length === 3) {
    return { role: 'initial', expr: toMath(right), timeExpr: toMath(args[2] ?? '0') };
  }
  if (args.length !== 2) throw new Error(`"${line}" should have two arguments, or three for u(x, y, 0).`);
  const [first, second] = args as [string, string];
  if (isSpatialName(first) && !isSpatialName(second)) {
    return { role: 'initial', expr: toMath(right, [first]), timeExpr: toMath(second) };
  }
  if (!isSpatialName(first) && isTimeName(second)) {
    return { role: 'boundary', expr: right, end: { kind: 'dirichlet', valueExpr: toMath(right), at: toMath(first) } };
  }
  if (!isSpatialName(first) && !isSpatialName(second)) {
    return { role: 'point', expr: right, point: { xExpr: toMath(first), yExpr: toMath(second), uExpr: toMath(right) } };
  }
  throw new Error(`Could not tell whether "${line}" is initial data or a boundary condition.`);
}

function robinCoefficient(extra: string, at: string): string {
  const removed = extra.replace(new RegExp(`\\*?\\s*u\\s*\\(\\s*${escapeRegExp(at.trim())}\\s*,\\s*t\\s*\\)`, 'i'), '');
  const cleaned = removed.replace(/\*/g, '').replace(/^\+/, '').trim();
  if (cleaned === '+' || cleaned === '') return '1';
  if (cleaned === '-') return '-1';
  return toMath(cleaned);
}

function isSpatialName(token: string): boolean {
  const name = token.trim();
  return name === 'x' || name === 'y' || name === 'r';
}

function isTimeName(token: string): boolean {
  const name = token.trim();
  return name === 't' || name === 'y';
}

interface DomainRead {
  kind: 'interval' | 'line' | 'half' | 'rectangle' | 'disk';
  left: string;
  right: string;
  radius: string;
  x0: string;
  x1: string;
  y0: string;
  y1: string;
  bc: 'dirichlet' | 'neumann';
  expressions: string[];
}

function readDomain(line: string): DomainRead {
  const text = line.trim();
  const bc = /neumann/i.test(text) ? 'neumann' : 'dirichlet';
  const blank: DomainRead = { kind: 'line', left: '0', right: '1', radius: '1', x0: '0', x1: '1', y0: '0', y1: '1', bc, expressions: [] };
  if (/\b(R|whole\s+line|real\s+line)\b|x\s*(in|∈)\s*R|\\mathbb\{R\}|-∞|infinity/i.test(text) && !/</.test(text)) {
    return { ...blank, kind: 'line' };
  }
  if (/disk|circle|x\s*\^\s*2\s*\+\s*y\s*\^\s*2|^r\s*</i.test(text)) {
    const radius =
      text.match(/([A-Za-z][A-Za-z0-9]*)\s*\^\s*2\s*$/)?.[1] ??
      text.match(/(?:radius|r)\s*(?:<|<=)?\s*([A-Za-z][A-Za-z0-9]*)/i)?.[1] ??
      '1';
    return { ...blank, kind: 'disk', radius: toMath(radius), expressions: [toMath(radius)] };
  }
  const halves = text.split(',');
  if (halves.length === 2) {
    const xPart = boundPair(halves[0] ?? '', 'x');
    const yPart = boundPair(halves[1] ?? '', 'y');
    return { ...blank, kind: 'rectangle', x0: xPart[0], x1: xPart[1], y0: yPart[0], y1: yPart[1], expressions: [...xPart, ...yPart] };
  }
  const half = text.match(/^([A-Za-z])\s*>+\s*(.+)$/) ?? text.match(/^(.+)\s*<+\s*([A-Za-z])$/);
  if (half && !text.includes('<') || (half && (text.match(/</g) ?? []).length < 2 && />/.test(text))) {
    const variable = (half?.[1]?.length === 1 ? half[1] : half?.[2]) ?? 'x';
    if (variable === 'x' || variable === 'r') return { ...blank, kind: 'half', expressions: [] };
  }
  const pair = boundPair(text, 'x');
  return { ...blank, kind: 'interval', left: pair[0], right: pair[1], expressions: pair };
}

function boundPair(text: string, variable: string): [string, string] {
  const match = text.match(/^(.*?)\s*<=?\s*[A-Za-z]\s*<=?\s*(.*?)$/);
  if (!match) throw new Error(`Could not read the domain "${text}". Use 0 < ${variable} < 1, x > 0, or x in R.`);
  return [toMath((match[1] ?? '').trim()), toMath((match[2] ?? '').trim())];
}

function classifyLines(lines: string[]): LineBag {
  const bag: LineBag = { periodic: false, conditions: [], assignments: [] };
  for (const line of lines) {
    if (/periodic/i.test(line) && !line.includes('=')) {
      bag.periodic = true;
      if (/[<∈>]/.test(line) || /disk|line|R/.test(line)) bag.domain = line;
      continue;
    }
    const assignment = readAssignment(line);
    if (assignment) {
      bag.assignments.push(assignment);
      continue;
    }
    if (isDomainLine(line)) {
      bag.domain = line;
      continue;
    }
    if (/^u(?:_?x)?\s*\(/i.test(line)) {
      bag.conditions.push(line);
      continue;
    }
    if (!bag.equation && line.includes('=')) {
      bag.equation = line;
      continue;
    }
    if (!bag.equation) bag.equation = line;
    else throw new Error(`Could not use the line "${line}".`);
  }
  return bag;
}

function isDomainLine(line: string): boolean {
  if (line.includes('=')) return false;
  return /[<≤≥>]|disk|circle|whole line|real line|\bin\b|∈/.test(line);
}

function readAssignment(line: string): { name: string; value: number } | null {
  const eq = indexOfEquals(line);
  if (eq < 0) return null;
  const left = line.slice(0, eq).trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(left) || RESERVED.has(left)) return null;
  try {
    const value = evalMath(line.slice(eq + 1), { pi: Math.PI, e: Math.E });
    if (!Number.isFinite(value)) return null;
    return { name: left, value };
  } catch {
    return null;
  }
}

function collectParameters(
  bag: LineBag,
  zero: string,
  extra: string[],
  conditions: string[],
  overrides: Record<string, Partial<ParameterSpec>> | undefined,
): Record<string, ParameterSpec> {
  const found = new Set<string>();
  for (const expr of [zero, ...extra, ...conditions]) {
    try {
      const prepared = expr.includes('u(') || expr.includes('u_') ? expr : expr;
      parse(toMath(shieldDerivatives(prepared), FIELD)).traverse((node: MathNode, _path: string, parent: MathNode) => {
        if (node.type !== 'SymbolNode') return;
        const owner = parent as MathNode & { fn?: MathNode };
        if (parent?.type === 'FunctionNode' && owner.fn === node) return;
        const name = (node as MathNode & { name: string }).name;
        if (!RESERVED.has(name) && !isBuiltInFunction(name)) found.add(name);
      });
    } catch {
      for (const word of expr.matchAll(/\b[A-Za-z][A-Za-z0-9]*\b/g)) {
        const name = word[0] ?? '';
        if (name && !RESERVED.has(name) && !isBuiltInFunction(name)) found.add(name);
      }
    }
  }
  const assigned = new Map(bag.assignments.map((item) => [item.name, item.value]));
  for (const name of assigned.keys()) found.add(name);
  const parameters: Record<string, ParameterSpec> = {};
  for (const name of found) {
    const value = assigned.get(name) ?? 1;
    const span = Math.max(Math.abs(value), 1);
    const nonnegative = (name === 'k' || name === 'nu' || name === 'kappa' || name === 'epsilon') && value >= 0;
    parameters[name] = {
      name,
      latex: symbolToLatex(name),
      value,
      min: nonnegative ? 0 : -Math.max(5, span * 2),
      max: nonnegative ? Math.max(1, span * 2) : Math.max(5, span * 2),
      step: nonnegative ? Math.max(span, 0.1) / 100 : 0.01,
    };
  }
  if (overrides) {
    for (const [name, patch] of Object.entries(overrides)) {
      const current = parameters[name];
      if (!current) continue;
      parameters[name] = { ...current, ...patch, name, latex: patch.latex ?? current.latex };
    }
  }
  return parameters;
}

function shieldDerivatives(input: string): string {
  let text = input;
  text = text.replace(/\(\s*u\s*\^\s*2\s*\/\s*2\s*\)\s*_x/gi, '(U*UX)');
  text = text.replace(/∂²u\/∂x²|\\partial_\{xx\}u|u_\{xx\}/gi, 'UXX');
  text = text.replace(/∂²u\/∂y²|u_\{yy\}/gi, 'UYY');
  text = text.replace(/u_xx|uxx/gi, 'UXX');
  text = text.replace(/u_yy|uyy/gi, 'UYY');
  text = text.replace(/u_xy/gi, 'UXY');
  text = text.replace(/u_tt/gi, 'UTT');
  text = text.replace(/u_\{x\}|∂u\/∂x|u_x|\bux\b/gi, 'UX');
  text = text.replace(/u_\{y\}|∂u\/∂y|u_y|\buy\b/gi, 'UY');
  text = text.replace(/u_\{t\}|∂u\/∂t|u_t|\but\b/gi, 'UT');
  text = text.replace(/\bu\b/g, 'U');
  return text;
}

function equationLatex(original: string): string {
  let text = original.trim();
  const chunks: Array<[RegExp, string]> = [
    [/u_xx/g, 'u_{xx}'],
    [/uxx/g, 'u_{xx}'],
    [/u_yy/g, 'u_{yy}'],
    [/u_x/g, 'u_{x}'],
    [/u_y/g, 'u_{y}'],
    [/u_t/g, 'u_{t}'],
    [/\bux\b/g, 'u_{x}'],
    [/\buy\b/g, 'u_{y}'],
    [/\but\b/g, 'u_{t}'],
    [/\s*\*\s*/g, ' '],
  ];
  for (const [pattern, replacement] of chunks) text = text.replace(pattern, replacement);
  text = text.replace(/\b(alpha|beta|gamma|delta|epsilon|lambda|mu|nu|pi|sigma|omega|kappa)\b/g, (name) => symbolToLatex(name));
  return text;
}

function diff(expr: string, symbol: string): string {
  try {
    return safeSimplify(derivative(expr, symbol).toString());
  } catch {
    return '0';
  }
}

function substitute(expr: string, values: Record<string, string>): string {
  let text = expr;
  for (const name of Object.keys(values).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${values[name]})`);
  }
  return safeSimplify(text);
}

function safeSimplify(expr: string): string {
  try {
    return simplify(expr).toString();
  } catch {
    return expr;
  }
}

function isZero(expr: string | undefined): boolean {
  if (!expr) return true;
  const simplified = safeSimplify(expr);
  return simplified === '0' || simplified === '-0';
}

function isConstant(expr: string): boolean {
  return !mentions(expr, 'U') && !mentions(expr, 'x') && !mentions(expr, 't') && !mentions(expr, 'y');
}

function samePlace(at: string, end: string): boolean {
  try {
    return Math.abs(evalMath(at, { pi: Math.PI }) - evalMath(end, { pi: Math.PI })) < 1e-9;
  } catch {
    return at.replace(/\s+/g, '') === end.replace(/\s+/g, '');
  }
}

function indexOfEquals(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === '=' && depth === 0 && text[i + 1] !== '=' && text[i - 1] !== '<' && text[i - 1] !== '>' && text[i - 1] !== '!') return i;
  }
  return -1;
}

function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args.filter(Boolean);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
