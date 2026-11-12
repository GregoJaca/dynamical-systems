import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PALETTE } from '../../core/palette';
import type { FieldFrame, HeatSolution } from '../types';
import { groupColor } from './colors';
import { finiteExtent, profileSeries } from './exportView';
import { activeFrame, usePdeStore } from '../store';

const MARGIN = { left: 46, right: 14, top: 12, bottom: 28 };

function tick(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return value.toExponential(0);
  return String(Math.round(value * 100) / 100);
}

export function Profile() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const solution = usePdeStore((state) => state.solution);
  const frameId = usePdeStore((state) => state.frame);
  const theme = usePdeStore((state) => state.theme);
  const x0 = usePdeStore((state) => state.x0);
  const t0 = usePdeStore((state) => state.t0);
  const hidden = usePdeStore((state) => state.hidden);
  const selectedId = usePdeStore((state) => state.selectedId);
  const partialN = usePdeStore((state) => state.partialN);
  const setX0 = usePdeStore((state) => state.setX0);
  const frame = activeFrame(solution, frameId);
  const heat = solution?.family === 'heat' ? solution : null;
  const yRange = useMemo(() => (heat && frame ? frozenProfileRange(heat, frame) : { min: -1, max: 1 }), [heat, frame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heat || !frame) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const series = profileSeries(heat, frame, t0, partialN, hidden, selectedId);
      const plotW = rect.width - MARGIN.left - MARGIN.right;
      const plotH = rect.height - MARGIN.top - MARGIN.bottom;
      const spanX = frame.xMax - frame.xMin || 1;
      const spanU = yRange.max - yRange.min || 1;
      const xOf = (x: number) => MARGIN.left + ((x - frame.xMin) / spanX) * plotW;
      const yOf = (u: number) => MARGIN.top + ((yRange.max - u) / spanU) * plotH;
      const palette = PALETTE[theme];
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = theme === 'dark' ? '#101010' : '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = palette.axis;
      ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
      ctx.font = '12px "Source Sans 3", sans-serif';
      ctx.fillStyle = palette.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(tick(frame.xMin), MARGIN.left, rect.height - MARGIN.bottom + 4);
      ctx.fillText(tick(frame.xMax), MARGIN.left + plotW, rect.height - MARGIN.bottom + 4);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(tick(yRange.max), MARGIN.left - 6, MARGIN.top);
      ctx.fillText(tick(yRange.min), MARGIN.left - 6, MARGIN.top + plotH);
      const stroke = (values: number[], color: string, width: number) => {
        ctx.beginPath();
        let open = false;
        values.forEach((value, index) => {
          if (!Number.isFinite(value)) {
            open = false;
            return;
          }
          const px = xOf(series.xs[index]!);
          const py = yOf(value);
          if (!open) {
            ctx.moveTo(px, py);
            open = true;
          } else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      if (series.partial) stroke(series.partial, groupColor('mode', theme), 1.6);
      if (series.selected) stroke(series.selected, groupColor('shock', theme), 2.4);
      stroke(series.u, palette.text, 2);
      const cursor = xOf(x0);
      ctx.strokeStyle = groupColor('ray', theme);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cursor, MARGIN.top);
      ctx.lineTo(cursor, MARGIN.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      const u0 = sampleAt(series.xs, series.u, x0);
      if (Number.isFinite(u0)) {
        ctx.fillStyle = groupColor('ray', theme);
        ctx.beginPath();
        ctx.arc(cursor, yOf(u0), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [heat, frame, theme, x0, t0, hidden, selectedId, partialN, yRange]);

  if (!heat || !frame || heat.spatial !== 'x') return null;

  const read = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const plotW = rect.width - MARGIN.left - MARGIN.right;
    const unit = Math.min(1, Math.max(0, (event.clientX - rect.left - MARGIN.left) / (plotW || 1)));
    setX0(frame.xMin + unit * (frame.xMax - frame.xMin));
  };

  return (
    <div className="stage pde-profile">
      <canvas
        ref={canvasRef}
        className="pde-shot"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          read(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) read(event);
        }}
      />
    </div>
  );
}

function sliceExtent(heat: HeatSolution, frame: FieldFrame, t: number): { min: number; max: number; width: number } {
  const series = profileSeries(heat, frame, t, 0, [], null);
  let min = Infinity;
  let max = -Infinity;
  for (const value of series.u) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const width = Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
  return { min, max, width };
}

function frozenProfileRange(heat: HeatSolution, frame: FieldFrame): { min: number; max: number } {
  const atMin = sliceExtent(heat, frame, frame.tMin);
  const chosen = atMin.width < 1e-6 ? widerExtent(atMin, sliceExtent(heat, frame, frame.tMax)) : atMin;
  return finiteExtent([chosen.min, chosen.max]);
}

function widerExtent(
  first: { min: number; max: number; width: number },
  second: { min: number; max: number; width: number },
): { min: number; max: number; width: number } {
  return second.width > first.width ? second : first;
}

function sampleAt(xs: number[], values: number[], x: number): number {
  let best = Number.NaN;
  let distance = Infinity;
  for (let index = 0; index < xs.length; index += 1) {
    const gap = Math.abs(xs[index]! - x);
    if (gap < distance && Number.isFinite(values[index])) {
      distance = gap;
      best = values[index]!;
    }
  }
  return best;
}
