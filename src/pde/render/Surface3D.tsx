import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, NoToneMapping } from 'three';
import { Katex } from '../../ui/Katex';
import { parseUserNumber, rationalLabel } from '../../ui/format';
import type { CharSolution, FieldFrame, HeatSolution, PdeSolution } from '../types';
import { emphasis, groupColor, viridis } from './colors';
import { charGraphics, midY, sampleFrame } from './exportView';
import { activeFrame, usePdeStore } from '../store';

const CAMERA = { position: [2.15, 1.45, 2.25] as [number, number, number], fov: 42, near: 0.01, far: 40 };
const GL = { antialias: true, toneMapping: NoToneMapping };

class SurfaceBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : 'The surface could not be drawn.' };
  }

  render() {
    if (this.state.message) return <p className="status error">{this.state.message}</p>;
    return this.props.children;
  }
}

interface SurfaceModel {
  geometry: BufferGeometry;
  project: (x: number, t: number, u: number) => [number, number, number];
  xMin: number;
  xMax: number;
  tMin: number;
  tMax: number;
}

function buildSurface(solution: PdeSolution, frame: FieldFrame): SurfaceModel {
  const y = midY(frame);
  const nx = 80;
  const nt = 40;
  const xMin = Math.min(frame.xMin, frame.xMax);
  const xMax = Math.max(frame.xMin, frame.xMax);
  const tMin = Math.min(frame.tMin, frame.tMax);
  const tMax = Math.max(frame.tMin, frame.tMax);
  const samples = new Float64Array(nx * nt);
  let uMin = Infinity;
  let uMax = -Infinity;
  const consider = (value: number) => {
    if (!Number.isFinite(value)) return;
    if (value < uMin) uMin = value;
    if (value > uMax) uMax = value;
  };
  for (let j = 0; j < nt; j += 1) {
    const t = tMin + ((tMax - tMin) * j) / (nt - 1);
    for (let i = 0; i < nx; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / (nx - 1);
      const value = sampleFrame(frame, x, t, y);
      samples[j * nx + i] = value;
      consider(value);
    }
  }
  if (solution.family === 'characteristics') {
    for (const curve of solution.curves) for (const point of curve.points) consider(point.u);
    for (const point of solution.dataCurve) consider(point.u);
  }
  if (!Number.isFinite(uMin) || !Number.isFinite(uMax)) {
    uMin = -1;
    uMax = 1;
  }
  if (uMax - uMin < 1e-9) {
    uMin -= 0.5;
    uMax += 0.5;
  }
  const spanX = xMax - xMin || 1;
  const spanT = tMax - tMin || 1;
  const spanU = uMax - uMin || 1;
  const project = (x: number, t: number, u: number): [number, number, number] => [
    ((x - xMin) / spanX) * 2 - 1,
    ((u - uMin) / spanU) * 1.05 - 0.52,
    ((t - tMin) / spanT) * 1.5 - 0.75,
  ];
  const positions = new Float32Array(nx * nt * 3);
  const colors = new Float32Array(nx * nt * 3);
  const color = new Color();
  for (let j = 0; j < nt; j += 1) {
    const t = tMin + (spanT * j) / (nt - 1);
    for (let i = 0; i < nx; i += 1) {
      const x = xMin + (spanX * i) / (nx - 1);
      const value = samples[j * nx + i] ?? Number.NaN;
      const u = Number.isFinite(value) ? value : (uMin + uMax) / 2;
      const [px, py, pz] = project(x, t, u);
      const offset = (j * nx + i) * 3;
      positions[offset] = px;
      positions[offset + 1] = py;
      positions[offset + 2] = pz;
      const [red, green, blue] = viridis(Number.isFinite(value) ? (value - uMin) / spanU : 0.5);
      color.setStyle(`rgb(${red}, ${green}, ${blue})`);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < nt - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (![samples[a], samples[b], samples[c], samples[d]].every((value) => Number.isFinite(value))) continue;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, project, xMin, xMax, tMin, tMax };
}

interface OverlayLine {
  key: string;
  points: Array<[number, number, number]>;
  color: string;
  width: number;
  opacity: number;
  dashed: boolean;
}

function overlayLines(
  solution: PdeSolution,
  frame: FieldFrame,
  model: SurfaceModel,
  theme: 'light' | 'dark',
  t0: number,
  x0: number,
  hidden: string[],
  selectedId: string | null,
  hoverId: string | null,
): { lines: OverlayLine[]; marker: [number, number, number] } {
  const y = midY(frame);
  const lines: OverlayLine[] = [];
  const push = (key: string, id: string, raw: Array<[number, number, number]>, color: string, width: number, dashed: boolean) => {
    const mark = emphasis(id, selectedId, hoverId, hidden);
    const points = raw.filter((point) => point.every((value) => Number.isFinite(value)));
    if (!mark.draw || points.length < 2) return;
    lines.push({ key, points, color, width: width * mark.scale, opacity: mark.alpha, dashed });
  };

  if (solution.family === 'heat') {
    for (const curve of (solution as HeatSolution).boundaryCurves) {
      const id = solution.objects.some((object) => object.id === curve.id)
        ? curve.id
        : (solution.objects.find((object) => object.group === 'boundary')?.id ?? curve.id);
      const points = curve.points.flatMap((point) => {
        const x = point[0];
        const t = point[1];
        if (typeof x !== 'number' || typeof t !== 'number') return [];
        return [model.project(x, t, sampleFrame(frame, x, t, y))];
      });
      push(id, id, points, groupColor('boundary', theme), 5, false);
    }
  } else {
    const graphics = charGraphics(solution as CharSolution);
    for (const curve of graphics.curves) {
      const source = curveSource(solution as CharSolution, frame, curve.id, curve.points);
      const lifted = source.map(([x, t, u]) => model.project(x, t, u));
      const color =
        curve.kind === 'data'
          ? groupColor('boundary', theme)
          : curve.kind === 'shock'
            ? groupColor('shock', theme)
            : curve.kind === 'envelope'
              ? groupColor('envelope', theme)
              : curve.kind === 'ray'
                ? groupColor('ray', theme)
                : groupColor('characteristic', theme);
      const width = curve.kind === 'data' || curve.kind === 'shock' ? 4 : 2;
      push(curve.id, curve.id, lifted, color, width, curve.kind === 'envelope');
    }
  }

  const slice: Array<[number, number, number]> = [];
  const steps = 80;
  for (let index = 0; index < steps; index += 1) {
    const x = model.xMin + ((model.xMax - model.xMin) * index) / (steps - 1);
    const u = sampleFrame(frame, x, t0, y);
    if (!Number.isFinite(u)) continue;
    slice.push(model.project(x, t0, u));
  }
  if (slice.length > 1) lines.push({ key: 'slice', points: slice, color: '#f0b429', width: 3, opacity: 1, dashed: false });
  const markerU = sampleFrame(frame, x0, t0, y);
  const marker = model.project(x0, t0, Number.isFinite(markerU) ? markerU : 0);
  return { lines, marker };
}

function curveSource(solution: CharSolution, frame: FieldFrame, id: string, fallback: Array<[number, number]>): Array<[number, number, number]> {
  const curve = solution.curves.find((item) => item.id === id);
  if (curve) return curve.points.filter((point) => Number.isFinite(point.u)).map((point) => [point.x, point.t, point.u]);
  if (solution.dataCurve.length > 0 && solution.objects.some((object) => object.id === id && object.group === 'boundary')) {
    return solution.dataCurve.filter((point) => Number.isFinite(point.u)).map((point) => [point.x, point.t, point.u]);
  }
  return fallback.map(([x, t]) => [x, t, sampleFrame(frame, x, t)]);
}

export function Surface3D() {
  const solution = usePdeStore((state) => state.solution);
  const frameId = usePdeStore((state) => state.frame);
  const theme = usePdeStore((state) => state.theme);
  const t0 = usePdeStore((state) => state.t0);
  const x0 = usePdeStore((state) => state.x0);
  const hidden = usePdeStore((state) => state.hidden);
  const selectedId = usePdeStore((state) => state.selectedId);
  const hoverId = usePdeStore((state) => state.hoverId);
  const setT0 = usePdeStore((state) => state.setT0);
  const frame = activeFrame(solution, frameId);
  const model = useMemo(() => (solution && frame ? buildSurface(solution, frame) : null), [solution, frame]);

  useEffect(() => () => model?.geometry.dispose(), [model]);

  const overlays = useMemo(() => {
    if (!solution || !frame || !model) return null;
    return overlayLines(solution, frame, model, theme, t0, x0, hidden, selectedId, hoverId);
  }, [solution, frame, model, theme, t0, x0, hidden, selectedId, hoverId]);

  if (!solution || !frame || !model || !overlays) return <p className="status">No surface for this problem.</p>;

  const fieldId = solution.objects.find((object) => object.group === 'field')?.id ?? '';
  const fieldMark = emphasis(fieldId, selectedId, hoverId, hidden);
  const background = theme === 'dark' ? '#101010' : '#ffffff';

  return (
    <>
      <p className="object-text">
        <Katex tex={`u(${frame.xName}, ${frame.tName})`} />
      </p>
      <div className="stage pde-surface">
        <SurfaceBoundary>
          <Canvas className="pde-surface-canvas" camera={CAMERA} gl={GL} style={{ width: '100%', height: '100%' }}>
            <color attach="background" args={[background]} />
            <ambientLight intensity={0.82} />
            <directionalLight position={[3.2, 4.6, 2.4]} intensity={1.35} />
            {fieldMark.draw ? (
              <mesh geometry={model.geometry} frustumCulled={false}>
                <meshStandardMaterial
                  vertexColors
                  roughness={0.58}
                  metalness={0}
                  side={DoubleSide}
                  transparent={fieldMark.alpha < 1}
                  opacity={fieldMark.alpha}
                />
              </mesh>
            ) : null}
            {overlays.lines.map((line) => (
              <Line
                key={line.key}
                points={line.points}
                color={line.color}
                lineWidth={line.width}
                dashed={line.dashed}
                dashSize={0.08}
                gapSize={0.05}
                transparent
                opacity={line.opacity}
              />
            ))}
            <mesh position={overlays.marker}>
              <sphereGeometry args={[0.045, 18, 18]} />
              <meshStandardMaterial color="#f0b429" />
            </mesh>
            <OrbitControls enableDamping={false} />
          </Canvas>
        </SurfaceBoundary>
      </div>
      <TimeSlider frame={frame} value={t0} onChange={setT0} />
    </>
  );
}

function TimeSlider({ frame, value, onChange }: { frame: FieldFrame; value: number; onChange: (value: number) => void }) {
  const min = Math.min(frame.tMin, frame.tMax);
  const max = Math.max(frame.tMin, frame.tMax);
  const [text, setText] = useState(rationalLabel(value));
  useEffect(() => setText(rationalLabel(value)), [value]);
  const commit = () => {
    const next = parseUserNumber(text);
    if (next === null) {
      setText(rationalLabel(value));
      return;
    }
    onChange(next);
  };
  return (
    <label className="parameter">
      <Katex tex={frame.tName || 't'} />
      <input
        aria-label="Time"
        type="range"
        min={min}
        max={max}
        step={(max - min || 1) / 400}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        aria-label="Time value"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
