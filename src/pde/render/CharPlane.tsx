import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PALETTE } from '../../core/palette';
import { Katex } from '../../ui/Katex';
import type { CharSolution, FieldFrame } from '../types';
import { axisText, emphasis, groupColor, viridis, viridisCss } from './colors';
import { charGraphics, type CurveLayer } from './exportView';
import { activeFrame, usePdeStore } from '../store';

const MARGIN = { left: 46, right: 72, top: 12, bottom: 32 };

interface Tip {
  tex: string;
  left: number;
  top: number;
}

function tick(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return value.toExponential(0);
  return String(Math.round(value * 100) / 100);
}

function colorOf(kind: CurveLayer['kind'], theme: 'light' | 'dark'): string {
  if (kind === 'data') return groupColor('boundary', theme);
  if (kind === 'shock') return groupColor('shock', theme);
  if (kind === 'envelope') return groupColor('envelope', theme);
  if (kind === 'ray') return groupColor('ray', theme);
  return groupColor('characteristic', theme);
}

export function CharPlane() {
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
  const hover = usePdeStore((state) => state.hover);
  const [tip, setTip] = useState<Tip | null>(null);
  const hits = useRef<Array<{ id: string; tex: string; points: Array<[number, number]>; region: boolean }>>([]);
  const char = solution?.family === 'characteristics' ? solution : null;
  const frame = activeFrame(solution, frameId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !char || !frame) return;
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
      hits.current = drawPlane(ctx, rect.width, rect.height, char, frame, theme, x0, t0, hidden, selectedId, hoverId);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [char, frame, theme, x0, t0, hidden, selectedId, hoverId]);

  if (!char || !frame) return null;

  const locate = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const plotW = rect.width - MARGIN.left - MARGIN.right;
    const plotH = rect.height - MARGIN.top - MARGIN.bottom;
    const x = frame.xMin + Math.min(1, Math.max(0, (px - MARGIN.left) / (plotW || 1))) * (frame.xMax - frame.xMin);
    const t = frame.tMax - Math.min(1, Math.max(0, (py - MARGIN.top) / (plotH || 1))) * (frame.tMax - frame.tMin);
    return { px, py, x, t, width: rect.width, height: rect.height };
  };

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        className="pde-shot"
        data-pde-shot="1"
        onPointerDown={(event) => {
          const point = locate(event);
          setCursor(point.x, point.t);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const point = locate(event);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setCursor(point.x, point.t);
          const hit = nearest(hits.current, point.px, point.py);
          hover(hit?.id ?? null);
          if (!hit?.tex) {
            setTip(null);
            return;
          }
          setTip({
            tex: hit.tex,
            left: Math.min(point.width - 180, point.px + 12),
            top: Math.min(point.height - 48, point.py + 12),
          });
        }}
        onPointerLeave={() => {
          hover(null);
          setTip(null);
        }}
      />
      {tip ? (
        <div className="pde-hover" style={{ left: tip.left, top: tip.top }}>
          <Katex tex={tip.tex} />
        </div>
      ) : null}
    </div>
  );
}

function strokeWidth(kind: CurveLayer['kind']): number {
  if (kind === 'data') return 5;
  if (kind === 'curve') return 3.6;
  if (kind === 'shock') return 3.8;
  if (kind === 'envelope') return 2.4;
  return 2.2;
}

function strokeColor(kind: CurveLayer['kind'], theme: 'light' | 'dark', ink: string): string {
  if (kind === 'data') return groupColor('boundary', theme);
  if (kind === 'curve') return ink;
  return colorOf(kind, theme);
}

