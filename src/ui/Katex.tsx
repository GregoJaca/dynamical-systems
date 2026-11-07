import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function Katex({ tex, display = false }: { tex: string; display?: boolean }) {
  const node = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = node.current;
    if (!target) return;
    if (!tex.trim()) {
      target.textContent = '';
      return;
    }
    try {
      katex.render(tex, target, { throwOnError: false, displayMode: display, strict: 'ignore' });
    } catch {
      target.textContent = tex;
    }
  }, [tex, display]);
  return <span ref={node} className={display ? 'block overflow-x-auto py-0.5' : 'inline-block max-w-full overflow-x-auto align-middle'} />;
}
