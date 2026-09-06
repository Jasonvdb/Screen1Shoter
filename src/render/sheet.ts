// Contact sheets: one PNG per rendered size, out/<locale>/sheet-<sizeId>.png.
// Opens /#/sheet/<locale>/<sizeId>?scale&columns (src/web/app/SheetPage.tsx)
// in Chromium at device scale factor 1 and screenshots the full page. The
// page lays its tiles out from report.json and the PNGs on disk, so the sheet
// needs a finished `s1s render`, not a browser render of every screen again.
// Output is RGB, no alpha, exactly the size sheet-model.ts predicts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Browser, Page } from 'playwright';
import sharp from 'sharp';
import { dimsEqual, formatDims, getPreset, isSizeId } from '../config/presets.ts';
import { sheetRoute } from '../config/resolve.ts';
import type { AppDisplayType, Dims, RenderReport, SizeId } from '../config/types.ts';
import { S1sError } from '../core/errors.ts';
import { bezelDir, reportPath, sheetPath } from '../core/paths.ts';
import type { Project } from '../core/project.ts';
import {
  SHEET_BACKGROUND,
  normaliseSheetParams,
  sheetLayout,
  sheetSizes,
  sheetSummary,
  sheetTiles,
  type SheetParams,
  type SheetSummary,
} from '../web/app/sheet-model.ts';
import { launchBrowser } from './browser.ts';
import { createS1sServer, type S1sServer } from './server.ts';

export interface SheetOptions {
  locale: string;
  /** Size ids (aliases allowed). Default: every size in the report. */
  sizes?: string[];
  /** Tile size as a fraction of the output PNG. Default 0.25. */
  scale?: number;
  /** Tiles per row. Default 5. */
  columns?: number;
  /** Reuse a running server (render.ts, tests). */
  serverUrl?: string;
  /** Already-loaded report; default: read out/<locale>/report.json. */
  report?: RenderReport;
  onProgress?: (sheet: SheetFile) => void;
}

export interface SheetFile {
  sizeId: SizeId;
  displayType: AppDisplayType;
  /** Absolute: out/<locale>/sheet-<sizeId>.png */
  path: string;
  dims: Dims;
  scale: number;
  columns: number;
  rows: number;
  tiles: number;
  summary: SheetSummary;
}

export interface SheetResult {
  locale: string;
  reportPath: string;
  scale: number;
  columns: number;
  sheets: SheetFile[];
}

const GOTO_TIMEOUT_MS = 60_000;
/** The first page load also transforms every module; later sheets reuse them. */
const READY_TIMEOUT_MS = 90_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads and shape-checks out/<locale>/report.json. */
export async function readReport(project: Pick<Project, 'dir'>, locale: string): Promise<RenderReport> {
  const path = reportPath(project, locale);
  const hint = `Run \`s1s render --locale ${locale}\` first.`;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new S1sError('usage', `No render report at ${path}.`, { hint });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new S1sError('usage', `Cannot parse ${path}: ${errorMessage(error)}`, { hint });
  }
  const report = parsed as Partial<RenderReport>;
  if (report.version !== 1 || !Array.isArray(report.items) || typeof report.locale !== 'string') {
    throw new S1sError('usage', `${path} is not a render report.`, { hint });
  }
  return report as RenderReport;
}

/** Full page URL of one sheet; the query lives inside the hash so the router sees it. */
export function sheetUrl(baseUrl: string, locale: string, sizeId: string, params: SheetParams): string {
  return `${baseUrl.replace(/\/+$/, '')}${sheetRoute(locale, sizeId)}?scale=${params.scale}&columns=${params.columns}`;
}

/** Sizes to sheet, or a usage error naming what is unknown or not rendered. */
export function resolveSheetSizes(report: RenderReport, path: string, requested?: readonly string[]): SizeId[] {
  if (report.dryRun) {
    throw new S1sError('usage', `${path} comes from a dry run; nothing was rendered.`, {
      hint: `Run \`s1s render --locale ${report.locale}\` without --dry-run.`,
    });
  }
  const { sizes, absent } = sheetSizes(report, requested);
  const unknown = absent.filter((id) => !isSizeId(id));
  if (unknown.length > 0) throw new S1sError('usage', `Unknown size ${unknown.map((id) => `"${id}"`).join(', ')}.`);
  if (absent.length > 0) {
    throw new S1sError('usage', `No rendered items for ${absent.join(', ')} in ${path}.`, {
      hint: `Run \`s1s render --locale ${report.locale} --sizes ${absent.join(',')}\` first.`,
    });
  }
  if (sizes.length === 0) {
    throw new S1sError('usage', `${path} has no items.`, { hint: `Run \`s1s render --locale ${report.locale}\` first.` });
  }
  return sizes;
}

