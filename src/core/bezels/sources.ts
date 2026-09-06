// Apple product-bezel DMGs: where they come from, what is inside and how a
// file name maps to a bezel id + colour variant. Every name and number here
// was observed in the W2 Stage A spike (see docs/bezels.md); nothing is typed
// from memory. The install step walks `pngDir` of a mounted DMG, runs every
// file through `normaliseBezelFilename` and measures the ones it keeps.
import type { Dims, Rect } from '../../config/types.ts';

export type BezelOrientation = 'portrait' | 'landscape';

export type BezelDmgId = 'iphone-17' | 'ipad-pro-m5' | 'apple-watch-11' | 'apple-watch-ultra-3';

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
  'apple-watch-11': {
    url: 'https://devimages-cdn.apple.com/design/resources/download/Bezel-Apple-Watch-Series-11-2025.dmg',
    dmgName: 'Bezel-Apple-Watch-Series-11-2025.dmg',
    bytes: 357_953_080,
    pngDir: 'PNG',
  },
  'apple-watch-ultra-3': {
    url: 'https://devimages-cdn.apple.com/design/resources/download/Bezel-Apple-Watch-Ultra-3-2025.dmg',
    dmgName: 'Bezel-Apple-Watch-Ultra-3-2025.dmg',
    bytes: 329_151_217,
    pngDir: 'PNG',
  },
};

// Not inspected in the spike (URLs from the plan; contents unknown, so no
// BezelSource entries yet):
//   Bezel-iPhone-16.dmg                 -> presets expect iphone-16-pro-max, iphone-16-pro as fallbacks
//   Bezel-iPad-Air-(M4).dmg             -> presets expect ipad-air-13-m4, ipad-air-11-m4 as fallbacks
//                                          (IPAD_CHIP_SIZE below already maps 'iPad Air (M4) 13"')
//   ipad-pro-13-m4 / ipad-pro-11-m4     -> preset fallbacks with no known DMG (Apple lists only the M5 iPad Pro)

