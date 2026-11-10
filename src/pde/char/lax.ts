/**
 * Inviscid Burgers and other convex conservation laws u_t + f(u)_x = 0.
 * The entropy solution is the Hopf–Lax / Lax–Oleinik formula. A single jump
 * is written in closed form (shock or rarefaction).
 */

import { compileMath, exprToLatex } from '../expr';
import type { CharCurve, CharProblem, PdeObject } from '../types';
import type { BuiltChar } from './solveChar';
import { constantOf, parameterValues } from './solveChar';
import { coleHopf } from './viscous';

interface Flux {
  burgers: boolean;
  f: (u: number) => number;
  speed: (u: number) => number;
  dual: (p: number) => number;
  inverse: (p: number) => number;
  latex: string;
}

interface Riemann {
  xJump: number;
  uL: number;
  uR: number;
  rarefaction: boolean;
}

export function solveBurgers(problem: CharProblem): BuiltChar {
  const params = parameterValues(problem);
  const data = readData(problem, params);
  const flux = readFlux(problem, params);
  const nu = problem.parameters.nu?.value ?? 0.05;
  const viscous = coleHopf(data.g, nu);
  const domain = chooseDomain(data.g, data.t0);
  const slopes = slopeRange(data.g);
  const breaking = breakingTime(data.g, slopes);
  const riemann = detectRiemann(data.g);
  const evaluate = buildEvaluate(data, flux, riemann, slopes);
  const curves = riemann ? riemannCurves(riemann, data, domain) : smoothCurves(data, domain, breaking?.t);
  const features: BuiltChar['features'] = ['cole-hopf'];
  const objects: PdeObject[] = [
    { id: 'characteristics', label: 'Characteristics', formulaLatex: 'x=\\xi+t f\'(g(\\xi))', group: 'characteristic', defaultOn: true },
    { id: 'data', label: 'Data', formulaLatex: `u(x,${texNum(data.t0)})=${tex(data.gExpr)}`, group: 'boundary', defaultOn: true },
  ];
  const extras: Partial<BuiltChar> = { viscous, breaking: breaking ?? undefined };

  if (riemann?.rarefaction) {
    features.push('rarefaction');
    const fan = rarefactionLatex(riemann);
    objects.push({ id: 'rarefaction', label: 'Rarefaction', formulaLatex: fan, group: 'region', defaultOn: true });
    extras.rarefactionLatex = fan;
    extras.regions = [
      {
        id: 'rarefaction-fan',
        label: 'Rarefaction',
        formulaLatex: fan,
        polygon: [
          [riemann.xJump, data.t0],
          [riemann.xJump + riemann.uL * (domain.t[1] - data.t0), domain.t[1]],
          [riemann.xJump + riemann.uR * (domain.t[1] - data.t0), domain.t[1]],
        ],
      },
    ];
  } else if (riemann) {
    features.push('shock');
    const shock = shockRecord(riemann, domain, data.t0);
    objects.push({ id: 'shock', label: 'Shock', formulaLatex: shock.latex, group: 'shock', defaultOn: true });
    extras.shock = shock;
    extras.equalArea = equalAreaRiemann(riemann, Math.min(1, domain.t[1]));
  } else if (breaking) {
    const envelope = envelopeOf(data.g, domain);
    if (envelope.points.length > 0) {
      objects.push({ id: 'envelope', label: 'Envelope', formulaLatex: envelope.latex, group: 'envelope', defaultOn: true });
      extras.envelope = envelope;
    }
    if (slopes.max > slopes.min + 1e-6) features.push('shock');
    const sampleT = Math.min(domain.t[1], breaking.t + 0.5);
    if (sampleT > breaking.t) extras.equalArea = equalAreaSmooth(data.g, flux, sampleT, domain);
  }

  const formula = riemann
    ? riemann.rarefaction
      ? extras.rarefactionLatex ?? 'u=(x-x_0)/t'
      : extras.shock?.latex ?? 'u'
    : `u=g(x-t f'(u))`;
  const worked = workedBurgers(problem, data, flux, riemann, breaking, evaluate);

  return {
    exact: riemann !== null,
    formulaLatex: formula,
    generalLatex: `u_t+f(u)_x=0,\\quad f(u)=${flux.latex},\\quad u=\\partial_x\\min_y\\Big(U_0(y)+t f^*\\big(\\tfrac{x-y}{t}\\big)\\Big)`,
    evaluate,
    curves,
    dataCurve: linspace(domain.x[0], domain.x[1], 24).map((x) => ({ x, t: data.t0, u: data.g(x) })),
    objects,
    notes: [
      {
        id: 'lax',
        title: 'Lax–Oleinik',
        latex: `With \\(f^*=${flux.burgers ? 'p^2/2' : "f^*"}\\), \\(y^*=\\arg\\min(U_0(y)+t f^*((x-y)/t))\\) and \\(u=(f')^{-1}((x-y^*)/t)\\).`,
      },
    ],
    workedLatex: worked,
    features,
    warnings: [],
    transversalityLatex: 'The initial line is nowhere characteristic for a scalar conservation law: every speed crosses t=constant.',
    domainX: domain.x,
    domainT: domain.t,
    residualKind: 'burgers',
    ...extras,
  };
}

