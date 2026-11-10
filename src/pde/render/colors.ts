import type { PdeObject } from '../types';

/** Viridis stops in sRGB. Interpolated; the ramp stays readable for the common colour-vision deficiencies. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [68, 1, 84]],
  [0.11, [72, 40, 120]],
  [0.22, [62, 73, 137]],
  [0.33, [49, 104, 142]],
  [0.44, [38, 130, 142]],
  [0.55, [31, 158, 137]],
  [0.66, [53, 183, 121]],
  [0.77, [110, 206, 88]],
  [0.88, [181, 222, 43]],
  [1, [253, 231, 37]],
];

export function viridis(t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, t));
  let index = 0;
  while (index < STOPS.length - 2 && STOPS[index + 1]![0] < u) index += 1;
  const left = STOPS[index]!;
  const right = STOPS[index + 1]!;
  const span = right[0] - left[0] || 1;
  const mix = (u - left[0]) / span;
  return [
    Math.round(left[1][0] + (right[1][0] - left[1][0]) * mix),
    Math.round(left[1][1] + (right[1][1] - left[1][1]) * mix),
    Math.round(left[1][2] + (right[1][2] - left[1][2]) * mix),
  ];
}

export function viridisCss(t: number): string {
  const [red, green, blue] = viridis(t);
  return `rgb(${red}, ${green}, ${blue})`;
}

const LIGHT: Record<PdeObject['group'], string> = {
  field: '#21918c',
  mode: '#3b528b',
  boundary: '#1c1917',
  characteristic: '#1f3a5f',
  shock: '#c2410c',
  steady: '#047857',
  kernel: '#6d28d9',
  region: '#0f766e',
  ray: '#a16207',
  envelope: '#7c3aed',
};

const DARK: Record<PdeObject['group'], string> = {
  field: '#5ec962',
  mode: '#9ecae1',
  boundary: '#f3f1ec',
  characteristic: '#d7c4a3',
  shock: '#fb7185',
  steady: '#6ee7b7',
  kernel: '#c4b5fd',
  region: '#5eead4',
  ray: '#fde68a',
  envelope: '#ddd6fe',
};

export function groupColor(group: PdeObject['group'], theme: 'light' | 'dark'): string {
  return (theme === 'dark' ? DARK : LIGHT)[group];
}

export function emphasis(
  id: string,
  selectedId: string | null,
  hoverId: string | null,
  hidden: readonly string[],
): { draw: boolean; alpha: number; scale: number } {
  if (hidden.includes(id)) return { draw: false, alpha: 0, scale: 1 };
  const hot = hoverId === id;
  const picked = selectedId === id;
  if (hoverId && !hot) return { draw: true, alpha: 0.18, scale: picked ? 1.2 : 1 };
  return { draw: true, alpha: 1, scale: picked || hot ? 1.8 : 1 };
}
