// DOM-free numbers and geometry of the two-device template (unit-tested under
// Node): the per-family layout table and the stack arithmetic that places the
// overlapped pair. two-device.tsx renders from these.
import type { Dims } from '../../config/types.ts';

interface FontRange {
  min: number;
  max: number;
  maxLines: number;
}

/** Text block numbers in pt at the family's reference width (440 iPhone, 1032 iPad). */
export interface TextLayout {
  /** Fixed height of the text block so every screen in a set gets the same device size. */
  textHeight: number;
  /** Gap between badge, headline and subline. */
  textGap: number;
  headline: FontRange;
  subline: FontRange;
  badge: number;
}

export type Arrangement = 'side' | 'stack';

export interface TwoDeviceLayout extends TextLayout {
  padX: number;
  padTop: number;
  padBottom: number;
  /** Gap between the text block and the devices. */
  gap: number;
  /** Default arrangement; `props.arrangement` overrides it per screen. */
  arrangement: Arrangement;
  /** stack: width of each device as a fraction of the canvas; the pair spans the content width. */
  deviceWidth: number;
  /**
   * stack: how far the front device sits below the back one, in pt. Must
   * clear the back device's Dynamic Island and status bar (iPhone: island
   * bottom ~34 pt at 56% width) and, with the device height, fill the row.
   */
  offsetY: number;
  /** side: max width of the pair as a fraction of the canvas. */
  pairWidth: number;
  /** side: gap between the devices as a fraction of one device width. */
  deviceGap: number;
}

export type TwoDeviceFamily = 'iphone' | 'ipad';

export const LAYOUT: Record<TwoDeviceFamily, TwoDeviceLayout> = {
  iphone: {
    padX: 30,
    padTop: 54,
    padBottom: 30,
    textHeight: 172,
    gap: 20,
    textGap: 10,
    headline: { min: 28, max: 46, maxLines: 2 },
    subline: { min: 15, max: 21, maxLines: 2 },
    badge: 12,
    arrangement: 'stack',
    deviceWidth: 0.56,
    offsetY: 88,
    pairWidth: 1,
    deviceGap: 0.08,
  },
  ipad: {
    padX: 40,
    padTop: 76,
    padBottom: 44,
    textHeight: 258,
    gap: 30,
    textGap: 14,
    headline: { min: 40, max: 72, maxLines: 2 },
    subline: { min: 22, max: 32, maxLines: 2 },
    badge: 17,
    arrangement: 'stack',
    deviceWidth: 0.6,
    offsetY: 120,
    pairWidth: 1,
    deviceGap: 0.08,
  },
};

/** Where the overlapped pair goes, in CSS px (pt) for a canvas of `pt` at layout scale `s`. */
export interface StackGeometry {
  /** Content width the pair spans. */
  pairWidth: number;
  /** Width of each device. */
  deviceWidth: number;
  deviceHeight: number;
  /** Left offset of the right device. */
  shiftX: number;
  /** Top offset of the front device. */
  offsetY: number;
  pairHeight: number;
  /** Height left for the pair below the text block. */
  rowHeight: number;
  /** Fraction of the back device the front one leaves uncovered. */
  visible: number;
}

export function stackGeometry(layout: TwoDeviceLayout, pt: Dims, s: number, deviceAspect: number): StackGeometry {
  const px = (value: number): number => Math.round(value * s);
  const pairWidth = pt.width - 2 * px(layout.padX);
  const deviceWidth = layout.deviceWidth * pt.width;
  const deviceHeight = deviceWidth / deviceAspect;
  const offsetY = layout.offsetY * s;
  return {
    pairWidth,
    deviceWidth,
    deviceHeight,
    shiftX: Math.max(0, pairWidth - deviceWidth),
    offsetY,
    pairHeight: deviceHeight + offsetY,
    rowHeight: pt.height - px(layout.padTop) - px(layout.padBottom) - px(layout.textHeight) - px(layout.gap),
    visible: Math.max(0, pairWidth - deviceWidth) / deviceWidth,
  };
}
