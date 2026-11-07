import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { equilibriumColor, PALETTE } from '../core/palette';
import { useSystemStore } from '../store/useSystemStore';
import { coordList } from './format';
import { Katex } from './Katex';

function Row({
  id,
  label,
  formula,
  color,
}: {
  id: string;
  label: string;
  formula: string;
  color: string;
}) {
  const hidden = useSystemStore((state) => state.hiddenObjectIds.includes(id));
  const selected = useSystemStore((state) => state.selectedObjectId === id);
  const toggleHidden = useSystemStore((state) => state.toggleHidden);
  const selectObject = useSystemStore((state) => state.selectObject);
  const hoverObject = useSystemStore((state) => state.hoverObject);
  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-2 py-1.5 ${selected ? 'bg-[#f0b429]/12' : 'hover:bg-black/10'} ${hidden ? 'opacity-40' : ''}`}
      onMouseEnter={() => hoverObject(id)}
      onMouseLeave={() => hoverObject(null)}
      onClick={() => selectObject(id)}
    >
      <button
        type="button"
        className="mt-0.5 opacity-70"
        aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleHidden(id);
        }}
      >
        {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide opacity-60">{label}</div>
        <Katex tex={formula} />
      </div>
    </div>
  );
}

export function ObjectTree() {
  const analysis = useSystemStore((state) => state.analysis);
  const theme = useSystemStore((state) => state.theme);
  const palette = PALETTE[theme];
  const orbits = analysis.streamlines.filter((segment) => segment.category === 'separatrix' || segment.category === 'characteristic_orbit' || segment.category === 'user_traced');
  return (
    <div className="space-y-3">
      <Group title="Equilibria">
        {analysis.equilibria.map((eq) => (
          <div key={eq.id}>
            <Row
              id={eq.id}
              label={`${eq.id} · ${eq.classification2D ?? eq.classification3D ?? eq.stability}`}
              formula={eq.familyFormulaLatex || coordList(eq.coords, eq.coordsExactLatex)}
              color={equilibriumColor(eq.stability, eq.classification2D ?? eq.classification3D, theme)}
            />
            {eq.subspaces.map((space) => (
              <div key={`${eq.id}-${space.kind}`} className="ml-4">
                <Row id={`${eq.id}:${space.kind}`} label={`${space.kind} of ${eq.id}`} formula={space.cartesianFormulaLatex || space.basisExactLatex[0] || `\\dim = ${space.dimension}`} color={space.kind === 'Es' ? palette.es : space.kind === 'Eu' ? palette.eu : palette.ec} />
              </div>
            ))}
          </div>
        ))}
        {analysis.equilibria.length === 0 && <Empty text="No equilibria in the current window yet." />}
      </Group>
      <Group title="Manifolds">
        {analysis.manifolds.map((branch) => (
          <Row
            key={branch.id}
            id={branch.id}
            label={`${branch.kind} ${branch.sign > 0 ? '+' : '−'} · ${branch.equilibriumId}`}
            formula={branch.taylorSeriesLatex || branch.reducedDynamicsLatex || `\\text{Integrated } ${branch.kind} \\text{ branch}`}
            color={branch.kind === 'Wu' ? palette.wu : branch.kind === 'Wc' ? palette.wc : palette.ws}
          />
        ))}
      </Group>
      <Group title="Separatrices and orbits">
        {orbits.map((segment) => (
          <Row
            key={segment.id}
            id={segment.id}
            label={segment.reasonTag || segment.category}
            formula={segment.formulaOrDescriptionLatex || `\\text{${segment.reasonTag || segment.category}}`}
            color={segment.category === 'separatrix' ? palette.separatrix : palette.streamline}
          />
        ))}
      </Group>
      <Group title="Nullclines">
        {analysis.nullclines.map((curve) => (
          <Row key={curve.id} id={curve.id} label={curve.variableLatex || `f_${curve.component} = 0`} formula={curve.formulaLatex} color={curve.component === 0 ? palette.nullclineX : palette.nullclineY} />
        ))}
      </Group>
      <Group title="Limit cycles">
        {analysis.limitCycles.map((cycle) => (
          <Row key={cycle.id} id={cycle.id} label={`${cycle.id} · ${cycle.stability}`} formula={cycle.formulaLatex || (cycle.radius ? `r = ${cycle.radius}` : '\\text{Closed orbit}')} color={palette.cycle} />
        ))}
      </Group>
      {(analysis.global.hamiltonianLatex || analysis.global.lyapunov) && (
        <Group title="Scalar fields">
          {analysis.global.hamiltonianLatex && <Row id="hamiltonian" label="Hamiltonian" formula={`H = ${analysis.global.hamiltonianLatex}`} color={palette.cycle} />}
          {analysis.global.lyapunov && <Row id="lyapunov" label="Lyapunov" formula={`V = ${analysis.global.lyapunov.vLatex}`} color={palette.wc} />}
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] uppercase tracking-[0.16em] opacity-60">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 text-sm opacity-60">{text}</p>;
}
