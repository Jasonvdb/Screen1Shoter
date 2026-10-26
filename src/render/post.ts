// Post-processing of screenshot bytes with sharp: exact-size assertion,
// alpha flatten against the theme background, sha1 hash, previews.
// No browser knowledge lives here; render.ts and the watch passthrough both
// funnel their bytes through postProcess().
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { dimsEqual, formatDims } from '../config/presets.ts';
import type { Dims, SizePreset, Theme } from '../config/types.ts';
import { S1sError } from '../core/errors.ts';

/** Previews are written at one third of the output size. */
export const PREVIEW_SCALE = 1 / 3;

export interface ProcessedPng {
  /** Final PNG bytes: exact preset.px, 3 channels, no alpha. */
  png: Buffer;
  /** sha1 hex of `png`. */
  hash: string;
  dims: Dims;
}

export function sha1(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates and normalises screenshot bytes for App Store Connect.
 * Never resizes: a size mismatch is a hard `dims-mismatch` error because it
 * means the viewport or device scale factor was wrong.
 */
export async function postProcess(buffer: Buffer, preset: SizePreset, theme: Theme): Promise<ProcessedPng> {
  let meta: Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch (error) {
    throw new S1sError('render-failed', `Screenshot bytes are not a readable image: ${errorMessage(error)}`);
  }
  const dims: Dims = { width: meta.width, height: meta.height };
  if (!dimsEqual(dims, preset.px)) {
    throw new S1sError(
      'dims-mismatch',
      `Screenshot for ${preset.id} is ${formatDims(dims)}, expected ${formatDims(preset.px)}`,
      { hint: 'The renderer never resizes. Check the viewport, deviceScaleFactor and screenshot scale.' },
    );
  }

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(buffer)
      .flatten({ background: theme.background })
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new S1sError('render-failed', `Post-processing failed: ${errorMessage(error)}`, {
      hint: 'theme.background must be an sRGB colour such as "#101014".',
    });
  }
  if (out.info.channels !== 3) {
    throw new S1sError('render-failed', `Expected 3 channels after flattening, got ${out.info.channels}`);
  }
  const outDims: Dims = { width: out.info.width, height: out.info.height };
  if (!dimsEqual(outDims, preset.px)) {
    throw new S1sError('dims-mismatch', `Post-processed PNG is ${formatDims(outDims)}, expected ${formatDims(preset.px)}`);
  }
  return { png: out.data, hash: sha1(out.data), dims: outDims };
}

/** Writes the same PNG bytes to every path, creating directories as needed. */
export async function writePng(png: Buffer, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, png);
  }
}

/** Writes a scaled-down copy for humans and agents to look at (default 1/3). */
export async function writePreview(png: Buffer, previewPath: string, scale: number = PREVIEW_SCALE): Promise<void> {
  if (!(scale > 0 && scale <= 1)) throw new S1sError('usage', `Preview scale must be in (0, 1], got ${scale}`);
  const meta = await sharp(png).metadata();
  const width = Math.max(1, Math.round(meta.width * scale));
  await mkdir(dirname(previewPath), { recursive: true });
  await sharp(png).resize({ width, kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(previewPath);
}

/**
 * Width in pt an iPhone shows a creative asset at: the search card measured
 * about 365 pt in App Store Connect Preview; the header fills a 402 pt screen
 * after about 8% is cut from each side, so the whole canvas spans ~478 pt.
 * Both are third-party measurements (references/creative-assets.md), close
 * enough to judge whether the UI in the asset can still be read.
 */
export const CREATIVE_PHONE_WIDTH_PT: Readonly<Record<string, number>> = {
  CREATIVE_SEARCH: 365,
  CREATIVE_HEADER: 478,
  CREATIVE_UNIVERSAL: 478,
};

/** Share of the header's width an iPhone cuts from each side (third-party measurement). */
export const HEADER_SIDE_CUT = 0.08;

/** Paths of the review views `writeCreativeViews` writes for one output PNG. */
export function creativeViewPaths(outPath: string): { safe: string; phone: string } {
  const dir = join(dirname(outPath), 'store');
  const stem = basename(outPath, '.png');
  return { safe: join(dir, `${stem}-safe.png`), phone: join(dir, `${stem}-phone.png`) };
}

/**
 * Two review views of a creative asset, never uploaded: `-safe` is the Art
 * Safe Area at full resolution (what every App Store layout keeps), `-phone`
 * the whole asset at the pixel width an iPhone shows it (@3x). The agent's
 * validation step reads both; a preview at 1/3 hides what these show.
 */
export async function writeCreativeViews(png: Buffer, preset: SizePreset, outPath: string): Promise<{ safe: string; phone: string } | null> {
  const safe = preset.creative?.safeAreaPx;
  if (safe === undefined) return null;
  const paths = creativeViewPaths(outPath);
  await mkdir(dirname(paths.safe), { recursive: true });
  await sharp(png).extract({ left: safe.x, top: safe.y, width: safe.width, height: safe.height }).png({ compressionLevel: 9 }).toFile(paths.safe);
  // The header fills a 402 pt iPhone screen after about 8% is cut from each
  // side, so its phone view shows exactly that part; search shows it whole.
  const header = preset.displayType === 'CREATIVE_HEADER';
  const cut = header ? Math.round(preset.px.width * HEADER_SIDE_CUT) : 0;
  const widthPt = header ? 402 : (CREATIVE_PHONE_WIDTH_PT[preset.displayType] ?? 478);
  await sharp(png)
    .extract({ left: cut, top: 0, width: preset.px.width - 2 * cut, height: preset.px.height })
    .resize({ width: widthPt * 3, kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(paths.phone);
  return paths;
}
