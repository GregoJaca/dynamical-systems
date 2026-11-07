import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { NoToneMapping, PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { PALETTE, equilibriumColor, type ThemePalette } from '../core/palette';
import type { CompiledSystem, EquilibriumAnalysis, HigherDimViewProps, ThemeMode, ViewportBounds } from '../core/types';
import { downsamplePairs, integrateRk4, sampleSeries, type Rk4Series } from './rk4';
import { formatTick, threeVector, toThree } from './space';

const SERIES_COLORS = ['#38BDF8', '#FB7185', '#FBBF24', '#34D399', '#C4B5FD', '#FB923C', '#22D3EE', '#F472B6'] as const;

/**
 * Time-series and projection panel. Designed for dimension >= 4 and usable as the
 * bottom drawer for 1D–3D. Orbits come from a small local RK4 on `compiled`.
 */
export function HigherDimView({ spec, analysis, theme, compiled, onTracePoint }: HigherDimViewProps) {
  const palette = PALETTE[theme];
  const [horizon, setHorizon] = useState(12);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [mode, setMode] = useState<'2d' | '3d'>(spec.dimension >= 3 ? '3d' : '2d');
  const [axes, setAxes] = useState<number[]>(() => defaultAxes(spec.dimension, spec.dimension >= 3 ? '3d' : '2d'));
  const [y0, setY0] = useState<number[]>(() => defaultIc(spec.dimension));
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hidden, setHidden] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setY0(defaultIc(spec.dimension));
    const nextMode = spec.dimension >= 3 ? '3d' : '2d';
    setMode(nextMode);
    setAxes(defaultAxes(spec.dimension, nextMode));
    setHidden({});
    setCursor(0);
  }, [spec.id, spec.dimension]);

  const series = useMemo(() => integrateRk4(compiled, fitState(y0, spec.dimension), horizon, direction), [compiled, y0, horizon, direction, spec.dimension]);
  const tLast = series.t[series.t.length - 1] ?? 0;
  const tMin = Math.min(0, tLast);
  const tMax = Math.max(0, tLast);
  const shown = clamp(cursor, tMin, tMax);
  const state = sampleSeries(series, shown) ?? fitState(y0, spec.dimension);
  const speed = fieldSpeed(compiled, shown, state);

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setCursor((current) => {
        const end = tLast;
        const span = Math.max(Math.abs(end), 1e-3);
        const next = current + Math.sign(end || direction) * dt * (span / 8);
        if (end >= 0 && next >= end) return 0;
        if (end < 0 && next <= end) return 0;
        return next;
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, tLast, direction]);

  const setModeAndAxes = (next: '2d' | '3d') => {
    setMode(next);
    setAxes((current) => resizeAxes(current, spec.dimension, next));
  };

  const toggleAxis = (index: number) => {
    setAxes((current) => toggleAxisList(current, index, spec.dimension, mode));
  };

  const traceState = (point: number[]) => {
    const next = fitState(point, spec.dimension);
    setY0(next);
    setCursor(0);
    onTracePoint(next);
  };

  return (
    <section style={panelStyle(palette)} aria-label="Time series and phase projections">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{spec.dimension >= 4 ? 'Time series and phase projections' : 'Time series drawer'}</strong>
          <div style={{ color: palette.muted }}>
            {spec.dimension}D · local RK4 · {series.t.length - 1} steps · {series.message}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={chip(palette, playing)} onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" style={chip(palette, direction === -1)} onClick={() => { setDirection((value) => (value === 1 ? -1 : 1)); setCursor(0); }}>
            {direction === 1 ? 'Forward' : 'Backward'}
          </button>
          <button type="button" style={chip(palette, false)} onClick={() => traceState(state)}>
            Trace x(t)
          </button>
        </div>
      </header>

      <div style={sliderGrid}>
        {spec.stateVars.map((name, index) => {
          const range = rangeFor(index, analysis.viewport, state[index] ?? 0);
          return (
            <label key={`${name}:${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>
                {name}(0) = {formatTick(y0[index] ?? 0, false)}
              </span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={clamp(y0[index] ?? 0, range.min, range.max)}
                aria-label={`${name} initial condition`}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setY0((current) => {
                    const next = fitState(current, spec.dimension);
                    next[index] = value;
                    return next;
                  });
                  setCursor(0);
                }}
              />
            </label>
          );
        })}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>|T| = {horizon.toFixed(1)}</span>
          <input
            type="range"
            min={0.5}
            max={60}
            step={0.5}
            value={horizon}
            aria-label="Integration horizon"
            onChange={(event) => {
              setHorizon(Number(event.target.value));
              setCursor(0);
            }}
          />
        </label>
      </div>

      <TimeSeriesChart
        palette={palette}
        names={spec.stateVars}
        series={series}
        hidden={hidden}
        cursor={shown}
        onCursor={setCursor}
        onToggle={(index) => setHidden((current) => ({ ...current, [index]: !current[index] }))}
      />

      <div style={{ color: palette.muted }}>
        t = {formatTick(shown, false)}
        {speed ? ` · ‖f‖ = ${speed}` : ''}
        {' · '}
        {state.map((value, index) => `${spec.stateVars[index] ?? `x${index + 1}`} = ${formatTick(value, false)}`).join(' · ')}
      </div>

      {spec.dimension >= 2 ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: palette.muted }}>Project</span>
            {spec.dimension >= 3 ? (
              <>
                <button type="button" style={chip(palette, mode === '2d')} onClick={() => setModeAndAxes('2d')}>
                  2 variables
                </button>
                <button type="button" style={chip(palette, mode === '3d')} onClick={() => setModeAndAxes('3d')}>
                  3 variables
                </button>
              </>
            ) : null}
            {spec.stateVars.map((name, index) => (
              <button key={`${name}:axis`} type="button" style={chip(palette, axes.includes(index))} onClick={() => toggleAxis(index)} aria-pressed={axes.includes(index)}>
                {name}
              </button>
            ))}
          </div>
          {mode === '3d' && axes.length >= 3 ? (
            <ProjectionScene3D
              theme={theme}
              names={axes.map((index) => spec.stateVars[index] ?? `x${index + 1}`)}
              series={series}
              axes={axes.slice(0, 3)}
              cursor={shown}
              equilibria={analysis.equilibria}
            />
          ) : (
            <ProjectionPlot2D
              palette={palette}
              names={axes.slice(0, 2).map((index) => spec.stateVars[index] ?? `x${index + 1}`)}
              series={series}
              axes={axes.slice(0, 2)}
              cursor={shown}
              equilibria={analysis.equilibria}
              theme={theme}
              onPick={(u, v) => {
                const next = state.slice();
                const i = axes[0];
                const j = axes[1];
                if (i != null) next[i] = u;
                if (j != null) next[j] = v;
                traceState(next);
              }}
            />
          )}
        </>
      ) : (
        <div style={{ color: palette.muted }}>A phase projection needs at least two state variables. The time series above is the full portrait.</div>
      )}
    </section>
  );
}

function TimeSeriesChart({
  palette,
  names,
  series,
  hidden,
  cursor,
  onCursor,
  onToggle,
}: {
  palette: ThemePalette;
  names: string[];
  series: Rk4Series;
  hidden: Record<number, boolean>;
  cursor: number;
  onCursor: (time: number) => void;
  onToggle: (index: number) => void;
}) {
  const width = 720;
  const height = 210;
  const pad = { l: 48, r: 12, t: 14, b: 28 };
  const dim = Math.max(names.length, series.y[0]?.length ?? 0);
  const active = Array.from({ length: dim }, (_, index) => index).filter((index) => !hidden[index]);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const row of series.y) {
    for (const index of active) {
      const value = row[index];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      yMin = Math.min(yMin, value);
      yMax = Math.max(yMax, value);
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1;
    yMax = 1;
  }
  if (yMax - yMin < 1e-6) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;
  const t0 = series.t[0] ?? 0;
  const t1 = series.t[series.t.length - 1] ?? 0;
  const xOf = (time: number) => pad.l + ((time - t0) / (t1 - t0 || 1)) * (width - pad.l - pad.r);
  const yOf = (value: number) => pad.t + ((yMax - value) / (yMax - yMin || 1)) * (height - pad.t - pad.b);
  const cursorX = xOf(cursor);

  const seek = (event: ReactPointerEvent<SVGSVGElement>) => {
    const ctm = event.currentTarget.getScreenCTM();
    if (!ctm) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const u = (point.x - pad.l) / (width - pad.l - pad.r);
    onCursor(t0 + clamp(u, 0, 1) * (t1 - t0));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {Array.from({ length: dim }, (_, index) => (
          <button key={names[index] ?? index} type="button" style={chip(palette, !hidden[index])} onClick={() => onToggle(index)}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: seriesColor(index), marginRight: 6 }} />
            {names[index] ?? `x${index + 1}`}(t)
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Time series" style={{ background: 'transparent', touchAction: 'none' }} onPointerDown={seek} onPointerMove={(event) => { if (event.buttons === 1) seek(event); }}>
        <line x1={pad.l} y1={yOf(0)} x2={width - pad.r} y2={yOf(0)} stroke={palette.axis} strokeOpacity={0.45} />
        <line x1={xOf(0)} y1={pad.t} x2={xOf(0)} y2={height - pad.b} stroke={palette.axis} strokeOpacity={0.45} />
        <text x={pad.l} y={height - 8} fill={palette.muted} fontSize={11}>t</text>
        <text x={8} y={pad.t + 4} fill={palette.muted} fontSize={11}>{formatTick(yMax, false)}</text>
        <text x={8} y={height - pad.b} fill={palette.muted} fontSize={11}>{formatTick(yMin, false)}</text>
        {active.map((index) => {
          const column = series.y.map((row) => row[index] ?? Number.NaN);
          const pairs = downsamplePairs(series.t, column, 600);
          const d = pairs.map(([time, value], pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${xOf(time).toFixed(2)} ${yOf(value).toFixed(2)}`).join(' ');
          return <path key={index} d={d} fill="none" stroke={seriesColor(index)} strokeWidth={1.7} />;
        })}
        <line x1={cursorX} y1={pad.t} x2={cursorX} y2={height - pad.b} stroke={palette.text} strokeDasharray="3 3" />
      </svg>
    </div>
  );
}