function drawPlane(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  solution: CharSolution,
  frame: FieldFrame,
  theme: 'light' | 'dark',
  x0: number,
  t0: number,
  hidden: string[],
  selectedId: string | null,
  hoverId: string | null,
) {
  const palette = PALETTE[theme];
  const graphics = charGraphics(solution);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xOf = (x: number) => MARGIN.left + ((x - frame.xMin) / (frame.xMax - frame.xMin || 1)) * plotW;
  const tOf = (t: number) => MARGIN.top + ((frame.tMax - t) / (frame.tMax - frame.tMin || 1)) * plotH;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme === 'dark' ? '#101010' : '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = palette.axis;
  ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH);
  ctx.clip();
  const recorded: Array<{ id: string; tex: string; points: Array<[number, number]>; region: boolean }> = [];
  for (const region of graphics.regions) {
    const mark = emphasis(region.id, selectedId, hoverId, hidden);
    if (!mark.draw || region.polygon.length < 3) continue;
    ctx.beginPath();
    region.polygon.forEach(([x, t], index) => {
      const px = xOf(x);
      const py = tOf(t);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.globalAlpha = (region.rarefaction ? 0.16 : 0.22) * mark.alpha;
    ctx.fillStyle = groupColor('region', theme);
    ctx.fill();
    ctx.globalAlpha = 1;
    recorded.push({ id: region.id, tex: region.latex, points: region.polygon.map(([x, t]) => [xOf(x), tOf(t)]), region: true });
  }
  const familyIds = solution.objects.filter((object) => object.group === 'characteristic').map((object) => object.id);
  const paths = [
    ...graphics.curves.filter((curve) => curve.kind !== 'data'),
    ...graphics.curves.filter((curve) => curve.kind === 'data'),
  ];
  const range = valueRange(
    paths.filter((curve) => curve.kind === 'curve'),
    frame,
  );
  for (const curve of paths) {
    const mark = curveMark(curve.kind === 'curve' ? [curve.id, ...familyIds] : [curve.id], selectedId, hoverId, hidden);
    if (!mark.draw || curve.points.length < 2) continue;
    const pixels = curve.points.map((point) => [xOf(point[0]), tOf(point[1])] as [number, number]);
    const emphasisScale = mark.scale > 1 ? 1.28 : 1;
    ctx.globalAlpha = mark.alpha;
    ctx.lineWidth = strokeWidth(curve.kind) * emphasisScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(curve.kind === 'envelope' ? [7, 5] : []);
    if (curve.kind === 'curve') strokeByValue(ctx, pixels, curve.values, range);
    else {
      ctx.strokeStyle = strokeColor(curve.kind, theme, palette.text);
      ctx.beginPath();
      pixels.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    recorded.push({ id: curve.id, tex: curve.latex, points: pixels, region: false });
  }
  const xPx = xOf(x0);
  const tPx = tOf(t0);
  ctx.strokeStyle = palette.text;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(xPx, MARGIN.top);
  ctx.lineTo(xPx, MARGIN.top + plotH);
  ctx.moveTo(MARGIN.left, tPx);
  ctx.lineTo(MARGIN.left + plotW, tPx);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.fillStyle = palette.muted;
  ctx.font = '12px "Source Sans 3", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(tick(frame.xMin), MARGIN.left, height - MARGIN.bottom + 4);
  ctx.fillText(tick(frame.xMax), width - MARGIN.right, height - MARGIN.bottom + 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(tick(frame.tMax), MARGIN.left - 6, MARGIN.top);
  ctx.fillText(tick(frame.tMin), MARGIN.left - 6, height - MARGIN.bottom);
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.text;
  ctx.fillText(axisText(frame.xName), width - MARGIN.right - 16, height - 4);
  ctx.fillText(axisText(frame.tName), 8, MARGIN.top + 4);
  if (range) paintColorbar(ctx, range.min, range.max, MARGIN.left + plotW + 8, MARGIN.top, 10, plotH, palette.muted);
  return recorded;
}

function curveMark(
  ids: string[],
  selectedId: string | null,
  hoverId: string | null,
  hidden: readonly string[],
): { draw: boolean; alpha: number; scale: number } {
  if (ids.some((id) => hidden.includes(id))) return { draw: false, alpha: 0, scale: 1 };
  const hot = ids.some((id) => id === hoverId);
  const picked = ids.some((id) => id === selectedId);
  if (hoverId && !hot) return { draw: true, alpha: 0.18, scale: picked ? 1.2 : 1 };
  return { draw: true, alpha: 1, scale: picked || hot ? 1.8 : 1 };
}

function valueRange(curves: CurveLayer[], frame: FieldFrame): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const curve of curves) {
    curve.points.forEach((point, index) => {
      const value = curve.values?.[index];
      if (value === undefined || !Number.isFinite(value)) return;
      const [x, t] = point;
      if (x < frame.xMin || x > frame.xMax || t < frame.tMin || t > frame.tMax) return;
      if (value < min) min = value;
      if (value > max) max = value;
    });
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

function colorFor(value: number | undefined, range: { min: number; max: number } | null): string {
  if (!range || value === undefined || !Number.isFinite(value) || range.max - range.min < 1e-8) return viridisCss(0.55);
  return viridisCss(Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min))));
}

