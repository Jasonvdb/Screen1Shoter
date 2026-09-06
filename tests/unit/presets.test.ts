// Size presets against Apple's screenshot specification (plan "Research
// facts" + `asc screenshots sizes --all`). Design unit is CSS px = Apple
// points, so px must equal pt * scale for every preset.
import { describe, expect, it } from 'vitest';
import {
  ALL_SIZE_IDS,
  DEFAULT_SIZES,
  SIZE_PRESETS,
  dimsEqual,
  displayFolder,
  formatDims,
  getPreset,
  isAcceptedDims,
  isSizeId,
  presetsByFamily,
  presetsFor,
  renderTarget,
} from '../../src/config/presets.ts';
import type { AppDisplayType, DeviceFamily, Dims, SizeId } from '../../src/config/types.ts';

interface AppleRow {
  family: DeviceFamily;
  displayType: AppDisplayType;
  token: string;
  px: Dims;
  pt: Dims;
  scale: number;
  simulator: string;
}

const d = (width: number, height: number): Dims => ({ width, height });

/** The table from the plan and CONTRACTS.md section 3. */
const APPLE_TABLE: Record<SizeId, AppleRow> = {
  'iphone-6.9': { family: 'iphone', displayType: 'APP_IPHONE_69', token: 'IPHONE_69', px: d(1320, 2868), pt: d(440, 956), scale: 3, simulator: 'iPhone 17 Pro Max' },
  'iphone-6.7': { family: 'iphone', displayType: 'APP_IPHONE_67', token: 'IPHONE_67', px: d(1320, 2868), pt: d(440, 956), scale: 3, simulator: 'iPhone 17 Pro Max' },
  'iphone-6.5': { family: 'iphone', displayType: 'APP_IPHONE_65', token: 'IPHONE_65', px: d(1284, 2778), pt: d(428, 926), scale: 3, simulator: 'iPhone 14 Plus' },
  'iphone-6.1': { family: 'iphone', displayType: 'APP_IPHONE_61', token: 'IPHONE_61', px: d(1206, 2622), pt: d(402, 874), scale: 3, simulator: 'iPhone 17 Pro' },
  'ipad-13': { family: 'ipad', displayType: 'APP_IPAD_PRO_3GEN_129', token: 'IPAD_PRO_3GEN_129', px: d(2064, 2752), pt: d(1032, 1376), scale: 2, simulator: 'iPad Pro 13-inch (M5)' },
  'ipad-11': { family: 'ipad', displayType: 'APP_IPAD_PRO_3GEN_11', token: 'IPAD_PRO_3GEN_11', px: d(1668, 2420), pt: d(834, 1210), scale: 2, simulator: 'iPad Pro 11-inch (M5)' },
  'watch-s10': { family: 'watch', displayType: 'APP_WATCH_SERIES_10', token: 'WATCH_SERIES_10', px: d(416, 496), pt: d(416, 496), scale: 1, simulator: 'Apple Watch Series 11 (46mm)' },
  'watch-ultra': { family: 'watch', displayType: 'APP_WATCH_ULTRA', token: 'WATCH_ULTRA', px: d(422, 514), pt: d(422, 514), scale: 1, simulator: 'Apple Watch Ultra 3 (49mm)' },
};

/** Sizes App Store Connect accepts per display type (verified facts only). */
const ACCEPTED_FACTS: Partial<Record<AppDisplayType, Dims[]>> = {
  APP_IPHONE_69: [d(1320, 2868)],
  APP_IPHONE_67: [d(1320, 2868)],
  APP_IPHONE_65: [d(1284, 2778), d(1242, 2688)],
  APP_IPHONE_61: [d(1206, 2622)],
  APP_IPAD_PRO_3GEN_129: [d(2064, 2752), d(2048, 2732)],
  APP_WATCH_SERIES_10: [d(416, 496)],
  APP_WATCH_ULTRA: [d(422, 514), d(410, 502)],
};

const ids: SizeId[] = [...ALL_SIZE_IDS];

