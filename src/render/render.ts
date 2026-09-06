// The render pipeline: matrix -> Vite -> Chromium page pool -> sharp ->
// PNGs + previews + report.json + review.md + manifest render fields.
// Returns the report; the CLI decides exit codes from report.ok.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { isSizeId, presetsFor } from '../config/presets.ts';
import { captureRefPreset } from '../config/resolve.ts';
import type { LocaleCopy, RenderItem, RenderReport, RenderReportItem, ResolvedScreen, SizeId, Warning } from '../config/types.ts';
import { templateMeta } from '../config/template-meta.ts';
import { makeWarning, mergeWarnings, promoteWarnings } from '../config/warnings.ts';
import { captureWarnings } from '../core/captures.ts';
import { unusedCopyKeys } from '../core/copy.ts';
import { S1sError, isS1sError } from '../core/errors.ts';
import { writeManifest } from '../core/manifest.ts';
import { buildMatrix, type MatrixOptions } from '../core/matrix.ts';
import { bezelDir, reportPath, sheetPath } from '../core/paths.ts';
import type { Project } from '../core/project.ts';
import { contextFor, launchBrowser } from './browser.ts';
import { applyManifest, buildReport } from './bookkeeping.ts';
import { postProcess, writePng, writePreview } from './post.ts';
import { writeReview } from './review.ts';
import { createS1sServer, type S1sServer } from './server.ts';
import { readReport, sheetProject } from './sheet.ts';

export interface RenderOptions {
  locale: string;
  /** Size ids (aliases allowed). Default: project.sizes. */
  sizes?: string[];
  /** Screen ids or 1-based ordinals. Default: every screen. */
  screens?: string[];
  /** Parallel pages per size. Default 4. */
  jobs?: number;
  /** Build the matrix and node-side warnings only; write nothing. */
  dryRun?: boolean;
  /** Write out/<locale>/sheet-<sizeId>.png per rendered size (sheet.ts). Default true. */
  sheet?: boolean;
  /** Promote warn-level warnings to error. */
  strict?: boolean;
  /** Downgrade capture-missing from error to warn (early layout work). */
  allowPlaceholder?: boolean;
  /** Reuse a running server (tests / dev). */
  serverUrl?: string;
  onProgress?: (item: RenderReportItem) => void;
}

const DEFAULT_JOBS = 4;
const GOTO_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 30_000;
/** First load also pre-bundles React and transforms every module. */
const FIRST_READY_TIMEOUT_MS = 90_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const OUTPUT_FILE = /^\d{2}-.+\.png$/;

/** Templates that render no copy at all; `copy-missing` is not an error for them. */
const COPYLESS_TEMPLATES = new Set(['raw']);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateSizes(sizes: readonly string[] | undefined): void {
  for (const id of sizes ?? []) {
    if (!isSizeId(id)) throw new S1sError('usage', `Unknown size "${id}"`, { hint: 'Run `s1s doctor` to list size ids.' });
  }
}

/**
 * A missing copy file is not fatal: every screen then carries a
 * `copy-missing` error and the report says so. An invalid file is.
 */
async function loadCopyOrNull(project: Project, locale: string): Promise<LocaleCopy | null> {
  try {
    return await project.copyFor(locale);
  } catch (error) {
    if (isS1sError(error) && error.code === 'copy-missing') return null;
    throw error;
  }
}

function matrixOptions(opts: RenderOptions): MatrixOptions {
  const out: MatrixOptions = { locale: opts.locale };
  if (opts.sizes && opts.sizes.length > 0) out.sizes = opts.sizes;
  if (opts.screens && opts.screens.length > 0) out.screens = opts.screens;
  return out;
}

