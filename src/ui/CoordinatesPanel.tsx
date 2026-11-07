import { useSystemStore } from '../store/useSystemStore';
import { Badge, Section } from './bits';
import { prettyLabel } from './format';
import { Katex } from './Katex';
import { RichText } from './RichText';

export function CoordinatesPanel() {
  const analysis = useSystemStore((state) => state.analysis);
  const polar = analysis.coordinateTransforms.polar2D;
  const cylindrical = analysis.coordinateTransforms.cylindrical3D;
  const spherical = analysis.coordinateTransforms.spherical3D;
  const global = analysis.global;

  return (
    <div className="space-y-4">
      <Section title="Polar coordinates">
        <div className="flex items-center gap-2">
          {polar?.isRecommended && <Badge tone="gold">Recommended</Badge>}
          {polar?.recommendationReason && <span className="text-xs opacity-70">{polar.recommendationReason}</span>}
        </div>
        {polar ? (
          <div className="space-y-1">
            <Katex tex={`\\dot r = ${polar.rDotLatex}`} display />
            <Katex tex={`\\dot\\theta = ${polar.thetaDotLatex}`} display />
            {polar.radialEquilibriaR.length > 0 && <p className="text-sm">Radial equilibria r = {polar.radialEquilibriaR.map((radius) => radius.toPrecision(4)).join(', ')}</p>}
          </div>
        ) : (
          <p className="text-sm opacity-70">Polar formulas appear here for planar systems. The picture is on the portrait, below the phase plane.</p>
        )}
      </Section>
      <Section title="Cylindrical and spherical">
        {cylindrical ? (
          <div>
            {cylindrical.isRecommended && <Badge tone="gold">Recommended</Badge>}
            <Katex tex={`\\dot r = ${cylindrical.rDotLatex}`} display />
            <Katex tex={`\\dot\\theta = ${cylindrical.thetaDotLatex}`} display />
            <Katex tex={`\\dot z = ${cylindrical.zDotLatex}`} display />
            {cylindrical.recommendationReason && <p className="text-xs opacity-70">{cylindrical.recommendationReason}</p>}
          </div>
        ) : (
          <p className="text-sm opacity-70">Cylindrical coordinates are computed for 3D systems.</p>
        )}
        {spherical && (
          <div className="mt-2">
            {spherical.isRecommended && <Badge tone="gold">Recommended</Badge>}
            <Katex tex={`\\dot\\rho = ${spherical.rhoDotLatex}`} display />
            <Katex tex={`\\dot\\theta = ${spherical.thetaDotLatex}`} display />
            <Katex tex={`\\dot\\phi = ${spherical.phiDotLatex}`} display />
          </div>
        )}
      </Section>
      <Section title="Divergence, symmetries, and integrals">
        {global.divergenceLatex && <Katex tex={`\\nabla\\cdot f = ${global.divergenceLatex}`} display />}
        {global.isGradientSystem && global.potentialFunctionLatex && <Katex tex={`f = -\\nabla V,\\quad V = ${global.potentialFunctionLatex}`} display />}
        {global.isHamiltonian && global.hamiltonianLatex && (
          <Katex tex={global.hamiltonianLatex.trim().startsWith('H') ? global.hamiltonianLatex : `H = ${global.hamiltonianLatex}`} display />
        )}
        {global.symmetries.map((symmetry) => (
          <div key={symmetry.type} className="rounded-xl bg-black/10 p-2 text-sm">
            <Badge>{prettyLabel(symmetry.type)}</Badge>
            <Katex tex={symmetry.formulaLatex} display />
            <p className="opacity-80">{symmetry.geometricImplication}</p>
          </div>
        ))}
        {global.bendixsonDulac && (
          <div className="text-sm">
            <p>{global.bendixsonDulac.applies ? 'Bendixson–Dulac applies.' : 'No Dulac multiplier succeeded.'}</p>
            <Katex tex={`B = ${global.bendixsonDulac.multiplierLatex}`} display />
            <Katex tex={`\\nabla\\cdot(Bf) = ${global.bendixsonDulac.divergenceProductLatex}`} display />
            <p>{global.bendixsonDulac.conclusion}</p>
          </div>
        )}
        {global.lyapunov && (
          <div className="text-sm">
            <Badge tone={global.lyapunov.classification === 'strict_lyapunov' ? 'good' : 'gold'}>{prettyLabel(global.lyapunov.classification)}</Badge>
            <Katex tex={`V = ${global.lyapunov.vLatex}`} display />
            <Katex tex={`\\dot V = ${global.lyapunov.vDotLatex}`} display />
            <RichText text={global.lyapunov.conclusionLatex} />
          </div>
        )}
      </Section>
    </div>
  );
}