function ProjectionPlot2D({
  palette,
  names,
  series,
  axes,
  cursor,
  equilibria,
  theme,
  onPick,
}: {
  palette: ThemePalette;
  names: string[];
  series: Rk4Series;
  axes: number[];
  cursor: number;
  equilibria: EquilibriumAnalysis[];
  theme: ThemeMode;
  onPick: (u: number, v: number) => void;
}) {
  const width = 640;
  const height = 360;
  const pad = 36;
  const i = axes[0] ?? 0;
  const j = axes[1] ?? Math.min(1, i);
  const samples = series.y.map((row) => [row[i] ?? 0, row[j] ?? 0]);
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const [u, v] of samples) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  if (!Number.isFinite(uMin)) {
    uMin = -1;
    uMax = 1;
    vMin = -1;
    vMax = 1;
  }
  const span = Math.max(uMax - uMin, vMax - vMin, 1e-3) * 1.15;
  const cu = (uMin + uMax) / 2;
  const cv = (vMin + vMax) / 2;
  const u0 = cu - span / 2;
  const v0 = cv - span / 2;
  const plot = Math.min(width - pad * 2, height - pad * 2);
  const originX = (width - plot) / 2;
  const originY = (height - plot) / 2;
  const xOf = (u: number) => originX + ((u - u0) / span) * plot;
  const yOf = (v: number) => originY + (1 - (v - v0) / span) * plot;
  const d = samples
    .map(([u, v], index) => `${index === 0 ? 'M' : 'L'} ${xOf(u ?? 0).toFixed(2)} ${yOf(v ?? 0).toFixed(2)}`)
    .join(' ');
  const state = sampleSeries(series, cursor);
  const markerU = state?.[i] ?? samples[0]?.[0] ?? 0;
  const markerV = state?.[j] ?? samples[0]?.[1] ?? 0;

  const pick = (event: ReactPointerEvent<SVGSVGElement>) => {
    const ctm = event.currentTarget.getScreenCTM();
    if (!ctm) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const u = u0 + ((point.x - originX) / plot) * span;
    const v = v0 + (1 - (point.y - originY) / plot) * span;
    if (Number.isFinite(u) && Number.isFinite(v)) onPick(u, v);
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Projected orbit" style={{ background: 'transparent', cursor: 'crosshair' }} onClick={pick}>
      <rect x={originX} y={originY} width={plot} height={plot} fill="none" stroke={palette.axis} strokeOpacity={0.45} />
      <text x={originX + plot - 4} y={originY + plot + 16} fill={palette.muted} fontSize={12} textAnchor="end">{names[0] ?? 'u'}</text>
      <text x={originX - 8} y={originY + 12} fill={palette.muted} fontSize={12} textAnchor="end">{names[1] ?? 'v'}</text>
      <path d={d} fill="none" stroke={palette.ws} strokeWidth={1.8} />
      {equilibria.map((eq) => {
        const u = eq.coords[i];
        const v = eq.coords[j];
        if (typeof u !== 'number' || typeof v !== 'number') return null;
        return <circle key={eq.id} cx={xOf(u)} cy={yOf(v)} r={4.5} fill={equilibriumColor(eq.stability, eq.classification3D ?? eq.classification2D, theme)} />;
      })}
      <circle cx={xOf(markerU)} cy={yOf(markerV)} r={6} fill={palette.wu} stroke={palette.bg} strokeWidth={1.5} />
    </svg>
  );
}

