/**
 * Dormand–Prince 5(4) adaptive integrator with cubic Hermite dense output.
 * Steps may run forward or backward. Optional events stop on a buffered viewport,
 * a neighborhood of an equilibrium, a Poincaré return, or finite-time blow-up.
 */

import type { Rk45Options, Rk45Result } from '../core/types';

const A: number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];

const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
const ERROR_COEFF = B5.map((weight, index) => weight - (B4[index] ?? 0));

interface Sample {
  t: number;
  y: number[];
  yp: number[];
}

export function integrateRK45(options: Rk45Options): Rk45Result {
  const t0 = options.t0 ?? 0;
  const t1 = options.t1;
  const y = options.y0.map((value) => value);
  const n = y.length;
  const rtol = options.rtol ?? 1e-6;
  const atol = options.atol ?? 1e-8;
  const maxSteps = options.maxSteps ?? 20_000;
  const direction = t1 >= t0 ? 1 : -1;
  const params = options.params;
  const f = options.f;
  const blowUpRadius = options.blowUpRadius ?? 1e5;
  const equilibriumRadius = options.equilibriumRadius ?? 1e-2;
  const velocityStop = options.velocityStop ?? 1e-6;
  const minPeriod = options.minPeriodTime ?? 0.5;
  const viewport = expandedViewport(options);
  const departDistance = options.departDistance ?? 0;
  const project = options.project;
  let departed = departDistance <= 0;

  let yp = f(t0, y, params);
  if (!isFiniteVector(yp)) {
    return { t: [t0], y: [y.slice()], status: 'blowUp' };
  }

  const samples: Sample[] = [{ t: t0, y: y.slice(), yp: yp.slice() }];
  let t = t0;
  let h = initialStep(direction, t1 - t0, y, yp, atol, rtol);
  let status: Rk45Result['status'] = 'tmax';
  let equilibriumId: string | undefined;
  let period: number | undefined;
  let steps = 0;
  let rejected = 0;

  const normal = options.detectPeriodic ? safeNormalize(yp) : null;
  let previousSection = 0;
  let leftSection = false;

  const k: number[][] = Array.from({ length: 7 }, () => Array(n).fill(0));

  while (steps < maxSteps) {
    if ((direction > 0 && t >= t1 - 1e-14 * (1 + Math.abs(t1))) || (direction < 0 && t <= t1 + 1e-14 * (1 + Math.abs(t1)))) {
      status = 'tmax';
      break;
    }
    if ((direction > 0 && t + h > t1) || (direction < 0 && t + h < t1)) h = t1 - t;
    if (h === 0 || !Number.isFinite(h)) {
      status = 'maxSteps';
      break;
    }

    k[0] = yp;
    let stageFailed = false;
    for (let stage = 1; stage < 7; stage += 1) {
      const yStage = y.slice();
      const row = A[stage] ?? [];
      for (let j = 0; j < stage; j += 1) {
        const weight = row[j] ?? 0;
        if (weight === 0) continue;
        const kj = k[j] ?? [];
        for (let i = 0; i < n; i += 1) yStage[i] = (yStage[i] ?? 0) + h * weight * (kj[i] ?? 0);
      }
      const tk = t + h * (stage === 6 ? 1 : stageCoefficient(stage));
      const fk = f(stage === 6 ? t + h : tk, yStage, params);
      if (!isFiniteVector(fk)) {
        stageFailed = true;
        break;
      }
      k[stage] = fk;
    }
    if (stageFailed) {
      h *= 0.5;
      rejected += 1;
      if (rejected > 40 || Math.abs(h) < 1e-14) {
        status = 'blowUp';
        break;
      }
      continue;
    }

    const y5 = y.slice();
    const errVec = Array(n).fill(0);
    for (let stage = 0; stage < 7; stage += 1) {
      const b = B5[stage] ?? 0;
      const e = ERROR_COEFF[stage] ?? 0;
      const ks = k[stage] ?? [];
      for (let i = 0; i < n; i += 1) {
        y5[i] = (y5[i] ?? 0) + h * b * (ks[i] ?? 0);
        errVec[i] = (errVec[i] ?? 0) + h * e * (ks[i] ?? 0);
      }
    }
    const err = rms(errVec, y, y5, atol, rtol);
    const accept = err <= 1 || Math.abs(h) <= 1e-14 * (1 + Math.abs(t));
    const factor = stepFactor(err);
    if (!accept) {
      h *= Math.min(1, Math.max(0.2, factor));
      rejected += 1;
      if (rejected > 80) {
        status = 'maxSteps';
        break;
      }
      continue;
    }

    const yNew = y5;
    const ypNew = k[6] ?? f(t + h, yNew, params);
    t += h;
    for (let i = 0; i < n; i += 1) y[i] = yNew[i] ?? 0;
    yp = ypNew.slice();
    if (project) {
      project(y);
      const projected = f(t, y, params);
      if (isFiniteVector(projected)) yp = projected;
    }
    if (!departed && distance(y, options.y0) >= departDistance) departed = true;
    samples.push({ t, y: y.slice(), yp: yp.slice() });
    steps += 1;
    rejected = 0;

    const radius = norm(y);
    if (radius > blowUpRadius) {
      status = 'blowUp';
      break;
    }
    if (viewport && outsideViewport(y, viewport)) {
      status = 'viewportExit';
      break;
    }
    if (departed && options.equilibria && options.equilibria.length > 0) {
      const speed = norm(yp);
      if (speed < velocityStop) {
        let nearest: { id: string; dist: number } | null = null;
        for (const eq of options.equilibria) {
          const dist = distance(y, eq.coords);
          if (!nearest || dist < nearest.dist) nearest = { id: eq.id, dist };
        }
        if (nearest && nearest.dist < equilibriumRadius) {
          status = 'equilibriumReached';
          equilibriumId = nearest.id;
          break;
        }
      }
    }
    if (normal && options.detectPeriodic) {
      const section = dotOffset(y, options.y0, normal);
      const travelled = Math.abs(t - t0);
      if (!leftSection && distance(y, options.y0) > 1e-3) leftSection = true;
      if (leftSection && previousSection < 0 && section >= 0 && travelled > minPeriod) {
        const alpha = previousSection / (previousSection - section || 1);
        const crossing = y.map((value, index) => (samples[samples.length - 2]?.y[index] ?? value) * (1 - alpha) + value * alpha);
        if (distance(crossing, options.y0) < 1e-2 * (1 + norm(options.y0))) {
          status = 'periodicOrbitDetected';
          period = travelled;
          break;
        }
      }
      previousSection = section;
    }

    let hNext = h * factor;
    const span = Math.abs(t1 - t);
    if (Math.abs(hNext) > span && span > 0) hNext = direction * span;
    if (!Number.isFinite(hNext) || hNext === 0) hNext = h;
    h = hNext;
  }

  if (steps >= maxSteps && status === 'tmax' && Math.abs(t - t1) > 1e-8 * (1 + Math.abs(t1))) status = 'maxSteps';

  const dense = options.sampleDistance && options.sampleDistance > 0 ? resample(samples, options.sampleDistance) : samples;
  return {
    t: dense.map((sample) => sample.t),
    y: dense.map((sample) => sample.y),
    status,
    equilibriumId,
    period,
  };
}

