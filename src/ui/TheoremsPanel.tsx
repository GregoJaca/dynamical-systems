import { useState } from 'react';
import { useSystemStore } from '../store/useSystemStore';
import { Katex } from './Katex';
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
        <button type="button" className="rounded-full bg-[#f0b429] px-3 py-1 text-xs font-semibold text-[#1c1404]" onClick={() => void copy()}>
          {copied ? 'Copied LaTeX' : 'Copy as LaTeX'}
        </button>
      </div>
      {theorems.map((theorem) => (
        <article key={theorem.id} className="rounded-2xl border border-slate-400/25 p-3">
          <p className="text-sm font-semibold">{theorem.name}</p>
          <p className="text-[11px] uppercase tracking-wide opacity-60">{theorem.perkoReference}</p>
          <Katex tex={theorem.statementLatex} display />
          <Katex tex={theorem.applicationToSystemLatex} display />
        </article>
      ))}
      {theorems.length === 0 && <p className="text-sm opacity-70">Applicable Perko theorems are attached when the symbolic pass recognizes them. The numeric portrait still has a worked write-up below.</p>}
      {sections.map((section) => (
        <section key={section.title} className="space-y-1">
          <h4 className="text-[11px] uppercase tracking-[0.16em] opacity-60">{section.title}</h4>
          {section.latex
            .split(/\n+/)
            .filter((line) => line.trim().length > 0)
            .map((line, index) => {
              const display = line.includes('\\[') || line.startsWith('\\begin');
              const tex = line.replace(/^\\\[/, '').replace(/\\\]$/, '');
              return <Katex key={`${section.title}-${index}`} tex={tex} display={display} />;
            })}
        </section>
      ))}
    </div>
  );
}
