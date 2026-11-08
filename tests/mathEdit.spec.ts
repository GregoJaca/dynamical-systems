import { describe, expect, it } from 'vitest';
import { applyMathEdit, FUNCTION_KEYS, GREEK_KEYS, MAIN_FUNCTION_KEYS, NUMPAD_KEYS, TOOL_KEYS } from '../src/ui/mathEdit';

function key(id: string) {
  const found = [...MAIN_FUNCTION_KEYS, ...NUMPAD_KEYS, ...TOOL_KEYS, ...FUNCTION_KEYS, ...GREEK_KEYS].find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing key ${id}`);
  return found;
}

describe('math keypad', () => {
  it('drops function templates around the caret', () => {
    const next = applyMathEdit('x + ', 4, 4, key('sin').edit(''));
    expect(next).toEqual({ value: 'x + sin()', cursor: 8 });
  });

  it('wraps a selection instead of replacing it', () => {
    const next = applyMathEdit('x + y', 4, 5, key('sin').edit('y'));
    expect(next).toEqual({ value: 'x + sin(y)', cursor: 10 });
    const squared = applyMathEdit('x+1', 0, 3, key('square').edit('x+1'));
    expect(squared.value).toBe('(x+1)^2');
  });

  it('inserts roots, absolute value, and fractions with the caret in the blank', () => {
    expect(applyMathEdit('', 0, 0, key('sqrt').edit(''))).toEqual({ value: 'sqrt()', cursor: 5 });
    expect(applyMathEdit('', 0, 0, key('abs').edit(''))).toEqual({ value: '||', cursor: 1 });
    expect(applyMathEdit('', 0, 0, key('fraction').edit(''))).toEqual({ value: '()/()', cursor: 1 });
    expect(applyMathEdit('', 0, 0, key('nthroot').edit(''))).toEqual({ value: 'nthRoot(, )', cursor: 8 });
  });

  it('deletes the selection or the previous character and moves the caret', () => {
    expect(applyMathEdit('sin(x)', 3, 6, key('backspace').edit(''))).toEqual({ value: 'sin', cursor: 3 });
    expect(applyMathEdit('sin', 0, 0, key('backspace').edit(''))).toEqual({ value: 'sin', cursor: 0 });
    expect(applyMathEdit('pi', 2, 2, key('left').edit(''))).toEqual({ value: 'pi', cursor: 1 });
    expect(applyMathEdit('pi', 0, 0, key('left').edit(''))).toEqual({ value: 'pi', cursor: 0 });
  });

  it('types operators and greek letters as parser input', () => {
    expect(applyMathEdit('2', 1, 1, key('mul').edit('')).value).toBe('2*');
    expect(applyMathEdit('', 0, 0, key('div').edit('')).value).toBe('/');
    expect(applyMathEdit('', 0, 0, key('theta').edit('')).value).toBe('θ');
    expect(applyMathEdit('', 0, 0, key('greek-μ').edit('')).value).toBe('μ');
    expect(key('arctan').edit('') ).toEqual({ op: 'insert', text: 'arctan()', cursor: 7 });
  });
});
