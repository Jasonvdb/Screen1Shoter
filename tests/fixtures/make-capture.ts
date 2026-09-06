// Generates fake simulator captures with sharp: solid RGB PNGs of an exact
// pixel size with a label in the middle. Used by unit tests that need a file
// on disk and by the smoke test (W2).
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { getPreset } from '../../src/config/presets.ts';
import { captureRelPath } from '../../src/config/resolve.ts';
import type { DeviceFamily, Dims, SizeId } from '../../src/config/types.ts';

export interface MakeCaptureOptions {
  /** sRGB hex background. */
  background?: string;
  /** Text drawn in the centre. Default: "<width>x<height>". */
  label?: string;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Writes an RGB PNG (3 channels, no alpha) of exactly `dims` to `outPath`,
 * creating parent directories. Returns `outPath`.
 */
export async function makeCapture(outPath: string, dims: Dims, opts: MakeCaptureOptions = {}): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const background = opts.background ?? '#1c1c1e';
  const label = escapeXml(opts.label ?? `${dims.width}x${dims.height}`);
  const fontSize = Math.round(Math.min(dims.width, dims.height) / 10);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width}" height="${dims.height}">` +
    `<rect x="0" y="0" width="${dims.width}" height="${dims.height}" fill="${background}"/>` +
    `<rect x="${Math.round(dims.width * 0.06)}" y="${Math.round(dims.height * 0.06)}" ` +
    `width="${Math.round(dims.width * 0.88)}" height="${Math.round(dims.height * 0.88)}" ` +
    `fill="none" stroke="#8e8e93" stroke-width="${Math.max(2, Math.round(dims.width / 200))}"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" fill="#ffffff">${label}</text>` +
    `</svg>`;
  await sharp(Buffer.from(svg)).flatten({ background }).removeAlpha().png().toFile(outPath);
  return outPath;
}

/** Default size whose `captureDims` a family's captures are generated at. */
export const DEFAULT_CAPTURE_SIZE: Record<DeviceFamily, SizeId> = {
  iphone: 'iphone-6.9',
  ipad: 'ipad-13',
  watch: 'watch-s10',
};

/**
 * Writes `captures/<locale>/<family>/<ref>.png` for every ref, sized to the
 * preset's `captureDims`. Returns the absolute paths written.
 */
export async function makeProjectCaptures(
  projectDir: string,
  locale: string,
  refs: Partial<Record<DeviceFamily, readonly string[]>>,
  sizeByFamily: Partial<Record<DeviceFamily, SizeId>> = {},
): Promise<string[]> {
  const written: string[] = [];
  for (const family of Object.keys(refs) as DeviceFamily[]) {
    const preset = getPreset(sizeByFamily[family] ?? DEFAULT_CAPTURE_SIZE[family]);
    for (const ref of refs[family] ?? []) {
      const outPath = join(projectDir, captureRelPath(locale, family, ref));
      written.push(await makeCapture(outPath, preset.captureDims, { label: `${family}/${ref}` }));
    }
  }
  return written;
}
