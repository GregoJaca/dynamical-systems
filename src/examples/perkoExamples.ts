import { parseSystem } from '../input/parser';
import type { ExampleGroundTruth, ParameterSpec, PerkoExample, SystemSpec } from '../core/types';

const LINEAR = 'Linear phase portraits';
const NONHYPERBOLIC = 'Nonhyperbolic points and manifolds';
const CYCLES = 'Limit cycles';
const OSCILLATORS = 'Oscillators and pendulums';
const GLOBAL = 'Global structure';
const HIGHER = 'Higher dimension';

function parameter(
  name: string,
  latex: string,
  value: number,
  min: number,
  max: number,
  step: number,
): ParameterSpec {
  return { name, latex, value, min, max, step };
}

function gridEquilibria(): number[][] {
  const axes = [-1, 0, 1];
  const points: number[][] = [];
  for (const x of axes) {
    for (const y of axes) points.push([x, y]);
  }
  return points;
}

const lorenzWing = Math.sqrt(72);

export const PERKO_EXAMPLES: PerkoExample[] = [
  {
    id: 'saddle-separatrix',
    title: 'Hyperbolic saddle and curved separatrices',
    citation: 'Perko §2.7',
    group: LINEAR,
    blurb: 'The unstable manifold of the origin is the parabola y = x²/3, and the stable manifold is the y-axis.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x', '-y + x^2'],
    parameters: {},
    groundTruth: {
      equilibria: [[0, 0]],
      originClassification2D: 'saddle',
      manifoldCheck: {
        kind: 'Wu',
        residualExpr: 'y - (x^2)/3',
        maxResidual: 1e-4,
        domain: 1,
      },
    },
  },
  {
    id: 'jordan-node',
    title: 'Improper node with a Jordan block',
    citation: 'Perko §1.5',
    group: LINEAR,
    blurb: 'A repeated negative eigenvalue with a single eigenvector: trajectories approach along a degenerate node.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['-x + y', '-y'],
    parameters: {},
    groundTruth: {
      equilibria: [[0, 0]],
      originClassification2D: 'stable_degenerate_node',
    },
  },
  {
    id: 'linear-center',
    title: 'Linear center',
    citation: 'Perko §1.4',
    group: LINEAR,
    blurb: 'Rotation by the matrix exponential e^{At} = cos(t) I + sin(t) J, and a conserved Hamiltonian.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['-y', 'x'],
    parameters: {},
    groundTruth: {
      equilibria: [[0, 0]],
      originClassification2D: 'linear_center',
      hamiltonian: true,
    },
  },
  {
    id: 'weak-focus',
    title: 'Weak focus',
    citation: 'Perko §2.8',
    group: NONHYPERBOLIC,
    blurb: 'The linearization is a center, but the cubic terms make a weakly attracting focus. Polar form: ṙ = −r³, θ̇ = 1.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['-y - x * (x^2 + y^2)', 'x - y * (x^2 + y^2)'],
    parameters: {},
    groundTruth: {
      equilibria: [[0, 0]],
      originClassification2D: 'weak_stable_focus',
      polarRecommended: true,
    },
  },
  {
    id: 'reversible-center',
    title: 'Time-reversible nonlinear center',
    citation: 'Perko §2.10',
    group: NONHYPERBOLIC,
    blurb: 'A Hamiltonian center at the origin and a homoclinic loop to the saddle at (1, 0).',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['y', '-x + x^2'],
    parameters: {},
    groundTruth: {
      equilibria: [
        [0, 0],
        [1, 0],
      ],
      originClassification2D: 'nonlinear_center',
      hamiltonian: true,
    },
  },
  {
    id: 'center-manifold-stable',
    title: 'Asymptotically stable center manifold',
    citation: 'Perko §2.12',
    group: NONHYPERBOLIC,
    blurb: 'Reduction on Wᶜ gives y = −x² + O(x⁴) and ẋ = −x³, so the origin is asymptotically stable.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x * y', '-y - x^2'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0]] },
  },
  {
    id: 'center-manifold-saddle-node',
    title: 'Center manifold saddle-node',
    citation: 'Perko §2.12',
    group: NONHYPERBOLIC,
    blurb: 'The center manifold carries the saddle-node equation ẋ = x², while y decays exponentially.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x^2', '-y'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0]] },
  },
  {
    id: 'nilpotent-cusp',
    title: 'Nilpotent cusp',
    citation: 'Perko §2.11',
    group: NONHYPERBOLIC,
    blurb: 'A nilpotent equilibrium of cusp type. Its Poincaré index is 0.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['y', 'x^2'],
    parameters: {},
    groundTruth: {
      equilibria: [[0, 0]],
      originClassification2D: 'cusp',
    },
  },
  {
    id: 'semi-hyperbolic-saddle-node',
    title: 'Semi-hyperbolic saddle-node',
    citation: 'Perko §2.11',
    group: NONHYPERBOLIC,
    blurb: 'One zero eigenvalue and one positive eigenvalue, with two separatrices at the origin.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x^2 - y', 'y'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0]] },
  },
  {
    id: 'hopf',
    title: 'Supercritical Hopf cycle',
    citation: 'Polar Hopf normal form',
    group: CYCLES,
    blurb: 'For μ = 1 the unit circle is an asymptotically stable limit cycle and the origin is an unstable focus.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['mu * x - y - x * (x^2 + y^2)', 'x + mu * y - y * (x^2 + y^2)'],
    parameters: {
      mu: parameter('mu', '\\mu', 1, -1, 2, 0.01),
    },
    groundTruth: {
      equilibria: [[0, 0]],
      polarRecommended: true,
    },
  },
  {
    id: 'semi-stable-cycle',
    title: 'Semi-stable limit cycle',
    citation: 'Polar normal form',
    group: CYCLES,
    blurb: 'The unit circle attracts from outside and repels toward the origin, so the cycle is semi-stable.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['-y + x * (x^2 + y^2 - 1)^2', 'x + y * (x^2 + y^2 - 1)^2'],
    parameters: {},
    groundTruth: {
      equilibria: [[0, 0]],
      polarRecommended: true,
    },
  },
  {
    id: 'van-der-pol',
    title: 'Van der Pol oscillator',
    citation: 'Relaxation oscillation',
    group: CYCLES,
    blurb: 'A unique stable limit cycle. At μ = 1.5 the orbit is already visibly relaxed.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['y', 'mu * (1 - x^2) * y - x'],
    parameters: {
      mu: parameter('mu', '\\mu', 1.5, 0, 4, 0.01),
    },
    groundTruth: { equilibria: [[0, 0]] },
  },
  {
    id: 'damped-pendulum',
    title: 'Damped pendulum',
    citation: 'Heteroclinic separatrices',
    group: OSCILLATORS,
    blurb: 'Second-order pendulum with γ = 0.25. Saddles at odd multiples of π are joined by heteroclinic separatrices.',
    mode: 'second_order_scalar',
    dimension: 2,
    stateVars: ['theta', 'omega'],
    rows: ["theta'' + gamma*theta' + sin(theta) = 0"],
    parameters: {
      gamma: parameter('gamma', '\\gamma', 0.25, 0, 2, 0.01),
    },
  },
  {
    id: 'undamped-pendulum',
    title: 'Undamped pendulum',
    citation: 'Periodic family and homoclinic eye',
    group: OSCILLATORS,
    blurb: 'Energy ω²/2 − cos θ is conserved. Centers and saddles alternate along θ = kπ.',
    mode: 'second_order_scalar',
    dimension: 2,
    stateVars: ['theta', 'omega'],
    rows: ["theta'' + sin(theta) = 0"],
    parameters: {},
    groundTruth: {
      equilibria: [
        [-Math.PI, 0],
        [0, 0],
        [Math.PI, 0],
      ],
      hamiltonian: true,
    },
  },
  {
    id: 'duffing',
    title: 'Duffing twin wells',
    citation: 'Double homoclinic figure-eight',
    group: OSCILLATORS,
    blurb: 'With δ = 0 the figure-eight is Hamiltonian. Raise δ toward 0.15 to add damping.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['y', 'x - x^3 - delta * y'],
    parameters: {
      delta: parameter('delta', '\\delta', 0, 0, 1, 0.01),
    },
    groundTruth: {
      equilibria: [
        [-1, 0],
        [0, 0],
        [1, 0],
      ],
      hamiltonian: true,
    },
  },
  {
    id: 'lotka-volterra',
    title: 'Lotka–Volterra predator–prey',
    citation: 'Conservative ecological cycle',
    group: GLOBAL,
    blurb: 'All four rates equal 1, so the positive equilibrium sits at (1, 1) and the axes equilibria at the origin.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x * (alpha - beta * y)', 'y * (delta * x - gamma)'],
    parameters: {
      alpha: parameter('alpha', '\\alpha', 1, 0.1, 4, 0.05),
      beta: parameter('beta', '\\beta', 1, 0.1, 4, 0.05),
      delta: parameter('delta', '\\delta', 1, 0.1, 4, 0.05),
      gamma: parameter('gamma', '\\gamma', 1, 0.1, 4, 0.05),
    },
    groundTruth: {
      equilibria: [
        [0, 0],
        [1, 1],
      ],
    },
  },
  {
    id: 'competing-species',
    title: 'Competing species',
    citation: 'Basin boundary separatrix',
    group: GLOBAL,
    blurb: 'Four equilibria. The saddle at (1, 1) separates the basins of the axial attractors.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x * (3 - x - 2 * y)', 'y * (2 - x - y)'],
    parameters: {},
    groundTruth: {
      equilibria: [
        [0, 0],
        [3, 0],
        [0, 2],
        [1, 1],
      ],
    },
  },
  {
    id: 'bendixson',
    title: 'Bendixson–Dulac benchmark',
    citation: 'Perko §3.9',
    group: GLOBAL,
    blurb: 'A Dulac multiplier rules out periodic orbits in the plane.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['y', '-x - (1 + x^2 + x^4) * y'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0]] },
  },
  {
    id: 'lyapunov-strict',
    title: 'Strict Lyapunov function',
    citation: 'Perko §2.9',
    group: GLOBAL,
    blurb: 'V = (x² + y²)/2 is a strict Lyapunov function: V̇ = −(x⁴ + y⁴) < 0 off the origin.',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['-y - x^3', 'x - y^3'],
    parameters: {},
    userLyapunovExpr: '(x^2 + y^2) / 2',
    groundTruth: { equilibria: [[0, 0]] },
  },
  {
    id: 'gradient-wells',
    title: 'Four-well gradient system',
    citation: 'Gradient dynamics',
    group: GLOBAL,
    blurb: 'The flow is a gradient. Nine equilibria sit on the grid {−1, 0, 1}².',
    mode: 'autonomous',
    dimension: 2,
    stateVars: ['x', 'y'],
    rows: ['x * (1 - x^2)', 'y * (1 - y^2)'],
    parameters: {},
    groundTruth: { equilibria: gridEquilibria() },
  },
  {
    id: 'saddle-focus-3d',
    title: 'Linear saddle-focus',
    citation: '3D linear classification',
    group: HIGHER,
    blurb: 'A 1D unstable axis and a stable focus in the xy-plane: a saddle-focus of index 1.',
    mode: 'autonomous',
    dimension: 3,
    stateVars: ['x', 'y', 'z'],
    rows: ['-0.5 * x - 2 * y', '2 * x - 0.5 * y', 'z'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0, 0]] },
  },
  {
    id: 'cylindrical-3d',
    title: 'Axisymmetric cylindrical flow',
    citation: 'Cylindrical reduction',
    group: HIGHER,
    blurb: 'Radial and axial equations ignore θ, so cylindrical coordinates are the natural chart. z decays.',
    mode: 'autonomous',
    dimension: 3,
    stateVars: ['x', 'y', 'z'],
    rows: ['x * (1 - x^2 - y^2) - y', 'y * (1 - x^2 - y^2) + x', '-z'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0, 0]] },
  },
  {
    id: 'lorenz',
    title: 'Lorenz attractor',
    citation: 'Lorenz 1963',
    group: HIGHER,
    blurb: 'Classic parameters σ = 10, ρ = 28, β = 8/3. Three equilibria: the origin and a conjugate pair of wings.',
    mode: 'autonomous',
    dimension: 3,
    stateVars: ['x', 'y', 'z'],
    rows: ['sigma * (y - x)', 'x * (rho - z) - y', 'x * y - beta * z'],
    parameters: {
      sigma: parameter('sigma', '\\sigma', 10, 0, 30, 0.1),
      rho: parameter('rho', '\\rho', 28, 0, 50, 0.1),
      beta: parameter('beta', '\\beta', 8 / 3, 0.1, 8, 0.01),
    },
    groundTruth: {
      equilibria: [
        [0, 0, 0],
        [lorenzWing, lorenzWing, 27],
        [-lorenzWing, -lorenzWing, 27],
      ],
    },
  },
  {
    id: 'coupled-4d',
    title: 'Coupled 4D oscillator',
    citation: 'Higher-dimensional benchmark',
    group: HIGHER,
    blurb: 'Two oscillators, one damped and one conservative, coupled by small linear terms. The origin is an equilibrium.',
    mode: 'autonomous',
    dimension: 4,
    stateVars: ['x1', 'x2', 'x3', 'x4'],
    rows: ['x2', '-x1 - 0.2 * x2 + 0.1 * x3', 'x4', '-2 * x3 + 0.1 * x1'],
    parameters: {},
    groundTruth: { equilibria: [[0, 0, 0, 0]] },
  },
];

export function exampleToSpec(example: PerkoExample, revision = 1): SystemSpec {
  return parseSystem({
    id: example.id,
    revision,
    mode: example.mode,
    dimension: example.dimension,
    stateVars: [...example.stateVars],
    rows: [...example.rows],
    independentVar: 't',
    parameterOverrides: example.parameters,
    userLyapunovExpr: example.userLyapunovExpr,
  });
}

export function exampleById(id: string | null | undefined): PerkoExample | undefined {
  if (!id) return undefined;
  return PERKO_EXAMPLES.find((example) => example.id === id);
}

export type { ExampleGroundTruth };
