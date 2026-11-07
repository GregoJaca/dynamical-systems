import type {
  CasEnrichment,
  CasEquilibriumPatch,
  CasManifoldSeries,
  ComplexEigenvalue,
  EquilibriumAnalysis,
  EquilibriumType2D,
  GlobalPropertiesAnalysis,
  ManifoldBranch,
  NumericAnalysis,
  SubspaceInfo,
} from '../core/types';
import { applicableTheorems } from '../theorems/theoremRegistry';

const MATCH_TOLERANCE = 1e-3;

const SUBSPACE_ORDER: Record<SubspaceInfo['kind'], number> = { Es: 0, Ec: 1, Eu: 2 };

const INDEX_BY_CLASS: Partial<Record<EquilibriumType2D, number>> = {
  saddle: -1,
  saddle_node: 0,
  cusp: 0,
  non_isolated_line: 0,
  stable_proper_node: 1,
  unstable_proper_node: 1,
  stable_improper_node: 1,
  unstable_improper_node: 1,
  stable_degenerate_node: 1,
  unstable_degenerate_node: 1,
  stable_focus: 1,
  unstable_focus: 1,
  linear_center: 1,
  nonlinear_center: 1,
  weak_stable_focus: 1,
  weak_unstable_focus: 1,
};

function infDistance(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  let max = 0;
  for (let index = 0; index < length; index += 1) {
    max = Math.max(max, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
  }
  return max;
}

function traceOf(matrix: number[][]): number {
  return matrix.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
}

function determinantOf(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 1) return matrix[0]?.[0] ?? 0;
  if (n === 2) {
    return (matrix[0]?.[0] ?? 0) * (matrix[1]?.[1] ?? 0) - (matrix[0]?.[1] ?? 0) * (matrix[1]?.[0] ?? 0);
  }
  let det = 0;
  for (let column = 0; column < n; column += 1) {
    const minor = matrix.slice(1).map((row) => row.filter((_, index) => index !== column));
    const sign = column % 2 === 0 ? 1 : -1;
    det += sign * (matrix[0]?.[column] ?? 0) * determinantOf(minor);
  }
  return det;
}

function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const aug = matrix.map((row, rowIndex) => {
    const copy = row.slice();
    for (let column = 0; column < n; column += 1) copy.push(rowIndex === column ? 1 : 0);
    return copy;
  });
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(aug[row]?.[column] ?? 0) > Math.abs(aug[pivot]?.[column] ?? 0)) pivot = row;
    }
    const pivotRow = aug[pivot];
    if (!pivotRow || Math.abs(pivotRow[column] ?? 0) < 1e-10) return null;
    if (pivot !== column) {
      aug[pivot] = aug[column]!;
      aug[column] = pivotRow;
    }
    const scale = aug[column]?.[column] ?? 1;
    for (let entry = 0; entry < 2 * n; entry += 1) aug[column]![entry] = (aug[column]?.[entry] ?? 0) / scale;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = aug[row]?.[column] ?? 0;
      for (let entry = 0; entry < 2 * n; entry += 1) {
        aug[row]![entry] = (aug[row]?.[entry] ?? 0) - factor * (aug[column]?.[entry] ?? 0);
      }
    }
  }
  return aug.map((row) => row.slice(n));
}

function multiply(left: number[][], right: number[][]): number[][] {
  const rows = left.length;
  const inner = right.length;
  const cols = right[0]?.length ?? 0;
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, column) => {
      let sum = 0;
      for (let index = 0; index < inner; index += 1) sum += (left[row]?.[index] ?? 0) * (right[index]?.[column] ?? 0);
      return sum;
    }),
  );
}

/**
 * Rebuild J = P D P^{-1} from the CAS ordering contract:
 * subspaces are consumed Es, then Ec, then Eu; eigenvalues follow that same
 * concatenation. A complex conjugate pair uses columns (Re v, Im v) and the
 * real block [[α, β], [-β, α]] with β = |Im λ|.
 */
