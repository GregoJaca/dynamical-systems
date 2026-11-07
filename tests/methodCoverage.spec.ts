import { describe, expect, it } from 'vitest';
import { exampleToSpec, PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { analyzeNumeric } from '../src/numeric/analyze';

const SYMMETRIES = [
  'x_reflection',
  'y_reflection',
  'origin_inversion',
  'time_reversible_x',
  'time_reversible_y',
  'rotational_SO2',
  'periodic_translation',
];

describe('method coverage', () => {
  it('keeps every notes method alive on some example, and never claims Dulac against a cycle', () => {
    const hits: Record<string, string[]> = {};
    const mark = (key: string, id: string) => {
      (hits[key] ??= []).push(id);
    };
    const dulacAndCycle: string[] = [];
    for (const example of PERKO_EXAMPLES) {
      const analysis = analyzeNumeric(exampleToSpec(example));
      const id = example.id;
      for (const symmetry of analysis.global.symmetries) mark(`symmetry:${symmetry.type}`, id);
      if (analysis.global.bendixsonDulac?.applies) mark('dulac', id);
      if (analysis.global.bendixsonDulac?.applies && analysis.limitCycles.length > 0) dulacAndCycle.push(id);
      if (analysis.global.isHamiltonian) mark('hamiltonian', id);
      if (analysis.global.isGradientSystem) mark('gradient', id);
      if (analysis.global.lyapunov?.classification === 'strict_lyapunov') mark('lyapunov-strict', id);
      if (analysis.global.linearSystemExact) mark('matrix-exponential', id);
      if (analysis.coordinateTransforms.polar2D?.isRecommended) mark('polar', id);
      if (analysis.coordinateTransforms.cylindrical3D?.isRecommended) mark('cylindrical', id);
      if (analysis.coordinateTransforms.spherical3D?.isRecommended) mark('spherical', id);
    }
    const lines = Object.keys(hits)
      .sort()
      .map((key) => `${key} (${hits[key]?.length}): ${hits[key]?.join(', ')}`);
    console.log(lines.join('\n'));
    for (const type of SYMMETRIES) expect(hits[`symmetry:${type}`]?.length ?? 0, type).toBeGreaterThan(0);
    for (const method of ['dulac', 'hamiltonian', 'gradient', 'lyapunov-strict', 'matrix-exponential', 'polar', 'cylindrical', 'spherical']) {
      expect(hits[method]?.length ?? 0, method).toBeGreaterThan(0);
    }
    expect(dulacAndCycle).toEqual([]);
    expect(hits.spherical).toContain('radial-sink-3d');
    expect(hits['matrix-exponential']).not.toContain('exam-2');
  }, 180_000);
});
