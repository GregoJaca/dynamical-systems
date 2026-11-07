import type { CompiledSystem, EquilibriumAnalysis, EquilibriumType2D, EquilibriumType3D, StabilityVerdict } from '../core/types';
import { latexNumber } from './algebra';
import { attachExactSpectrum } from './exactSpectrum';
import {
  buildSubspaces,
  decompose,
  det2,
  determinant,
  invert2,
  isDiagonalizableReal,
  solveLinear,
  traceOf,
  type RealEigenPair,
  type Spectrum,
} from './linearAlgebra';

export interface EquilibriumSearch {
  compiled: CompiledSystem;
  dimension: number;
  isLinear: boolean;
  hamiltonian: boolean;
  reversibleFix: { yAxis: boolean; xAxis: boolean };
  variableLatex: string[];
  periodicVars: boolean[];
  searchRadius: number;
  rhsExpressions?: string[];
  stateVars?: string[];
}

const ROOT_TOL = 1e-12;
const DEDUP = 1e-5;
const HYPERBOLIC_TOL = 1e-7;

export function findEquilibriaNumeric(search: EquilibriumSearch): EquilibriumAnalysis[] {
  const { compiled, dimension } = search;
  const seeds = seedPoints(dimension, search.searchRadius, search.periodicVars);
  const roots: number[][] = [];
  for (const seed of seeds) {
    const root = newton(compiled, seed, search.searchRadius);
    if (!root) continue;
    const polished = polishRoot(compiled, root);
    if (search.periodicVars.some(Boolean) && !insidePeriodicWindow(polished, search.periodicVars)) continue;
    if (roots.some((other) => distance(other, polished) < DEDUP)) continue;
    if (infNorm(compiled.f(0, polished, compiled.parameterValues)) < 1e-9) roots.push(polished);
  }
  roots.sort((a, b) => {
    for (let i = 0; i < dimension; i += 1) {
      const delta = (a[i] ?? 0) - (b[i] ?? 0);
      if (Math.abs(delta) > 1e-8) return delta;
    }
    return 0;
  });
  const isolated = !isContinuum(compiled, roots);
  return roots.map((coords, index) => analyzeEquilibrium(search, coords, index, isolated, roots.length));
}

function analyzeEquilibrium(
  search: EquilibriumSearch,
  coords: number[],
  index: number,
  isolated: boolean,
  rootCount: number,
): EquilibriumAnalysis {
  const { compiled } = search;
  const jacobian = compiled.J(0, coords, compiled.parameterValues).map((row) => row.map((value) => (Number.isFinite(value) ? value : 0)));
  const spectrum = decompose(jacobian);
  const trace = traceOf(jacobian);
  const det = search.dimension === 2 ? det2(jacobian) : determinant(jacobian);
  const disc = trace * trace - 4 * det;
  const poincare = search.dimension === 2 ? poincareIndex(compiled, coords) : undefined;
  const hyperbolic = spectrum.eigenvalues.every((lambda) => Math.abs(lambda.re) > HYPERBOLIC_TOL);
  const repeated = algebraicMultiplicity(spectrum, spectrum.eigenvalues[0]?.re ?? 0);
  const diagonalizable =
    search.dimension !== 2 || Math.abs(disc) > 1e-8 || isDiagonalizableReal(jacobian, spectrum.eigenvalues[0]?.re ?? 0, repeated);
  const onReversibleAxis =
    (search.reversibleFix.yAxis && Math.abs(coords[1] ?? 0) < 1e-6) ||
    (search.reversibleFix.xAxis && Math.abs(coords[0] ?? 0) < 1e-6);
  const focus = hyperbolic ? null : focusQuantity(compiled, coords, spectrum.pairs);
  const classified = classify({
    dimension: search.dimension,
    isLinear: search.isLinear,
    hamiltonian: search.hamiltonian,
    onReversibleAxis,
    isolated: isolated && rootCount < 24,
    trace,
    det,
    disc,
    diagonalizable,
    poincare: poincare ?? 0,
    eigenvalues: spectrum,
    focus,
  });
  const subspaces = buildSubspaces(coords, spectrum.pairs, search.variableLatex);
  const built: EquilibriumAnalysis = {
    id: `eq-${index}`,
    coords,
    sourceMethod: 'numeric_newton',
    jacobianNumeric: jacobian,
    trace: { value: trace },
    determinant: { value: det },
    discriminant2D: search.dimension === 2 ? { value: disc } : undefined,
    eigenvalues: spectrum.eigenvalues,
    eigenvectors: spectrum.eigenvectors,
    isHyperbolic: classified.hyperbolic,
    poincareIndex2D: poincare,
    classification2D: classified.classification2D,
    classification3D: classified.classification3D,
    stability: classified.stability,
    stabilityReasonLatex: classified.reason,
    subspaces,
    hartmanGrobmanApplies: classified.hyperbolic,
    hartmanGrobmanRadius: classified.hyperbolic ? hartmanRadius(compiled, coords, jacobian) : undefined,
  };
  if (search.rhsExpressions && search.stateVars) attachExactSpectrum(built, search.rhsExpressions, search.stateVars);
  return built;
}

