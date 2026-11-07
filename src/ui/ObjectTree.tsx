import type { ReactNode } from 'react';
import type { EquilibriumAnalysis, LayerVisibility, ManifoldBranch } from '../core/types';
import { equilibriumColor, PALETTE } from '../core/palette';
import { useSystemStore } from '../store/useSystemStore';
import { coordList, prettyLabel } from './format';
import { Katex, looksLikeProse } from './Katex';

function isMath(value: string): boolean {
  return !looksLikeProse(value) && /\\[a-zA-Z]|[_^{}=]/.test(value);
}

function Formula({ value }: { value: string }) {
  const parts = value.split(' ; ').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.every((part) => !isMath(part))) return <p className="object-text">{parts.join(' ; ')}</p>;
  return (
    <p className="object-text">
      {parts.map((part, index) => (
        <span key={`${part}:${index}`}>
          {index > 0 ? ' ; ' : null}
          {isMath(part) ? <Katex tex={part} /> : part}
        </span>
      ))}
    </p>
  );
}

function where(eq: EquilibriumAnalysis): string {
  return coordList(eq.coords, eq.coordsExactLatex);
}

function withCoordinates(text: string, equilibria: EquilibriumAnalysis[]): string {
  return text.replace(/\beq-\d+\b/g, (id) => {
    const eq = equilibria.find((item) => item.id === id);
    return eq ? where(eq) : id;
  });
}

