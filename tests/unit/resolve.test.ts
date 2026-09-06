// resolveScreen: base < overrides[family] < overrides[sizeId] < locales[locale].
// `template` and `capture` replace, `props` shallow-merge, capture defaults to
// [screen.id], copy comes from copy.screens[copyKey ?? id].
import { describe, expect, it, vi } from 'vitest';
import { SIZE_PRESETS, renderTarget } from '../../src/config/presets.ts';
import {
  captureKey,
  captureRelPath,
  exportFileName,
  formatOrdinal,
  renderFileName,
  renderRoute,
  resolveScreen,
  screenAppliesTo,
  sheetRoute,
} from '../../src/config/resolve.ts';
import type { CaptureResolver, LocaleCopy, ScreenDef } from '../../src/config/types.ts';
import { must } from '../fixtures/helpers.ts';

const iphone69 = SIZE_PRESETS['iphone-6.9'];
const iphone67 = SIZE_PRESETS['iphone-6.7'];
const iphone65 = SIZE_PRESETS['iphone-6.5'];
const ipad13 = SIZE_PRESETS['ipad-13'];
const watch = SIZE_PRESETS['watch-s10'];

/** Resolver that pretends every capture exists in the requested locale. */
const fakeResolver: CaptureResolver = (ref, preset, locale) => ({
  requested: ref,
  family: preset.family,
  locale,
  resolvedPath: captureRelPath(locale, preset.family, ref),
  usedLocale: locale,
  fallback: 'none',
  dims: preset.captureDims,
});

const copy: LocaleCopy = {
  locale: 'en-US',
  screens: {
    home: { headline: 'See Every Ride', highlight: 'Every' },
    details: { headline: ['Time Every Lap', 'Automatically'] },
  },
};

/** One screen that exercises every layer. */
const layered: ScreenDef = {
  id: 'layered',
  template: 'text-bottom',
  capture: 'cap-base',
  props: { a: 'base', b: 'base', c: 'base', d: 'base' },
  overrides: {
    iphone: { template: 'hero-top-text', capture: 'cap-family', props: { b: 'family', c: 'family', d: 'family' } },
    'iphone-6.9': { capture: ['cap-size-1', 'cap-size-2'], props: { c: 'size', d: 'size' } },
    'iphone-6.7': { template: 'tilted', capture: 'cap-alias', props: { a: 'alias' } },
  },
  locales: {
    'de-DE': { template: 'two-device', props: { d: 'locale' } },
  },
};

describe('screenAppliesTo', () => {
  it('applies everywhere when `only` is absent or empty', () => {
    expect(screenAppliesTo({ id: 'x' }, iphone69)).toBe(true);
    expect(screenAppliesTo({ id: 'x', only: [] }, watch)).toBe(true);
  });

  it('matches by family or by size id', () => {
    expect(screenAppliesTo({ id: 'x', only: ['ipad'] }, ipad13)).toBe(true);
    expect(screenAppliesTo({ id: 'x', only: ['ipad'] }, iphone69)).toBe(false);
    expect(screenAppliesTo({ id: 'x', only: ['iphone-6.5'] }, iphone65)).toBe(true);
    expect(screenAppliesTo({ id: 'x', only: ['iphone-6.5'] }, iphone69)).toBe(false);
    expect(screenAppliesTo({ id: 'x', only: ['watch', 'ipad-13'] }, watch)).toBe(true);
    expect(screenAppliesTo({ id: 'x', only: ['watch', 'ipad-13'] }, ipad13)).toBe(true);
  });
});

