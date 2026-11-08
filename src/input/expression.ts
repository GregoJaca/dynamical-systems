/**
 * Turns calculator-style math into an explicit mathjs expression.
 * Function names stay functions: `sin x`, `arctan(x)`, `sin^2 x`, `|x|`.
 * Adjacent letters multiply (`xy` is `x*y`). Greek names such as `mu` and `gamma` stay whole.
 */

export type FnSpec = { name: string; min: number; max: number; implicit: boolean };

const ALIASES: Record<string, string> = {
  sine: 'sin',
  cosine: 'cos',
  tangent: 'tan',
  secant: 'sec',
  cosecant: 'csc',
  cotangent: 'cot',
  arcsine: 'asin',
  arccosine: 'acos',
  arctangent: 'atan',
  arcsin: 'asin',
  arccos: 'acos',
  arctan2: 'atan2',
  arctan: 'atan',
  arccsc: 'acsc',
  arcsec: 'asec',
  arccot: 'acot',
  arctg: 'atan',
  arcctg: 'acot',
  tg: 'tan',
  ctg: 'cot',
  cotg: 'cot',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  arccsch: 'acsch',
  arcsech: 'asech',
  arccoth: 'acoth',
  arsinh: 'asinh',
  arcosh: 'acosh',
  artanh: 'atanh',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  csch: 'csch',
  sech: 'sech',
  coth: 'coth',
  asinh: 'asinh',
  acosh: 'acosh',
  atanh: 'atanh',
  acsch: 'acsch',
  asech: 'asech',
  acoth: 'acoth',
  asin: 'asin',
  acos: 'acos',
  atan2: 'atan2',
  atan: 'atan',
  acsc: 'acsc',
  asec: 'asec',
  acot: 'acot',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  csc: 'csc',
  sec: 'sec',
  cot: 'cot',
  sqrt: 'sqrt',
  cbrt: 'cbrt',
  exp: 'exp',
  exponential: 'exp',
  log10: 'log10',
  log2: 'log2',
  log: 'log',
  ln: 'log',
  lg: 'log10',
  abs: 'abs',
  fabs: 'abs',
  sign: 'sign',
  sgn: 'sign',
  floor: 'floor',
  ceil: 'ceil',
  ceiling: 'ceil',
  round: 'round',
  fix: 'fix',
  square: 'square',
  cube: 'cube',
  erf: 'erf',
  hypot: 'hypot',
  min: 'min',
  max: 'max',
  mod: 'mod',
  gcd: 'gcd',
  lcm: 'lcm',
  nthroot: 'nthRoot',
  factorial: 'factorial',
};

const SPECS: Record<string, FnSpec> = {};
for (const name of new Set(Object.values(ALIASES))) {
  SPECS[name] = { name, min: 1, max: 1, implicit: true };
}
Object.assign(SPECS, {
  log: { name: 'log', min: 1, max: 2, implicit: true },
  atan2: { name: 'atan2', min: 2, max: 2, implicit: false },
  nthRoot: { name: 'nthRoot', min: 2, max: 2, implicit: false },
  hypot: { name: 'hypot', min: 2, max: 16, implicit: false },
  min: { name: 'min', min: 1, max: 16, implicit: false },
  max: { name: 'max', min: 1, max: 16, implicit: false },
  mod: { name: 'mod', min: 2, max: 2, implicit: false },
  gcd: { name: 'gcd', min: 2, max: 16, implicit: false },
  lcm: { name: 'lcm', min: 2, max: 16, implicit: false },
} satisfies Record<string, FnSpec>);

const INVERSE: Record<string, string> = {
  sin: 'asin',
  cos: 'acos',
  tan: 'atan',
  csc: 'acsc',
  sec: 'asec',
  cot: 'acot',
  sinh: 'asinh',
  cosh: 'acosh',
  tanh: 'atanh',
  csch: 'acsch',
  sech: 'asech',
  coth: 'acoth',
  asin: 'sin',
  acos: 'cos',
  atan: 'tan',
  acsc: 'csc',
  asec: 'sec',
  acot: 'cot',
  asinh: 'sinh',
  acosh: 'cosh',
  atanh: 'tanh',
  acsch: 'csch',
  asech: 'sech',
  acoth: 'coth',
};

const FUNCTION_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

