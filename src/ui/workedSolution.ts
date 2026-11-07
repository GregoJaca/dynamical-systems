import type { EquilibriumAnalysis, NumericAnalysis, SystemSpec } from '../core/types';
import { complexLatex, coordList, matrixLatex, prettyLabel, rationalLabel, vectorLatex } from './format';

export interface SolutionSection {
  title: string;
  latex: string;
}

function equilibriumBlock(eq: EquilibriumAnalysis): string {
  const lines = [
    `\\[${coordList(eq.coords, eq.coordsExactLatex)}\\]`,
    eq.familyFormulaLatex ? `Family: \\(${eq.familyFormulaLatex}\\)` : '',
    `\\[J = ${eq.jacobianExactLatex || matrixLatex(eq.jacobianNumeric)}\\]`,
    `\\[\\operatorname{tr} J = ${eq.trace.exactLatex || rationalLabel(eq.trace.value)},\\quad \\det J = ${eq.determinant.exactLatex || rationalLabel(eq.determinant.value)}\\]`,
    eq.discriminant2D
      ? `\\[\\tau^2 - 4\\Delta = ${eq.discriminant2D.exactLatex || rationalLabel(eq.discriminant2D.value)}\\]`
      : '',
    `Eigenvalues: \\(${eq.eigenvalues.map((lambda) => complexLatex(lambda)).join(', ')}\\).`,
    eq.eigenvectors.length
      ? `Eigenvectors: ${eq.eigenvectors.map((vector) => `\\(${vectorLatex(vector)}\\)`).join(', ')}.`
      : '',
    eq.poincareIndex2D !== undefined ? `Poincaré index \\(${eq.poincareIndex2D}\\).` : '',
    `Classification: ${prettyLabel(eq.classification2D ?? eq.classification3D)}. Stability: ${prettyLabel(eq.stability)}.`,
    eq.stabilityReasonLatex ?? '',
    ...eq.subspaces.map((space) => `\\[${space.cartesianFormulaLatex}\\]`),
  ];
  return lines.filter(Boolean).join('\n');
}

export function workedSections(spec: SystemSpec, analysis: NumericAnalysis): SolutionSection[] {
  const systemLatex = spec.latexEquations.length
    ? spec.latexEquations.map((line) => `\\[${line}\\]`).join('\n')
    : spec.rawEquations.map((line) => `\\[${line.replace(/_/g, '\\_')}\\]`).join('\n');
  const sections: SolutionSection[] = [
    { title: 'System', latex: systemLatex || '\\text{No equations yet.}' },
  ];
  if (analysis.equilibria.length) {
    sections.push({
      title: 'Equilibria and linearization',
      latex: analysis.equilibria.map((eq) => equilibriumBlock(eq)).join('\n\n'),
    });
  }
  const manifolds = analysis.manifolds.filter((branch) => branch.taylorSeriesLatex || branch.reducedDynamicsLatex);
  if (manifolds.length) {
    sections.push({
      title: 'Invariant manifolds',
      latex: manifolds
        .map((branch) =>
          [branch.taylorSeriesLatex ? `\\[${branch.taylorSeriesLatex}\\]` : '', branch.reducedDynamicsLatex ? `\\[${branch.reducedDynamicsLatex}\\]` : '']
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n\n'),
    });
  }
  const globalBits = [
    analysis.global.divergenceLatex ? `\\[\\nabla\\cdot f = ${analysis.global.divergenceLatex}\\]` : '',
    analysis.global.hamiltonianLatex
      ? `\\[${analysis.global.hamiltonianLatex.trim().startsWith('H') ? analysis.global.hamiltonianLatex : `H = ${analysis.global.hamiltonianLatex}`}\\]`
      : '',
    analysis.global.potentialFunctionLatex ? `\\[${analysis.global.potentialFunctionLatex}\\]` : '',
    analysis.global.lyapunov
      ? `\\[${analysis.global.lyapunov.vLatex},\\quad ${analysis.global.lyapunov.vDotLatex}\\]\n${analysis.global.lyapunov.conclusionLatex}`
      : '',
    analysis.global.bendixsonDulac?.applies
      ? `\\[${analysis.global.bendixsonDulac.multiplierLatex},\\quad \\nabla\\cdot(Bf) = ${analysis.global.bendixsonDulac.divergenceProductLatex}\\]\n${analysis.global.bendixsonDulac.conclusion}`
      : '',
    analysis.global.linearSystemExact
      ? `\\[e^{At} = ${analysis.global.linearSystemExact.matrixExponentialLatex}\\]\n\\[${analysis.global.linearSystemExact.generalSolutionLatex}\\]`
      : '',
  ].filter(Boolean);
  if (globalBits.length) {
    sections.push({ title: 'Global structure', latex: globalBits.join('\n\n') });
  }
  if (analysis.global.applicableTheorems.length) {
    sections.push({
      title: 'Theorems',
      latex: analysis.global.applicableTheorems
        .map(
          (theorem) =>
            `${theorem.name} (${theorem.perkoReference})\n${theorem.statementLatex}\n${theorem.applicationToSystemLatex}`,
        )
        .join('\n\n'),
    });
  }
  return sections;
}

export function workedSolutionDocument(spec: SystemSpec, analysis: NumericAnalysis): string {
  const body = workedSections(spec, analysis)
    .map((section) => `\\subsection*{${section.title}}\n${section.latex}`)
    .join('\n\n');
  return `\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${body}\n\\end{document}\n`;
}
