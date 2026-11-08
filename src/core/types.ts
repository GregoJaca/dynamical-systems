/**
 * Immutable contract between the parser, numeric engine, CAS worker, renderers, and UI.
 * Modules may not invent parallel copies of these structures.
 * Math modules (src/input, src/numeric, src/cas, src/theorems) must not import React or the DOM.
 */

export type SystemMode = 'autonomous' | 'non_autonomous' | 'second_order_scalar' | 'polar_input';

export type ThemeMode = 'dark' | 'light';

export type InspectorTab = 'objects' | 'equilibria' | 'coordinates' | 'theorems';

export type ParticleSpeedMode = 'trueVelocity' | 'uniformSpeed';

export type CompareMode = 'off' | 'overlay' | 'split';

export interface ParameterSpec {
  name: string;
  latex: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface SystemSpec {
  id: string;
  revision: number;
  mode: SystemMode;
  dimension: number;
  stateVars: string[];
  independentVar: string;
  rawEquations: string[];
  rhsExpressions: string[];
  latexEquations: string[];
  parameters: Record<string, ParameterSpec>;
  isAutonomous: boolean;
  isLinear: boolean;
  userLyapunovExpr?: string;
}

export interface ParseSystemInput {
  mode: SystemMode;
  dimension: number;
  stateVars?: string[];
  rows: string[];
  independentVar?: string;
  parameterOverrides?: Record<string, Partial<ParameterSpec>>;
  userLyapunovExpr?: string;
  id?: string;
  revision?: number;
}

export interface CompiledSystem {
  f: (t: number, x: number[], p: Record<string, number>) => number[];
  J: (t: number, x: number[], p: Record<string, number>) => number[][];
  parameterValues: Record<string, number>;
  stateVars: string[];
}

export interface ExactOrNumeric {
  value: number;
  exactLatex?: string;
}

export interface ComplexEigenvalue {
  re: number;
  im: number;
  exactLatex?: string;
  multiplicity: number;
}

export type EquilibriumType2D =
  | 'stable_proper_node'
  | 'unstable_proper_node'
  | 'stable_improper_node'
  | 'unstable_improper_node'
  | 'stable_degenerate_node'
  | 'unstable_degenerate_node'
  | 'saddle'
  | 'stable_focus'
  | 'unstable_focus'
  | 'linear_center'
  | 'nonlinear_center'
  | 'weak_stable_focus'
  | 'weak_unstable_focus'
  | 'saddle_node'
  | 'cusp'
  | 'non_isolated_line'
  | 'unknown_non_hyperbolic';

export type EquilibriumType3D =
  | 'stable_node_3d'
  | 'unstable_node_3d'
  | 'saddle_index_1'
  | 'saddle_index_2'
  | 'stable_focus_node'
  | 'unstable_focus_node'
  | 'saddle_focus_1_2'
  | 'saddle_focus_2_1'
  | 'center_manifold_3d'
  | 'higher_dim_equilibrium';

export type StabilityVerdict =
  | 'asymptotically_stable'
  | 'lyapunov_stable'
  | 'unstable'
  | 'semi_stable'
  | 'undetermined';

export interface SubspaceInfo {
  kind: 'Es' | 'Eu' | 'Ec';
  dimension: number;
  basisVectors: number[][];
  basisExactLatex: string[];
  cartesianFormulaLatex: string;
}

export interface ManifoldBranch {
  id: string;
  equilibriumId: string;
  kind: 'Ws' | 'Wu' | 'Wc';
  sign: 1 | -1;
  points: number[][];
  arclength: number;
  taylorSeriesLatex?: string;
  reducedDynamicsLatex?: string;
  connectionToEquilibriumId?: string;
  connectionType?: 'homoclinic' | 'heteroclinic';
}

export interface EquilibriumAnalysis {
  id: string;
  coords: number[];
  coordsExactLatex?: string[];
  familyFormulaLatex?: string;
  sourceMethod: 'exact_sympy' | 'numeric_newton';
  jacobianNumeric: number[][];
  jacobianExactLatex?: string;
  trace: ExactOrNumeric;
  determinant: ExactOrNumeric;
  discriminant2D?: ExactOrNumeric;
  eigenvalues: ComplexEigenvalue[];
  eigenvectors: number[][];
  isHyperbolic: boolean;
  poincareIndex2D?: number;
  classification2D?: EquilibriumType2D;
  classification3D?: EquilibriumType3D;
  stability: StabilityVerdict;
  stabilityReasonLatex: string;
  subspaces: SubspaceInfo[];
  hartmanGrobmanApplies: boolean;
  hartmanGrobmanRadius?: number;
}

export interface StreamlineSegment {
  id: string;
  points: number[][];
  velocities: number[];
  forwardLimitId: string;
  backwardLimitId: string;
  category: 'background_streamline' | 'separatrix' | 'characteristic_orbit' | 'limit_cycle' | 'user_traced';
  reasonTag?: string;
  formulaOrDescriptionLatex?: string;
}

export interface Nullcline {
  id: string;
  component: number;
  variableLatex: string;
  points: number[][][];
  formulaLatex: string;
}

export interface LimitCycle {
  id: string;
  points: number[][];
  period?: number;
  radius?: number;
  stability: 'stable' | 'unstable' | 'semi_stable' | 'unknown';
  formulaLatex?: string;
}

export interface ManifoldSurface3D {
  id: string;
  equilibriumId: string;
  kind: 'Ws' | 'Wu' | 'Wc';
  trajectories: number[][][];
  vertices: number[];
  indices: number[];
  formulaLatex?: string;
  reducedDynamicsLatex?: string;
}

export interface BasinField {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  nx: number;
  ny: number;
  /** Row-major ω-limit ids, length nx * ny. */
  limitIds: string[];
}

export interface PolarAnalysis {
  isRecommended: boolean;
  recommendationReason?: string;
  /** Translation used before polar coordinates. Absent when the chart is centered at the origin. */
  origin?: number[];
  originLatex?: string;
  rDotLatex: string;
  thetaDotLatex: string;
  rDotExpr: string;
  thetaDotExpr: string;
  radialEquilibriaR: number[];
  radialStability: Array<'attracting' | 'repelling' | 'semi_stable' | 'unknown'>;
}

export interface CylindricalAnalysis {
  isRecommended: boolean;
  recommendationReason?: string;
  rDotLatex: string;
  thetaDotLatex: string;
  zDotLatex: string;
  rDotExpr: string;
  thetaDotExpr: string;
  zDotExpr: string;
}

export interface SphericalAnalysis {
  isRecommended: boolean;
  recommendationReason?: string;
  rhoDotLatex: string;
  thetaDotLatex: string;
  phiDotLatex: string;
  rhoDotExpr: string;
  thetaDotExpr: string;
  phiDotExpr: string;
}

export interface CoordinateTransformAnalysis {
  polar2D?: PolarAnalysis;
  cylindrical3D?: CylindricalAnalysis;
  spherical3D?: SphericalAnalysis;
}

export interface SymmetryInfo {
  type:
    | 'x_reflection'
    | 'y_reflection'
    | 'origin_inversion'
    | 'time_reversible_x'
    | 'time_reversible_y'
    | 'rotational_SO2'
    | 'periodic_translation';
  formulaLatex: string;
  geometricImplication: string;
}

export interface GlobalPropertiesAnalysis {
  symbolicJacobianLatex: string;
  divergenceLatex: string;
  divergenceExpr: string;
  isDivergenceFree: boolean;
  curl2DLatex?: string;
  isGradientSystem: boolean;
  potentialFunctionLatex?: string;
  potentialExpr?: string;
  isHamiltonian: boolean;
  hamiltonianLatex?: string;
  hamiltonianExpr?: string;
  symmetries: SymmetryInfo[];
  bendixsonDulac?: {
    applies: boolean;
    multiplierLatex: string;
    divergenceProductLatex: string;
    conclusion: string;
  };
  linearSystemExact?: {
    matrixALatex: string;
    jordanFormLatex: string;
    matrixExponentialLatex: string;
    generalSolutionLatex: string;
  };
  lyapunov?: {
    source: 'user' | 'auto_quadratic' | 'auto_hamiltonian' | 'auto_mechanical';
    vLatex: string;
    vDotLatex: string;
    vExpr: string;
    vDotExpr: string;
    classification: 'strict_lyapunov' | 'weak_lyapunov_lasalle' | 'conserved_first_integral' | 'indefinite';
    conclusionLatex: string;
  };
  applicableTheorems: ApplicableTheorem[];
}

export interface ApplicableTheorem {
  id: string;
  name: string;
  perkoReference: string;
  statementLatex: string;
  applicationToSystemLatex: string;
}

export interface ViewportBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin?: number;
  zMax?: number;
  isPiScaledX?: boolean;
  isPiScaledY?: boolean;
  isPiScaledZ?: boolean;
}

