import { solveChar } from './char/solveChar';
import { solveClass } from './classify/solveClass';
import { solveHeat } from './heat/solveHeat';
import type { PdeProblem, PdeSolution } from './types';

export function solveProblem(problem: PdeProblem): PdeSolution {
  if (problem.family === 'heat') return solveHeat(problem);
  if (problem.family === 'classify') return solveClass(problem);
  return solveChar(problem);
}
