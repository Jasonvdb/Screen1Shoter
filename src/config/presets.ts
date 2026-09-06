// Size presets. Numbers come from Apple's screenshot specification and from
// `asc screenshots sizes --all` (verified 2026-09-02). Design unit is CSS px =
// Apple points; px = pt * scale is asserted by the unit tests.
import type { AppDisplayType, DeviceFamily, Dims, SizeId, SizePreset } from './types.ts';

const d = (width: number, height: number): Dims => ({ width, height });

const IPHONE_69_ACCEPTED: Dims[] = [d(1320, 2868), d(1290, 2796), d(1260, 2736)];

export const SIZE_PRESETS: Record<SizeId, SizePreset> = {
  'iphone-6.9': {
    id: 'iphone-6.9',
    family: 'iphone',
    displayType: 'APP_IPHONE_69',
    deviceTypeToken: 'IPHONE_69',
    px: d(1320, 2868),
    pt: d(440, 956),
    scale: 3,
    acceptedDims: IPHONE_69_ACCEPTED,
    bezel: 'iphone-17-pro-max',
    bezelFallbacks: ['iphone-17-pro', 'iphone-17', 'iphone-16-pro-max'],
    captureDims: d(1320, 2868),
    simulatorName: 'iPhone 17 Pro Max',
  },
  'iphone-6.7': {
    id: 'iphone-6.7',
    family: 'iphone',
    displayType: 'APP_IPHONE_67',
    deviceTypeToken: 'IPHONE_67',
    px: d(1320, 2868),
    pt: d(440, 956),
    scale: 3,
    acceptedDims: IPHONE_69_ACCEPTED,
    bezel: 'iphone-17-pro-max',
    bezelFallbacks: ['iphone-17-pro', 'iphone-17', 'iphone-16-pro-max'],
    captureDims: d(1320, 2868),
    simulatorName: 'iPhone 17 Pro Max',
    aliasOf: 'iphone-6.9',
  },
  'iphone-6.5': {
    id: 'iphone-6.5',
    family: 'iphone',
    displayType: 'APP_IPHONE_65',
    deviceTypeToken: 'IPHONE_65',
    px: d(1284, 2778),
    pt: d(428, 926),
    scale: 3,
    acceptedDims: [d(1284, 2778), d(1242, 2688)],
    bezel: 'iphone-17-pro-max',
    bezelFallbacks: ['iphone-16-pro-max', 'iphone-17-pro', 'iphone-17'],
    captureDims: d(1284, 2778),
    simulatorName: 'iPhone 14 Plus',
  },
  'iphone-6.1': {
    id: 'iphone-6.1',
    family: 'iphone',
    displayType: 'APP_IPHONE_61',
    deviceTypeToken: 'IPHONE_61',
    px: d(1206, 2622),
    pt: d(402, 874),
    scale: 3,
    acceptedDims: [d(1206, 2622), d(1179, 2556)],
    bezel: 'iphone-17-pro',
    bezelFallbacks: ['iphone-17', 'iphone-16-pro', 'iphone-17-pro-max'],
    captureDims: d(1206, 2622),
    simulatorName: 'iPhone 17 Pro',
  },
  'ipad-13': {
    id: 'ipad-13',
    family: 'ipad',
    displayType: 'APP_IPAD_PRO_3GEN_129',
    deviceTypeToken: 'IPAD_PRO_3GEN_129',
    px: d(2064, 2752),
    pt: d(1032, 1376),
    scale: 2,
    acceptedDims: [d(2064, 2752), d(2048, 2732)],
    bezel: 'ipad-pro-13-m5',
    bezelFallbacks: ['ipad-pro-13-m4', 'ipad-air-13-m4'],
    captureDims: d(2064, 2752),
    simulatorName: 'iPad Pro 13-inch (M5)',
  },
  'ipad-11': {
    id: 'ipad-11',
    family: 'ipad',
    displayType: 'APP_IPAD_PRO_3GEN_11',
    deviceTypeToken: 'IPAD_PRO_3GEN_11',
    px: d(1668, 2420),
    pt: d(834, 1210),
    scale: 2,
    acceptedDims: [d(1668, 2420), d(1668, 2388), d(1640, 2360), d(1488, 2266)],
    bezel: 'ipad-pro-11-m5',
    bezelFallbacks: ['ipad-pro-11-m4', 'ipad-air-11-m4'],
    captureDims: d(1668, 2420),
    simulatorName: 'iPad Pro 11-inch (M5)',
  },
  'watch-s10': {
    id: 'watch-s10',
    family: 'watch',
    displayType: 'APP_WATCH_SERIES_10',
    deviceTypeToken: 'WATCH_SERIES_10',
    px: d(416, 496),
    pt: d(416, 496),
    scale: 1,
    acceptedDims: [d(416, 496)],
    bezel: 'apple-watch-series-11-46mm',
    bezelFallbacks: [],
    captureDims: d(416, 496),
    simulatorName: 'Apple Watch Series 11 (46mm)',
    passthrough: true,
  },
};