export interface NumericAnalysis {
  revision: number;
  equilibria: EquilibriumAnalysis[];
  streamlines: StreamlineSegment[];
  manifolds: ManifoldBranch[];
  manifoldSurfaces: ManifoldSurface3D[];
  nullclines: Nullcline[];
  limitCycles: LimitCycle[];
  basinField?: BasinField;
  coordinateTransforms: CoordinateTransformAnalysis;
  global: GlobalPropertiesAnalysis;
  viewport: ViewportBounds;
}

export interface CasEquilibriumPatch {
  matchCoords: number[];
  coordsExactLatex?: string[];
  familyFormulaLatex?: string;
  jacobianExactLatex?: string;
  trace?: ExactOrNumeric;
  determinant?: ExactOrNumeric;
  discriminant2D?: ExactOrNumeric;
  eigenvalues?: ComplexEigenvalue[];
  subspaces?: SubspaceInfo[];
  stabilityReasonLatex?: string;
  classification2D?: EquilibriumType2D;
  classification3D?: EquilibriumType3D;
  stability?: StabilityVerdict;
  sourceMethod?: 'exact_sympy';
}

export interface CasManifoldSeries {
  matchCoords: number[];
  kind: 'Ws' | 'Wu' | 'Wc';
  taylorSeriesLatex: string;
  reducedDynamicsLatex?: string;
}

