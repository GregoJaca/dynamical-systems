import type { NumericAnalysis, StreamlineSegment, ViewportBounds } from '../core/types';
import { coordList, prettyLabel } from '../ui/format';
import { finitePair } from './geometry';

export function objectAnchor(id: string, analysis: NumericAnalysis, userOrbits: StreamlineSegment[]): number[] | null {
  const equilibrium = analysis.equilibria.find((item) => item.id === id);
  if (equilibrium && finitePair(equilibrium.coords)) return equilibrium.coords;
  for (const equilibrium of analysis.equilibria) {
    if (id.startsWith(`${equilibrium.id}:`) && finitePair(equilibrium.coords)) return equilibrium.coords;
  }
  const manifold = analysis.manifolds.find((item) => item.id === id);
  if (manifold) return midpoint(manifold.points);
  const streamline = [...analysis.streamlines, ...userOrbits].find((item) => item.id === id);
  if (streamline) return midpoint(streamline.points);
  const cycle = analysis.limitCycles.find((item) => item.id === id);
  if (cycle) return midpoint(cycle.points);
  const nullcline = analysis.nullclines.find((item) => item.id === id);
  if (nullcline) return midpoint(nullcline.points[0] ?? []);
  return null;
}

function midpoint(points: number[][]): number[] | null {
  const finite = points.filter(finitePair);
  if (finite.length === 0) return null;
  const pick = finite[Math.floor(finite.length / 2)];
  return pick ? [pick[0], pick[1]] : null;
}

export function objectFormula(id: string, analysis: NumericAnalysis, userOrbits: StreamlineSegment[]): string | null {
  const equilibrium = analysis.equilibria.find((item) => item.id === id);
  if (equilibrium) {
    const label = equilibrium.classification2D ?? equilibrium.classification3D;
    const parts = [
      label ? prettyLabel(label) : undefined,
      equilibrium.stabilityReasonLatex,
      equilibrium.familyFormulaLatex,
    ].filter((part): part is string => !!part && part.trim().length > 0);
    return swapIds(parts.join('\\\\'), analysis) || null;
  }
  const subspace = subspaceFormula(id, analysis);
  if (subspace) return subspace;
  const manifold = analysis.manifolds.find((item) => item.id === id);
  if (manifold) {
    const home = analysis.equilibria.find((item) => item.id === manifold.equilibriumId);
    const place = home ? coordList(home.coords, home.coordsExactLatex) : '';
    return swapIds(manifold.taylorSeriesLatex || manifold.reducedDynamicsLatex || `${manifold.kind} of ${place}`, analysis);
  }
  const streamline = [...analysis.streamlines, ...userOrbits].find((item) => item.id === id);
  if (streamline) return swapIds(streamline.formulaOrDescriptionLatex || streamline.reasonTag || '', analysis) || null;
  const cycle = analysis.limitCycles.find((item) => item.id === id);
  if (cycle) return cycle.formulaLatex || `\\Gamma:\\; T \\approx ${cycle.period?.toPrecision(3) ?? '?'}`;
  const nullcline = analysis.nullclines.find((item) => item.id === id);
  if (nullcline) return nullcline.formulaLatex;
  return null;
}

function swapIds(text: string, analysis: NumericAnalysis): string {
  return text.replace(/\beq-\d+\b/g, (id) => {
    const eq = analysis.equilibria.find((item) => item.id === id);
    return eq ? coordList(eq.coords, eq.coordsExactLatex) : id;
  });
}

function subspaceFormula(id: string, analysis: NumericAnalysis): string | null {
  for (const equilibrium of analysis.equilibria) {
    for (const subspace of equilibrium.subspaces) {
      if (`${equilibrium.id}:${subspace.kind}` === id) return subspace.cartesianFormulaLatex || subspace.kind;
    }
  }
  return null;
}

export function viewportKey(viewport: ViewportBounds): string {
  const round = (value: number) => (Number.isFinite(value) ? value.toFixed(4) : 'nan');
  return [viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax].map(round).join(',');
}
