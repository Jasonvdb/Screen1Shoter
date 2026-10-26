// Creative assets (iOS 27 product page header and search results): the sizes
// are opt-in per screen, show other sizes' captures, lay out inside Apple's
// Art Safe Area, export beside the screenshot root, and print Asset Library
// commands that place each file in the slots its size fills.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIZE_PRESETS, safeAreaPt } from '../../src/config/presets.ts';
import { resolveScreen, screenAppliesTo } from '../../src/config/resolve.ts';
import type { CaptureResolver, ProjectManifest, Rect, ScreenDef, SizeId } from '../../src/config/types.ts';
import { creativeRoot, exportDir, isCreativeDisplayType } from '../../src/core/paths.ts';
import { loadProject } from '../../src/core/project.ts';
import { creativeCommands, type ExportFile } from '../../src/render/export.ts';
import { artItems, creativeGeometry, type CreativeDevice, type CreativeTextMode } from '../../src/web/templates/creative-hero-layout.ts';
import { MODEL_HELPER_SOURCE, hexToRgb } from '../../src/core/model-render.ts';
import { catchS1sError, makeTempDir, writeTempProject, type TempDir } from '../fixtures/helpers.ts';

const CREATIVE: SizeId[] = ['creative-universal', 'creative-header', 'creative-search'];

const placeholder: CaptureResolver = (ref, preset, locale) => ({
  requested: ref,
  family: preset.family,
  locale,
  resolvedPath: null,
  usedLocale: locale,
  fallback: 'placeholder',
  dims: null,
});

describe('creative sizes are opt-in', () => {
  const plain: ScreenDef = { id: 'home' };
  const hero: ScreenDef = { id: 'store', only: ['creative'], capture: ['iphone-6.9:home'] };

  it('a screen without `only` renders on device sizes, never on a creative canvas', () => {
    expect(screenAppliesTo(plain, SIZE_PRESETS['iphone-6.9'])).toBe(true);
    for (const id of CREATIVE) expect(screenAppliesTo(plain, SIZE_PRESETS[id]), id).toBe(false);
  });

  it('`only` by family or by size id selects creative canvases', () => {
    for (const id of CREATIVE) expect(screenAppliesTo(hero, SIZE_PRESETS[id]), id).toBe(true);
    expect(screenAppliesTo({ id: 'h', only: ['creative-header'] }, SIZE_PRESETS['creative-header'])).toBe(true);
    expect(screenAppliesTo({ id: 'h', only: ['creative-header'] }, SIZE_PRESETS['creative-search'])).toBe(false);
    expect(screenAppliesTo(hero, SIZE_PRESETS['iphone-6.9'])).toBe(false);
  });

  it('defaults to creative-hero and no capture, and resolves a prefixed ref under its own family', () => {
    const bare = resolveScreen({ id: 'art', only: ['creative'] }, SIZE_PRESETS['creative-header'], 'en-US', undefined, placeholder);
    expect(bare.template).toBe('creative-hero');
    expect(bare.captures).toEqual([]);
    const shown = resolveScreen(hero, SIZE_PRESETS['creative-search'], 'en-US', undefined, placeholder);
    expect(shown.captures.map((c) => c.family)).toEqual(['iphone']);
  });
});

describe('loadProject: creative screens', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir();
  });
  afterEach(async () => {
    await tmp.cleanup();
  });

  const load = (screens: ScreenDef[]) =>
    writeTempProject(tmp.dir, { screens: { sizes: ['iphone-6.9', 'creative-search'], screens } }).then(() => loadProject({ projectDir: tmp.dir }));

  it('accepts device captures by size prefix', async () => {
    const project = await load([{ id: 'home' }, { id: 'store', only: ['creative'], capture: ['iphone-6.9:home', 'ipad-13:home'] }]);
    expect(project.sizes).toContain('creative-search');
  });

  it('refuses a bare capture ref, which would look for a creative capture no simulator makes', async () => {
    const error = await catchS1sError(load([{ id: 'store', only: ['creative'], capture: 'home' }]));
    expect(error.code).toBe('config-invalid');
    expect(error.message).toContain('"iphone-6.9:home"');
  });

  it('refuses more than three devices', async () => {
    const refs = ['iphone-6.9:a', 'iphone-6.9:b', 'ipad-13:c', 'ipad-13:d'];
    const error = await catchS1sError(load([{ id: 'store', only: ['creative'], capture: refs }]));
    expect(error.message).toContain('at most 3 captures');
  });

  it('refuses a device template on a creative canvas', async () => {
    const error = await catchS1sError(load([{ id: 'store', only: ['creative'], template: 'hero-top-text', capture: ['iphone-6.9:home'] }]));
    expect(error.message).toContain('has no creative layout');
  });
});