function ProjectionScene3D({
  theme,
  names,
  series,
  axes,
  cursor,
  equilibria,
}: {
  theme: ThemeMode;
  names: string[];
  series: Rk4Series;
  axes: number[];
  cursor: number;
  equilibria: EquilibriumAnalysis[];
}) {
  const palette = PALETTE[theme];
  const projected = useMemo(() => projectOrbit(series, axes), [series, axes]);
  const marker = useMemo(() => {
    const math = projectPoint(sampleSeries(series, cursor) ?? series.y[0] ?? [], axes);
    return math ? toThree(math) : projected.marker;
  }, [series, axes, cursor, projected.marker]);
  return (
    <div style={{ position: 'relative', height: 300, border: `1px solid ${palette.axis}`, borderRadius: 10, overflow: 'hidden' }}>
      <Canvas camera={{ position: [3, 2.4, 3], fov: 45, near: 0.01, far: 200 }} gl={{ antialias: true, toneMapping: NoToneMapping }} dpr={[1, 1.75]}>
        <color attach="background" args={[palette.bg]} />
        <ambientLight intensity={0.85} />
        <ProjectionRig bounds={projected} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        {projected.tuples.length > 1 ? <Line points={projected.tuples} color={palette.ws} lineWidth={2} /> : null}
        <mesh position={marker}>
          <sphereGeometry args={[projected.markerRadius, 14, 14]} />
          <meshBasicMaterial color={palette.wu} toneMapped={false} />
        </mesh>
        {equilibria.map((eq) => {
          const point = projectPoint(eq.coords, axes);
          if (!point) return null;
          return (
            <mesh key={eq.id} position={toThree(point)}>
              <sphereGeometry args={[projected.markerRadius * 0.7, 12, 12]} />
              <meshBasicMaterial color={equilibriumColor(eq.stability, eq.classification3D ?? eq.classification2D, theme)} toneMapped={false} />
            </mesh>
          );
        })}
        <ProjectionAxes projected={projected} names={names} color={palette.axis} text={palette.text} />
      </Canvas>
    </div>
  );
}

