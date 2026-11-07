import type { LayerVisibility, NumericAnalysis, SystemSpec, ThemeMode } from '../core/types';
import { buildPhaseSvg, downloadPhasePng, downloadTextFile } from '../render2d/SvgExporter';

export async function downloadPortrait(
  kind: 'svg' | 'png',
  spec: SystemSpec,
  analysis: NumericAnalysis,
  theme: ThemeMode,
  layers?: LayerVisibility,
) {
  const svg = buildPhaseSvg({
    analysis,
    theme,
    layers,
    title: spec.latexEquations[0] || spec.id,
    width: 1200,
    height: 800,
  });
  const filename = `${spec.id || 'phase-portrait'}.${kind}`;
  if (kind === 'svg') {
    downloadTextFile(filename, svg, 'image/svg+xml');
    return;
  }
  await downloadPhasePng(svg, filename);
}
