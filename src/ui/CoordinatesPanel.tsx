import type { ReactNode } from 'react';
import { useSystemStore } from '../store/useSystemStore';
import { Badge } from './bits';
import { prettyLabel } from './format';
import { Katex } from './Katex';
import { RichText } from './RichText';

function shownEquation(prefix: string, formula: string): string {
  const trimmed = formula.trim();
  if (!trimmed) return '';
  if (trimmed.includes('=') || trimmed.includes('\\dot')) return trimmed;
  return `${prefix} = ${trimmed}`;
}

export function CoordinatesPanel() {
  const analysis = useSystemStore((state) => state.analysis);
  const polar = analysis.coordinateTransforms.polar2D;
  const cylindrical = analysis.coordinateTransforms.cylindrical3D;
  const spherical = analysis.coordinateTransforms.spherical3D;
  const global = analysis.global;
  const polarUseful = Boolean(polar?.isRecommended);
  const dulac = global.bendixsonDulac?.applies ? global.bendixsonDulac : null;
  const lyapunov = global.lyapunov && global.lyapunov.classification !== 'indefinite' && !(global.isHamiltonian && global.lyapunov.classification === 'conserved_first_integral') ? global.lyapunov : null;
  const blocks: ReactNode[] = [];

  if (polar && polarUseful) {
    blocks.push(
      <div key="polar">
        <Katex tex={shownEquation('\\dot r', polar.rDotLatex)} display />
        <Katex tex={shownEquation('\\dot\\theta', polar.thetaDotLatex)} display />
        {polar.radialEquilibriaR.length > 0 && (
          <p className="text-sm">
            Radial equilibria {polar.radialEquilibriaR.map((radius, index) => `r = ${radius} (${prettyLabel(polar.radialStability[index])})`).join(' ; ')}
          </p>
        )}
      </div>,
    );
  }
  if (cylindrical) {
    blocks.push(
      <div key="cylindrical">
        <Katex tex={shownEquation('\\dot r', cylindrical.rDotLatex)} display />
        <Katex tex={shownEquation('\\dot\\theta', cylindrical.thetaDotLatex)} display />
        <Katex tex={shownEquation('\\dot z', cylindrical.zDotLatex)} display />
      </div>,
    );
  }
  if (spherical) {
    blocks.push(
      <div key="spherical">
        <Katex tex={shownEquation('\\dot\\rho', spherical.rhoDotLatex)} display />
        <Katex tex={shownEquation('\\dot\\theta', spherical.thetaDotLatex)} display />
        <Katex tex={shownEquation('\\dot\\phi', spherical.phiDotLatex)} display />
      </div>,
    );
  }
  if (global.divergenceLatex) blocks.push(<Katex key="div" tex={`\\nabla\\cdot f = ${global.divergenceLatex}`} display />);
  if (global.isGradientSystem && global.potentialFunctionLatex) {
    blocks.push(
      <Katex
        key="potential"
        tex={`f = -\\nabla V,\\quad ${global.potentialFunctionLatex.trim().startsWith('V') ? global.potentialFunctionLatex : `V = ${global.potentialFunctionLatex}`}`}
        display
      />,
    );
  }
  if (global.isHamiltonian && global.hamiltonianLatex) {
    blocks.push(<Katex key="hamiltonian" tex={global.hamiltonianLatex.trim().startsWith('H') ? global.hamiltonianLatex : `H = ${global.hamiltonianLatex}`} display />);
  }
  for (const symmetry of global.symmetries) {
    blocks.push(
      <div key={symmetry.type} className="rounded-xl bg-black/10 p-2 text-sm">
        <Badge>{prettyLabel(symmetry.type)}</Badge>
        <Katex tex={symmetry.formulaLatex} display />
        <p>{symmetry.geometricImplication}</p>
      </div>,
    );
  }
  if (dulac) {
    blocks.push(
      <div key="dulac" className="text-sm">
        <Katex tex={dulac.multiplierLatex.trim().startsWith('B') ? dulac.multiplierLatex : `B = ${dulac.multiplierLatex}`} display />
        {dulac.divergenceProductLatex && <Katex tex={`\\nabla\\cdot(Bf) = ${dulac.divergenceProductLatex}`} display />}
        <RichText text={dulac.conclusion} />
      </div>,
    );
  }
  if (lyapunov) {
    blocks.push(
      <div key="lyapunov" className="text-sm">
        <Badge tone={lyapunov.classification === 'strict_lyapunov' ? 'good' : 'gold'}>{prettyLabel(lyapunov.classification)}</Badge>
        <Katex tex={lyapunov.vLatex.trim().startsWith('V') ? lyapunov.vLatex : `V = ${lyapunov.vLatex}`} display />
        <Katex tex={shownEquation('\\dot V', lyapunov.vDotLatex)} display />
        <RichText text={lyapunov.conclusionLatex} />
      </div>,
    );
  }

  if (blocks.length === 0) return null;
  return (
    <section>
      <h2>Coordinates and integrals</h2>
      <div className="space-y-3">{blocks}</div>
    </section>
  );
}
