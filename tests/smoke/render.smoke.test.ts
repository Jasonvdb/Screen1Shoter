// End-to-end render of a copy of example/screenshots through Vite + Chromium
// with a synthetic bezel cache in a temp S1S_HOME: exact-size RGB PNGs, the
// installed bezel drawn around every capture (no bezel-fallback), previews,
// contact sheets, report.json, review.md and manifest render fields. Two
// smaller projects follow: a watch set (passthrough, no browser) and an
// iPad feature-grid set with callouts. Needs Playwright's Chromium
// (`s1s doctor`); never touches the network.
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeExampleCaptures } from '../../example/screenshots/make-captures.ts';
import { linkProject } from '../../src/cli/commands/link.ts';
import { getPreset } from '../../src/config/presets.ts';
import { captureRelPath, screenAppliesTo } from '../../src/config/resolve.ts';
import type { BezelIndex, LocaleCopy, Rect, RenderReport, RenderReportItem, ScreensConfig } from '../../src/config/types.ts';
import { bezelIndexPath } from '../../src/core/bezels/index.ts';
import { imageState, readManifest } from '../../src/core/manifest.ts';
import { bezelDir, reportPath, reviewPath, sheetPath, sizeOutDir } from '../../src/core/paths.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { PREVIEW_SCALE } from '../../src/render/post.ts';
import { renderProject } from '../../src/render/render.ts';
import { normaliseSheetParams, sheetLayout } from '../../src/web/app/sheet-model.ts';
import { LAYOUT } from '../../src/web/templates/two-device-layout.ts';
import { copyExampleProject, hexToRgb, makeTempDir, must, parseJsonLine, pngInfo, runS1s, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import {
  BEZEL_BODY_RGB,
  centerOf,
  colorBounds,
  countColor,
  inset,
  pixelAt,
  locateColor,
  projectBezel,
  readRaw,
  writeSyntheticBezelHome,
} from '../fixtures/make-bezel.ts';
import { makeCapture } from '../fixtures/make-capture.ts';

// src/core/paths.ts reads S1S_HOME when it loads, so the temp cache dir must
// exist in the environment before any import above runs. Vitest hoists this
// call above the imports.
const HOME = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: joinPath } = await import('node:path');
  const dir = mkdtempSync(joinPath(tmpdir(), 's1s-home-'));
  process.env['S1S_HOME'] = dir;
  return dir;
});

const SIZES = ['iphone-6.9', 'ipad-13'] as const;
/** preset.bezel of the two sizes; installed synthetically into HOME. */
const BEZEL_IDS = ['iphone-17-pro-max', 'ipad-pro-13-m5'] as const;
/** Warnings a clean machine may still report (the default font stack names SF Pro). */
const TOLERATED = new Set(['font-fallback']);

const find = (report: RenderReport, key: string): RenderReportItem => must(report.items.find((i) => i.key === key), key);
const codes = (item: RenderReportItem): string[] => item.warnings.map((w) => w.code);
const unexpectedWarnings = (item: RenderReportItem): string[] =>
  item.warnings.filter((w) => !TOLERATED.has(w.code)).map((w) => `${w.code}: ${w.message}`);
const NN = (ordinal: number): string => String(ordinal).padStart(2, '0');

/**
 * A capture clipped with the wrong radius shows the canvas background at the
 * screen corners: a 2 px radius error already leaves ~100 background pixels
 * per corner at iPad scale. The scanned region is the screen shape (rounded
 * corners) shrunk by 3 px, so the bezel body outside the corners is not
 * counted. Where the clip and the cut-out coincide exactly, anti-aliasing may
 * blend a handful of seam pixels back to the background; those are tolerated.
 */
const SEAM_PIXEL_BUDGET = 8;
function expectNoScreenGap(raw: Awaited<ReturnType<typeof readRaw>>, background: [number, number, number], screen: Rect, radius: number, what: string): void {
  const region = inset(screen, 3);
  const r = Math.max(0, radius - 3);
  const count = countColor(raw, background, region, 1, r);
  const sample = locateColor(raw, background, region, 1, 8, r);
  expect(count, `${what}: ${count} canvas-background pixels inside the screen, e.g. ${JSON.stringify(sample)}`).toBeLessThanOrEqual(SEAM_PIXEL_BUDGET);
}

