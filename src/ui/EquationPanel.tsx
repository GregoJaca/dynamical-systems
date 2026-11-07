import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { ParameterSpec, SystemMode } from '../core/types';
import { exampleById } from '../examples/perkoExamples';
import { useSystemStore } from '../store/useSystemStore';
import { rowPreviewLatex } from './asciiLatex';
import { Badge } from './bits';
import { parseUserNumber, rationalLabel } from './format';
import { Katex } from './Katex';

const MODES: Array<{ id: SystemMode; label: string }> = [
  { id: 'autonomous', label: 'Autonomous' },
  { id: 'second_order_scalar', label: '2nd-order' },
  { id: 'non_autonomous', label: 'Non-autonomous' },
];

const DIMENSIONS = [1, 2, 3, 4] as const;

function ParameterControl({ spec }: { spec: ParameterSpec }) {
  const setParameterValue = useSystemStore((state) => state.setParameterValue);
  const setParameterBounds = useSystemStore((state) => state.setParameterBounds);
  const flushCas = useSystemStore((state) => state.flushCas);
  const [text, setText] = useState(rationalLabel(spec.value));
  const [minText, setMinText] = useState(String(spec.min));
  const [maxText, setMaxText] = useState(String(spec.max));
  const [stepText, setStepText] = useState(String(spec.step));

  useEffect(() => setText(rationalLabel(spec.value)), [spec.value]);
  useEffect(() => setMinText(String(spec.min)), [spec.min]);
  useEffect(() => setMaxText(String(spec.max)), [spec.max]);
  useEffect(() => setStepText(String(spec.step)), [spec.step]);

  const commitText = () => {
    const value = parseUserNumber(text);
    if (value === null) {
      setText(rationalLabel(spec.value));
      return;
    }
    setParameterValue(spec.name, value);
    flushCas();
  };

  const commitBounds = () => {
    const min = Number(minText);
    const max = Number(maxText);
    const step = Number(stepText);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) return;
    setParameterBounds(spec.name, { min, max, step });
  };

  return (
    <div className="rounded-2xl border border-slate-400/25 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Katex tex={spec.latex} />
        <input
          aria-label={`${spec.name} value`}
          className="w-24 rounded-lg bg-black/10 px-2 py-1 text-right text-sm"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitText();
          }}
        />
      </div>
      <input
        aria-label={`${spec.name} slider`}
        className="w-full accent-[#f0b429]"
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={spec.value}
        onChange={(event) => setParameterValue(spec.name, Number(event.target.value))}
        onPointerUp={flushCas}
        onKeyUp={flushCas}
      />
      <div className="mt-1 grid grid-cols-3 gap-1 text-[11px] opacity-75">
        {(['min', 'max', 'step'] as const).map((field) => (
          <label key={field} className="flex flex-col">
            {field}
            <input
              className="rounded bg-black/10 px-1 py-0.5 text-inherit"
              value={field === 'min' ? minText : field === 'max' ? maxText : stepText}
              onChange={(event) => {
                const next = event.target.value;
                if (field === 'min') setMinText(next);
                else if (field === 'max') setMaxText(next);
                else setStepText(next);
              }}
              onBlur={commitBounds}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function EquationPanel({ onClose }: { onClose: () => void }) {
  const spec = useSystemStore((state) => state.spec);
  const draftRows = useSystemStore((state) => state.draftRows);
  const exampleId = useSystemStore((state) => state.exampleId);
  const parseError = useSystemStore((state) => state.parseError);
  const numericStatus = useSystemStore((state) => state.numericStatus);
  const casStatus = useSystemStore((state) => state.casStatus);
  const setDraftRow = useSystemStore((state) => state.setDraftRow);
  const setMode = useSystemStore((state) => state.setMode);
  const setDimension = useSystemStore((state) => state.setDimension);
  const setUserLyapunov = useSystemStore((state) => state.setUserLyapunov);
  const openGallery = useSystemStore((state) => state.openGallery);
  const example = exampleById(exampleId);
  const parameters = Object.values(spec.parameters);
  const secondOrder = spec.mode === 'second_order_scalar';

  return (
    <aside className="glass flex h-full w-[340px] flex-col rounded-3xl">
      <header className="flex items-start justify-between gap-2 px-4 pb-2 pt-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-60">Equations</p>
          <h1 className="font-display text-xl leading-tight">{example?.title ?? 'Custom system'}</h1>
        </div>
        <button type="button" className="rounded-full px-2 py-1 text-xs opacity-70" onClick={onClose} aria-label="Hide equations">
          Hide
        </button>
      </header>
      <div className="scroll-thin flex-1 space-y-3 overflow-auto px-4 pb-4">
        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-full bg-[#f0b429] px-3 py-2 text-sm font-semibold text-[#1c1404]" onClick={openGallery}>
          <BookOpen size={16} />
          Example gallery
        </button>
        <div className="grid grid-cols-3 gap-1">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`rounded-full px-2 py-1 text-xs ${spec.mode === mode.id ? 'bg-[#f0b429]/20 text-[#f0b429]' : 'bg-black/10'}`}
              onClick={() => setMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {DIMENSIONS.map((dimension) => (
            <button
              key={dimension}
              type="button"
              disabled={secondOrder}
              className={`rounded-full px-3 py-1 text-xs disabled:opacity-40 ${spec.dimension === dimension || (dimension === 4 && spec.dimension > 4) ? 'bg-[#f0b429]/20 text-[#f0b429]' : 'bg-black/10'}`}
              onClick={() => setDimension(dimension)}
            >
              {dimension === 4 ? '4D+' : `${dimension}D`}
            </button>
          ))}
          {spec.dimension >= 4 && !secondOrder && (
            <span className="ml-1 flex items-center gap-1 text-xs">
              <button type="button" className="rounded-full bg-black/10 px-2" onClick={() => setDimension(spec.dimension - 1)} disabled={spec.dimension <= 4}>
                −
              </button>
              {spec.dimension}D
              <button type="button" className="rounded-full bg-black/10 px-2" onClick={() => setDimension(spec.dimension + 1)} disabled={spec.dimension >= 8}>
                +
              </button>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={spec.isAutonomous ? 'good' : 'gold'}>{spec.isAutonomous ? 'Autonomous' : 'Explicit time'}</Badge>
          <Badge>{spec.isLinear ? 'Linear' : 'Nonlinear'}</Badge>
        </div>
        <div className="space-y-2">
          {draftRows.map((row, index) => {
            const variable = spec.stateVars[index];
            const parsed = !parseError && spec.latexEquations[index] && spec.latexEquations.length === draftRows.length;
            const tex = parsed ? spec.latexEquations[index]! : rowPreviewLatex(row, variable, secondOrder && index === 0);
            return (
              <label key={`${spec.mode}-${index}`} className="block rounded-2xl border border-slate-400/25 p-2">
                <span className="mb-1 block text-[11px] uppercase tracking-wide opacity-60">{variable ?? `Equation ${index + 1}`}</span>
                <input
                  aria-label={variable ? `${variable} equation` : `Equation ${index + 1}`}
                  className="w-full rounded-xl bg-black/10 px-2 py-1.5 text-sm outline-none"
                  value={row}
                  spellCheck={false}
                  onChange={(event) => setDraftRow(index, event.target.value)}
                />
                <div className="mt-1 min-h-6 text-sm">
                  <Katex tex={tex} />
                </div>
              </label>
            );
          })}
        </div>
        {spec.latexEquations.length > 0 && spec.latexEquations.length !== draftRows.length && (
          <div className="space-y-1 rounded-2xl bg-black/10 p-2">
            <p className="text-[11px] uppercase tracking-wide opacity-60">Interpreted system</p>
            {spec.latexEquations.map((tex) => (
              <Katex key={tex} tex={tex} display />
            ))}
          </div>
        )}
        {parseError && <p className="rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{parseError}</p>}
        {parameters.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] opacity-60">Parameters</p>
            {parameters.map((specItem) => (
              <ParameterControl key={specItem.name} spec={specItem} />
            ))}
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide opacity-60">Lyapunov V(x)</span>
          <input
            className="w-full rounded-xl bg-black/10 px-2 py-1.5 text-sm"
            value={spec.userLyapunovExpr ?? ''}
            placeholder="(x^2 + y^2) / 2"
            onChange={(event) => setUserLyapunov(event.target.value)}
          />
        </label>
      </div>
      <footer className="flex items-center justify-between border-t border-slate-400/20 px-4 py-2 text-[11px] uppercase tracking-wide opacity-70">
        <span>Numeric {numericStatus}</span>
        <span>Symbolic {casStatus}</span>
      </footer>
    </aside>
  );
}