const NAMED_SYMBOLS = [
  'infinity',
  'varepsilon',
  'epsilon',
  'vartheta',
  'varphi',
  'lambda',
  'alpha',
  'gamma',
  'delta',
  'theta',
  'kappa',
  'sigma',
  'omega',
  'beta',
  'zeta',
  'iota',
  'chi',
  'psi',
  'phi',
  'rho',
  'tau',
  'eps',
  'eta',
  'nan',
  'mu',
  'nu',
  'xi',
  'pi',
].sort((a, b) => b.length - a.length);

const SYMBOL_CANON: Record<string, string> = {
  eps: 'epsilon',
  infinity: 'Infinity',
  nan: 'NaN',
};

const CANONICAL_FUNCTIONS = new Set(Object.values(ALIASES));

export function isBuiltInFunction(name: string): boolean {
  const lower = name.toLowerCase();
  return CANONICAL_FUNCTIONS.has(name) || CANONICAL_FUNCTIONS.has(lower) || Object.prototype.hasOwnProperty.call(ALIASES, lower);
}

type Token =
  | { type: 'num'; value: string }
  | { type: 'id'; value: string }
  | { type: 'fn'; name: string; typed: string; base?: string }
  | { type: 'op'; op: '+' | '-' | '*' | '/' | '%' | '^' | '!' | 'deg' }
  | { type: 'lp' }
  | { type: 'rp' }
  | { type: 'comma' }
  | { type: 'abs' }
  | { type: 'eof' };

type Ast =
  | { type: 'num'; value: string }
  | { type: 'sym'; name: string }
  | { type: 'unary'; op: '+' | '-'; arg: Ast }
  | { type: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: Ast; right: Ast }
  | { type: 'call'; name: string; args: Ast[] };

const UNICODE_GREEK: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ζ: 'zeta',
  η: 'eta',
  θ: 'theta',
  ι: 'iota',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  τ: 'tau',
  φ: 'phi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
  Γ: 'Gamma',
  Δ: 'Delta',
  Θ: 'Theta',
  Λ: 'Lambda',
  Ξ: 'Xi',
  Π: 'Pi',
  Σ: 'Sigma',
  Φ: 'Phi',
  Ψ: 'Psi',
  Ω: 'Omega',
};

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
  'ⁿ': 'n',
  'ⁱ': 'i',
  'ᵃ': 'a',
  'ᵇ': 'b',
  'ᶜ': 'c',
  'ᵈ': 'd',
  'ᵉ': 'e',
  'ᶠ': 'f',
  'ᵍ': 'g',
  'ʰ': 'h',
  'ʲ': 'j',
  'ᵏ': 'k',
  'ˡ': 'l',
  'ᵐ': 'm',
  'ᵒ': 'o',
  'ᵖ': 'p',
  'ʳ': 'r',
  'ˢ': 's',
  'ᵗ': 't',
  'ᵘ': 'u',
  'ᵛ': 'v',
  'ʷ': 'w',
  'ˣ': 'x',
  'ʸ': 'y',
  'ᶻ': 'z',
};

const DOTTED: Record<string, string> = {
  'ẋ': "x'",
  'Ẋ': "X'",
  'ẏ': "y'",
  'Ẏ': "Y'",
  'ż': "z'",
  'Ż': "Z'",
  'ẍ': "x''",
  'Ẍ': "X''",
  'ṁ': "m'",
  'Ṁ': "M'",
  'ṅ': "n'",
  'Ṅ': "N'",
};

const SUBSCRIPT: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
};

const VULGAR: Record<string, string> = {
  '½': '(1/2)',
  '⅓': '(1/3)',
  '⅔': '(2/3)',
  '¼': '(1/4)',
  '¾': '(3/4)',
  '⅕': '(1/5)',
  '⅖': '(2/5)',
  '⅗': '(3/5)',
  '⅘': '(4/5)',
  '⅙': '(1/6)',
  '⅚': '(5/6)',
  '⅛': '(1/8)',
  '⅜': '(3/8)',
  '⅝': '(5/8)',
  '⅞': '(7/8)',
};

const LATEX_COMMANDS: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  csc: 'csc',
  sec: 'sec',
  cot: 'cot',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  arccsc: 'arccsc',
  arcsec: 'arcsec',
  arccot: 'arccot',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  csch: 'csch',
  sech: 'sech',
  coth: 'coth',
  ln: 'ln',
  log: 'log',
  exp: 'exp',
  abs: 'abs',
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  varepsilon: 'epsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  pi: 'pi',
  rho: 'rho',
  sigma: 'sigma',
  tau: 'tau',
  phi: 'phi',
  varphi: 'phi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
};

