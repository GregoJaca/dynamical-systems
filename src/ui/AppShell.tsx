import { useEffect, useState } from 'react';
import { PhaseCanvas2D } from '../render2d/PhaseCanvas2D';
import { PhaseLine1D } from '../render2d/PhaseLine1D';
import { PolarPhaseCanvas2D } from '../render2d/PolarPhaseCanvas2D';
import { TraceDetMinimap } from '../render2d/TraceDetMinimap';
import { HigherDimView } from '../render3d/HigherDimView';
import { PhaseScene3D } from '../render3d/PhaseScene3D';
import { exampleById } from '../examples/perkoExamples';
import { useSystemStore } from '../store/useSystemStore';
import { CoordinatesPanel } from './CoordinatesPanel';
import { EquationPanel } from './EquationPanel';
import { EquilibriaPanel } from './EquilibriaPanel';
import { ExampleGallery } from './ExampleGallery';
import { hideObjects } from './filterAnalysis';
import { ObjectTree } from './ObjectTree';
import { prettyLabel } from './format';
import { Katex } from './Katex';
import { TheoremsPanel } from './TheoremsPanel';
import { downloadPortrait } from './downloadPortrait';

function Portrait() {
  const spec = useSystemStore((state) => state.spec);
  const rawAnalysis = useSystemStore((state) => state.analysis);
  const hiddenObjectIds = useSystemStore((state) => state.hiddenObjectIds);
  const layers = useSystemStore((state) => state.layers);
  const theme = useSystemStore((state) => state.theme);
  const particles = useSystemStore((state) => state.particles);
  const compiled = useSystemStore((state) => state.compiled);
  const hoverObjectId = useSystemStore((state) => state.hoverObjectId);
  const selectedObjectId = useSystemStore((state) => state.selectedObjectId);
  const linearization = useSystemStore((state) => state.linearization);
  const flowMap = useSystemStore((state) => state.flowMap);
  const userOrbits = useSystemStore((state) => state.userOrbits);
  const extendedPhase = useSystemStore((state) => state.extendedPhase);
  const hoverObject = useSystemStore((state) => state.hoverObject);
  const selectObject = useSystemStore((state) => state.selectObject);
  const setViewport = useSystemStore((state) => state.setViewport);
  const resetViewport = useSystemStore((state) => state.resetViewport);
  const tracePoint = useSystemStore((state) => state.tracePoint);
  const tracePolar = useSystemStore((state) => state.tracePolar);
  const setFlowMap = useSystemStore((state) => state.setFlowMap);
  const toggleLayer = useSystemStore((state) => state.toggleLayer);
  const toggleParticles = useSystemStore((state) => state.toggleParticles);
  const setParticleMode = useSystemStore((state) => state.setParticleMode);
  const toggleFlowMap = useSystemStore((state) => state.toggleFlowMap);
  const setExtendedPhase = useSystemStore((state) => state.setExtendedPhase);
  const analysis = hideObjects(rawAnalysis, hiddenObjectIds);

  const showExtended = spec.dimension === 2 && !spec.isAutonomous && extendedPhase;
  const show3d = spec.dimension === 3 || showExtended;
  const showLine = spec.dimension === 1 && !show3d;
  const show2d = spec.dimension === 2 && !show3d;
  const showHigh = spec.dimension >= 4;

  return (
    <div className="portrait-page">
      <div className="stage">
        {showLine && <PhaseLine1D spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} />}
        {show2d && (
          <PhaseCanvas2D
            spec={spec}
            analysis={analysis}
            layers={layers}
            particles={particles}
            theme={theme}
            hoverObjectId={hoverObjectId}
            selectedObjectId={selectedObjectId}
            linearization={linearization}
            flowMap={flowMap}
            userOrbits={userOrbits}
            compiled={compiled}
            onHoverObject={hoverObject}
            onSelectObject={selectObject}
            onViewportChange={setViewport}
            onTracePoint={tracePoint}
            onFlowMapChange={setFlowMap}
            onResetViewport={resetViewport}
          />
        )}
        {show3d && (
          <PhaseScene3D
            spec={spec}
            analysis={analysis}
            layers={layers}
            theme={theme}
            particles={particles}
            userOrbits={userOrbits}
            selectedObjectId={selectedObjectId}
            hoverObjectId={hoverObjectId}
            onSelectObject={selectObject}
            onTracePoint={tracePoint}
          />
        )}
        {showHigh && <HigherDimView spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} />}
      </div>

      <div className="portrait-tools">
        {show2d && (
          <button type="button" onClick={toggleParticles}>
            {particles.playing ? 'Stop motion' : 'Move along the curves'}
          </button>
        )}
        {show2d && particles.playing && (
          <button type="button" onClick={() => setParticleMode(particles.mode === 'trueVelocity' ? 'uniformSpeed' : 'trueVelocity')}>
            {particles.mode === 'trueVelocity' ? 'Speed follows the vector field' : 'Uniform speed'}
          </button>
        )}
      </div>

      {analysis.equilibria.length > 0 && (
        <ul className="equilibrium-list">
          {analysis.equilibria.map((eq) => (
            <li key={eq.id}>
              <Katex tex={eq.familyFormulaLatex || eq.coordsExactLatex?.join(', ') || eq.coords.map((value) => value.toPrecision(3)).join(', ')} />
              <span>{prettyLabel(eq.classification2D ?? eq.classification3D ?? eq.stability)}</span>
            </li>
          ))}
        </ul>
      )}

      {show2d && (
        <section className="below">
          <h2>Polar coordinates</h2>
          <div className="stage polar-stage">
            <PolarPhaseCanvas2D spec={spec} analysis={analysis} theme={theme} compiled={compiled} userOrbits={userOrbits} particles={particles} onTracePolar={tracePolar} />
          </div>
        </section>
      )}

      <section className="below">
        <h2>What is drawn</h2>
        <div className="check-list">
          {(
            [
              ['streamlines', 'Trajectories'],
              ['separatrices', 'Separatrices'],
              ['manifoldsWuWs', 'Stable and unstable manifolds'],
              ['centerManifoldWc', 'Center manifold'],
              ['linearSubspaces', 'Eigenspaces'],
              ['nullclines', 'Nullclines'],
              ['limitCycles', 'Limit cycles'],
              ['vectorField', 'Vector field arrows'],
              ['basins', 'Basins'],
              ['lyapunov', 'Lyapunov levels'],
              ['hamiltonianContours', 'Hamiltonian levels'],
              ['equilibria', 'Equilibria'],
              ['timeSeries', 'Time series'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} /> {label}
            </label>
          ))}
          {show2d && (
            <label>
              <input type="checkbox" checked={flowMap.active} onChange={toggleFlowMap} /> Flow of a small disk
            </label>
          )}
          {spec.dimension === 2 && !spec.isAutonomous && (
            <label>
              <input type="checkbox" checked={extendedPhase} onChange={() => setExtendedPhase(!extendedPhase)} /> Extended phase space (x, y, t)
            </label>
          )}
        </div>
        {layers.timeSeries && spec.dimension < 4 && (
          <div className="stage polar-stage">
            <HigherDimView spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} />
          </div>
        )}
        <ObjectTree />
        <p className="note-exports">
          <button type="button" className="text-button" onClick={() => void downloadPortrait('svg', spec, analysis, theme, layers)}>
            Download SVG
          </button>
          <button type="button" className="text-button" onClick={() => void downloadPortrait('png', spec, analysis, theme, layers)}>
            Download PNG
          </button>
        </p>
      </section>
    </div>
  );
}

