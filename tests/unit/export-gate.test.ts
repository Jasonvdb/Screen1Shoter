// The gate `s1s export` puts in front of an upload, and what it leaves behind
// in the destination folder. Every case here ships wrong pixels to App Store
// Connect when it regresses: a report that describes part of the set, a set
// file the run did not write, a screen that left screens.ts, a temp file a
// hard kill left in the upload folder, and a locale that is a path.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportText } from '../../src/cli/commands/export.ts';
import { renderFileName } from '../../src/config/resolve.ts';
import type {
  AppDisplayType,
  Dims,
  ImageState,
  ImageStatus,
  ProjectManifest,
  RenderReportItem,
  SizeId,
} from '../../src/config/types.ts';
import { writeJsonAtomic } from '../../src/core/fs.ts';
import { imageState, readManifest } from '../../src/core/manifest.ts';
import { metadataDir, reportPath, sizeOutDir } from '../../src/core/paths.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { buildReport } from '../../src/render/bookkeeping.ts';
import { exportProject } from '../../src/render/export.ts';
import { catchS1sError, makeTempDir, must, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import { labelColour, makeFlatPng } from '../fixtures/make-set.ts';

const LOCALE = 'en-US';
const SIZE: SizeId = 'iphone-6.9';
const DISPLAY: AppDisplayType = 'APP_IPHONE_69';
/** Export copies bytes and never reads pixels, so the fixture PNGs stay tiny. */
const TINY: Dims = { width: 4, height: 8 };

/** One item of the render report: which screen sits at which position. */
interface ReportScreen {
  screenId: string;
  ordinal: number;
}

interface Fixture {
  project: Project;
  /** <app>/metadata/screenshots/en-US/APP_IPHONE_69 */
  setDir: string;
}

/**
 * A finished render of one display type: the PNGs, out/<locale>/report.json
 * and a manifest whose images carry `status`. `report` defaults to the screens
 * of screens.ts in order; passing it lets a test build the report a
 * `--screens` render writes when it has none to carry.
 */
async function makeFixture(
  root: string,
  opts: {
    screens: string[];
    report?: ReportScreen[];
    status?: ImageStatus;
    state?: Partial<ImageState>;
    /** Leave out app.appId, versionString and versionLocalizationId: the manifest nobody filled in. */
    incomplete?: boolean;
  },
): Promise<Fixture> {
  const projectDir = join(root, 'screenshots');
  const reported = opts.report ?? opts.screens.map((screenId, index) => ({ screenId, ordinal: index + 1 }));

  const items: RenderReportItem[] = [];
  const screens: Record<string, ImageState> = {};
  for (const { screenId, ordinal } of reported) {
    const out = join(sizeOutDir({ dir: projectDir }, LOCALE, DISPLAY), renderFileName(ordinal, screenId));
    await makeFlatPng(out, TINY, labelColour(screenId));
    items.push({
      key: `${LOCALE}/${SIZE}/${screenId}`,
      locale: LOCALE,
      sizeId: SIZE,
      displayTypes: [DISPLAY],
      screenId,
      ordinal,
      template: 'hero-top-text',
      status: 'rendered',
      outputs: [out],
      preview: null,
      hash: `hash-${screenId}`,
      dims: TINY,
      warnings: [],
      durationMs: 5,
    });
    screens[screenId] = {
      status: opts.status ?? 'image-approved',
      render: `out/${LOCALE}/${DISPLAY}/${renderFileName(ordinal, screenId)}`,
      renderHash: `hash-${screenId}`,
      ...opts.state,
    };
  }

  const manifest: ProjectManifest = {
    version: 1,
    app: {
      name: 'Basic',
      bundleId: 'com.example.basic',
      ...(opts.incomplete ? {} : { appId: '6001234567' }),
      deviceFamilies: ['iphone'],
      sourceLocale: LOCALE,
      appLocales: [LOCALE],
      metadataDir: 'metadata/screenshots',
    },
    sizes: {},
    screens: [],
    locales: {
      [LOCALE]: {
        copyStatus: 'approved',
        captureSource: 'own',
        ...(opts.incomplete ? {} : { versionString: '2.4.0', versionLocalizationId: 'b41d0c6a-loc' }),
        devices: { [SIZE]: { screens } },
      },
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

  const project = await loadProject({ projectDir });
  await writeJsonAtomic(reportPath(project, LOCALE), buildReport(project, { locale: LOCALE }, [SIZE], items));
  return { project, setDir: join(metadataDir(project), LOCALE, DISPLAY) };
}

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-export-gate-');
});
afterEach(() => tmp.cleanup());

describe('exportProject: the readiness gate', () => {
  it('refuses a report whose ordinals do not run from 01, instead of renaming screen 4 to 01.png', async () => {
    const fx = await makeFixture(tmp.dir, {
      screens: ['home', 'detail', 'plan', 'hero'],
      // What `s1s render --screens hero` writes with no previous report to carry.
      report: [{ screenId: 'hero', ordinal: 4 }],
    });

    const error = await catchS1sError(exportProject(fx.project, { locale: LOCALE, asc: false }));
    expect(error.code).toBe('export-blocked');
    expect(error.message).toContain('01.png');
    expect(error.message).toContain('04');
    expect(must(error.hint, 'hint')).toContain('--screens');
    expect(existsSync(fx.setDir)).toBe(false);
  });

  it('refuses a report that repeats an ordinal', async () => {
    const fx = await makeFixture(tmp.dir, {
      screens: ['home', 'detail', 'plan'],
      report: [
        { screenId: 'home', ordinal: 1 },
        { screenId: 'detail', ordinal: 2 },
        { screenId: 'plan', ordinal: 2 },
      ],
    });

    const error = await catchS1sError(exportProject(fx.project, { locale: LOCALE, asc: false }));
    expect(error.code).toBe('export-blocked');
    expect(existsSync(fx.setDir)).toBe(false);
  });

  it('refuses a set of more than 10 screens', async () => {
    const screens = Array.from({ length: 11 }, (_, index) => `screen${index + 1}`);
    const fx = await makeFixture(tmp.dir, { screens });

    const error = await catchS1sError(exportProject(fx.project, { locale: LOCALE, asc: false }));
    expect(error.code).toBe('export-blocked');
    expect(error.message).toContain('at most 10');
    expect(existsSync(fx.setDir)).toBe(false);
  });

  it('rejects a locale that is a path', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home'] });
    const error = await catchS1sError(exportProject(fx.project, { locale: '../../shared', asc: false, prune: true }));
    expect(error.code).toBe('usage');
    expect(error.exitCode).toBe(2);
  });
});

