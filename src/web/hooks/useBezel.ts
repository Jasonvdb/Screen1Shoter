// Picks the bezel for a preset from /bezels/index.json (fetched once per page,
// token held so the renderer waits). 404 or no matching id -> generic CSS
// frame geometry plus fallback: 'generic'. The pure selection is in bezel.ts.
import { useEffect, useState } from 'react';
import type { BezelIndex, SizePreset, Theme } from '../../config/types.ts';
import { acquire } from '../runtime/ready.ts';
import { selectBezel, type BezelOptions, type ReadyBezel } from './bezel.ts';

export type { BezelFallback, BezelOptions, ReadyBezel } from './bezel.ts';

export type BezelLookup = { status: 'loading' } | ReadyBezel;

let indexPromise: Promise<BezelIndex | null> | null = null;
let indexValue: BezelIndex | null | undefined;

async function fetchIndex(): Promise<BezelIndex | null> {
  try {
    const res = await fetch('/bezels/index.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<BezelIndex>;
    return Array.isArray(json.entries) ? (json as BezelIndex) : null;
  } catch {
    return null;
  }
}

export function loadBezelIndex(): Promise<BezelIndex | null> {
  if (!indexPromise) {
    indexPromise = fetchIndex().then((value) => {
      indexValue = value;
      return value;
    });
  }
  return indexPromise;
}

/** `opts.variant` beats theme.bezelVariant; `opts.bezelId` beats preset.bezel. */
export function lookupBezel(index: BezelIndex | null, preset: SizePreset, theme: Theme, opts: BezelOptions = {}): ReadyBezel {
  return selectBezel(index, preset, { bezelId: opts.bezelId, variant: opts.variant ?? theme.bezelVariant });
}

export function useBezel(preset: SizePreset, theme: Theme, opts: BezelOptions = {}): BezelLookup {
  const [index, setIndex] = useState<BezelIndex | null | undefined>(indexValue);
  useEffect(() => {
    if (index !== undefined) return;
    const release = acquire('bezel-index');
    let alive = true;
    loadBezelIndex()
      .then((value) => {
        if (alive) setIndex(value);
      })
      .finally(release);
    return () => {
      alive = false;
    };
  }, [index]);
  return index === undefined ? { status: 'loading' } : lookupBezel(index, preset, theme, opts);
}