/** Warnings the Node side knows before the browser runs. */
function nodeWarnings(item: RenderItem, allowPlaceholder: boolean): Warning[] {
  const warnings: Warning[] = [];
  for (const source of item.screen.captures) {
    warnings.push(...captureWarnings(source, captureRefPreset(source.requested, item.preset), { allowPlaceholder }));
  }
  if (item.screen.copy === undefined && !COPYLESS_TEMPLATES.has(item.screen.template)) {
    warnings.push(
      makeWarning(
        'copy-missing',
        `No copy for screen "${item.screen.id}" (key "${item.screen.copyKey}") in copy/${item.locale}.json`,
      ),
    );
  }
  const overflow = calloutOverflow(item);
  if (overflow) warnings.push(overflow);
  return warnings;
}

/** Element the browser flags for the same problem, so mergeWarnings() keeps one warning. */
export const CALLOUTS_ELEMENT = '[data-s1s-id="callouts"]';

/** More copy.callouts than the template shows: an error here and in the browser (same element). */
export function calloutOverflow(item: { screen: Pick<ResolvedScreen, 'template' | 'copy' | 'copyKey'>; locale: string }): Warning | null {
  const max = templateMeta(item.screen.template)?.callouts;
  const count = item.screen.copy?.callouts?.length ?? 0;
  if (max === undefined || count <= max) return null;
  return makeWarning(
    'overflow',
    `copy/${item.locale}.json screens.${item.screen.copyKey}.callouts has ${count} entries; ${item.screen.template} shows at most ${max}`,
    CALLOUTS_ELEMENT,
  );
}

function baseReportItem(item: RenderItem): RenderReportItem {
  return {
    key: item.key,
    locale: item.locale,
    sizeId: item.preset.id,
    displayTypes: item.outputs.map((o) => o.displayType),
    screenId: item.screen.id,
    ordinal: item.ordinal,
    template: item.screen.template,
    status: 'skipped',
    outputs: [],
    preview: null,
    hash: null,
    dims: null,
    warnings: [],
    durationMs: 0,
  };
}

function plannedItem(item: RenderItem, warnings: Warning[]): RenderReportItem {
  return {
    ...baseReportItem(item),
    outputs: item.outputs.map((o) => o.outPath),
    preview: item.outputs[0]?.previewPath ?? null,
    warnings,
  };
}

function failedItem(item: RenderItem, warnings: Warning[], error: string, startedAt: number): RenderReportItem {
  return { ...baseReportItem(item), status: 'failed', warnings, error, durationMs: Math.round(performance.now() - startedAt) };
}

async function writeOutputs(item: RenderItem, png: Buffer): Promise<void> {
  await writePng(
    png,
    item.outputs.map((o) => o.outPath),
  );
  for (const output of item.outputs) await writePreview(png, output.previewPath);
}

/** `raw` on a watch preset: copy the capture through postProcess, no browser. */
async function renderPassthrough(project: Project, item: RenderItem, warnings: Warning[]): Promise<RenderReportItem> {
  const startedAt = performance.now();
  const source = item.screen.captures[0];
  if (!source || source.resolvedPath === null) {
    return failedItem(item, warnings, `No capture for ${item.key}; passthrough sizes have no placeholder`, startedAt);
  }
  try {
    const buffer = await readFile(join(project.dir, source.resolvedPath));
    const processed = await postProcess(buffer, item.preset, project.theme);
    await writeOutputs(item, processed.png);
    return {
      ...baseReportItem(item),
      status: 'passthrough',
      outputs: item.outputs.map((o) => o.outPath),
      preview: item.outputs[0]?.previewPath ?? null,
      hash: processed.hash,
      dims: processed.dims,
      warnings,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return failedItem(item, warnings, errorMessage(error), startedAt);
  }
}

// ---------------------------------------------------------------------------
// Browser items
// ---------------------------------------------------------------------------

interface PageSlot {
  page: Page;
  /** Recent console errors / page errors, cleared per item. */
  log: string[];
  /** Set while an item waits for readiness: called with a fatal console line so the wait ends at once. */
  onFatal: ((line: string) => void) | null;
}

/** An uncaught page error or a Vite transform failure: the page will never become ready. */
const FATAL_LINE = /^pageerror: |\[vite\] Internal Server Error/;

function listen(slot: PageSlot): void {
  const push = (line: string): void => {
    slot.log.push(line);
    if (slot.log.length > 8) slot.log.shift();
    if (FATAL_LINE.test(line)) slot.onFatal?.(line);
  };
  slot.page.on('pageerror', (error) => push(`pageerror: ${error.message}`));
  slot.page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') push(`console.${msg.type()}: ${msg.text()}`);
  });
}

