import * as Comlink from 'comlink';
import type { NumericAnalysis, SystemSpec } from '../core/types';
import type { NumericWorkerApi } from './numericWorker';

export interface NumericClient {
  analyzeNumeric: (spec: SystemSpec) => Promise<NumericAnalysis>;
  terminate: () => void;
}

/** Main-thread handle for the Comlink numeric worker. */
export function createNumericClient(): NumericClient {
  const worker = new Worker(new URL('./numericWorker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<NumericWorkerApi>(worker);
  return {
    analyzeNumeric: (spec) => remote.analyzeNumeric(spec),
    terminate: () => {
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}
