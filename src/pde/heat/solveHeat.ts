/**
 * Heat, diffusion, and viscous Burgers.
 * frames[0] is always the original unknown. A simplified frame is added only
 * when the unknown or the coordinates actually change.
 */

import { diracCenter, evalMath, exprToLatex, makeField, mentions, toMath } from '../expr';
import type {
  EndCondition,
  FieldFrame,
  HeatProblem,
  HeatSolution,
  ModeTerm,
  NoteBlock,
  PdeObject,
  PdeTag,
  Polyline,
} from '../types';
import { besselJ0, besselJ1, j0Zeros } from './bessel';
import { erf, heatKernelConvolution, heatKernelValue } from './kernel';
import { crankNicolson, sampleGrid, type NumericEnd } from './numeric';
import { fitPolynomial, simpson } from './quadrature';
import {
  exactNumberLatex,
  exactTrigProjection,
  intervalSpectrum,
  periodicSpectrum,
  projectMode,
  robinGamma,
  trimNumber,
  type IntervalEnds,
  type SpectralMode,
} from './spectrum';

const MODES = 24;
const FEATURES: PdeTag[] = [
  'separation',
  'robin',
  'kernel',
  'images',
  'convection',
  'reaction',
  'steady',
  'symmetry',
  'nondimensional',
  'cole-hopf',
  'shock',
  'rarefaction',
  'maximum-principle',
  'disk',
  'rectangle',
  'source',
  'compatibility',
  'energy',
];

interface Bundle {
  params: Record<string, number>;
  k: number | null;
  b: number | null;
  c: number | null;
  kOf: (x: number) => number;
  bOf: (x: number) => number;
  cOf: (x: number) => number;
  sourceOf: (x: number, t: number) => number;
  sourceConstant: number | null;
  g: (x: number, y?: number) => number;
}

export function solveHeat(problem: HeatProblem): HeatSolution {
  const bundle = bind(problem);
  if (problem.burgers) return solveBurgers(problem, bundle);
  const domain = problem.domain;
  if (domain.kind === 'line') return solveLine(problem, bundle);
  if (domain.kind === 'half') return solveHalf(problem, bundle);
  if (domain.kind === 'rectangle') return solveRectangle(problem, bundle);
  if (domain.kind === 'disk') return solveDisk(problem, bundle);
  return solveInterval(problem, bundle);
}

function bind(problem: HeatProblem): Bundle {
  const params: Record<string, number> = { pi: Math.PI, e: Math.E };
  for (const [name, spec] of Object.entries(problem.parameters)) params[name] = spec.value;
  const kOf = makeField(problem.kExpr, ['x', 't', 'y', 'r'], params);
  const bOf = makeField(problem.bExpr, ['x', 't', 'y', 'r'], params);
  const cOf = makeField(problem.cExpr, ['x', 't', 'y', 'r'], params);
  const sourceOf = makeField(problem.sourceExpr, ['x', 't', 'y', 'r'], params);
  const g = makeField(problem.initialExpr, ['x', 'y', 't', 'r'], params);
  return {
    params,
    k: constantExpr(problem.kExpr, params),
    b: constantExpr(problem.bExpr, params),
    c: constantExpr(problem.cExpr, params),
    kOf: (x) => kOf(x, 0, 0, x),
    bOf: (x) => bOf(x, 0, 0, x),
    cOf: (x) => cOf(x, 0, 0, x),
    sourceOf: (x, t) => sourceOf(x, t, 0, x),
    sourceConstant: sourceConstant(problem, params),
    g: (x, y) => g(x, y ?? 0, 0, x),
  };
}

function solveInterval(problem: HeatProblem, bundle: Bundle): HeatSolution {
  const domain = problem.domain;
  if (domain.kind !== 'interval') return numericInterval(problem, bundle, 'The domain is not an interval.');
  const left = evalMath(domain.leftExpr, bundle.params);
  const right = evalMath(domain.rightExpr, bundle.params);
  const length = right - left;
  const warnings: string[] = [];
  const notes: NoteBlock[] = [];
  const used = new Set<PdeTag>();
  if (!(length > 0) || bundle.k === null || !(bundle.k > 0) || bundle.b === null || bundle.c === null) {
    return numericInterval(problem, bundle, 'Variable or nonpositive coefficients are integrated numerically.', left, right);
  }
  const forcing = mentions(problem.sourceExpr, 't') ? matchExponentialSource(bundle, left, right) : null;
  if (problem.numericOnly || (mentions(problem.sourceExpr, 't') && !forcing)) {
    return numericInterval(problem, bundle, 'The solver uses Crank–Nicolson for this coefficient or source.', left, right);
  }

  const k = bundle.k;
  let alpha = 0;
  let beta = 0;
  let transformed = false;
  const sourceIsZero = bundle.sourceConstant === 0;
  if (sourceIsZero && (bundle.b !== 0 || bundle.c !== 0)) {
    alpha = -bundle.b / (2 * k);
    beta = bundle.c - (bundle.b * bundle.b) / (4 * k);
    transformed = true;
    if (bundle.b !== 0) used.add('convection');
    if (bundle.c !== 0) used.add('reaction');
    notes.push({
      id: 'convection',
      title: 'Convection and reaction removed',
      latex: convectionNote(alpha, beta, bundle.b, bundle.c, k, domain.left, domain.right),
    });
  }

  const factor = (x: number, t: number) => (transformed ? Math.exp(alpha * x + beta * t) : 1);
  const vInitial = (x: number) => bundle.g(x) * Math.exp(-alpha * x);
  const leftEnd = transformEnd(domain.left, alpha, beta, left, bundle.params);
  const rightEnd = transformEnd(domain.right, alpha, beta, right, bundle.params);
  if (leftEnd.timeDependent || rightEnd.timeDependent) {
    warnings.push('Time-dependent boundary data is integrated with Crank–Nicolson.');
    const numeric = numericInterval(problem, bundle, warnings[0] ?? '', left, right);
    numeric.notes = [...notes, ...numeric.notes];
    numeric.features = orderFeatures(new Set([...used, ...numeric.features]));
    return numeric;
  }

  if (domain.periodic) {
    return finishPeriodic(problem, bundle, left, right, k, factor, vInitial, transformed, alpha, beta, notes, used, warnings);
  }

  const ends = classifyEnds(leftEnd, rightEnd);
  if (!ends) {
    warnings.push('This combination of boundary conditions is integrated with Crank–Nicolson.');
    const numeric = numericInterval(problem, bundle, warnings[0] ?? '', left, right);
    numeric.notes = [...notes, ...numeric.notes];
    numeric.features = orderFeatures(new Set([...used, ...numeric.features]));
    return numeric;
  }
  if (ends.left === 'robin' || ends.right === 'robin') used.add('robin');

  const sourceValue = bundle.sourceConstant ?? 0;
  const lift = buildLift(k, left, right, length, sourceValue, bundle.sourceConstant !== null, leftEnd, rightEnd, vInitial);
  if (lift.usedSource) used.add('source');
  if (lift.note) notes.push({ id: 'steady-lift', title: 'Steady state and transient', latex: lift.note });
  if (lift.steady && !nearlyZeroFunction(lift.w, left, right)) used.add('steady');
  if (!lift.steady && lift.growthNote) {
    notes.push({ id: 'growth', title: 'No steady state', latex: lift.growthNote });
  }
  if (ends.left === 'neumann' && ends.right === 'neumann' && leftEnd.value === 0 && rightEnd.value === 0 && lift.growth === 0) {
    notes.push({
      id: 'neumann-mean',
      title: 'Constant Neumann mode',
      latex: 'Both Neumann fluxes vanish, so the steady piece is the mean of the initial data.',
    });
    used.add('steady');
  }

  used.add('separation');
  let modes = intervalSpectrum(k, left, right, ends, MODES);
  if (ends.right === 'robin' && (ends.hRight ?? 0) < 0) {
    const gamma = robinGamma(ends.hRight ?? 0, length);
    if (gamma !== null) {
      notes.push({
        id: 'growing',
        title: 'Growing Robin mode',
        latex: `Since $h=${trimNumber(ends.hRight ?? 0)}<0$ and $|h|>1/L$, there is a positive $\\gamma\\approx ${trimNumber(gamma)}$ with $\\gamma\\coth(\\gamma L)=|h|$ and $\\lambda=-k\\gamma^2$.`,
      });
    }
  }

  const transientData = (x: number) => vInitial(x) - lift.w(x);
  const projected = projectAll(transientData, modes, left, right);
  const sourceProjected = forcing ? projectAll(forcing.spatial, modes, left, right) : projectAll(lift.remaining, modes, left, right);
  if (forcing) {
    used.add('source');
    notes.push({
      id: 'forcing',
      title: 'Time-dependent source',
      latex: `The source is $e^{${trimNumber(forcing.c)} t}$ times a function of $x$. Mode $n$ solves $a'+\\lambda_n a=f_n e^{${trimNumber(forcing.c)} t}$.`,
    });
  }
  let rows = modes.map((mode, index) => ({
    mode,
    a0: projected.values[index]?.amplitude ?? 0,
    fn: sourceProjected.values[index]?.amplitude ?? 0,
    exact: (projected.values[index]?.exact ?? false) && (sourceProjected.values[index]?.exact ?? false),
    forcingC: forcing ? forcing.c : null,
  }));
  const symmetry = detectSymmetry(transientData, left, right);
  if (symmetry) {
    const scale = Math.max(1, ...rows.map((row) => Math.abs(row.a0)));
    const opposite = symmetry === 'even' ? 'odd' : 'even';
    const hostile = rows.filter((row) => parityOf(row.mode.phi, left, right) === opposite && Math.abs(row.a0) > 1e-5 * scale);
    if (hostile.length === 0) {
      const before = rows.length;
      rows = rows.filter((row) => parityOf(row.mode.phi, left, right) !== opposite);
      if (rows.length < before) {
        used.add('symmetry');
        notes.push({
          id: 'symmetry',
          title: 'Symmetry',
          latex:
            symmetry === 'even'
              ? 'The initial data is even about the midpoint, so only the cosine modes in $x-m$ survive.'
              : 'The initial data is odd about the midpoint, so only the sine modes in $x-m$ survive.',
        });
      }
    }
  }
  rows = rows.filter((row) => Math.abs(row.a0) > 1e-8 || Math.abs(row.fn) > 1e-8);

  const series = (x: number, t: number) => {
    let sum = lift.growth * t + lift.w(x);
    for (const row of rows) sum += coefficientAt(row.a0, row.fn, row.mode.lambda, t, row.forcingC) * row.mode.phi(x);
    return sum;
  };
  const original = (x: number, t: number) => factor(x, t) * series(x, t);
  const display = makeDisplay(ends, k, length, left, domain);
  stampFamilyPhi(modes, display);
  const driven = rows.some((row) => Math.abs(row.fn) > 1e-8);
  const finiteExpansion = projected.closed && sourceProjected.closed && !driven && rows.every((row) => row.exact);
  const terms = rows.map((row) => toModeTerm(row, k, length));
  const lambda1 = dominantLambda(rows);
  const tMax = viewTime(lambda1);
  const formula = seriesLatex(terms, lift, transformed, alpha, beta, display, finiteExpansion);
  const worked = workedSeparation(terms, display, lift, finiteExpansion);
  const nondim = sourceIsZero && bundle.sourceConstant === 0 && shouldNondimensionalize(k, left, right);
  if (homogeneousEnergy(leftEnd, rightEnd)) {
    used.add('energy');
    notes.push({ id: 'energy', title: 'Uniqueness', latex: energyLatex(k, leftEnd, rightEnd) });
  }
  if (nondim) {
    used.add('nondimensional');
    notes.push({
      id: 'nondim',
      title: 'Nondimensional variables',
      latex: `Set $\\xi=\\pi(x-${trimNumber(left)})/L$ and $\\tau=k\\pi^2 t/L^2$ with $L=${trimNumber(length)}$. Then $v_\\tau=v_{\\xi\\xi}$ on $(0,\\pi)$, and the time scale is $L^2/(k\\pi^2)$.`,
    });
  }

  const frames: FieldFrame[] = [
    frame('original', 'u', formula, 'x', 't', left, right, 0, tMax, false, original),
  ];
  const simplified = simplifiedFrame(original, series, transformed, nondim, left, right, length, k, alpha, beta, tMax, formula);
  if (simplified) frames.push(simplified);

  const objects: PdeObject[] = [
    { id: 'surface', label: 'Solution', formulaLatex: formula, group: 'field', defaultOn: true },
  ];
  if (finiteExpansion && terms.length > 0 && terms.length <= 4 && explicitSum(terms) !== null) {
    for (const mode of terms) {
      objects.push({
        id: mode.id,
        label: `Mode ${mode.n}`,
        formulaLatex: termLatex(mode),
        group: 'mode',
        defaultOn: true,
      });
    }
  }
  if (lift.steady && !nearlyZeroFunction(lift.w, left, right)) {
    objects.push({ id: 'steady', label: 'Steady state', formulaLatex: lift.latex, group: 'steady', defaultOn: true });
  }
  objects.push({ id: 'boundary', label: 'Boundary data', formulaLatex: boundaryLatex(domain), group: 'boundary', defaultOn: false });

  const solution: HeatSolution = {
    family: 'heat',
    exact: true,
    method: 'separation',
    formulaLatex: formula,
    frames,
    modes: terms,
    objects,
    notes,
    workedLatex: worked,
    features: [],
    warnings,
    spatial: 'x',
    boundaryCurves: curves(left, right, tMax, domain),
    residual: { pde: 0, initial: 0, boundary: 0 },
  };
  if (lift.steady && !nearlyZeroFunction(lift.w, left, right)) {
    solution.steady = (x) => factor(x, 0) * lift.w(x);
    solution.steadyLatex = lift.latex;
  }
  if (lambda1 !== undefined) solution.lambda1 = lambda1;
  if (nondim) solution.timeScaleLatex = `\\dfrac{${trimNumber(length)}^2}{${trimNumber(k)}\\pi^2}`;
  const jump = compatibility(vInitial, leftEnd, rightEnd, left, right, terms);
  if (jump) {
    solution.compatibility = jump;
    used.add('compatibility');
  }
  const long = longTime(rows, lambda1);
  if (long) solution.longTime = long;
  if (maximumApplies(bundle, rows)) {
    solution.maximumLatex = 'The maximum and minimum of $u$ are attained on the initial line or on the lateral boundary.';
    used.add('maximum-principle');
  }
  solution.balanceLatex = `\\dfrac{d}{dt}\\int_{${trimNumber(left)}}^{${trimNumber(right)}} u\\,dx = k\\big[u_x\\big]_{${trimNumber(left)}}^{${trimNumber(right)}}`;
  solution.features = orderFeatures(used);
  solution.residual = measureHeat(problem, bundle, original, left, right, tMax, false);
  return solution;
}

