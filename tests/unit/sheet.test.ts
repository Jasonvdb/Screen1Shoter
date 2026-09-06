// Pure contact-sheet logic: params, layout, tiles and labels from a
// RenderReport (src/web/app/sheet-model.ts) plus the Node-side helpers in
// src/render/sheet.ts that need no browser (report reading, URL, size checks).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPreset } from '../../src/config/presets.ts';
import type { RenderReport, RenderReportItem, SizeId } from '../../src/config/types.ts';
import { makeWarning } from '../../src/config/warnings.ts';
import { readReport, resolveSheetSizes, sheetUrl } from '../../src/render/sheet.ts';
import {
  SHEET_CHROME,
  SHEET_DEFAULTS,
  TILE_COLOURS,
  normaliseSheetParams,
  parseSheetParams,
  reportSizes,
  sheetLayout,
  sheetSizes,
  sheetSummary,
  sheetTile,
  sheetTiles,
  summaryText,
  tileImageUrl,
  tileLevel,
  warningSummary,
} from '../../src/web/app/sheet-model.ts';
import { catchS1sError, makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

const IPHONE = getPreset('iphone-6.9');
const IPAD = getPreset('ipad-13');

function item(overrides: Partial<RenderReportItem> & { sizeId: SizeId; screenId: string; ordinal: number }): RenderReportItem {
  return {
    key: `en-US/${overrides.sizeId}/${overrides.screenId}`,
    locale: 'en-US',
    displayTypes: [getPreset(overrides.sizeId).displayType],
    template: 'hero-top-text',
    status: 'rendered',
    outputs: [],
    preview: null,
    hash: null,
    dims: null,
    warnings: [],
    durationMs: 0,
    ...overrides,
  };
}

function report(items: RenderReportItem[], extra: Partial<RenderReport> = {}): RenderReport {
  return {
    version: 1,
    generatedAt: '2026-09-02T00:00:00.000Z',
    projectDir: '/app/screenshots',
    locale: 'en-US',
    sizes: ['iphone-6.9', 'ipad-13'],
    dryRun: false,
    items,
    counts: { rendered: 0, failed: 0, skipped: 0, errors: 0, warns: 0, infos: 0 },
    ok: true,
    sheets: [],
    ...extra,
  };
}

const SAMPLE = report([
  item({ sizeId: 'ipad-13', screenId: 'home', ordinal: 1 }),
  item({ sizeId: 'iphone-6.9', screenId: 'share', ordinal: 3, warnings: [makeWarning('text-clipped', 'clipped')] }),
  item({ sizeId: 'iphone-6.9', screenId: 'home', ordinal: 1, template: 'text-bottom', warnings: [makeWarning('font-fallback', 'x')] }),
  item({ sizeId: 'iphone-6.9', screenId: 'detail', ordinal: 2, status: 'failed', error: 'Page not ready' }),
  item({ sizeId: 'iphone-6.9', screenId: 'skipped one', ordinal: 4, status: 'skipped' }),
]);

describe('sheet params', () => {
  it('defaults and clamps', () => {
    expect(normaliseSheetParams({})).toEqual({ scale: SHEET_DEFAULTS.scale, columns: SHEET_DEFAULTS.columns });
    expect(normaliseSheetParams({ scale: 0.5, columns: 3.7 })).toEqual({ scale: 0.5, columns: 3 });
    expect(normaliseSheetParams({ scale: 0, columns: 0 })).toEqual({ scale: 0.25, columns: 5 });
    expect(normaliseSheetParams({ scale: 1.5, columns: Number.NaN })).toEqual({ scale: 0.25, columns: 5 });
    expect(normaliseSheetParams({ scale: 1, columns: 1 })).toEqual({ scale: 1, columns: 1 });
  });

  it('parses the route query and ignores junk', () => {
    expect(parseSheetParams(new URLSearchParams('scale=0.5&columns=2'))).toEqual({ scale: 0.5, columns: 2 });
    expect(parseSheetParams(new URLSearchParams('scale=abc&columns='))).toEqual({ scale: 0.25, columns: 5 });
    expect(parseSheetParams(new URLSearchParams(''))).toEqual({ scale: 0.25, columns: 5 });
  });

  it('sheetUrl keeps the query inside the hash route', () => {
    expect(sheetUrl('http://127.0.0.1:5173/', 'de-DE', 'iphone-6.9', { scale: 0.25, columns: 5 })).toBe(
      'http://127.0.0.1:5173/#/sheet/de-DE/iphone-6.9?scale=0.25&columns=5',
    );
  });
});

describe('sheetLayout', () => {
  const { padding, gap, header, caption, border } = SHEET_CHROME;

  it('tiles are the scaled output size and the sheet wraps at columns', () => {
    const layout = sheetLayout(IPHONE, { scale: 0.25, columns: 5 }, 7);
    expect(layout.tileWidth).toBe(330);
    expect(layout.tileHeight).toBe(717);
    expect(layout.cellWidth).toBe(330 + 2 * border);
    expect(layout.cellHeight).toBe(717 + caption + 2 * border);
    expect(layout.columns).toBe(5);
    expect(layout.rows).toBe(2);
    expect(layout.width).toBe(2 * padding + 5 * layout.cellWidth + 4 * gap);
    expect(layout.height).toBe(2 * padding + header + 2 * layout.cellHeight + gap);
  });

  it('never leaves empty trailing columns and is wider than tall for 3 screens at 25%', () => {
    for (const preset of [IPHONE, IPAD]) {
      const layout = sheetLayout(preset, { scale: 0.25, columns: 5 }, 3);
      expect(layout.columns).toBe(3);
      expect(layout.rows).toBe(1);
      expect(layout.width).toBeGreaterThan(layout.height);
    }
  });

  it('one column, one tile, tiny scale still yields at least 1 px tiles', () => {
    const layout = sheetLayout(IPHONE, { scale: 0.0001, columns: 1 }, 1);
    expect(layout.tileWidth).toBe(1);
    expect(layout.tileHeight).toBe(1);
    expect(layout.rows).toBe(1);
    expect(sheetLayout(IPHONE, { scale: 0.25, columns: 3 }, 0).rows).toBe(1);
  });
});

describe('tiles', () => {
  it('image URL is under /project/out with the render file name, encoded', () => {
    expect(tileImageUrl(item({ sizeId: 'iphone-6.9', screenId: 'skipped one', ordinal: 4 }))).toBe(
      '/project/out/en-US/APP_IPHONE_69/04-skipped%20one.png',
    );
    expect(tileImageUrl(item({ sizeId: 'iphone-6.9', screenId: 'a', ordinal: 1, status: 'failed' }))).toBeNull();
    expect(tileImageUrl(item({ sizeId: 'iphone-6.9', screenId: 'a', ordinal: 1, status: 'skipped' }))).toBeNull();
    expect(tileImageUrl(item({ sizeId: 'watch-s10', screenId: 'g', ordinal: 2, status: 'passthrough' }))).toBe(
      '/project/out/en-US/APP_WATCH_SERIES_10/02-g.png',
    );
    expect(tileImageUrl(item({ sizeId: 'iphone-6.9', screenId: 'a', ordinal: 1, displayTypes: [] }))).toBeNull();
  });

  it('labels, severity and colours per item', () => {
    const ok = sheetTile(item({ sizeId: 'iphone-6.9', screenId: 'home', ordinal: 1 }));
    expect(ok).toMatchObject({ label: '01', screenId: 'home', template: 'hero-top-text', status: 'rendered', level: 'ok', summary: 'ok', error: null });
    expect(TILE_COLOURS[ok.level]).toBe('#3f3f46');

    const warned = sheetTile(item({ sizeId: 'iphone-6.9', screenId: 'x', ordinal: 12, warnings: [makeWarning('font-fallback', 'f'), makeWarning('capture-fallback-locale', 'i')] }));
    expect(warned.label).toBe('12');
    expect(warned.level).toBe('warn');
    expect(warned.summary).toBe('1 warn, 1 info');

    const errored = sheetTile(item({ sizeId: 'iphone-6.9', screenId: 'x', ordinal: 2, warnings: [makeWarning('text-clipped', 'c'), makeWarning('overflow', 'o')] }));
    expect(errored.level).toBe('error');
    expect(errored.summary).toBe('2 errors');
    expect(TILE_COLOURS[errored.level]).toBe('#ef4444');

    const failed = sheetTile(item({ sizeId: 'iphone-6.9', screenId: 'x', ordinal: 3, status: 'failed', error: 'boom' }));
    expect(failed).toMatchObject({ status: 'failed', level: 'error', error: 'boom', imageUrl: null });
    expect(sheetTile(item({ sizeId: 'iphone-6.9', screenId: 'x', ordinal: 3, status: 'failed' })).error).toBe('render failed');

    const skipped = sheetTile(item({ sizeId: 'iphone-6.9', screenId: 'x', ordinal: 3, status: 'skipped' }));
    expect(skipped).toMatchObject({ status: 'missing', level: 'warn', error: null, imageUrl: null });
  });

  it('tileLevel and warningSummary are consistent with the report counts', () => {
    expect(tileLevel('rendered', { error: 0, warn: 0, info: 3 })).toBe('ok');
    expect(tileLevel('rendered', { error: 0, warn: 1, info: 0 })).toBe('warn');
    expect(tileLevel('missing', { error: 0, warn: 0, info: 0 })).toBe('warn');
    expect(tileLevel('failed', { error: 0, warn: 0, info: 0 })).toBe('error');
    expect(warningSummary({ error: 1, warn: 2, info: 0 })).toBe('1 error, 2 warn');
    expect(warningSummary({ error: 0, warn: 0, info: 0 })).toBe('ok');
  });

  it('sheetTiles filters one size, sorts by ordinal and collapses aliases', () => {
    const tiles = sheetTiles(SAMPLE, 'iphone-6.9');
    expect(tiles.map((t) => `${t.label} ${t.screenId}`)).toEqual(['01 home', '02 detail', '03 share', '04 skipped one']);
    expect(sheetTiles(SAMPLE, 'iphone-6.7').map((t) => t.key)).toEqual(tiles.map((t) => t.key));
    expect(sheetTiles(SAMPLE, 'ipad-13')).toHaveLength(1);
    expect(sheetTiles(SAMPLE, 'watch-s10')).toEqual([]);
    expect(sheetTiles(SAMPLE, 'nope')).toEqual([]);
  });

  it('sheetSummary and summaryText', () => {
    const summary = sheetSummary(sheetTiles(SAMPLE, 'iphone-6.9'));
    expect(summary).toEqual({ tiles: 4, rendered: 2, failed: 1, errors: 1, warns: 1, infos: 0 });
    expect(summaryText(summary)).toBe('1 failed, 1 error, 1 warn');
    expect(summaryText(sheetSummary(sheetTiles(SAMPLE, 'ipad-13')))).toBe('ok');
  });
});

describe('sizes', () => {
  it('reportSizes keeps report order; sheetSizes maps aliases and reports absent ids', () => {
    expect(reportSizes(SAMPLE)).toEqual(['ipad-13', 'iphone-6.9']);
    expect(sheetSizes(SAMPLE)).toEqual({ sizes: ['ipad-13', 'iphone-6.9'], absent: [] });
    expect(sheetSizes(SAMPLE, ['iphone-6.7', 'iphone-6.9', 'watch-s10', 'bogus'])).toEqual({
      sizes: ['iphone-6.9'],
      absent: ['watch-s10', 'bogus'],
    });
  });

  it('resolveSheetSizes: usage errors for dry runs, unknown, unrendered and empty', async () => {
    const path = '/app/screenshots/out/en-US/report.json';
    expect(resolveSheetSizes(SAMPLE, path)).toEqual(['ipad-13', 'iphone-6.9']);
    expect(resolveSheetSizes(SAMPLE, path, ['iphone-6.7'])).toEqual(['iphone-6.9']);
    const dry = await catchS1sError(Promise.resolve().then(() => resolveSheetSizes(report([], { dryRun: true }), path)));
    expect(dry.code).toBe('usage');
    expect(dry.message).toContain('dry run');
    const unknown = await catchS1sError(Promise.resolve().then(() => resolveSheetSizes(SAMPLE, path, ['bogus'])));
    expect(unknown.message).toContain('Unknown size "bogus"');
    const absent = await catchS1sError(Promise.resolve().then(() => resolveSheetSizes(SAMPLE, path, ['watch-s10'])));
    expect(absent.message).toContain('watch-s10');
    expect(absent.hint).toContain('--sizes watch-s10');
    const empty = await catchS1sError(Promise.resolve().then(() => resolveSheetSizes(report([]), path)));
    expect(empty.message).toContain('no items');
  });
});

describe('readReport', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('s1s-sheet-');
  });
  afterEach(() => tmp.cleanup());

  it('missing, unparsable and wrong-shape files are usage errors with a render hint', async () => {
    const project = { dir: tmp.dir };
    const missing = await catchS1sError(readReport(project, 'en-US'));
    expect(missing.code).toBe('usage');
    expect(missing.hint).toContain('s1s render --locale en-US');

    await mkdir(join(tmp.dir, 'out', 'en-US'), { recursive: true });
    await writeFile(join(tmp.dir, 'out', 'en-US', 'report.json'), '{not json');
    expect((await catchS1sError(readReport(project, 'en-US'))).message).toContain('Cannot parse');

    await writeFile(join(tmp.dir, 'out', 'en-US', 'report.json'), JSON.stringify({ version: 2 }));
    expect((await catchS1sError(readReport(project, 'en-US'))).message).toContain('not a render report');
  });

  it('returns the parsed report', async () => {
    await mkdir(join(tmp.dir, 'out', 'en-US'), { recursive: true });
    await writeFile(join(tmp.dir, 'out', 'en-US', 'report.json'), JSON.stringify(SAMPLE));
    const parsed = await readReport({ dir: tmp.dir }, 'en-US');
    expect(parsed.items.map((i) => i.key)).toEqual(SAMPLE.items.map((i) => i.key));
    expect(must(parsed.items[3]).error).toBe('Page not ready');
  });
});
