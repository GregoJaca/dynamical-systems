import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const HASH_PREFIX = '#p=';

export type PdeView = 'home' | 'study' | 'examples' | 'about';
export type PdeFrameId = 'original' | 'simplified';

export interface PdeSnapshot {
  v: 1;
  draft: string;
  view: PdeView;
  theme: 'light' | 'dark';
  t0: number;
  x0: number;
  hidden: string[];
  selectedId: string | null;
  frame: PdeFrameId;
  partialN: number;
  parameters: Record<string, number>;
}

export function encodePdeState(snapshot: PdeSnapshot): string {
  return HASH_PREFIX + compressToEncodedURIComponent(JSON.stringify(snapshot));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function decodePdeState(hash: string): PdeSnapshot | null {
  const text = hash.startsWith('#') ? hash : `#${hash}`;
  if (!text.startsWith(HASH_PREFIX)) return null;
  const json = decompressFromEncodedURIComponent(text.slice(HASH_PREFIX.length));
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<PdeSnapshot>;
    if (!parsed || parsed.v !== 1 || typeof parsed.draft !== 'string') return null;
    if (parsed.view !== 'home' && parsed.view !== 'study' && parsed.view !== 'examples' && parsed.view !== 'about') return null;
    if (parsed.theme !== 'light' && parsed.theme !== 'dark') return null;
    if (parsed.frame !== 'original' && parsed.frame !== 'simplified') return null;
    if (!Array.isArray(parsed.hidden) || !parsed.hidden.every((id) => typeof id === 'string')) return null;
    const parameters: Record<string, number> = {};
    if (parsed.parameters && typeof parsed.parameters === 'object') {
      for (const [name, value] of Object.entries(parsed.parameters)) {
        if (typeof value === 'number' && Number.isFinite(value)) parameters[name] = value;
      }
    }
    const partial = finite(parsed.partialN, 4);
    return {
      v: 1,
      draft: parsed.draft,
      view: parsed.view,
      theme: parsed.theme,
      t0: finite(parsed.t0, 0),
      x0: finite(parsed.x0, 0),
      hidden: parsed.hidden,
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : null,
      frame: parsed.frame,
      partialN: Math.max(1, Math.round(partial)),
      parameters,
    };
  } catch {
    return null;
  }
}
