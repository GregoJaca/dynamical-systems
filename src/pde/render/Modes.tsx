import { useEffect, useRef } from 'react';
import { PALETTE } from '../../core/palette';
import { groupColor } from './colors';
import { midY, modeId, samplePhi } from './exportView';
import { activeFrame, usePdeStore } from '../store';

export function Modes() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const solution = usePdeStore((state) => state.solution);
  const frameId = usePdeStore((state) => state.frame);
  const theme = usePdeStore((state) => state.theme);
  const hidden = usePdeStore((state) => state.hidden);
  const selectedId = usePdeStore((state) => state.selectedId);
  const select = usePdeStore((state) => state.select);
  const heat = solution?.family === 'heat' ? solution : null;
  const frame = activeFrame(solution, frameId);
  const count = heat?.modes.length ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heat || !frame || count === 0) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const palette = PALETTE[theme];
      const y = midY(frame);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = theme === 'dark' ? '#101010' : '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);
      const cell = rect.width / count;
      heat.modes.forEach((mode, index) => {
        const id = modeId(heat, mode, index);
        const left = index * cell;
        const shown = !hidden.includes(id) && !hidden.includes(mode.id);
        const picked = selectedId === id || selectedId === mode.id;
        if (picked) {
          ctx.strokeStyle = 'var(--color-accent)';
          ctx.strokeStyle = theme === 'dark' ? '#d7c4a3' : '#1f3a5f';
          ctx.lineWidth = 2;
          ctx.strokeRect(left + 1, 1, cell - 2, rect.height - 2);
        }
        const samples: number[] = [];
        const steps = 48;
        for (let step = 0; step < steps; step += 1) {
          const x = frame.xMin + ((frame.xMax - frame.xMin) * step) / (steps - 1);
          samples.push(samplePhi(mode, x, y));
        }
        let min = Infinity;
        let max = -Infinity;
        for (const value of samples) {
          if (!Number.isFinite(value)) continue;
          if (value < min) min = value;
          if (value > max) max = value;
        }
        if (!Number.isFinite(min) || !Number.isFinite(max)) return;
        if (max - min < 1e-9) {
          min -= 1;
          max += 1;
        }
        ctx.beginPath();
        samples.forEach((value, step) => {
          if (!Number.isFinite(value)) return;
          const px = left + 8 + ((cell - 16) * step) / (steps - 1);
          const py = 16 + ((max - value) / (max - min)) * (rect.height - 28);
          if (step === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.globalAlpha = shown ? 1 : 0.28;
        ctx.strokeStyle = groupColor('mode', theme);
        ctx.lineWidth = picked ? 2.4 : 1.4;
        ctx.stroke();
        ctx.globalAlpha = shown ? 1 : 0.45;
        ctx.fillStyle = palette.muted;
        ctx.font = '12px "Source Sans 3", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(mode.m != null ? `${mode.n},${mode.m}` : String(mode.n), left + 6, 4);
        ctx.globalAlpha = 1;
      });
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [heat, frame, theme, hidden, selectedId, count]);

  if (!heat || count === 0) return null;

  return (
    <div className="stage pde-modes">
      <canvas
        ref={canvasRef}
        className="pde-mode-canvas"
        style={{ width: Math.max(84 * count, 84), height: '100%' }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const index = Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * count)));
          const mode = heat.modes[index];
          if (!mode) return;
          select(modeId(heat, mode, index));
        }}
      />
    </div>
  );
}
