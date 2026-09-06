// s1s status: reconciles screenshots/manifest.json against what is actually
// on disk. A row per in-scope image with the state of its capture, render and
// export; entries screens.ts no longer knows become orphans instead of rows;
// exported files nothing claims become strayExports. `--set` goes through the
// transition guard, so an illegal status change never reaches the file.
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureRelPath, exportFileName, renderFileName } from '../../src/config/resolve.ts';
import type { AppDisplayType, Dims, ImageState, ManifestLocaleDevice, ProjectManifest, SizeId } from '../../src/config/types.ts';
import { sha256File } from '../../src/core/fs.ts';
import { imageState, readManifest } from '../../src/core/manifest.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { reconcile, type ReconcileReport, type ReconcileRow } from '../../src/core/reconcile.ts';
import { makeTempDir, must, parseJsonLine, runS1s, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import { labelColour, makeFlatPng } from '../fixtures/make-set.ts';

const LOCALE = 'en-US';
const SIZE: SizeId = 'iphone-6.9';
const DISPLAY: AppDisplayType = 'APP_IPHONE_69';
/** Reconcile compares presence and hashes, never pixel sizes: keep the fixtures small. */
const SMALL: Dims = { width: 64, height: 64 };

async function sha1File(path: string): Promise<string> {
  return createHash('sha1').update(await readFile(path)).digest('hex');
}

interface OrphanEntry {
  sizeId: SizeId;
  screenId: string;
  state: ImageState;
}

interface ReconcileFixture {
  project: Project;
  capturePath: (screenId: string) => string;
  renderPath: (ordinal: number, screenId: string) => string;
  exportPath: (ordinal: number) => string;
  exportDir: string;
}

/**
 * A project whose every screen has a capture and a render on disk, the listed
 * screens also an export, and a manifest that records all of it with the real
 * hashes. Extra manifest entries land verbatim, so a test can plant one for a
 * screen or a size screens.ts does not have.
 */
async function makeReconcileFixture(
  root: string,
  opts: { screens: string[]; exported?: readonly string[]; orphans?: readonly OrphanEntry[] },
): Promise<ReconcileFixture> {
  const projectDir = join(root, 'screenshots');
  const exportDir = join(root, 'metadata', 'screenshots', LOCALE, DISPLAY);
  const exported = new Set(opts.exported ?? []);
  const screens: Record<string, ImageState> = {};

  for (const [index, screenId] of opts.screens.entries()) {
    const ordinal = index + 1;
    const captureRel = captureRelPath(LOCALE, 'iphone', screenId);
    const renderRel = `out/${LOCALE}/${DISPLAY}/${renderFileName(ordinal, screenId)}`;
    const capture = await makeFlatPng(join(projectDir, captureRel), SMALL, labelColour(`capture/${screenId}`));
    const render = await makeFlatPng(join(projectDir, renderRel), SMALL, labelColour(`render/${screenId}`));
    const state: ImageState = {
      status: exported.has(screenId) ? 'exported' : 'generated',
      capture: captureRel,
      captureSha256: await sha256File(capture),
      render: renderRel,
      renderHash: await sha1File(render),
    };
    if (exported.has(screenId)) {
      const file = await makeFlatPng(join(exportDir, exportFileName(ordinal)), SMALL, labelColour(`render/${screenId}`));
      // Project-relative posix, like `capture` and `render` (manifest-schema.md).
      state.export = `../metadata/screenshots/${LOCALE}/${DISPLAY}/${exportFileName(ordinal)}`;
      state.exportSha256 = await sha256File(file);
      state.storeFileName = exportFileName(ordinal);
    }
    screens[screenId] = state;
  }

  const devices: Partial<Record<SizeId, ManifestLocaleDevice>> = { [SIZE]: { screens } };
  for (const orphan of opts.orphans ?? []) {
    const device = devices[orphan.sizeId] ?? { screens: {} };
    device.screens[orphan.screenId] = orphan.state;
    devices[orphan.sizeId] = device;
  }

  const manifest: ProjectManifest = {
    version: 1,
    app: {
      name: 'Basic',
      bundleId: 'com.example.basic',
      deviceFamilies: ['iphone'],
      sourceLocale: LOCALE,
      appLocales: [LOCALE],
      metadataDir: 'metadata/screenshots',
    },
    sizes: {},
    screens: [],
    locales: { [LOCALE]: { copyStatus: 'approved', captureSource: 'own', devices } },
    runs: [],
  };

  await writeTempProject(projectDir, {
    screens: { sizes: [SIZE], screens: opts.screens.map((id) => ({ id })) },
    copies: {
      [LOCALE]: { locale: LOCALE, screens: Object.fromEntries(opts.screens.map((id) => [id, { headline: id }])) },
    },
    manifest,
  });

  return {
    project: await loadProject({ projectDir }),
    capturePath: (screenId) => join(projectDir, captureRelPath(LOCALE, 'iphone', screenId)),
    renderPath: (ordinal, screenId) => join(projectDir, 'out', LOCALE, DISPLAY, renderFileName(ordinal, screenId)),
    exportPath: (ordinal) => join(exportDir, exportFileName(ordinal)),
    exportDir,
  };
}

function rowFor(report: ReconcileReport, screenId: string): ReconcileRow {
  return must(report.rows.find((row) => row.screenId === screenId), screenId);
}

const total = (summary: Record<string, number>): number => Object.values(summary).reduce((a, b) => a + b, 0);

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-reconcile-');
});
afterEach(() => tmp.cleanup());

