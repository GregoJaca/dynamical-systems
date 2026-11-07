import { useEffect, useState } from 'react';
import { PhaseCanvas2D } from '../render2d/PhaseCanvas2D';
import { PhaseLine1D } from '../render2d/PhaseLine1D';
import { PolarPhaseCanvas2D } from '../render2d/PolarPhaseCanvas2D';
import { TraceDetMinimap } from '../render2d/TraceDetMinimap';
import { HigherDimView } from '../render3d/HigherDimView';
import { PhaseScene3D } from '../render3d/PhaseScene3D';
import { useSystemStore } from '../store/useSystemStore';
import { CoordinatesPanel } from './CoordinatesPanel';
import { EquationPanel } from './EquationPanel';
import { EquilibriaPanel } from './EquilibriaPanel';
import { ExampleGallery } from './ExampleGallery';
import { hideObjects } from './filterAnalysis';
import { ObjectTree } from './ObjectTree';
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
  const analysis = hideObjects(rawAnalysis, hiddenObjectIds);

  const showExtended = spec.dimension === 2 && !spec.isAutonomous && extendedPhase;
  const show3d = spec.dimension === 3 || showExtended;
  const showLine = spec.dimension === 1 && !show3d;
  const show2d = spec.dimension === 2 && !show3d;
  const showHigh = spec.dimension >= 4;

  const polar = analysis.coordinateTransforms.polar2D;
  const polarUseful = Boolean(polar?.isRecommended);

  return (
    <div className="portrait-page">
      {showHigh ? (
        <HigherDimView spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} role="stacked" />
      ) : (
        <>
          <h2>Phase portrait</h2>
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
          </div>
        </>
      )}

      {show2d && polarUseful && (
        <section className="below">
          <h2>Polar coordinates</h2>
          <p className="lede">
            Distance r runs left to right. Angle θ runs upward. A vertical line is a circle in the phase portrait.
          </p>
          <div className="stage polar-stage">
            <PolarPhaseCanvas2D
              spec={spec}
              analysis={analysis}
              theme={theme}
              compiled={compiled}
              layers={layers}
              hoverObjectId={hoverObjectId}
              selectedObjectId={selectedObjectId}
              userOrbits={userOrbits}
              particles={particles}
              onTracePolar={tracePolar}
            />
          </div>
        </section>
      )}
      {layers.timeSeries && spec.dimension < 4 && (
        <section className="below">
          <HigherDimView spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} role="series" />
        </section>
      )}
    </div>
  );
}

function Visualization() {
  const spec = useSystemStore((state) => state.spec);
  const layers = useSystemStore((state) => state.layers);
  const particles = useSystemStore((state) => state.particles);
  const theme = useSystemStore((state) => state.theme);
  const analysis = useSystemStore((state) => state.analysis);
  const toggleParticles = useSystemStore((state) => state.toggleParticles);
  const showMotion = spec.dimension === 2 || spec.dimension === 3;
  return (
    <div className="side-stack">
      {showMotion && (
        <div className="button-row">
          <button type="button" className={particles.playing ? 'real-button on' : 'real-button'} onClick={toggleParticles}>
            {particles.playing ? 'Stop' : 'Play'}
          </button>
        </div>
      )}
      <ObjectTree />
      <p className="note-exports">
        <button type="button" className="real-button" onClick={() => void downloadPortrait('svg', spec, analysis, theme, layers)}>
          Download SVG
        </button>
        <button type="button" className="real-button" onClick={() => void downloadPortrait('png', spec, analysis, theme, layers)}>
          Download PNG
        </button>
      </p>
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
      {analysis.equilibria.length > 0 && (
        <section>
          <h2>Equilibria</h2>
          <EquilibriaPanel />
        </section>
      )}
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
      <CoordinatesPanel />
    </div>
  );
}

function About() {
  return (
    <div className="system-page about-page">
      <h1>About</h1>
      <p>The goal of this site is to aid in the understanding of dynamical systems. I highly recommend first solving problems by hand and sketching by hand, and only later to use visualization tools.</p>
      <p>
        For any issues / questions / ideas you can email me at:{' '}
        <a href="mailto:gregorio.jaca@gmail.com">gregorio.jaca@gmail.com</a>
      </p>
      <p>
        To contribute, please check out{' '}
        <a href="https://github.com/GregoJaca/dynamical-systems">https://github.com/GregoJaca/dynamical-systems</a>
      </p>
    </div>
  );
}

export function AppShell() {
  const theme = useSystemStore((state) => state.theme);
  const view = useSystemStore((state) => state.view);
  const setView = useSystemStore((state) => state.setView);
  const setTheme = useSystemStore((state) => state.setTheme);
  const copyShareLink = useSystemStore((state) => state.copyShareLink);
  const [notice, setNotice] = useState('');
  const [studyTab, setStudyTab] = useState<'system' | 'picture' | 'notes'>('system');

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

  return (
    <div className="app">
      <header className="topbar">
        <nav>
          <button type="button" className={view === 'system' ? 'current' : ''} onClick={() => setView('system')}>
            Home
          </button>
          <button type="button" className={view === 'examples' ? 'current' : ''} onClick={() => setView('examples')}>
            Examples
          </button>
          <button type="button" className={view === 'about' ? 'current' : ''} onClick={() => setView('about')}>
            About
          </button>
        </nav>
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
      <main className={view === 'portrait' ? 'study-main' : ''}>
        {view === 'system' && (
          <div className="system-page">
            <h1>Nonlinear dynamical systems</h1>
            <p className="lede">
              Write a system here, or open Examples in the bar above. The name on the left of each row is the variable. Clearing an equation keeps the variable; Remove deletes it.
            </p>
            <EquationPanel />
          </div>
        )}
        {view === 'portrait' && (
          <div className="study-grid">
            <div className="study-picture">
              <Portrait />
            </div>
            <aside className="study-side">
              <div className="tabs">
                <button type="button" className={studyTab === 'system' ? 'current' : ''} onClick={() => setStudyTab('system')}>
                  System
                </button>
                <button type="button" className={studyTab === 'picture' ? 'current' : ''} onClick={() => setStudyTab('picture')}>
                  Visualization
                </button>
                <button type="button" className={studyTab === 'notes' ? 'current' : ''} onClick={() => setStudyTab('notes')}>
                  Notes
                </button>
              </div>
              <div className="side-body">
                {studyTab === 'system' && <EquationPanel />}
                {studyTab === 'picture' && <Visualization />}
                {studyTab === 'notes' && <Notes />}
              </div>
            </aside>
          </div>
        )}
        {view === 'examples' && <ExampleGallery />}
        {view === 'about' && <About />}
      </main>
    </div>
  );
}