/** Unicode, LaTeX, and calculator syntax folded into an explicit mathjs expression. */
export function prepareMath(raw: string, known: readonly string[] = []): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const names = [...known].sort((a, b) => b.length - a.length);
  return rewriteMath(expandLatex(foldUnicode(trimmed)), names);
}

/** The name typed in the variable field: `x_1`, `x₁`, and `θ` become the symbol used in equations. */
export function readDeclaredName(raw: string): string {
  const folded = expandLatex(foldUnicode(raw)).replace(/\s+/g, '');
  if (!folded) throw new Error('Name each variable.');
  if (/['′″‴˙]/.test(folded)) {
    throw new Error(`"${raw.trim()}" includes a derivative. Name the variable itself, for example x.`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(folded)) {
    throw new Error(`"${raw.trim()}" is not a variable name. Use a letter, x_1, or a Greek name such as theta.`);
  }
  const name = canonicalSymbol(folded);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`"${raw.trim()}" is not a variable name. Use a letter, x_1, or a Greek name such as theta.`);
  }
  return name;
}

export function rewriteMath(input: string, known: readonly string[] = []): string {
  const eq = indexOfTopLevelEquals(input);
  if (eq >= 0) {
    const left = input.slice(0, eq).trim();
    const right = input.slice(eq + 1).trim();
    if (!left || !right) throw new Error('Equation is missing one side.');
    return `${rewriteMath(left, known)} = ${rewriteMath(right, known)}`;
  }
  if (!input.trim()) throw new Error('Expression is empty.');
  const tokens = matchAbs(lex(input, known));
  return print(new Parser(tokens).parseExpression());
}

function foldUnicode(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? '';
    if (char === '−' || char === '–' || char === '—') out += '-';
    else if (char === '×' || char === '·' || char === '∙' || char === '⋅' || char === '∗') out += '*';
    else if (char === '÷' || char === '∕' || char === '⁄') out += '/';
    else if (char === '√') out += 'sqrt';
    else if (char === '∛') out += 'cbrt';
    else if (char === '∞') out += 'Infinity';
    else if (char === '∣') out += '|';
    else if (char === '″') out += "''";
    else if (char === '‴') out += "'''";
    else if (char === '′' || char === '’' || char === 'ʼ' || char === 'ˈ' || char === '˙' || char === '\u0307') out += "'";
    else if (DOTTED[char]) out += DOTTED[char];
    else if (SUPERSCRIPT[char]) {
      let body = '';
      while (i < chars.length && SUPERSCRIPT[chars[i] ?? '']) {
        body += SUPERSCRIPT[chars[i] ?? ''];
        i += 1;
      }
      i -= 1;
      out += `^(${body})`;
    } else if (SUBSCRIPT[char]) {
      let body = '';
      while (i < chars.length && SUBSCRIPT[chars[i] ?? '']) {
        body += SUBSCRIPT[chars[i] ?? ''];
        i += 1;
      }
      out += `_${body}`;
      if (isDigit(chars[i] ?? '')) out += ' ';
      i -= 1;
    } else if (VULGAR[char]) out += VULGAR[char];
    else if (UNICODE_GREEK[char]) out += UNICODE_GREEK[char];
    else out += char;
  }
  return out.replace(/\*\*/g, '^');
}

