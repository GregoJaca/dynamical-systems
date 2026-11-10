/**
 * The heat kernel on the line, and its convolution against an initial trace.
 * Odd and even options are the extensions through 0. An interval uses images.
 */

import { simpson } from './quadrature';

export interface KernelOptions {
  odd?: boolean;
  even?: boolean;
  left?: number;
  right?: number;
  images?: number;
}

export function heatKernelValue(k: number, x: number, t: number): number {
  if (!(t > 0) || !(k > 0)) return 0;
  const width = 4 * k * t;
  return Math.exp(-(x * x) / width) / Math.sqrt(Math.PI * width);
}

export function heatKernelConvolution(
  g: (y: number) => number,
  k: number,
  x: number,
  t: number,
  options?: KernelOptions,
): number {
  if (!(t > 0) || !(k > 0)) return extendedInitial(g, x, options);
  const left = options?.left;
  const right = options?.right;
  if (left !== undefined && right !== undefined && right > left) {
    return integrateImages(g, k, x, t, left, right, options ?? {});
  }
  const radius = Math.max(8 * Math.sqrt(4 * k * t), 1e-4);
  if (options?.odd || options?.even) {
    const far = Math.max(x, 0) + radius + 4;
    const sign = options.odd ? -1 : 1;
    return simpson((y) => {
      const direct = heatKernelValue(k, x - y, t);
      const image = heatKernelValue(k, x + y, t);
      return (direct + sign * image) * g(y);
    }, 0, far);
  }
  return simpson((y) => heatKernelValue(k, x - y, t) * g(y), x - radius, x + radius);
}

export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

function extendedInitial(g: (y: number) => number, x: number, options?: KernelOptions): number {
  if (options?.odd) return x > 0 ? g(x) : x < 0 ? -g(-x) : 0;
  if (options?.even) return x >= 0 ? g(x) : g(-x);
  const left = options?.left;
  const right = options?.right;
  if (left !== undefined && right !== undefined && (x < left || x > right)) return 0;
  return g(x);
}

function integrateImages(
  g: (y: number) => number,
  k: number,
  x: number,
  t: number,
  left: number,
  right: number,
  options: KernelOptions,
): number {
  const images = options.images ?? 6;
  const length = right - left;
  const odd = options.odd !== false && !options.even;
  const sign = odd ? -1 : 1;
  return simpson((y) => imageKernel(k, x, y, t, left, length, images, sign) * g(y), left, right);
}

function imageKernel(
  k: number,
  x: number,
  y: number,
  t: number,
  left: number,
  length: number,
  images: number,
  reflectionSign: number,
): number {
  const X = x - left;
  const Y = y - left;
  let sum = 0;
  for (let m = -images; m <= images; m += 1) {
    const shift = 2 * m * length;
    sum += heatKernelValue(k, X - Y - shift, t);
    sum += reflectionSign * heatKernelValue(k, X + Y - shift, t);
  }
  return sum;
}
