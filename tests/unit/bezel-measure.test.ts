// measureRaw / measureBezel against synthetic bezels drawn with sharp: an
// opaque body with round corners, a transparent round-cornered screen and an
// opaque Dynamic Island (iPhone), or no island (iPad). Rects must land within
// 1 px of what was drawn, the radius within 2 px. Real-file numbers come from
// docs/bezels.md and are checked through the pure helpers.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BezelEntry, Rect } from '../../src/config/types.ts';
import { isS1sError } from '../../src/core/errors.ts';
import {
  TRIM_PAD,
  cornerProfile,
  loadRawImage,
  matchPreset,
  measureBezel,
  measureRaw,
  radiusFromProfile,
  shiftMeasurement,
  trimRect,
  writeTrimmedBezel,
  type BezelMeasurement,
  type RawImage,
} from '../../src/core/bezels/measure.ts';
import { bezelSvg } from '../fixtures/make-bezel.ts';
import { makeTempDir, type TempDir } from '../fixtures/helpers.ts';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

interface Synthetic {
  entry: BezelEntry;
  png: Buffer;
}

/** Draws `entry` (untrimmed: transparent margin around the body) as an RGBA PNG. */
async function synthetic(entry: BezelEntry, density?: number): Promise<Synthetic> {
  let image = sharp(Buffer.from(bezelSvg(entry))).ensureAlpha().png();
  if (density !== undefined) image = image.withMetadata({ density });
  return { entry, png: await image.toBuffer() };
}

async function rawOf(png: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

/** iPhone 17 Pro Max at a quarter of its size: screen 330x717 = APP_IPHONE_69 aspect. */
const IPHONE: BezelEntry = {
  id: 'synthetic-iphone',
  variant: 'blue',
  file: 'synthetic-iphone/blue.png',
  imageSize: { width: 370, height: 750 },
  deviceRect: rect(6, 5, 357, 740),
  screenRect: rect(20, 17, 330, 717),
  cornerRadius: 48,
  islandRect: rect(138, 28, 94, 27),
  orientation: 'portrait',
  screenAspect: 330 / 717,
};

/** iPad Pro 13" at a quarter: screen 516x688 = 0.75, no island, small radius. */
const IPAD: BezelEntry = {
  id: 'synthetic-ipad',
  variant: 'silver',
  file: 'synthetic-ipad/silver.png',
  imageSize: { width: 580, height: 750 },
  deviceRect: rect(7, 8, 562, 734),
  screenRect: rect(30, 31, 516, 688),
  cornerRadius: 15,
  orientation: 'portrait',
  screenAspect: 0.75,
};

function expectRectNear(actual: Rect | undefined, expected: Rect, tolerance = 1): void {
  expect(actual, 'rect present').toBeDefined();
  const got = actual as Rect;
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(got[key] - expected[key]), `${key}: ${got[key]} vs ${expected[key]}`).toBeLessThanOrEqual(tolerance);
  }
}

describe('measureRaw on a synthetic iPhone bezel', () => {
  let m: BezelMeasurement;
  beforeAll(async () => {
    const { png } = await synthetic(IPHONE);
    m = measureRaw(await rawOf(png));
  });

  it('finds the device and screen rects within 1 px', () => {
    expect(m.imageSize).toEqual(IPHONE.imageSize);
    expectRectNear(m.deviceRect, IPHONE.deviceRect);
    expectRectNear(m.screenRect, IPHONE.screenRect);
    expect(m.orientation).toBe('portrait');
    expect(m.screenAspect).toBeCloseTo(330 / 717, 3);
  });

  it('detects the Dynamic Island inside the top of the screen', () => {
    expectRectNear(m.islandRect, IPHONE.islandRect as Rect);
    const island = m.islandRect as Rect;
    expect(island.y).toBeGreaterThan(m.screenRect.y);
    expect(island.y + island.height).toBeLessThan(m.screenRect.y + m.screenRect.height * 0.15);
  });

  it('recovers the drawn corner radius within 2 px', () => {
    expect(Math.abs(m.cornerRadius - IPHONE.cornerRadius)).toBeLessThanOrEqual(2);
  });

  it('matches the iPhone 6.9" preset by aspect and takes its scale as pxPerPt', () => {
    expect(m.presetId).toBe('iphone-6.9');
    expect(m.pxPerPt).toBe(3);
  });
});

