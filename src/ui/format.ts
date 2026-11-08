import type { ComplexEigenvalue } from '../core/types';
import { latexNumber } from '../numeric/algebra';

export function rationalLabel(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return latexNumber(value).replace(/\\sqrt\{([^{}]+)\}/g, '√$1').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
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
  if (imaginary === 0) return latexNumber(lambda.re);
  const imAbs = latexNumber(Math.abs(imaginary));
  const imag = imAbs === '1' ? 'i' : `${imAbs} i`;
  if (Math.abs(lambda.re) < 1e-10) return imaginary < 0 ? `-${imag}` : imag;
  return `${latexNumber(lambda.re)} ${imaginary < 0 ? '-' : '+'} ${imag}`;
}

export function vectorLatex(vector: number[]): string {
  return `\\begin{pmatrix} ${vector.map((entry) => latexNumber(entry)).join(' \\\\ ')} \\end{pmatrix}`;
}

export function matrixLatex(matrix: number[][]): string {
  const body = matrix.map((row) => row.map((entry) => latexNumber(entry)).join(' & ')).join(' \\\\ ');
  return `\\begin{pmatrix} ${body} \\end{pmatrix}`;
}

export function coordList(values: number[], exact?: string[]): string {
  const parts = values.map((value, index) => exact?.[index] || rationalLabel(value));
  return `(${parts.join(', ')})`;
}
