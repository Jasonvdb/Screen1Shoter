// phone-watch must not move the phone. A set that mixes it with hero-top-text
// keeps one copy band and one device box across the carousel, so the watch is
// the only thing the template adds, and it has to fit the canvas on every
// iPhone and iPad preset without being clipped.
import { describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import type { Dims, SizePreset } from '../../src/config/types.ts';
import { BEZEL_SOURCES, isBezelSourceId } from '../../src/core/bezels/sources.ts';
import { fitInto } from '../../src/web/components/fit-box.ts';
import { LAYOUT } from '../../src/web/templates/framed-layout.ts';
import { EDGE_MARGIN, WATCH, watchBox } from '../../src/web/templates/phone-watch-layout.ts';

/** Same rule as layoutScale(): 1 at 440 pt (iPhone) / 1032 pt (iPad). */
const scaleOf = (preset: SizePreset): number => preset.pt.width / (preset.family === 'ipad' ? 1032 : 440);

const WATCH_FACTS = BEZEL_SOURCES['apple-watch-series-11-46mm'].portrait;
const watchAspect = WATCH_FACTS.deviceRect.width / WATCH_FACTS.deviceRect.height;

const presets = Object.values(SIZE_PRESETS).filter((p) => !p.aliasOf && (p.family === 'iphone' || p.family === 'ipad'));

/**
 * The phone box the template measures: FitBox.fitInto over the slot left under
 * the text block, exactly the box DeviceFrame's slot mode gives hero-top-text.
 */
function phoneBox(preset: SizePreset): { box: Dims; top: number } {
  const family = preset.family === 'ipad' ? 'ipad' : 'iphone';
  const layout = LAYOUT[family];
  const s = scaleOf(preset);
  const px = (value: number) => Math.round(value * s);
  const top = px(layout.padTop) + px(layout.textHeight) + px(layout.gap);
  const slot: Dims = {
    width: preset.pt.width - 2 * px(layout.padX),
    height: preset.pt.height - top - px(layout.padBottom),
  };
  const bezelId = preset.bezel;
  const deviceRect = isBezelSourceId(bezelId) ? BEZEL_SOURCES[bezelId].portrait.deviceRect : null;
  if (!deviceRect) throw new Error(`${preset.id}: no bezel facts`);
  return { box: fitInto(slot, deviceRect.width / deviceRect.height, Math.round(layout.deviceMaxWidth * preset.pt.width)), top };
}

describe('watchBox', () => {
  for (const preset of presets) {
    const family = preset.family === 'ipad' ? 'ipad' : 'iphone';

    it(`${preset.id}: the watch stays on the canvas and beside the phone's lower right corner`, () => {
      const { box: phone, top } = phoneBox(preset);
      const w = watchBox(WATCH[family], phone, top, preset.pt, watchAspect);
      const left = (preset.pt.width - phone.width) / 2 + w.left;
      const topAbs = top + w.top;

      expect(left, 'left edge on canvas').toBeGreaterThanOrEqual(0);
      expect(topAbs, 'top edge on canvas').toBeGreaterThanOrEqual(0);
      expect(left + w.width, 'right edge on canvas').toBeLessThanOrEqual(preset.pt.width);
      expect(topAbs + w.height, 'bottom edge on canvas').toBeLessThanOrEqual(preset.pt.height);

      // Lower right: past the phone's horizontal centre and below its own centre.
      expect(left + w.width / 2).toBeGreaterThan((preset.pt.width - phone.width) / 2 + phone.width / 2);
      expect(topAbs + w.height / 2).toBeGreaterThan(top + phone.height / 2);
    });

    it(`${preset.id}: the watch is small enough to leave the phone the subject and large enough to read`, () => {
      const { box: phone, top } = phoneBox(preset);
      const w = watchBox(WATCH[family], phone, top, preset.pt, watchAspect);
      // Area, not width: the watch box is far squarer than the phone's.
      const share = (w.width * w.height) / (phone.width * phone.height);
      expect(share).toBeLessThan(0.25);
      // The 416 px capture must not be shrunk past half its own width in device px.
      const screenWidth = w.width * (WATCH_FACTS.screenRect.width / WATCH_FACTS.deviceRect.width);
      expect(screenWidth * preset.scale).toBeGreaterThan(WATCH_FACTS.screenRect.width / 2);
    });
  }

  it('overhangs the phone on both axes when the padding allows it', () => {
    const preset = SIZE_PRESETS['iphone-6.9'];
    const { box: phone, top } = phoneBox(preset);
    const w = watchBox(WATCH.iphone, phone, top, preset.pt, watchAspect);
    expect(w.left + w.width, 'right edge past the phone').toBeGreaterThan(phone.width);
    expect(w.top + w.height, 'bottom edge below the phone').toBeGreaterThan(phone.height);
  });

  it('clamps an overhang that would push the watch off the canvas rather than letting it clip', () => {
    const preset = SIZE_PRESETS['iphone-6.9'];
    const { box: phone, top } = phoneBox(preset);
    const greedy = { ...WATCH.iphone, overhangX: 5, overhangY: 5 };
    const w = watchBox(greedy, phone, top, preset.pt, watchAspect);
    const right = (preset.pt.width - phone.width) / 2 + w.left + w.width;
    expect(right).toBeCloseTo(preset.pt.width - EDGE_MARGIN * phone.width, 6);
    expect(top + w.top + w.height).toBeCloseTo(preset.pt.height - EDGE_MARGIN * phone.width, 6);
    // Clamping moves the watch; it never shrinks it, so the two devices keep their relative size.
    expect(w.width).toBe(watchBox(WATCH.iphone, phone, top, preset.pt, watchAspect).width);
  });

  it('scales with the phone box, not with the canvas', () => {
    const preset = SIZE_PRESETS['iphone-6.9'];
    const { box: phone, top } = phoneBox(preset);
    const half: Dims = { width: phone.width / 2, height: phone.height / 2 };
    expect(watchBox(WATCH.iphone, half, top, preset.pt, watchAspect).width).toBe(Math.round(WATCH.iphone.width * half.width));
  });
});
