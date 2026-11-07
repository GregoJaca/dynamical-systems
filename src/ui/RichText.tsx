import { Katex, isBareFormula, readableProse, splitMath } from './Katex';

export { splitMath } from './Katex';

export function RichText({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const pieces = splitMath(trimmed);
  const mathPieces = pieces.filter((piece) => piece.math);
  const prosePieces = pieces.filter((piece) => !piece.math && piece.value.trim());
  if (mathPieces.length === 1 && prosePieces.length === 0) {
    const piece = mathPieces[0]!;
    return <Katex tex={piece.value} display={piece.display} />;
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