describe('measureRaw on a synthetic iPad bezel (no island)', () => {
  let m: BezelMeasurement;
  beforeAll(async () => {
    const { png } = await synthetic(IPAD, 144);
    m = measureRaw(await rawOf(png), { density: 144 });
  });

  it('finds the rects, no island, the small radius and the iPad preset', () => {
    expectRectNear(m.deviceRect, IPAD.deviceRect);
    expectRectNear(m.screenRect, IPAD.screenRect);
    expect(m.islandRect).toBeUndefined();
    expect(Math.abs(m.cornerRadius - IPAD.cornerRadius)).toBeLessThanOrEqual(2);
    expect(m.presetId).toBe('ipad-13');
    expect(m.pxPerPt).toBe(2);
    expect(m.screenAspect).toBe(0.75);
  });

  it('falls back to dpi / 72 for pxPerPt when no preset aspect matches', async () => {
    const odd: BezelEntry = { ...IPAD, imageSize: { width: 580, height: 600 }, deviceRect: rect(7, 8, 562, 584), screenRect: rect(30, 31, 516, 538) };
    const { png } = await synthetic(odd, 144);
    const got = measureRaw(await rawOf(png), { density: 144 });
    expect(got.presetId).toBeUndefined();
    expect(got.pxPerPt).toBe(2);
    expect(measureRaw(await rawOf(png)).pxPerPt).toBeUndefined();
  });
});

describe('measureRaw orientation and failures', () => {
  it('reports landscape when the screen is wider than tall and still finds the island on the left', async () => {
    const landscape: BezelEntry = {
      ...IPHONE,
      imageSize: { width: 750, height: 370 },
      deviceRect: rect(5, 6, 740, 357),
      screenRect: rect(17, 20, 717, 330),
      islandRect: rect(28, 138, 27, 94),
    };
    const { png } = await synthetic(landscape);
    const m = measureRaw(await rawOf(png));
    expect(m.orientation).toBe('landscape');
    expectRectNear(m.screenRect, landscape.screenRect);
    expectRectNear(m.islandRect, landscape.islandRect as Rect);
    expect(m.presetId).toBe('iphone-6.9');
  });

  it('rejects a fully transparent image and an image without a cut-out', async () => {
    const empty = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .raw()
      .toBuffer();
    const opaque = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } })
      .raw()
      .toBuffer();
    for (const data of [empty, opaque]) {
      try {
        measureRaw({ width: 40, height: 40, data });
        expect.unreachable('measureRaw should throw');
      } catch (err) {
        expect(isS1sError(err) && err.code).toBe('bezel-missing');
      }
    }
    expect(() => measureRaw({ width: 40, height: 40, data: Buffer.alloc(10) })).toThrow(/RGBA/);
  });
});

describe('radiusFromProfile', () => {
  /** First half-covered x per row for a circle of radius r tangent to the screen's top and left edges. */
  const circleProfile = (r: number): number[] => {
    const out: number[] = [];
    for (let y = 0; ; y++) {
      const dy = r - y - 0.5;
      const x = dy > 0 ? Math.round(r - Math.sqrt(r * r - dy * dy)) : 0;
      out.push(x);
      if (x === 0) break;
    }
    return out;
  };

  it('reproduces a circle radius within 2 px', () => {
    for (const r of [15, 48, 61, 120]) expect(Math.abs(radiusFromProfile(circleProfile(r)) - r)).toBeLessThanOrEqual(2);
  });

  it('gives the largest gap-free circle for a superellipse (Pro Max: diagonal row 56 -> about 191)', () => {
    // Offsets shrink linearly from 246 to reach the diagonal at row 56; the exact curve is irrelevant to the crossing.
    const offsets: number[] = [];
    for (let i = 0; i <= 60; i++) offsets.push(Math.max(0, Math.round(246 - (246 - 56) * (i / 56))));
    const radius = radiusFromProfile(offsets);
    expect(radius).toBeGreaterThanOrEqual(186);
    expect(radius).toBeLessThanOrEqual(196);
  });

  it('is 0 for a square corner and the first offset when the profile never crosses', () => {
    expect(radiusFromProfile([0])).toBe(0);
    expect(radiusFromProfile([])).toBe(0);
    expect(radiusFromProfile([5, 5, 5])).toBeLessThanOrEqual(5 + Math.sqrt(5) + 2);
  });
});