function expandLatex(text: string): string {
  let source = text;
  source = source.replace(/\\ddot\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$1''");
  source = source.replace(/\\ddot\s*([A-Za-z_][A-Za-z0-9_]*)/g, "$1''");
  source = source.replace(/\\dot\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$1'");
  source = source.replace(/\\dot\s*([A-Za-z_][A-Za-z0-9_]*)/g, "$1'");
  source = source.replace(/\\frac\{d\^2\s*([A-Za-z_][A-Za-z0-9_]*)\}\{d[a-zA-Z]\^2\}/g, "$1''");
  source = source.replace(/d\^2\s*([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*d[a-zA-Z]\^2/g, "$1''");
  source = source.replace(/d\^\(2\)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*d[a-zA-Z]\^\(2\)/g, "$1''");
  source = source.replace(/\\frac\{d\s*([A-Za-z_][A-Za-z0-9_]*)\}\{d[a-zA-Z]\}/g, "$1'");
  source = source.replace(/\bd\s*([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*d[a-zA-Z]\b/g, "$1'");
  const expanded = scanLatex(source);
  return expanded.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\{/g, '(').replace(/\}/g, ')');
}

function scanLatex(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\\') {
      out += text[i];
      continue;
    }
    if (text[i + 1] === '\\') {
      out += ' ';
      i += 1;
      continue;
    }
    const commandStart = i + 1;
    let j = commandStart;
    while (j < text.length && /[A-Za-z]/.test(text[j] ?? '')) j += 1;
    const command = text.slice(commandStart, j);
    if (!command) {
      out += ' ';
      continue;
    }
    i = j - 1;
    if (command === 'left' || command === 'right' || command === 'bigl' || command === 'bigr' || command === 'Bigl' || command === 'Bigr') {
      continue;
    }
    if (command === 'cdot' || command === 'times' || command === 'ast') {
      out += '*';
      continue;
    }
    if (command === 'div') {
      out += '/';
      continue;
    }
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
      const num = readBrace(text, j);
      const den = readBrace(text, num.next);
      out += `((${scanLatex(num.value)})/(${scanLatex(den.value)}))`;
      i = den.next - 1;
      continue;
    }
    if (command === 'sqrt') {
      let degree = '';
      if (text[j] === '[') {
        const end = text.indexOf(']', j + 1);
        if (end < 0) throw new Error('A square root is missing its closing bracket.');
        degree = text.slice(j + 1, end);
        j = end + 1;
      }
      if (text[j] === '{') {
        const body = readBrace(text, j);
        const inside = scanLatex(body.value);
        out += degree ? `nthRoot(${inside}, ${scanLatex(degree)})` : `sqrt(${inside})`;
        i = body.next - 1;
      } else {
        out += degree ? 'nthRoot' : 'sqrt';
        i = j - 1;
      }
      continue;
    }
    if (command === 'operatorname' || command === 'mathrm' || command === 'text') {
      const body = readBrace(text, j);
      out += body.value;
      i = body.next - 1;
      continue;
    }
    const mapped = LATEX_COMMANDS[command];
    if (!mapped) throw new Error(`Unknown LaTeX command \\${command}.`);
    out += mapped;
    if (text[j] === '{') {
      const body = readBrace(text, j);
      out += `(${scanLatex(body.value)})`;
      i = body.next - 1;
    }
  }
  return out;
}

function readBrace(text: string, index: number): { value: string; next: number } {
  if (text[index] !== '{') throw new Error('Expected a brace group in the LaTeX expression.');
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return { value: text.slice(index + 1, i), next: i + 1 };
    }
  }
  throw new Error('A LaTeX brace group is not closed.');
}

function lex(input: string, known: readonly string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i] ?? '';
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === '|' ) {
      tokens.push({ type: 'abs' });
      i += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'lp' });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rp' });
      i += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma' });
      i += 1;
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '%' || char === '^') {
      tokens.push({ type: 'op', op: char });
      i += 1;
      continue;
    }
    if (char === '!') {
      if (input[i + 1] === '=') throw new Error('Comparisons are not supported in an expression.');
      tokens.push({ type: 'op', op: '!' });
      i += 1;
      continue;
    }
    if (char === '°') {
      tokens.push({ type: 'op', op: 'deg' });
      i += 1;
      continue;
    }
    if (char === '<' || char === '>' || char === '=') throw new Error('Comparisons are not supported in an expression.');
    if (isDigit(char) || (char === '.' && isDigit(input[i + 1] ?? ''))) {
      const number = readNumber(input, i);
      tokens.push({ type: 'num', value: number.value });
      i = number.next;
      continue;
    }
    if (isLetter(char) || char === '_') {
      const start = i;
      i += 1;
      while (i < input.length && (isLetter(input[i] ?? '') || isDigit(input[i] ?? '') || input[i] === '_')) i += 1;
      const word = input.slice(start, i);
      const classified = classifyWord(word, known);
      while (input[i] === "'") {
        const last = classified[classified.length - 1];
        if (!last || last.type !== 'id') throw new Error(`A derivative mark cannot follow "${word}".`);
        last.value += "'";
        i += 1;
      }
      tokens.push(...classified);
      continue;
    }
    throw new Error(`Unexpected "${char}" in the expression.`);
  }
  return tokens;
}

