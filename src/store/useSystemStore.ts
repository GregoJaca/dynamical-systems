import { create } from 'zustand';
import { defaultLayers, directScene } from '../core/layers';
import type {
  CasEnrichment,
  CasStatus,
  CompareMode,
  CompiledSystem,
  FlowMapState,
  InspectorTab,
  LayerVisibility,
  LinearizationState,
  NumericAnalysis,
  ParameterSpec,
  ParseSystemInput,
  ParticleSettings,
  PerkoExample,
  PipelineStatus,
  ShareSnapshot,
  StreamlineSegment,
  SystemMode,
  SystemSpec,
  ThemeMode,
  ViewportBounds,
} from '../core/types';
import { exampleToSpec } from '../examples/perkoExamples';
import { compileSystemNumeric, tryParseSystem } from '../input/parser';
import { decodeShareState, encodeShareState } from '../share/urlState';
import { emptyAnalysis } from './emptyAnalysis';
import { mergeCas } from '../cas/mergeCas';
import { computeLinearStreamlines, traceUserOrbit } from './orbits';
import { primeWorkers, requestCas, requestNumeric } from './pipeline';
import { parameterOverrides, toSnapshot, type SnapshotSource } from './snapshot';

interface PublishOptions {
  reframe: boolean;
  freezeViewport: boolean;
  layers: 'reset' | 'merge' | 'keep';
}

export interface SystemStore extends SnapshotSource {
  analysis: NumericAnalysis;
  compiled: CompiledSystem | null;
  autoViewport: ViewportBounds;
  numericStatus: PipelineStatus;
  numericError: string | null;
  casStatus: CasStatus;
  casWarnings: string[];
  parseError: string | null;
  flowMap: FlowMapState;
  hoverObjectId: string | null;
  selectedObjectId: string | null;
  hiddenObjectIds: string[];
  userOrbits: StreamlineSegment[];
  galleryOpen: boolean;
  extendedPhase: boolean;
  draftVars: string[];
  view: 'system' | 'portrait' | 'notes' | 'examples' | 'about';
  boot: () => void;
  loadSnapshot: (snapshot: ShareSnapshot) => void;
  loadExample: (example: PerkoExample) => void;
  setDraftRow: (index: number, value: string) => void;
  setSystem: (vars: string[], rows: string[]) => void;
  setView: (view: 'system' | 'portrait' | 'notes' | 'examples' | 'about') => void;
  setMode: (mode: SystemMode) => void;
  setDimension: (dimension: number) => void;
  setParameterValue: (name: string, value: number) => void;
  setParameterBounds: (name: string, bounds: Partial<Pick<ParameterSpec, 'min' | 'max' | 'step'>>) => void;
  setUserLyapunov: (expr: string) => void;
  toggleLayer: (key: keyof LayerVisibility) => void;
  setTheme: (theme: ThemeMode) => void;
  setParticleMode: (mode: ParticleSettings['mode']) => void;
  toggleParticles: () => void;
  setFlowMap: (patch: Partial<FlowMapState>) => void;
  toggleFlowMap: () => void;
  setExtendedPhase: (value: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setViewport: (viewport: ViewportBounds) => void;
  resetViewport: () => void;
  hoverObject: (id: string | null) => void;
  selectObject: (id: string | null) => void;
  selectEquilibrium: (id: string) => void;
  cycleCompare: (equilibriumId: string) => void;
  toggleHidden: (id: string) => void;
  tracePoint: (point: number[]) => void;
  tracePolar: (radius: number, theta: number) => void;
  openGallery: () => void;
  closeGallery: () => void;
  flushCas: () => void;
  copyShareLink: () => string;
}

let revisionCounter = 0;
let hashSuspended = 0;
let explicitShare = false;
let hashTimer: ReturnType<typeof setTimeout> | null = null;
let casTimer: ReturnType<typeof setTimeout> | null = null;
let linearTimer: ReturnType<typeof setTimeout> | null = null;
let linearToken = 0;
let frameQueued = false;
let pendingSpec: SystemSpec | null = null;
let pendingCas: CasEnrichment | null = null;
let booted = false;
const publishPlans = new Map<number, PublishOptions>();

function nextRevision(): number {
  revisionCounter += 1;
  return revisionCounter;
}

function paintTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.body.dataset.theme = theme;
}

