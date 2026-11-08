export type MathEdit =
  | { op: 'insert'; text: string; cursor: number }
  | { op: 'backspace' }
  | { op: 'move'; delta: -1 | 1 };

export type KeySpec = {
  id: string;
  label: string;
  aria: string;
  tone?: 'digit' | 'op';
  repeat?: boolean;
  edit: (selection: string) => MathEdit;
};

export function applyMathEdit(value: string, start: number, end: number, edit: MathEdit): { value: string; cursor: number } {
  const length = value.length;
  const lo = clamp(Math.min(start, end), 0, length);
  const hi = clamp(Math.max(start, end), 0, length);
  if (edit.op === 'move') {
    const origin = start === end ? clamp(start, 0, length) : edit.delta < 0 ? lo : hi;
    return { value, cursor: clamp(origin + edit.delta, 0, length) };
  }
  if (edit.op === 'backspace') {
    if (lo !== hi) return { value: value.slice(0, lo) + value.slice(hi), cursor: lo };
    if (lo === 0) return { value, cursor: 0 };
    return { value: value.slice(0, lo - 1) + value.slice(hi), cursor: lo - 1 };
  }
  const text = edit.text;
  const next = value.slice(0, lo) + text + value.slice(hi);
  return { value: next, cursor: lo + clamp(edit.cursor, 0, text.length) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function typed(id: string, label: string, aria: string, text: string, tone?: KeySpec['tone']): KeySpec {
  return { id, label, aria, tone, edit: () => ({ op: 'insert', text, cursor: text.length }) };
}

function wrapped(id: string, label: string, aria: string, before: string, after: string): KeySpec {
  return {
    id,
    label,
    aria,
    edit: (selection) => {
      const text = selection ? `${before}${selection}${after}` : `${before}${after}`;
      const cursor = selection ? text.length : before.length;
      return { op: 'insert', text, cursor };
    },
  };
}

function atom(selection: string): boolean {
  return /^[A-Za-z0-9]+$/u.test(selection) || /^[\u03b1-\u03c9\u03d5\u03c0]$/u.test(selection);
}

function power(id: string, label: string, aria: string, exponent: string): KeySpec {
  return {
    id,
    label,
    aria,
    edit: (selection) => {
      if (!selection) return { op: 'insert', text: exponent, cursor: exponent.length };
      const text = atom(selection) ? `${selection}${exponent}` : `(${selection})${exponent}`;
      return { op: 'insert', text, cursor: text.length };
    },
  };
}

const call = (name: string, label = name) => wrapped(name, label, label, `${name}(`, ')');

export const TOOL_KEYS: KeySpec[] = [
  { id: 'left', label: '←', aria: 'Move left', edit: () => ({ op: 'move', delta: -1 }) },
  { id: 'right', label: '→', aria: 'Move right', edit: () => ({ op: 'move', delta: 1 }) },
  typed('prime', '′', 'Derivative', "'"),
  { id: 'backspace-tool', label: '⌫', aria: 'Backspace', repeat: true, edit: () => ({ op: 'backspace' }) },
  {
    id: 'fraction',
    label: 'a/b',
    aria: 'Fraction',
    edit: (selection) => {
      if (!selection) return { op: 'insert', text: '()/()', cursor: 1 };
      const text = `(${selection})/()`;
      return { op: 'insert', text, cursor: text.length - 1 };
    },
  },
];

export const MAIN_FUNCTION_KEYS: KeySpec[] = [
  power('square', 'x²', 'Square', '^2'),
  power('power', 'xⁿ', 'Power', '^'),
  wrapped('sqrt', '√', 'Square root', 'sqrt(', ')'),
  {
    id: 'nthroot',
    label: 'ⁿ√',
    aria: 'nth root',
    edit: (selection) => {
      if (!selection) return { op: 'insert', text: 'nthRoot(, )', cursor: 'nthRoot('.length };
      const text = `nthRoot(${selection}, )`;
      return { op: 'insert', text, cursor: text.length - 1 };
    },
  },
  wrapped('paren', '( )', 'Parentheses', '(', ')'),
  wrapped('abs', '|x|', 'Absolute value', '|', '|'),
  typed('pi', 'π', 'pi', 'π'),
  typed('theta', 'θ', 'theta', 'θ'),
  call('sin'),
  call('cos'),
  call('tan'),
  call('ln', 'ln'),
  typed('x', 'x', 'x', 'x'),
  typed('y', 'y', 'y', 'y'),
  typed('e', 'e', 'e', 'e'),
  typed('comma', ',', 'Comma', ','),
];

export const NUMPAD_KEYS: KeySpec[] = [
  typed('7', '7', '7', '7', 'digit'),
  typed('8', '8', '8', '8', 'digit'),
  typed('9', '9', '9', '9', 'digit'),
  typed('div', '÷', 'Divide', '/', 'op'),
  typed('4', '4', '4', '4', 'digit'),
  typed('5', '5', '5', '5', 'digit'),
  typed('6', '6', '6', '6', 'digit'),
  typed('mul', '×', 'Multiply', '*', 'op'),
  typed('1', '1', '1', '1', 'digit'),
  typed('2', '2', '2', '2', 'digit'),
  typed('3', '3', '3', '3', 'digit'),
  typed('sub', '−', 'Minus', '-', 'op'),
  typed('0', '0', '0', '0', 'digit'),
  typed('dot', '.', 'Decimal point', '.', 'digit'),
  { id: 'backspace', label: '⌫', aria: 'Backspace', tone: 'op', repeat: true, edit: () => ({ op: 'backspace' }) },
  typed('add', '+', 'Plus', '+', 'op'),
];

export const FUNCTION_KEYS: KeySpec[] = [
  call('sin'),
  call('cos'),
  call('tan'),
  call('cot'),
  call('sec'),
  call('csc'),
  call('arcsin'),
  call('arccos'),
  call('arctan'),
  call('arccot'),
  call('sinh'),
  call('cosh'),
  call('tanh'),
  wrapped('abs2', '|x|', 'Absolute value', '|', '|'),
  call('ln', 'ln'),
  call('log'),
  call('log10', 'log₁₀'),
  call('exp'),
  call('sqrt', 'sqrt'),
  call('cbrt', 'cbrt'),
  call('sgn'),
  call('floor'),
  call('ceil'),
  call('round'),
  call('min'),
  call('max'),
  call('atan2'),
  call('mod'),
  call('gcd'),
  call('lcm'),
  typed('eq', '=', 'Equals', '='),
  power('power2', 'xⁿ', 'Power', '^'),
  typed('comma2', ',', 'Comma', ','),
  { id: 'backspace2', label: '⌫', aria: 'Backspace', repeat: true, edit: () => ({ op: 'backspace' }) },
];

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω'] as const;

export const GREEK_KEYS: KeySpec[] = [
  typed('var-z', 'z', 'z', 'z'),
  typed('var-t', 't', 't', 't'),
  typed('var-w', 'w', 'w', 'w'),
  typed('var-u', 'u', 'u', 'u'),
  typed('var-v', 'v', 'v', 'v'),
  typed('var-n', 'n', 'n', 'n'),
  ...GREEK.map((letter) => typed(`greek-${letter}`, letter, letter, letter)),
  typed('infinity', '∞', 'Infinity', '∞'),
  typed('degree', '°', 'Degree', '°'),
  { id: 'backspace3', label: '⌫', aria: 'Backspace', repeat: true, edit: () => ({ op: 'backspace' }) },
];
