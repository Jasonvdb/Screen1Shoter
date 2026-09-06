// Pure core of useBezel and DeviceFrame (DOM-free; unit-tested under Node):
// which index entry a preset gets, the generic stand-in geometry, and the CSS
// boxes that place a capture and a bezel image inside a frame.
//
// Geometry units are whatever the source uses (bezel px for an index entry,
// pt for the generic frame); every function scales by the rendered width, so
// the unit never matters.
import type { BezelEntry, BezelIndex, DeviceFamily, Dims, Rect, SizePreset } from '../../config/types.ts';

/** The subset of BezelEntry the frame needs; genericGeometry produces the same shape in pt. */
export interface FrameGeometry {
  imageSize: Dims;
  deviceRect: Rect;
  screenRect: Rect;
  cornerRadius: number;
  islandRect?: Rect;
}

export type BezelFallback = 'none' | 'substitute' | 'generic';

export interface ReadyBezel {
  status: 'ready';
  /** null when no installed bezel fits the preset (generic CSS frame). */
  entry: BezelEntry | null;
  geometry: FrameGeometry;
  /** '/bezels/<id>/<variant>.png' or null for the generic frame. */
  url: string | null;
  /** The id asked for (bezelId or preset.bezel); named by the bezel-fallback warning. */
  wantedId: string;
  variant: string | null;
  /** 'substitute' = an id from preset.bezelFallbacks; 'generic' = no bezel at all. */
  fallback: BezelFallback;
}

export interface BezelOptions {
  /** Bezel id to try first. Default preset.bezel. */
  bezelId?: string | undefined;
  /** Colour variant; 'auto' (default) takes the first installed one for the id. */
  variant?: string | undefined;
}

// ---------------------------------------------------------------------------
// Generic frame (no bezel installed)
// ---------------------------------------------------------------------------

interface GenericSpec {
  /** Bezel width around the screen, pt. */
  border: number;
  screenRadius: number;
  island?: { width: number; height: number; top: number };
}

/**
 * Proportions of the real bezels in pt (docs/bezels.md): iPhone 17 Pro Max
 * insets 18/15 pt, corner 63 pt, island 125x36 pt 14 pt below the screen top;
 * iPad Pro 13" insets 45/47 pt, corner 30 pt. Close enough that a layout made
 * against the generic frame keeps its shape once bezels are installed.
 */
const GENERIC: Record<DeviceFamily, GenericSpec> = {
  iphone: { border: 17, screenRadius: 63, island: { width: 125, height: 36, top: 14 } },
  ipad: { border: 46, screenRadius: 30 },
  watch: { border: 20, screenRadius: 84 },
};

/** Frame geometry for a family whose screen is `screen` (pt). */
export function genericGeometry(family: DeviceFamily, screen: Dims): FrameGeometry {
  const spec = GENERIC[family];
  const imageSize: Dims = { width: screen.width + 2 * spec.border, height: screen.height + 2 * spec.border };
  const geometry: FrameGeometry = {
    imageSize,
    deviceRect: { x: 0, y: 0, width: imageSize.width, height: imageSize.height },
    screenRect: { x: spec.border, y: spec.border, width: screen.width, height: screen.height },
    cornerRadius: spec.screenRadius,
  };
  if (spec.island) {
    geometry.islandRect = {
      x: spec.border + (screen.width - spec.island.width) / 2,
      y: spec.border + spec.island.top,
      width: spec.island.width,
      height: spec.island.height,
    };
  }
  return geometry;
}

// ---------------------------------------------------------------------------
// Index lookup
// ---------------------------------------------------------------------------

export function bezelUrl(entry: BezelEntry): string {
  return `/bezels/${entry.file.split('/').map(encodeURIComponent).join('/')}`;
}

function usable(entry: BezelEntry): boolean {
  const { deviceRect: d, screenRect: s } = entry;
  return entry.orientation === 'portrait' && d.width > 0 && d.height > 0 && s.width > 0 && s.height > 0;
}

/**
 * Picks the bezel for a preset: `bezelId` (if given), then preset.bezel, then
 * preset.bezelFallbacks in order. Within an id the requested variant wins,
 * else the first installed one. Nothing installed -> generic geometry.
 */
export function selectBezel(index: BezelIndex | null, preset: SizePreset, opts: BezelOptions = {}): ReadyBezel {
  const wantedId = opts.bezelId ?? preset.bezel;
  const variant = opts.variant ?? 'auto';
  const ids = [...new Set([wantedId, preset.bezel, ...preset.bezelFallbacks])];
  for (const id of ids) {
    const entries = index?.entries.filter((e) => e.id === id && usable(e)) ?? [];
    const entry = (variant === 'auto' ? undefined : entries.find((e) => e.variant === variant)) ?? entries[0];
    if (!entry) continue;
    return {
      status: 'ready',
      entry,
      geometry: entry,
      url: bezelUrl(entry),
      wantedId,
      variant: entry.variant,
      fallback: id === wantedId ? 'none' : 'substitute',
    };
  }
  return {
    status: 'ready',
    entry: null,
    geometry: genericGeometry(preset.family, preset.pt),
    url: null,
    wantedId,
    variant: null,
    fallback: 'generic',
  };
}

// ---------------------------------------------------------------------------
// Frame boxes
// ---------------------------------------------------------------------------

export type FrameCrop = 'none' | 'bottom';

/** Bezel px added around the screen cut-out so the capture sits under the anti-aliased edge. */
export const SCREEN_GROW = 1;

export function deviceAspect(geometry: FrameGeometry): number {
  return geometry.deviceRect.width / geometry.deviceRect.height;
}

/**
 * The frame's outer box inside `avail` (CSS px; a side may be Infinity):
 * crop 'none' = the largest deviceRect-aspect box that fits; crop 'bottom' =
 * the full available width, the height clipped to `avail.height`.
 */
export function frameBox(geometry: FrameGeometry, avail: Dims, crop: FrameCrop = 'none'): Dims {
  const aspect = deviceAspect(geometry);
  let width = Number.isFinite(avail.width) ? avail.width : avail.height * aspect;
  if (!Number.isFinite(width)) return { width: 0, height: 0 };
  if (crop === 'none' && width / aspect > avail.height) width = avail.height * aspect;
  width = Math.max(0, Math.floor(width));
  const full = width / aspect;
  return { width, height: crop === 'bottom' ? Math.min(avail.height, full) : full };
}

export interface FrameLayout {
  /** CSS px per geometry unit. */
  k: number;
  /** Full device outline in CSS px (the visible box may be shorter when cropped). */
  device: Dims;
  /** Capture box: screenRect grown by SCREEN_GROW, relative to the device box. */
  screen: Rect & { radius: number };
  /** Bezel image box relative to the device box (negative offsets: the PNG canvas is larger than the device). */
  image: Rect;
}

/** CSS placement of the capture and the bezel image for a device drawn `width` CSS px wide. */
export function frameLayout(geometry: FrameGeometry, width: number): FrameLayout {
  const { deviceRect: d, screenRect: s, imageSize, cornerRadius } = geometry;
  const k = width / d.width;
  const g = SCREEN_GROW;
  return {
    k,
    device: { width, height: d.height * k },
    screen: {
      x: (s.x - d.x - g) * k,
      y: (s.y - d.y - g) * k,
      width: (s.width + 2 * g) * k,
      height: (s.height + 2 * g) * k,
      radius: (cornerRadius + g) * k,
    },
    image: { x: -d.x * k, y: -d.y * k, width: imageSize.width * k, height: imageSize.height * k },
  };
}
