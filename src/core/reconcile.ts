// Reconciliation for `s1s status`: what screens.ts describes, what the
// manifest claims and what is actually on disk, in one table.
//
// Three signals are reported independently (a status is a claim, a file is a
// fact), plus the two things nothing else notices: manifest entries whose
// screen or size left screens.ts (orphans) and exported files no entry claims
// (strays). Local only - App Store Connect is authoritative for shipped state,
// but reading it needs credentials and network, so an 'uploaded' row carries
// STORE_NOT_CONSULTED instead of a store column.
import { readdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { SIZE_PRESETS, isSizeId, presetByDisplayType, presetsFor } from '../config/presets.ts';
import { captureRelPath, exportFileName, formatOrdinal, renderFileName } from '../config/resolve.ts';
import { IMAGE_STATUSES } from '../config/types.ts';
import type {
  AppDisplayType,
  CaptureSource,
  ImageState,
  ImageStatus,
  LocaleCopy,
  ProjectManifest,
  SizeId,
} from '../config/types.ts';
import { S1sError } from './errors.ts';
import { isFile, sha1File, sha256File } from './fs.ts';
import { canTransition, imageState, updateImage, type DroppableImageField } from './manifest.ts';
import { buildMatrix, type MatrixOptions } from './matrix.ts';
import { exportDir, metadataDir, sizeOutDir } from './paths.ts';
import type { Project } from './project.ts';

/** 'none' = not expected (a template that needs no capture, an entry with no such path). */
export type FileState = 'present' | 'missing' | 'none';

export interface ReconcileRow {
  locale: string;
  sizeId: SizeId;
  displayType: AppDisplayType;
  screenId: string;
  /** 0 when the screen is no longer in screens.ts. */
  ordinal: number;
  status: ImageStatus;
  capture: FileState;
  render: FileState;
  export: FileState;
  /** 'stale' when the render exists but its sha1 differs from manifest.renderHash. */
  renderStale: boolean;
  notes: string[];
}

export interface ReconcileReport {
  version: 1;
  generatedAt: string;
  locales: string[];
  rows: ReconcileRow[];
  /** Manifest entries whose screen or size is no longer in screens.ts. */
  orphans: ReconcileRow[];
  /** Exported files on disk with no manifest entry (absolute paths). */
  strayExports: string[];
  /** status -> count, over `rows` only. */
  summary: Record<string, number>;
  /** Every in-scope row has the files its status implies. Orphans do not flip it. */
  ok: boolean;
}

export interface ReconcileOptions {
  locale?: string;
  sizes?: string[];
  screens?: string[];
}

/** Note on every 'uploaded' row: this command never talks to App Store Connect. */
export const STORE_NOT_CONSULTED =
  'store not consulted: `asc screenshots list` is authoritative for shipped state';

/**
 * `buildMatrix` resolves copy it does not need here and throws when a copy
 * file is invalid. Status must still report on a project with broken copy, so
 * an empty copy is passed in and the copy signal is left to `s1s render`.
 */
const NO_COPY: LocaleCopy = { locale: '', screens: {} };

type ProjectDirs = Pick<Project, 'dir' | 'appDir'>;

/**
 * Where a path the manifest records actually is. `capture`, `render` and
 * `export` are all written relative to the project dir (the export of an
 * app repo therefore starts '../'); see references/manifest-schema.md.
 */
function manifestPath(project: ProjectDirs, value: string): string {
  return isAbsolute(value) ? value : resolve(project.dir, value);
}

async function locate(project: ProjectDirs, value: string): Promise<{ path: string; exists: boolean }> {
  const path = manifestPath(project, value);
  return { path, exists: await isFile(path) };
}

/** True when `path` sits under `dir` (not the dir itself). */
function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function statusRank(status: ImageStatus): number {
  return IMAGE_STATUSES.indexOf(status);
}

/** Files the status claims exist. A stale render counts as missing. */
function rowIsOk(row: ReconcileRow): boolean {
  const rank = statusRank(row.status);
  if (rank >= statusRank('captured') && row.capture === 'missing') return false;
  if (rank >= statusRank('generated') && (row.render !== 'present' || row.renderStale)) return false;
  if (rank >= statusRank('exported') && row.export !== 'present') return false;
  return true;
}

/** `--locale` when given, else every locale screens.ts or the manifest knows. */
function scopeLocales(project: Project, opts: ReconcileOptions): string[] {
  if (opts.locale !== undefined) return [opts.locale];
  const seen = new Set<string>();
  const locales: string[] = [];
  for (const locale of [...project.locales, ...Object.keys(project.manifest.locales)]) {
    if (seen.has(locale)) continue;
    seen.add(locale);
    locales.push(locale);
  }
  return locales;
}

function presetIds(sizes: readonly string[]): SizeId[] {
  try {
    return presetsFor(sizes).map((preset) => preset.id);
  } catch (err) {
    throw new S1sError('usage', err instanceof Error ? err.message : String(err));
  }
}

function matrixOptions(locale: string, opts: ReconcileOptions): MatrixOptions {
  return {
    locale,
    copy: NO_COPY,
    ...(opts.sizes && opts.sizes.length > 0 ? { sizes: opts.sizes } : {}),
    ...(opts.screens && opts.screens.length > 0 ? { screens: opts.screens } : {}),
  };
}

interface CaptureSignal {
  state: FileState;
  notes: string[];
}

function captureSignal(locale: string, sources: readonly CaptureSource[]): CaptureSignal {
  if (sources.length === 0) return { state: 'none', notes: [] };
  const notes: string[] = [];
  const missing = sources.filter((source) => source.resolvedPath === null);
  if (missing.length > 0) {
    const paths = missing.map((source) => captureRelPath(locale, source.family, source.requested));
    notes.push(`capture missing: ${paths.join(', ')}`);
  }
  const borrowed = sources.filter((source) => source.fallback === 'source-locale');
  if (borrowed.length > 0) {
    const locales = [...new Set(borrowed.map((source) => source.usedLocale))];
    notes.push(`capture reused from ${locales.join(', ')}`);
  }
  return { state: missing.length === 0 ? 'present' : 'missing', notes };
}

/**
 * `captureSha256` pins one file, but a multi-device screen lists several
 * captures and `s1s capture` overwrites the field per file, so the manifest
 * cannot say which one it describes. Comparing only single-capture screens
 * keeps the check honest instead of inventing a mismatch. Hashes are cached
 * because sibling sizes (an alias, iPhone plus its 6.7in twin) share a file.
 */
async function captureShaNotes(
  project: ProjectDirs,
  state: ImageState | undefined,
  sources: readonly CaptureSource[],
  cache: Map<string, string | null>,
): Promise<string[]> {
  const expected = state?.captureSha256;
  const recorded = state?.capture;
  if (expected === undefined || recorded === undefined || sources.length !== 1) return [];
  const found = await locate(project, recorded);
  if (!found.exists) return [];
  let actual = cache.get(found.path);
  if (actual === undefined) {
    actual = await sha256File(found.path).catch(() => null);
    cache.set(found.path, actual);
  }
  if (actual === expected) return [];
  return [`capture ${recorded} changed since it was recorded: sha256 ${actual ?? 'unreadable'} != captureSha256 ${expected}; re-render to pick it up`];
}

interface RenderSignal {
  state: FileState;
  stale: boolean;
  notes: string[];
}

async function renderSignal(
  project: ProjectDirs,
  state: ImageState | undefined,
  /** Where a render would land; null for an orphan, which has no ordinal. */
  fallbackPath: string | null,
): Promise<RenderSignal> {
  const recorded = state?.render;
  if (recorded === undefined) {
    // No render is expected yet. A file at the usual place means a render
    // never reached the manifest (an interrupted run, a hand-copied PNG).
    if (fallbackPath !== null && (await isFile(fallbackPath))) {
      return { state: 'none', stale: false, notes: [`${fallbackPath} exists but the manifest records no render`] };
    }
    return { state: 'none', stale: false, notes: [] };
  }
  const found = await locate(project, recorded);
  if (!found.exists) {
    return { state: 'missing', stale: false, notes: [`render ${recorded} is gone (out/ is not committed; run \`s1s render\`)`] };
  }
  const expected = state?.renderHash;
  if (expected === undefined) return { state: 'present', stale: false, notes: [`render ${recorded} has no renderHash`] };
  const actual = await sha1File(found.path).catch(() => null);
  if (actual === expected) return { state: 'present', stale: false, notes: [] };
  return { state: 'present', stale: true, notes: [`render ${recorded} is stale: sha1 ${actual ?? 'unreadable'} != renderHash ${expected}`] };
}

interface ExportSignal {
  state: FileState;
  notes: string[];
}

async function exportSignal(
  project: ProjectDirs,
  state: ImageState | undefined,
  metaDir: string,
  /** Where an export would land; null for an orphan, which has no ordinal. */
  fallbackPath: string | null,
): Promise<ExportSignal> {
  const recorded = state?.export;
  if (recorded === undefined) {
    // No export is expected yet; a file sitting there is listed as a stray.
    if (fallbackPath !== null && (await isFile(fallbackPath))) {
      return { state: 'none', notes: [`${fallbackPath} exists but no manifest entry claims it`] };
    }
    return { state: 'none', notes: [] };
  }
  const found = await locate(project, recorded);
  const notes: string[] = [];
  if (!isInside(metaDir, found.path)) notes.push(`export ${recorded} is outside ${metaDir}`);
  // `s1s export` names files by their position in the render report, not by
  // the ordinal screens.ts gives them, so the two can disagree.
  if (fallbackPath !== null && found.path !== fallbackPath) {
    notes.push(`export ${recorded} is not ${basename(fallbackPath)}, the file this ordinal exports to; re-run \`s1s render\` then \`s1s export\``);
  }
  if (!found.exists) return { state: 'missing', notes: [...notes, `export ${recorded} is gone (run \`s1s export\`)`] };
  // The shipped copy is what `exportSha256` pins. A file edited or replaced
  // since the export means the upload folder no longer holds the reviewed
  // pixels, which is the one thing a status table must not report as fine.
  const expected = state?.exportSha256;
  if (expected === undefined) return { state: 'present', notes: [...notes, `export ${recorded} has no exportSha256`] };
  const actual = await sha256File(found.path).catch(() => null);
  if (actual !== expected) {
    notes.push(`export ${recorded} is stale: sha256 ${actual ?? 'unreadable'} != exportSha256 ${expected}; re-run \`s1s export\``);
  }
  return { state: 'present', notes };
}

/** Every export path the manifest claims, absolute; strays are what is left. */
function claimedExports(project: Project): Set<string> {
  const claimed = new Set<string>();
  for (const locale of Object.values(project.manifest.locales)) {
    for (const device of Object.values(locale.devices)) {
      for (const state of Object.values(device?.screens ?? {})) {
        if (state.export === undefined) continue;
        claimed.add(manifestPath(project, state.export));
      }
    }
  }
  return claimed;
}

/**
 * Files under <metadataDir>/<locale>/<APP_DISPLAY_TYPE>/ that no manifest
 * entry claims. Hidden files (.DS_Store) are ignored: `asc` ignores them too.
 */
async function strayExports(
  metaDir: string,
  locales: readonly string[],
  displayTypes: ReadonlySet<string> | null,
  claimed: ReadonlySet<string>,
): Promise<string[]> {
  const strays: string[] = [];
  for (const locale of locales) {
    const dirs = await readdir(join(metaDir, locale), { withFileTypes: true }).catch(() => []);
    for (const dir of dirs) {
      const preset = dir.isDirectory() ? presetByDisplayType(dir.name) : undefined;
      if (preset === undefined) continue;
      if (displayTypes && !displayTypes.has(preset.displayType)) continue;
      const setDir = exportDir(metaDir, locale, preset.displayType);
      const files = await readdir(setDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || file.name.startsWith('.')) continue;
        const path = join(setDir, file.name);
        if (!claimed.has(path)) strays.push(path);
      }
    }
  }
  return strays.sort();
}

