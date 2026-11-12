import { create } from 'zustand';
import type { ParameterSpec, ThemeMode } from '../core/types';
import { parseProblem } from './parse';
import { solveProblem } from './solve';
import type { FieldFrame, PdeExample, PdeProblem, PdeSolution } from './types';
import { DEFAULT_PDE_LINES } from './types';
import { decodePdeState, encodePdeState, type PdeFrameId, type PdeSnapshot, type PdeView } from './url';

export interface PdeStore {
  view: PdeView;
  theme: ThemeMode;
  draft: string;
  problem: PdeProblem | null;
  error: string | null;
  solution: PdeSolution | null;
  hidden: string[];
  selectedId: string | null;
  hoverId: string | null;
  t0: number;
  x0: number;
  frame: PdeFrameId;
  partialN: number;
  solving: boolean;
  boot: () => void;
  setView: (view: PdeView) => void;
  setTheme: (theme: ThemeMode) => void;
  setDraft: (draft: string) => void;
  setParameter: (name: string, value: number) => void;
  setCursor: (x0: number, t0: number) => void;
  setX0: (x0: number) => void;
  setT0: (t0: number) => void;
  setFrame: (frame: PdeFrameId) => void;
  setPartialN: (partialN: number) => void;
  toggleHidden: (id: string) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  loadExample: (example: PdeExample) => void;
  copyShareLink: () => string;
}

export function activeFrame(solution: PdeSolution | null, frame: PdeFrameId): FieldFrame | null {
  if (!solution) return null;
  return solution.frames.find((item) => item.id === frame) ?? solution.frames[0] ?? null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not read this problem.';
}

function overrides(values: Record<string, number> | undefined): Record<string, Partial<ParameterSpec>> | undefined {
  if (!values) return undefined;
  const patch: Record<string, Partial<ParameterSpec>> = {};
  for (const [name, value] of Object.entries(values)) patch[name] = { value };
  return patch;
}

function parameterValues(problem: PdeProblem | null): Record<string, number> {
  const values: Record<string, number> = {};
  if (!problem) return values;
  for (const [name, spec] of Object.entries(problem.parameters)) values[name] = spec.value;
  return values;
}

interface Solved {
  problem: PdeProblem | null;
  solution: PdeSolution | null;
  error: string | null;
}

function compute(draft: string, values?: Record<string, number>): Solved {
  try {
    const problem = parseProblem(draft, overrides(values));
    try {
      return { problem, solution: solveProblem(problem), error: null };
    } catch (error) {
      return { problem, solution: null, error: message(error) };
    }
  } catch (error) {
    return { problem: null, solution: null, error: message(error) };
  }
}

function midpoint(solution: PdeSolution | null, frame: PdeFrameId): { t0: number; x0: number } {
  const field = activeFrame(solution, frame);
  if (!field) return { t0: 0, x0: 0 };
  return { t0: (field.tMin + field.tMax) / 2, x0: (field.xMin + field.xMax) / 2 };
}

function clampToFrame(solution: PdeSolution | null, frame: PdeFrameId, t0: number, x0: number): { t0: number; x0: number } {
  const field = activeFrame(solution, frame);
  if (!field) return { t0, x0 };
  const tMin = Math.min(field.tMin, field.tMax);
  const tMax = Math.max(field.tMin, field.tMax);
  const xMin = Math.min(field.xMin, field.xMax);
  const xMax = Math.max(field.xMin, field.xMax);
  return {
    t0: Math.min(tMax, Math.max(tMin, t0)),
    x0: Math.min(xMax, Math.max(xMin, x0)),
  };
}

function defaultHidden(solution: PdeSolution | null): string[] {
  if (!solution) return [];
  return solution.objects.filter((object) => !object.defaultOn).map((object) => object.id);
}

function keepHidden(previousHidden: string[], previous: PdeSolution | null, solution: PdeSolution | null): string[] {
  if (!solution) return [];
  const nextIds = new Set(solution.objects.map((object) => object.id));
  const kept = previousHidden.filter((id) => nextIds.has(id));
  const known = new Set(previous?.objects.map((object) => object.id) ?? []);
  for (const object of solution.objects) {
    if (!object.defaultOn && !known.has(object.id) && !kept.includes(object.id)) kept.push(object.id);
  }
  return kept;
}

function defaultPartial(solution: PdeSolution | null): number {
  if (!solution || solution.family !== 'heat' || solution.modes.length === 0) return 4;
  return Math.min(4, solution.modes.length);
}