function stageCoefficient(stage: number): number {
  return [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1][stage] ?? 1;
}

function stepFactor(err: number): number {
  const safe = Math.max(err, 1e-12);
  const raw = 0.9 * safe ** (-0.2);
  return Math.min(5, Math.max(0.2, raw));
}

function initialStep(direction: number, span: number, y: number[], yp: number[], atol: number, rtol: number): number {
  const d0 = rms(y, y.map(() => 0), y, atol, rtol);
  const d1 = rms(yp, yp.map(() => 0), yp, atol, rtol);
  let h0 = 1e-3;
  if (d0 < 1e-5 || d1 < 1e-5) h0 = 1e-4;
  else h0 = Math.min(0.05, 0.01 * (d0 / d1));
  const magnitude = Math.min(Math.abs(span) || h0, Math.max(h0, 1e-6));
  return direction * magnitude;
}

function rms(err: number[], y: number[], yNew: number[], atol: number, rtol: number): number {
  let sum = 0;
  for (let i = 0; i < err.length; i += 1) {
    const scale = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
    const ratio = (err[i] ?? 0) / (scale || 1);
    sum += ratio * ratio;
  }
  return Math.sqrt(sum / Math.max(1, err.length));
}

function resample(samples: Sample[], spacing: number): Sample[] {
  if (samples.length === 0) return [];
  const out: Sample[] = [samples[0]!];
  for (let seg = 0; seg < samples.length - 1; seg += 1) {
    const a = samples[seg]!;
    const b = samples[seg + 1]!;
    const h = b.t - a.t;
    const length = Math.max(distance(a.y, b.y), Math.abs(h) * 0.5 * (norm(a.yp) + norm(b.yp)));
    const pieces = Math.max(1, Math.min(80, Math.ceil(length / Math.max(spacing * 0.25, 1e-6))));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const s = piece / pieces;
      const y = hermite(a.y, a.yp, b.y, b.yp, h, s);
      const last = out[out.length - 1]!;
      if (piece === pieces || distance(last.y, y) >= spacing * 0.98) {
        const t = a.t + s * h;
        const yp = a.yp.map((value, index) => value * (1 - s) + (b.yp[index] ?? 0) * s);
        out.push({ t, y, yp });
      }
    }
  }
  return out;
}