function writeHash(state: SnapshotSource & { view: 'system' | 'portrait' | 'notes' | 'examples' | 'about' }) {
  if (typeof window === 'undefined' || hashSuspended > 0) return;
  const url = new URL(window.location.href);
  if (state.view !== 'portrait' && !explicitShare) {
    if (!url.hash) return;
    url.hash = '';
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    return;
  }
  const hash = encodeShareState(toSnapshot(state));
  if (url.hash === hash) return;
  url.hash = hash;
  window.history.replaceState(null, '', url);
}

function defaultVars(dimension: number): string[] {
  if (dimension <= 1) return ['x'];
  if (dimension === 2) return ['x', 'y'];
  if (dimension === 3) return ['x', 'y', 'z'];
  return Array.from({ length: dimension }, (_, index) => `x${index + 1}`);
}

function resizeVars(dimension: number, current: string[]): string[] {
  if (current.length === dimension) return [...current];
  const defaults = defaultVars(dimension);
  if (dimension > current.length) return [...current, ...defaults.slice(current.length)];
  return current.slice(0, dimension);
}

function manualSpec(
  id: string,
  revision: number,
  mode: SystemMode,
  dimension: number,
  stateVars: string[],
  rows: string[],
  parameters: Record<string, ParameterSpec>,
  userLyapunovExpr?: string,
): SystemSpec {
  const mentionsTime = rows.some((row) => /(^|[^A-Za-z])t([^A-Za-z]|$)/.test(row));
  return {
    id,
    revision,
    mode,
    dimension,
    stateVars: [...stateVars],
    independentVar: 't',
    rawEquations: [...rows],
    rhsExpressions: [...rows],
    latexEquations: [],
    parameters: { ...parameters },
    isAutonomous: mode !== 'non_autonomous' && !mentionsTime,
    isLinear: false,
    userLyapunovExpr,
  };
}

function compileSafe(spec: SystemSpec): CompiledSystem | null {
  try {
    return compileSystemNumeric(spec);
  } catch {
    return null;
  }
}

function mergeParameterBounds(
  parsed: Record<string, ParameterSpec>,
  previous: Record<string, ParameterSpec>,
): Record<string, ParameterSpec> {
  const merged: Record<string, ParameterSpec> = {};
  for (const [name, spec] of Object.entries(parsed)) {
    const prior = previous[name];
    merged[name] = prior
      ? { ...spec, value: prior.value, min: prior.min, max: prior.max, step: prior.step, latex: spec.latex || prior.latex }
      : spec;
  }
  return merged;
}

function overlaySnapshotParameters(parsed: Record<string, ParameterSpec>, snapshot: ShareSnapshot): Record<string, ParameterSpec> {
  const parameters = { ...parsed };
  for (const [name, value] of Object.entries(snapshot.parameters)) {
    const existing = parameters[name];
    parameters[name] = {
      name,
      latex: existing?.latex || name,
      value: value.value,
      min: value.min,
      max: value.max,
      step: value.step,
    };
  }
  return parameters;
}

function specFromExample(example: PerkoExample, revision: number): { spec: SystemSpec; error: string | null } {
  try {
    const parsed = exampleToSpec(example, revision);
    return {
      spec: { ...parsed, revision, id: example.id, userLyapunovExpr: example.userLyapunovExpr },
      error: null,
    };
  } catch (error) {
    return {
      spec: manualSpec(
        example.id,
        revision,
        example.mode,
        example.dimension,
        example.stateVars,
        example.rows,
        example.parameters,
        example.userLyapunovExpr,
      ),
      error: error instanceof Error ? error.message : 'Could not parse this example',
    };
  }
}

