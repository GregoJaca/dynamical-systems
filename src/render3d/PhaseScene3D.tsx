import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { PALETTE, basinColor, equilibriumColor, type ThemePalette } from '../core/palette';
import type {
  EquilibriumAnalysis,
  LayerVisibility,
  ManifoldBranch,
  ManifoldSurface3D,
  NumericAnalysis,
  PhaseScene3DProps,
  StreamlineSegment,
  ThemeMode,
} from '../core/types';
import {
  add,
  basisMatrix,
  clipLine,
  decimate,
  emphasisOpacity,
  emphasisWidth,
  formatTick,
  fromThree,
  hexToRgb,
  hitInsideBox,
  indicesToTriangles,
  mathToFlatThree,
  norm,
  planeFrame,
  sanitizePoints,
  scale,
  sceneBounds,
  subspaceObjectId,
  sub,
  threeVector,
  tickValues,
  toThree,
  type PlaneFrame,
  type SceneBounds,
} from './space';

const UP = new Vector3(0, 1, 0);
const PRESETS = [
  { id: 'isometric', label: 'Isometric' },
  { id: 'xy', label: 'XY Plane' },
  { id: 'xz', label: 'XZ Plane' },
  { id: 'yz', label: 'YZ Plane' },
] as const;

type CameraPreset = (typeof PRESETS)[number]['id'];

interface BoundaryProps {
  children: ReactNode;
  theme: ThemeMode;
}

interface BoundaryState {
  message: string | null;
}

class SceneErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    const message = error instanceof Error ? error.message : 'The 3D view hit a rendering error.';
    return { message };
  }

  override render() {
    if (!this.state.message) return this.props.children;
    const palette = PALETTE[this.props.theme];
    return (
      <div style={{ ...fillStyle, background: palette.bg, color: palette.text, padding: 24 }}>
        <strong>3D view unavailable</strong>
        <p style={{ color: palette.muted, maxWidth: 460 }}>{this.state.message}</p>
      </div>
    );
  }
}

/**
 * 3D phase portrait. The non-autonomous (x, y, t) extended phase space is intentionally
 * not rendered: time stays a parameter and this view shows the spatial state only.
 */
