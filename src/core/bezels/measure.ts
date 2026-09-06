// Measures an Apple product-bezel PNG: where the opaque device is, where the
// transparent screen cut-out is, the Dynamic Island, and a CSS corner radius
// that clips a capture without gaps. Works on raw RGBA from sharp, one image
// at a time (a 2300x3000 file is a 27 MB buffer). The method and thresholds
// come from the W2 Stage A spike (docs/bezels.md); `measureRaw` is pure so
// the unit test can feed it a synthetic bezel.
import sharp from 'sharp';
import { ALL_SIZE_IDS, SIZE_PRESETS } from '../../config/presets.ts';
import type { Dims, Rect, SizeId, SizePreset } from '../../config/types.ts';
import { S1sError } from '../errors.ts';
import type { BezelOrientation } from './sources.ts';

/** alpha <= this is see-through (the screen interior is 0, edge anti-aliasing 1-12). */
export const TRANSPARENT_ALPHA = 12;
/** Scans from the screen centre stop at the first pixel above this. */
const EDGE_ALPHA = 64;
/** Half coverage: an unbiased boundary for the corner profile. */
const HALF_ALPHA = 128;
/** Pixels kept around the device when trimming. */
export const TRIM_PAD = 2;
/** A circle of radius r crosses its corner diagonal at r * (1 - 1/sqrt(2)) from the corner. */
const DIAGONAL_FACTOR = 1 - Math.SQRT1_2;

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Buffer;
}

export interface BezelMeasurement {
  imageSize: Dims;
  orientation: BezelOrientation;
  /** Bounding box of alpha > TRANSPARENT_ALPHA. */
  deviceRect: Rect;
  /** Bounding box of the transparent cut-out inside the device. */
  screenRect: Rect;
  /** Opaque Dynamic Island inside the screen (iPhone). */
  islandRect?: Rect;
  /** Largest CSS circle radius (bezel px) that leaves no background gap at the screen corners. */
  cornerRadius: number;
  /** screenRect.width / screenRect.height, 4 decimals. */
  screenAspect: number;
  /** Bezel pixels per Apple point (preset scale, else PNG dpi / 72). */
  pxPerPt?: number;
  /** Preset whose screen aspect matches within 1% (portrait comparison). */
  presetId?: SizeId;
}

