import type { ViewportBounds } from '../core/types';

/** CSS-pixel rectangle that shows a world window. */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function finitePair(point: number[] | undefined): point is [number, number] {
  return !!point && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

export function makeView(
  bounds: Pick<ViewportBounds, 'xMin' | 'xMax' | 'yMin' | 'yMax'>,
  left: number,
  top: number,
  width: number,
  height: number,
): ViewRect {
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  return {
    left,
    top,
    width: Math.max(1, width),
    height: Math.max(1, height),
    xMin: bounds.xMin,
    xMax: xSpan > 1e-9 ? bounds.xMax : bounds.xMin + 1e-6,
    yMin: bounds.yMin,
    yMax: ySpan > 1e-9 ? bounds.yMax : bounds.yMin + 1e-6,
  };
}

export function worldToScreen(view: ViewRect, x: number, y: number): [number, number] {
  const sx = view.left + ((x - view.xMin) / (view.xMax - view.xMin)) * view.width;
  const sy = view.top + ((view.yMax - y) / (view.yMax - view.yMin)) * view.height;
  return [sx, sy];
}

export function screenToWorld(view: ViewRect, sx: number, sy: number): [number, number] {
  const x = view.xMin + ((sx - view.left) / view.width) * (view.xMax - view.xMin);
  const y = view.yMax - ((sy - view.top) / view.height) * (view.yMax - view.yMin);
  return [x, y];
}

export function zoomViewport(viewport: ViewportBounds, wx: number, wy: number, factor: number): ViewportBounds {
  const clamped = Math.min(8, Math.max(0.125, factor));
  const xMin = wx + (viewport.xMin - wx) / clamped;
  const xMax = wx + (viewport.xMax - wx) / clamped;
  const yMin = wy + (viewport.yMin - wy) / clamped;
  const yMax = wy + (viewport.yMax - wy) / clamped;
  const span = Math.max(xMax - xMin, yMax - yMin);
  if (span < 1e-4 || span > 1e5 || ![xMin, xMax, yMin, yMax].every(Number.isFinite)) return viewport;
  return { ...viewport, xMin, xMax, yMin, yMax };
}

export function panViewport(viewport: ViewportBounds, dxWorld: number, dyWorld: number): ViewportBounds {
  return {
    ...viewport,
    xMin: viewport.xMin + dxWorld,
    xMax: viewport.xMax + dxWorld,
    yMin: viewport.yMin + dyWorld,
    yMax: viewport.yMax + dyWorld,
  };
}

export interface Tick {
  value: number;
  label: string;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(2);
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function formatPi(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) < 1e-9) return '0';
  const halves = Math.round((value / Math.PI) * 2);
  if (Math.abs(value - (halves * Math.PI) / 2) > 1e-3 * Math.max(1, Math.abs(value))) {
    return formatNumber(value);
  }
  if (halves === 0) return '0';
  const sign = halves < 0 ? '−' : '';
  const n = Math.abs(halves);
  const g = gcd(n, 2);
  const num = n / g;
  const den = 2 / g;
  if (num === 1 && den === 1) return `${sign}π`;
  if (den === 1) return `${sign}${num}π`;
  if (num === 1) return `${sign}π/${den}`;
  return `${sign}${num}π/${den}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function niceTicks(min: number, max: number, piScaled: boolean): Tick[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (piScaled) {
    const span = max - min;
    const step = span > 14 * Math.PI ? Math.PI : span > 6 * Math.PI ? Math.PI / 2 : Math.PI / 2;
    const start = Math.ceil(min / step - 1e-8);
    const end = Math.floor(max / step + 1e-8);
    const ticks: Tick[] = [];
    for (let k = start; k <= end && ticks.length < 16; k += 1) {
      const value = k * step;
      ticks.push({ value, label: formatPi(value) });
    }
    return ticks;
  }
  const step = niceStep(max - min);
  const start = Math.ceil(min / step - 1e-8);
  const end = Math.floor(max / step + 1e-8);
  const ticks: Tick[] = [];
  for (let k = start; k <= end && ticks.length < 14; k += 1) {
    const value = k * step;
    ticks.push({ value, label: formatNumber(value) });
  }
  return ticks;
}

export function niceStep(span: number): number {
  const safe = Math.max(span, 1e-9);
  const raw = safe / 6;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const factor = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return factor * pow;
}

export function polylineLength(points: number[][]): { cum: number[]; total: number } {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePair(a) || !finitePair(b)) {
      cum.push(total);
      continue;
    }
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum.push(total);
  }
  return { cum, total };
}

export function pointAtArc(points: number[][], cum: number[], s: number): [number, number] {
  if (points.length === 0) return [0, 0];
  const first = points[0];
  if (!finitePair(first)) return [0, 0];
  if (points.length === 1 || cum.length < 2) return [first[0], first[1]];
  const total = cum[cum.length - 1] ?? 0;
  let target = s;
  if (total > 0) {
    target = ((s % total) + total) % total;
  }
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] ?? 0) <= target) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[Math.min(points.length - 1, lo + 1)];
  if (!finitePair(a)) return [0, 0];
  if (!finitePair(b)) return [a[0], a[1]];
  const ds = (cum[lo + 1] ?? 0) - (cum[lo] ?? 0);
  const t = ds > 1e-12 ? (target - (cum[lo] ?? 0)) / ds : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function velocityAtArc(velocities: number[], cum: number[], s: number): number {
  if (velocities.length === 0 || cum.length === 0) return 0;
  const total = cum[cum.length - 1] ?? 0;
  const target = total > 0 ? ((s % total) + total) % total : 0;
  let lo = 0;
  for (let i = 0; i < cum.length - 1; i += 1) {
    if ((cum[i + 1] ?? 0) >= target) {
      lo = i;
      break;
    }
    lo = i;
  }
  const ds = (cum[lo + 1] ?? 0) - (cum[lo] ?? 0);
  const t = ds > 1e-12 ? (target - (cum[lo] ?? 0)) / ds : 0;
  const v0 = velocities[Math.min(lo, velocities.length - 1)] ?? 0;
  const v1 = velocities[Math.min(lo + 1, velocities.length - 1)] ?? v0;
  return v0 + (v1 - v0) * t;
}

export function closestPolylineDistance(
  view: ViewRect,
  points: number[][],
  sx: number,
  sy: number,
): number {
  let best = Infinity;
  let prev: [number, number] | null = null;
  for (const point of points) {
    if (!finitePair(point)) {
      prev = null;
      continue;
    }
    const current = worldToScreen(view, point[0], point[1]);
    if (prev) best = Math.min(best, distanceToSegment(sx, sy, prev[0], prev[1], current[0], current[1]));
    prev = current;
  }
  return best;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Clip an infinite line through `origin` along `direction` to the world window. */
export function clipInfiniteLine(
  view: Pick<ViewRect, 'xMin' | 'xMax' | 'yMin' | 'yMax'>,
  origin: number[],
  direction: number[],
): [number, number, number, number] | null {
  if (!finitePair(origin) || direction.length < 2) return null;
  const dx = direction[0] ?? 0;
  const dy = direction[1] ?? 0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-12) return null;
  const ts: number[] = [];
  const consider = (t: number) => {
    if (!Number.isFinite(t)) return;
    const x = origin[0] + t * dx;
    const y = origin[1] + t * dy;
    if (x >= view.xMin - 1e-9 && x <= view.xMax + 1e-9 && y >= view.yMin - 1e-9 && y <= view.yMax + 1e-9) {
      ts.push(t);
    }
  };
  if (Math.abs(dx) > 1e-14) {
    consider((view.xMin - origin[0]) / dx);
    consider((view.xMax - origin[0]) / dx);
  }
  if (Math.abs(dy) > 1e-14) {
    consider((view.yMin - origin[1]) / dy);
    consider((view.yMax - origin[1]) / dy);
  }
  if (ts.length < 2) return null;
  ts.sort((a, b) => a - b);
  const t0 = ts[0] ?? 0;
  const t1 = ts[ts.length - 1] ?? 0;
  if (Math.abs(t1 - t0) < 1e-9) return null;
  return [origin[0] + t0 * dx, origin[1] + t0 * dy, origin[0] + t1 * dx, origin[1] + t1 * dy];
}

export function shoelace(points: number[][]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    area += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
  }
  return Math.abs(area) / 2;
}

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return `${hex}${a}`;
  return hex;
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function median(values: number[]): number {
  if (values.length === 0) return 1;
  const copy = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (copy.length === 0) return 1;
  return copy[Math.floor(copy.length / 2)] ?? 1;
}

export function hashUnit(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function tangentAt(points: number[][], fraction: number): { x: number; y: number; angle: number } | null {
  if (points.length < 2) return null;
  const { cum, total } = polylineLength(points);
  if (total < 1e-8) return null;
  const s = Math.max(0, Math.min(0.98, fraction)) * total;
  const [x, y] = pointAtArc(points, cum, s);
  const ahead = pointAtArc(points, cum, Math.min(total, s + total * 0.02));
  const angle = Math.atan2(ahead[1] - y, ahead[0] - x);
  if (!Number.isFinite(angle)) return null;
  return { x, y, angle };
}