function once(values: Array<string | undefined>): string {
  const kept: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim() ?? '';
    if (!trimmed || kept.includes(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept.join(' ; ');
}

function Swatch({
  on,
  dashed,
  color,
  label,
  onClick,
}: {
  on: boolean;
  dashed: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? `swatch on${dashed ? ' dashed' : ''}` : `swatch${dashed ? ' dashed' : ''}`}
      style={{ color }}
      aria-pressed={on}
      aria-label={on ? `Hide ${label}` : `Show ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <i />
    </button>
  );
}

function LayerRow({
  title,
  on,
  dashed,
  color,
  focus,
  onToggle,
  formula,
}: {
  title: string;
  on: boolean;
  dashed: boolean;
  color: string;
  focus: string;
  onToggle: () => void;
  formula?: string;
}) {
  const hoverObject = useSystemStore((state) => state.hoverObject);
  return (
    <div className="layer-row" onMouseEnter={() => hoverObject(focus)} onMouseLeave={() => hoverObject(null)} onClick={onToggle}>
      <Swatch on={on} dashed={dashed} color={color} label={title} onClick={onToggle} />
      <div className="viz-copy">
        <div className="layer-name">{title}</div>
        {formula ? <Formula value={formula} /> : null}
      </div>
    </div>
  );
}

function Row({
  id,
  label,
  formula,
  color,
  dashed,
  shown,
  onToggle,
  sentence = false,
}: {
  id: string;
  label: string;
  formula: string;
  color: string;
  dashed: boolean;
  shown: boolean;
  onToggle: () => void;
  sentence?: boolean;
}) {
  const hoverObject = useSystemStore((state) => state.hoverObject);
  return (
    <div
      className="object-row nested"
      onMouseEnter={() => hoverObject(id)}
      onMouseLeave={() => hoverObject(null)}
      onClick={onToggle}
    >
      <Swatch on={shown} dashed={dashed} color={color} label={label} onClick={onToggle} />
      <div className="viz-copy">
        {sentence ? <p className="object-text">{label}</p> : <div className="layer-name">{label}</div>}
        <Formula value={formula} />
      </div>
    </div>
  );
}

function Block({ children }: { children: ReactNode }) {
  return <section className="viz-block">{children}</section>;
}

export function ObjectTree() {
  const analysis = useSystemStore((state) => state.analysis);
  const theme = useSystemStore((state) => state.theme);
  const spec = useSystemStore((state) => state.spec);
  const layers = useSystemStore((state) => state.layers);
  const flowMap = useSystemStore((state) => state.flowMap);
  const extendedPhase = useSystemStore((state) => state.extendedPhase);
  const toggleLayer = useSystemStore((state) => state.toggleLayer);
  const toggleFlowMap = useSystemStore((state) => state.toggleFlowMap);
  const setExtendedPhase = useSystemStore((state) => state.setExtendedPhase);
  const palette = PALETTE[theme];
  const separatrices = analysis.streamlines.filter((segment) => segment.category === 'separatrix');
  const placed = analysis.streamlines.filter((segment) => segment.category === 'user_traced');
  const stableManifolds = analysis.manifolds.filter((branch) => branch.kind !== 'Wc');
  const centerManifolds = analysis.manifolds.filter((branch) => branch.kind === 'Wc');
  const subspaces = analysis.equilibria.flatMap((eq) => eq.subspaces.map((space) => ({ eq, space })));
  const isolatedCycles = analysis.limitCycles.length > 0 && analysis.limitCycles.length <= 6;
  const showPlane = spec.dimension === 2;
  const hiddenIds = useSystemStore((state) => state.hiddenObjectIds);
  const toggleHidden = useSystemStore((state) => state.toggleHidden);
  const toggle = (key: keyof LayerVisibility) => () => toggleLayer(key);
  const reveal = (key: keyof LayerVisibility, id: string) => showGroup(key, [id]);
  const showGroup = (key: keyof LayerVisibility, ids: string[]) => () => {
    const store = useSystemStore.getState();
    const anyShown = store.layers[key] && ids.some((id) => !store.hiddenObjectIds.includes(id));
    if (!store.layers[key]) toggleLayer(key);
    for (const id of ids) {
      const hidden = useSystemStore.getState().hiddenObjectIds.includes(id);
      if (anyShown && !hidden) toggleHidden(id);
      if (!anyShown && hidden) toggleHidden(id);
    }
  };
  const groupRows = (branches: ManifoldBranch[]) => {
    const groups = new Map<string, ManifoldBranch[]>();
    for (const branch of branches) {
      const key = `${branch.kind}:${branch.equilibriumId}`;
      groups.set(key, [...(groups.get(key) ?? []), branch]);
    }
    return [...groups.values()];
  };

  return (
    <div className="viz-list">
      <p className="viz-hint">Hover a row to highlight it on the portrait. Click the row to show or hide it.</p>

      {analysis.equilibria.length > 0 && (
        <Block>
          <LayerRow title="Equilibria" on={layers.equilibria} dashed={false} color={palette.equilibrium} focus="group:equilibria" onToggle={toggle('equilibria')} />
          {[...groupBy(analysis.equilibria, (eq) => prettyLabel(eq.classification2D ?? eq.classification3D ?? eq.stability)).entries()].map(([label, eqs]) => {
            const ids = eqs.map((eq) => eq.id);
            const first = eqs[0]!;
            return (
              <Row
                key={label}
                id={`multi:${ids.join(',')}`}
                label={label}
                formula={once(eqs.map((eq) => eq.familyFormulaLatex || where(eq)))}
                color={equilibriumColor(first.stability, first.classification2D ?? first.classification3D, theme)}
                dashed={false}
                shown={layers.equilibria && ids.some((id) => !hiddenIds.includes(id))}
                onToggle={showGroup('equilibria', ids)}
              />
            );
          })}
        </Block>
      )}

      {subspaces.length > 0 && (
        <Block>
          <LayerRow title="Eigenspaces" on={layers.linearSubspaces} dashed color={palette.ec} focus="group:eigenspaces" onToggle={toggle('linearSubspaces')} />
          {[...groupBy(subspaces, ({ space }) => `${space.kind}:${space.cartesianFormulaLatex || space.basisExactLatex[0] || ''}`).entries()].map(([key, items]) => {
            const ids = items.map(({ eq, space }) => `${eq.id}:${space.kind}`);
            const first = items[0]!;
            return (
              <Row
                key={key}
                id={`multi:${ids.join(',')}`}
                label={`${first.space.kind} of ${items.map(({ eq }) => where(eq)).join(' ; ')}`}
                formula={first.space.cartesianFormulaLatex || first.space.basisExactLatex[0] || ''}
                color={first.space.kind === 'Es' ? palette.es : first.space.kind === 'Eu' ? palette.eu : palette.ec}
                dashed
                shown={layers.linearSubspaces && ids.some((id) => !hiddenIds.includes(id))}
                onToggle={showGroup('linearSubspaces', ids)}
              />
            );
          })}
        </Block>
      )}

      {stableManifolds.length > 0 && (
        <Block>
          <LayerRow title="Stable and unstable manifolds" on={layers.manifoldsWuWs} dashed={false} color={palette.ws} focus="group:manifolds" onToggle={toggle('manifoldsWuWs')} />
          {groupRows(stableManifolds).map((branches) => {
            const first = branches[0]!;
            const home = analysis.equilibria.find((eq) => eq.id === first.equilibriumId);
            const ids = branches.map((branch) => branch.id);
            return (
              <Row
                key={ids.join(',')}
                id={`multi:${ids.join(',')}`}
                label={`${first.kind} of ${home ? where(home) : ''}`}
                formula={once(branches.map((branch) => branch.taylorSeriesLatex || branch.reducedDynamicsLatex))}
                color={first.kind === 'Wu' ? palette.wu : palette.ws}
                dashed={false}
                shown={layers.manifoldsWuWs && ids.some((id) => !hiddenIds.includes(id))}
                onToggle={showGroup('manifoldsWuWs', ids)}
              />
            );
          })}
        </Block>
      )}

      {centerManifolds.length > 0 && (
        <Block>
          <LayerRow title="Center manifold" on={layers.centerManifoldWc} dashed={false} color={palette.wc} focus="group:center" onToggle={toggle('centerManifoldWc')} />
          {groupRows(centerManifolds).map((branches) => {
            const first = branches[0]!;
            const home = analysis.equilibria.find((eq) => eq.id === first.equilibriumId);
            const ids = branches.map((branch) => branch.id);
            return (
              <Row
                key={ids.join(',')}
                id={`multi:${ids.join(',')}`}
                label={`Wc of ${home ? where(home) : ''}`}
                formula={once(branches.map((branch) => branch.taylorSeriesLatex || branch.reducedDynamicsLatex))}
                color={palette.wc}
                dashed={false}
                shown={layers.centerManifoldWc && ids.some((id) => !hiddenIds.includes(id))}
                onToggle={showGroup('centerManifoldWc', ids)}
              />
            );
          })}
        </Block>
      )}

      {separatrices.length > 0 && stableManifolds.length === 0 && (
        <Block>
          <LayerRow title="Separatrices" on={layers.separatrices} dashed={false} color={palette.separatrix} focus="group:separatrices" onToggle={toggle('separatrices')} />
          {[...groupBy(separatrices, (segment) => withCoordinates(segment.reasonTag || 'Separatrix', analysis.equilibria)).entries()].map(([caption, segments]) => {
            const ids = segments.map((segment) => segment.id);
            const detail = once(segments.map((segment) => (segment.formulaOrDescriptionLatex && segment.formulaOrDescriptionLatex !== segment.reasonTag ? withCoordinates(segment.formulaOrDescriptionLatex, analysis.equilibria) : '')));
            return (
              <Row
                key={caption}
                id={`multi:${ids.join(',')}`}
                label={caption}
                formula={detail}
                color={palette.separatrix}
                dashed={false}
                sentence
                shown={layers.separatrices && ids.some((id) => !hiddenIds.includes(id))}
                onToggle={showGroup('separatrices', ids)}
              />
            );
          })}
        </Block>
      )}

      {analysis.nullclines.length > 0 && (
        <Block>
          <LayerRow title="Nullclines" on={layers.nullclines} dashed color={palette.nullclineY} focus="group:nullclines" onToggle={toggle('nullclines')} />
          {analysis.nullclines.map((curve) => (
            <Row
              key={curve.id}
              id={curve.id}
              label="Nullcline"
              formula={curve.formulaLatex || curve.variableLatex}
              color={curve.component === 0 ? palette.nullclineX : palette.nullclineY}
              dashed
              shown={layers.nullclines && !hiddenIds.includes(curve.id)}
              onToggle={reveal('nullclines', curve.id)}
            />
          ))}
        </Block>
      )}

      {isolatedCycles && (
        <Block>
          <LayerRow title="Limit cycles" on={layers.limitCycles} dashed={false} color={palette.cycle} focus="group:cycles" onToggle={toggle('limitCycles')} />
          {analysis.limitCycles.map((cycle) => (
            <Row
              key={cycle.id}
              id={cycle.id}
              label={prettyLabel(cycle.stability)}
              formula={cycle.formulaLatex || (cycle.radius ? `r = ${cycle.radius}` : 'Closed orbit')}
              color={palette.cycle}
              dashed={false}
              shown={layers.limitCycles && !hiddenIds.includes(cycle.id)}
              onToggle={reveal('limitCycles', cycle.id)}
            />
          ))}
        </Block>
      )}

      {showPlane && analysis.streamlines.some((segment) => segment.category !== 'separatrix' && segment.category !== 'user_traced') && (
        <Block>
          <LayerRow title="Trajectories" on={layers.streamlines} dashed={false} color={palette.streamline} focus="group:trajectories" onToggle={toggle('streamlines')} />
        </Block>
      )}

      {placed.length > 0 && (
        <Block>
          {placed.map((segment) => (
            <Row
              key={segment.id}
              id={segment.id}
              label="Orbit through a chosen point"
              formula=""
              color={palette.streamline}
              dashed={false}
              shown={!hiddenIds.includes(segment.id)}
              onToggle={() => toggleHidden(segment.id)}
            />
          ))}
        </Block>
      )}

      {analysis.global.isHamiltonian && analysis.global.hamiltonianLatex && (
        <Block>
          <LayerRow
            title="Hamiltonian levels"
            on={layers.hamiltonianContours}
            dashed
            color={palette.cycle}
            focus="group:hamiltonian"
            onToggle={toggle('hamiltonianContours')}
            formula={analysis.global.hamiltonianLatex.trim().startsWith('H') ? analysis.global.hamiltonianLatex : `H = ${analysis.global.hamiltonianLatex}`}
          />
        </Block>
      )}

      {analysis.global.lyapunov &&
        analysis.global.lyapunov.classification !== 'indefinite' &&
        !(analysis.global.isHamiltonian && analysis.global.lyapunov.classification === 'conserved_first_integral') && (
        <Block>
          <LayerRow
            title="Lyapunov levels"
            on={layers.lyapunov}
            dashed
            color={palette.wc}
            focus="group:lyapunov"
            onToggle={toggle('lyapunov')}
            formula={`V = ${analysis.global.lyapunov.vLatex}`}
          />
        </Block>
      )}

      {showPlane && (
        <Block>
          <LayerRow title="Vector field" on={layers.vectorField} dashed={false} color={palette.muted} focus="group:arrows" onToggle={toggle('vectorField')} />
        </Block>
      )}

      {analysis.basinField && (
        <Block>
          <LayerRow title="Basins" on={layers.basins} dashed={false} color={palette.stableEq} focus="group:basins" onToggle={toggle('basins')} />
        </Block>
      )}

      {spec.dimension < 4 && (
        <Block>
          <LayerRow title="Time series" on={layers.timeSeries} dashed={false} color={palette.muted} focus="group:time" onToggle={toggle('timeSeries')} />
        </Block>
      )}

      {showPlane && (
        <Block>
          <LayerRow title="Flow of a small disk" on={flowMap.active} dashed={false} color={palette.droplet} focus="group:flow" onToggle={toggleFlowMap} />
        </Block>
      )}

      {showPlane && !spec.isAutonomous && (
        <Block>
          <LayerRow title="Extended phase space" on={extendedPhase} dashed={false} color={palette.muted} focus="group:extended" onToggle={() => setExtendedPhase(!extendedPhase)} />
        </Block>
      )}
    </div>
  );
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
