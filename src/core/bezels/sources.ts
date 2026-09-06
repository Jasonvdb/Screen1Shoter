// Apple product-bezel DMGs: where they come from, what is inside and how a
// file name maps to a bezel id + colour variant. Every name and number here
// was observed in the W2 Stage A spike (see docs/bezels.md); nothing is typed
// from memory. The install step walks `pngDir` of a mounted DMG, runs every
// file through `normaliseBezelFilename` and measures the ones it keeps.
import type { Dims, Rect } from '../../config/types.ts';

export type BezelOrientation = 'portrait' | 'landscape';

export type BezelDmgId = 'iphone-17' | 'ipad-pro-m5';

export interface BezelDmg {
  /** Apple CDN URL. No login, but `hdiutil attach` prints an SLA and waits for "Y" on stdin. */
  url: string;
  /** File name under `dmgDir()` (S1S_HOME/dmg). */
  dmgName: string;
  /** Exact size in bytes as served on 2026-09-02; a file of this size is not re-downloaded. */
  bytes: number;
  /** Folder in the mounted image that holds the PNGs. `Photoshop/` (PSDs) and `.DropDMGBackground/` are ignored. */
  pngDir: string;
}

export const BEZEL_DMGS: Readonly<Record<BezelDmgId, BezelDmg>> = {
  'iphone-17': {
    url: 'https://devimages-cdn.apple.com/design/resources/download/Bezel-iPhone-17.dmg',
    dmgName: 'Bezel-iPhone-17.dmg',
    bytes: 265_205_982,
    pngDir: 'PNG',
  },
  'ipad-pro-m5': {
    url: 'https://devimages-cdn.apple.com/design/resources/download/Bezel-iPad-Pro-(M5).dmg',
    dmgName: 'Bezel-iPad-Pro-(M5).dmg',
    bytes: 6_787_021,
    pngDir: 'PNG',
  },
};

// Not inspected in the spike (URLs from the plan; contents unknown, so no
// BezelSource entries yet):
//   Bezel-iPhone-16.dmg                 -> presets expect iphone-16-pro-max, iphone-16-pro as fallbacks
//   Bezel-iPad-Air-(M4).dmg             -> presets expect ipad-air-13-m4, ipad-air-11-m4 as fallbacks
//                                          (IPAD_CHIP_SIZE below already maps 'iPad Air (M4) 13"')
//   Bezel-Apple-Watch-Series-11-2025.dmg -> preset watch-s10 names apple-watch-series-11-46mm, but
//                                          the watch preset is passthrough, so no bezel is needed
//   ipad-pro-13-m4 / ipad-pro-11-m4     -> preset fallbacks with no known DMG (Apple lists only the M5 iPad Pro)

export type BezelSourceId =
  | 'iphone-17-pro-max'
  | 'iphone-17-pro'
  | 'iphone-17'
  | 'iphone-air'
  | 'ipad-pro-13-m5'
  | 'ipad-pro-11-m5';

export interface BezelPortraitFacts {
  imageSize: Dims;
  /** Bounding box of alpha > 12 (the opaque device). */
  deviceRect: Rect;
  /** Bounding box of alpha <= 12 inside the device: the screen cut-out. Equals the App Store px size of the matching preset. */
  screenRect: Rect;
  /** Opaque (alpha 255, RGB 0,0,0) Dynamic Island inside the screen. Absent on iPad. */
  islandRect?: Rect;
  /**
   * CSS circle radius (bezel px) that clips the capture without leaving a
   * background gap at the screen corners, as `measure.ts` (`radiusFromProfile`)
   * computes it on the real file and `install` writes it to index.json; any
   * radius down to ~85 px (iPhone) also stays inside the opaque body. Apple's
   * corners are superellipses, so this is smaller than the number of rows the
   * corner spans, and 1-2 px under the hand-fit maximum (docs/bezels.md).
   */
  cornerRadius: number;
}