describe('exportProject: the destination folder', () => {
  it('--prune deletes 00.png and a same-ordinal file in another extension', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home', 'detail'] });
    await mkdir(fx.setDir, { recursive: true });
    await writeFile(join(fx.setDir, '00.png'), 'ordinal zero');
    await writeFile(join(fx.setDir, '01.jpg'), 'same ordinal, other extension');
    await writeFile(join(fx.setDir, '09.png'), 'left over from a longer set');
    await writeFile(join(fx.setDir, 'cover.png'), 'not a set file');

    const report = await exportProject(fx.project, { locale: LOCALE, asc: false, prune: true });
    expect(report.pruned.map((path) => path.replace(`${fx.setDir}/`, ''))).toEqual(['00.png', '01.jpg', '09.png']);
    expect((await readdir(fx.setDir)).sort()).toEqual(['01.png', '02.png', 'cover.png']);
  });

  it('lists set files it did not write when --prune is off', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home', 'detail'] });
    await mkdir(fx.setDir, { recursive: true });
    await writeFile(join(fx.setDir, '03.png'), 'a screen that was retired');

    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(report.stale).toEqual([join(fx.setDir, '03.png')]);
    expect(report.pruned).toEqual([]);
    expect(exportText(fx.project, report)).toContain('--prune');
    // Reported, never deleted: only --prune deletes.
    expect(existsSync(join(fx.setDir, '03.png'))).toBe(true);

    const pruned = await exportProject(fx.project, { locale: LOCALE, asc: false, prune: true });
    expect(pruned.stale).toEqual([]);
    expect(pruned.pruned).toEqual([join(fx.setDir, '03.png')]);
  });

  it('writes its temp file dot-prefixed, where asc and s1s validate skip it', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home'] });
    // A directory in the temp file's place fails the copy and names the path.
    const tmpPath = join(fx.setDir, `.01.png.${process.pid}.tmp`);
    await mkdir(tmpPath, { recursive: true });

    await expect(exportProject(fx.project, { locale: LOCALE, asc: false })).rejects.toThrow(/\.01\.png\./);
    expect(existsSync(join(fx.setDir, '01.png'))).toBe(false);
  });
});

