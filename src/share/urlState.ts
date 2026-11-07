import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { ShareSnapshot } from '../core/types';

const HASH_PREFIX = '#s=';

export function encodeShareState(snapshot: ShareSnapshot): string {
  return HASH_PREFIX + compressToEncodedURIComponent(JSON.stringify(snapshot));
}

export function decodeShareState(hash: string): ShareSnapshot | null {
  const text = hash.startsWith('#') ? hash : `#${hash}`;
  if (!text.startsWith(HASH_PREFIX)) return null;
  const json = decompressFromEncodedURIComponent(text.slice(HASH_PREFIX.length)) as string | null;
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ShareSnapshot;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.rows) || !parsed.layers || !parsed.viewport) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
