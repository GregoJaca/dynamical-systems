import type { ThemeMode } from './types';

export interface ThemePalette {
  bg: string;
  grid: string;
  axis: string;
  text: string;
  muted: string;
  streamline: string;
  separatrix: string;
  ws: string;
  wu: string;
  wc: string;
  es: string;
  eu: string;
  ec: string;
  equilibrium: string;
  saddle: string;
  stableEq: string;
  unstableEq: string;
  centerEq: string;
  cycle: string;
  nullclineX: string;
  nullclineY: string;
  linearGhost: string;
  hgDisk: string;
  droplet: string;
}

export const PALETTE: Record<ThemeMode, ThemePalette> = {
  dark: {
    bg: '#0B0F17',
    grid: 'rgba(232,238,247,0.055)',
    axis: 'rgba(232,238,247,0.55)',
    text: '#E8EEF7',
    muted: '#93A1B5',
    streamline: 'rgba(125,211,252,0.42)',
    separatrix: '#F59E0B',
    ws: '#38BDF8',
    wu: '#FB7185',
    wc: '#C4B5FD',
    es: '#7DD3FC',
    eu: '#FDA4AF',
    ec: '#DDD6FE',
    equilibrium: '#F8FAFC',
    saddle: '#F59E0B',
    stableEq: '#38BDF8',
    unstableEq: '#FB7185',
    centerEq: '#C4B5FD',
    cycle: '#FBBF24',
    nullclineX: '#34D399',
    nullclineY: '#A78BFA',
    linearGhost: 'rgba(103,232,249,0.75)',
    hgDisk: 'rgba(103,232,249,0.13)',
    droplet: 'rgba(240,180,41,0.85)',
  },
  light: {
    bg: '#F7F3EA',
    grid: 'rgba(28,25,21,0.06)',
    axis: 'rgba(28,25,21,0.55)',
    text: '#1C1915',
    muted: '#6B6258',
    streamline: 'rgba(3,105,161,0.35)',
    separatrix: '#C2410C',
    ws: '#0369A1',
    wu: '#BE123C',
    wc: '#6D28D9',
    es: '#0284C7',
    eu: '#E11D48',
    ec: '#7C3AED',
    equilibrium: '#1C1915',
    saddle: '#C2410C',
    stableEq: '#0369A1',
    unstableEq: '#BE123C',
    centerEq: '#6D28D9',
    cycle: '#A16207',
    nullclineX: '#047857',
    nullclineY: '#6D28D9',
    linearGhost: 'rgba(14,116,144,0.8)',
    hgDisk: 'rgba(14,116,144,0.1)',
    droplet: 'rgba(180,83,9,0.9)',
  },
};

/** Okabe–Ito, colorblind-safe basin colors. */
export const BASIN_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#D55E00',
  '#CC79A7',
  '#56B4E9',
  '#F0E442',
  '#999999',
] as const;

export function basinColor(limitId: string): string {
  let hash = 0;
  for (let i = 0; i < limitId.length; i += 1) {
    hash = (hash * 31 + limitId.charCodeAt(i)) >>> 0;
  }
  return BASIN_COLORS[hash % BASIN_COLORS.length] ?? BASIN_COLORS[0];
}

export function equilibriumColor(stability: string, classification: string | undefined, theme: ThemeMode): string {
  const palette = PALETTE[theme];
  if (classification === 'saddle' || classification?.includes('saddle')) return palette.saddle;
  if (stability === 'asymptotically_stable' || stability === 'lyapunov_stable') return palette.stableEq;
  if (stability === 'unstable') return palette.unstableEq;
  return palette.centerEq;
}
