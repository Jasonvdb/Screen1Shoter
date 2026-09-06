// A watch item skips the browser only when its template draws nothing: `raw`
// is a passthrough, `watch-caption` is not. The second half checks that the
// browser path the non-raw watch items now take really lands on 416x496, so
// postProcess accepts what Chromium hands it.
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import { defineTheme, type Dims, type RenderItem, type SizeId } from '../../src/config/types.ts';
import { buildMatrix, isPassthroughItem } from '../../src/core/matrix.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { postProcess } from '../../src/render/post.ts';
import { fixtureProjectDir, must } from '../fixtures/helpers.ts';

const watch = SIZE_PRESETS['watch-s10'];
const iphone69 = SIZE_PRESETS['iphone-6.9'];
const ipad13 = SIZE_PRESETS['ipad-13'];

/** The fixture's only watch screen; it takes the family default template. */
const WATCH_SCREEN = 'glance';
const WATCH_KEY = `en-US/watch-s10/${WATCH_SCREEN}`;

let project: Project;

beforeAll(async () => {
  project = await loadProject({ projectDir: fixtureProjectDir('project-basic') });
});

/**
 * The fixture project with the watch screen re-templated. loadProject refuses
 * templates that template-meta.ts still marks unimplemented, so the matrix is
 * built from a patched config: this test is about the passthrough rule, not
 * about which phase has shipped which template.
 */
function withWatchTemplate(template: string): Project {
  return {
    ...project,
    screens: {
      ...project.screens,
      screens: project.screens.screens.map((screen) => (screen.id === WATCH_SCREEN ? { ...screen, template } : screen)),
    },
  };
}

const find = (items: RenderItem[], key: string): RenderItem => must(items.find((i) => i.key === key), key);

describe('isPassthroughItem', () => {
  it('is true only for the watch preset rendering `raw`', () => {
    expect(isPassthroughItem(watch, 'raw', false)).toBe(true);
    expect(isPassthroughItem(watch, 'watch-caption', false)).toBe(false);
    expect(isPassthroughItem(watch, 'hero-top-text', false)).toBe(false);
  });

  it('is false for every preset that is not flagged passthrough, `raw` included', () => {
    for (const id of Object.keys(SIZE_PRESETS) as SizeId[]) {
      const preset = SIZE_PRESETS[id];
      if (preset.passthrough === true) continue;
      expect(isPassthroughItem(preset, 'raw', false), id).toBe(false);
      expect(isPassthroughItem(preset, 'hero-top-text', false), id).toBe(false);
    }
  });

  // templates/index.ts may export a template whose id is `raw`, and the
  // registry replaces the built-in with it. Node cannot evaluate that file, so
  // a project that ships one loses the passthrough shortcut rather than
  // shipping the capture where the author expected their own module.
  it('is false on the watch once the project ships a template entry file', () => {
    expect(isPassthroughItem(watch, 'raw', true)).toBe(false);
  });
});

describe('buildMatrix: the watch render path', () => {
  it('marks a watch screen with the default template (raw) as passthrough', () => {
    const items = buildMatrix(project, { locale: 'en-US' });
    const glance = find(items, WATCH_KEY);
    expect(glance.screen.template).toBe('raw');
    expect(glance.passthrough).toBe(true);
  });

  it('routes the same screen through the browser once its template is watch-caption', () => {
    const items = buildMatrix(withWatchTemplate('watch-caption'), { locale: 'en-US' });
    const glance = find(items, WATCH_KEY);
    expect(glance.screen.template).toBe('watch-caption');
    expect(glance.passthrough).toBe(false);
    // The browser needs a route and the watch preset to render at.
    expect(glance.url).toBe(`/#/render/en-US/watch-s10/${WATCH_SCREEN}`);
    expect(glance.preset.id).toBe('watch-s10');
  });

  it('sends the same watch screen through the browser when the project has templates/index.ts', () => {
    const withTemplates: Project = { ...project, templatesPath: join(project.dir, 'templates', 'index.tsx') };
    const glance = find(buildMatrix(withTemplates, { locale: 'en-US' }), WATCH_KEY);
    expect(glance.screen.template).toBe('raw');
    expect(glance.passthrough).toBe(false);
  });

  it('never marks an iPhone or iPad item passthrough, whatever its template', () => {
    for (const template of ['raw', 'hero-top-text']) {
      const items = buildMatrix(withWatchTemplate(template), { locale: 'en-US' });
      for (const item of items) {
        if (item.preset.family === 'watch') continue;
        expect(item.passthrough, item.key).toBe(false);
      }
    }
  });
});

/** Opaque PNG of `dims`, standing in for the bytes Chromium returns. */
async function pngOf(dims: Dims): Promise<Buffer> {
  return sharp({ create: { width: dims.width, height: dims.height, channels: 4, background: '#1c1c1e' } })
    .png()
    .toBuffer();
}

describe('watch-s10 through the browser', () => {
  it('has a pt/scale pair a Chromium context can render: 416x496 @1 = 416x496 px', () => {
    // contextFor() sets viewport = pt and deviceScaleFactor = scale, and a
    // `scale: "device"` screenshot is therefore pt * scale.
    expect(watch.pt).toEqual({ width: 416, height: 496 });
    expect(watch.scale).toBe(1);
    expect({ width: watch.pt.width * watch.scale, height: watch.pt.height * watch.scale }).toEqual(watch.px);
    expect(watch.px).toEqual({ width: 416, height: 496 });
  });

  it('passes the postProcess dimension check with browser-shaped bytes', async () => {
    const theme = defineTheme({ background: '#101014', accent: '#6c8cff', text: '#ffffff' });
    const processed = await postProcess(await pngOf(watch.px), watch, theme);
    expect(processed.dims).toEqual({ width: 416, height: 496 });
    expect((await sharp(processed.png).metadata()).channels).toBe(3);
  });

  it('shares the pt * scale = px rule with the framed presets', () => {
    for (const preset of [watch, iphone69, ipad13]) {
      expect({ width: preset.pt.width * preset.scale, height: preset.pt.height * preset.scale }, preset.id).toEqual(preset.px);
    }
  });
});
