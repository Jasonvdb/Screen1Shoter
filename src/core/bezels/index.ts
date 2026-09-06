// Reads the bezel cache index (~/.screen1shoter/bezels/index.json). The
// download / measure / install commands arrive in W2; this module only reads.
import { join } from 'node:path';
import type { BezelEntry, BezelIndex, SizePreset } from '../../config/types.ts';
import { S1sError } from '../errors.ts';
import { errorMessage, readJsonFile } from '../fs.ts';
import { bezelDir } from '../paths.ts';
import { bezelIndexSchema, parseWith } from '../schemas.ts';

export function bezelIndexPath(dir: string = bezelDir()): string {
  return join(dir, 'index.json');
}

/** null when no index exists yet; S1sError('bezel-missing') when it is corrupt. */
export async function readBezelIndex(dir: string = bezelDir()): Promise<BezelIndex | null> {
  const path = bezelIndexPath(dir);
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch (err) {
    throw new S1sError('bezel-missing', `Bezel index ${path} is unreadable: ${errorMessage(err)}`, {
      hint: 'Run `s1s bezels install` to rebuild it.',
    });
  }
  if (raw === undefined) return null;
  return parseWith(bezelIndexSchema, raw, 'bezel-missing', path);
}

export interface BezelMatch {
  entry: BezelEntry;
  /** true when the entry comes from preset.bezelFallbacks, not preset.bezel. */
  fallback: boolean;
}

/**
 * Picks the bezel for a preset: preset.bezel first, then bezelFallbacks in
 * order. `variant` 'auto' (or an uninstalled variant) takes the first one
 * installed for that id. null -> GenericBezel + 'bezel-fallback' warning.
 */
export function findBezel(index: BezelIndex | null, preset: SizePreset, variant = 'auto'): BezelMatch | null {
  if (!index) return null;
  const ids = [preset.bezel, ...preset.bezelFallbacks];
  for (const [position, id] of ids.entries()) {
    const entries = index.entries.filter((e) => e.id === id);
    const entry = (variant !== 'auto' ? entries.find((e) => e.variant === variant) : undefined) ?? entries[0];
    if (entry) return { entry, fallback: position > 0 };
  }
  return null;
}
