// Generates placeholder captures for the example project so it renders
// without a simulator: captures/<locale>/{iphone,ipad}/<id>.png at the exact
// captureDims of iphone-6.9 (1320x2868) and ipad-13 (2064x2752).
//
//   pnpm exec tsx example/screenshots/make-captures.ts [targetProjectDir]
//
// The smoke test imports `writeExampleCaptures` and points it at a temp copy.
import { mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import type { DeviceFamily, Dims } from '../../src/config/types.ts';

/** Capture names screens.ts references ("compare" reuses home + detail, so it needs none of its own). */
export const EXAMPLE_SCREEN_IDS: readonly string[] = ['home', 'detail', 'share', 'features'];

const CAPTURE_DIMS: ReadonlyArray<[DeviceFamily, Dims]> = [
  ['iphone', SIZE_PRESETS['iphone-6.9'].captureDims],
  ['ipad', SIZE_PRESETS['ipad-13'].captureDims],
];

function placeholderSvg(dims: Dims, id: string, index: number): string {
  const hue = (210 + index * 97) % 360;
  const bar = Math.round(dims.height * 0.05);
  const font = Math.round(dims.width / 10);
  const family = 'Helvetica, Arial, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width}" height="${dims.height}">
  <rect width="100%" height="100%" fill="hsl(${hue}, 45%, 24%)"/>
  <rect width="100%" height="${bar}" fill="hsl(${hue}, 45%, 16%)"/>
  <text x="${Math.round(dims.width * 0.06)}" y="${Math.round(bar * 0.68)}" font-family="${family}" font-size="${Math.round(bar * 0.5)}" font-weight="700" fill="#ffffff">9:41</text>
  <text x="50%" y="50%" text-anchor="middle" font-family="${family}" font-size="${font}" font-weight="700" fill="#ffffff">${id}</text>
  <text x="50%" y="${Math.round(dims.height / 2 + font)}" text-anchor="middle" font-family="${family}" font-size="${Math.round(font / 2)}" fill="#c9d1e6">${dims.width} x ${dims.height}</text>
</svg>`;
}

/** Writes one placeholder PNG per screen and family; returns the paths. */
export async function writeExampleCaptures(projectDir: string, locale = 'en-US'): Promise<string[]> {
  const written: string[] = [];
  for (const [family, dims] of CAPTURE_DIMS) {
    const dir = join(projectDir, 'captures', locale, family);
    await mkdir(dir, { recursive: true });
    for (const [index, id] of EXAMPLE_SCREEN_IDS.entries()) {
      const path = join(dir, `${id}.png`);
      await sharp(Buffer.from(placeholderSvg(dims, id, index))).removeAlpha().png().toFile(path);
      written.push(path);
    }
  }
  return written;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = process.argv[2] ? resolve(process.argv[2]) : dirname(fileURLToPath(import.meta.url));
  const files = await writeExampleCaptures(target);
  const show = (f: string): string => {
    const rel = relative(process.cwd(), f);
    return rel.startsWith('..') ? f : rel;
  };
  process.stdout.write(`${files.map(show).join('\n')}\n`);
}
