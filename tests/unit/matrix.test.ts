// buildMatrix over the project-basic fixture: presets grouped by render
// target (6.7" alias renders once as 6.9"), screens filtered by `only`,
// ordinals contiguous per size, out paths under out/<locale>/<displayType>/.
// Also covers findProjectDir / loadProject since the matrix depends on them.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderRoute } from '../../src/config/resolve.ts';
import type { RenderItem, ScreenDef, SizeId } from '../../src/config/types.ts';
import { buildMatrix } from '../../src/core/matrix.ts';
import { findProjectDir, loadProject, type Project } from '../../src/core/project.ts';
import { fixtureAppDir, fixtureProjectDir, makeTempDir, must, writeTempProject } from '../fixtures/helpers.ts';

const appDir = fixtureAppDir('project-basic');
const projectDir = fixtureProjectDir('project-basic');
const outDir = join(projectDir, 'out', 'en-US');

let project: Project;

beforeAll(async () => {
  project = await loadProject({ projectDir });
});

const keys = (items: RenderItem[]): string[] => items.map((i) => i.key);
const find = (items: RenderItem[], key: string): RenderItem => must(items.find((i) => i.key === key), key);
const ordinalsFor = (items: RenderItem[], sizeId: SizeId): number[] =>
  items.filter((i) => i.preset.id === sizeId).map((i) => i.ordinal);

describe('findProjectDir / loadProject', () => {
  it('finds <cwd>/screenshots, the project dir itself, or walks up from a child', () => {
    expect(findProjectDir(appDir)).toBe(projectDir);
    expect(findProjectDir(projectDir)).toBe(projectDir);
    expect(findProjectDir(join(projectDir, 'copy'))).toBe(projectDir);
  });

  it('returns null when no screenshots/screens.ts is on the path', async () => {
    const tmp = await makeTempDir();
    try {
      expect(findProjectDir(tmp.dir)).toBeNull();
    } finally {
      await tmp.cleanup();
    }
  });

  it('exposes paths, config, sizes, locales and the manifest', () => {
    expect(project.dir).toBe(projectDir);
    expect(project.appDir).toBe(appDir);
    expect(project.screensPath).toBe(join(projectDir, 'screens.ts'));
    expect(project.themePath).toBe(join(projectDir, 'theme.ts'));
    expect(project.manifestPath).toBe(join(projectDir, 'manifest.json'));
    expect(project.templatesPath).toBeNull();
    expect(project.sizes).toEqual(['iphone-6.9', 'iphone-6.7', 'ipad-13', 'watch-s10']);
    expect(project.locales).toEqual(['en-US']);
    expect(project.sourceLocale).toBe('en-US');
    expect(project.screens.screens.map((s: ScreenDef) => s.id)).toEqual(['home', 'detail', 'pocket', 'tablet-split', 'glance']);
    expect(project.theme.background).toBe('#0b0f14');
    expect(project.theme.fonts.portable).toBe(true);
    expect(project.manifest.app.bundleId).toBe('com.example.basic');
    expect(project.copyPath('de-DE')).toBe(join(projectDir, 'copy', 'de-DE.json'));
  });

  it('copyFor loads the locale copy once and caches it', async () => {
    const first = await project.copyFor('en-US');
    const second = await project.copyFor('en-US');
    expect(first.locale).toBe('en-US');
    expect(Object.keys(first.screens)).toEqual(['home', 'details', 'pocket', 'tablet-split', 'glance']);
    expect(second).toBe(first);
  });

  it('loads a project from cwd when projectDir is omitted', async () => {
    const fromCwd = await loadProject({ cwd: appDir });
    expect(fromCwd.dir).toBe(projectDir);
  });
});

