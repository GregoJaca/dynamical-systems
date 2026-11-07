import { useEffect, useRef, useState } from 'react';
import type { ParameterSpec } from '../core/types';
import { useSystemStore } from '../store/useSystemStore';
import { parseUserNumber, rationalLabel } from './format';
import { Katex } from './Katex';

const NAME_SEQUENCE = ['x', 'y', 'z', 'w', 'u', 'v', 'p', 'q'];

function nextName(used: string[]): string {
  const free = NAME_SEQUENCE.find((name) => !used.includes(name));
  if (free) return free;
  let index = used.length + 1;
  while (used.includes(`x${index}`)) index += 1;
  return `x${index}`;
}

function ParameterControl({ spec }: { spec: ParameterSpec }) {
  const setParameterValue = useSystemStore((state) => state.setParameterValue);
  const flushCas = useSystemStore((state) => state.flushCas);
  const [text, setText] = useState(rationalLabel(spec.value));

  useEffect(() => setText(rationalLabel(spec.value)), [spec.value]);

  const commitText = () => {
    const value = parseUserNumber(text);
    if (value === null) {
      setText(rationalLabel(spec.value));
      return;
    }
    setParameterValue(spec.name, value);
    flushCas();
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
        onChange={(event) => setParameterValue(spec.name, Number(event.target.value))}
        onPointerUp={flushCas}
        onKeyUp={flushCas}
      />
      <input
        aria-label={`${spec.name} value`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitText();
        }}
      />
    </label>
  );
}

export function EquationPanel() {
  const spec = useSystemStore((state) => state.spec);
  const draftRows = useSystemStore((state) => state.draftRows);
  const draftVars = useSystemStore((state) => state.draftVars);
  const parseError = useSystemStore((state) => state.parseError);
  const numericStatus = useSystemStore((state) => state.numericStatus);
  const setSystem = useSystemStore((state) => state.setSystem);
  const setUserLyapunov = useSystemStore((state) => state.setUserLyapunov);
  const setView = useSystemStore((state) => state.setView);
  const [pending, setPending] = useState('');
  const [lyapunov, setLyapunov] = useState(spec.userLyapunovExpr ?? '');
  const pendingRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusLast = useRef(false);

  useEffect(() => setLyapunov(spec.userLyapunovExpr ?? ''), [spec.userLyapunovExpr]);
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    rowRefs.current[draftRows.length - 1]?.focus();
  }, [draftRows.length]);

  const commit = (vars: string[], rows: string[]) => {
    setSystem(vars, rows);
  };

  const addFromPending = (value: string) => {
    const name = nextName(draftVars);
    focusLast.current = true;
    setPending('');
    commit([...draftVars, name], [...draftRows, value]);
  };

  const parameters = Object.values(spec.parameters);
  const status = parseError ? parseError : numericStatus === 'running' ? 'Computing the portrait…' : spec.isLinear ? 'Linear' : 'Nonlinear';

  return (
    <form
      className="system-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!parseError) setView('portrait');
      }}
    >
      <div className="system-brace">
        <div className="brace" aria-hidden="true" />
        <div className="equations">
          {draftRows.map((row, index) => (
            <div className="equation" key={`${draftVars[index] ?? 'row'}-${index}`}>
              <input
                aria-label={`Variable ${index + 1}`}
                className="var-input"
                value={draftVars[index] ?? ''}
                spellCheck={false}
                onChange={(event) => {
                  const vars = [...draftVars];
                  vars[index] = event.target.value;
                  commit(vars, draftRows);
                }}
              />
              <span className="prime">′ =</span>
              <input
                aria-label={`Right-hand side ${index + 1}`}
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                className="eq-input"
                value={row}
                spellCheck={false}
                placeholder="0"
                onChange={(event) => {
                  const rows = [...draftRows];
                  rows[index] = event.target.value;
                  if (!event.target.value.trim() && draftRows.length > 1) {
                    commit(
                      draftVars.filter((_, variableIndex) => variableIndex !== index),
                      rows.filter((_, rowIndex) => rowIndex !== index),
                    );
                    return;
                  }
                  commit(draftVars, rows);
                }}
              />
              {draftRows.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove equation ${index + 1}`}
                  onClick={() =>
                    commit(
                      draftVars.filter((_, variableIndex) => variableIndex !== index),
                      draftRows.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <div className="equation pending">
            <span className="var-input ghost">{nextName(draftVars)}</span>
            <span className="prime">′ =</span>
            <input
              ref={pendingRef}
              aria-label="Add an equation"
              className="eq-input"
              value={pending}
              spellCheck={false}
              placeholder="add another equation"
              onChange={(event) => {
                const value = event.target.value;
                if (value.trim()) addFromPending(value);
                else setPending(value);
              }}
            />
          </div>
        </div>
      </div>

      {!parseError && spec.latexEquations.length > 0 && (
        <div className="system-preview">
          {spec.latexEquations.map((tex) => (
            <Katex key={tex} tex={tex} display />
          ))}
        </div>
      )}
      <p className={parseError ? 'status error' : 'status'}>{status}</p>

      {parameters.length > 0 && (
        <div className="parameters">
          {parameters.map((parameter) => (
            <ParameterControl key={parameter.name} spec={parameter} />
          ))}
        </div>
      )}

      <details className="optional">
        <summary>Lyapunov function, if you have one</summary>
        <label className="lyapunov">
          V =
          <input
            aria-label="Lyapunov function"
            value={lyapunov}
            spellCheck={false}
            placeholder="(x^2 + y^2)/2"
            onChange={(event) => setLyapunov(event.target.value)}
            onBlur={() => setUserLyapunov(lyapunov)}
          />
        </label>
      </details>

      <div className="actions">
        <button type="submit" disabled={Boolean(parseError)}>
          Study this system
        </button>
        <button type="button" className="text-button" onClick={() => setView('examples')}>
          Examples
        </button>
      </div>
    </form>
  );
}