function hermite(y0: number[], f0: number[], y1: number[], f1: number[], h: number, s: number): number[] {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return y0.map((value, index) => h00 * value + h10 * h * (f0[index] ?? 0) + h01 * (y1[index] ?? 0) + h11 * h * (f1[index] ?? 0));
}

function expandedViewport(options: Rk45Options): { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number } | null {
  const box = options.viewport;
  if (!box) return null;
  const margin = options.viewportMargin ?? 0.25;
  const xPad = (box.xMax - box.xMin) * margin;
  const yPad = (box.yMax - box.yMin) * margin;
  const zPad = ((box.zMax ?? 1) - (box.zMin ?? -1)) * margin;
  return {
    xMin: box.xMin - xPad,
    xMax: box.xMax + xPad,
    yMin: box.yMin - yPad,
    yMax: box.yMax + yPad,
    zMin: (box.zMin ?? -Infinity) - (box.zMin === undefined ? 0 : zPad),
    zMax: (box.zMax ?? Infinity) + (box.zMax === undefined ? 0 : zPad),
  };
}

function outsideViewport(y: number[], box: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number }): boolean {
  if ((y[0] ?? 0) < box.xMin || (y[0] ?? 0) > box.xMax) return true;
  if (y.length > 1 && ((y[1] ?? 0) < box.yMin || (y[1] ?? 0) > box.yMax)) return true;
  if (y.length > 2 && ((y[2] ?? 0) < box.zMin || (y[2] ?? 0) > box.zMax)) return true;
  return false;
}

function dotOffset(y: number[], y0: number[], normal: number[]): number {
  let sum = 0;
  for (let i = 0; i < normal.length; i += 1) sum += ((y[i] ?? 0) - (y0[i] ?? 0)) * (normal[i] ?? 0);
  return sum;
}

function safeNormalize(v: number[]): number[] {
  const length = norm(v);
  if (length < 1e-14) return v.map(() => 0);
  return v.map((value) => value / length);
}

function distance(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
}

function isFiniteVector(v: number[]): boolean {
  return v.length > 0 && v.every((value) => Number.isFinite(value));
}
