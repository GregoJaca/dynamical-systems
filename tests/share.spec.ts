import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeShareState, encodeShareState } from '../src/share/urlState';
import { defaultLayers } from '../src/core/layers';
import type { ShareSnapshot } from '../src/core/types';

const snapshot: ShareSnapshot = {
  v: 1,
  mode: 'autonomous',
  dimension: 2,
  stateVars: ['x', 'y'],
  rows: ['mu * x - y - x * (x^2 + y^2)', 'x + mu * y - y * (x^2 + y^2)'],
  parameters: { mu: { value: 0.35, min: -1, max: 2, step: 0.01 } },
  viewport: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
  viewportLocked: true,
  layers: { ...defaultLayers(), polarSplit: true, basins: true },
  theme: 'light',
  particleMode: 'uniformSpeed',
  particlesPlaying: false,
  inspectorTab: 'coordinates',
  selectedEquilibriumId: 'E0',
  compareMode: 'overlay',
  exampleId: 'hopf',
};

describe('stateless sharing', () => {
  it('round-trips the portrait through the URL hash', () => {
    const hash = encodeShareState(snapshot);
    expect(hash.startsWith('#s=')).toBe(true);
    const decoded = decodeShareState(hash);
    expect(decoded).toEqual(snapshot);
  });

  it('never persists to browser storage', () => {
    const sources = [
      'src/share/urlState.ts',
      'src/store/useSystemStore.ts',
      'src/ui/AppShell.tsx',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });
});
