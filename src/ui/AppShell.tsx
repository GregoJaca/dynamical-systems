import { useEffect, useMemo, useState } from 'react';
import { PhaseCanvas2D } from '../render2d/PhaseCanvas2D';
import { PhaseLine1D } from '../render2d/PhaseLine1D';
import { PolarPhaseCanvas2D } from '../render2d/PolarPhaseCanvas2D';
import { TraceDetMinimap } from '../render2d/TraceDetMinimap';
import { HigherDimView } from '../render3d/HigherDimView';
import { PhaseScene3D } from '../render3d/PhaseScene3D';
import { useSystemStore } from '../store/useSystemStore';
import { EquationPanel } from './EquationPanel';
import { ExampleGallery } from './ExampleGallery';
import { hideObjects } from './filterAnalysis';
import { InspectorDrawer } from './InspectorDrawer';
import { ViewportToolbar } from './ViewportToolbar';

function PortraitStage() {
  const spec = useSystemStore((state) => state.spec);
  const rawAnalysis = useSystemStore((state) => state.analysis);
  const hiddenObjectIds = useSystemStore((state) => state.hiddenObjectIds);
  const layers = useSystemStore((state) => state.layers);
  const theme = useSystemStore((state) => state.theme);
  const particles = useSystemStore((state) => state.particles);
  const compiled = useSystemStore((state) => state.compiled);
  const hoverObjectId = useSystemStore((state) => state.hoverObjectId);
  const selectedObjectId = useSystemStore((state) => state.selectedObjectId);
  const selectedEquilibriumId = useSystemStore((state) => state.selectedEquilibriumId);
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
  const selectEquilibrium = useSystemStore((state) => state.selectEquilibrium);
  const analysis = useMemo(() => hideObjects(rawAnalysis, hiddenObjectIds), [rawAnalysis, hiddenObjectIds]);

  const flowActive = flowMap.active;
  const flowPlaying = flowMap.playing;
  useEffect(() => {
    if (!flowActive || !flowPlaying) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = useSystemStore.getState().flowMap;
      if (!current.active || !current.playing) return;
      let time = current.time + dt * 0.8;
      if (time > current.timeMax) time = -current.timeMax;
      useSystemStore.getState().setFlowMap({ time });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [flowActive, flowPlaying]);

  const showExtended = spec.dimension === 2 && !spec.isAutonomous && extendedPhase;
  const show3d = spec.dimension === 3 || showExtended;
  const showLine = spec.dimension === 1 && !show3d;
  const show2d = spec.dimension === 2 && !show3d;
  const showHigh = spec.dimension >= 4;
  const showPolar = layers.polarSplit && spec.dimension === 2 && !showExtended;
  const showSeries = layers.timeSeries && spec.dimension < 4;
  const chip = showHigh ? 'Projection and time series' : show3d ? (showExtended ? '(x, y, t)' : 'Phase space') : showLine ? 'Phase line' : '(x, y)';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className={`grid min-h-0 flex-1 gap-2 ${showPolar ? 'grid-cols-1 min-[900px]:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="relative min-h-0">
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/35 px-2 py-1 text-xs">{chip}</div>
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
          {layers.traceDetMinimap && spec.dimension === 2 && (
            <div className="absolute bottom-2 left-2 z-10 w-56">
              <TraceDetMinimap analysis={analysis} theme={theme} selectedEquilibriumId={selectedEquilibriumId} onSelectEquilibrium={selectEquilibrium} />
            </div>
          )}
        </div>
        {showPolar && (
          <div className="relative min-h-0">
            <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/35 px-2 py-1 text-xs">(r, θ)</div>
            <PolarPhaseCanvas2D spec={spec} analysis={analysis} theme={theme} compiled={compiled} userOrbits={userOrbits} particles={particles} onTracePolar={tracePolar} />
          </div>
        )}
      </div>
      {showSeries && (
        <div className="h-[34%] min-h-[160px]">
          <HigherDimView spec={spec} analysis={analysis} theme={theme} compiled={compiled} onTracePoint={tracePoint} />
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const theme = useSystemStore((state) => state.theme);
  const [showEquations, setShowEquations] = useState(true);
  const [showInspector, setShowInspector] = useState(true);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className={`absolute bottom-3 right-3 top-16 z-0 ${showEquations ? 'left-3 min-[1180px]:left-[368px]' : 'left-3'} ${showInspector ? 'min-[1180px]:right-[408px]' : ''}`}
      >
        <PortraitStage />
      </div>
      {showEquations && (
        <div className="absolute bottom-3 left-3 top-3 z-20">
          <EquationPanel onClose={() => setShowEquations(false)} />
        </div>
      )}
      {showInspector && (
        <div className="absolute bottom-3 right-3 top-3 z-20">
          <InspectorDrawer onClose={() => setShowInspector(false)} />
        </div>
      )}
      <ViewportToolbar
        showEquations={showEquations}
        showInspector={showInspector}
        onToggleEquations={() => setShowEquations((open) => !open)}
        onToggleInspector={() => setShowInspector((open) => !open)}
      />
      <ExampleGallery />
    </div>
  );
}
