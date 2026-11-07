import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { CompiledSystem, PolarCanvasProps } from '../core/types';
import { PALETTE } from '../core/palette';
import { finitePair, makeView, niceTicks, screenToWorld, worldToScreen, type ViewRect } from './geometry';
import { rk4Step, type Rhs } from './integrate';
import { spawnParticles, stepParticles, type SimParticle } from './particles';
import { compilePolarField } from './scalars';
import { drawBackground, drawGrid, drawParticles, drawVectorArrows, strokeArrow, strokeWorldPath, type ArrowSample } from './paint';

interface PolarBounds {
  rMin: number;
  rMax: number;
  thMin: number;
  thMax: number;
}

function suggestedRadius(props: PolarCanvasProps): number {
  const radial = props.analysis.coordinateTransforms.polar2D?.radialEquilibriaR ?? [];
  const viewport = props.analysis.viewport;
  const corner = Math.hypot(
    Math.max(Math.abs(viewport.xMin), Math.abs(viewport.xMax)),
    Math.max(Math.abs(viewport.yMin), Math.abs(viewport.yMax)),
  );
  const fromCycles = radial.length > 0 ? Math.max(...radial.map((value) => Math.abs(value))) * 1.45 : 0;
  return Math.max(2, Math.min(14, fromCycles || 0, corner || 4), fromCycles || 2);
}

function polarField(compiled: CompiledSystem | null, symbolic: ((r: number, theta: number) => [number, number]) | null): Rhs {
  return (_t, state, params) => {
    const r = state[0] ?? 0;
    const theta = state[1] ?? 0;
    if (symbolic) {
      const value = symbolic(Math.abs(r), theta);
      if (Number.isFinite(value[0]) && Number.isFinite(value[1])) return value;
    }
    if (!compiled || Math.abs(r) < 1e-5) return [0, 0];
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    try {
      const velocity = compiled.f(0, [x, y], params);
      const fx = velocity[0] ?? 0;
      const fy = velocity[1] ?? 0;
      return [(x * fx + y * fy) / r, (x * fy - y * fx) / (r * r)];
    } catch {
      return [0, 0];
    }
  };
}

function integratePolar(field: Rhs, r0: number, theta0: number, direction: 1 | -1, rMax: number, params: Record<string, number>): number[][] {
  let r = r0;
  let theta = theta0;
  const path: number[][] = [[r, theta]];
  const h = 0.045 * direction;
  for (let step = 0; step < 180; step += 1) {
    let next: number[];
    try {
      next = rk4Step(field, 0, [r, theta], h, params);
    } catch {
      break;
    }
    r = next[0] ?? r;
    theta = next[1] ?? theta;
    if (r < 0) {
      r = -r;
      theta += Math.PI;
    }
    if (!Number.isFinite(r) || !Number.isFinite(theta) || r > rMax * 1.25 || r < 1e-4) break;
    path.push([r, theta]);
  }
  return path;
}

