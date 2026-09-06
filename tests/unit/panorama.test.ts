// Panorama slice arithmetic (src/config/panorama.ts), the injection
// resolveScreen does with it, and the cross-field checks loadProject runs
// before either can produce a broken seam. The CSS that turns a slice into
// pixels lives in src/web/components/Background.tsx and is covered by the
// smoke render instead.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  panoramaBackground,
  panoramaOrder,
  panoramaSlice,
  type PanoramaSlice,
} from '../../src/config/panorama.ts';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import { captureRelPath, resolveScreen } from '../../src/config/resolve.ts';
import type { CaptureResolver, ScreensConfig } from '../../src/config/types.ts';
import { loadProject } from '../../src/core/project.ts';
import { catchS1sError, makeTempDir, must, writeTempProject } from '../fixtures/helpers.ts';

const iphone69 = SIZE_PRESETS['iphone-6.9'];

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

function config(ids: string[], panorama?: ScreensConfig['panorama']): ScreensConfig {
  const screens: ScreensConfig = { screens: ids.map((id) => ({ id })) };
  if (panorama !== undefined) screens.panorama = panorama;
  return screens;
}

const FOUR = config(['home', 'track', 'stats', 'share'], { image: 'assets/wide.png' });

describe('panoramaOrder', () => {
  it('defaults to every screen in screens.ts order', () => {
    expect(panoramaOrder(FOUR)).toEqual(['home', 'track', 'stats', 'share']);
  });

  it('uses panorama.screens in the order the author wrote them', () => {
    const cfg = config(['home', 'track', 'stats'], { image: 'wide.png', screens: ['stats', 'home'] });
    expect(panoramaOrder(cfg)).toEqual(['stats', 'home']);
  });

  it('drops a listed id screens.ts does not define, so later slices keep their seam', () => {
    const cfg = config(['home', 'track'], { image: 'wide.png', screens: ['home', 'ghost', 'track'] });
    expect(panoramaOrder(cfg)).toEqual(['home', 'track']);
    expect(must(panoramaSlice(cfg, 'track')).index).toBe(1);
  });

  it('is the plain screen list when there is no panorama', () => {
    expect(panoramaOrder(config(['home', 'track']))).toEqual(['home', 'track']);
  });
});

describe('panoramaSlice', () => {
  it('gives the i-th of N equal slices, in screen order', () => {
    const slices = ['home', 'track', 'stats', 'share'].map((id) => must(panoramaSlice(FOUR, id), id));
    expect(slices.map((slice) => slice.index)).toEqual([0, 1, 2, 3]);
    expect(slices.every((slice) => slice.count === 4)).toBe(true);
    expect(slices.every((slice) => slice.image === 'assets/wide.png')).toBe(true);
  });

  it('tiles the whole image with no gap and no overlap', () => {
    const ids = ['home', 'track', 'stats', 'share'];
    const slices = ids.map((id) => must(panoramaSlice(FOUR, id), id));
    expect(must(slices[0]).offset).toBe(0);
    for (const [i, slice] of slices.entries()) {
      const next = slices[i + 1];
      // Each slice ends exactly where the next one starts; the last ends at 1.
      expect(slice.offset + slice.width).toBeCloseTo(next ? next.offset : 1, 12);
    }
    expect(slices.reduce((sum, slice) => sum + slice.width, 0)).toBeCloseTo(1, 12);
  });

  it('gives a one-screen panorama the whole image', () => {
    const cfg = config(['home', 'track'], { image: 'wide.png', screens: ['home'] });
    expect(panoramaSlice(cfg, 'home')).toEqual({ image: 'wide.png', index: 0, count: 1, offset: 0, width: 1 });
  });

  it('returns null for a screen outside the panorama list', () => {
    const cfg = config(['home', 'track', 'stats'], { image: 'wide.png', screens: ['home', 'stats'] });
    expect(panoramaSlice(cfg, 'track')).toBeNull();
    expect(must(panoramaSlice(cfg, 'stats')).index).toBe(1);
  });

  it('returns null when the project has no panorama', () => {
    expect(panoramaSlice(config(['home']), 'home')).toBeNull();
  });
});

describe('panoramaBackground', () => {
  it('renames image to src and keeps the numbers', () => {
    const slice: PanoramaSlice = { image: 'assets/wide.png', index: 1, count: 4, offset: 0.25, width: 0.25 };
    expect(panoramaBackground(slice)).toEqual({
      type: 'panorama',
      src: 'assets/wide.png',
      index: 1,
      count: 4,
      offset: 0.25,
      width: 0.25,
    });
  });
});

