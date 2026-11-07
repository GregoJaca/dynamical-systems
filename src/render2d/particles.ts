import type { ParticleSpeedMode } from '../core/types';
import { basinColor } from '../core/palette';
import { median, pointAtArc, polylineLength, velocityAtArc } from './geometry';

export const COMET_TRAIL = 12;

export interface SimParticle {
  curveId: string;
  points: number[][];
  cum: number[];
  total: number;
  velocities: number[];
  s: number;
  color: string;
  trail: Array<[number, number]>;
}

export interface ParticleCurve {
  id: string;
  points: number[][];
  velocities?: number[];
  limitId?: string;
}

export function spawnParticles(curves: ParticleCurve[], count: number): SimParticle[] {
  const usable = curves
    .map((curve) => {
      const measured = polylineLength(curve.points);
      return { curve, ...measured };
    })
    .filter((entry) => entry.total > 1e-6 && entry.curve.points.length > 1);
  if (usable.length === 0 || count <= 0) return [];
  const totalLength = usable.reduce((sum, entry) => sum + entry.total, 0);
  const budget = Math.min(400, Math.floor(count));
  const particles: SimParticle[] = [];
  let remaining = budget;
  usable.forEach((entry, index) => {
    const share =
      index === usable.length - 1
        ? remaining
        : Math.max(1, Math.round((entry.total / totalLength) * budget));
    const take = Math.min(remaining, share);
    remaining -= take;
    for (let n = 0; n < take; n += 1) {
      const fraction = (n + 0.37) / take;
      particles.push({
        curveId: entry.curve.id,
        points: entry.curve.points,
        cum: entry.cum,
        total: entry.total,
        velocities: entry.curve.velocities ?? [],
        s: fraction * entry.total,
        color: basinColor(entry.curve.limitId || entry.curve.id),
        trail: [pointAtArc(entry.curve.points, entry.cum, fraction * entry.total)],
      });
    }
  });
  return particles;
}

export function stepParticles(
  particles: SimParticle[],
  dt: number,
  mode: ParticleSpeedMode,
  worldSpan: number,
): void {
  const speeds: number[] = [];
  if (mode === 'trueVelocity') {
    for (const particle of particles) {
      if (particle.velocities.length === 0) continue;
      const speed = velocityAtArc(particle.velocities, particle.cum, particle.s);
      if (speed > 0) speeds.push(speed);
    }
  }
  const typical = median(speeds);
  const cruise = Math.max(worldSpan, 1e-3) * 0.22;
  const step = Math.max(0, Math.min(dt, 0.05));
  for (const particle of particles) {
    if (particle.total < 1e-8) continue;
    let speed = cruise;
    if (mode === 'trueVelocity' && particle.velocities.length > 0) {
      const local = velocityAtArc(particle.velocities, particle.cum, particle.s);
      const ratio = typical > 1e-8 ? local / typical : 1;
      speed = cruise * Math.min(3.4, Math.max(0.28, ratio));
    }
    particle.s += speed * step;
    const point = pointAtArc(particle.points, particle.cum, particle.s);
    const previous = particle.trail[particle.trail.length - 1];
    // Open orbits are not loops. Arc length wraps back to the start, which is
    // often an equilibrium, and connecting those two samples paints a ray.
    const limit = Math.max(speed * step * 6, worldSpan * 0.04);
    const jumped = previous != null && Math.hypot(point[0] - previous[0], point[1] - previous[1]) > limit;
    if (jumped) particle.trail = [point];
    else particle.trail.push(point);
    if (particle.trail.length > COMET_TRAIL) particle.trail.shift();
  }
}