export type BezelSourceId =
  | 'iphone-17-pro-max'
  | 'iphone-17-pro'
  | 'iphone-17'
  | 'iphone-air'
  | 'ipad-pro-13-m5'
  | 'ipad-pro-11-m5'
  | 'apple-watch-series-11-46mm'
  | 'apple-watch-series-11-42mm'
  | 'apple-watch-ultra-3';

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
  /**
   * Measured on the portrait PNG named by `defaultVariant`. On iPhone and iPad
   * the alpha channel is identical across colours, so one measurement covers
   * the id. Apple Watch is the exception: each band changes `deviceRect`
   * (a Sport Loop is 12 px taller than a Sport Band), but the case and its
   * screen cut-out do not move, and `installBezelFile` measures every file it
   * writes. Only `screenRect` is used as a guard, so the record stays true.
   */
  portrait: BezelPortraitFacts;
  /** File the `portrait` facts were measured on, when the id has more than one alpha shape. */
  measuredVariant?: string;
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
  // PNG/{Magnetic Link,Milanese Loop,Sport Band,Sport Loop}/Apple Watch S11 - 46mm - <Case> + <Band>.png
  // A watch file names the case size where a phone file names the orientation,
  // and there is no landscape file; normaliseBezelFilename reads both shapes.
  // `variants` is in install order (sorted path), so variants[0] is what
  // `bezelVariant: 'auto'` picks. A watch has no colour in common with a phone,
  // so a project's single theme.bezelVariant never matches one: name the band
  // on the screen instead (phone-watch takes `props.watchVariant`).
  'apple-watch-series-11-46mm': {
    dmg: 'apple-watch-11',
    model: 'Apple Watch S11 - 46mm',
    subDir: '',
    variants: [
      'titanium-gold-magnetic-link-sage-gray',
      'titanium-natural-magnetic-link-caramel',
      'titanium-slate-magnetic-link-navy',
      'titanium-gold-milanese-loop',
      'titanium-natural-milanese-loop',
      'titanium-slate-milanese-loop',
      'aluminum-jet-black-sport-band-black',
      'aluminum-rose-gold-sport-band-light-blush',
      'aluminum-silver-sport-band-neon-yellow',
      'aluminum-silver-sport-band-purple-fog',
      'aluminum-space-gray-sport-band-anchor-blue',
      'aluminum-space-gray-sport-band-black',
      'titanium-gold-sport-band-light-blush',
      'titanium-gold-sport-band-purple-fog',
      'titanium-natural-sport-band-stone-gray',
      'titanium-slate-sport-band-black',
      'aluminum-jet-black-sport-loop-dark-gray',
      'aluminum-rose-gold-sport-loop-purple-fog',
      'aluminum-silver-sport-loop-forest',
      'aluminum-silver-sport-loop-neon-yellow',
      'aluminum-space-gray-sport-loop-anchor-blue',
      'aluminum-space-gray-sport-loop-forest',
    ],
    pxPerPt: 1,
    measuredVariant: 'aluminum-jet-black-sport-band-black',
    portrait: {
      imageSize: { width: 560, height: 880 },
      deviceRect: rect(31, 16, 521, 849),
      screenRect: rect(72, 192, 416, 496),
      cornerRadius: 101,
    },
  },
  // Same DMG, no preset points at it today: `s1s bezels install --device apple-watch-series-11-42mm`.
  'apple-watch-series-11-42mm': {
    dmg: 'apple-watch-11',
    model: 'Apple Watch S11 - 42mm',
    subDir: '',
    variants: [
      'titanium-gold-magnetic-link-sage-gray',
      'titanium-natural-magnetic-link-caramel',
      'titanium-slate-magnetic-link-navy',
      'titanium-gold-milanese-loop',
      'titanium-natural-milanese-loop',
      'titanium-slate-milanese-loop',
      'aluminum-jet-black-sport-band-black',
      'aluminum-rose-gold-sport-band-light-blush',
      'aluminum-silver-sport-band-neon-yellow',
      'aluminum-silver-sport-band-purple-fog',
      'aluminum-space-gray-sport-band-anchor-blue',
      'aluminum-space-gray-sport-band-black',
      'titanium-gold-sport-band-light-blush',
      'titanium-gold-sport-band-purple-fog',
      'titanium-natural-sport-band-stone-gray',
      'titanium-slate-sport-band-black',
      'aluminum-jet-black-sport-loop-dark-gray',
      'aluminum-rose-gold-sport-loop-purple-fog',
      'aluminum-silver-sport-loop-forest',
      'aluminum-silver-sport-loop-neon-yellow',
      'aluminum-space-gray-sport-loop-anchor-blue',
      'aluminum-space-gray-sport-loop-forest',
    ],
    pxPerPt: 1,
    measuredVariant: 'aluminum-jet-black-sport-band-black',
    portrait: {
      imageSize: { width: 520, height: 800 },
      deviceRect: rect(36, 19, 469, 763),
      screenRect: rect(73, 177, 374, 446),
      cornerRadius: 90,
    },
  },
  // PNG/{Alpine Loop,Milanese Loop,Ocean Band,Trail Loop}/AW Ultra 3 - <Case> + <Band>.png
  // A third file-name shape: Apple ships the Ultra in one case size, so the
  // name has no size part and no orientation part either. Its cut-out is
  // 422x514, the larger of the two sizes APP_WATCH_ULTRA accepts, and it is
  // the frame `phone-watch` uses for props.watchBezel: 'apple-watch-ultra-3'.
  'apple-watch-ultra-3': {
    dmg: 'apple-watch-ultra-3',
    model: 'AW Ultra 3',
    subDir: '',
    variants: [
      'black-alpine-loop-black',
      'black-alpine-loop-light-blue',
      'natural-alpine-loop-light-blue',
      'natural-alpine-loop-terra-cotta',
      'black-milanese-loop',
      'natural-milanese-loop',
      'black-ocean-band-anchor-blue',
      'black-ocean-band-black',
      'natural-ocean-band-anchor-blue',
      'natural-ocean-band-neon-green',
      'black-trail-loop-black-charcoal',
      'natural-trail-loop-blue-bright-blue',
      'natural-trail-loop-green-neon',
    ],
    pxPerPt: 1,
    measuredVariant: 'black-alpine-loop-black',
    portrait: {
      imageSize: { width: 600, height: 960 },
      deviceRect: rect(34, 18, 561, 924),
      screenRect: rect(89, 223, 422, 514),
      cornerRadius: 114,
    },
  },
};

export const BEZEL_SOURCE_IDS: readonly BezelSourceId[] = Object.keys(BEZEL_SOURCES) as BezelSourceId[];

export function isBezelSourceId(id: string): id is BezelSourceId {
  return Object.hasOwn(BEZEL_SOURCES, id);
}

/**
 * Every Apple Watch bezel id starts with this. Apple's own naming carries the
 * product, so no extra field on BezelSource has to repeat it.
 */
const WATCH_ID_PREFIX = 'apple-watch-';

