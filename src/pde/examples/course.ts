import type { PdeExample } from '../types';

/** Past midterm and the two homework sheets. Plain lines, not a private markup. */
export const COURSE_EXAMPLES: PdeExample[] = [
  {
    id: 'midterm-classify',
    title: 'Type and canonical form',
    group: '1st midterm',
    source: '1st midterm, 1',
    blurb: 'Move α. The type changes at α = 4. For α = 1 the general solution is a sum of two arbitrary functions of the characteristic coordinates.',
    lines: ['u_xx + alpha u_yy + 4 u_xy = 0', 'alpha = 1'],
    tags: ['classification'],
  },
  {
    id: 'midterm-cauchy',
    title: 'Data on y = −2',
    group: '1st midterm',
    source: '1st midterm, 2',
    blurb: 'The curves leave the line y = −2. The value is constant on each curve, so u is the foot x exp(-(y³ + 8)).',
    lines: ['3 x y^2 u_x + u_y = 0', 'x in R', 'y > -2', 'u(x, -2) = x'],
    tags: ['characteristics'],
    formula: 'x*exp(-(y^3+8))',
  },
  {
    id: 'midterm-robin-neumann',
    title: 'Robin–Neumann uniqueness',
    group: '1st midterm',
    source: '1st midterm, 3',
    blurb: 'For α > 0 the energy decays, so the solution is unique. The picture is the heat flow of u(x,0) = 1; the slowest mode is the one that remains.',
    lines: ['u_t - 3 u_xx = 0', '0 < x < pi', 'u_x(0, t) - alpha u(0, t) = 0', 'u_x(pi, t) = 0', 'u(x, 0) = 1', 'alpha = 1'],
    tags: ['separation', 'robin', 'energy'],
  },
  {
    id: 'midterm-dirichlet-family',
    title: 'Dirichlet family, one sine',
    group: '1st midterm',
    source: '1st midterm, 4a',
    blurb: 'Every sum of sin(nx) exp(-3 n² t) solves the homogeneous problem. This page shows the n = 1 member. The notes list the eigenvalue.',
    lines: ['u_t - 3 u_xx = 0', '0 < x < pi', 'u(0, t) = 0', 'u(pi, t) = 0', 'u(x, 0) = sin(x)'],
    tags: ['separation'],
    formula: 'exp(-3*t)*sin(x)',
  },
  {
    id: 'midterm-two-sines',
    title: 'Two sine modes',
    group: '1st midterm',
    source: '1st midterm, 4b',
    blurb: 'sin(4x) and sin(2x) are already eigenfunctions, so each keeps its coefficient and decays at its own rate.',
    lines: ['u_t - 3 u_xx = 0', '0 < x < pi', 'u(x, 0) = sin(4x) + 5 sin(2x)', 'u(0, t) = 0', 'u(pi, t) = 0'],
    tags: ['separation'],
    formula: 'exp(-48*t)*sin(4*x)+5*exp(-12*t)*sin(2*x)',
  },
  ...homework1(),
  ...homework2(),
];

function homework1(): PdeExample[] {
  const problems: Array<[string, string, string, string?]> = [
    ['hw1-1', '1', 'u_t + (x+t) u_x = exp(-t)', 'u(x, 0) = sin(x)'],
    ['hw1-2', '2', 'u_t + (1+t) u_x = x', 'u(x, 0) = x^2'],
    ['hw1-3', '3', 'u_t + x u_x = u + t', 'u(x, 0) = exp(-x)'],
    ['hw1-4', '4', 'u_t + 2 t u_x = cos(x)', 'u(x, 0) = x^3'],
    ['hw1-5', '5', 'u_t + (x-t) u_x = t^2', 'u(x, 0) = ln(1+x^2)'],
    ['hw1-6', '6', 'u_t + exp(t) u_x = exp(t) x', 'u(x, 0) = 1-x'],
    ['hw1-7', '7', 'u_t + (x+t^2) u_x = x t', 'u(x, 0) = x^2+1'],
    ['hw1-8', '8', 'u_t + (x+1) u_x = exp(t)', 'u(x, 0) = cos(x)'],
    ['hw1-9', '9', '(1+t) u_t + x u_x = u', 'u(x, 0) = 2x'],
    ['hw1-10', '10', '(1+x) u_t + t u_x = t^2 + x', 'u(x, 0) = x'],
  ];
  return problems.map(([id, number, equation, data]) => ({
    id,
    title: `Characteristics ${number}`,
    group: 'homework 1',
    source: `APDEs sheet 1, exercise ${number}`,
    blurb: 'The initial line t = 0 is transverse. The notes give the characteristic ODE, the foot, and the transport of the data.',
    lines: [equation, 'x in R', data ?? 'u(x, 0) = 0'],
    tags: ['characteristics'],
    ...(number === '9' ? { formula: '2*x' } : {}),
  }));
}

