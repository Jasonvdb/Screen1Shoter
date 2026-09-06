// phone-watch must not move the phone. A set that mixes it with hero-top-text
// keeps one copy band and one device box across the carousel, so the watch is
// the only thing the template adds, and it has to fit the canvas on every
// iPhone and iPad preset without being clipped.
import { describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import type { Dims, SizePreset } from '../../src/config/types.ts';
import { BEZEL_SOURCES, WATCH_BEZEL_IDS, isBezelSourceId } from '../../src/core/bezels/sources.ts';
import { fitInto } from '../../src/web/components/fit-box.ts';
import { LAYOUT } from '../../src/web/templates/framed-layout.ts';
import {
  DEFAULT_WATCH_SIZE_ID,
  EDGE_MARGIN,
  WATCH,
  watchBox,
  watchSizeId,
} from '../../src/web/templates/phone-watch-layout.ts';

/** Same rule as layoutScale(): 1 at 440 pt (iPhone) / 1032 pt (iPad). */
const scaleOf = (preset: SizePreset): number => preset.pt.width / (preset.family === 'ipad' ? 1032 : 440);

const WATCH_FACTS = BEZEL_SOURCES['apple-watch-series-11-46mm'].portrait;
const watchAspect = WATCH_FACTS.deviceRect.width / WATCH_FACTS.deviceRect.height;

/** Every frame props.watchBezel may name, so the placement holds for all of them. */
const WATCH_MODELS = WATCH_BEZEL_IDS.map((id) => {
  const facts = BEZEL_SOURCES[id].portrait;
  return { id, facts, aspect: facts.deviceRect.width / facts.deviceRect.height };
});

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

describe('watchSizeId', () => {
  it('takes the watch size the capture ref names', () => {
    expect(watchSizeId('watch-ultra:watch-lap')).toBe('watch-ultra');
    expect(watchSizeId('watch-s10:watch-lap')).toBe('watch-s10');
  });

  it('falls back to the Series watch for a ref that names no watch size', () => {
    // A bare name, an unknown prefix (the schema rejects that one first) and a
    // phone size all mean "nobody chose", not "use a phone-sized watch frame".
    expect(watchSizeId(undefined)).toBe(DEFAULT_WATCH_SIZE_ID);
    expect(watchSizeId('watch-lap')).toBe(DEFAULT_WATCH_SIZE_ID);
    expect(watchSizeId('nope:watch-lap')).toBe(DEFAULT_WATCH_SIZE_ID);
    expect(watchSizeId('iphone-6.9:watch-lap')).toBe(DEFAULT_WATCH_SIZE_ID);
    expect(SIZE_PRESETS[DEFAULT_WATCH_SIZE_ID].family).toBe('watch');
  });

  it('names a size whose bezel is a watch, so the frame follows the capture size', () => {
    for (const id of Object.keys(SIZE_PRESETS) as Array<keyof typeof SIZE_PRESETS>) {
      const preset = SIZE_PRESETS[id];
      if (preset.family !== 'watch') continue;
      expect(watchSizeId(`${id}:watch-lap`)).toBe(id);
      expect(WATCH_BEZEL_IDS).toContain(preset.bezel);
    }
  });
});

describe('watchBox across every watch model', () => {
  // The Ultra is squarer than a Series watch (aspect 0.607 against 0.614), so
  // the box grows taller for the same width. Placement must survive that on
  // every canvas, not only on the model the numbers were tuned against.
  for (const preset of presets) {
    const family = preset.family === 'ipad' ? 'ipad' : 'iphone';
    for (const model of WATCH_MODELS) {
      it(`${preset.id} + ${model.id}: on the canvas, below and right of the phone's centre`, () => {
        const { box: phone, top } = phoneBox(preset);
        const w = watchBox(WATCH[family], phone, top, preset.pt, model.aspect);
        const left = (preset.pt.width - phone.width) / 2 + w.left;

        expect(left).toBeGreaterThanOrEqual(0);
        expect(top + w.top).toBeGreaterThanOrEqual(0);
        expect(left + w.width).toBeLessThanOrEqual(preset.pt.width);
        expect(top + w.top + w.height).toBeLessThanOrEqual(preset.pt.height);
        expect(left + w.width / 2).toBeGreaterThan((preset.pt.width - phone.width) / 2 + phone.width / 2);
        expect(top + w.top + w.height / 2).toBeGreaterThan(top + phone.height / 2);
        // Still an inset, not a co-star.
        expect((w.width * w.height) / (phone.width * phone.height)).toBeLessThan(0.25);
      });
    }
  }

  it('gives one width to every model, so a frame swap does not resize the watch', () => {
    const preset = SIZE_PRESETS['iphone-6.9'];
    const { box: phone, top } = phoneBox(preset);
    const widths = WATCH_MODELS.map((m) => watchBox(WATCH.iphone, phone, top, preset.pt, m.aspect).width);
    expect(new Set(widths).size).toBe(1);
  });
});
