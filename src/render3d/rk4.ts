import type { CompiledSystem } from '../core/types';

export interface Rk4Series {
  t: number[];
  y: number[][];
  status: 'ok' | 'stopped' | 'unavailable';
  message: string;
}

const MAX_ABS = 1e6;
const MAX_STEPS = 6000;

/**
 * Fixed-step classical RK4 with a few safety subdivisions when a step leaves
 * the finite box. Enough for the higher-dimensional time-series panel; the
 * production integrator stays in the numeric worker.
 */
export function integrateRk4(
  compiled: CompiledSystem | null,
  y0: readonly number[],
  tEnd: number,
  direction: 1 | -1,
): Rk4Series {
  if (!compiled) {
    return { t: [0], y: [y0.slice()], status: 'unavailable', message: 'Waiting for the numeric compiler.' };
  }
  const dim = y0.length;
  if (dim === 0 || compiled.stateVars.length !== dim) {
    return {
      t: [0],
      y: [y0.slice()],
      status: 'unavailable',
      message: 'Initial state does not match the compiled system.',
    };
  }
  const horizon = Math.abs(tEnd);
  if (!(horizon > 0)) {
    return { t: [0], y: [y0.slice()], status: 'ok', message: 'Zero time interval.' };
  }
  const sign = direction < 0 ? -1 : 1;
  const target = sign * horizon;
  let h = (sign * horizon) / Math.min(MAX_STEPS, Math.max(160, Math.round(horizon * 48)));
  const params = compiled.parameterValues;
  const t: number[] = [0];
  const y: number[][] = [y0.slice()];
  let time = 0;
  let state = y0.slice();
  let steps = 0;
  let stopped = false;
  let message = 'Integrated with fixed-step RK4.';

  while (steps < MAX_STEPS) {
    const remaining = target - time;
    if (Math.abs(remaining) < Math.abs(h) * 1e-6) break;
    const step = Math.abs(remaining) < Math.abs(h) ? remaining : h;
    const advanced = acceptStep(compiled.f, time, state, params, step);
    steps += advanced?.attempts ?? 1;
    if (!advanced) {
      stopped = true;
      message = 'Integration stopped: the step left the finite range or f(t, x) failed.';
      break;
    }
    time = advanced.time;
    state = advanced.state;
    t.push(time);
    y.push(state);
    if (Math.abs(target - time) <= Math.abs(step) * 1e-4) break;
  }

  if (!stopped && steps >= MAX_STEPS && Math.abs(target - time) > Math.abs(h)) {
    stopped = true;
    message = 'Integration stopped: step limit reached before the horizon.';
  }

  return { t, y, status: stopped ? 'stopped' : 'ok', message };
}

function acceptStep(
  f: CompiledSystem['f'],
  time: number,
  state: number[],
  params: Record<string, number>,
  step: number,
): { time: number; state: number[]; attempts: number } | null {
  let h = step;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const next = rk4Step(f, time, state, params, h);
    if (next && next.every((v) => Number.isFinite(v) && Math.abs(v) < MAX_ABS)) {
      return { time: time + h, state: next, attempts: attempt };
    }
    h *= 0.5;
  }
  return null;
}

function rk4Step(
  f: CompiledSystem['f'],
  time: number,
  state: readonly number[],
  params: Record<string, number>,
  h: number,
): number[] | null {
  const k1 = evaluate(f, time, state, params);
  if (!k1) return null;
  const k2 = evaluate(f, time + h / 2, axpy(state, k1, h / 2), params);
  if (!k2) return null;
  const k3 = evaluate(f, time + h / 2, axpy(state, k2, h / 2), params);
  if (!k3) return null;
  const k4 = evaluate(f, time + h, axpy(state, k3, h), params);
  if (!k4) return null;
  return state.map((v, i) => v + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)));
}

function evaluate(
  f: CompiledSystem['f'],
  time: number,
  state: readonly number[],
  params: Record<string, number>,
): number[] | null {
  try {
    const out = f(time, state.slice(), params);
    if (!out || out.length < state.length) return null;
    const sample = out.slice(0, state.length);
    if (!sample.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return sample;
  } catch {
    return null;
  }
}

function axpy(y: readonly number[], k: readonly number[], s: number): number[] {
  return y.map((v, i) => v + s * (k[i] ?? 0));
}

export function sampleSeries(series: Rk4Series, time: number): number[] | null {
  const { t, y } = series;
  if (t.length === 0 || y.length === 0) return null;
  const first = t[0] ?? 0;
  const last = t[t.length - 1] ?? first;
  const increasing = last >= first;
  const atStart = increasing ? time <= first : time >= first;
  const atEnd = increasing ? time >= last : time <= last;
  if (atStart) return y[0]?.slice() ?? null;
  if (atEnd) return y[y.length - 1]?.slice() ?? null;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const midTime = t[mid] ?? 0;
    if (increasing ? midTime <= time : midTime >= time) lo = mid;
    else hi = mid;
  }
  const t0 = t[lo] ?? 0;
  const t1 = t[hi] ?? t0;
  const span = t1 - t0 || 1;
  const u = (time - t0) / span;
  const a = y[lo] ?? [];
  const b = y[hi] ?? a;
  return a.map((v, i) => v + u * ((b[i] ?? v) - v));
}

export function downsamplePairs(t: readonly number[], values: readonly number[], maxPoints: number): Array<[number, number]> {
  const n = Math.min(t.length, values.length);
  if (n === 0) return [];
  if (n <= maxPoints) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < n; i += 1) out.push([t[i] ?? 0, values[i] ?? 0]);
    return out;
  }
  const out: Array<[number, number]> = [];
  const step = (n - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    out.push([t[idx] ?? 0, values[idx] ?? 0]);
  }
  return out;
}