const alphaAt = (img: RawImage, x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3] ?? 0;

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function rectOf(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Bounding box of the pixels inside `region` whose alpha satisfies `keep`, or null. */
function boundingBox(img: RawImage, region: Rect, keep: (alpha: number) => boolean): Rect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y1 = -1;
  const xEnd = Math.min(img.width, region.x + region.width);
  const yEnd = Math.min(img.height, region.y + region.height);
  for (let y = Math.max(0, region.y); y < yEnd; y++) {
    const rowStart = y * img.width * 4 + 3;
    for (let x = Math.max(0, region.x); x < xEnd; x++) {
      if (!keep(img.data[rowStart + x * 4] ?? 0)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : rectOf(x0, y0, x1, y1);
}

/** From (x, y) outward along one axis while alpha <= EDGE_ALPHA; returns the last transparent coordinate. */
function scanUntilEdge(img: RawImage, x: number, y: number, dx: number, dy: number): number {
  let cx = x;
  let cy = y;
  for (;;) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height || alphaAt(img, nx, ny) > EDGE_ALPHA) break;
    cx = nx;
    cy = ny;
  }
  return dx !== 0 ? cx : cy;
}

function fail(message: string): S1sError {
  return new S1sError('bezel-missing', message, {
    hint: 'Expected an Apple product bezel PNG: an opaque device with a transparent screen cut-out.',
  });
}

/**
 * Screen x-range from row scans at mid height and at 20% height (an iPhone
 * landscape file has its island at mid height, so the union of both rows is
 * the real width), y-range from a column scan 20% into that range.
 */
function findScreenBox(img: RawImage, device: Rect): Rect {
  const cx = device.x + Math.floor(device.width / 2);
  const cy = device.y + Math.floor(device.height / 2);
  if (alphaAt(img, cx, cy) > TRANSPARENT_ALPHA) throw fail('the device centre is opaque: no screen cut-out found');
  let left = Number.POSITIVE_INFINITY;
  let right = -1;
  for (const y of [cy, device.y + Math.round(device.height * 0.2)]) {
    if (alphaAt(img, cx, y) > EDGE_ALPHA) continue;
    left = Math.min(left, scanUntilEdge(img, cx, y, -1, 0));
    right = Math.max(right, scanUntilEdge(img, cx, y, 1, 0));
  }
  const probeX = left + Math.round((right - left + 1) * 0.2);
  const top = scanUntilEdge(img, probeX, cy, 0, -1);
  const bottom = scanUntilEdge(img, probeX, cy, 0, 1);
  return rectOf(left, top, right, bottom);
}

/** Opaque pill on the screen's leading edge (top in portrait, left in landscape), away from the corners. */
function findIsland(img: RawImage, screen: Rect, orientation: BezelOrientation): Rect | undefined {
  const region: Rect =
    orientation === 'portrait'
      ? { x: screen.x + Math.round(screen.width * 0.2), y: screen.y, width: Math.round(screen.width * 0.6), height: Math.round(screen.height * 0.15) }
      : { x: screen.x, y: screen.y + Math.round(screen.height * 0.2), width: Math.round(screen.width * 0.15), height: Math.round(screen.height * 0.6) };
  const island = boundingBox(img, region, (a) => a > TRANSPARENT_ALPHA);
  if (!island) return undefined;
  // Anything that large is not an island (a screen that is not transparent).
  if (island.width * island.height > screen.width * screen.height * 0.1) return undefined;
  return island;
}

/**
 * Corner profile of the top-left screen corner: for each row from the screen
 * top, the first half-covered transparent x, counted from the screen's left
 * edge. Scanned inward from 20% of the width (the bounding-box corner itself
 * lies outside the phone body on iPhones). Stops at the first row that
 * reaches the edge (offset 0).
 */
export function cornerProfile(img: RawImage, screen: Rect): number[] {
  const offsets: number[] = [];
  const startX = screen.x + Math.round(screen.width * 0.2);
  const maxRows = Math.floor(Math.min(screen.width, screen.height) / 2);
  for (let i = 0; i < maxRows; i++) {
    const y = screen.y + i;
    let x = startX;
    while (x > screen.x && alphaAt(img, x - 1, y) < HALF_ALPHA) x--;
    const offset = x - screen.x;
    offsets.push(offset);
    if (offset === 0) break;
  }
  return offsets;
}

/**
 * CSS circle radius from the row where the corner profile crosses the 45
 * degree diagonal (offset <= row): for a circle this reproduces its radius;
 * for Apple's superellipse corners it gives the largest circle that leaves no
 * background gap (docs/bezels.md). Cross-checked against the top row: on a
 * circle the tangent row under-reads by about sqrt(r), so anything above
 * offset(0) + sqrt(offset(0)) + 2 means the profile is not a corner.
 */
export function radiusFromProfile(offsets: readonly number[]): number {
  const first = offsets[0];
  if (first === undefined || first <= 0) return 0;
  for (let i = 1; i < offsets.length; i++) {
    const prev = offsets[i - 1] ?? 0;
    const cur = offsets[i] ?? 0;
    if (cur > i) continue;
    const above = prev - (i - 1);
    const below = i - cur;
    const crossing = i - 1 + above / (above + below);
    const diagonal = crossing / DIAGONAL_FACTOR;
    return Math.round(Math.min(diagonal, first + Math.sqrt(first) + 2));
  }
  return first;
}

/** Preset whose screen aspect matches within 1% (exact px first, then the closest aspect; aliases and passthrough skipped). */
export function matchPreset(screen: Dims, orientation: BezelOrientation): SizePreset | undefined {
  const portrait = orientation === 'portrait' ? screen : { width: screen.height, height: screen.width };
  const aspect = portrait.width / portrait.height;
  let best: { preset: SizePreset; error: number } | undefined;
  for (const id of ALL_SIZE_IDS) {
    const preset = SIZE_PRESETS[id];
    if (preset.aliasOf || preset.passthrough) continue;
    if (preset.px.width === portrait.width && preset.px.height === portrait.height) return preset;
    const presetAspect = preset.px.width / preset.px.height;
    const error = Math.abs(aspect - presetAspect) / presetAspect;
    if (error < 0.01 && (!best || error < best.error)) best = { preset, error };
  }
  return best?.preset;
}

/** Pure measurement of an RGBA image. Throws S1sError('bezel-missing') when the image is not a bezel. */
export function measureRaw(img: RawImage, opts: { density?: number } = {}): BezelMeasurement {
  if (img.data.length < img.width * img.height * 4) throw fail('image buffer is not RGBA');
  const full: Rect = { x: 0, y: 0, width: img.width, height: img.height };
  const deviceRect = boundingBox(img, full, (a) => a > TRANSPARENT_ALPHA);
  if (!deviceRect) throw fail('image is fully transparent');
  if (deviceRect.width < 8 || deviceRect.height < 8) throw fail('device outline is too small');
  const box = findScreenBox(img, deviceRect);
  const screenRect = boundingBox(img, box, (a) => a <= TRANSPARENT_ALPHA);
  if (!screenRect) throw fail('no transparent screen cut-out found');
  const orientation: BezelOrientation = screenRect.width > screenRect.height ? 'landscape' : 'portrait';
  const islandRect = findIsland(img, screenRect, orientation);
  const cornerRadius = radiusFromProfile(cornerProfile(img, screenRect));
  const preset = matchPreset(screenRect, orientation);
  const fromDensity = opts.density && opts.density % 72 === 0 ? opts.density / 72 : undefined;
  const pxPerPt = preset?.scale ?? fromDensity;
  const measurement: BezelMeasurement = {
    imageSize: { width: img.width, height: img.height },
    orientation,
    deviceRect,
    screenRect,
    cornerRadius,
    screenAspect: round4(screenRect.width / screenRect.height),
  };
  if (islandRect) measurement.islandRect = islandRect;
  if (pxPerPt !== undefined) measurement.pxPerPt = pxPerPt;
  if (preset) measurement.presetId = preset.id;
  return measurement;
}

/** Decodes a PNG to raw RGBA without sharp's default pixel limit. */
export async function loadRawImage(path: string): Promise<RawImage & { density?: number }> {
  const image = sharp(path, { limitInputPixels: false });
  const meta = await image.metadata();
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw fail(`${path}: expected RGBA, got ${info.channels} channels`);
  const raw: RawImage & { density?: number } = { width: info.width, height: info.height, data };
  if (typeof meta.density === 'number') raw.density = meta.density;
  return raw;
}

export async function measureBezel(path: string): Promise<BezelMeasurement> {
  const raw = await loadRawImage(path);
  try {
    return measureRaw(raw, raw.density === undefined ? {} : { density: raw.density });
  } catch (err) {
    if (err instanceof S1sError) throw new S1sError(err.code, `${path}: ${err.message}`, err.hint ? { hint: err.hint } : {});
    throw err;
  }
}

/** deviceRect grown by `pad`, clamped to the image. */
export function trimRect(m: Pick<BezelMeasurement, 'imageSize' | 'deviceRect'>, pad: number = TRIM_PAD): Rect {
  const x0 = Math.max(0, m.deviceRect.x - pad);
  const y0 = Math.max(0, m.deviceRect.y - pad);
  const x1 = Math.min(m.imageSize.width, m.deviceRect.x + m.deviceRect.width + pad);
  const y1 = Math.min(m.imageSize.height, m.deviceRect.y + m.deviceRect.height + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const shift = (r: Rect, by: Rect): Rect => ({ x: r.x - by.x, y: r.y - by.y, width: r.width, height: r.height });

/** The same measurement expressed inside the trimmed image. */
export function shiftMeasurement(m: BezelMeasurement, trim: Rect): BezelMeasurement {
  const out: BezelMeasurement = {
    ...m,
    imageSize: { width: trim.width, height: trim.height },
    deviceRect: shift(m.deviceRect, trim),
    screenRect: shift(m.screenRect, trim),
  };
  if (m.islandRect) out.islandRect = shift(m.islandRect, trim);
  return out;
}

/** Crops `srcPath` to `trim` and writes a PNG (alpha kept) to `destPath`. */
export async function writeTrimmedBezel(srcPath: string, destPath: string, trim: Rect): Promise<void> {
  await sharp(srcPath, { limitInputPixels: false })
    .extract({ left: trim.x, top: trim.y, width: trim.width, height: trim.height })
    .png()
    .toFile(destPath);
}
