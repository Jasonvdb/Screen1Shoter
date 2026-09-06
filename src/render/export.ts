// `s1s export`: copy a finished render into the folders App Store Connect
// uploads from, `<metadataDir>/<locale>/<APP_DISPLAY_TYPE>/NN.png`.
//
// The render report (out/<locale>/report.json) is the only source of truth for
// what exists: it already names every display-type copy of every item, so an
// alias size (`iphone-6.7` renders as `iphone-6.9`) lands in both folders
// without re-deriving anything from the presets.
//
// Export is the last gate before an upload, so it refuses on anything Apple
// would reject (a failed item, an error-level warning, a missing PNG, a set
// the report describes only in part or one longer than ten) and only
// warns on the things a human still owns (image approval, an appId nobody
// filled in, a sibling folder with identical pixel sizes).
import { copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ALL_SIZE_IDS, displayTypesShareDims, getPreset, isSizeId, presetByDisplayType } from '../config/presets.ts';
import { EXPORT_FILE_RE, exportFileName, exportOrdinal, formatOrdinal } from '../config/resolve.ts';
import type {
  AppDisplayType,
  ImageState,
  ManifestRun,
  ProjectManifest,
  RenderReport,
  RenderReportItem,
  SizeId,
  SizePreset,
  Warning,
} from '../config/types.ts';
import { makeWarning } from '../config/warnings.ts';
import { ascValidateScreenshots, findAsc, type AscValidateResult } from '../core/asc.ts';
import { S1sError } from '../core/errors.ts';
import { formatCommand } from '../core/exec.ts';
import { errorMessage, isFile, readJsonFile, sha256File } from '../core/fs.ts';
import { appendRun, canTransition, imageState, updateImage, writeManifest } from '../core/manifest.ts';
import { assertLocaleSegment, exportDir, metadataDir, reportPath, toPosix } from '../core/paths.ts';
import type { Project } from '../core/project.ts';
import { MAX_SET_FILES, duplicateDimsMessage } from './validate.ts';

/**
 * 'unchanged' when the destination already holds these exact bytes.
 * 'skipped' is reserved for a file the export deliberately leaves alone; the
 * current rules never produce it (a source it cannot copy blocks the run).
 */
export type ExportAction = 'written' | 'unchanged' | 'skipped';

export interface ExportFile {
  /** The requested size id (may be an alias such as 'iphone-6.7'). */
  sizeId: SizeId;
  displayType: AppDisplayType;
  screenId: string;
  /** 1-based within the set, contiguous, in report order. */
  ordinal: number;
  /** Absolute: out/<locale>/<displayType>/NN-<id>.png */
  from: string;
  /** Absolute: <metadataDir>/<locale>/<displayType>/NN.png */
  to: string;
  sha256: string;
  action: ExportAction;
}

export interface ExportOptions {
  locale: string;
  /** Size ids; default: every size the render report has items for. */
  sizes?: string[];
  /** Absolute or app-relative override of manifest.app.metadataDir. */
  metadataDir?: string;
  /** Delete NN.png / NN.jpg beyond the exported count in each set. */
  prune?: boolean;
  /** Plan everything, touch nothing (no files, no manifest, no asc). */
  dryRun?: boolean;
  /** Default true: run `asc screenshots validate` per size when asc is on PATH. */
  asc?: boolean;
  onProgress?: (file: ExportFile) => void;
}

export interface ExportReport {
  version: 1;
  generatedAt: string;
  locale: string;
  /** Absolute. */
  metadataDir: string;
  sizes: SizeId[];
  dryRun: boolean;
  files: ExportFile[];
  /** Absolute paths deleted by --prune (planned deletions on a dry run). */
  pruned: string[];
  /**
   * Absolute paths of set files this run did not write and --prune did not
   * delete. They still upload, so a shrunk set ships retired screenshots.
   */
  stale: string[];
  warnings: Warning[];
  /** One result per display type, in the order the display types appear in `files`. */
  asc: AscValidateResult[] | null;
  /**
   * The per-localization upload commands (asc-upload.md section 7), one per
   * display type, each with `--dry-run`.
   */
  uploadCommands: string[];
  /**
   * The multi-locale fan-out form (section 8), one per display type, each with
   * `--dry-run`. Empty when this export warned about duplicate dims: the
   * fan-out selects files by pixel size, so a sibling folder doubles the set.
   */
  fanOutCommands: string[];
  ok: boolean;
}

