// End-to-end render of a copy of example/screenshots through Vite + Chromium
// with a synthetic bezel cache in a temp S1S_HOME: exact-size RGB PNGs, the
// installed bezel drawn around every capture (no bezel-fallback), previews,
// contact sheets, report.json, review.md and manifest render fields. Two
// smaller projects follow: a watch set (passthrough, no browser) and an
// iPad feature-grid set with callouts, and the W6 opt-in set (panorama
// background, bleed-bottom, tilted, watch-caption). Needs Playwright's
// Chromium (`s1s doctor`); never touches the network.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeExampleCaptures } from '../../example/screenshots/make-captures.ts';
import { galleryUrl } from '../../src/cli/commands/dev.ts';
import { linkProject } from '../../src/cli/commands/link.ts';
import { getPreset } from '../../src/config/presets.ts';
import { captureRelPath, screenAppliesTo } from '../../src/config/resolve.ts';
import type { BezelIndex, LocaleCopy, Rect, RenderReport, RenderReportItem, ScreensConfig } from '../../src/config/types.ts';
import { bezelIndexPath } from '../../src/core/bezels/index.ts';
import { imageState, readManifest } from '../../src/core/manifest.ts';
import { bezelDir, reportPath, reviewPath, sheetPath, sizeOutDir } from '../../src/core/paths.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { launchBrowser } from '../../src/render/browser.ts';
import { exportProject } from '../../src/render/export.ts';
import { PREVIEW_SCALE } from '../../src/render/post.ts';
import { renderProject } from '../../src/render/render.ts';
import { createS1sServer } from '../../src/render/server.ts';
import { validateExport } from '../../src/render/validate.ts';
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

  // Export and validate are unit-tested against synthetic flat PNGs. This is
  // the only place the real Chromium renders cross the render -> export ->
  // validate seam, which is where a dims, alpha or channel-count regression
  // would actually surface.
  it('exports the rendered PNGs into metadata/screenshots and `s1s validate` passes on them', async () => {
    const root = join(tmp.dir, 'metadata-export');
    const exported = await exportProject(project, { locale: 'en-US', metadataDir: root, asc: false });
    expect(exported.ok, JSON.stringify(exported.warnings)).toBe(true);
    // The only things left to warn about are the human's: image approval and
    // the App Store Connect ids the example project has never filled in.
    const ADVISORY = new Set(['export-unapproved', 'manifest-incomplete']);
    expect(exported.warnings.filter((w) => !ADVISORY.has(w.code) || w.level !== 'warn')).toEqual([]);
    expect(exported.metadataDir).toBe(root);

    for (const sizeId of SIZES) {
      const displayType = getPreset(sizeId).displayType;
      const items = report.items.filter((i) => i.sizeId === sizeId);
      const files = exported.files.filter((f) => f.displayType === displayType);
      expect(files.map((f) => f.to), displayType).toEqual(
        items.map((item) => join(root, 'en-US', displayType, `${NN(item.ordinal)}.png`)),
      );
      for (const [index, file] of files.entries()) {
        // The exported bytes are the rendered bytes, at the preset's size.
        expect(file.from, file.to).toBe(must(items[index]).outputs[0]);
        expect(await pngInfo(file.to), file.to).toEqual({
          width: getPreset(sizeId).px.width,
          height: getPreset(sizeId).px.height,
          channels: 3,
          hasAlpha: false,
        });
      }
    }

    const validated = await validateExport(project, { locale: 'en-US', metadataDir: root });
    expect(validated.problems.filter((p) => p.level === 'error')).toEqual([]);
    expect(validated.ok).toBe(true);
    // validate walks the tree, so its sets come out in folder-name order.
    expect(validated.sets.map((s) => [s.displayType, s.count])).toEqual(
      SIZES.map((sizeId) => [getPreset(sizeId).displayType, report.items.filter((i) => i.sizeId === sizeId).length]).sort(
        (a, b) => String(a[0]).localeCompare(String(b[0])),
      ),
    );
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

// ---------------------------------------------------------------------------
// W6 opt-in set: a panorama across two screens, and watch-caption in the browser
// ---------------------------------------------------------------------------

describe('panorama and the W6 templates (smoke)', () => {
  const LEFT: [number, number, number] = [255, 0, 0];
  const RIGHT: [number, number, number] = [0, 255, 0];
  /** Bottom fifth of the watch capture; only a `contain` fit keeps it. */
  const CAPTURE_FOOT: [number, number, number] = [0, 255, 255];

  /** A capture whose bottom fifth is one flat colour, so a crop is countable. */
  async function writeBandedCapture(path: string, dims: { width: number; height: number }): Promise<void> {
    const foot = Math.round(dims.height * 0.2);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width}" height="${dims.height}">` +
      `<rect x="0" y="0" width="${dims.width}" height="${dims.height}" fill="#1c1c1e"/>` +
      `<rect x="0" y="${dims.height - foot}" width="${dims.width}" height="${foot}" fill="rgb(${CAPTURE_FOOT.join(',')})"/>` +
      `</svg>`;
    await mkdir(join(path, '..'), { recursive: true });
    await sharp(Buffer.from(svg)).removeAlpha().png().toFile(path);
  }

  let tmp: TempDir;
  let project: Project;
  let report: RenderReport;

  beforeAll(async () => {
    await writeSyntheticBezelHome(HOME, BEZEL_IDS);
    tmp = await makeTempDir('s1s-smoke-w6-');
    const dir = await copyExampleProject(join(tmp.dir, 'Example', 'screenshots'));
    const screens: ScreensConfig = {
      sizes: ['iphone-6.9', 'watch-s10'],
      locales: ['en-US'],
      panorama: { image: 'assets/pano.png', screens: ['bleed', 'tilt'] },
      screens: [
        { id: 'bleed', template: 'bleed-bottom', only: ['iphone'] },
        { id: 'tilt', template: 'tilted', capture: 'bleed', props: { rotate: -10 }, only: ['iphone'] },
        { id: 'narrow', template: 'bleed-bottom', capture: 'bleed', props: { deviceWidth: 0.6 }, only: ['iphone'] },
        { id: 'glance', template: 'watch-caption', only: ['watch'] },
        { id: 'glance-fit', template: 'watch-caption', capture: 'glance', props: { fit: 'contain' }, only: ['watch'] },
      ],
    };
    await writeFile(
      join(dir, 'screens.ts'),
      `import { defineScreens } from 'screen1shoter/config';\nexport default defineScreens(${JSON.stringify(screens)});\n`,
    );
    const copy: LocaleCopy = {
      locale: 'en-US',
      screens: {
        bleed: { headline: ['Every Ride', 'On One Map'], subline: 'Cropped at the bottom edge' },
        tilt: { headline: ['Tilted', 'And Whole'], subline: 'Rotated, never clipped' },
        narrow: { headline: ['Still', 'Cropped'], subline: 'A narrower device still meets the edge' },
        glance: { headline: ['On Your', 'Wrist'] },
        'glance-fit': { headline: ['Whole', 'Screen'] },
      },
    };
    await writeFile(join(dir, 'copy', 'en-US.json'), `${JSON.stringify(copy, null, 2)}\n`);
    const iphone = getPreset('iphone-6.9');
    await makeCapture(join(dir, captureRelPath('en-US', 'iphone', 'bleed')), iphone.captureDims, { label: 'bleed' });
    // A banded watch capture: the caption box is wider than 416x496, so
    // `cover` scales to the width and cuts the bottom fifth away. The bottom
    // band is what `props.fit: 'contain'` has to bring back.
    await writeBandedCapture(join(dir, captureRelPath('en-US', 'watch', 'glance')), getPreset('watch-s10').captureDims);
    // Two halves at exactly the strip aspect (2 canvases wide), so `cover`
    // crops nothing and each screen must show one flat colour.
    const width = iphone.px.width * 2;
    const height = iphone.px.height;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="0" y="0" width="${width / 2}" height="${height}" fill="rgb(${LEFT.join(',')})"/>` +
      `<rect x="${width / 2}" y="0" width="${width / 2}" height="${height}" fill="rgb(${RIGHT.join(',')})"/>` +
      `</svg>`;
    await mkdir(join(dir, 'assets'), { recursive: true });
    await sharp(Buffer.from(svg)).removeAlpha().png().toFile(join(dir, 'assets', 'pano.png'));
    await linkProject(dir);
    project = await loadProject({ projectDir: dir });
    report = await renderProject(project, { locale: 'en-US', sheet: false });
  });
  afterAll(async () => {
    await tmp.cleanup();
    await rm(HOME, { recursive: true, force: true });
  });

  it('renders all three opt-in templates at their exact size, warning-free', async () => {
    expect(report.items.filter((i) => i.status === 'failed').map((i) => `${i.key}: ${i.error ?? ''}`)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.items.map((i) => [i.key, i.template])).toEqual([
      ['en-US/iphone-6.9/bleed', 'bleed-bottom'],
      ['en-US/iphone-6.9/tilt', 'tilted'],
      ['en-US/iphone-6.9/narrow', 'bleed-bottom'],
      ['en-US/watch-s10/glance', 'watch-caption'],
      ['en-US/watch-s10/glance-fit', 'watch-caption'],
    ]);
    for (const item of report.items) {
      expect(unexpectedWarnings(item), item.key).toEqual([]);
      expect(codes(item), item.key).not.toContain('bezel-fallback');
      expect(await pngInfo(must(item.outputs[0])), item.key).toMatchObject({ channels: 3, hasAlpha: false });
    }
  });

  it('sends a watch-caption screen through the browser instead of copying the capture', () => {
    const glance = find(report, 'en-US/watch-s10/glance');
    // The preset is passthrough; only `raw` may take that route, because every
    // other template has copy to paint over the capture.
    expect(glance.status).toBe('rendered');
    expect(glance.dims).toEqual(getPreset('watch-s10').px);
  });

  // The template's contract is that the device runs off the bottom edge. Below
  // about deviceWidth 0.78 the frame fits inside its slot, so only a
  // bottom-aligned frame still reaches the edge; a top-pinned one leaves a
  // band of flat theme background that no check would ever report.
  it('bleed-bottom still meets the bottom canvas edge at a deviceWidth that fits the slot', async () => {
    const raw = await readRaw(must(find(report, 'en-US/iphone-6.9/narrow').outputs[0]));
    const body = must(colorBounds(raw, BEZEL_BODY_RGB), 'the bezel body (magenta) in the narrow bleed-bottom render');
    // Within the anti-aliased last row of the bezel edge; the top-pinned
    // version left 478 px of flat background here.
    expect(raw.height - (body.y + body.height), 'gap below the device').toBeLessThanOrEqual(2);
    // deviceWidth really applied: the device no longer spans the canvas.
    expect(body.width).toBeLessThan(raw.width * 0.7);
    // And it is not merely a full-width frame: it starts below the text block.
    expect(body.y).toBeGreaterThan(0);
  });

  it('watch-caption crops the capture bottom by default and keeps it with props.fit "contain"', async () => {
    const [cover, contain] = await Promise.all(
      ['glance', 'glance-fit'].map(async (id) => readRaw(must(find(report, `en-US/watch-s10/${id}`).outputs[0]))),
    );
    // The capture box is wider than a 416x496 capture, so 'cover' scales to
    // the width and the bottom band never reaches the canvas.
    expect(countColor(must(cover), CAPTURE_FOOT, undefined, 8), 'cover keeps the bottom band').toBe(0);
    const kept = countColor(must(contain), CAPTURE_FOOT, undefined, 8);
    expect(kept, 'contain drops the bottom band').toBeGreaterThan(1000);
  });

  it('cuts the panorama into one slice per screen, in screens.ts order', async () => {
    const [first, second] = await Promise.all(
      ['bleed', 'tilt'].map(async (id) => readRaw(must(find(report, `en-US/iphone-6.9/${id}`).outputs[0]))),
    );
    // The top corners are background on both templates (bleed-bottom runs its
    // device off the bottom edge, so only the top is safe to sample): the first
    // screen shows the left half of the image, the second the right half, so the
    // two join with no seam.
    for (const [raw, colour] of [[must(first), LEFT], [must(second), RIGHT]] as const) {
      const corners = [[4, 4], [raw.width - 5, 4]] as const;
      for (const [x, y] of corners) expect(pixelAt(raw, x, y), `${x},${y}`).toEqual(colour);
    }
  });

  it('names the non-compliant templates in review.md', async () => {
    const review = await readFile(reviewPath(project, 'en-US'), 'utf8');
    expect(review).toContain('## Non-compliant templates');
    expect(review).toContain('bleed-bottom, tilted');
  });
});

// ---------------------------------------------------------------------------
// The dev server's own routes: `s1s dev --locale <l>` and <html lang>
// ---------------------------------------------------------------------------

describe('dev routes in a real browser (smoke)', () => {
  const LOCALES = ['en-US', 'de-DE'] as const;
  let tmp: TempDir;
  let server: Awaited<ReturnType<typeof createS1sServer>>;
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  let url: string;

  beforeAll(async () => {
    await writeSyntheticBezelHome(HOME, BEZEL_IDS);
    tmp = await makeTempDir('s1s-smoke-dev-');
    const screens: ScreensConfig = { sizes: ['iphone-6.9'], locales: [...LOCALES], screens: [{ id: 'home' }] };
    const copies: Record<string, LocaleCopy> = {
      'en-US': { locale: 'en-US', screens: { home: { headline: 'Every ride on the map' } } },
      'de-DE': { locale: 'de-DE', screens: { home: { headline: 'Jede Runde auf der Karte' } } },
    };
    const dir = await writeTempProject(join(tmp.dir, 'screenshots'), { screens, copies });
    for (const locale of LOCALES) {
      await makeCapture(join(dir, captureRelPath(locale, 'iphone', 'home')), getPreset('iphone-6.9').captureDims, { label: locale });
    }
    await linkProject(dir);
    server = await createS1sServer({ projectDir: dir, bezelDir: bezelDir(), mode: 'dev' });
    url = server.url.replace(/\/+$/, '');
    browser = await launchBrowser();
  });
  afterAll(async () => {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    await tmp.cleanup();
    await rm(HOME, { recursive: true, force: true });
  });

  it('opens the gallery on the locale `s1s dev --locale` names', async () => {
    const page = await browser.newPage();
    try {
      // The exact URL src/cli/commands/dev.ts prints for `--locale de-DE`.
      await page.goto(galleryUrl(server.url, 'de-DE'), { waitUntil: 'load' });
      await page.waitForFunction('document.querySelector("select") !== null', undefined, { timeout: 60_000 });
      expect(await page.evaluate<string>('document.querySelector("select").value')).toBe('de-DE');
    } finally {
      await page.close();
    }
  });

  it('gives the render route the locale it renders as the document language', async () => {
    const page = await browser.newPage();
    try {
      for (const locale of LOCALES) {
        await page.goto(`${url}/#/render/${locale}/iphone-6.9/home`, { waitUntil: 'load' });
        await page.waitForFunction(
          `document.querySelector('[data-s1s-canvas]')?.getAttribute('data-s1s-canvas') === ${JSON.stringify(`${locale}/iphone-6.9/home`)}`,
          undefined,
          { timeout: 60_000 },
        );
        // Chromium cases (text-transform) and breaks lines (text-wrap: balance)
        // per document language, so lang="en" would case Turkish and German wrong.
        expect(await page.evaluate<string>('document.documentElement.lang'), locale).toBe(locale);
      }
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Project templates: the registry, not the built-in metadata, decides what a
// screen renders and whether it is guideline-compliant
// ---------------------------------------------------------------------------

describe('project templates/index.tsx (smoke)', () => {
  const OVERRIDE_RGB: [number, number, number] = [0, 255, 0];
  let tmp: TempDir;
  let project: Project;
  let report: RenderReport;

  beforeAll(async () => {
    await writeSyntheticBezelHome(HOME, BEZEL_IDS);
    tmp = await makeTempDir('s1s-smoke-templates-');
    const screens: ScreensConfig = {
      sizes: ['iphone-6.9', 'watch-s10'],
      locales: ['en-US'],
      screens: [
        { id: 'wild', template: 'wild', only: ['iphone'] },
        { id: 'glance', template: 'raw', only: ['watch'] },
      ],
    };
    const copies: Record<string, LocaleCopy> = {
      'en-US': { locale: 'en-US', screens: { wild: { headline: 'Wild' }, glance: { headline: 'Glance' } } },
    };
    const dir = await writeTempProject(join(tmp.dir, 'screenshots'), { screens, copies });
    // `wild` is a project template nothing in src/config knows about; `raw`
    // replaces the built-in of the same id, which is exactly what the watch
    // passthrough shortcut used to skip.
    const fill = (rgb: readonly number[]) =>
      `{ position: 'absolute', inset: 0, background: 'rgb(${rgb.join(',')})' }`;
    await mkdir(join(dir, 'templates'), { recursive: true });
    await writeFile(
      join(dir, 'templates', 'index.tsx'),
      [
        "import { defineTemplate } from 'screen1shoter';",
        'export default [',
        "  defineTemplate({ id: 'wild', families: ['iphone'], compliant: false, Component: () => <div style={" + fill([255, 0, 0]) + '} /> }),',
        "  defineTemplate({ id: 'raw', families: ['iphone', 'ipad', 'watch'], Component: () => <div style={" + fill(OVERRIDE_RGB) + '} /> }),',
        '];',
        '',
      ].join('\n'),
    );
    for (const [family, sizeId] of [['iphone', 'iphone-6.9'], ['watch', 'watch-s10']] as const) {
      const ref = family === 'iphone' ? 'wild' : 'glance';
      await makeCapture(join(dir, captureRelPath('en-US', family, ref)), getPreset(sizeId).captureDims, { label: ref });
    }
    await linkProject(dir);
    project = await loadProject({ projectDir: dir });
    expect(project.templatesPath).toBe(join(dir, 'templates', 'index.tsx'));
    report = await renderProject(project, { locale: 'en-US', sheet: false });
  });
  afterAll(async () => {
    await tmp.cleanup();
    await rm(HOME, { recursive: true, force: true });
  });

  it('renders a project template that replaces the built-in `raw` on the watch instead of copying the capture', async () => {
    const glance = find(report, 'en-US/watch-s10/glance');
    expect(report.items.filter((i) => i.status === 'failed').map((i) => `${i.key}: ${i.error ?? ''}`)).toEqual([]);
    expect(glance.status).toBe('rendered');
    expect(glance.dims).toEqual(getPreset('watch-s10').px);
    const raw = await readRaw(must(glance.outputs[0]));
    const centre = pixelAt(raw, Math.floor(raw.width / 2), Math.floor(raw.height / 2));
    expect(centre, 'the project module painted the watch canvas, not the capture').toEqual(OVERRIDE_RGB);
  });

  it('reports and names a project template that declares `compliant: false`', async () => {
    const wild = find(report, 'en-US/iphone-6.9/wild');
    expect(wild.template).toBe('wild');
    expect(wild.noncompliant).toBe('wild');
    // The built-in metadata knows nothing about `wild`, so review.md can only
    // name it if the fact came back from the browser registry.
    const review = await readFile(reviewPath(project, 'en-US'), 'utf8');
    expect(review).toContain('## Non-compliant templates');
    expect(review).toContain('wild');
  });
});