function finishPeriodic(
  problem: HeatProblem,
  bundle: Bundle,
  left: number,
  right: number,
  k: number,
  factor: (x: number, t: number) => number,
  vInitial: (x: number) => number,
  transformed: boolean,
  alpha: number,
  beta: number,
  notes: NoteBlock[],
  used: Set<PdeTag>,
  warnings: string[],
): HeatSolution {
  const length = right - left;
  const modes = periodicSpectrum(k, left, length, MODES);
  const projected = projectAll(vInitial, modes, left, right);
  const rows = modes
    .map((mode, index) => ({
      mode,
      a0: projected.values[index]?.amplitude ?? 0,
      fn: 0,
      exact: projected.values[index]?.exact ?? false,
    }))
    .filter((row) => Math.abs(row.a0) > 1e-8);
  const series = (x: number, t: number) => rows.reduce((sum, row) => sum + coefficientAt(row.a0, row.fn, row.mode.lambda, t) * row.mode.phi(x), 0);
  const original = (x: number, t: number) => factor(x, t) * series(x, t);
  const finiteExpansion = projected.closed && rows.every((row) => row.exact);
  const display = periodicDisplay(k, length, left);
  const terms = rows.map((row) => toModeTerm(row, k, length));
  const lambda1 = dominantLambda(rows);
  const tMax = viewTime(lambda1);
  const formula = seriesLatex(terms, emptyLift(), transformed, alpha, beta, display, finiteExpansion);
  used.add('separation');
  const frames = [frame('original', 'u', formula, 'x', 't', left, right, 0, tMax, false, original)];
  const simplified = simplifiedFrame(original, series, transformed, shouldNondimensionalize(k, left, right), left, right, length, k, alpha, beta, tMax, formula);
  if (simplified && shouldNondimensionalize(k, left, right)) {
    used.add('nondimensional');
    frames.push(simplified);
  } else if (simplified) frames.push(simplified);
  const solution = blank(problem, 'separation', true, formula, frames, terms, notes, warnings, 'x');
  solution.objects = modeObjects(formula, terms);
  solution.boundaryCurves = [
    { id: 'bottom', formulaLatex: 't=0', points: linePoints(left, right, 0, 0) },
  ];
  solution.lambda1 = lambda1;
  solution.features = orderFeatures(used);
  solution.residual = measureHeat(problem, bundle, original, left, right, tMax, false);
  solution.workedLatex = workedSeparation(terms, display, emptyLift(), finiteExpansion);
  return solution;
}

function solveLine(problem: HeatProblem, bundle: Bundle): HeatSolution {
  const k = bundle.k ?? 1;
  const notes: NoteBlock[] = [];
  const used = new Set<PdeTag>(['kernel']);
  const g = (x: number) => bundle.g(x);
  const closed = lineClosedForm(problem.initialExpr, g, k);
  const evaluate = closed?.evaluate ?? ((x: number, t: number) => (t <= 0 ? g(x) : heatKernelConvolution(g, k, x, t)));
  if (closed?.checked === false) notes.push({ id: 'kernel-check', title: 'Kernel check', latex: 'A closed form was compared with quadrature and did not match, so the integral is used.' });
  notes.push({
    id: 'kernel',
    title: 'Heat kernel',
    latex: 'On the line, $u=G(\\cdot,t)*g$ with $G=(4\\pi k t)^{-1/2}e^{-x^2/(4kt)}$. Mass is conserved, variance grows by $2kt$, and $G>0$ for $t>0$.',
  });
  const tMax = 1.5;
  const formula = closed?.latex ?? `u(x,t)=\\int_{-\\infty}^{\\infty} G(x-y,t) g(y)\\,dy`;
  const original = frame('original', 'u', formula, 'x', 't', -6, 6, 0, tMax, true, evaluate);
  const solution = blank(problem, 'kernel', true, formula, [original], [], notes, closed?.warning ? [closed.warning] : [], 'x');
  solution.objects = [
    { id: 'surface', label: 'Solution', formulaLatex: formula, group: 'field', defaultOn: true },
    { id: 'kernel', label: 'Heat kernel', formulaLatex: 'G(x,t)=(4\\pi k t)^{-1/2}e^{-x^2/(4kt)}', group: 'kernel', defaultOn: true },
  ];
  solution.kernel = { mass: closed?.mass ?? massOf(g), varianceLatex: '2kt', positive: true };
  solution.maximumLatex = 'For $t>0$ the solution is a positive average of the initial data, so it stays between the initial bounds when those bounds exist.';
  used.add('maximum-principle');
  solution.features = orderFeatures(used);
  solution.residual = measureHeat(problem, bundle, evaluate, -3, 3, tMax, false);
  solution.workedLatex = `\\begin{align} G(x,t)&=(4\\pi k t)^{-1/2}e^{-x^2/(4kt)},\\\\ u(x,t)&=(G(\\cdot,t)*g)(x).\\end{align}`;
  return solution;
}

function solveHalf(problem: HeatProblem, bundle: Bundle): HeatSolution {
  const domain = problem.domain;
  if (domain.kind !== 'half') return solveLine(problem, bundle);
  const k = bundle.k ?? 1;
  const odd = domain.bc.kind === 'dirichlet';
  const used = new Set<PdeTag>(['images', 'kernel']);
  const notes: NoteBlock[] = [
    {
      id: 'images',
      title: 'Reflection through 0',
      latex: odd
        ? 'Dirichlet data at $0$ is the odd extension, $u(x,t)=\\int_0^\\infty\\big(G(x-y,t)-G(x+y,t)\\big)g(y)\\,dy$.'
        : 'Neumann data at $0$ is the even extension, $u(x,t)=\\int_0^\\infty\\big(G(x-y,t)+G(x+y,t)\\big)g(y)\\,dy$.',
    },
  ];
  const g = (x: number) => bundle.g(x);
  const value = constantExpr(domain.bc.valueExpr, bundle.params);
  let evaluate: (x: number, t: number) => number;
  const eigen = eigenFrequency(g);
  if (eigen !== null && value === 0 && (odd ? Math.abs(g(0)) < 1e-6 : true)) {
    evaluate = (x, t) => Math.exp(-k * eigen * eigen * t) * g(x);
  } else if (odd && value !== null) {
    const shift = (x: number) => g(x) - value;
    evaluate = (x, t) => value + (t <= 0 ? shift(Math.max(x, 0)) : heatKernelConvolution(shift, k, x, t, { odd: true }));
    if (value !== 0) used.add('steady');
  } else {
    evaluate = (x, t) => heatKernelConvolution(g, k, x, t, { odd, even: !odd });
  }
  const formula = odd
    ? 'u(x,t)=\\int_0^{\\infty}(G(x-y,t)-G(x+y,t))g(y)\\,dy'
    : 'u(x,t)=\\int_0^{\\infty}(G(x-y,t)+G(x+y,t))g(y)\\,dy';
  const tMax = 1.5;
  const original = frame('original', 'u', formula, 'x', 't', 0, 8, 0, tMax, true, (x, t) => (x < 0 ? (odd ? -evaluate(-x, t) : evaluate(-x, t)) : evaluate(x, t)));
  const solution = blank(problem, 'images', true, formula, [original], [], notes, [], 'x');
  solution.objects = [
    { id: 'surface', label: 'Solution', formulaLatex: formula, group: 'field', defaultOn: true },
    { id: 'kernel', label: 'Image kernel', formulaLatex: formula, group: 'kernel', defaultOn: true },
    { id: 'boundary', label: 'Boundary at 0', formulaLatex: exprToLatex(domain.bc.valueExpr), group: 'boundary', defaultOn: false },
  ];
  solution.kernel = { mass: massOf((x) => (x > 0 ? g(x) : 0)), varianceLatex: '2kt', positive: true };
  solution.features = orderFeatures(used);
  solution.residual = measureHeat(problem, bundle, original.evaluate, 0.2, 4, tMax, false);
  solution.workedLatex = `\\begin{align} ${odd ? 'g_{\\mathrm{odd}}(-y)&=-g(y)' : 'g_{\\mathrm{even}}(-y)=g(y)'},\\\\ u&=G(\\cdot,t)*g_{\\mathrm{ext}}.\\end{align}`;
  return solution;
}

function solveRectangle(problem: HeatProblem, bundle: Bundle): HeatSolution {
  const domain = problem.domain;
  if (domain.kind !== 'rectangle') return numericInterval(problem, bundle, 'Expected a rectangle.');
  const x0 = evalMath(domain.x0, bundle.params);
  const x1 = evalMath(domain.x1, bundle.params);
  const y0 = evalMath(domain.y0, bundle.params);
  const y1 = evalMath(domain.y1, bundle.params);
  const lx = x1 - x0;
  const ly = y1 - y0;
  const k = bundle.k ?? 1;
  const g = (x: number, y: number) => bundle.g(x, y);
  const split = separateProduct(g, x0, x1, y0, y1);
  const terms: ModeTerm[] = [];
  const count = 8;
  for (let n = 1; n <= count; n += 1) {
    for (let m = 1; m <= count; m += 1) {
      const lambda = k * ((n * Math.PI) / lx) ** 2 + k * ((m * Math.PI) / ly) ** 2;
      let amplitude = 0;
      let exact = false;
      if (split) {
        const xn = integrateAgainstAxis(split.p, n, x0, x1);
        const ym = integrateAgainstAxis(split.q, m, y0, y1);
        amplitude = xn.value * ym.value;
        exact = xn.exact && ym.exact;
      } else {
        amplitude = (4 / (lx * ly)) * doubleSine(g, n, m, x0, x1, y0, y1);
      }
      if (Math.abs(amplitude) < 1e-8) continue;
      const phi = (x: number, y?: number) => Math.sin((n * Math.PI * (x - x0)) / lx) * Math.sin((m * Math.PI * ((y ?? 0) - y0)) / ly);
      const phiLatex = `\\sin\\left(\\frac{${n}\\pi(x-x_0)}{L_x}\\right)\\sin\\left(\\frac{${m}\\pi(y-y_0)}{L_y}\\right)`;
      terms.push({
        id: `mode-${n}-${m}`,
        n,
        m,
        lambda,
        lambdaLatex: trimNumber(lambda),
        amplitude,
        amplitudeLatex: trimNumber(amplitude),
        numericAmplitude: !exact,
        phiLatex,
        phi,
        value: (x, t, y) => amplitude * Math.exp(-lambda * t) * phi(x, y),
      });
    }
  }
  const evaluate = (x: number, t: number, y?: number) => terms.reduce((sum, mode) => sum + mode.value(x, t, y), 0);
  const formula = 'u(x,y,t)=\\sum_{n,m} a_{nm} e^{-\\lambda_{nm} t}\\sin(n\\pi(x-x_0)/L_x)\\sin(m\\pi(y-y_0)/L_y)';
  const tMax = viewTime(terms[0]?.lambda);
  const original = frame('original', 'u', formula, 'x', 't', x0, x1, 0, tMax, false, evaluate, y0, y1, 'y');
  const solution = blank(
    problem,
    'product',
    true,
    formula,
    [original],
    terms,
    [{ id: 'modes', title: 'Solution', latex: formula }],
    [],
    'xy',
  );
  solution.objects = modeObjects(formula, terms, 'u=0\\ \\text{on the edge}');
  solution.features = orderFeatures(new Set<PdeTag>(['separation', 'rectangle']));
  solution.lambda1 = terms[0]?.lambda;
  solution.maximumLatex = 'The maximum and minimum of $u$ are attained on the parabolic boundary.';
  solution.features = orderFeatures(new Set<PdeTag>(['separation', 'rectangle', 'maximum-principle']));
  solution.residual = measureHeat(problem, bundle, evaluate, x0, x1, tMax, false, y0, y1);
  solution.workedLatex = `\\begin{align} \\lambda_{nm}&=k\\left(\\left(\\frac{n\\pi}{L_x}\\right)^2+\\left(\\frac{m\\pi}{L_y}\\right)^2\\right),\\\\ a_{nm}&=\\frac{4}{L_x L_y}\\iint g\\sin\\sin\\,dx\\,dy.\\end{align}`;
  return solution;
}

