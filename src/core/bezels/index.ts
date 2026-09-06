// The bezel cache index (~/.screen1shoter/bezels/index.json): read, look up
// the entry for a preset, merge freshly installed entries and write it back.
// The download / mount / measure pipeline lives in install.ts.
import { join } from 'node:path';
import type { BezelEntry, BezelIndex, SizePreset } from '../../config/types.ts';
import { S1sError } from '../errors.ts';
import { errorMessage, readJsonFile, writeJsonAtomic } from '../fs.ts';
import { bezelDir } from '../paths.ts';
import { bezelIndexSchema, parseWith } from '../schemas.ts';
import { BEZEL_SOURCES, isBezelSourceId, type BezelFileName } from './sources.ts';

export function bezelIndexPath(dir: string = bezelDir()): string {
  return join(dir, 'index.json');
}

const REBUILD_HINT = 'Run `s1s bezels install --force` to rebuild it (the bad file is kept as index.json.bak).';

/** null when no index exists yet; S1sError('bezel-missing') when it is corrupt (install.ts rebuilds it). */
export async function readBezelIndex(dir: string = bezelDir()): Promise<BezelIndex | null> {
  const path = bezelIndexPath(dir);
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch (err) {
    throw new S1sError('bezel-missing', `Bezel index ${path} is unreadable: ${errorMessage(err)}`, { hint: REBUILD_HINT });
  }
  if (raw === undefined) return null;
  try {
    return parseWith(bezelIndexSchema, raw, 'bezel-missing', path);
  } catch (err) {
    throw new S1sError('bezel-missing', errorMessage(err), { hint: REBUILD_HINT });
  }
}

/** Writes the index atomically and returns its path. */
export async function writeBezelIndex(index: BezelIndex, dir: string = bezelDir()): Promise<string> {
  const path = bezelIndexPath(dir);
  await writeJsonAtomic(path, index);
  return path;
}

/** Cache file for a bezel: '<id>/<variant>.png', landscape files get a '-landscape' suffix. */
export function bezelEntryFile(name: Pick<BezelFileName, 'id' | 'variant' | 'orientation'>): string {
  return `${name.id}/${name.variant}${name.orientation === 'landscape' ? '-landscape' : ''}.png`;
}

/** Absolute path of an entry's PNG. */
export function bezelFilePath(entry: Pick<BezelEntry, 'file'>, dir: string = bezelDir()): string {
  return join(dir, entry.file);
}

/** One entry per id + variant + orientation. */
export function bezelEntryKey(entry: Pick<BezelEntry, 'id' | 'variant' | 'orientation'>): string {
  return `${entry.id}/${entry.variant}/${entry.orientation}`;
}

/** Position of a variant in sources.ts (`variants[0]` is the 'auto' default); unknown ones sort last, by name. */
function variantRank(entry: Pick<BezelEntry, 'id' | 'variant'>): number {
  if (!isBezelSourceId(entry.id)) return Number.MAX_SAFE_INTEGER;
  const rank = BEZEL_SOURCES[entry.id].variants.indexOf(entry.variant);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

const orientationRank = (entry: Pick<BezelEntry, 'orientation'>): number => (entry.orientation === 'portrait' ? 0 : 1);

const byKey = (a: BezelEntry, b: BezelEntry): number =>
  a.id.localeCompare(b.id) ||
  orientationRank(a) - orientationRank(b) ||
  variantRank(a) - variantRank(b) ||
  a.variant.localeCompare(b.variant);

/**
 * New index with `entries` replacing same-key entries of `index`, sorted by
 * id, portrait first, then source variant order so `findBezel(..., 'auto')`
 * and the browser's `selectBezel` take the default colour (`entries[0]`).
 */
export function upsertBezelEntries(index: BezelIndex | null, entries: readonly BezelEntry[]): BezelIndex {
  const merged = new Map<string, BezelEntry>();
  for (const entry of index?.entries ?? []) merged.set(bezelEntryKey(entry), entry);
  for (const entry of entries) merged.set(bezelEntryKey(entry), entry);
  return { version: 1, updatedAt: new Date().toISOString(), entries: [...merged.values()].sort(byKey) };
}

export interface BezelMatch {
  entry: BezelEntry;
  /** true when the entry comes from preset.bezelFallbacks, not preset.bezel. */
  fallback: boolean;
}

/**
 * Picks the portrait bezel for a preset: preset.bezel first, then
 * bezelFallbacks in order. `variant` 'auto' (or an uninstalled variant) takes
 * the first one installed for that id. null -> GenericBezel + 'bezel-fallback' warning.
 */
export function findBezel(index: BezelIndex | null, preset: SizePreset, variant = 'auto'): BezelMatch | null {
  if (!index) return null;
  const ids = [preset.bezel, ...preset.bezelFallbacks];
  for (const [position, id] of ids.entries()) {
    const entries = index.entries.filter((e) => e.id === id && e.orientation === 'portrait');
    const entry = (variant !== 'auto' ? entries.find((e) => e.variant === variant) : undefined) ?? entries[0];
    if (entry) return { entry, fallback: position > 0 };
  }
  return null;
}