describe('SIZE_PRESETS', () => {
  it('lists exactly the eight Apple size classes, once each', () => {
    expect(ids).toEqual(Object.keys(APPLE_TABLE));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ids)('%s: px = pt x scale', (id) => {
    const p = SIZE_PRESETS[id];
    expect(p.id).toBe(id);
    expect(p.px.width).toBe(p.pt.width * p.scale);
    expect(p.px.height).toBe(p.pt.height * p.scale);
    expect(Number.isInteger(p.scale) && p.scale >= 1).toBe(true);
  });

  it.each(ids)('%s: matches the Apple table', (id) => {
    const p = SIZE_PRESETS[id];
    const row = APPLE_TABLE[id];
    expect(p.family).toBe(row.family);
    expect(p.displayType).toBe(row.displayType);
    expect(p.deviceTypeToken).toBe(row.token);
    expect(p.px).toEqual(row.px);
    expect(p.pt).toEqual(row.pt);
    expect(p.scale).toBe(row.scale);
    expect(p.simulatorName).toBe(row.simulator);
  });

  it.each(ids)('%s: px is one of the accepted dims and captureDims equals px', (id) => {
    const p = SIZE_PRESETS[id];
    expect(isAcceptedDims(p, p.px)).toBe(true);
    expect(p.captureDims).toEqual(p.px);
    for (const dims of ACCEPTED_FACTS[p.displayType] ?? []) {
      expect(p.acceptedDims).toContainEqual(dims);
    }
  });

  it('display type is the token prefixed with APP_ (upload token <-> export folder)', () => {
    for (const id of ids) {
      const p = SIZE_PRESETS[id];
      expect(p.displayType).toBe(`APP_${p.deviceTypeToken}`);
      expect(displayFolder(p)).toBe(p.displayType);
    }
  });

  it('every watch size is an unframed 1x passthrough, and nothing else is', () => {
    const watches = ids.filter((id) => SIZE_PRESETS[id].family === 'watch');
    expect(watches).toEqual(['watch-s10', 'watch-ultra']);
    for (const id of ids) {
      const p = SIZE_PRESETS[id];
      if (p.family !== 'watch') {
        expect(p.passthrough).toBeFalsy();
        continue;
      }
      expect(p.passthrough).toBe(true);
      expect(p.scale).toBe(1);
      expect(p.pt).toEqual(p.px);
    }
    expect(SIZE_PRESETS['watch-s10'].acceptedDims).toEqual([d(416, 496)]);
    // APP_WATCH_ULTRA takes the Ultra 3's 422x514 and the Ultra/Ultra 2's
    // 410x502, which is a same-aspect resample rather than a wrong device.
    expect(SIZE_PRESETS['watch-ultra'].acceptedDims).toEqual([d(422, 514), d(410, 502)]);
  });

  it('marks only the Ultra frame optional, so the default bezel install does not grow', () => {
    const optional = ids.filter((id) => SIZE_PRESETS[id].bezelOptional);
    expect(optional).toEqual(['watch-ultra']);
    // An optional frame must be one no set needs on its own: a passthrough
    // preset renders its capture unframed, so only phone-watch ever draws it.
    for (const id of optional) expect(SIZE_PRESETS[id].passthrough).toBe(true);
  });

  it('iPhone classes share one layout: aspect ratio within 0.459-0.463', () => {
    for (const p of presetsByFamily('iphone')) {
      const aspect = p.px.width / p.px.height;
      expect(aspect).toBeGreaterThan(0.459);
      expect(aspect).toBeLessThan(0.463);
    }
  });

  it('every preset names a bezel id', () => {
    for (const id of ids) {
      expect(SIZE_PRESETS[id].bezel.length).toBeGreaterThan(0);
    }
  });
});

describe('alias iphone-6.7 -> iphone-6.9', () => {
  const alias = SIZE_PRESETS['iphone-6.7'];
  const target = SIZE_PRESETS['iphone-6.9'];

  it('is the only alias and points at iphone-6.9', () => {
    expect(alias.aliasOf).toBe('iphone-6.9');
    const aliases = ids.filter((id) => SIZE_PRESETS[id].aliasOf !== undefined);
    expect(aliases).toEqual(['iphone-6.7']);
  });

  it('renders as iphone-6.9 (same px, pt, scale) but exports to APP_IPHONE_67', () => {
    expect(renderTarget(alias)).toBe(target);
    expect(renderTarget(target)).toBe(target);
    expect(alias.px).toEqual(target.px);
    expect(alias.pt).toEqual(target.pt);
    expect(alias.scale).toBe(target.scale);
    expect(displayFolder(alias)).toBe('APP_IPHONE_67');
    expect(displayFolder(target)).toBe('APP_IPHONE_69');
    expect(alias.deviceTypeToken).toBe('IPHONE_67');
  });

  it('non-alias presets render as themselves', () => {
    for (const id of ids) {
      const p = SIZE_PRESETS[id];
      if (!p.aliasOf) expect(renderTarget(p)).toBe(p);
    }
  });
});

describe('lookup helpers', () => {
  it('isSizeId / getPreset', () => {
    expect(isSizeId('ipad-13')).toBe(true);
    expect(isSizeId('ipad-12.9')).toBe(false);
    expect(isSizeId('toString')).toBe(false);
    expect(getPreset('iphone-6.5').px).toEqual(d(1284, 2778));
    expect(() => getPreset('iphone-7.0')).toThrow(/Unknown size "iphone-7.0"/);
    expect(() => getPreset('iphone-7.0')).toThrow(/iphone-6\.9/);
  });

  it('DEFAULT_SIZES are iPhone 6.9" and iPad 13"', () => {
    expect([...DEFAULT_SIZES]).toEqual(['iphone-6.9', 'ipad-13']);
  });

  it('presetsFor: defaults when empty, keeps order, de-duplicates, keeps aliases', () => {
    expect(presetsFor().map((p) => p.id)).toEqual(['iphone-6.9', 'ipad-13']);
    expect(presetsFor([]).map((p) => p.id)).toEqual(['iphone-6.9', 'ipad-13']);
    expect(presetsFor(['ipad-13', 'iphone-6.9', 'ipad-13']).map((p) => p.id)).toEqual(['ipad-13', 'iphone-6.9']);
    expect(presetsFor(['iphone-6.7']).map((p) => p.id)).toEqual(['iphone-6.7']);
    expect(presetsFor(['iphone-6.7', 'iphone-6.9']).map((p) => p.id)).toEqual(['iphone-6.7', 'iphone-6.9']);
    expect(() => presetsFor(['iphone-6.9', 'nope'])).toThrow(/Unknown size "nope"/);
  });

  it('presetsByFamily', () => {
    expect(presetsByFamily('iphone').map((p) => p.id)).toEqual(['iphone-6.9', 'iphone-6.7', 'iphone-6.5', 'iphone-6.1']);
    expect(presetsByFamily('ipad').map((p) => p.id)).toEqual(['ipad-13', 'ipad-11']);
    expect(presetsByFamily('watch').map((p) => p.id)).toEqual(['watch-s10', 'watch-ultra']);
    expect(presetsByFamily('ipad', ['iphone-6.9', 'ipad-11']).map((p) => p.id)).toEqual(['ipad-11']);
    expect(presetsByFamily('watch', ['iphone-6.9'])).toEqual([]);
  });

  it('dimsEqual / formatDims / isAcceptedDims', () => {
    expect(dimsEqual(d(1, 2), d(1, 2))).toBe(true);
    expect(dimsEqual(d(1, 2), d(2, 1))).toBe(false);
    expect(formatDims(d(1320, 2868))).toBe('1320x2868');
    expect(isAcceptedDims(SIZE_PRESETS['ipad-13'], d(2048, 2732))).toBe(true);
    expect(isAcceptedDims(SIZE_PRESETS['ipad-13'], d(2732, 2048))).toBe(false);
    expect(isAcceptedDims(SIZE_PRESETS['iphone-6.9'], d(1284, 2778))).toBe(false);
  });
});