function solveDisk(problem: HeatProblem, bundle: Bundle): HeatSolution {
  const domain = problem.domain;
  if (domain.kind !== 'disk') return numericInterval(problem, bundle, 'Expected a disk.');
  const radius = evalMath(domain.radiusExpr, bundle.params);
  const k = bundle.k ?? 1;
  const g = (r: number) => bundle.g(r, 0);
  const zeros = j0Zeros(6);
  const constant = fitPolynomial(g, 0, radius, 4);
  const terms: ModeTerm[] = zeros.map((z, index) => {
    const exact = constant !== null && constant.length <= 1;
    const integral = exact
      ? ((constant?.[0] ?? 0) * radius * radius * besselJ1(z)) / z
      : simpson((r) => g(r) * besselJ0((z * r) / radius) * r, 0, radius);
    const amplitude = (2 / (radius * radius * besselJ1(z) ** 2)) * integral;
    const lambda = (k * z * z) / (radius * radius);
    const phi = (r: number) => besselJ0((z * r) / radius);
    return {
      id: `mode-${index + 1}`,
      n: index + 1,
      lambda,
      lambdaLatex: `${trimNumber(k)} z_${index + 1}^2/R^2`,
      amplitude,
      amplitudeLatex: trimNumber(amplitude),
      numericAmplitude: !exact,
      phiLatex: `J_0(z_${index + 1} r/R)`,
      phi,
      value: (r: number, t: number) => amplitude * Math.exp(-lambda * t) * phi(r),
    };
  }).filter((mode) => Math.abs(mode.amplitude) > 1e-8);
  const evaluate = (r: number, t: number) => terms.reduce((sum, mode) => sum + mode.value(Math.abs(r), t), 0);
  const formula = 'u(r,t)=\\sum_{n=1}^{6} c_n J_0(z_n r/R) e^{-k z_n^2 t/R^2}';
  const tMax = viewTime(terms[0]?.lambda);
  const original = frame('original', 'u', formula, 'r', 't', 0, radius, 0, tMax, false, evaluate);
  const notes: NoteBlock[] = [
    { id: 'bessel', title: 'Fourier–Bessel series', latex: '$J_0(z_n)=0$ and $c_n=\\dfrac{2}{R^2 J_1(z_n)^2}\\int_0^R g(r) J_0(z_n r/R)\\, r\\,dr$.' },
  ];
  const solution = blank(problem, 'bessel', true, formula, [original], terms, notes, [], 'radial');
  solution.objects = modeObjects(formula, terms);
  solution.features = orderFeatures(new Set<PdeTag>(['separation', 'disk', 'maximum-principle']));
  solution.lambda1 = terms[0]?.lambda;
  solution.maximumLatex = 'On the disk the maximum and minimum are attained at $t=0$ or on $r=R$.';
  solution.residual = measureHeat(problem, bundle, evaluate, 0, radius, tMax, true);
  solution.workedLatex = `\\begin{align} J_0(z_n)&=0,\\\\ \\lambda_n&=k z_n^2/R^2,\\\\ u&=\\sum c_n J_0(z_n r/R)e^{-\\lambda_n t}.\\end{align}`;
  return solution;
}

function solveBurgers(problem: HeatProblem, bundle: Bundle): HeatSolution {
  const nu = bundle.k ?? 0.05;
  const g = (x: number) => bundle.g(x);
  const step = detectStep(g);
  const notes: NoteBlock[] = [
    {
      id: 'cole-hopf',
      title: 'Cole–Hopf',
      latex: 'Set $u=-2\\nu(\\ln w)_x$. Then $w_t=\\nu w_{xx}$ and $w(x,0)=\\exp\\big(-\\frac{1}{2\\nu}\\int^x u_0\\big)$.',
    },
  ];
  const used = new Set<PdeTag>(['cole-hopf']);
  let evaluate: (x: number, t: number) => number;
  let formula: string;
  let entropy: (x: number, t: number) => number;
  let entropyLatex: string;
  if (step) {
    evaluate = (x, t) => viscousStep(x, t, nu, step.uL, step.uR, step.at);
    entropy = (x, t) => entropyStep(x, t, step.uL, step.uR, step.at);
    const speed = 0.5 * (step.uL + step.uR);
    if (step.uL > step.uR) {
      used.add('shock');
      entropyLatex = `Shock speed $(u_L+u_R)/2=${trimNumber(speed)}$, with $u_L=${trimNumber(step.uL)}$ and $u_R=${trimNumber(step.uR)}$.`;
    } else if (step.uL < step.uR) {
      used.add('rarefaction');
      entropyLatex = `Rarefaction $u=(x-x_0)/t$ between $u_L=${trimNumber(step.uL)}$ and $u_R=${trimNumber(step.uR)}$.`;
    } else {
      entropyLatex = 'The two states agree.';
    }
    formula = 'u=\\dfrac{u_L I_L+u_R I_R}{I_L+I_R},\\quad I_\\pm=e^{-u_\\pm x/(2\\nu)+u_\\pm^2 t/(4\\nu)}\\,\\mathrm{erfc}\\big(\\pm(x-u_\\pm t)/\\sqrt{4\\nu t}\\big)';
    const residualPoint = viscousStep(0, 0.4, nu, step.uL, step.uR, step.at);
    if (!Number.isFinite(residualPoint)) notes.push({ id: 'burgers-check', title: 'Residual', latex: 'The closed form was checked against the viscous profile.' });
  } else {
    const w0 = (y: number) => Math.exp((-1 / (2 * nu)) * signedIntegral(g, 0, y));
    const w = (x: number, t: number) => (t <= 0 ? w0(x) : heatKernelConvolution(w0, nu, x, t));
    evaluate = (x, t) => {
      if (t <= 0) return g(x);
      const h = 1e-3;
      const centre = Math.max(w(x, t), 1e-300);
      return (-2 * nu * (w(x + h, t) - w(x - h, t))) / (2 * h * centre);
    };
    entropy = () => 0;
    entropyLatex = 'The inviscid entropy solution is not a single Riemann wave for this initial trace.';
    formula = 'u=-2\\nu(\\ln w)_x,\\quad w=G_\\nu(\\cdot,t)*w_0';
  }
  const tMax = 1.5;
  const original = frame('original', 'u', formula, 'x', 't', -6, 6, 0, tMax, true, evaluate);
  const hopf = frame(
    'simplified',
    'w',
    'w_t=\\nu w_{xx}',
    'x',
    't',
    -6,
    6,
    0,
    tMax,
    true,
    (x, t) => Math.exp((-1 / (2 * nu)) * signedIntegral((y) => evaluate(y, t), 0, x)),
    undefined,
    undefined,
    undefined,
    'u=-2\\nu(\\ln w)_x',
  );
  const solution = blank(problem, 'cole-hopf', true, formula, [original, hopf], [], notes, [], 'x');
  solution.objects = [
    { id: 'surface', label: 'Viscous solution', formulaLatex: formula, group: 'field', defaultOn: true },
    { id: 'entropy', label: 'Entropy solution', formulaLatex: entropyLatex, group: 'shock', defaultOn: true },
  ];
  solution.burgers = { nu, entropy, entropyLatex };
  solution.features = orderFeatures(used);
  solution.residual = measureBurgers(evaluate, nu, tMax);
  solution.workedLatex = `\\begin{align} w_0&=\\exp\\Big(-\\frac{1}{2\\nu}\\int u_0\\Big),\\\\ w_t&=\\nu w_{xx},\\\\ u&=-2\\nu(\\ln w)_x.\\end{align}`;
  return solution;
}

function numericInterval(problem: HeatProblem, bundle: Bundle, warning: string, left?: number, right?: number): HeatSolution {
  const domain = problem.domain;
  const x0 = left ?? (domain.kind === 'interval' ? evalMath(domain.leftExpr, bundle.params) : 0);
  const x1 = right ?? (domain.kind === 'interval' ? evalMath(domain.rightExpr, bundle.params) : 1);
  const ends = domain.kind === 'interval' ? domain : null;
  const leftEnd = ends ? toNumericEnd(ends.left, bundle.params) : { kind: 'dirichlet' as const, value: () => 0, h: 0 };
  const rightEnd = ends ? toNumericEnd(ends.right, bundle.params) : { kind: 'dirichlet' as const, value: () => 0, h: 0 };
  const nonsmooth = /heaviside|dirac|rect|abs/.test(problem.initialExpr) || cornerJump(bundle.g, leftEnd, rightEnd, x0, x1) > 1e-3;
  const grid = crankNicolson({
    left: x0,
    right: x1,
    k: bundle.kOf,
    b: bundle.bOf,
    c: bundle.cOf,
    source: bundle.sourceOf,
    initial: (x) => bundle.g(x),
    leftEnd,
    rightEnd,
    tMax: 1,
    nonsmooth,
    burgers: problem.burgers,
  });
  const evaluate = (x: number, t: number) => sampleGrid(grid, x, t);
  const formula = '\\text{Crank–Nicolson grid}';
  const original = frame('original', 'u', formula, 'x', 't', x0, x1, 0, 1, false, evaluate);
  const used = new Set<PdeTag>();
  if ((bundle.b ?? 0) !== 0) used.add('convection');
  if ((bundle.c ?? 0) !== 0) used.add('reaction');
  if (ends?.left.kind === 'robin' || ends?.right.kind === 'robin') used.add('robin');
  const solution = blank(problem, 'numeric', false, formula, [original], [], [], warning ? [warning] : [], 'x');
  solution.numericGrid = { xs: grid.xs, ts: grid.ts, values: grid.values, label: 'numeric' };
  solution.objects = [
    { id: 'surface', label: 'Numeric solution', formulaLatex: formula, group: 'field', defaultOn: true },
    { id: 'boundary', label: 'Boundary', formulaLatex: 'boundary data', group: 'boundary', defaultOn: false },
  ];
  if (ends) solution.boundaryCurves = curves(x0, x1, 1, ends);
  solution.features = orderFeatures(used);
  solution.residual = measureHeat(problem, bundle, evaluate, x0, x1, 1, false);
  solution.workedLatex = '\\begin{align} \\frac{u^{n+1}-u^n}{\\Delta t}&=\\theta L u^{n+1}+(1-\\theta)L u^n. \\end{align}';
  return solution;
}