describe('cornerProfile', () => {
  it('starts at the first-row offset and ends at 0', async () => {
    const { png } = await synthetic(IPAD);
    const img = await rawOf(png);
    const m = measureRaw(img);
    const offsets = cornerProfile(img, m.screenRect);
    expect(offsets[0]).toBeGreaterThan(0);
    expect(offsets[0]).toBeLessThanOrEqual(IPAD.cornerRadius);
    expect(offsets.at(-1)).toBe(0);
    expect(offsets.length).toBeLessThanOrEqual(IPAD.cornerRadius + 1);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeLessThanOrEqual(offsets[i - 1] as number);
  });
});

describe('matchPreset', () => {
  it('prefers an exact px match, else the closest aspect within 1%, in either orientation', () => {
    expect(matchPreset({ width: 1320, height: 2868 }, 'portrait')?.id).toBe('iphone-6.9');
    expect(matchPreset({ width: 2868, height: 1320 }, 'landscape')?.id).toBe('iphone-6.9');
    expect(matchPreset({ width: 1206, height: 2622 }, 'portrait')?.id).toBe('iphone-6.1');
    expect(matchPreset({ width: 1260, height: 2736 }, 'portrait')?.scale).toBe(3); // iPhone Air
    expect(matchPreset({ width: 2064, height: 2752 }, 'portrait')?.id).toBe('ipad-13');
    expect(matchPreset({ width: 1668, height: 2420 }, 'portrait')?.id).toBe('ipad-11');
    expect(matchPreset({ width: 100, height: 100 }, 'portrait')).toBeUndefined();
    // Never the passthrough watch preset or an alias.
    expect(matchPreset({ width: 416, height: 496 }, 'portrait')).toBeUndefined();
  });
});

describe('trimRect and shiftMeasurement', () => {
  const m: BezelMeasurement = {
    imageSize: { width: 1470, height: 3000 },
    orientation: 'portrait',
    deviceRect: rect(21, 20, 1428, 2959),
    screenRect: rect(75, 66, 1320, 2868),
    islandRect: rect(548, 109, 374, 108),
    cornerRadius: 190,
    screenAspect: 0.4603,
    pxPerPt: 3,
  };

  it('grows the device rect by TRIM_PAD and clamps to the image', () => {
    expect(TRIM_PAD).toBe(2);
    expect(trimRect(m)).toEqual(rect(19, 18, 1432, 2963));
    expect(trimRect({ imageSize: { width: 10, height: 10 }, deviceRect: rect(1, 0, 9, 10) })).toEqual(rect(0, 0, 10, 10));
  });

  it('moves every rect into the trimmed image and keeps the rest', () => {
    const trimmed = shiftMeasurement(m, trimRect(m));
    expect(trimmed.imageSize).toEqual({ width: 1432, height: 2963 });
    expect(trimmed.deviceRect).toEqual(rect(2, 2, 1428, 2959));
    expect(trimmed.screenRect).toEqual(rect(56, 48, 1320, 2868));
    expect(trimmed.islandRect).toEqual(rect(529, 91, 374, 108));
    expect(trimmed.cornerRadius).toBe(190);
    expect(trimmed.pxPerPt).toBe(3);
  });
});

describe('measureBezel and writeTrimmedBezel on files', () => {
  let tmp: TempDir;
  beforeAll(async () => {
    tmp = await makeTempDir('s1s-bezel-measure-');
  });
  afterAll(async () => {
    await tmp.cleanup();
  });

  it('measures a PNG on disk, prefixes errors with the path, and trims with alpha kept', async () => {
    const src = join(tmp.dir, 'iphone.png');
    const { png } = await synthetic(IPHONE, 216);
    await sharp(png).toFile(src);
    const raw = await loadRawImage(src);
    expect(raw.density).toBe(216);

    const m = await measureBezel(src);
    expectRectNear(m.screenRect, IPHONE.screenRect);
    expect(m.pxPerPt).toBe(3);

    const dest = join(tmp.dir, 'out', 'iphone.png');
    await mkdir(join(tmp.dir, 'out'), { recursive: true });
    const trim = trimRect(m);
    await writeTrimmedBezel(src, dest, trim);
    const meta = await sharp(dest).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: trim.width, height: trim.height });
    expect(meta.hasAlpha).toBe(true);
    const again = await measureBezel(dest);
    expectRectNear(again.deviceRect, shiftMeasurement(m, trim).deviceRect);
    expectRectNear(again.screenRect, shiftMeasurement(m, trim).screenRect);

    const blank = join(tmp.dir, 'blank.png');
    await sharp({ create: { width: 30, height: 30, channels: 4, background: '#00000000' } }).png().toFile(blank);
    await expect(measureBezel(blank)).rejects.toThrow(/blank\.png: image is fully transparent/);
  });
});
