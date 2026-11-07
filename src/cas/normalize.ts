import type {
  CasEnrichment,
  CasEquilibriumPatch,
  CasManifoldSeries,
  ComplexEigenvalue,
  CoordinateTransformAnalysis,
  GlobalPropertiesAnalysis,
  SubspaceInfo,
} from '../core/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const coords: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    coords.push(entry);
  }
  return coords;
}

function numberMatrix(value: unknown): number[][] | null {
  if (!Array.isArray(value)) return null;
  const rows: number[][] = [];
  for (const row of value) {
    const parsed = numberArray(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

function eigenvalue(value: unknown): ComplexEigenvalue | null {
  if (!isRecord(value)) return null;
  if (typeof value.re !== 'number' || typeof value.im !== 'number') return null;
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return null;
  const multiplicity = typeof value.multiplicity === 'number' ? value.multiplicity : 1;
  if (!Number.isFinite(multiplicity) || multiplicity < 1) return null;
  return {
    re: value.re,
    im: value.im,
    multiplicity,
    ...(typeof value.exactLatex === 'string' ? { exactLatex: value.exactLatex } : {}),
  };
}

function subspace(value: unknown): SubspaceInfo | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'Es' && value.kind !== 'Eu' && value.kind !== 'Ec') return null;
  const basisVectors = numberMatrix(value.basisVectors);
  if (!basisVectors) return null;
  const basisExactLatex = Array.isArray(value.basisExactLatex)
    ? value.basisExactLatex.filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (typeof value.cartesianFormulaLatex !== 'string') return null;
  const dimension = typeof value.dimension === 'number' ? value.dimension : basisVectors.length;
  return {
    kind: value.kind,
    dimension,
    basisVectors,
    basisExactLatex,
    cartesianFormulaLatex: value.cartesianFormulaLatex,
  };
}

function patch(value: unknown): CasEquilibriumPatch | null {
  if (!isRecord(value)) return null;
  const matchCoords = numberArray(value.matchCoords);
  if (!matchCoords) return null;
  const eigenvalues = Array.isArray(value.eigenvalues)
    ? value.eigenvalues.map(eigenvalue).filter((entry): entry is ComplexEigenvalue => entry !== null)
    : undefined;
  const subspaces = Array.isArray(value.subspaces)
    ? value.subspaces.map(subspace).filter((entry): entry is SubspaceInfo => entry !== null)
    : undefined;
  return {
    matchCoords,
    ...(Array.isArray(value.coordsExactLatex) ? { coordsExactLatex: value.coordsExactLatex.filter((e) => typeof e === 'string') } : {}),
    ...(typeof value.familyFormulaLatex === 'string' ? { familyFormulaLatex: value.familyFormulaLatex } : {}),
    ...(typeof value.jacobianExactLatex === 'string' ? { jacobianExactLatex: value.jacobianExactLatex } : {}),
    ...(isRecord(value.trace) && typeof value.trace.value === 'number'
      ? { trace: value.trace as unknown as CasEquilibriumPatch['trace'] }
      : {}),
    ...(isRecord(value.determinant) && typeof value.determinant.value === 'number'
      ? { determinant: value.determinant as unknown as CasEquilibriumPatch['determinant'] }
      : {}),
    ...(isRecord(value.discriminant2D) && typeof value.discriminant2D.value === 'number'
      ? { discriminant2D: value.discriminant2D as unknown as CasEquilibriumPatch['discriminant2D'] }
      : {}),
    ...(eigenvalues && eigenvalues.length > 0 ? { eigenvalues } : {}),
    ...(subspaces && subspaces.length > 0 ? { subspaces } : {}),
    ...(typeof value.stabilityReasonLatex === 'string' ? { stabilityReasonLatex: value.stabilityReasonLatex } : {}),
    ...(typeof value.classification2D === 'string'
      ? { classification2D: value.classification2D as CasEquilibriumPatch['classification2D'] }
      : {}),
    ...(typeof value.classification3D === 'string'
      ? { classification3D: value.classification3D as CasEquilibriumPatch['classification3D'] }
      : {}),
    ...(typeof value.stability === 'string' ? { stability: value.stability as CasEquilibriumPatch['stability'] } : {}),
    ...(value.sourceMethod === 'exact_sympy' ? { sourceMethod: 'exact_sympy' as const } : {}),
  };
}

function series(value: unknown): CasManifoldSeries | null {
  if (!isRecord(value)) return null;
  const matchCoords = numberArray(value.matchCoords);
  if (!matchCoords) return null;
  if (value.kind !== 'Ws' && value.kind !== 'Wu' && value.kind !== 'Wc') return null;
  if (typeof value.taylorSeriesLatex !== 'string' || value.taylorSeriesLatex.length === 0) return null;
  return {
    matchCoords,
    kind: value.kind,
    taylorSeriesLatex: value.taylorSeriesLatex,
    ...(typeof value.reducedDynamicsLatex === 'string' ? { reducedDynamicsLatex: value.reducedDynamicsLatex } : {}),
  };
}

export function normalizeEnrichment(revision: number, value: unknown): CasEnrichment {
  const record = isRecord(value) ? value : {};
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    revision: typeof record.revision === 'number' ? record.revision : revision,
    equilibriaPatches: Array.isArray(record.equilibriaPatches)
      ? record.equilibriaPatches.map(patch).filter((entry): entry is CasEquilibriumPatch => entry !== null)
      : [],
    manifoldSeries: Array.isArray(record.manifoldSeries)
      ? record.manifoldSeries.map(series).filter((entry): entry is CasManifoldSeries => entry !== null)
      : [],
    ...(isRecord(record.coordinateTransforms)
      ? { coordinateTransforms: record.coordinateTransforms as CoordinateTransformAnalysis }
      : {}),
    ...(isRecord(record.global) ? { global: record.global as Partial<GlobalPropertiesAnalysis> } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