describe('resolveScreen precedence', () => {
  it('base < family < size < locale for props (shallow merge)', () => {
    const r = resolveScreen(layered, iphone69, 'de-DE', undefined, fakeResolver);
    expect(r.props).toEqual({ a: 'base', b: 'family', c: 'size', d: 'locale' });
  });

  it('template: the last layer that sets it wins', () => {
    expect(resolveScreen(layered, ipad13, 'en-US', undefined, fakeResolver).template).toBe('text-bottom');
    expect(resolveScreen(layered, iphone65, 'en-US', undefined, fakeResolver).template).toBe('hero-top-text');
    expect(resolveScreen(layered, iphone69, 'en-US', undefined, fakeResolver).template).toBe('hero-top-text');
    expect(resolveScreen(layered, iphone69, 'de-DE', undefined, fakeResolver).template).toBe('two-device');
    expect(resolveScreen(layered, ipad13, 'de-DE', undefined, fakeResolver).template).toBe('two-device');
  });

  it('capture: replaced (never merged) by the highest layer that sets it', () => {
    const requested = (r: ReturnType<typeof resolveScreen>) => r.captures.map((c) => c.requested);
    expect(requested(resolveScreen(layered, ipad13, 'en-US', undefined, fakeResolver))).toEqual(['cap-base']);
    expect(requested(resolveScreen(layered, iphone65, 'en-US', undefined, fakeResolver))).toEqual(['cap-family']);
    expect(requested(resolveScreen(layered, iphone69, 'en-US', undefined, fakeResolver))).toEqual(['cap-size-1', 'cap-size-2']);
    // The locale layer does not set capture, so the size layer still wins.
    expect(requested(resolveScreen(layered, iphone69, 'de-DE', undefined, fakeResolver))).toEqual(['cap-size-1', 'cap-size-2']);
  });

  it('family and size layers only apply to their own family / size', () => {
    const r = resolveScreen(layered, ipad13, 'en-US', undefined, fakeResolver);
    expect(r.props).toEqual({ a: 'base', b: 'base', c: 'base', d: 'base' });
    const r65 = resolveScreen(layered, iphone65, 'en-US', undefined, fakeResolver);
    expect(r65.props).toEqual({ a: 'base', b: 'family', c: 'family', d: 'family' });
  });

  it('overrides keyed by an alias id are never consulted (aliases render as their target)', () => {
    const r = resolveScreen(layered, renderTarget(iphone67), 'en-US', undefined, fakeResolver);
    expect(r.sizeId).toBe('iphone-6.9');
    expect(r.template).toBe('hero-top-text');
    expect(r.props['a']).toBe('base');
    expect(r.captures.map((c) => c.requested)).toEqual(['cap-size-1', 'cap-size-2']);
  });

  it('does not mutate the screen definition', () => {
    const before = JSON.stringify(layered);
    const r = resolveScreen(layered, iphone69, 'de-DE', undefined, fakeResolver);
    r.props['z'] = 'mutated';
    expect(JSON.stringify(layered)).toBe(before);
  });
});

describe('resolveScreen defaults', () => {
  it('template defaults per family: hero-top-text for iphone/ipad, raw for watch', () => {
    const bare: ScreenDef = { id: 'home' };
    expect(resolveScreen(bare, iphone69, 'en-US', copy, fakeResolver).template).toBe('hero-top-text');
    expect(resolveScreen(bare, ipad13, 'en-US', copy, fakeResolver).template).toBe('hero-top-text');
    expect(resolveScreen(bare, watch, 'en-US', copy, fakeResolver).template).toBe('raw');
  });

  it('capture defaults to [screen.id]', () => {
    const r = resolveScreen({ id: 'home' }, iphone69, 'en-US', copy, fakeResolver);
    expect(r.captures).toHaveLength(1);
    const c = must(r.captures[0]);
    expect(c.requested).toBe('home');
    expect(c.family).toBe('iphone');
    expect(c.locale).toBe('en-US');
    expect(c.resolvedPath).toBe('captures/en-US/iphone/home.png');
  });

  it('per-family capture map picks the family entry, else falls back to the id', () => {
    const screen: ScreenDef = { id: 'detail', capture: { iphone: 'detail-phone', ipad: ['detail-pad-a', 'detail-pad-b'] } };
    expect(resolveScreen(screen, iphone69, 'en-US', copy, fakeResolver).captures.map((c) => c.requested)).toEqual(['detail-phone']);
    expect(resolveScreen(screen, ipad13, 'en-US', copy, fakeResolver).captures.map((c) => c.requested)).toEqual(['detail-pad-a', 'detail-pad-b']);
    expect(resolveScreen(screen, watch, 'en-US', copy, fakeResolver).captures.map((c) => c.requested)).toEqual(['detail']);
  });

  it('array capture keeps order; a string override collapses it to one', () => {
    const screen: ScreenDef = { id: 'pair', capture: ['left', 'right'], overrides: { ipad: { capture: 'wide' } } };
    expect(resolveScreen(screen, iphone69, 'en-US', copy, fakeResolver).captures.map((c) => c.requested)).toEqual(['left', 'right']);
    expect(resolveScreen(screen, ipad13, 'en-US', copy, fakeResolver).captures.map((c) => c.requested)).toEqual(['wide']);
  });

  it('calls the capture resolver once per ref with (ref, preset, locale) and keeps its result', () => {
    const resolver = vi.fn(fakeResolver);
    const r = resolveScreen({ id: 'pair', capture: ['left', 'right'] }, ipad13, 'fr-FR', copy, resolver);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenNthCalledWith(1, 'left', ipad13, 'fr-FR');
    expect(resolver).toHaveBeenNthCalledWith(2, 'right', ipad13, 'fr-FR');
    expect(r.captures).toEqual([resolver.mock.results[0]?.value, resolver.mock.results[1]?.value]);
  });

  it('passes through a resolver fallback (source-locale) untouched', () => {
    const fallbackResolver: CaptureResolver = (ref, preset) => ({
      requested: ref,
      family: preset.family,
      locale: 'de-DE',
      resolvedPath: captureRelPath('en-US', preset.family, ref),
      usedLocale: 'en-US',
      fallback: 'source-locale',
      dims: preset.captureDims,
    });
    const r = resolveScreen({ id: 'home' }, iphone69, 'de-DE', undefined, fallbackResolver);
    expect(must(r.captures[0])).toMatchObject({ fallback: 'source-locale', usedLocale: 'en-US', locale: 'de-DE' });
  });
});