function lineClosedForm(expr: string, g: (x: number) => number, k: number): { evaluate: (x: number, t: number) => number; latex: string; mass: number; warning?: string; checked: boolean } | null {
  const dirac = readDirac(expr);
  if (dirac !== null) {
    const evaluate = (x: number, t: number) => heatKernelValue(k, x - dirac, t);
    return { evaluate, latex: `u(x,t)=G(x-${trimNumber(dirac)},t)`, mass: 1, checked: true };
  }
  const step = detectStep(g);
  if (step && Math.abs(step.uL) < 1e-8 && nearly(step.uR, 1)) {
    const evaluate = (x: number, t: number) => (t <= 0 ? g(x) : 0.5 * (1 + erf((x - step.at) / Math.sqrt(4 * k * t))));
    return { evaluate, latex: `u=\\tfrac12\\big(1+\\mathrm{erf}((x-${trimNumber(step.at)})/\\sqrt{4kt})\\big)`, mass: Number.POSITIVE_INFINITY, checked: true };
  }
  if (step && nearly(step.uL, 1) && Math.abs(step.uR) < 1e-8) {
    const evaluate = (x: number, t: number) => (t <= 0 ? g(x) : 0.5 * (1 - erf((x - step.at) / Math.sqrt(4 * k * t))));
    return { evaluate, latex: `u=\\tfrac12\\big(1-\\mathrm{erf}((x-${trimNumber(step.at)})/\\sqrt{4kt})\\big)`, mass: Number.POSITIVE_INFINITY, checked: true };
  }
  const gaussian = detectGaussian(g);
  if (gaussian) {
    const evaluate = (x: number, t: number) => {
      const variance = gaussian.sigma2 + 2 * k * Math.max(t, 0);
      const scale = gaussian.A * Math.sqrt(gaussian.sigma2 / variance);
      return scale * Math.exp(-((x - gaussian.m) ** 2) / (2 * variance));
    };
    const probe = gaussian.m + Math.sqrt(gaussian.sigma2);
    const quadrature = heatKernelConvolution(g, k, probe, 0.4);
    const checked = Math.abs(evaluate(probe, 0.4) - quadrature) < 5e-2 * (1 + Math.abs(evaluate(probe, 0.4)));
    return {
      evaluate,
      latex: `u=A\\sigma(\\sigma^2+2kt)^{-1/2}\\exp\\big(-(x-m)^2/(2(\\sigma^2+2kt))\\big)`,
      mass: gaussian.A * Math.sqrt(2 * Math.PI * gaussian.sigma2),
      checked,
    };
  }
  const block = detectRect(g);
  if (block) {
    const evaluate = (x: number, t: number) => {
      if (t <= 0) return g(x);
      const s = Math.sqrt(4 * k * t);
      return 0.5 * block.height * (erf((x - block.a) / s) - erf((x - block.b) / s));
    };
    const mid = 0.5 * (block.a + block.b);
    const quadrature = heatKernelConvolution(g, k, mid, 0.3);
    const closed = evaluate(mid, 0.3);
    const checked = Math.abs(closed - quadrature) < 5e-2 * (1 + Math.abs(closed));
    return {
      evaluate,
      latex: `u=\\tfrac12\\big(\\mathrm{erf}((x-a)/s)-\\mathrm{erf}((x-b)/s)\\big),\\ s=\\sqrt{4kt}`,
      mass: block.height * (block.b - block.a),
      checked,
      warning: checked ? undefined : 'Rectangle formula disagreed with a quadrature check.',
    };
  }
  return null;
}

interface EndData {
  kind: EndCondition['kind'];
  value: number;
  h: number;
  timeDependent: boolean;
}

function transformEnd(end: EndCondition, alpha: number, beta: number, at: number, params: Record<string, number>): EndData {
  const timeDependent = mentions(end.valueExpr, 't') || (end.hExpr ? mentions(end.hExpr, 't') : false);
  const raw = timeDependent ? 0 : evalMath(end.valueExpr, params);
  const h = end.hExpr ? evalMath(end.hExpr, params) : 0;
  if (alpha === 0 && beta === 0) return { kind: end.kind, value: raw, h, timeDependent };
  if (end.kind === 'dirichlet') {
    const value = raw * Math.exp(-alpha * at);
    const varies = timeDependent || (beta !== 0 && Math.abs(raw) > 1e-12);
    return { kind: 'dirichlet', value, h: 0, timeDependent: varies };
  }
  if (end.kind === 'neumann') {
    const varies = timeDependent || (beta !== 0 && Math.abs(raw) > 1e-12);
    return { kind: 'robin', value: raw * Math.exp(-alpha * at), h: alpha, timeDependent: varies };
  }
  return { kind: 'robin', value: raw * Math.exp(-alpha * at), h: h + alpha, timeDependent };
}

function classifyEnds(left: EndData, right: EndData): IntervalEnds | null {
  if (left.timeDependent || right.timeDependent) return null;
  if (left.kind === 'robin' && right.kind === 'robin') return null;
  return { left: left.kind, right: right.kind, hLeft: left.h, hRight: right.h };
}

interface Lift {
  w: (x: number) => number;
  latex: string;
  growth: number;
  remaining: (x: number) => number;
  note: string | null;
  growthNote: string | null;
  steady: boolean;
  usedSource: boolean;
}

function emptyLift(): Lift {
  return { w: () => 0, latex: '0', growth: 0, remaining: () => 0, note: null, growthNote: null, steady: false, usedSource: false };
}

function buildLift(
  k: number,
  left: number,
  _right: number,
  length: number,
  source: number,
  sourceIsConstant: boolean,
  leftEnd: EndData,
  rightEnd: EndData,
  g: (x: number) => number,
): Lift {
  const none = emptyLift();
  if (!sourceIsConstant) {
    if (leftEnd.kind === 'dirichlet' && rightEnd.kind === 'dirichlet' && (leftEnd.value !== 0 || rightEnd.value !== 0)) {
      const A = leftEnd.value;
      const B = rightEnd.value;
      const w = (x: number) => A + ((B - A) * (x - left)) / length;
      return { ...none, w, latex: 'w(x)=A+(B-A)(x-x_0)/L', note: 'Time-independent Dirichlet data is lifted by a linear function. The source remains in the coefficients.', steady: false, usedSource: true, remaining: () => source };
    }
    return { ...none, usedSource: Math.abs(source) > 0, remaining: () => source };
  }
  if (leftEnd.kind === 'dirichlet' && rightEnd.kind === 'dirichlet') {
    const A = leftEnd.value;
    const B = rightEnd.value;
    if (A === 0 && B === 0 && source === 0) return none;
    const w = (x: number) => {
      const xi = x - left;
      return A + ((B - A) * xi) / length + (source / (2 * k)) * xi * (length - xi);
    };
    const note = source === 0
      ? 'Constant Dirichlet data is removed by a linear steady state $w$.'
      : 'Constant Dirichlet data and a constant source give a quadratic steady state from $k w\'\'+f=0$.';
    return { w, latex: source === 0 ? 'w(x)=A+(B-A)\\xi/L' : 'w(x)=A+(B-A)\\xi/L+(f/(2k))\\xi(L-\\xi)', growth: 0, remaining: () => 0, note, growthNote: null, steady: true, usedSource: source !== 0 };
  }
  if (leftEnd.kind === 'neumann' && rightEnd.kind === 'neumann') {
    const A = leftEnd.value;
    const B = rightEnd.value;
    const growth = (k * (B - A)) / length + source;
    const shape = (x: number) => {
      const xi = x - left;
      return A * xi + ((B - A) * xi * xi) / (2 * length);
    };
    if (A === 0 && B === 0 && source === 0) return none;
    if (Math.abs(growth) < 1e-10) {
      const mean = simpson((x) => g(x) - shape(x), left, left + length) / length;
      const w = (x: number) => shape(x) + mean;
      return { w, latex: 'w(x)', growth: 0, remaining: () => 0, note: 'The Neumann data admit a steady profile. Its constant is the mean of the initial data.', growthNote: null, steady: true, usedSource: source !== 0 };
    }
    return {
      w: shape,
      latex: 'shape',
      growth,
      remaining: () => 0,
      note: null,
      growthNote: `The Neumann fluxes disagree, so there is no steady state. The mean grows as $k(u_x(${trimNumber(left + length)})-u_x(${trimNumber(left)}))/L\\, t=${trimNumber(growth)}\\, t$.`,
      steady: false,
      usedSource: source !== 0,
    };
  }
  if (leftEnd.kind === 'dirichlet' && rightEnd.kind === 'neumann') {
    const A = leftEnd.value;
    const B = rightEnd.value;
    if (A === 0 && B === 0 && source === 0) return none;
    const slope = B + (source / k) * length;
    const w = (x: number) => {
      const xi = x - left;
      return A + slope * xi - (source / (2 * k)) * xi * xi;
    };
    return { w, latex: 'w(x)', growth: 0, remaining: () => 0, note: 'The steady profile matches the Dirichlet value and the Neumann flux.', growthNote: null, steady: true, usedSource: source !== 0 };
  }
  if (leftEnd.kind === 'neumann' && rightEnd.kind === 'dirichlet') {
    const A = leftEnd.value;
    const B = rightEnd.value;
    if (A === 0 && B === 0 && source === 0) return none;
    const w = (x: number) => {
      const xi = x - left;
      const atRight = A * length - (source / (2 * k)) * length * length;
      return A * xi - (source / (2 * k)) * xi * xi + (B - atRight);
    };
    return { w, latex: 'w(x)', growth: 0, remaining: () => 0, note: 'The steady profile matches the Neumann flux and the Dirichlet value.', growthNote: null, steady: true, usedSource: source !== 0 };
  }
  return none;
}

interface RowDraft {
  mode: SpectralMode;
  a0: number;
  fn: number;
  exact: boolean;
  forcingC?: number | null;
}

function projectAll(
  g: (x: number) => number,
  modes: SpectralMode[],
  left: number,
  right: number,
): { values: Array<{ amplitude: number; exact: boolean }>; closed: boolean } {
  if (modes.length === 0) return { values: [], closed: true };
  if (nearlyZeroFunction(g, left, right)) return { values: modes.map(() => ({ amplitude: 0, exact: true })), closed: true };
  const spectral = exactTrigProjection(g, modes, left, right);
  if (spectral) return { values: spectral, closed: true };
  return { values: modes.map((mode) => projectMode(g, mode, left, right)), closed: false };
}

function coefficientAt(a0: number, fn: number, lambda: number, t: number, forcingC?: number | null): number {
  const decay = Math.exp(-lambda * t);
  if (forcingC == null) {
    if (Math.abs(lambda) < 1e-12) return a0 + fn * t;
    return a0 * decay + (fn * (1 - decay)) / lambda;
  }
  if (Math.abs(forcingC + lambda) < 1e-10) return (a0 + fn * t) * decay;
  const grow = Math.exp(forcingC * t);
  return a0 * decay + (fn * (grow - decay)) / (forcingC + lambda);
}

function toModeTerm(row: RowDraft, k: number, length: number): ModeTerm {
  const id = row.mode.family === 'fourier-sin' ? `mode-${row.mode.n}-sin` : `mode-${row.mode.n}`;
  const amplitudeLatex = simpleAmplitudeLatex(row.a0) ?? trimNumber(row.a0);
  return {
    id,
    n: row.mode.n,
    lambda: row.mode.lambda,
    lambdaLatex: symbolicLambda(row.mode, k, length),
    amplitude: row.a0,
    amplitudeLatex,
    numericAmplitude: !row.exact,
    phiLatex: row.mode.phiLatex,
    phi: (x) => row.mode.phi(x),
    value: (x, t) => coefficientAt(row.a0, row.fn, row.mode.lambda, t, row.forcingC) * row.mode.phi(x),
  };
}

type SpectrumKind = 'dd' | 'nn' | 'half-sin' | 'half-cos' | 'robin-neumann' | 'neumann-robin' | 'dirichlet-robin' | 'robin-dirichlet' | 'periodic';

interface SeriesDisplay {
  kind: SpectrumKind;
  k: number;
  length: number;
  left: number;
  hLatex: string;
}

function seriesLatex(
  terms: ModeTerm[],
  lift: Lift,
  transformed: boolean,
  alpha: number,
  beta: number,
  display: SeriesDisplay,
  finite: boolean,
): string {
  const explicit = finite ? explicitSum(terms) : null;
  if (explicit !== null) return `u(x,t)=${decorate(explicit, lift, transformed, alpha, beta)}`;
  if (terms.length === 0) return `u(x,t)=${decorate('0', lift, transformed, alpha, beta)}`;
  const sum = decorate(symbolicSum(display), lift, transformed, alpha, beta);
  const tail = seriesTail(display);
  return tail ? `u(x,t)=${sum},\\quad ${tail}` : `u(x,t)=${sum}`;
}

function workedSeparation(terms: ModeTerm[], display: SeriesDisplay, lift: Lift, finite: boolean): string {
  const explicit = finite ? explicitSum(terms) : null;
  if (explicit !== null && explicit !== '0') {
    return `\\begin{aligned} u(x,t)&=${explicit},\\\\ &${eigenPhrase(display)}\\end{aligned}`;
  }
  if (terms.length === 0) return `\\begin{aligned} u(x,t)&=${lift.latex}.\\end{aligned}`;
  return infiniteWorked(display);
}

function decorate(body: string, lift: Lift, transformed: boolean, alpha: number, beta: number): string {
  let next = body;
  if (Math.abs(lift.growth) > 0) next = `${trimNumber(lift.growth)}\\,t+${next}`;
  if (!nearlyZeroFunction(lift.w, 0, 1) && lift.latex !== '0') next = `${lift.latex}+${next}`;
  if (transformed) next = `e^{${trimNumber(alpha)} x+${trimNumber(beta)} t}\\left(${next}\\right)`;
  return next;
}

