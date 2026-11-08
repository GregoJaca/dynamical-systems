import { describe, expect, it } from 'vitest';
import { PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { light } from './light';

const EXAM_IDS = PERKO_EXAMPLES.filter((example) => example.id.startsWith('exam-')).map((example) => example.id);

describe('exam preparation examples', () => {
  it.each(EXAM_IDS)('%s analyzes and keeps the Lyapunov function when one is given', (id) => {
    const example = PERKO_EXAMPLES.find((item) => item.id === id);
    if (!example) throw new Error(id);
    const study = light(id);
    expect(study.equilibria.length).toBeGreaterThan(0);
    if (!example.userLyapunovExpr) return;
    expect(study.bundle.global.lyapunov?.source).toBe('user');
    expect(['strict_lyapunov', 'weak_lyapunov_lasalle']).toContain(study.bundle.global.lyapunov?.classification);
  });
});
