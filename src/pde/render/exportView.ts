import type { CharSolution, FieldFrame, HeatSolution, ModeTerm, PdeObject } from '../types';
import { activeFrame, usePdeStore } from '../store';
import { groupColor } from './colors';

export function sampleFrame(frame: FieldFrame, x: number, t: number, y?: number): number {
  try {
    const value = y == null ? frame.evaluate(x, t) : frame.evaluate(x, t, y);
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function sampleMode(mode: ModeTerm, x: number, t: number, y?: number): number {
  try {
    const value = mode.value(x, t, y);
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function samplePhi(mode: ModeTerm, x: number, y?: number): number {
  try {
    const value = mode.phi(x, y);
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function modeId(solution: HeatSolution, mode: ModeTerm, index: number): string {
  if (solution.objects.some((object) => object.id === mode.id)) return mode.id;
  const grouped = solution.objects.filter((object) => object.group === 'mode');
  return grouped[index]?.id ?? mode.id;
}

export function visibleModes(solution: HeatSolution, hidden: readonly string[]): ModeTerm[] {
  return solution.modes.filter((mode, index) => !hidden.includes(modeId(solution, mode, index)) && !hidden.includes(mode.id));
}

export interface ProfileSeries {
  xs: number[];
  u: number[];
  partial: number[] | null;
  selected: number[] | null;
}

export function profileSeries(solution: HeatSolution, frame: FieldFrame, t0: number, partialN: number, hidden: readonly string[], selectedId: string | null): ProfileSeries {
  const count = 240;
  const y = midY(frame);
  const xs: number[] = [];
  const u: number[] = [];
  const modes = visibleModes(solution, hidden).slice(0, Math.max(0, partialN));
  const selected =
    solution.modes.find((mode, index) => {
      const id = modeId(solution, mode, index);
      return (id === selectedId || mode.id === selectedId) && !hidden.includes(id) && !hidden.includes(mode.id);
    }) ?? null;
  const partial: number[] | null = modes.length > 0 ? [] : null;
  const selectedValues: number[] | null = selected ? [] : null;
  const span = frame.xMax - frame.xMin || 1;
  for (let index = 0; index < count; index += 1) {
    const x = frame.xMin + (span * index) / (count - 1);
    xs.push(x);
    u.push(sampleFrame(frame, x, t0, y));
    if (partial) {
      let sum = 0;
      for (const mode of modes) sum += sampleMode(mode, x, t0, y);
      partial.push(sum);
    }
    if (selected && selectedValues) selectedValues.push(sampleMode(selected, x, t0, y));
  }
  return { xs, u, partial, selected: selectedValues };
}

export function midY(frame: FieldFrame): number | undefined {
  if (frame.yMin == null || frame.yMax == null) return undefined;
  return (frame.yMin + frame.yMax) / 2;
}

export interface CurveLayer {
  id: string;
  latex: string;
  points: Array<[number, number]>;
  values?: number[];
  kind: 'curve' | 'data' | 'shock' | 'envelope' | 'ray' | 'wavefront';
}

export interface RegionLayer {
  id: string;
  latex: string;
  polygon: Array<[number, number]>;
  rarefaction: boolean;
}

export interface CharGraphics {
  curves: CurveLayer[];
  regions: RegionLayer[];
}

function pairs(points: number[][]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const point of points) {
    const x = point[0];
    const t = point[1];
    if (typeof x === 'number' && typeof t === 'number' && Number.isFinite(x) && Number.isFinite(t)) result.push([x, t]);
  }
  return result;
}

function objectLatex(objects: PdeObject[], id: string, fallback: string): string {
  return objects.find((object) => object.id === id)?.formulaLatex || fallback;
}

function groupId(objects: PdeObject[], group: PdeObject['group'], index: number, fallback: string): string {
  const grouped = objects.filter((object) => object.group === group);
  return grouped[index]?.id ?? fallback;
}

export function charGraphics(solution: CharSolution): CharGraphics {
  const objects = solution.objects;
  const curves: CurveLayer[] = [];
  solution.curves.forEach((curve, index) => {
    const id = objects.some((object) => object.id === curve.id) ? curve.id : groupId(objects, 'characteristic', index, curve.id);
    const finite = curve.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.t));
    curves.push({
      id,
      latex: curve.carriedLatex || objectLatex(objects, id, curve.invariantLatex),
      points: finite.map((point) => [point.x, point.t]),
      values: finite.map((point) => point.u),
      kind: 'curve',
    });
  });
  if (solution.dataCurve.length > 0) {
    const id = objects.find((object) => object.group === 'boundary')?.id ?? objects.find((object) => /data/i.test(object.label))?.id ?? 'data';
    curves.push({
      id,
      latex: objectLatex(objects, id, 'initial line'),
      points: solution.dataCurve.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.t)).map((point) => [point.x, point.t]),
      values: solution.dataCurve.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.t)).map((point) => point.u),
      kind: 'data',
    });
  }
  if (solution.shock && solution.shock.points.length > 1) {
    const id = objects.find((object) => object.group === 'shock')?.id ?? 'shock';
    curves.push({ id, latex: objectLatex(objects, id, solution.shock.latex), points: pairs(solution.shock.points), kind: 'shock' });
  }
  if (solution.envelope && solution.envelope.points.length > 1) {
    const id = objects.find((object) => object.group === 'envelope')?.id ?? 'envelope';
    curves.push({ id, latex: objectLatex(objects, id, solution.envelope.latex), points: pairs(solution.envelope.points), kind: 'envelope' });
  }
  solution.rays?.forEach((ray, index) => {
    const id = groupId(objects, 'ray', index, `ray-${index}`);
    curves.push({ id, latex: objectLatex(objects, id, ray.latex), points: pairs(ray.points), kind: 'ray' });
  });
  solution.wavefronts?.forEach((front, index) => {
    const id = objects.find((object) => object.formulaLatex === front.latex)?.id ?? `wavefront-${index}`;
    curves.push({ id, latex: objectLatex(objects, id, front.latex), points: pairs(front.points), kind: 'wavefront' });
  });

  const regions: RegionLayer[] = [];
  solution.regions?.forEach((region, index) => {
    const id = objects.some((object) => object.id === region.id) ? region.id : groupId(objects, 'region', index, region.id);
    regions.push({
      id,
      latex: objectLatex(objects, id, region.formulaLatex),
      polygon: pairs(region.polygon),
      rarefaction: false,
    });
  });
  if (solution.rarefactionLatex && solution.rays && solution.rays.length >= 2) {
    const already = regions.some((region) => region.latex === solution.rarefactionLatex);
    if (!already) {
      const starts = solution.rays.map((ray) => ray.points[0]).filter((point): point is number[] => Array.isArray(point));
      const ends = solution.rays.map((ray) => ray.points[ray.points.length - 1]).filter((point): point is number[] => Array.isArray(point));
      const polygon = pairs([...starts, ...ends.reverse()]);
      if (polygon.length >= 3) {
        const id = objects.find((object) => object.formulaLatex === solution.rarefactionLatex)?.id ?? 'rarefaction';
        regions.push({ id, latex: solution.rarefactionLatex, polygon, rarefaction: true });
      }
    }
  }
  return { curves, regions };
}

