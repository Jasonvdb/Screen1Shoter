// End-to-end render of a copy of example/screenshots through Vite + Chromium:
// exact-size RGB PNGs, previews, report.json, review.md and manifest render
// fields. Needs Playwright's Chromium (`s1s doctor`). Bezels are optional:
// without them every item carries a warn-level bezel-fallback.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeExampleCaptures } from '../../example/screenshots/make-captures.ts';
import { linkProject } from '../../src/cli/commands/link.ts';
import { getPreset } from '../../src/config/presets.ts';
import type { RenderReport } from '../../src/config/types.ts';
import { imageState, readManifest } from '../../src/core/manifest.ts';
import { reportPath, reviewPath } from '../../src/core/paths.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { PREVIEW_SCALE } from '../../src/render/post.ts';
import { renderProject } from '../../src/render/render.ts';
import { copyExampleProject, makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

const SIZES = ['iphone-6.9', 'ipad-13'] as const;

describe('render example/ (smoke)', () => {
  let tmp: TempDir;
  let project: Project;
  let report: RenderReport;

  beforeAll(async () => {
    tmp = await makeTempDir('s1s-smoke-');
    const dir = await copyExampleProject(join(tmp.dir, 'Example', 'screenshots'));
    await writeExampleCaptures(dir);
    await linkProject(dir);
    project = await loadProject({ projectDir: dir });
    report = await renderProject(project, { locale: 'en-US', sizes: [...SIZES], sheet: false });
  });
  afterAll(() => tmp.cleanup());

  it('renders every item without failures or error-level warnings', () => {
    expect(report.items.map((i) => i.key)).toEqual([
      'en-US/iphone-6.9/home',
      'en-US/iphone-6.9/detail',
      'en-US/iphone-6.9/share',
      'en-US/ipad-13/home',
      'en-US/ipad-13/detail',
      'en-US/ipad-13/share',
    ]);
    const failures = report.items.filter((i) => i.status === 'failed').map((i) => `${i.key}: ${i.error ?? ''}`);
    expect(failures).toEqual([]);
    expect(report.counts.failed).toBe(0);
    expect(report.counts.errors).toBe(0);
    expect(report.ok).toBe(true);
    for (const item of report.items) {
      expect(item.status).toBe('rendered');
      expect(item.hash).toMatch(/^[0-9a-f]{40}$/);
      for (const w of item.warnings) expect(['bezel-fallback', 'font-fallback']).toContain(w.code);
    }
  });

  it('writes exact preset.px PNGs with 3 channels, no alpha, plus 1/3 previews', async () => {
    for (const item of report.items) {
      const preset = getPreset(item.sizeId);
      expect(item.dims).toEqual(preset.px);
      expect(item.outputs).toHaveLength(1);
      for (const out of item.outputs) {
        const meta = await sharp(out).metadata();
        expect([meta.width, meta.height], out).toEqual([preset.px.width, preset.px.height]);
        expect(meta.channels, out).toBe(3);
        expect(meta.hasAlpha, out).toBe(false);
      }
      const preview = await sharp(must(item.preview)).metadata();
      expect(preview.width).toBe(Math.round(preset.px.width * PREVIEW_SCALE));
      expect(preview.hasAlpha).toBe(false);
    }
  });

  it('writes report.json and review.md, and records the render in the manifest', async () => {
    const written = JSON.parse(await readFile(reportPath(project, 'en-US'), 'utf8')) as RenderReport;
    expect(written.ok).toBe(true);
    expect(written.items.map((i) => i.hash)).toEqual(report.items.map((i) => i.hash));
    expect(existsSync(reviewPath(project, 'en-US'))).toBe(true);
    const review = await readFile(reviewPath(project, 'en-US'), 'utf8');
    expect(review).toContain('Result: OK');
    expect(review).toContain('## iphone-6.9 (APP_IPHONE_69)');

    const manifest = await readManifest(project.manifestPath);
    for (const item of report.items) {
      const state = must(imageState(manifest, 'en-US', item.sizeId, item.screenId), item.key);
      expect(state.status).toBe('generated');
      expect(state.renderHash).toBe(item.hash);
      expect(state.render).toBe(`out/en-US/${item.displayTypes[0]}/${String(item.ordinal).padStart(2, '0')}-${item.screenId}.png`);
    }
    expect(manifest.runs.at(-1)?.command).toBe('render --locale en-US --sizes iphone-6.9,ipad-13');
  });

  it('re-rendering produces identical hashes', async () => {
    const again = await renderProject(project, { locale: 'en-US', sizes: [...SIZES], sheet: false });
    expect(again.ok).toBe(true);
    expect(again.items.map((i) => i.hash)).toEqual(report.items.map((i) => i.hash));
  });
});
