import { useEffect, useState } from 'react';
import type { ParameterSpec } from '../../core/types';
import { parseUserNumber, rationalLabel } from '../../ui/format';
import { Katex } from '../../ui/Katex';
import { exprToLatex } from '../expr';
import { usePdeStore } from '../store';
import type { CharProblem, EndCondition, HeatProblem, PdeProblem } from '../types';

function safeLatex(raw: string): string {
  try {
    return exprToLatex(raw);
  } catch {
    return raw.replace(/_/g, '\\_');
  }
}

function endLatex(end: EndCondition): string {
  const at = safeLatex(end.at);
  const value = safeLatex(end.valueExpr);
  if (end.kind === 'dirichlet') return `u(${at}, t) = ${value}`;
  if (end.kind === 'neumann') return `u_{x}(${at}, t) = ${value}`;
  const h = safeLatex(end.hExpr ?? '1');
  return `u_{x}(${at}, t) + ${h}\\, u(${at}, t) = ${value}`;
}

function heatDomain(problem: HeatProblem): string {
  const domain = problem.domain;
  if (domain.kind === 'interval') return `${safeLatex(domain.leftExpr)} < x < ${safeLatex(domain.rightExpr)}`;
  if (domain.kind === 'line') return 'x \\in \\mathbb{R}';
  if (domain.kind === 'half') return 'x > 0';
  if (domain.kind === 'rectangle') {
    return `${safeLatex(domain.x0)} < x < ${safeLatex(domain.x1)},\\ ${safeLatex(domain.y0)} < y < ${safeLatex(domain.y1)}`;
  }
  return `r < ${safeLatex(domain.radiusExpr)}`;
}

function heatBoundary(problem: HeatProblem): string | null {
  const domain = problem.domain;
  if (domain.kind === 'interval') {
    if (domain.periodic) return '\\text{periodic}';
    return `${endLatex(domain.left)},\\quad ${endLatex(domain.right)}`;
  }
  if (domain.kind === 'half') return endLatex(domain.bc);
  if (domain.kind === 'rectangle' || domain.kind === 'disk') return domain.bc === 'neumann' ? 'u_n = 0' : 'u = 0';
  return null;
}

function heatInitial(problem: HeatProblem): string {
  const value = safeLatex(problem.initialExpr);
  if (problem.spatial === 'xy') return `u(x, y, 0) = ${value}`;
  if (problem.spatial === 'radial') return `u(r, 0) = ${value}`;
  return `u(x, 0) = ${value}`;
}

function charDomain(problem: CharProblem): string {
  const line = problem.lines.find((item) => !item.includes('=') && /[<≤≥>]|disk|circle|\bin\b|∈/.test(item));
  if (!line) return problem.vars === 'xy' ? '(x, y)' : '(x, t)';
  return line
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/\bpi\b/g, '\\pi');
}

function charInitial(problem: CharProblem): string {
  const data = problem.data;
  if (data.kind === 'cauchy') return `u(x, ${safeLatex(data.timeExpr)}) = ${safeLatex(data.gExpr)}`;
  if (data.kind === 'point') return `u(${safeLatex(data.xExpr)}, ${safeLatex(data.yExpr)}) = ${safeLatex(data.uExpr)}`;
  return `u(x, 0) = ${safeLatex(data.gExpr)}`;
}

function Readout({ problem }: { problem: PdeProblem }) {
  const equation = problem.equationLatex;
  const domain = problem.family === 'heat' ? heatDomain(problem) : problem.family === 'classify' ? '(x, y)' : charDomain(problem);
  const boundary = problem.family === 'heat' ? heatBoundary(problem) : problem.family === 'characteristics' && problem.data.kind === 'strip' ? endLatex(problem.data.left) : null;
  const initial = problem.family === 'heat' ? heatInitial(problem) : problem.family === 'classify' ? '\\text{no initial condition}' : charInitial(problem);
  return (
    <div className="system-preview">
      <Katex tex={equation} display />
      <p>
        Domain <Katex tex={domain} />
      </p>
      <p>{boundary ? <>Boundary <Katex tex={boundary} /></> : 'There is no boundary condition.'}</p>
      <p>
        Initial data <Katex tex={initial} />
      </p>
    </div>
  );
}

function ParameterControl({ spec }: { spec: ParameterSpec }) {
  const setParameter = usePdeStore((state) => state.setParameter);
  const [text, setText] = useState(rationalLabel(spec.value));
  useEffect(() => setText(rationalLabel(spec.value)), [spec.value]);

  const commit = () => {
    const value = parseUserNumber(text);
    if (value === null) {
      setText(rationalLabel(spec.value));
      return;
    }
    setParameter(spec.name, value);
  };

  return (
    <label className="parameter">
      <Katex tex={spec.latex} />
      <input
        aria-label={`${spec.name} slider`}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={spec.value}
        onChange={(event) => setParameter(spec.name, Number(event.target.value))}
      />
      <input
        aria-label={`${spec.name} value`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

export function ProblemForm() {
  const draft = usePdeStore((state) => state.draft);
  const problem = usePdeStore((state) => state.problem);
  const error = usePdeStore((state) => state.error);
  const solution = usePdeStore((state) => state.solution);
  const setDraft = usePdeStore((state) => state.setDraft);
  const setView = usePdeStore((state) => state.setView);
  const parameters = problem ? Object.values(problem.parameters) : [];

  return (
    <form
      className="system-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem) setView('study');
      }}
    >
      <textarea
        className="eq-input pde-draft"
        aria-label="Problem"
        spellCheck={false}
        value={draft}
        rows={8}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? <p className="status error">{error}</p> : null}
      {problem ? <Readout problem={problem} /> : null}
      {solution?.warnings.filter(Boolean).map((warning) => (
        <p key={warning} className="status">
          {warning}
        </p>
      ))}
      {parameters.length > 0 && (
        <div className="parameters">
          {parameters.map((parameter) => (
            <ParameterControl key={parameter.name} spec={parameter} />
          ))}
        </div>
      )}
      <div className="actions">
        <button type="submit" disabled={!problem}>
          Study this problem
        </button>
      </div>
    </form>
  );
}
