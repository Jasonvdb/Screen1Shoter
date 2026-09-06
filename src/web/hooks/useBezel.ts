// Picks the bezel for a preset from /bezels/index.json (cached per page).
// 404 or no matching id -> generic CSS frame geometry plus a bezel-fallback flag.
import { useEffect, useState } from 'react';
import type { BezelEntry, BezelIndex, SizePreset, Theme } from '../../config/types.ts';
import type { FrameGeometry } from '../components/DeviceFrame.tsx';
import { genericGeometry } from '../components/GenericBezel.tsx';
import { acquire } from '../runtime/ready.ts';

export interface ReadyBezel {
  status: 'ready';
  /** null when no bezel is installed for the preset. */
  entry: BezelEntry | null;
  geometry: FrameGeometry;
  /** '/bezels/<id>/<variant>.png' or null for the generic frame. */
  url: string | null;
  /** preset.bezel: the id we wanted (reported by the bezel-fallback warning). */
  wantedId: string;
  variant: string | null;
}

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

function bezelUrl(entry: BezelEntry): string {
  return `/bezels/${entry.file.split('/').map(encodeURIComponent).join('/')}`;
}

/** Preferred id first, then the fallbacks; theme variant when installed, else the first variant. */
export function lookupBezel(index: BezelIndex | null, preset: SizePreset, theme: Theme): ReadyBezel {
  for (const id of [preset.bezel, ...preset.bezelFallbacks]) {
    const matches = index?.entries.filter((e) => e.id === id && e.orientation === 'portrait') ?? [];
    const wanted = theme.bezelVariant === 'auto' ? undefined : matches.find((e) => e.variant === theme.bezelVariant);
    const entry = wanted ?? matches[0];
    if (entry) {
      return { status: 'ready', entry, geometry: entry, url: bezelUrl(entry), wantedId: preset.bezel, variant: entry.variant };
    }
  }
  return {
    status: 'ready',
    entry: null,
    geometry: genericGeometry(preset.family, preset.pt),
    url: null,
    wantedId: preset.bezel,
    variant: null,
  };
}

export function useBezel(preset: SizePreset, theme: Theme): BezelLookup {
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
  return index === undefined ? { status: 'loading' } : lookupBezel(index, preset, theme);
}
