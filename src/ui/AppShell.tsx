import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

function useNarrowStudy() {
  const query = '(max-width: 860px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return narrow;
}

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
  const deleteTrajectory = useSystemStore((state) => state.deleteTrajectory);
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

  const showPolar = show2d && polarUseful;
  const showSeries = layers.timeSeries && spec.dimension < 4;

  const primary = (
      <div className={showHigh ? 'portrait-primary portrait-tall' : 'portrait-primary'}>
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
                  onDeleteTrajectory={deleteTrajectory}
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
      </div>
  );

  const extras =
    showPolar || showSeries ? (
        <div className="portrait-extras">
          {showPolar && (
            <section className="below">
              <h2>Polar coordinates</h2>
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
          {showSeries && (
            <section className="below">
              <HigherDimView spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} role="series" />
            </section>
          )}
        </div>
    ) : null;

  return (
    <div className="portrait-page">
      {primary}
      {extras}
    </div>
  );
}

function clampPanel(total: number, height: number) {
  const minPanel = 124;
  const minPicture = 160;
  const maxPanel = Math.max(minPanel, total - minPicture);
  return Math.min(maxPanel, Math.max(minPanel, height));
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
          <p className="lede">We can classify eq. points of 2D systems we can use the trace and determinant. This shows you where each eq. point is.</p>
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
        PDE lab is a separate page for the heat equation and characteristics. <a href="./pde/">PDE lab</a>
      </p>
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
  const narrow = useNarrowStudy();
  const sideScrollRef = useRef<HTMLDivElement>(null);
  const studyRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<{ pointer: number; startY: number; startHeight: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const panelHeightRef = useRef<number | null>(null);
  panelHeightRef.current = panelHeight;
  const openStudyTab = (tab: 'system' | 'picture' | 'notes') => {
    setStudyTab(tab);
    if (narrow) sideScrollRef.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!narrow) return;
    const grid = studyRef.current;
    if (!grid) return;
    setPanelHeight((current) => clampPanel(grid.clientHeight, current ?? Math.round(grid.clientHeight * 0.42)));
  }, [narrow]);

  useEffect(() => {
    const grid = studyRef.current;
    if (!grid || !narrow) return;
    const observer = new ResizeObserver(() => {
      setPanelHeight((current) => (current == null ? current : clampPanel(grid.clientHeight, current)));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [narrow]);

  const onSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !narrow || panelHeight == null) return;
    splitDrag.current = { pointer: event.pointerId, startY: event.clientY, startHeight: panelHeight };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* The drag still tracks while the pointer stays on the handle. */
    }
  };

  const onSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current;
    const grid = studyRef.current;
    if (!drag || drag.pointer !== event.pointerId || !grid) return;
    setPanelHeight(clampPanel(grid.clientHeight, drag.startHeight - (event.clientY - drag.startY)));
  };

  const onSplitPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitDrag.current?.pointer === event.pointerId) splitDrag.current = null;
  };

  useEffect(() => {
    const handle = splitRef.current;
    if (!handle) return;
    let active = false;
    let startY = 0;
    let startH = 0;

    const onTouchMove = (event: TouchEvent) => {
      if (!active) return;
      event.preventDefault();
      const grid = studyRef.current;
      const touch = event.touches[0];
      if (!grid || !touch) return;
      setPanelHeight(clampPanel(grid.clientHeight, startH - (touch.clientY - startY)));
    };

    const onTouchEnd = () => {
      active = false;
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!window.matchMedia('(max-width: 860px)').matches || event.touches.length !== 1) return;
      event.preventDefault();
      const grid = studyRef.current;
      active = true;
      startY = event.touches[0].clientY;
      startH = panelHeightRef.current ?? (grid ? Math.round(grid.clientHeight * 0.42) : 280);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchEnd);
    };

    handle.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => {
      handle.removeEventListener('touchstart', onTouchStart);
      onTouchEnd();
    };
  }, [view]);

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
            <EquationPanel />
          </div>
        )}
        {view === 'portrait' && (
          <div className="study-grid" ref={studyRef}>
            <div className="study-picture">
              <Portrait />
            </div>
            <div
              ref={splitRef}
              className="study-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panels"
              aria-valuemin={124}
              aria-valuenow={panelHeight ?? undefined}
              tabIndex={0}
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
              onKeyDown={(event) => {
                if (!narrow || panelHeight == null || !studyRef.current) return;
                const step = event.key === 'ArrowUp' ? 28 : event.key === 'ArrowDown' ? -28 : 0;
                if (!step) return;
                event.preventDefault();
                setPanelHeight(clampPanel(studyRef.current.clientHeight, panelHeight + step));
              }}
            />
            <aside className="study-side" style={narrow && panelHeight != null ? { height: panelHeight } : undefined}>
              <div className="tabs">
                <button type="button" className={studyTab === 'system' ? 'current' : ''} onClick={() => openStudyTab('system')}>
                  System
                </button>
                <button type="button" className={studyTab === 'picture' ? 'current' : ''} onClick={() => openStudyTab('picture')}>
                  Visualization
                </button>
                <button type="button" className={studyTab === 'notes' ? 'current' : ''} onClick={() => openStudyTab('notes')}>
                  Notes
                </button>
              </div>
              <div className="side-scroll" ref={sideScrollRef}>
                <div className="side-body">
                  {studyTab === 'system' && <EquationPanel />}
                  {studyTab === 'picture' && <Visualization />}
                  {studyTab === 'notes' && <Notes />}
                </div>
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