function buildEvaluate(
  data: Data,
  flux: Flux,
  riemann: Riemann | null,
  slopes: { min: number; max: number },
): (x: number, t: number) => number {
  if (riemann) {
    return (x, t) => {
      if (t <= data.t0 + 1e-12) return data.g(x);
      const dt = t - data.t0;
      const xi = (x - riemann.xJump) / dt;
      if (riemann.rarefaction) {
        if (xi <= riemann.uL) return riemann.uL;
        if (xi >= riemann.uR) return riemann.uR;
        return xi;
      }
      const speed = 0.5 * (riemann.uL + riemann.uR);
      return x < riemann.xJump + speed * dt ? riemann.uL : riemann.uR;
    };
  }
  const grid = hopfGrid(data.g, [-12, 12], 401);
  return (x, t) => {
    if (t <= data.t0 + 1e-10) return data.g(x);
    const dt = t - data.t0;
    const folded = slopes.min < -1 / dt && slopes.max > -1 / dt;
    if (!folded) {
      const foot = invertFoot(x, dt, data.g, slopes);
      if (foot !== null) return data.g(foot);
    }
    return laxOleinik(x, dt, flux, grid, data.g);
  };
}

function invertFoot(x: number, dt: number, g: (x: number) => number, slopes: { min: number; max: number }): number | null {
  const bound = 8 + Math.abs(x) + dt * (1 + Math.max(Math.abs(slopes.min), Math.abs(slopes.max), 1));
  let lo = x - bound;
  let hi = x + bound;
  const residual = (xi: number) => xi + dt * g(xi) - x;
  let flo = residual(lo);
  let fhi = residual(hi);
  for (let expand = 0; expand < 6 && flo * fhi > 0; expand += 1) {
    lo -= bound;
    hi += bound;
    flo = residual(lo);
    fhi = residual(hi);
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let step = 0; step < 60; step += 1) {
    const mid = 0.5 * (lo + hi);
    const value = residual(mid);
    if (Math.abs(value) < 1e-12 || hi - lo < 1e-12) return mid;
    if (value * flo <= 0) {
      hi = mid;
      fhi = value;
    } else {
      lo = mid;
      flo = value;
    }
  }
  return 0.5 * (lo + hi);
}

interface Grid {
  ys: number[];
  U: number[];
}

function hopfGrid(g: (x: number) => number, span: [number, number], count: number): Grid {
  const ys = linspace(span[0], span[1], count);
  const U = [0];
  for (let index = 1; index < ys.length; index += 1) {
    const width = (ys[index] ?? 0) - (ys[index - 1] ?? 0);
    const trap = 0.5 * (g(ys[index - 1] ?? 0) + g(ys[index] ?? 0)) * width;
    U.push((U[index - 1] ?? 0) + trap);
  }
  return { ys, U };
}

function prefix(grid: Grid, y: number): number {
  const { ys, U } = grid;
  if (y <= (ys[0] ?? 0)) return U[0] ?? 0;
  const last = ys.length - 1;
  if (y >= (ys[last] ?? 0)) return U[last] ?? 0;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((ys[mid] ?? 0) <= y) lo = mid;
    else hi = mid;
  }
  const y0 = ys[lo] ?? 0;
  const y1 = ys[hi] ?? y0;
  const blend = (y - y0) / (y1 - y0 || 1);
  return (U[lo] ?? 0) * (1 - blend) + (U[hi] ?? 0) * blend;
}

