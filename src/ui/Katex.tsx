import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface Piece {
  math: boolean;
  display: boolean;
  value: string;
}

const MATH_WORDS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp', 'sqrt', 'sinh', 'cosh', 'tanh',
  'arcsin', 'arccos', 'arctan', 'det', 'dim', 'span', 'max', 'min', 'gcd', 'mod', 'inf', 'sup',
  'lim', 'sum', 'prod', 'cdot', 'times', 'partial', 'nabla', 'dot', 'ddot', 'bar', 'hat', 'tilde',
  'vec', 'overline', 'underline', 'displaystyle', 'textstyle', 'mathrm', 'mathbf', 'mathbb',
  'mathcal', 'mathsf', 'mathit', 'operatorname', 'text', 'quad', 'qquad', 'cdots', 'ldots', 'frac',
  'left', 'right', 'begin', 'end', 'pmatrix', 'bmatrix', 'matrix', 'array', 'cases', 'aligned',
  'gathered', 'implies', 'iff', 'mod',
]);

/** Words outside `\text{...}` and commands. Two of them means the string is a sentence, not a formula. */
export function looksLikeProse(text: string): boolean {
  const withoutText = text.replace(/\\text\{([^{}]*)\}/g, ' ');
  const withoutCommands = withoutText.replace(/\\[a-zA-Z]+/g, ' ');
  const words = withoutCommands.match(/[A-Za-z]{4,}/g) ?? [];
  const prose = words.filter((word) => !MATH_WORDS.has(word.toLowerCase()));
  if (prose.length >= 2) return true;
  if (prose.length === 1 && /\s/.test(withoutCommands) && !/[=^_]/.test(text) && !/\\[a-zA-Z]/.test(text)) return true;
  return false;
}

/** Drop one or more matching delimiter pairs. The delimiters themselves are never rendered. */
export function stripDelimiters(text: string): { tex: string; display: boolean } {
  let tex = text.trim();
  let display = false;
  for (let guard = 0; guard < 3; guard += 1) {
    const displayMatch = tex.match(/^\$\$([\s\S]*)\$\$$/) ?? tex.match(/^\\\[([\s\S]*)\\\]$/);
    const inlineMatch = tex.match(/^\\\(([\s\S]*)\\\)$/) ?? tex.match(/^\$([\s\S]*)\$$/);
    const match = displayMatch ?? inlineMatch;
    if (!match) break;
    display = display || Boolean(displayMatch);
    tex = (match[1] ?? '').trim();
  }
  return { tex, display };
}

export function readableProse(text: string): string {
  const trimmed = stripDelimiters(text).tex;
  if (/\\text\{/.test(trimmed) && !/\\(?!text\b)[a-zA-Z]/.test(trimmed)) {
    const extracted = trimmed
      .replace(/\\text\{([^{}]*)\}/g, '$1')
      .replace(/[{}\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (extracted) return extracted;
  }
  return trimmed;
}

export function isBareFormula(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || looksLikeProse(trimmed)) return false;
  if (/\\[a-zA-Z]|[_^{}]/.test(trimmed)) return true;
  return /=/.test(trimmed) && !/[A-Za-z]{3,}/.test(trimmed.replace(/\\[a-zA-Z]+/g, ' '));
}

/** Split prose from `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`. Captured math does not include the delimiters. */
export function splitMath(text: string): Piece[] {
  const pieces: Piece[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ math: false, display: false, value: text.slice(last, index) });
    const display = match[1] !== undefined || match[2] !== undefined;
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (value) {
      if (looksLikeProse(value)) {
        const inner = value !== text.trim() ? splitMath(value) : [];
        if (inner.some((piece) => piece.math)) pieces.push(...inner);
        else pieces.push({ math: false, display: false, value });
      } else {
        pieces.push({ math: true, display, value: stripDelimiters(value).tex });
      }
    }
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push({ math: false, display: false, value: text.slice(last) });
  if (pieces.length === 0 && text) pieces.push({ math: false, display: false, value: text });
  return pieces;
}

function paintMath(target: HTMLElement, tex: string, display: boolean) {
  const source = stripDelimiters(tex).tex;
  if (!source) {
    target.textContent = '';
    return;
  }
  if (looksLikeProse(source)) {
    target.textContent = readableProse(source);
    return;
  }
  try {
    katex.render(source, target, { throwOnError: true, displayMode: display, strict: 'ignore' });
  } catch {
    target.replaceChildren(document.createTextNode(readableProse(source)));
    return;
  }
  if (target.querySelector('.katex-error')) {
    target.replaceChildren(document.createTextNode(readableProse(source)));
  }
}

export function Katex({ tex, display = false }: { tex: string; display?: boolean }) {
  const node = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = node.current;
    if (!target) return;
    target.replaceChildren();
    const trimmed = tex.trim();
    if (!trimmed) return;
    const pieces = splitMath(trimmed);
    const meaningful = pieces.filter((piece) => piece.value.length > 0);
    const mathPieces = meaningful.filter((piece) => piece.math);
    const prosePieces = meaningful.filter((piece) => !piece.math && piece.value.trim());
    if (mathPieces.length === 0) {
      if (isBareFormula(trimmed)) {
        const unwrapped = stripDelimiters(trimmed);
        paintMath(target, unwrapped.tex, display || unwrapped.display);
      } else {
        target.textContent = readableProse(trimmed);
      }
      return;
    }
    if (prosePieces.length === 0 && mathPieces.length === 1) {
      const unwrapped = stripDelimiters(mathPieces[0]!.value);
      paintMath(target, unwrapped.tex, display || mathPieces[0]!.display || unwrapped.display);
      return;
    }
    for (const piece of meaningful) {
      if (!piece.math) {
        target.append(document.createTextNode(piece.value));
        continue;
      }
      const span = document.createElement('span');
      const unwrapped = stripDelimiters(piece.value);
      paintMath(span, unwrapped.tex, piece.display || unwrapped.display);
      target.append(span);
    }
  }, [tex, display]);
  return <span ref={node} className={display ? 'math-display' : 'math-inline'} />;
}
