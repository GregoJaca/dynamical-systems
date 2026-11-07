import { describe, expect, it } from 'vitest';
import { PERKO_EXAMPLES } from '../src/examples/perkoExamples';

// Planar polar chart (r horizontal, θ in [-π, π]), not the numeric recommender.
// True only when a student would switch to polar: circles, spirals, or a limit cycle
// about the origin, ṙ independent of θ, or radial decay (including the linear center,
// where ṙ = 0). Cartesian nodes, saddles, cusps, saddle-nodes, homoclinic figures,
// population models, gradient grids, both pendulums, and every system of dimension
// other than 2 stay false.
const polarRecommended: Record<string, boolean> = {
  'saddle-separatrix': false,
  'jordan-node': false,
  'linear-center': true,
  'weak-focus': true,
  'reversible-center': false,
  'center-manifold-stable': false,
  'center-manifold-saddle-node': false,
  'nilpotent-cusp': false,
  'semi-hyperbolic-saddle-node': false,
  hopf: true,
  'semi-stable-cycle': true,
  'van-der-pol': true,
  'damped-pendulum': false,
  'undamped-pendulum': false,
  duffing: false,
  'lotka-volterra': false,
  'competing-species': false,
  bendixson: true,
  'lyapunov-strict': true,
  'gradient-wells': false,
  'saddle-focus-3d': false,
  'cylindrical-3d': false,
  lorenz: false,
  'coupled-4d': false,
};

describe('polar golden flags', () => {
  it('locks polarRecommended on every Perko example', () => {
    const actual = PERKO_EXAMPLES.map((example) => [example.id, example.groundTruth?.polarRecommended] as const).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const expected = Object.entries(polarRecommended).sort(([left], [right]) => left.localeCompare(right));
    expect(actual).toEqual(expected);
  });
});
