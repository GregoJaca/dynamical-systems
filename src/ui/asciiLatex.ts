const GREEK: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\varepsilon',
  theta: '\\theta',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  sigma: '\\sigma',
  tau: '\\tau',
  phi: '\\phi',
  omega: '\\omega',
};

function greekName(name: string): string {
  return GREEK[name] ?? name;
}

/** Lightweight ASCII preview used until the parser returns real LaTeX. */
export function asciiMathToLatex(input: string): string {
  let text = input.trim();
  text = text.replace(/([A-Za-z]+)\s*''/g, (_, name: string) => `\\ddot{${greekName(name)}}`);
  text = text.replace(/([A-Za-z]+)\s*'/g, (_, name: string) => `\\dot{${greekName(name)}}`);
  text = text.replace(/\b(sin|cos|tan|exp|ln|log|sqrt|arctan|arcsin|arccos)\b/g, '\\$1');
  text = text.replace(/\b([A-Za-z]+)\b/g, (word) => GREEK[word] ?? word);
  text = text.replace(/\*/g, ' \\cdot ');
  return text;
}

export function rowPreviewLatex(row: string, stateVar: string | undefined, secondOrder: boolean): string {
  const trimmed = row.trim();
  if (!trimmed) return '';
  if (trimmed.includes('=') || trimmed.includes("'") || trimmed.includes('\\')) return asciiMathToLatex(trimmed);
  const variable = greekName(stateVar ?? 'x');
  const left = secondOrder ? `\\ddot{${variable}}` : `\\dot{${variable}}`;
  return `${left} = ${asciiMathToLatex(trimmed)}`;
}
