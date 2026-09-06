// Browser-free parts of the render pipeline: the dry-run path of
// renderProject (matrix + node warnings + report) and the manifest
// bookkeeping rule in applyManifest.
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RenderItem, RenderReport, RenderReportItem, Warning } from '../../src/config/types.ts';
import { makeWarning } from '../../src/config/warnings.ts';
import { imageState, updateImage } from '../../src/core/manifest.ts';
import { buildMatrix } from '../../src/core/matrix.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { MAX_MANIFEST_RUNS, applyManifest, buildReport } from '../../src/render/bookkeeping.ts';
import { CALLOUTS_ELEMENT, calloutOverflow, renderProject } from '../../src/render/render.ts';
import { catchS1sError, fixtureProjectDir, makeTempDir, must, writeTempProject, type TempDir } from '../fixtures/helpers.ts';

let basic: Project;

beforeAll(async () => {
  basic = await loadProject({ projectDir: fixtureProjectDir('project-basic') });
});

const find = (report: RenderReport, key: string): RenderReportItem => must(report.items.find((i) => i.key === key), key);
const codes = (item: RenderReportItem): string[] => item.warnings.map((w) => w.code);

describe('renderProject dry run', () => {
  it('plans project-basic: 7 items, every one skipped with a capture-missing error, nothing written', async () => {
    const report = await renderProject(basic, { locale: 'en-US', dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.locale).toBe('en-US');
    expect(report.sizes).toEqual(['iphone-6.9', 'iphone-6.7', 'ipad-13', 'watch-s10']);
    expect(report.items).toHaveLength(7);
    expect(report.counts).toMatchObject({ rendered: 0, failed: 0, skipped: 7, errors: 7 });
    for (const item of report.items) {
      expect(item.status).toBe('skipped');
      expect(item.hash).toBeNull();
      expect(codes(item)).toContain('capture-missing');
      expect(codes(item)).not.toContain('copy-missing');
    }
    const watch = find(report, 'en-US/watch-s10/glance');
    expect(watch.template).toBe('raw');
    expect(watch.displayTypes).toEqual(['APP_WATCH_SERIES_10']);
    expect(find(report, 'en-US/iphone-6.9/home').displayTypes).toEqual(['APP_IPHONE_69', 'APP_IPHONE_67']);
    expect(find(report, 'en-US/iphone-6.9/home').outputs).toHaveLength(2);
  });

  describe('temp projects', () => {
    let tmp: TempDir;
    beforeEach(async () => {
      tmp = await makeTempDir();
    });
    afterEach(() => tmp.cleanup());

    it('copy-missing per item except raw; copy-unused only on items[0]', async () => {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9', 'watch-s10'],
          screens: [
            { id: 'home', only: ['iphone'] },
            { id: 'later', only: ['iphone'] },
            { id: 'glance', only: ['watch'] },
          ],
        },
        copies: { 'en-US': { locale: 'en-US', screens: { home: { headline: 'Hi' }, stray: { headline: 'Unused' } } } },
      });
      const project = await loadProject({ projectDir: dir });
      const report = await renderProject(project, { locale: 'en-US', dryRun: true, allowPlaceholder: true });
      expect(report.items.map((i) => i.key)).toEqual(['en-US/iphone-6.9/home', 'en-US/iphone-6.9/later', 'en-US/watch-s10/glance']);
      const [home, later, glance] = report.items;
      expect(codes(must(home))).toEqual(['capture-missing', 'copy-unused']);
      expect(must(home).warnings.find((w) => w.code === 'copy-unused')).toMatchObject({ level: 'info' });
      expect(must(home).warnings.find((w) => w.code === 'copy-unused')?.message).toContain('"stray"');
      expect(codes(must(later))).toEqual(['capture-missing', 'copy-missing']);
      expect(codes(must(glance))).toEqual(['capture-missing']);
      expect(report.counts).toMatchObject({ errors: 1, warns: 3, infos: 1 });
      expect(report.ok).toBe(false);
    });

    it('--strict promotes warn to error and flips report.ok', async () => {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['iphone-6.9'], screens: [{ id: 'home' }] },
        copies: { 'en-US': { locale: 'en-US', screens: { home: { headline: 'Hi' } } } },
      });
      const project = await loadProject({ projectDir: dir });
      const relaxed = await renderProject(project, { locale: 'en-US', dryRun: true, allowPlaceholder: true });
      expect(relaxed.ok).toBe(true);
      expect(relaxed.counts).toMatchObject({ errors: 0, warns: 1 });

      const strict = await renderProject(project, { locale: 'en-US', dryRun: true, allowPlaceholder: true, strict: true });
      expect(strict.ok).toBe(false);
      expect(strict.counts).toMatchObject({ errors: 1, warns: 0 });
      expect(must(strict.items[0]).warnings).toEqual([{ ...must(relaxed.items[0]).warnings[0], level: 'error' }]);
    });

    it('throws usage when the matrix is empty', async () => {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['iphone-6.9', 'ipad-13'], screens: [{ id: 'home', only: ['iphone'] }] },
      });
      const project = await loadProject({ projectDir: dir });
      const error = await catchS1sError(renderProject(project, { locale: 'en-US', dryRun: true, sizes: ['ipad-13'] }));
      expect(error.code).toBe('usage');
      expect(error.message).toContain('Nothing to render');
    });

    it('rejects an unknown size before touching the matrix', async () => {
      const error = await catchS1sError(renderProject(basic, { locale: 'en-US', dryRun: true, sizes: ['iphone-7.0'] }));
      expect(error.code).toBe('usage');
    });
  });
});