function keepPartial(partialN: number, solution: PdeSolution | null): number {
  if (!solution || solution.family !== 'heat' || solution.modes.length === 0) return Math.max(1, partialN);
  return Math.min(solution.modes.length, Math.max(1, Math.round(partialN)));
}

function keepFrame(frame: PdeFrameId, solution: PdeSolution | null): PdeFrameId {
  if (!solution) return frame;
  if (solution.frames.some((item) => item.id === frame)) return frame;
  return solution.frames[0]?.id ?? 'original';
}

function keepSelected(selectedId: string | null, solution: PdeSolution | null): string | null {
  if (!selectedId || !solution) return null;
  return solution.objects.some((object) => object.id === selectedId) ? selectedId : null;
}

function toSnapshot(state: PdeStore): PdeSnapshot {
  return {
    v: 1,
    draft: state.draft,
    view: state.view,
    theme: state.theme,
    t0: state.t0,
    x0: state.x0,
    hidden: state.hidden,
    selectedId: state.selectedId,
    frame: state.frame,
    partialN: state.partialN,
    parameters: parameterValues(state.problem),
  };
}

let hashLock = 0;
let hashTimer: ReturnType<typeof setTimeout> | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let solveToken = 0;
let booted = false;

function writeHash(state: PdeStore) {
  if (typeof window === 'undefined' || hashLock > 0) return;
  const hash = encodePdeState(toSnapshot(state));
  if (window.location.hash === hash) return;
  const url = new URL(window.location.href);
  url.hash = hash;
  window.history.replaceState(null, '', url);
}

function scheduleHash() {
  if (hashLock > 0 || typeof window === 'undefined') return;
  if (hashTimer) clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    hashTimer = null;
    writeHash(usePdeStore.getState());
  }, 180);
}

function flushHash() {
  if (hashTimer) {
    clearTimeout(hashTimer);
    hashTimer = null;
  }
  writeHash(usePdeStore.getState());
}

const restored = typeof window !== 'undefined' ? decodePdeState(window.location.hash) : null;
const initialDraft = restored?.draft ?? DEFAULT_PDE_LINES.join('\n');
const initialSolved = compute(initialDraft, restored?.parameters);
const initialFrame = restored ? keepFrame(restored.frame, initialSolved.solution) : keepFrame('original', initialSolved.solution);
const initialCursor = restored
  ? clampToFrame(initialSolved.solution, initialFrame, restored.t0, restored.x0)
  : midpoint(initialSolved.solution, initialFrame);

if (typeof document !== 'undefined') {
  document.body.dataset.theme = restored?.theme ?? 'light';
}

function applySolved(draft: string, solved: Solved, resetCursor: boolean) {
  const state = usePdeStore.getState();
  const frame = resetCursor ? keepFrame('original', solved.solution) : keepFrame(state.frame, solved.solution);
  const cursor = resetCursor ? midpoint(solved.solution, frame) : clampToFrame(solved.solution, frame, state.t0, state.x0);
  usePdeStore.setState({
    draft,
    problem: solved.problem,
    solution: solved.solution,
    error: solved.error,
    frame,
    ...cursor,
    hidden: resetCursor ? defaultHidden(solved.solution) : keepHidden(state.hidden, state.solution, solved.solution),
    partialN: resetCursor ? defaultPartial(solved.solution) : keepPartial(state.partialN, solved.solution),
    selectedId: keepSelected(resetCursor ? null : state.selectedId, solved.solution),
    hoverId: null,
  });
}

function publishDraft(draft: string) {
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  const token = ++solveToken;
  usePdeStore.setState({ draft, solving: true, solution: null, error: null });
  setTimeout(() => {
    if (token !== solveToken) return;
    applySolved(draft, compute(draft), true);
    usePdeStore.setState({ solving: false });
  }, 0);
}

function flushDraft() {
  if (!draftTimer) return;
  clearTimeout(draftTimer);
  draftTimer = null;
  const draft = usePdeStore.getState().draft;
  applySolved(draft, compute(draft), true);
}

function scheduleDraft(draft: string) {
  usePdeStore.setState({ draft });
  if (draftTimer) clearTimeout(draftTimer);
  const token = ++solveToken;
  draftTimer = setTimeout(() => {
    draftTimer = null;
    const latest = usePdeStore.getState().draft;
    usePdeStore.setState({ solving: true });
    setTimeout(() => {
      if (token !== solveToken) return;
      applySolved(latest, compute(latest), true);
      usePdeStore.setState({ solving: false });
    }, 0);
  }, 120);
}

