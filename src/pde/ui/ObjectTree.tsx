import { Katex } from '../../ui/Katex';
import { groupColor } from '../render/colors';
import { usePdeStore } from '../store';

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

  if (!solution) return <p className="status">Nothing to show yet.</p>;

  const modeCount = solution.family === 'heat' ? solution.modes.length : 0;

  return (
    <div className="viz-list">
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
      {modeCount > 0 && (
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
