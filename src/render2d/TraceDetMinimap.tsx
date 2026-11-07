import { useEffect, useMemo, useRef, useState } from 'react';
import type { EquilibriumAnalysis, TraceDetMinimapProps } from '../core/types';
import { PALETTE, equilibriumColor } from '../core/palette';
import { coordList } from '../ui/format';

interface PlaneWindow {
  tMin: number;
  tMax: number;
  dMin: number;
  dMax: number;
}

interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const VIEW_W = 420;
const VIEW_H = 340;

function fitWindow(equilibria: EquilibriumAnalysis[]): PlaneWindow {
  let tMin = -2;
  let tMax = 2;
  let dMin = -1.6;
  let dMax = 2.4;
  for (const equilibrium of equilibria) {
    const tau = equilibrium.trace.value;
    const det = equilibrium.determinant.value;
    if (!Number.isFinite(tau) || !Number.isFinite(det)) continue;
    tMin = Math.min(tMin, tau);
    tMax = Math.max(tMax, tau);
    dMin = Math.min(dMin, det);
    dMax = Math.max(dMax, det);
  }
  const spanT = Math.max(tMax - tMin, 1);
  const spanD = Math.max(dMax - dMin, 1);
  tMin -= spanT * 0.22;
  tMax += spanT * 0.22;
  dMin -= spanD * 0.18;
  dMax += spanD * 0.18;
  if (tMin > -1.4) tMin = -1.8;
  if (tMax < 1.4) tMax = 1.8;
  if (dMin > -1) dMin = -1.4;
  const half = Math.max(Math.abs(tMin), Math.abs(tMax));
  const focusRoom = ((half * 0.5) * (half * 0.5)) / 4;
  if (dMax < focusRoom * 1.45) dMax = Math.max(dMax, focusRoom * 1.45);
  return { tMin, tMax, dMin, dMax };
}

function toScreen(win: PlaneWindow, plot: PlotBox, tau: number, delta: number): [number, number] {
  const x = plot.left + ((tau - win.tMin) / (win.tMax - win.tMin)) * plot.width;
  const y = plot.top + ((win.dMax - delta) / (win.dMax - win.dMin)) * plot.height;
  return [x, y];
}

