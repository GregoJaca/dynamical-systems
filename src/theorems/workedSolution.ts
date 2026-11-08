import type { EquilibriumAnalysis, NumericAnalysis, SystemSpec } from '../core/types';
import { parse } from 'mathjs';
import { paintSymbolLatex, symbolToLatex } from '../input/parser';
import { applicableTheorems, eigenvalueLatex, equilibriumLatex } from './theoremRegistry';

function num(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-10) return '0';
  return String(Math.round(value * 1e8) / 1e8);
}

type WorkedSpec = Pick<SystemSpec, 'latexEquations' | 'stateVars' | 'rhsExpressions' | 'isAutonomous' | 'isLinear' | 'dimension' | 'userLyapunovExpr'>;

function systemDisplay(analysis: NumericAnalysis, spec?: WorkedSpec): string {
  if (spec?.latexEquations?.length) {
    return spec.latexEquations.map((equation) => equation.trim()).join(' \\\\\n');
  }
  const names = spec?.stateVars ?? [];
  const rhs = spec?.rhsExpressions ?? [];
  if (names.length > 0 && rhs.length === names.length) {
    const symbols = [...names];
    return names
      .map((name, index) => {
        const expr = rhs[index] ?? '0';
        let rendered = expr;
        try {
          rendered = paintSymbolLatex(parse(expr).toTex(), symbols);
        } catch {
          rendered = paintSymbolLatex(expr, symbols);
        }
        return `\\dot{${symbolToLatex(name)}} = ${rendered}`;
      })
      .join(' \\\\\n');
  }
  if (analysis.global.symbolicJacobianLatex) {
    return `J(x) = ${analysis.global.symbolicJacobianLatex}`;
  }
  return '\\dot x = f(x)';
}

function equilibriumBlock(eq: EquilibriumAnalysis): string {
  const lines = [
    `\\item Equilibrium $${equilibriumLatex(eq)}$${eq.familyFormulaLatex ? `, in the family $${eq.familyFormulaLatex}$` : ''}.`,
  ];
  if (eq.jacobianExactLatex) lines.push(`Jacobian $J = ${eq.jacobianExactLatex}$.`);
  const spectrum = eigenvalueLatex(eq);
  if (spectrum) lines.push(`Eigenvalues: $${spectrum}$.`);
  const trace = eq.trace.exactLatex ?? num(eq.trace.value);
  const det = eq.determinant.exactLatex ?? num(eq.determinant.value);
  lines.push(`Trace $${trace}$, determinant $${det}$.`);
  if (eq.classification2D) lines.push(`Planar type: $${eq.classification2D.replaceAll('_', '\\ ')}$.`);
  if (eq.classification3D) lines.push(`Spatial type: $${eq.classification3D.replaceAll('_', '\\ ')}$.`);
  lines.push(`Stability: $${eq.stability.replaceAll('_', '\\ ')}$. ${eq.stabilityReasonLatex}`);
  for (const space of eq.subspaces) {
    lines.push(`$${space.cartesianFormulaLatex}$.`);
  }
  return lines.join('\n');
}

