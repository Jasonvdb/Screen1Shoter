// Synthetic Apple-style bezels for tests that must never touch the network:
// one RGBA PNG per id (opaque magenta body, transparent screen cut-out with
// round corners, opaque black Dynamic Island) plus a bezels/index.json, laid
// out the way `s1s bezels install` stores them under S1S_HOME. Geometry comes
// from BEZEL_SOURCES (the Stage A facts), trimmed to deviceRect + BEZEL_TRIM.
//
// The body is exact magenta so a framed render can be scanned for it: the
// helpers at the bottom find the body, project the screen and island into
// output pixels, and count colours inside a region. `writeSyntheticDmgTree`
// lays the same PNGs out like a mounted Apple DMG (untrimmed, Apple's file
// names) so the install pipeline can run end to end without a download.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { BezelEntry, BezelIndex, Dims, Rect } from '../../src/config/types.ts';
import { BEZEL_SOURCES, isWatchBezelId, type BezelOrientation, type BezelSourceId } from '../../src/core/bezels/sources.ts';

/** Transparent margin kept around the device outline, as the installer does. */
export const BEZEL_TRIM = 2;

export type Rgb = readonly [number, number, number];

/** Body colour. Exact magenta appears in no capture, theme or text, so it is a safe marker. */
export const BEZEL_BODY_RGB: Rgb = [255, 0, 255];
export const BEZEL_ISLAND_RGB: Rgb = [0, 0, 0];

function shift(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/** The index entry of a synthetic bezel: BEZEL_SOURCES[id].portrait moved into a trimmed canvas. */
export function syntheticBezelEntry(id: BezelSourceId, variant?: string): BezelEntry {
  const source = BEZEL_SOURCES[id];
  const { deviceRect, screenRect, islandRect, cornerRadius } = source.portrait;
  const dx = BEZEL_TRIM - deviceRect.x;
  const dy = BEZEL_TRIM - deviceRect.y;
  const chosen = variant ?? source.variants[0] ?? 'default';
  const imageSize: Dims = { width: deviceRect.width + 2 * BEZEL_TRIM, height: deviceRect.height + 2 * BEZEL_TRIM };
  const entry: BezelEntry = {
    id,
    variant: chosen,
    file: `${id}/${chosen}.png`,
    imageSize,
    deviceRect: shift(deviceRect, dx, dy),
    screenRect: shift(screenRect, dx, dy),
    cornerRadius,
    orientation: 'portrait',
    screenAspect: screenRect.width / screenRect.height,
    pxPerPt: source.pxPerPt,
  };
  if (islandRect) entry.islandRect = shift(islandRect, dx, dy);
  return entry;
}

/**
 * The same bezel as Apple ships it: the full untrimmed portrait file
 * (`source.portrait.imageSize`) with the measured rects in place. Feeding
 * this through `s1s bezels install --from` must reproduce BEZEL_SOURCES.
 */
export function syntheticSourceEntry(id: BezelSourceId, variant?: string): BezelEntry {
  const source = BEZEL_SOURCES[id];
  const { imageSize, deviceRect, screenRect, islandRect, cornerRadius } = source.portrait;
  const chosen = variant ?? source.variants[0] ?? 'default';
  const entry: BezelEntry = {
    id,
    variant: chosen,
    file: `${id}/${chosen}.png`,
    imageSize: { ...imageSize },
    deviceRect: { ...deviceRect },
    screenRect: { ...screenRect },
    cornerRadius,
    orientation: 'portrait',
    screenAspect: screenRect.width / screenRect.height,
    pxPerPt: source.pxPerPt,
  };
  if (islandRect) entry.islandRect = { ...islandRect };
  return entry;
}

function roundedRect({ x, y, width, height }: Rect, r: number): string {
  const right = x + width;
  const bottom = y + height;
  return (
    `M${x + r},${y} H${right - r} A${r},${r} 0 0 1 ${right},${y + r} V${bottom - r} ` +
    `A${r},${r} 0 0 1 ${right - r},${bottom} H${x + r} A${r},${r} 0 0 1 ${x},${bottom - r} ` +
    `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`
  );
}

const rgb = ([r, g, b]: Rgb): string => `rgb(${r},${g},${b})`;

/** SVG source of the bezel image: body with an even-odd screen hole, plus the island pill. */
export function bezelSvg(entry: BezelEntry): string {
  const { imageSize, deviceRect, screenRect, cornerRadius, islandRect } = entry;
  const border = screenRect.x - deviceRect.x;
  const body = `${roundedRect(deviceRect, cornerRadius + border)} ${roundedRect(screenRect, cornerRadius)}`;
  const island = islandRect
    ? `<rect x="${islandRect.x}" y="${islandRect.y}" width="${islandRect.width}" height="${islandRect.height}" ` +
      `rx="${islandRect.height / 2}" ry="${islandRect.height / 2}" fill="${rgb(BEZEL_ISLAND_RGB)}"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imageSize.width}" height="${imageSize.height}">` +
    `<path fill-rule="evenodd" fill="${rgb(BEZEL_BODY_RGB)}" d="${body}"/>${island}</svg>`
  );
}