function Notes() {
  const spec = useSystemStore((state) => state.spec);
  const analysis = useSystemStore((state) => state.analysis);
  const theme = useSystemStore((state) => state.theme);
  const selectedEquilibriumId = useSystemStore((state) => state.selectedEquilibriumId);
  const selectEquilibrium = useSystemStore((state) => state.selectEquilibrium);

  return (
    <div className="notes-page">
      <section>
        <h2>Equilibria</h2>
        <EquilibriaPanel />
      </section>
      <section>
        <h2>Theorems</h2>
        <TheoremsPanel />
      </section>
      {spec.dimension === 2 && (
        <section>
          <h2>Trace and determinant</h2>
          <p className="lede">Where this system’s equilibria sit in the classification plane. The picture of the flow stays on the portrait.</p>
          <div className="trace-det">
            <TraceDetMinimap analysis={analysis} theme={theme} selectedEquilibriumId={selectedEquilibriumId} onSelectEquilibrium={selectEquilibrium} />
          </div>
        </section>
      )}
      <section>
        <h2>Coordinates and integrals</h2>
        <CoordinatesPanel />
      </section>
    </div>
  );
}

export function AppShell() {
  const theme = useSystemStore((state) => state.theme);
  const view = useSystemStore((state) => state.view);
  const setView = useSystemStore((state) => state.setView);
  const setTheme = useSystemStore((state) => state.setTheme);
  const copyShareLink = useSystemStore((state) => state.copyShareLink);
  const exampleId = useSystemStore((state) => state.exampleId);
  const spec = useSystemStore((state) => state.spec);
  const example = exampleById(exampleId);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  const share = async () => {
    const url = copyShareLink();
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied');
    } catch {
      setNotice('Link is in the address bar');
    }
    window.setTimeout(() => setNotice(''), 1600);
  };

  const title = example?.title ?? (spec.id === 'custom' ? 'Custom system' : 'System');

  return (
    <div className="app">
      <header className="topbar">
        <nav>
          <button type="button" className={view === 'system' ? 'current' : ''} onClick={() => setView('system')}>
            System
          </button>
          <button type="button" className={view === 'portrait' ? 'current' : ''} onClick={() => setView('portrait')}>
            Portrait
          </button>
          <button type="button" className={view === 'notes' ? 'current' : ''} onClick={() => setView('notes')}>
            Notes
          </button>
          <button type="button" className={view === 'examples' ? 'current' : ''} onClick={() => setView('examples')}>
            Examples
          </button>
        </nav>
        <strong className="current-title">{title}</strong>
        <div className="top-actions">
          {notice && <span>{notice}</span>}
          <button type="button" className="text-button" onClick={() => void share()}>
            Share
          </button>
          <button type="button" className="text-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>
      <main>
        {view === 'system' && (
          <div className="system-page">
            <h1>Define a system</h1>
            <p className="lede">Write the right-hand side of each equation. A blank row adds a variable. Or start from an example.</p>
            <EquationPanel />
          </div>
        )}
        {view === 'portrait' && <Portrait />}
        {view === 'notes' && <Notes />}
        {view === 'examples' && <ExampleGallery />}
      </main>
    </div>
  );
}