export const ALL_SIZE_IDS: readonly SizeId[] = Object.keys(SIZE_PRESETS) as SizeId[];

export const DEFAULT_SIZES: readonly SizeId[] = ['iphone-6.9', 'ipad-13'];

export function isSizeId(value: string): value is SizeId {
  return Object.hasOwn(SIZE_PRESETS, value);
}

/** Returns the preset for a size id. Throws on an unknown id. */
export function getPreset(id: string): SizePreset {
  if (!isSizeId(id)) {
    throw new Error(`Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}`);
  }
  return SIZE_PRESETS[id];
}

/**
 * Presets for a list of size ids in the given order, de-duplicated.
 * Empty or undefined -> DEFAULT_SIZES. Aliases are kept (the matrix builder
 * groups them with their render target).
 */
export function presetsFor(ids?: readonly string[]): SizePreset[] {
  const wanted = ids && ids.length > 0 ? ids : DEFAULT_SIZES;
  const seen = new Set<SizeId>();
  const out: SizePreset[] = [];
  for (const id of wanted) {
    const preset = getPreset(id);
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

/** Presets of one family, optionally restricted to the given ids. */
export function presetsByFamily(family: DeviceFamily, ids?: readonly string[]): SizePreset[] {
  return presetsFor(ids ?? ALL_SIZE_IDS).filter((p) => p.family === family);
}

/** The preset that is actually rendered: follows `aliasOf`. */
export function renderTarget(preset: SizePreset): SizePreset {
  return preset.aliasOf ? SIZE_PRESETS[preset.aliasOf] : preset;
}

/** Export folder name for a preset (its App Store Connect display type). */
export function displayFolder(preset: SizePreset): AppDisplayType {
  return preset.displayType;
}

const PRESET_BY_DISPLAY_TYPE = new Map<string, SizePreset>(
  Object.values(SIZE_PRESETS).map((preset) => [preset.displayType, preset]),
);

/** The preset that renders into a display-type folder; undefined for a folder no preset writes. */
export function presetByDisplayType(displayType: string): SizePreset | undefined {
  return PRESET_BY_DISPLAY_TYPE.get(displayType);
}

/**
 * Display types with no preset that still hold pixels a preset writes. Only
 * the duplicate-dims rule needs them: a legacy 12.9" folder beside the 13"
 * one uploads the same pixels twice (references/apple-rules.md section 3).
 */
const LEGACY_DISPLAY_DIMS: Readonly<Record<string, readonly Dims[]>> = {
  APP_IPAD_PRO_129: [d(2064, 2752), d(2048, 2732)],
};

/** Sizes App Store Connect accepts in a display-type folder; null for a name nothing knows. */
export function acceptedDimsForDisplayType(displayType: string): readonly Dims[] | null {
  return presetByDisplayType(displayType)?.acceptedDims ?? LEGACY_DISPLAY_DIMS[displayType] ?? null;
}

/**
 * True when two display-type folders accept a common pixel size. That is the
 * duplicate-dims trap: `asc screenshots upload --path <metadata dir>` fans out
 * over the tree and selects files by pixel size, so one set's files upload
 * into both. `s1s export` warns about it and `s1s validate` reports it.
 */
export function displayTypesShareDims(a: string, b: string): boolean {
  if (a === b) return false;
  const left = acceptedDimsForDisplayType(a);
  const right = acceptedDimsForDisplayType(b);
  if (left === null || right === null) return false;
  return left.some((dims) => right.some((other) => dimsEqual(dims, other)));
}

export function dimsEqual(a: Dims, b: Dims): boolean {
  return a.width === b.width && a.height === b.height;
}

export function formatDims(dims: Dims): string {
  return `${dims.width}x${dims.height}`;
}

/** True when `dims` is one of the sizes App Store Connect accepts for the preset. */
export function isAcceptedDims(preset: SizePreset, dims: Dims): boolean {
  return preset.acceptedDims.some((accepted) => dimsEqual(accepted, dims));
}