export const usePdeStore = create<PdeStore>((set, get) => ({
  view: restored?.view ?? 'home',
  theme: restored?.theme ?? 'light',
  draft: initialDraft,
  problem: initialSolved.problem,
  error: initialSolved.error,
  solution: initialSolved.solution,
  hidden: restored?.hidden ?? defaultHidden(initialSolved.solution),
  selectedId: keepSelected(restored?.selectedId ?? null, initialSolved.solution),
  hoverId: null,
  t0: initialCursor.t0,
  x0: initialCursor.x0,
  frame: initialFrame,
  partialN: restored ? keepPartial(restored.partialN, initialSolved.solution) : defaultPartial(initialSolved.solution),
  solving: false,

  boot: () => {
    if (booted || typeof window === 'undefined') return;
    booted = true;
    document.body.dataset.theme = get().theme;
    window.addEventListener('hashchange', () => {
      const decoded = decodePdeState(window.location.hash);
      if (!decoded) return;
      if (encodePdeState(toSnapshot(get())) === window.location.hash) return;
      hashLock += 1;
      try {
        if (draftTimer) {
          clearTimeout(draftTimer);
          draftTimer = null;
        }
        const solved = compute(decoded.draft, decoded.parameters);
        const frame = keepFrame(decoded.frame, solved.solution);
        set({
          draft: decoded.draft,
          view: decoded.view,
          theme: decoded.theme,
          problem: solved.problem,
          solution: solved.solution,
          error: solved.error,
          hidden: decoded.hidden,
          selectedId: keepSelected(decoded.selectedId, solved.solution),
          hoverId: null,
          frame,
          partialN: keepPartial(decoded.partialN, solved.solution),
          ...clampToFrame(solved.solution, frame, decoded.t0, decoded.x0),
        });
        document.body.dataset.theme = decoded.theme;
      } finally {
        hashLock -= 1;
      }
    });
  },

  setView: (view) => {
    flushDraft();
    set({ view });
  },

  setTheme: (theme) => {
    document.body.dataset.theme = theme;
    set({ theme });
  },

  setDraft: (draft) => scheduleDraft(draft),

  setParameter: (name, value) => {
    const state = get();
    if (!state.problem?.parameters[name]) return;
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    const values = { ...parameterValues(state.problem), [name]: value };
    const solved = compute(state.draft, values);
    applySolved(state.draft, solved, false);
  },

  setCursor: (x0, t0) => {
    const state = get();
    set(clampToFrame(state.solution, state.frame, t0, x0));
  },

  setX0: (x0) => {
    const state = get();
    set(clampToFrame(state.solution, state.frame, state.t0, x0));
  },

  setT0: (t0) => {
    const state = get();
    set(clampToFrame(state.solution, state.frame, t0, state.x0));
  },

  setFrame: (frame) => {
    const state = get();
    const next = keepFrame(frame, state.solution);
    set({ frame: next, ...clampToFrame(state.solution, next, state.t0, state.x0) });
  },

  setPartialN: (partialN) => set({ partialN: keepPartial(partialN, get().solution) }),

  toggleHidden: (id) => {
    const hidden = get().hidden;
    set({ hidden: hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id] });
  },

  select: (id) => set({ selectedId: get().selectedId === id ? null : id }),

  hover: (id) => {
    if (get().hoverId === id) return;
    set({ hoverId: id });
  },

  loadExample: (example) => {
    set({ view: 'study' });
    publishDraft(example.lines.join('\n'));
  },

  copyShareLink: () => {
    flushDraft();
    flushHash();
    return window.location.href;
  },
}));

function sameShare(left: PdeStore, right: PdeStore): boolean {
  return (
    left.draft === right.draft &&
    left.view === right.view &&
    left.theme === right.theme &&
    left.t0 === right.t0 &&
    left.x0 === right.x0 &&
    left.frame === right.frame &&
    left.partialN === right.partialN &&
    left.selectedId === right.selectedId &&
    left.hidden === right.hidden &&
    left.problem === right.problem
  );
}

if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    usePdeStore.getState().boot();
    usePdeStore.subscribe((state, previous) => {
      if (sameShare(state, previous)) return;
      scheduleHash();
    });
  });
}
