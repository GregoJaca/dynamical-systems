import { useSystemStore } from '../store/useSystemStore';
import { Badge, Section } from './bits';
import { complexLatex, coordList, matrixLatex, prettyLabel, rationalLabel, vectorLatex } from './format';
import { Katex } from './Katex';
import { RichText } from './RichText';

export function EquilibriaPanel() {
  const analysis = useSystemStore((state) => state.analysis);
  const selectedId = useSystemStore((state) => state.selectedEquilibriumId);
  const linearization = useSystemStore((state) => state.linearization);
  const cycleCompare = useSystemStore((state) => state.cycleCompare);
  const selectEquilibrium = useSystemStore((state) => state.selectEquilibrium);
  const exact = analysis.global.linearSystemExact;

  return (
    <div className="space-y-4">
      {exact && (
        <Section title="Matrix exponential">
          <div className="space-y-1 rounded-2xl bg-black/10 p-3">
            <Katex tex={`A = ${exact.matrixALatex}`} display />
            <Katex tex={`J = ${exact.jordanFormLatex}`} display />
            <Katex tex={`e^{At} = ${exact.matrixExponentialLatex}`} display />
            <Katex tex={exact.generalSolutionLatex} display />
          </div>
        </Section>
      )}
      {analysis.equilibria.map((eq) => {
        const open = selectedId === eq.id || analysis.equilibria.length <= 4;
        return (
          <details key={eq.id} open={open} className="rounded-2xl border border-slate-400/25 px-3 py-2">
            <summary className="cursor-pointer text-sm" onClick={() => selectEquilibrium(eq.id)}>
              {coordList(eq.coords, eq.coordsExactLatex)} · {prettyLabel(eq.classification2D ?? eq.classification3D ?? eq.stability)}
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              {eq.familyFormulaLatex && <Katex tex={eq.familyFormulaLatex} display />}
              <Katex tex={`J = ${eq.jacobianExactLatex || matrixLatex(eq.jacobianNumeric)}`} display />
              <p>
                tr {eq.trace.exactLatex ? <Katex tex={eq.trace.exactLatex} /> : rationalLabel(eq.trace.value)} · det{' '}
                {eq.determinant.exactLatex ? <Katex tex={eq.determinant.exactLatex} /> : rationalLabel(eq.determinant.value)}
                {eq.discriminant2D && (
                  <>
                    {' '}
                    · Δdisc {eq.discriminant2D.exactLatex ? <Katex tex={eq.discriminant2D.exactLatex} /> : rationalLabel(eq.discriminant2D.value)}
                  </>
                )}
              </p>
              <div className="space-y-1">
                {eq.eigenvalues.map((lambda, index) => (
                  <div key={`${eq.id}-lambda-${index}`} className="flex flex-wrap items-center gap-2">
                    <Katex tex={`\\lambda_{${index + 1}} = ${complexLatex(lambda)}`} />
                    {eq.eigenvectors[index] && <Katex tex={vectorLatex(eq.eigenvectors[index]!)} />}
                    {lambda.multiplicity > 1 && <Badge>mult. {lambda.multiplicity}</Badge>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge tone={eq.isHyperbolic ? 'good' : 'gold'}>{eq.isHyperbolic ? 'Hyperbolic' : 'Nonhyperbolic'}</Badge>
                <Badge>{prettyLabel(eq.stability)}</Badge>
                {eq.hartmanGrobmanApplies && <Badge>Hartman–Grobman</Badge>}
              </div>
              {eq.stabilityReasonLatex && <RichText text={eq.stabilityReasonLatex} />}
              {eq.subspaces.map((space) => (
                <Katex key={`${eq.id}-${space.kind}`} tex={space.cartesianFormulaLatex} display />
              ))}
              {eq.hartmanGrobmanRadius !== undefined && <p className="opacity-70">Faithful radius ≈ {rationalLabel(eq.hartmanGrobmanRadius)}</p>}
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs ${linearization.equilibriumId === eq.id && linearization.mode !== 'off' ? 'bg-[#f0b429]/20 text-[#f0b429]' : 'bg-black/10'}`}
                onClick={() => cycleCompare(eq.id)}
              >
                Compare with linearization
                {linearization.equilibriumId === eq.id && linearization.mode !== 'off' ? ` · ${linearization.mode}` : ''}
              </button>
            </div>
          </details>
        );
      })}
    </div>
  );
}