/** State of a path the manifest records; 'none' when it records none. */
async function recordedFileState(project: ProjectDirs, recorded: string | undefined): Promise<FileState> {
  if (recorded === undefined) return 'none';
  return (await locate(project, recorded)).exists ? 'present' : 'missing';
}

/** A manifest entry with no row: the size, the screen and why it is left over. */
interface Orphan {
  sizeId: SizeId;
  screenId: string;
  state: ImageState;
  why: string;
}

/** Manifest entries the matrix does not cover. This is what `s1s status` exists for. */
function orphanRows(project: Project, locale: string, covered: ReadonlySet<string>, opts: ReconcileOptions): Orphan[] {
  const screenIds = new Set(project.screens.screens.map((screen) => screen.id));
  const projectSizes = new Set<SizeId>(project.sizes);
  const sizeFilter = opts.sizes && opts.sizes.length > 0 ? new Set(presetIds(opts.sizes)) : null;
  const screenFilter = opts.screens && opts.screens.length > 0 ? new Set(opts.screens) : null;
  const devices = project.manifest.locales[locale]?.devices ?? {};
  const found: Orphan[] = [];

  for (const [sizeId, device] of Object.entries(devices)) {
    if (!isSizeId(sizeId)) continue;
    if (sizeFilter && !sizeFilter.has(sizeId)) continue;
    for (const [screenId, state] of Object.entries(device?.screens ?? {})) {
      if (covered.has(`${sizeId}/${screenId}`)) continue;
      if (screenFilter && !screenFilter.has(screenId)) continue;
      const reasons: string[] = [];
      if (!screenIds.has(screenId)) reasons.push(`screen "${screenId}" is not in screens.ts`);
      if (!projectSizes.has(sizeId)) reasons.push(`size "${sizeId}" is not in screens.sizes (${project.sizes.join(', ')})`);
      if (reasons.length === 0) reasons.push(`screen "${screenId}" no longer applies to ${sizeId} (see its \`only\` list)`);
      found.push({ sizeId, screenId, state, why: reasons.join('; ') });
    }
  }
  return found;
}

