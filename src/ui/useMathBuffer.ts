import { useRef } from 'react';
import { applyMathEdit, type KeySpec } from './mathEdit';

type Mirror = { value: string; start: number; end: number };

/** Remembers the caret so keypad taps can edit a controlled input without blurring it. */
export function useMathBuffer() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirror = useRef<Mirror>({ value: '', start: 0, end: 0 });
  const armed = useRef<number | null>(null);

  const attach = (input: HTMLInputElement) => {
    inputRef.current = input;
    if (armed.current !== null) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    mirror.current = { value: input.value, start, end };
  };

  const syncFromInput = (input: HTMLInputElement) => {
    if (armed.current !== null) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    mirror.current = { value: input.value, start, end };
  };

  const place = () => {
    const input = inputRef.current;
    const pos = armed.current;
    if (!input || pos === null) return;
    input.focus();
    const cursor = Math.min(pos, input.value.length);
    input.setSelectionRange(cursor, cursor);
    mirror.current = { value: input.value, start: cursor, end: cursor };
    armed.current = null;
  };

  const applyKey = (key: KeySpec): string => {
    const input = inputRef.current;
    const base = mirror.current;
    let start = base.start;
    let end = base.end;
    if (input && input.value === base.value) {
      start = input.selectionStart ?? start;
      end = input.selectionEnd ?? end;
    }
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const next = applyMathEdit(base.value, lo, hi, key.edit(base.value.slice(lo, hi)));
    mirror.current = { value: next.value, start: next.cursor, end: next.cursor };
    armed.current = next.cursor;
    return next.value;
  };

  const arm = (cursor: number) => {
    armed.current = cursor;
  };

  return { inputRef, attach, syncFromInput, place, applyKey, arm };
}
