import type { LayerVisibility, NumericAnalysis, StreamlineSegment, ThemeMode, ViewportBounds } from '../core/types';
import { PALETTE, equilibriumColor } from '../core/palette';
import {
  clipInfiniteLine,
  finitePair,
  makeView,
  niceTicks,
  tangentAt,
  worldToScreen,
  xmlEscape,
  type ViewRect,
} from './geometry';

export interface PhaseSvgInput {
  analysis: NumericAnalysis;
  theme?: ThemeMode;
  width?: number;
  height?: number;
  layers?: Partial<LayerVisibility>;
  title?: string;
  userOrbits?: StreamlineSegment[];
}

const SVG_DEFAULTS: Pick<
  LayerVisibility,
  | 'streamlines'
  | 'separatrices'
  | 'manifoldsWuWs'
  | 'centerManifoldWc'
  | 'nullclines'
  | 'limitCycles'
  | 'linearSubspaces'
  | 'equilibria'
> = {
  streamlines: true,
  separatrices: true,
  manifoldsWuWs: true,
  centerManifoldWc: true,
  nullclines: true,
  limitCycles: true,
  linearSubspaces: true,
  equilibria: true,
};

/** Publication SVG of the curves, subspaces, equilibria, and ticks currently in the analysis. */
export function buildPhaseSvg(input: PhaseSvgInput): string {
  const theme = input.theme ?? 'dark';
  const palette = PALETTE[theme];
  const width = input.width ?? 960;
  const height = input.height ?? 640;
  const layers = { ...SVG_DEFAULTS, ...input.layers };
  const view = makeView(input.analysis.viewport, 28, 18, width - 40, height - 36);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${palette.bg}"/>`);
  if (input.title) {
    parts.push(
      `<text x="${width / 2}" y="16" text-anchor="middle" fill="${palette.text}" font-family="Source Sans 3, Segoe UI, sans-serif" font-size="14">${xmlEscape(input.title)}</text>`,
    );
  }
  parts.push(gridMarkup(view, input.analysis.viewport, palette.grid, palette.axis, palette.muted));
  if (layers.streamlines) {
    for (const segment of input.analysis.streamlines) {
      if (segment.category === 'separatrix') continue;
      parts.push(curveMarkup(view, segment.points, palette.streamline, segment.category === 'characteristic_orbit' ? 1.6 : 1.2, segment.id));
    }
  }
  if (layers.nullclines) {
    for (const nullcline of input.analysis.nullclines) {
      const color = nullcline.component === 0 ? palette.nullclineX : palette.nullclineY;
      for (const branch of nullcline.points) {
        parts.push(curveMarkup(view, branch, color, 1.4, nullcline.id, true));
      }
    }
  }
  if (layers.separatrices) {
    for (const segment of input.analysis.streamlines) {
      if (segment.category !== 'separatrix') continue;
      parts.push(curveMarkup(view, segment.points, palette.separatrix, 2.1, segment.id));
      parts.push(arrowMarkup(view, segment.points, palette.separatrix));
    }
  }
  if (layers.manifoldsWuWs || layers.centerManifoldWc) {
    for (const manifold of input.analysis.manifolds) {
      const visible = manifold.kind === 'Wc' ? layers.centerManifoldWc : layers.manifoldsWuWs;
      if (!visible) continue;
      const color = manifold.kind === 'Ws' ? palette.ws : manifold.kind === 'Wu' ? palette.wu : palette.wc;
      parts.push(curveMarkup(view, manifold.points, color, 2.1, manifold.id));
      parts.push(arrowMarkup(view, manifold.points, color));
    }
  }
  if (layers.limitCycles) {
    for (const cycle of input.analysis.limitCycles) {
      parts.push(curveMarkup(view, cycle.points, palette.cycle, 2.2, cycle.id, cycle.stability === 'unstable'));
    }
  }
  for (const orbit of input.userOrbits ?? []) {
    parts.push(curveMarkup(view, orbit.points, palette.droplet, 1.8, orbit.id));
    parts.push(arrowMarkup(view, orbit.points, palette.droplet));
  }
  if (layers.linearSubspaces) {
    for (const equilibrium of input.analysis.equilibria) {
      for (const subspace of equilibrium.subspaces) {
        const basis = subspace.basisVectors[0];
        if (!basis) continue;
        const clipped = clipInfiniteLine(view, equilibrium.coords, basis);
        if (!clipped) continue;
        const [x1, y1] = worldToScreen(view, clipped[0], clipped[1]);
        const [x2, y2] = worldToScreen(view, clipped[2], clipped[3]);
        const color = subspace.kind === 'Es' ? palette.es : subspace.kind === 'Eu' ? palette.eu : palette.ec;
        parts.push(
          `<line data-object-id="${xmlEscape(`${equilibrium.id}:${subspace.kind}`)}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="1.6" stroke-dasharray="7 5"/>`,
        );
      }
    }
  }
  if (layers.equilibria) {
    for (const equilibrium of input.analysis.equilibria) {
      if (!finitePair(equilibrium.coords)) continue;
      const [sx, sy] = worldToScreen(view, equilibrium.coords[0], equilibrium.coords[1]);
      const color = equilibriumColor(equilibrium.stability, equilibrium.classification2D ?? equilibrium.classification3D, theme);
      const label = (equilibrium.classification2D ?? equilibrium.stability).replaceAll('_', ' ');
      parts.push(
        `<g data-object-id="${xmlEscape(equilibrium.id)}" transform="translate(${sx.toFixed(2)} ${sy.toFixed(2)})">${glyph(equilibrium.classification2D, color)}<text x="10" y="-8" fill="${palette.text}" font-size="11" font-family="Source Sans 3, Segoe UI, sans-serif">${xmlEscape(label)}</text></g>`,
      );
    }
  }
  parts.push('</svg>');
  return parts.filter(Boolean).join('');
}