describe('resolveScreen copy', () => {
  it('uses copy.screens[id] by default and passes the object through by reference', () => {
    const r = resolveScreen({ id: 'home' }, iphone69, 'en-US', copy, fakeResolver);
    expect(r.copyKey).toBe('home');
    expect(r.copy).toBe(copy.screens['home']);
  });

  it('honours copyKey', () => {
    const r = resolveScreen({ id: 'detail', copyKey: 'details' }, iphone69, 'en-US', copy, fakeResolver);
    expect(r.copyKey).toBe('details');
    expect(r.copy).toEqual({ headline: ['Time Every Lap', 'Automatically'] });
  });

  it('yields undefined copy (-> copy-missing warning) when the key or the locale copy is absent; never falls back to another locale silently', () => {
    expect(resolveScreen({ id: 'missing' }, iphone69, 'en-US', copy, fakeResolver).copy).toBeUndefined();
    expect(resolveScreen({ id: 'home' }, iphone69, 'de-DE', undefined, fakeResolver).copy).toBeUndefined();
    const german: LocaleCopy = { locale: 'de-DE', screens: {} };
    expect(resolveScreen({ id: 'home' }, iphone69, 'de-DE', german, fakeResolver).copy).toBeUndefined();
  });

  it('fills id, locale, sizeId, family and notes', () => {
    const r = resolveScreen({ id: 'home', notes: 'Hero shot.' }, ipad13, 'en-US', copy, fakeResolver);
    expect(r).toMatchObject({ id: 'home', locale: 'en-US', sizeId: 'ipad-13', family: 'ipad', notes: 'Hero shot.' });
    expect('notes' in resolveScreen({ id: 'home' }, ipad13, 'en-US', copy, fakeResolver)).toBe(false);
  });
});

describe('naming helpers', () => {
  it('captureKey / captureRelPath', () => {
    expect(captureKey('en-US', 'iphone', 'home')).toBe('en-US/iphone/home');
    expect(captureRelPath('de-DE', 'ipad', 'detail-pad')).toBe('captures/de-DE/ipad/detail-pad.png');
  });

  it('formatOrdinal pads to two digits and rejects out-of-range values', () => {
    expect(formatOrdinal(1)).toBe('01');
    expect(formatOrdinal(10)).toBe('10');
    expect(formatOrdinal(99)).toBe('99');
    expect(() => formatOrdinal(0)).toThrow(/Ordinal out of range/);
    expect(() => formatOrdinal(100)).toThrow(/Ordinal out of range/);
    expect(() => formatOrdinal(1.5)).toThrow(/Ordinal out of range/);
  });

  it('renderFileName / exportFileName', () => {
    expect(renderFileName(1, 'home')).toBe('01-home.png');
    expect(renderFileName(3, 'tablet-split')).toBe('03-tablet-split.png');
    expect(exportFileName(1)).toBe('01.png');
    expect(exportFileName(10)).toBe('10.png');
  });

  it('renderRoute / sheetRoute are hash routes with encoded segments', () => {
    expect(renderRoute('en-US', 'iphone-6.9', 'home')).toBe('/#/render/en-US/iphone-6.9/home');
    expect(renderRoute('en-US', 'ipad-13', 'a b/c')).toBe('/#/render/en-US/ipad-13/a%20b%2Fc');
    expect(sheetRoute('de-DE', 'iphone-6.9')).toBe('/#/sheet/de-DE/iphone-6.9');
  });
});