/** Rasterises the entry to an RGBA PNG at `path` (parents created); `rotate` 90 makes the landscape file. */
export async function writeSyntheticBezelFile(path: string, entry: BezelEntry, rotate: 0 | 90 = 0): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(bezelSvg(entry))).ensureAlpha().rotate(rotate).png().toFile(path);
  return path;
}

/** Writes `<bezelDir>/<entry.file>` as an RGBA PNG and returns the path. */
export async function writeSyntheticBezel(bezelDir: string, entry: BezelEntry): Promise<string> {
  return writeSyntheticBezelFile(join(bezelDir, entry.file), entry);
}

/**
 * Populates `<home>/bezels/` (S1S_HOME layout) with one synthetic bezel per id
 * and an index.json, and returns the index. Existing files are overwritten.
 */
export async function writeSyntheticBezelHome(home: string, ids: readonly BezelSourceId[]): Promise<BezelIndex> {
  const dir = join(home, 'bezels');
  const entries = ids.map((id) => syntheticBezelEntry(id));
  for (const entry of entries) await writeSyntheticBezel(dir, entry);
  const index: BezelIndex = { version: 1, updatedAt: new Date().toISOString(), entries };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

// ---------------------------------------------------------------------------
// A fake DMG mount: Apple's folder layout with synthetic PNGs
// ---------------------------------------------------------------------------

/** 'deep-blue' -> 'Deep Blue', the colour part of Apple's file names. */
export function bezelColourName(variant: string): string {
  return variant
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A watch model carries its case size where a phone model does not, and it is
 * the only shape whose file name has no orientation part. That is exactly what
 * `normaliseBezelFilename` keys on, so the fixture must reproduce it.
 */
export function isWatchModel(id: BezelSourceId): boolean {
  return isWatchBezelId(id);
}

/**
 * Path of a bezel PNG relative to the DMG's `PNG/` folder, exactly as Apple
 * names it: `<model> - <Colour> - <Portrait|Landscape>.png` for a phone or
 * iPad, `<model> - <Case> + <Band>.png` for a watch (there is no landscape
 * file, and the model already holds the case size when the DMG ships two).
 *
 * The real watch names join case and band with " + ", which `bezelSlug` folds
 * to the same dash as a space, so the slug round-trips either way.
 */
export function appleBezelRelPath(id: BezelSourceId, variant: string, orientation: BezelOrientation): string {
  const source = BEZEL_SOURCES[id];
  const name = isWatchModel(id)
    ? `${source.model} - ${bezelColourName(variant)}.png`
    : `${source.model} - ${bezelColourName(variant)} - ${orientation === 'portrait' ? 'Portrait' : 'Landscape'}.png`;
  return source.subDir ? `${source.subDir}/${name}` : name;
}

export interface SyntheticDmgTree {
  /** Portrait PNGs, relative to `root`. */
  portrait: string[];
  /** Landscape PNGs, relative to `root`. */
  landscape: string[];
  /** Non-bezel files the installer must ignore, relative to `root`. */
  decoys: string[];
}

/**
 * Lays out `root` like a mounted Apple bezel DMG (docs/bezels.md): `PNG/`
 * (flat for iPad, one sub-folder per iPhone model) with the first variant of
 * every id in portrait and landscape at Apple's full untrimmed size, plus the
 * decoys a real image carries (.DS_Store, the licence RTF, Photoshop/*.psd,
 * .DropDMGBackground/*.png). `s1s bezels install --from <root>` must find the
 * portrait files and skip everything else.
 */
export async function writeSyntheticDmgTree(root: string, ids: readonly BezelSourceId[]): Promise<SyntheticDmgTree> {
  const tree: SyntheticDmgTree = { portrait: [], landscape: [], decoys: [] };
  const pngDir = join(root, 'PNG');
  for (const id of ids) {
    const entry = syntheticSourceEntry(id);
    const portrait = `PNG/${appleBezelRelPath(id, entry.variant, 'portrait')}`;
    await writeSyntheticBezelFile(join(root, portrait), entry);
    tree.portrait.push(portrait);
    // Apple ships no landscape watch bezel, so neither does the fixture.
    if (!isWatchModel(id)) {
      const landscape = `PNG/${appleBezelRelPath(id, entry.variant, 'landscape')}`;
      await writeSyntheticBezelFile(join(root, landscape), entry, 90);
      tree.landscape.push(landscape);
    }
    const psd = `Photoshop/${BEZEL_SOURCES[id].model}.psd`;
    await mkdir(dirname(join(root, psd)), { recursive: true });
    await writeFile(join(root, psd), '8BPS');
    tree.decoys.push(psd);
  }
  const background = '.DropDMGBackground/Bezel@2x.png';
  await mkdir(dirname(join(root, background)), { recursive: true });
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#dddddd' } })
    .png()
    .toFile(join(root, background));
  await writeFile(join(root, '.DS_Store'), Buffer.alloc(16));
  await writeFile(join(pngDir, '.DS_Store'), Buffer.alloc(16));
  await writeFile(join(root, 'Apple Design Resources License.rtf'), '{\\rtf1 licence}');
  tree.decoys.push(background, '.DS_Store', 'PNG/.DS_Store', 'Apple Design Resources License.rtf');
  return tree;
}

// ---------------------------------------------------------------------------
// Reading a framed render back
// ---------------------------------------------------------------------------

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export async function readRaw(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

export function pixelAt(img: RawImage, x: number, y: number): Rgb {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i] ?? -1, img.data[i + 1] ?? -1, img.data[i + 2] ?? -1];
}

function near(img: RawImage, i: number, [r, g, b]: Rgb, tolerance: number): boolean {
  return (
    Math.abs((img.data[i] ?? -999) - r) <= tolerance &&
    Math.abs((img.data[i + 1] ?? -999) - g) <= tolerance &&
    Math.abs((img.data[i + 2] ?? -999) - b) <= tolerance
  );
}

/** Bounding box of every pixel within `tolerance` of `color` (optionally only inside `within`), or null when there is none. */
export function colorBounds(img: RawImage, color: Rgb, tolerance = 0, within?: Rect): Rect | null {
  const region = within ?? { x: 0, y: 0, width: img.width, height: img.height };
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(img.height, Math.ceil(region.y + region.height));
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!near(img, (y * img.width + x) * img.channels, color, tolerance)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** true when pixel centre (x, y) lies inside `rect` rounded by `radius` (a screen-shaped region). */
function insideRounded(x: number, y: number, rect: Rect, radius: number): boolean {
  if (radius <= 0) return true;
  const cx = x + 0.5;
  const cy = y + 0.5;
  const dx = Math.max(rect.x + radius - cx, cx - (rect.x + rect.width - radius), 0);
  const dy = Math.max(rect.y + radius - cy, cy - (rect.y + rect.height - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Number of pixels within `tolerance` of `color`, optionally restricted to
 * `within` (clamped to the image), whose corners are rounded by `radius`.
 */
export function countColor(img: RawImage, color: Rgb, within?: Rect, tolerance = 0, radius = 0): number {
  const region = within ?? { x: 0, y: 0, width: img.width, height: img.height };
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(img.height, Math.ceil(region.y + region.height));
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!insideRounded(x, y, region, radius)) continue;
      if (near(img, (y * img.width + x) * img.channels, color, tolerance)) count += 1;
    }
  }
  return count;
}

/** Up to `limit` (x, y) positions within `tolerance` of `color` inside `within` (corners rounded by `radius`); for failure messages. */
export function locateColor(img: RawImage, color: Rgb, within: Rect, tolerance = 0, limit = 8, radius = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const x0 = Math.max(0, Math.floor(within.x));
  const y0 = Math.max(0, Math.floor(within.y));
  const x1 = Math.min(img.width, Math.ceil(within.x + within.width));
  const y1 = Math.min(img.height, Math.ceil(within.y + within.height));
  for (let y = y0; y < y1 && out.length < limit; y += 1) {
    for (let x = x0; x < x1 && out.length < limit; x += 1) {
      if (!insideRounded(x, y, within, radius)) continue;
      if (near(img, (y * img.width + x) * img.channels, color, tolerance)) out.push([x, y]);
    }
  }
  return out;
}

export interface ProjectedBezel {
  /** Output pixels per bezel pixel. */
  k: number;
  screen: Rect;
  island: Rect | null;
  /** Screen corner radius in output pixels. */
  radius: number;
}

/** Where the entry's screen and island land in a render whose body (magenta) bounding box is `body`. */
export function projectBezel(entry: BezelEntry, body: Rect): ProjectedBezel {
  const k = body.width / entry.deviceRect.width;
  const place = (rect: Rect): Rect => ({
    x: body.x + (rect.x - entry.deviceRect.x) * k,
    y: body.y + (rect.y - entry.deviceRect.y) * k,
    width: rect.width * k,
    height: rect.height * k,
  });
  return { k, screen: place(entry.screenRect), island: entry.islandRect ? place(entry.islandRect) : null, radius: entry.cornerRadius * k };
}

/** `rect` shrunk by `by` pixels on every side. */
export function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, width: rect.width - 2 * by, height: rect.height - 2 * by };
}

/** Integer centre of a rect. */
export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}
