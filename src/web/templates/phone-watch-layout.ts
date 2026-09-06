// DOM-free numbers and geometry of the phone-watch template (unit-tested
// under Node): where the Apple Watch sits relative to the phone or iPad it
// stands in front of. phone-watch.tsx renders from these.
//
// The template deliberately borrows hero-top-text's FramedLayout for the text
// block and the phone, so a set can put phone-watch on one screen and
// hero-top-text on the rest and the copy band and the device still land at the
// same y at the same width. Everything here describes only the extra device.
import { SIZE_PRESETS } from '../../config/presets.ts';
import { parseCaptureRef } from '../../config/resolve.ts';
import type { CaptureRef, Dims, SizeId } from '../../config/types.ts';

export type PhoneWatchFamily = 'iphone' | 'ipad';

/** Watch size used when the second capture ref names none. */
export const DEFAULT_WATCH_SIZE_ID: SizeId = 'watch-s10';

/**
 * The watch size the second capture ref names, which is the one knob that
 * decides both halves at once: the file's expected pixel size and, through
 * `preset.bezel`, which Apple Watch is drawn. `watch-ultra:lap` puts a real
 * 422x514 Ultra capture in an Ultra 3 frame; a bare or phone-sized ref falls
 * back to the Series watch. `props.watchBezel` changes only the frame, for a
 * project that has one watch capture and wants another model beside the phone.
 */
export function watchSizeId(ref: CaptureRef | undefined): SizeId {
  if (ref === undefined) return DEFAULT_WATCH_SIZE_ID;
  const { sizeId } = parseCaptureRef(ref);
  return sizeId !== null && SIZE_PRESETS[sizeId].family === 'watch' ? sizeId : DEFAULT_WATCH_SIZE_ID;
}

export interface WatchPlacement {
  /** Watch device-box width, as a fraction of the phone's device-box width. */
  width: number;
  /**
   * How far past the phone's right edge the watch's own right edge sits, as a
   * fraction of the phone's width. The overhang is what makes the pair read as
   * two objects on a surface rather than one inset into the other.
   */
  overhangX: number;
  /** Same, below the phone's bottom edge. A fraction of the phone's WIDTH, so both overhangs are the same visual distance. */
  overhangY: number;
}

/**
 * True relative scale would put the watch at 0.60 of the phone's width (an
 * Apple Watch 46 mm with its bands is 76 mm tall against a 163 mm iPhone 17
 * Pro Max), which buries a third of the phone. These are the legible
 * compromise: large enough that the watch face still reads at carousel scale,
 * small enough that the phone stays the subject.
 */
export const WATCH: Record<PhoneWatchFamily, WatchPlacement> = {
  iphone: { width: 0.44, overhangX: 0.07, overhangY: 0.03 },
  ipad: { width: 0.3, overhangX: 0.05, overhangY: 0.025 },
};

/** Clearance kept between the watch and the canvas edge, as a fraction of the phone's width. */
export const EDGE_MARGIN = 0.03;

export interface WatchBox {
  width: number;
  height: number;
  /** Offsets from the phone box's own top-left corner, so the watch can be placed inside it. */
  left: number;
  top: number;
}

/**
 * The watch box in CSS px, given the phone box the template just measured.
 *
 * `phone` is the phone's device box, `phoneTop` its y in the canvas (the
 * template stacks padTop + textHeight + gap above it) and `canvas` the whole
 * frame in pt. The phone is centred horizontally, so its x follows.
 *
 * The result is clamped to the canvas: an overhang wider than the template's
 * own padding would push the watch off the frame, where it would be clipped
 * and reported by the canvas check instead of simply looking placed. Clamping
 * moves the watch inwards rather than shrinking it, so the two devices keep
 * their relative size.
 */
export function watchBox(placement: WatchPlacement, phone: Dims, phoneTop: number, canvas: Dims, watchAspect: number): WatchBox {
  const width = Math.round(placement.width * phone.width);
  const height = width / watchAspect;
  const phoneLeft = (canvas.width - phone.width) / 2;
  const margin = EDGE_MARGIN * phone.width;
  const right = Math.min(phoneLeft + phone.width + placement.overhangX * phone.width, canvas.width - margin);
  const bottom = Math.min(phoneTop + phone.height + placement.overhangY * phone.width, canvas.height - margin);
  return { width, height, left: right - width - phoneLeft, top: bottom - height - phoneTop };
}
