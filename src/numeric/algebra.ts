/**
 * Small symbolic helpers on top of mathjs: substitution, polynomial arithmetic,
 * sign tests, and the antiderivatives needed for Hamiltonians and Lyapunov functions.
 */

import { derivative, parse, simplify, type MathNode } from 'mathjs';

/** mathjs nodes are not a discriminated union, so reads go through this view. */
type Ast = MathNode & {
  name: string;
  value: number | string;
  content: Ast;
  op: string;
  fn: Ast | string;
  args: Ast[];
};

function asAst(node: MathNode): Ast {
  return node as Ast;
}

export type Poly = Map<string, number>;

const ZERO_TOL = 1e-9;

export function trySimplify(expr: string): string {
  // mathjs simplify is exponential on long trig products. The unsimplified expression stays exact.
  if (expr.length > 220) return expr;
  try {
    return simplify(expr).toString();
  } catch {
    return expr;
  }
}

export function substituteExpr(expr: string, map: Record<string, string>): string {
  const replacements = new Map<string, MathNode>();
  for (const [name, value] of Object.entries(map)) replacements.set(name, parse(value));
  const transformed = parse(expr).transform((node) => {
    const symbol = asAst(node);
    if (node.type === 'SymbolNode' && replacements.has(symbol.name)) {
      return replacements.get(symbol.name)!.clone();
    }
    return node;
  });
  return transformed.toString();
}

export function substituteNumbers(expr: string, values: Record<string, number>): string {
  const names = Object.keys(values).sort((a, b) => b.length - a.length);
  let current = expr;
  for (const name of names) current = substituteExpr(current, { [name]: formatNumber(values[name] ?? 0) });
  return trySimplify(current);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1e-12) return '0';
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-10) return String(rounded);
  const rational = rationalize(value, 16);
  if (rational) return rational.d === 1 ? String(rational.n) : `(${rational.n}/${rational.d})`;
  const text = Number(value.toPrecision(12)).toString();
  return text.includes('e') ? `(${text})` : text;
}

export function rationalize(value: number, maxDen = 12): { n: number; d: number } | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) < 1e-10) return { n: 0, d: 1 };
  for (let d = 1; d <= maxDen; d += 1) {
    const n = Math.round(value * d);
    if (Math.abs(n / d - value) <= 1e-8 * Math.max(1, Math.abs(value))) return { n, d };
  }
  return null;
}

export function latexNumber(value: number): string {
  if (Math.abs(value) < 1e-10) return '0';
  const rational = rationalize(value, 12);
  if (!rational) {
    const text = Number(value.toPrecision(6)).toString();
    return text.startsWith('-') ? `-${text.slice(1)}` : text;
  }
  const sign = rational.n < 0 ? '-' : '';
  const num = Math.abs(rational.n);
  if (rational.d === 1) return `${sign}${num}`;
  return `${sign}\\frac{${num}}{${rational.d}}`;
}

export function dependsOn(expr: string, variable: string): boolean {
  let found = false;
  parse(expr).traverse((node) => {
    if (node.type === 'SymbolNode' && asAst(node).name === variable) found = true;
  });
  return found;
}

export function toPolynomial(expr: string, vars: string[]): Poly | null {
  let expanded: MathNode;
  try {
    expanded = simplify(parse(expr));
  } catch {
    return null;
  }
  return nodeToPoly(asAst(expanded), vars);
}

function nodeToPoly(node: Ast, vars: string[]): Poly | null {
  if (node.type === 'ParenthesisNode') return nodeToPoly(node.content, vars);
  if (node.type === 'ConstantNode') return polyConstant(Number(node.value));
  if (node.type === 'SymbolNode') {
    const index = vars.indexOf(node.name);
    if (index < 0) {
      if (node.name === 'pi') return polyConstant(Math.PI);
      if (node.name === 'e') return polyConstant(Math.E);
      return null;
    }
    return polyMonomial(vars.length, index, 1, 1);
  }
  if (node.type === 'OperatorNode') {
    if (node.fn === 'unaryMinus' || (node.op === '-' && node.args.length === 1)) {
      const inner = nodeToPoly(node.args[0]!, vars);
      return inner && scalePoly(inner, -1);
    }
    if (node.op === '+') return combinePoly(node.args, vars, false);
    if (node.op === '-' && node.args.length === 2) {
      const left = nodeToPoly(node.args[0]!, vars);
      const right = nodeToPoly(node.args[1]!, vars);
      if (!left || !right) return null;
      return addPoly(left, scalePoly(right, -1));
    }
    if (node.op === '*') {
      let acc = polyConstant(1);
      for (const arg of node.args) {
        const factor = nodeToPoly(arg, vars);
        if (!factor) return null;
        acc = mulPoly(acc, factor);
      }
      return acc;
    }
    if (node.op === '/') {
      const left = nodeToPoly(node.args[0]!, vars);
      const right = nodeToPoly(node.args[1]!, vars);
      if (!left || !right || !isConstantPoly(right)) return null;
      const denom = constantTerm(right);
      if (Math.abs(denom) < ZERO_TOL) return null;
      return scalePoly(left, 1 / denom);
    }
    if (node.op === '^') {
      const base = nodeToPoly(node.args[0]!, vars);
      const exp = nodeToPoly(node.args[1]!, vars);
      if (!base || !exp || !isConstantPoly(exp)) return null;
      const power = constantTerm(exp);
      if (!Number.isInteger(power) || power < 0 || power > 12) return null;
      return powPoly(base, power);
    }
  }
  if (node.type === 'FunctionNode') return null;
  return null;
}