interface ClassInput {
  dimension: number;
  isLinear: boolean;
  hamiltonian: boolean;
  onReversibleAxis: boolean;
  isolated: boolean;
  trace: number;
  det: number;
  disc: number;
  diagonalizable: boolean;
  poincare: number;
  eigenvalues: Spectrum;
  focus: number | null;
}

function classify(input: ClassInput): {
  classification2D?: EquilibriumType2D;
  classification3D?: EquilibriumType3D;
  stability: StabilityVerdict;
  hyperbolic: boolean;
  reason: string;
} {
  const hyperbolic = input.eigenvalues.eigenvalues.every((lambda) => Math.abs(lambda.re) > HYPERBOLIC_TOL);
  if (input.dimension === 1) {
    const rate = input.eigenvalues.eigenvalues[0]?.re ?? 0;
    return {
      stability: Math.abs(rate) <= HYPERBOLIC_TOL ? 'undetermined' : rate < 0 ? 'asymptotically_stable' : 'unstable',
      hyperbolic,
      reason: hyperbolic ? 'The derivative at the rest point is nonzero.' : 'The derivative vanishes, so the rest point is non-hyperbolic.',
    };
  }
  if (input.dimension === 2) {
    return { ...classify2D(input), hyperbolic };
  }
  if (input.dimension === 3) {
    const classification3D = classify3D(input.eigenvalues);
    const stability = stabilityFromSpectrum(input.eigenvalues, hyperbolic);
    return {
      classification3D,
      stability,
      hyperbolic,
      reason: hyperbolic
        ? "Hartman--Grobman: the equilibrium is hyperbolic, so the nonlinear flow is topologically equivalent to its linearization."
        : 'A center direction is present, so linearization does not decide stability.',
    };
  }
  const stability = stabilityFromSpectrum(input.eigenvalues, hyperbolic);
  return {
    classification3D: 'higher_dim_equilibrium',
    stability,
    hyperbolic,
    reason: hyperbolic ? 'Every eigenvalue has nonzero real part.' : 'At least one eigenvalue lies on the imaginary axis.',
  };
}

