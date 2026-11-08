import { Box3, Matrix4, Ray, Vector3 } from 'three';
import { matchesFocus } from '../core/focus';
import type { ViewportBounds } from '../core/types';

/** Axis-aligned phase-space box. Math Z is padded when the system is planar so the cage has volume. */
export interface SceneBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  span: number;
  /** True when the caller supplied a real z interval. Traced points then keep that coordinate. */
  zIsState: boolean;
  key: string;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ordered(a: number, b: number, fallbackSpan: number): [number, number] {
  if (!(b > a)) {
    const mid = Number.isFinite(a) ? a : 0;
    const pad = fallbackSpan * 0.5;
    return [mid - pad, mid + pad];
  }
  return [a, b];
}

export function sceneBounds(viewport: ViewportBounds): SceneBounds {
  const [xMin, xMax] = ordered(finite(viewport.xMin, -2), finite(viewport.xMax, 2), 4);
  const [yMin, yMax] = ordered(finite(viewport.yMin, -2), finite(viewport.yMax, 2), 4);
  const sx = Math.max(xMax - xMin, 1e-3);
  const sy = Math.max(yMax - yMin, 1e-3);
  const zIsState =
    viewport.zMin != null &&
    viewport.zMax != null &&
    Number.isFinite(viewport.zMin) &&
    Number.isFinite(viewport.zMax) &&
    Math.abs(viewport.zMax - viewport.zMin) > 1e-6;
  let zMin = zIsState ? finite(viewport.zMin, 0) : 0;
  let zMax = zIsState ? finite(viewport.zMax, 0) : 0;
  if (!(zMax > zMin)) {
    const pad = 0.08 * Math.max(sx, sy);
    const mid = (zMin + zMax) / 2;
    zMin = mid - pad;
    zMax = mid + pad;
  }
  const sz = Math.max(zMax - zMin, 1e-3);
  const span = Math.max(sx, sy, sz);
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const cz = (zMin + zMax) / 2;
  const key = [xMin, xMax, yMin, yMax, zMin, zMax].map((v) => v.toFixed(5)).join('|');
  return { xMin, xMax, yMin, yMax, zMin, zMax, cx, cy, cz, sx, sy, sz, span, zIsState, key };
}

/**
 * Math (x, y, z) → Three (x, z, y).
 * The mathematical xy-plane is the ground plane and mathematical z points up,
 * so the XY / XZ / YZ camera presets match the phase-space axes.
 */
export function toThree(p: readonly number[]): [number, number, number] {
  return [p[0] ?? 0, p[2] ?? 0, p[1] ?? 0];
}

export function fromThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

export function threeVector(p: readonly number[], out = new Vector3()): Vector3 {
  const [x, y, z] = toThree(p);
  return out.set(x, y, z);
}

export function pad3(v: readonly number[]): [number, number, number] {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
}

export function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export function norm(v: readonly number[]): number {
  return Math.hypot(...v);
}

export function unit(v: readonly number[]): number[] | null {
  const n = norm(v);
  if (!(n > 1e-12)) return null;
  return v.map((c) => c / n);
}

export function scale(v: readonly number[], s: number): number[] {
  return v.map((c) => c * s);
}

export function add(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.max(a.length, b.length, 3);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push((a[i] ?? 0) + (b[i] ?? 0));
  return out;
}

export function sub(a: readonly number[], b: readonly number[]): number[] {
  return add(a, scale(b, -1));
}

export function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  const [ax, ay, az] = pad3(a);
  const [bx, by, bz] = pad3(b);
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

export interface PlaneFrame {
  u: [number, number, number];
  v: [number, number, number];
  n: [number, number, number];
}

/** Orthonormal frame spanning two basis vectors, with n = u × v. */
export function planeFrame(rawU: readonly number[], rawV: readonly number[]): PlaneFrame | null {
  const u0 = unit(pad3(rawU));
  if (!u0) return null;
  const proj = dot(rawV, u0);
  const v0 = unit(sub(pad3(rawV), scale(u0, proj)));
  if (!v0) return null;
  const n0 = unit(cross(u0, v0));
  if (!n0) return null;
  return { u: pad3(u0), v: pad3(v0), n: pad3(n0) };
}

export function basisMatrix(origin: readonly number[], frame: PlaneFrame): Matrix4 {
  const U = threeVector(frame.u);
  const V = threeVector(frame.v);
  const N = threeVector(frame.n);
  const m = new Matrix4().makeBasis(U, V, N);
  m.setPosition(threeVector(origin));
  return m;
}