function spectralJacobian(patch: CasEquilibriumPatch): number[][] | null {
  const eigenvalues = patch.eigenvalues;
  const subspaces = patch.subspaces;
  if (!eigenvalues?.length || !subspaces?.length) return null;
  const n = patch.matchCoords.length;
  const vectors = [...subspaces]
    .sort((left, right) => SUBSPACE_ORDER[left.kind] - SUBSPACE_ORDER[right.kind])
    .flatMap((space) => space.basisVectors);
  if (vectors.length !== n || vectors.some((vector) => vector.length !== n)) return null;

  const blocks = Array.from({ length: n }, () => Array<number>(n).fill(0));
  let cursor = 0;
  for (let index = 0; index < eigenvalues.length; ) {
    const eigenvalue = eigenvalues[index];
    if (!eigenvalue) return null;
    if (Math.abs(eigenvalue.im) > 1e-8) {
      const next = eigenvalues[index + 1];
      if (!next || eigenvalue.multiplicity !== 1 || next.multiplicity !== 1) return null;
      if (Math.abs(next.re - eigenvalue.re) > 1e-6 || Math.abs(next.im + eigenvalue.im) > 1e-6) return null;
      if (cursor + 2 > n) return null;
      const alpha = eigenvalue.re;
      const beta = Math.abs(eigenvalue.im);
      blocks[cursor]![cursor] = alpha;
      blocks[cursor]![cursor + 1] = beta;
      blocks[cursor + 1]![cursor] = -beta;
      blocks[cursor + 1]![cursor + 1] = alpha;
      cursor += 2;
      index += 2;
      continue;
    }
    const span = eigenvalue.multiplicity;
    if (span < 1 || cursor + span > n) return null;
    for (let offset = 0; offset < span; offset += 1) blocks[cursor + offset]![cursor + offset] = eigenvalue.re;
    cursor += span;
    index += 1;
  }
  if (cursor !== n) return null;

  const basis = Array.from({ length: n }, (_, row) => vectors.map((column) => column[row] ?? 0));
  const inverse = invert(basis);
  if (!inverse) return null;
  return multiply(multiply(basis, blocks), inverse);
}

function inferIndex(classification: EquilibriumType2D | undefined): number | undefined {
  if (!classification) return undefined;
  return INDEX_BY_CLASS[classification];
}

function eigenvalueCount(eigenvalues: ComplexEigenvalue[]): number {
  return eigenvalues.reduce((sum, eigenvalue) => sum + eigenvalue.multiplicity, 0);
}

function applyPatch(eq: EquilibriumAnalysis, patch: CasEquilibriumPatch): EquilibriumAnalysis {
  const eigenvalues = patch.eigenvalues?.length ? patch.eigenvalues : eq.eigenvalues;
  const classification2D = patch.classification2D ?? eq.classification2D;
  const next: EquilibriumAnalysis = {
    ...eq,
    coordsExactLatex: patch.coordsExactLatex ?? eq.coordsExactLatex,
    familyFormulaLatex: patch.familyFormulaLatex ?? eq.familyFormulaLatex,
    jacobianExactLatex: patch.jacobianExactLatex ?? eq.jacobianExactLatex,
    trace: patch.trace ?? eq.trace,
    determinant: patch.determinant ?? eq.determinant,
    discriminant2D: patch.discriminant2D ?? eq.discriminant2D,
    eigenvalues,
    subspaces: patch.subspaces?.length ? patch.subspaces : eq.subspaces,
    stabilityReasonLatex: patch.stabilityReasonLatex ?? eq.stabilityReasonLatex,
    classification2D,
    classification3D: patch.classification3D ?? eq.classification3D,
    stability: patch.stability ?? eq.stability,
    sourceMethod: patch.sourceMethod ?? eq.sourceMethod,
    poincareIndex2D: eq.poincareIndex2D ?? inferIndex(classification2D),
  };
  if (patch.eigenvalues?.length && eigenvalueCount(patch.eigenvalues) === eq.coords.length) {
    const hyperbolic = patch.eigenvalues.every((eigenvalue) => Math.abs(eigenvalue.re) > 1e-8);
    next.isHyperbolic = hyperbolic;
    next.hartmanGrobmanApplies = hyperbolic;
  }
  return next;
}

function synthesizeEquilibrium(patch: CasEquilibriumPatch, index: number): EquilibriumAnalysis | null {
  const jacobian = spectralJacobian(patch);
  if (!jacobian) return null;
  const eigenvalues = patch.eigenvalues ?? [];
  const subspaces = patch.subspaces ?? [];
  const hyperbolic = eigenvalues.every((eigenvalue) => Math.abs(eigenvalue.re) > 1e-8);
  const trace = patch.trace ?? { value: traceOf(jacobian) };
  const determinant = patch.determinant ?? { value: determinantOf(jacobian) };
  return {
    id: `cas-eq-${index}`,
    coords: patch.matchCoords.slice(),
    coordsExactLatex: patch.coordsExactLatex,
    familyFormulaLatex: patch.familyFormulaLatex,
    sourceMethod: 'exact_sympy',
    jacobianNumeric: jacobian,
    jacobianExactLatex: patch.jacobianExactLatex,
    trace,
    determinant,
    discriminant2D: patch.discriminant2D,
    eigenvalues,
    eigenvectors: subspaces.flatMap((space) => space.basisVectors.map((vector) => vector.slice())),
    isHyperbolic: hyperbolic,
    poincareIndex2D: inferIndex(patch.classification2D),
    classification2D: patch.classification2D,
    classification3D: patch.classification3D,
    stability: patch.stability ?? 'undetermined',
    stabilityReasonLatex: patch.stabilityReasonLatex ?? '',
    subspaces,
    hartmanGrobmanApplies: hyperbolic,
  };
}

