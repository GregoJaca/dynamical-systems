import { useMemo, useState } from 'react';
import { Katex } from '../../ui/Katex';
import { PDE_EXAMPLES } from '../examples/corpus';
import { usePdeStore } from '../store';

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'psi', 'omega'];

function previewTex(lines: string[]): string {
  const equation = lines.find((line) => line.includes('=')) ?? lines[0] ?? '';
  let tex = equation
    .replaceAll('u_xx', 'u_{xx}')
    .replaceAll('uxx', 'u_{xx}')
    .replaceAll('u_yy', 'u_{yy}')
    .replaceAll('u_xy', 'u_{xy}')
    .replaceAll('u_tt', 'u_{tt}')
    .replaceAll('u_x', 'u_{x}')
    .replaceAll('u_y', 'u_{y}')
    .replaceAll('u_t', 'u_{t}')
    .replaceAll('*', ' ');
  for (const name of GREEK) tex = tex.replace(new RegExp(`\\b${name}\\b`, 'g'), `\\${name}`);
  return tex;
}

export function Examples() {
  const draft = usePdeStore((state) => state.draft);
  const loadExample = usePdeStore((state) => state.loadExample);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = PDE_EXAMPLES.filter((example) => !example.parked);
    if (!needle) return visible;
    return visible.filter((example) =>
      [example.title, example.id, example.source, example.blurb, example.group, ...example.lines].join(' ').toLowerCase().includes(needle),
    );
  }, [query]);
  const groups = [...new Set(filtered.map((example) => example.group))];

  return (
    <div className="examples-page">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1>Examples</h1>
        <input className="eq-input" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search examples" />
      </div>
      {filtered.length === 0 && <p className="status">No examples match.</p>}
      {groups.map((group) => (
        <section key={group} className="mb-4">
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.16em] opacity-60">{group}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered
              .filter((example) => example.group === group)
              .map((example) => {
                const active = example.lines.join('\n') === draft;
                return (
                  <button
                    key={example.id}
                    type="button"
                    className={`rounded-2xl border px-3 py-2 text-left ${active ? 'border-[#f0b429] bg-[#f0b429]/10' : 'border-slate-400/25'}`}
                    onClick={() => loadExample(example)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{example.title}</span>
                      <span className="text-[11px] uppercase tracking-wide opacity-60">{example.source}</span>
                    </div>
                    <p className="mt-1 text-sm opacity-75">{example.blurb}</p>
                    <div className="example-system mt-1 text-sm opacity-90">
                      <Katex display tex={previewTex(example.lines)} />
                    </div>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