function ProjectionRig({ bounds }: { bounds: ProjectedOrbit }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const applied = useRef('');
  useFrame(() => {
    if (applied.current === bounds.key) return;
    const rig = controls as OrbitControlsImpl | null;
    if (!rig || !(camera instanceof PerspectiveCamera)) return;
    const center = threeVector(bounds.center);
    const radius = Math.max(bounds.radius, 0.2);
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (radius / Math.max(0.2, Math.sin(fov / 2))) * 1.35;
    camera.position.set(center.x + dist * 0.8, center.y + dist * 0.55, center.z + dist * 0.8);
    camera.near = Math.max(radius / 200, 1e-3);
    camera.far = dist + radius * 10;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    rig.target.copy(center);
    rig.update();
    applied.current = bounds.key;
  });
  return null;
}

function ProjectionAxes({
  projected,
  names,
  color,
  text,
}: {
  projected: ProjectedOrbit;
  names: string[];
  color: string;
  text: string;
}) {
  const [uName, vName, wName] = names;
  const origin = projected.min;
  const xEnd = [projected.max[0], origin[1], origin[2]];
  const yEnd = [origin[0], projected.max[1], origin[2]];
  const zEnd = [origin[0], origin[1], projected.max[2]];
  return (
    <group>
      <Line points={[toThree(origin), toThree(xEnd), toThree(origin), toThree(yEnd), toThree(origin), toThree(zEnd)]} segments color={color} lineWidth={1.2} />
      <Html position={toThree(xEnd)} center style={axisHtml(text)}>{uName ?? 'u'}</Html>
      <Html position={toThree(yEnd)} center style={axisHtml(text)}>{vName ?? 'v'}</Html>
      <Html position={toThree(zEnd)} center style={axisHtml(text)}>{wName ?? 'w'}</Html>
    </group>
  );
}

