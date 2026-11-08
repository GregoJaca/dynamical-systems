import { exampleById, exampleToSpec } from '../src/examples/perkoExamples';
import { compileSystemNumeric } from '../src/input/parser';
import type { CompiledSystem, EquilibriumAnalysis, ManifoldBranch, SystemSpec, ViewportBounds } from '../src/core/types';
import { analyzeGlobal, finalizeGlobal, type GlobalBundle } from '../src/numeric/globalAnalysis';
import { findEquilibriaNumeric } from '../src/numeric/equilibriaNumeric';
import { chooseViewport } from '../src/numeric/viewport';
import { computeManifolds } from '../src/numeric/manifolds';
import { linkConnections } from '../src/numeric/connections';

export interface LightStudy {
  spec: SystemSpec;
  compiled: CompiledSystem;
  bundle: GlobalBundle;
  equilibria: EquilibriumAnalysis[];
  viewport: ViewportBounds;
}

const studies = new Map<string, LightStudy>();
const manifoldStudies = new Map<string, LightStudy & { manifolds: ManifoldBranch[] }>();

export function light(id: string): LightStudy {
  const cached = studies.get(id);
  if (cached) return cached;
  const example = exampleById(id);
  if (!example) throw new Error(`missing ${id}`);
  const spec = exampleToSpec(example);
  const compiled = compileSystemNumeric(spec);
  const bundle = analyzeGlobal(spec, compiled);
  const equilibria = findEquilibriaNumeric({
    compiled,
    dimension: spec.dimension,
    isLinear: spec.isLinear,
    hamiltonian: bundle.global.isHamiltonian,
    reversibleFix: bundle.reversibleFix,
    variableLatex: spec.stateVars,
    periodicVars: spec.stateVars.map((name) => spec.rhsExpressions.some((expr) => new RegExp(`\\b(sin|cos|tan)\\(\\s*${name}\\b`).test(expr))),
    searchRadius: 12,
    rhsExpressions: spec.rhsExpressions,
    stateVars: spec.stateVars,
  });
  finalizeGlobal(spec, compiled, bundle, equilibria, []);
  const study = { spec, compiled, bundle, equilibria, viewport: chooseViewport(spec, equilibria, []) };
  studies.set(id, study);
  return study;
}

export function withManifolds(id: string): LightStudy & { manifolds: ManifoldBranch[] } {
  const cached = manifoldStudies.get(id);
  if (cached) return cached;
  const study = light(id);
  const manifolds = computeManifolds(study.spec, study.compiled, study.equilibria, study.viewport, study.bundle.global.hamiltonianExpr);
  linkConnections(manifolds, study.equilibria);
  const full = { ...study, manifolds };
  manifoldStudies.set(id, full);
  return full;
}

export function fieldAngle(compiled: CompiledSystem, points: number[][]): number {
  let worst = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1] ?? [];
    const b = points[index] ?? [];
    const c = points[index + 1] ?? [];
    const velocity = compiled.f(0, b, compiled.parameterValues);
    const chord = [(c[0] ?? 0) - (a[0] ?? 0), (c[1] ?? 0) - (a[1] ?? 0)];
    const speed = Math.hypot(velocity[0] ?? 0, velocity[1] ?? 0);
    const length = Math.hypot(chord[0] ?? 0, chord[1] ?? 0);
    if (speed < 1e-4 || length < 1e-6) continue;
    const cosine = Math.abs((((velocity[0] ?? 0) * (chord[0] ?? 0) + (velocity[1] ?? 0) * (chord[1] ?? 0)) / (speed * length)));
    worst = Math.max(worst, Math.acos(Math.min(1, cosine)));
  }
  return worst;
}