async function orphanRow(project: Project, locale: string, orphan: Orphan, metaDir: string): Promise<ReconcileRow> {
  const { state } = orphan;
  const capture = await recordedFileState(project, state.capture);
  const render = await renderSignal(project, state, null);
  const exported = await exportSignal(project, state, metaDir, null);
  // An orphan's export path is claimed, so it is never a stray: without this
  // note nothing says a dropped screen still sits in the upload folder.
  const stillExported =
    exported.state === 'present' && state.export !== undefined
      ? [`${manifestPath(project, state.export)} is still in the upload folder; delete it or run \`s1s export --prune\``]
      : [];
  return {
    locale,
    sizeId: orphan.sizeId,
    displayType: SIZE_PRESETS[orphan.sizeId].displayType,
    screenId: orphan.screenId,
    ordinal: 0,
    status: state.status,
    capture,
    render: render.state,
    export: exported.state,
    renderStale: render.stale,
    notes: [orphan.why, ...render.notes, ...exported.notes, ...wasUploadedNotes(state), ...stillExported],
  };
}

/** Every screen id the manifest holds for the scoped locales (orphans included). */
function manifestScreenIds(project: Project, locales: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const locale of locales) {
    for (const device of Object.values(project.manifest.locales[locale]?.devices ?? {})) {
      for (const screenId of Object.keys(device?.screens ?? {})) ids.add(screenId);
    }
  }
  return ids;
}

