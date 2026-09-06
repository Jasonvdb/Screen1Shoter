// Pure core of useBezel / DeviceFrame (src/web/hooks/bezel.ts): index lookup
// with variant and fallback rules, the generic geometry, and the CSS boxes
// that place a capture and a bezel image. Numbers are the iPhone 17 Pro Max
// and iPad Pro 13" facts from docs/bezels.md.
import { describe, expect, it } from 'vitest';
import { getPreset } from '../../src/config/presets.ts';
import type { BezelEntry, BezelIndex, Rect } from '../../src/config/types.ts';
import {
  SCREEN_GROW,
  bezelUrl,
  deviceAspect,
  frameBox,
  frameLayout,
  genericGeometry,
  selectBezel,
} from '../../src/web/hooks/bezel.ts';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** Untrimmed iPhone 17 Pro Max portrait file. */
function proMax(variant: string): BezelEntry {
  return {
    id: 'iphone-17-pro-max',
    variant,
    file: `iphone-17-pro-max/${variant}.png`,
    imageSize: { width: 1470, height: 3000 },
    deviceRect: rect(21, 20, 1428, 2959),
    screenRect: rect(75, 66, 1320, 2868),
    cornerRadius: 190,
    islandRect: rect(548, 109, 374, 108),
    orientation: 'portrait',
    screenAspect: 1320 / 2868,
    pxPerPt: 3,
  };
}

/** Trimmed iPad Pro 13" (deviceRect + 2 px), as `s1s bezels install` writes it. */
function ipad13(variant: string): BezelEntry {
  return {
    id: 'ipad-pro-13-m5',
    variant,
    file: `ipad-pro-13-m5/${variant}.png`,
    imageSize: { width: 2253, height: 2940 },
    deviceRect: rect(2, 2, 2249, 2936),
    screenRect: rect(92, 96, 2064, 2752),
    cornerRadius: 60,
    orientation: 'portrait',
    screenAspect: 0.75,
    pxPerPt: 2,
  };
}

function index(entries: BezelEntry[]): BezelIndex {
  return { version: 1, updatedAt: '2026-09-02T00:00:00Z', entries };
}

const IPHONE = getPreset('iphone-6.9');
const IPAD = getPreset('ipad-13');
const IPHONE_61 = getPreset('iphone-6.1');

describe('selectBezel', () => {
  const idx = index([proMax('deep-blue'), proMax('cosmic-orange'), proMax('silver'), ipad13('space-black'), ipad13('silver')]);

  it('takes the requested variant of the preferred id', () => {
    const got = selectBezel(idx, IPHONE, { variant: 'silver' });
    expect(got.fallback).toBe('none');
    expect(got.entry?.variant).toBe('silver');
    expect(got.url).toBe('/bezels/iphone-17-pro-max/silver.png');
    expect(got.wantedId).toBe('iphone-17-pro-max');
    expect(got.geometry).toBe(got.entry);
  });

  it("'auto' and an uninstalled variant both take the first installed one", () => {
    expect(selectBezel(idx, IPHONE).variant).toBe('deep-blue');
    expect(selectBezel(idx, IPHONE, { variant: 'auto' }).variant).toBe('deep-blue');
    expect(selectBezel(idx, IPAD, { variant: 'deep-blue' }).variant).toBe('space-black');
  });

  it('substitutes an id from preset.bezelFallbacks and says so', () => {
    // iphone-6.1 wants iphone-17-pro; only the Pro Max is installed (last fallback).
    const got = selectBezel(idx, IPHONE_61, { variant: 'deep-blue' });
    expect(got.fallback).toBe('substitute');
    expect(got.entry?.id).toBe('iphone-17-pro-max');
    expect(got.wantedId).toBe('iphone-17-pro');
  });

  it('tries an explicit bezelId before the preset chain', () => {
    const got = selectBezel(idx, IPHONE, { bezelId: 'ipad-pro-13-m5' });
    expect(got.entry?.id).toBe('ipad-pro-13-m5');
    expect(got.fallback).toBe('none');
    const missing = selectBezel(idx, IPHONE, { bezelId: 'iphone-air' });
    expect(missing.entry?.id).toBe('iphone-17-pro-max');
    expect(missing.fallback).toBe('substitute');
    expect(missing.wantedId).toBe('iphone-air');
  });

  it('ignores landscape and degenerate entries', () => {
    const landscape: BezelEntry = { ...proMax('deep-blue'), orientation: 'landscape' };
    const empty: BezelEntry = { ...proMax('silver'), deviceRect: rect(0, 0, 0, 0) };
    expect(selectBezel(index([landscape, empty]), IPHONE).fallback).toBe('generic');
  });

  it('falls back to the generic geometry without an index or a matching id', () => {
    for (const idx of [null, index([]), index([ipad13('silver')])]) {
      const got = selectBezel(idx, IPHONE);
      expect(got.fallback).toBe('generic');
      expect(got.entry).toBeNull();
      expect(got.url).toBeNull();
      expect(got.variant).toBeNull();
      expect(got.wantedId).toBe('iphone-17-pro-max');
      expect(got.geometry.screenRect).toMatchObject({ width: 440, height: 956 });
    }
  });

  it('encodes the file path in the URL', () => {
    expect(bezelUrl({ ...proMax('x'), file: 'iphone 17/deep blue.png' })).toBe('/bezels/iphone%2017/deep%20blue.png');
  });
});