function laxOleinik(x: number, dt: number, flux: Flux, grid: Grid, g: (y: number) => number): number {
  const cost = (y: number) => prefix(grid, y) + dt * flux.dual((x - y) / dt);
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let index = 0; index < grid.ys.length; index += 1) {
    const value = cost(grid.ys[index] ?? 0);
    if (value < best) {
      best = value;
      bestIndex = index;
    }
  }
  const step = (grid.ys[1] ?? 0) - (grid.ys[0] ?? 0) || 0.05;
  const yStar = goldenMin(cost, (grid.ys[bestIndex] ?? x) - 2 * step, (grid.ys[bestIndex] ?? x) + 2 * step);
  const speed = flux.inverse((x - yStar) / dt);
  if (!Number.isFinite(speed)) return g(x);
  return speed;
}

function goldenMin(fn: (y: number) => number, left: number, right: number): number {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = left;
  let b = right;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  let fc = fn(c);
  let fd = fn(d);
  for (let step = 0; step < 40; step += 1) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - ratio * (b - a);
      fc = fn(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + ratio * (b - a);
      fd = fn(d);
    }
  }
  return fc <= fd ? c : d;
}

function detectRiemann(g: (x: number) => number): Riemann | null {
  const xs = linspace(-8, 8, 321);
  const values = xs.map((x) => g(x));
  let total = 0;
  for (let index = 0; index < values.length - 1; index += 1) total += Math.abs((values[index + 1] ?? 0) - (values[index] ?? 0));
  let maxJump = 0;
  let rough = 0;
  for (const x of xs) {
    const jump = Math.abs(g(x + 0.3) - g(x - 0.3));
    if (jump > maxJump) {
      maxJump = jump;
      rough = x;
    }
  }
  if (maxJump < 0.2 || maxJump < 0.75 * Math.max(total, maxJump)) return null;
  const left = values.filter((_, index) => (xs[index] ?? 0) < rough - 0.35);
  const right = values.filter((_, index) => (xs[index] ?? 0) > rough + 0.35);
  if (left.length < 5 || right.length < 5) return null;
  const uL = average(left);
  const uR = average(right);
  if (Math.abs(uL - uR) < 1e-6) return null;
  if (spread(left) > 0.08 * Math.abs(uL - uR) + 1e-3) return null;
  if (spread(right) > 0.08 * Math.abs(uL - uR) + 1e-3) return null;
  const mid = 0.5 * (uL + uR);
  let lo = rough - 0.3;
  let hi = rough + 0.3;
  if ((g(lo) - mid) * (g(hi) - mid) > 0) return { xJump: rough, uL, uR, rarefaction: uL < uR };
  for (let step = 0; step < 40; step += 1) {
    const x = 0.5 * (lo + hi);
    if ((g(x) - mid > 0) === (g(lo) - mid > 0)) lo = x;
    else hi = x;
  }
  return { xJump: 0.5 * (lo + hi), uL, uR, rarefaction: uL < uR };
}

function slopeRange(g: (x: number) => number): { min: number; max: number; xAtMin: number } {
  const h = 1e-3;
  let min = 0;
  let max = 0;
  let xAtMin = 0;
  for (const x of linspace(-4, 4, 161)) {
    const slope = (g(x + h) - g(x - h)) / (2 * h);
    if (!Number.isFinite(slope)) continue;
    if (slope < min) {
      min = slope;
      xAtMin = x;
    }
    if (slope > max) max = slope;
  }
  return { min, max, xAtMin };
}

function breakingTime(g: (x: number) => number, slopes: { min: number; max: number; xAtMin: number }): BuiltChar['breaking'] {
  if (slopes.min >= -1e-6) return undefined;
  const t = -1 / slopes.min;
  const x = slopes.xAtMin + g(slopes.xAtMin) * t;
  return {
    t,
    x,
    latex: `t^*=-1/\\min g'=${texNum(t)}`,
  };
}

