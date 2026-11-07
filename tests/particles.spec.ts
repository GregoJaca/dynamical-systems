import { describe, expect, it } from 'vitest';
import { stepParticles, type SimParticle } from '../src/render2d/particles';

describe('particle trails', () => {
  it('drops the trail when an open orbit wraps back to its start', () => {
    const particle: SimParticle = {
      curveId: 'separatrix-0',
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      cum: [0, 1, 2],
      total: 2,
      velocities: [],
      s: 1.99,
      color: '#000',
      trail: [[1.99, 0]],
    };
    stepParticles([particle], 0.05, 'uniformSpeed', 4);
    expect(particle.s).toBeGreaterThan(2);
    expect(particle.trail).toHaveLength(1);
    expect(particle.trail[0]?.[0]).toBeLessThan(0.2);
  });
});