/** Error-level render warnings the manifest recorded; a status alone never shows them. */
function renderWarningNotes(state: ImageState | undefined): string[] {
  return (state?.renderWarnings ?? [])
    .filter((warning) => warning.level === 'error')
    .map((warning) => `${warning.code}: ${warning.message}`);
}

/**
 * `wasUploaded` is what `s1s render` and `s1s export` leave behind when they
 * move an image the store already holds. It is the only "shipped but stale"
 * signal a local run has, and no column shows it. It does not flip `ok`: the
 * files are all there, it is the store copy that is behind.
 */
function wasUploadedNotes(state: ImageState | undefined): string[] {
  if (state?.wasUploaded !== true) return [];
  return [
    'was uploaded and has been re-rendered since: the store copy is stale; re-export, re-upload, then `s1s status --set uploaded`',
  ];
}

/**
 * One row per (locale, size, screen) that screens.ts and the manifest between
 * them describe. `opts.sizes` / `opts.screens` narrow the rows and the
 * orphans; a `--screens` id the manifest still holds selects an orphan, and
 * only an id neither screens.ts nor the manifest knows is a usage error.
 */
export async function reconcile(project: Project, opts: ReconcileOptions = {}): Promise<ReconcileReport> {
  const locales = scopeLocales(project, opts);
  const metaDir = metadataDir(project);
  const sizeOrder = presetIds(opts.sizes && opts.sizes.length > 0 ? opts.sizes : project.sizes);
  const displayTypes = opts.sizes && opts.sizes.length > 0
    ? new Set(sizeOrder.map((id) => SIZE_PRESETS[id].displayType as string))
    : null;

  const rows: ReconcileRow[] = [];
  const orphans: ReconcileRow[] = [];
  const manifestScreens = manifestScreenIds(project, locales);
  const requestedScreens = opts.screens ?? [];

  for (const locale of locales) {
    // Unfiltered first: it decides what counts as covered, so `--screens`
    // never turns an in-use screen into an orphan. Rows this run emits are
    // added below, so `--sizes` cannot list one image as both.
    const covered = new Set<string>();
    const selectable = new Set<string>();
    for (const item of buildMatrix(project, { locale, copy: NO_COPY })) {
      for (const output of item.outputs) covered.add(`${output.sizeId}/${item.screen.id}`);
      selectable.add(item.screen.id);
      selectable.add(String(item.ordinal));
      selectable.add(formatOrdinal(item.ordinal));
    }

    // A selector the matrix does not know may still name a manifest entry
    // this command reports as an orphan; only a name neither knows is usage.
    const unknown = requestedScreens.filter((sel) => !selectable.has(sel) && !manifestScreens.has(sel));
    if (unknown.length > 0) {
      const known = project.screens.screens.map((screen) => screen.id).join(', ');
      throw new S1sError('usage', `Unknown screen selector(s): ${unknown.join(', ')}`, {
        hint: `Use a screen id (${known}), a 1-based ordinal, or a screen id the manifest still holds.`,
      });
    }
    const selected = requestedScreens.filter((sel) => selectable.has(sel));
    const items =
      requestedScreens.length > 0 && selected.length === 0
        ? []
        : buildMatrix(project, matrixOptions(locale, { ...opts, ...(selected.length > 0 ? { screens: selected } : {}) }));

    // A copy file that does not parse stops `s1s render`, never this command.
    // Reporting it here is the only place it surfaces before the render fails.
    const copyError = project.copyErrors[locale];
    const copyNotes = copyError ? [`copy for ${locale} cannot be read: ${copyError.message}`] : [];
    const captureHashes = new Map<string, string | null>();

    for (const item of items) {
      const capture = captureSignal(locale, item.screen.captures);
      for (const output of item.outputs) {
        covered.add(`${output.sizeId}/${item.screen.id}`);
        const state = imageState(project.manifest, locale, output.sizeId, item.screen.id);
        const status = state?.status ?? 'pending';
        const outPath = join(sizeOutDir(project, locale, output.displayType), renderFileName(item.ordinal, item.screen.id));
        const exportPath = join(exportDir(metaDir, locale, output.displayType), exportFileName(item.ordinal));
        const render = await renderSignal(project, state, outPath);
        const exported = await exportSignal(project, state, metaDir, exportPath);
        const captureSha = await captureShaNotes(project, state, item.screen.captures, captureHashes);
        rows.push({
          locale,
          sizeId: output.sizeId,
          displayType: output.displayType,
          screenId: item.screen.id,
          ordinal: item.ordinal,
          status,
          capture: capture.state,
          render: render.state,
          export: exported.state,
          renderStale: render.stale,
          notes: [
            ...copyNotes,
            ...capture.notes,
            ...captureSha,
            ...render.notes,
            ...exported.notes,
            ...renderWarningNotes(state),
            ...wasUploadedNotes(state),
            ...(status === 'uploaded' ? [STORE_NOT_CONSULTED] : []),
          ],
        });
      }
    }

    for (const orphan of orphanRows(project, locale, covered, opts)) {
      orphans.push(await orphanRow(project, locale, orphan, metaDir));
    }
  }

  const localeRank = new Map(locales.map((locale, index) => [locale, index]));
  const sizeRank = new Map(sizeOrder.map((id, index) => [id, index]));
  const sortKey = (row: ReconcileRow): [number, number, number, string] => [
    localeRank.get(row.locale) ?? locales.length,
    sizeRank.get(row.sizeId) ?? sizeOrder.length,
    row.ordinal,
    row.screenId,
  ];
  const byPosition = (a: ReconcileRow, b: ReconcileRow): number => {
    const [aLocale, aSize, aOrdinal, aScreen] = sortKey(a);
    const [bLocale, bSize, bOrdinal, bScreen] = sortKey(b);
    return aLocale - bLocale || aSize - bSize || aOrdinal - bOrdinal || aScreen.localeCompare(bScreen);
  };
  rows.sort(byPosition);
  orphans.sort(byPosition);

  const summary: Record<string, number> = {};
  for (const row of rows) summary[row.status] = (summary[row.status] ?? 0) + 1;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    locales,
    rows,
    orphans,
    strayExports: await strayExports(metaDir, locales, displayTypes, claimedExports(project)),
    summary,
    ok: rows.every(rowIsOk),
  };
}

