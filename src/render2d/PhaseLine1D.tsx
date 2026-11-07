import { useEffect, useRef } from 'react';
import type { PhaseLine1DProps } from '../core/types';
import { PALETTE, equilibriumColor } from '../core/palette';
import { formatNumber, niceTicks } from './geometry';

export function PhaseLine1D(props: PhaseLine1DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let shift = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      shift += dt;
      const current = propsRef.current;
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (width > 1 && height > 1 && !document.hidden) paintLine(ctx, width, height, current, shift);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const palette = PALETTE[props.theme];
  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      style={{ background: palette.bg, touchAction: 'none' }}
      onPointerDown={(event) => {
        const rect = wrapRef.current?.getBoundingClientRect();
        const canvas = canvasRef.current;
        if (!rect || !canvas) return;
        const viewport = props.analysis.viewport;
        const pad = 28;
        const width = rect.width - pad * 2;
        const x = viewport.xMin + ((event.clientX - rect.left - pad) / width) * (viewport.xMax - viewport.xMin);
        if (Number.isFinite(x)) props.onTracePoint([x]);
      }}
    >
      <canvas ref={canvasRef} data-phase-canvas="phase-line" className="absolute inset-0 h-full w-full" />
    </div>
  );
}

function paintLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: PhaseLine1DProps,
  shift: number,
): void {
  const palette = PALETTE[props.theme];
  const viewport = props.analysis.viewport;
  const pad = 28;
  const axisY = height * 0.68;
  const xOf = (x: number) => pad + ((x - viewport.xMin) / Math.max(1e-9, viewport.xMax - viewport.xMin)) * (width - pad * 2);
  const samples: Array<{ x: number; f: number }> = [];
  const dimension = Math.max(1, props.spec.dimension);
  for (let i = 0; i <= 240; i += 1) {
    const x = viewport.xMin + ((viewport.xMax - viewport.xMin) * i) / 240;
    let value = Number.NaN;
    if (props.compiled) {
      const state = Array.from({ length: dimension }, () => 0);
      state[0] = x;
      try {
        value = props.compiled.f(0, state, props.compiled.parameterValues)[0] ?? Number.NaN;
      } catch {
        value = Number.NaN;
      }
    }
    samples.push({ x, f: value });
  }
  const finite = samples.map((sample) => Math.abs(sample.f)).filter((value) => Number.isFinite(value) && value > 0);
  const maxAbs = finite.length > 0 ? Math.max(...finite) : 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = palette.muted;
  ctx.font = '11px "Source Sans 3", Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  for (const tick of niceTicks(viewport.xMin, viewport.xMax, !!viewport.isPiScaledX)) {
    const sx = xOf(tick.value);
    ctx.beginPath();
    ctx.moveTo(sx, 12);
    ctx.lineTo(sx, height - 12);
    ctx.stroke();
    ctx.fillText(tick.label, sx, height - 8);
  }
  ctx.beginPath();
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1.6;
  ctx.moveTo(pad, axisY);
  ctx.lineTo(width - pad, axisY);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = palette.streamline;
  ctx.lineWidth = 1.5;
  let started = false;
  for (const sample of samples) {
    if (!Number.isFinite(sample.f)) {
      started = false;
      continue;
    }
    const sx = xOf(sample.x);
    const sy = axisY - (sample.f / maxAbs) * (axisY - 22);
    if (!started) {
      ctx.moveTo(sx, sy);
      started = true;
    } else ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  const spacing = 42;
  for (let sx = pad + 16; sx < width - pad; sx += spacing) {
    const x = viewport.xMin + ((sx - pad) / Math.max(1, width - pad * 2)) * (viewport.xMax - viewport.xMin);
    const nearest = samples.reduce((best, sample) => (Math.abs(sample.x - x) < Math.abs(best.x - x) ? sample : best));
    if (!Number.isFinite(nearest.f) || Math.abs(nearest.f) < maxAbs * 0.02) continue;
    const direction = Math.sign(nearest.f);
    const travel = ((shift * 28 * Math.tanh(Math.abs(nearest.f) / maxAbs)) % spacing) * direction;
    const head = Math.min(width - pad - 8, Math.max(pad + 8, sx + travel));
    ctx.fillStyle = direction > 0 ? palette.unstableEq : palette.stableEq;
    ctx.beginPath();
    ctx.moveTo(head + direction * 7, axisY);
    ctx.lineTo(head - direction * 5, axisY - 5);
    ctx.lineTo(head - direction * 5, axisY + 5);
    ctx.closePath();
    ctx.fill();
  }

  for (const equilibrium of props.analysis.equilibria) {
    const x = equilibrium.coords[0];
    if (!Number.isFinite(x)) continue;
    const sx = xOf(x);
    const color = equilibriumColor(equilibrium.stability, equilibrium.classification2D ?? equilibrium.classification3D, props.theme);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = palette.bg;
    ctx.lineWidth = 2;
    if (equilibrium.stability === 'semi_stable') {
      ctx.arc(sx, axisY, 6, Math.PI / 2, -Math.PI / 2, true);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, axisY, 6, -Math.PI / 2, Math.PI / 2, true);
      ctx.stroke();
    } else if (equilibrium.stability === 'unstable') {
      ctx.arc(sx, axisY, 6, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(sx, axisY, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = palette.text;
    ctx.textAlign = 'center';
    ctx.fillText(formatNumber(x), sx, axisY - 14);
  }

  ctx.fillStyle = palette.muted;
  ctx.textAlign = 'left';
  ctx.fillText(props.spec.stateVars[0] ?? 'x', pad, 16);
  ctx.fillText("ẋ = f(x)", width - 90, 16);
}
