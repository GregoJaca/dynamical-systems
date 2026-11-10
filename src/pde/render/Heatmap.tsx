import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PALETTE } from '../../core/palette';
import type { FieldFrame } from '../types';
import { emphasis, viridis } from './colors';
import { midY, sampleFrame } from './exportView';
import { activeFrame, usePdeStore } from '../store';

const MARGIN = { left: 46, right: 14, top: 12, bottom: 32 };

function tick(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return value.toExponential(0);
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function marchSquares(
  xs: number[],
  ys: number[],
  values: number[][],
  level: number,
): Array<[[number, number], [number, number]]> {
  const segments: Array<[[number, number], [number, number]]> = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, v0: number, v1: number): [number, number] => {
    const span = v1 - v0;
    const t = span === 0 ? 0.5 : Math.min(1, Math.max(0, (level - v0) / span));
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  for (let j = 0; j < ys.length - 1; j += 1) {
    for (let i = 0; i < xs.length - 1; i += 1) {
      const corners = [values[j]?.[i], values[j]?.[i + 1], values[j + 1]?.[i + 1], values[j + 1]?.[i]];
      if (corners.some((value) => typeof value !== 'number' || !Number.isFinite(value))) continue;
      const [c0, c1, c2, c3] = corners as [number, number, number, number];
      let bits = 0;
      if (c0 >= level) bits |= 1;
      if (c1 >= level) bits |= 2;
      if (c2 >= level) bits |= 4;
      if (c3 >= level) bits |= 8;
      if (bits === 0 || bits === 15) continue;
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const y0 = ys[j]!;
      const y1 = ys[j + 1]!;
      const bottom = edge(x0, y0, x1, y0, c0, c1);
      const right = edge(x1, y0, x1, y1, c1, c2);
      const top = edge(x0, y1, x1, y1, c3, c2);
      const left = edge(x0, y0, x0, y1, c0, c3);
      const centerHigh = (c0 + c1 + c2 + c3) / 4 >= level;
      const links: Array<[[number, number], [number, number]]> =
        bits === 1
          ? [[left, bottom]]
          : bits === 2
            ? [[bottom, right]]
            : bits === 3
              ? [[left, right]]
              : bits === 4
                ? [[right, top]]
                : bits === 5
                  ? centerHigh
                    ? [
                        [left, top],
                        [bottom, right],
                      ]
                    : [
                        [left, bottom],
                        [right, top],
                      ]
                  : bits === 6
                    ? [[bottom, top]]
                    : bits === 7
                      ? [[left, top]]
                      : bits === 8
                        ? [[top, left]]
                        : bits === 9
                          ? [[bottom, top]]
                          : bits === 10
                            ? centerHigh
                              ? [
                                  [left, bottom],
                                  [right, top],
                                ]
                              : [
                                  [left, top],
                                  [bottom, right],
                                ]
                            : bits === 11
                              ? [[top, right]]
                              : bits === 12
                                ? [[right, left]]
                                : bits === 13
                                  ? [[bottom, right]]
                                  : [[left, bottom]];
      segments.push(...links);
    }
  }
  return segments;
}

function paintAxes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  xName: string,
  yName: string,
  theme: 'light' | 'dark',
) {
  const palette = PALETTE[theme];
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  ctx.strokeStyle = palette.axis;
  ctx.fillStyle = palette.muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
  ctx.font = '12px "Source Sans 3", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let step = 0; step <= 4; step += 1) {
    const value = xMin + ((xMax - xMin) * step) / 4;
    ctx.fillText(tick(value), MARGIN.left + (plotW * step) / 4, height - MARGIN.bottom + 4);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let step = 0; step <= 4; step += 1) {
    const value = yMin + ((yMax - yMin) * step) / 4;
    ctx.fillText(tick(value), MARGIN.left - 6, MARGIN.top + plotH * (1 - step / 4));
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = palette.text;
  ctx.fillText(xName, width - MARGIN.right - 28, height - 4);
  ctx.fillText(yName, 8, MARGIN.top + 12);
}