describe('exportProject: what it tells the human', () => {
  it('warns when the report still holds a screen screens.ts dropped', async () => {
    // 'gone' left screens.ts after the render; out/report.json still has it.
    const fx = await makeFixture(tmp.dir, {
      screens: ['home', 'detail'],
      report: [
        { screenId: 'home', ordinal: 1 },
        { screenId: 'detail', ordinal: 2 },
        { screenId: 'gone', ordinal: 3 },
      ],
    });

    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });
    const dropped = must(
      report.warnings.find((warning) => warning.message.includes('no longer in screens.ts')),
      'dropped-screen warning',
    );
    expect(dropped.code).toBe('manifest-incomplete');
    expect(dropped.message).toContain('03-gone');
  });

  it('flags wasUploaded when a re-export repoints an uploaded image', async () => {
    const fx = await makeFixture(tmp.dir, {
      screens: ['home', 'detail'],
      status: 'uploaded',
      state: { export: `../metadata/screenshots/${LOCALE}/${DISPLAY}/09.png`, exportSha256: 'stale', storeFileName: '09.png' },
    });

    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(report.files).toHaveLength(2);

    const manifest = await readManifest(fx.project.manifestPath);
    const state = must(imageState(manifest, LOCALE, SIZE, 'home'), 'home state');
    // The status machine refuses uploaded -> exported, so the status stays.
    expect(state.status).toBe('uploaded');
    expect(state.storeFileName).toBe('01.png');
    expect(state.wasUploaded).toBe(true);
  });

  it('exports a screen that is not image-approved and says so at warn level', async () => {
    // 'generated' is the render straight out of `s1s render`: nobody looked at it yet.
    const fx = await makeFixture(tmp.dir, { screens: ['home', 'detail'], status: 'generated' });

    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });
    const warning = must(
      report.warnings.find((entry) => entry.code === 'export-unapproved'),
      'export-unapproved warning',
    );
    expect(warning.level).toBe('warn');
    expect(warning.message).toContain(DISPLAY);
    expect(warning.message).toContain('01-home (generated)');
    expect(warning.message).toContain('02-detail (generated)');

    // Advisory only: the human review gate stays the human's, so the files land
    // and the run still passes.
    expect(report.ok).toBe(true);
    expect(report.files).toHaveLength(2);
    expect(existsSync(join(fx.setDir, '01.png'))).toBe(true);
    expect(exportText(fx.project, report)).toContain('not image-approved');

    const manifest = await readManifest(fx.project.manifestPath);
    expect(must(imageState(manifest, LOCALE, SIZE, 'home'), 'home state').status).toBe('exported');
  });

  it('warns and prints a placeholder for every id the manifest is missing', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home'], incomplete: true });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });

    const fields = report.warnings.filter((entry) => entry.code === 'manifest-incomplete').map((entry) => entry.message);
    expect(fields).toHaveLength(3);
    expect(fields.every((message) => message.includes('placeholder'))).toBe(true);
    expect(fields.join('\n')).toContain(`locales.${LOCALE}.versionLocalizationId`);
    expect(fields.join('\n')).toContain('app.appId');
    expect(fields.join('\n')).toContain(`locales.${LOCALE}.versionString`);
    expect(report.warnings.every((entry) => entry.level === 'warn')).toBe(true);
    expect(report.ok).toBe(true);

    expect(must(report.uploadCommands[0], 'upload command')).toContain("--version-localization '<VERSION_LOCALIZATION_ID>'");
    expect(must(report.fanOutCommands[0], 'fan-out command')).toContain("--app '<APP_ID>' --version '<VERSION>'");
    // Quoted, because a bare <APP_ID> pasted into a shell is a redirection.
    expect([...report.uploadCommands, ...report.fanOutCommands].join('\n')).not.toMatch(/[ =]<[A-Z_]+>/);
  });
});