function foldPolar(path: number[][]): number[][][] {
  const parts: number[][][] = [];
  let current: number[][] = [];
  let previous: number | null = null;
  for (const point of path) {
    const r = point[0] ?? 0;
    const theta = point[1] ?? 0;
    const folded = Math.atan2(Math.sin(theta), Math.cos(theta));
    if (previous != null && Math.abs(folded - previous) > 2.4) {
      if (current.length > 1) parts.push(current);
      current = [];
    }
    current.push([r, folded]);
    previous = folded;
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

function cartesianToPolar(points: number[][]): number[][][] {
  const unwrapped: number[][] = [];
  let previous = 0;
  let accumulated = 0;
  let started = false;
  for (const point of points) {
    if (!finitePair(point)) continue;
    const r = Math.hypot(point[0], point[1]);
    const theta = Math.atan2(point[1], point[0]);
    if (!started) {
      accumulated = theta;
      started = true;
    } else {
      let delta = theta - previous;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      accumulated += delta;
    }
    previous = theta;
    unwrapped.push([r, accumulated]);
  }
  return foldPolar(unwrapped);
}

export function PolarPhaseCanvas2D(props: PolarCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<SimParticle[]>([]);
  const propsRef = useRef(props);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const paintKick = useRef<() => void>(() => {});
  propsRef.current = props;
  const radius = suggestedRadius(props);
  const [bounds, setBounds] = useState<PolarBounds>({ rMin: 0, rMax: radius, thMin: -Math.PI, thMax: Math.PI });
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    setBounds({ rMin: 0, rMax: radius, thMin: -Math.PI, thMax: Math.PI });
  }, [radius]);

  const paramKey = props.compiled ? JSON.stringify(props.compiled.parameterValues) : '';
  const curves = useMemo(() => {
    const symbolic = compilePolarField(
      props.analysis.coordinateTransforms.polar2D?.rDotExpr,
      props.analysis.coordinateTransforms.polar2D?.thetaDotExpr,
      props.compiled?.parameterValues ?? {},
    );
    const field = polarField(props.compiled, symbolic);
    const params = props.compiled?.parameterValues ?? {};
    const rMax = Math.max(radius, 1);
    const seeds: Array<[number, number]> = [];
    for (const r of [0.2, 0.55, 0.95, 1.45, 2.1, rMax * 0.72]) {
      if (r <= 0 || r >= rMax) continue;
      for (const theta of [-2.2, -0.7, 0.4, 1.7]) seeds.push([r, theta]);
    }
    for (const r of props.analysis.coordinateTransforms.polar2D?.radialEquilibriaR ?? []) {
      if (r > 0.05) seeds.push([r * 0.85, 0.2], [r * 1.12, -1]);
    }
    const pieces: number[][][] = [];
    for (const [r, theta] of seeds) {
      pieces.push(...foldPolar(integratePolar(field, r, theta, 1, rMax, params)));
      pieces.push(...foldPolar(integratePolar(field, r, theta, -1, rMax, params)));
    }
    const arrows: ArrowSample[] = [];
    for (let row = 0; row < 9; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        const r = ((column + 0.5) * rMax) / 10;
        const theta = -Math.PI + ((row + 0.5) * Math.PI * 2) / 9;
        const value = field(0, [r, theta], params);
        if (Number.isFinite(value[0]) && Number.isFinite(value[1])) arrows.push({ x: r, y: theta, fx: value[0] ?? 0, fy: value[1] ?? 0 });
      }
    }
    return { pieces, arrows, field };
  }, [props.compiled, props.analysis.coordinateTransforms.polar2D, props.analysis.revision, paramKey, radius]);

  const particleKey = `${props.analysis.revision}:${props.particles.count}:${curves.pieces.length}`;
  const particleKeyRef = useRef('');
  if (particleKeyRef.current !== particleKey) {
    particleKeyRef.current = particleKey;
    particlesRef.current = spawnParticles(
      curves.pieces.map((points, index) => ({ id: `polar-${index}`, points, limitId: `polar-${index % 8}` })),
      props.particles.count,
    );
  }

  const view = makeView(
    { xMin: bounds.rMin, xMax: bounds.rMax, yMin: bounds.thMin, yMax: bounds.thMax },
    8,
    8,
    Math.max(1, size.w - 16),
    Math.max(1, size.h - 16),
  );

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
      const current = propsRef.current;
      if (w > 1 && h > 1 && !document.hidden) {
        const liveView = viewRef.current;
        if (current.particles.playing) {
          const span = Math.max(liveView.xMax - liveView.xMin, liveView.yMax - liveView.yMin);
          stepParticles(particlesRef.current, dt, current.particles.mode, span);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const palette = PALETTE[current.theme];
        drawBackground(ctx, current.theme, w, h);
        drawGrid(ctx, liveView, current.theme, false, true);
        drawVectorArrows(ctx, liveView, arrowRef.current, palette.muted);
        curvesRef.current.forEach((points, index) => {
          strokeWorldPath(ctx, liveView, points, palette.streamline, 1.25, 0.9);
          if (index % 3 === 0) strokeArrow(ctx, liveView, points, palette.streamline, 0.9);
        });
        const polar = current.analysis.coordinateTransforms.polar2D;
        for (const [index, rEq] of (polar?.radialEquilibriaR ?? []).entries()) {
          const stability = polar?.radialStability[index];
          strokeWorldPath(
            ctx,
            liveView,
            [
              [rEq, liveView.yMin],
              [rEq, liveView.yMax],
            ],
            palette.cycle,
            2,
            0.95,
            stability === 'repelling' || stability === 'semi_stable',
          );
        }
        for (const orbit of current.userOrbits) {
          for (const piece of cartesianToPolar(orbit.points)) {
            strokeWorldPath(ctx, liveView, piece, palette.droplet, 2, 0.95);
          }
        }
        if (current.particles.playing || particlesRef.current.some((particle) => particle.trail.length > 0)) {
          drawParticles(ctx, liveView, particlesRef.current, null);
        }
        ctx.save();
        ctx.fillStyle = palette.text;
        ctx.font = '12px "Source Sans 3", Segoe UI, sans-serif';
        ctx.fillText('r', liveView.left + liveView.width - 12, liveView.top + liveView.height - 6);
        ctx.fillText('θ', liveView.left + 8, liveView.top + 14);
        ctx.restore();
      }
      if (propsRef.current.particles.playing) requestFrame();
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
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    paintKick.current();
  });

  const viewRef = useRef<ViewRect>(view);
  const curvesRef = useRef(curves.pieces);
  const arrowRef = useRef(curves.arrows);
  viewRef.current = view;
  curvesRef.current = curves.pieces;
  arrowRef.current = curves.arrows;

  const palette = PALETTE[props.theme];
  const polar = props.analysis.coordinateTransforms.polar2D;
  const formula = polar
    ? katex.renderToString(`${polar.rDotLatex}\\quad ${polar.thetaDotLatex}`, { throwOnError: false })
    : '';

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap || event.button !== 0) return;
    const rect = wrap.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const [r, theta] = screenToWorld(view, sx, sy);
    props.onTracePolar(Math.max(0, r), Math.atan2(Math.sin(theta), Math.cos(theta)));
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: palette.bg, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setBounds({ rMin: 0, rMax: radius, thMin: -Math.PI, thMax: Math.PI })}
      onWheel={(event) => {
        event.preventDefault();
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect) return;
        const [r, theta] = screenToWorld(view, event.clientX - rect.left, event.clientY - rect.top);
        const factor = Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0016);
        setBounds((current) => {
          const rMin = Math.max(0, r + (current.rMin - r) / factor);
          const rMax = r + (current.rMax - r) / factor;
          const thMin = theta + (current.thMin - theta) / factor;
          const thMax = theta + (current.thMax - theta) / factor;
          if (!(rMax > rMin + 0.05) || !(thMax > thMin + 0.05)) return current;
          return { rMin, rMax, thMin, thMax };
        });
      }}
    >
      <canvas ref={canvasRef} data-phase-canvas="polar" className="absolute inset-0 h-full w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {niceTicks(bounds.thMin, bounds.thMax, true).map((tick) => {
          const [, sy] = worldToScreen(view, bounds.rMin, tick.value);
          return (
            <text key={tick.label + tick.value} x={view.left + 4} y={sy} fill={palette.muted} fontSize="11">
              {tick.label}
            </text>
          );
        })}
        {(polar?.radialEquilibriaR ?? []).map((rEq) => {
          const [sx] = worldToScreen(view, rEq, bounds.thMax);
          return (
            <text key={rEq} x={sx + 4} y={view.top + 16} fill={palette.cycle} fontSize="11">
              r = {rEq.toFixed(2)}
            </text>
          );
        })}
      </svg>
      {formula && (
        <div
          className="pointer-events-none absolute left-3 top-2 max-w-[70%] rounded px-2 py-1 text-xs"
          style={{ background: palette.bg, color: palette.text }}
          dangerouslySetInnerHTML={{ __html: formula }}
        />
      )}
      {polar?.isRecommended && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-full px-2 py-0.5 text-[11px]" style={{ color: palette.cycle, border: `1px solid ${palette.cycle}` }}>
          recommended
        </div>
      )}
    </div>
  );
}
