import { useEffect, useState } from 'react';
import { Katex } from '../../ui/Katex';
import { groupColor } from '../render/colors';
import { activeFrame, usePdeStore } from '../store';

export function ObjectTree() {
  const solution = usePdeStore((state) => state.solution);
  const theme = usePdeStore((state) => state.theme);
  const hidden = usePdeStore((state) => state.hidden);
  const selectedId = usePdeStore((state) => state.selectedId);
  const partialN = usePdeStore((state) => state.partialN);
  const toggleHidden = usePdeStore((state) => state.toggleHidden);
  const select = usePdeStore((state) => state.select);
  const hover = usePdeStore((state) => state.hover);
  const setPartialN = usePdeStore((state) => state.setPartialN);
  const frameId = usePdeStore((state) => state.frame);
  const setFrame = usePdeStore((state) => state.setFrame);

  if (!solution) return <p className="status">Nothing to show yet.</p>;
  const simplified = solution.frames.find((frame) => frame.id === 'simplified');
  const dimensionless = frameId === 'simplified';

  const modeCount = solution.family === 'heat' ? solution.modes.length : 0;

  return (
    <div className="viz-list">
      <TimeControl />
      {simplified ? (
        <div>
          <button type="button" className={dimensionless ? 'real-button on' : 'real-button'} onClick={() => setFrame(dimensionless ? 'original' : 'simplified')}>
            Dimensionless
          </button>
          {dimensionless && simplified.mapLatex ? (
            <p className="object-text">
              <Katex tex={simplified.mapLatex} />
            </p>
          ) : null}
        </div>
      ) : null}
      {solution.objects.map((object) => {
        const shown = !hidden.includes(object.id);
        const color = groupColor(object.group, theme);
        return (
          <div
            key={object.id}
            className={selectedId === object.id ? 'object-row selected' : 'object-row'}
            onMouseEnter={() => hover(object.id)}
            onMouseLeave={() => hover(null)}
            onClick={() => select(object.id)}
          >
            <button
              type="button"
              className={shown ? `swatch on${object.group === 'envelope' ? ' dashed' : ''}` : `swatch${object.group === 'envelope' ? ' dashed' : ''}`}
              style={{ color }}
              aria-pressed={shown}
              aria-label={shown ? `Hide ${object.label}` : `Show ${object.label}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleHidden(object.id);
              }}
            >
              <i />
            </button>
            <div className="viz-copy">
              <div className="layer-name">{object.label}</div>
              {object.formulaLatex ? (
                <p className="object-text">
                  <Katex tex={object.formulaLatex} />
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {modeCount > 1 && (
        <label className="parameter">
          <Katex tex="N" />
          <input
            aria-label="Partial sum length"
            type="range"
            min={1}
            max={modeCount}
            step={1}
            value={Math.min(partialN, modeCount)}
            onChange={(event) => setPartialN(Number(event.target.value))}
          />
          <input
            aria-label="Partial sum length value"
            value={String(Math.min(partialN, modeCount))}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) setPartialN(value);
            }}
          />
        </label>
      )}
    </div>
  );
}

function TimeControl() {
  const solution = usePdeStore((state) => state.solution);
  const frameId = usePdeStore((state) => state.frame);
  const t0 = usePdeStore((state) => state.t0);
  const setT0 = usePdeStore((state) => state.setT0);
  const frame = activeFrame(solution, frameId);
  const [playing, setPlaying] = useState(false);
  const mode = solution?.family === 'heat' ? solution.modes[0] : undefined;

  const show =
    Boolean(frame) &&
    (frame?.tMax ?? 0) > (frame?.tMin ?? 0) + 1e-9 &&
    solution?.family !== 'characteristics' &&
    !(solution?.family === 'heat' && solution.spatial !== 'x');

  useEffect(() => {
    if (!playing || !show || !frame) return;
    let handle = 0;
    let last = performance.now();
    const step = (now: number) => {
      const span = frame.tMax - frame.tMin || 1;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = usePdeStore.getState().t0;
      let next = current + span * dt * 0.28;
      if (next > frame.tMax) next = frame.tMin;
      setT0(next);
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [playing, frame, setT0, show]);

  if (!show || !frame) return null;
  const readout = `${frame.tName} = ${Math.round(t0 * 1000) / 1000}`;
  const factor = mode && Number.isFinite(mode.lambda) ? Math.exp(-mode.lambda * Math.max(0, t0)) : null;
  return (
    <div className="parameter">
      <button type="button" className={playing ? 'real-button on' : 'real-button'} onClick={() => setPlaying((value) => !value)}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        aria-label={readout}
        type="range"
        min={frame.tMin}
        max={frame.tMax}
        step={(frame.tMax - frame.tMin) / 200}
        value={Math.min(frame.tMax, Math.max(frame.tMin, t0))}
        onChange={(event) => setT0(Number(event.target.value))}
      />
      <span>{readout}</span>
      {factor !== null && Number.isFinite(factor) ? <span>{`slowest factor ${Math.round(factor * 1000) / 1000}`}</span> : null}
    </div>
  );
}
