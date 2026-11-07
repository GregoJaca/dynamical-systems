const GREEK: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\epsilon',
  varepsilon: '\\varepsilon',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  iota: '\\iota',
  kappa: '\\kappa',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  sigma: '\\sigma',
  tau: '\\tau',
  phi: '\\phi',
  varphi: '\\varphi',
  chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
};

const FUNCTIONS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sqrt', 'sin', 'cos', 'tan', 'exp', 'ln', 'log'];

function symbolWord(name: string): string {
  if (GREEK[name]) return GREEK[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  return `\\mathrm{${name}}`;
}

/** Lightweight ASCII preview used until the parser returns real LaTeX. */
export function asciiMathToLatex(input: string): string {
  let text = input.trim();
  text = text.replace(/([A-Za-z]+)\s*''/g, (_, name: string) => `\\ddot{${symbolWord(name)}}`);
  text = text.replace(/([A-Za-z]+)\s*'/g, (_, name: string) => `\\dot{${symbolWord(name)}}`);
  text = text.replace(new RegExp(`(?<![A-Za-z\\\\])(${FUNCTIONS.join('|')})(?![A-Za-z])`, 'g'), '\\$1');
  text = text.replace(/(?<![A-Za-z\\])([A-Za-z][A-Za-z0-9]*)(?![A-Za-z0-9])/g, (word) => symbolWord(word));
  text = text.replace(/\*/g, ' \\cdot ');
  return text;
}

export function rowPreviewLatex(row: string, stateVar: string | undefined, secondOrder: boolean): string {
  const trimmed = row.trim();
  if (!trimmed) return '';
  if (trimmed.includes('=') || trimmed.includes("'") || trimmed.includes('\\')) return asciiMathToLatex(trimmed);
  const variable = symbolWord(stateVar ?? 'x');
  const left = secondOrder ? `\\ddot{${variable}}` : `\\dot{${variable}}`;
  return `${left} = ${asciiMathToLatex(trimmed)}`;
}
