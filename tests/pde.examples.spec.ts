import { describe, expect, it } from 'vitest';
import { PDE_EXAMPLES } from '../src/pde/examples/corpus';
import { compileMath, evalMath } from '../src/pde/expr';
import { parseProblem } from '../src/pde/parse';
import type { PdeProblem, PdeTag } from '../src/pde/types';

const ALLOWED_TAGS: readonly PdeTag[] = [
  'separation',
  'robin',
  'kernel',
  'images',
  'convection',
  'reaction',
  'steady',
  'symmetry',
  'nondimensional',
  'cole-hopf',
  'shock',
  'rarefaction',
  'characteristics',
  'eikonal',
  'maximum-principle',
  'disk',
  'rectangle',
  'source',
  'compatibility',
  'boundary-regions',
  'classification',
  'energy',
];

describe('PDE example corpus', () => {
  it('parses every example, with unique ids, unique lines, and legal tags', () => {
    const ids = new Set<string>();
    const signatures = new Set<string>();

    for (const example of PDE_EXAMPLES) {
      expect(ids.has(example.id), `duplicate id ${example.id}`).toBe(false);
      ids.add(example.id);

      const signature = JSON.stringify(example.lines);
      expect(signatures.has(signature), `duplicate lines on ${example.id}`).toBe(false);
      signatures.add(signature);

      for (const tag of example.tags) {
        expect(ALLOWED_TAGS, `${example.id} has unknown tag ${tag}`).toContain(tag);
      }

      try {
        parseProblem(example.lines);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${example.id} did not parse: ${message}`);
      }
    }
  });

  it('evaluates every closed form at one interior point', () => {
    for (const example of PDE_EXAMPLES) {
      if (!example.formula) continue;
      const problem = parseProblem(example.lines);
      const value = compileMath(example.formula)(interiorScope(problem));
      expect(Number.isFinite(value), `${example.id} gave ${value}`).toBe(true);
    }
  });
});

/** A point inside the domain. The second coordinate stays below 1/27 so the slope-cube formula is real. */
function interiorScope(problem: PdeProblem): Record<string, number> {
  const scope: Record<string, number> = { pi: Math.PI, e: Math.E, x: 0.7, y: 0.02, t: 0.2, r: 0.4 };
  for (const spec of Object.values(problem.parameters)) scope[spec.name] = spec.value;

  if (problem.family === 'heat') {
    const domain = problem.domain;
    if (domain.kind === 'interval') {
      const left = evalMath(domain.leftExpr, scope);
      const right = evalMath(domain.rightExpr, scope);
      scope.x = (left + right) / 2;
    } else if (domain.kind === 'rectangle') {
      scope.x = (evalMath(domain.x0, scope) + evalMath(domain.x1, scope)) / 2;
      scope.y = (evalMath(domain.y0, scope) + evalMath(domain.y1, scope)) / 2;
    } else if (domain.kind === 'disk') {
      scope.r = evalMath(domain.radiusExpr, scope) / 2;
      scope.x = scope.r;
    }
  }

  return scope;
}
