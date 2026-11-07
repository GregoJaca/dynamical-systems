/**
 * Numeric web worker. The UI thread ships a SystemSpec and receives a NumericAnalysis.
 * Cancellation is the caller's responsibility: drop results whose revision is stale.
 */

import * as Comlink from 'comlink';
import type { NumericAnalysis, SystemSpec } from '../core/types';
import { analyzeNumeric } from './analyze';

export interface NumericWorkerApi {
  analyzeNumeric(spec: SystemSpec): NumericAnalysis;
}

const api: NumericWorkerApi = {
  analyzeNumeric,
};

Comlink.expose(api);
