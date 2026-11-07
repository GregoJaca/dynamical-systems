import { analyzeSymbolic, boot, CasSupersededError, CasTimeoutError } from '../cas/casClient';
import type { CasEnrichment, CasStatus, NumericAnalysis, SystemSpec } from '../core/types';
import { analyzeNumeric } from '../numeric/analyze';
import { createNumericClient, type NumericClient } from '../numeric/workerClient';

let numericClient: NumericClient | null = null;
let numericBroken = false;
let casToken = 0;

class WorkerTimeout extends Error {
  constructor() {
    super('timeout');
    this.name = 'WorkerTimeout';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new WorkerTimeout());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('Worker request failed'));
      },
    );
  });
}

function getNumericClient(): NumericClient | null {
  if (numericBroken) return null;
  if (numericClient) return numericClient;
  try {
    numericClient = createNumericClient();
    return numericClient;
  } catch {
    numericBroken = true;
    return null;
  }
}

/** Start the numeric worker and the Pyodide boot. Symbolic calls use the CAS client, which respawns itself after 4500ms. */
export function primeWorkers(onCas: (status: CasStatus) => void): void {
  getNumericClient();
  void boot().then(
    () => onCas('idle'),
    () => onCas('unavailable'),
  );
}

export function requestNumeric(
  spec: SystemSpec,
  onResult: (analysis: NumericAnalysis) => void,
  onError: (message: string) => void,
): void {
  const revision = spec.revision;
  const finishMain = () => {
    try {
      const analysis = analyzeNumeric(spec);
      onResult(analysis.revision === revision ? analysis : { ...analysis, revision });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Numeric analysis failed');
    }
  };

  const client = getNumericClient();
  if (!client) {
    finishMain();
    return;
  }

  void (async () => {
    try {
      const analysis = await withTimeout(client.analyzeNumeric(spec), 12_000, () => {
        client.terminate();
        if (numericClient === client) numericClient = null;
      });
      if (!analysis || analysis.revision !== revision) {
        finishMain();
        return;
      }
      onResult(analysis);
    } catch {
      finishMain();
    }
  })();
}

export function requestCas(
  spec: SystemSpec,
  handlers: {
    onStatus: (status: CasStatus, warnings?: string[]) => void;
    onResult: (enrichment: CasEnrichment) => void;
  },
): void {
  const token = ++casToken;
  const revision = spec.revision;
  handlers.onStatus('running');
  void analyzeSymbolic(spec).then(
    (enrichment) => {
      if (token !== casToken || enrichment.revision !== revision) return;
      handlers.onResult(enrichment);
      handlers.onStatus('ready', enrichment.warnings);
    },
    (error: unknown) => {
      if (token !== casToken || error instanceof CasSupersededError) return;
      if (error instanceof CasTimeoutError) {
        handlers.onStatus('timeout');
        return;
      }
      handlers.onStatus('error', [error instanceof Error ? error.message : 'Symbolic analysis failed']);
    },
  );
}
