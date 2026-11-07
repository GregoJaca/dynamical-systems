import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type {
  CompiledSystem,
  LayerVisibility,
  NumericAnalysis,
  PhaseCanvas2DProps,
  StreamlineSegment,
  SystemSpec,
  ViewportBounds,
} from '../core/types';
import { PALETTE, equilibriumColor } from '../core/palette';
import { clipInfiniteLine, finitePair, makeView, panViewport, shoelace, worldToScreen, zoomViewport, type ViewRect } from './geometry';
import { objectAnchor, objectFormula, viewportKey } from './formulas';
import { hitTestPhase } from './hitTest';
import { linearField, precomputeDroplet, sampleDroplet, synthesizeLinearOrbits, type DropletCache } from './integrate';
import { spawnParticles, stepParticles, type SimParticle } from './particles';
import { contourLines, sampleGrid } from './contours';
import { compileScalarField } from './scalars';
import {
  paintPhaseFrame,
  rasterBasins,
  rasterScalar,
  type ArrowSample,
} from './paint';

interface Size {
  w: number;
  h: number;
}

interface FieldCache {
  basinStamp: string;
  basin: HTMLCanvasElement | null;
  lyapKey: string;
  lyapAt: number;
  lyap: HTMLCanvasElement | null;
  hamKey: string;
  hamAt: number;
  ham: number[][][] | null;
  arrowKey: string;
  arrowAt: number;
  arrows: ArrowSample[] | null;
  linearArrowKey: string;
  linearArrows: ArrowSample[] | null;
}

function parameterRecord(spec: SystemSpec, compiled: CompiledSystem | null): Record<string, number> {
  if (compiled) return compiled.parameterValues;
  const values: Record<string, number> = {};
  for (const [name, parameter] of Object.entries(spec.parameters)) values[name] = parameter.value;
  return values;
}

function layoutViews(width: number, height: number, viewport: ViewportBounds, split: boolean): { main: ViewRect; linear: ViewRect | null } {
  if (split && width > 140) {
    const gap = 18;
    const pane = (width - gap) / 2;
    return {
      main: makeView(viewport, 0, 0, pane, height),
      linear: makeView(viewport, pane + gap, 0, pane, height),
    };
  }
  return { main: makeView(viewport, 0, 0, width, height), linear: null };
}

function collectCurves(analysis: NumericAnalysis, layers: LayerVisibility, userOrbits: StreamlineSegment[]) {
  const curves: Array<{ id: string; points: number[][]; velocities?: number[]; limitId?: string }> = [];
  for (const segment of analysis.streamlines) {
    const separatrix = segment.category === 'separatrix';
    if (separatrix ? !layers.separatrices : !layers.streamlines) continue;
    curves.push({
      id: segment.id,
      points: segment.points,
      velocities: segment.velocities,
      limitId: segment.forwardLimitId,
    });
  }
  for (const manifold of analysis.manifolds) {
    const visible = manifold.kind === 'Wc' ? layers.centerManifoldWc : layers.manifoldsWuWs;
    if (!visible) continue;
    curves.push({ id: manifold.id, points: manifold.points, limitId: manifold.equilibriumId });
  }
  if (layers.limitCycles) {
    for (const cycle of analysis.limitCycles) curves.push({ id: cycle.id, points: cycle.points, limitId: cycle.id });
  }
  for (const orbit of userOrbits) {
    curves.push({ id: orbit.id, points: orbit.points, velocities: orbit.velocities, limitId: orbit.forwardLimitId });
  }
  return curves;
}

function sampleArrows(
  field: (x: number, y: number) => [number, number] | null,
  view: ViewRect,
  columns: number,
  rows: number,
): ArrowSample[] {
  const arrows: ArrowSample[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = view.xMin + ((column + 0.5) * (view.xMax - view.xMin)) / columns;
      const y = view.yMin + ((row + 0.5) * (view.yMax - view.yMin)) / rows;
      const value = field(x, y);
      if (!value) continue;
      arrows.push({ x, y, fx: value[0], fy: value[1] });
    }
  }
  return arrows;
}

function renderFormula(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false, displayMode: false });
  } catch {
    return source;
  }
}

