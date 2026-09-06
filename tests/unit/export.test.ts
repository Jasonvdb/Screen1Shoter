// s1s export: out/<locale>/<displayType>/NN-<id>.png becomes the app repo's
// metadata/screenshots/<locale>/<displayType>/NN.png. The rules that bite are
// the destination name, an alias writing the same bytes twice, not rewriting
// unchanged pixels, a --prune that may only ever delete NN.png / NN.jpg, a
// --dry-run that touches nothing, and the gate that refuses a broken render.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportText } from '../../src/cli/commands/export.ts';
import { getPreset, presetsFor } from '../../src/config/presets.ts';
import { exportFileName, renderFileName } from '../../src/config/resolve.ts';
import type {
  AppDisplayType,
  ImageState,
  ImageStatus,
  ManifestLocaleDevice,
  ProjectManifest,
  RenderReport,
  RenderReportItem,
  SizeId,
} from '../../src/config/types.ts';
import { makeWarning } from '../../src/config/warnings.ts';
import { sha256File, writeJsonAtomic } from '../../src/core/fs.ts';
import { imageState, readManifest } from '../../src/core/manifest.ts';
import { renderGroups } from '../../src/core/matrix.ts';
import { metadataDir, reportPath, sizeOutDir } from '../../src/core/paths.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { buildReport } from '../../src/render/bookkeeping.ts';
import { exportProject, type ExportFile, type ExportReport } from '../../src/render/export.ts';
import { catchS1sError, makeTempDir, must, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import { labelColour, makeFlatPng } from '../fixtures/make-set.ts';

const LOCALE = 'en-US';

async function sha1File(path: string): Promise<string> {
  return createHash('sha1').update(await readFile(path)).digest('hex');
}

interface ExportFixture {
  project: Project;
  /** The report `s1s render` left in out/<locale>/report.json. */
  report: RenderReport;
  /** Rewrites that report (the readiness gate reads it). */
  writeReport: (report: RenderReport) => Promise<void>;
  /** out/<locale>/<displayType>/NN-<id>.png */
  outPath: (displayType: AppDisplayType, ordinal: number, screenId: string) => string;
  /** <app>/metadata/screenshots/<locale>/<displayType>/NN.png */
  destPath: (displayType: AppDisplayType, ordinal: number) => string;
}

/**
 * A finished render on disk: one PNG per screen per display type (aliases get
 * a byte-identical copy, as render.ts writes them), report.json, and a
 * manifest whose images are `generated` with the real render hashes.
 */
async function makeExportFixture(
  root: string,
  opts: { sizes: SizeId[]; screens: string[]; status?: ImageStatus },
): Promise<ExportFixture> {
  const projectDir = join(root, 'screenshots');
  const presets = presetsFor(opts.sizes);
  const items: RenderReportItem[] = [];
  const hashes = new Map<string, string>();

  for (const { target, requested } of renderGroups(opts.sizes)) {
    for (const [index, screenId] of opts.screens.entries()) {
      const ordinal = index + 1;
      const fileName = renderFileName(ordinal, screenId);
      const outputs: string[] = [];
      for (const preset of requested) {
        const path = join(sizeOutDir({ dir: projectDir }, LOCALE, preset.displayType), fileName);
        const first = outputs[0];
        if (first === undefined) await makeFlatPng(path, target.px, labelColour(`${target.id}/${screenId}`));
        else {
          await mkdir(dirname(path), { recursive: true });
          await copyFile(first, path);
        }
        outputs.push(path);
      }
      const source = must(outputs[0], 'render output');
      const hash = await sha1File(source);
      for (const preset of requested) hashes.set(`${preset.id}/${screenId}`, hash);
      items.push({
        key: `${LOCALE}/${target.id}/${screenId}`,
        locale: LOCALE,
        sizeId: target.id,
        displayTypes: requested.map((preset) => preset.displayType),
        screenId,
        ordinal,
        template: 'hero-top-text',
        status: 'rendered',
        outputs,
        preview: null,
        hash,
        dims: target.px,
        warnings: [],
        durationMs: 12,
      });
    }
  }

  const devices: Partial<Record<SizeId, ManifestLocaleDevice>> = {};
  for (const preset of presets) {
    const screens: Record<string, ImageState> = {};
    for (const [index, screenId] of opts.screens.entries()) {
      screens[screenId] = {
        status: opts.status ?? 'generated',
        render: `out/${LOCALE}/${preset.displayType}/${renderFileName(index + 1, screenId)}`,
        renderHash: must(hashes.get(`${preset.id}/${screenId}`), 'render hash'),
      };
    }
    devices[preset.id] = { screens };
  }
  const families = [...new Set(presets.map((preset) => preset.family))];
  const manifest: ProjectManifest = {
    version: 1,
    app: {
      name: 'Basic',
      bundleId: 'com.example.basic',
      appId: '6001234567',
      deviceFamilies: families,
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
        versionString: '2.4.0',
        versionLocalizationId: 'b41d0c6a-loc',
        devices,
      },
    },
    runs: [],
  };

  await writeTempProject(projectDir, {
    screens: { sizes: opts.sizes, screens: opts.screens.map((id) => ({ id })) },
    copies: {
      [LOCALE]: { locale: LOCALE, screens: Object.fromEntries(opts.screens.map((id) => [id, { headline: id }])) },
    },
    manifest,
  });
  const project = await loadProject({ projectDir });
  const report = buildReport(project, { locale: LOCALE }, [...opts.sizes], items);
  const writeReport = async (next: RenderReport): Promise<void> => {
    await writeJsonAtomic(reportPath(project, LOCALE), next);
  };
  await writeReport(report);

  return {
    project,
    report,
    writeReport,
    outPath: (displayType, ordinal, screenId) =>
      join(sizeOutDir(project, LOCALE, displayType), renderFileName(ordinal, screenId)),
    destPath: (displayType, ordinal) =>
      join(metadataDir(project), LOCALE, displayType, exportFileName(ordinal)),
  };
}

