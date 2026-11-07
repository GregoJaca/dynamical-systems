import type {
  LayerVisibility,
  LinearizationState,
  ParameterSpec,
  ParticleSettings,
  ShareSnapshot,
  SystemSpec,
  ThemeMode,
  ViewportBounds,
} from '../core/types';

export interface SnapshotSource {
  spec: SystemSpec;
  draftRows: string[];
  viewport: ViewportBounds;
  viewportLocked: boolean;
  layers: LayerVisibility;
  theme: ThemeMode;
  particles: ParticleSettings;
  inspectorTab: ShareSnapshot['inspectorTab'];
  selectedEquilibriumId: string | null;
  linearization: LinearizationState;
  exampleId: string | null;
}

export function toSnapshot(state: SnapshotSource): ShareSnapshot {
  const parameters: ShareSnapshot['parameters'] = {};
  for (const [name, spec] of Object.entries(state.spec.parameters)) {
    parameters[name] = { value: spec.value, min: spec.min, max: spec.max, step: spec.step };
  }
  const snapshot: ShareSnapshot = {
    v: 1,
    mode: state.spec.mode,
    dimension: state.spec.dimension,
    stateVars: [...state.spec.stateVars],
    rows: [...state.draftRows],
    parameters,
    viewport: { ...state.viewport },
    viewportLocked: state.viewportLocked,
    layers: { ...state.layers },
    theme: state.theme,
    particleMode: state.particles.mode,
    particlesPlaying: state.particles.playing,
    inspectorTab: state.inspectorTab,
    selectedEquilibriumId: state.selectedEquilibriumId,
    compareMode: state.linearization.mode,
  };
  if (state.spec.userLyapunovExpr) snapshot.userLyapunovExpr = state.spec.userLyapunovExpr;
  if (state.exampleId) snapshot.exampleId = state.exampleId;
  return snapshot;
}

export function parameterOverrides(parameters: Record<string, ParameterSpec>): Record<string, ParameterSpec> {
  return Object.fromEntries(Object.entries(parameters).map(([name, spec]) => [name, { ...spec }]));
}