function shockRecord(riemann: Riemann, domain: Window, t0: number): NonNullable<BuiltChar['shock']> {
  const speed = 0.5 * (riemann.uL + riemann.uR);
  const times = linspace(t0, domain.t[1], 16);
  const lax = `${texNum(riemann.uL)}>${texNum(speed)}>${texNum(riemann.uR)}`;
  return {
    points: times.map((t) => [riemann.xJump + speed * (t - t0), t]),
    latex: `x=${texNum(riemann.xJump)}+${texNum(speed)}\\, t`,
    speedLatex: `s=(u_L+u_R)/2=${texNum(speed)}`,
    laxLatex: `u_L>s>u_R:\\ ${lax}`,
  };
}

function rarefactionLatex(riemann: Riemann): string {
  return `u=\\begin{cases}${texNum(riemann.uL)}&x\\le ${texNum(riemann.xJump)}+${texNum(riemann.uL)}t\\\\ (x-${texNum(riemann.xJump)})/t&${texNum(riemann.uL)}<(x-${texNum(riemann.xJump)})/t<${texNum(riemann.uR)}\\\\ ${texNum(riemann.uR)}&x\\ge ${texNum(riemann.xJump)}+${texNum(riemann.uR)}t\\end{cases}`;
}

function equalAreaRiemann(riemann: Riemann, t: number): NonNullable<BuiltChar['equalArea']> {
  const speed = 0.5 * (riemann.uL + riemann.uR);
  const shockX = riemann.xJump + speed * t;
  const yL = shockX - riemann.uL * t;
  const yR = shockX - riemann.uR * t;
  const lo = Math.min(yL, yR);
  const hi = Math.max(yL, yR);
  const integral = stepIntegral(lo, hi, riemann);
  const chord = 0.5 * (riemann.uL + riemann.uR) * (hi - lo);
  const leftEdge = riemann.xJump + Math.min(riemann.uL, riemann.uR) * t;
  const rightEdge = riemann.xJump + Math.max(riemann.uL, riemann.uR) * t;
  const xs = linspace(leftEdge - 0.5, rightEdge + 0.5, 9);
  return {
    t,
    shockX,
    areaGap: Math.abs(integral - chord),
    multivalued: xs.map((x) => {
      const values: number[] = [];
      if (x <= rightEdge) values.push(riemann.uL);
      if (x >= leftEdge) values.push(riemann.uR);
      return { x, values: values.length > 0 ? values : [x < shockX ? riemann.uL : riemann.uR] };
    }),
  };
}

function stepIntegral(lo: number, hi: number, riemann: Riemann): number {
  const cutL = Math.max(lo, Math.min(hi, riemann.xJump));
  return riemann.uL * Math.max(0, cutL - lo) + riemann.uR * Math.max(0, hi - cutL);
}

function equalAreaSmooth(g: (x: number) => number, flux: Flux, t: number, domain: Window): NonNullable<BuiltChar['equalArea']> | undefined {
  if (!flux.burgers || !(t > 0)) return undefined;
  const feet = linspace(domain.x[0] - 2, domain.x[1] + 2, 80);
  const images = feet.map((xi) => ({ xi, x: xi + t * g(xi), u: g(xi) }));
  let bestGap = Number.POSITIVE_INFINITY;
  let best: { shockX: number; yL: number; yR: number; uL: number; uR: number } | null = null;
  const prefixG = hopfGrid(g, [domain.x[0] - 3, domain.x[1] + 3], 241);
  for (let i = 0; i < images.length; i += 1) {
    for (let j = i + 2; j < images.length; j += 1) {
      const left = images[i];
      const right = images[j];
      if (!left || !right || left.u <= right.u) continue;
      const xGap = Math.abs(left.x - right.x);
      const integral = prefix(prefixG, right.xi) - prefix(prefixG, left.xi);
      const chord = 0.5 * (left.u + right.u) * (right.xi - left.xi);
      const gap = Math.abs(integral - chord);
      const score = gap + xGap;
      if (score < bestGap) {
        bestGap = score;
        best = { shockX: 0.5 * (left.x + right.x), yL: left.xi, yR: right.xi, uL: left.u, uR: right.u };
      }
    }
  }
  if (!best) return undefined;
  const xs = linspace(domain.x[0], domain.x[1], 11);
  return {
    t,
    shockX: best.shockX,
    areaGap: Math.abs(prefix(prefixG, best.yR) - prefix(prefixG, best.yL) - 0.5 * (best.uL + best.uR) * (best.yR - best.yL)),
    multivalued: xs.map((x) => {
      const values = images.filter((image) => Math.abs(image.x - x) < 0.15).map((image) => image.u);
      const unique = values.filter((value, index) => values.findIndex((other) => Math.abs(other - value) < 1e-3) === index);
      return { x, values: unique.length > 0 ? unique.slice(0, 3) : [g(x)] };
    }),
  };
}