function homework2(): PdeExample[] {
  const rows: PdeExample[] = [
    heat('hw2-1', '1', 'u_t - 9 u_xx = 0', '0 < x < 1', 'u(0, t) = 0', 'u(1, t) = 0', 'u(x, 0) = 3 sin(2 pi x) - 2 sin(3 pi x)', '3*exp(-36*pi^2*t)*sin(2*pi*x)-2*exp(-81*pi^2*t)*sin(3*pi*x)'),
    heat('hw2-2', '2', 'u_t - 4 u_xx = 0', '0 < x < 1', 'u(0, t) = 0', 'u(1, t) = 0', 'u(x, 0) = 5 sin(pi x)', '5*exp(-4*pi^2*t)*sin(pi*x)'),
    heat('hw2-3', '3', 'u_t - u_xx = 0', '0 < x < pi', 'u_x(0, t) = 0', 'u_x(pi, t) = 0', 'u(x, 0) = cos(2x) + 3 cos(4x)', 'exp(-4*t)*cos(2*x)+3*exp(-16*t)*cos(4*x)'),
    heat('hw2-4', '4', 'u_t - 16 u_xx = 0', '0 < x < 1', 'u(0, t) = 0', 'u(1, t) = 0', 'u(x, 0) = 2 sin(pi x) + sin(3 pi x)', '2*exp(-16*pi^2*t)*sin(pi*x)+exp(-144*pi^2*t)*sin(3*pi*x)'),
    heat('hw2-5', '5', 'u_t - u_xx = 0', '0 < x < 1', 'u(0, t) = 0', 'u_x(1, t) = 0', 'u(x, 0) = x (1-x)'),
    heat('hw2-6', '6', 'u_t - 9 u_xx = 0', '0 < x < pi', 'u_x(0, t) = 0', 'u_x(pi, t) = 0', 'u(x, 0) = 4 cos(x) - cos(3x)', '4*exp(-9*t)*cos(x)-exp(-81*t)*cos(3*x)'),
    heat('hw2-7', '7', 'u_t - u_xx = exp(-t) sin(pi x)', '0 < x < 1', 'u(0, t) = 0', 'u(1, t) = 0', 'u(x, 0) = 0', '(exp(-t)-exp(-pi^2*t))/(pi^2-1)*sin(pi*x)'),
    heat('hw2-8', '8', 'u_t - u_xx = 5', '0 < x < 1', 'u(0, t) = 0', 'u(1, t) = 0', 'u(x, 0) = 0'),
    heat('hw2-9', '9', 'u_t - 4 u_xx = 0', '0 < x < 1', 'u(0, t) = 0', 'u(1, t) = 2', 'u(x, 0) = 2x', '2*x'),
    heat('hw2-10', '10', 'u_t - u_xx = 0', '0 < x < 1', 'u_x(0, t) = 0', 'u_x(1, t) = 1', 'u(x, 0) = 0'),
  ];
  return rows;
}

function heat(
  id: string,
  number: string,
  equation: string,
  domain: string,
  left: string,
  right: string,
  initial: string,
  formula?: string,
): PdeExample {
  return {
    id,
    title: `Fourier ${number}`,
    group: 'homework 2',
    source: `APDEs sheet 2, exercise ${number}`,
    blurb: 'Separation of variables. The notes list the eigenvalues, the coefficients that are nonzero, and the energy argument for uniqueness.',
    lines: [equation, domain, left, right, initial],
    tags: ['separation', 'energy'],
    ...(formula ? { formula } : {}),
  };
}
