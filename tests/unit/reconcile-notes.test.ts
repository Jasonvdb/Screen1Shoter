// What `s1s status` says beyond the three file columns. A status is a claim
// and a file is a fact, but the manifest also records things no column shows:
// an export the render order no longer agrees with, a dropped screen whose
// file still sits in the upload folder, copy that does not parse, and a render
// that failed. Asking about an orphan by name must work too.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDisplayType, ImageState, ProjectManifest, SizeId } from '../../src/config/types.ts';
import { makeWarning } from '../../src/config/warnings.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { reconcile, type ReconcileRow } from '../../src/core/reconcile.ts';
import { catchS1sError, makeTempDir, must, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import { makeFlatPng } from '../fixtures/make-set.ts';

const LOCALE = 'en-US';
const SIZE: SizeId = 'iphone-6.9';
const DISPLAY: AppDisplayType = 'APP_IPHONE_69';

/** A project whose manifest holds exactly `images`, keyed by screen id. */
async function makeProject(
  root: string,
  opts: { screens: string[]; images: Record<string, ImageState>; badCopy?: boolean },
): Promise<Project> {
  const projectDir = join(root, 'screenshots');
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
    locales: {
      [LOCALE]: { copyStatus: 'approved', captureSource: 'own', devices: { [SIZE]: { screens: opts.images } } },
    },
    runs: [],
  };
  await writeTempProject(projectDir, {
    screens: { sizes: [SIZE], screens: opts.screens.map((id) => ({ id })) },
    copies: {
      [LOCALE]: { locale: LOCALE, screens: Object.fromEntries(opts.screens.map((id) => [id, { headline: id }])) },
    },
    manifest,
  });
  if (opts.badCopy === true) await writeFile(join(projectDir, 'copy', `${LOCALE}.json`), '{ "screens": ');
  return loadProject({ projectDir });
}

/** Writes <root>/metadata/screenshots/en-US/APP_IPHONE_69/<name>. */
async function writeExport(root: string, name: string): Promise<string> {
  const dir = join(root, 'metadata', 'screenshots', LOCALE, DISPLAY);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, 'exported pixels');
  return path;
}

function rowFor(rows: readonly ReconcileRow[], screenId: string): ReconcileRow {
  return must(rows.find((row) => row.screenId === screenId), screenId);
}

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-reconcile-notes-');
});
afterEach(() => tmp.cleanup());

describe('reconcile: notes the columns cannot show', () => {
  it('notes an export whose file is not the one this ordinal exports to', async () => {
    await writeExport(tmp.dir, '03.png');
    const project = await makeProject(tmp.dir, {
      screens: ['home', 'detail'],
      images: {
        home: { status: 'exported', export: `../metadata/screenshots/${LOCALE}/${DISPLAY}/03.png` },
      },
    });

    const report = await reconcile(project, { locale: LOCALE });
    const home = rowFor(report.rows, 'home');
    expect(home.export).toBe('present');
    expect(home.notes.join('\n')).toContain('01.png');
    expect(home.notes.join('\n')).toContain('s1s export');
  });

  it('notes an orphan whose export file is still in the upload folder', async () => {
    const path = await writeExport(tmp.dir, '02.png');
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: {
        home: { status: 'pending' },
        gone: { status: 'exported', export: `../metadata/screenshots/${LOCALE}/${DISPLAY}/02.png` },
      },
    });

    const report = await reconcile(project, { locale: LOCALE });
    expect(report.orphans).toHaveLength(1);
    const orphan = must(report.orphans[0], 'orphan');
    expect(orphan.export).toBe('present');
    expect(orphan.notes.join('\n')).toContain(path);
    expect(orphan.notes.join('\n')).toContain('--prune');
    // The file is claimed by a manifest entry, so it is not a stray either.
    expect(report.strayExports).toEqual([]);
  });

  it('notes a copy file that does not parse', async () => {
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: { home: { status: 'pending' } },
      badCopy: true,
    });

    const report = await reconcile(project, { locale: LOCALE });
    expect(rowFor(report.rows, 'home').notes.join('\n')).toContain(`copy for ${LOCALE} cannot be read`);
  });

  it('notes an image that was uploaded and re-rendered since', async () => {
    const project = await makeProject(tmp.dir, {
      screens: ['home', 'detail'],
      images: {
        home: { status: 'generated', wasUploaded: true },
        detail: { status: 'generated' },
      },
    });

    const report = await reconcile(project, { locale: LOCALE });
    const note = rowFor(report.rows, 'home').notes.join('\n');
    expect(note).toContain('was uploaded');
    expect(note).toContain('re-rendered');
    expect(note).toContain('stale');
    expect(rowFor(report.rows, 'detail').notes.join('\n')).not.toContain('was uploaded');
  });

  it('notes an error-level render warning the status does not show', async () => {
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: { home: { status: 'captured', renderWarnings: [makeWarning('render-failed', 'browser timeout')] } },
    });
    // The status claims a capture, so the file has to be there for `ok`.
    await makeFlatPng(join(project.dir, 'captures', LOCALE, 'iphone', 'home.png'), { width: 4, height: 8 }, [9, 9, 9]);

    const report = await reconcile(project, { locale: LOCALE });
    const home = rowFor(report.rows, 'home');
    expect(home.status).toBe('captured');
    expect(home.notes.join('\n')).toContain('render-failed: browser timeout');
    // A recorded warning is not a missing file, so it does not flip ok.
    expect(report.ok).toBe(true);
  });
});