function polygonPoints(win: PlaneWindow, plot: PlotBox, world: Array<[number, number]>): string {
  return world
    .map(([tau, delta]) => {
      const [x, y] = toScreen(win, plot, tau, delta);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function bandPolygon(win: PlaneWindow, side: -1 | 1, mode: 'node' | 'focus'): Array<[number, number]> | null {
  const outer = side < 0 ? win.tMin : win.tMax;
  const inner = 0;
  if (side < 0 && outer >= -1e-6) return null;
  if (side > 0 && outer <= 1e-6) return null;
  const samples = 48;
  const lower: Array<[number, number]> = [];
  const upper: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i += 1) {
    const tau = outer + ((inner - outer) * i) / samples;
    const parabola = (tau * tau) / 4;
    if (mode === 'node') {
      const floor = Math.max(0, win.dMin);
      const ceiling = Math.min(parabola, win.dMax);
      if (ceiling - floor < 1e-4) continue;
      lower.push([tau, floor]);
      upper.push([tau, ceiling]);
    } else {
      const floor = Math.min(win.dMax, Math.max(parabola, 0, win.dMin));
      const ceiling = win.dMax;
      if (ceiling - floor < 1e-4) continue;
      lower.push([tau, floor]);
      upper.push([tau, ceiling]);
    }
  }
  if (lower.length < 2) return null;
  return [...lower, ...upper.reverse()];
}

function coordText(equilibrium: EquilibriumAnalysis): string {
  return coordList(equilibrium.coords).replace(/\\frac\{(\d+)\}\{(\d+)\}/g, '$1/$2');
}

function inside(win: PlaneWindow, tau: number, delta: number): boolean {
  return tau >= win.tMin && tau <= win.tMax && delta >= win.dMin && delta <= win.dMax;
}

export function TraceDetMinimap(props: TraceDetMinimapProps) {
  const palette = PALETTE[props.theme];
  const win = useMemo(() => fitWindow(props.analysis.equilibria), [props.analysis.equilibria]);
  const plot: PlotBox = { left: 46, top: 16, width: VIEW_W - 64, height: VIEW_H - 58 };
  const history = useRef(new Map<string, Array<{ tau: number; det: number }>>());
  const [, bump] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let changed = false;
    for (const equilibrium of props.analysis.equilibria) {
      const tau = equilibrium.trace.value;
      const det = equilibrium.determinant.value;
      if (!Number.isFinite(tau) || !Number.isFinite(det)) continue;
      const trail = history.current.get(equilibrium.id) ?? [];
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last.tau - tau, last.det - det) > 1e-4) {
        trail.push({ tau, det });
        if (trail.length > 36) trail.shift();
        history.current.set(equilibrium.id, trail);
        changed = true;
      }
    }
    if (changed) bump((value) => value + 1);
  }, [props.analysis]);

  const parabola: Array<[number, number]> = [];
  for (let i = 0; i <= 80; i += 1) {
    const tau = win.tMin + ((win.tMax - win.tMin) * i) / 80;
    const delta = (tau * tau) / 4;
    if (delta <= win.dMax + 0.5) parabola.push([tau, Math.min(delta, win.dMax)]);
  }

  const regions: Array<{ id: string; label: string; fill: string; points: Array<[number, number]> | null; at: [number, number] }> = [
    {
      id: 'saddles',
      label: 'saddles',
      fill: props.theme === 'dark' ? 'rgba(245,158,11,0.16)' : 'rgba(194,65,12,0.12)',
      points:
        win.dMin < 0
          ? [
              [win.tMin, win.dMin],
              [win.tMax, win.dMin],
              [win.tMax, Math.min(0, win.dMax)],
              [win.tMin, Math.min(0, win.dMax)],
            ]
          : null,
      at: [(win.tMin + win.tMax) / 2, win.dMin * 0.55],
    },
    {
      id: 'stable-nodes',
      label: 'stable nodes',
      fill: props.theme === 'dark' ? 'rgba(56,189,248,0.16)' : 'rgba(3,105,161,0.12)',
      points: bandPolygon(win, -1, 'node'),
      at: [win.tMin * 0.55, Math.min(win.dMax * 0.25, Math.max(0.15, (win.tMin * win.tMin) / 10))],
    },
    {
      id: 'unstable-nodes',
      label: 'unstable nodes',
      fill: props.theme === 'dark' ? 'rgba(251,113,133,0.16)' : 'rgba(190,18,60,0.1)',
      points: bandPolygon(win, 1, 'node'),
      at: [win.tMax * 0.55, Math.min(win.dMax * 0.25, Math.max(0.15, (win.tMax * win.tMax) / 10))],
    },
    {
      id: 'stable-foci',
      label: 'stable foci',
      fill: props.theme === 'dark' ? 'rgba(56,189,248,0.28)' : 'rgba(3,105,161,0.18)',
      points: bandPolygon(win, -1, 'focus'),
      at: [win.tMin * 0.45, win.dMax * 0.72],
    },
    {
      id: 'unstable-foci',
      label: 'unstable foci',
      fill: props.theme === 'dark' ? 'rgba(251,113,133,0.28)' : 'rgba(190,18,60,0.16)',
      points: bandPolygon(win, 1, 'focus'),
      at: [win.tMax * 0.45, win.dMax * 0.72],
    },
  ];

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      role="img"
      aria-label="Trace determinant minimap"
      style={{ background: palette.bg }}
    >
      <defs>
        <clipPath id="trace-det-plot">
          <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#trace-det-plot)">
      <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} fill={palette.bg} stroke={palette.grid} />
      {regions.map((region) =>
        region.points ? (
          <polygon key={region.id} points={polygonPoints(win, plot, region.points)} fill={region.fill} />
        ) : null,
      )}
      <polyline
        points={polygonPoints(win, plot, parabola)}
        fill="none"
        stroke={palette.text}
        strokeWidth="1.4"
      />
      <line
        x1={toScreen(win, plot, win.tMin, 0)[0]}
        y1={toScreen(win, plot, 0, 0)[1]}
        x2={toScreen(win, plot, win.tMax, 0)[0]}
        y2={toScreen(win, plot, 0, 0)[1]}
        stroke={palette.axis}
        strokeWidth="1.3"
      />
      <line
        x1={toScreen(win, plot, 0, Math.max(0, win.dMin))[0]}
        y1={toScreen(win, plot, 0, Math.max(0, win.dMin))[1]}
        x2={toScreen(win, plot, 0, win.dMax)[0]}
        y2={toScreen(win, plot, 0, win.dMax)[1]}
        stroke={palette.cycle}
        strokeWidth="1.6"
      />
      {regions.map((region) =>
        inside(win, region.at[0], region.at[1]) ? (
          <text
            key={`${region.id}-label`}
            x={toScreen(win, plot, region.at[0], region.at[1])[0]}
            y={toScreen(win, plot, region.at[0], region.at[1])[1]}
            fill={palette.muted}
            fontSize="11"
            textAnchor="middle"
            fontFamily="Source Sans 3, Segoe UI, sans-serif"
          >
            {region.label}
          </text>
        ) : null,
      )}
      {inside(win, 0.15, Math.max(0.4, win.dMax * 0.45)) && (
        <text
          x={toScreen(win, plot, 0.2, Math.max(0.45, Math.min(win.dMax * 0.55, (win.dMax + Math.max(win.dMin, 0)) / 2)))[0]}
          y={toScreen(win, plot, 0, Math.max(0.45, win.dMax * 0.5))[1]}
          fill={palette.cycle}
          fontSize="11"
          fontFamily="Source Sans 3, Segoe UI, sans-serif"
        >
          centers
        </text>
      )}
      {props.analysis.equilibria.map((equilibrium) => {
        const trail = history.current.get(equilibrium.id) ?? [];
        const color = equilibriumColor(equilibrium.stability, equilibrium.classification2D ?? equilibrium.classification3D, props.theme);
        const points = trail
          .filter((sample) => inside(win, sample.tau, sample.det))
          .map((sample) => toScreen(win, plot, sample.tau, sample.det).join(','))
          .join(' ');
        return points ? <polyline key={`${equilibrium.id}-trail`} points={points} fill="none" stroke={color} strokeWidth="1.2" opacity="0.45" /> : null;
      })}
      {props.analysis.equilibria.map((equilibrium) => {
        const tau = equilibrium.trace.value;
        const det = equilibrium.determinant.value;
        if (!Number.isFinite(tau) || !Number.isFinite(det) || !inside(win, tau, det)) return null;
        const [x, y] = toScreen(win, plot, tau, det);
        const selected = equilibrium.id === props.selectedEquilibriumId || equilibrium.id === hover;
        const color = equilibriumColor(equilibrium.stability, equilibrium.classification2D ?? equilibrium.classification3D, props.theme);
        const name = (equilibrium.classification2D ?? equilibrium.stability).replaceAll('_', ' ');
        return (
          <g key={equilibrium.id} data-object-id={equilibrium.id} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={selected ? 9 : 7.5} fill={palette.bg} />
            <circle
              cx={x}
              cy={y}
              r={selected ? 5.5 : 4.2}
              fill={color}
              stroke={palette.text}
              strokeWidth={selected ? 1.6 : 1}
              onClick={() => props.onSelectEquilibrium(equilibrium.id)}
              onPointerEnter={() => setHover(equilibrium.id)}
              onPointerLeave={() => setHover(null)}
            />
            <text x={x + 10} y={y - 8} fill={palette.text} fontSize="11" fontFamily="Source Sans 3, Segoe UI, sans-serif">
              {coordText(equilibrium)}
            </text>
            <title>
              {coordText(equilibrium)} · {name}: τ = {tau.toFixed(3)}, Δ = {det.toFixed(3)}
            </title>
          </g>
        );
      })}
      </g>
      <text x={VIEW_W / 2} y={VIEW_H - 22} textAnchor="middle" fill={palette.muted} fontSize="11" fontFamily="Source Sans 3, Segoe UI, sans-serif">
        Δ = 0 saddle boundary · τ = 0 Hopf / center · Δ = τ²/4 node–focus
      </text>
      <text x={VIEW_W - 18} y={VIEW_H - 8} textAnchor="end" fill={palette.text} fontSize="12">
        τ
      </text>
      <text x="18" y="28" fill={palette.text} fontSize="12">
        Δ
      </text>
    </svg>
  );
}