async function openSlot(context: BrowserContext): Promise<PageSlot> {
  const slot: PageSlot = { page: await context.newPage(), log: [], onFatal: null };
  listen(slot);
  return slot;
}

/** After a failed item: a dead React root must not poison the next item on this slot. */
async function resetSlot(slot: PageSlot): Promise<void> {
  const context = slot.page.context();
  await slot.page.close().catch(() => {});
  slot.page = await context.newPage();
  slot.log = [];
  slot.onFatal = null;
  listen(slot);
}

// Ready when the settle loop finished and either the route's canvas is up or
// the page rendered an ErrorPanel (unknown template, project.json failure,
// template throw caught by the canvas boundary). ERROR_EXPR then decides.
const READY_EXPR = (key: string): string =>
  `window.__S1S_READY === true && (` +
  `(document.querySelector('[data-s1s-canvas]')?.getAttribute('data-s1s-canvas') ?? null) === ${JSON.stringify(key)}` +
  ` || document.querySelector('[data-s1s-id="error"]') !== null)`;

const ERROR_EXPR = `document.querySelector('[data-s1s-id="error"]')?.textContent ?? null`;

const CHECK_EXPR = `(typeof window.__S1S === 'object' && window.__S1S && typeof window.__S1S.check === 'function') ? window.__S1S.check() : []`;

// The registry, not the built-in metadata, decides compliance: a project
// template may declare `compliant: false` under a built-in id.
const NONCOMPLIANT_EXPR = `(typeof window.__S1S === 'object' && window.__S1S && typeof window.__S1S.noncompliant === 'function') ? window.__S1S.noncompliant() : null`;

const DIAG_EXPR = `JSON.stringify({
  ready: window.__S1S_READY,
  canvas: document.querySelector('[data-s1s-canvas]')?.getAttribute('data-s1s-canvas') ?? null,
  fitting: document.querySelectorAll('[data-s1s-fitting]').length,
  pendingImages: Array.from(document.images).filter((i) => !i.complete).length,
})`;

function isWarningList(value: unknown): value is Warning[] {
  return (
    Array.isArray(value) &&
    value.every(
      (w) =>
        typeof w === 'object' && w !== null && typeof (w as Warning).code === 'string' && typeof (w as Warning).message === 'string',
    )
  );
}

async function diagnostics(page: Page): Promise<string> {
  try {
    const raw = await page.evaluate<string>(DIAG_EXPR);
    return ` State: ${raw}.`;
  } catch {
    return '';
  }
}

interface BrowserRun {
  project: Project;
  baseUrl: string;
  strict: boolean;
  allowPlaceholder: boolean;
}

/** Waits for READY_EXPR, or fails at once on a fatal console line (pageerror, Vite transform error). */
async function waitForReady(slot: PageSlot, key: string, timeoutMs: number): Promise<void> {
  const { page } = slot;
  let onFatal: (line: string) => void = () => {};
  const fatal = new Promise<never>((_resolve, reject) => {
    onFatal = (line) => reject(new Error(`Page failed: ${line}`));
  });
  fatal.catch(() => {});
  slot.onFatal = onFatal;
  const already = slot.log.find((line) => FATAL_LINE.test(line));
  if (already !== undefined) onFatal(already);
  const wait = page.waitForFunction(READY_EXPR(key), undefined, { timeout: timeoutMs, polling: 'raf' });
  wait.catch(() => {});
  try {
    await Promise.race([wait, fatal]);
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith('Page failed:')) throw error;
    const why = message.split('\n')[0] ?? 'timeout';
    throw new Error(`Page not ready after ${Math.round(timeoutMs / 1000)} s (${why}).${await diagnostics(page)}`);
  } finally {
    slot.onFatal = null;
  }
  const panel = await page.evaluate<string | null>(ERROR_EXPR);
  if (panel !== null) throw new Error(`Page reported an error: ${panel.trim().replace(/\s*\n\s*/g, ' | ')}`);
}