export interface CasEnrichment {
  revision: number;
  equilibriaPatches: CasEquilibriumPatch[];
  manifoldSeries: CasManifoldSeries[];
  coordinateTransforms?: CoordinateTransformAnalysis;
  global?: Partial<GlobalPropertiesAnalysis>;
  warnings?: string[];
}

export interface LayerVisibility {
  streamlines: boolean;
  particles: boolean;
  manifoldsWuWs: boolean;
  centerManifoldWc: boolean;
  linearSubspaces: boolean;
  nullclines: boolean;
  basins: boolean;
  lyapunov: boolean;
  hamiltonianContours: boolean;
  polarSplit: boolean;
  traceDetMinimap: boolean;
  equilibria: boolean;
  separatrices: boolean;
  limitCycles: boolean;
  vectorField: boolean;
  timeSeries: boolean;
}

export interface ParticleSettings {
  playing: boolean;
  mode: ParticleSpeedMode;
  count: number;
}

export interface FlowMapState {
  active: boolean;
  cx: number;
  cy: number;
  radius: number;
  time: number;
  timeMax: number;
  playing: boolean;
}

export interface LinearizationState {
  equilibriumId: string | null;
  mode: CompareMode;
  streamlines: StreamlineSegment[];
}

export interface ShareSnapshot {
  v: 1;
  mode: SystemMode;
  dimension: number;
  stateVars: string[];
  rows: string[];
  parameters: Record<string, { value: number; min: number; max: number; step: number }>;
  userLyapunovExpr?: string;
  viewport: ViewportBounds;
  viewportLocked: boolean;
  layers: LayerVisibility;
  theme: ThemeMode;
  particleMode: ParticleSpeedMode;
  particlesPlaying: boolean;
  inspectorTab: InspectorTab;
  selectedEquilibriumId: string | null;
  compareMode: CompareMode;
  exampleId?: string;
}