export function finiteExtent(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
  if (max - min < 1e-9) return { min: min - 0.5, max: max + 0.5 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function save(filename: string, href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadPng(): void {
  const canvas = document.querySelector('canvas[data-pde-shot="1"]');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  save('pde-lab.png', canvas.toDataURL('image/png'));
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function poly(points: string, stroke: string, width: number, dash: boolean, opacity: number): string {
  const dashAttr = dash ? ' stroke-dasharray="7 5"' : '';
  return `<polyline fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"${dashAttr} points="${points}" />`;
}

function svgPoint(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

export function downloadSvg(): void {
  const state = usePdeStore.getState();
  const solution = state.solution;
  const frame = activeFrame(solution, state.frame);
  if (!solution || !frame) return;
  const theme = state.theme;
  const ink = theme === 'dark' ? '#f3f1ec' : '#1c1917';
  const paper = theme === 'dark' ? '#101010' : '#ffffff';
  const muted = theme === 'dark' ? '#93a1b5' : '#6b6258';
  const width = 800;
  const height = 460;
  const margin = { left: 56, right: 18, top: 18, bottom: 40 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="${paper}" />`,
  ];

  if (solution.family === 'heat') {
    const series = profileSeries(solution, frame, state.t0, state.partialN, state.hidden, state.selectedId);
    const range = finiteExtent([...series.u, ...(series.partial ?? []), ...(series.selected ?? [])]);
    const spanX = frame.xMax - frame.xMin || 1;
    const spanU = range.max - range.min || 1;
    const xOf = (x: number) => margin.left + ((x - frame.xMin) / spanX) * plotW;
    const yOf = (u: number) => margin.top + ((range.max - u) / spanU) * plotH;
    const line = (values: number[]) =>
      values
        .map((value, index) => (Number.isFinite(value) ? svgPoint(xOf(series.xs[index]!), yOf(value)) : ''))
        .filter(Boolean)
        .join(' ');
    parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="${muted}" />`);
    parts.push(`<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${muted}" />`);
    if (series.partial) parts.push(poly(line(series.partial), groupColor('mode', theme), 2, false, 1));
    if (series.selected) parts.push(poly(line(series.selected), groupColor('shock', theme), 2.4, false, 1));
    parts.push(poly(line(series.u), ink, 2.2, false, 1));
    const cursorX = xOf(state.x0);
    parts.push(`<line x1="${cursorX}" y1="${margin.top}" x2="${cursorX}" y2="${height - margin.bottom}" stroke="${groupColor('ray', theme)}" stroke-width="1.2" />`);
    parts.push(`<text x="${margin.left}" y="16" fill="${ink}" font-family="Source Sans 3, sans-serif" font-size="14">${xml(frame.xName)}, ${xml(frame.tName)} = ${state.t0.toPrecision(3)}</text>`);
  } else if (solution.family === 'characteristics') {
    const graphics = charGraphics(solution);
    const spanX = frame.xMax - frame.xMin || 1;
    const spanT = frame.tMax - frame.tMin || 1;
    const xOf = (x: number) => margin.left + ((x - frame.xMin) / spanX) * plotW;
    const yOf = (t: number) => margin.top + ((frame.tMax - t) / spanT) * plotH;
    const path = (points: Array<[number, number]>) => points.map(([x, t]) => svgPoint(xOf(x), yOf(t))).join(' ');
    parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="${muted}" />`);
    parts.push(`<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${muted}" />`);
    for (const region of graphics.regions) {
      if (state.hidden.includes(region.id) || region.polygon.length < 3) continue;
      const picked = state.selectedId === region.id;
      const fill = region.rarefaction ? groupColor('region', theme) : groupColor('region', theme);
      const opacity = region.rarefaction ? 0.14 : picked ? 0.28 : 0.16;
      parts.push(`<polygon points="${path(region.polygon)}" fill="${fill}" opacity="${opacity}" stroke="none" />`);
    }
    for (const curve of graphics.curves) {
      if (state.hidden.includes(curve.id) || curve.points.length < 2) continue;
      const picked = state.selectedId === curve.id;
      const color = groupColor(curve.kind === 'data' ? 'boundary' : curve.kind === 'shock' ? 'shock' : curve.kind === 'envelope' ? 'envelope' : curve.kind === 'ray' ? 'ray' : 'characteristic', theme);
      const base = curve.kind === 'data' || curve.kind === 'shock' ? 3.4 : curve.kind === 'envelope' ? 2 : 1.5;
      parts.push(poly(path(curve.points), color, picked ? base * 1.7 : base, curve.kind === 'envelope', 1));
    }
    parts.push(`<text x="${margin.left}" y="16" fill="${ink}" font-family="Source Sans 3, sans-serif" font-size="14">${xml(frame.xName)} and ${xml(frame.tName)}</text>`);
  }

  parts.push('</svg>');
  const name = solution.family === 'heat' ? 'pde-profile.svg' : 'pde-characteristics.svg';
  save(name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(parts.join(''))}`);
}
