/**
 * Contract for PDE Lab. Math modules under src/pde must not import React or the DOM.
 * Solvers return plain data plus closures the views sample. They do not invent a second problem type.
 */

import type { ParameterSpec } from '../core/types';

export type { ParameterSpec };

export type PdeTag =
  | 'separation'
  | 'robin'
  | 'kernel'
  | 'images'
  | 'convection'
  | 'reaction'
  | 'steady'
  | 'symmetry'
  | 'nondimensional'
  | 'cole-hopf'
  | 'shock'
  | 'rarefaction'
  | 'characteristics'
  | 'eikonal'
  | 'maximum-principle'
  | 'disk'
  | 'rectangle'
  | 'source'
  | 'compatibility'
  | 'boundary-regions'
  | 'classification'
  | 'energy';

export interface EndCondition {
  kind: 'dirichlet' | 'neumann' | 'robin';
  /** Dirichlet: u = value. Neumann: u_x = value. Robin: u_x + h u = value. Expressions may use t. */
  valueExpr: string;
  hExpr?: string;
  /** Endpoint as a mathjs expression, such as `0` or `L`. */
  at: string;
}

export interface HeatProblem {
  family: 'heat';
  /** u_t = k u_xx + b u_x + c u + source. For a disk, u_xx stands for the radial Laplacian. */
  kExpr: string;
  bExpr: string;
  cExpr: string;
  sourceExpr: string;
  spatial: 'x' | 'xy' | 'radial';
  domain:
    | { kind: 'interval'; leftExpr: string; rightExpr: string; left: EndCondition; right: EndCondition; periodic: boolean }
    | { kind: 'line' }
    | { kind: 'half'; bc: EndCondition }
    | { kind: 'rectangle'; x0: string; x1: string; y0: string; y1: string; bc: 'dirichlet' | 'neumann' }
    | { kind: 'disk'; radiusExpr: string; bc: 'dirichlet' | 'neumann' };
  initialExpr: string;
  /** Viscous Burgers, already written so that Cole–Hopf applies: kExpr is ν. */
  burgers: boolean;
  /** Second-order term depends on x, or the equation is nonlinear and not Burgers. */
  numericOnly: boolean;
  parameters: Record<string, ParameterSpec>;
  lines: string[];
  equationLatex: string;
}

export interface CharProblem {
  family: 'characteristics';
  /** Independent variables. `t` is the second variable even when the user wrote y; see `vars`. */
  vars: 'xt' | 'xy';
  /**
   * a u_x + b u_τ + c u = d.
   * τ is t when vars is `xt`, and y when vars is `xy`.
   * Expressions may depend on x, τ (use the symbol `t` in `xt` and `y` in `xy`), and `u`.
   */
  aExpr: string;
  bExpr: string;
  cExpr: string;
  dExpr: string;
  quasilinear: boolean;
  /** Convex flux for u_t + f(u)_x = 0, when the equation is a conservation law. */
  fluxExpr?: string;
  eikonal: boolean;
  data:
    | { kind: 'cauchy'; timeExpr: string; gExpr: string }
    | { kind: 'point'; xExpr: string; yExpr: string; uExpr: string }
    | { kind: 'strip'; gExpr: string; left: EndCondition };
  parameters: Record<string, ParameterSpec>;
  lines: string[];
  equationLatex: string;
}

export interface ClassProblem {
  family: 'classify';
  /** Coefficients of u_xx, u_xy, u_yy in A u_xx + B u_xy + C u_yy = 0. */
  aExpr: string;
  bExpr: string;
  cExpr: string;
  /** True when a first-order or zero-order term is present. */
  lowerOrder: boolean;
  parameters: Record<string, ParameterSpec>;
  lines: string[];
  equationLatex: string;
}

export interface ClassFamilyLine {
  id: string;
  label: string;
  formulaLatex: string;
  /** dy/dx. Null means a vertical line. */
  slope: number | null;
}

export interface ClassSolution {
  family: 'classify';
  exact: boolean;
  formulaLatex: string;
  generalLatex: string;
  canonicalLatex: string;
  type: 'hyperbolic' | 'parabolic' | 'elliptic';
  delta: number;
  deltaLatex: string;
  families: ClassFamilyLine[];
  frames: FieldFrame[];
  objects: PdeObject[];
  notes: NoteBlock[];
  workedLatex: string;
  features: PdeTag[];
  warnings: string[];
  a: number;
  b: number;
  c: number;
}

export type PdeProblem = HeatProblem | CharProblem | ClassProblem;

export interface PdeObject {
  id: string;
  label: string;
  formulaLatex: string;
  group: 'field' | 'mode' | 'boundary' | 'characteristic' | 'shock' | 'steady' | 'kernel' | 'region' | 'ray' | 'envelope';
  defaultOn: boolean;
}