function classify2D(input: ClassInput): { classification2D: EquilibriumType2D; stability: StabilityVerdict; reason: string } {
  const scale = 1 + Math.abs(input.trace) + Math.abs(input.det);
  const det0 = Math.abs(input.det) <= 1e-8 * scale;
  const trace0 = Math.abs(input.trace) <= 1e-8 * scale;
  if (!input.isolated) {
    return { classification2D: 'non_isolated_line', stability: 'lyapunov_stable', reason: 'Equilibria accumulate along a line, so the rest point is not isolated.' };
  }
  if (input.det < -1e-8 * scale) {
    return {
      classification2D: 'saddle',
      stability: 'unstable',
      reason: 'The determinant is negative, so the eigenvalues are real and of opposite sign. The equilibrium is a hyperbolic saddle.',
    };
  }
  if (det0 && trace0) {
    return {
      classification2D: input.poincare === 0 ? 'cusp' : 'unknown_non_hyperbolic',
      stability: 'unstable',
      reason: 'Both eigenvalues vanish. The Poincaré index distinguishes a nilpotent cusp from a non-isolated set.',
    };
  }
  if (det0) {
    return {
      classification2D: 'saddle_node',
      stability: 'semi_stable',
      reason: 'Exactly one eigenvalue is zero, so the equilibrium is non-hyperbolic of saddle-node type until the center-manifold coefficient is computed.',
    };
  }
  if (trace0 && input.det > 0) {
    if (input.isLinear) {
      return {
        classification2D: 'linear_center',
        stability: 'lyapunov_stable',
        reason: 'The linearization is a pure rotation and the vector field is linear, so nearby orbits are periodic.',
      };
    }
    if (input.hamiltonian || input.onReversibleAxis) {
      return {
        classification2D: 'nonlinear_center',
        stability: 'lyapunov_stable',
        reason: input.hamiltonian
          ? 'The linearization is a center and the system is Hamiltonian, so the equilibrium is a true nonlinear center.'
          : 'The linearization is a center lying on the fixed set of a reversing symmetry, so it is a nonlinear center.',
      };
    }
    const quantity = input.focus ?? 0;
    if (quantity < -1e-3) {
      return {
        classification2D: 'weak_stable_focus',
        stability: 'asymptotically_stable',
        reason: 'The linearization is a center, but the first Lyapunov focus quantity is negative, so the equilibrium is a weakly attracting focus.',
      };
    }
    if (quantity > 1e-3) {
      return {
        classification2D: 'weak_unstable_focus',
        stability: 'unstable',
        reason: 'The linearization is a center, but the first Lyapunov focus quantity is positive, so the equilibrium is a weakly repelling focus.',
      };
    }
    return {
      classification2D: 'nonlinear_center',
      stability: 'lyapunov_stable',
      reason: 'The first Lyapunov focus quantities vanish, consistent with a nonlinear center.',
    };
  }
  const stable = input.trace < 0;
  if (input.disc < -1e-9 * scale) {
    return {
      classification2D: stable ? 'stable_focus' : 'unstable_focus',
      stability: stable ? 'asymptotically_stable' : 'unstable',
      reason: stable
        ? 'Complex eigenvalues with negative real part: a hyperbolic stable focus.'
        : 'Complex eigenvalues with positive real part: a hyperbolic unstable focus.',
    };
  }
  const repeated = Math.abs(input.disc) <= 1e-8 * scale;
  let classification2D: EquilibriumType2D;
  if (repeated && !input.diagonalizable) classification2D = stable ? 'stable_degenerate_node' : 'unstable_degenerate_node';
  else if (repeated) classification2D = stable ? 'stable_proper_node' : 'unstable_proper_node';
  else classification2D = stable ? 'stable_improper_node' : 'unstable_improper_node';
  return {
    classification2D,
    stability: stable ? 'asymptotically_stable' : 'unstable',
    reason: stable ? 'Both eigenvalues are real and negative.' : 'Both eigenvalues are real and positive.',
  };
}

function classify3D(spectrum: Spectrum): EquilibriumType3D {
  const eigs = spectrum.eigenvalues;
  if (eigs.some((lambda) => Math.abs(lambda.re) <= HYPERBOLIC_TOL)) return 'center_manifold_3d';
  const complex = eigs.filter((lambda) => Math.abs(lambda.im) > HYPERBOLIC_TOL);
  const real = eigs.filter((lambda) => Math.abs(lambda.im) <= HYPERBOLIC_TOL);
  if (complex.length >= 2 && real.length === 1) {
    const cre = complex[0]?.re ?? 0;
    const rr = real[0]?.re ?? 0;
    if (rr > 0 && cre < 0) return 'saddle_focus_1_2';
    if (rr < 0 && cre > 0) return 'saddle_focus_2_1';
    if (rr < 0 && cre < 0) return 'stable_focus_node';
    if (rr > 0 && cre > 0) return 'unstable_focus_node';
  }
  const positive = eigs.filter((lambda) => lambda.re > HYPERBOLIC_TOL).length;
  const negative = eigs.filter((lambda) => lambda.re < -HYPERBOLIC_TOL).length;
  if (positive === 0 && negative === eigs.length) return 'stable_node_3d';
  if (negative === 0 && positive === eigs.length) return 'unstable_node_3d';
  if (positive === 1) return 'saddle_index_1';
  if (positive === 2) return 'saddle_index_2';
  return 'higher_dim_equilibrium';
}

function stabilityFromSpectrum(spectrum: Spectrum, hyperbolic: boolean): StabilityVerdict {
  if (!hyperbolic) return 'undetermined';
  return spectrum.eigenvalues.every((lambda) => lambda.re < 0) ? 'asymptotically_stable' : 'unstable';
}

function algebraicMultiplicity(spectrum: Spectrum, value: number): number {
  return spectrum.eigenvalues.filter((lambda) => Math.abs(lambda.re - value) < 1e-7 && Math.abs(lambda.im) < 1e-7).length;
}