function gridMarkup(view: ViewRect, viewport: ViewportBounds, grid: string, axis: string, muted: string): string {
  const lines: string[] = [];
  for (const tick of niceTicks(view.xMin, view.xMax, !!viewport.isPiScaledX)) {
    const [sx] = worldToScreen(view, tick.value, 0);
    lines.push(
      `<line x1="${sx.toFixed(2)}" y1="${view.top.toFixed(2)}" x2="${sx.toFixed(2)}" y2="${(view.top + view.height).toFixed(2)}" stroke="${grid}" stroke-width="1"/>`,
    );
    lines.push(
      `<text x="${sx.toFixed(2)}" y="${(view.top + view.height + 14).toFixed(2)}" text-anchor="middle" fill="${muted}" font-size="11" font-family="Source Sans 3, Segoe UI, sans-serif">${xmlEscape(tick.label)}</text>`,
    );
  }
  for (const tick of niceTicks(view.yMin, view.yMax, !!viewport.isPiScaledY)) {
    const [, sy] = worldToScreen(view, 0, tick.value);
    lines.push(
      `<line x1="${view.left.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${(view.left + view.width).toFixed(2)}" y2="${sy.toFixed(2)}" stroke="${grid}" stroke-width="1"/>`,
    );
    lines.push(
      `<text x="${(view.left - 6).toFixed(2)}" y="${(sy + 4).toFixed(2)}" text-anchor="end" fill="${muted}" font-size="11" font-family="Source Sans 3, Segoe UI, sans-serif">${xmlEscape(tick.label)}</text>`,
    );
  }
  if (view.yMin < 0 && view.yMax > 0) {
    const [, sy] = worldToScreen(view, 0, 0);
    lines.push(
      `<line x1="${view.left.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${(view.left + view.width).toFixed(2)}" y2="${sy.toFixed(2)}" stroke="${axis}" stroke-width="1.2"/>`,
    );
  }
  if (view.xMin < 0 && view.xMax > 0) {
    const [sx] = worldToScreen(view, 0, 0);
    lines.push(
      `<line x1="${sx.toFixed(2)}" y1="${view.top.toFixed(2)}" x2="${sx.toFixed(2)}" y2="${(view.top + view.height).toFixed(2)}" stroke="${axis}" stroke-width="1.2"/>`,
    );
  }
  return lines.join('');
}