export interface ExampleGroundTruth {
  equilibria?: number[][];
  originClassification2D?: EquilibriumType2D;
  polarRecommended?: boolean;
  hamiltonian?: boolean;
  manifoldCheck?: {
    kind: 'Ws' | 'Wu';
    residualExpr: string;
    maxResidual: number;
    domain: number;
  };
}

export interface PerkoExample {
  id: string;
  title: string;
  citation: string;
  group: string;
  blurb: string;
  mode: SystemMode;
  dimension: number;
  stateVars: string[];
  rows: string[];
  parameters: Record<string, ParameterSpec>;
  userLyapunovExpr?: string;
  groundTruth?: ExampleGroundTruth;
}

export type PipelineStatus = 'idle' | 'running' | 'ready' | 'error';
export type CasStatus = 'booting' | 'idle' | 'running' | 'ready' | 'error' | 'timeout' | 'unavailable';

export interface Rk45Options {
  t0?: number;
  t1: number;
  y0: number[];
  rtol?: number;
  atol?: number;
  maxSteps?: number;
  params: Record<string, number>;
  f: (t: number, y: number[], p: Record<string, number>) => number[];
  viewport?: ViewportBounds;
  viewportMargin?: number;
  equilibria?: Array<{ id: string; coords: number[] }>;
  equilibriumRadius?: number;
  velocityStop?: number;
  blowUpRadius?: number;
  detectPeriodic?: boolean;
  minPeriodTime?: number;
  sampleDistance?: number;
  /** Ignore equilibrium arrival until the orbit has moved this far from the seed. */
  departDistance?: number;
  /** Pull the accepted state back onto an invariant, such as a Hamiltonian level. */
  project?: (y: number[]) => void;
}

export interface Rk45Result {
  t: number[];
  y: number[][];
  status: 'viewportExit' | 'equilibriumReached' | 'periodicOrbitDetected' | 'blowUp' | 'tmax' | 'maxSteps';
  equilibriumId?: string;
  period?: number;
}

export interface PhaseCanvas2DProps {
  spec: SystemSpec;
  analysis: NumericAnalysis;
  layers: LayerVisibility;
  particles: ParticleSettings;
  theme: ThemeMode;
  hoverObjectId: string | null;
  selectedObjectId: string | null;
  linearization: LinearizationState;
  flowMap: FlowMapState;
  userOrbits: StreamlineSegment[];
  compiled: CompiledSystem | null;
  onHoverObject: (id: string | null) => void;
  onSelectObject: (id: string | null) => void;
  onViewportChange: (viewport: ViewportBounds) => void;
  onTracePoint: (point: number[]) => void;
  onFlowMapChange: (patch: Partial<FlowMapState>) => void;
  onResetViewport: () => void;
}

export interface PolarCanvasProps {
  spec: SystemSpec;
  analysis: NumericAnalysis;
  theme: ThemeMode;
  compiled: CompiledSystem | null;
  layers: LayerVisibility;
  hoverObjectId: string | null;
  selectedObjectId: string | null;
  userOrbits: StreamlineSegment[];
  particles: ParticleSettings;
  onTracePolar: (r: number, theta: number) => void;
}

export interface TraceDetMinimapProps {
  analysis: NumericAnalysis;
  theme: ThemeMode;
  selectedEquilibriumId: string | null;
  onSelectEquilibrium: (id: string) => void;
}

export interface PhaseLine1DProps {
  spec: SystemSpec;
  analysis: NumericAnalysis;
  theme: ThemeMode;
  compiled: CompiledSystem | null;
  onTracePoint: (point: number[]) => void;
}

export interface PhaseScene3DProps {
  spec: SystemSpec;
  analysis: NumericAnalysis;
  layers: LayerVisibility;
  theme: ThemeMode;
  particles: ParticleSettings;
  userOrbits: StreamlineSegment[];
  selectedObjectId: string | null;
  hoverObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  onTracePoint: (point: number[]) => void;
}

export interface HigherDimViewProps {
  spec: SystemSpec;
  analysis: NumericAnalysis;
  theme: ThemeMode;
  compiled: CompiledSystem | null;
  onTracePoint: (point: number[]) => void;
  role?: 'stacked' | 'portrait' | 'series';
}