describe('reconcile', () => {
  it('reports one row per in-scope image with the state of each file', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home', 'detail'], exported: ['home'] });
    const report = await reconcile(fx.project);

    expect(report.version).toBe(1);
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
    expect(report.locales).toEqual([LOCALE]);
    expect(report.rows).toHaveLength(2);

    expect(rowFor(report, 'home')).toMatchObject({
      locale: LOCALE,
      sizeId: SIZE,
      displayType: DISPLAY,
      screenId: 'home',
      ordinal: 1,
      status: 'exported',
      capture: 'present',
      render: 'present',
      export: 'present',
      renderStale: false,
    });
    expect(rowFor(report, 'detail')).toMatchObject({
      ordinal: 2,
      status: 'generated',
      capture: 'present',
      render: 'present',
      export: 'none',
      renderStale: false,
    });

    expect(report.orphans).toEqual([]);
    expect(report.strayExports).toEqual([]);
    expect(report.summary['exported']).toBe(1);
    expect(report.summary['generated']).toBe(1);
    expect(total(report.summary)).toBe(2);
    expect(report.ok).toBe(true);
  });

  it('puts a manifest entry whose screen or size left screens.ts in orphans, not rows', async () => {
    const fx = await makeReconcileFixture(tmp.dir, {
      screens: ['home'],
      orphans: [
        { sizeId: SIZE, screenId: 'retired', state: { status: 'uploaded', storeFileName: '04.png' } },
        { sizeId: 'iphone-6.5', screenId: 'home', state: { status: 'uploaded', storeFileName: '01.png' } },
      ],
    });
    const report = await reconcile(fx.project);

    expect(report.rows.map((row) => row.screenId)).toEqual(['home']);
    expect(report.orphans).toHaveLength(2);

    const retired = must(report.orphans.find((row) => row.screenId === 'retired'), 'retired orphan');
    expect(retired.sizeId).toBe(SIZE);
    expect(retired.ordinal).toBe(0);
    expect(retired.status).toBe('uploaded');

    const droppedSize = must(report.orphans.find((row) => row.sizeId === 'iphone-6.5'), 'iphone-6.5 orphan');
    expect(droppedSize.screenId).toBe('home');
    expect(droppedSize.ordinal).toBe(0);

    // The summary counts rows only.
    expect(total(report.summary)).toBe(1);
    expect(report.summary['generated']).toBe(1);
  });

  it('marks a render that is no longer on disk as missing', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home', 'detail'] });
    await rm(fx.renderPath(2, 'detail'));

    const report = await reconcile(fx.project);
    expect(rowFor(report, 'home').render).toBe('present');
    const detail = rowFor(report, 'detail');
    expect(detail.render).toBe('missing');
    expect(detail.renderStale).toBe(false);
    expect(detail.notes.join(' ')).not.toBe('');
    expect(report.ok).toBe(false);
  });

  it('marks a render whose bytes changed as stale', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home', 'detail'] });
    const path = fx.renderPath(1, 'home');
    const before = await sha1File(path);
    await makeFlatPng(path, SMALL, [200, 10, 90]);
    expect(await sha1File(path)).not.toBe(before);

    const report = await reconcile(fx.project);
    const home = rowFor(report, 'home');
    expect(home.render).toBe('present');
    expect(home.renderStale).toBe(true);
    expect(rowFor(report, 'detail').renderStale).toBe(false);
  });

  it('lists an exported file no manifest entry claims in strayExports', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home'], exported: ['home'] });
    const stray = await makeFlatPng(join(fx.exportDir, '07.png'), SMALL, [1, 2, 3]);

    const report = await reconcile(fx.project);
    expect(report.strayExports).toContain(stray);
    expect(report.strayExports).not.toContain(fx.exportPath(1));
    expect(rowFor(report, 'home').export).toBe('present');
  });

  it('restricts the rows to the requested screens', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home', 'detail'] });
    const report = await reconcile(fx.project, { locale: LOCALE, sizes: [SIZE], screens: ['detail'] });

    expect(report.rows).toHaveLength(1);
    expect(must(report.rows[0], 'row').screenId).toBe('detail');
    expect(must(report.rows[0], 'row').ordinal).toBe(2);
  });
});

