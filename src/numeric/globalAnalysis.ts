import { compile, parse } from 'mathjs';
import type {
  ApplicableTheorem,
  CylindricalAnalysis,
  CompiledSystem,
  EquilibriumAnalysis,
  GlobalPropertiesAnalysis,
  LimitCycle,
  PolarAnalysis,
  SphericalAnalysis,
  SymmetryInfo,
  SystemSpec,
} from '../core/types';
import { paintSymbolLatex, symbolToLatex } from '../input/parser';
import {
  differentiate,
  certifiedSign,
  expressionSign,
  integrateExpr,
  isIdenticallyZero,
  latexNumber,
  substituteExpr,
  substituteNumbers,
  trySimplify,
} from './algebra';

type BendixsonInfo = NonNullable<GlobalPropertiesAnalysis['bendixsonDulac']>;

export interface GlobalBundle {
  global: GlobalPropertiesAnalysis;
  polar?: PolarAnalysis;
  cylindrical?: CylindricalAnalysis;
  spherical?: SphericalAnalysis;
  reversibleFix: { xAxis: boolean; yAxis: boolean };
}

export function analyzeGlobal(spec: SystemSpec, compiled: CompiledSystem): GlobalBundle {
  const vars = spec.stateVars;
  const values = compiled.parameterValues;
  const rhs = spec.rhsExpressions.map((expr) => substituteNumbers(expr, values));
  const symbolicRhs = spec.rhsExpressions;
  const divergence = vars.map((variable, index) => differentiate(symbolicRhs[index] ?? '0', variable)).join('+');
  const divergenceExpr = trySimplify(divergence);
  const divergenceNow = trySimplify(vars.map((variable, index) => differentiate(rhs[index] ?? '0', variable)).join('+'));
  const isDivergenceFree = isIdenticallyZero(divergenceNow, vars);
  const curl = vars.length >= 2 ? trySimplify(`(${differentiate(rhs[1] ?? '0', vars[0] ?? 'x')}) - (${differentiate(rhs[0] ?? '0', vars[1] ?? 'y')})`) : '';
  const gradient = vars.length >= 2 && isIdenticallyZero(curl, vars);
  const potential = gradient && vars.length === 2 ? integratePotential(rhs[0] ?? '0', rhs[1] ?? '0', vars[0]!, vars[1]!) : null;
  const hamiltonian = vars.length === 2 && isDivergenceFree ? integrateHamiltonian(rhs[0] ?? '0', rhs[1] ?? '0', vars[0]!, vars[1]!) : null;
  const symmetries = vars.length >= 2 ? detectSymmetries(rhs, vars) : [];
  const reversibleFix = {
    yAxis: symmetries.some((item) => item.type === 'time_reversible_y'),
    xAxis: symmetries.some((item) => item.type === 'time_reversible_x'),
  };
  const bendixson = vars.length === 2 ? bendixsonDulac(rhs, vars) : undefined;
  const restsAtOrigin = compiled.f(0, vars.map(() => 0), values).every((value) => Math.abs(value) < 1e-8);
  const linearSystemExact = spec.isLinear && vars.length === 2 && restsAtOrigin ? linearClosedForm(compiled, spec.independentVar) : undefined;
  const polar = vars.length === 2 ? polarSkeleton(symbolicRhs, vars) : undefined;
  const cylindrical = vars.length === 3 ? cylindricalSkeleton(symbolicRhs, vars) : undefined;
  const spherical = vars.length === 3 ? sphericalSkeleton(symbolicRhs, vars) : undefined;
  const jacobianLatex = jacobianMatrixLatex(symbolicRhs, vars);

  const global: GlobalPropertiesAnalysis = {
    symbolicJacobianLatex: jacobianLatex,
    divergenceLatex: expressionToDisplay(divergenceExpr, vars),
    divergenceExpr,
    isDivergenceFree,
    curl2DLatex: vars.length >= 2 ? expressionToDisplay(curl, vars) : undefined,
    isGradientSystem: Boolean(gradient && potential),
    potentialFunctionLatex: potential ? `V = ${expressionToDisplay(potential, vars)}` : undefined,
    potentialExpr: potential ?? undefined,
    isHamiltonian: Boolean(hamiltonian),
    hamiltonianLatex: hamiltonian ? `H = ${expressionToDisplay(hamiltonian, vars)}` : undefined,
    hamiltonianExpr: hamiltonian ?? undefined,
    symmetries,
    bendixsonDulac: bendixson,
    linearSystemExact,
    applicableTheorems: [],
  };
  return { global, polar, cylindrical, spherical, reversibleFix };
}