interface ProjectedOrbit {
  tuples: [number, number, number][];
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  marker: [number, number, number];
  markerRadius: number;
  radius: number;
  key: string;
}

function projectOrbit(series: Rk4Series, axes: number[]): ProjectedOrbit {
  const math = series.y
    .map((row) => projectPoint(row, axes))
    .filter((point): point is [number, number, number] => point != null);
  const markerMath = math[0] ?? [0, 0, 0];
  if (math.length === 0) math.push(markerMath);
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of math) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], point[k]);
      max[k] = Math.max(max[k], point[k]);
    }
  }
  for (let k = 0; k < 3; k += 1) {
    if (max[k] - min[k] < 1e-3) {
      min[k] -= 0.5;
      max[k] += 0.5;
    }
  }
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius = 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const step = Math.max(1, Math.ceil(math.length / 900));
  const drawn: Array<[number, number, number]> = [];
  for (let index = 0; index < math.length; index += step) {
    const point = math[index];
    if (point) drawn.push(point);
  }
  const tail = math[math.length - 1];
  const lastDrawn = drawn[drawn.length - 1];
  if (tail && (!lastDrawn || tail[0] !== lastDrawn[0] || tail[1] !== lastDrawn[1] || tail[2] !== lastDrawn[2])) drawn.push(tail);
  const tuples = drawn.map((point) => toThree(point));
  const marker = toThree(markerMath);
  const key = `${center.map((value) => value.toFixed(4)).join(',')}|${radius.toFixed(4)}|${tuples.length}`;
  return { tuples, center, min, max, marker, markerRadius: Math.max(radius * 0.035, 0.02), radius, key };
}