// The contract asked for a pure `--set` function in src/core/reconcile.ts.
// The implementation put the guard inside `s1s status --set` instead, so the
// rule is exercised through the command: it is all-or-nothing, and a refusal
// must not touch manifest.json.
describe('s1s status --set', () => {
  it('applies a legal forward transition', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home', 'detail'], exported: ['detail'] });
    const run = await runS1s(
      ['status', '--set', 'uploaded', '--locale', LOCALE, '--sizes', SIZE, '--screens', 'detail', '--json'],
      { cwd: tmp.dir },
    );
    expect(run.code, run.stderr).toBe(0);

    const manifest = await readManifest(fx.project.manifestPath);
    const detail = must(imageState(manifest, LOCALE, SIZE, 'detail'), 'detail');
    expect(detail.status).toBe('uploaded');
    expect(detail.renderHash).toBe(must(imageState(fx.project.manifest, LOCALE, SIZE, 'detail'), 'detail').renderHash);
    expect(detail.storeFileName).toBe('02.png');
    expect(must(imageState(manifest, LOCALE, SIZE, 'home'), 'home').status).toBe('generated');
  });

  it('refuses an illegal transition with usage and leaves manifest.json byte-identical', async () => {
    const fx = await makeReconcileFixture(tmp.dir, { screens: ['home', 'detail'], exported: ['detail'] });
    const bytes = await readFile(fx.project.manifestPath);

    // 'home' (generated) could reach image-approved; 'exported' cannot go back to it.
    const run = await runS1s(
      ['status', '--set', 'image-approved', '--locale', LOCALE, '--sizes', SIZE, '--screens', 'home,detail', '--json'],
      { cwd: tmp.dir },
    );
    expect(run.code).toBe(2);

    const json = parseJsonLine<{ ok: boolean; error: { code: string; message: string; hint: string | null } }>(run);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('usage');
    expect(json.error.message).toContain('image-approved');
    expect(json.error.message).toContain('exported');
    expect(typeof json.error.hint).toBe('string');
    expect((await readFile(fx.project.manifestPath)).equals(bytes)).toBe(true);
  });
});