function matchPatches(equilibria: EquilibriumAnalysis[], patches: CasEquilibriumPatch[]): Map<number, CasEquilibriumPatch> {
  const pairs: Array<{ eqIndex: number; patchIndex: number; distance: number }> = [];
  equilibria.forEach((eq, eqIndex) => {
    patches.forEach((patch, patchIndex) => {
      const distance = infDistance(eq.coords, patch.matchCoords);
      if (distance <= MATCH_TOLERANCE) pairs.push({ eqIndex, patchIndex, distance });
    });
  });
  pairs.sort((left, right) => left.distance - right.distance);
  const usedEq = new Set<number>();
  const usedPatch = new Set<number>();
  const matched = new Map<number, CasEquilibriumPatch>();
  for (const pair of pairs) {
    if (usedEq.has(pair.eqIndex) || usedPatch.has(pair.patchIndex)) continue;
    usedEq.add(pair.eqIndex);
    usedPatch.add(pair.patchIndex);
    const patch = patches[pair.patchIndex];
    if (patch) matched.set(pair.eqIndex, patch);
  }
  return matched;
}

function seriesFor(eq: EquilibriumAnalysis, series: CasManifoldSeries[], kind: CasManifoldSeries['kind']): CasManifoldSeries | undefined {
  return series.find((entry) => entry.kind === kind && infDistance(entry.matchCoords, eq.coords) <= MATCH_TOLERANCE);
}

function enrichManifolds(equilibria: EquilibriumAnalysis[], manifolds: ManifoldBranch[], series: CasManifoldSeries[]): ManifoldBranch[] {
  const next = manifolds.map((branch) => {
    const eq = equilibria.find((candidate) => candidate.id === branch.equilibriumId);
    if (!eq) return branch;
    const match = seriesFor(eq, series, branch.kind);
    if (!match) return branch;
    return {
      ...branch,
      taylorSeriesLatex: match.taylorSeriesLatex,
      reducedDynamicsLatex: match.reducedDynamicsLatex ?? branch.reducedDynamicsLatex,
    };
  });
  const covered = new Set(next.map((branch) => `${branch.equilibriumId}:${branch.kind}`));
  for (const entry of series) {
    const eq = equilibria.find((candidate) => infDistance(candidate.coords, entry.matchCoords) <= MATCH_TOLERANCE);
    if (!eq || covered.has(`${eq.id}:${entry.kind}`)) continue;
    covered.add(`${eq.id}:${entry.kind}`);
    next.push({
      id: `cas-${entry.kind}-${eq.id}`,
      equilibriumId: eq.id,
      kind: entry.kind,
      sign: 1,
      points: [eq.coords.slice()],
      arclength: 0,
      taylorSeriesLatex: entry.taylorSeriesLatex,
      reducedDynamicsLatex: entry.reducedDynamicsLatex,
    });
  }
  return next;
}

function mergeGlobal(base: GlobalPropertiesAnalysis, patch: Partial<GlobalPropertiesAnalysis> | undefined): GlobalPropertiesAnalysis {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    symmetries: patch.symmetries ?? base.symmetries,
    bendixsonDulac: patch.bendixsonDulac ?? base.bendixsonDulac,
    linearSystemExact: patch.linearSystemExact ?? base.linearSystemExact,
    lyapunov: patch.lyapunov ?? base.lyapunov,
    applicableTheorems: base.applicableTheorems,
  };
}

/** Merge exact SymPy fields into a numeric analysis without touching the camera or trajectories. */
export function mergeCas(base: NumericAnalysis, enrichment: CasEnrichment): NumericAnalysis {
  if (enrichment.revision !== base.revision) return base;
  const matched = matchPatches(base.equilibria, enrichment.equilibriaPatches);
  const usedPatches = new Set(matched.values());
  const equilibria = base.equilibria.map((eq, index) => {
    const patch = matched.get(index);
    return patch ? applyPatch(eq, patch) : eq;
  });
  enrichment.equilibriaPatches.forEach((patch, index) => {
    if (usedPatches.has(patch)) return;
    const created = synthesizeEquilibrium(patch, index);
    if (created) equilibria.push(created);
  });
  const merged: NumericAnalysis = {
    ...base,
    equilibria,
    manifolds: enrichManifolds(equilibria, base.manifolds, enrichment.manifoldSeries),
    coordinateTransforms: {
      ...base.coordinateTransforms,
      ...(enrichment.coordinateTransforms ?? {}),
    },
    global: mergeGlobal(base.global, enrichment.global),
  };
  const nonAutonomous = enrichment.warnings?.some((warning) => /non-autonomous/i.test(warning)) ?? false;
  merged.global = {
    ...merged.global,
    applicableTheorems: applicableTheorems(merged, { isAutonomous: !nonAutonomous }),
  };
  return merged;
}
