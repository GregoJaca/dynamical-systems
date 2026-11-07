import { describe, expect, it } from 'vitest';
import { exampleToSpec, PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { analyzeNumeric } from '../src/numeric/analyze';

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
  'exam-2': false,
  'exam-3': false,
  'exam-5': false,
  'exam-6': false,
  'exam-7': false,
  'exam-8': false,
  'exam-10': false,
  'exam-11': false,
  'exam-13': true,
  'exam-16': false,
  'exam-17': false,
  'exam-19': false,
  'exam-20': false,
  'exam-21': false,
  'exam-22': false,
  'exam-23': false,
  'exam-24': false,
  'exam-25': true,
};

describe('polar golden flags', () => {
  it('locks polarRecommended on every Perko example', () => {
    const actual = PERKO_EXAMPLES.map((example) => [example.id, example.groundTruth?.polarRecommended] as const).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const expected = Object.entries(polarRecommended).sort(([left], [right]) => left.localeCompare(right));
    expect(actual).toEqual(expected);
  });

  it('recommends the polar chart exactly on that list', () => {
    const mismatches = PERKO_EXAMPLES.filter((example) => example.dimension === 2)
      .map((example) => {
        const recommended = analyzeNumeric(exampleToSpec(example)).coordinateTransforms.polar2D?.isRecommended === true;
        return { id: example.id, recommended, expected: example.groundTruth?.polarRecommended === true };
      })
      .filter((entry) => entry.recommended !== entry.expected);
    expect(mismatches).toEqual([]);
  }, 120_000);
});