describe('render example/ with bezels (smoke)', () => {
  let tmp: TempDir;
  let project: Project;
  let report: RenderReport;
  let bezels: BezelIndex;

  beforeAll(async () => {
    bezels = await writeSyntheticBezelHome(HOME, BEZEL_IDS);
    tmp = await makeTempDir('s1s-smoke-');
    const dir = await copyExampleProject(join(tmp.dir, 'Example', 'screenshots'));
    await writeExampleCaptures(dir);
    await linkProject(dir);
    project = await loadProject({ projectDir: dir });
    // Contact sheets stay on (the default) so the sheet test below sees what `s1s render` writes.
    report = await renderProject(project, { locale: 'en-US', sizes: [...SIZES] });
  });
  afterAll(async () => {
    await tmp.cleanup();
    await rm(HOME, { recursive: true, force: true });
  });

  it('reads the bezel cache from the temp S1S_HOME', () => {
    expect(bezelDir()).toBe(join(HOME, 'bezels'));
    expect(existsSync(bezelIndexPath())).toBe(true);
    for (const sizeId of SIZES) expect(bezels.entries.map((e) => e.id)).toContain(getPreset(sizeId).bezel);
  });

  it('renders every item without failures, error-level warnings or bezel fallbacks', () => {
    // Every example screen that applies to the size, in screens.ts order, iPhone first.
    const expectedKeys = SIZES.flatMap((sizeId) =>
      project.screens.screens.filter((screen) => screenAppliesTo(screen, getPreset(sizeId))).map((screen) => `en-US/${sizeId}/${screen.id}`),
    );
    expect(expectedKeys).toContain('en-US/iphone-6.9/home');
    expect(expectedKeys).toContain('en-US/ipad-13/home');
    expect(report.items.map((i) => i.key)).toEqual(expectedKeys);
    const failures = report.items.filter((i) => i.status === 'failed').map((i) => `${i.key}: ${i.error ?? ''}`);
    expect(failures).toEqual([]);
    expect(report.counts.failed).toBe(0);
    expect(report.counts.errors).toBe(0);
    expect(report.ok).toBe(true);
    for (const item of report.items) {
      expect(item.status, item.key).toBe('rendered');
      expect(item.hash).toMatch(/^[0-9a-f]{40}$/);
      const unexpected = item.warnings.filter((w) => !TOLERATED.has(w.code)).map((w) => `${w.code}: ${w.message}`);
      expect(unexpected, item.key).toEqual([]);
      // Optional: a report that names the bezel it used must name the preset's own bezel.
      const exposed = (item as unknown as Record<string, unknown>)['bezel'];
      if (exposed !== undefined) expect(JSON.stringify(exposed), item.key).toContain(getPreset(item.sizeId).bezel);
    }
  });

  it('writes exact preset.px PNGs with 3 channels, no alpha, plus 1/3 previews', async () => {
    for (const item of report.items) {
      const preset = getPreset(item.sizeId);
      expect(item.dims).toEqual(preset.px);
      expect(item.outputs).toHaveLength(1);
      for (const out of item.outputs) {
        expect(await pngInfo(out), out).toEqual({ width: preset.px.width, height: preset.px.height, channels: 3, hasAlpha: false });
      }
      const preview = await sharp(must(item.preview)).metadata();
      expect(preview.width).toBe(Math.round(preset.px.width * PREVIEW_SCALE));
      expect(preview.hasAlpha).toBe(false);
    }
  });

  it('draws the installed bezel around the capture: island on top, no background at the screen corners', async () => {
    const background = hexToRgb(project.theme.background);
    for (const sizeId of SIZES) {
      const preset = getPreset(sizeId);
      const entry = must(bezels.entries.find((e) => e.id === preset.bezel), preset.bezel);
      const out = must(find(report, `en-US/${sizeId}/home`).outputs[0]);
      const raw = await readRaw(out);
      const body = colorBounds(raw, BEZEL_BODY_RGB);
      expect(body, `${sizeId}: the bezel body (magenta) is not in ${out}`).not.toBeNull();
      const bodyRect = must(body);
      expect(bodyRect.width / bodyRect.height, `${sizeId}: body aspect`).toBeCloseTo(entry.deviceRect.width / entry.deviceRect.height, 2);

      const { k, screen, island, radius } = projectBezel(entry, bodyRect);
      // The frame is scaled to the template's device slot, never enlarged.
      expect(k, `${sizeId}: scale`).toBeGreaterThan(0.3);
      expect(k, `${sizeId}: scale`).toBeLessThanOrEqual(1);
      expectNoScreenGap(raw, background, screen, radius, sizeId);
      if (island) {
        const centre = centerOf(island);
        expect(pixelAt(raw, centre.x, centre.y), `${sizeId}: Dynamic Island must cover the capture`).toEqual([0, 0, 0]);
      } else {
        expect(entry.islandRect, `${sizeId}: iPad bezels have no island`).toBeUndefined();
      }
    }
  });

  it('writes report.json and review.md, and records the render in the manifest', async () => {
    const written = JSON.parse(await readFile(reportPath(project, 'en-US'), 'utf8')) as RenderReport;
    expect(written.ok).toBe(true);
    expect(written.items.map((i) => i.hash)).toEqual(report.items.map((i) => i.hash));
    expect(existsSync(reviewPath(project, 'en-US'))).toBe(true);
    const review = await readFile(reviewPath(project, 'en-US'), 'utf8');
    expect(review).toContain('Result: OK');
    expect(review).toContain('## iphone-6.9 (APP_IPHONE_69)');

    const manifest = await readManifest(project.manifestPath);
    for (const item of report.items) {
      const state = must(imageState(manifest, 'en-US', item.sizeId, item.screenId), item.key);
      expect(state.status).toBe('generated');
      expect(state.renderHash).toBe(item.hash);
      expect(state.render).toBe(`out/en-US/${item.displayTypes[0]}/${String(item.ordinal).padStart(2, '0')}-${item.screenId}.png`);
      expect(codes({ ...item, warnings: state.renderWarnings ?? [] })).not.toContain('bezel-fallback');
    }
    expect(manifest.runs.at(-1)?.command).toBe('render --locale en-US --sizes iphone-6.9,ipad-13');
  });

  it('writes a contact sheet per size at the default 25% / 5 columns: wider than tall, sized by sheetLayout', async () => {
    for (const sizeId of SIZES) {
      const path = sheetPath(project, 'en-US', sizeId);
      expect(existsSync(path), path).toBe(true);
      const info = await pngInfo(path);
      expect(info.hasAlpha, path).toBe(false);
      expect(info.width, `${sizeId}: sheet ${info.width}x${info.height}`).toBeGreaterThan(info.height);
      const tiles = report.items.filter((i) => i.sizeId === sizeId).length;
      expect(tiles).toBeGreaterThanOrEqual(3);
      const layout = sheetLayout(getPreset(sizeId), normaliseSheetParams({}), tiles);
      expect({ width: info.width, height: info.height }, `${sizeId}: sheet dims for ${tiles} tiles`).toEqual({ width: layout.width, height: layout.height });
    }
  });

  it('two-device (compare, iphone-6.9): two frames, the front one lower by offsetY, the back island uncovered', async () => {
    const preset = getPreset('iphone-6.9');
    const item = find(report, 'en-US/iphone-6.9/compare');
    expect(item.template).toBe('two-device');
    expect(codes(item)).not.toContain('overflow');
    const entry = must(bezels.entries.find((e) => e.id === preset.bezel), preset.bezel);
    const raw = await readRaw(must(item.outputs[0]));
    const whole = must(colorBounds(raw, BEZEL_BODY_RGB), 'bezel bodies (magenta) in the two-device render');
    // The pair spans padX..padX+pairWidth; the back device is alone in the left quarter, the front one alone in the right quarter.
    const quarter = Math.floor(whole.width / 4);
    const back = must(colorBounds(raw, BEZEL_BODY_RGB, 0, { x: whole.x, y: 0, width: quarter, height: raw.height }), 'back device');
    const front = must(colorBounds(raw, BEZEL_BODY_RGB, 0, { x: whole.x + whole.width - quarter, y: 0, width: quarter, height: raw.height }), 'front device');
    expect(back.x + back.width).toBeLessThan(front.x);
    // layoutScale(preset) = pt width / REF_WIDTH.iphone (440), 1 on iphone-6.9; Canvas.tsx is browser-only.
    const expectedOffset = LAYOUT.iphone.offsetY * (preset.pt.width / 440) * preset.scale;
    expect(front.y - back.y, 'front top below back top by offsetY').toBeGreaterThanOrEqual(expectedOffset - 2);
    expect(front.y - back.y).toBeLessThanOrEqual(expectedOffset + 2);
    expect(front.y + front.height, 'front bottom below back bottom').toBeGreaterThan(back.y + back.height);
    // Two full frames: each device is as tall as the whole pair minus the offset.
    const deviceHeight = whole.height - (front.y - back.y);
    expect(back.height, 'back device height').toBeCloseTo(deviceHeight, -1);
    expect(front.height, 'front device height').toBeCloseTo(deviceHeight, -1);
    // The offset clears the back device's Dynamic Island: its bottom edge lies above the front device's top.
    const k = deviceHeight / entry.deviceRect.height;
    const islandBottom = back.y + (must(entry.islandRect).y - entry.deviceRect.y + must(entry.islandRect).height) * k;
    expect(islandBottom, 'back island bottom vs front top').toBeLessThan(front.y);
  });

  it('re-rendering a screen produces identical hashes and keeps the other screens in report.json', async () => {
    const again = await renderProject(project, { locale: 'en-US', sizes: [...SIZES], screens: ['home'], sheet: false });
    expect(again.ok).toBe(true);
    expect(again.items.map((i) => i.key)).toEqual(['en-US/iphone-6.9/home', 'en-US/ipad-13/home']);
    for (const item of again.items) expect(item.hash, item.key).toBe(find(report, item.key).hash);
    // The PNGs of the other screens are still on disk, so the report on disk still lists the whole set.
    const written = JSON.parse(await readFile(reportPath(project, 'en-US'), 'utf8')) as RenderReport;
    expect(written.items.map((i) => i.key)).toEqual(report.items.map((i) => i.key));
    expect(written.counts.rendered).toBe(report.items.length);
    expect(written.sheets).toEqual([]);
  });

  it('`s1s sheet --scale 0.1 --columns 2 --json` re-lays out every size from report.json', async () => {
    const run = await runS1s(['sheet', '--project', project.dir, '--scale', '0.1', '--columns', '2', '--json'], { timeoutMs: 240_000 });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<{ ok: boolean; scale: number; columns: number; sheets: Array<{ sizeId: string; path: string; dims: { width: number; height: number }; tiles: number }> }>(run);
    expect(json.ok).toBe(true);
    expect([json.scale, json.columns]).toEqual([0.1, 2]);
    expect(json.sheets.map((s) => s.sizeId)).toEqual([...SIZES]);
    for (const sheet of json.sheets) {
      const sizeId = sheet.sizeId as (typeof SIZES)[number];
      const tiles = report.items.filter((i) => i.sizeId === sizeId).length;
      expect(tiles).toBe(5);
      expect(sheet.tiles).toBe(tiles);
      const layout = sheetLayout(getPreset(sizeId), { scale: 0.1, columns: 2 }, tiles);
      expect(sheet.dims, sizeId).toEqual({ width: layout.width, height: layout.height });
      expect(sheet.path).toBe(sheetPath(project, 'en-US', sizeId));
      expect(await pngInfo(sheet.path)).toEqual({ width: layout.width, height: layout.height, channels: 3, hasAlpha: false });
    }
  });
});

