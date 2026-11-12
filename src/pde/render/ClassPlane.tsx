import { useEffect, useRef } from 'react';
import { PALETTE } from '../../core/palette';
import { usePdeStore } from '../store';

const MARGIN = { left: 42, right: 16, top: 16, bottom: 28 };

/** The two families of lines y − m x = constant, or vertical lines when the slope is infinite. */
export function ClassPlane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const solution = usePdeStore((state) => state.solution);
  const theme = usePdeStore((state) => state.theme);
  const hidden = usePdeStore((state) => state.hidden);
  const selectedId = usePdeStore((state) => state.selectedId);
  const classified = solution?.family === 'classify' ? solution : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !classified) return;
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
      draw(ctx, rect.width, rect.height, classified.families, classified.type, classified.delta, theme, hidden, selectedId);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [classified, theme, hidden, selectedId]);

  if (!classified) return null;
  return <canvas ref={canvasRef} className="pde-shot" aria-label="Characteristic families" />;
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  families: Array<{ id: string; slope: number | null; label: string }>,
  type: string,
  delta: number,
  theme: 'light' | 'dark',
  hidden: string[],
  selectedId: string | null,
) {
  const palette = PALETTE[theme];
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme === 'dark' ? '#101010' : '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xMin = -3;
  const xMax = 3;
  const yMin = -3;
  const yMax = 3;
  const xOf = (x: number) => MARGIN.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const yOf = (y: number) => MARGIN.top + ((yMax - y) / (yMax - yMin)) * plotH;
  ctx.strokeStyle = palette.axis;
  ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH);
  ctx.clip();
  const colors = ['#3b528b', '#fde725'];
  families.forEach((family, index) => {
    if (hidden.includes(family.id)) return;
    ctx.strokeStyle = colors[index % colors.length] ?? '#3b528b';
    ctx.globalAlpha = selectedId && selectedId !== family.id ? 0.2 : 1;
    ctx.lineWidth = selectedId === family.id ? 2.8 : 2;
    for (let level = -6; level <= 6; level += 1) {
      ctx.beginPath();
      if (family.slope === null) {
        const x = level * 0.45;
        ctx.moveTo(xOf(x), yOf(yMin));
        ctx.lineTo(xOf(x), yOf(yMax));
      } else {
        const intercept = level * 0.7;
        ctx.moveTo(xOf(xMin), yOf(family.slope * xMin + intercept));
        ctx.lineTo(xOf(xMax), yOf(family.slope * xMax + intercept));
      }
      ctx.stroke();
    }
  });
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.text;
  ctx.font = '13px "Source Sans 3", sans-serif';
  ctx.fillText(type, MARGIN.left, 12);
  void delta;
  ctx.fillText('x', width - MARGIN.right - 8, height - 8);
  ctx.fillText('y', 8, MARGIN.top + 4);
}