function equalBox(width: number, height: number, xMin: number, xMax: number, yMin: number, yMax: number) {
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const scale = Math.min(plotW / (xMax - xMin || 1), plotH / (yMax - yMin || 1));
  const boxW = (xMax - xMin || 1) * scale;
  const boxH = (yMax - yMin || 1) * scale;
  return {
    left: MARGIN.left + (plotW - boxW) / 2,
    top: MARGIN.top + (plotH - boxH) / 2,
    width: boxW,
    height: boxH,
  };
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

export function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const solution = usePdeStore((state) => state.solution);
  const frameId = usePdeStore((state) => state.frame);
  const theme = usePdeStore((state) => state.theme);
  const x0 = usePdeStore((state) => state.x0);
  const t0 = usePdeStore((state) => state.t0);
  const hidden = usePdeStore((state) => state.hidden);
  const selectedId = usePdeStore((state) => state.selectedId);
  const hoverId = usePdeStore((state) => state.hoverId);
  const setCursor = usePdeStore((state) => state.setCursor);
  const setX0 = usePdeStore((state) => state.setX0);
  const setT0 = usePdeStore((state) => state.setT0);
  const frame = solution?.family === 'heat' ? activeFrame(solution, frameId) : null;
  const spatial = solution?.family === 'heat' ? solution.spatial : 'x';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame || solution?.family !== 'heat') return;
    const paint = () => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      drawHeat(fitted.ctx, fitted.width, fitted.height, {
        solution,
        frame,
        theme,
        x0,
        t0,
        hidden,
        selectedId,
        hoverId,
      });
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [solution, frame, theme, x0, t0, hidden, selectedId, hoverId]);

  if (!frame || solution?.family !== 'heat') return null;

  const readPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const plotW = rect.width - MARGIN.left - MARGIN.right;
    const plotH = rect.height - MARGIN.top - MARGIN.bottom;
    if (spatial === 'radial') {
      const radius = Math.max(Math.abs(frame.xMax), Math.abs(frame.xMin), 1e-6);
      const box = equalBox(rect.width, rect.height, -radius, radius, -radius, radius);
      const xUnit = Math.min(1, Math.max(0, (px - box.left) / (box.width || 1)));
      const yUnit = Math.min(1, Math.max(0, (py - box.top) / (box.height || 1)));
      const x = -radius + xUnit * 2 * radius;
      const y = radius - yUnit * 2 * radius;
      setX0(Math.min(radius, Math.hypot(x, y)));
      return;
    }
    const xUnit = Math.min(1, Math.max(0, (px - MARGIN.left) / (plotW || 1)));
    const yUnit = Math.min(1, Math.max(0, (py - MARGIN.top) / (plotH || 1)));
    if (spatial === 'x') {
      const x = frame.xMin + xUnit * (frame.xMax - frame.xMin);
      const t = frame.tMax - yUnit * (frame.tMax - frame.tMin);
      setCursor(x, t);
      return;
    }
    setX0(frame.xMin + xUnit * (frame.xMax - frame.xMin || 1));
  };

  const drag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId) || event.buttons === 1) readPointer(event);
  };

  return (
    <>
      <div className="stage">
        <canvas
          ref={canvasRef}
          className="pde-shot"
          data-pde-shot="1"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            readPointer(event);
          }}
          onPointerMove={drag}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
      </div>
      {spatial !== 'x' && (
        <TimeSlider
          min={Math.min(frame.tMin, frame.tMax)}
          max={Math.max(frame.tMin, frame.tMax)}
          value={t0}
          label={frame.tName || 't'}
          onChange={setT0}
        />
      )}
    </>
  );
}