/**
 * The asc branch, driven by a stub `asc` on PATH. Nothing here runs the real
 * asc, and `--dry-run` must not even reach for it: the folders still hold the
 * previous export, so validating them would report on pixels this run planned
 * to replace.
 */
describe('exportProject: asc validation', () => {
  let realPath: string | undefined;

  beforeEach(() => {
    realPath = process.env['PATH'];
  });
  afterEach(() => {
    if (realPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = realPath;
  });

  interface AscStub {
    /** One line per invocation: the arguments it was called with. */
    calls: () => Promise<string[]>;
  }

  /** Puts a fake `asc` first on PATH: it logs every call and answers from a canned report. */
  async function stubAsc(dir: string, opts: { report: unknown; exitCode: number }): Promise<AscStub> {
    await mkdir(dir, { recursive: true });
    const log = join(dir, 'calls.log');
    const reportPath = join(dir, 'report.json');
    await writeFile(reportPath, JSON.stringify(opts.report));
    await writeFile(
      join(dir, 'asc'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
        'if [ "$1" = "--version" ]; then echo 1.2.2; exit 0; fi',
        `cat ${JSON.stringify(reportPath)}`,
        `exit ${opts.exitCode}`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    process.env['PATH'] = `${dir}${delimiter}${process.env['PATH'] ?? ''}`;
    return {
      calls: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((line) => line.length > 0),
    };
  }

  it('flips report.ok and names the issues when asc validation fails', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home', 'detail'] });
    const stub = await stubAsc(join(tmp.dir, 'bin-fail'), {
      exitCode: 1,
      report: {
        errorCount: 1,
        warningCount: 0,
        issues: [{ severity: 'error', fileName: '01.png', message: 'wrong dimensions 4x8, expected 1320x2868' }],
      },
    });

    const report = await exportProject(fx.project, { locale: LOCALE });
    const results = must(report.asc, 'asc results');
    expect(results).toHaveLength(1);
    const result = must(results[0], 'asc result');
    expect(result.ok).toBe(false);
    expect(result.command).toContain('--device-type IPHONE_69');
    expect(report.ok).toBe(false);

    const validate = must(
      (await stub.calls()).find((line) => line.startsWith('screenshots validate')),
      'asc validate call',
    );
    expect(validate).toContain(`--path ${fx.setDir}`);
    expect(validate).toContain('--output json');

    const text = exportText(fx.project, report);
    expect(text).toContain('FAILED');
    expect(text).toContain('asc validation failed');
    expect(text).toContain('error 01.png: wrong dimensions 4x8, expected 1320x2868');

    // asc failing fails the report, never the copy: the files are on disk either way.
    expect(existsSync(join(fx.setDir, '01.png'))).toBe(true);
  });

  it('--dry-run runs asc not at all', async () => {
    const fx = await makeFixture(tmp.dir, { screens: ['home'] });
    const stub = await stubAsc(join(tmp.dir, 'bin-ok'), { exitCode: 0, report: { errorCount: 0, warningCount: 0, issues: [] } });

    const planned = await exportProject(fx.project, { locale: LOCALE, dryRun: true });
    expect(planned.asc).toBeNull();
    expect(await stub.calls()).toEqual([]);

    // Same stub, same PATH: the real run does reach it, so the assertion above
    // is about --dry-run and not about a stub nobody could find.
    const done = await exportProject(fx.project, { locale: LOCALE });
    expect(must(done.asc, 'asc results')).toHaveLength(1);
    expect(must(done.asc?.[0], 'asc result').ok).toBe(true);
    expect(done.ok).toBe(true);
    expect((await stub.calls()).filter((line) => line.startsWith('screenshots validate'))).toHaveLength(1);
  });
});