describe('reconcile: --screens on an orphan', () => {
  it('reports the orphan a screens.ts id can no longer name', async () => {
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: { home: { status: 'pending' }, gone: { status: 'exported' } },
    });

    const report = await reconcile(project, { locale: LOCALE, screens: ['gone'] });
    expect(report.rows).toEqual([]);
    expect(report.orphans.map((row) => row.screenId)).toEqual(['gone']);
  });

  it('still refuses a selector neither screens.ts nor the manifest knows', async () => {
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: { home: { status: 'pending' }, gone: { status: 'exported' } },
    });

    const error = await catchS1sError(reconcile(project, { locale: LOCALE, screens: ['nosuch'] }));
    expect(error.code).toBe('usage');
    expect(error.message).toContain('nosuch');
  });
});

describe('reconcile: the recorded hashes', () => {
  /** sha256 of the bytes writeExport() writes, so a matching entry is easy to build. */
  const EXPORTED_SHA = createHash('sha256').update('exported pixels').digest('hex');

  it('notes an export whose bytes no longer match exportSha256', async () => {
    const path = await writeExport(tmp.dir, '01.png');
    await writeFile(path, 'tampered pixels');
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: {
        home: {
          status: 'exported',
          export: `../metadata/screenshots/${LOCALE}/${DISPLAY}/01.png`,
          exportSha256: EXPORTED_SHA,
        },
      },
    });

    const report = await reconcile(project, { locale: LOCALE });
    const home = rowFor(report.rows, 'home');
    // The file is still there; only its contents moved on.
    expect(home.export).toBe('present');
    expect(home.notes.join('\n')).toContain('is stale');
    expect(home.notes.join('\n')).toContain('exportSha256');
  });

  it('says nothing when the exported bytes still match', async () => {
    await writeExport(tmp.dir, '01.png');
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: {
        home: {
          status: 'exported',
          export: `../metadata/screenshots/${LOCALE}/${DISPLAY}/01.png`,
          exportSha256: EXPORTED_SHA,
        },
      },
    });

    const report = await reconcile(project, { locale: LOCALE });
    const home = rowFor(report.rows, 'home');
    expect(home.export).toBe('present');
    expect(home.notes.join('\n')).not.toContain('exportSha256');
  });

  it('notes an export the manifest recorded without a sha', async () => {
    await writeExport(tmp.dir, '01.png');
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: {
        home: { status: 'exported', export: `../metadata/screenshots/${LOCALE}/${DISPLAY}/01.png` },
      },
    });

    const report = await reconcile(project, { locale: LOCALE });
    expect(rowFor(report.rows, 'home').notes.join('\n')).toContain('no exportSha256');
  });

  it('notes a capture edited since it was recorded', async () => {
    const project = await makeProject(tmp.dir, {
      screens: ['home'],
      images: {
        home: {
          status: 'captured',
          capture: `captures/${LOCALE}/iphone/home.png`,
          captureSha256: createHash('sha256').update('the recorded capture').digest('hex'),
        },
      },
    });
    const capturePath = join(project.dir, 'captures', LOCALE, 'iphone', 'home.png');
    await mkdir(dirname(capturePath), { recursive: true });
    await writeFile(capturePath, 'a different capture');

    const report = await reconcile(project, { locale: LOCALE });
    expect(rowFor(report.rows, 'home').notes.join('\n')).toContain('captureSha256');
  });
});