describe('buildMatrix: presets and ordinals', () => {
  it('renders every preset in project.sizes once, in order, with the 6.7" alias folded into 6.9"', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    expect(keys(items)).toEqual([
      'en-US/iphone-6.9/home',
      'en-US/iphone-6.9/detail',
      'en-US/iphone-6.9/pocket',
      'en-US/ipad-13/home',
      'en-US/ipad-13/detail',
      'en-US/ipad-13/tablet-split',
      'en-US/watch-s10/glance',
    ]);
    for (const item of items) {
      expect(item.preset.aliasOf).toBeUndefined();
      expect(item.locale).toBe('en-US');
      expect(item.key).toBe(`${item.locale}/${item.preset.id}/${item.screen.id}`);
      expect(item.url).toBe(renderRoute('en-US', item.preset.id, item.screen.id));
      expect(item.screen.sizeId).toBe(item.preset.id);
      expect(item.screen.locale).toBe('en-US');
    }
  });

  it('ordinals are 1-based and contiguous per size', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    expect(ordinalsFor(items, 'iphone-6.9')).toEqual([1, 2, 3]);
    expect(ordinalsFor(items, 'ipad-13')).toEqual([1, 2, 3]);
    expect(ordinalsFor(items, 'watch-s10')).toEqual([1]);
  });

  it('watch items are passthrough, everything else goes through the browser', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    expect(find(items, 'en-US/watch-s10/glance').passthrough).toBe(true);
    for (const item of items) {
      if (item.preset.id !== 'watch-s10') expect(item.passthrough).toBe(false);
    }
  });
});

describe('buildMatrix: output paths', () => {
  it('writes NN-<id>.png under out/<locale>/<displayType>/ with preview/NN-<id>.png beside it', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    const split = find(items, 'en-US/ipad-13/tablet-split');
    expect(split.ordinal).toBe(3);
    expect(split.outputs).toEqual([
      {
        sizeId: 'ipad-13',
        displayType: 'APP_IPAD_PRO_3GEN_129',
        outPath: join(outDir, 'APP_IPAD_PRO_3GEN_129', '03-tablet-split.png'),
        previewPath: join(outDir, 'APP_IPAD_PRO_3GEN_129', 'preview', '03-tablet-split.png'),
      },
    ]);
    const glance = find(items, 'en-US/watch-s10/glance');
    expect(must(glance.outputs[0]).outPath).toBe(join(outDir, 'APP_WATCH_SERIES_10', '01-glance.png'));
  });

  it('an alias adds a second output to its own display-type folder', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    const home = find(items, 'en-US/iphone-6.9/home');
    expect(home.outputs.map((o) => [o.sizeId, o.displayType])).toEqual([
      ['iphone-6.9', 'APP_IPHONE_69'],
      ['iphone-6.7', 'APP_IPHONE_67'],
    ]);
    expect(must(home.outputs[0]).outPath).toBe(join(outDir, 'APP_IPHONE_69', '01-home.png'));
    expect(must(home.outputs[0]).previewPath).toBe(join(outDir, 'APP_IPHONE_69', 'preview', '01-home.png'));
    expect(must(home.outputs[1]).outPath).toBe(join(outDir, 'APP_IPHONE_67', '01-home.png'));
    expect(must(home.outputs[1]).previewPath).toBe(join(outDir, 'APP_IPHONE_67', 'preview', '01-home.png'));
  });
});

