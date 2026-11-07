import { wrap, type Remote } from 'comlink';
import type { CasEnrichment, SystemSpec } from '../core/types';
import { CAS_TIMEOUT_MS, type CasWorkerApi } from './workerApi';

export { CAS_TIMEOUT_MS } from './workerApi';

export class CasTimeoutError extends Error {
  constructor() {
    super('CAS worker exceeded 4500ms and was restarted.');
    this.name = 'CasTimeoutError';
  }
}

export class CasSupersededError extends Error {
  constructor() {
    super('CAS request was superseded by a newer analysis.');
    this.name = 'CasSupersededError';
  }
}

let worker: Worker | null = null;
let remote: Remote<CasWorkerApi> | null = null;
let bootPromise: Promise<void> | null = null;
let activeToken = 0;
let runningAnalysis = false;

function spawn(): void {
  worker?.terminate();
  worker = new Worker(new URL('./casWorker.ts', import.meta.url), { type: 'module' });
  remote = wrap<CasWorkerApi>(worker);
  bootPromise = null;
}

export function boot(): Promise<void> {
  if (!worker || !remote) spawn();
  if (!bootPromise) {
    const active = remote!;
    bootPromise = active.boot().catch((error: unknown) => {
      if (remote === active) bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

function skipped(spec: SystemSpec): CasEnrichment {
  return {
    revision: spec.revision,
    equilibriaPatches: [],
    manifoldSeries: [],
    warnings: ['Symbolic analysis skipped for non-autonomous systems.'],
  };
}

function withTimeout(api: Remote<CasWorkerApi>, spec: SystemSpec, token: number): Promise<CasEnrichment> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const job = api.analyzeSymbolic(spec).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (token !== activeToken) {
        reject(new CasSupersededError());
        return;
      }
      spawn();
      reject(new CasTimeoutError());
    }, CAS_TIMEOUT_MS);
  });
  return Promise.race([job, timeout])
    .then((outcome) => {
      if (token !== activeToken) throw new CasSupersededError();
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

/**
 * Exact symbolic analysis. A newer call cancels an in-flight SymPy run.
 * The first Pyodide download is not limited by the 4500ms analysis budget.
 */
export async function analyzeSymbolic(spec: SystemSpec): Promise<CasEnrichment> {
  if (!spec.isAutonomous || spec.mode === 'non_autonomous') return skipped(spec);
  const token = ++activeToken;
  if (runningAnalysis) spawn();
  try {
    await boot();
    if (token !== activeToken) throw new CasSupersededError();
    runningAnalysis = true;
    const enrichment = await withTimeout(remote!, spec, token);
    if (token !== activeToken) throw new CasSupersededError();
    return enrichment.revision === spec.revision ? enrichment : { ...enrichment, revision: spec.revision };
  } finally {
    if (token === activeToken) runningAnalysis = false;
  }
}
