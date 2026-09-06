// The one capture-size rule (captureDimsWarning) and its use in the render
// warnings: exact = nothing, same aspect within 1% = warn (resampled), other
// = error naming the simulator. Plus listCaptureLocales and mergeWarnings.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import { captureKey, captureRelPath, missingCaptureElement } from '../../src/config/resolve.ts';
import type { CaptureSource, ProjectManifest, Warning } from '../../src/config/types.ts';
import { captureDimsWarning, makeWarning, mergeWarnings } from '../../src/config/warnings.ts';
import { captureMap, captureWarnings, listCaptureLocales, readPngDims, resolveCapture } from '../../src/core/captures.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { copyFixtureProject, makeTempDir, type TempDir } from '../fixtures/helpers.ts';
import { makeCapture, makeProjectCaptures } from '../fixtures/make-capture.ts';

const iphone69 = SIZE_PRESETS['iphone-6.9'];
const iphone65 = SIZE_PRESETS['iphone-6.5'];
const ipad13 = SIZE_PRESETS['ipad-13'];

function source(dims: CaptureSource['dims'], extra: Partial<CaptureSource> = {}): CaptureSource {
  return {
    requested: 'home',
    family: 'iphone',
    locale: 'en-US',
    resolvedPath: captureRelPath('en-US', 'iphone', 'home'),
    usedLocale: 'en-US',
    fallback: 'none',
    dims,
    ...extra,
  };
}

describe('captureDimsWarning', () => {
  it('is null for the exact capture size', () => {
    expect(captureDimsWarning(iphone69.captureDims, iphone69)).toBeNull();
  });

  it('warns (resampled) for a same-aspect capture from another iPhone class', () => {
    // 1320x2868 (6.9") rendered as 6.5": aspect 0.4603 vs 0.4622 = 0.4%.
    const warning = captureDimsWarning(iphone69.captureDims, iphone65, 'captures/en-US/iphone/home.png');
    expect(warning?.code).toBe('capture-dims');
    expect(warning?.level).toBe('warn');
    expect(warning?.message).toContain('captures/en-US/iphone/home.png is 1320x2868');
    expect(warning?.message).toContain('will be resampled');
  });

  it('errors and names the simulator for a wrong device', () => {
    const warning = captureDimsWarning(ipad13.captureDims, iphone69);
    expect(warning?.level).toBe('error');
    expect(warning?.message).toContain(`capture on "${iphone69.simulatorName}"`);
  });
});

describe('captureWarnings', () => {
  it('reports nothing for an exact own-locale capture', () => {
    expect(captureWarnings(source(iphone69.captureDims), iphone69, { allowPlaceholder: false })).toEqual([]);
  });

  it('mirrors the shared rule: warn for same aspect, error for a wrong device', () => {
    const warn = captureWarnings(source(iphone69.captureDims), iphone65, { allowPlaceholder: false });
    expect(warn.map((w) => [w.code, w.level])).toEqual([['capture-dims', 'warn']]);
    const error = captureWarnings(source(ipad13.captureDims), iphone69, { allowPlaceholder: false });
    expect(error.map((w) => [w.code, w.level])).toEqual([['capture-dims', 'error']]);
  });

  it('tags a missing capture with the placeholder element so browser warnings de-duplicate', () => {
    const missing = source(null, { resolvedPath: null, fallback: 'placeholder' });
    const [warning] = captureWarnings(missing, iphone69, { allowPlaceholder: false });
    expect(warning?.code).toBe('capture-missing');
    expect(warning?.level).toBe('error');
    expect(warning?.element).toBe(missingCaptureElement('home'));
    const [relaxed] = captureWarnings(missing, iphone69, { allowPlaceholder: true });
    expect(relaxed?.level).toBe('warn');
  });
});

