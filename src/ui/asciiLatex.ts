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
  const indexed = name.match(/^([A-Za-z])(\d+)$/);
  if (indexed) return `${GREEK[indexed[1]!] ?? indexed[1]}_{${indexed[2]}}`;
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

/** One formula, or a braced stack when the system has several equations. */
export function systemPreviewLatex(rows: string[], stateVars: string[], secondOrder: boolean): string {
  const lines = rows.map((row, index) => rowPreviewLatex(row, stateVars[index], secondOrder)).filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? '';
  return `\\begin{cases} ${lines.join(' \\\\ ')} \\end{cases}`;
}
