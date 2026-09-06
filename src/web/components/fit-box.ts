// Pure core of FitBox (DOM-free so Node tests and layout modules can import
// it): the largest box of a fixed aspect ratio that fits a measured slot.
// DeviceFrame's slot mode computes the same box through frameBox, so a
// template that measures a device row with FitBox lands where a template that
// hands the row to DeviceFrame does.
import type { Dims } from '../../config/types.ts';

/** Largest integer-width box with `aspect` inside `slot`, capped by the maxima. */
export function fitInto(slot: Dims, aspect: number, maxWidth?: number, maxHeight?: number): Dims {
  let width = Math.min(slot.width, maxWidth ?? Number.POSITIVE_INFINITY);
  const height = Math.min(slot.height, maxHeight ?? Number.POSITIVE_INFINITY);
  if (width / aspect > height) width = height * aspect;
  width = Math.max(0, Math.floor(width));
  return { width, height: width / aspect };
}
