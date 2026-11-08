import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledSystem, PolarCanvasProps } from '../core/types';
import { PALETTE, equilibriumColor } from '../core/palette';
import { matchesFocus } from '../core/focus';
import { screenToWorld, worldToScreen, type ViewRect } from './geometry';
import { type Rhs } from './integrate';
import { spawnParticles, stepParticles, type SimParticle } from './particles';
import { lyapunovCurvesAvailable } from '../core/layers';
import { levelContours } from './contours';
import { cartesianToPolar, seedPolarOrbits } from './polarFlow';
import { compilePolarField, compileScalarField } from './scalars';
import { curveAlpha, curveWidth, drawBackground, drawGrid, drawParticles, drawVectorArrows, strokeArrow, strokeWorldPath, type ArrowSample } from './paint';

interface PolarBounds {
  rMin: number;
  rMax: number;
  thMin: number;
  thMax: number;
}

function suggestedRadius(props: PolarCanvasProps): number {
  const radial = (props.analysis.coordinateTransforms.polar2D?.radialEquilibriaR ?? []).filter((value) => value > 1e-3);
  const viewport = props.analysis.viewport;
  const corner = Math.hypot(
    Math.max(Math.abs(viewport.xMin), Math.abs(viewport.xMax)),
    Math.max(Math.abs(viewport.yMin), Math.abs(viewport.yMax)),
  );
  if (radial.length > 0) return Math.max(...radial) * 1.35;
  return Math.max(1.25, Math.min(corner || 3, 6));
}

function polarField(
  compiled: CompiledSystem | null,
  symbolic: ((r: number, theta: number) => [number, number]) | null,
  origin: number[],
): Rhs {
  const ox = origin[0] ?? 0;
  const oy = origin[1] ?? 0;
  return (_t, state, params) => {
    const r = state[0] ?? 0;
    const theta = state[1] ?? 0;
    if (symbolic) {
      const value = symbolic(Math.abs(r), theta);
      if (Number.isFinite(value[0]) && Number.isFinite(value[1])) return value;
    }
    if (!compiled || Math.abs(r) < 1e-5) return [0, 0];
    const x = ox + r * Math.cos(theta);
    const y = oy + r * Math.sin(theta);
    try {
      const velocity = compiled.f(0, [x, y], params);
      const fx = velocity[0] ?? 0;
      const fy = velocity[1] ?? 0;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return [c * fx + s * fy, (c * fy - s * fx) / r];
    } catch {
      return [0, 0];
    }
  };
}

function lineSamples(origin: number[], basis: number[], reach: number): number[][] {
  const norm = Math.hypot(basis[0] ?? 0, basis[1] ?? 0) || 1;
  const ux = (basis[0] ?? 0) / norm;
  const uy = (basis[1] ?? 0) / norm;
  const points: number[][] = [];
  for (let index = -28; index <= 28; index += 1) {
    const s = (index / 28) * reach;
    points.push([(origin[0] ?? 0) + s * ux, (origin[1] ?? 0) + s * uy]);
  }
  return points;
}

