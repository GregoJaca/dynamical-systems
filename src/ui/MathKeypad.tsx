import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { FUNCTION_KEYS, GREEK_KEYS, MAIN_FUNCTION_KEYS, NUMPAD_KEYS, TOOL_KEYS, type KeySpec } from './mathEdit';

type Page = 'numbers' | 'functions' | 'greek';

export function MathKeypad({
  open,
  systemKeyboard,
  onEdit,
  onClose,
  onSystemKeyboard,
  onMathKeyboard,
}: {
  open: boolean;
  systemKeyboard: boolean;
  onEdit: (key: KeySpec) => void;
  onClose: () => void;
  onSystemKeyboard: () => void;
  onMathKeyboard: () => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>('numbers');

  useEffect(() => {
    if (!open) return;
    const node = padRef.current;
    if (!node) return;
    const write = () => {
      document.body.style.setProperty('--keypad-h', `${node.offsetHeight}px`);
      document.body.classList.add('keypad-open');
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.body.classList.remove('keypad-open');
      document.body.style.removeProperty('--keypad-h');
    };
  }, [open, page, systemKeyboard]);

  if (!open) return null;

  const hold = (event: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
  };

  return createPortal(
    <div className={systemKeyboard ? 'math-keypad math-keypad-system' : 'math-keypad'} ref={padRef} onPointerDown={hold} onMouseDown={hold}>
      <div className="math-keypad-inner" role="group" aria-label="Math keypad">
        {systemKeyboard ? (
          <div className="math-keypad-system-row">
            <button type="button" onPointerDown={hold} onMouseDown={hold} onClick={onMathKeyboard}>
              123
            </button>
            <span>System keyboard</span>
            <button type="button" onPointerDown={hold} onMouseDown={hold} onClick={onClose}>
              Hide
            </button>
          </div>
        ) : (
          <>
            <div className="math-keypad-tabs" role="tablist" aria-label="Keypad pages">
              <button type="button" role="tab" aria-selected={page === 'numbers'} onPointerDown={hold} onMouseDown={hold} onClick={() => setPage('numbers')}>
                123
              </button>
              <button type="button" role="tab" aria-selected={page === 'functions'} onPointerDown={hold} onMouseDown={hold} onClick={() => setPage('functions')}>
                f(x)
              </button>
              <button type="button" role="tab" aria-selected={page === 'greek'} onPointerDown={hold} onMouseDown={hold} onClick={() => setPage('greek')}>
                αβγ
              </button>
              <span className="spacer" />
              <button type="button" onPointerDown={hold} onMouseDown={hold} onClick={onSystemKeyboard}>
                ABC
              </button>
              <button type="button" onPointerDown={hold} onMouseDown={hold} onClick={onClose} aria-label="Hide keypad">
                Hide
              </button>
            </div>
            {page === 'numbers' ? (
              <div className="math-keypad-panels">
                <KeyGrid keys={MAIN_FUNCTION_KEYS} columns="fns" onEdit={onEdit} />
                <KeyGrid keys={NUMPAD_KEYS} columns="nums" onEdit={onEdit} />
              </div>
            ) : null}
            {page === 'functions' ? <KeyGrid keys={FUNCTION_KEYS} columns="four scroll" onEdit={onEdit} /> : null}
            {page === 'greek' ? <KeyGrid keys={GREEK_KEYS} columns="eight scroll" onEdit={onEdit} /> : null}
            <KeyGrid keys={TOOL_KEYS} columns="tools" onEdit={onEdit} />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M8.2 5.5h10.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8.2l-5.7-6.5 5.7-6.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11 9.2l5.2 5.6M16.2 9.2 11 14.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function KeyGrid({ keys, columns, onEdit }: { keys: KeySpec[]; columns: string; onEdit: (key: KeySpec) => void }) {
  return (
    <div className={`math-key-grid ${columns}`}>
      {keys.map((key) => (
        <KeyButton key={key.id} spec={key} onEdit={onEdit} />
      ))}
    </div>
  );
}

function KeyButton({ spec, onEdit }: { spec: KeySpec; onEdit: (key: KeySpec) => void }) {
  const repeat = useRef<number | null>(null);
  const start = useRef<number | null>(null);

  const stop = () => {
    if (start.current !== null) window.clearTimeout(start.current);
    if (repeat.current !== null) window.clearInterval(repeat.current);
    start.current = null;
    repeat.current = null;
  };

  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onEdit(spec);
    if (!spec.repeat) return;
    start.current = window.setTimeout(() => {
      repeat.current = window.setInterval(() => onEdit(spec), 55);
    }, 360);
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      className={['math-key', spec.tone ?? '', spec.label.length > 3 ? 'dense' : ''].filter(Boolean).join(' ')}
      aria-label={spec.aria}
      onPointerDown={press}
      onMouseDown={(event) => event.preventDefault()}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {spec.repeat && spec.aria === 'Backspace' ? <BackspaceIcon /> : spec.label}
    </button>
  );
}