describe('buildMatrix: filters', () => {
  it('sizes: only the requested sizes', () => {
    const items = buildMatrix(project, { locale: 'en-US', sizes: ['ipad-13'] });
    expect(keys(items)).toEqual(['en-US/ipad-13/home', 'en-US/ipad-13/detail', 'en-US/ipad-13/tablet-split']);
    for (const item of items) expect(item.outputs.map((o) => o.displayType)).toEqual(['APP_IPAD_PRO_3GEN_129']);
  });

  it('sizes: an alias alone renders as its target and exports only to APP_IPHONE_67', () => {
    const items = buildMatrix(project, { locale: 'en-US', sizes: ['iphone-6.7'] });
    expect(keys(items)).toEqual(['en-US/iphone-6.9/home', 'en-US/iphone-6.9/detail', 'en-US/iphone-6.9/pocket']);
    for (const item of items) {
      expect(item.preset.id).toBe('iphone-6.9');
      expect(item.outputs.map((o) => [o.sizeId, o.displayType])).toEqual([['iphone-6.7', 'APP_IPHONE_67']]);
      expect(must(item.outputs[0]).outPath.startsWith(join(outDir, 'APP_IPHONE_67'))).toBe(true);
    }
  });

  it('sizes: alias and target together render once with two outputs, in any order', () => {
    for (const sizes of [['iphone-6.7', 'iphone-6.9'], ['iphone-6.9', 'iphone-6.7']]) {
      const items = buildMatrix(project, { locale: 'en-US', sizes });
      expect(items).toHaveLength(3);
      const displayTypes = must(items[0]).outputs.map((o) => o.displayType).sort();
      expect(displayTypes).toEqual(['APP_IPHONE_67', 'APP_IPHONE_69']);
    }
  });

  it('sizes: an unknown id throws and names it', () => {
    expect(() => buildMatrix(project, { locale: 'en-US', sizes: ['iphone-7.0'] })).toThrow(/iphone-7\.0/);
  });

  it('screens: by id keeps the ordinal of the full set (NN stays stable when re-rendering one screen)', () => {
    const items = buildMatrix(project, { locale: 'en-US', screens: ['detail'] });
    expect(keys(items)).toEqual(['en-US/iphone-6.9/detail', 'en-US/ipad-13/detail']);
    expect(items.map((i) => i.ordinal)).toEqual([2, 2]);
    expect(must(must(items[0]).outputs[0]).outPath).toBe(join(outDir, 'APP_IPHONE_69', '02-detail.png'));
  });

  it('screens: by ordinal selects the Nth screen of each size', () => {
    const items = buildMatrix(project, { locale: 'en-US', screens: ['3'] });
    expect(keys(items)).toEqual(['en-US/iphone-6.9/pocket', 'en-US/ipad-13/tablet-split']);
  });

  it('screens: ids and ordinals mix', () => {
    const items = buildMatrix(project, { locale: 'en-US', screens: ['home', '3'] });
    expect(keys(items)).toEqual([
      'en-US/iphone-6.9/home',
      'en-US/iphone-6.9/pocket',
      'en-US/ipad-13/home',
      'en-US/ipad-13/tablet-split',
    ]);
  });

  it('sizes and screens combine', () => {
    const items = buildMatrix(project, { locale: 'en-US', sizes: ['ipad-13'], screens: ['tablet-split'] });
    expect(keys(items)).toEqual(['en-US/ipad-13/tablet-split']);
    expect(must(items[0]).ordinal).toBe(3);
  });
});

describe('buildMatrix: resolved screens', () => {
  it('applies family/size overrides per preset and attaches the locale copy', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    const phone = find(items, 'en-US/iphone-6.9/detail').screen;
    expect(phone.template).toBe('text-bottom');
    expect(phone.props).toEqual({ align: 'center', accentBar: false });
    expect(phone.captures.map((c) => c.requested)).toEqual(['detail-phone']);
    expect(phone.copyKey).toBe('details');
    expect(phone.copy?.headline).toEqual(['Time Every Lap', 'Automatically']);

    const pad = find(items, 'en-US/ipad-13/detail').screen;
    expect(pad.template).toBe('text-bottom');
    expect(pad.props).toEqual({ align: 'left', accentBar: true });
    expect(pad.captures.map((c) => c.requested)).toEqual(['detail-pad']);

    expect(find(items, 'en-US/watch-s10/glance').screen.template).toBe('raw');
    expect(find(items, 'en-US/iphone-6.9/home').screen.copy?.headline).toBe('See Every Ride');
  });

  it('missing captures resolve to placeholders (resolvedPath null, dims null)', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    const capture = must(find(items, 'en-US/iphone-6.9/home').screen.captures[0]);
    expect(capture).toMatchObject({
      requested: 'home',
      family: 'iphone',
      locale: 'en-US',
      fallback: 'placeholder',
      resolvedPath: null,
      dims: null,
    });
  });
});

describe('buildMatrix: panorama', () => {
  // The browser resolves the screen it draws with the whole config in hand, so
  // the item Node reports has to carry the same slice or the two disagree
  // about what the page shows.
  it('carries the slice of a project-level panorama into props.background', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9'],
          panorama: { image: 'assets/wide.png' },
          screens: [{ id: 'home' }, { id: 'track' }],
        },
      });
      const items = buildMatrix(await loadProject({ projectDir: dir }), { locale: 'en-US' });
      expect(items.map((item) => item.screen.props['background'])).toEqual([
        { type: 'panorama', src: 'assets/wide.png', index: 0, count: 2, offset: 0, width: 0.5 },
        { type: 'panorama', src: 'assets/wide.png', index: 1, count: 2, offset: 0.5, width: 0.5 },
      ]);
    } finally {
      await tmp.cleanup();
    }
  });
});
