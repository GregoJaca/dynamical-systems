import { compileSystemNumeric } from '../src/input/parser';
import { integrateRK45 } from '../src/numeric/rk45';
import { exampleById, exampleToSpec } from '../src/examples/perkoExamples';

const compiled = compileSystemNumeric(exampleToSpec(exampleById('exam-17')!));
const params = compiled.parameterValues;
const P = (x: number, y: number) => x * y;
const Q = (x: number, y: number) => (4 * x * x + y * y - 1) * (x * x + 4 * y * y - 4);

const s = 1 / Math.sqrt(30);
const lambda = 2 * Math.sqrt(30);
const tangent = [s, 1];
const transverse = [s, -1];
const det = tangent[0]! * transverse[1]! - tangent[1]! * transverse[0]!;
const inv00 = transverse[1]! / det;
const inv01 = -transverse[0]! / det;
const inv10 = -tangent[1]! / det;
const inv11 = tangent[0]! / det;

function uvField(u: number, v: number) {
  const x = 2 + tangent[0]! * u + transverse[0]! * v;
  const y = tangent[1]! * u + transverse[1]! * v;
  const f = P(x, y);
  const g = Q(x, y);
  return [inv00 * f + inv01 * g, inv10 * f + inv11 * g];
}

const eps = 1e-5;
const fPlus = uvField(eps, 0);
const fMinus = uvField(-eps, 0);
const fV = uvField(0, eps);
console.log('du/du numerical', ((fPlus[0]! - fMinus[0]!) / (2 * eps)).toFixed(6), 'expected', lambda.toFixed(6));
console.log('dv/dv numerical', ((uvField(0, eps)[1]! - uvField(0, -eps)[1]!) / (2 * eps)).toFixed(6), 'expected', (-lambda).toFixed(6));
console.log('cross du/dv', ((fV[0]! - uvField(0, -eps)[0]!) / (2 * eps)).toExponential(2));

// Jet of the graph by finite differences is unnecessary; use the recursion on sampled Taylor of the field via automatic monomials, evaluated by interpolation? 
// Just integrate the invariance ODE as a power series using Cauchy products from jet of uvField computed by complex-step / finite differences on a tensor.
// Multivariate finite difference up to degree 8 is enough to see the reverted x(y) coefficients.

function jet() {
  const deg = 8;
  const coeff: number[][] = Array.from({ length: deg + 1 }, () => Array(deg + 1).fill(0));
  // finite differences on a small square using the discrete Taylor formula is messy.
  // Exact: expand with the known polynomial by evaluating partial derivatives analytically through automatic differentiation of monomials.
  // Since uvField is rational? No, polynomial. Use incremental AD: represent value as jet in (u,v) truncated.
  type J = number[][];
  const cnst = (c: number): J => {
    const m = Array.from({ length: deg + 1 }, () => Array(deg + 1).fill(0));
    m[0]![0] = c;
    return m;
  };
  const mono = (i: number, j: number, c = 1): J => {
    const m = cnst(0);
    if (i <= deg && j <= deg) m[i]![j] = c;
    return m;
  };
  const add = (a: J, b: J, s = 1): J => a.map((row, i) => row.map((value, j) => value + s * (b[i]?.[j] ?? 0)));
  const mul = (a: J, b: J): J => {
    const m = cnst(0);
    for (let i = 0; i <= deg; i += 1) for (let j = 0; j <= deg - i; j += 1) {
      const av = a[i]![j]!;
      if (!av) continue;
      for (let k = 0; k <= deg - i; k += 1) for (let l = 0; l <= deg - i - k - j; l += 1) {
        m[i + k]![j + l] += av * (b[k]![l] ?? 0);
      }
    }
    return m;
  };
  const X = add(add(cnst(2), mono(1, 0, tangent[0]!)), mono(0, 1, transverse[0]!));
  const Y = add(mono(1, 0, tangent[1]!), mono(0, 1, transverse[1]!));
  const f = mul(X, Y);
  const inner = add(add(mul(X, X), mul(Y, Y), 0.25), cnst(-0.25), 4);
  const outer = add(add(mul(X, X), mul(Y, Y), 4), cnst(-4));
  const g = mul(inner, outer);
  const U = add(mul(f, cnst(inv00)), mul(g, cnst(inv01)));
  const V = add(mul(f, cnst(inv10)), mul(g, cnst(inv11)));
  console.log('jet U_u', U[1]![0], 'U_v', U[0]![1], 'V_u', V[1]![0], 'V_v', V[0]![1]);
  const h = Array(deg + 1).fill(0);
  for (let degree = 2; degree <= deg; degree += 1) {
    const powers: J[] = [cnst(1)];
    for (let p = 1; p <= deg; p += 1) {
      const prev = powers[p - 1]!;
      const next = cnst(0);
      for (let i = 0; i <= deg; i += 1) {
        const hv = h[i] ?? 0;
        if (!hv) continue;
        for (let k = 0; k <= deg - i; k += 1) for (let l = 0; l <= deg - i - k; l += 1) next[k + i]![l] += hv * (prev[k]![l] ?? 0);
      }
      powers.push(next);
    }
    const compose = (poly: J) => {
      const out = Array(deg + 1).fill(0);
      for (let i = 0; i <= deg; i += 1) for (let j = 0; j <= deg - i; j += 1) {
        const w = poly[i]![j]!;
        if (!w) continue;
        const pw = powers[j]!;
        for (let n = 0; n <= deg - i; n += 1) out[i + n] += w * (pw[n]![0] ?? 0);
      }
      return out;
    };
    const left = compose(U);
    const right = compose(V);
    const hp = Array(deg + 1).fill(0);
    for (let i = 1; i <= deg; i += 1) hp[i - 1] = i * (h[i] ?? 0);
    const product = Array(deg + 1).fill(0);
    for (let i = 0; i <= deg; i += 1) for (let j = 0; j <= deg - i; j += 1) product[i + j] += hp[i]! * left[j]!;
    h[degree] = ((right[degree] ?? 0) - (product[degree] ?? 0)) / (degree * lambda - (-lambda));
  }
  console.log('h', h.map((v) => Number(v.toExponential(3))));
  // revert x(y): x = 2 + s*u + s*v, y = u - v, v=h(u)
  // y = u - h(u), x = 2 + s (u + h(u))
  const yOfU = h.map((value, index) => (index === 1 ? 1 - value : -value));
  const xOfU = h.map((value, index) => {
    if (index === 0) return 2;
    return s * ((index === 1 ? 1 : 0) + value);
  });
  // series reversion of y(u) = a1 u + a2 u^2 + ...
  const lead = yOfU[1] ?? 0;
  const invU = Array(deg + 1).fill(0);
  invU[1] = 1 / lead;
  for (let degree = 2; degree <= deg; degree += 1) {
    let extra = 0;
    let power = [1];
    for (let factor = 1; factor <= degree; factor += 1) {
      const next = Array(degree + 1).fill(0);
      for (let i = 0; i < power.length; i += 1) for (let j = 0; j <= degree - i; j += 1) next[i + j] += (power[i] ?? 0) * (invU[j] ?? 0);
      power = next;
      if (factor === 1) continue;
      extra += (yOfU[factor] ?? 0) * (power[degree] ?? 0);
    }
    invU[degree] = -extra / lead;
  }
  const composed = Array(deg + 1).fill(0);
  composed[0] = xOfU[0];
  let power = [1];
  for (let degree = 1; degree <= deg; degree += 1) {
    const next = Array(deg + 1).fill(0);
    for (let i = 0; i < power.length; i += 1) for (let j = 0; j <= deg - i; j += 1) next[i + j] += (power[i] ?? 0) * (invU[j] ?? 0);
    power = next;
    const c = xOfU[degree] ?? 0;
    for (let i = 0; i <= deg; i += 1) composed[i] += c * (power[i] ?? 0);
  }
  console.log('x(y) about y=0', composed.map((v) => Number(v.toFixed(6))));
}

