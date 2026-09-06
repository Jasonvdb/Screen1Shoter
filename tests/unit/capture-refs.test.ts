// A capture ref may name another size first: `watch-s10:watch-lap` on an
// iPhone screen reads captures/<locale>/watch/watch-lap.png and is checked
// against 416x496, not against the iPhone's own dimensions. Without that,
// phone-watch could not put a watch capture on a phone canvas at all.
import { describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import {
  CAPTURE_REF_RE,
  captureKey,
  captureRefPreset,
  captureRelPath,
  missingCaptureElement,
  parseCaptureRef,
  resolveScreen,
} from '../../src/config/resolve.ts';
import type { CaptureResolver, ScreenDef } from '../../src/config/types.ts';
import { screenDefSchema } from '../../src/core/schemas.ts';
import { must } from '../fixtures/helpers.ts';

const iphone69 = SIZE_PRESETS['iphone-6.9'];
const ipad13 = SIZE_PRESETS['ipad-13'];
const watch = SIZE_PRESETS['watch-s10'];

/** Records the preset each ref was resolved against, which is the whole point of the prefix. */
const recordingResolver: CaptureResolver = (ref, preset, locale) => ({
  requested: ref,
  family: preset.family,
  locale,
  resolvedPath: captureRelPath(locale, preset.family, ref),
  usedLocale: locale,
  fallback: 'none',
  dims: preset.captureDims,
});

describe('parseCaptureRef', () => {
  it('leaves a bare name alone', () => {
    expect(parseCaptureRef('lap-times')).toEqual({ sizeId: null, name: 'lap-times', unknownSize: false });
  });

  it('splits a known size off the front', () => {
    expect(parseCaptureRef('watch-s10:watch-lap')).toEqual({ sizeId: 'watch-s10', name: 'watch-lap', unknownSize: false });
    expect(parseCaptureRef('ipad-13:hero')).toEqual({ sizeId: 'ipad-13', name: 'hero', unknownSize: false });
  });

  it('flags a prefix that names no size instead of folding it into the name', () => {
    // Silently treating 'watch-s11:watch-lap' as a file name would look for
    // captures/<locale>/<family>/watch-s11:watch-lap.png and report it missing.
    const parsed = parseCaptureRef('watch-s11:watch-lap');
    expect(parsed).toEqual({ sizeId: null, name: 'watch-lap', unknownSize: true });
  });
});

describe('CAPTURE_REF_RE', () => {
  it.each(['lap-times', 'watch_lap.2', 'watch-s10:watch-lap', 'iphone-6.9:hero'])('accepts %s', (ref) => {
    expect(CAPTURE_REF_RE.test(ref)).toBe(true);
  });

  it.each(['', ':watch-lap', 'watch-s10:', 'a:b:c', '../escape', 'has space', '-leading'])('rejects %s', (ref) => {
    expect(CAPTURE_REF_RE.test(ref)).toBe(false);
  });
});

describe('captureRefPreset', () => {
  it('returns the named size, else the one being rendered', () => {
    expect(captureRefPreset('watch-s10:watch-lap', iphone69).id).toBe('watch-s10');
    expect(captureRefPreset('lap-times', iphone69).id).toBe('iphone-6.9');
    // An unknown prefix falls back to the render preset; the schema rejects it first.
    expect(captureRefPreset('nope:watch-lap', ipad13).id).toBe('ipad-13');
  });
});

describe('captureKey and captureRelPath', () => {
  it('drop the prefix, so two refs naming one file share a key and a path', () => {
    expect(captureRelPath('en-US', 'watch', 'watch-s10:watch-lap')).toBe('captures/en-US/watch/watch-lap.png');
    expect(captureRelPath('en-US', 'watch', 'watch-lap')).toBe('captures/en-US/watch/watch-lap.png');
    expect(captureKey('en-US', 'watch', 'watch-s10:watch-lap')).toBe(captureKey('en-US', 'watch', 'watch-lap'));
  });

  it('keeps the whole ref in the placeholder selector, which both sides build from source.requested', () => {
    expect(missingCaptureElement('watch-s10:watch-lap')).toBe('[data-s1s-capture-missing="watch-s10:watch-lap"]');
  });
});

describe('resolveScreen with a cross-size ref', () => {
  const screen: ScreenDef = {
    id: 'lap-times',
    template: 'phone-watch',
    capture: ['lap-times', 'watch-s10:watch-lap'],
  };

  it('sends the phone ref to the render preset and the watch ref to the watch preset', () => {
    const resolved = resolveScreen(screen, iphone69, 'en-US', undefined, recordingResolver);
    const [phone, wrist] = resolved.captures;
    expect(must(phone).family).toBe('iphone');
    expect(must(phone).resolvedPath).toBe('captures/en-US/iphone/lap-times.png');
    expect(must(phone).dims).toEqual(iphone69.captureDims);
    expect(must(wrist).family).toBe('watch');
    expect(must(wrist).resolvedPath).toBe('captures/en-US/watch/watch-lap.png');
    expect(must(wrist).dims).toEqual(watch.captureDims);
    expect(must(wrist).requested).toBe('watch-s10:watch-lap');
  });

  it('routes the same watch ref identically from an iPad canvas', () => {
    const resolved = resolveScreen(screen, ipad13, 'en-US', undefined, recordingResolver);
    expect(must(resolved.captures[1]).resolvedPath).toBe('captures/en-US/watch/watch-lap.png');
    expect(must(resolved.captures[0]).resolvedPath).toBe('captures/en-US/ipad/lap-times.png');
  });
});

describe('screenDefSchema', () => {
  it('accepts a prefixed ref', () => {
    expect(screenDefSchema.safeParse({ id: 'lap-times', capture: ['lap-times', 'watch-s10:watch-lap'] }).success).toBe(true);
  });

  it('rejects a prefix that names no size', () => {
    const result = screenDefSchema.safeParse({ id: 'lap-times', capture: ['lap-times', 'watch-s11:watch-lap'] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/size that does not exist/);
  });

  it('still rejects a name that is not file-safe', () => {
    expect(screenDefSchema.safeParse({ id: 'x', capture: 'has space' }).success).toBe(false);
    expect(screenDefSchema.safeParse({ id: 'x', capture: '../escape' }).success).toBe(false);
  });
});