function focusQuantity(compiled: CompiledSystem, coords: number[], pairs: RealEigenPair[]): number | null {
  const real = pairs.find((pair) => pair.complexPart === 'real');
  const imag = pairs.find((pair) => pair.complexPart === 'imag');
  if (!real || !imag || coords.length < 2) return null;
  const P = [
    [real.vector[0] ?? 0, imag.vector[0] ?? 0],
    [real.vector[1] ?? 0, imag.vector[1] ?? 0],
  ];
  const inverse = invert2(P);
  if (!inverse) return null;
  const radius = 0.04;
  const samples = 48;
  let total = 0;
  for (let k = 0; k < samples; k += 1) {
    const angle = (2 * Math.PI * k) / samples;
    const u = radius * Math.cos(angle);
    const v = radius * Math.sin(angle);
    const point = coords.slice();
    point[0] = (coords[0] ?? 0) + (P[0]?.[0] ?? 0) * u + (P[0]?.[1] ?? 0) * v;
    point[1] = (coords[1] ?? 0) + (P[1]?.[0] ?? 0) * u + (P[1]?.[1] ?? 0) * v;
    const velocity = compiled.f(0, point, compiled.parameterValues);
    const f1 = (inverse[0]?.[0] ?? 0) * (velocity[0] ?? 0) + (inverse[0]?.[1] ?? 0) * (velocity[1] ?? 0);
    const f2 = (inverse[1]?.[0] ?? 0) * (velocity[0] ?? 0) + (inverse[1]?.[1] ?? 0) * (velocity[1] ?? 0);
    total += (u * f1 + v * f2) / radius ** 4;
  }
  return total / samples;
}

function poincareIndex(compiled: CompiledSystem, coords: number[]): number {
  const samples = 720;
  const radius = 1e-3;
  let total = 0;
  let previous = 0;
  for (let k = 0; k <= samples; k += 1) {
    const angle = (2 * Math.PI * k) / samples;
    const point = coords.slice();
    point[0] = (coords[0] ?? 0) + radius * Math.cos(angle);
    point[1] = (coords[1] ?? 0) + radius * Math.sin(angle);
    const velocity = compiled.f(0, point, compiled.parameterValues);
    const theta = Math.atan2(velocity[1] ?? 0, velocity[0] ?? 0);
    if (k === 0) {
      previous = theta;
      continue;
    }
    let delta = theta - previous;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    total += delta;
    previous = theta;
  }
  return Math.round(total / (2 * Math.PI));
}

function hartmanRadius(compiled: CompiledSystem, coords: number[], jacobian: number[][]): number {
  let lo = 0;
  let hi = 1.5;
  for (let iter = 0; iter < 12; iter += 1) {
    const mid = (lo + hi) / 2;
    if (linearizationFaithful(compiled, coords, jacobian, mid)) lo = mid;
    else hi = mid;
  }
  return Number(lo.toPrecision(3));
}

function linearizationFaithful(compiled: CompiledSystem, coords: number[], jacobian: number[][], radius: number): boolean {
  if (radius < 1e-4) return true;
  const directions = 12;
  for (let k = 0; k < directions; k += 1) {
    const angle = (2 * Math.PI * k) / directions;
    const offset = [radius * Math.cos(angle), radius * Math.sin(angle)];
    const point = coords.map((value, index) => value + (offset[index] ?? 0));
    const full = compiled.f(0, point, compiled.parameterValues);
    const linear = jacobian.map((row) => row.reduce((sum, value, index) => sum + value * (offset[index] ?? 0), 0));
    const nonlinear = Math.hypot(...full.map((value, index) => value - (linear[index] ?? 0)));
    const linearNorm = Math.hypot(...linear);
    if (linearNorm > 1e-8 && nonlinear > 0.15 * linearNorm) return false;
  }
  return true;
}

function polishRoot(compiled: CompiledSystem, x: number[]): number[] {
  const params = compiled.parameterValues;
  let current = x.slice();
  let residual = infNorm(compiled.f(0, current, params));
  const snapped = current.map((value) => (Math.abs(value) < 1e-4 ? 0 : value));
  const snappedResidual = infNorm(compiled.f(0, snapped, params));
  if (snappedResidual <= residual + 1e-15) {
    current = snapped;
    residual = snappedResidual;
  }
  return current;
}

