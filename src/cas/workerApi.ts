import type { CasEnrichment, SystemSpec } from '../core/types';

/** Pyodide build pinned for the symbolic worker. Loaded as an ES module, never via importScripts. */
export const PYODIDE_VERSION = '0.26.4';

export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`;

/** Kill and respawn the worker when a symbolic call exceeds this budget. Boot is not on this clock. */
export const CAS_TIMEOUT_MS = 4500;

export interface CasWorkerApi {
  boot(): Promise<void>;
  analyzeSymbolic(spec: SystemSpec): Promise<CasEnrichment>;
}
