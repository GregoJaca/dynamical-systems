import { describe, expect, it } from 'vitest';
import { PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { cyclesFromPolar } from '../src/numeric/globalAnalysis';
import { findIsolatedCycles } from '../src/numeric/isolatedCycles';
import { light } from './light';

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
      const study = light(example.id);
      const id = example.id;
      const global = study.bundle.global;
      for (const symmetry of global.symmetries) mark(`symmetry:${symmetry.type}`, id);
      if (global.bendixsonDulac?.applies) mark('dulac', id);
      const polarCycles = study.bundle.polar ? cyclesFromPolar(study.bundle.polar) : [];
      const isolated = global.bendixsonDulac?.applies ? findIsolatedCycles(study.compiled, study.equilibria, study.viewport) : [];
      if (global.bendixsonDulac?.applies && (polarCycles.length > 0 || isolated.length > 0)) dulacAndCycle.push(id);
      if (global.isHamiltonian) mark('hamiltonian', id);
      if (global.isGradientSystem) mark('gradient', id);
      if (global.lyapunov?.classification === 'strict_lyapunov') mark('lyapunov-strict', id);
      if (global.linearSystemExact) mark('matrix-exponential', id);
      if (study.bundle.polar?.isRecommended) mark('polar', id);
      if (study.bundle.cylindrical?.isRecommended) mark('cylindrical', id);
      if (study.bundle.spherical?.isRecommended) mark('spherical', id);
    }
    for (const type of SYMMETRIES) expect(hits[`symmetry:${type}`]?.length ?? 0, type).toBeGreaterThan(0);
    for (const method of ['dulac', 'hamiltonian', 'gradient', 'lyapunov-strict', 'matrix-exponential', 'polar', 'cylindrical', 'spherical']) {
      expect(hits[method]?.length ?? 0, method).toBeGreaterThan(0);
    }
    expect(dulacAndCycle).toEqual([]);
    expect(hits.spherical).toContain('radial-sink-3d');
    expect(hits['matrix-exponential']).not.toContain('exam-2');
  });
});