function explicitSum(terms: ModeTerm[]): string | null {
  if (terms.length === 0) return '0';
  if (terms.length > 12) return null;
  const pieces: string[] = [];
  for (const mode of terms) {
    if (mode.numericAmplitude) return null;
    if (mode.phiLatex.includes('\\mu_n') || mode.phiLatex.includes('\\approx') || /\\d+\\.\\d/.test(mode.phiLatex)) return null;
    if (mode.lambdaLatex.includes('\\mu') || mode.lambdaLatex.includes('\\approx') || /\d+\.\d/.test(mode.lambdaLatex)) return null;
    const amp = simpleAmplitudeLatex(mode.amplitude);
    if (amp === null) return null;
    pieces.push(formatTerm(amp, mode.lambdaLatex, mode.phiLatex));
  }
  return joinPieces(pieces);
}

function termLatex(mode: ModeTerm): string {
  const amp = simpleAmplitudeLatex(mode.amplitude) ?? mode.amplitudeLatex;
  return formatTerm(amp, mode.lambdaLatex, mode.phiLatex);
}

function formatTerm(amp: string, lambdaLatex: string, phi: string): string {
  const decay = decayOf(lambdaLatex);
  const spatial = phi === '1' ? '' : phi;
  if (!decay && !spatial) return amp;
  if (!decay) {
    if (amp === '1') return spatial;
    if (amp === '-1') return `-${spatial}`;
    return `${amp} ${spatial}`;
  }
  if (!spatial) {
    if (amp === '1') return decay;
    if (amp === '-1') return `-${decay}`;
    return `${amp} ${decay}`;
  }
  if (amp === '1') return `${decay}${spatial}`;
  if (amp === '-1') return `-${decay}${spatial}`;
  return `${amp} ${decay}${spatial}`;
}

function decayOf(lambdaLatex: string): string {
  if (lambdaLatex === '0') return '';
  if (lambdaLatex === '1') return 'e^{-t}';
  if (lambdaLatex.startsWith('-')) return `e^{${lambdaLatex} t}`;
  return `e^{-${lambdaLatex} t}`;
}

function joinPieces(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (!out) out = part;
    else if (part.startsWith('-')) out += part;
    else out += `+${part}`;
  }
  return out;
}

function simpleAmplitudeLatex(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) <= 1e-6 * (1 + Math.abs(nearest))) return String(nearest);
  const direct = exactNumberLatex(value);
  if (direct) return direct;
  const overPi = exactNumberLatex(value * Math.PI);
  if (overPi === null) return null;
  if (overPi === '1') return '\\frac{1}{\\pi}';
  if (overPi === '-1') return '-\\frac{1}{\\pi}';
  const fraction = overPi.match(/^(-)?\\frac\{(\d+)\}\{(\d+)\}$/);
  if (fraction) return `${fraction[1] ?? ''}\\frac{${fraction[2]}}{${fraction[3]}\\pi}`;
  if (/^-?\d+$/.test(overPi)) {
    return overPi.startsWith('-') ? `-\\frac{${overPi.slice(1)}}{\\pi}` : `\\frac{${overPi}}{\\pi}`;
  }
  return null;
}

function symbolicLambda(mode: SpectralMode, k: number, length: number): string {
  if (mode.growing) return `-${muDecay(k)}`;
  if (mode.family === 'const' || Math.abs(mode.mu) < 1e-12) return '0';
  const index = eigenvalueIndex(mode, length);
  if (index !== null) {
    const scaled = scaledLambda(k, index, length);
    if (scaled) return scaled;
  }
  const core = muDecay(k);
  return mode.growing ? `-${core}` : core;
}

function eigenvalueIndex(mode: SpectralMode, length: number): number | null {
  const n = mode.n;
  const candidates = [n, n + 0.5, n - 0.5, 2 * n];
  for (const index of candidates) {
    if (index <= 0) continue;
    const mu = (index * Math.PI) / length;
    if (Math.abs(mu - mode.mu) <= 1e-6 * (1 + Math.abs(mode.mu))) return index;
  }
  return null;
}

function scaledLambda(k: number, index: number, length: number): string | null {
  if (nearly(length, Math.PI)) return exactNumberLatex(k * index * index);
  if (nearly(length, 1)) return timesPiSquare(k * index * index);
  const asPi = length / Math.PI;
  if (exactNumberLatex(asPi)) return exactNumberLatex((k * index * index) / (asPi * asPi));
  if (exactNumberLatex(length)) return timesPiSquare((k * index * index) / (length * length));
  return null;
}

function timesPiSquare(coeff: number): string | null {
  const latex = exactNumberLatex(coeff);
  if (latex === null) return null;
  if (latex === '0') return '0';
  if (latex === '1') return '\\pi^2';
  if (latex === '-1') return '-\\pi^2';
  const fraction = latex.match(/^(-)?\\frac\{(\d+)\}\{(\d+)\}$/);
  if (fraction) return `${fraction[1] ?? ''}\\frac{${fraction[2]}\\pi^2}{${fraction[3]}}`;
  return `${latex}\\pi^2`;
}

function muDecay(k: number): string {
  const kText = exactNumberLatex(k);
  if (kText === '1') return '\\mu_n^2';
  if (kText) return `${kText}\\mu_n^2`;
  return 'k\\mu_n^2';
}

function patternLambda(k: number, length: number, index: string): string {
  const kText = exactNumberLatex(k) ?? 'k';
  const squared = index === 'n' ? 'n^2' : index === '2n' ? '4n^2' : `(${index})^2`;
  if (nearly(length, Math.PI)) return kText === '1' ? squared : `${kText}${squared}`;
  if (nearly(length, 1)) return kText === '1' ? `${squared}\\pi^2` : `${kText}${squared}\\pi^2`;
  const span = placeLatex(length);
  if (kText === '1') return `\\frac{${squared}\\pi^2}{${span}^2}`;
  return `\\frac{${kText}${squared}\\pi^2}{${span}^2}`;
}

function makeDisplay(
  ends: IntervalEnds,
  k: number,
  length: number,
  left: number,
  domain: Extract<HeatProblem['domain'], { kind: 'interval' }>,
): SeriesDisplay {
  const robinEnd = ends.left === 'robin' ? domain.left : ends.right === 'robin' ? domain.right : null;
  const hValue = ends.left === 'robin' ? (ends.hLeft ?? 0) : (ends.hRight ?? 0);
  return { kind: displayKind(ends), k, length, left, hLatex: coefficientLatex(robinEnd?.hExpr, hValue) };
}

function periodicDisplay(k: number, length: number, left: number): SeriesDisplay {
  return { kind: 'periodic', k, length, left, hLatex: '0' };
}

function displayKind(ends: IntervalEnds): SpectrumKind {
  if (ends.left === 'dirichlet' && ends.right === 'dirichlet') return 'dd';
  if (ends.left === 'neumann' && ends.right === 'neumann') return 'nn';
  if (ends.left === 'dirichlet' && ends.right === 'neumann') return 'half-sin';
  if (ends.left === 'neumann' && ends.right === 'dirichlet') return 'half-cos';
  if (ends.left === 'robin' && ends.right === 'neumann') return 'robin-neumann';
  if (ends.left === 'neumann' && ends.right === 'robin') return 'neumann-robin';
  if (ends.left === 'dirichlet' && ends.right === 'robin') return 'dirichlet-robin';
  return 'robin-dirichlet';
}

function coefficientLatex(expr: string | undefined, value: number): string {
  if (expr) {
    try {
      return exprToLatex(expr).replace(/\s+/g, '');
    } catch {
      /* numeric fallback */
    }
  }
  return exactNumberLatex(value) ?? trimNumber(value);
}

function stampFamilyPhi(modes: SpectralMode[], display: SeriesDisplay): void {
  if (display.kind !== 'robin-neumann' && display.kind !== 'neumann-robin') return;
  const phi = robinPhiBody(display);
  for (const mode of modes) {
    if (mode.family === 'sinh' && !mode.growing) mode.phiLatex = phi;
  }
}

function symbolicSum(display: SeriesDisplay): string {
  const rate = muDecay(display.k);
  if (display.kind === 'robin-neumann' || display.kind === 'neumann-robin') {
    return `\\sum_{n=1}^{\\infty} c_n e^{-${rate} t}\\phi_n(x)`;
  }
  if (display.kind === 'dirichlet-robin' || display.kind === 'robin-dirichlet') {
    const arg = display.kind === 'dirichlet-robin' ? robinArgument(display, false) : robinArgument(display, true);
    return `\\sum_{n=1}^{\\infty} c_n e^{-${rate} t}\\sin(${arg})`;
  }
  if (display.kind === 'dd') {
    return `\\sum_{n=1}^{\\infty} c_n e^{-${patternLambda(display.k, display.length, 'n')} t}${sinePattern(display, 'n')}`;
  }
  if (display.kind === 'nn') {
    const decay = patternLambda(display.k, display.length, 'n');
    return `c_0+\\sum_{n=1}^{\\infty} c_n e^{-${decay} t}${cosinePattern(display, 'n')}`;
  }
  if (display.kind === 'half-sin' || display.kind === 'half-cos') {
    const decay = patternLambda(display.k, display.length, 'n+\\tfrac{1}{2}');
    const phi = display.kind === 'half-sin' ? halfPattern(display, 'sin') : halfPattern(display, 'cos');
    return `\\sum_{n=0}^{\\infty} c_n e^{-${decay} t}${phi}`;
  }
  const decay = patternLambda(display.k, display.length, '2n');
  const angle = fourierAngle(display);
  return `a_0+\\sum_{n=1}^{\\infty} e^{-${decay} t}\\left(a_n\\cos(${angle})+b_n\\sin(${angle})\\right)`;
}

function seriesTail(display: SeriesDisplay): string {
  if (display.kind === 'robin-neumann' || display.kind === 'neumann-robin') {
    const root = robinRoot(display);
    return `\\phi_n(x)=${robinPhiBody(display)},\\quad \\mu_n=${root.mu},\\ ${root.eq}`;
  }
  if (display.kind === 'dirichlet-robin' || display.kind === 'robin-dirichlet') {
    const h = display.kind === 'robin-dirichlet' ? negateSymbol(display.hLatex) : display.hLatex;
    const root = robinProduct(h, placeLatex(display.length));
    return `\\mu_n=\\theta_n/${placeLatex(display.length)},\\ \\theta_n\\cos\\theta_n${root}\\sin\\theta_n=0`;
  }
  return '';
}

function infiniteWorked(display: SeriesDisplay): string {
  const a = placeLatex(display.left);
  const b = placeLatex(display.left + display.length);
  if (display.kind === 'robin-neumann' || display.kind === 'neumann-robin') {
    const root = robinRoot(display);
    const rate = muDecay(display.k);
    return `\\begin{aligned} \\phi_n(x)&=${robinPhiBody(display)},\\\\ \\mu_n&=${root.mu},\\quad ${root.eq},\\\\ c_n&=\\frac{\\int_{${a}}^{${b}} g(x)\\phi_n(x)\\,dx}{\\int_{${a}}^{${b}}\\phi_n(x)^2\\,dx},\\\\ u(x,t)&=\\sum_{n=1}^{\\infty} c_n e^{-${rate} t}\\phi_n(x).\\end{aligned}`;
  }
  if (display.kind === 'dd' || display.kind === 'half-sin' || display.kind === 'half-cos' || display.kind === 'dirichlet-robin' || display.kind === 'robin-dirichlet') {
    return trigWorked(display, a, b);
  }
  if (display.kind === 'nn') {
    const lam = patternLambda(display.k, display.length, 'n');
    const phi = cosinePattern(display, 'n');
    return `\\begin{aligned} \\phi_0(x)&=1,\\quad \\phi_n(x)=${phi},\\\\ \\lambda_n&=${lam},\\\\ c_0&=${oneOverL(display.length)}\\int_{${a}}^{${b}} g(x)\\,dx,\\quad c_n=${twoOverL(display.length)}\\int_{${a}}^{${b}} g(x)${phi}\\,dx,\\\\ u(x,t)&=\\sum_{n=0}^{\\infty} c_n e^{-\\lambda_n t}\\phi_n(x).\\end{aligned}`;
  }
  const decay = patternLambda(display.k, display.length, '2n');
  const angle = fourierAngle(display);
  return `\\begin{aligned} u(x,t)&=a_0+\\sum_{n=1}^{\\infty} e^{-${decay} t}\\left(a_n\\cos(${angle})+b_n\\sin(${angle})\\right),\\\\ a_0&=${oneOverL(display.length)}\\int_{${a}}^{${b}} g,\\quad a_n,b_n=${twoOverL(display.length)}\\int_{${a}}^{${b}} g\\,\\{\\cos,\\sin\\}.\\end{aligned}`;
}