function newton(compiled: CompiledSystem, seed: number[], radius: number): number[] | null {
  let x = seed.slice();
  let fx = compiled.f(0, x, compiled.parameterValues);
  let residual = infNorm(fx);
  if (residual < ROOT_TOL) return polishRoot(compiled, x);
  for (let iter = 0; iter < 45; iter += 1) {
    const jacobian = compiled.J(0, x, compiled.parameterValues);
    const step = solveLinear(
      jacobian,
      fx.map((value) => -value),
    );
    if (!step || step.some((value) => !Number.isFinite(value))) {
      const polished = polishRoot(compiled, x);
      return infNorm(compiled.f(0, polished, compiled.parameterValues)) < 1e-8 ? polished : null;
    }
    const stepNorm = Math.hypot(...step);
    const cap = Math.max(2, radius);
    const limited = stepNorm > cap ? step.map((value) => (value * cap) / stepNorm) : step;
    let alpha = 1;
    let improved = false;
    for (let line = 0; line < 14; line += 1) {
      const trial = x.map((value, index) => value + alpha * (limited[index] ?? 0));
      if (Math.hypot(...trial) > radius * 8) {
        alpha *= 0.5;
        continue;
      }
      const fTrial = compiled.f(0, trial, compiled.parameterValues);
      if (!fTrial.every((value) => Number.isFinite(value))) {
        alpha *= 0.5;
        continue;
      }
      const next = infNorm(fTrial);
      if (next < residual * (1 - 1e-4 * alpha) || next < ROOT_TOL) {
        x = trial;
        fx = fTrial;
        residual = next;
        improved = true;
        break;
      }
      alpha *= 0.5;
    }
    if (residual < ROOT_TOL) return polishRoot(compiled, x);
    if (!improved) break;
  }
  const polished = polishRoot(compiled, x);
  return infNorm(compiled.f(0, polished, compiled.parameterValues)) < 1e-8 ? polished : null;
}

function seedPoints(dimension: number, radius: number, periodic: boolean[]): number[][] {
  const perAxis = dimension <= 1 ? 21 : dimension === 2 ? 9 : dimension === 3 ? 6 : 4;
  const axes = Array.from({ length: dimension }, (_, index) => {
    const limit = periodic[index] ? Math.min(radius, (3 * Math.PI) / 2) : radius;
    return linspace(-limit, limit, perAxis);
  });
  const seeds: number[][] = [Array(dimension).fill(0)];
  const extras = [0, 1, -1, 0.5, -0.5, Math.PI, -Math.PI, 2, -2, 3];
  for (const value of extras) seeds.push(Array.from({ length: dimension }, () => value));
  const grids = [axes];
  if (dimension === 2) grids.push([linspace(-2, 2, 7), linspace(-2, 2, 7)]);
  for (const grid of grids) {
    const ranges = grid.length === dimension ? grid : axes;
    visitGrid(ranges, (point) => seeds.push(point), dimension >= 4 ? 400 : 2000);
  }
  return seeds;
}

function visitGrid(axes: number[][], emit: (point: number[]) => void, cap: number): void {
  let count = 0;
  const point = Array(axes.length).fill(0);
  const walk = (index: number) => {
    if (count >= cap) return;
    if (index === axes.length) {
      emit(point.slice());
      count += 1;
      return;
    }
    for (const value of axes[index] ?? [0]) {
      point[index] = value;
      walk(index + 1);
    }
  };
  walk(0);
}

function linspace(min: number, max: number, count: number): number[] {
  if (count <= 1) return [(min + max) / 2];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function insidePeriodicWindow(root: number[], periodic: boolean[]): boolean {
  const limit = (3 * Math.PI) / 2 + 0.05;
  return root.every((value, index) => !periodic[index] || Math.abs(value) <= limit);
}

function isContinuum(compiled: CompiledSystem, roots: number[][]): boolean {
  if (roots.length < 8) return false;
  let aligned = 0;
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const mid = roots[i]!.map((value, index) => 0.5 * (value + (roots[j]?.[index] ?? 0)));
      if (infNorm(compiled.f(0, mid, compiled.parameterValues)) < 1e-6) aligned += 1;
    }
  }
  return aligned > roots.length;
}

function infNorm(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));
}

export function stabilityLatex(kind: StabilityVerdict): string {
  if (kind === 'asymptotically_stable') return 'asymptotically stable';
  if (kind === 'lyapunov_stable') return 'Lyapunov stable';
  if (kind === 'semi_stable') return 'semi-stable';
  if (kind === 'unstable') return 'unstable';
  return 'undetermined';
}

export { latexNumber };