function fileFor(report: ExportReport, displayType: AppDisplayType, screenId: string): ExportFile {
  return must(
    report.files.find((file) => file.displayType === displayType && file.screenId === screenId),
    `${displayType}/${screenId}`,
  );
}

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-export-');
});
afterEach(() => tmp.cleanup());

describe('exportProject', () => {
  it('copies NN-<id>.png to NN.png under metadata/screenshots/<locale>/<displayType>', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail', 'foo'] });
    const seen: ExportFile[] = [];
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false, onProgress: (file) => seen.push(file) });

    expect(report.version).toBe(1);
    expect(report.locale).toBe(LOCALE);
    expect(report.dryRun).toBe(false);
    expect(report.sizes).toEqual(['iphone-6.9']);
    expect(report.metadataDir).toBe(join(tmp.dir, 'metadata', 'screenshots'));
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
    expect(report.asc).toBeNull();
    expect(report.pruned).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.files).toHaveLength(3);

    const foo = fileFor(report, 'APP_IPHONE_69', 'foo');
    expect(foo.ordinal).toBe(3);
    expect(foo.sizeId).toBe('iphone-6.9');
    expect(foo.action).toBe('written');
    expect(foo.from).toBe(fx.outPath('APP_IPHONE_69', 3, 'foo'));
    expect(foo.to).toBe(join(tmp.dir, 'metadata', 'screenshots', 'en-US', 'APP_IPHONE_69', '03.png'));
    expect((await readFile(foo.to)).equals(await readFile(foo.from))).toBe(true);
    expect(foo.sha256).toBe(await sha256File(foo.to));

    expect(await readdir(dirname(foo.to))).toEqual(['01.png', '02.png', '03.png']);
    expect(seen.map((file) => file.to).sort()).toEqual(report.files.map((file) => file.to).sort());

    expect(report.uploadCommands).toHaveLength(1);
    const command = must(report.uploadCommands[0], 'upload command');
    expect(command).toContain('screenshots upload');
    expect(command).toContain('--device-type IPHONE_69');
  });

  it('resolves an app-relative metadataDir override against the app repo', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home'] });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false, metadataDir: 'store/shots' });

    expect(report.metadataDir).toBe(join(tmp.dir, 'store', 'shots'));
    expect(report.files).toHaveLength(1);
    expect(must(report.files[0], 'file').to).toBe(join(tmp.dir, 'store', 'shots', 'en-US', 'APP_IPHONE_69', '01.png'));
    expect(existsSync(join(tmp.dir, 'store', 'shots', 'en-US', 'APP_IPHONE_69', '01.png'))).toBe(true);
    expect(existsSync(join(tmp.dir, 'metadata'))).toBe(false);
  });

  it('writes an alias size into both display-type folders with the same bytes', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9', 'iphone-6.7'], screens: ['home', 'detail'] });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });

    expect(report.sizes).toEqual(['iphone-6.9', 'iphone-6.7']);
    expect(report.files).toHaveLength(4);

    const nine = fileFor(report, 'APP_IPHONE_69', 'home');
    const seven = fileFor(report, 'APP_IPHONE_67', 'home');
    expect(nine.sizeId).toBe('iphone-6.9');
    expect(seven.sizeId).toBe('iphone-6.7');
    expect(seven.to).toBe(fx.destPath('APP_IPHONE_67', 1));
    expect(seven.from).toBe(fx.outPath('APP_IPHONE_67', 1, 'home'));
    expect(seven.sha256).toBe(nine.sha256);
    expect((await readFile(seven.to)).equals(await readFile(nine.to))).toBe(true);
    expect(await readdir(dirname(seven.to))).toEqual(['01.png', '02.png']);

    expect(report.uploadCommands).toHaveLength(2);
    expect(report.uploadCommands.join('\n')).toContain('--device-type IPHONE_67');

    const manifest = await readManifest(fx.project.manifestPath);
    const aliasState = must(imageState(manifest, LOCALE, 'iphone-6.7', 'home'), 'alias image state');
    expect(aliasState.status).toBe('exported');
    expect(aliasState.storeFileName).toBe('01.png');
    expect(must(imageState(manifest, LOCALE, 'iphone-6.9', 'home'), 'state').status).toBe('exported');
  });

  it('reports unchanged and leaves the file alone on a second export of the same pixels', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    const first = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(first.files).toHaveLength(2);
    expect(first.files.map((file) => file.action)).toEqual(['written', 'written']);

    const dest = fileFor(first, 'APP_IPHONE_69', 'home').to;
    const pinned = new Date('2020-01-02T03:04:05.000Z');
    await utimes(dest, pinned, pinned);

    const second = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(second.files).toHaveLength(2);
    expect(second.files.map((file) => file.action)).toEqual(['unchanged', 'unchanged']);
    expect(second.ok).toBe(true);
    expect((await stat(dest)).mtimeMs).toBe(pinned.getTime());
    expect(fileFor(second, 'APP_IPHONE_69', 'home').sha256).toBe(fileFor(first, 'APP_IPHONE_69', 'home').sha256);
  });

  it('prunes only NN.png / NN.jpg past the end of the set, and only with --prune', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail', 'foo'] });
    const first = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(first.files).toHaveLength(3);
    const setDir = dirname(fileFor(first, 'APP_IPHONE_69', 'home').to);

    // Leftovers of a longer set, plus files an export must never touch.
    await makeFlatPng(join(setDir, '04.png'), getPreset('iphone-6.9').px, [10, 20, 30]);
    await writeFile(join(setDir, '05.jpg'), 'stale jpeg');
    await writeFile(join(setDir, '1.png'), 'one digit, not a set file');
    await writeFile(join(setDir, 'cover.png'), 'cover art');
    await writeFile(join(setDir, 'notes.txt'), 'hand notes');
    await writeFile(join(setDir, '.DS_Store'), 'finder');
    await mkdir(join(setDir, 'old'), { recursive: true });
    await writeFile(join(setDir, 'old', '06.png'), 'archived');

    const kept = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(kept.pruned).toEqual([]);
    expect(existsSync(join(setDir, '04.png'))).toBe(true);

    const pruned = await exportProject(fx.project, { locale: LOCALE, asc: false, prune: true });
    expect([...pruned.pruned].sort()).toEqual([join(setDir, '04.png'), join(setDir, '05.jpg')].sort());
    expect((await readdir(setDir)).sort()).toEqual(
      ['.DS_Store', '01.png', '02.png', '03.png', '1.png', 'cover.png', 'notes.txt', 'old'].sort(),
    );
    expect(existsSync(join(setDir, 'old', '06.png'))).toBe(true);
    expect(pruned.ok).toBe(true);
  });

  it('refuses a report with a failed item and writes nothing', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    const [first, ...rest] = fx.report.items;
    const broken: RenderReportItem = { ...must(first, 'item'), status: 'failed', hash: null, error: 'browser timeout' };
    await fx.writeReport(buildReport(fx.project, { locale: LOCALE }, ['iphone-6.9'], [broken, ...rest]));

    const error = await catchS1sError(exportProject(fx.project, { locale: LOCALE, asc: false }));
    expect(error.code).toBe('export-blocked');
    expect(typeof error.hint).toBe('string');
    expect(existsSync(join(tmp.dir, 'metadata'))).toBe(false);
  });

  it('refuses a report with an error-level warning and writes nothing', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    const [first, ...rest] = fx.report.items;
    const flagged: RenderReportItem = {
      ...must(first, 'item'),
      warnings: [makeWarning('text-clipped', 'the headline is clipped')],
    };
    const report = buildReport(fx.project, { locale: LOCALE }, ['iphone-6.9'], [flagged, ...rest]);
    expect(report.counts.errors).toBe(1);
    await fx.writeReport(report);

    const error = await catchS1sError(exportProject(fx.project, { locale: LOCALE, asc: false }));
    expect(error.code).toBe('export-blocked');
    expect(existsSync(join(tmp.dir, 'metadata'))).toBe(false);
  });

  it('--dry-run writes no file and does not touch manifest.json', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    const manifestBefore = await readFile(fx.project.manifestPath);
    const pinned = new Date('2020-01-02T03:04:05.000Z');
    await utimes(fx.project.manifestPath, pinned, pinned);

    const report = await exportProject(fx.project, { locale: LOCALE, asc: false, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.files).toHaveLength(2);
    expect(report.metadataDir).toBe(join(tmp.dir, 'metadata', 'screenshots'));

    expect(existsSync(join(tmp.dir, 'metadata'))).toBe(false);
    expect((await readFile(fx.project.manifestPath)).equals(manifestBefore)).toBe(true);
    expect((await stat(fx.project.manifestPath)).mtimeMs).toBe(pinned.getTime());
  });

  it('records status exported, the export path, its sha256 and storeFileName', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });
    expect(report.files).toHaveLength(2);

    const manifest = await readManifest(fx.project.manifestPath);
    for (const file of report.files) {
      const state = must(imageState(manifest, LOCALE, file.sizeId, file.screenId), file.screenId);
      expect(state.status).toBe('exported');
      expect(state.storeFileName).toBe(basename(file.to));
      expect(state.exportSha256).toBe(file.sha256);
      expect(state.exportSha256).toBe(await sha256File(file.to));
      // Recorded like `capture` and `render`: a posix path relative to the project dir.
      expect(resolve(fx.project.dir, must(state.export, 'export path'))).toBe(file.to);
      expect(state.renderHash).toBe(must(imageState(fx.project.manifest, LOCALE, file.sizeId, file.screenId)).renderHash);
    }
    expect(must(imageState(manifest, LOCALE, 'iphone-6.9', 'detail')).storeFileName).toBe('02.png');
  });
});

