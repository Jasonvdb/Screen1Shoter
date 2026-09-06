// One wide image cut into a slice per screen, so the screenshots join up when
// the App Store carousel puts them side by side.
//
// DOM-free like the rest of src/config: a slice is index, count and fractions
// of the image width. Turning those into CSS is the browser's job.
import type { ScreensConfig } from './types.ts';

/** Where one screen sits in the panorama, in units the renderer converts to CSS. */
export interface PanoramaSlice {
  /** `panorama.image`: a path relative to the project dir. */
  image: string;
  /** 0-based position of this screen among the panorama's screens. */
  index: number;
  /** How many equal slices the image is cut into. */
  count: number;
  /** Fraction of the image width this slice starts at (`index / count`). */
  offset: number;
  /** Fraction of the image width one slice covers (`1 / count`). */
  width: number;
}

/**
 * Screen ids that take a slice, in carousel order: `panorama.screens` when the
 * author listed them, otherwise every screen in screens.ts order.
 *
 * A listed id that screens.ts does not define is dropped: counting it would
 * shift every later slice and break the seam between real screens. That drop
 * is unreachable from loadProject, which refuses an unknown or repeated id
 * (src/core/project.ts); it stays as the fallback for a caller holding a
 * config nobody validated.
 */
export function panoramaOrder(config: ScreensConfig): string[] {
  const ids = config.screens.map((screen) => screen.id);
  const listed = config.panorama?.screens;
  if (listed === undefined) return ids;
  const known = new Set(ids);
  return listed.filter((id) => known.has(id));
}

/**
 * The slice of `config.panorama` this screen shows, or null when the project
 * has no panorama or this screen is not part of it (it keeps its own
 * background).
 */
export function panoramaSlice(config: ScreensConfig, screenId: string): PanoramaSlice | null {
  const panorama = config.panorama;
  if (panorama === undefined) return null;
  const order = panoramaOrder(config);
  const index = order.indexOf(screenId);
  if (index < 0) return null;
  const count = order.length;
  return { image: panorama.image, index, count, offset: index / count, width: 1 / count };
}

/**
 * The value `props.background` carries for a screen in the panorama. Numbers
 * only: src/config is DOM-free, so the browser turns these into CSS lengths.
 */
export interface PanoramaBackground extends Omit<PanoramaSlice, 'image'> {
  type: 'panorama';
  /** `panorama.image`, spelled `src` so it parses like a plain image background. */
  src: string;
}

export function panoramaBackground({ image, ...slice }: PanoramaSlice): PanoramaBackground {
  return { type: 'panorama', src: image, ...slice };
}
