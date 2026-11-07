import { Katex } from './Katex';

interface Piece {
  math: boolean;
  display: boolean;
  value: string;
}

/** Prose stays prose. Only the $...$ pieces are sent to KaTeX, so spaces and underscores survive. */
export function splitMath(text: string): Piece[] {
  const pieces: Piece[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$]+)\$|\\\(([\s\S]+?)\\\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ math: false, display: false, value: text.slice(last, index) });
    const display = Boolean(match[1] || match[2]);
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    pieces.push({ math: true, display, value });
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push({ math: false, display: false, value: text.slice(last) });
  if (pieces.length === 0) pieces.push({ math: false, display: false, value: text });
  return pieces;
}

export function RichText({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const hasMath = trimmed.includes('$');
  const looksLikeLatex = !hasMath && /\\[a-zA-Z]/.test(trimmed);
  if (looksLikeLatex) return <Katex tex={trimmed} display />;
  return (
    <p className="rich">
      {splitMath(trimmed).map((piece, index) =>
        piece.math ? (
          <Katex key={index} tex={piece.value} display={piece.display} />
        ) : (
          <span key={index}>{piece.value}</span>
        ),
      )}
    </p>
  );
}
