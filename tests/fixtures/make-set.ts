// PNG fixtures for the W5 export / validate / reconcile tests: flat RGB files
// of an exact pixel size (fast: raw pixels, no SVG rasterising) and the one
// shape App Store Connect rejects on sight, an alpha channel. Real files on
// disk; nothing here mocks the filesystem.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { Dims } from '../../src/config/types.ts';

export type Rgb = [number, number, number];

/** Stable, distinct-per-label colour so two fixture files never share bytes by accident. */
export function labelColour(label: string): Rgb {
  let hash = 0x811c9dc5;
  for (const char of label) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return [(hash >> 16) & 0xff, (hash >> 8) & 0xff, (hash & 0xff) | 0x20];
}

/** Writes a solid RGB PNG (3 channels, no alpha) of exactly `dims`, creating parent dirs. */
export async function makeFlatPng(outPath: string, dims: Dims, colour: Rgb): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const raw = Buffer.alloc(dims.width * dims.height * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = colour[0];
    raw[i + 1] = colour[1];
    raw[i + 2] = colour[2];
  }
  await sharp(raw, { raw: { width: dims.width, height: dims.height, channels: 3 } }).png().toFile(outPath);
  return outPath;
}

/**
 * Writes an RGBA PNG (4 channels) of exactly `dims` in which every pixel is
 * fully opaque. The channel alone is the violation, so `s1s validate` must
 * still reject it.
 */
export async function makeAlphaPng(outPath: string, dims: Dims, colour: Rgb = [28, 28, 30]): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const raw = Buffer.alloc(dims.width * dims.height * 4);
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = colour[0];
    raw[i + 1] = colour[1];
    raw[i + 2] = colour[2];
    raw[i + 3] = 255;
  }
  await sharp(raw, { raw: { width: dims.width, height: dims.height, channels: 4 } }).png().toFile(outPath);
  return outPath;
}

/**
 * Writes one exported set: `names` ('01.png', ...) inside `dir`, each exactly
 * `dims` and each with its own bytes. Returns the absolute paths in order.
 */
export async function writeExportSet(dir: string, names: readonly string[], dims: Dims): Promise<string[]> {
  const written: string[] = [];
  for (const name of names) {
    written.push(await makeFlatPng(join(dir, name), dims, labelColour(`${dir}/${name}`)));
  }
  return written;
}
