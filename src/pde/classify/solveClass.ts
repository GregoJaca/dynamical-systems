/**
 * Constant-coefficient second-order equations in two variables.
 * The type is the sign of B² − 4AC. Canonical coordinates are the real
 * characteristic slopes when they exist.
 */

import { evalMath } from '../expr';
import type { ClassProblem, ClassSolution, FieldFrame, PdeObject } from '../types';

export function solveClass(problem: ClassProblem): ClassSolution {
  const params: Record<string, number> = { pi: Math.PI, e: Math.E };
  for (const [name, spec] of Object.entries(problem.parameters)) params[name] = spec.value;
  const A = evalMath(problem.aExpr, params);
  const B = evalMath(problem.bExpr, params);
  const C = evalMath(problem.cExpr, params);
  const delta = B * B - 4 * A * C;
  const type = delta > 1e-8 ? 'hyperbolic' : delta < -1e-8 ? 'elliptic' : 'parabolic';
  const lower = problem.lowerOrder;
  const algebra = algebraNotes(A, B, C, delta, type, lower);
  const families = familiesFor(A, B, C, delta, type);
  const canonical = canonicalLatex(type, A, B, delta);
  const general = generalLatex(type, A, B, delta, lower);
  const frame: FieldFrame = {
    id: 'original',
    name: 'plane',
    formulaLatex: general,
    xName: 'x',
    tName: 'y',
    yName: 'y',
    xMin: -3,
    xMax: 3,
    tMin: -3,
    tMax: 3,
    yMin: -3,
    yMax: 3,
    unbounded: true,
    evaluate: () => 0,
  };
  const objects: PdeObject[] = [
    { id: 'type', label: 'Type', formulaLatex: `${type},\\ \\Delta=${trim(delta)}`, group: 'region', defaultOn: true },
    ...families.map((family) => ({
      id: family.id,
      label: family.label,
      formulaLatex: family.formulaLatex,
      group: 'characteristic' as const,
      defaultOn: true,
    })),
    { id: 'canonical', label: 'Canonical equation', formulaLatex: canonical, group: 'field', defaultOn: true },
    { id: 'general', label: 'General solution', formulaLatex: general, group: 'field', defaultOn: true },
  ];
  return {
    family: 'classify',
    exact: !lower,
    formulaLatex: general,
    generalLatex: general,
    canonicalLatex: canonical,
    type,
    delta,
    deltaLatex: `B^2-4AC=${trim(B)}^2-4(${trim(A)})(${trim(C)})=${trim(delta)}`,
    families,
    frames: [frame],
    objects,
    notes: algebra,
    workedLatex: algebra.map((note) => `${note.title}. ${note.latex}`).join(' '),
    features: ['classification'],
    warnings: lower ? ['Lower-order terms are present, so f+g is not yet the full general solution.'] : [],
    a: A,
    b: B,
    c: C,
  };
}

function algebraNotes(A: number, B: number, C: number, delta: number, type: ClassSolution['type'], lower: boolean) {
  const quadratic = `A m^2 - B m + C = ${trim(A)} m^2 - ${trim(B)} m + ${trim(C)}`;
  const steps = [
    {
      id: 'principal',
      title: 'Principal part',
      latex: `A=${trim(A)},\\ B=${trim(B)},\\ C=${trim(C)}.\\ \\text{The type ignores first-order terms.}`,
    },
    {
      id: 'discriminant',
      title: 'Discriminant',
      latex: `\\Delta=B^2-4AC=${trim(delta)}.`,
    },
    {
      id: 'type',
      title: 'Type',
      latex:
        type === 'hyperbolic'
          ? '\\Delta>0,\\ \\text{so the equation is hyperbolic.}'
          : type === 'elliptic'
            ? '\\Delta<0,\\ \\text{so the equation is elliptic.}'
            : '\\Delta=0,\\ \\text{so the equation is parabolic.}',
    },
    {
      id: 'slopes',
      title: 'Characteristic slopes',
      latex: `${quadratic}=0.\\ \\text{The slopes are}\\ dy/dx.`,
    },
  ];
  if (type === 'hyperbolic') {
    const [m1, m2] = slopes(A, B, delta);
    steps.push({
      id: 'cancel',
      title: 'Why these slopes clear the second derivatives',
      latex: `A m_i^2-B m_i+C=0\\ \\text{at}\\ m_1=${trim(m1)},\\ m_2=${trim(m2)}.\\ \\text{A function of}\\ y-m_i x\\ \\text{then contributes nothing to}\\ A u_{xx}+B u_{xy}+C u_{yy}.`,
    });
  }
  if (type === 'elliptic') {
    const alpha = Math.abs(A) < 1e-12 ? 0 : B / (2 * A);
    const beta = Math.abs(A) < 1e-12 ? 0 : Math.sqrt(Math.max(0, -delta)) / (2 * Math.abs(A));
    steps.push({
      id: 'complex',
      title: 'Complex slopes, real coordinates',
      latex: `m=${trim(alpha)}\\pm i\\,${trim(beta)}.\\ \\text{The real coordinates are}\\ \\xi=y-${trim(alpha)}x,\\ \\eta=${trim(beta)}x.`,
    });
  }
  steps.push({
    id: 'canonical',
    title: 'Canonical equation',
    latex: canonicalLatex(type, A, B, delta),
  });
  steps.push({
    id: 'general',
    title: 'General solution',
    latex: generalLatex(type, A, B, delta, lower),
  });
  return steps;
}