// ---------------------------------------------------------------------------
// Watch: passthrough sizes copy the capture, no browser involved
// ---------------------------------------------------------------------------

describe('watch passthrough (smoke)', () => {
  let tmp: TempDir;
  const WATCH_IDS = ['stats', 'summary'] as const;
  const preset = getPreset('watch-s10');

  beforeAll(async () => {
    tmp = await makeTempDir('s1s-smoke-watch-');
  });
  afterAll(async () => {
    await tmp.cleanup();
  });

  it('flows a 416x496 capture to out/<locale>/APP_WATCH_SERIES_10/NN-<id>.png unchanged', async () => {
    const screens: ScreensConfig = {
      sizes: ['watch-s10'],
      locales: ['en-US'],
      screens: WATCH_IDS.map((id) => ({ id, only: ['watch'] })),
    };
    const copy: LocaleCopy = { locale: 'en-US', screens: { stats: { headline: 'Live Stats' }, summary: { headline: 'Ride Summary' } } };
    const dir = await writeTempProject(join(tmp.dir, 'screenshots'), { screens, copies: { 'en-US': copy } });
    const sources = new Map<string, string>();
    for (const [index, id] of WATCH_IDS.entries()) {
      const path = join(dir, captureRelPath('en-US', 'watch', id));
      sources.set(id, await makeCapture(path, preset.captureDims, { background: index === 0 ? '#1d3557' : '#3a0f2e', label: id }));
    }
    expect(await pngInfo(must(sources.get('stats')))).toEqual({ width: 416, height: 496, channels: 3, hasAlpha: false });

    const project = await loadProject({ projectDir: dir });
    expect(project.sizes).toEqual(['watch-s10']);
    const report = await renderProject(project, { locale: 'en-US', sheet: false });
    expect(report.items.filter((i) => i.status === 'failed').map((i) => `${i.key}: ${i.error ?? ''}`)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.counts.errors).toBe(0);
    expect(report.items.map((i) => i.key)).toEqual(['en-US/watch-s10/stats', 'en-US/watch-s10/summary']);

    const outDir = sizeOutDir(project, 'en-US', 'APP_WATCH_SERIES_10');
    expect(outDir).toBe(join(dir, 'out', 'en-US', 'APP_WATCH_SERIES_10'));
    for (const item of report.items) {
      expect(item.status, item.key).toBe('passthrough');
      expect(item.template, item.key).toBe('raw');
      expect(item.displayTypes).toEqual(['APP_WATCH_SERIES_10']);
      expect(item.dims).toEqual(preset.px);
      expect(item.outputs).toEqual([join(outDir, `${NN(item.ordinal)}-${item.screenId}.png`)]);
      expect(unexpectedWarnings(item), item.key).toEqual([]);
      expect(codes(item)).not.toContain('bezel-fallback');
      const out = must(item.outputs[0]);
      expect(await pngInfo(out), out).toEqual({ width: 416, height: 496, channels: 3, hasAlpha: false });
      // Pixel-identical to the capture: passthrough must never scale, pad or frame a watch shot.
      const source = await readRaw(must(sources.get(item.screenId)));
      const written = await readRaw(out);
      expect([written.width, written.height, written.channels]).toEqual([source.width, source.height, source.channels]);
      expect(written.data.equals(source.data), `${item.key}: output pixels differ from the capture`).toBe(true);
      expect(existsSync(must(item.preview)), `${item.key}: preview`).toBe(true);
    }
    const manifest = await readManifest(project.manifestPath);
    expect(must(imageState(manifest, 'en-US', 'watch-s10', 'stats')).status).toBe('generated');
  });
});