/** Clip the infinite line origin + t dir to the phase box. dir need not be a unit vector. */
export function clipLine(origin: readonly number[], direction: readonly number[], bounds: SceneBounds): [number[], number[]] | null {
  const o = pad3(origin);
  const d = pad3(direction);
  const min = [bounds.xMin, bounds.yMin, bounds.zMin];
  const max = [bounds.xMax, bounds.yMax, bounds.zMax];
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const di = d[i] ?? 0;
    const oi = o[i] ?? 0;
    if (Math.abs(di) < 1e-12) {
      if (oi < (min[i] ?? 0) - 1e-8 || oi > (max[i] ?? 0) + 1e-8) return null;
      continue;
    }
    let ta = ((min[i] ?? 0) - oi) / di;
    let tb = ((max[i] ?? 0) - oi) / di;
    if (ta > tb) {
      const swap = ta;
      ta = tb;
      tb = swap;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [add(o, scale(d, t0)), add(o, scale(d, t1))];
}

export function box3Of(bounds: SceneBounds): Box3 {
  const min = threeVector([bounds.xMin, bounds.yMin, bounds.zMin]);
  const max = threeVector([bounds.xMax, bounds.yMax, bounds.zMax]);
  return new Box3(min, max);
}

/** Ray against the camera-facing plane through the box center, clamped to the cage. */
export function hitInsideBox(ray: Ray, bounds: SceneBounds): Vector3 | null {
  const center = threeVector([bounds.cx, bounds.cy, bounds.cz]);
  const box = box3Of(bounds);
  const dir = ray.direction;
  const denom = dir.dot(dir);
  if (!(denom > 1e-16)) return null;
  const t = center.clone().sub(ray.origin).dot(dir) / denom;
  if (t > 1e-4) {
    const onPlane = ray.origin.clone().addScaledVector(dir, t);
    if (box.containsPoint(onPlane)) return onPlane;
  }
  const entry = rayBox(ray, box);
  return entry;
}

function rayBox(ray: Ray, box: Box3): Vector3 | null {
  const invX = 1 / (Math.abs(ray.direction.x) < 1e-12 ? 1e-12 : ray.direction.x);
  const invY = 1 / (Math.abs(ray.direction.y) < 1e-12 ? 1e-12 : ray.direction.y);
  const invZ = 1 / (Math.abs(ray.direction.z) < 1e-12 ? 1e-12 : ray.direction.z);
  let tmin = (box.min.x - ray.origin.x) * invX;
  let tmax = (box.max.x - ray.origin.x) * invX;
  if (tmin > tmax) {
    const s = tmin;
    tmin = tmax;
    tmax = s;
  }
  let tymin = (box.min.y - ray.origin.y) * invY;
  let tymax = (box.max.y - ray.origin.y) * invY;
  if (tymin > tymax) {
    const s = tymin;
    tymin = tymax;
    tymax = s;
  }
  if (tmin > tymax || tymin > tmax) return null;
  if (tymin > tmin) tmin = tymin;
  if (tymax < tmax) tmax = tymax;
  let tzmin = (box.min.z - ray.origin.z) * invZ;
  let tzmax = (box.max.z - ray.origin.z) * invZ;
  if (tzmin > tzmax) {
    const s = tzmin;
    tzmin = tzmax;
    tzmax = s;
  }
  if (tmin > tzmax || tzmin > tmax) return null;
  if (tzmin > tmin) tmin = tzmin;
  if (tmin < 0) return null;
  return ray.origin.clone().addScaledVector(ray.direction, tmin);
}

export function sanitizePoints(points: readonly (readonly number[])[]): number[][] {
  const out: number[][] = [];
  for (const p of points) {
    if (!p || p.length === 0) continue;
    if (!p.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const prev = out[out.length - 1];
    if (prev) {
      let d2 = 0;
      const n = Math.max(prev.length, p.length);
      for (let i = 0; i < n; i += 1) {
        const delta = (p[i] ?? 0) - (prev[i] ?? 0);
        d2 += delta * delta;
      }
      if (d2 < 1e-16) continue;
    }
    out.push(p.slice());
  }
  return out;
}

export function decimate(points: number[][], maxPoints: number): number[][] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const diag = spanOf(points);
  let lo = 0;
  let hi = Math.max(diag, 1e-9);
  let best = [points[0] ?? [], points[points.length - 1] ?? []];
  for (let iter = 0; iter < 16; iter += 1) {
    const mid = (lo + hi) / 2;
    const simplified = douglasPeucker(points, mid);
    if (simplified.length > maxPoints) lo = mid;
    else {
      best = simplified;
      hi = mid;
    }
  }
  return best.length > 1 ? best : points.slice(0, maxPoints);
}

function douglasPeucker(points: number[][], epsilon: number): number[][] {
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [start, end] = range;
    let worst = -1;
    let worstDist = 0;
    const a = points[start] ?? [];
    const b = points[end] ?? [];
    for (let index = start + 1; index < end; index += 1) {
      const dist = segmentDistance(points[index] ?? [], a, b);
      if (dist > worstDist) {
        worstDist = dist;
        worst = index;
      }
    }
    if (worst >= 0 && worstDist > epsilon) {
      keep[worst] = true;
      stack.push([start, worst], [worst, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function segmentDistance(point: number[], a: number[], b: number[]): number {
  const ab = a.map((value, index) => (b[index] ?? 0) - value);
  const length = Math.hypot(...ab);
  if (length < 1e-14) return Math.hypot(...point.map((value, index) => value - (a[index] ?? 0)));
  const ap = a.map((value, index) => (point[index] ?? 0) - value);
  const cross = Math.hypot(
    (ap[1] ?? 0) * (ab[2] ?? 0) - (ap[2] ?? 0) * (ab[1] ?? 0),
    (ap[2] ?? 0) * (ab[0] ?? 0) - (ap[0] ?? 0) * (ab[2] ?? 0),
    (ap[0] ?? 0) * (ab[1] ?? 0) - (ap[1] ?? 0) * (ab[0] ?? 0),
  );
  return cross / length;
}

function spanOf(points: number[][]): number {
  const min = points[0]?.slice() ?? [0];
  const max = min.slice();
  for (const point of points) {
    point.forEach((value, index) => {
      min[index] = Math.min(min[index] ?? value, value);
      max[index] = Math.max(max[index] ?? value, value);
    });
  }
  return Math.hypot(...max.map((value, index) => value - (min[index] ?? 0)));
}

/**
 * `indices` may be a triangle strip (as produced for 2D manifolds) or an already
 * expanded triangle list. Strips list each vertex about once; lists repeat them.
 */
export function indicesToTriangles(indices: readonly number[], vertexCount: number): number[] {
  if (indices.length < 3 || vertexCount < 3) return [];
  const asStrip = indices.length % 3 !== 0 || uniqueCount(indices) > indices.length * 0.75;
  const triples = asStrip ? stripToTriangles(indices) : indices;
  const out: number[] = [];
  for (let i = 0; i + 2 < triples.length; i += 3) {
    const a = triples[i] ?? -1;
    const b = triples[i + 1] ?? -1;
    const c = triples[i + 2] ?? -1;
    if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
    if (a === b || b === c || a === c) continue;
    out.push(a, b, c);
  }
  return out;
}

function uniqueCount(indices: readonly number[]): number {
  const seen = new Set<number>();
  for (const id of indices) seen.add(id);
  return seen.size;
}

function stripToTriangles(indices: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 1) {
    const a = indices[i] ?? -1;
    const b = indices[i + 1] ?? -1;
    const c = indices[i + 2] ?? -1;
    if (a === b || b === c || a === c) continue;
    if (i % 2 === 0) out.push(a, b, c);
    else out.push(a, c, b);
  }
  return out;
}

export function mathToFlatThree(vertices: readonly number[]): Float32Array {
  const count = Math.floor(vertices.length / 3);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const x = vertices[i * 3] ?? 0;
    const y = vertices[i * 3 + 1] ?? 0;
    const z = vertices[i * 3 + 2] ?? 0;
    const [tx, ty, tz] = toThree([x, y, z]);
    out[i * 3] = tx;
    out[i * 3 + 1] = ty;
    out[i * 3 + 2] = tz;
  }
  return out;
}

export function emphasisOpacity(id: string, hoverId: string | null, selectedId: string | null, base: number): number {
  if (hoverId) return matchesFocus(id, hoverId) ? Math.min(1, base + 0.06) : base * 0.2;
  if (selectedId && !matchesFocus(id, selectedId)) return base * 0.4;
  return base;
}

export function emphasisWidth(id: string, hoverId: string | null, selectedId: string | null, base: number): number {
  if (matchesFocus(id, hoverId) || id === selectedId) return base + 0.4;
  return base;
}

export function tickValues(min: number, max: number, piScaled: boolean): number[] {
  const count = 5;
  const linear = () => Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
  if (!piScaled || !(max > min)) return linear();
  const step = Math.PI / 2;
  const start = Math.ceil((min + step * 1e-6) / step);
  const end = Math.floor((max - step * 1e-6) / step);
  const span = end - start;
  if (span < 1 || span > 16) return linear();
  const stride = Math.max(1, Math.round(span / 4));
  const out: number[] = [];
  for (let k = start; k <= end; k += stride) out.push(k * step);
  return out.length > 0 ? out : linear();
}

export function formatTick(value: number, piScaled: boolean): string {
  if (!Number.isFinite(value)) return '';
  if (piScaled) {
    const halves = Math.round((value / Math.PI) * 2);
    const snapped = (halves * Math.PI) / 2;
    if (Math.abs(value - snapped) <= Math.max(1e-3, Math.abs(value) * 2e-3)) return formatHalfPi(halves);
  }
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return text === '-0' || text === '-0.0' || text === '-0.00' ? '0' : text;
}

function formatHalfPi(halves: number): string {
  if (halves === 0) return '0';
  const sign = halves < 0 ? '−' : '';
  const n = Math.abs(halves);
  if (n === 2) return `${sign}π`;
  if (n % 2 === 0) return `${sign}${n / 2}π`;
  if (n === 1) return `${sign}π/2`;
  return `${sign}${n}π/2`;
}

export function subspaceObjectId(equilibriumId: string, kind: string): string {
  return `${equilibriumId}:${kind}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [120, 140, 160];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