export interface ModeTerm {
  id: string;
  n: number;
  m?: number;
  lambda: number;
  lambdaLatex: string;
  amplitude: number;
  amplitudeLatex: string;
  /** True when the coefficient came from quadrature rather than an exact rule. */
  numericAmplitude: boolean;
  phiLatex: string;
  phi: (x: number, y?: number) => number;
  value: (x: number, t: number, y?: number) => number;
}

export interface NoteBlock {
  id: string;
  title: string;
  /** KaTeX, or prose with `$...$` fragments. No banners. */
  latex: string;
}

export interface FieldFrame {
  id: 'original' | 'simplified';
  name: string;
  formulaLatex: string;
  /** How this frame's unknown maps back to the original u, when it is not u itself. */
  mapLatex?: string;
  xName: string;
  tName: string;
  yName?: string;
  xMin: number;
  xMax: number;
  tMin: number;
  tMax: number;
  yMin?: number;
  yMax?: number;
  unbounded: boolean;
  evaluate: (x: number, t: number, y?: number) => number;
}

export interface Polyline {
  id: string;
  formulaLatex: string;
  /** [x, t] pairs. */
  points: number[][];
}

export interface HeatSolution {
  family: 'heat';
  exact: boolean;
  method: 'separation' | 'kernel' | 'images' | 'bessel' | 'product' | 'cole-hopf' | 'numeric';
  formulaLatex: string;
  frames: FieldFrame[];
  modes: ModeTerm[];
  objects: PdeObject[];
  notes: NoteBlock[];
  /** Derivation built from the coefficients and steps actually computed. */
  workedLatex: string;
  features: PdeTag[];
  warnings: string[];
  spatial: 'x' | 'xy' | 'radial';
  /** False when the data is an unspecified function, so there is a formula and no graph. */
  showGraph?: boolean;
  boundaryCurves: Polyline[];
  steadyLatex?: string;
  steady?: (x: number, y?: number) => number;
  lambda1?: number;
  timeScaleLatex?: string;
  compatibility?: { jump: number; gibbsLatex: string; decayLatex: string };
  longTime?: { rateLatex: string; timeToEpsilon: number; epsilon: number; profileLatex: string };
  kernel?: { mass: number; varianceLatex: string; positive: boolean };
  maximumLatex?: string;
  balanceLatex?: string;
  burgers?: { nu: number; entropy: (x: number, t: number) => number; entropyLatex: string };
  /** Cross-check or the primary field when no closed form exists. values[timeIndex][spaceIndex]. */
  numericGrid?: { xs: number[]; ts: number[]; values: number[][]; label: 'numeric' };
  residual: { pde: number; initial: number; boundary: number };
}

export interface CharCurve {
  id: string;
  invariantLatex: string;
  carriedLatex: string;
  points: Array<{ x: number; t: number; u: number }>;
}

export interface CharSolution {
  family: 'characteristics';
  exact: boolean;
  formulaLatex: string;
  generalLatex: string;
  frames: FieldFrame[];
  curves: CharCurve[];
  /** The data curve Γ in the (x, τ) plane, with the value of u it carries. */
  dataCurve: Array<{ x: number; t: number; u: number }>;
  objects: PdeObject[];
  notes: NoteBlock[];
  workedLatex: string;
  features: PdeTag[];
  warnings: string[];
  vars: 'xt' | 'xy';
  /** The field can be sampled on a grid. Otherwise the picture is the curves only. */
  fastField?: boolean;
  shock?: { points: number[][]; latex: string; speedLatex: string; laxLatex: string };
  envelope?: { points: number[][]; latex: string };
  rarefactionLatex?: string;
  breaking?: { t: number; x: number; latex: string };
  regions?: Array<{ id: string; label: string; formulaLatex: string; polygon: number[][] }>;
  rays?: Array<{ points: number[][]; latex: string }>;
  wavefronts?: Array<{ points: number[][]; latex: string }>;
  equalArea?: { t: number; multivalued: Array<{ x: number; values: number[] }>; shockX: number; areaGap: number };
  viscous?: { nu: number; evaluate: (x: number, t: number) => number; latex: string };
  domainX: [number, number];
  domainT: [number, number];
  residual: { pde: number; data: number };
  transversalityLatex: string;
}

export type PdeSolution = HeatSolution | CharSolution | ClassSolution;

export interface CheckReport {
  ok: boolean;
  pdeResidual: number;
  initialResidual: number;
  boundaryResidual: number;
  differenceFromTool: number;
  diagnoses: string[];
}

export interface PdeExample {
  id: string;
  title: string;
  group: string;
  source: string;
  blurb: string;
  lines: string[];
  /** What a careful reading says this problem is for. Tests compare these with `solution.features`. */
  tags: PdeTag[];
  /** Closed form in the problem's variables and parameters, when one is part of the exercise. */
  formula?: string;
  /** Kept in the source list, hidden from the gallery until it is fast and safe. */
  parked?: boolean;
}

export const DEFAULT_PDE_LINES = [
  'u_t = k u_xx',
  '0 < x < pi',
  'u(0, t) = 0',
  'u(pi, t) = 0',
  'u(x, 0) = sin(x)',
  'k = 1',
];
