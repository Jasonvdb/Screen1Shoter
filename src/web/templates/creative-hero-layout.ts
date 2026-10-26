// DOM-free geometry of the creative-hero template (unit-tested under Node).
//
// Two rules decide everything. Words are key art: the text block lies inside
// Apple's Art Safe Area. Subjects are whole: every frame and object stays on
// the canvas, side by side with a gap (none hides another), as tall as the
// canvas allows. Devices also stay within the safe area's width, so no layout
// cuts off a screen of UI at the side. A row of key art alone (no device) may
// use the canvas width with side margins: like the figure in Apple's template
// sample, its centre is the focal point and its edges may run past the safe
// area. Vertically every subject may pass the safe band: a phone or a part
// that fitted inside a 21:9 band would be too small to see.
import type { Dims, Rect } from '../../config/types.ts';

export type CreativeTextMode = 'left' | 'top' | 'none';

interface FontRange {
  min: number;
  max: number;
  maxLines: number;
}

export interface CreativeLayout {
  /** 'left': text column width; 'top': text block height (fractions of the safe area). */
  textShare: { left: number; top: number };
  /** Gap between the text block and the devices, as a fraction of the safe area side it splits. */
  gap: number;
  /** Font sizes as fractions of the safe area height. */
  headline: FontRange;
  subline: FontRange;
  /** Gap between headline and subline, fraction of the safe area height. */
  textGap: number;
  /** Tallest device as a share of the canvas height. */
  deviceHeight: number;
  /** Clear space between a device and the canvas edge, share of the canvas height. */
  margin: number;
  /** Clear space beside a row of key art, share of the canvas width. */
  artMargin: number;
  /** Gap between neighbouring devices, share of the tallest device. */
  deviceGap: number;
  /** Height of a phone beside a tablet, relative to the tablet (bottoms aligned). */
  phoneBesideTablet: number;
}

export const CREATIVE_LAYOUT: CreativeLayout = {
  textShare: { left: 0.44, top: 0.3 },
  gap: 0.06,
  headline: { min: 0.08, max: 0.17, maxLines: 3 },
  subline: { min: 0.045, max: 0.075, maxLines: 2 },
  textGap: 0.03,
  deviceHeight: 0.88,
  margin: 0.05,
  // iPhone cuts about 8% from each side of the header (creative-assets.md).
  artMargin: 0.1,
  deviceGap: 0.05,
  phoneBesideTablet: 0.8,
};

/**
 * One subject to place: a device frame or a piece of key art (a transparent
 * PNG such as an `s1s model render`), by its aspect (width / height).
 * `tablet` marks a tablet-sized frame; key art is never one.
 */
export interface CreativeDevice {
  aspect: number;
  tablet: boolean;
  /** Key art rather than a device: it keeps its own height share (`scale`, default 1). */
  art?: { scale: number };
}

export interface CreativeGeometry {
  /** null when no text is drawn. */
  text: Rect | null;
  devices: Rect[];
}

export interface CreativeInput {
  canvas: Dims;
  safe: Rect;
  text: CreativeTextMode;
  devices: readonly CreativeDevice[];
  layout?: CreativeLayout;
}

export interface ArtItem {
  src: string;
  /** Height relative to the row (1 = as tall as the tallest subject). */
  scale: number;
}

/** `props.art`: a path, or a list of paths or `{ src, scale }`, project-relative. */
export function artItems(value: unknown): ArtItem[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.flatMap((entry): ArtItem[] => {
    if (typeof entry === 'string' && entry.length > 0) return [{ src: entry, scale: 1 }];
    if (typeof entry === 'object' && entry !== null) {
      const src = (entry as Record<string, unknown>)['src'];
      const scale = (entry as Record<string, unknown>)['scale'];
      if (typeof src === 'string' && src.length > 0) {
        return [{ src, scale: typeof scale === 'number' && scale > 0 && scale <= 1 ? scale : 1 }];
      }
    }
    return [];
  });
}

/** Text block and device boxes in canvas pt. */
export function creativeGeometry(input: CreativeInput): CreativeGeometry {
  const layout = input.layout ?? CREATIVE_LAYOUT;
  const { canvas, safe, devices } = input;
  if (devices.length === 0) return { text: input.text === 'none' ? null : { ...safe }, devices: [] };

  const margin = canvas.height * layout.margin;
  // Relative heights: a phone beside a tablet stands a little shorter, bottoms aligned.
  const mixed = devices.some((d) => d.tablet) && devices.some((d) => !d.tablet);
  const rel = devices.map((d) => (d.art ? d.art.scale : mixed && !d.tablet ? layout.phoneBesideTablet : 1));
  const unitWidth = devices.reduce((sum, d, i) => sum + d.aspect * (rel[i] ?? 1), 0) + (devices.length - 1) * layout.deviceGap;

  const artOnly = devices.every((d) => d.art !== undefined);
  const artMargin = canvas.width * layout.artMargin;
  const textWidth = safe.width * layout.textShare.left;
  const textGap = safe.width * layout.gap;

  let text: Rect | null = null;
  let rowWidthMax = artOnly ? canvas.width - 2 * artMargin : safe.width;
  let rowTop = margin;
  let rowBottom = canvas.height - margin;
  if (input.text === 'left') {
    rowWidthMax = artOnly ? canvas.width - artMargin - (safe.x + textWidth + textGap) : safe.width - textWidth - textGap;
  } else if (input.text === 'top') {
    const height = safe.height * layout.textShare.top;
    text = { x: safe.x, y: safe.y, width: safe.width, height };
    rowTop = safe.y + height + safe.height * layout.gap;
  }

  const height = Math.min(canvas.height * layout.deviceHeight, rowBottom - rowTop, rowWidthMax / unitWidth);
  const rowWidth = unitWidth * height;

  let rowX: number;
  if (input.text === 'left') {
    // Text column and subjects form one group centred on the safe area; the
    // text never leaves it, so a wide row of art pushes the group right.
    const groupX = Math.max(safe.x, safe.x + (safe.width - (textWidth + textGap + rowWidth)) / 2);
    text = { x: groupX, y: safe.y, width: textWidth, height: safe.height };
    rowX = groupX + textWidth + textGap;
  } else {
    rowX = safe.x + (safe.width - rowWidth) / 2;
  }

  // Centre the row on the safe area's centre, then keep it on the canvas.
  const safeCentre = safe.y + safe.height / 2;
  let y = input.text === 'top' ? rowTop + (rowBottom - rowTop - height) / 2 : safeCentre - height / 2;
  y = Math.max(rowTop, Math.min(y, rowBottom - height));
  rowBottom = y + height;

  const gapPx = layout.deviceGap * height;
  let x = rowX;
  const boxes = devices.map((d, i) => {
    const h = height * (rel[i] ?? 1);
    const w = h * d.aspect;
    const box = { x, y: rowBottom - h, width: w, height: h };
    x += w + gapPx;
    return box;
  });
  return { text, devices: boxes };
}