export function finalizeGlobal(
  spec: SystemSpec,
  compiled: CompiledSystem,
  bundle: GlobalBundle,
  equilibria: EquilibriumAnalysis[],
  limitCycles: LimitCycle[],
): void {
  const lyapunov = analyzeLyapunov(spec, compiled, bundle.global.hamiltonianExpr);
  if (lyapunov) bundle.global.lyapunov = lyapunov;
  if (bundle.polar && spec.dimension === 2) {
    const recommendation = recommendPolar(spec, bundle.polar, equilibria, limitCycles);
    bundle.polar.isRecommended = recommendation.recommended;
    bundle.polar.recommendationReason = recommendation.reason;
    const radial = radialEquilibria(bundle.polar, compiled.parameterValues);
    bundle.polar.radialEquilibriaR = radial.radii;
    bundle.polar.radialStability = radial.stability;
    for (const symmetry of polarSymmetries(bundle.polar, compiled.parameterValues, spec.stateVars)) {
      if (bundle.global.symmetries.some((item) => item.type === symmetry.type)) continue;
      bundle.global.symmetries.push(symmetry);
    }
  }
  if (bundle.cylindrical) {
    const free = angularlyFree(bundle.cylindrical.rDotExpr, bundle.cylindrical.zDotExpr, compiled.parameterValues);
    bundle.cylindrical.isRecommended = free;
    bundle.cylindrical.recommendationReason = free ? 'Radial and axial dynamics do not depend on the azimuthal angle.' : undefined;
  }
  if (bundle.spherical) {
    const free = angularlyFree(bundle.spherical.rhoDotExpr, bundle.spherical.rhoDotExpr, compiled.parameterValues);
    bundle.spherical.isRecommended = free;
    bundle.spherical.recommendationReason = free ? 'The radial equation is independent of the angular coordinates.' : undefined;
  }
  bundle.global.applicableTheorems = theorems(spec, bundle, equilibria);
}

function integrateHamiltonian(f1: string, f2: string, x: string, y: string): string | null {
  const partial = integrateExpr(f1, y, [x, y]);
  if (!partial) return null;
  const aPrime = trySimplify(`-(${f2}) - (${differentiate(partial, x)})`);
  if (!isIdenticallyZero(differentiate(aPrime, y), [x, y])) return null;
  const correction = integrateExpr(aPrime, x, [x, y]);
  if (!correction) return null;
  const hamiltonian = trySimplify(`(${partial}) + (${correction})`);
  if (!isIdenticallyZero(`(${differentiate(hamiltonian, y)}) - (${f1})`, [x, y])) return null;
  if (!isIdenticallyZero(`(${differentiate(hamiltonian, x)}) + (${f2})`, [x, y])) return null;
  return hamiltonian;
}

function integratePotential(f1: string, f2: string, x: string, y: string): string | null {
  const partial = integrateExpr(`-(${f1})`, x, [x, y]);
  if (!partial) return null;
  const bPrime = trySimplify(`-(${f2}) - (${differentiate(partial, y)})`);
  if (!isIdenticallyZero(differentiate(bPrime, x), [x, y])) return null;
  const correction = integrateExpr(bPrime, y, [x, y]);
  if (!correction) return null;
  const potential = trySimplify(`(${partial}) + (${correction})`);
  if (!isIdenticallyZero(`(${differentiate(potential, x)}) + (${f1})`, [x, y])) return null;
  if (!isIdenticallyZero(`(${differentiate(potential, y)}) + (${f2})`, [x, y])) return null;
  return potential;
}

