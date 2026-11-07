import type { ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-display text-[15px] tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'gold' | 'good' }) {
  const toneClass =
    tone === 'gold'
      ? 'bg-[#f0b429]/18 text-[#f0b429]'
      : tone === 'good'
        ? 'bg-sky-400/15 text-sky-300'
        : 'bg-black/10 text-inherit opacity-80';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass}`}>{children}</span>;
}