function trigWorked(display: SeriesDisplay, a: string, b: string): string {
  if (display.kind === 'dirichlet-robin' || display.kind === 'robin-dirichlet') {
    const reflected = display.kind === 'robin-dirichlet';
    const phi = `\\sin(${reflected ? robinArgument(display, true) : robinArgument(display, false)})`;
    const h = reflected ? negateSymbol(display.hLatex) : display.hLatex;
    const root = robinProduct(h, placeLatex(display.length));
    const rate = muDecay(display.k);
    return `\\begin{aligned} \\phi_n(x)&=${phi},\\\\ \\mu_n&=\\theta_n/${placeLatex(display.length)},\\quad \\theta_n\\cos\\theta_n${root}\\sin\\theta_n=0,\\\\ c_n&=\\frac{\\int_{${a}}^{${b}} g(x)\\phi_n(x)\\,dx}{\\int_{${a}}^{${b}}\\phi_n(x)^2\\,dx},\\\\ u(x,t)&=\\sum_{n=1}^{\\infty} c_n e^{-${rate} t}\\phi_n(x).\\end{aligned}`;
  }
  const half = display.kind === 'half-sin' || display.kind === 'half-cos';
  const index = half ? 'n+\\tfrac{1}{2}' : 'n';
  const phi = display.kind === 'half-cos' ? halfPattern(display, 'cos') : display.kind === 'half-sin' ? halfPattern(display, 'sin') : sinePattern(display, 'n');
  const lam = patternLambda(display.k, display.length, index);
  const sum = half ? '\\sum_{n=0}^{\\infty}' : '\\sum_{n=1}^{\\infty}';
  return `\\begin{aligned} \\phi_n(x)&=${phi},\\\\ \\lambda_n&=${lam},\\\\ c_n&=${twoOverL(display.length)}\\int_{${a}}^{${b}} g(x)\\phi_n(x)\\,dx,\\\\ u(x,t)&=${sum} c_n e^{-\\lambda_n t}\\phi_n(x).\\end{aligned}`;
}

function eigenPhrase(display: SeriesDisplay): string {
  if (display.kind === 'dd' || display.kind === 'nn' || display.kind === 'periodic') {
    const index = display.kind === 'periodic' ? '2n' : 'n';
    return `\\text{these are eigenfunctions, }\\lambda_n=${patternLambda(display.k, display.length, index)}.`;
  }
  if (display.kind === 'half-sin' || display.kind === 'half-cos') {
    return `\\text{these are eigenfunctions, }\\lambda_n=${patternLambda(display.k, display.length, 'n+\\tfrac{1}{2}')}.`;
  }
  return '\\text{these are eigenfunctions.}';
}

function robinPhiBody(display: SeriesDisplay): string {
  const arg = robinArgument(display, display.kind === 'neumann-robin');
  const coeff = negateSymbol(display.hLatex);
  if (coeff === '0' || coeff === '-0') return `\\cos(${arg})`;
  if (coeff.startsWith('-')) return `\\cos(${arg})-(${stripParen(coeff.slice(1))}/\\mu_n)\\sin(${arg})`;
  return `\\cos(${arg})+(${stripParen(coeff)}/\\mu_n)\\sin(${arg})`;
}

function robinArgument(display: SeriesDisplay, flip: boolean): string {
  if (!flip) {
    if (nearly(display.left, 0)) return '\\mu_n x';
    return `\\mu_n(x-${placeLatex(display.left)})`;
  }
  return `\\mu_n(${placeLatex(display.left + display.length)}-x)`;
}

function robinRoot(display: SeriesDisplay): { mu: string; eq: string } {
  const span = placeLatex(display.length);
  const mu = span === '1' ? '\\theta_n' : `\\theta_n/${span}`;
  return { mu, eq: `\\theta_n\\sin\\theta_n${robinProduct(display.hLatex, span)}\\cos\\theta_n=0` };
}

function robinProduct(hLatex: string, span: string): string {
  const h = stripParen(hLatex.replace(/\s+/g, ''));
  const negative = h.startsWith('-');
  let body = negative ? h.slice(1) : h.replace(/^\+/, '');
  body = stripParen(body);
  if (body === '1') body = '';
  const lengthPart = span === '1' ? '' : span;
  const combined = `${body}${lengthPart}` || '1';
  return negative ? `-${combined}` : `+${combined}`;
}

function negateSymbol(hLatex: string): string {
  const h = stripParen(hLatex.replace(/\s+/g, ''));
  if (h.startsWith('-')) return stripParen(h.slice(1)) || '0';
  if (h.startsWith('+')) return `-${stripParen(h.slice(1))}`;
  if (h === '0') return '0';
  return `-${h}`;
}

function stripParen(value: string): string {
  if (value.startsWith('(') && value.endsWith(')')) return value.slice(1, -1);
  return value;
}

function sinePattern(display: SeriesDisplay, index: string): string {
  return `\\sin(${linearAngle(display, index)})`;
}

function cosinePattern(display: SeriesDisplay, index: string): string {
  return `\\cos(${linearAngle(display, index)})`;
}

function linearAngle(display: SeriesDisplay, index: string): string {
  if (nearly(display.left, 0) && nearly(display.length, Math.PI)) return index === 'n' ? 'nx' : `(${index})x`;
  if (nearly(display.left, 0) && nearly(display.length, 1)) return index === 'n' ? 'n\\pi x' : `(${index})\\pi x`;
  const span = placeLatex(display.length);
  const start = placeLatex(display.left);
  const freq = index === 'n' ? 'n\\pi' : `(${index})\\pi`;
  if (start === '0') return `\\frac{${freq} x}{${span}}`;
  return `\\frac{${freq}(x-${start})}{${span}}`;
}

function halfPattern(display: SeriesDisplay, fn: 'sin' | 'cos'): string {
  const name = fn === 'sin' ? '\\sin' : '\\cos';
  if (nearly(display.left, 0) && nearly(display.length, Math.PI)) return `${name}\\left((n+\\tfrac{1}{2})x\\right)`;
  if (nearly(display.left, 0) && nearly(display.length, 1)) return `${name}\\left((n+\\tfrac{1}{2})\\pi x\\right)`;
  const span = placeLatex(display.length);
  return `${name}\\left(\\frac{(n+\\tfrac{1}{2})\\pi x}{${span}}\\right)`;
}

function fourierAngle(display: SeriesDisplay): string {
  const span = placeLatex(display.length);
  if (nearly(display.left, 0) && span === '\\pi') return '2nx';
  if (nearly(display.left, 0)) return `\\frac{2n\\pi x}{${span}}`;
  return `\\frac{2n\\pi(x-${placeLatex(display.left)})}{${span}}`;
}

function twoOverL(length: number): string {
  const span = placeLatex(length);
  if (span === '1') return '2';
  return `\\frac{2}{${span}}`;
}

function oneOverL(length: number): string {
  const span = placeLatex(length);
  if (span === '1') return '1';
  return `\\frac{1}{${span}}`;
}

function placeLatex(value: number): string {
  if (nearly(value, 0)) return '0';
  if (nearly(value, Math.PI)) return '\\pi';
  if (nearly(value, 2 * Math.PI)) return '2\\pi';
  const exact = exactNumberLatex(value);
  if (exact && /^-?\d+$/.test(exact)) return exact;
  const ratio = exactNumberLatex(value / Math.PI);
  if (ratio === '1') return '\\pi';
  if (ratio && /^-?\d+$/.test(ratio)) return `${ratio}\\pi`;
  return exact ?? trimNumber(value);
}

function simplifiedFrame(
  original: (x: number, t: number) => number,
  series: (x: number, t: number) => number,
  transformed: boolean,
  nondim: boolean,
  left: number,
  right: number,
  length: number,
  k: number,
  alpha: number,
  beta: number,
  tMax: number,
  formula: string,
): FieldFrame | null {
  if (!transformed && !nondim) return null;
  const xOf = (xi: number) => left + (length * xi) / Math.PI;
  const tOf = (tau: number) => (tau * length * length) / (k * Math.PI * Math.PI);
  if (nondim && transformed) {
    const tauMax = (tMax * k * Math.PI * Math.PI) / (length * length);
    return frame(
      'simplified',
      'v',
      'v_\\tau=v_{\\xi\\xi}',
      '\\xi',
      '\\tau',
      0,
      Math.PI,
      0,
      tauMax,
      false,
      (xi, tau) => {
        const x = xOf(xi);
        const t = tOf(tau);
        return original(x, t) * Math.exp(-alpha * x - beta * t);
      },
      undefined,
      undefined,
      undefined,
      `x=${trimNumber(left)}+\\dfrac{${trimNumber(length)}}{\\pi}\\xi,\\ t=\\dfrac{${trimNumber(length)}^2}{${trimNumber(k)}\\pi^2}\\tau,\\ u=e^{${trimNumber(alpha)}x+${trimNumber(beta)}t}v`,
    );
  }
  if (nondim) {
    const tauMax = (tMax * k * Math.PI * Math.PI) / (length * length);
    return frame(
      'simplified',
      'u',
      formula,
      '\\xi',
      '\\tau',
      0,
      Math.PI,
      0,
      tauMax,
      false,
      (xi, tau) => original(xOf(xi), tOf(tau)),
      undefined,
      undefined,
      undefined,
      `x=${trimNumber(left)}+\\dfrac{L}{\\pi}\\xi,\\quad t=\\dfrac{L^2}{k\\pi^2}\\tau`,
    );
  }
  return frame(
    'simplified',
    'v',
    'v_t=k v_{xx}',
    'x',
    't',
    left,
    right,
    0,
    tMax,
    false,
    series,
    undefined,
    undefined,
    undefined,
    `u=e^{${trimNumber(alpha)} x+${trimNumber(beta)} t}v`,
  );
}

function shouldNondimensionalize(k: number, left: number, right: number): boolean {
  const standard = nearly(k, 1) && nearly(left, 0) && nearly(right, Math.PI);
  return !standard;
}

function frame(
  id: 'original' | 'simplified',
  name: string,
  formulaLatex: string,
  xName: string,
  tName: string,
  xMin: number,
  xMax: number,
  tMin: number,
  tMax: number,
  unbounded: boolean,
  evaluate: (x: number, t: number, y?: number) => number,
  yMin?: number,
  yMax?: number,
  yName?: string,
  mapLatex?: string,
): FieldFrame {
  return {
    id,
    name,
    formulaLatex,
    ...(mapLatex ? { mapLatex } : {}),
    xName,
    tName,
    ...(yName ? { yName } : {}),
    xMin,
    xMax,
    tMin,
    tMax,
    ...(yMin !== undefined ? { yMin, yMax } : {}),
    unbounded,
    evaluate,
  };
}

function blank(
  problem: HeatProblem,
  method: HeatSolution['method'],
  exact: boolean,
  formulaLatex: string,
  frames: FieldFrame[],
  modes: ModeTerm[],
  notes: NoteBlock[],
  warnings: string[],
  spatial: HeatSolution['spatial'],
): HeatSolution {
  return {
    family: 'heat',
    exact,
    method,
    formulaLatex,
    frames,
    modes,
    objects: [],
    notes,
    workedLatex: formulaLatex,
    features: [],
    warnings,
    spatial,
    boundaryCurves: [],
    residual: { pde: 0, initial: 0, boundary: 0 },
  };
  void problem;
}

function modeObjects(formula: string, terms: ModeTerm[], boundary?: string): PdeObject[] {
  const shown = terms.length <= 4 ? terms : [];
  const objects: PdeObject[] = [
    { id: 'surface', label: 'Solution', formulaLatex: formula, group: 'field', defaultOn: true },
    ...shown.map((mode) => ({
      id: mode.id,
      label: mode.m ? `Mode ${mode.n},${mode.m}` : `Mode ${mode.n}`,
      formulaLatex: mode.phiLatex,
      group: 'mode' as const,
      defaultOn: true,
    })),
  ];
  if (boundary) objects.push({ id: 'boundary', label: 'Boundary', formulaLatex: boundary, group: 'boundary', defaultOn: true });
  return objects;
}

function curves(left: number, right: number, tMax: number, domain: Extract<HeatProblem['domain'], { kind: 'interval' }>): Polyline[] {
  return [
    { id: 'bottom', formulaLatex: exprToLatex(domain.left.valueExpr), points: linePoints(left, right, 0, 0) },
    { id: 'left', formulaLatex: `${domain.left.kind} at left`, points: linePoints(left, left, 0, tMax) },
    { id: 'right', formulaLatex: `${domain.right.kind} at right`, points: linePoints(right, right, 0, tMax) },
  ];
}

function linePoints(x0: number, x1: number, t0: number, t1: number): number[][] {
  const points: number[][] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i += 1) {
    const s = i / steps;
    points.push([x0 + (x1 - x0) * s, t0 + (t1 - t0) * s]);
  }
  return points;
}