describe('applyManifest', () => {
  let items: RenderItem[];
  const bezel: Warning = makeWarning('bezel-fallback', 'generic frame');
  const unused: Warning = makeWarning('copy-unused', 'stray key');

  beforeAll(() => {
    items = buildMatrix(basic, { locale: 'en-US', sizes: ['iphone-6.9', 'iphone-6.7'], screens: ['home'] });
    expect(items).toHaveLength(1);
  });

  function result(item: RenderItem, patch: Partial<RenderReportItem>): RenderReportItem {
    return {
      key: item.key,
      locale: item.locale,
      sizeId: item.preset.id,
      displayTypes: item.outputs.map((o) => o.displayType),
      screenId: item.screen.id,
      ordinal: item.ordinal,
      template: item.screen.template,
      status: 'rendered',
      outputs: item.outputs.map((o) => o.outPath),
      preview: item.outputs[0]?.previewPath ?? null,
      hash: 'new',
      dims: item.preset.px,
      warnings: [],
      durationMs: 1,
      ...patch,
    };
  }

  const home69 = { locale: 'en-US', sizeId: 'iphone-6.9', screenId: 'home' } as const;
  const home67 = { locale: 'en-US', sizeId: 'iphone-6.7', screenId: 'home' } as const;

  it('hash change on an uploaded image: generated + wasUploaded, both alias folders, copy-unused filtered', () => {
    const manifest = updateImage(basic.manifest, home69, { status: 'uploaded', renderHash: 'old', uploadedAt: 't0' });
    const results = [result(must(items[0]), { warnings: [bezel, unused] })];
    const report = buildReport(basic, { locale: 'en-US' }, ['iphone-6.9', 'iphone-6.7'], results);
    const next = applyManifest({ dir: basic.dir, manifest }, { locale: 'en-US', sizes: ['iphone-6.9', 'iphone-6.7'] }, items, results, report, 't1');

    const state = must(imageState(next, 'en-US', 'iphone-6.9', 'home'));
    expect(state).toMatchObject({
      status: 'generated',
      wasUploaded: true,
      uploadedAt: 't0',
      renderHash: 'new',
      render: 'out/en-US/APP_IPHONE_69/01-home.png',
      renderWarnings: [bezel],
    });
    expect(typeof state.renderedAt).toBe('string');
    expect(imageState(next, 'en-US', 'iphone-6.7', 'home')).toMatchObject({
      status: 'generated',
      renderHash: 'new',
      render: 'out/en-US/APP_IPHONE_67/01-home.png',
    });
    expect(imageState(next, 'en-US', 'iphone-6.7', 'home')?.wasUploaded).toBeUndefined();
    expect(next.runs.at(-1)).toMatchObject({
      command: 'render --locale en-US --sizes iphone-6.9,iphone-6.7',
      startedAt: 't1',
      ok: true,
      notes: '1 rendered, 0 failed, 0 errors',
    });
    expect(basic.manifest).not.toBe(next);
  });

  it('same hash: status and renderedAt kept, warnings refreshed', () => {
    const manifest = updateImage(basic.manifest, home69, {
      status: 'image-approved',
      renderHash: 'new',
      renderedAt: 'before',
      renderWarnings: [bezel],
    });
    const results = [result(must(items[0]), { warnings: [] })];
    const report = buildReport(basic, { locale: 'en-US' }, ['iphone-6.9'], results);
    const next = applyManifest({ dir: basic.dir, manifest }, { locale: 'en-US' }, items, results, report, 't1');
    expect(imageState(next, 'en-US', 'iphone-6.9', 'home')).toMatchObject({
      status: 'image-approved',
      renderHash: 'new',
      renderedAt: 'before',
      renderWarnings: [],
    });
    expect(imageState(next, 'en-US', 'iphone-6.9', 'home')?.wasUploaded).toBeUndefined();
    // The alias folder had no state: it is created as generated.
    expect(imageState(next, 'en-US', 'iphone-6.7', 'home')?.status).toBe('generated');
  });

  it('failed item: render fields dropped, render-failed error appended, run not ok', () => {
    let manifest = updateImage(basic.manifest, home69, { status: 'generated', render: 'x', renderHash: 'h', renderedAt: 't' });
    manifest = updateImage(manifest, home67, { status: 'generated', render: 'y', renderHash: 'h', renderedAt: 't' });
    const results = [result(must(items[0]), { status: 'failed', hash: null, outputs: [], error: 'boom', warnings: [bezel] })];
    const report = buildReport(basic, { locale: 'en-US' }, ['iphone-6.9'], results);
    expect(report.ok).toBe(false);
    const next = applyManifest({ dir: basic.dir, manifest }, { locale: 'en-US' }, items, results, report, 't1');
    for (const ref of [home69, home67]) {
      const state = must(imageState(next, ref.locale, ref.sizeId, ref.screenId));
      expect(state.status).toBe('generated');
      expect(state).not.toHaveProperty('render');
      expect(state).not.toHaveProperty('renderHash');
      expect(state).not.toHaveProperty('renderedAt');
      expect(state.renderWarnings).toEqual([bezel, { code: 'render-failed', level: 'error', message: 'boom' }]);
    }
    expect(next.runs.at(-1)).toMatchObject({ ok: false, notes: '0 rendered, 1 failed, 0 errors' });
  });

  it(`keeps only the newest ${MAX_MANIFEST_RUNS} runs`, () => {
    const runs = Array.from({ length: MAX_MANIFEST_RUNS + 5 }, (_, i) => ({ command: `old ${i}`, startedAt: `t${i}` }));
    const manifest = { ...basic.manifest, runs };
    const results = [result(must(items[0]), {})];
    const report = buildReport(basic, { locale: 'en-US' }, ['iphone-6.9'], results);
    const next = applyManifest({ dir: basic.dir, manifest }, { locale: 'en-US' }, items, results, report, 't1');
    expect(next.runs).toHaveLength(MAX_MANIFEST_RUNS);
    expect(next.runs[0]?.command).toBe('old 6');
    expect(next.runs.at(-1)?.command).toBe('render --locale en-US');
  });
});