// ---------------------------------------------------------------------------
// feature-grid: iPad layout with callout cards
// ---------------------------------------------------------------------------

describe('feature-grid on ipad-13 (smoke)', () => {
  const CALLOUTS = [
    { title: 'Start Fast', body: 'One tap and the lap timer is running' },
    { title: 'See Every Lap', body: 'Splits, sectors and your best line' },
    { title: 'Share the Ride', body: 'A card your friends can open anywhere' },
  ];
  let tmp: TempDir;
  let project: Project;
  let report: RenderReport;
  let item: RenderReportItem;
  let bezels: BezelIndex;

  beforeAll(async () => {
    // Same cache layout as the first block; rewriting it keeps this block independent of test order.
    bezels = await writeSyntheticBezelHome(HOME, BEZEL_IDS);
    tmp = await makeTempDir('s1s-smoke-grid-');
    const dir = await copyExampleProject(join(tmp.dir, 'Example', 'screenshots'));
    const screens: ScreensConfig = {
      sizes: ['ipad-13'],
      locales: ['en-US'],
      screens: [{ id: 'grid', template: 'feature-grid', only: ['ipad'], notes: 'Three reasons in one shot.' }],
    };
    await writeFile(
      join(dir, 'screens.ts'),
      `import { defineScreens } from 'screen1shoter/config';\nexport default defineScreens(${JSON.stringify(screens)});\n`,
    );
    const copy: LocaleCopy = {
      locale: 'en-US',
      screens: { grid: { headline: 'Built for Race Day', highlight: 'Race Day', subline: 'Everything the pit crew needs', callouts: CALLOUTS } },
    };
    await writeFile(join(dir, 'copy', 'en-US.json'), `${JSON.stringify(copy, null, 2)}\n`);
    await makeCapture(join(dir, captureRelPath('en-US', 'ipad', 'grid')), getPreset('ipad-13').captureDims, { label: 'grid' });
    await linkProject(dir);
    project = await loadProject({ projectDir: dir });
    report = await renderProject(project, { locale: 'en-US', sizes: ['ipad-13'], sheet: false });
    item = find(report, 'en-US/ipad-13/grid');
  });
  afterAll(async () => {
    await tmp.cleanup();
    await rm(HOME, { recursive: true, force: true });
  });

  it('renders with the callouts copy: exact size, no warnings, no fallback frame', async () => {
    expect(item.status, item.error ?? '').toBe('rendered');
    expect(report.ok).toBe(true);
    expect(item.template).toBe('feature-grid');
    expect(item.dims).toEqual(getPreset('ipad-13').px);
    expect(await pngInfo(must(item.outputs[0]))).toEqual({ width: 2064, height: 2752, channels: 3, hasAlpha: false });
    // A missing/short callouts list is flagged as an overflow; three cards must not be.
    expect(unexpectedWarnings(item)).toEqual([]);
    expect(codes(item)).not.toContain('bezel-fallback');
  });

  it('puts the framed device in the left column and the accent markers of three cards on the right', async () => {
    const preset = getPreset('ipad-13');
    const entry = must(bezels.entries.find((e) => e.id === preset.bezel), preset.bezel);
    const raw = await readRaw(must(item.outputs[0]));
    const body = must(colorBounds(raw, BEZEL_BODY_RGB), 'bezel body (magenta) in the feature-grid render');
    // Device column is 56% of the canvas width; the frame fits that column and sits left of centre.
    expect(body.width / raw.width).toBeGreaterThan(0.4);
    expect(body.width / raw.width).toBeLessThanOrEqual(0.56 + 0.01);
    expect(body.x + body.width / 2).toBeLessThan(raw.width / 2);
    const { screen, island, radius } = projectBezel(entry, body);
    expect(island).toBeNull();
    expectNoScreenGap(raw, hexToRgb(project.theme.background), screen, radius, 'ipad-13 feature-grid');

    // Three numbered markers filled with theme.accent, right of the device, inside its rows.
    const accent = hexToRgb(project.theme.accent);
    const right = { x: body.x + body.width, y: body.y, width: raw.width - (body.x + body.width), height: body.height };
    const markerArea = Math.PI * (36 * preset.scale / 2) ** 2;
    const accentPixels = countColor(raw, accent, right, 2);
    expect(accentPixels, 'accent marker pixels right of the device').toBeGreaterThan(CALLOUTS.length * markerArea * 0.6);
    // Nothing accent-coloured leaks into the device column below the text block.
    expect(countColor(raw, accent, inset(body, 4), 2)).toBe(0);
  });
});