function curveMarkup(
  view: ViewRect,
  points: number[][],
  color: string,
  width: number,
  id: string,
  dashed = false,
): string {
  const d = pathData(view, points);
  if (!d) return '';
  const dash = dashed ? ' stroke-dasharray="6 5"' : '';
  return `<path data-object-id="${xmlEscape(id)}" d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
}

function pathData(view: ViewRect, points: number[][]): string {
  let data = '';
  let started = false;
  let previous: [number, number] | null = null;
  for (const point of points) {
    if (!finitePair(point)) {
      started = false;
      previous = null;
      continue;
    }
    const current = worldToScreen(view, point[0], point[1]);
    if (previous && Math.hypot(current[0] - previous[0], current[1] - previous[1]) > Math.max(view.width, view.height) * 0.45) {
      started = false;
    }
    data += started ? `L${current[0].toFixed(2)} ${current[1].toFixed(2)}` : `M${current[0].toFixed(2)} ${current[1].toFixed(2)}`;
    started = true;
    previous = current;
  }
  return data;
}

function arrowMarkup(view: ViewRect, points: number[][], color: string): string {
  const marker = tangentAt(points, 0.62);
  if (!marker) return '';
  const [sx, sy] = worldToScreen(view, marker.x, marker.y);
  const scaleX = view.width / Math.max(1e-9, view.xMax - view.xMin);
  const scaleY = view.height / Math.max(1e-9, view.yMax - view.yMin);
  const angle = Math.atan2(-Math.sin(marker.angle) * scaleY, Math.cos(marker.angle) * scaleX);
  const tip = [sx + 8 * Math.cos(angle), sy + 8 * Math.sin(angle)];
  const left = [sx + 6 * Math.cos(angle + 2.6), sy + 6 * Math.sin(angle + 2.6)];
  const right = [sx + 6 * Math.cos(angle - 2.6), sy + 6 * Math.sin(angle - 2.6)];
  return `<polygon points="${tip.map((value) => value.toFixed(2)).join(',')} ${left.map((value) => value.toFixed(2)).join(',')} ${right.map((value) => value.toFixed(2)).join(',')}" fill="${color}"/>`;
}

function glyph(classification: string | undefined, color: string): string {
  if (classification === 'saddle' || classification?.includes('saddle')) {
    return `<polygon points="0,-7 7,0 0,7 -7,0" fill="${color}" stroke="${color}"/>`;
  }
  if (classification === 'linear_center' || classification === 'nonlinear_center') {
    return `<circle r="6" fill="none" stroke="${color}" stroke-width="1.8"/><circle r="1.6" fill="${color}"/>`;
  }
  return `<circle r="5.5" fill="${color}"/>`;
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 2× supersampled PNG. Pass an SVG string from `buildPhaseSvg` or a live canvas. */
export function downloadPhasePng(source: HTMLCanvasElement | string, filename = 'phase-portrait.png'): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (typeof source === 'string') return rasterizeSvg(source, filename);
  const cssWidth = source.clientWidth || source.width;
  const cssHeight = source.clientHeight || source.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cssWidth * 2));
  canvas.height = Math.max(1, Math.round(cssHeight * 2));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToDownload(canvas, filename);
}

function rasterizeSvg(svg: string, filename: string): Promise<void> {
  const width = Number(svg.match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1] ?? 960);
  const height = Number(svg.match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1] ?? 640);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * 2));
      canvas.height = Math.max(1, Math.round(height * 2));
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      void canvasToDownload(canvas, filename).then(resolve);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    image.src = url;
  });
}

function canvasToDownload(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}