function polyConstant(value: number): Poly {
  return new Map([['', value]]);
}

function polyMonomial(dim: number, index: number, power: number, coeff: number): Poly {
  const exps = Array(dim).fill(0);
  exps[index] = power;
  return new Map([[exps.join(','), coeff]]);
}

function parseKey(key: string, dim: number): number[] {
  if (!key) return Array(dim).fill(0);
  const parts = key.split(',').map(Number);
  while (parts.length < dim) parts.push(0);
  return parts;
}

function scalePoly(poly: Poly, factor: number): Poly {
  const out: Poly = new Map();
  for (const [key, coeff] of poly) out.set(key, coeff * factor);
  return out;
}

function addPoly(left: Poly, right: Poly): Poly {
  const out: Poly = new Map(left);
  for (const [key, coeff] of right) out.set(key, (out.get(key) ?? 0) + coeff);
  for (const [key, coeff] of out) if (Math.abs(coeff) < 1e-12) out.delete(key);
  return out;
}

function mulPoly(left: Poly, right: Poly): Poly {
  const out: Poly = new Map();
  for (const [ka, ca] of left) {
    for (const [kb, cb] of right) {
      const ea = ka ? ka.split(',').map(Number) : [0];
      const eb = kb ? kb.split(',').map(Number) : [0];
      const dim = Math.max(ea.length, eb.length);
      const exps = Array(dim).fill(0);
      for (let i = 0; i < dim; i += 1) exps[i] = (ea[i] ?? 0) + (eb[i] ?? 0);
      const key = exps.every((value) => value === 0) ? '' : exps.join(',');
      out.set(key, (out.get(key) ?? 0) + ca * cb);
    }
  }
  for (const [key, coeff] of out) if (Math.abs(coeff) < 1e-12) out.delete(key);
  return out;
}

function powPoly(base: Poly, power: number): Poly {
  let acc = polyConstant(1);
  for (let i = 0; i < power; i += 1) acc = mulPoly(acc, base);
  return acc;
}

function isConstantPoly(poly: Poly): boolean {
  for (const key of poly.keys()) {
    if (key && key.split(',').some((part) => Number(part) !== 0)) return false;
  }
  return true;
}

function constantTerm(poly: Poly): number {
  let total = 0;
  for (const [key, coeff] of poly) {
    if (!key || key.split(',').every((part) => Number(part) === 0)) total += coeff;
  }
  return total;
}

function combinePoly(args: Ast[], vars: string[], subtract: boolean): Poly | null {
  let acc = polyConstant(0);
  args.forEach((arg, index) => {
    const poly = nodeToPoly(arg, vars);
    if (!poly) return;
    const sign = subtract && index > 0 ? -1 : 1;
    acc = addPoly(acc, scalePoly(poly, sign));
  });
  if (args.some((arg) => nodeToPoly(arg, vars) === null)) return null;
  return acc;
}

export function polyIsZero(poly: Poly): boolean {
  for (const coeff of poly.values()) if (Math.abs(coeff) > 1e-8) return false;
  return true;
}

export type SignClass = 'positive' | 'negative' | 'nonpositive' | 'nonnegative' | 'zero' | 'indefinite' | 'unknown';

/** Sign of a polynomial on R^n. Even-powered same-sign polynomials are semi-definite. */
export function polynomialSign(poly: Poly, dim: number): SignClass {
  if (polyIsZero(poly)) return 'zero';
  let sign = 0;
  let constant = 0;
  const pure = Array(dim).fill(false);
  for (const [key, coeff] of poly) {
    if (Math.abs(coeff) < 1e-10) continue;
    const exps = parseKey(key, dim);
    if (exps.some((exp) => exp % 2 === 1)) return 'indefinite';
    const sg = Math.sign(coeff);
    if (sign === 0) sign = sg;
    else if (sg !== sign) return 'indefinite';
    const support = exps.map((exp, index) => (exp > 0 ? index : -1)).filter((index) => index >= 0);
    if (support.length === 0) constant += coeff;
    if (support.length === 1) pure[support[0]!] = true;
  }
  if (sign === 0) return 'zero';
  if (Math.abs(constant) > 1e-10) return sign > 0 ? 'positive' : 'negative';
  const definite = pure.every(Boolean);
  if (sign > 0) return definite ? 'positive' : 'nonnegative';
  return definite ? 'negative' : 'nonpositive';
}