export interface BezelSource {
  dmg: BezelDmgId;
  /** Model part of Apple's file name, exactly as written: `<model> - <Colour> - <Portrait|Landscape>.png`. */
  model: string;
  /** Sub-folder under `pngDir`; '' when the DMG is flat. */
  subDir: string;
  /** Colour slugs observed. `variants[0]` is the default for `bezelVariant: 'auto'`. */
  variants: readonly string[];
  /** Native bezel pixels per Apple point (PNG dpi / 72). */
  pxPerPt: number;
  /** Measured on the portrait PNG. The alpha channel is identical across colours, so one measurement per id is enough. */
  portrait: BezelPortraitFacts;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

export const BEZEL_SOURCES: Readonly<Record<BezelSourceId, BezelSource>> = {
  // PNG/iPhone 17 Pro Max/iPhone 17 Pro Max - {Cosmic Orange,Deep Blue,Silver} - {Portrait,Landscape}.png
  'iphone-17-pro-max': {
    dmg: 'iphone-17',
    model: 'iPhone 17 Pro Max',
    subDir: 'iPhone 17 Pro Max',
    variants: ['deep-blue', 'cosmic-orange', 'silver'],
    pxPerPt: 3,
    portrait: {
      imageSize: { width: 1470, height: 3000 },
      deviceRect: rect(21, 20, 1428, 2959),
      screenRect: rect(75, 66, 1320, 2868),
      islandRect: rect(548, 109, 374, 108),
      cornerRadius: 189,
    },
  },
  // PNG/iPhone 17 Pro/iPhone 17 Pro - {Cosmic Orange,Deep Blue,Silver} - {Portrait,Landscape}.png
  'iphone-17-pro': {
    dmg: 'iphone-17',
    model: 'iPhone 17 Pro',
    subDir: 'iPhone 17 Pro',
    variants: ['deep-blue', 'cosmic-orange', 'silver'],
    pxPerPt: 3,
    portrait: {
      imageSize: { width: 1350, height: 2760 },
      deviceRect: rect(16, 21, 1318, 2717),
      screenRect: rect(72, 69, 1206, 2622),
      islandRect: rect(488, 112, 374, 108),
      cornerRadius: 186,
    },
  },
  // PNG/iPhone 17/iPhone 17 - {Black,Lavender,Mist Blue,Sage,White} - {Portrait,Landscape}.png
  'iphone-17': {
    dmg: 'iphone-17',
    model: 'iPhone 17',
    subDir: 'iPhone 17',
    variants: ['black', 'white', 'lavender', 'mist-blue', 'sage'],
    pxPerPt: 3,
    portrait: {
      imageSize: { width: 1350, height: 2760 },
      deviceRect: rect(19, 26, 1311, 2708),
      screenRect: rect(72, 69, 1206, 2622),
      islandRect: rect(488, 111, 374, 109),
      cornerRadius: 189,
    },
  },
  // PNG/iPhone Air/iPhone Air - {Cloud White,Light Gold,Sky Blue,Space Black} - {Portrait,Landscape}.png
  'iphone-air': {
    dmg: 'iphone-17',
    model: 'iPhone Air',
    subDir: 'iPhone Air',
    variants: ['space-black', 'cloud-white', 'light-gold', 'sky-blue'],
    pxPerPt: 3,
    portrait: {
      imageSize: { width: 1380, height: 2880 },
      deviceRect: rect(5, 25, 1370, 2829),
      screenRect: rect(60, 72, 1260, 2736),
      islandRect: rect(503, 133, 374, 108),
      cornerRadius: 189,
    },
  },
  // PNG/iPad Pro (M5) 13" - {Silver,Space Black} - {Portrait,Landscape}.png   (flat folder, ASCII inch mark)
  'ipad-pro-13-m5': {
    dmg: 'ipad-pro-m5',
    model: 'iPad Pro (M5) 13"',
    subDir: '',
    variants: ['space-black', 'silver'],
    pxPerPt: 2,
    portrait: {
      imageSize: { width: 2300, height: 3000 },
      deviceRect: rect(28, 30, 2249, 2936),
      screenRect: rect(118, 124, 2064, 2752),
      cornerRadius: 58,
    },
  },
  // PNG/iPad Pro (M5) 11" - {Silver,Space Black} - {Portrait,Landscape}.png
  'ipad-pro-11-m5': {
    dmg: 'ipad-pro-m5',
    model: 'iPad Pro (M5) 11"',
    subDir: '',
    variants: ['space-black', 'silver'],
    pxPerPt: 2,
    portrait: {
      imageSize: { width: 1880, height: 2640 },
      deviceRect: rect(15, 15, 1854, 2606),
      screenRect: rect(106, 110, 1668, 2420),
      cornerRadius: 58,
    },
  },
};

export const BEZEL_SOURCE_IDS: readonly BezelSourceId[] = Object.keys(BEZEL_SOURCES) as BezelSourceId[];

export function isBezelSourceId(id: string): id is BezelSourceId {
  return Object.hasOwn(BEZEL_SOURCES, id);
}

/** DMGs to download for a set of bezel ids, in first-use order. Unknown ids are skipped. */
export function dmgsFor(ids: readonly string[]): BezelDmgId[] {
  const out: BezelDmgId[] = [];
  for (const id of ids) {
    if (!isBezelSourceId(id)) continue;
    const dmg = BEZEL_SOURCES[id].dmg;
    if (!out.includes(dmg)) out.push(dmg);
  }
  return out;
}

// ---------------------------------------------------------------------------
// File-name normalisation
// ---------------------------------------------------------------------------

export interface BezelFileName {
  /** Bezel id such as 'iphone-17-pro-max'. May name a model that has no BezelSource entry yet. */
  id: string;
  /** Colour slug such as 'deep-blue'. */
  variant: string;
  orientation: BezelOrientation;
}

/**
 * Model slugs that do not follow the plain "lowercase, spaces to dashes" rule.
 * Key = raw slug of the model part, value = bezel id. Observed: Apple writes the
 * chip before the size (`iPad Pro (M5) 13"`), presets name the size first.
 */
export const FILENAME_OVERRIDES: Readonly<Record<string, string>> = {
  'ipad-pro-m5-13': 'ipad-pro-13-m5',
  'ipad-pro-m5-11': 'ipad-pro-11-m5',
};

/** Generic form of the override for DMGs not seen yet: `ipad-air-m4-13` -> `ipad-air-13-m4`. */
const IPAD_CHIP_SIZE = /^(ipad(?:-[a-z]+)?)-(m\d+)-(\d+(?:\.\d+)?)$/;

const PART_SEPARATOR = ' - ';

/** 'iPad Pro (M5) 13"' -> 'ipad-pro-m5-13'; 'Cosmic Orange' -> 'cosmic-orange'. Keeps dots (12.9). */
export function bezelSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/["“”″()]/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Pure: maps an Apple bezel file name (any path prefix) to id / variant /
 * orientation, or null for anything that is not a `<model> - <Colour> -
 * <Portrait|Landscape>.png` file (PSDs, .DS_Store, the DMG background image).
 */
export function normaliseBezelFilename(path: string): BezelFileName | null {
  const base = path.split('/').pop() ?? '';
  if (base.startsWith('.') || !/\.png$/i.test(base)) return null;
  const parts = base.slice(0, -4).split(PART_SEPARATOR).map((part) => part.trim());
  if (parts.length !== 3) return null;
  const [model, colour, orientationText] = parts as [string, string, string];
  const orientation = orientationText.toLowerCase();
  if (orientation !== 'portrait' && orientation !== 'landscape') return null;
  const rawId = bezelSlug(model);
  const variant = bezelSlug(colour);
  if (!rawId || !variant) return null;
  const id = FILENAME_OVERRIDES[rawId] ?? rawId.replace(IPAD_CHIP_SIZE, '$1-$3-$2');
  return { id, variant, orientation };
}

/** `normaliseBezelFilename` restricted to models with a BezelSource entry. */
export function sourceForFile(path: string): { id: BezelSourceId; file: BezelFileName } | null {
  const file = normaliseBezelFilename(path);
  if (!file || !isBezelSourceId(file.id)) return null;
  return { id: file.id, file };
}
