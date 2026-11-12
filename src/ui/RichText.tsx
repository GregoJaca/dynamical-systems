import { Katex, isBareFormula, looksLikeProse, readableProse, splitMath } from './Katex';

export { splitMath } from './Katex';

interface Piece {
  math: boolean;
  display: boolean;
  value: string;
}

/** A fragment that is an equation, not a sentence. */
function formulaish(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || looksLikeProse(trimmed)) return false;
  return isBareFormula(trimmed);
}

/**
 * Worked solutions often paste the PDE, then a sentence, with no math delimiters
 * around the PDE. Pull that equation out so it renders.
 */
function breakProse(value: string): Piece[] {
  const lead = value.match(/^([\s\S]*?)(?=\s+[A-Z][a-z]{2,}\b)/);
  const head = lead?.[1] ?? '';
  if (lead && formulaish(head)) {
    return [{ math: true, display: false, value: head.trim() }, ...breakProse(value.slice(head.length))];
  }
  const sentences = value.split(/(?<=\.)\s+(?=[A-Z])/);
  if (sentences.length <= 1) return [{ math: false, display: false, value }];
  return sentences.map((sentence) =>
    formulaish(sentence) ? { math: true, display: false, value: sentence.trim() } : { math: false, display: false, value: sentence },
  );
}

function piecesOf(text: string): Piece[] {
  return splitMath(text).flatMap((piece) => (piece.math ? [piece] : breakProse(piece.value)));
}

export function RichText({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const pieces = piecesOf(trimmed).filter((piece) => piece.value.trim());
  const mathPieces = pieces.filter((piece) => piece.math);
  const prosePieces = pieces.filter((piece) => !piece.math);
  if (mathPieces.length === 1 && prosePieces.length === 0) {
    const piece = mathPieces[0]!;
    return <Katex tex={piece.value} display={piece.display || formulaish(piece.value)} />;
  }
  if (mathPieces.length === 0 && isBareFormula(trimmed)) return <Katex tex={trimmed} display />;
  if (mathPieces.length === 0) return <p className="rich">{readableProse(trimmed)}</p>;
  return (
    <p className="rich">
      {pieces.map((piece, index) =>
        piece.math ? (
          <Katex key={index} tex={piece.value} display={piece.display} />
        ) : (
          <span key={index}>{piece.value}</span>
        ),
      )}
    </p>
  );
}
