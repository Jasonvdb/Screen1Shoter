// DOM-free numbers of the framed templates (unit-tested under Node):
// hero-top-text, text-bottom and phone-watch all lay a fixed-height text block
// against a device that fills what is left. They share one table so a set can
// mix them and keep the copy band and the device box at the same y and width
// on every frame; phone-watch's own extra numbers live in phone-watch-layout.ts.
export interface FontRange {
  min: number;
  max: number;
  maxLines: number;
}

/** Numbers in pt at the family's reference width (440 iPhone, 1032 iPad); ratios are unitless. */
export interface FramedLayout {
  padX: number;
  padTop: number;
  padBottom: number;
  /** Fixed height of the text block so every screen in a set gets the same device size. */
  textHeight: number;
  /** Gap between the text block and the device. */
  gap: number;
  /** Gap between badge, headline and subline. */
  textGap: number;
  headline: FontRange;
  subline: FontRange;
  badge: number;
  /** Device width as a fraction of the canvas width. */
  deviceMaxWidth: number;
}

export type FramedFamily = 'iphone' | 'ipad';

export const LAYOUT: Record<FramedFamily, FramedLayout> = {
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
    deviceMaxWidth: 0.82,
  },
  ipad: {
    padX: 80,
    padTop: 76,
    padBottom: 44,
    textHeight: 258,
    gap: 30,
    textGap: 14,
    headline: { min: 40, max: 72, maxLines: 2 },
    subline: { min: 22, max: 32, maxLines: 2 },
    badge: 17,
    deviceMaxWidth: 0.84,
  },
};
