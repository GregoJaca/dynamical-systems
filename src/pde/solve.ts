import { solveChar } from './char/solveChar';
import { solveHeat } from './heat/solveHeat';
import type { PdeProblem, PdeSolution } from './types';

export function solveProblem(problem: PdeProblem): PdeSolution {
  return problem.family === 'heat' ? solveHeat(problem) : solveChar(problem);
}
