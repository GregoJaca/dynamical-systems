import type {
  ApplicableTheorem,
  EquilibriumAnalysis,
  NumericAnalysis,
  SymmetryInfo,
} from '../core/types';

export interface TheoremContext {
  isAutonomous?: boolean;
  isLinear?: boolean;
  dimension?: number;
}

const REAL_EPS = 1e-7;

function num(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-10) return '0';
  const rounded = Math.round(value * 1e8) / 1e8;
  return String(rounded);
}

export function equilibriumLatex(eq: EquilibriumAnalysis): string {
  const parts = eq.coordsExactLatex?.length ? eq.coordsExactLatex : eq.coords.map((coord) => num(coord));
  return `\\left(${parts.join(', ')}\\right)`;
}

export function eigenvalueLatex(eq: EquilibriumAnalysis): string {
  if (eq.eigenvalues.length === 0) return '';
  return eq.eigenvalues
    .map((eigenvalue) => {
      const body =
        eigenvalue.exactLatex ??
        (Math.abs(eigenvalue.im) < 1e-10
          ? num(eigenvalue.re)
          : `${num(eigenvalue.re)}${eigenvalue.im >= 0 ? '+' : '-'}${num(Math.abs(eigenvalue.im))}i`);
      return eigenvalue.multiplicity > 1 ? `${body}\\ (\\mathrm{mult.}\\ ${eigenvalue.multiplicity})` : body;
    })
    .join(', ');
}