/** Rule-based homework writeup. Symbolic formulas are quoted from the analysis; nothing is invented. */
export function buildWorkedSolutionLatex(analysis: NumericAnalysis, spec?: WorkedSpec): string {
  const theorems = applicableTheorems(analysis, {
    isAutonomous: spec?.isAutonomous,
    isLinear: spec?.isLinear,
    dimension: spec?.dimension,
  });
  const sections: string[] = [
    '\\section*{Worked solution}',
    '\\subsection*{System}',
    `\\[\\begin{aligned}\n${systemDisplay(analysis, spec)}\n\\end{aligned}\\]`,
  ];
  if (spec?.isLinear) sections.push('The vector field is linear, so the phase portrait is determined by the Jordan form of $A$.');
  if (analysis.equilibria.length > 0) {
    sections.push('\\subsection*{Equilibria and linearization}');
    sections.push('\\begin{enumerate}');
    for (const eq of analysis.equilibria) sections.push(equilibriumBlock(eq));
    sections.push('\\end{enumerate}');
  }

  const linear = analysis.global.linearSystemExact;
  if (linear) {
    sections.push('\\subsection*{Matrix exponential}');
    sections.push(`\\[A = ${linear.matrixALatex}, \\qquad J = ${linear.jordanFormLatex}.\\]`);
    sections.push(`\\[e^{At} = ${linear.matrixExponentialLatex}, \\qquad ${linear.generalSolutionLatex}.\\]`);
  }

  const manifolds = analysis.manifolds.filter((branch) => branch.taylorSeriesLatex || branch.reducedDynamicsLatex);
  if (manifolds.length > 0) {
    sections.push('\\subsection*{Invariant manifolds}');
    sections.push('\\begin{itemize}');
    for (const branch of manifolds) {
      const formula = branch.taylorSeriesLatex ?? '';
      const reduced = branch.reducedDynamicsLatex ? ` Reduced dynamics: $${branch.reducedDynamicsLatex}$.` : '';
      sections.push(`\\item $${formula}$.${reduced}`);
    }
    sections.push('\\end{itemize}');
  }

  sections.push('\\subsection*{Global structure}');
  const globalLines = [
    `Divergence: $\\nabla\\cdot f = ${analysis.global.divergenceLatex}$${analysis.global.isDivergenceFree ? ', identically zero' : ''}.`,
  ];
  if (analysis.global.curl2DLatex) globalLines.push(`Planar curl: $${analysis.global.curl2DLatex}$.`);
  if (analysis.global.isHamiltonian && analysis.global.hamiltonianLatex) {
    globalLines.push(`Hamiltonian: $${analysis.global.hamiltonianLatex.trim().startsWith('H') ? analysis.global.hamiltonianLatex : `H = ${analysis.global.hamiltonianLatex}`}$, with $\\dot x = H_y$ and $\\dot y = -H_x$.`);
  }
  if (analysis.global.isGradientSystem && analysis.global.potentialFunctionLatex) {
    globalLines.push(`Gradient structure: $f = -\\nabla V$ with $V = ${analysis.global.potentialFunctionLatex}$.`);
  }
  if (analysis.global.symmetries.length > 0) {
    globalLines.push(
      `Symmetries: ${analysis.global.symmetries.map((symmetry) => `$${symmetry.formulaLatex}$ (${symmetry.geometricImplication})`).join('; ')}.`,
    );
  }
  if (analysis.global.bendixsonDulac?.applies) {
    const dulac = analysis.global.bendixsonDulac;
    globalLines.push(`Bendixson–Dulac multiplier $${dulac.multiplierLatex}$, and $\\nabla\\cdot(Bf) = ${dulac.divergenceProductLatex}$. ${dulac.conclusion}.`);
  }
  if (analysis.global.lyapunov && analysis.global.lyapunov.classification !== 'indefinite') {
    const lyapunov = analysis.global.lyapunov;
    globalLines.push(`Lyapunov function ($\\mathrm{${lyapunov.source}}$): $${lyapunov.vLatex}$, $${lyapunov.vDotLatex}$. ${lyapunov.conclusionLatex}`);
  }
  const polar = analysis.coordinateTransforms.polar2D;
  if (polar?.isRecommended) {
    globalLines.push(
      `Polar form: $${polar.rDotLatex}$, $${polar.thetaDotLatex}$.${polar.isRecommended ? ` Recommended: ${polar.recommendationReason ?? 'polar coordinates simplify the field'}.` : ''}`,
    );
  }
  const cylindrical = analysis.coordinateTransforms.cylindrical3D;
  if (cylindrical?.isRecommended) {
    globalLines.push(
      `Cylindrical form: $${cylindrical.rDotLatex}$, $${cylindrical.thetaDotLatex}$, $${cylindrical.zDotLatex}$.`,
    );
  }
  const spherical = analysis.coordinateTransforms.spherical3D;
  if (spherical?.isRecommended) {
    globalLines.push(
      `Spherical form: $${spherical.rhoDotLatex}$, $${spherical.thetaDotLatex}$, $${spherical.phiDotLatex}$.`,
    );
  }
  sections.push(globalLines.join('\n\n'));

  if (theorems.length > 0) {
    sections.push('\\subsection*{Theorems used}');
    sections.push('\\begin{enumerate}');
    for (const item of theorems) {
      sections.push(
        `\\item \\textbf{${item.name}} (${item.perkoReference}). ${item.statementLatex}\\\\ Application: ${item.applicationToSystemLatex}`,
      );
    }
    sections.push('\\end{enumerate}');
  }

  return sections.join('\n\n');
}