function detectSymmetries(rhs: string[], vars: string[]): SymmetryInfo[] {
  const [x, y] = vars;
  if (!x || !y) return [];
  const f = (index: number, map: Record<string, string>) => substituteExpr(rhs[index] ?? '0', map);
  const zero = (expr: string) => isIdenticallyZero(expr, vars);
  const found: SymmetryInfo[] = [];
  const xReflect = zero(`(${f(0, { [x]: `(-${x})` })}) - (-(${rhs[0]}))`) && zero(`(${f(1, { [x]: `(-${x})` })}) - (${rhs[1]})`);
  if (xReflect) {
    found.push({
      type: 'x_reflection',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (-${symbolToLatex(x)}, ${symbolToLatex(y)})`,
      geometricImplication: 'The phase portrait is symmetric across the vertical axis.',
    });
  }
  const yReflect = zero(`(${f(0, { [y]: `(-${y})` })}) - (${rhs[0]})`) && zero(`(${f(1, { [y]: `(-${y})` })}) - (-(${rhs[1]}))`);
  if (yReflect) {
    found.push({
      type: 'y_reflection',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (${symbolToLatex(x)}, -${symbolToLatex(y)})`,
      geometricImplication: 'The phase portrait is symmetric across the horizontal axis.',
    });
  }
  const origin = zero(`(${f(0, { [x]: `(-${x})`, [y]: `(-${y})` })}) - (-(${rhs[0]}))`) && zero(`(${f(1, { [x]: `(-${x})`, [y]: `(-${y})` })}) - (-(${rhs[1]}))`);
  if (origin) {
    found.push({
      type: 'origin_inversion',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (-${symbolToLatex(x)}, -${symbolToLatex(y)})`,
      geometricImplication: 'The vector field is odd, so the portrait is symmetric under a half-turn.',
    });
  }
  const revY = zero(`(${f(0, { [y]: `(-${y})` })}) - (-(${rhs[0]}))`) && zero(`(${f(1, { [y]: `(-${y})` })}) - (${rhs[1]})`);
  if (revY) {
    found.push({
      type: 'time_reversible_y',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}, t) \\mapsto (${symbolToLatex(x)}, -${symbolToLatex(y)}, -t)`,
      geometricImplication: 'Reversing symmetry across the horizontal axis. A linear center on that axis is a nonlinear center.',
    });
  }
  const revX = zero(`(${f(0, { [x]: `(-${x})` })}) - (${rhs[0]})`) && zero(`(${f(1, { [x]: `(-${x})` })}) - (-(${rhs[1]}))`);
  if (revX) {
    found.push({
      type: 'time_reversible_x',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}, t) \\mapsto (-${symbolToLatex(x)}, ${symbolToLatex(y)}, -t)`,
      geometricImplication: 'Reversing symmetry across the vertical axis. A linear center on that axis is a nonlinear center.',
    });
  }
  const rotate = zero(`(${f(0, { [x]: `(-${y})`, [y]: x })}) - (-(${rhs[1]}))`) && zero(`(${f(1, { [x]: `(-${y})`, [y]: x })}) - (${rhs[0]})`);
  if (rotate) {
    found.push({
      type: 'rotational_SO2',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (-${symbolToLatex(y)}, ${symbolToLatex(x)})`,
      geometricImplication: 'The vector field commutes with rotation, so polar coordinates decouple.',
    });
  }
  const periodic = zero(`(${f(0, { [x]: `(${x} + 2 * pi)` })}) - (${rhs[0]})`) && zero(`(${f(1, { [x]: `(${x} + 2 * pi)` })}) - (${rhs[1]})`);
  if (periodic) {
    found.push({
      type: 'periodic_translation',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (${symbolToLatex(x)} + 2\\pi, ${symbolToLatex(y)})`,
      geometricImplication: 'The equation is 2π-periodic in the first coordinate.',
    });
  }
  return found;
}

function bendixsonDulac(rhs: string[], vars: string[]): BendixsonInfo | undefined {
  const [x, y] = vars;
  if (!x || !y) return undefined;
  const multipliers = [
    { latex: '1', expr: '1' },
    { latex: 'e^{-x}', expr: `exp(-(${x}))` },
    { latex: 'e^{x}', expr: `exp(${x})` },
    { latex: 'e^{-y}', expr: `exp(-(${y}))` },
    { latex: 'e^{y}', expr: `exp(${y})` },
    { latex: 'e^{-2x}', expr: `exp(-2*(${x}))` },
  ];
  for (const multiplier of multipliers) {
    const productX = trySimplify(`(${multiplier.expr}) * (${rhs[0]})`);
    const productY = trySimplify(`(${multiplier.expr}) * (${rhs[1]})`);
    const divergence = trySimplify(`(${differentiate(productX, x)}) + (${differentiate(productY, y)})`);
    // 1/(x²+y²) is left out on purpose. It is singular at the origin, so a
    // sign there does not rule out a cycle that winds around that point.
    const sign = certifiedSign(divergence, vars);
    if (sign === 'negative' || sign === 'positive' || sign === 'nonpositive' || sign === 'nonnegative') {
      const strict = sign === 'negative' || sign === 'positive';
      return {
        applies: true,
        multiplierLatex: `B = ${multiplier.latex}`,
        divergenceProductLatex: expressionToDisplay(divergence, vars),
        conclusion: strict
          ? 'No periodic orbits exist in the simply connected domain where the multiplier stays smooth and nonzero.'
          : 'The Dulac divergence does not change sign, which rules out periodic orbits in the region where it is not identically zero.',
      };
    }
  }
  return { applies: false, multiplierLatex: 'B = 1', divergenceProductLatex: '', conclusion: 'No Dulac multiplier from the standard family was sign-definite.' };
}

function linearClosedForm(compiled: CompiledSystem, timeName: string): GlobalPropertiesAnalysis['linearSystemExact'] {
  const matrix = compiled.J(0, compiled.stateVars.map(() => 0), compiled.parameterValues);
  if (matrix.length !== 2) return undefined;
  const exponential = exponentialLatex(matrix, timeName);
  return {
    matrixALatex: pmatrix(matrix.map((row) => row.map((value) => latexNumber(value)))),
    jordanFormLatex: jordanLatex(matrix),
    matrixExponentialLatex: exponential,
    generalSolutionLatex: `\\mathbf{x}(${timeName}) = e^{A ${timeName}} \\mathbf{x}_0`,
  };
}

function exponentialLatex(matrix: number[][], time: string): string {
  const a = matrix[0]?.[0] ?? 0;
  const b = matrix[0]?.[1] ?? 0;
  const c = matrix[1]?.[0] ?? 0;
  const d = matrix[1]?.[1] ?? 0;
  const tau = a + d;
  const det = a * d - b * c;
  const disc = tau * tau - 4 * det;
  const alpha = tau / 2;
  if (disc < -1e-9) {
    const beta = Math.sqrt(-disc) / 2;
    const factor = Math.abs(alpha) < 1e-8 ? '' : `e^{${latexNumber(alpha)} ${time}}`;
    const cos = trigLatex('cos', beta, time);
    const sin = trigLatex('sin', beta, time);
    const shift = [
      [a - alpha, b],
      [c, d - alpha],
    ];
    const entries = [0, 1].map((row) =>
      [0, 1].map((col) => {
        const extra = (shift[row]?.[col] ?? 0) / beta;
        return `${factor}\\left(${cos}${signedTerm(extra, sin)}\\right)`;
      }),
    );
    return pmatrix(entries);
  }
  if (disc > 1e-9) {
    const delta = Math.sqrt(disc) / 2;
    const l1 = alpha + delta;
    const l2 = alpha - delta;
    return `e^{${latexNumber(l1)} ${time}} P_1 + e^{${latexNumber(l2)} ${time}} P_2`;
  }
  return `e^{${latexNumber(alpha)} ${time}}\\left(I + ${time}(A - ${latexNumber(alpha)} I)\\right)`;
}

function jordanLatex(matrix: number[][]): string {
  const a = matrix[0]?.[0] ?? 0;
  const b = matrix[0]?.[1] ?? 0;
  const c = matrix[1]?.[0] ?? 0;
  const d = matrix[1]?.[1] ?? 0;
  const tau = a + d;
  const det = a * d - b * c;
  const disc = tau * tau - 4 * det;
  const alpha = tau / 2;
  if (disc < -1e-9) {
    const beta = Math.sqrt(-disc) / 2;
    return pmatrix([
      [`${latexNumber(alpha)}+${latexNumber(beta)} i`, '0'],
      ['0', `${latexNumber(alpha)}-${latexNumber(beta)} i`],
    ]);
  }
  if (Math.abs(disc) <= 1e-9) {
    const off = Math.abs(b) + Math.abs(c) > 1e-8 && Math.abs(a - d) < 1e-8 ? 1 : 0;
    return pmatrix([
      [latexNumber(alpha), String(off)],
      ['0', latexNumber(alpha)],
    ]);
  }
  const delta = Math.sqrt(disc) / 2;
  return pmatrix([
    [latexNumber(alpha + delta), '0'],
    ['0', latexNumber(alpha - delta)],
  ]);
}

function polarSkeleton(rhs: string[], vars: string[]): PolarAnalysis {
  const [x, y] = vars;
  const fx = substituteExpr(rhs[0] ?? '0', { [x!]: '(r * cos(theta))', [y!]: '(r * sin(theta))' });
  const fy = substituteExpr(rhs[1] ?? '0', { [x!]: '(r * cos(theta))', [y!]: '(r * sin(theta))' });
  const rDot = `(((r * cos(theta)) * (${fx}) + (r * sin(theta)) * (${fy})) / r)`;
  const thetaDot = `(((r * cos(theta)) * (${fy}) - (r * sin(theta)) * (${fx})) / (r ^ 2))`;
  return {
    isRecommended: false,
    rDotLatex: `\\dot r = ${expressionToDisplay(rDot, ['r', 'theta'])}`,
    thetaDotLatex: `\\dot\\theta = ${expressionToDisplay(thetaDot, ['r', 'theta'])}`,
    rDotExpr: rDot,
    thetaDotExpr: thetaDot,
    radialEquilibriaR: [],
    radialStability: [],
  };
}

function cylindricalSkeleton(rhs: string[], vars: string[]): CylindricalAnalysis {
  const [x, y, z] = vars;
  const map = { [x!]: '(r * cos(theta))', [y!]: '(r * sin(theta))', [z!]: 'z' };
  const f = rhs.map((expr) => substituteExpr(expr, map));
  const rDot = `(((r * cos(theta)) * (${f[0]}) + (r * sin(theta)) * (${f[1]})) / r)`;
  const thetaDot = `(((r * cos(theta)) * (${f[1]}) - (r * sin(theta)) * (${f[0]})) / (r ^ 2))`;
  const zDot = f[2] ?? '0';
  return {
    isRecommended: false,
    rDotLatex: `\\dot r = ${expressionToDisplay(rDot, ['r', 'theta', 'z'])}`,
    thetaDotLatex: `\\dot\\theta = ${expressionToDisplay(thetaDot, ['r', 'theta', 'z'])}`,
    zDotLatex: `\\dot z = ${expressionToDisplay(zDot, ['r', 'theta', 'z'])}`,
    rDotExpr: rDot,
    thetaDotExpr: thetaDot,
    zDotExpr: zDot,
  };
}

function sphericalSkeleton(rhs: string[], vars: string[]): SphericalAnalysis {
  const [x, y, z] = vars;
  const map = {
    [x!]: '(rho * sin(theta) * cos(phi))',
    [y!]: '(rho * sin(theta) * sin(phi))',
    [z!]: '(rho * cos(theta))',
  };
  const f = rhs.map((expr) => substituteExpr(expr, map));
  const rhoDot = `(((rho * sin(theta) * cos(phi)) * (${f[0]}) + (rho * sin(theta) * sin(phi)) * (${f[1]}) + (rho * cos(theta)) * (${f[2]})) / rho)`;
  const thetaDot = `(((cos(theta) * cos(phi)) * (${f[0]}) + (cos(theta) * sin(phi)) * (${f[1]}) + (-sin(theta)) * (${f[2]})) / rho)`;
  const phiDot = `(((-sin(phi)) * (${f[0]}) + (cos(phi)) * (${f[1]})) / (rho * sin(theta)))`;
  return {
    isRecommended: false,
    rhoDotLatex: `\\dot\\rho = ${expressionToDisplay(rhoDot, ['rho', 'theta', 'phi'])}`,
    thetaDotLatex: `\\dot\\theta = ${expressionToDisplay(thetaDot, ['rho', 'theta', 'phi'])}`,
    phiDotLatex: `\\dot\\phi = ${expressionToDisplay(phiDot, ['rho', 'theta', 'phi'])}`,
    rhoDotExpr: rhoDot,
    thetaDotExpr: thetaDot,
    phiDotExpr: phiDot,
  };
}

function atOrigin(eq: EquilibriumAnalysis): boolean {
  return eq.coords.length >= 2 && eq.coords.every((value) => Math.abs(value) < 1e-5);
}

/**
 * Polar is the useful chart when the whole portrait is organized around the
 * origin: a center, a focus, or a limit cycle, and no second equilibrium.
 * A center next to a saddle, or a pendulum already written in (θ, ω), stays
 * in the cartesian picture.
 */
function recommendPolar(
  spec: SystemSpec,
  polar: PolarAnalysis,
  equilibria: EquilibriumAnalysis[],
  limitCycles: LimitCycle[],
): { recommended: boolean; reason?: string } {
  if (spec.dimension !== 2) return { recommended: false };
  const origin = equilibria.find(atOrigin);
  if (!origin || equilibria.some((eq) => !atOrigin(eq))) return { recommended: false };
  const kind = origin.classification2D ?? '';
  const rotating = kind.includes('focus') || kind.includes('center');
  const parameters = Object.fromEntries(Object.entries(spec.parameters).map(([name, item]) => [name, item.value]));
  const radialOnly = angularlyFree(polar.rDotExpr, polar.thetaDotExpr, parameters);
  if (radialOnly && (rotating || limitCycles.length > 0)) {
    return { recommended: true, reason: 'The radial equation is independent of θ.' };
  }
  if (rotating) return { recommended: true, reason: 'The origin is a focus or a center.' };
  if (limitCycles.length > 0) return { recommended: true, reason: 'A limit cycle encloses the origin.' };
  if (radialOnly) return { recommended: true, reason: 'The radial equation is independent of θ.' };
  return { recommended: false };
}

export function radialEquilibria(polar: PolarAnalysis, parameters: Record<string, number>): { radii: number[]; stability: PolarAnalysis['radialStability'] } {
  const radii: number[] = [];
  const probe = (radius: number) => {
    try {
      return Number(evaluateSafe(polar.rDotExpr, { r: radius, theta: 0, ...parameters }));
    } catch {
      return Number.NaN;
    }
  };
  const thetaProbe = (radius: number) => {
    try {
      return Number(evaluateSafe(polar.thetaDotExpr, { r: radius, theta: 0, ...parameters }));
    } catch {
      return Number.NaN;
    }
  };
  const probes: number[] = [];
  const samples = 240;
  const rMax = 6;
  let olderR = 1e-3;
  let older = probe(olderR);
  let middleR = rMax / samples;
  let middle = probe(middleR);
  if (Number.isFinite(older)) probes.push(older);
  if (Number.isFinite(middle)) probes.push(middle);
  for (let i = 2; i <= samples; i += 1) {
    const radius = (rMax * i) / samples;
    const value = probe(radius);
    if (Number.isFinite(value)) probes.push(value);
    if (Number.isFinite(older) && Number.isFinite(middle) && older * middle < 0) radii.push(bisect(probe, olderR, middleR));
    if (Number.isFinite(middle) && Number.isFinite(value) && middle * value < 0) radii.push(bisect(probe, middleR, radius));
    const absMiddle = Math.abs(middle);
    const shoulders = Math.max(Math.abs(older), Math.abs(value));
    if (
      Number.isFinite(middle) &&
      absMiddle <= Math.abs(older) &&
      absMiddle <= Math.abs(value) &&
      absMiddle < 1e-4 &&
      shoulders > 1e-3 &&
      absMiddle < 0.2 * shoulders
    ) {
      radii.push(middleR);
    }
    olderR = middleR;
    older = middle;
    middleR = radius;
    middle = value;
  }
  const finite = probes.filter((value) => Number.isFinite(value));
  const flat = finite.length > 8 && finite.every((value) => Math.abs(value) < 1e-4);
  if (flat) return { radii: [], stability: [] };
  const unique = radii
    .filter((radius) => radius > 0.05 && Number.isFinite(radius))
    .sort((a, b) => a - b)
    .filter((radius, index, all) => index === 0 || radius - (all[index - 1] ?? 0) > 1e-2);
  if (unique.length > 6) return { radii: [], stability: [] };
  const stability = unique.map((radius) => {
    if (Math.abs(thetaProbe(radius)) < 1e-6) return 'unknown' as const;
    const inside = probe(radius * 0.9);
    const outside = probe(radius * 1.1);
    if (inside > 1e-5 && outside < -1e-5) return 'attracting' as const;
    if (inside < -1e-5 && outside > 1e-5) return 'repelling' as const;
    return 'semi_stable' as const;
  });
  return { radii: unique, stability };
}

export function cyclesFromPolar(polar: PolarAnalysis): LimitCycle[] {
  return polar.radialEquilibriaR
    .map((radius, index) => ({ radius, stability: polar.radialStability[index] ?? 'unknown' }))
    .filter((item) => item.stability !== 'unknown')
    .map((item, index) => ({
      id: `lc-${index}`,
      points: circle(item.radius),
      radius: item.radius,
      stability: item.stability === 'attracting' ? 'stable' : item.stability === 'repelling' ? 'unstable' : item.stability,
      formulaLatex: `r = ${latexNumber(item.radius)}`,
    }));
}

function circle(radius: number): number[][] {
  const count = 180;
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

function analyzeLyapunov(spec: SystemSpec, compiled: CompiledSystem, hamiltonian: string | undefined): GlobalPropertiesAnalysis['lyapunov'] {
  const vars = spec.stateVars;
  const values = compiled.parameterValues;
  const rhs = spec.rhsExpressions.map((expr) => substituteNumbers(expr, values));
  const candidates: Array<{ source: 'user' | 'auto_quadratic' | 'auto_hamiltonian'; expr: string }> = [];
  if (spec.userLyapunovExpr) candidates.push({ source: 'user', expr: substituteNumbers(spec.userLyapunovExpr, values) });
  candidates.push({ source: 'auto_quadratic', expr: `(1/2)*(${vars.map((name) => `(${name})^2`).join('+')})` });
  if (hamiltonian) candidates.push({ source: 'auto_hamiltonian', expr: hamiltonian });
  for (const candidate of candidates) {
    const vDot = trySimplify(vars.map((name, index) => `(${differentiate(candidate.expr, name)}) * (${rhs[index] ?? '0'})`).join('+'));
    const vSign = expressionSign(candidate.expr, vars);
    const dSign = expressionSign(vDot, vars);
    if (dSign === 'zero' && (vSign === 'positive' || vSign === 'negative' || candidate.source === 'auto_hamiltonian')) {
      return {
        source: candidate.source === 'user' ? 'user' : 'auto_hamiltonian',
        vLatex: `V = ${expressionToDisplay(candidate.expr, vars)}`,
        vDotLatex: '\\dot V = 0',
        vExpr: candidate.expr,
        vDotExpr: '0',
        classification: 'conserved_first_integral',
        conclusionLatex: 'V is constant along trajectories.',
      };
    }
    const positiveV = vSign === 'positive';
    if (positiveV && (dSign === 'negative' || dSign === 'nonpositive')) {
      const strict = dSign === 'negative';
      return {
        source: candidate.source,
        vLatex: `V = ${expressionToDisplay(candidate.expr, vars)}`,
        vDotLatex: `\\dot V = ${expressionToDisplay(vDot, vars)}`,
        vExpr: candidate.expr,
        vDotExpr: vDot,
        classification: strict ? 'strict_lyapunov' : 'weak_lyapunov_lasalle',
        conclusionLatex: strict
          ? 'V is positive definite and \\(\\dot V\\) is negative definite, so the origin is asymptotically stable.'
          : "V is positive definite and \\(\\dot V\\) is negative semi-definite, so LaSalle's principle applies.",
      };
    }
  }
  return undefined;
}

function theorems(spec: SystemSpec, bundle: GlobalBundle, equilibria: EquilibriumAnalysis[]): ApplicableTheorem[] {
  const items: ApplicableTheorem[] = [];
  if (equilibria.some((eq) => eq.isHyperbolic)) {
    items.push({
      id: 'hartman-grobman',
      name: 'Hartman–Grobman theorem',
      perkoReference: 'Perko §2.8',
      statementLatex: 'A hyperbolic equilibrium is topologically equivalent to its linearization.',
      applicationToSystemLatex: 'At least one equilibrium is hyperbolic, so its local phase portrait matches the linear classification.',
    });
  }
  if (equilibria.some((eq) => eq.classification2D === 'saddle' || eq.classification3D?.startsWith('saddle'))) {
    items.push({
      id: 'stable-manifold',
      name: 'Stable manifold theorem',
      perkoReference: 'Perko §2.7',
      statementLatex: 'A hyperbolic saddle has immersed stable and unstable manifolds tangent to the stable and unstable subspaces.',
      applicationToSystemLatex: 'The computed separatrices are tangent to the real eigendirections of each saddle.',
    });
  }
  if (equilibria.some((eq) => !eq.isHyperbolic)) {
    items.push({
      id: 'center-manifold',
      name: 'Center manifold theorem',
      perkoReference: 'Perko §2.12',
      statementLatex: 'A non-hyperbolic equilibrium has a locally invariant center manifold tangent to the center subspace.',
      applicationToSystemLatex: 'Stability is read from the reduced vector field on that center manifold.',
    });
  }
  if (bundle.global.isHamiltonian) {
    items.push({
      id: 'liouville',
      name: "Liouville's theorem",
      perkoReference: 'Perko §3.1',
      statementLatex: 'A divergence-free flow preserves phase-space volume.',
      applicationToSystemLatex: 'The Hamiltonian is constant on trajectories, so there are no asymptotically stable equilibria or limit cycles.',
    });
  }
  if (bundle.global.bendixsonDulac?.applies) {
    items.push({
      id: 'bendixson-dulac',
      name: 'Bendixson–Dulac criterion',
      perkoReference: 'Perko §3.9',
      statementLatex: 'If a multiplier makes the divergence sign-definite on a simply connected region, that region contains no periodic orbit.',
      applicationToSystemLatex: bundle.global.bendixsonDulac.conclusion,
    });
  }
  if (bundle.global.lyapunov?.classification === 'strict_lyapunov' || bundle.global.lyapunov?.classification === 'weak_lyapunov_lasalle') {
    items.push({
      id: 'lyapunov',
      name: "Lyapunov's stability theorem",
      perkoReference: 'Perko §2.9',
      statementLatex: 'A positive definite function with negative definite orbital derivative proves asymptotic stability.',
      applicationToSystemLatex: bundle.global.lyapunov.conclusionLatex,
    });
  }
  if (equilibria.some((eq) => eq.classification2D === 'nonlinear_center') && (bundle.reversibleFix.xAxis || bundle.reversibleFix.yAxis)) {
    items.push({
      id: 'reversible-center',
      name: 'Time-reversible center theorem',
      perkoReference: 'Perko §2.10',
      statementLatex: 'A linear center on the fixed set of a reversing symmetry is a nonlinear center.',
      applicationToSystemLatex: 'Reversibility upgrades the linear center to a true nonlinear center.',
    });
  }
  if (spec.dimension === 2) {
    items.push({
      id: 'poincare-index',
      name: 'Poincaré index theorem',
      perkoReference: 'Perko §3.12',
      statementLatex: 'The index of a closed curve equals the sum of the indices of the equilibria it encloses.',
      applicationToSystemLatex: 'Each hyperbolic saddle has index −1 and each hyperbolic node or focus has index +1.',
    });
  }
  return items;
}

/**
 * Cartesian symmetry tests are algebraic and can miss a symmetry that is
 * obvious once the field is written in polar coordinates. A closed orbit is
 * not a closed curve in the (r, θ) plane, so Dulac is not repeated there.
 */
function polarSymmetries(polar: PolarAnalysis, parameters: Record<string, number>, vars: string[]): SymmetryInfo[] {
  const [x, y] = vars;
  if (!x || !y) return [];
  const found: SymmetryInfo[] = [];
  if (angularlyFree(polar.rDotExpr, polar.thetaDotExpr, parameters) && angularlyFree(polar.thetaDotExpr, polar.rDotExpr, parameters)) {
    found.push({
      type: 'rotational_SO2',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (-${symbolToLatex(y)}, ${symbolToLatex(x)})`,
      geometricImplication: 'The radial and angular equations ignore θ, so the vector field commutes with rotation.',
    });
  }
  if (symmetricInTheta(polar.rDotExpr, parameters, 'even') && symmetricInTheta(polar.thetaDotExpr, parameters, 'odd')) {
    found.push({
      type: 'y_reflection',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (${symbolToLatex(x)}, -${symbolToLatex(y)})`,
      geometricImplication: 'In polar coordinates ṙ is even in θ and θ̇ is odd, so the portrait is symmetric across the horizontal axis.',
    });
  }
  if (verticalMirror(polar.rDotExpr, polar.thetaDotExpr, parameters)) {
    found.push({
      type: 'x_reflection',
      formulaLatex: `(${symbolToLatex(x)}, ${symbolToLatex(y)}) \\mapsto (-${symbolToLatex(x)}, ${symbolToLatex(y)})`,
      geometricImplication: 'Reflecting θ through the vertical axis preserves ṙ and reverses θ̇, so the portrait is symmetric across that axis.',
    });
  }
  return found;
}

function symmetricInTheta(expr: string, parameters: Record<string, number>, parity: 'even' | 'odd'): boolean {
  for (const radius of [0.35, 1.1, 2.4]) {
    for (const theta of [0.2, 0.9, 1.6, 2.4, -1.2]) {
      const here = evaluateSafe(expr, { r: radius, theta, ...parameters });
      const there = evaluateSafe(expr, { r: radius, theta: -theta, ...parameters });
      const target = parity === 'even' ? there : -there;
      if (!close(here, target)) return false;
    }
  }
  return true;
}

function verticalMirror(radial: string, angular: string, parameters: Record<string, number>): boolean {
  for (const radius of [0.35, 1.1, 2.4]) {
    for (const theta of [0.2, 0.9, 1.6, 2.4, -1.2]) {
      const here = { r: radius, theta, ...parameters };
      const there = { r: radius, theta: Math.PI - theta, ...parameters };
      if (!close(evaluateSafe(radial, here), evaluateSafe(radial, there))) return false;
      if (!close(evaluateSafe(angular, here), -evaluateSafe(angular, there))) return false;
    }
  }
  return true;
}

function close(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-5 * (1 + Math.abs(left));
}

function angularlyFree(expr: string, _other: string, parameters: Record<string, number>): boolean {
  const values: number[] = [];
  for (const theta of [0, 0.7, 1.4, 2.2, 3]) {
    try {
      values.push(Number(evaluateSafe(expr, { r: 0.8, theta, z: 0.3, rho: 1, phi: 0.4, ...parameters })));
    } catch {
      return false;
    }
  }
  if (values.some((value) => !Number.isFinite(value))) return false;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.every((value) => Math.abs(value - mean) < 1e-6 * (1 + Math.abs(mean)));
}

function jacobianMatrixLatex(rhs: string[], vars: string[]): string {
  const rows = rhs.map((expr) => vars.map((variable) => expressionToDisplay(differentiate(expr, variable), vars)));
  return pmatrix(rows);
}

function expressionToDisplay(expr: string, symbols: string[]): string {
  const rough = (value: string) => paintSymbolLatex(value.replace(/\*/g, ' \\cdot ').replace(/\^(\d+)/g, '^{$1}'), symbols);
  if (expr.length > 280) return rough(expr);
  try {
    return paintSymbolLatex(parse(expr).toTex(), symbols);
  } catch {
    return rough(expr);
  }
}

function pmatrix(rows: string[][]): string {
  return `\\begin{pmatrix} ${rows.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;
}

function trigLatex(fn: 'cos' | 'sin', beta: number, time: string): string {
  const symbol = fn === 'cos' ? '\\cos' : '\\sin';
  if (Math.abs(beta - 1) < 1e-8) return `${symbol} ${time}`;
  return `${symbol}(${latexNumber(beta)} ${time})`;
}

function signedTerm(coeff: number, factor: string): string {
  if (Math.abs(coeff) < 1e-8) return '';
  const sign = coeff < 0 ? '-' : '+';
  const mag = latexNumber(Math.abs(coeff));
  const body = mag === '1' ? factor : `${mag}${factor}`;
  return `${sign}${body}`;
}

function bisect(fn: (value: number) => number, left: number, right: number): number {
  let a = left;
  let b = right;
  let fa = fn(a);
  for (let i = 0; i < 40; i += 1) {
    const mid = 0.5 * (a + b);
    const fm = fn(mid);
    if (!Number.isFinite(fm)) return mid;
    if (Math.abs(fm) < 1e-8 || Math.abs(b - a) < 1e-6) return mid;
    if (fa * fm <= 0) b = mid;
    else {
      a = mid;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

function evaluateSafe(expr: string, scope: Record<string, number>): number {
  return Number(compile(expr).evaluate(scope));
}