function strokePolarPieces(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  points: number[][],
  color: string,
  width: number,
  alpha: number,
  dashed = false,
  arrow = false,
  origin: number[] = [0, 0],
): void {
  for (const piece of cartesianToPolar(points, origin)) {
    strokeWorldPath(ctx, view, piece, color, width, alpha, dashed);
    if (arrow) strokeArrow(ctx, view, piece, color, alpha);
  }
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
    const field = polarField(props.compiled, symbolic, props.analysis.coordinateTransforms.polar2D?.origin ?? [0, 0]);
    const params = props.compiled?.parameterValues ?? {};
    const polarInfo = props.analysis.coordinateTransforms.polar2D;
    const thetaDepends = (polarInfo?.rDotExpr ?? '').includes('theta') || (polarInfo?.thetaDotExpr ?? '').includes('theta');
    const rMax = Math.max(radius, 0.8);
    const pieces = seedPolarOrbits(field, rMax, thetaDepends, polarInfo?.radialEquilibriaR ?? [], params);
    return { pieces, field };
  }, [props.compiled, props.analysis.coordinateTransforms.polar2D, props.analysis.revision, paramKey, radius]);
  const arrows = useMemo(() => {
    const samples: ArrowSample[] = [];
    const rSpan = Math.max(bounds.rMax - bounds.rMin, 0.2);
    const thSpan = Math.max(bounds.thMax - bounds.thMin, 0.2);
    const params = props.compiled?.parameterValues ?? {};
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 11; column += 1) {
        const r = bounds.rMin + ((column + 0.5) * rSpan) / 11;
        const theta = bounds.thMin + ((row + 0.5) * thSpan) / 8;
        const value = curves.field(0, [r, theta], params);
        if (Number.isFinite(value[0]) && Number.isFinite(value[1])) samples.push({ x: r, y: theta, fx: value[0] ?? 0, fy: value[1] ?? 0 });
      }
    }
    return samples;
  }, [curves.field, props.compiled, bounds]);

  const lyapunovLevels = useMemo(() => {
    if (!props.layers.lyapunov || !lyapunovCurvesAvailable(props.analysis)) return [];
    const field = compileScalarField(
      props.analysis.global.lyapunov?.vExpr,
      props.spec.stateVars,
      props.compiled?.parameterValues ?? {},
      props.spec.independentVar,
    );
    if (!field) return [];
    const view = props.analysis.viewport;
    return levelContours(field, view.xMin, view.xMax, view.yMin, view.yMax);
  }, [
    props.layers.lyapunov,
    props.analysis.global.lyapunov?.classification,
    props.analysis.global.lyapunov?.vExpr,
    props.analysis.viewport,
    props.analysis.revision,
    props.spec.stateVars,
    props.spec.independentVar,
    props.compiled,
  ]);

  const particleKey = `${props.analysis.revision}:${props.particles.count}:${curves.pieces.length}`;
  const particleKeyRef = useRef('');
  if (particleKeyRef.current !== particleKey) {
    particleKeyRef.current = particleKey;
    particlesRef.current = spawnParticles(
      curves.pieces.map((points, index) => ({ id: `polar-${index}`, points, limitId: `polar-${index % 8}` })),
      props.particles.count,
    );
  }

  const view = {
    left: 58,
    top: 28,
    width: Math.max(1, size.w - 78),
    height: Math.max(1, size.h - 58),
    xMin: bounds.rMin,
    xMax: bounds.rMax,
    yMin: bounds.thMin,
    yMax: bounds.thMax,
  };

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
        const focusId = current.hoverObjectId;
        const polarOrigin = current.analysis.coordinateTransforms.polar2D?.origin ?? [0, 0];
        const selectedId = current.selectedObjectId;
        if (current.layers.vectorField) drawVectorArrows(ctx, liveView, arrowRef.current, palette.muted);
        if (current.layers.lyapunov) {
          for (const path of lyapunovRef.current) {
            strokePolarPieces(ctx, liveView, path, palette.nullclineX, 1.45, 0.9, true, false, polarOrigin);
          }
        }
        if (current.layers.streamlines) {
          curvesRef.current.forEach((points, index) => {
            const id = `stream-polar-${index}`;
            strokeWorldPath(ctx, liveView, points, palette.streamline, curveWidth(id, focusId, selectedId, 1.35), curveAlpha(id, focusId, 0.92));
            strokeArrow(ctx, liveView, points, palette.streamline, curveAlpha(id, focusId, 0.9));
          });
        }
        if (current.layers.nullclines) {
          for (const nullcline of current.analysis.nullclines) {
            const color = nullcline.component === 0 ? palette.nullclineX : palette.nullclineY;
            for (const branch of nullcline.points) {
              strokePolarPieces(
                ctx,
                liveView,
                branch,
                color,
                curveWidth(nullcline.id, focusId, selectedId, 1.4),
                curveAlpha(nullcline.id, focusId, 0.9),
                true,
                false,
                polarOrigin,
              );
            }
          }
        }
        if (current.layers.separatrices) {
          for (const segment of current.analysis.streamlines) {
            if (segment.category !== 'separatrix') continue;
            strokePolarPieces(
              ctx,
              liveView,
              segment.points,
              palette.separatrix,
              curveWidth(segment.id, focusId, selectedId, 2.1),
              curveAlpha(segment.id, focusId, 0.95),
              false,
              true,
              polarOrigin,
            );
          }
        }
        if (current.layers.manifoldsWuWs || current.layers.centerManifoldWc) {
          for (const manifold of current.analysis.manifolds) {
            const visible = manifold.kind === 'Wc' ? current.layers.centerManifoldWc : current.layers.manifoldsWuWs;
            if (!visible) continue;
            const color = manifold.kind === 'Ws' ? palette.ws : manifold.kind === 'Wu' ? palette.wu : palette.wc;
            strokePolarPieces(
              ctx,
              liveView,
              manifold.points,
              color,
              curveWidth(manifold.id, focusId, selectedId, 2.15),
              curveAlpha(manifold.id, focusId, 0.95),
              false,
              false,
              polarOrigin,
            );
          }
        }
        if (current.layers.linearSubspaces) {
          const reach = Math.hypot(liveView.xMax, Math.PI);
          for (const equilibrium of current.analysis.equilibria) {
            for (const subspace of equilibrium.subspaces) {
              const basis = subspace.basisVectors[0];
              if (!basis) continue;
              const samples = lineSamples(equilibrium.coords, basis, reach);
              const id = `${equilibrium.id}:${subspace.kind}`;
              const color = subspace.kind === 'Es' ? palette.es : subspace.kind === 'Eu' ? palette.eu : palette.ec;
              strokePolarPieces(ctx, liveView, samples, color, curveWidth(id, focusId, selectedId, 1.3), curveAlpha(id, focusId, 0.85), true, false, polarOrigin);
            }
          }
        }
        const polar = current.analysis.coordinateTransforms.polar2D;
        if (current.layers.limitCycles) {
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
          for (const cycle of current.analysis.limitCycles) {
            strokePolarPieces(
              ctx,
              liveView,
              cycle.points,
              palette.cycle,
              curveWidth(cycle.id, focusId, selectedId, 2.2),
              curveAlpha(cycle.id, focusId, 1),
              cycle.stability === 'unstable',
              false,
              polarOrigin,
            );
          }
        }
        for (const orbit of current.userOrbits) {
          strokePolarPieces(ctx, liveView, orbit.points, palette.droplet, curveWidth(orbit.id, focusId, selectedId, 2), curveAlpha(orbit.id, focusId, 0.95), false, true, polarOrigin);
        }
        if (current.layers.equilibria) {
          for (const equilibrium of current.analysis.equilibria) {
            const x = (equilibrium.coords[0] ?? 0) - (polarOrigin[0] ?? 0);
            const y = (equilibrium.coords[1] ?? 0) - (polarOrigin[1] ?? 0);
            const r = Math.hypot(x, y);
            const theta = r < 1e-4 ? 0 : Math.atan2(y, x);
            const [sx, sy] = worldToScreen(liveView, r, theta);
            if (sx < liveView.left - 8 || sx > liveView.left + liveView.width + 8) continue;
            if (sy < liveView.top - 8 || sy > liveView.top + liveView.height + 8) continue;
            const color = equilibriumColor(equilibrium.stability, equilibrium.classification2D ?? equilibrium.classification3D, current.theme);
            const dim = focusId != null && !matchesFocus(equilibrium.id, focusId);
            ctx.save();
            ctx.globalAlpha = dim ? 0.25 : 1;
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.strokeStyle = palette.bg;
            ctx.lineWidth = 2;
            if (equilibrium.stability === 'unstable') {
              ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }
        }
        if (current.particles.playing || particlesRef.current.some((particle) => particle.trail.length > 0)) {
          drawParticles(ctx, liveView, particlesRef.current, focusId);
        }
        ctx.save();
        ctx.font = '12px "Source Sans 3", Segoe UI, sans-serif';
        ctx.fillStyle = palette.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('θ', 8, liveView.top - 8);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('r', liveView.left + liveView.width + 6, liveView.top + liveView.height - 4);
        ctx.fillStyle = palette.cycle;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        let lastLabelX = Number.NEGATIVE_INFINITY;
        const cycleRadii = current.layers.limitCycles ? (polar?.radialEquilibriaR ?? []) : [];
        for (const rEq of cycleRadii.filter((value) => value > 1e-4).slice(0, 4)) {
          const [sx] = worldToScreen(liveView, rEq, liveView.yMax);
          if (sx < liveView.left || sx > liveView.left + liveView.width) continue;
          if (sx - lastLabelX < 48) continue;
          lastLabelX = sx;
          ctx.fillText(`r = ${rEq.toFixed(2)}`, sx, liveView.top - 6);
        }
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
  const arrowRef = useRef(arrows);
  const lyapunovRef = useRef(lyapunovLevels);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  viewRef.current = view;
  curvesRef.current = curves.pieces;
  arrowRef.current = arrows;
  lyapunovRef.current = lyapunovLevels;

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let mode: 'none' | 'pan' | 'pinch' = 'none';
    let moved = false;
    let lastTap = 0;
    let live = boundsRef.current;
    let origin: { x: number; y: number; sx: number; sy: number; bounds: PolarBounds } | null = null;
    let pinch: { dist: number; midSx: number; midSy: number; bounds: PolarBounds; r: number; theta: number } | null = null;

    const metrics = () => {
      const rect = wrap.getBoundingClientRect();
      return { width: Math.max(1, rect.width - 78), height: Math.max(1, rect.height - 58), left: 58, top: 28, rect };
    };

    const locate = (clientX: number, clientY: number, box: PolarBounds) => {
      const { width, height, left, top, rect } = metrics();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const r = box.rMin + ((sx - left) / width) * (box.rMax - box.rMin);
      const theta = box.thMax - ((sy - top) / height) * (box.thMax - box.thMin);
      return { sx, sy, r, theta, width, height };
    };

    const clampBox = (box: PolarBounds): PolarBounds => {
      let { rMin, rMax, thMin, thMax } = box;
      if (!(rMax > rMin + 0.02)) rMax = rMin + 0.02;
      if (!(thMax > thMin + 0.02)) thMax = thMin + 0.02;
      if (rMin < 0) {
        rMax -= rMin;
        rMin = 0;
      }
      return { rMin, rMax, thMin, thMax };
    };

    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length >= 2) {
        const a = event.touches[0];
        const b = event.touches[1];
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        const spot = locate(midX, midY, live);
        pinch = {
          dist: Math.max(8, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
          midSx: spot.sx,
          midSy: spot.sy,
          bounds: live,
          r: spot.r,
          theta: spot.theta,
        };
        origin = null;
        mode = 'pinch';
        moved = true;
        return;
      }
      const touch = event.touches[0];
      const spot = locate(touch.clientX, touch.clientY, live);
      origin = { x: touch.clientX, y: touch.clientY, sx: spot.sx, sy: spot.sy, bounds: live };
      pinch = null;
      mode = 'pan';
      moved = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (mode === 'none') return;
      event.preventDefault();
      if (event.touches.length >= 2 && pinch) {
        const a = event.touches[0];
        const b = event.touches[1];
        const dist = Math.max(8, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
        const factor = Math.min(8, Math.max(0.125, dist / pinch.dist));
        const mid = locate((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, pinch.bounds);
        const zoomed = clampBox({
          rMin: pinch.r + (pinch.bounds.rMin - pinch.r) / factor,
          rMax: pinch.r + (pinch.bounds.rMax - pinch.r) / factor,
          thMin: pinch.theta + (pinch.bounds.thMin - pinch.theta) / factor,
          thMax: pinch.theta + (pinch.bounds.thMax - pinch.theta) / factor,
        });
        const spanR = zoomed.rMax - zoomed.rMin;
        const spanT = zoomed.thMax - zoomed.thMin;
        const { width, height } = metrics();
        const next = clampBox({
          rMin: zoomed.rMin - ((mid.sx - pinch.midSx) * spanR) / width,
          rMax: zoomed.rMax - ((mid.sx - pinch.midSx) * spanR) / width,
          thMin: zoomed.thMin + ((mid.sy - pinch.midSy) * spanT) / height,
          thMax: zoomed.thMax + ((mid.sy - pinch.midSy) * spanT) / height,
        });
        live = next;
        setBounds(next);
        return;
      }
      if (!origin || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (!moved) return;
      const spanR = origin.bounds.rMax - origin.bounds.rMin;
      const spanT = origin.bounds.thMax - origin.bounds.thMin;
      const { width, height } = metrics();
      const next = clampBox({
        rMin: origin.bounds.rMin - (dx * spanR) / width,
        rMax: origin.bounds.rMax - (dx * spanR) / width,
        thMin: origin.bounds.thMin + (dy * spanT) / height,
        thMax: origin.bounds.thMax + (dy * spanT) / height,
      });
      live = next;
      setBounds(next);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        const spot = locate(touch.clientX, touch.clientY, live);
        origin = { x: touch.clientX, y: touch.clientY, sx: spot.sx, sy: spot.sy, bounds: live };
        pinch = null;
        mode = 'pan';
        moved = true;
        return;
      }
      if (event.touches.length > 1) return;
      if (mode === 'pan' && origin && !moved) {
        const now = performance.now();
        if (now - lastTap < 280) {
          lastTap = 0;
          const next = suggestedRadius(propsRef.current);
          setBounds({ rMin: 0, rMax: next, thMin: -Math.PI, thMax: Math.PI });
          live = { rMin: 0, rMax: next, thMin: -Math.PI, thMax: Math.PI };
        } else {
          lastTap = now;
          const changed = event.changedTouches[0];
          if (changed) {
            const spot = locate(changed.clientX, changed.clientY, boundsRef.current);
            propsRef.current.onTracePolar(Math.max(0, spot.r), Math.atan2(Math.sin(spot.theta), Math.cos(spot.theta)));
          }
        }
      }
      mode = 'none';
      origin = null;
      pinch = null;
    };

    wrap.addEventListener('touchstart', onTouchStart, { passive: false });
    wrap.addEventListener('touchmove', onTouchMove, { passive: false });
    wrap.addEventListener('touchend', onTouchEnd);
    wrap.addEventListener('touchcancel', onTouchEnd);
    return () => {
      wrap.removeEventListener('touchstart', onTouchStart);
      wrap.removeEventListener('touchmove', onTouchMove);
      wrap.removeEventListener('touchend', onTouchEnd);
      wrap.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const palette = PALETTE[props.theme];

  const traceAt = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const [r, theta] = screenToWorld(view, clientX - rect.left, clientY - rect.top);
    props.onTracePolar(Math.max(0, r), Math.atan2(Math.sin(theta), Math.cos(theta)));
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: palette.bg, touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch' || event.button !== 0) return;
        pressRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        if (event.pointerType === 'touch') return;
        const press = pressRef.current;
        pressRef.current = null;
        if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) return;
        traceAt(event.clientX, event.clientY);
      }}
      onPointerCancel={() => {
        pressRef.current = null;
      }}
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
    </div>
  );
}