describe('genericGeometry', () => {
  it('has the shape of a bezel entry with the screen at the preset size', () => {
    const g = genericGeometry('iphone', IPHONE.pt);
    expect(g.deviceRect).toEqual({ x: 0, y: 0, width: g.imageSize.width, height: g.imageSize.height });
    expect(g.screenRect).toMatchObject({ width: 440, height: 956 });
    expect(g.screenRect.x).toBeGreaterThan(0);
    expect(g.cornerRadius).toBeLessThan(220);
    const island = g.islandRect!;
    expect(island.x + island.width / 2).toBeCloseTo(g.screenRect.x + g.screenRect.width / 2, 6);
    expect(island.y).toBeGreaterThan(g.screenRect.y);
    expect(genericGeometry('ipad', IPAD.pt).islandRect).toBeUndefined();
  });

  it('is close to the real device aspect', () => {
    const real = deviceAspect(proMax('deep-blue'));
    expect(Math.abs(deviceAspect(genericGeometry('iphone', IPHONE.pt)) - real) / real).toBeLessThan(0.02);
    const realPad = deviceAspect(ipad13('silver'));
    expect(Math.abs(deviceAspect(genericGeometry('ipad', IPAD.pt)) - realPad) / realPad).toBeLessThan(0.02);
  });
});

describe('frameBox', () => {
  const g = proMax('deep-blue');
  const aspect = 1428 / 2959;

  it('contains the device in the available box', () => {
    // The width is floored to whole CSS px (crisp bezel edges), so the height lands just under the limit.
    const wide = frameBox(g, { width: 1000, height: 400 });
    expect(wide.width).toBe(Math.floor(400 * aspect));
    expect(wide.height).toBeCloseTo(wide.width / aspect, 6);
    expect(wide.height).toBeLessThanOrEqual(400);
    const tall = frameBox(g, { width: 300, height: 10_000 });
    expect(tall.width).toBe(300);
    expect(tall.height).toBeCloseTo(300 / aspect, 6);
    expect(frameBox(g, { width: 300, height: Number.POSITIVE_INFINITY }).width).toBe(300);
    expect(frameBox(g, { width: Number.POSITIVE_INFINITY, height: 900 }).height).toBeCloseTo(Math.floor(900 * aspect) / aspect, 6);
  });

  it("crop 'bottom' keeps the width and clips the height", () => {
    const box = frameBox(g, { width: 300, height: 200 }, 'bottom');
    expect(box).toEqual({ width: 300, height: 200 });
    expect(frameBox(g, { width: 300, height: 10_000 }, 'bottom').height).toBeCloseTo(300 / aspect, 6);
  });

  it('never returns a negative or infinite box', () => {
    expect(frameBox(g, { width: -5, height: 10 })).toEqual({ width: 0, height: 0 });
    expect(frameBox(g, { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY })).toEqual({ width: 0, height: 0 });
  });
});

describe('frameLayout', () => {
  it('places the capture one bezel px outside the cut-out at native size', () => {
    const layout = frameLayout(proMax('deep-blue'), 1428);
    expect(layout.k).toBe(1);
    expect(layout.device).toEqual({ width: 1428, height: 2959 });
    expect(layout.screen).toEqual({ x: 75 - 21 - SCREEN_GROW, y: 66 - 20 - SCREEN_GROW, width: 1322, height: 2870, radius: 191 });
    expect(layout.image).toEqual({ x: -21, y: -20, width: 1470, height: 3000 });
  });

  it('scales every box by the rendered width', () => {
    const g = ipad13('space-black');
    const layout = frameLayout(g, 2249 / 4);
    expect(layout.k).toBeCloseTo(0.25, 9);
    expect(layout.screen.x).toBeCloseTo((92 - 2 - 1) / 4, 9);
    expect(layout.screen.width).toBeCloseTo(2066 / 4, 9);
    expect(layout.screen.radius).toBeCloseTo(61 / 4, 9);
    expect(layout.image).toEqual({ x: -0.5, y: -0.5, width: 2253 / 4, height: 2940 / 4 });
    // Capture fraction of the device box is scale-free.
    expect(layout.screen.x / layout.device.width).toBeCloseTo((92 - 2 - 1) / 2249, 9);
  });
});