describe('creative-hero geometry', () => {
  const PHONE: CreativeDevice = { aspect: 0.487, tablet: false };
  const TABLET: CreativeDevice = { aspect: 0.765, tablet: true };
  const EPS = 0.001;
  const inside = (inner: Rect, outer: Rect) =>
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS;
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;

  const rows: CreativeDevice[][] = [[], [PHONE], [TABLET, PHONE], [PHONE, PHONE, PHONE]];
  const modes: CreativeTextMode[] = ['left', 'top', 'none'];

  for (const id of CREATIVE) {
    const preset = SIZE_PRESETS[id];
    const safe = safeAreaPt(preset)!;
    const canvas: Rect = { x: 0, y: 0, width: preset.pt.width, height: preset.pt.height };
    for (const devices of rows) {
      for (const text of modes) {
        it(`${id}, ${devices.length} device(s), text ${text}: text in the safe area, whole devices on the canvas, nothing overlaps`, () => {
          const g = creativeGeometry({ canvas: preset.pt, safe, text, devices });
          expect(g.devices).toHaveLength(devices.length);
          for (const rect of g.devices) {
            expect(inside(rect, canvas), 'device on the canvas').toBe(true);
            // Never cut off at the side: within the safe area's width.
            expect(rect.x).toBeGreaterThanOrEqual(safe.x - EPS);
            expect(rect.x + rect.width).toBeLessThanOrEqual(safe.x + safe.width + EPS);
          }
          g.devices.forEach((a, i) => g.devices.slice(i + 1).forEach((b) => expect(overlaps(a, b), 'devices overlap').toBe(false)));
          if (g.text) {
            expect(inside(g.text, safe), 'text in the safe area').toBe(true);
            for (const rect of g.devices) expect(overlaps(g.text, rect), 'text over a device').toBe(false);
          }
          expect(g.text === null).toBe(text === 'none');
        });
      }
    }
  }

  it('one phone beside a text column fills most of the search canvas height', () => {
    const preset = SIZE_PRESETS['creative-search'];
    const [phone] = creativeGeometry({ canvas: preset.pt, safe: safeAreaPt(preset)!, text: 'left', devices: [PHONE] }).devices;
    expect(phone!.height / preset.pt.height).toBeGreaterThan(0.75);
  });

  it('a phone beside a tablet stands shorter, bottoms aligned, with a gap between them', () => {
    const preset = SIZE_PRESETS['creative-header'];
    const [tablet, phone] = creativeGeometry({ canvas: preset.pt, safe: safeAreaPt(preset)!, text: 'none', devices: [TABLET, PHONE] }).devices;
    expect(phone!.height / tablet!.height).toBeCloseTo(0.8, 6);
    expect(phone!.y + phone!.height).toBeCloseTo(tablet!.y + tablet!.height, 6);
    expect(phone!.x).toBeGreaterThan(tablet!.x + tablet!.width);
  });
});

describe('creative exports', () => {
  it('go to creative-assets beside the screenshot root, never inside it', () => {
    const root = '/app/metadata/screenshots';
    expect(creativeRoot(root)).toBe('/app/metadata/creative-assets');
    expect(exportDir(root, 'en-US', 'CREATIVE_HEADER')).toBe('/app/metadata/creative-assets/en-US/CREATIVE_HEADER');
    expect(exportDir(root, 'en-US', 'APP_IPHONE_69')).toBe('/app/metadata/screenshots/en-US/APP_IPHONE_69');
    for (const id of CREATIVE) expect(isCreativeDisplayType(SIZE_PRESETS[id].displayType), id).toBe(true);
    expect(isCreativeDisplayType('APP_IPHONE_DUO')).toBe(false);
  });

  const manifest = (app: Partial<ProjectManifest['app']> = {}): ProjectManifest => ({
    version: 1,
    app: { name: 'Demo', bundleId: 'x', deviceFamilies: [], sourceLocale: 'en-US', appLocales: ['en-US'], metadataDir: 'metadata/screenshots', ...app },
    sizes: {},
    screens: [],
    locales: { 'en-US': { copyStatus: 'approved', captureSource: 'own', versionLocalizationId: 'LOC', devices: {} } },
    runs: [],
  });
  const file = (sizeId: SizeId, ordinal: number, screenId: string): ExportFile => {
    const displayType = SIZE_PRESETS[sizeId].displayType;
    const name = `${String(ordinal).padStart(2, '0')}.png`;
    return { sizeId, displayType, screenId, ordinal, from: '', to: join('/app/metadata/creative-assets/en-US', displayType, name), sha256: '', action: 'written' };
  };
  const project = { appDir: '/app', manifest: manifest({ assetLibraryId: 'LIB' }) };

  it('places the universal 01 file in both slots and uploads later variants without placing them', () => {
    const { commands, warnings } = creativeCommands(project, 'en-US', [file('creative-universal', 1, 'hero'), file('creative-universal', 2, 'alt')]);
    expect(warnings).toEqual([]);
    expect(commands.filter((c) => c.includes('images upload'))).toHaveLength(2);
    expect(commands[0]).toContain('--file metadata/creative-assets/en-US/CREATIVE_UNIVERSAL/01.png');
    const placements = commands.filter((c) => c.includes('placements create'));
    expect(placements.map((c) => c.split('--placement-type ')[1])).toEqual(['PRODUCT_PAGE_HEADER_ASSET', 'APP_STORE_SEARCH_RESULTS_ASSET']);
    expect(placements.every((c) => c.includes('--localization-id LOC'))).toBe(true);
  });

  it('lets a dedicated header or search asset win its slot over the universal one', () => {
    const { commands } = creativeCommands(project, 'en-US', [file('creative-universal', 1, 'hero'), file('creative-search', 1, 'search')]);
    const placements = commands.filter((c) => c.includes('placements create'));
    expect(placements).toHaveLength(2);
    expect(placements[0]).toContain('01-hero');
    expect(placements[0]).toContain('PRODUCT_PAGE_HEADER_ASSET');
    expect(placements[1]).toContain('01-search');
    expect(placements[1]).toContain('APP_STORE_SEARCH_RESULTS_ASSET');
  });

  it('warns about a missing Asset Library id and prints a placeholder', () => {
    const { commands, warnings } = creativeCommands({ appDir: '/app', manifest: manifest() }, 'en-US', [file('creative-header', 1, 'h')]);
    expect(warnings.map((w) => w.code)).toEqual(['manifest-incomplete']);
    expect(commands[0]).toContain("'<ASSET_LIBRARY_ID>'");
  });

  it('prints nothing for a screenshot-only export', () => {
    expect(creativeCommands(project, 'en-US', [file('iphone-6.9', 1, 'home')])).toEqual({ commands: [], warnings: [] });
  });
});

