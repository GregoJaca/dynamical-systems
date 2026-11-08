import type { ApplicableTheorem, EquilibriumAnalysis, NumericAnalysis } from '../core/types';
import { latexNumber } from './algebra';

/**
 * The index of each equilibrium is always computed. It is worth stating only when it
 * constrains a closed orbit: several equilibria, an index of 0, a limit cycle, or a
 * homoclinic or heteroclinic connection.
 */
export function poincareIsRelevant(analysis: Pick<NumericAnalysis, 'equilibria' | 'limitCycles' | 'manifolds'> & { dimension?: number }): boolean {
  const dimension = analysis.dimension ?? analysis.equilibria[0]?.coords.length ?? 0;
  if (dimension !== 2) return false;
  const indexed = analysis.equilibria.filter((eq) => eq.poincareIndex2D !== undefined);
  if (indexed.length === 0) return false;
  if (analysis.limitCycles.length > 0) return true;
  if (analysis.manifolds.some((branch) => branch.connectionType)) return true;
  if (indexed.some((eq) => eq.poincareIndex2D === 0)) return true;
  return indexed.length >= 2;
}

export function poincareIndexLatex(equilibria: EquilibriumAnalysis[]): string {
  const rows = equilibria
    .filter((eq) => eq.poincareIndex2D !== undefined)
    .map((eq) => `${place(eq)} & ${eq.poincareIndex2D}`);
  return `\\begin{array}{ll} ${rows.join(' \\\\ ')} \\end{array}`;
}

function place(eq: EquilibriumAnalysis): string {
  const coords = eq.coordsExactLatex?.length === eq.coords.length ? eq.coordsExactLatex : eq.coords.map((value) => latexNumber(value));
  return `(${coords.join(', ')})`;
}

export function poincareTheorem(analysis: NumericAnalysis): ApplicableTheorem | null {
  if (!poincareIsRelevant(analysis)) return null;
  const closed = analysis.limitCycles.length > 0 || analysis.manifolds.some((branch) => branch.connectionType);
  const zero = analysis.equilibria.some((eq) => eq.poincareIndex2D === 0);
  const application = closed
    ? 'A closed orbit has index +1, so the indices of the equilibria it encloses sum to +1.'
    : zero
      ? 'An equilibrium of index 0 cannot be the only rest point inside a periodic orbit.'
      : 'Any periodic orbit must enclose indices that sum to +1.';
  return {
    id: 'poincare-index',
    name: 'Poincaré index theorem',
    perkoReference: 'Perko §3.12',
    statementLatex: 'The index of a closed curve equals the sum of the indices of the equilibria it encloses. A periodic orbit has index +1.',
    applicationToSystemLatex: `${application} ${poincareIndexLatex(analysis.equilibria)}`,
  };
}