function classifyWord(word: string, known: readonly string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < word.length) {
    const logBase = /^log_(\d+)/i.exec(word.slice(index));
    if (logBase?.[1]) {
      tokens.push({ type: 'fn', name: 'log', typed: logBase[0], base: logBase[1] });
      index += logBase[0].length;
      continue;
    }
    const piece = longestPiece(word, index, known);
    tokens.push(piece.token);
    index = piece.next;
  }
  return tokens;
}

function longestPiece(word: string, index: number, known: readonly string[]): { token: Token; next: number } {
  const lower = word.toLowerCase();
  let best: { token: Token; next: number; rank: number } | null = null;
  const consider = (candidate: { token: Token; next: number; rank: number }) => {
    if (!best || candidate.next > best.next || (candidate.next === best.next && candidate.rank > best.rank)) best = candidate;
  };
  for (const key of FUNCTION_KEYS) {
    if (!lower.startsWith(key, index)) continue;
    const name = ALIASES[key] ?? key;
    const spec = SPECS[name];
    const next = index + key.length;
    if (!spec?.implicit && next !== word.length) continue;
    consider({ token: { type: 'fn', name, typed: word.slice(index, next) }, next, rank: 3 });
  }
  for (const name of NAMED_SYMBOLS) {
    if (!lower.startsWith(name, index)) continue;
    const next = index + name.length + trailingIndex(word, index + name.length);
    consider({ token: { type: 'id', value: canonicalSymbol(word.slice(index, next)) }, next, rank: 2 });
  }
  for (const name of known) {
    if (!name) continue;
    const matches = name.length === 1 ? word.startsWith(name, index) : word.slice(index, index + name.length).toLowerCase() === name.toLowerCase();
    if (!matches) continue;
    consider({ token: { type: 'id', value: name }, next: index + name.length, rank: 2 });
  }
  if (isLetter(word[index] ?? '')) {
    const next = index + 1 + trailingIndex(word, index + 1);
    consider({ token: { type: 'id', value: word.slice(index, next).replaceAll('_', '') }, next, rank: 1 });
  }
  if (best) return best;
  if (isDigit(word[index] ?? '') || word[index] === '.') {
    const number = readNumber(word, index);
    return { token: { type: 'num', value: number.value }, next: number.next };
  }
  throw new Error(`Unexpected "${word[index] ?? ''}" in the expression.`);
}

function trailingIndex(word: string, index: number): number {
  if (word[index] === '_' && isDigit(word[index + 1] ?? '')) {
    let next = index + 2;
    while (isDigit(word[next] ?? '')) next += 1;
    return next - index;
  }
  let next = index;
  while (isDigit(word[next] ?? '')) next += 1;
  return next - index;
}

function canonicalSymbol(word: string): string {
  const indexed = word.match(/^([A-Za-z]+)_(\d+)$/);
  const stem = (indexed?.[1] ?? word).toLowerCase();
  const suffix = indexed?.[2] ?? '';
  const canon = SYMBOL_CANON[stem] ?? (NAMED_SYMBOLS.includes(stem) ? stem : null);
  if (canon) return `${canon}${suffix}`;
  return word.replace('_', '');
}

