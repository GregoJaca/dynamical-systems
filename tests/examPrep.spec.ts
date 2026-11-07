import { describe, expect, it } from 'vitest';
import { exampleToSpec, PERKO_EXAMPLES } from '../src/examples/perkoExamples';
import { analyzeNumeric } from '../src/numeric/analyze';

const EXAM_IDS = PERKO_EXAMPLES.filter((example) => example.id.startsWith('exam-')).map((example) => example.id);

describe('exam preparation examples', () => {
  it.each(EXAM_IDS)('%s analyzes and keeps the Lyapunov function when one is given', (id) => {
    const example = PERKO_EXAMPLES.find((item) => item.id === id);
    if (!example) throw new Error(id);
    const analysis = analyzeNumeric(exampleToSpec(example));
    expect(analysis.equilibria.length).toBeGreaterThan(0);
    if (!example.userLyapunovExpr) return;
    expect(analysis.global.lyapunov?.source).toBe('user');
    expect(['strict_lyapunov', 'weak_lyapunov_lasalle']).toContain(analysis.global.lyapunov?.classification);
  }, 60_000);
});
