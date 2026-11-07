import { useMemo, useState } from 'react';
import { PERKO_EXAMPLES } from '../examples/perkoExamples';
import { useSystemStore } from '../store/useSystemStore';
import { rowPreviewLatex } from './asciiLatex';
import { Katex } from './Katex';

export function ExampleGallery() {
  const activeId = useSystemStore((state) => state.exampleId);
  const loadExample = useSystemStore((state) => state.loadExample);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PERKO_EXAMPLES;
    return PERKO_EXAMPLES.filter((example) =>
      [example.title, example.id, example.citation, example.blurb, example.group].join(' ').toLowerCase().includes(needle),
    );
  }, [query]);
  const groups = [...new Set(filtered.map((example) => example.group))];

  return (
    <div className="examples-page">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1>Examples</h1>
        <input
          className="eq-input"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search examples"
        />
      </div>
        {groups.map((group) => (
          <section key={group} className="mb-4">
            <h3 className="mb-2 text-[11px] uppercase tracking-[0.16em] opacity-60">{group}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered
                .filter((example) => example.group === group)
                .map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    className={`rounded-2xl border px-3 py-2 text-left ${example.id === activeId ? 'border-[#f0b429] bg-[#f0b429]/10' : 'border-slate-400/25'}`}
                    onClick={() => loadExample(example)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{example.title}</span>
                      <span className="text-[11px] uppercase tracking-wide opacity-60">{example.citation}</span>
                    </div>
                    <p className="mt-1 text-sm opacity-75">{example.blurb}</p>
                    <div className="mt-1 text-sm opacity-90">
                      {example.rows.map((row, index) => (
                        <Katex key={`${example.id}-${index}`} tex={rowPreviewLatex(row, example.stateVars[index], example.mode === 'second_order_scalar')} />
                      ))}
                    </div>
                  </button>
                ))}
            </div>
          </section>
        ))}
    </div>
  );
}