function editorVarsFor(mode: SystemMode, stateVars: string[], rowCount: number): string[] {
  if (mode === 'second_order_scalar') return [stateVars[0] ?? 'x'];
  if (stateVars.length === rowCount) return [...stateVars];
  return defaultVars(rowCount);
}

function createInitial(): { spec: SystemSpec; draftRows: string[]; draftVars: string[]; exampleId: string | null; parseError: string | null } {
  const vars = ['x', 'y'];
  return {
    spec: manualSpec('blank', nextRevision(), 'autonomous', 2, vars, ['0', '0'], {}),
    draftRows: ['', ''],
    draftVars: vars,
    exampleId: null,
    parseError: null,
  };
}

const initial = createInitial();
const initialViewport = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };

const initialLinearization: LinearizationState = { equilibriumId: null, mode: 'off', streamlines: [] };

const initialFlow: FlowMapState = {
  active: false,
  cx: 0.35,
  cy: 0.2,
  radius: 0.45,
  time: 0,
  timeMax: 2.5,
  playing: false,
};

const initialParticles: ParticleSettings = { playing: false, mode: 'trueVelocity', count: 36 };

export const useSystemStore = create<SystemStore>((set, get) => {
  const applyCas = (enrichment: CasEnrichment) => {
    if (enrichment.revision !== get().spec.revision) return;
    if (get().analysis.revision !== enrichment.revision) {
      pendingCas = enrichment;
      return;
    }
    const before = get().analysis;
    let analysis: NumericAnalysis;
    try {
      analysis = mergeCas(before, enrichment);
    } catch (error) {
      set({
        casStatus: 'error',
        casWarnings: [error instanceof Error ? error.message : 'Could not merge the symbolic result'],
      });
      return;
    }
    const layers = { ...get().layers };
    if (analysis.global.isHamiltonian && !before.global.isHamiltonian) layers.hamiltonianContours = true;
    if (analysis.global.linearSystemExact && !before.global.linearSystemExact) layers.linearSubspaces = true;
    set({ analysis, layers, casStatus: 'ready', casWarnings: enrichment.warnings ?? [] });
  };

  const refreshLinearization = () => {
    if (linearTimer) clearTimeout(linearTimer);
    linearTimer = setTimeout(() => {
      const token = ++linearToken;
      const state = get();
      if (state.linearization.mode === 'off' || !state.linearization.equilibriumId || !state.compiled) {
        if (state.linearization.streamlines.length > 0) {
          set({ linearization: { ...state.linearization, streamlines: [] } });
        }
        return;
      }
      const equilibrium = state.analysis.equilibria.find((item) => item.id === state.linearization.equilibriumId);
      if (!equilibrium) return;
      try {
        const streamlines = computeLinearStreamlines(state.compiled, equilibrium, state.viewport);
        if (token !== linearToken) return;
        set({ linearization: { ...get().linearization, streamlines } });
      } catch {
        if (token !== linearToken) return;
        set({ linearization: { ...get().linearization, streamlines: [] } });
      }
    }, 180);
  };

  const applyPublish = (analysis: NumericAnalysis, plan: PublishOptions) => {
    if (analysis.revision !== get().spec.revision) return;
    const state = get();
    let viewportLocked = state.viewportLocked;
    let viewport = state.viewport;
    if (!plan.freezeViewport && (plan.reframe || !viewportLocked)) {
      viewport = analysis.viewport;
      if (plan.reframe) viewportLocked = false;
    }
    const framed: NumericAnalysis = { ...analysis, viewport };
    let layers = state.layers;
    if (plan.layers === 'reset') layers = directScene(framed, defaultLayers());
    else if (plan.layers === 'merge') layers = directScene(framed, state.layers);
    set({
      analysis: framed,
      viewport,
      autoViewport: analysis.viewport,
      viewportLocked,
      layers,
      numericStatus: 'ready',
      numericError: null,
    });
    if (pendingCas && pendingCas.revision === framed.revision) {
      const enrichment = pendingCas;
      pendingCas = null;
      applyCas(enrichment);
    }
    refreshLinearization();
  };

  const scheduleNumeric = (spec: SystemSpec, plan: PublishOptions) => {
    if (pendingSpec && pendingSpec.revision !== spec.revision) publishPlans.delete(pendingSpec.revision);
    if (pendingCas && pendingCas.revision !== spec.revision) pendingCas = null;
    pendingSpec = spec;
    publishPlans.set(spec.revision, plan);
    if (frameQueued) return;
    frameQueued = true;
    const run = () => {
      frameQueued = false;
      const next = pendingSpec;
      pendingSpec = null;
      if (!next || next.revision !== get().spec.revision) return;
      set({ numericStatus: 'running', numericError: null });
      requestNumeric(
        next,
        (analysis) => {
          const chosen = publishPlans.get(next.revision) ?? plan;
          publishPlans.delete(next.revision);
          applyPublish(analysis, chosen);
        },
        (message) => {
          publishPlans.delete(next.revision);
          if (get().spec.revision !== next.revision) return;
          set({ numericStatus: 'error', numericError: message });
        },
      );
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  const scheduleCas = (immediate: boolean) => {
    if (casTimer) clearTimeout(casTimer);
    casTimer = setTimeout(() => {
      casTimer = null;
      const spec = get().spec;
      requestCas(spec, {
        onStatus: (status, warnings) => {
          if (get().spec.revision !== spec.revision) return;
          set({ casStatus: status, casWarnings: warnings ?? (status === 'ready' ? [] : get().casWarnings) });
        },
        onResult: (enrichment) => applyCas(enrichment),
      });
    }, immediate ? 0 : 150);
  };

  const reparse = (input: {
    mode: SystemMode;
    dimension: number;
    stateVars: string[];
    rows: string[];
    userLyapunovExpr?: string;
    editorVars?: string[];
    exampleId: string | null;
    plan: PublishOptions;
    cas: 'debounce' | 'now';
  }) => {
    const revision = nextRevision();
    const previous = get().spec;
    const request: ParseSystemInput = {
      id: input.exampleId ?? 'custom',
      revision,
      mode: input.mode,
      dimension: input.dimension,
      stateVars: input.stateVars,
      rows: input.rows,
      independentVar: 't',
      parameterOverrides: parameterOverrides(previous.parameters),
      userLyapunovExpr: input.userLyapunovExpr,
    };
    const parsed = tryParseSystem(request);
    const editorVars = input.editorVars ?? editorVarsFor(input.mode, input.stateVars, input.rows.length);
    if (!parsed.ok) {
      set({
        draftRows: [...input.rows],
        draftVars: editorVars,
        exampleId: input.exampleId,
        parseError: parsed.error,
      });
      return;
    }
    try {
      const spec: SystemSpec = {
        ...parsed.spec,
        id: input.exampleId ?? parsed.spec.id ?? 'custom',
        revision,
        parameters: mergeParameterBounds(parsed.spec.parameters, previous.parameters),
        userLyapunovExpr: input.userLyapunovExpr,
      };
      set({
        spec,
        draftRows: [...input.rows],
        draftVars: editorVars,
        exampleId: input.exampleId,
        compiled: compileSafe(spec),
        parseError: null,
        numericStatus: 'running',
        numericError: null,
        userOrbits: [],
        extendedPhase: input.dimension === 2 && !spec.isAutonomous ? get().extendedPhase : false,
      });
      scheduleNumeric(spec, input.plan);
      scheduleCas(input.cas === 'now');
    } catch (error) {
      set({
        draftRows: [...input.rows],
        draftVars: editorVars,
        exampleId: input.exampleId,
        parseError: error instanceof Error ? error.message : 'Could not parse the system',
      });
    }
  };

  const applySnapshot = (snapshot: ShareSnapshot) => {
    const revision = nextRevision();
    let spec: SystemSpec;
    let parseError: string | null = null;
    const parsed = tryParseSystem({
      id: snapshot.exampleId ?? 'shared',
      revision,
      mode: snapshot.mode,
      dimension: snapshot.dimension,
      stateVars: snapshot.stateVars,
      rows: snapshot.rows,
      independentVar: 't',
      parameterOverrides: Object.fromEntries(
        Object.entries(snapshot.parameters).map(([name, value]) => [name, { name, ...value }]),
      ),
      userLyapunovExpr: snapshot.userLyapunovExpr,
    });
    if (parsed.ok) {
      spec = {
        ...parsed.spec,
        id: snapshot.exampleId ?? parsed.spec.id ?? 'shared',
        revision,
        userLyapunovExpr: snapshot.userLyapunovExpr,
        parameters: overlaySnapshotParameters(parsed.spec.parameters, snapshot),
      };
    } else {
      parseError = parsed.error;
      const parameters: Record<string, ParameterSpec> = {};
      for (const [name, value] of Object.entries(snapshot.parameters)) {
        parameters[name] = { name, latex: name, ...value };
      }
      spec = manualSpec(
        snapshot.exampleId ?? 'shared',
        revision,
        snapshot.mode,
        snapshot.dimension,
        snapshot.stateVars,
        snapshot.rows,
        parameters,
        snapshot.userLyapunovExpr,
      );
    }
    const compareMode: CompareMode = snapshot.compareMode;
    set({
      spec,
      draftRows: [...snapshot.rows],
      draftVars: editorVarsFor(snapshot.mode, snapshot.stateVars, snapshot.rows.length),
      view: 'portrait',
      exampleId: snapshot.exampleId ?? null,
      compiled: compileSafe(spec),
      parseError,
      viewport: { ...snapshot.viewport },
      viewportLocked: snapshot.viewportLocked,
      layers: { ...snapshot.layers },
      theme: snapshot.theme,
      particles: { ...get().particles, playing: snapshot.particlesPlaying, mode: 'trueVelocity' },
      inspectorTab: snapshot.inspectorTab,
      selectedEquilibriumId: snapshot.selectedEquilibriumId,
      selectedObjectId: snapshot.selectedEquilibriumId,
      linearization: {
        equilibriumId: snapshot.selectedEquilibriumId,
        mode: compareMode,
        streamlines: [],
      },
      hoverObjectId: null,
      hiddenObjectIds: [],
      userOrbits: [],
      extendedPhase: false,
      galleryOpen: false,
      numericStatus: parseError ? 'error' : 'running',
      numericError: parseError,
    });
    paintTheme(snapshot.theme);
    if (!parseError) {
      scheduleNumeric(spec, { reframe: false, freezeViewport: true, layers: 'keep' });
      scheduleCas(true);
    }
  };

  return {
    spec: initial.spec,
    draftRows: initial.draftRows,
    draftVars: initial.draftVars,
    view: 'system',
    exampleId: initial.exampleId,
    parseError: initial.parseError,
    analysis: emptyAnalysis(initial.spec.revision, initialViewport),
    compiled: compileSafe(initial.spec),
    viewport: initialViewport,
    autoViewport: initialViewport,
    viewportLocked: false,
    layers: defaultLayers(),
    theme: 'light',
    particles: initialParticles,
    inspectorTab: 'objects',
    selectedEquilibriumId: null,
    linearization: initialLinearization,
    flowMap: initialFlow,
    hoverObjectId: null,
    selectedObjectId: null,
    hiddenObjectIds: [],
    userOrbits: [],
    galleryOpen: false,
    extendedPhase: false,
    numericStatus: 'idle',
    numericError: null,
    casStatus: 'booting',
    casWarnings: [],

    boot: () => {
      if (booted || typeof window === 'undefined') return;
      booted = true;
      window.addEventListener('hashchange', () => {
        const decoded = decodeShareState(window.location.hash);
        if (!decoded) return;
        if (encodeShareState(toSnapshot(get())) === window.location.hash) return;
        hashSuspended += 1;
        try {
          applySnapshot(decoded);
        } finally {
          hashSuspended -= 1;
        }
      });
      paintTheme(get().theme);
      const decoded = decodeShareState(window.location.hash);
      if (decoded) {
        hashSuspended += 1;
        try {
          applySnapshot(decoded);
        } finally {
          hashSuspended -= 1;
        }
      } else if (get().draftRows.every((row) => row.trim().length > 0)) {
        scheduleNumeric(get().spec, { reframe: true, freezeViewport: false, layers: 'reset' });
        scheduleCas(true);
      }
      primeWorkers((status) => {
        const current = get().casStatus;
        if (current === 'running' || current === 'ready' || current === 'timeout') return;
        set({ casStatus: status });
      });
    },

    loadSnapshot: (snapshot) => {
      hashSuspended += 1;
      try {
        applySnapshot(snapshot);
      } finally {
        hashSuspended -= 1;
      }
    },

    loadExample: (example) => {
      const built = specFromExample(example, nextRevision());
      const spec = built.spec;
      const parseError = built.error;
      set({
        spec,
        draftRows: [...example.rows],
        draftVars: editorVarsFor(example.mode, example.stateVars, example.rows.length),
        view: 'portrait',
        exampleId: example.id,
        compiled: compileSafe(spec),
        parseError,
        galleryOpen: false,
        userOrbits: [],
        hiddenObjectIds: [],
        extendedPhase: false,
        selectedObjectId: null,
        selectedEquilibriumId: null,
        hoverObjectId: null,
        linearization: { equilibriumId: null, mode: 'off', streamlines: [] },
        viewportLocked: false,
        numericStatus: 'running',
        numericError: parseError,
      });
      scheduleNumeric(spec, { reframe: true, freezeViewport: false, layers: 'reset' });
      scheduleCas(true);
    },

    setDraftRow: (index, value) => {
      const rows = [...get().draftRows];
      rows[index] = value;
      const spec = get().spec;
      reparse({
        mode: spec.mode,
        dimension: spec.dimension,
        stateVars: [...spec.stateVars],
        rows,
        editorVars: get().draftVars,
        userLyapunovExpr: spec.userLyapunovExpr,
        exampleId: null,
        plan: { reframe: true, freezeViewport: false, layers: 'merge' },
        cas: 'debounce',
      });
    },

    setSystem: (vars, rows) => {
      if (vars.length === 0 || vars.length !== rows.length) return;
      const names = vars.map((name) => name.trim());
      const equations = rows.map((row) => row);
      if (names.some((name) => name.length === 0) || equations.some((row) => row.trim().length === 0)) {
        set({
          draftRows: equations,
          draftVars: names,
          parseError: names.some((name) => name.length === 0) ? 'Name each variable.' : 'An equation is empty.',
        });
        return;
      }
      const spec = get().spec;
      const secondOrder = equations.length === 1 && /''|′′/.test(equations[0] ?? '');
      const velocity = spec.mode === 'second_order_scalar' ? (spec.stateVars[1] ?? 'v') : 'v';
      reparse({
        mode: secondOrder ? 'second_order_scalar' : 'autonomous',
        dimension: secondOrder ? 2 : equations.length,
        stateVars: secondOrder ? [names[0] ?? 'x', velocity] : names,
        rows: equations.map((row) => row.trim()),
        editorVars: names,
        userLyapunovExpr: spec.userLyapunovExpr,
        exampleId: null,
        plan: { reframe: true, freezeViewport: false, layers: 'merge' },
        cas: 'debounce',
      });
    },

    setView: (view) => {
      if (view !== 'portrait') explicitShare = false;
      set({ view });
    },

    setMode: (mode) => {
      const spec = get().spec;
      if (mode === spec.mode) return;
      if (mode === 'second_order_scalar') {
        reparse({
          mode,
          dimension: 2,
          stateVars: spec.mode === 'second_order_scalar' ? [...spec.stateVars] : ['x', 'v'],
          rows: [spec.mode === 'second_order_scalar' ? (get().draftRows[0] ?? "x'' + x' + x = 0") : "x'' + x' + x = 0"],
          userLyapunovExpr: spec.userLyapunovExpr,
          exampleId: null,
          plan: { reframe: true, freezeViewport: false, layers: 'reset' },
          cas: 'debounce',
        });
        return;
      }
      const dimension = spec.mode === 'second_order_scalar' ? 2 : spec.dimension;
      const stateVars = spec.mode === 'second_order_scalar' ? defaultVars(dimension) : resizeVars(dimension, spec.stateVars);
      const source = spec.mode === 'second_order_scalar' && spec.rhsExpressions.length === dimension ? spec.rhsExpressions : get().draftRows;
      const rows = [...source];
      while (rows.length < dimension) rows.push('0');
      reparse({
        mode,
        dimension,
        stateVars,
        rows: rows.slice(0, dimension),
        userLyapunovExpr: spec.userLyapunovExpr,
        exampleId: null,
        plan: { reframe: true, freezeViewport: false, layers: 'reset' },
        cas: 'debounce',
      });
    },

    setDimension: (value) => {
      const spec = get().spec;
      if (spec.mode === 'second_order_scalar') return;
      const dimension = Math.max(1, Math.min(8, Math.round(value)));
      if (dimension === spec.dimension) return;
      const stateVars = resizeVars(dimension, spec.stateVars);
      const rows = [...get().draftRows];
      while (rows.length < dimension) rows.push('0');
      reparse({
        mode: spec.mode,
        dimension,
        stateVars,
        rows: rows.slice(0, dimension),
        userLyapunovExpr: spec.userLyapunovExpr,
        exampleId: null,
        plan: { reframe: true, freezeViewport: false, layers: 'reset' },
        cas: 'debounce',
      });
    },

    setParameterValue: (name, value) => {
      const current = get().spec.parameters[name];
      if (!current || !Number.isFinite(value)) return;
      const revision = nextRevision();
      const spec: SystemSpec = {
        ...get().spec,
        revision,
        parameters: { ...get().spec.parameters, [name]: { ...current, value } },
      };
      set({
        spec,
        compiled: compileSafe(spec),
        numericStatus: 'running',
        numericError: null,
        userOrbits: [],
      });
      scheduleNumeric(spec, { reframe: false, freezeViewport: false, layers: 'merge' });
    },

    setParameterBounds: (name, bounds) => {
      const current = get().spec.parameters[name];
      if (!current) return;
      const next = { ...current, ...bounds };
      if (!(next.step > 0) || !(next.max > next.min)) return;
      let value = current.value;
      if (value < next.min) value = next.min;
      if (value > next.max) value = next.max;
      const spec: SystemSpec = {
        ...get().spec,
        parameters: { ...get().spec.parameters, [name]: { ...next, value } },
      };
      set({ spec, compiled: compileSafe(spec) });
      if (value !== current.value) get().setParameterValue(name, value);
    },

    setUserLyapunov: (expr) => {
      const spec = get().spec;
      const userLyapunovExpr = expr.trim() ? expr.trim() : undefined;
      reparse({
        mode: spec.mode,
        dimension: spec.dimension,
        stateVars: [...spec.stateVars],
        rows: [...get().draftRows],
        userLyapunovExpr,
        exampleId: null,
        plan: { reframe: false, freezeViewport: false, layers: 'merge' },
        cas: 'debounce',
      });
    },

    toggleLayer: (key) => {
      set({ layers: { ...get().layers, [key]: !get().layers[key] } });
    },

    setTheme: (theme) => {
      paintTheme(theme);
      set({ theme });
    },

    setParticleMode: () => {
      set({ particles: { ...get().particles, mode: 'trueVelocity' } });
    },

    toggleParticles: () => {
      const playing = !get().particles.playing;
      set({
        particles: { ...get().particles, playing },
        layers: { ...get().layers, particles: playing ? true : get().layers.particles },
      });
    },

    setFlowMap: (patch) => {
      set({ flowMap: { ...get().flowMap, ...patch } });
    },

    toggleFlowMap: () => {
      const active = !get().flowMap.active;
      set({ flowMap: { ...get().flowMap, active, playing: false, time: active ? get().flowMap.time : 0 } });
    },

    setExtendedPhase: (value) => set({ extendedPhase: value }),

    setInspectorTab: (inspectorTab) => set({ inspectorTab }),

    setViewport: (viewport) => {
      set({
        viewport,
        viewportLocked: true,
        analysis: { ...get().analysis, viewport },
      });
    },

    resetViewport: () => {
      const viewport = get().autoViewport;
      set({
        viewport,
        viewportLocked: false,
        analysis: { ...get().analysis, viewport },
      });
    },

    hoverObject: (hoverObjectId) => set({ hoverObjectId }),

    selectObject: (id) => {
      const isEquilibrium = id !== null && get().analysis.equilibria.some((item) => item.id === id);
      set({
        selectedObjectId: id,
        selectedEquilibriumId: isEquilibrium ? id : get().selectedEquilibriumId,
      });
    },

    selectEquilibrium: (id) => {
      const linearization = get().linearization.mode === 'off'
        ? get().linearization
        : { ...get().linearization, equilibriumId: id };
      set({
        selectedEquilibriumId: id,
        selectedObjectId: id,
        inspectorTab: 'equilibria',
        linearization,
      });
      if (linearization.mode !== 'off') refreshLinearization();
    },

    cycleCompare: (equilibriumId) => {
      const current = get().linearization;
      const order: CompareMode[] = ['off', 'overlay', 'split'];
      const next = current.equilibriumId === equilibriumId ? order[(order.indexOf(current.mode) + 1) % order.length]! : 'overlay';
      set({
        selectedEquilibriumId: equilibriumId,
        selectedObjectId: equilibriumId,
        inspectorTab: 'equilibria',
        linearization: { ...current, equilibriumId, mode: next, streamlines: next === 'off' ? [] : current.streamlines },
      });
      refreshLinearization();
    },

    toggleHidden: (id) => {
      const hidden = get().hiddenObjectIds;
      set({ hiddenObjectIds: hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id] });
    },

    tracePoint: (point) => {
      const state = get();
      if (!state.compiled) return;
      const revision = state.spec.revision;
      const compiled = state.compiled;
      const viewport = state.viewport;
      const equilibria = state.analysis.equilibria.map((eq) => ({ id: eq.id, coords: eq.coords }));
      const id = `user-${Date.now().toString(36)}`;
      setTimeout(() => {
        if (get().spec.revision !== revision) return;
        const orbit = traceUserOrbit(compiled, point, viewport, equilibria, id);
        if (!orbit || get().spec.revision !== revision) return;
        set({ userOrbits: [...get().userOrbits, orbit] });
      }, 0);
    },

    tracePolar: (radius, theta) => {
      get().tracePoint([radius * Math.cos(theta), radius * Math.sin(theta)]);
    },

    openGallery: () => set({ galleryOpen: true }),
    closeGallery: () => set({ galleryOpen: false }),

    flushCas: () => scheduleCas(true),

    copyShareLink: () => {
      if (hashTimer) {
        clearTimeout(hashTimer);
        hashTimer = null;
      }
      explicitShare = true;
      writeHash(get());
      if (typeof window === 'undefined') return encodeShareState(toSnapshot(get()));
      return window.location.href;
    },
  };
});

if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    useSystemStore.getState().boot();
  });
}

useSystemStore.subscribe(() => {
  if (hashSuspended > 0 || typeof window === 'undefined') return;
  if (hashTimer) clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    hashTimer = null;
    writeHash(useSystemStore.getState());
  }, 100);
});