async function renderOne(
  run: BrowserRun,
  slot: PageSlot,
  item: RenderItem,
  warnings: Warning[],
  readyTimeoutMs: number,
): Promise<RenderReportItem> {
  const startedAt = performance.now();
  const { page } = slot;
  slot.log.length = 0;
  const url = run.baseUrl + item.url;
  try {
    // Hash routes navigate in-document; clear readiness ourselves so a stale
    // `true` from the previous route can never satisfy the wait below. (The
    // route-derived Math.random seed re-installs itself on navigation.)
    await page.evaluate('window.__S1S_READY = false;');
    await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
    await waitForReady(slot, item.key, readyTimeoutMs);
    const checked: unknown = await page.evaluate(CHECK_EXPR);
    const browserWarnings = (isWarningList(checked) ? checked : []).map((w) =>
      w.code === 'capture-missing' && run.allowPlaceholder ? { ...w, level: 'warn' as const } : w,
    );
    const tagged: unknown = await page.evaluate(NONCOMPLIANT_EXPR);
    const noncompliant = typeof tagged === 'string' && tagged.length > 0 ? tagged : undefined;
    const shot = await page.screenshot({
      type: 'png',
      fullPage: false,
      scale: 'device',
      animations: 'disabled',
      caret: 'hide',
      timeout: SCREENSHOT_TIMEOUT_MS,
    });
    const processed = await postProcess(shot, item.preset, run.project.theme);
    await writeOutputs(item, processed.png);
    return {
      ...baseReportItem(item),
      status: 'rendered',
      outputs: item.outputs.map((o) => o.outPath),
      preview: item.outputs[0]?.previewPath ?? null,
      hash: processed.hash,
      dims: processed.dims,
      warnings: promoteWarnings(mergeWarnings(warnings, browserWarnings), run.strict),
      durationMs: Math.round(performance.now() - startedAt),
      ...(noncompliant === undefined ? {} : { noncompliant }),
    };
  } catch (error) {
    const consoleTail = slot.log.length ? ` Console: ${slot.log.join(' | ')}` : '';
    return failedItem(item, promoteWarnings(warnings, run.strict), `${errorMessage(error)} [${url}]${consoleTail}`, startedAt);
  }
}

async function renderPreset(
  run: BrowserRun,
  browser: Browser,
  items: readonly RenderItem[],
  warnings: readonly Warning[][],
  indices: number[],
  jobs: number,
  results: RenderReportItem[],
  warm: { done: boolean },
  onProgress: RenderOptions['onProgress'],
): Promise<void> {
  const first = items[indices[0] ?? -1];
  if (!first) return;
  const context = await contextFor(browser, first.preset, { locale: first.locale });
  const slots: PageSlot[] = [];
  try {
    const queue = [...indices];
    const take = async (slot: PageSlot, timeout: number): Promise<void> => {
      const index = queue.shift();
      if (index === undefined) return;
      const item = items[index];
      if (!item) return;
      const result = await renderOne(run, slot, item, warnings[index] ?? [], timeout);
      results[index] = result;
      onProgress?.(result);
      if (result.status === 'failed') await resetSlot(slot);
    };

    // Warm-up: the very first item runs alone with a long timeout so Vite's
    // dependency pre-bundling and module transforms happen once, off the pool.
    slots.push(await openSlot(context));
    if (!warm.done) {
      await take(slots[0] as PageSlot, FIRST_READY_TIMEOUT_MS);
      warm.done = true;
    }
    while (slots.length < Math.min(jobs, Math.max(queue.length, 1))) slots.push(await openSlot(context));
    await Promise.all(
      slots.map(async (slot) => {
        while (queue.length > 0) await take(slot, READY_TIMEOUT_MS);
      }),
    );
  } finally {
    await context.close().catch(() => {});
  }
}

