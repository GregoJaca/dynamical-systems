import { useState } from 'react';
import { useSystemStore } from '../store/useSystemStore';
import { RichText } from './RichText';
import { workedSections, workedSolutionDocument } from './workedSolution';

export function TheoremsPanel() {
  const spec = useSystemStore((state) => state.spec);
  const analysis = useSystemStore((state) => state.analysis);
  const [copied, setCopied] = useState(false);
  const sections = workedSections(spec, analysis);
  const theorems = analysis.global.applicableTheorems;

  const copy = async () => {
    const documentText = workedSolutionDocument(spec, analysis);
    try {
      await navigator.clipboard.writeText(documentText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-[15px]">Worked solution</h3>
        <button type="button" className="text-button" onClick={() => void copy()}>
          {copied ? 'Copied LaTeX' : 'Copy as LaTeX'}
        </button>
      </div>
      {theorems.map((theorem) => (
        <article key={theorem.id}>
          <h3 className="theorem-name">{theorem.name}</h3>
          <p className="citation">{theorem.perkoReference}</p>
          <RichText text={theorem.statementLatex} />
          <RichText text={theorem.applicationToSystemLatex} />
        </article>
      ))}
      {sections
        .filter((section) => section.title !== 'Theorems')
        .map((section) => (
        <section key={section.title} className="space-y-1">
          <h4 className="text-[11px] uppercase tracking-[0.16em] opacity-60">{section.title}</h4>
          {section.latex
            .split(/\n+/)
            .filter((line) => line.trim().length > 0 && !/^\s*(No |\\text\{No )/i.test(line))
            .map((line, index) => (
              <RichText key={`${section.title}-${index}`} text={line} />
            ))}
        </section>
      ))}
    </div>
  );
}