export function PhaseScene3D(props: PhaseScene3DProps) {
  const { analysis, theme, hoverObjectId, selectedObjectId } = props;
  const palette = PALETTE[theme];
  const [preset, setPreset] = useState<CameraPreset>('isometric');
  const [traceArmed, setTraceArmed] = useState(false);
  const bounds = useMemo(() => sceneBounds(analysis.viewport), [analysis.viewport]);
  const caption = findAnchor(analysis, props.userOrbits, hoverObjectId ?? selectedObjectId);

  return (
    <SceneErrorBoundary key={analysis.revision} theme={theme}>
      <div style={{ ...fillStyle, background: palette.bg, color: palette.text }}>
        <Canvas
          style={{ position: 'absolute', inset: 0 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: false, toneMapping: NoToneMapping }}
          camera={{ position: [4, 3, 4], fov: 42, near: 0.01, far: 200 }}
        >
          <color attach="background" args={[palette.bg]} />
          <SceneContents {...props} bounds={bounds} preset={preset} traceArmed={traceArmed} palette={palette} />
        </Canvas>
        <div style={toolbarStyle}>
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreset(item.id)}
              style={chipStyle(palette, preset === item.id)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => setTraceArmed((armed) => !armed)} style={chipStyle(palette, traceArmed)}>
            {traceArmed ? 'Tracing orbits' : 'Trace orbit'}
          </button>
        </div>
        <div style={{ ...noteStyle, color: palette.muted }}>
          <span>{traceArmed ? 'Click inside the box to place x(0).' : 'Drag to orbit. Click an object to select it.'}</span>
          {caption ? (
            <span style={{ color: palette.text, maxWidth: 720, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {caption.title}
              {caption.detail ? ` — ${caption.detail}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </SceneErrorBoundary>
  );
}

const fillStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%', minHeight: 480, overflow: 'hidden' };
const toolbarStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 2,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  maxWidth: 'calc(100% - 24px)',
};
const noteStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 12,
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  font: '12px/1.4 ui-sans-serif, system-ui, sans-serif',
  pointerEvents: 'none',
  textShadow: '0 1px 2px rgba(0,0,0,0.35)',
};

function chipStyle(palette: ThemePalette, active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? palette.ws : palette.axis}`,
    background: active ? palette.ws : 'transparent',
    color: active ? palette.bg : palette.text,
    borderRadius: 999,
    padding: '5px 10px',
    font: '12px/1 ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
  };
}

interface SceneContentsProps extends PhaseScene3DProps {
  bounds: SceneBounds;
  preset: CameraPreset;
  traceArmed: boolean;
  palette: ThemePalette;
}

function SceneContents(props: SceneContentsProps) {
  const { analysis, layers, bounds, palette, hoverObjectId, selectedObjectId } = props;
  const focused = hoverObjectId ?? selectedObjectId;

  return (
    <>
      <ambientLight intensity={props.theme === 'dark' ? 0.55 : 0.8} />
      <hemisphereLight args={[props.theme === 'dark' ? '#dbeafe' : '#fff7ed', props.theme === 'dark' ? '#1e293b' : '#d6d3d1', 0.45]} />
      <directionalLight position={[bounds.span, bounds.span * 1.6, bounds.span * 0.3]} intensity={0.85} />
      <CameraRig preset={props.preset} bounds={bounds} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <BoundsCage bounds={bounds} palette={palette} labels={axisLabels(props.spec.stateVars)} piX={analysis.viewport.isPiScaledX} piY={analysis.viewport.isPiScaledY} piZ={analysis.viewport.isPiScaledZ} />
      {layers.basins && analysis.basinField ? (
        <BasinSheet field={analysis.basinField} bounds={bounds} opacity={focused ? 0.12 : 0.42} />
      ) : null}
      <FlowLayer {...props} />
      <ManifoldLayer {...props} />
      <SurfaceLayer {...props} />
      <EigenLayer {...props} />
      {layers.equilibria ? <EquilibriumLayer {...props} /> : null}
      {layers.vectorField ? <VectorArrows {...props} /> : null}
      {layers.particles ? <StreamParticles {...props} /> : null}
      <PointerPicker
        bounds={bounds}
        dimension={props.spec.dimension}
        traceArmed={props.traceArmed}
        onSelect={props.onSelectObject}
        onTrace={props.onTracePoint}
      />
    </>
  );
}

function CameraRig({ preset, bounds }: { preset: CameraPreset; bounds: SceneBounds }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const applied = useRef('');

  useFrame(() => {
    const key = `${preset}|${bounds.key}`;
    if (applied.current === key) return;
    const rig = controls as OrbitControlsImpl | null;
    if (!rig || !(camera instanceof PerspectiveCamera)) return;
    const center = threeVector([bounds.cx, bounds.cy, bounds.cz]);
    const radius = 0.5 * Math.hypot(bounds.sx, bounds.sy, bounds.sz);
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (radius / Math.max(0.2, Math.sin(fov / 2))) * 1.2;
    const nudge = bounds.span * 0.045;
    if (preset === 'xy') camera.position.set(center.x + nudge, center.y + dist, center.z + nudge);
    else if (preset === 'xz') camera.position.set(center.x + nudge * 0.25, center.y + nudge, center.z + dist);
    else if (preset === 'yz') camera.position.set(center.x + dist, center.y + nudge, center.z + nudge * 0.25);
    else camera.position.set(center.x + dist * 0.78, center.y + dist * 0.56, center.z + dist * 0.78);
    camera.up.set(0, 1, 0);
    camera.near = Math.max(radius / 250, 1e-3);
    camera.far = dist + radius * 12;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    rig.target.copy(center);
    rig.minDistance = Math.max(radius * 0.12, 1e-3);
    rig.maxDistance = dist * 8;
    rig.update();
    applied.current = key;
  });

  return null;
}

function BoundsCage({
  bounds,
  palette,
  labels,
  piX,
  piY,
  piZ,
}: {
  bounds: SceneBounds;
  palette: ThemePalette;
  labels: [string, string, string];
  piX?: boolean;
  piY?: boolean;
  piZ?: boolean;
}) {
  const edges = useMemo(() => boxEdges(bounds), [bounds]);
  const ticks = useMemo(() => axisTicks(bounds, piX === true, piY === true, piZ === true), [bounds, piX, piY, piZ]);
  const [xName, yName, zName] = labels;
  return (
    <group>
      <Line points={edges} segments color={palette.axis} lineWidth={1.25} raycast={() => null} toneMapped={false} />
      <Line points={ticks.segments} segments color={palette.axis} lineWidth={1} transparent opacity={0.7} raycast={() => null} toneMapped={false} />
      <FloorGrid bounds={bounds} color={palette.axis} />
      {ticks.labels.map((tick) => (
        <Html key={tick.key} position={tick.position} center style={tickLabelStyle(palette)} zIndexRange={[2, 0]}>
          {tick.text}
        </Html>
      ))}
      <Html position={toThree([bounds.xMax, bounds.yMin, bounds.zMin])} center style={axisNameStyle(palette)}>
        {xName}
      </Html>
      <Html position={toThree([bounds.xMin, bounds.yMax, bounds.zMin])} center style={axisNameStyle(palette)}>
        {yName}
      </Html>
      <Html position={toThree([bounds.xMin, bounds.yMin, bounds.zMax])} center style={axisNameStyle(palette)}>
        {zName}
      </Html>
    </group>
  );
}

function FloorGrid({ bounds, color }: { bounds: SceneBounds; color: string }) {
  const points = useMemo(() => {
    const pts: [number, number, number][] = [];
    const lines = 6;
    const z = bounds.zMin;
    for (let i = 0; i <= lines; i += 1) {
      const x = bounds.xMin + (bounds.sx * i) / lines;
      const y = bounds.yMin + (bounds.sy * i) / lines;
      pts.push(toThree([x, bounds.yMin, z]), toThree([x, bounds.yMax, z]));
      pts.push(toThree([bounds.xMin, y, z]), toThree([bounds.xMax, y, z]));
    }
    return pts;
  }, [bounds]);
  return <Line points={points} segments color={color} lineWidth={1} transparent opacity={0.22} raycast={() => null} toneMapped={false} />;
}

function BasinSheet({
  field,
  bounds,
  opacity,
}: {
  field: NonNullable<NumericAnalysis['basinField']>;
  bounds: SceneBounds;
  opacity: number;
}) {
  const texture = useMemo(() => basinTexture(field), [field]);
  useEffect(() => () => texture.dispose(), [texture]);
  const z = bounds.zIsState ? bounds.cz : 0;
  return (
    <mesh position={toThree([bounds.cx, bounds.cy, z])} rotation={[Math.PI / 2, 0, 0]} renderOrder={0} raycast={() => null}>
      <planeGeometry args={[bounds.sx, bounds.sy]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} side={DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function FlowLayer(props: SceneContentsProps) {
  const { analysis, layers, userOrbits, palette, hoverObjectId, selectedObjectId } = props;
  const lines = useMemo(() => {
    const drawn: Array<{ id: string; points: number[][]; color: string; width: number; closed?: boolean }> = [];
    if (layers.nullclines) {
      for (const nullcline of analysis.nullclines) {
        const color = opaque(nullcline.component === 0 ? palette.nullclineX : palette.nullclineY, palette.nullclineX);
        for (const polyline of nullcline.points) {
          drawn.push({ id: nullcline.id, points: polyline, color, width: 1.25, closed: false });
        }
      }
    }
    for (const segment of analysis.streamlines) {
      if (!streamlineVisible(segment, layers)) continue;
      drawn.push({
        id: segment.id,
        points: segment.points,
        color: streamlineColor(segment, palette),
        width: segment.category === 'separatrix' ? 2.1 : 1.35,
      });
    }
    if (layers.limitCycles) {
      for (const cycle of analysis.limitCycles) {
        drawn.push({ id: cycle.id, points: cycle.points, color: palette.cycle, width: 2.2, closed: true });
      }
    }
    for (const orbit of userOrbits) {
      drawn.push({ id: orbit.id, points: orbit.points, color: opaque(palette.droplet, '#F0B429'), width: 2.3 });
    }
    return drawn;
  }, [analysis, layers, userOrbits, palette]);

  return (
    <group renderOrder={4}>
      {lines.map((line, index) => (
        <PhaseLine
          key={`${line.id}:${index}`}
          points={line.points}
          color={line.color}
          width={emphasisWidth(line.id, hoverObjectId, selectedObjectId, line.width)}
          opacity={emphasisOpacity(line.id, hoverObjectId, selectedObjectId, 0.92)}
          objectId={line.id}
          closed={line.closed}
        />
      ))}
    </group>
  );
}

function ManifoldLayer(props: SceneContentsProps) {
  const { analysis, layers, particles, palette, hoverObjectId, selectedObjectId, bounds } = props;
  const branches = analysis.manifolds.filter((branch) => manifoldVisible(branch.kind, layers));
  return (
    <group>
      {branches.map((branch) => (
        <GlowingTube
          key={branch.id}
          points={branch.points}
          color={manifoldColor(branch.kind, palette)}
          radius={bounds.span * (branch.id === selectedObjectId || branch.id === hoverObjectId ? 0.011 : 0.0065)}
          opacity={emphasisOpacity(branch.id, hoverObjectId, selectedObjectId, 0.95)}
          objectId={branch.id}
          playing={particles.playing}
          reverse={branch.kind === 'Ws'}
        />
      ))}
    </group>
  );
}

function SurfaceLayer(props: SceneContentsProps) {
  const { analysis, layers, palette, hoverObjectId, selectedObjectId } = props;
  const surfaces = analysis.manifoldSurfaces.filter((surface) => manifoldVisible(surface.kind, layers));
  return (
    <group>
      {surfaces.map((surface) => (
        <ManifoldRibbon
          key={surface.id}
          surface={surface}
          color={manifoldColor(surface.kind, palette)}
          opacity={emphasisOpacity(surface.id, hoverObjectId, selectedObjectId, 0.35)}
          objectId={surface.id}
        />
      ))}
    </group>
  );
}

function EigenLayer(props: SceneContentsProps) {
  const { analysis, layers, palette, bounds, hoverObjectId, selectedObjectId } = props;
  const items = useMemo(() => collectEigenspaces(analysis.equilibria, bounds, palette, layers), [analysis.equilibria, bounds, palette, layers]);
  return (
    <group>
      {items.map((item) =>
        item.kind === 'line' ? (
          <EigenLine
            key={item.id}
            a={item.a}
            b={item.b}
            color={item.color}
            opacity={emphasisOpacity(item.id, hoverObjectId, selectedObjectId, 0.9)}
            width={emphasisWidth(item.id, hoverObjectId, selectedObjectId, 1.5)}
            objectId={item.id}
          />
        ) : (
          <EigenDisc
            key={item.id}
            origin={item.origin}
            frame={item.frame}
            radius={item.radius}
            color={item.color}
            opacity={emphasisOpacity(item.id, hoverObjectId, selectedObjectId, 0.2)}
            objectId={item.id}
          />
        ),
      )}
    </group>
  );
}

function EquilibriumLayer(props: SceneContentsProps) {
  const { analysis, palette, theme, bounds, hoverObjectId, selectedObjectId, spec } = props;
  const showAllLabels = analysis.equilibria.length <= 8;
  return (
    <group>
      {analysis.equilibria.map((eq) => {
        const color = equilibriumColor(eq.stability, eq.classification3D ?? eq.classification2D, theme);
        const active = eq.id === hoverObjectId || eq.id === selectedObjectId;
        const radius = bounds.span * (active ? 0.024 : 0.015);
        const label = showAllLabels || active;
        return (
          <group key={eq.id} position={toThree(eq.coords)}>
            <EquilibriumGlyph classification={eq.classification3D ?? eq.classification2D} radius={radius} color={color} objectId={eq.id} />
            {active ? (
              <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
                <torusGeometry args={[radius * 2.3, radius * 0.16, 8, 28]} />
                <meshBasicMaterial color={color} toneMapped={false} />
              </mesh>
            ) : null}
            {label ? (
              <Html position={[0, radius * 3.2, 0]} center style={eqLabelStyle(palette)} zIndexRange={[4, 0]}>
                {eq.coords.map((value, index) => `${spec.stateVars[index] ?? `x${index + 1}`}=${formatTick(value, false)}`).join('  ')}
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

function EquilibriumGlyph({
  classification,
  radius,
  color,
  objectId,
}: {
  classification: string | undefined;
  radius: number;
  color: string;
  objectId: string;
}) {
  const saddle = classification?.includes('saddle') === true;
  const center = classification === 'linear_center' || classification === 'nonlinear_center' || classification === 'center_manifold_3d';
  return (
    <mesh userData={{ objectId }} renderOrder={6}>
      {saddle ? <octahedronGeometry args={[radius, 0]} /> : center ? <torusGeometry args={[radius, radius * 0.32, 8, 18]} /> : <sphereGeometry args={[radius, 18, 18]} />}
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function VectorArrows(props: SceneContentsProps) {
  const marks = useMemo(() => {
    const polylines: number[][][] = [];
    for (const segment of props.analysis.streamlines) {
      if (streamlineVisible(segment, props.layers)) polylines.push(segment.points);
    }
    for (const branch of props.analysis.manifolds) {
      if (manifoldVisible(branch.kind, props.layers)) polylines.push(branch.points);
    }
    for (const orbit of props.userOrbits) polylines.push(orbit.points);
    return collectArrows(polylines, props.bounds.span);
  }, [props.analysis, props.layers, props.userOrbits, props.bounds.span]);
  const color = props.palette.axis;
  return (
    <group>
      {marks.map((mark, index) => (
        <mesh key={index} position={mark.position} quaternion={mark.quaternion} raycast={() => null}>
          <coneGeometry args={[mark.length * 0.18, mark.length, 7]} />
          <meshBasicMaterial color={color} transparent opacity={0.75} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function StreamParticles(props: SceneContentsProps) {
  const curves = useMemo(() => {
    const built: ParticleCurve[] = [];
    const push = (points: number[][], speeds: number[] | undefined, color: string) => {
      const curve = toParticleCurve(points, speeds, color);
      if (curve) built.push(curve);
    };
    for (const segment of props.analysis.streamlines) {
      if (!streamlineVisible(segment, props.layers)) continue;
      push(segment.points, segment.velocities, streamlineColor(segment, props.palette));
    }
    for (const branch of props.analysis.manifolds) {
      if (!manifoldVisible(branch.kind, props.layers)) continue;
      push(branch.points, undefined, manifoldColor(branch.kind, props.palette));
    }
    for (const orbit of props.userOrbits) push(orbit.points, orbit.velocities, opaque(props.palette.droplet, '#F0B429'));
    return built;
  }, [props.analysis, props.layers, props.userOrbits, props.palette]);
  const count = Math.max(1, Math.min(800, Math.round(props.particles.count || curves.length * 4 || 1)));
  if (curves.length === 0) return null;
  return (
    <FlowParticles
      key={count}
      curves={curves}
      count={count}
      playing={props.particles.playing}
      mode={props.particles.mode}
      radius={props.bounds.span * 0.008}
    />
  );
}

function PointerPicker({
  bounds,
  dimension,
  traceArmed,
  onSelect,
  onTrace,
}: {
  bounds: SceneBounds;
  dimension: number;
  traceArmed: boolean;
  onSelect: (id: string | null) => void;
  onTrace: (point: number[]) => void;
}) {
  const { camera, gl, scene } = useThree();
  const boundsRef = useRef(bounds);
  const traceRef = useRef(traceArmed);
  const selectRef = useRef(onSelect);
  const traceCb = useRef(onTrace);
  const dimRef = useRef(dimension);
  boundsRef.current = bounds;
  traceRef.current = traceArmed;
  selectRef.current = onSelect;
  traceCb.current = onTrace;
  dimRef.current = dimension;

  useEffect(() => {
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    let down: { x: number; y: number } | null = null;
    const element = gl.domElement;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      down = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (!down || event.button !== 0) return;
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      down = null;
      if (dx * dx + dy * dy > 25) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const params = raycaster.params as { Line?: { threshold: number }; Line2?: { threshold: number } };
      if (params.Line) params.Line.threshold = boundsRef.current.span * 0.02;
      params.Line2 = { threshold: 8 };
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const id = objectIdOf(hit.object);
        if (id) {
          selectRef.current(id);
          return;
        }
      }
      if (!traceRef.current) {
        selectRef.current(null);
        return;
      }
      const hitPoint = hitInsideBox(raycaster.ray, boundsRef.current);
      if (!hitPoint) return;
      const [x, y, z] = fromThree(hitPoint.x, hitPoint.y, hitPoint.z);
      const coords = [x, y, boundsRef.current.zIsState ? z : 0];
      const point: number[] = [];
      for (let i = 0; i < dimRef.current; i += 1) point.push(coords[i] ?? 0);
      selectRef.current(null);
      traceCb.current(point);
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, scene]);

  return null;
}

function PhaseLine({
  points,
  color,
  width,
  opacity,
  objectId,
  dashed = false,
  closed = false,
}: {
  points: number[][];
  color: string;
  width: number;
  opacity: number;
  objectId?: string;
  dashed?: boolean;
  closed?: boolean;
}) {
  const rendered = useMemo(() => {
    const clean = decimate(sanitizePoints(points), 720);
    if (closed && clean.length > 2) {
      const first = clean[0];
      const last = clean[clean.length - 1];
      if (first && last && norm(sub(first, last)) > 1e-5) clean.push(first.slice());
    }
    return clean.map((point) => toThree(point));
  }, [points, closed]);
  const dash = useMemo(() => polylineLength(rendered) / 24, [rendered]);
  if (rendered.length < 2) return null;
  return (
    <Line
      points={rendered}
      color={color}
      lineWidth={width}
      transparent
      opacity={opacity}
      dashed={dashed}
      dashSize={Math.max(dash, 1e-4)}
      gapSize={Math.max(dash * 0.62, 1e-4)}
      toneMapped={false}
      userData={objectId ? { objectId } : undefined}
    />
  );
}

function EigenLine({
  a,
  b,
  color,
  opacity,
  width,
  objectId,
}: {
  a: number[];
  b: number[];
  color: string;
  opacity: number;
  width: number;
  objectId: string;
}) {
  const points = useMemo(() => [a, b], [a, b]);
  return <PhaseLine points={points} color={color} width={width} opacity={opacity} objectId={objectId} dashed />;
}

function EigenDisc({
  origin,
  frame,
  radius,
  color,
  opacity,
  objectId,
}: {
  origin: number[];
  frame: PlaneFrame;
  radius: number;
  color: string;
  opacity: number;
  objectId: string;
}) {
  const geometry = useMemo(() => {
    const geom = new CircleGeometry(radius, 56);
    geom.applyMatrix4(basisMatrix(origin, frame));
    return geom;
  }, [origin, frame, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const grid = useMemo(() => discGrid(origin, frame, radius), [origin, frame, radius]);
  return (
    <group>
      <mesh geometry={geometry} userData={{ objectId }} renderOrder={1}>
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <Line
        points={grid}
        segments
        color={color}
        lineWidth={1}
        transparent
        opacity={Math.min(0.9, opacity + 0.45)}
        toneMapped={false}
        userData={{ objectId }}
      />
    </group>
  );
}

function ManifoldRibbon({
  surface,
  color,
  opacity,
  objectId,
}: {
  surface: ManifoldSurface3D;
  color: string;
  opacity: number;
  objectId: string;
}) {
  const geometry = useMemo(() => ribbonGeometry(surface), [surface]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return (
    <group>
      {geometry ? (
        <mesh geometry={geometry} renderOrder={2} userData={{ objectId }}>
          <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
        </mesh>
      ) : null}
      {surface.trajectories.map((trajectory, index) => (
        <PhaseLine
          key={`${surface.id}:${index}`}
          points={trajectory}
          color={color}
          width={1.15}
          opacity={Math.min(1, opacity + 0.5)}
          objectId={objectId}
        />
      ))}
    </group>
  );
}

function GlowingTube({
  points,
  color,
  radius,
  opacity,
  objectId,
  playing,
  reverse,
}: {
  points: number[][];
  color: string;
  radius: number;
  opacity: number;
  objectId: string;
  playing: boolean;
  reverse: boolean;
}) {
  const curve = useMemo(() => {
    const clean = decimate(sanitizePoints(points), 280);
    if (clean.length < 2) return null;
    const built = new CatmullRomCurve3(clean.map((point) => threeVector(point)));
    return built.getLength() > 1e-5 ? built : null;
  }, [points]);
  const geometry = useMemo(() => {
    if (!curve) return null;
    return new TubeGeometry(curve, Math.min(160, Math.max(12, points.length)), Math.max(radius, 1e-4), 8, false);
  }, [curve, radius, points.length]);
  const shell = useMemo(() => {
    if (!curve) return null;
    return new TubeGeometry(curve, Math.min(80, Math.max(8, points.length)), Math.max(radius, 1e-4) * 1.9, 6, false);
  }, [curve, radius, points.length]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => shell?.dispose(), [shell]);
  if (!curve || !geometry) return null;
  return (
    <group>
      {shell ? (
        <mesh geometry={shell} renderOrder={2} raycast={() => null}>
          <meshBasicMaterial color={color} transparent opacity={Math.min(0.2, opacity * 0.2)} depthWrite={false} toneMapped={false} />
        </mesh>
      ) : null}
      <mesh geometry={geometry} userData={{ objectId }} renderOrder={3}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.8}
          roughness={0.38}
          metalness={0}
          transparent
          opacity={opacity}
          toneMapped={false}
        />
      </mesh>
      {[0.18, 0.46, 0.74].map((phase) => (
        <PulseBead key={phase} curve={curve} phase={phase} color={color} scale={Math.max(radius, 1e-4) * 3.1} playing={playing} reverse={reverse} />
      ))}
    </group>
  );
}

function PulseBead({
  curve,
  phase,
  color,
  scale,
  playing,
  reverse,
}: {
  curve: CatmullRomCurve3;
  phase: number;
  color: string;
  scale: number;
  playing: boolean;
  reverse: boolean;
}) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || curve.getLength() < 1e-6) return;
    const travel = playing ? clock.elapsedTime * 0.13 : 0;
    const along = (phase + travel) % 1;
    const u = Math.min(0.992, Math.max(0.008, reverse ? 1 - along : along));
    mesh.position.copy(curve.getPointAt(u));
    const tangent = curve.getTangentAt(u);
    if (tangent.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(UP, tangent.normalize());
  });
  return (
    <mesh ref={ref} renderOrder={5} raycast={() => null}>
      <coneGeometry args={[scale * 0.4, scale * 1.3, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

interface ParticleCurve {
  points: Vector3[];
  cumulative: number[];
  total: number;
  speeds: number[];
  color: string;
}

function FlowParticles({
  curves,
  count,
  playing,
  mode,
  radius,
}: {
  curves: ParticleCurve[];
  count: number;
  playing: boolean;
  mode: PhaseScene3DProps['particles']['mode'];
  radius: number;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const scratch = useMemo(() => new Vector3(), []);
  const cursor = useRef<Float32Array>(new Float32Array(0));
  const owners = useRef<Uint16Array>(new Uint16Array(0));
  const geometry = useMemo(() => new SphereGeometry(radius, 8, 8), [radius]);
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => {
    cursor.current = new Float32Array(count);
    owners.current = new Uint16Array(count);
    const inst = mesh.current;
    const tint = new Color();
    for (let i = 0; i < count; i += 1) {
      cursor.current[i] = count <= 1 ? 0.15 : (i + 0.5) / count;
      owners.current[i] = curves.length === 0 ? 0 : i % curves.length;
      const curve = curves[owners.current[i] ?? 0];
      if (!inst || !curve) continue;
      inst.setColorAt(i, tint.set(curve.color));
      pointAt(curve, cursor.current[i] ?? 0, scratch);
      dummy.position.copy(scratch);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    if (!inst) return;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }, [count, curves, dummy, scratch]);

  useFrame((_, delta) => {
    const inst = mesh.current;
    if (!inst || curves.length === 0) return;
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < cursor.current.length; i += 1) {
      const curve = curves[owners.current[i] ?? 0];
      if (!curve) continue;
      let u = cursor.current[i] ?? 0;
      if (playing) {
        const cruise = curve.total / 7;
        const raw = mode === 'uniformSpeed' ? cruise : Math.max(speedAt(curve, u), cruise * 0.2);
        const capped = Math.min(raw, curve.total / 1.35);
        u = (u + (capped * dt) / curve.total) % 1;
        cursor.current[i] = u < 0 ? u + 1 : u;
      }
      pointAt(curve, u, scratch);
      dummy.position.copy(scratch);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} raycast={() => null} />;
}

type EigenItem =
  | { kind: 'line'; id: string; color: string; a: number[]; b: number[] }
  | { kind: 'plane'; id: string; color: string; origin: number[]; frame: PlaneFrame; radius: number };

function collectEigenspaces(equilibria: EquilibriumAnalysis[], bounds: SceneBounds, palette: ThemePalette, layers: LayerVisibility): EigenItem[] {
  if (!layers.linearSubspaces) return [];
  const items: EigenItem[] = [];
  for (const eq of equilibria) {
    const pieces = eigenPieces(eq);
    for (const piece of pieces) {
      const color = piece.kind === 'Es' ? palette.es : piece.kind === 'Eu' ? palette.eu : palette.ec;
      if (piece.vectors.length >= 2) {
        const frame = planeFrame(piece.vectors[0] ?? [], piece.vectors[1] ?? []);
        if (!frame) continue;
        items.push({
          kind: 'plane',
          id: piece.id,
          color,
          origin: eq.coords.slice(),
          frame,
          radius: bounds.span * 0.22,
        });
        continue;
      }
      const direction = piece.vectors[0];
      if (!direction) continue;
      const clipped = clipLine(eq.coords, direction, bounds);
      if (!clipped) continue;
      items.push({ kind: 'line', id: piece.id, color, a: clipped[0], b: clipped[1] });
    }
  }
  return items;
}

function eigenPieces(eq: EquilibriumAnalysis): Array<{ id: string; kind: 'Es' | 'Eu' | 'Ec'; vectors: number[][] }> {
  const fromSubspaces = eq.subspaces
    .map((space) => ({
      id: subspaceObjectId(eq.id, space.kind),
      kind: space.kind,
      vectors: space.basisVectors.filter((vector) => vector.some((entry) => entry !== 0)).slice(0, 2),
    }))
    .filter((space) => space.vectors.length === 1 || space.vectors.length === 2);
  if (fromSubspaces.length > 0) return fromSubspaces;
  const fallback: Array<{ id: string; kind: 'Es' | 'Eu' | 'Ec'; vectors: number[][] }> = [];
  eq.eigenvalues.forEach((lambda, index) => {
    const vector = eq.eigenvectors[index];
    if (!vector || Math.abs(lambda.im) > 1e-5) return;
    const kind: 'Es' | 'Eu' | 'Ec' = Math.abs(lambda.re) <= 1e-6 ? 'Ec' : lambda.re < 0 ? 'Es' : 'Eu';
    fallback.push({ id: subspaceObjectId(eq.id, `${kind}${index}`), kind, vectors: [vector] });
  });
  return fallback;
}

function ribbonGeometry(surface: ManifoldSurface3D): BufferGeometry | null {
  const position = mathToFlatThree(surface.vertices);
  const vertexCount = position.length / 3;
  const triangles = indicesToTriangles(surface.indices, vertexCount);
  if (vertexCount < 3 || triangles.length < 3) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}

function basinTexture(field: NonNullable<NumericAnalysis['basinField']>): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, field.nx);
  canvas.height = Math.max(1, field.ny);
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(canvas.width, canvas.height);
    for (let j = 0; j < field.ny; j += 1) {
      for (let i = 0; i < field.nx; i += 1) {
        const id = field.limitIds[j * field.nx + i] ?? '';
        const [r, g, b] = hexToRgb(basinColor(id || 'none'));
        const row = field.ny - 1 - j;
        const pixel = (row * field.nx + i) * 4;
        image.data[pixel] = r;
        image.data[pixel + 1] = g;
        image.data[pixel + 2] = b;
        image.data[pixel + 3] = id ? 210 : 0;
      }
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function boxEdges(bounds: SceneBounds): [number, number, number][] {
  const corners: [number, number, number][] = [];
  for (const x of [bounds.xMin, bounds.xMax]) {
    for (const y of [bounds.yMin, bounds.yMax]) {
      for (const z of [bounds.zMin, bounds.zMax]) corners.push(toThree([x, y, z]));
    }
  }
  const pts: [number, number, number][] = [];
  for (let index = 0; index < 8; index += 1) {
    for (const bit of [1, 2, 4]) {
      const next = index | bit;
      if (next === index) continue;
      const a = corners[index];
      const b = corners[next];
      if (a && b) pts.push(a, b);
    }
  }
  return pts;
}

function axisTicks(bounds: SceneBounds, piX: boolean, piY: boolean, piZ: boolean): {
  segments: [number, number, number][];
  labels: Array<{ key: string; position: [number, number, number]; text: string }>;
} {
  const segments: [number, number, number][] = [];
  const labels: Array<{ key: string; position: [number, number, number]; text: string }> = [];
  const tick = bounds.span * 0.02;
  const push = (key: string, at: number[], dir: number[], text: string) => {
    segments.push(toThree(at), toThree(add(at, scale(dir, tick))));
    labels.push({ key, position: toThree(add(at, scale(dir, tick * 2.2))), text });
  };
  tickValues(bounds.xMin, bounds.xMax, piX).forEach((value, index) => {
    push(`x${index}`, [value, bounds.yMin, bounds.zMin], [0, -1, 0], formatTick(value, piX));
  });
  tickValues(bounds.yMin, bounds.yMax, piY).forEach((value, index) => {
    push(`y${index}`, [bounds.xMin, value, bounds.zMin], [-1, 0, 0], formatTick(value, piY));
  });
  tickValues(bounds.zMin, bounds.zMax, piZ).forEach((value, index) => {
    push(`z${index}`, [bounds.xMin, bounds.yMin, value], [-1, 0, 0], formatTick(value, piZ));
  });
  return { segments, labels };
}

function discGrid(origin: number[], frame: PlaneFrame, radius: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const segments = 36;
  for (let ring = 1; ring <= 3; ring += 1) {
    const rad = (radius * ring) / 3;
    for (let i = 0; i < segments; i += 1) {
      const t0 = (i / segments) * Math.PI * 2;
      const t1 = ((i + 1) / segments) * Math.PI * 2;
      pts.push(toThree(ringPoint(origin, frame, rad, t0)), toThree(ringPoint(origin, frame, rad, t1)));
    }
  }
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const theta = (spoke / 8) * Math.PI * 2;
    pts.push(toThree(origin), toThree(ringPoint(origin, frame, radius, theta)));
  }
  return pts;
}

function ringPoint(origin: number[], frame: PlaneFrame, radius: number, theta: number): number[] {
  return add(origin, add(scale(frame.u, radius * Math.cos(theta)), scale(frame.v, radius * Math.sin(theta))));
}

interface ArrowMark {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  length: number;
}

function collectArrows(polylines: number[][][], span: number): ArrowMark[] {
  const marks: ArrowMark[] = [];
  const spacing = Math.max(span * 0.2, 1e-3);
  const quat = new Quaternion();
  const dir = new Vector3();
  for (const line of polylines) {
    if (marks.length >= 56) break;
    const clean = decimate(sanitizePoints(line), 90);
    let walked = spacing;
    for (let i = 1; i < clean.length; i += 1) {
      const a = clean[i - 1];
      const b = clean[i];
      if (!a || !b) continue;
      const chord = Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), ((b[2] ?? 0) - (a[2] ?? 0)));
      walked += chord;
      if (walked < spacing) continue;
      walked = 0;
      const start = toThree(a);
      const end = toThree(b);
      dir.set(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
      if (dir.lengthSq() < 1e-12) continue;
      dir.normalize();
      quat.setFromUnitVectors(UP, dir);
      const length = Math.min(span * 0.055, Math.max(chord, span * 0.028));
      marks.push({
        position: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
        quaternion: [quat.x, quat.y, quat.z, quat.w],
        length,
      });
      if (marks.length >= 56) break;
    }
  }
  return marks;
}

function toParticleCurve(points: number[][], speeds: number[] | undefined, color: string): ParticleCurve | null {
  const clean = decimate(sanitizePoints(points), 240);
  if (clean.length < 2) return null;
  const vectors = clean.map((point) => threeVector(point));
  const cumulative = [0];
  for (let i = 1; i < vectors.length; i += 1) {
    cumulative.push((cumulative[i - 1] ?? 0) + (vectors[i]?.distanceTo(vectors[i - 1] ?? new Vector3()) ?? 0));
  }
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (!(total > 1e-6)) return null;
  const samples = speeds && speeds.length > 1 ? resample(speeds, clean.length) : clean.map(() => total / 8);
  return { points: vectors, cumulative, total, speeds: samples, color };
}

function resample(values: number[], count: number): number[] {
  if (count <= 1) return [values[0] ?? 0];
  if (values.length === 0) return Array.from({ length: count }, () => 1);
  if (values.length === 1) return Array.from({ length: count }, () => values[0] ?? 1);
  return Array.from({ length: count }, (_, index) => {
    const f = (index / (count - 1)) * (values.length - 1);
    const lo = Math.floor(f);
    const hi = Math.min(values.length - 1, lo + 1);
    const u = f - lo;
    return (values[lo] ?? 0) * (1 - u) + (values[hi] ?? 0) * u;
  });
}

function pointAt(curve: ParticleCurve | undefined, u: number, target: Vector3): Vector3 {
  if (!curve || curve.points.length === 0) return target.set(0, 0, 0);
  const distance = ((u % 1) + 1) % 1 * curve.total;
  let index = 0;
  while (index < curve.cumulative.length - 1 && (curve.cumulative[index + 1] ?? 0) < distance) index += 1;
  const c0 = curve.cumulative[index] ?? 0;
  const c1 = curve.cumulative[index + 1] ?? c0;
  const span = c1 - c0 || 1;
  const t = Math.min(1, Math.max(0, (distance - c0) / span));
  const a = curve.points[index] ?? curve.points[0];
  const b = curve.points[Math.min(curve.points.length - 1, index + 1)] ?? a;
  if (!a || !b) return target.set(0, 0, 0);
  return target.copy(a).lerp(b, t);
}

function speedAt(curve: ParticleCurve, u: number): number {
  const speeds = curve.speeds;
  if (speeds.length === 0) return curve.total / 8;
  const f = Math.min(0.999999, Math.max(0, u)) * (speeds.length - 1);
  const lo = Math.floor(f);
  const hi = Math.min(speeds.length - 1, lo + 1);
  const t = f - lo;
  return Math.abs((speeds[lo] ?? 0) * (1 - t) + (speeds[hi] ?? 0) * t);
}

function polylineLength(points: readonly [number, number, number][]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}

function streamlineVisible(segment: StreamlineSegment, layers: LayerVisibility): boolean {
  if (segment.category === 'separatrix') return layers.separatrices || layers.manifoldsWuWs;
  if (segment.category === 'limit_cycle') return layers.limitCycles;
  if (segment.category === 'user_traced') return true;
  if (segment.category === 'characteristic_orbit') return layers.streamlines || layers.separatrices;
  return layers.streamlines;
}

function manifoldVisible(kind: ManifoldBranch['kind'], layers: LayerVisibility): boolean {
  if (kind === 'Wc') return layers.centerManifoldWc;
  return layers.manifoldsWuWs;
}

function manifoldColor(kind: ManifoldBranch['kind'], palette: ThemePalette): string {
  if (kind === 'Ws') return palette.ws;
  if (kind === 'Wu') return palette.wu;
  return palette.wc;
}

function streamlineColor(segment: StreamlineSegment, palette: ThemePalette): string {
  if (segment.category === 'separatrix' || segment.category === 'characteristic_orbit') return palette.separatrix;
  if (segment.category === 'limit_cycle') return palette.cycle;
  if (segment.category === 'user_traced') return opaque(palette.droplet, '#F0B429');
  if (segment.forwardLimitId) return basinColor(segment.forwardLimitId);
  return opaque(palette.streamline, palette.ws);
}

function opaque(color: string, fallback: string): string {
  if (color.startsWith('#')) return color;
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return fallback;
  const channel = (value: string | undefined) => Number(value ?? '0').toString(16).padStart(2, '0');
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

function axisLabels(stateVars: string[]): [string, string, string] {
  return [stateVars[0] ?? 'x', stateVars[1] ?? 'y', stateVars[2] ?? 'z'];
}

function objectIdOf(object: Object3D | null): string | null {
  let current: Object3D | null = object;
  while (current) {
    const id = current.userData.objectId;
    if (typeof id === 'string' && id.length > 0) return id;
    current = current.parent;
  }
  return null;
}

interface Anchor {
  title: string;
  detail: string;
  at: number[];
}

function findAnchor(analysis: NumericAnalysis, userOrbits: StreamlineSegment[], id: string | null): Anchor | null {
  if (!id) return null;
  for (const eq of analysis.equilibria) {
    if (eq.id === id) {
      return {
        title: (eq.classification3D ?? eq.classification2D ?? eq.stability).replaceAll('_', ' '),
        detail: eq.familyFormulaLatex ?? eq.stabilityReasonLatex,
        at: eq.coords,
      };
    }
    for (const space of eq.subspaces) {
      if (subspaceObjectId(eq.id, space.kind) === id) {
        return { title: space.kind, detail: space.cartesianFormulaLatex, at: eq.coords };
      }
    }
    if (id.startsWith(`${eq.id}:`)) {
      const suffix = id.slice(eq.id.length + 1);
      if (suffix.startsWith('Es') || suffix.startsWith('Eu') || suffix.startsWith('Ec')) {
        return { title: suffix, detail: 'linear eigenspace', at: eq.coords };
      }
    }
  }
  for (const branch of analysis.manifolds) {
    if (branch.id !== id) continue;
    return {
      title: `${branch.kind} ${branch.sign > 0 ? '+' : '−'}`,
      detail: branch.taylorSeriesLatex ?? branch.reducedDynamicsLatex ?? branch.connectionType ?? '',
      at: midpoint(branch.points),
    };
  }
  for (const surface of analysis.manifoldSurfaces) {
    if (surface.id !== id) continue;
    return { title: `${surface.kind} surface`, detail: 'invariant manifold ribbon', at: midpoint(surface.trajectories[0] ?? []) };
  }
  for (const segment of [...analysis.streamlines, ...userOrbits]) {
    if (segment.id !== id) continue;
    return {
      title: segment.category.replaceAll('_', ' '),
      detail: segment.formulaOrDescriptionLatex ?? segment.reasonTag ?? '',
      at: midpoint(segment.points),
    };
  }
  for (const cycle of analysis.limitCycles) {
    if (cycle.id !== id) continue;
    return { title: `${cycle.stability} cycle`, detail: cycle.formulaLatex ?? '', at: midpoint(cycle.points) };
  }
  for (const nullcline of analysis.nullclines) {
    if (nullcline.id !== id) continue;
    return { title: nullcline.variableLatex || 'nullcline', detail: nullcline.formulaLatex, at: midpoint(nullcline.points[0] ?? []) };
  }
  return null;
}

function midpoint(points: readonly (readonly number[])[]): number[] {
  if (points.length === 0) return [0, 0, 0];
  return points[Math.floor(points.length / 2)]?.slice() ?? [0, 0, 0];
}

function tickLabelStyle(palette: ThemePalette): CSSProperties {
  return { color: palette.muted, font: '10px/1 ui-sans-serif, system-ui, sans-serif', whiteSpace: 'nowrap', pointerEvents: 'none' };
}

function axisNameStyle(palette: ThemePalette): CSSProperties {
  return { color: palette.text, font: '12px/1 ui-sans-serif, system-ui, sans-serif', fontWeight: 600, pointerEvents: 'none' };
}

function eqLabelStyle(palette: ThemePalette): CSSProperties {
  return {
    color: palette.text,
    background: palette.bg,
    border: `1px solid ${palette.axis}`,
    borderRadius: 6,
    padding: '2px 6px',
    font: '11px/1.3 ui-sans-serif, system-ui, sans-serif',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };
}