describe('buildReport', () => {
  it('counts statuses and warning levels; ok only without failures and errors', () => {
    const item = must(buildMatrix(basic, { locale: 'en-US', sizes: ['ipad-13'], screens: ['home'] })[0]);
    const base: RenderReportItem = {
      key: item.key,
      locale: 'en-US',
      sizeId: 'ipad-13',
      displayTypes: ['APP_IPAD_PRO_3GEN_129'],
      screenId: 'home',
      ordinal: 1,
      template: 'hero-top-text',
      status: 'rendered',
      outputs: [],
      preview: null,
      hash: 'h',
      dims: null,
      warnings: [makeWarning('bezel-fallback', 'w'), makeWarning('copy-unused', 'i')],
      durationMs: 0,
    };
    const ok = buildReport(basic, { locale: 'en-US', dryRun: true }, ['ipad-13'], [base, { ...base, status: 'passthrough' }]);
    expect(ok.counts).toEqual({ rendered: 2, failed: 0, skipped: 0, errors: 0, warns: 2, infos: 2 });
    expect(ok).toMatchObject({ ok: true, dryRun: true, version: 1, projectDir: basic.dir, sizes: ['ipad-13'] });

    const failed = buildReport(basic, { locale: 'en-US' }, ['ipad-13'], [{ ...base, status: 'failed', error: 'x' }]);
    expect(failed.counts).toMatchObject({ rendered: 0, failed: 1 });
    expect(failed.ok).toBe(false);

    const errored = buildReport(basic, { locale: 'en-US' }, ['ipad-13'], [{ ...base, warnings: [makeWarning('overflow', 'e')] }]);
    expect(errored.counts).toMatchObject({ errors: 1 });
    expect(errored.ok).toBe(false);
  });
});

describe('calloutOverflow', () => {
  const callouts = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `t${i}` }));
  it('is an overflow error on the callouts element when copy lists more callouts than feature-grid shows', () => {
    const warning = calloutOverflow({ locale: 'de-DE', screen: { template: 'feature-grid', copyKey: 'features', copy: { headline: 'h', callouts: callouts(4) } } });
    expect(warning).toMatchObject({ code: 'overflow', level: 'error', element: CALLOUTS_ELEMENT });
    expect(warning?.message).toBe('copy/de-DE.json screens.features.callouts has 4 entries; feature-grid shows at most 3');
  });

  it('is null for three callouts, for templates without a cap, and for missing copy', () => {
    expect(calloutOverflow({ locale: 'en-US', screen: { template: 'feature-grid', copyKey: 'f', copy: { headline: 'h', callouts: callouts(3) } } })).toBeNull();
    expect(calloutOverflow({ locale: 'en-US', screen: { template: 'hero-top-text', copyKey: 'f', copy: { headline: 'h', callouts: callouts(9) } } })).toBeNull();
    expect(calloutOverflow({ locale: 'en-US', screen: { template: 'feature-grid', copyKey: 'f', copy: undefined } })).toBeNull();
  });
});