function envelopeOf(g: (x: number) => number, domain: Window): NonNullable<BuiltChar['envelope']> {
  const h = 1e-3;
  const points: number[][] = [];
  for (const x0 of linspace(domain.x[0], domain.x[1], 41)) {
    const slope = (g(x0 + h) - g(x0 - h)) / (2 * h);
    if (!(slope < -1e-4)) continue;
    const t = -1 / slope;
    if (t < 0 || t > 20) continue;
    points.push([x0 + g(x0) * t, t]);
  }
  return { points, latex: `t=-1/g'(x_0),\\ x=x_0+g(x_0)t` };
}

function riemannCurves(riemann: Riemann, data: Data, domain: Window): CharCurve[] {
  const t1 = domain.t[1];
  const speed = 0.5 * (riemann.uL + riemann.uR);
  const plateauCount = riemann.rarefaction ? 4 : 6;
  const leftFeet = linspace(domain.x[0], riemann.xJump - 0.05, plateauCount);
  const rightFeet = linspace(riemann.xJump + 0.05, domain.x[1], plateauCount);
  const plateau = (x0: number, u0: number, index: number, side: string): CharCurve => {
    const hit = Math.abs(u0 - speed) > 1e-8 ? (riemann.xJump - x0) / (u0 - speed) : t1;
    const tEnd = riemann.rarefaction ? t1 : Math.max(data.t0, Math.min(t1, hit > 0 ? hit : t1));
    return {
      id: `char-${side}-${index}`,
      invariantLatex: `x-${texNum(u0)} t=${texNum(x0)}`,
      carriedLatex: `u=${texNum(u0)}`,
      points: linspace(data.t0, tEnd, 10).map((t) => ({ x: x0 + u0 * (t - data.t0), t, u: u0 })),
    };
  };
  const fan: CharCurve[] = riemann.rarefaction
    ? linspace(riemann.uL, riemann.uR, 4).map((speedRay, index) => ({
        id: `fan-${index}`,
        invariantLatex: `x/t=${texNum(speedRay)}`,
        carriedLatex: `u=${texNum(speedRay)}`,
        points: linspace(data.t0, t1, 10).map((t) => ({
          x: riemann.xJump + speedRay * (t - data.t0),
          t,
          u: speedRay,
        })),
      }))
    : [];
  return [
    ...leftFeet.map((x0, index) => plateau(x0, riemann.uL, index, 'L')),
    ...rightFeet.map((x0, index) => plateau(x0, riemann.uR, index, 'R')),
    ...fan,
  ].slice(0, 12);
}

function smoothCurves(data: Data, domain: Window, breakingT: number | undefined): CharCurve[] {
  const t1 = breakingT && breakingT < domain.t[1] ? Math.min(domain.t[1], breakingT) : domain.t[1];
  return linspace(domain.x[0], domain.x[1], 12).map((x0, index) => {
    const u0 = data.g(x0);
    return {
      id: `char-${index}`,
      invariantLatex: `x-${texNum(u0)} t=${texNum(x0)}`,
      carriedLatex: `u=${texNum(u0)}`,
      points: linspace(data.t0, t1, 12).map((t) => ({ x: x0 + u0 * (t - data.t0), t, u: u0 })),
    };
  });
}