export function isWatchBezelId(id: string): boolean {
  return id.startsWith(WATCH_ID_PREFIX);
}

/**
 * Watch bezels in table order, which is what `phone-watch` accepts as
 * props.watchBezel: the frame it stands beside the phone. Only the id a
 * preset names is part of the default install; `s1s bezels install --device
 * <id>` fetches the rest.
 */
export const WATCH_BEZEL_IDS: readonly BezelSourceId[] = BEZEL_SOURCE_IDS.filter(isWatchBezelId);

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
  'apple-watch-s11-46mm': 'apple-watch-series-11-46mm',
  'apple-watch-s11-42mm': 'apple-watch-series-11-42mm',
  'aw-ultra-3': 'apple-watch-ultra-3',
};

/** Generic form of the override for DMGs not seen yet: `ipad-air-m4-13` -> `ipad-air-13-m4`. */
const IPAD_CHIP_SIZE = /^(ipad(?:-[a-z]+)?)-(m\d+)-(\d+(?:\.\d+)?)$/;

const PART_SEPARATOR = ' - ';

/** Second part of an Apple Watch file name: the case size, where a phone names the orientation. */
const WATCH_CASE_SIZE = /^\d{2}mm$/;

/**
 * Model part of an Apple Watch file, which is the only product whose name may
 * end after the strap: 'Apple Watch S11', 'AW Ultra 3'. A two-part phone name
 * ('iPhone 17 - Portrait.png') is not a bezel and must still be rejected.
 */
const WATCH_MODEL = /^(?:apple watch|aw)\b/i;

/** 'iPad Pro (M5) 13"' -> 'ipad-pro-m5-13'; 'Cosmic Orange' -> 'cosmic-orange'. Keeps dots (12.9). */
export function bezelSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/["“”″()]/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface NameParts {
  /** Model text to slug into the bezel id, case size included when the name spends a part on it. */
  rawModel: string;
  /** Text to slug into the colour/strap variant. */
  variantText: string;
  orientationText: string;
}

/**
 * Which of the three shapes `parts` is, or null. A watch never spends a part
 * on the orientation (Apple ships portrait only), so the shapes are told
 * apart by the parts that are left:
 *
 *   `<model> - <NNmm> - <Case> + <Band>.png`          two case sizes in one DMG (Series 11)
 *   `<model> - <Case> + <Band>.png`                   one case size (Ultra 3)
 *   `<model> - <Colour> - <Portrait|Landscape>.png`   iPhone, iPad
 */
function nameShape(parts: readonly string[]): NameParts | null {
  const [model, second, third] = parts;
  if (model === undefined || second === undefined) return null;
  if (parts.length === 2) {
    return WATCH_MODEL.test(model) ? { rawModel: model, variantText: second, orientationText: 'portrait' } : null;
  }
  if (parts.length !== 3 || third === undefined) return null;
  // The case size takes the slot a phone spends on the colour, so it joins the model.
  if (WATCH_CASE_SIZE.test(second)) return { rawModel: `${model} ${second}`, variantText: third, orientationText: 'portrait' };
  return { rawModel: model, variantText: second, orientationText: third.toLowerCase() };
}

/**
 * Pure: maps an Apple bezel file name (any path prefix) to id / variant /
 * orientation, or null for anything that is none of the shapes Apple ships
 * (PSDs, .DS_Store, the DMG background image). See `nameShape` for the three.
 */
export function normaliseBezelFilename(path: string): BezelFileName | null {
  const base = path.split('/').pop() ?? '';
  if (base.startsWith('.') || !/\.png$/i.test(base)) return null;
  const shape = nameShape(base.slice(0, -4).split(PART_SEPARATOR).map((part) => part.trim()));
  if (!shape) return null;
  const { rawModel, variantText, orientationText } = shape;
  if (orientationText !== 'portrait' && orientationText !== 'landscape') return null;
  const rawId = bezelSlug(rawModel);
  const variant = bezelSlug(variantText);
  if (!rawId || !variant) return null;
  const id = FILENAME_OVERRIDES[rawId] ?? rawId.replace(IPAD_CHIP_SIZE, '$1-$3-$2');
  return { id, variant, orientation: orientationText };
}

/** `normaliseBezelFilename` restricted to models with a BezelSource entry. */
export function sourceForFile(path: string): { id: BezelSourceId; file: BezelFileName } | null {
  const file = normaliseBezelFilename(path);
  if (!file || !isBezelSourceId(file.id)) return null;
  return { id: file.id, file };
}