async function renderBrowserItems(
  project: Project,
  opts: RenderOptions,
  items: readonly RenderItem[],
  warnings: readonly Warning[][],
  indices: number[],
  results: RenderReportItem[],
): Promise<void> {
  let server: S1sServer | null = null;
  let browser: Browser | null = null;
  try {
    if (!opts.serverUrl) {
      server = await createS1sServer({ projectDir: project.dir, bezelDir: bezelDir(), mode: 'render', project, locale: opts.locale });
    }
    const baseUrl = (opts.serverUrl ?? server?.url ?? '').replace(/\/+$/, '');
    browser = await launchBrowser();
    const run: BrowserRun = { project, baseUrl, strict: opts.strict ?? false, allowPlaceholder: opts.allowPlaceholder ?? false };
    const jobs = Math.max(1, Math.floor(opts.jobs ?? DEFAULT_JOBS));
    const warm = { done: false };

    // One context per preset, in matrix order.
    const byPreset = new Map<SizeId, number[]>();
    for (const index of indices) {
      const item = items[index];
      if (!item) continue;
      const list = byPreset.get(item.preset.id) ?? [];
      list.push(index);
      byPreset.set(item.preset.id, list);
    }
    for (const group of byPreset.values()) {
      await renderPreset(run, browser, items, warnings, group, jobs, results, warm, opts.onProgress);
    }
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

/** Removes NN-*.png files (and previews) that this full render did not produce. */
async function pruneStaleOutputs(items: readonly RenderItem[]): Promise<void> {
  const keep = new Map<string, Set<string>>();
  for (const item of items) {
    for (const output of item.outputs) {
      for (const path of [output.outPath, output.previewPath]) {
        const dir = dirname(path);
        const names = keep.get(dir) ?? new Set<string>();
        names.add(path.slice(dir.length + 1));
        keep.set(dir, names);
      }
    }
  }
  for (const [dir, names] of keep) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (OUTPUT_FILE.test(name) && !names.has(name)) await rm(join(dir, name), { force: true });
    }
  }
}

/**
 * A failed item must not leave a stale PNG that the manifest, `s1s status`
 * or `s1s export` would take for a current render.
 */
async function removeFailedOutputs(items: readonly RenderItem[], results: readonly RenderReportItem[]): Promise<void> {
  for (const [index, result] of results.entries()) {
    const item = items[index];
    if (!item || result.status !== 'failed') continue;
    for (const output of item.outputs) {
      await rm(output.outPath, { force: true });
      await rm(output.previewPath, { force: true });
    }
  }
}