describe('creative-hero key art', () => {
  const ART: CreativeDevice = { aspect: 1.5, tablet: false, art: { scale: 1 } };

  it('a row of key art alone may pass the safe area width but keeps 10% clear each side', () => {
    const preset = SIZE_PRESETS['creative-header'];
    const safe = safeAreaPt(preset)!;
    const g = creativeGeometry({ canvas: preset.pt, safe, text: 'none', devices: [ART, ART, ART] });
    const left = Math.min(...g.devices.map((r) => r.x));
    const right = Math.max(...g.devices.map((r) => r.x + r.width));
    expect(right - left).toBeGreaterThan(safe.width);
    expect(left).toBeGreaterThanOrEqual(preset.pt.width * 0.1 - 0.001);
    expect(right).toBeLessThanOrEqual(preset.pt.width * 0.9 + 0.001);
    // Centred on the safe area: the middle subject is the focal point.
    expect((left + right) / 2).toBeCloseTo(safe.x + safe.width / 2, 3);
  });

  it('a device next to key art keeps the whole row within the safe area width', () => {
    const preset = SIZE_PRESETS['creative-header'];
    const safe = safeAreaPt(preset)!;
    const g = creativeGeometry({ canvas: preset.pt, safe, text: 'none', devices: [ART, { aspect: 0.487, tablet: false }] });
    for (const r of g.devices) {
      expect(r.x).toBeGreaterThanOrEqual(safe.x - 0.001);
      expect(r.x + r.width).toBeLessThanOrEqual(safe.x + safe.width + 0.001);
    }
  });

  it('text beside key art stays in the safe area', () => {
    const preset = SIZE_PRESETS['creative-universal'];
    const safe = safeAreaPt(preset)!;
    const g = creativeGeometry({ canvas: preset.pt, safe, text: 'left', devices: [ART] });
    expect(g.text!.x).toBeGreaterThanOrEqual(safe.x - 0.001);
    expect(g.text!.x + g.text!.width).toBeLessThanOrEqual(safe.x + safe.width + 0.001);
    expect(g.devices[0]!.x).toBeGreaterThan(g.text!.x + g.text!.width);
  });

  it('reads props.art as paths or { src, scale }', () => {
    expect(artItems('assets/a.png')).toEqual([{ src: 'assets/a.png', scale: 1 }]);
    expect(artItems(['assets/a.png', { src: 'assets/b.png', scale: 0.6 }, { src: '' }, 7])).toEqual([
      { src: 'assets/a.png', scale: 1 },
      { src: 'assets/b.png', scale: 0.6 },
    ]);
    expect(artItems(undefined)).toEqual([]);
  });
});

describe('s1s model render', () => {
  it('parses #RRGGBB and shades like the app viewer: double-sided, auto-smooth normals', () => {
    expect(hexToRgb('#B86E26').map((v) => Math.round(v * 255))).toEqual([184, 110, 38]);
    expect(() => hexToRgb('copper')).toThrow(/not a #RRGGBB/);
    expect(MODEL_HELPER_SOURCE).toContain('isDoubleSided = true');
    expect(MODEL_HELPER_SOURCE).toContain('cos(35 * .pi / 180)');
    expect(MODEL_HELPER_SOURCE).toContain('NSColor.clear');
  });
});