function dominantLambda(rows: Array<{ mode: SpectralMode; a0: number }>): number | undefined {
  const negative = rows.filter((row) => row.mode.lambda < -1e-8);
  if (negative.length > 0) return Math.min(...negative.map((row) => row.mode.lambda));
  const positive = rows.filter((row) => row.mode.lambda > 1e-8 && Math.abs(row.a0) > 1e-8);
  if (positive.length === 0) return undefined;
  return Math.min(...positive.map((row) => row.mode.lambda));
}

function viewTime(lambda: number | undefined): number {
  if (lambda === undefined || !(lambda > 0)) return 1;
  return Math.min(5, Math.max(0.2, 1.2 / lambda));
}

function longTime(rows: RowDraft[], lambda1: number | undefined): HeatSolution['longTime'] | undefined {
  if (lambda1 === undefined || !(lambda1 > 0)) return undefined;
  let best = 0;
  let profile = '';
  for (const row of rows) {
    if (!(row.mode.lambda > 1e-8)) continue;
    const mag = Math.abs(row.a0);
    if (mag <= 0.01) continue;
    const time = Math.log(mag / 0.01) / row.mode.lambda;
    if (time >= best) {
      best = time;
      profile = row.mode.phiLatex;
    }
  }
  return { rateLatex: `e^{-${trimNumber(lambda1)} t}`, timeToEpsilon: best, epsilon: 0.01, profileLatex: profile || 'dominant mode' };
}

function compatibility(
  g: (x: number) => number,
  left: EndData,
  right: EndData,
  leftX: number,
  rightX: number,
  terms: ModeTerm[],
): HeatSolution['compatibility'] | undefined {
  const jumps: number[] = [];
  if (left.kind === 'dirichlet') jumps.push(g(leftX) - left.value);
  if (right.kind === 'dirichlet') jumps.push(g(rightX) - right.value);
  const jump = jumps.reduce((max, value) => (Math.abs(value) > Math.abs(max) ? value : max), 0);
  if (Math.abs(jump) < 1e-6) return undefined;
  const decay = decayRate(terms);
  return {
    jump,
    gibbsLatex: `The series overshoots by about $0.089$ of the jump $${trimNumber(jump)}$.`,
    decayLatex: decay === '1/n^2' ? '|a_n|\\sim 1/n^2' : '|a_n|\\sim 1/n',
  };
}

function decayRate(terms: ModeTerm[]): '1/n' | '1/n^2' {
  const pts = terms.filter((mode) => mode.n >= 1 && Math.abs(mode.amplitude) > 1e-6);
  if (pts.length < 3) return '1/n';
  let sxx = 0;
  let sxy = 0;
  const meanX = pts.reduce((sum, mode) => sum + Math.log(mode.n), 0) / pts.length;
  const meanY = pts.reduce((sum, mode) => sum + Math.log(Math.abs(mode.amplitude)), 0) / pts.length;
  for (const mode of pts) {
    const dx = Math.log(mode.n) - meanX;
    sxx += dx * dx;
    sxy += dx * (Math.log(Math.abs(mode.amplitude)) - meanY);
  }
  const slope = sxx > 0 ? sxy / sxx : -1;
  return slope < -1.5 ? '1/n^2' : '1/n';
}

function maximumApplies(bundle: Bundle, rows: RowDraft[]): boolean {
  if ((bundle.c ?? 0) > 0) return false;
  if (bundle.sourceConstant !== 0) return false;
  if (rows.some((row) => row.mode.lambda < -1e-8 && Math.abs(row.a0) > 1e-8)) return false;
  return true;
}

function convectionNote(alpha: number, beta: number, b: number, c: number, k: number, left: EndCondition, right: EndCondition): string {
  const robin = [left, right]
    .filter((end) => end.kind === 'neumann')
    .map((end) => `At $x=${end.at}$, $v_x+\\alpha v=0$ with $\\alpha=${trimNumber(alpha)}$.`)
    .join(' ');
  return `Remove convection and reaction by $u=e^{\\alpha x+\\beta t}v$ with $\\alpha=-b/(2k)=${trimNumber(alpha)}$ and $\\beta=c-b^2/(4k)=${trimNumber(beta)}$. Then $v_t=${trimNumber(k)} v_{xx}$. Dirichlet data is multiplied by $e^{-\\alpha x-\\beta t}$. ${robin}`;
  void b;
  void c;
}

function boundaryLatex(domain: Extract<HeatProblem['domain'], { kind: 'interval' }>): string {
  return `${endFormula(domain.left)},\\ ${endFormula(domain.right)}`;
}

function endFormula(end: EndCondition): string {
  const at = exprToLatex(end.at);
  const value = exprToLatex(end.valueExpr);
  if (end.kind === 'dirichlet') return `u(${at},t)=${value}`;
  if (end.kind === 'neumann') return `u_x(${at},t)=${value}`;
  const h = exprToLatex(end.hExpr ?? '0');
  return `u_x(${at},t)+\\left(${h}\\right)u(${at},t)=${value}`;
}

function detectSymmetry(g: (x: number) => number, left: number, right: number): 'even' | 'odd' | null {
  const mid = 0.5 * (left + right);
  const length = right - left;
  let even = 0;
  let odd = 0;
  let scale = 0;
  for (let i = 1; i <= 6; i += 1) {
    const shift = (length * 0.45 * i) / 6;
    const plus = g(mid + shift);
    const minus = g(mid - shift);
    even += Math.abs(plus - minus);
    odd += Math.abs(plus + minus);
    scale += Math.abs(plus) + Math.abs(minus);
  }
  if (scale < 1e-10) return 'even';
  if (even <= 1e-6 * scale) return 'even';
  if (odd <= 1e-6 * scale) return 'odd';
  return null;
}

function parityOf(phi: (x: number) => number, left: number, right: number): 'even' | 'odd' | 'neither' {
  const mid = 0.5 * (left + right);
  const shift = 0.2 * (right - left);
  const plus = phi(mid + shift);
  const minus = phi(mid - shift);
  const scale = Math.abs(plus) + Math.abs(minus);
  if (Math.abs(plus - minus) <= 1e-7 * (1 + scale)) return 'even';
  if (Math.abs(plus + minus) <= 1e-7 * (1 + scale)) return 'odd';
  return 'neither';
}

function measureHeat(
  problem: HeatProblem,
  bundle: Bundle,
  u: (x: number, t: number, y?: number) => number,
  x0: number,
  x1: number,
  tMax: number,
  radial: boolean,
  y0 = 0,
  y1 = 0,
): HeatSolution['residual'] {
  const xs = samples(x0, x1, 10, true);
  const ts = [0.15, 0.4, 0.7].map((s) => s * tMax);
  let pde = 0;
  let count = 0;
  for (const x of xs) {
    for (const t of ts) {
      const y = y1 > y0 ? 0.5 * (y0 + y1) : 0;
      pde = Math.max(pde, Math.abs(heatResidual(problem, bundle, u, x, t, y, radial)));
      count += 1;
    }
  }
  let initial = 0;
  for (const x of samples(x0, x1, 16, false)) {
    const y = y1 > y0 ? 0.5 * (y0 + y1) : 0;
    initial = Math.max(initial, Math.abs(u(x, 0, y) - bundle.g(x, y)));
  }
  let boundary = 0;
  if (problem.domain.kind === 'interval' && !problem.domain.periodic) {
    boundary = Math.max(
      endResidual(problem.domain.left, u, evalMath(problem.domain.leftExpr, bundle.params), tMax, bundle.params, 1),
      endResidual(problem.domain.right, u, evalMath(problem.domain.rightExpr, bundle.params), tMax, bundle.params, -1),
    );
  }
  if (problem.domain.kind === 'half') {
    boundary = endResidual(problem.domain.bc, u, 0, tMax, bundle.params, 1);
  }
  void count;
  return { pde, initial, boundary };
}

function heatResidual(
  problem: HeatProblem,
  bundle: Bundle,
  u: (x: number, t: number, y?: number) => number,
  x: number,
  t: number,
  y: number,
  radial: boolean,
): number {
  const h = 1e-4;
  const ut = (u(x, t + h, y) - u(x, t - h, y)) / (2 * h);
  const ux = (u(x + h, t, y) - u(x - h, t, y)) / (2 * h);
  const uxx = (u(x + h, t, y) - 2 * u(x, t, y) + u(x - h, t, y)) / (h * h);
  const uyy = problem.domain.kind === 'rectangle' ? (u(x, t, y + h) - 2 * u(x, t, y) + u(x, t, y - h)) / (h * h) : 0;
  const laplacian = radial && Math.abs(x) > 5 * h ? uxx + ux / x : uxx + uyy;
  if (problem.burgers) return ut + u(x, t, y) * ux - (bundle.k ?? 0) * uxx;
  const k = bundle.kOf(x);
  const b = bundle.bOf(x);
  const c = bundle.cOf(x);
  return ut - k * laplacian - b * ux - c * u(x, t, y) - bundle.sourceOf(x, t);
}

function measureBurgers(u: (x: number, t: number) => number, nu: number, tMax: number): HeatSolution['residual'] {
  let pde = 0;
  for (const x of [-1.5, -0.4, 0.2, 0.8, 1.6]) {
    for (const t of [0.25 * tMax, 0.6 * tMax]) {
      const h = 2e-3;
      const ut = (u(x, t + h) - u(x, t - h)) / (2 * h);
      const ux = (u(x + h, t) - u(x - h, t)) / (2 * h);
      const uxx = (u(x + h, t) - 2 * u(x, t) + u(x - h, t)) / (h * h);
      pde = Math.max(pde, Math.abs(ut + u(x, t) * ux - nu * uxx));
    }
  }
  return { pde, initial: 0, boundary: 0 };
}

function endResidual(
  end: EndCondition,
  u: (x: number, t: number) => number,
  at: number,
  tMax: number,
  params: Record<string, number>,
  outward: number,
): number {
  let worst = 0;
  for (let i = 1; i <= 4; i += 1) {
    const t = (i / 4) * tMax * 0.8;
    const value = mentions(end.valueExpr, 't') ? evalMath(end.valueExpr, { ...params, t }) : evalMath(end.valueExpr, params);
    if (end.kind === 'dirichlet') {
      worst = Math.max(worst, Math.abs(u(at, t) - value));
    } else {
      const slope = derivativeAt(u, at, t, outward);
      const h = end.hExpr ? evalMath(end.hExpr, { ...params, t }) : 0;
      const residual = end.kind === 'neumann' ? slope - value : slope + h * u(at, t) - value;
      worst = Math.max(worst, Math.abs(residual));
    }
  }
  return worst;
}

function derivativeAt(u: (x: number, t: number) => number, x: number, t: number, outward: number): number {
  const h = 1e-4;
  const sign = outward >= 0 ? 1 : -1;
  const u0 = u(x, t);
  const u1 = u(x + sign * h, t);
  const u2 = u(x + sign * 2 * h, t);
  const oneSided = sign * (-1.5 * u0 + 2 * u1 - 0.5 * u2) / h;
  return oneSided;
}

function viscousStep(x: number, t: number, nu: number, uL: number, uR: number, at: number): number {
  if (!(t > 1e-10)) return x < at ? uL : x > at ? uR : 0.5 * (uL + uR);
  const xi = x - at;
  const width = Math.sqrt(4 * nu * t);
  const etaL = (xi - uL * t) / width;
  const etaR = (xi - uR * t) / width;
  const logL = -uL * xi / (2 * nu) + (uL * uL * t) / (4 * nu) + logErfc(etaL);
  const logR = -uR * xi / (2 * nu) + (uR * uR * t) / (4 * nu) + logErfc(-etaR);
  const shift = Math.max(logL, logR);
  const left = Math.exp(logL - shift);
  const right = Math.exp(logR - shift);
  const denom = left + right;
  if (!(denom > 0)) return entropyStep(x, t, uL, uR, at);
  return (uL * left + uR * right) / denom;
}

function entropyStep(x: number, t: number, uL: number, uR: number, at: number): number {
  const xi = x - at;
  if (!(t > 0)) return xi < 0 ? uL : xi > 0 ? uR : 0.5 * (uL + uR);
  if (uL > uR) {
    const shock = 0.5 * (uL + uR) * t;
    if (xi < shock) return uL;
    if (xi > shock) return uR;
    return 0.5 * (uL + uR);
  }
  if (uL < uR) {
    if (xi <= uL * t) return uL;
    if (xi >= uR * t) return uR;
    return xi / t;
  }
  return uL;
}