function projectPoint(coords: readonly number[], axes: number[]): [number, number, number] | null {
  if (axes.length < 3) return null;
  const values = axes.slice(0, 3).map((index) => coords[index]);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function defaultIc(dimension: number): number[] {
  return Array.from({ length: Math.max(0, dimension) }, (_, index) => 0.45 * 0.72 ** index);
}

function defaultAxes(dimension: number, mode: '2d' | '3d'): number[] {
  const count = mode === '3d' && dimension >= 3 ? 3 : Math.min(2, dimension);
  return Array.from({ length: count }, (_, index) => index);
}

function resizeAxes(current: number[], dimension: number, mode: '2d' | '3d'): number[] {
  const limit = mode === '3d' && dimension >= 3 ? 3 : Math.min(2, dimension);
  const kept = current.filter((index) => index >= 0 && index < dimension).slice(0, limit);
  for (let index = 0; kept.length < limit && index < dimension; index += 1) {
    if (!kept.includes(index)) kept.push(index);
  }
  return kept;
}

function toggleAxisList(current: number[], index: number, dimension: number, mode: '2d' | '3d'): number[] {
  const limit = mode === '3d' && dimension >= 3 ? 3 : Math.min(2, Math.max(dimension, 1));
  if (current.includes(index)) {
    if (current.length <= Math.min(2, dimension)) return current;
    return current.filter((item) => item !== index);
  }
  if (current.length < limit) return [...current, index];
  return [...current.slice(1), index];
}

function fitState(state: readonly number[], dimension: number): number[] {
  const next = defaultIc(dimension);
  for (let index = 0; index < dimension; index += 1) {
    const value = state[index];
    if (typeof value === 'number' && Number.isFinite(value)) next[index] = value;
  }
  return next;
}

function rangeFor(index: number, viewport: ViewportBounds, value: number): { min: number; max: number; step: number } {
  const xSpan = Math.max(Math.abs(viewport.xMax - viewport.xMin), 2);
  let min = -xSpan / 2;
  let max = xSpan / 2;
  if (index === 0) {
    min = viewport.xMin;
    max = viewport.xMax;
  } else if (index === 1) {
    min = viewport.yMin;
    max = viewport.yMax;
  } else if (index === 2 && viewport.zMin != null && viewport.zMax != null) {
    min = viewport.zMin;
    max = viewport.zMax;
  }
  if (!(max > min)) {
    min = -2;
    max = 2;
  }
  min = Math.min(min, value);
  max = Math.max(max, value);
  return { min, max, step: Math.max((max - min) / 200, 1e-4) };
}

function fieldSpeed(compiled: CompiledSystem | null, time: number, state: number[]): string {
  if (!compiled) return '';
  try {
    const velocity = compiled.f(time, state.slice(), compiled.parameterValues);
    const value = Math.hypot(...velocity);
    return Number.isFinite(value) ? value.toPrecision(3) : '';
  } catch {
    return '';
  }
}

function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

function clamp(value: number, min: number, max: number): number {
  if (!(max > min)) return min;
  return Math.min(max, Math.max(min, value));
}

const sliderGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
};

function panelStyle(palette: ThemePalette): CSSProperties {
  return {
    boxSizing: 'border-box',
    width: '100%',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    background: palette.bg,
    color: palette.text,
    font: '13px/1.45 ui-sans-serif, system-ui, sans-serif',
  };
}

function chip(palette: ThemePalette, active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? palette.ws : palette.axis}`,
    background: active ? palette.ws : 'transparent',
    color: active ? palette.bg : palette.text,
    borderRadius: 999,
    padding: '4px 10px',
    font: '12px/1.2 ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
  };
}

function axisHtml(color: string): CSSProperties {
  return { color, font: '12px/1 ui-sans-serif, system-ui, sans-serif', fontWeight: 600, pointerEvents: 'none' };
}