/** One display type of one run: its preset, its items and its destination folder. */
interface ExportSet {
  sizeId: SizeId;
  preset: SizePreset;
  displayType: AppDisplayType;
  dir: string;
  items: RenderReportItem[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The render report, or `export-blocked` naming the render that must run first. */
async function readRenderReport(project: Pick<Project, 'dir'>, locale: string): Promise<RenderReport> {
  const path = reportPath(project, locale);
  const hint = `Run \`s1s render --locale ${locale}\` first.`;
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch (error) {
    throw new S1sError('export-blocked', `Cannot read ${path}: ${errorMessage(error)}`, { hint });
  }
  if (raw === undefined) {
    throw new S1sError('export-blocked', `No render report at ${path}.`, { hint });
  }
  const report = raw as Partial<RenderReport>;
  if (report.version !== 1 || !Array.isArray(report.items) || typeof report.locale !== 'string') {
    throw new S1sError('export-blocked', `${path} is not a render report.`, { hint });
  }
  if (report.dryRun === true) {
    throw new S1sError('export-blocked', `${path} comes from a dry run; no PNGs were written.`, {
      hint: `Run \`s1s render --locale ${locale}\` without --dry-run.`,
    });
  }
  return report as RenderReport;
}

/** Every size id the report has items for, in first-seen order. */
function reportSizeIds(report: RenderReport): SizeId[] {
  const ids: SizeId[] = [];
  for (const item of report.items) {
    for (const displayType of item.displayTypes) {
      const sizeId = presetByDisplayType(displayType)?.id;
      if (sizeId !== undefined && !ids.includes(sizeId)) ids.push(sizeId);
    }
  }
  return ids;
}

function resolveSizes(report: RenderReport, requested: readonly string[] | undefined): SizeId[] {
  if (!requested || requested.length === 0) {
    const sizes = reportSizeIds(report);
    if (sizes.length === 0) {
      throw new S1sError('export-blocked', `${reportPath({ dir: report.projectDir }, report.locale)} lists no rendered sizes.`, {
        hint: `Run \`s1s render --locale ${report.locale}\` first.`,
      });
    }
    return sizes;
  }
  const out: SizeId[] = [];
  for (const id of requested) {
    if (!isSizeId(id)) {
      throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function buildSets(report: RenderReport, sizes: readonly SizeId[], root: string, locale: string): ExportSet[] {
  return sizes.map((sizeId) => {
    const preset = getPreset(sizeId);
    const displayType = preset.displayType;
    return {
      sizeId,
      preset,
      displayType,
      dir: exportDir(root, locale, displayType),
      items: report.items.filter((item) => item.displayTypes.includes(displayType)),
    };
  });
}

// ---------------------------------------------------------------------------
// Readiness gate
// ---------------------------------------------------------------------------

function itemLabel(item: RenderReportItem): string {
  return `${formatOrdinal(item.ordinal)}-${item.screenId}`;
}

/** The source PNG of one item for one display type, or null when the report has no copy for it. */
function sourceFor(item: RenderReportItem, displayType: AppDisplayType): string | null {
  const index = item.displayTypes.indexOf(displayType);
  return index < 0 ? null : (item.outputs[index] ?? null);
}

/**
 * Everything that must be fixed before an upload: a report that does not
 * describe the whole set (its ordinals must run 1..N, because the destination
 * name comes from the position), more than MAX_SET_FILES screens, a failed
 * item, an error-level warning, or a PNG the report names but disk does not
 * have. Returns one line per offending screen so the message names them all.
 */
async function blockingProblems(set: ExportSet): Promise<string[]> {
  if (set.items.length === 0) {
    return [`${set.sizeId}: the render report has no items for ${set.displayType}`];
  }
  const problems: string[] = [];
  if (set.items.length > MAX_SET_FILES) {
    problems.push(
      `${set.sizeId}: the report has ${set.items.length} items for ${set.displayType}; App Store Connect takes at most ${MAX_SET_FILES} per set`,
    );
  }
  let expected = 0;
  for (const item of set.items) {
    expected += 1;
    const label = `${set.sizeId} ${itemLabel(item)}`;
    // The destination name comes from the position in the set, so a report
    // that covers only part of it (a `--screens` render with no previous
    // report to carry) would ship screen 4 as 01.png.
    if (item.ordinal !== expected) {
      problems.push(
        `${label}: it would be written as ${exportFileName(expected)}, but the report gives it ordinal ${formatOrdinal(item.ordinal)}; the report does not describe the whole set`,
      );
    }
    if (item.status === 'failed') {
      problems.push(`${label}: render failed${item.error ? `: ${item.error}` : ''}`);
      continue;
    }
    for (const warning of item.warnings) {
      if (warning.level === 'error') problems.push(`${label}: ${warning.code}: ${warning.message}`);
    }
    const source = sourceFor(item, set.displayType);
    if (source === null) {
      // A 'skipped' item has no outputs at all: exporting around it would ship
      // a set with a screen missing and every later ordinal shifted.
      problems.push(`${label}: not rendered (status ${item.status}); the report lists no ${set.displayType} output`);
    } else if (!(await isFile(source))) {
      problems.push(`${label}: ${source} is missing`);
    }
  }
  return problems;
}

async function assertReady(sets: readonly ExportSet[], locale: string): Promise<void> {
  const problems: string[] = [];
  for (const set of sets) problems.push(...(await blockingProblems(set)));
  if (problems.length === 0) return;
  throw new S1sError('export-blocked', `${problems.length} problem(s) block the export:\n${problems.map((p) => `  - ${p}`).join('\n')}`, {
    hint: `Fix the screens above and re-run \`s1s render --locale ${locale}\` (without --screens, so the report covers the whole set), then export again.`,
  });
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/**
 * Temp file + rename, so a crash never leaves a half-written NN.png in the
 * upload folder. The temp name is dot-prefixed: a hard kill (SIGKILL runs no
 * catch block) leaves a file `asc`, `s1s validate` and `s1s status` all skip,
 * instead of one that blocks every later upload.
 */
async function copyAtomic(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  const tmp = join(dirname(to), `.${basename(to)}.${process.pid}.tmp`);
  try {
    await copyFile(from, tmp);
    await rename(tmp, to);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function exportSet(set: ExportSet, opts: ExportOptions): Promise<ExportFile[]> {
  const files: ExportFile[] = [];
  let ordinal = 0;
  for (const item of set.items) {
    const from = sourceFor(item, set.displayType);
    if (from === null) continue;
    ordinal += 1;
    const to = join(set.dir, exportFileName(ordinal));
    const sha256 = await sha256File(from);
    const unchanged = (await isFile(to)) && (await sha256File(to)) === sha256;
    if (!unchanged && !opts.dryRun) await copyAtomic(from, to);
    const file: ExportFile = {
      sizeId: set.sizeId,
      displayType: set.displayType,
      screenId: item.screenId,
      ordinal,
      from,
      to,
      sha256,
      action: unchanged ? 'unchanged' : 'written',
    };
    files.push(file);
    opts.onProgress?.(file);
  }
  return files;
}

/**
 * Set files (`NN.png` / `NN.jpg` / `NN.jpeg`) the run did not write: a
 * leftover of a longer set, a `00.png`, or the same ordinal in another
 * extension (`01.jpg` beside this run's `01.png`, which uploads in an order
 * nobody chose). Subfolders, other names and dotfiles are left alone.
 */
async function staleFiles(set: ExportSet, written: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(set.dir, { withFileTypes: true }).catch(() => []);
  const stale: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (exportOrdinal(entry.name) === null || written.has(entry.name)) continue;
    stale.push(join(set.dir, entry.name));
  }
  return stale.sort();
}

/** `--prune`: delete exactly the stale set files. */
async function pruneSet(set: ExportSet, written: ReadonlySet<string>, dryRun: boolean): Promise<string[]> {
  const stale = await staleFiles(set, written);
  if (!dryRun) {
    for (const path of stale) await rm(path, { force: true });
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Screens the human has not approved yet: advisory only, so the review gate stays the human's. */
function approvalWarnings(manifest: ProjectManifest, locale: string, files: readonly ExportFile[]): Warning[] {
  const unapproved = new Map<AppDisplayType, string[]>();
  for (const file of files) {
    const state = imageState(manifest, locale, file.sizeId, file.screenId);
    const status = state?.status ?? 'pending';
    if (status === 'image-approved' || status === 'exported' || status === 'uploaded') continue;
    const list = unapproved.get(file.displayType) ?? [];
    list.push(`${formatOrdinal(file.ordinal)}-${file.screenId} (${status})`);
    unapproved.set(file.displayType, list);
  }
  return [...unapproved].map(([displayType, screens]) =>
    makeWarning(
      'export-unapproved',
      `${displayType}: ${screens.length} screen(s) are not image-approved: ${screens.join(', ')}. ` +
        'Exported anyway; approve them in the manifest before you upload.',
    ),
  );
}

/**
 * Screens the report still has but `screens.ts` does not: `s1s export` reads
 * the render report, never `screens.ts`, so a screen deleted after the last
 * render would ship one more time (and `s1s status` calls it an orphan, which
 * does not flip `ok`).
 */
function droppedScreenWarnings(project: Pick<Project, 'screens'>, sets: readonly ExportSet[]): Warning[] {
  const known = new Set(project.screens.screens.map((screen) => screen.id));
  const dropped = new Map<AppDisplayType, string[]>();
  for (const set of sets) {
    for (const item of set.items) {
      if (known.has(item.screenId)) continue;
      dropped.set(set.displayType, [...(dropped.get(set.displayType) ?? []), itemLabel(item)]);
    }
  }
  return [...dropped].map(([displayType, screens]) =>
    makeWarning(
      'manifest-incomplete',
      `${displayType}: ${screens.join(', ')} ${screens.length === 1 ? 'is' : 'are'} in the render report but no longer in screens.ts. ` +
        'Exported anyway; re-run `s1s render` to drop them, then `s1s export --prune`.',
    ),
  );
}

/**
 * The duplicate-dims trap, seen from the export side: a sibling folder that
 * already holds NN files and accepts the pixel size this run just wrote.
 * `s1s validate` reports the same clash from the files themselves; the rule
 * (`displayTypesShareDims`) and the message are shared with it.
 */
async function duplicateDimsWarnings(root: string, locale: string, sets: readonly ExportSet[]): Promise<Warning[]> {
  const written = sets.filter((set) => set.items.length > 0);
  if (written.length === 0) return [];
  const localeDir = join(root, locale);
  const entries = await readdir(localeDir, { withFileTypes: true }).catch(() => []);
  const warnings: Warning[] = [];
  const reported = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // The pair matters, not who wrote it: exporting both APP_IPHONE_69 and
    // APP_IPHONE_67 in one run sets the same trap as finding one already there.
    const clash = written.find((set) => displayTypesShareDims(set.displayType, entry.name));
    if (clash === undefined) continue;
    const pair = [clash.displayType, entry.name].sort().join(' + ');
    if (reported.has(pair)) continue;
    const names = await readdir(join(localeDir, entry.name)).catch(() => [] as string[]);
    if (!names.some((name) => EXPORT_FILE_RE.test(name))) continue;
    reported.add(pair);
    warnings.push(makeWarning('duplicate-dims', duplicateDimsMessage(locale, clash.displayType, entry.name, clash.preset.px)));
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// asc
// ---------------------------------------------------------------------------

async function validateWithAsc(sets: readonly ExportSet[], cwd: string): Promise<AscValidateResult[]> {
  const results: AscValidateResult[] = [];
  for (const set of sets) {
    if (set.items.length === 0) continue;
    try {
      results.push(await ascValidateScreenshots({ path: set.dir, deviceType: set.preset.deviceTypeToken, cwd }));
    } catch (error) {
      // An asc failure fails the report, never the export: the files are on disk either way.
      const message = errorMessage(error);
      results.push({
        ok: false,
        command: `asc screenshots validate --path ${set.dir} --device-type ${set.preset.deviceTypeToken}`,
        report: message,
        stderr: message,
      });
    }
  }
  return results;
}

/** One printed `asc screenshots upload` line; `formatCommand` quotes the placeholders. */
function uploadLine(args: readonly string[]): string {
  return formatCommand('asc', ['screenshots', 'upload', ...args]);
}

/**
 * The `asc screenshots upload` commands to run next.
 *
 * asc-upload.md section 7 makes the per-localization form the default: one
 * command per display type, `--path` naming exactly one folder, targeting one
 * version localization. Section 8 keeps the fan-out form (`--path` = the
 * export root, which asc walks for every locale and selects by pixel size) for
 * the case where several locales are complete and the tree has no
 * duplicate-dims siblings, so `duplicateDims` suppresses it outright.
 *
 * Every command carries `--dry-run`, because section 7 says to read a dry run
 * before every upload and the real command differs only in `--replace`. A
 * missing id becomes an obvious placeholder plus a warning naming the manifest
 * field to fill in; a field no printed command uses is not warned about.
 */
function uploadCommands(
  project: Pick<Project, 'appDir' | 'manifest'>,
  locale: string,
  root: string,
  sets: readonly ExportSet[],
  duplicateDims: boolean,
): { commands: string[]; fanOut: string[]; warnings: Warning[] } {
  const written = sets.filter((set) => set.items.length > 0);
  if (written.length === 0) return { commands: [], fanOut: [], warnings: [] };

  // Run from the app repo root, the way the skill's commands do.
  const relativeRoot = relative(project.appDir, root);
  const path = relativeRoot && !relativeRoot.startsWith('..') ? toPosix(relativeRoot) : toPosix(root);

  const warnings: Warning[] = [];
  const localizationId = project.manifest.locales[locale]?.versionLocalizationId;
  if (!localizationId) {
    warnings.push(
      makeWarning(
        'manifest-incomplete',
        `No versionLocalizationId for ${locale} in the manifest; the upload command below has a placeholder. ` +
          `Fill in locales.${locale}.versionLocalizationId (see asc-upload.md section 4).`,
      ),
    );
  }
  const commands = written.map((set) =>
    uploadLine([
      '--version-localization',
      localizationId ?? '<VERSION_LOCALIZATION_ID>',
      '--path',
      `${path}/${locale}/${set.displayType}`,
      '--device-type',
      set.preset.deviceTypeToken,
      '--dry-run',
      '--pretty',
    ]),
  );
  if (duplicateDims) return { commands, fanOut: [], warnings };

  const appId = project.manifest.app.appId;
  const version = project.manifest.locales[locale]?.versionString;
  if (!appId) {
    warnings.push(
      makeWarning('manifest-incomplete', 'No app.appId in the manifest; the upload command below has a placeholder. Fill in app.appId (see asc-upload.md section 2).'),
    );
  }
  if (!version) {
    warnings.push(
      makeWarning(
        'manifest-incomplete',
        `No versionString for ${locale} in the manifest; the upload command below has a placeholder. ` +
          `Fill in locales.${locale}.versionString (see asc-upload.md section 3).`,
      ),
    );
  }
  const fanOut = written.map((set) =>
    uploadLine([
      '--app',
      appId ?? '<APP_ID>',
      '--version',
      version ?? '<VERSION>',
      '--path',
      path,
      '--device-type',
      set.preset.deviceTypeToken,
      '--dry-run',
      '--pretty',
    ]),
  );
  return { commands, fanOut, warnings };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Records the export per screen: the file, its hash, its store name and
 * status 'exported' where the status machine allows it. A screen that is
 * already 'uploaded' keeps that status (canTransition refuses the step back),
 * so a re-export never pretends the store lost the file.
 */
export function applyExportManifest(
  project: Pick<Project, 'dir' | 'manifest'>,
  locale: string,
  files: readonly ExportFile[],
): ProjectManifest {
  let manifest = project.manifest;
  for (const file of files) {
    const ref = { locale, sizeId: file.sizeId, screenId: file.screenId };
    const previous = imageState(manifest, locale, file.sizeId, file.screenId);
    const patch: Partial<ImageState> = {
      export: toPosix(relative(project.dir, file.to)),
      exportSha256: file.sha256,
      storeFileName: exportFileName(file.ordinal),
    };
    if (canTransition(previous?.status ?? 'pending', 'exported')) patch.status = 'exported';
    // The status machine refuses uploaded -> exported, so an already uploaded
    // image keeps its status while its file, hash and store name are
    // repointed. Flag it, the way a changed render does, or nobody knows the
    // store still holds the old pixels.
    else if (previous?.status === 'uploaded' && (previous.storeFileName !== patch.storeFileName || previous.exportSha256 !== file.sha256)) {
      patch.wasUploaded = true;
    }
    manifest = updateImage(manifest, ref, patch);
  }
  return manifest;
}

/** The `runs` entry one export appends, the way render.ts records a render. */
function exportRun(opts: ExportOptions, report: ExportReport, startedAt: string, finishedAt: string): ManifestRun {
  const sizes = opts.sizes?.length ? ` --sizes ${opts.sizes.join(',')}` : '';
  const prune = opts.prune ? ' --prune' : '';
  const written = report.files.filter((f) => f.action === 'written').length;
  return {
    command: `export --locale ${opts.locale}${sizes}${prune}`,
    startedAt,
    finishedAt,
    ok: report.ok,
    notes: `${written} written, ${report.files.length - written} unchanged, ${report.pruned.length} pruned`,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function exportProject(project: Project, opts: ExportOptions): Promise<ExportReport> {
  const startedAt = new Date().toISOString();
  const { locale } = opts;
  assertLocaleSegment(locale);
  const root = opts.metadataDir ? resolve(project.appDir, opts.metadataDir) : metadataDir(project);

  const report = await readRenderReport(project, locale);
  const sizes = resolveSizes(report, opts.sizes);
  const sets = buildSets(report, sizes, root, locale);
  await assertReady(sets, locale);

  const files: ExportFile[] = [];
  const pruned: string[] = [];
  const stale: string[] = [];
  for (const set of sets) {
    const exported = await exportSet(set, opts);
    files.push(...exported);
    const written = new Set(exported.map((file) => basename(file.to)));
    if (opts.prune) pruned.push(...(await pruneSet(set, written, opts.dryRun === true)));
    else stale.push(...(await staleFiles(set, written)));
  }

  const duplicateDims = await duplicateDimsWarnings(root, locale, sets);
  const warnings: Warning[] = [
    ...approvalWarnings(project.manifest, locale, files),
    ...droppedScreenWarnings(project, sets),
    ...duplicateDims,
  ];
  const upload = uploadCommands(project, locale, root, sets, duplicateDims.length > 0);
  warnings.push(...upload.warnings);

  // A dry run validates nothing: the folders still hold the previous export.
  const asc = opts.asc === false || opts.dryRun === true ? null : (await findAsc()) === null ? null : await validateWithAsc(sets, project.appDir);

  const result: ExportReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    metadataDir: root,
    sizes,
    dryRun: opts.dryRun === true,
    files,
    pruned,
    stale,
    warnings,
    asc,
    uploadCommands: upload.commands,
    fanOutCommands: upload.fanOut,
    ok: !warnings.some((w) => w.level === 'error') && (asc ?? []).every((r) => r.ok),
  };

  if (!result.dryRun) {
    const manifest = appendRun(applyExportManifest(project, locale, files), exportRun(opts, result, startedAt, result.generatedAt));
    project.manifest = manifest;
    await writeManifest(project.manifestPath, manifest);
  }
  return result;
}