describe('mergeWarnings', () => {
  it('drops extra warnings that share code and element with a base warning, keeps the rest', () => {
    const base: Warning[] = [makeWarning('capture-missing', 'node', missingCaptureElement('home'))];
    const extra: Warning[] = [
      makeWarning('capture-missing', 'browser', missingCaptureElement('home')),
      makeWarning('capture-missing', 'browser other', missingCaptureElement('other')),
      makeWarning('overflow', 'no element'),
    ];
    const merged = mergeWarnings(base, extra);
    expect(merged.map((w) => w.message)).toEqual(['node', 'browser other', 'no element']);
  });

  it('collapses duplicates among the extras too (two DeviceFrames, one substitute bezel)', () => {
    const extra: Warning[] = [
      makeWarning('bezel-fallback', 'first frame', '[data-s1s-id="device"]'),
      makeWarning('bezel-fallback', 'second frame', '[data-s1s-id="device"]'),
      makeWarning('overflow', 'a', '[data-s1s-id="text"]'),
      makeWarning('overflow', 'b'),
      makeWarning('overflow', 'c'),
    ];
    expect(mergeWarnings([], extra).map((w) => w.message)).toEqual(['first frame', 'a', 'b', 'c']);
  });
});

describe('listCaptureLocales', () => {
  it('lists locale-shaped directories under captures/ and nothing else', async () => {
    const tmp = await makeTempDir();
    try {
      for (const name of ['en-US', 'de-DE', 'zh-Hans', 'notes', '.DS_Store']) await mkdir(join(tmp.dir, 'captures', name), { recursive: true });
      expect(await listCaptureLocales(tmp.dir)).toEqual(['de-DE', 'en-US', 'zh-Hans']);
      expect(await listCaptureLocales(join(tmp.dir, 'missing'))).toEqual([]);
    } finally {
      await tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Files on disk: readPngDims, the resolveCapture fallback chain, captureMap
// ---------------------------------------------------------------------------

describe('readPngDims', () => {
  it('reads the IHDR of a real PNG and returns null for text or a missing file', async () => {
    const tmp = await makeTempDir();
    try {
      const png = await makeCapture(join(tmp.dir, 'real.png'), { width: 30, height: 20 });
      expect(readPngDims(png)).toEqual({ width: 30, height: 20 });
      await writeFile(join(tmp.dir, 'fake.png'), 'not a png at all, but long enough to read 24 bytes');
      expect(readPngDims(join(tmp.dir, 'fake.png'))).toBeNull();
      expect(readPngDims(join(tmp.dir, 'missing.png'))).toBeNull();
    } finally {
      await tmp.cleanup();
    }
  });
});

describe('resolveCapture fallback chain (temp copy of project-bare)', () => {
  let tmp: TempDir;
  let project: Project;

  beforeEach(async () => {
    tmp = await makeTempDir();
    const dir = await copyFixtureProject('project-bare', join(tmp.dir, 'screenshots'));
    project = await loadProject({ projectDir: dir });
    expect(project.sourceLocale).toBe('en-US');
  });
  afterEach(() => tmp.cleanup());

  it('1) own file: fallback none, usedLocale = locale, dims from the file', async () => {
    await makeProjectCaptures(project.dir, 'en-US', { iphone: ['home'] });
    const source = resolveCapture(project, 'home', iphone69, 'en-US');
    expect(source).toEqual({
      requested: 'home',
      family: 'iphone',
      locale: 'en-US',
      resolvedPath: 'captures/en-US/iphone/home.png',
      usedLocale: 'en-US',
      fallback: 'none',
      dims: iphone69.captureDims,
    });
    expect(captureWarnings(source, iphone69, { allowPlaceholder: false })).toEqual([]);
  });

  // Nobody declared this reuse: de-DE is captured in its own right and its
  // capture step simply never ran, so English pixels would ship inside a
  // German set. That is a warn, not the info a declared reuse gets.
  it('2) no de-DE file: the source-locale file is used with one warn-level warning', async () => {
    await makeProjectCaptures(project.dir, 'en-US', { iphone: ['home'] });
    const source = resolveCapture(project, 'home', iphone69, 'de-DE');
    expect(source).toMatchObject({
      locale: 'de-DE',
      resolvedPath: 'captures/en-US/iphone/home.png',
      usedLocale: 'en-US',
      fallback: 'source-locale',
      dims: iphone69.captureDims,
    });
    const warnings = captureWarnings(source, iphone69, { allowPlaceholder: false });
    expect(warnings.map((w) => [w.code, w.level])).toEqual([['capture-fallback-locale', 'warn']]);
    expect(warnings[0]?.message).toContain('has no file at captures/de-DE/iphone/home.png');
    expect(warnings[0]?.message).toContain('captures/en-US/iphone/home.png');
  });

  it('3) manifest reuse:en-US wins over a de-DE file that exists and is recorded as `reuse`', async () => {
    await makeProjectCaptures(project.dir, 'en-US', { iphone: ['home'] });
    await makeProjectCaptures(project.dir, 'de-DE', { iphone: ['home'] });
    // Without reuse the own file wins.
    expect(resolveCapture(project, 'home', iphone69, 'de-DE')).toMatchObject({
      resolvedPath: 'captures/de-DE/iphone/home.png',
      fallback: 'none',
    });
    const manifest: ProjectManifest = {
      ...project.manifest,
      locales: { ...project.manifest.locales, 'de-DE': { copyStatus: 'draft', captureSource: 'reuse:en-US', devices: {} } },
    };
    const source = resolveCapture({ ...project, manifest }, 'home', iphone69, 'de-DE');
    expect(source).toMatchObject({
      resolvedPath: 'captures/en-US/iphone/home.png',
      usedLocale: 'en-US',
      fallback: 'reuse',
    });
    // A deliberate reuse stays info: the human asked for these pixels.
    expect(captureWarnings(source, iphone69, { allowPlaceholder: false }).map((w) => [w.code, w.level])).toEqual([
      ['capture-fallback-locale', 'info'],
    ]);
  });

  // `reuse:de-DE` for de-AT never touches the source locale, so recording
  // 'source-locale' would name a locale nobody read a pixel from.
  it('3b) reuse:<locale> that is not the source locale is recorded as `reuse`, naming that locale', async () => {
    await makeProjectCaptures(project.dir, 'de-DE', { iphone: ['home'] });
    const manifest: ProjectManifest = {
      ...project.manifest,
      locales: { ...project.manifest.locales, 'de-AT': { copyStatus: 'draft', captureSource: 'reuse:de-DE', devices: {} } },
    };
    const source = resolveCapture({ ...project, manifest }, 'home', iphone69, 'de-AT');
    expect(source).toMatchObject({
      resolvedPath: 'captures/de-DE/iphone/home.png',
      usedLocale: 'de-DE',
      fallback: 'reuse',
    });
  });

  it('4) no file anywhere: placeholder with resolvedPath and dims null', () => {
    const source = resolveCapture(project, 'nothing', ipad13, 'en-US');
    expect(source).toEqual({
      requested: 'nothing',
      family: 'ipad',
      locale: 'en-US',
      resolvedPath: null,
      usedLocale: 'en-US',
      fallback: 'placeholder',
      dims: null,
    });
    expect(captureWarnings(source, ipad13, { allowPlaceholder: false }).map((w) => [w.code, w.level])).toEqual([
      ['capture-missing', 'error'],
    ]);
  });

  it('5) a non-PNG file at the path resolves with dims null and a capture-dims error', async () => {
    const path = join(project.dir, captureRelPath('en-US', 'ipad', 'home'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'definitely not a portable network graphic');
    const source = resolveCapture(project, 'home', ipad13, 'en-US');
    expect(source).toMatchObject({ resolvedPath: 'captures/en-US/ipad/home.png', fallback: 'none', dims: null });
    const warnings = captureWarnings(source, ipad13, { allowPlaceholder: false });
    expect(warnings.map((w) => [w.code, w.level])).toEqual([['capture-dims', 'error']]);
    expect(warnings[0]?.message).toContain('not a readable PNG');
  });

  it('7) captureMap keys every screen x preset by captureKey(locale, family, ref)', async () => {
    await makeProjectCaptures(project.dir, 'en-US', { iphone: ['home'] });
    const map = captureMap(project, ['en-US'], [iphone69, ipad13]);
    const expected = ['home', 'detail'].flatMap((id) => [captureKey('en-US', 'iphone', id), captureKey('en-US', 'ipad', id)]);
    expect(Object.keys(map).sort()).toEqual(expected.sort());
    expect(map[captureKey('en-US', 'iphone', 'home')]?.fallback).toBe('none');
    expect(map[captureKey('en-US', 'iphone', 'detail')]?.fallback).toBe('placeholder');
    expect(map[captureKey('en-US', 'ipad', 'home')]?.fallback).toBe('placeholder');
  });
});