function workedBurgers(
  problem: CharProblem,
  data: Data,
  flux: Flux,
  riemann: Riemann | null,
  breaking: BuiltChar['breaking'],
  evaluate: (x: number, t: number) => number,
): string {
  const lines = [
    problem.equationLatex,
    `This is \\(u_t+f(u)_x=0\\) with \\(f(u)=${flux.latex}\\). The characteristic speed is \\(f'(u)\\), so \\(u=g(x-t f'(u))\\) until breaking.`,
    `The invariant along a ray is the value of \\(u\\). Eliminating the foot gives the implicit profile.`,
    `Data: \\(u(x,${texNum(data.t0)})=${tex(data.gExpr)}\\).`,
  ];
  if (breaking) lines.push(`The first breaking time is \\(${breaking.latex}\\) at \\(x=${texNum(breaking.x)}\\).`);
  if (riemann?.rarefaction) {
    lines.push(`The jump \\(u_L=${texNum(riemann.uL)}<u_R=${texNum(riemann.uR)}\\) is a rarefaction centred at \\(x=${texNum(riemann.xJump)}\\): \\(u=(x-x_0)/t\\) between the edge speeds. No shock.`);
  } else if (riemann) {
    const speed = 0.5 * (riemann.uL + riemann.uR);
    lines.push(`Rankine–Hugoniot speed \\(s=(u_L+u_R)/2=${texNum(speed)}\\). Lax inequality \\(u_L>s>u_R\\) selects this shock.`);
    lines.push(`Lax–Oleinik: \\(U_0=\\int g\\), \\(f^*(p)=p^2/2\\), \\(u=(x-y^*)/t\\) with \\(y^*=\\arg\\min(U_0(y)+t f^*((x-y)/t))\\).`);
  } else {
    lines.push(`After breaking, the entropy solution is the Lax–Oleinik minimiser, not the multivalued characteristic profile. Equal-area places the shock where the two lobes match.`);
  }
  lines.push(`Check: \\(u(0.4,1)=${texNum(evaluate(0.4, 1))}\\).`);
  return lines.join(' ');
}

function readFlux(problem: CharProblem, params: Record<string, number>): Flux {
  const b = constantOf(problem.bExpr, params) ?? 1;
  const speedOf = compileMath(problem.aExpr, ['U', 'u', 'x', 't', 'y']);
  const speed = (u: number) => {
    const value = speedOf({ ...params, U: u, u, x: 0, t: 0, y: 0 }) / b;
    return Number.isFinite(value) ? value : u;
  };
  const burgers = [0, 0.5, 1, -1, 2].every((u) => Math.abs(speed(u) - u) < 1e-6);
  if (burgers) {
    return { burgers: true, f: (u) => (u * u) / 2, speed, dual: (p) => (p * p) / 2, inverse: (p) => p, latex: 'u^2/2' };
  }
  const f = (u: number) => {
    const steps = 40;
    const h = u / steps;
    let acc = 0;
    for (let index = 0; index < steps; index += 1) acc += speed((index + 0.5) * h) * h;
    return acc;
  };
  return {
    burgers: false,
    f,
    speed,
    dual: (p) => legendre(f, p).value,
    inverse: (p) => legendre(f, p).u,
    latex: problem.fluxExpr ? exprToLatex(problem.fluxExpr) : 'f(u)',
  };
}

function legendre(f: (u: number) => number, p: number): { value: number; u: number } {
  let bestU = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (const u of linspace(-8, 8, 81)) {
    const value = p * u - f(u);
    if (value > best) {
      best = value;
      bestU = u;
    }
  }
  return { value: best, u: bestU };
}

interface Data {
  g: (x: number) => number;
  gExpr: string;
  t0: number;
}

function readData(problem: CharProblem, params: Record<string, number>): Data {
  const gExpr = problem.data.kind === 'cauchy' ? problem.data.gExpr : '0';
  const t0 = problem.data.kind === 'cauchy' ? (constantOf(problem.data.timeExpr, params) ?? 0) : 0;
  const fn = compileMath(gExpr, ['x', 't', 'y']);
  return {
    gExpr,
    t0,
    g: (x: number) => {
      const value = fn({ ...params, x, t: t0, y: t0 });
      return Number.isFinite(value) ? value : 0;
    },
  };
}

interface Window {
  x: [number, number];
  t: [number, number];
}

function chooseDomain(g: (x: number) => number, t0: number): Window {
  const values = linspace(-6, 6, 25).map((x) => g(x));
  const maxAbs = Math.max(...values.map((value) => Math.abs(value)));
  const rounded = new Set(values.map((value) => Math.round(value * 10) / 10));
  const x: [number, number] = maxAbs > 2.5 || rounded.size <= 3 ? [-3, 3] : [-2 * Math.PI, 2 * Math.PI];
  return { x, t: [Math.min(0, t0), Math.max(2, t0 + 2)] };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function linspace(start: number, end: number, count: number): number[] {
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

function tex(expr: string): string {
  try {
    return exprToLatex(expr);
  } catch {
    return expr;
  }
}

function texNum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1e6) / 1e6);
}