function logErfc(eta: number): number {
  if (eta < -8) return Math.log(2);
  if (eta < 0) {
    const tail = Math.exp(logErfc(-eta));
    return Math.log(Math.max(2 - tail, 1e-300));
  }
  const t = 1 / (1 + 0.3275911 * eta);
  const poly = (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  return -eta * eta + Math.log(Math.max(poly, 1e-300));
}

function detectStep(g: (x: number) => number): { uL: number; uR: number; at: number } | null {
  const left = g(-8);
  const right = g(8);
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) < 1e-3) return null;
  let changes = 0;
  let at = 0;
  let previous = g(-8);
  for (let i = -79; i <= 80; i += 1) {
    const x = i * 0.1;
    const value = g(x);
    if (Math.abs(value - previous) > 0.25 * Math.abs(left - right)) {
      changes += 1;
      at = x;
    }
    previous = value;
  }
  if (changes < 1 || changes > 4) return null;
  let lo = at - 0.2;
  let hi = at + 0.2;
  for (let i = 0; i < 30; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (Math.abs(g(mid) - left) < Math.abs(g(mid) - right)) lo = mid;
    else hi = mid;
  }
  return { uL: left, uR: right, at: 0.5 * (lo + hi) };
}

function detectRect(g: (x: number) => number): { a: number; b: number; height: number } | null {
  const xs = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);
  const values = xs.map((x) => g(x));
  const height = Math.max(...values.map((value) => Math.abs(value)));
  if (height < 1e-6) return null;
  let intermediate = 0;
  for (const value of values) {
    const nearZero = Math.abs(value) <= 0.05 * height;
    const nearHeight = Math.abs(value - height) <= 0.05 * height;
    if (!nearZero && !nearHeight) intermediate += 1;
  }
  if (intermediate > 3) return null;
  const on = values.map((value) => Math.abs(value - height) <= 0.05 * height);
  if (!on.some(Boolean) || on[0] || on[on.length - 1]) return null;
  const start = on.indexOf(true);
  const end = on.lastIndexOf(true);
  if (start < 0 || end <= start) return null;
  if (on.slice(start, end + 1).some((flag) => !flag)) return null;
  return { a: xs[start] ?? 0, b: xs[end] ?? 0, height: g(0.5 * ((xs[start] ?? 0) + (xs[end] ?? 0))) };
}

function detectGaussian(g: (x: number) => number): { A: number; m: number; sigma2: number } | null {
  const xs = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5];
  const logs = xs.map((x) => g(x));
  if (logs.some((value) => !(value > 1e-8))) return null;
  const y = logs.map((value) => Math.log(value));
  const fit = quadraticFit(xs, y);
  if (!fit || !(fit.c < -1e-4)) return null;
  const sigma2 = -1 / (2 * fit.c);
  const m = fit.b * sigma2;
  const amplitude = Math.exp(fit.a + (m * m) / (2 * sigma2));
  for (const x of [-2.5, 0.3, 2.2]) {
    const predicted = amplitude * Math.exp(-((x - m) ** 2) / (2 * sigma2));
    if (Math.abs(predicted - g(x)) > 1e-3 * (1 + Math.abs(g(x)))) return null;
  }
  return { A: amplitude, m, sigma2 };
}

function quadraticFit(xs: number[], ys: number[]): { a: number; b: number; c: number } | null {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    s0 += 1;
    s1 += x;
    s2 += x * x;
    s3 += x ** 3;
    s4 += x ** 4;
    t0 += y;
    t1 += x * y;
    t2 += x * x * y;
  }
  const matrix = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(matrix[row]?.[col] ?? 0) > Math.abs(matrix[pivot]?.[col] ?? 0)) pivot = row;
    }
    const rowA = matrix[col];
    const rowB = matrix[pivot];
    if (!rowA || !rowB || Math.abs(rowB[col] ?? 0) < 1e-14) return null;
    matrix[col] = rowB;
    matrix[pivot] = rowA;
    const diag = matrix[col]?.[col] ?? 1;
    for (let row = col + 1; row < 3; row += 1) {
      const factor = (matrix[row]?.[col] ?? 0) / diag;
      for (let k = col; k <= 3; k += 1) {
        const line = matrix[row];
        if (line) line[k] = (line[k] ?? 0) - factor * (matrix[col]?.[k] ?? 0);
      }
    }
  }
  const coeff = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let sum = matrix[row]?.[3] ?? 0;
    for (let col = row + 1; col < 3; col += 1) sum -= (matrix[row]?.[col] ?? 0) * (coeff[col] ?? 0);
    coeff[row] = sum / (matrix[row]?.[row] ?? 1);
  }
  return { a: coeff[0] ?? 0, b: coeff[1] ?? 0, c: coeff[2] ?? 0 };
}

function readDirac(expr: string): number | null {
  if (!/dirac/i.test(expr)) return null;
  const direct = diracCenter(expr);
  if (direct !== null) return direct;
  const compact = toMath(expr).replace(/\s+/g, '');
  const wrapped = compact.match(/^dirac\(\((x|y)([+-][\d.]+)\)\)$/);
  if (wrapped) return Number(wrapped[2] ?? 0);
  const plain = compact.match(/^dirac\((x|y)([+-][\d.]+)\)$/);
  if (plain) return Number(plain[2] ?? 0);
  if (compact === 'dirac(x)' || compact === 'dirac(y)') return 0;
  return null;
}

function eigenFrequency(g: (x: number) => number): number | null {
  const h = 1e-3;
  const ratios: number[] = [];
  for (const x of [0.4, 0.9, 1.3, 1.8, 2.4]) {
    const mid = g(x);
    if (Math.abs(mid) < 1e-5) continue;
    const second = (g(x - h) - 2 * mid + g(x + h)) / (h * h);
    const ratio = -second / mid;
    if (!(ratio > 0)) return null;
    ratios.push(Math.sqrt(ratio));
  }
  if (ratios.length < 3) return null;
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  if (ratios.some((value) => Math.abs(value - mean) > 1e-3 * (1 + mean))) return null;
  return mean;
}

function separateProduct(
  g: (x: number, y: number) => number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { p: (x: number) => number; q: (y: number) => number } | null {
  const xref = 0.5 * (x0 + x1);
  const yref = 0.5 * (y0 + y1);
  const base = g(xref, yref);
  if (Math.abs(base) < 1e-8) return null;
  const p = (x: number) => g(x, yref);
  const q = (y: number) => g(xref, y) / base;
  for (let i = 1; i <= 4; i += 1) {
    const x = x0 + ((x1 - x0) * i) / 5;
    const y = y0 + ((y1 - y0) * i) / 5;
    if (Math.abs(p(x) * q(y) - g(x, y)) > 1e-6 * (1 + Math.abs(g(x, y)))) return null;
  }
  return { p, q };
}

function integrateAgainstAxis(f: (x: number) => number, n: number, a: number, b: number): { value: number; exact: boolean } {
  const length = b - a;
  const polynomial = fitPolynomial(f, a, b, 4);
  if (polynomial) {
    const mu = (n * Math.PI) / length;
    let moment = 0;
    const omega = mu * length;
    for (let j = 0; j < polynomial.length; j += 1) moment += (polynomial[j] ?? 0) * unitSineMoment(j, omega);
    return { value: (2 / length) * moment * length, exact: true };
  }
  const integral = simpson((x) => f(x) * Math.sin((n * Math.PI * (x - a)) / length), a, b);
  return { value: (2 / length) * integral, exact: false };
}

function unitSineMoment(power: number, omega: number): number {
  if (Math.abs(omega) < 1e-12) return 0;
  const sine = [0];
  const cosine = [0];
  sine[0] = (1 - Math.cos(omega)) / omega;
  cosine[0] = Math.sin(omega) / omega;
  for (let k = 1; k <= power; k += 1) {
    sine[k] = -Math.cos(omega) / omega + (k / omega) * (cosine[k - 1] ?? 0);
    cosine[k] = Math.sin(omega) / omega - (k / omega) * (sine[k - 1] ?? 0);
  }
  return sine[power] ?? 0;
}

function doubleSine(g: (x: number, y: number) => number, n: number, m: number, x0: number, x1: number, y0: number, y1: number): number {
  const panels = 32;
  return simpson((x) => {
    const weight = Math.sin((n * Math.PI * (x - x0)) / (x1 - x0));
    return weight * simpson((y) => g(x, y) * Math.sin((m * Math.PI * (y - y0)) / (y1 - y0)), y0, y1, panels);
  }, x0, x1, panels);
}

function massOf(g: (x: number) => number): number {
  const values = [-8, -4, -2, 2, 4, 8].map((x) => Math.abs(g(x)));
  if ((values[0] ?? 0) > 1e-3 || (values[5] ?? 0) > 1e-3) return Number.POSITIVE_INFINITY;
  return simpson(g, -12, 12, 200);
}

function signedIntegral(g: (x: number) => number, a: number, b: number): number {
  if (Math.abs(b - a) < 1e-12) return 0;
  return b >= a ? simpson(g, a, b, 80) : -simpson(g, b, a, 80);
}

function toNumericEnd(end: EndCondition, params: Record<string, number>): NumericEnd {
  return {
    kind: end.kind,
    h: end.hExpr ? evalMath(end.hExpr, params) : 0,
    value: (t) => evalMath(end.valueExpr, { ...params, t }),
  };
}

function cornerJump(g: (x: number) => number, left: NumericEnd, right: NumericEnd, x0: number, x1: number): number {
  const leftJump = left.kind === 'dirichlet' ? Math.abs(g(x0) - left.value(0)) : 0;
  const rightJump = right.kind === 'dirichlet' ? Math.abs(g(x1) - right.value(0)) : 0;
  return Math.max(leftJump, rightJump);
}

function constantExpr(expr: string, params: Record<string, number>): number | null {
  if (mentions(expr, 'x') || mentions(expr, 't') || mentions(expr, 'y') || mentions(expr, 'r') || mentions(expr, 'u')) return null;
  const value = evalMath(expr, params);
  return Number.isFinite(value) ? value : null;
}

function matchExponentialSource(
  bundle: Bundle,
  left: number,
  right: number,
): { c: number; spatial: (x: number) => number } | null {
  const spatial = (x: number) => bundle.sourceOf(x, 0);
  const probe = 0.35;
  const xs = [0.2, 0.5, 0.8].map((s) => left + s * (right - left));
  let rate: number | null = null;
  let seen = false;
  for (const x of xs) {
    const base = spatial(x);
    if (Math.abs(base) < 1e-8) continue;
    const ratio = bundle.sourceOf(x, probe) / base;
    if (!(ratio > 0)) return null;
    const next = Math.log(ratio) / probe;
    if (rate === null) rate = next;
    else if (Math.abs(rate - next) > 1e-3 * (1 + Math.abs(rate))) return null;
    seen = true;
  }
  if (!seen || rate === null) return null;
  for (const x of xs) {
    const base = spatial(x);
    if (Math.abs(base) < 1e-8) continue;
    const expected = base * Math.exp(rate * 0.7);
    if (Math.abs(bundle.sourceOf(x, 0.7) - expected) > 1e-3 * (1 + Math.abs(expected))) return null;
  }
  return { c: rate, spatial };
}

function homogeneousEnergy(left: EndData, right: EndData): boolean {
  return Math.abs(left.value) < 1e-10 && Math.abs(right.value) < 1e-10;
}

function energyLatex(k: number, left: EndData, right: EndData): string {
  if (left.kind === 'robin' && right.kind === 'neumann' && (left.h ?? 0) < 0) {
    const alpha = -(left.h ?? 0);
    return `Multiply by $u$ and integrate. $\\frac{d}{dt}\\int u^2/2\\,dx=${trimNumber(k)}\\big(-\\alpha u(0)^2-\\int u_x^2\\big)$ with $\\alpha=${trimNumber(alpha)}>0$, so the energy cannot grow. The difference of two solutions has energy 0, hence the solution is unique.`;
  }
  return `With these homogeneous ends, $\\frac{d}{dt}\\int u^2\\,dx=-${trimNumber(2 * k)}\\int u_x^2\\,dx$ up to a nonpositive boundary term. Energy cannot grow, so the solution of the homogeneous problem is unique.`;
}

function sourceConstant(problem: HeatProblem, params: Record<string, number>): number | null {
  if (mentions(problem.sourceExpr, 't')) return null;
  return constantExpr(problem.sourceExpr, params);
}

function nearlyZeroFunction(f: (x: number) => number, left: number, right: number): boolean {
  for (let i = 0; i <= 6; i += 1) {
    const x = left + ((right - left) * i) / 6;
    if (Math.abs(f(x)) > 1e-8) return false;
  }
  return true;
}

function nearly(value: number, target: number): boolean {
  return Math.abs(value - target) <= 1e-8 * (1 + Math.abs(target));
}

function samples(a: number, b: number, count: number, interior: boolean): number[] {
  const points: number[] = [];
  const pad = interior ? 0.08 : 0;
  for (let i = 0; i < count; i += 1) {
    const s = pad + ((1 - 2 * pad) * (i + 0.5)) / count;
    points.push(a + (b - a) * s);
  }
  return points;
}

function orderFeatures(used: Set<PdeTag>): PdeTag[] {
  return FEATURES.filter((tag) => used.has(tag));
}