async function writeReport(project: Project, report: RenderReport): Promise<string> {
  const path = reportPath(project, report.locale);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * A `--screens` run renders a subset, but its PNGs sit next to the untouched
 * ones (no pruning), so report.json, review.md and the sheets keep describing
 * the whole set: items of the previous report.json that this run did not
 * render are carried over. The returned report still lists this run only.
 */
async function withCarriedItems(project: Project, opts: RenderOptions, sizes: SizeId[], run: RenderReport): Promise<RenderReport> {
  let previous: RenderReport;
  try {
    previous = await readReport(project, opts.locale);
  } catch {
    return run;
  }
  if (previous.dryRun) return run;
  const rendered = new Set(run.items.map((i) => i.key));
  const carried = previous.items.filter((i) => !rendered.has(i.key));
  if (carried.length === 0) return run;
  const order = new Map(project.sizes.map((id, index) => [id, index]));
  const rank = (item: RenderReportItem): number => order.get(item.sizeId) ?? project.sizes.length;
  const items = [...carried, ...run.items].sort((a, b) => rank(a) - rank(b) || a.ordinal - b.ordinal);
  return buildReport(project, opts, sizes, items);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderProject(project: Project, opts: RenderOptions): Promise<RenderReport> {
  const startedAt = new Date().toISOString();
  validateSizes(opts.sizes);
  const copy = await loadCopyOrNull(project, opts.locale);
  const items = buildMatrix(project, matrixOptions(opts));
  if (items.length === 0) {
    throw new S1sError('usage', `Nothing to render for locale ${opts.locale}`, {
      hint: 'Check --sizes / --screens and the `only` filters in screens.ts.',
    });
  }
  const sizes = presetsFor(opts.sizes && opts.sizes.length > 0 ? opts.sizes : project.sizes).map((p) => p.id);
  const allowPlaceholder = opts.allowPlaceholder ?? false;
  const strict = opts.strict ?? false;

  const warnings = items.map((item) => nodeWarnings(item, allowPlaceholder));
  // Project-level: copy keys no screen uses. Attached to the first item so
  // they surface in report.json without a schema change.
  const unused = copy
    ? unusedCopyKeys(copy, project.screens).map((key) =>
        makeWarning('copy-unused', `copy/${opts.locale}.json has key "${key}" that no screen uses`),
      )
    : [];
  warnings[0]?.push(...unused);

  if (opts.dryRun) {
    const planned = items.map((item, i) => plannedItem(item, promoteWarnings(warnings[i] ?? [], strict)));
    return buildReport(project, opts, sizes, planned);
  }

  const results: RenderReportItem[] = items.map((item) => baseReportItem(item));
  const browserIndices: number[] = [];
  for (const [index, item] of items.entries()) {
    if (item.passthrough) {
      const result = await renderPassthrough(project, item, promoteWarnings(warnings[index] ?? [], strict));
      results[index] = result;
      opts.onProgress?.(result);
    } else {
      browserIndices.push(index);
    }
  }
  if (browserIndices.length > 0) {
    await renderBrowserItems(project, opts, items, warnings, browserIndices, results);
  }

  if (!opts.screens || opts.screens.length === 0) await pruneStaleOutputs(items);
  await removeFailedOutputs(items, results);

  const report = buildReport(project, opts, sizes, results);
  project.manifest = applyManifest(project, opts, items, results, report, startedAt);
  await writeManifest(project.manifestPath, project.manifest);
  // On disk the report covers the whole set (see withCarriedItems); the
  // sheet page reads report.json, so it is written before the sheets and
  // once more with `sheets` filled in.
  const written = opts.screens && opts.screens.length > 0 ? await withCarriedItems(project, opts, sizes, report) : report;
  await writeReport(project, written);
  await writeReview(project, written);
  // A sheet from an earlier run must never pass for this one.
  for (const sizeId of sizes) await rm(sheetPath(project, opts.locale, sizeId), { force: true });
  if (opts.sheet !== false) {
    // Sheets are a review aid: a failure here must not hide a finished render.
    try {
      // Only this run's sizes (their sheets were just deleted); a size whose screens all sat outside the filters has nothing to tile.
      const sheetSizes = sizes.filter((id) => written.items.some((i) => i.sizeId === id));
      const result = await sheetProject(project, { locale: opts.locale, sizes: sheetSizes, report: written, ...(opts.serverUrl ? { serverUrl: opts.serverUrl } : {}) });
      report.sheets = result.sheets.map(({ sizeId, displayType, path, dims, tiles }) => ({ sizeId, displayType, path, dims, tiles }));
      written.sheets = report.sheets;
    } catch (error) {
      process.stderr.write(`s1s: contact sheet skipped: ${errorMessage(error)}\n`);
    }
    await writeReport(project, written);
  }
  return report;
}
