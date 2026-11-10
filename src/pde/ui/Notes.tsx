import { useState } from 'react';
import { Katex } from '../../ui/Katex';
import { checkAnswer } from '../check';
import { usePdeStore } from '../store';
import type { CheckReport } from '../types';

function quantity(value: number): string {
  if (!Number.isFinite(value)) return 'unavailable';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(2);
  return String(Math.round(value * 1e4) / 1e4);
}

export function Notes() {
  const problem = usePdeStore((state) => state.problem);
  const solution = usePdeStore((state) => state.solution);
  const [answer, setAnswer] = useState('');
  const [report, setReport] = useState<CheckReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkError, setCheckError] = useState('');

  const copy = async () => {
    const text = solution?.workedLatex ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    window.setTimeout(() => setCopied(false), 1600);
  };

  const check = () => {
    if (!problem || !solution) return;
    setCheckError('');
    try {
      setReport(checkAnswer(problem, solution, answer));
    } catch (error) {
      setReport(null);
      setCheckError(error instanceof Error ? error.message : 'Could not check that answer.');
    }
  };

  if (!solution || !problem) {
    return (
      <div className="notes-page">
        <p className="status">The notes appear once the problem has a solution.</p>
      </div>
    );
  }

  return (
    <div className="notes-page">
      <p className="note-exports">
        <button type="button" className="text-button" onClick={() => void copy()}>
          {copied ? 'Copied LaTeX' : 'Copy LaTeX'}
        </button>
      </p>
      {solution.notes.map((note) => (
        <section key={note.id}>
          <h2>{note.title}</h2>
          <Katex tex={note.latex} />
        </section>
      ))}
      <section>
        <h2>Check an answer</h2>
        <textarea
          className="eq-input pde-draft"
          aria-label="Your answer"
          spellCheck={false}
          value={answer}
          rows={5}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <p className="note-exports">
          <button type="button" className="real-button" disabled={!answer.trim()} onClick={check}>
            Check this answer
          </button>
        </p>
        {checkError ? <p className="status error">{checkError}</p> : null}
        {report ? (
          <>
            <p>{report.ok ? 'The answer matches.' : 'The answer does not match.'}</p>
            <p>The PDE residual is {quantity(report.pdeResidual)}.</p>
            <p>The initial residual is {quantity(report.initialResidual)}.</p>
            <p>The boundary residual is {quantity(report.boundaryResidual)}.</p>
            <p>The difference from this tool is {quantity(report.differenceFromTool)}.</p>
            {report.diagnoses.map((line) => (
              <p key={line}>
                <Katex tex={line} />
              </p>
            ))}
          </>
        ) : null}
      </section>
    </div>
  );
}