export function PhaseCanvas2D(props: PhaseCanvas2DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const particlesRef = useRef<SimParticle[]>([]);
  const particleKeyRef = useRef('');
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const paintKick = useRef<() => void>(() => {});
  const cacheRef = useRef<FieldCache>({
    basinStamp: '',
    basin: null,
    lyapKey: '',
    lyapAt: 0,
    lyap: null,
    hamKey: '',
    hamAt: 0,
    ham: null,
    arrowKey: '',
    arrowAt: 0,
    arrows: null,
    linearArrowKey: '',
    linearArrows: null,
  });
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);
  propsRef.current = props;

  const paramKey = props.compiled ? JSON.stringify(props.compiled.parameterValues) : '';
  const compiledRef = useRef(props.compiled);
  compiledRef.current = props.compiled;

  const linearOrbits = useMemo(() => {
    if (props.linearization.mode === 'off') return [];
    if (props.linearization.streamlines.length > 0) {
      return props.linearization.streamlines.map((segment) => ({ id: segment.id, points: segment.points }));
    }
    const equilibrium = props.analysis.equilibria.find((item) => item.id === props.linearization.equilibriumId);
    if (!equilibrium) return [];
    return synthesizeLinearOrbits(equilibrium, props.analysis.viewport);
  }, [props.linearization, props.analysis.equilibria, props.analysis.viewport]);

  const dropletCache = useMemo<DropletCache | null>(() => {
    const system = compiledRef.current;
    if (!props.flowMap.active || !system) return null;
    return precomputeDroplet({
      f: system.f,
      params: system.parameterValues,
      cx: props.flowMap.cx,
      cy: props.flowMap.cy,
      radius: props.flowMap.radius,
      timeMax: Math.max(0, props.flowMap.timeMax),
    });
  }, [props.flowMap.active, props.flowMap.cx, props.flowMap.cy, props.flowMap.radius, props.flowMap.timeMax, props.spec.revision, paramKey]);

  const lyapEval = useMemo(
    () =>
      compileScalarField(
        props.analysis.global.lyapunov?.vDotExpr,
        props.spec.stateVars,
        parameterRecord(props.spec, props.compiled),
        props.spec.independentVar,
      ),
    [props.analysis.global.lyapunov?.vDotExpr, props.spec.revision, props.spec.independentVar, paramKey, props.spec.stateVars],
  );
  const hamEval = useMemo(
    () =>
      compileScalarField(
        props.analysis.global.hamiltonianExpr,
        props.spec.stateVars,
        parameterRecord(props.spec, props.compiled),
        props.spec.independentVar,
      ),
    [props.analysis.global.hamiltonianExpr, props.spec.revision, props.spec.independentVar, paramKey, props.spec.stateVars],
  );

  const bundleRef = useRef({
    props,
    linearOrbits,
    dropletCache,
    lyapEval,
    hamEval,
  });
  bundleRef.current = { props, linearOrbits, dropletCache, lyapEval, hamEval };

  const particleKey = [
    props.analysis.revision,
    props.analysis.streamlines.length,
    props.analysis.manifolds.length,
    props.analysis.limitCycles.length,
    props.userOrbits.length,
    props.particles.count,
    props.layers.streamlines,
    props.layers.separatrices,
    props.layers.manifoldsWuWs,
    props.layers.centerManifoldWc,
    props.layers.limitCycles,
  ].join(':');
  if (particleKeyRef.current !== particleKey) {
    particleKeyRef.current = particleKey;
    particlesRef.current = spawnParticles(
      collectCurves(props.analysis, props.layers, props.userOrbits),
      props.particles.count,
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w, h, dpr };
      const bufferW = Math.max(1, Math.round(w * dpr));
      const bufferH = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bufferW || canvas.height !== bufferH) {
        canvas.width = bufferW;
        canvas.height = bufferH;
      }
      setSize((previous) => (previous.w === w && previous.h === h ? previous : { w, h }));
      paintKick.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h, dpr } = sizeRef.current;
      const bundle = bundleRef.current;
      if (w > 1 && h > 1 && !document.hidden) {
        const { props: current } = bundle;
        if (current.particles.playing && current.layers.particles) {
          const span = Math.max(
            current.analysis.viewport.xMax - current.analysis.viewport.xMin,
            current.analysis.viewport.yMax - current.analysis.viewport.yMin,
          );
          stepParticles(particlesRef.current, dt, current.particles.mode, span);
        }
        const split = current.linearization.mode === 'split';
        const layout = layoutViews(w, h, current.analysis.viewport, split);
        refreshCaches(cacheRef.current, bundle, layout.main, layout.linear, now);
        const ghost = bundle.dropletCache?.frames.find((item) => item.time === 0)?.ring ?? [];
        const deformed =
          current.flowMap.active && bundle.dropletCache ? sampleDroplet(bundle.dropletCache, current.flowMap.time) : [];
        const equilibrium =
          current.analysis.equilibria.find((item) => item.id === current.linearization.equilibriumId) ?? null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintPhaseFrame({
          ctx,
          cssWidth: w,
          cssHeight: h,
          theme: current.theme,
          view: layout.main,
          linearView: layout.linear,
          analysis: current.analysis,
          layers: current.layers,
          focusId: current.hoverObjectId,
          selectedId: current.selectedObjectId,
          particles: particlesRef.current,
          showParticles: current.layers.particles,
          userOrbits: current.userOrbits,
          linearOrbits: bundle.linearOrbits,
          linearEquilibrium: current.linearization.mode === 'off' ? null : equilibrium,
          compareMode: current.linearization.mode,
          basinCanvas: cacheRef.current.basin,
          lyapunovCanvas: cacheRef.current.lyap,
          hamiltonian: cacheRef.current.ham,
          arrows: cacheRef.current.arrows,
          linearArrows: cacheRef.current.linearArrows,
          droplet: current.flowMap.active && deformed.length > 0 ? { ghost, deformed } : null,
        });
      }
      const live = propsRef.current;
      const moving = (live.particles.playing && live.layers.particles) || (live.flowMap.active && live.flowMap.playing);
      if (moving) requestFrame();
    };
    let scheduled = false;
    const requestFrame = () => {
      if (scheduled) return;
      scheduled = true;
      raf = requestAnimationFrame((now) => {
        scheduled = false;
        frame(now);
      });
    };
    paintKick.current = requestFrame;
    requestFrame();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = propsRef.current;
      const rect = wrap.getBoundingClientRect();
      const layout = layoutViews(
        sizeRef.current.w,
        sizeRef.current.h,
        current.analysis.viewport,
        current.linearization.mode === 'split',
      );
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const view = layout.linear && sx >= layout.linear.left ? layout.linear : layout.main;
      const [wx, wy] = screenToWorldSafe(view, sx, sy);
      const factor = Math.exp(-Math.max(-160, Math.min(160, event.deltaY)) * 0.0018);
      current.onViewportChange(zoomViewport(current.analysis.viewport, wx, wy, factor));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      wrap.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    paintKick.current();
  });

  useEffect(() => {
    if (!props.flowMap.active || !props.flowMap.playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = propsRef.current.flowMap;
      const speed = Math.max(0.35, current.timeMax / 6);
      let next = current.time + dt * speed;
      if (next > current.timeMax) next = -current.timeMax;
      propsRef.current.onFlowMapChange({ time: next });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.flowMap.active, props.flowMap.playing]);

  useEffect(() => {
    if (!props.hoverObjectId) {
      setTooltip(null);
      return;
    }
    const formula = objectFormula(props.hoverObjectId, props.analysis, props.userOrbits);
    if (!formula) {
      setTooltip(null);
      return;
    }
    const layout = layoutViews(size.w, size.h, props.analysis.viewport, props.linearization.mode === 'split');
    const anchor = objectAnchor(props.hoverObjectId, props.analysis, props.userOrbits);
    const [sx, sy] = anchor ? worldToScreen(layout.main, anchor[0] ?? 0, anchor[1] ?? 0) : [layout.main.left + 12, layout.main.top + 12];
    setTooltip({
      html: renderFormula(formula),
      x: Math.min(Math.max(8, sx + 14), Math.max(8, size.w - 240)),
      y: Math.min(Math.max(8, sy + 12), Math.max(8, size.h - 80)),
    });
  }, [props.hoverObjectId, props.analysis, props.userOrbits, props.linearization.mode, size]);

  const palette = PALETTE[props.theme];
  const layout = layoutViews(size.w, size.h, props.analysis.viewport, props.linearization.mode === 'split');
  const ring = props.flowMap.active && dropletCache ? sampleDroplet(dropletCache, props.flowMap.time) : [];
  const area = shoelace(ring);
  const ratio = dropletCache && dropletCache.area0 > 1e-8 ? area / dropletCache.area0 : 1;
  let divergence = Number.NaN;
  if (props.compiled) {
    try {
      const jacobian = props.compiled.J(0, [props.flowMap.cx, props.flowMap.cy], props.compiled.parameterValues);
      divergence = (jacobian[0]?.[0] ?? 0) + (jacobian[1]?.[1] ?? 0);
    } catch {
      divergence = Number.NaN;
    }
  }

  const dragRef = useRef<{
    kind: 'pan' | 'droplet';
    x: number;
    y: number;
    moved: boolean;
    viewport: ViewportBounds;
    cx: number;
    cy: number;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const view = layout.linear && sx >= layout.linear.left ? layout.linear : layout.main;
    const [wx, wy] = screenToWorldSafe(view, sx, sy);
    const insideDroplet =
      props.flowMap.active &&
      view === layout.main &&
      Math.hypot(wx - props.flowMap.cx, wy - props.flowMap.cy) <= props.flowMap.radius * 1.15;
    dragRef.current = {
      kind: insideDroplet ? 'droplet' : 'pan',
      x: event.clientX,
      y: event.clientY,
      moved: false,
      viewport: props.analysis.viewport,
      cx: props.flowMap.cx,
      cy: props.flowMap.cy,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      const view = layout.main;
      if (drag.kind === 'droplet') {
        const spanX = view.xMax - view.xMin;
        const spanY = view.yMax - view.yMin;
        props.onFlowMapChange({
          cx: drag.cx + (dx * spanX) / view.width,
          cy: drag.cy - (dy * spanY) / view.height,
        });
      } else if (drag.moved) {
        const spanX = drag.viewport.xMax - drag.viewport.xMin;
        const spanY = drag.viewport.yMax - drag.viewport.yMin;
        props.onViewportChange(
          panViewport(drag.viewport, (-dx * spanX) / view.width, (dy * spanY) / view.height),
        );
      }
      return;
    }
    const onLinear = layout.linear != null && sx >= layout.linear.left;
    const view = onLinear && layout.linear ? layout.linear : layout.main;
    const hit = onLinear ? null : hitTestPhase(view, sx, sy, props.analysis, props.userOrbits, props.layers);
    if (hit !== props.hoverObjectId) props.onHoverObject(hit);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved || event.detail > 1) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const onLinear = layout.linear != null && sx >= layout.linear.left;
    const view = onLinear && layout.linear ? layout.linear : layout.main;
    const hit = onLinear ? null : hitTestPhase(view, sx, sy, props.analysis, props.userOrbits, props.layers);
    if (hit) props.onSelectObject(hit);
    else {
      props.onSelectObject(null);
      const [wx, wy] = screenToWorldSafe(view, sx, sy);
      props.onTracePoint([wx, wy]);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: palette.bg, touchAction: 'none', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => props.onHoverObject(null)}
      onDoubleClick={() => props.onResetViewport()}
    >
      <canvas ref={canvasRef} data-phase-canvas="cartesian" className="absolute inset-0 h-full w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {props.layers.linearSubspaces &&
          props.analysis.equilibria.flatMap((equilibrium) =>
            equilibrium.subspaces.map((subspace) => {
              const basis = subspace.basisVectors[0];
              if (!basis) return null;
              const panes = layout.linear ? [layout.main, layout.linear] : [layout.main];
              return panes.map((view) => {
                const clipped = clipInfiniteLine(view, equilibrium.coords, basis);
                if (!clipped) return null;
                const [x1, y1] = worldToScreen(view, clipped[0], clipped[1]);
                const [x2, y2] = worldToScreen(view, clipped[2], clipped[3]);
                const id = `${equilibrium.id}:${subspace.kind}`;
                const color = subspace.kind === 'Es' ? palette.es : subspace.kind === 'Eu' ? palette.eu : palette.ec;
                const focused = props.hoverObjectId === id || props.hoverObjectId === equilibrium.id;
                const dim = props.hoverObjectId != null && !focused;
                return (
                  <line
                    key={`${view.left}:${id}`}
                    data-object-id={id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={color}
                    strokeWidth={focused ? 3 : 1.6}
                    strokeDasharray="7 5"
                    opacity={dim ? 0.2 : 0.95}
                  />
                );
              });
            }),
          )}
        {props.layers.equilibria &&
          props.analysis.equilibria.map((equilibrium) => {
            if (!finitePair(equilibrium.coords)) return null;
            const panes = layout.linear ? [layout.main] : [layout.main];
            return panes.map((view) => {
              const [sx, sy] = worldToScreen(view, equilibrium.coords[0], equilibrium.coords[1]);
              const color = equilibriumColor(
                equilibrium.stability,
                equilibrium.classification2D ?? equilibrium.classification3D,
                props.theme,
              );
              const focused = props.hoverObjectId === equilibrium.id || props.selectedObjectId === equilibrium.id;
              const dim = props.hoverObjectId != null && props.hoverObjectId !== equilibrium.id;
              const label = (equilibrium.classification2D ?? equilibrium.stability).replaceAll('_', ' ');
              const showLabel = focused || props.analysis.equilibria.length <= 8;
              return (
                <g key={`${view.left}:${equilibrium.id}`} data-object-id={equilibrium.id} opacity={dim ? 0.25 : 1} transform={`translate(${sx} ${sy})`}>
                  {equilibriumGlyph(equilibrium.classification2D, color, focused ? 7 : 5.5)}
                  {showLabel && (
                    <text x="10" y="-8" fill={palette.text} fontSize="11" fontFamily="Source Sans 3, Segoe UI, sans-serif">
                      {label}
                    </text>
                  )}
                </g>
              );
            });
          })}
      </svg>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md px-2 py-1 text-xs"
          style={{ left: tooltip.x, top: tooltip.y, background: palette.bg, color: palette.text, border: `1px solid ${palette.axis}` }}
          dangerouslySetInnerHTML={{ __html: tooltip.html }}
        />
      )}
      {props.flowMap.active && (
        <div
          className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-xs"
          style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.axis}`, pointerEvents: 'auto' }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <span>φₜ(U)</span>
          <input
            aria-label="Flow map time"
            type="range"
            min={-props.flowMap.timeMax}
            max={props.flowMap.timeMax}
            step={Math.max(props.flowMap.timeMax / 200, 0.01)}
            value={props.flowMap.time}
            onChange={(event) => props.onFlowMapChange({ time: Number(event.target.value), playing: false })}
          />
          <span>t = {props.flowMap.time.toFixed(2)}</span>
          <span>area ratio {dropletCache && dropletCache.area0 > 1e-8 ? ratio.toFixed(3) : '—'}</span>
          <span>∇·f = {Number.isFinite(divergence) ? divergence.toFixed(3) : '—'}</span>
          {Number.isFinite(divergence) && <span>e^(t div) {Math.exp(divergence * props.flowMap.time).toFixed(3)}</span>}
        </div>
      )}
    </div>
  );
}

function screenToWorldSafe(view: ViewRect, sx: number, sy: number): [number, number] {
  const x = view.xMin + ((sx - view.left) / view.width) * (view.xMax - view.xMin);
  const y = view.yMax - ((sy - view.top) / view.height) * (view.yMax - view.yMin);
  return [x, y];
}

function equilibriumGlyph(classification: string | undefined, color: string, radius: number) {
  if (classification === 'saddle' || classification?.includes('saddle')) {
    return <polygon points={`0,${-radius} ${radius},0 0,${radius} ${-radius},0`} fill={color} />;
  }
  if (classification === 'linear_center' || classification === 'nonlinear_center') {
    return (
      <>
        <circle r={radius} fill="none" stroke={color} strokeWidth="1.8" />
        <circle r="1.7" fill={color} />
      </>
    );
  }
  return <circle r={radius} fill={color} />;
}

function refreshCaches(
  cache: FieldCache,
  bundle: {
    props: PhaseCanvas2DProps;
    lyapEval: ((x: number, y: number) => number) | null;
    hamEval: ((x: number, y: number) => number) | null;
  },
  view: ViewRect,
  linearView: ViewRect | null,
  now: number,
): void {
  const { props, lyapEval, hamEval } = bundle;
  const field = props.analysis.basinField;
  const basinStamp = props.layers.basins && field ? `${props.analysis.revision}:${field.nx}x${field.ny}:${field.limitIds.length}` : '';
  if (cache.basinStamp !== basinStamp) {
    cache.basinStamp = basinStamp;
    cache.basin = basinStamp && field ? rasterBasins(field) : null;
  }
  const lyapKey = props.layers.lyapunov && lyapEval ? `${viewportKey(props.analysis.viewport)}:${props.analysis.revision}` : '';
  if (lyapKey && lyapEval && cache.lyapKey !== lyapKey && (cache.lyap == null || now - cache.lyapAt > 90)) {
    cache.lyapKey = lyapKey;
    cache.lyapAt = now;
    cache.lyap = rasterScalar(lyapEval, view.xMin, view.xMax, view.yMin, view.yMax);
  }
  if (!lyapKey) cache.lyap = null;
  const hamKey = props.layers.hamiltonianContours && hamEval ? lyapKey || `${viewportKey(props.analysis.viewport)}:${props.analysis.revision}` : '';
  if (hamKey && cache.hamKey !== hamKey && (cache.ham == null || now - cache.hamAt > 120)) {
    cache.hamKey = hamKey;
    cache.hamAt = now;
    cache.ham = hamEval ? hamiltonianContours(hamEval, view) : null;
  }
  if (!hamKey) cache.ham = null;
  const arrowKey = props.layers.vectorField && props.compiled ? `${viewportKey(props.analysis.viewport)}:${props.spec.revision}` : '';
  if (arrowKey && props.compiled && cache.arrowKey !== arrowKey && (cache.arrows == null || now - cache.arrowAt > 70)) {
    const system = props.compiled;
    cache.arrowKey = arrowKey;
    cache.arrowAt = now;
    cache.arrows = sampleArrows((x, y) => {
      try {
        const value = system.f(0, [x, y], system.parameterValues);
        return [value[0] ?? 0, value[1] ?? 0];
      } catch {
        return null;
      }
    }, view, 16, 12);
  }
  if (!arrowKey) cache.arrows = null;
  const equilibrium = props.analysis.equilibria.find((item) => item.id === props.linearization.equilibriumId);
  const linearKey =
    linearView && equilibrium && props.layers.vectorField ? `${equilibrium.id}:${viewportKey(props.analysis.viewport)}` : '';
  if (linearKey && equilibrium && linearView && cache.linearArrowKey !== linearKey) {
    const field = linearField(equilibrium);
    cache.linearArrowKey = linearKey;
    cache.linearArrows = sampleArrows((x, y) => {
      const value = field(0, [x, y], {});
      return [value[0] ?? 0, value[1] ?? 0];
    }, linearView, 14, 11);
  }
  if (!linearKey) cache.linearArrows = null;
}

function hamiltonianContours(evaluate: (x: number, y: number) => number, view: ViewRect): number[][][] {
  const sampled = sampleGrid(evaluate, view.xMin, view.xMax, view.yMin, view.yMax, 28, 28);
  if (!sampled) return [];
  const values: number[] = [];
  for (const row of sampled.grid) {
    for (const value of row) if (Number.isFinite(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  if (values.length < 8) return [];
  const lines: number[][][] = [];
  for (const quantile of [0.18, 0.34, 0.5, 0.66, 0.82]) {
    const level = values[Math.min(values.length - 1, Math.floor(quantile * (values.length - 1)))] ?? 0;
    lines.push(...contourLines(sampled.grid, sampled.xs, sampled.ys, level));
  }
  return lines;
}