jet();

const view = { xMin: -8, xMax: 8, yMin: -8, yMax: 8 };
function run(name: string, y0: number[], time: number) {
  const result = integrateRK45({
    t0: 0,
    t1: time,
    y0,
    params,
    f: compiled.f,
    rtol: 1e-10,
    atol: 1e-12,
    maxSteps: 80000,
    viewport: view,
    viewportMargin: 0,
    sampleDistance: 0.15,
    blowUpRadius: 1e6,
  });
  const pts = result.y;
  let min1 = Infinity;
  let at1: number[] = [];
  let minM = Infinity;
  let atM: number[] = [];
  let minC = Infinity;
  const targets = [
    [0, -1],
    [0, 1],
    [0.5, 0],
    [-0.5, 0],
  ];
  for (const p of pts) {
    const d1 = Math.hypot((p[0] ?? 0) - 0, (p[1] ?? 0) + 1);
    if (d1 < min1) {
      min1 = d1;
      at1 = p;
    }
    const dm = Math.hypot(p[0] ?? 0, (p[1] ?? 0) - 1);
    if (dm < minM) {
      minM = dm;
      atM = p;
    }
    minC = Math.min(minC, Math.hypot((p[0] ?? 0) - 0.5, p[1] ?? 0), Math.hypot((p[0] ?? 0) + 0.5, p[1] ?? 0));
  }
  const decimated = pts.filter((_, i) => i % Math.ceil(pts.length / 18) === 0 || i === pts.length - 1);
  console.log('\n', name, result.status, 'T', result.t[result.t.length - 1]?.toFixed(2), 'n', pts.length);
  console.log('  closest (0,-1)', min1.toFixed(4), 'at', at1.map((v) => v.toFixed(3)).join(','));
  console.log('  closest (0,1)', minM.toFixed(4), 'at', atM.map((v) => v.toFixed(3)).join(','));
  console.log('  closest center', minC.toFixed(3));
  console.log('  path', decimated.map((p) => `(${(p[0] ?? 0).toFixed(3)},${(p[1] ?? 0).toFixed(3)})`).join(' '));
  const end = pts[pts.length - 1] ?? [];
  const vel = compiled.f(0, end, params);
  console.log('  end vel', vel.map((v) => v.toExponential(2)).join(','));
}

const eps0 = 1e-6;
run('Wu down from +2', [2 - s * eps0, -eps0], 80);
run('Wu up from +2', [2 + s * eps0, eps0], 20);
run('Ws up from +2 backward', [2 - s * eps0, eps0], -80);
run('Wu down from -2', [-2 + s * eps0, -eps0], 80);