// asc-upload.md section 7 is the default upload: one command per display type,
// --path naming exactly one folder, --version-localization naming one locale's
// set, --dry-run first. Section 8's fan-out (--path = the export root, asc
// walks every locale and picks files by pixel size) is the exception.
describe('exportProject: the upload commands it prints', () => {
  it('prints the per-localization form with --dry-run, and the fan-out form only as the multi-locale case', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });

    expect(report.uploadCommands).toEqual([
      'asc screenshots upload --version-localization b41d0c6a-loc ' +
        '--path metadata/screenshots/en-US/APP_IPHONE_69 --device-type IPHONE_69 --dry-run --pretty',
    ]);
    expect(report.fanOutCommands).toEqual([
      'asc screenshots upload --app 6001234567 --version 2.4.0 ' +
        '--path metadata/screenshots --device-type IPHONE_69 --dry-run --pretty',
    ]);
    for (const command of [...report.uploadCommands, ...report.fanOutCommands]) {
      expect(command).toContain('--dry-run');
      // A --replace with no --dry-run is the command that ships pixels nobody read.
      expect(command.includes('--replace') && !command.includes('--dry-run')).toBe(false);
    }

    const text = exportText(fx.project, report);
    expect(text).toContain(must(report.uploadCommands[0], 'upload command'));
    expect(text).toContain('section 7');
    expect(text).toContain('section 8');
  });

  it('suppresses the fan-out form when this export warned about duplicate dims', async () => {
    // APP_IPHONE_69 and APP_IPHONE_67 are both 1320x2868: a fan-out run sends
    // both folders into one set.
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9', 'iphone-6.7'], screens: ['home'] });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false });

    expect(report.warnings.map((warning) => warning.code)).toContain('duplicate-dims');
    expect(report.fanOutCommands).toEqual([]);
    expect(report.uploadCommands).toEqual([
      'asc screenshots upload --version-localization b41d0c6a-loc ' +
        '--path metadata/screenshots/en-US/APP_IPHONE_69 --device-type IPHONE_69 --dry-run --pretty',
      'asc screenshots upload --version-localization b41d0c6a-loc ' +
        '--path metadata/screenshots/en-US/APP_IPHONE_67 --device-type IPHONE_67 --dry-run --pretty',
    ]);

    const text = exportText(fx.project, report);
    expect(text).not.toContain('--path metadata/screenshots --device-type');
    expect(text).toContain('duplicate-dims');
  });

  it('points --path at the metadata dir the export actually used', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home'] });
    const report = await exportProject(fx.project, { locale: LOCALE, asc: false, metadataDir: 'store/shots' });

    expect(must(report.uploadCommands[0], 'upload command')).toContain('--path store/shots/en-US/APP_IPHONE_69 ');
    expect(must(report.fanOutCommands[0], 'fan-out command')).toContain('--path store/shots ');
  });
});

