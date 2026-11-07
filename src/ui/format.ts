import type { ComplexEigenvalue } from '../core/types';

export function rationalLabel(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (Math.abs(abs - Math.round(abs)) < 1e-8) return `${sign}${Math.round(abs).toString()}`;
  for (let denominator = 1; denominator <= 16; denominator += 1) {
    const numerator = Math.round(abs * denominator);
    if (Math.abs(abs - numerator / denominator) < 1e-6) {
      return denominator === 1 ? `${sign}${numerator.toString()}` : `${sign}${numerator.toString()}/${denominator.toString()}`;
    }
  }
  return `${sign}${Number(abs.toPrecision(4)).toString()}`;
}

export function parseUserNumber(text: string): number | null {
  const trimmed = text.trim();
  const fraction = /^(-?\d+)\s*\/\s*(\d+)$/.exec(trimmed);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (!denominator) return null;
    return Number(fraction[1]) / denominator;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function prettyLabel(value: string | undefined): string {
  if (!value) return 'Unclassified';
  return value.replace(/_/g, ' ');
}

export function complexLatex(lambda: Pick<ComplexEigenvalue, 're' | 'im' | 'exactLatex'>): string {
  if (lambda.exactLatex) return lambda.exactLatex;
  const imaginary = Math.abs(lambda.im) < 1e-10 ? 0 : lambda.im;
  if (imaginary === 0) return rationalLabel(lambda.re);
  const imAbs = rationalLabel(Math.abs(imaginary));
  if (Math.abs(lambda.re) < 1e-10) return imaginary < 0 ? `-${imAbs} i` : `${imAbs} i`;
  return `${rationalLabel(lambda.re)} ${imaginary < 0 ? '-' : '+'} ${imAbs} i`;
}

export function vectorLatex(vector: number[]): string {
  return `\\begin{pmatrix} ${vector.map((entry) => rationalLabel(entry)).join(' \\\\ ')} \\end{pmatrix}`;
}

export function matrixLatex(matrix: number[][]): string {
  const body = matrix.map((row) => row.map((entry) => rationalLabel(entry)).join(' & ')).join(' \\\\ ');
  return `\\begin{pmatrix} ${body} \\end{pmatrix}`;
}

export function coordList(values: number[], exact?: string[]): string {
  const parts = values.map((value, index) => exact?.[index] || rationalLabel(value));
  return `(${parts.join(', ')})`;
}