function strokeByValue(
  ctx: CanvasRenderingContext2D,
  pixels: Array<[number, number]>,
  values: number[] | undefined,
  range: { min: number; max: number } | null,
) {
  const span = range ? range.max - range.min : 0;
  if (!values || !range || span < 1e-8) {
    const sample = values?.find((value) => Number.isFinite(value));
    ctx.strokeStyle = colorFor(sample, range);
    ctx.beginPath();
    pixels.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
    ctx.stroke();
    return;
  }
  for (let index = 1; index < pixels.length; index += 1) {
    const previous = pixels[index - 1]!;
    const point = pixels[index]!;
    ctx.strokeStyle = colorFor(values[index] ?? values[index - 1], range);
    ctx.beginPath();
    ctx.moveTo(previous[0], previous[1]);
    ctx.lineTo(point[0], point[1]);
    ctx.stroke();
  }
}

function paintColorbar(
  ctx: CanvasRenderingContext2D,
  min: number,
  max: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  const flat = max - min < 1e-8;
  const steps = flat ? 1 : 64;
  ctx.save();
  for (let index = 0; index < steps; index += 1) {
    const shade = flat ? 0.55 : 1 - index / (steps - 1);
    const [red, green, blue] = viridis(shade);
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillRect(x, y + (height * index) / steps, width, height / steps + 0.5);
  }
  ctx.fillStyle = color;
  ctx.font = '12px "Source Sans 3", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('u', x + width + 4, y);
  ctx.fillText(tick(max), x + width + 4, y + 14);
  ctx.textBaseline = 'bottom';
  ctx.fillText(tick(min), x + width + 4, y + height);
  ctx.restore();
}

function nearest(
  hits: Array<{ id: string; tex: string; points: Array<[number, number]>; region: boolean }>,
  px: number,
  py: number,
): { id: string; tex: string } | null {
  let best: { id: string; tex: string } | null = null;
  let bestDistance = 16;
  for (const hit of hits) {
    if (hit.region) continue;
    for (let index = 1; index < hit.points.length; index += 1) {
      const start = hit.points[index - 1]!;
      const end = hit.points[index]!;
      const distance = segmentDistance(px, py, start[0], start[1], end[0], end[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { id: hit.id, tex: hit.tex };
      }
    }
  }
  if (best) return best;
  for (const hit of hits) {
    if (!hit.region || hit.points.length < 3) continue;
    if (inside(px, py, hit.points)) return { id: hit.id, tex: hit.tex };
  }
  return null;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inside(px: number, py: number, polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index]!;
    const before = polygon[previous]!;
    const crosses = current[1] > py !== before[1] > py;
    if (crosses && px < ((before[0] - current[0]) * (py - current[1])) / (before[1] - current[1] || 1) + current[0]) hit = !hit;
  }
  return hit;
}
