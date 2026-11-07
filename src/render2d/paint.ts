import { matchesFocus } from '../core/focus';
import type { BasinField, CompareMode, EquilibriumAnalysis, LayerVisibility, NumericAnalysis, StreamlineSegment, ThemeMode } from '../core/types';
import { PALETTE, basinColor } from '../core/palette';
import type { ViewRect } from './geometry';
import { finitePair, niceTicks, tangentAt, withAlpha, worldToScreen } from './geometry';
import type { SimParticle } from './particles';

export interface ArrowSample {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

export function drawBackground(ctx: CanvasRenderingContext2D, theme: ThemeMode, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = PALETTE[theme].bg;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function clipView(ctx: CanvasRenderingContext2D, view: ViewRect): void {
  ctx.beginPath();
  ctx.rect(view.left, view.top, view.width, view.height);
  ctx.clip();
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: ViewRect, theme: ThemeMode, piX: boolean, piY: boolean): void {
  const palette = PALETTE[theme];
  ctx.save();
  clipView(ctx, view);
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.grid;
  for (const tick of niceTicks(view.xMin, view.xMax, piX)) {
    const [sx] = worldToScreen(view, tick.value, 0);
    if (sx < view.left - 1 || sx > view.left + view.width + 1) continue;
    ctx.beginPath();
    ctx.moveTo(sx, view.top);
    ctx.lineTo(sx, view.top + view.height);
    ctx.stroke();
  }
  for (const tick of niceTicks(view.yMin, view.yMax, piY)) {
    const [, sy] = worldToScreen(view, 0, tick.value);
    if (sy < view.top - 1 || sy > view.top + view.height + 1) continue;
    ctx.beginPath();
    ctx.moveTo(view.left, sy);
    ctx.lineTo(view.left + view.width, sy);
    ctx.stroke();
  }
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1.25;
  if (view.yMin < 0 && view.yMax > 0) {
    const [, sy] = worldToScreen(view, 0, 0);
    ctx.beginPath();
    ctx.moveTo(view.left, sy);
    ctx.lineTo(view.left + view.width, sy);
    ctx.stroke();
  }
  if (view.xMin < 0 && view.xMax > 0) {
    const [sx] = worldToScreen(view, 0, 0);
    ctx.beginPath();
    ctx.moveTo(sx, view.top);
    ctx.lineTo(sx, view.top + view.height);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = palette.muted;
  ctx.font = '11px "Source Sans 3", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of niceTicks(view.xMin, view.xMax, piX)) {
    const [sx] = worldToScreen(view, tick.value, 0);
    if (sx < view.left + 10 || sx > view.left + view.width - 10) continue;
    ctx.fillText(tick.label, sx, view.top + view.height + 5);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  let lastLabelY = Number.NEGATIVE_INFINITY;
  for (const tick of niceTicks(view.yMin, view.yMax, piY)) {
    const [, sy] = worldToScreen(view, 0, tick.value);
    if (sy < view.top + 8 || sy > view.top + view.height - 8) continue;
    if (Math.abs(sy - lastLabelY) < 14) continue;
    lastLabelY = sy;
    ctx.fillText(tick.label, view.left - 8, sy);
  }
  ctx.restore();
}

export function blitWorldImage(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  image: CanvasImageSource,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  alpha: number,
): void {
  const [x0, y0] = worldToScreen(view, xMin, yMax);
  const [x1, y1] = worldToScreen(view, xMax, yMin);
  ctx.save();
  clipView(ctx, view);
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

export function rasterBasins(field: BasinField): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (field.nx < 2 || field.ny < 2) return null;
  const canvas = document.createElement('canvas');
  canvas.width = field.nx;
  canvas.height = field.ny;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(field.nx, field.ny);
  for (let iy = 0; iy < field.ny; iy += 1) {
    const sourceRow = field.ny - 1 - iy;
    for (let ix = 0; ix < field.nx; ix += 1) {
      const id = field.limitIds[sourceRow * field.nx + ix] ?? '';
      const pixel = (iy * field.nx + ix) * 4;
      if (!id) {
        image.data[pixel + 3] = 0;
        continue;
      }
      const hex = basinColor(id);
      image.data[pixel] = Number.parseInt(hex.slice(1, 3), 16);
      image.data[pixel + 1] = Number.parseInt(hex.slice(3, 5), 16);
      image.data[pixel + 2] = Number.parseInt(hex.slice(5, 7), 16);
      image.data[pixel + 3] = 148;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function rasterScalar(
  evaluate: (x: number, y: number) => number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  nx = 40,
  ny = 40,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const values: number[] = [];
  const grid: number[] = [];
  for (let iy = 0; iy < ny; iy += 1) {
    const y = yMax - ((yMax - yMin) * iy) / (ny - 1);
    for (let ix = 0; ix < nx; ix += 1) {
      const x = xMin + ((xMax - xMin) * ix) / (nx - 1);
      const value = evaluate(x, y);
      grid.push(value);
      if (Number.isFinite(value)) values.push(Math.abs(value));
    }
  }
  if (values.length < (nx * ny) / 5) return null;
  values.sort((a, b) => a - b);
  const maxAbs = Math.max(1e-6, values[Math.floor(values.length * 0.9)] ?? 1);
  const image = ctx.createImageData(nx, ny);
  for (let i = 0; i < grid.length; i += 1) {
    const value = grid[i] ?? 0;
    const t = Number.isFinite(value) ? Math.max(-1, Math.min(1, value / maxAbs)) : 0;
    const pixel = i * 4;
    if (t >= 0) {
      image.data[pixel] = 220;
      image.data[pixel + 1] = Math.round(80 + (1 - t) * 80);
      image.data[pixel + 2] = Math.round(90 + (1 - t) * 70);
    } else {
      image.data[pixel] = Math.round(40 + (1 + t) * 70);
      image.data[pixel + 1] = Math.round(120 + (1 + t) * 50);
      image.data[pixel + 2] = 210;
    }
    image.data[pixel + 3] = Number.isFinite(value) ? 110 : 0;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function strokeWorldPath(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  points: number[][],
  color: string,
  width: number,
  alpha: number,
  dashed = false,
): void {
  ctx.save();
  clipView(ctx, view);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  let started = false;
  for (const point of points) {
    if (!finitePair(point)) {
      started = false;
      continue;
    }
    const [sx, sy] = worldToScreen(view, point[0], point[1]);
    if (!started) {
      ctx.moveTo(sx, sy);
      started = true;
    } else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.restore();
}

export function strokeArrow(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  points: number[][],
  color: string,
  alpha: number,
): void {
  const marker = tangentAt(points, 0.62);
  if (!marker) return;
  const [sx, sy] = worldToScreen(view, marker.x, marker.y);
  const scaleX = view.width / Math.max(1e-9, view.xMax - view.xMin);
  const scaleY = view.height / Math.max(1e-9, view.yMax - view.yMin);
  const angle = Math.atan2(-Math.sin(marker.angle) * scaleY, Math.cos(marker.angle) * scaleX);
  ctx.save();
  clipView(ctx, view);
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, 4);
  ctx.lineTo(-5, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawVectorArrows(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  arrows: ArrowSample[],
  color: string,
): void {
  ctx.save();
  clipView(ctx, view);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.72;
  const scaleX = view.width / Math.max(1e-9, view.xMax - view.xMin);
  const scaleY = view.height / Math.max(1e-9, view.yMax - view.yMin);
  for (const arrow of arrows) {
    const mag = Math.hypot(arrow.fx, arrow.fy);
    if (!Number.isFinite(mag) || mag < 1e-9) continue;
    const dx = arrow.fx * scaleX;
    const dy = -arrow.fy * scaleY;
    const screenMag = Math.hypot(dx, dy);
    if (screenMag < 1e-6) continue;
    const ux = dx / screenMag;
    const uy = dy / screenMag;
    const length = 9 + 8 * Math.tanh(mag * Math.hypot(scaleX, scaleY) * 0.06);
    const [sx, sy] = worldToScreen(view, arrow.x, arrow.y);
    const tipX = sx + ux * length;
    const tipY = sy + uy * length;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tipX - ux * 5, tipY - uy * 5);
    ctx.stroke();
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-7, 2.7);
    ctx.lineTo(-7, -2.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  particles: SimParticle[],
  focusId: string | null,
): void {
  ctx.save();
  clipView(ctx, view);
  ctx.lineCap = 'round';
  for (const particle of particles) {
    const dim = focusId != null && !matchesFocus(particle.curveId, focusId);
    const head = particle.trail[particle.trail.length - 1];
    if (!head) continue;
    for (let i = 1; i < particle.trail.length; i += 1) {
      const a = particle.trail[i - 1];
      const b = particle.trail[i];
      if (!a || !b) continue;
      const [x0, y0] = worldToScreen(view, a[0], a[1]);
      const [x1, y1] = worldToScreen(view, b[0], b[1]);
      if (Math.hypot(x1 - x0, y1 - y0) > Math.max(view.width, view.height) * 0.35) continue;
      ctx.strokeStyle = withAlpha(particle.color, (dim ? 0.15 : 0.85) * (i / particle.trail.length));
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    const [hx, hy] = worldToScreen(view, head[0], head[1]);
    ctx.fillStyle = withAlpha(particle.color, dim ? 0.2 : 1);
    ctx.beginPath();
    ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawDroplet(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  ghost: number[][],
  deformed: number[][],
  color: string,
): void {
  ctx.save();
  clipView(ctx, view);
  const pathOf = (ring: number[][]) => {
    ctx.beginPath();
    ring.forEach((point, index) => {
      if (!finitePair(point)) return;
      const [sx, sy] = worldToScreen(view, point[0], point[1]);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
  };
  ctx.fillStyle = withAlpha(color, 0.16);
  pathOf(deformed);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.setLineDash([4, 4]);
  ctx.globalAlpha = 0.8;
  pathOf(ghost);
  ctx.stroke();
  ctx.restore();
}

export function drawDisk(
  ctx: CanvasRenderingContext2D,
  view: ViewRect,
  cx: number,
  cy: number,
  radius: number,
  fill: string,
  stroke: string,
): void {
  if (!(radius > 0)) return;
  const [sx, sy] = worldToScreen(view, cx, cy);
  const [ex] = worldToScreen(view, cx + radius, cy);
  const pixelRadius = Math.abs(ex - sx);
  ctx.save();
  clipView(ctx, view);
  ctx.beginPath();
  ctx.arc(sx, sy, pixelRadius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

export function curveAlpha(id: string, focusId: string | null, base: number): number {
  if (!focusId || matchesFocus(id, focusId)) return base;
  return Math.min(base, 0.2);
}

export function curveWidth(id: string, focusId: string | null, selectedId: string | null, base: number): number {
  if (matchesFocus(id, focusId)) return base + 1.8;
  if (selectedId === id) return base + 0.9;
  return base;
}

export interface PhaseFrame {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  theme: ThemeMode;
  view: ViewRect;
  linearView: ViewRect | null;
  analysis: NumericAnalysis;
  layers: LayerVisibility;
  focusId: string | null;
  selectedId: string | null;
  particles: SimParticle[];
  showParticles: boolean;
  userOrbits: StreamlineSegment[];
  linearOrbits: Array<{ id: string; points: number[][] }>;
  linearEquilibrium: EquilibriumAnalysis | null;
  compareMode: CompareMode;
  basinCanvas: HTMLCanvasElement | null;
  lyapunovCanvas: HTMLCanvasElement | null;
  hamiltonian: number[][][] | null;
  arrows: ArrowSample[] | null;
  linearArrows: ArrowSample[] | null;
  droplet: { ghost: number[][]; deformed: number[][] } | null;
}

export function paintPhaseFrame(frame: PhaseFrame): void {
  const { ctx, theme, analysis } = frame;
  const palette = PALETTE[theme];
  drawBackground(ctx, theme, frame.cssWidth, frame.cssHeight);
  const panes: Array<{ view: ViewRect; linear: boolean }> = frame.linearView
    ? [
        { view: frame.view, linear: false },
        { view: frame.linearView, linear: true },
      ]
    : [{ view: frame.view, linear: false }];

  for (const pane of panes) {
    const view = pane.view;
    drawGrid(ctx, view, theme, !!analysis.viewport.isPiScaledX, !!analysis.viewport.isPiScaledY);
    if (pane.linear) {
      if (frame.linearArrows && frame.layers.vectorField) drawVectorArrows(ctx, view, frame.linearArrows, palette.linearGhost);
      for (const orbit of frame.linearOrbits) {
        strokeWorldPath(ctx, view, orbit.points, palette.linearGhost, 1.3, 0.8, true);
      }
      if (frame.linearEquilibrium) {
        const radius = frame.linearEquilibrium.hartmanGrobmanRadius ?? 0;
        drawDisk(
          ctx,
          view,
          frame.linearEquilibrium.coords[0] ?? 0,
          frame.linearEquilibrium.coords[1] ?? 0,
          radius,
          palette.hgDisk,
          palette.linearGhost,
        );
      }
      ctx.save();
      ctx.fillStyle = palette.muted;
      ctx.font = '12px "Source Sans 3", "Segoe UI", sans-serif';
      ctx.fillText('linearization  ξ̇ = Jξ', view.left + 10, view.top + 18);
      ctx.restore();
      continue;
    }

    if (frame.layers.basins && frame.basinCanvas && analysis.basinField) {
      const field = analysis.basinField;
      blitWorldImage(ctx, view, frame.basinCanvas, field.xMin, field.xMax, field.yMin, field.yMax, 1);
    }
    if (frame.layers.lyapunov && frame.lyapunovCanvas) {
      blitWorldImage(ctx, view, frame.lyapunovCanvas, view.xMin, view.xMax, view.yMin, view.yMax, 1);
    }
    if (frame.layers.hamiltonianContours && frame.hamiltonian) {
      for (const path of frame.hamiltonian) {
        strokeWorldPath(
          ctx,
          view,
          path,
          palette.muted,
          curveWidth('hamiltonian', frame.focusId, frame.selectedId, 1),
          curveAlpha('hamiltonian', frame.focusId, 0.7),
          true,
        );
      }
    }
    if (frame.layers.vectorField && frame.arrows) drawVectorArrows(ctx, view, frame.arrows, palette.muted);
    if (frame.layers.streamlines) {
      for (const segment of analysis.streamlines) {
        if (segment.category === 'separatrix') continue;
        strokeWorldPath(
          ctx,
          view,
          segment.points,
          palette.streamline,
          curveWidth(segment.id, frame.focusId, frame.selectedId, segment.category === 'characteristic_orbit' ? 1.45 : 1.15),
          curveAlpha(segment.id, frame.focusId, 1),
        );
        strokeArrow(ctx, view, segment.points, palette.streamline, curveAlpha(segment.id, frame.focusId, 0.9));
      }
    }
    if (frame.layers.nullclines) {
      for (const nullcline of analysis.nullclines) {
        const color = nullcline.component === 0 ? palette.nullclineX : palette.nullclineY;
        for (const branch of nullcline.points) {
          strokeWorldPath(
            ctx,
            view,
            branch,
            color,
            curveWidth(nullcline.id, frame.focusId, frame.selectedId, 1.4),
            curveAlpha(nullcline.id, frame.focusId, 0.9),
            true,
          );
        }
      }
    }
    if (frame.layers.separatrices) {
      for (const segment of analysis.streamlines) {
        if (segment.category !== 'separatrix') continue;
        strokeWorldPath(
          ctx,
          view,
          segment.points,
          palette.separatrix,
          curveWidth(segment.id, frame.focusId, frame.selectedId, 2.1),
          curveAlpha(segment.id, frame.focusId, 0.95),
        );
        strokeArrow(ctx, view, segment.points, palette.separatrix, curveAlpha(segment.id, frame.focusId, 1));
      }
    }
    if (frame.layers.manifoldsWuWs || frame.layers.centerManifoldWc) {
      for (const manifold of analysis.manifolds) {
        const visible = manifold.kind === 'Wc' ? frame.layers.centerManifoldWc : frame.layers.manifoldsWuWs;
        if (!visible) continue;
        const color = manifold.kind === 'Ws' ? palette.ws : manifold.kind === 'Wu' ? palette.wu : palette.wc;
        strokeWorldPath(
          ctx,
          view,
          manifold.points,
          color,
          curveWidth(manifold.id, frame.focusId, frame.selectedId, 2.15),
          curveAlpha(manifold.id, frame.focusId, 0.95),
        );
      }
    }
    if (frame.layers.limitCycles) {
      for (const cycle of analysis.limitCycles) {
        strokeWorldPath(
          ctx,
          view,
          cycle.points,
          palette.cycle,
          curveWidth(cycle.id, frame.focusId, frame.selectedId, 2.2),
          curveAlpha(cycle.id, frame.focusId, 1),
          cycle.stability === 'unstable',
        );
      }
    }
    for (const orbit of frame.userOrbits) {
      strokeWorldPath(
        ctx,
        view,
        orbit.points,
        palette.droplet,
        curveWidth(orbit.id, frame.focusId, frame.selectedId, 2),
        curveAlpha(orbit.id, frame.focusId, 0.95),
      );
      strokeArrow(ctx, view, orbit.points, palette.droplet, curveAlpha(orbit.id, frame.focusId, 1));
    }
    if (frame.compareMode === 'overlay') {
      for (const orbit of frame.linearOrbits) {
        strokeWorldPath(ctx, view, orbit.points, palette.linearGhost, 1.25, 0.75, true);
      }
      if (frame.linearEquilibrium && (frame.linearEquilibrium.hartmanGrobmanRadius ?? 0) > 0) {
        drawDisk(
          ctx,
          view,
          frame.linearEquilibrium.coords[0] ?? 0,
          frame.linearEquilibrium.coords[1] ?? 0,
          frame.linearEquilibrium.hartmanGrobmanRadius ?? 0,
          palette.hgDisk,
          palette.linearGhost,
        );
      }
    }
    if (frame.showParticles && frame.layers.particles) drawParticles(ctx, view, frame.particles, frame.focusId);
    if (frame.droplet) drawDroplet(ctx, view, frame.droplet.ghost, frame.droplet.deformed, palette.droplet);
    ctx.save();
    ctx.fillStyle = palette.muted;
    ctx.font = '12px "Source Sans 3", "Segoe UI", sans-serif';
    ctx.fillText(frame.linearView ? 'nonlinear  ẋ = f(x)' : '', view.left + 10, view.top + 18);
    ctx.restore();
  }

  if (frame.linearView) {
    ctx.save();
    ctx.strokeStyle = palette.axis;
    ctx.globalAlpha = 0.35;
    const mid = (frame.view.left + frame.view.width + frame.linearView.left) / 2;
    ctx.beginPath();
    ctx.moveTo(mid, 8);
    ctx.lineTo(mid, frame.cssHeight - 8);
    ctx.stroke();
    ctx.restore();
  }
}
