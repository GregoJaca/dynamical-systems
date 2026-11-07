import { useState } from 'react';
import { Download, Gauge, Image, Link2, Moon, Pause, Play, Spline, Sun } from 'lucide-react';
import type { LayerVisibility } from '../core/types';
import { useSystemStore } from '../store/useSystemStore';
import { downloadPortrait } from './downloadPortrait';

const TOGGLES: Array<{ key: keyof LayerVisibility; label: string; title: string }> = [
  { key: 'manifoldsWuWs', label: 'Wˢ/Wᵘ', title: 'Stable and unstable manifolds' },
  { key: 'centerManifoldWc', label: 'Wᶜ', title: 'Center manifold' },
  { key: 'linearSubspaces', label: 'Eˢ/Eᵘ/Eᶜ', title: 'Linear eigenspaces' },
  { key: 'nullclines', label: 'Nullclines', title: 'Nullclines' },
  { key: 'basins', label: 'Basins', title: 'Basins of attraction' },
  { key: 'lyapunov', label: 'V', title: 'Lyapunov function' },
  { key: 'polarSplit', label: '(r, θ)', title: 'Split polar phase portrait' },
  { key: 'traceDetMinimap', label: '(τ, Δ)', title: 'Trace–determinant minimap' },
  { key: 'timeSeries', label: 'x(t)', title: 'Time series' },
];

export function ViewportToolbar({
  showEquations,
  showInspector,
  onToggleEquations,
  onToggleInspector,
}: {
  showEquations: boolean;
  showInspector: boolean;
  onToggleEquations: () => void;
  onToggleInspector: () => void;
}) {
  const spec = useSystemStore((state) => state.spec);
  const analysis = useSystemStore((state) => state.analysis);
  const layers = useSystemStore((state) => state.layers);
  const theme = useSystemStore((state) => state.theme);
  const particles = useSystemStore((state) => state.particles);
  const flowMap = useSystemStore((state) => state.flowMap);
  const extendedPhase = useSystemStore((state) => state.extendedPhase);
  const toggleLayer = useSystemStore((state) => state.toggleLayer);
  const setTheme = useSystemStore((state) => state.setTheme);
  const toggleParticles = useSystemStore((state) => state.toggleParticles);
  const setParticleMode = useSystemStore((state) => state.setParticleMode);
  const toggleFlowMap = useSystemStore((state) => state.toggleFlowMap);
  const setFlowMap = useSystemStore((state) => state.setFlowMap);
  const setExtendedPhase = useSystemStore((state) => state.setExtendedPhase);
  const copyShareLink = useSystemStore((state) => state.copyShareLink);
  const [notice, setNotice] = useState('');

  const share = async () => {
    const url = copyShareLink();
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied');
    } catch {
      setNotice('Link is in the address bar');
    }
    window.setTimeout(() => setNotice(''), 1600);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
      <div className="glass pointer-events-auto flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-full px-2 py-1">
        <button type="button" className="rounded-full px-2 py-1 text-xs" onClick={onToggleEquations} aria-pressed={showEquations}>
          Equations
        </button>
        <button type="button" className="rounded-full px-2 py-1 text-xs" onClick={onToggleInspector} aria-pressed={showInspector}>
          Inspector
        </button>
        <span className="mx-1 h-4 w-px bg-slate-400/30" />
        <button type="button" className="rounded-full p-1.5" onClick={toggleParticles} aria-label={particles.playing ? 'Pause particles' : 'Play particles'} title="Animated particles">
          {particles.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className={`rounded-full px-2 py-1 text-xs ${particles.mode === 'trueVelocity' ? 'bg-[#f0b429]/20 text-[#f0b429]' : ''}`}
          onClick={() => setParticleMode(particles.mode === 'trueVelocity' ? 'uniformSpeed' : 'trueVelocity')}
          title="Particle speed"
        >
          <Gauge size={14} className="mr-1 inline" />
          {particles.mode === 'trueVelocity' ? '||f||' : 'Uniform'}
        </button>
        <button type="button" className={`rounded-full px-2 py-1 text-xs ${flowMap.active ? 'bg-[#f0b429]/20 text-[#f0b429]' : ''}`} onClick={toggleFlowMap} title="Flow map droplet">
          <Spline size={14} className="mr-1 inline" />
          φₜ
        </button>
        {flowMap.active && (
          <>
            <input
              aria-label="Flow map time"
              className="w-28 accent-[#f0b429]"
              type="range"
              min={-flowMap.timeMax}
              max={flowMap.timeMax}
              step={0.01}
              value={flowMap.time}
              onChange={(event) => setFlowMap({ time: Number(event.target.value), playing: false })}
            />
            <button type="button" className="rounded-full p-1.5" onClick={() => setFlowMap({ playing: !flowMap.playing })} aria-label="Play flow map">
              {flowMap.playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
          </>
        )}
        {spec.dimension === 2 && !spec.isAutonomous && (
          <button type="button" className={`rounded-full px-2 py-1 text-xs ${extendedPhase ? 'bg-[#f0b429]/20 text-[#f0b429]' : ''}`} onClick={() => setExtendedPhase(!extendedPhase)}>
            (x, y, t)
          </button>
        )}
        <span className="mx-1 h-4 w-px bg-slate-400/30" />
        {TOGGLES.map((toggle) => (
          <button
            key={toggle.key}
            type="button"
            title={toggle.title}
            aria-pressed={layers[toggle.key]}
            className={`rounded-full px-2 py-1 text-xs ${layers[toggle.key] ? 'bg-[#f0b429]/20 text-[#f0b429]' : 'opacity-75'}`}
            onClick={() => toggleLayer(toggle.key)}
          >
            {toggle.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-400/30" />
        <button type="button" className="rounded-full p-1.5" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" className="rounded-full p-1.5" onClick={() => void share()} aria-label="Copy share link" title={notice || 'Copy share link'}>
          <Link2 size={16} />
        </button>
        <button type="button" className="rounded-full p-1.5" onClick={() => void downloadPortrait('svg', spec, analysis, theme, layers)} aria-label="Export SVG">
          <Download size={16} />
        </button>
        <button type="button" className="rounded-full p-1.5" onClick={() => void downloadPortrait('png', spec, analysis, theme, layers)} aria-label="Export PNG">
          <Image size={16} />
        </button>
        {notice && <span className="px-2 text-xs text-[#f0b429]">{notice}</span>}
      </div>
    </div>
  );
}