describe('exportProject: manifest runs', () => {
  it('appends exactly one runs entry with its command line and notes', async () => {
    const fx = await makeExportFixture(tmp.dir, { sizes: ['iphone-6.9'], screens: ['home', 'detail'] });
    await exportProject(fx.project, { locale: LOCALE, asc: false, sizes: ['iphone-6.9'], prune: true });

    const first = await readManifest(fx.project.manifestPath);
    expect(first.runs).toHaveLength(1);
    const run = must(first.runs[0], 'run');
    expect(run.command).toBe('export --locale en-US --sizes iphone-6.9 --prune');
    expect(run.notes).toBe('2 written, 0 unchanged, 0 pruned');
    expect(run.ok).toBe(true);
    expect(Date.parse(run.startedAt)).not.toBeNaN();
    expect(Date.parse(must(run.finishedAt, 'finishedAt'))).not.toBeNaN();

    // A second export appends one more entry; a dry run appends none.
    await exportProject(fx.project, { locale: LOCALE, asc: false });
    await exportProject(fx.project, { locale: LOCALE, asc: false, dryRun: true });

    const after = await readManifest(fx.project.manifestPath);
    expect(after.runs).toHaveLength(2);
    const second = must(after.runs[1], 'second run');
    expect(second.command).toBe('export --locale en-US');
    expect(second.notes).toBe('0 written, 2 unchanged, 0 pruned');
  });
});