function matchAbs(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let open = 0;
  for (const token of tokens) {
    if (token.type !== 'abs') {
      out.push(token);
      continue;
    }
    const previous = out[out.length - 1];
    const previousIsValue = previous?.type === 'num' || previous?.type === 'id' || previous?.type === 'rp';
    if (open > 0 && previousIsValue) {
      out.push({ type: 'rp' });
      open -= 1;
    } else {
      out.push({ type: 'fn', name: 'abs', typed: 'abs' });
      out.push({ type: 'lp' });
      open += 1;
    }
  }
  if (open !== 0) throw new Error('Absolute value bars do not match.');
  return out;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): Ast {
    const node = this.parseSum();
    if (this.peek().type !== 'eof') throw new Error(`Unexpected "${this.describe(this.peek())}" in the expression.`);
    return node;
  }

  private parseSum(): Ast {
    let left = this.parseTerm();
    while (this.peek().type === 'op' && (this.peekOp() === '+' || this.peekOp() === '-')) {
      const op = this.eatArithmetic();
      left = { type: 'binary', op, left, right: this.parseTerm() };
    }
    return left;
  }

  private parseTerm(): Ast {
    let left = this.parseTight();
    while (this.peek().type === 'op' && (this.peekOp() === '*' || this.peekOp() === '/' || this.peekOp() === '%')) {
      const op = this.eatArithmetic();
      left = { type: 'binary', op, left, right: this.parseTight() };
    }
    return left;
  }

  private parseTight(): Ast {
    let left = this.parsePower();
    while (this.canJuxtapose()) left = { type: 'binary', op: '*', left, right: this.parsePower() };
    return left;
  }

  private parsePower(): Ast {
    if (this.peek().type === 'op' && (this.peekOp() === '+' || this.peekOp() === '-')) {
      const op = this.eatOp();
      if (op !== '+' && op !== '-') throw new Error('Expected a unary sign.');
      return { type: 'unary', op, arg: this.parsePower() };
    }
    let left = this.peek().type === 'fn' ? this.parseFunction() : this.parsePrimary();
    left = this.applyPostfix(left);
    if (this.peek().type === 'op' && this.peekOp() === '^') {
      this.eatOp();
      left = { type: 'binary', op: '^', left, right: this.parsePower() };
    }
    return left;
  }

  private parseFunction(): Ast {
    const token = this.eat();
    if (token.type !== 'fn') throw new Error('Expected a function name.');
    const spec = SPECS[token.name];
    if (!spec) throw new Error(`Unknown function "${token.typed}".`);
    let exponent: Ast | null = null;
    if (this.peek().type === 'op' && this.peekOp() === '^') {
      this.eatOp();
      exponent = this.parseFunctionExponent();
    }
    const args = this.parseArguments(token, spec);
    let node: Ast = { type: 'call', name: spec.name, args };
    if (exponent && isMinusOne(exponent)) {
      const inverse = INVERSE[spec.name];
      if (!inverse || args.length !== 1) {
        node = { type: 'binary', op: '^', left: node, right: exponent };
      } else {
        node = { type: 'call', name: inverse, args };
      }
    } else if (exponent) {
      node = { type: 'binary', op: '^', left: node, right: exponent };
    }
    return node;
  }

  private parseFunctionExponent(): Ast {
    if (this.peek().type === 'lp') {
      this.eat();
      const value = this.parseSum();
      this.expect('rp');
      return value;
    }
    if (this.peek().type === 'fn') throw new Error('Put a function exponent in parentheses.');
    return this.parsePower();
  }

  private parseArguments(token: Extract<Token, { type: 'fn' }>, spec: FnSpec): Ast[] {
    if (this.peek().type === 'lp') {
      this.eat();
      if (this.peek().type === 'rp') throw new Error(`${token.typed} needs an argument inside the parentheses.`);
      const args = [this.parseSum()];
      while (this.peek().type === 'comma') {
        this.eat();
        args.push(this.parseSum());
      }
      this.expect('rp');
      return this.finishArguments(token, spec, args);
    }
    if (!spec.implicit) {
      throw new Error(`${token.typed} needs parentheses, for example ${token.typed}(${spec.min === 2 ? 'y, x' : 'x'}).`);
    }
    if (!this.canStartArgument()) throw new Error(`${token.typed} needs an argument, for example ${token.typed}(x).`);
    return this.finishArguments(token, spec, [this.parseArgTight()]);
  }

  private finishArguments(token: Extract<Token, { type: 'fn' }>, spec: FnSpec, args: Ast[]): Ast[] {
    if (token.base) {
      if (args.length !== 1) throw new Error(`${token.typed} already has base ${token.base} and takes one argument.`);
      args = [args[0]!, { type: 'num', value: token.base }];
    }
    if (args.length < spec.min || args.length > spec.max) {
      const expected = spec.min === spec.max ? `${spec.min}` : `${spec.min} to ${spec.max}`;
      throw new Error(`${token.typed} takes ${expected} argument${spec.max === 1 ? '' : 's'}.`);
    }
    return args;
  }

  private parseArgTight(): Ast {
    let left = this.parsePower();
    while (this.canJuxtapose() && this.peek().type !== 'fn') {
      left = { type: 'binary', op: '*', left, right: this.parsePower() };
    }
    return left;
  }

  private parsePrimary(): Ast {
    const token = this.peek();
    if (token.type === 'num') {
      this.eat();
      return { type: 'num', value: token.value };
    }
    if (token.type === 'id') {
      this.eat();
      return { type: 'sym', name: token.value };
    }
    if (token.type === 'lp') {
      this.eat();
      const inner = this.parseSum();
      this.expect('rp');
      return inner;
    }
    throw new Error(`Unexpected "${this.describe(token)}" in the expression.`);
  }

  private applyPostfix(node: Ast): Ast {
    let current = node;
    while (this.peek().type === 'op' && (this.peekOp() === '!' || this.peekOp() === 'deg')) {
      const op = this.eatOp();
      if (op === '!') current = { type: 'call', name: 'factorial', args: [current] };
      else current = { type: 'binary', op: '*', left: current, right: { type: 'binary', op: '/', left: { type: 'sym', name: 'pi' }, right: { type: 'num', value: '180' } } };
    }
    return current;
  }

  private canJuxtapose(): boolean {
    const token = this.peek();
    return token.type === 'num' || token.type === 'id' || token.type === 'fn' || token.type === 'lp';
  }

  private canStartArgument(): boolean {
    return this.canJuxtapose() || (this.peek().type === 'op' && (this.peekOp() === '+' || this.peekOp() === '-'));
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: 'eof' };
  }

  private peekOp(): '+' | '-' | '*' | '/' | '%' | '^' | '!' | 'deg' {
    const token = this.peek();
    if (token.type !== 'op') throw new Error('Expected an operator.');
    return token.op;
  }

  private eat(): Token {
    const token = this.peek();
    if (token.type === 'eof') throw new Error('Expression ended unexpectedly.');
    this.index += 1;
    return token;
  }

  private eatOp(): '+' | '-' | '*' | '/' | '%' | '^' | '!' | 'deg' {
    const token = this.eat();
    if (token.type !== 'op') throw new Error('Expected an operator.');
    return token.op;
  }

  private eatArithmetic(): '+' | '-' | '*' | '/' | '%' | '^' {
    const op = this.eatOp();
    if (op === '!' || op === 'deg') throw new Error('Expected an arithmetic operator.');
    return op;
  }

  private expect(type: 'rp'): void {
    const token = this.peek();
    if (token.type !== type) throw new Error('A parenthesis is not closed.');
    this.eat();
  }

  private describe(token: Token): string {
    if (token.type === 'eof') return 'end of expression';
    if (token.type === 'num' || token.type === 'id') return token.value;
    if (token.type === 'fn') return token.typed;
    if (token.type === 'op') return token.op === 'deg' ? '°' : token.op;
    if (token.type === 'lp') return '(';
    if (token.type === 'rp') return ')';
    if (token.type === 'comma') return ',';
    if (token.type === 'abs') return '|';
    return 'token';
  }
}