function TimeSlider({ min, max, value, label, onChange }: { min: number; max: number; value: number; label: string; onChange: (value: number) => void }) {
  const span = max - min || 1;
  return (
    <label className="parameter">
      <span>{label}</span>
      <input aria-label="Time" type="range" min={min} max={max} step={span / 400} value={Math.min(max, Math.max(min, value))} onChange={(event) => onChange(Number(event.target.value))} />
      <input aria-label="Time value" value={tick(value)} readOnly />
    </label>
  );
}

function drawHeat(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: {
    solution: Extract<NonNullable<ReturnType<typeof usePdeStore.getState>['solution']>, { family: 'heat' }>;
    frame: FieldFrame;
    theme: 'light' | 'dark';
    x0: number;
    t0: number;
    hidden: string[];
    selectedId: string | null;
    hoverId: string | null;
  },
) {
  const { solution, frame, theme, x0, t0, hidden, selectedId, hoverId } = props;
  const palette = PALETTE[theme];
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme === 'dark' ? '#101010' : '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const fieldId = solution.objects.find((object) => object.group === 'field')?.id ?? '';
  const fieldMark = emphasis(fieldId, selectedId, hoverId, hidden);
  const y = midY(frame);

  if (solution.spatial === 'x') {
    const nx = 180;
    const nt = 96;
    const values = new Float64Array(nx * nt);
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < nt; j += 1) {
      const t = frame.tMin + ((frame.tMax - frame.tMin) * j) / (nt - 1);
      for (let i = 0; i < nx; i += 1) {
        const x = frame.xMin + ((frame.xMax - frame.xMin) * i) / (nx - 1);
        const value = sampleFrame(frame, x, t, y);
        values[j * nx + i] = value;
        if (Number.isFinite(value)) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    paintField(ctx, values, nx, nt, min, max, { left: MARGIN.left, top: MARGIN.top, width: plotW, height: plotH }, fieldMark.draw ? fieldMark.alpha : 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH);
    ctx.clip();
    const xOf = (x: number) => MARGIN.left + ((x - frame.xMin) / (frame.xMax - frame.xMin || 1)) * plotW;
    const tOf = (t: number) => MARGIN.top + ((frame.tMax - t) / (frame.tMax - frame.tMin || 1)) * plotH;
    for (const curve of solution.boundaryCurves) {
      const id = solution.objects.some((object) => object.id === curve.id)
        ? curve.id
        : (solution.objects.find((object) => object.group === 'boundary')?.id ?? curve.id);
      const mark = emphasis(id, selectedId, hoverId, hidden);
      if (!mark.draw || curve.points.length < 2) continue;
      ctx.beginPath();
      curve.points.forEach((point, index) => {
        const x = point[0];
        const t = point[1];
        if (typeof x !== 'number' || typeof t !== 'number') return;
        const px = xOf(x);
        const py = tOf(t);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = theme === 'dark' ? '#f3f1ec' : '#1c1917';
      ctx.globalAlpha = mark.alpha;
      ctx.lineWidth = 3.2 * mark.scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xOf(x0), MARGIN.top);
    ctx.lineTo(xOf(x0), MARGIN.top + plotH);
    ctx.moveTo(MARGIN.left, tOf(t0));
    ctx.lineTo(MARGIN.left + plotW, tOf(t0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    paintAxes(ctx, width, height, frame.xMin, frame.xMax, frame.tMin, frame.tMax, frame.xName, frame.tName, theme);
    return;
  }

  const radius = Math.max(Math.abs(frame.xMax), Math.abs(frame.xMin), 1e-6);
  const xMin = solution.spatial === 'radial' ? -radius : frame.xMin;
  const xMax = solution.spatial === 'radial' ? radius : frame.xMax;
  const yMin = solution.spatial === 'radial' ? -radius : (frame.yMin ?? frame.xMin);
  const yMax = solution.spatial === 'radial' ? radius : (frame.yMax ?? frame.xMax);
  const nx = 96;
  const ny = solution.spatial === 'radial' ? 96 : 72;
  const box =
    solution.spatial === 'radial'
      ? equalBox(width, height, xMin, xMax, yMin, yMax)
      : { left: MARGIN.left, top: MARGIN.top, width: plotW, height: plotH };
  const grid: number[][] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < nx; i += 1) xs.push(xMin + ((xMax - xMin) * i) / (nx - 1));
  for (let j = 0; j < ny; j += 1) ys.push(yMin + ((yMax - yMin) * j) / (ny - 1));
  const flat = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const row: number[] = [];
    for (let i = 0; i < nx; i += 1) {
      const x = xs[i]!;
      const yValue = ys[j]!;
      let value = Number.NaN;
      if (solution.spatial === 'radial') {
        const r = Math.hypot(x, yValue);
        if (r <= radius) value = sampleFrame(frame, r, t0);
      } else {
        value = sampleFrame(frame, x, t0, yValue);
      }
      row.push(value);
      flat[j * nx + i] = value;
      if (Number.isFinite(value)) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    grid.push(row);
  }
  paintField(ctx, flat, nx, ny, min, max, box, fieldMark.draw ? fieldMark.alpha : 0);
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    ctx.clip();
    const xOf = (x: number) => box.left + ((x - xMin) / (xMax - xMin || 1)) * box.width;
    const yOf = (yValue: number) => box.top + ((yMax - yValue) / (yMax - yMin || 1)) * box.height;
    ctx.strokeStyle = theme === 'dark' ? 'rgba(243,241,236,0.85)' : 'rgba(28,25,23,0.75)';
    ctx.lineWidth = 1.1;
    for (let level = 1; level <= 6; level += 1) {
      const heightLevel = min + ((max - min) * level) / 7;
      for (const [start, end] of marchSquares(xs, ys, grid, heightLevel)) {
        ctx.beginPath();
        ctx.moveTo(xOf(start[0]), yOf(start[1]));
        ctx.lineTo(xOf(end[0]), yOf(end[1]));
        ctx.stroke();
      }
    }
    ctx.strokeStyle = palette.text;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    if (solution.spatial === 'radial') {
      ctx.beginPath();
      ctx.arc(xOf(0), yOf(0), Math.abs(xOf(Math.min(radius, Math.max(0, x0))) - xOf(0)), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const px = xOf(x0);
      ctx.beginPath();
      ctx.moveTo(px, box.top);
      ctx.lineTo(px, box.top + box.height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
  paintAxes(
    ctx,
    width,
    height,
    xMin,
    xMax,
    yMin,
    yMax,
    solution.spatial === 'radial' ? 'x' : frame.xName,
    solution.spatial === 'radial' ? 'y' : (frame.yName ?? 'y'),
    theme,
  );
}

function paintField(
  ctx: CanvasRenderingContext2D,
  values: Float64Array,
  nx: number,
  ny: number,
  min: number,
  max: number,
  box: { left: number; top: number; width: number; height: number },
  alpha: number,
) {
  if (alpha <= 0 || !Number.isFinite(min) || !Number.isFinite(max)) return;
  const off = document.createElement('canvas');
  off.width = nx;
  off.height = ny;
  const imageCtx = off.getContext('2d');
  if (!imageCtx) return;
  const image = imageCtx.createImageData(nx, ny);
  const span = max - min || 1;
  for (let row = 0; row < ny; row += 1) {
    const source = ny - 1 - row;
    for (let col = 0; col < nx; col += 1) {
      const value = values[source * nx + col] ?? Number.NaN;
      const pixel = (row * nx + col) * 4;
      if (!Number.isFinite(value)) continue;
      const [red, green, blue] = viridis((value - min) / span);
      image.data[pixel] = red;
      image.data[pixel + 1] = green;
      image.data[pixel + 2] = blue;
      image.data[pixel + 3] = 255;
    }
  }
  imageCtx.putImageData(image, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, box.left, box.top, box.width, box.height);
  ctx.restore();
}