function familiesFor(A: number, B: number, C: number, delta: number, type: ClassSolution['type']): ClassSolution['families'] {
  if (type === 'elliptic') {
    const alpha = Math.abs(A) < 1e-12 ? 0 : B / (2 * A);
    const beta = Math.abs(A) < 1e-12 ? 1 : Math.sqrt(Math.max(0, -delta)) / (2 * Math.abs(A));
    return [
      { id: 'xi', label: 'ξ = constant', formulaLatex: `\\xi=y-${trim(alpha)}x`, slope: alpha },
      { id: 'eta', label: 'η = constant', formulaLatex: `\\eta=${trim(beta)}x`, slope: null },
    ];
  }
  if (Math.abs(A) < 1e-10) {
    const slope = Math.abs(B) < 1e-10 ? null : C / B;
    return [
      { id: 'family-1', label: 'First family', formulaLatex: 'x=\\mathrm{const}', slope: null },
      { id: 'family-2', label: 'Second family', formulaLatex: slope === null ? 'degenerate' : `y-${trim(slope)}x=\\mathrm{const}`, slope },
    ];
  }
  if (type === 'parabolic') {
    const m = B / (2 * A);
    return [
      { id: 'family', label: 'Repeated family', formulaLatex: `y-${trim(m)}x=\\mathrm{const}`, slope: m },
      { id: 'transverse', label: 'Transverse coordinate', formulaLatex: 'x=\\mathrm{const}', slope: null },
    ];
  }
  const [m1, m2] = slopes(A, B, delta);
  return [
    { id: 'family-1', label: 'First family', formulaLatex: `y-${trim(m1)}x=\\mathrm{const}`, slope: m1 },
    { id: 'family-2', label: 'Second family', formulaLatex: `y-${trim(m2)}x=\\mathrm{const}`, slope: m2 },
  ];
}

function slopes(A: number, B: number, delta: number): [number, number] {
  if (Math.abs(A) < 1e-10) return [0, 0];
  const root = Math.sqrt(Math.max(0, delta));
  return [(B + root) / (2 * A), (B - root) / (2 * A)];
}

function canonicalLatex(type: ClassSolution['type'], A: number, B: number, delta: number): string {
  if (type === 'hyperbolic') return 'u_{\\xi\\eta}=0';
  if (type === 'parabolic') return 'u_{\\eta\\eta}=0';
  const alpha = Math.abs(A) < 1e-12 ? 0 : B / (2 * A);
  const beta = Math.abs(A) < 1e-12 ? 0 : Math.sqrt(Math.max(0, -delta)) / (2 * Math.abs(A));
  return `u_{\\xi\\xi}+u_{\\eta\\eta}=0,\\quad \\xi=y-${trim(alpha)}x,\\ \\eta=${trim(beta)}x`;
}

function generalLatex(type: ClassSolution['type'], A: number, B: number, delta: number, lower: boolean): string {
  if (lower) return '\\text{type only: lower-order terms still have to be transformed}';
  if (type === 'elliptic') return canonicalLatex(type, A, B, delta);
  if (type === 'parabolic') {
    const m = Math.abs(A) < 1e-10 ? 0 : B / (2 * A);
    return `u=f(y-${trim(m)}x)+x\\,g(y-${trim(m)}x)`;
  }
  const [m1, m2] = slopes(A, B, delta);
  return `u=f(y-${trim(m1)}x)+g(y-${trim(m2)}x)`;
}

function trim(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}