function isMinusOne(node: Ast): boolean {
  if (node.type === 'num') return Number(node.value) === -1;
  if (node.type === 'unary' && node.op === '-' && node.arg.type === 'num') return Number(node.arg.value) === 1;
  return false;
}

function print(node: Ast): string {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'sym':
      return node.name;
    case 'unary':
      return node.op === '+' ? `(${print(node.arg)})` : `-(${print(node.arg)})`;
    case 'binary':
      return `(${print(node.left)} ${node.op} ${print(node.right)})`;
    case 'call':
      return `${node.name}(${node.args.map((arg) => print(arg)).join(', ')})`;
    default:
      throw new Error('Could not print this expression.');
  }
}

function readNumber(text: string, index: number): { value: string; next: number } {
  let i = index;
  if (text[i] === '.') i += 1;
  if (!isDigit(text[i] ?? '')) throw new Error('Expected a number.');
  while (isDigit(text[i] ?? '')) i += 1;
  if (text[index] !== '.' && text[i] === '.') {
    i += 1;
    while (isDigit(text[i] ?? '')) i += 1;
  }
  if ((text[i] === 'e' || text[i] === 'E') && (isDigit(text[i + 1] ?? '') || ((text[i + 1] === '+' || text[i + 1] === '-') && isDigit(text[i + 2] ?? '')))) {
    i += 1;
    if (text[i] === '+' || text[i] === '-') i += 1;
    while (isDigit(text[i] ?? '')) i += 1;
  }
  return { value: text.slice(index, i), next: i };
}

function indexOfTopLevelEquals(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === '=' && depth === 0 && text[i + 1] !== '=' && text[i - 1] !== '<' && text[i - 1] !== '>' && text[i - 1] !== '!' && text[i - 1] !== '=') {
      return i;
    }
  }
  return -1;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isLetter(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}