describe('resolveScreen panorama injection', () => {
  const resolve = (cfg: ScreensConfig, id: string) =>
    resolveScreen(must(cfg.screens.find((screen) => screen.id === id)), iphone69, 'en-US', undefined, fakeResolver, {
      config: cfg,
    });

  it('injects the slice as props.background so every template renders it', () => {
    expect(resolve(FOUR, 'stats').props['background']).toEqual({
      type: 'panorama',
      src: 'assets/wide.png',
      index: 2,
      count: 4,
      offset: 0.5,
      width: 0.25,
    });
  });

  it('leaves a screen outside the panorama with the background it had', () => {
    const cfg = config(['home', 'track'], { image: 'wide.png', screens: ['home'] });
    must(cfg.screens[1]).props = { background: '#101014' };
    expect(resolve(cfg, 'track').props['background']).toBe('#101014');
  });

  it('adds nothing when the screen has no background and takes no slice', () => {
    const cfg = config(['home', 'track'], { image: 'wide.png', screens: ['home'] });
    expect('background' in resolve(cfg, 'track').props).toBe(false);
  });

  it('lets an explicit props.background win over the panorama', () => {
    const cfg = config(['home', 'track'], { image: 'wide.png' });
    must(cfg.screens[0]).props = { background: { type: 'gradient', from: '#000', to: '#fff' } };
    expect(resolve(cfg, 'home').props['background']).toEqual({ type: 'gradient', from: '#000', to: '#fff' });
  });

  it('lets a background from an override layer win too', () => {
    const cfg = config(['home', 'track'], { image: 'wide.png' });
    must(cfg.screens[0]).overrides = { iphone: { props: { background: '#ff0000' } } };
    expect(resolve(cfg, 'home').props['background']).toBe('#ff0000');
  });

  it('injects nothing when the caller passes no config (loadProject validation, capture planning)', () => {
    const screen = must(FOUR.screens[0]);
    expect('background' in resolveScreen(screen, iphone69, 'en-US', undefined, fakeResolver).props).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadProject: the panorama is only coherent when every listed screen really
// renders on every target. Node has both halves, so it refuses at load time.
// ---------------------------------------------------------------------------

describe('loadProject panorama validation', () => {
  async function load(screens: ScreensConfig): Promise<ReturnType<typeof loadProject>> {
    const tmp = await makeTempDir();
    const dir = await writeTempProject(join(tmp.dir, 'screenshots'), { screens });
    return loadProject({ projectDir: dir }).finally(tmp.cleanup);
  }

  it('accepts a panorama whose screens all reach every configured size', async () => {
    const project = await load({
      sizes: ['iphone-6.9', 'ipad-13'],
      panorama: { image: 'assets/wide.png' },
      screens: [{ id: 'home' }, { id: 'detail' }],
    });
    expect(project.screens.panorama?.image).toBe('assets/wide.png');
  });

  it('refuses an implicit panorama when `only` keeps a screen off one family', async () => {
    const error = await catchS1sError(
      load({
        sizes: ['iphone-6.9', 'ipad-13'],
        panorama: { image: 'assets/wide.png' },
        screens: [{ id: 'home' }, { id: 'pocket', only: ['iphone'] }],
      }),
    );
    expect(error.code).toBe('config-invalid');
    expect(error.message).toContain('screen "pocket" is kept off ipad by `only`');
    expect(error.message).toContain('list panorama.screens explicitly');
  });

  it('refuses an implicit panorama holding a watch passthrough screen', async () => {
    const error = await catchS1sError(
      load({
        sizes: ['watch-s10'],
        panorama: { image: 'assets/wide.png' },
        screens: [{ id: 'glance' }],
      }),
    );
    expect(error.code).toBe('config-invalid');
    expect(error.message).toContain('screen "glance" is a passthrough item on watch');
  });

  it('accepts the same shapes once panorama.screens names the screens that take a slice', async () => {
    const project = await load({
      sizes: ['iphone-6.9', 'ipad-13', 'watch-s10'],
      panorama: { image: 'assets/wide.png', screens: ['home', 'detail'] },
      screens: [{ id: 'home' }, { id: 'detail' }, { id: 'pocket', only: ['iphone'] }, { id: 'glance', only: ['watch'] }],
    });
    expect(panoramaOrder(project.screens)).toEqual(['home', 'detail']);
  });

  it('refuses a panorama.screens id screens.ts does not define', async () => {
    const error = await catchS1sError(
      load({
        sizes: ['iphone-6.9'],
        panorama: { image: 'assets/wide.png', screens: ['home', 'detial', 'share'] },
        screens: [{ id: 'home' }, { id: 'detail' }, { id: 'share' }],
      }),
    );
    expect(error.code).toBe('config-invalid');
    expect(error.message).toContain('panorama.screens names unknown screen "detial"');
    expect(error.message).toContain('known: home, detail, share');
  });

  it('refuses a panorama.screens id listed twice', async () => {
    const error = await catchS1sError(
      load({
        sizes: ['iphone-6.9'],
        panorama: { image: 'assets/wide.png', screens: ['home', 'home', 'detail'] },
        screens: [{ id: 'home' }, { id: 'detail' }],
      }),
    );
    expect(error.code).toBe('config-invalid');
    expect(error.message).toContain('panorama.screens lists "home" twice');
  });
});