/** One image in the manifest: what `updateImage` addresses. */
export interface ImageRef {
  locale: string;
  sizeId: SizeId;
  screenId: string;
}

export interface SetStatusOptions {
  /** ISO time `uploaded` records; injectable so a test can pin it. */
  now?: string;
}

/** Fields `wasUploaded` is dropped from when an image reaches 'uploaded' again. */
const UPLOAD_CLEARS: readonly DroppableImageField[] = ['wasUploaded'];

/**
 * `s1s status --set`: the pure half. Every ref goes through `canTransition`
 * before any of them is applied, so an illegal status change never reaches a
 * half-updated manifest. Returns a new manifest; the caller writes it and
 * appends its own `runs` entry.
 *
 * `uploaded` also writes `uploadedAt` and clears `wasUploaded`, which is what
 * references/asc-upload.md section 9 promises the verify step records.
 */
export function setStatus(
  manifest: ProjectManifest,
  refs: readonly ImageRef[],
  target: ImageStatus,
  opts: SetStatusOptions = {},
): ProjectManifest {
  const illegal = refs
    .map((ref) => ({ ref, from: imageState(manifest, ref.locale, ref.sizeId, ref.screenId)?.status ?? 'pending' }))
    .filter((row) => !canTransition(row.from, target));
  if (illegal.length > 0) {
    const named = illegal.map(({ ref, from }) => `${ref.locale} ${ref.sizeId} ${ref.screenId} is ${from}`);
    throw new S1sError('usage', `Cannot set ${target}: ${named.join('; ')}. Nothing was written.`, {
      hint: 'A status may move forward, or back to pending / captured / generated. Set an intermediate status first.',
    });
  }
  // One timestamp for the whole call: the images were verified together.
  const patch: Partial<ImageState> =
    target === 'uploaded' ? { status: target, uploadedAt: opts.now ?? new Date().toISOString() } : { status: target };
  const drop = target === 'uploaded' ? UPLOAD_CLEARS : [];
  let next = manifest;
  for (const ref of refs) next = updateImage(next, ref, patch, { drop });
  return next;
}