export function isIdenticallyZero(expr: string, vars: string[]): boolean {
  const poly = toPolynomial(expr, vars);
  if (poly) return polyIsZero(poly);
  const simplified = trySimplify(expr);
  if (simplified === '0' || simplified === '0.0') return true;
  let code: ReturnType<MathNode['compile']>;
  try {
    code = parse(expr).compile();
  } catch {
    return false;
  }
  const probes = probePoints(vars);
  for (const scope of probes) {
    try {
      const value = Number(code.evaluate(scope));
      if (!Number.isFinite(value) || Math.abs(value) > 1e-6) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function expressionSign(expr: string, vars: string[]): SignClass {
  const poly = toPolynomial(expr, vars);
  if (poly) return polynomialSign(poly, vars.length);
  if (isIdenticallyZero(expr, vars)) return 'zero';
  let code: ReturnType<MathNode['compile']>;
  try {
    code = parse(expr).compile();
  } catch {
    return 'unknown';
  }
  let sawPositive = false;
  let sawNegative = false;
  let sawZero = false;
  for (const scope of probePoints(vars)) {
    let value: number;
    try {
      value = Number(code.evaluate(scope));
    } catch {
      return 'unknown';
    }
    if (!Number.isFinite(value)) return 'unknown';
    if (value > 1e-8) sawPositive = true;
    else if (value < -1e-8) sawNegative = true;
    else sawZero = true;
  }
  if (sawPositive && sawNegative) return 'indefinite';
  if (sawPositive && !sawNegative) return sawZero ? 'nonnegative' : 'positive';
  if (sawNegative && !sawPositive) return sawZero ? 'nonpositive' : 'negative';
  return 'zero';
}

function probePoints(vars: string[]): Record<string, number>[] {
  const fixed = [0, 0.4, -0.7, 1, -1.3, 0.8, 1.7, -0.2, Math.PI / 3, 0.15];
  const points: Record<string, number>[] = [];
  for (let i = 0; i < 16; i += 1) {
    const scope: Record<string, number> = {};
    vars.forEach((name, index) => {
      scope[name] = fixed[(i + index * 3) % fixed.length] ?? 0;
    });
    points.push(scope);
  }
  if (vars.length >= 2) {
    points.push({ [vars[0]!]: 0, [vars[1]!]: 1 });
    points.push({ [vars[0]!]: 1, [vars[1]!]: 0 });
    points.push({ [vars[0]!]: 0.5, [vars[1]!]: -0.5 });
  }
  return points;
}

export function integrateExpr(expr: string, variable: string, vars: string[]): string | null {
  const poly = toPolynomial(expr, vars);
  if (poly) {
    const integrated = integratePoly(poly, vars, variable);
    if (integrated) return polyToExpr(integrated, vars);
  }
  try {
    const node = integrateNode(asAst(parse(expr)), variable);
    if (!node) return null;
    return trySimplify(node.toString());
  } catch {
    return null;
  }
}

function integratePoly(poly: Poly, vars: string[], variable: string): Poly | null {
  const index = vars.indexOf(variable);
  if (index < 0) return null;
  const out: Poly = new Map();
  for (const [key, coeff] of poly) {
    const exps = parseKey(key, vars.length);
    exps[index] = (exps[index] ?? 0) + 1;
    const next = exps[index]!;
    if (Math.abs(next) < 1e-12) return null;
    out.set(exps.join(','), coeff / next);
  }
  return out;
}

export function polyToExpr(poly: Poly, vars: string[]): string {
  const terms: string[] = [];
  for (const [key, coeff] of poly) {
    if (Math.abs(coeff) < 1e-12) continue;
    const exps = parseKey(key, vars.length);
    const factors = exps
      .map((exp, index) => {
        if (!exp) return '';
        return exp === 1 ? vars[index]! : `${vars[index]}^${exp}`;
      })
      .filter(Boolean);
    const mag = formatNumber(Math.abs(coeff));
    const body = factors.length === 0 ? mag : mag === '1' ? factors.join('*') : `${mag}*${factors.join('*')}`;
    terms.push(coeff < 0 ? `-(${body})` : body);
  }
  if (terms.length === 0) return '0';
  return trySimplify(terms.join('+'));
}

function integrateNode(node: Ast, variable: string): MathNode | null {
  if (node.type === 'ParenthesisNode') {
    const inner = integrateNode(node.content, variable);
    return inner ? parse(`(${inner.toString()})`) : null;
  }
  if (node.type === 'ConstantNode') return parse(`(${node.toString()}) * ${variable}`);
  if (node.type === 'SymbolNode') {
    if (node.name === variable) return parse(`(${variable} ^ 2) / 2`);
    return parse(`(${node.name}) * ${variable}`);
  }
  if (node.type === 'OperatorNode') {
    if (node.fn === 'unaryMinus' || (node.op === '-' && node.args.length === 1)) {
      const inner = integrateNode(node.args[0]!, variable);
      return inner ? parse(`-(${inner.toString()})`) : null;
    }
    if (node.op === '+') {
      const parts = node.args.map((arg) => integrateNode(arg, variable));
      if (parts.some((part) => !part)) return null;
      return parse(parts.map((part) => `(${part!.toString()})`).join('+'));
    }
    if (node.op === '-' && node.args.length === 2) {
      const left = integrateNode(node.args[0]!, variable);
      const right = integrateNode(node.args[1]!, variable);
      if (!left || !right) return null;
      return parse(`(${left.toString()}) - (${right.toString()})`);
    }
    if (node.op === '*') {
      const factors = node.args.map((arg) => ({ node: arg, dep: dependsOn(arg.toString(), variable) }));
      if (factors.filter((factor) => factor.dep).length > 1) return null;
      const dependent = factors.find((factor) => factor.dep)?.node ?? null;
      const independent = factors.filter((factor) => !factor.dep).map((factor) => factor.node.toString());
      const integrand = dependent ? integrateNode(dependent, variable) : parse(variable);
      if (!integrand) return null;
      if (independent.length === 0) return integrand;
      return parse(`(${independent.join('*')}) * (${integrand.toString()})`);
    }
    if (node.op === '/') {
      if (dependsOn(node.args[1]!.toString(), variable)) return null;
      const inner = integrateNode(node.args[0]!, variable);
      if (!inner) return null;
      return parse(`(${inner.toString()}) / (${node.args[1]!.toString()})`);
    }
    if (node.op === '^') {
      const affine = asAffine(node.args[0]!, variable);
      const exp = node.args[1]!;
      if (!affine || dependsOn(exp.toString(), variable)) return null;
      const power = Number(evaluateConstant(exp));
      if (!Number.isFinite(power) || Math.abs(Number(affine.a)) < ZERO_TOL) return null;
      if (Math.abs(power + 1) < ZERO_TOL) return parse(`log(abs(${node.args[0]!.toString()})) / (${affine.a})`);
      return parse(`((${node.args[0]!.toString()}) ^ (${power + 1})) / ((${power + 1}) * (${affine.a}))`);
    }
  }
  if (node.type === 'FunctionNode') {
    const name = functionName(node);
    const arg = node.args[0];
    if (!name || !arg) return null;
    if (!dependsOn(arg.toString(), variable)) return parse(`(${node.toString()}) * ${variable}`);
    const affine = asAffine(arg, variable);
    if (!affine || Math.abs(Number(affine.a)) < ZERO_TOL) return null;
    const argument = arg.toString();
    if (name === 'sin') return parse(`-(cos(${argument})) / (${affine.a})`);
    if (name === 'cos') return parse(`(sin(${argument})) / (${affine.a})`);
    if (name === 'exp') return parse(`(exp(${argument})) / (${affine.a})`);
  }
  return null;
}

function asAffine(node: MathNode, variable: string): { a: string } | null {
  let slope: MathNode;
  try {
    slope = derivative(node, variable);
  } catch {
    return null;
  }
  if (dependsOn(slope.toString(), variable)) return null;
  const a = trySimplify(slope.toString());
  return { a };
}

function functionName(node: Ast): string | null {
  if (node.type !== 'FunctionNode' || typeof node.fn === 'string') return null;
  return node.fn.type === 'SymbolNode' ? node.fn.name : null;
}

function evaluateConstant(node: MathNode): number {
  try {
    return Number(node.evaluate({}));
  } catch {
    return Number.NaN;
  }
}

export function differentiate(expr: string, variable: string): string {
  return trySimplify(derivative(parse(expr), variable).toString());
}

export function seriesMonomialLatex(coeffs: number[], variable: string): string {
  const terms: string[] = [];
  coeffs.forEach((coeff, power) => {
    if (power < 1 || Math.abs(coeff) < 1e-8) return;
    const sign = coeff < 0 ? '-' : terms.length ? '+' : '';
    const mag = latexNumber(Math.abs(coeff));
    const showMag = mag === '1' || mag === '1.0' ? '' : mag;
    const body = power === 1 ? `${showMag}${variable}` : `${showMag}${variable}^{${power}}`;
    terms.push(`${sign}${body}`);
  });
  if (terms.length === 0) return '0';
  return terms.join('');
}