/** Flattens the screenshot to RGB and asserts the size the layout predicted. */
export async function finishSheet(buffer: Buffer, expected: Dims): Promise<{ png: Buffer; dims: Dims }> {
  const out = await sharp(buffer)
    .flatten({ background: SHEET_BACKGROUND })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const dims: Dims = { width: out.info.width, height: out.info.height };
  if (out.info.channels !== 3) throw new S1sError('render-failed', `Sheet has ${out.info.channels} channels after flattening, expected 3`);
  if (!dimsEqual(dims, expected)) {
    throw new S1sError('dims-mismatch', `Sheet is ${formatDims(dims)}, expected ${formatDims(expected)}`, {
      hint: 'SheetPage.tsx and sheet-model.ts disagree about the chrome sizes.',
    });
  }
  return { png: out.data, dims };
}

const READY_EXPR = (key: string): string =>
  `window.__S1S_READY === true && (` +
  `(document.querySelector('[data-s1s-sheet]')?.getAttribute('data-s1s-sheet') ?? null) === ${JSON.stringify(key)}` +
  ` || document.querySelector('[data-s1s-id="error"]') !== null)`;
const ERROR_EXPR = `document.querySelector('[data-s1s-id="error"]')?.textContent ?? null`;

async function shootSheet(page: Page, log: string[], url: string, key: string, dims: Dims): Promise<Buffer> {
  log.length = 0;
  await page.setViewportSize(dims);
  await page.evaluate('window.__S1S_READY = false;');
  await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
  try {
    await page.waitForFunction(READY_EXPR(key), undefined, { timeout: READY_TIMEOUT_MS, polling: 'raf' });
  } catch (error) {
    const tail = log.length > 0 ? ` Console: ${log.join(' | ')}` : '';
    throw new S1sError('render-failed', `Sheet page not ready: ${errorMessage(error).split('\n')[0] ?? 'timeout'} [${url}]${tail}`);
  }
  const panel = await page.evaluate<string | null>(ERROR_EXPR);
  if (panel !== null) {
    throw new S1sError('render-failed', `Sheet page reported an error: ${panel.trim().replace(/\s*\n\s*/g, ' | ')} [${url}]`);
  }
  return page.screenshot({ type: 'png', fullPage: true, animations: 'disabled', caret: 'hide', timeout: SCREENSHOT_TIMEOUT_MS });
}

/**
 * Writes out/<locale>/sheet-<sizeId>.png for every requested (or every
 * rendered) size and returns what was written. Throws on a missing report,
 * unknown or unrendered sizes, or a page that never becomes ready.
 */
export async function sheetProject(project: Project, opts: SheetOptions): Promise<SheetResult> {
  const params = normaliseSheetParams({ scale: opts.scale, columns: opts.columns });
  const path = reportPath(project, opts.locale);
  const report = opts.report ?? (await readReport(project, opts.locale));
  const sizes = resolveSheetSizes(report, path, opts.sizes);

  let server: S1sServer | null = null;
  let browser: Browser | null = null;
  const sheets: SheetFile[] = [];
  try {
    if (!opts.serverUrl) {
      server = await createS1sServer({ projectDir: project.dir, bezelDir: bezelDir(), mode: 'render', project, locale: opts.locale });
    }
    const baseUrl = opts.serverUrl ?? server?.url ?? '';
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: 'light',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const log: string[] = [];
    page.on('pageerror', (error) => log.push(`pageerror: ${error.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') log.push(`console.error: ${msg.text()}`);
    });

    for (const sizeId of sizes) {
      const preset = getPreset(sizeId);
      const tiles = sheetTiles(report, sizeId);
      const layout = sheetLayout(preset, params, tiles.length);
      const expected: Dims = { width: layout.width, height: layout.height };
      const shot = await shootSheet(page, log, sheetUrl(baseUrl, opts.locale, sizeId, params), `${opts.locale}/${sizeId}`, expected);
      const { png, dims } = await finishSheet(shot, expected);
      const out = sheetPath(project, opts.locale, sizeId);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, png);
      const sheet: SheetFile = {
        sizeId,
        displayType: preset.displayType,
        path: out,
        dims,
        scale: layout.scale,
        columns: layout.columns,
        rows: layout.rows,
        tiles: tiles.length,
        summary: sheetSummary(tiles),
      };
      sheets.push(sheet);
      opts.onProgress?.(sheet);
    }
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
  return { locale: opts.locale, reportPath: path, scale: params.scale, columns: params.columns, sheets };
}
