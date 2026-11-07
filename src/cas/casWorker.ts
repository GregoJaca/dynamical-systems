import { expose } from 'comlink';
import analyzerSource from './sympy_analyzer.py?raw';
import type { CasEnrichment, SystemSpec } from '../core/types';
import { normalizeEnrichment } from './normalize';
import { PYODIDE_INDEX_URL, PYODIDE_MODULE_URL, type CasWorkerApi } from './workerApi';

interface PyodideRuntime {
  loadPackage(names: string | string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
}

interface PyodideLoader {
  loadPyodide(options: { indexURL: string }): Promise<PyodideRuntime>;
}

let runtime: PyodideRuntime | null = null;
let bootPromise: Promise<void> | null = null;

function loadPyodideModule(specifier: string): Promise<PyodideLoader> {
  const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PyodideLoader>;
  return importer(specifier);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  const proxy = value as { toString?: () => string; destroy?: () => void };
  const text = proxy.toString ? proxy.toString() : String(value);
  proxy.destroy?.();
  return text;
}

async function boot(): Promise<void> {
  if (runtime) return;
  if (!bootPromise) {
    bootPromise = (async () => {
      const pyodide = await loadPyodideModule(PYODIDE_MODULE_URL);
      const next = await pyodide.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      await next.loadPackage(['sympy', 'mpmath']);
      await next.runPythonAsync(analyzerSource);
      runtime = next;
    })().catch((error: unknown) => {
      bootPromise = null;
      runtime = null;
      throw error;
    });
  }
  await bootPromise;
}

function skipped(spec: SystemSpec): CasEnrichment {
  return {
    revision: spec.revision,
    equilibriaPatches: [],
    manifoldSeries: [],
    warnings: ['Symbolic analysis skipped for non-autonomous systems.'],
  };
}

async function analyzeSymbolic(spec: SystemSpec): Promise<CasEnrichment> {
  if (!spec.isAutonomous || spec.mode === 'non_autonomous') return skipped(spec);
  await boot();
  const payload = JSON.stringify({
    revision: spec.revision,
    mode: spec.mode,
    dimension: spec.dimension,
    stateVars: spec.stateVars,
    independentVar: spec.independentVar,
    rhsExpressions: spec.rhsExpressions,
    isAutonomous: spec.isAutonomous,
    isLinear: spec.isLinear,
    parameters: Object.fromEntries(Object.entries(spec.parameters).map(([name, parameter]) => [name, parameter.value])),
    ...(spec.userLyapunovExpr ? { userLyapunovExpr: spec.userLyapunovExpr } : {}),
  });
  try {
    const raw = await runtime!.runPythonAsync(`analyze_json(${JSON.stringify(payload)})`);
    return normalizeEnrichment(spec.revision, JSON.parse(asText(raw)) as unknown);
  } catch (error) {
    return {
      revision: spec.revision,
      equilibriaPatches: [],
      manifoldSeries: [],
      warnings: [`Symbolic worker error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

const api: CasWorkerApi = { boot, analyzeSymbolic };

expose(api);
