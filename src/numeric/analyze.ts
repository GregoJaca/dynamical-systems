import { parse } from 'mathjs';
import type { NumericAnalysis, SystemSpec } from '../core/types';
import { compileSystemNumeric, symbolToLatex } from '../input/parser';
import { findEquilibriaNumeric } from './equilibriaNumeric';
import { linkConnections } from './connections';
import { attachCenterManifolds3D } from './centerManifold3d';
import { analyzeGlobal, cyclesFromPolar, finalizeGlobal } from './globalAnalysis';
import { findIsolatedCycles } from './isolatedCycles';
import { computeManifolds } from './manifolds';
import { computeManifoldSurfaces } from './manifolds3d';
import { poincareTheorem } from './poincareReport';
import { computeNullclines } from './nullclines';
import { generateCharacteristicOrbits, generateStreamlines } from './streamlines';
import { chooseViewport } from './viewport';

/** Full numeric phase-portrait analysis. No Pyodide and no symbolic CAS. */
export function analyzeNumeric(spec: SystemSpec): NumericAnalysis {
  const compiled = compileSystemNumeric(spec);
  const bundle = analyzeGlobal(spec, compiled);
  const equilibria = findEquilibriaNumeric({
    compiled,
    dimension: spec.dimension,
    isLinear: spec.isLinear,
    hamiltonian: bundle.global.isHamiltonian,
    reversibleFix: bundle.reversibleFix,
    variableLatex: spec.stateVars.map((name) => symbolToLatex(name)),
    periodicVars: spec.stateVars.map((name) => periodicIn(spec.rhsExpressions, name)),
    searchRadius: searchRadius(spec),
    rhsExpressions: spec.rhsExpressions,
    stateVars: spec.stateVars,
  });
  const viewport = chooseViewport(spec, equilibria, []);
  const manifolds = spec.dimension === 2 ? computeManifolds(spec, compiled, equilibria, viewport, bundle.global.hamiltonianExpr) : [];
  linkConnections(manifolds, equilibria);
  finalizeGlobal(spec, compiled, bundle, equilibria, []);
  let limitCycles = bundle.polar ? cyclesFromPolar(bundle.polar) : [];
  if (limitCycles.length === 0 && !bundle.global.bendixsonDulac?.applies && !bundle.global.isHamiltonian && spec.dimension === 2) {
    limitCycles = findIsolatedCycles(compiled, equilibria, viewport);
  }
  const framed = limitCycles.length > 0 ? chooseViewport(spec, equilibria, limitCycles) : viewport;
  const streamlines =
    spec.dimension === 2
      ? generateStreamlines(compiled, framed, equilibria, manifolds)
      : generateCharacteristicOrbits(compiled, framed, equilibria);
  const nullclines = spec.dimension === 2 ? computeNullclines(compiled, framed, spec.rhsExpressions) : [];
  const hyperbolicSurfaces = spec.dimension === 3 ? computeManifoldSurfaces(compiled, equilibria, framed) : [];
  const centerSurfaces = spec.dimension === 3 ? attachCenterManifolds3D(spec, equilibria) : [];
  const manifoldSurfaces = [...hyperbolicSurfaces, ...centerSurfaces];
  const analysis = {
    revision: spec.revision,
    equilibria,
    streamlines,
    manifolds,
    manifoldSurfaces,
    nullclines,
    limitCycles,
    coordinateTransforms: {
      polar2D: bundle.polar,
      cylindrical3D: bundle.cylindrical,
      spherical3D: bundle.spherical,
    },
    global: bundle.global,
    viewport: framed,
  };
  const indexTheorem = poincareTheorem(analysis);
  analysis.global.applicableTheorems = analysis.global.applicableTheorems.filter((theorem) => theorem.id !== 'poincare-index');
  if (indexTheorem) analysis.global.applicableTheorems.push(indexTheorem);
  return analysis;
}

function searchRadius(spec: SystemSpec): number {
  let largest = 0;
  for (const expr of spec.rhsExpressions) {
    parse(expr).traverse((node) => {
      if (node.type === 'ConstantNode') {
        const constant = node as { value?: number | string };
        largest = Math.max(largest, Math.abs(Number(constant.value)));
      }
    });
  }
  for (const parameter of Object.values(spec.parameters)) largest = Math.max(largest, Math.abs(parameter.value));
  return Math.min(48, Math.max(6, 1.65 * largest));
}

function periodicIn(rhs: string[], variable: string): boolean {
  const pattern = new RegExp(`\\b(sin|cos|tan)\\(\\s*${variable}\\b`);
  return rhs.some((expr) => pattern.test(expr));
}