function tex(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(\$|\\\(|\\\[)/.test(trimmed)) return trimmed;
  return `$${trimmed}$`;
}

function dimensionOf(analysis: NumericAnalysis, context?: TheoremContext): number {
  if (context?.dimension && context.dimension > 0) return context.dimension;
  return analysis.equilibria[0]?.coords.length ?? (analysis.coordinateTransforms.cylindrical3D || analysis.coordinateTransforms.spherical3D ? 3 : 2);
}

function listEquilibria(equilibria: EquilibriumAnalysis[], limit = 6): string {
  const shown = equilibria.slice(0, limit).map((eq) => equilibriumLatex(eq));
  const extra = equilibria.length > limit ? `,\\ldots` : '';
  return shown.join(', ') + extra;
}

function hasBothSigns(eq: EquilibriumAnalysis): boolean {
  const stable = eq.eigenvalues.some((eigenvalue) => eigenvalue.re < -REAL_EPS) || eq.subspaces.some((space) => space.kind === 'Es' && space.dimension > 0);
  const unstable = eq.eigenvalues.some((eigenvalue) => eigenvalue.re > REAL_EPS) || eq.subspaces.some((space) => space.kind === 'Eu' && space.dimension > 0);
  return stable && unstable;
}

function isHyperbolic(eq: EquilibriumAnalysis): boolean {
  if (eq.eigenvalues.length > 0 && eq.eigenvalues.every((eigenvalue) => Math.abs(eigenvalue.re) > REAL_EPS)) return true;
  return eq.isHyperbolic;
}

function isCenter(eq: EquilibriumAnalysis): boolean {
  if (eq.classification2D === 'linear_center' || eq.classification2D === 'nonlinear_center') return true;
  return (
    eq.coords.length === 2 &&
    eq.eigenvalues.length >= 2 &&
    eq.eigenvalues.every((eigenvalue) => Math.abs(eigenvalue.re) <= REAL_EPS && Math.abs(eigenvalue.im) > REAL_EPS)
  );
}

function onReversibilityAxis(eq: EquilibriumAnalysis, symmetry: SymmetryInfo): boolean {
  if (symmetry.type === 'time_reversible_x') return Math.abs(eq.coords[1] ?? 1) <= 1e-6;
  if (symmetry.type === 'time_reversible_y') return Math.abs(eq.coords[0] ?? 1) <= 1e-6;
  return false;
}

function realNilpotentSpectrum(eq: EquilibriumAnalysis): boolean {
  if (eq.classification2D === 'cusp' || eq.classification2D === 'saddle_node') return true;
  if (eq.coords.length !== 2 || eq.eigenvalues.length < 2) return false;
  if (!eq.eigenvalues.every((eigenvalue) => Math.abs(eigenvalue.im) <= REAL_EPS)) return false;
  return eq.eigenvalues.some((eigenvalue) => Math.abs(eigenvalue.re) <= REAL_EPS);
}

function radialCycle(analysis: NumericAnalysis): boolean {
  const polar = analysis.coordinateTransforms.polar2D;
  if (!polar) return false;
  if (polar.thetaDotExpr.replace(/\s+/g, '') === '0') return false;
  return polar.radialEquilibriaR.some((radius, index) => radius > 1e-5 && polar.radialStability[index] !== 'unknown');
}

function theorem(
  id: string,
  name: string,
  perkoReference: string,
  statementLatex: string,
  applicationToSystemLatex: string,
): ApplicableTheorem {
  return { id, name, perkoReference, statementLatex, applicationToSystemLatex };
}

/** Pure predicate matcher: which Perko theorems justify the current analysis. */
export function applicableTheorems(analysis: NumericAnalysis, context?: TheoremContext): ApplicableTheorem[] {
  const autonomous = context?.isAutonomous !== false;
  const dimension = dimensionOf(analysis, context);
  const results: ApplicableTheorem[] = [];
  const hyperbolic = analysis.equilibria.filter(isHyperbolic);
  const saddles = analysis.equilibria.filter(hasBothSigns);
  const nonHyperbolic = analysis.equilibria.filter((eq) => !isHyperbolic(eq));
  const centers = analysis.equilibria.filter(isCenter);

  if (autonomous && hyperbolic.length > 0) {
    const descriptions = hyperbolic.slice(0, 4).map((eq) => {
      const spectrum = eigenvalueLatex(eq);
      return `${tex(equilibriumLatex(eq))} with eigenvalues ${tex(spectrum || '\\lambda')}`;
    });
    results.push(
      theorem(
        'hartman-grobman',
        'Hartman–Grobman Theorem',
        'Perko §2.8',
        'Let $x^{*}$ be a hyperbolic equilibrium of a $C^{1}$ vector field. Then the nonlinear flow is topologically conjugate to its linearization $\\dot\\xi = Df(x^{*})\\xi$ in a neighborhood of $x^{*}$.',
        `Hyperbolic equilibria ${descriptions.join('; ')}. Each is locally topologically equivalent to its linearization, inside a Hartman–Grobman neighborhood.`,
      ),
    );
    const saddleNote =
      saddles.length > 0
        ? `Saddles ${tex(listEquilibria(saddles))} have immersed stable and unstable manifolds tangent to $E^{s}$ and $E^{u}$.`
        : `At ${tex(listEquilibria(hyperbolic))} the stable or unstable manifold fills a neighborhood of the equilibrium.`;
    results.push(
      theorem(
        'stable-unstable-manifolds',
        'Stable and Unstable Manifold Theorem',
        'Perko §2.7',
        'If $x^{*}$ is hyperbolic, then $W^{s}(x^{*})$ and $W^{u}(x^{*})$ are immersed $C^{r}$ manifolds of dimensions equal to the number of eigenvalues with negative and positive real part, and they are tangent at $x^{*}$ to $E^{s}$ and $E^{u}$.',
        saddleNote,
      ),
    );
  }

  const centerEvidence =
    nonHyperbolic.length > 0 || analysis.manifolds.some((branch) => branch.kind === 'Wc') || analysis.equilibria.some((eq) => eq.subspaces.some((space) => space.kind === 'Ec' && space.dimension > 0));
  if (autonomous && centerEvidence) {
    const subjects = (nonHyperbolic.length > 0 ? nonHyperbolic : analysis.equilibria).slice(0, 4);
    const reductions = analysis.manifolds
      .filter((branch) => branch.kind === 'Wc' && branch.reducedDynamicsLatex)
      .slice(0, 3)
      .map((branch) => branch.reducedDynamicsLatex);
    const reductionText = reductions.length > 0 ? ` Reduced dynamics: ${reductions.map((item) => tex(item ?? '')).join('; ')}.` : '';
    results.push(
      theorem(
        'center-manifold',
        'Local Center Manifold Theorem',
        'Perko §2.12',
        'If $Df(x^{*})$ has $n_{c}$ eigenvalues of zero real part, there is a local center manifold $W^{c}$ of dimension $n_{c}$, tangent to $E^{c}$, and the stability of $x^{*}$ is determined by the reduced flow on $W^{c}$.',
        `Non-hyperbolic equilibria ${tex(listEquilibria(subjects))} admit a local center manifold.${reductionText}`,
      ),
    );
  }

  const lyapunov = analysis.global.lyapunov;
  if (lyapunov && lyapunov.classification !== 'indefinite') {
    const verdict =
      lyapunov.classification === 'strict_lyapunov'
        ? 'negative definite, so the equilibrium is asymptotically stable'
        : lyapunov.classification === 'conserved_first_integral'
          ? 'identically zero, so $V$ is a first integral and nearby level sets are invariant'
          : "negative semi-definite, so LaSalle's principle confines the $\\omega$-limit set to $\\{\\dot V = 0\\}$";
    results.push(
      theorem(
        'lyapunov-lasalle',
        "Lyapunov Stability and LaSalle's Invariance Principle",
        'Perko §2.9',
        'If $V$ is positive definite and $\\dot V$ is negative definite, then $x^{*}$ is asymptotically stable. If $\\dot V \\le 0$, every orbit starting near $x^{*}$ approaches the largest invariant set inside $\\{\\dot V = 0\\}$.',
        `Take ${tex(lyapunov.vLatex)}. Then ${tex(lyapunov.vDotLatex)}, which is ${verdict}. ${lyapunov.conclusionLatex}`,
      ),
    );
  }

  const nilpotent = analysis.equilibria.filter(realNilpotentSpectrum);
  if (autonomous && dimension === 2 && nilpotent.length > 0) {
    results.push(
      theorem(
        'andronov-nilpotent',
        'Andronov–Leontovich Nilpotent Classification',
        'Perko §2.11',
        'A planar equilibrium whose linear part is zero or nilpotent is topologically a cusp, saddle-node, or a focus/center according to the first nonvanishing jet of its orbital normal form.',
        `The classification applies at ${tex(listEquilibria(nilpotent))}. ${nilpotent
          .map((eq) => `${tex(equilibriumLatex(eq))} is a ${eq.classification2D?.replaceAll('_', ' ') ?? 'non-hyperbolic point'}`)
          .join('; ')}.`,
      ),
    );
  }

  const reversible = analysis.global.symmetries.filter(
    (symmetry) => symmetry.type === 'time_reversible_x' || symmetry.type === 'time_reversible_y',
  );
  const reversibleCenters = centers.filter((eq) => reversible.some((symmetry) => onReversibilityAxis(eq, symmetry)));
  if (autonomous && reversibleCenters.length > 0) {
    const formulas = reversible.map((symmetry) => symmetry.formulaLatex).join(', ');
    results.push(
      theorem(
        'reversible-center',
        'Time-Reversible Center Theorem',
        'Perko §2.10',
        'If $\\dot x = f(x)$ is $R$-reversible and $x^{*} \\in \\mathrm{Fix}(R)$ is a linear center, then $x^{*}$ is a nonlinear center: a neighborhood is filled with periodic orbits.',
        `The field is reversible under ${tex(formulas)}. ${tex(listEquilibria(reversibleCenters))} lies on the fixed-point axis and is a center, so the linear center survives the nonlinear terms.`,
      ),
    );
  }

  if (autonomous && dimension === 2 && (analysis.limitCycles.length > 0 || radialCycle(analysis))) {
    const cycles = analysis.limitCycles
      .slice(0, 4)
      .map((cycle) => cycle.formulaLatex ?? (cycle.radius !== undefined ? `r = ${num(cycle.radius)}` : cycle.id));
    const radial = analysis.coordinateTransforms.polar2D?.radialEquilibriaR.filter((radius) => radius > 1e-5).map((radius) => num(radius)) ?? [];
    const description = cycles.length > 0 ? cycles.join('; ') : radial.map((radius) => `r = ${radius}`).join(', ');
    const orbit = description || 'detected by the radial equation';
    const orbitText = /[=\\]/.test(orbit) ? tex(orbit) : orbit;
    results.push(
      theorem(
        'poincare-bendixson',
        'Poincaré–Bendixson Theorem',
        'Perko §3.7',
        'A nonempty compact limit set of a planar $C^{1}$ flow that contains no equilibrium is a periodic orbit.',
        `The planar phase portrait contains the periodic orbit ${orbitText}.`,
      ),
    );
  }

  const dulac = analysis.global.bendixsonDulac;
  if (autonomous && dimension === 2 && dulac?.applies) {
    results.push(
      theorem(
        'bendixson-dulac',
        'Bendixson–Dulac Criterion',
        'Perko §3.9',
        'If $B$ is $C^{1}$ on a simply connected region $D$ and $\\nabla\\cdot(Bf)$ does not change sign and is not identically zero, then $D$ contains no periodic orbit.',
        `With multiplier ${tex(dulac.multiplierLatex)}, one has ${tex(`\\nabla\\cdot(Bf) = ${dulac.divergenceProductLatex}`)}. ${dulac.conclusion}`,
      ),
    );
  }

  if (autonomous && dimension === 2 && analysis.equilibria.length > 0) {
    const indexed = analysis.equilibria
      .filter((eq) => eq.poincareIndex2D !== undefined)
      .slice(0, 6)
      .map((eq) => `${equilibriumLatex(eq)}\\ (I = ${eq.poincareIndex2D})`);
    results.push(
      theorem(
        'poincare-index',
        'Poincaré Index Theorem',
        'Perko §3.12',
        'The Poincaré index of a closed orbit is $+1$, and it equals the sum of the indices of the equilibria in its interior. A saddle has index $-1$; a node, focus, or center has index $+1$; a cusp or saddle-node has index $0$.',
        indexed.length > 0
          ? `Computed indices: ${indexed.map((item) => tex(item)).join(', ')}.`
          : `The theorem constrains every periodic orbit of this planar system by the equilibria ${tex(listEquilibria(analysis.equilibria))}.`,
      ),
    );
  }

  return results;
}
