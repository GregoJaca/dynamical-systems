import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ParameterSpec } from '../core/types';
import { useSystemStore } from '../store/useSystemStore';
import { parseUserNumber, rationalLabel } from './format';
import { Katex } from './Katex';
import { MathKeypad } from './MathKeypad';
import type { KeySpec } from './mathEdit';
import { useMathBuffer } from './useMathBuffer';

type MathField = { kind: 'var' | 'row'; index: number } | { kind: 'pending' } | { kind: 'lyapunov' };

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
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [systemKeyboard, setSystemKeyboard] = useState(false);
  const pendingRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusLast = useRef(false);
  const fieldRef = useRef<MathField | null>(null);
  const buffer = useMathBuffer();
  const keyboardToggle = useRef(false);

  useEffect(() => setLyapunov(spec.userLyapunovExpr ?? ''), [spec.userLyapunovExpr]);
  useLayoutEffect(() => {
    if (focusLast.current) {
      focusLast.current = false;
      const node = rowRefs.current[draftRows.length - 1];
      if (node) buffer.inputRef.current = node;
    }
    buffer.place();
    if (!keyboardToggle.current) return;
    keyboardToggle.current = false;
    const input = buffer.inputRef.current;
    if (!input) return;
    input.blur();
    input.focus();
  });

  const commit = (vars: string[], rows: string[]) => {
    setSystem(vars, rows);
  };

  const addFromPending = (value: string, cursor = value.length) => {
    const name = nextName(draftVars);
    fieldRef.current = { kind: 'row', index: draftRows.length };
    focusLast.current = true;
    buffer.arm(cursor);
    setPending('');
    commit([...draftVars, name], [...draftRows, value]);
  };

  const writeField = (value: string) => {
    const field = fieldRef.current;
    if (!field || field.kind === 'pending') return;
    if (field.kind === 'row') {
      const rows = [...draftRows];
      rows[field.index] = value;
      commit(draftVars, rows);
      return;
    }
    if (field.kind === 'var') {
      const vars = [...draftVars];
      vars[field.index] = value;
      commit(vars, draftRows);
      return;
    }
    setLyapunov(value);
  };

  const insertKey = (key: KeySpec) => {
    const field = fieldRef.current;
    if (!field) return;
    const value = buffer.applyKey(key);
    if (field.kind === 'pending') {
      if (value.trim()) {
        const name = nextName(draftVars);
        fieldRef.current = { kind: 'row', index: draftRows.length };
        focusLast.current = true;
        setPending('');
        commit([...draftVars, name], [...draftRows, value]);
      } else {
        setPending(value);
      }
      return;
    }
    writeField(value);
  };

  const openField = (field: MathField, input: HTMLInputElement) => {
    fieldRef.current = field;
    buffer.attach(input);
    if (!keypadOpen) input.scrollIntoView({ block: 'nearest' });
    setKeypadOpen(true);
  };

  const mathInput = (field: MathField) => ({
    'data-math-field': 'true',
    inputMode: (systemKeyboard ? 'text' : 'none') as 'text' | 'none',
    autoCapitalize: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
    onPointerDown: (event: { currentTarget: HTMLInputElement }) => openField(field, event.currentTarget),
    onFocus: (event: { currentTarget: HTMLInputElement }) => openField(field, event.currentTarget),
    onSelect: (event: { currentTarget: HTMLInputElement }) => buffer.syncFromInput(event.currentTarget),
    onBlur: () => {
      if (field.kind === 'lyapunov') setUserLyapunov(lyapunov);
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.dataset.mathField === 'true') return;
        setKeypadOpen(false);
      }, 0);
    },
  });

  const parameters = Object.values(spec.parameters);
  const missingEquation = draftRows.some((row) => row.trim().length === 0) || draftVars.some((name) => name.trim().length === 0);
  const status = parseError ? parseError : !missingEquation && numericStatus === 'running' ? 'Computing the portrait…' : '';

  return (
    <form
      className="system-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!parseError && !missingEquation) setView('portrait');
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
                {...mathInput({ kind: 'var', index })}
                onChange={(event) => {
                  buffer.syncFromInput(event.currentTarget);
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
                placeholder="0"
                {...mathInput({ kind: 'row', index })}
                onChange={(event) => {
                  buffer.syncFromInput(event.currentTarget);
                  const rows = [...draftRows];
                  rows[index] = event.target.value;
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
              placeholder="add another equation"
              {...mathInput({ kind: 'pending' })}
              onChange={(event) => {
                buffer.syncFromInput(event.currentTarget);
                const value = event.target.value;
                if (value.trim()) addFromPending(value, event.target.selectionStart ?? value.length);
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
      {status ? <p className={parseError ? 'status error' : 'status'}>{status}</p> : null}

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
            placeholder="(x^2 + y^2)/2"
            {...mathInput({ kind: 'lyapunov' })}
            onChange={(event) => {
              buffer.syncFromInput(event.currentTarget);
              setLyapunov(event.target.value);
            }}
          />
        </label>
      </details>

      <div className="actions">
        <button type="submit" disabled={Boolean(parseError) || missingEquation}>
          Study this system
        </button>
      </div>
      <MathKeypad
        open={keypadOpen}
        systemKeyboard={systemKeyboard}
        onEdit={insertKey}
        onClose={() => setKeypadOpen(false)}
        onSystemKeyboard={() => {
          keyboardToggle.current = true;
          setSystemKeyboard(true);
          setKeypadOpen(true);
        }}
        onMathKeyboard={() => {
          keyboardToggle.current = true;
          setSystemKeyboard(false);
          setKeypadOpen(true);
        }}
      />
    </form>
  );
}
