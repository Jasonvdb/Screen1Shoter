// normaliseBezelFilename against the real file names seen in the W2 Stage A
// spike (docs/bezels.md), and the source table's consistency with presets.
import { describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import {
  BEZEL_DMGS,
  BEZEL_SOURCES,
  BEZEL_SOURCE_IDS,
  FILENAME_OVERRIDES,
  type BezelFileName,
  bezelSlug,
  dmgsFor,
  isBezelSourceId,
  normaliseBezelFilename,
  sourceForFile,
} from '../../src/core/bezels/sources.ts';

const MOUNT = '/Volumes/Bezel-iPhone-17';

/** Paths relative to the mount point, exactly as `find` printed them. */
const REAL_FILES: Array<[string, BezelFileName]> = [
  ['PNG/iPhone 17 Pro Max/iPhone 17 Pro Max - Cosmic Orange - Landscape.png', { id: 'iphone-17-pro-max', variant: 'cosmic-orange', orientation: 'landscape' }],
  ['PNG/iPhone 17 Pro Max/iPhone 17 Pro Max - Deep Blue - Portrait.png', { id: 'iphone-17-pro-max', variant: 'deep-blue', orientation: 'portrait' }],
  ['PNG/iPhone 17 Pro Max/iPhone 17 Pro Max - Silver - Portrait.png', { id: 'iphone-17-pro-max', variant: 'silver', orientation: 'portrait' }],
  ['PNG/iPhone 17 Pro/iPhone 17 Pro - Deep Blue - Portrait.png', { id: 'iphone-17-pro', variant: 'deep-blue', orientation: 'portrait' }],
  ['PNG/iPhone 17 Pro/iPhone 17 Pro - Cosmic Orange - Landscape.png', { id: 'iphone-17-pro', variant: 'cosmic-orange', orientation: 'landscape' }],
  ['PNG/iPhone 17/iPhone 17 - Black - Portrait.png', { id: 'iphone-17', variant: 'black', orientation: 'portrait' }],
  ['PNG/iPhone 17/iPhone 17 - Mist Blue - Portrait.png', { id: 'iphone-17', variant: 'mist-blue', orientation: 'portrait' }],
  ['PNG/iPhone 17/iPhone 17 - Lavender - Landscape.png', { id: 'iphone-17', variant: 'lavender', orientation: 'landscape' }],
  ['PNG/iPhone 17/iPhone 17 - Sage - Portrait.png', { id: 'iphone-17', variant: 'sage', orientation: 'portrait' }],
  ['PNG/iPhone 17/iPhone 17 - White - Portrait.png', { id: 'iphone-17', variant: 'white', orientation: 'portrait' }],
  ['PNG/iPhone Air/iPhone Air - Cloud White - Portrait.png', { id: 'iphone-air', variant: 'cloud-white', orientation: 'portrait' }],
  ['PNG/iPhone Air/iPhone Air - Light Gold - Portrait.png', { id: 'iphone-air', variant: 'light-gold', orientation: 'portrait' }],
  ['PNG/iPhone Air/iPhone Air - Sky Blue - Landscape.png', { id: 'iphone-air', variant: 'sky-blue', orientation: 'landscape' }],
  ['PNG/iPhone Air/iPhone Air - Space Black - Portrait.png', { id: 'iphone-air', variant: 'space-black', orientation: 'portrait' }],
  ['PNG/iPad Pro (M5) 13" - Space Black - Portrait.png', { id: 'ipad-pro-13-m5', variant: 'space-black', orientation: 'portrait' }],
  ['PNG/iPad Pro (M5) 13" - Silver - Landscape.png', { id: 'ipad-pro-13-m5', variant: 'silver', orientation: 'landscape' }],
  ['PNG/iPad Pro (M5) 11" - Silver - Portrait.png', { id: 'ipad-pro-11-m5', variant: 'silver', orientation: 'portrait' }],
  ['PNG/iPad Pro (M5) 11" - Space Black - Landscape.png', { id: 'ipad-pro-11-m5', variant: 'space-black', orientation: 'landscape' }],
];

/** Everything else the two DMGs contain. */
const NOT_BEZELS = [
  '.DropDMGBackground/Bezel-iPhone17@2x.png',
  '.DropDMGBackground/Bezel-iPadPro@2x.png',
  '.DS_Store',
  'PNG/.DS_Store',
  'PNG/iPhone Air/.DS_Store',
  'Apple Design Resources License.rtf',
  'Photoshop/iPhone 17 Pro Max/iPhone 17 Pro Max - Deep Blue - Portrait.psd',
  'Photoshop/iPad Pro (M5) 13" - Silver - Portrait.psd',
];

describe('normaliseBezelFilename', () => {
  it.each(REAL_FILES)('%s', (path, expected) => {
    expect(normaliseBezelFilename(path)).toEqual(expected);
    expect(normaliseBezelFilename(`${MOUNT}/${path}`)).toEqual(expected);
  });

  it.each(NOT_BEZELS)('returns null for %s', (path) => {
    expect(normaliseBezelFilename(path)).toBeNull();
  });

  it('rejects malformed names', () => {
    expect(normaliseBezelFilename('')).toBeNull();
    expect(normaliseBezelFilename('PNG/iPhone 17 - Portrait.png')).toBeNull();
    expect(normaliseBezelFilename('PNG/iPhone 17 - Black - Upright.png')).toBeNull();
    expect(normaliseBezelFilename('PNG/iPhone 17 - Black - Portrait - Extra.png')).toBeNull();
    expect(normaliseBezelFilename('PNG/ - Black - Portrait.png')).toBeNull();
  });

  it('is case-insensitive on the extension and orientation', () => {
    expect(normaliseBezelFilename('iPhone 17 - Black - PORTRAIT.PNG')).toEqual({ id: 'iphone-17', variant: 'black', orientation: 'portrait' });
  });

  it('maps DMGs not seen yet by the generic rules', () => {
    expect(normaliseBezelFilename('iPhone 16 Pro Max - Black Titanium - Portrait.png')).toEqual({ id: 'iphone-16-pro-max', variant: 'black-titanium', orientation: 'portrait' });
    expect(normaliseBezelFilename('iPad Air (M4) 13" - Blue - Portrait.png')?.id).toBe('ipad-air-13-m4');
    expect(normaliseBezelFilename('iPad Air (M4) 11" - Starlight - Landscape.png')?.id).toBe('ipad-air-11-m4');
    expect(normaliseBezelFilename('iPad Pro (M4) 12.9" - Silver - Portrait.png')?.id).toBe('ipad-pro-12.9-m4');
  });

  it('bezelSlug strips inch marks and parentheses', () => {
    expect(bezelSlug('iPad Pro (M5) 13"')).toBe('ipad-pro-m5-13');
    expect(bezelSlug('iPad Pro (M5) 13”')).toBe('ipad-pro-m5-13');
    expect(bezelSlug('  Deep  Blue ')).toBe('deep-blue');
  });
});

describe('FILENAME_OVERRIDES', () => {
  it('maps raw slugs to known source ids', () => {
    for (const [raw, id] of Object.entries(FILENAME_OVERRIDES)) {
      expect(raw).toBe(bezelSlug(raw));
      expect(isBezelSourceId(id)).toBe(true);
    }
  });
});

describe('sourceForFile', () => {
  it('returns the source for every real portrait file and lists its variant', () => {
    for (const [path, expected] of REAL_FILES) {
      const match = sourceForFile(path);
      expect(match?.id).toBe(expected.id);
      expect(BEZEL_SOURCES[match!.id].variants).toContain(expected.variant);
    }
  });

  it('returns null for a well-formed name of an unknown model', () => {
    expect(sourceForFile('iPhone 16 Pro Max - Black Titanium - Portrait.png')).toBeNull();
    expect(sourceForFile('Photoshop/iPhone 17 - Black - Portrait.psd')).toBeNull();
  });
});

describe('BEZEL_SOURCES', () => {
  it('lists the six models seen in the two DMGs', () => {
    expect([...BEZEL_SOURCE_IDS].sort()).toEqual(['ipad-pro-11-m5', 'ipad-pro-13-m5', 'iphone-17', 'iphone-17-pro', 'iphone-17-pro-max', 'iphone-air']);
  });

  it('round-trips its own model names through the normaliser', () => {
    for (const id of BEZEL_SOURCE_IDS) {
      const source = BEZEL_SOURCES[id];
      const path = [BEZEL_DMGS[source.dmg].pngDir, source.subDir, `${source.model} - X - Portrait.png`].filter(Boolean).join('/');
      expect(normaliseBezelFilename(path)?.id).toBe(id);
    }
  });

  it('has consistent geometry', () => {
    for (const id of BEZEL_SOURCE_IDS) {
      const { portrait: p, pxPerPt, variants } = BEZEL_SOURCES[id];
      expect(variants.length).toBeGreaterThan(0);
      expect([2, 3]).toContain(pxPerPt);
      expect(p.screenRect.x).toBeGreaterThan(p.deviceRect.x);
      expect(p.screenRect.y).toBeGreaterThan(p.deviceRect.y);
      expect(p.screenRect.x + p.screenRect.width).toBeLessThan(p.deviceRect.x + p.deviceRect.width);
      expect(p.screenRect.y + p.screenRect.height).toBeLessThan(p.deviceRect.y + p.deviceRect.height);
      expect(p.deviceRect.x + p.deviceRect.width).toBeLessThanOrEqual(p.imageSize.width);
      expect(p.deviceRect.y + p.deviceRect.height).toBeLessThanOrEqual(p.imageSize.height);
      expect(p.cornerRadius).toBeLessThan(p.screenRect.width / 2);
      expect(p.screenRect.width % pxPerPt).toBe(0);
      expect(p.screenRect.height % pxPerPt).toBe(0);
      if (id.startsWith('iphone')) {
        expect(p.islandRect).toBeDefined();
        const island = p.islandRect!;
        const islandCentre = island.x + island.width / 2;
        const screenCentre = p.screenRect.x + p.screenRect.width / 2;
        expect(Math.abs(islandCentre - screenCentre)).toBeLessThanOrEqual(1);
        expect(island.y).toBeGreaterThan(p.screenRect.y);
      } else {
        expect(p.islandRect).toBeUndefined();
      }
    }
  });

  it('matches the presets that name it', () => {
    for (const preset of Object.values(SIZE_PRESETS)) {
      if (!isBezelSourceId(preset.bezel)) continue;
      const source = BEZEL_SOURCES[preset.bezel];
      expect(source.pxPerPt).toBe(preset.scale);
      const bezelAspect = source.portrait.screenRect.width / source.portrait.screenRect.height;
      const presetAspect = preset.px.width / preset.px.height;
      expect(Math.abs(bezelAspect - presetAspect) / presetAspect).toBeLessThan(0.01);
    }
    // The default sizes use bezels whose cut-out is exactly the App Store size.
    expect(BEZEL_SOURCES['iphone-17-pro-max'].portrait.screenRect).toMatchObject({ width: 1320, height: 2868 });
    expect(BEZEL_SOURCES['ipad-pro-13-m5'].portrait.screenRect).toMatchObject({ width: 2064, height: 2752 });
    expect(BEZEL_SOURCES['iphone-17-pro'].portrait.screenRect).toMatchObject({ width: 1206, height: 2622 });
    expect(BEZEL_SOURCES['ipad-pro-11-m5'].portrait.screenRect).toMatchObject({ width: 1668, height: 2420 });
  });
});

describe('BEZEL_DMGS', () => {
  it('names the file after the URL', () => {
    for (const dmg of Object.values(BEZEL_DMGS)) {
      expect(dmg.url.startsWith('https://devimages-cdn.apple.com/design/resources/download/')).toBe(true);
      expect(dmg.url.split('/').pop()).toBe(dmg.dmgName);
      expect(dmg.bytes).toBeGreaterThan(1_000_000);
      expect(dmg.pngDir).toBe('PNG');
    }
  });

  it('dmgsFor de-duplicates and skips unknown ids', () => {
    expect(dmgsFor(['iphone-17-pro-max', 'ipad-pro-13-m5', 'iphone-17', 'iphone-16-pro-max'])).toEqual(['iphone-17', 'ipad-pro-m5']);
    expect(dmgsFor([])).toEqual([]);
  });
});
