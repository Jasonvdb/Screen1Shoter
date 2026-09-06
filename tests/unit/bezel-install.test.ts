// installBezels with `--from <dir>` against synthetic PNGs in a temp S1S_HOME:
// file-name filtering, landscape skipping, trimming to deviceRect + 2 px,
// index.json merging, keep / --force, the changed-DMG guard, and the
// `s1s bezels` CLI surface (--json shapes and exit codes). No network, no
// hdiutil: the DMG download and mount paths are only exercised for their
// pure decisions (requestedIds, isDownloadComplete, openSource errors).
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPreset } from '../../src/config/presets.ts';
import type { BezelEntry, BezelIndex, Rect } from '../../src/config/types.ts';
import { bezelEntryFile, findBezel, readBezelIndex } from '../../src/core/bezels/index.ts';
import {
  cacheDirs,
  defaultBezelIds,
  installBezels,
  isDownloadComplete,
  listPngs,
  openSource,
  requestedIds,
  type InstallResult,
} from '../../src/core/bezels/install.ts';
import { TRIM_PAD } from '../../src/core/bezels/measure.ts';
import { BEZEL_SOURCE_IDS } from '../../src/core/bezels/sources.ts';
import { isS1sError } from '../../src/core/errors.ts';
import { makeTempDir, parseJsonLine, runS1s, type TempDir } from '../fixtures/helpers.ts';
import { bezelSvg } from '../fixtures/make-bezel.ts';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** Untrimmed synthetic iPhone (screen 330x717, island) and iPad (screen 516x688) at a quarter of Apple's size. */
const PHONE: BezelEntry = {
  id: 'iphone-test',
  variant: 'deep-blue',
  file: 'iphone-test/deep-blue.png',
  imageSize: { width: 370, height: 750 },
  deviceRect: rect(6, 5, 357, 740),
  screenRect: rect(20, 17, 330, 717),
  cornerRadius: 48,
  islandRect: rect(138, 28, 94, 27),
  orientation: 'portrait',
  screenAspect: 330 / 717,
};
const PHONE_LANDSCAPE: BezelEntry = {
  ...PHONE,
  imageSize: { width: 750, height: 370 },
  deviceRect: rect(5, 6, 740, 357),
  screenRect: rect(17, 20, 717, 330),
  islandRect: rect(28, 138, 27, 94),
  orientation: 'landscape',
};
const PAD: BezelEntry = {
  id: 'ipad-test',
  variant: 'silver',
  file: 'ipad-test/silver.png',
  imageSize: { width: 580, height: 750 },
  deviceRect: rect(7, 8, 562, 734),
  screenRect: rect(30, 31, 516, 688),
  cornerRadius: 15,
  orientation: 'portrait',
  screenAspect: 0.75,
};

async function writePng(dir: string, name: string, entry: BezelEntry): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, '..'), { recursive: true });
  await sharp(Buffer.from(bezelSvg(entry))).ensureAlpha().png().toFile(path);
  return path;
}

/** A mount-like folder: model sub-folders, a landscape file, PSDs, dot-files and a background image. */
async function writeSourceDir(root: string): Promise<void> {
  await writePng(root, 'iPhone Test/iPhone Test - Deep Blue - Portrait.png', PHONE);
  await writePng(root, 'iPhone Test/iPhone Test - Deep Blue - Landscape.png', PHONE_LANDSCAPE);
  await writePng(root, 'iPad Test - Silver - Portrait.png', PAD);
  await writePng(root, '.DropDMGBackground/Bezel-Test@2x.png', PAD);
  await writePng(root, 'Bezel-Test@2x.png', PAD);
  await mkdir(join(root, 'Photoshop'), { recursive: true });
  await writeFile(join(root, 'Photoshop', 'iPhone Test - Deep Blue - Portrait.psd'), 'not a psd');
  await writeFile(join(root, '.DS_Store'), '');
}

function byId(result: InstallResult, id: string): BezelEntry {
  const entry = result.installed.find((e) => e.id === id);
  if (!entry) throw new Error(`${id} not installed: ${JSON.stringify(result, null, 2)}`);
  return entry;
}

let tmp: TempDir;
let src: string;
let n = 0;
const freshHome = async (): Promise<string> => {
  const home = join(tmp.dir, `home-${n++}`);
  await mkdir(home, { recursive: true });
  return home;
};

beforeAll(async () => {
  tmp = await makeTempDir('s1s-bezel-install-');
  src = join(tmp.dir, 'source');
  await writeSourceDir(src);
});
afterAll(async () => {
  await tmp.cleanup();
});

describe('pure decisions', () => {
  it('requestedIds: presets by default, --all, --device with validation, everything for --from', () => {
    expect(requestedIds({})).toEqual(defaultBezelIds());
    expect(defaultBezelIds()).toEqual(['iphone-17-pro-max', 'iphone-17-pro', 'ipad-pro-13-m5', 'ipad-pro-11-m5']);
    expect(requestedIds({ all: true })).toEqual([...BEZEL_SOURCE_IDS]);
    expect(requestedIds({ devices: ['iphone-17', 'iphone-17'] })).toEqual(['iphone-17']);
    expect(requestedIds({ from: '/x' })).toBeNull();
    expect(requestedIds({ from: '/x', devices: ['iphone-test'] })).toEqual(['iphone-test']);
    try {
      requestedIds({ devices: ['iphone-17', 'bogus'] });
      expect.unreachable();
    } catch (err) {
      expect(isS1sError(err) && err.code).toBe('usage');
      expect(isS1sError(err) && err.message).toContain('bogus');
    }
  });

  it('isDownloadComplete: exact known size or Content-Length match', () => {
    expect(isDownloadComplete(null, 100, 100)).toBe(false);
    expect(isDownloadComplete(0, 100, 100)).toBe(false);
    expect(isDownloadComplete(100, 100, null)).toBe(true);
    expect(isDownloadComplete(120, 100, 120)).toBe(true);
    expect(isDownloadComplete(90, 100, 120)).toBe(false);
  });

  it('cacheDirs lays out S1S_HOME', () => {
    const dirs = cacheDirs('/tmp/x');
    expect(dirs).toEqual({ home: '/tmp/x', bezels: '/tmp/x/bezels', dmg: '/tmp/x/dmg', mnt: '/tmp/x/mnt' });
  });

  it('listPngs walks sub-folders, skips dot-files and dot-dirs, sorts', async () => {
    expect(await listPngs(src)).toEqual([
      'Bezel-Test@2x.png',
      'iPad Test - Silver - Portrait.png',
      'iPhone Test/iPhone Test - Deep Blue - Landscape.png',
      'iPhone Test/iPhone Test - Deep Blue - Portrait.png',
    ]);
  });

  it('openSource: a directory as is, usage errors for a missing path or a non-dmg file', async () => {
    const dirs = cacheDirs(await freshHome());
    const root = await openSource(src, dirs);
    expect(root.dir).toBe(src);
    await root.cleanup();
    for (const bad of [join(src, 'nope'), join(src, '.DS_Store')]) {
      try {
        await openSource(bad, dirs);
        expect.unreachable();
      } catch (err) {
        expect(isS1sError(err) && err.code).toBe('usage');
      }
    }
  });
});

describe('installBezels --from <dir>', () => {
  let home: string;
  let result: InstallResult;
  beforeAll(async () => {
    home = await freshHome();
    result = await installBezels({ from: src, home });
  });

  it('installs the portrait bezels, skips landscape and non-bezel files, writes index.json', async () => {
    expect(result.installed.map((e) => `${e.id}/${e.variant}`).sort()).toEqual(['ipad-test/silver', 'iphone-test/deep-blue']);
    expect(result.kept).toEqual([]);
    expect(result.dmgs).toEqual([]);
    expect(result.offline).toBeUndefined();
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.file, s]));
    expect(reasons['iPhone Test/iPhone Test - Deep Blue - Landscape.png']).toMatchObject({ level: 'info', reason: expect.stringContaining('--landscape') });
    expect(reasons['Bezel-Test@2x.png']?.level).toBe('info');
    expect(result.skipped.some((s) => s.level === 'error')).toBe(false);

    expect(result.indexPath).toBe(join(home, 'bezels', 'index.json'));
    const onDisk = JSON.parse(await readFile(result.indexPath, 'utf8')) as BezelIndex;
    expect(onDisk.version).toBe(1);
    expect(onDisk.entries).toEqual(result.index.entries);
    expect(await readBezelIndex(join(home, 'bezels'))).toEqual(onDisk);
  });

  it('trims each file to deviceRect + 2 px and shifts the rects into the trimmed image', async () => {
    const phone = byId(result, 'iphone-test');
    expect(phone.file).toBe('iphone-test/deep-blue.png');
    expect(phone.orientation).toBe('portrait');
    expect(phone.imageSize).toEqual({ width: PHONE.deviceRect.width + 2 * TRIM_PAD, height: PHONE.deviceRect.height + 2 * TRIM_PAD });
    expect(phone.deviceRect).toMatchObject({ x: TRIM_PAD, y: TRIM_PAD });
    expect(Math.abs(phone.screenRect.x - (PHONE.screenRect.x - PHONE.deviceRect.x + TRIM_PAD))).toBeLessThanOrEqual(1);
    expect(Math.abs(phone.screenRect.width - PHONE.screenRect.width)).toBeLessThanOrEqual(1);
    expect(phone.islandRect).toBeDefined();
    expect(Math.abs(phone.cornerRadius - PHONE.cornerRadius)).toBeLessThanOrEqual(2);
    expect(phone.pxPerPt).toBe(3);
    expect(phone.screenAspect).toBeCloseTo(330 / 717, 3);

    const meta = await sharp(join(home, 'bezels', phone.file)).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual(phone.imageSize);
    expect(meta.hasAlpha).toBe(true);

    const pad = byId(result, 'ipad-test');
    expect(pad.islandRect).toBeUndefined();
    expect(pad.pxPerPt).toBe(2);
    expect(pad.imageSize).toEqual({ width: PAD.deviceRect.width + 2 * TRIM_PAD, height: PAD.deviceRect.height + 2 * TRIM_PAD });
  });

  it('keeps installed entries on a re-run and re-measures with --force', async () => {
    const again = await installBezels({ from: src, home });
    expect(again.installed).toEqual([]);
    expect(again.kept.map((e) => e.id).sort()).toEqual(['ipad-test', 'iphone-test']);
    expect(again.index.entries).toEqual(result.index.entries);

    const forced = await installBezels({ from: src, home, force: true });
    expect(forced.kept).toEqual([]);
    expect(forced.installed).toHaveLength(2);
    expect(forced.index.entries).toHaveLength(2);
  });

  it('installs landscape files under a -landscape name with --landscape; findBezel ignores them', async () => {
    const withLandscape = await installBezels({ from: src, home, landscape: true, devices: ['iphone-test'] });
    const landscape = withLandscape.installed.find((e) => e.orientation === 'landscape');
    expect(landscape?.file).toBe('iphone-test/deep-blue-landscape.png');
    expect(landscape?.file).toBe(bezelEntryFile({ id: 'iphone-test', variant: 'deep-blue', orientation: 'landscape' }));
    expect(landscape?.screenRect.width).toBeGreaterThan(landscape?.screenRect.height ?? 0);
    expect(withLandscape.kept.map((e) => e.id)).toEqual(['iphone-test']);
    expect(withLandscape.skipped.find((s) => s.file.startsWith('iPad'))?.reason).toContain('not requested');
    expect(withLandscape.index.entries).toHaveLength(3);
    await stat(join(home, 'bezels', 'iphone-test', 'deep-blue-landscape.png'));

    const preset = { ...getPreset('iphone-6.9'), bezel: 'iphone-test', bezelFallbacks: [] };
    const match = findBezel(withLandscape.index, preset);
    expect(match?.entry.orientation).toBe('portrait');
    expect(match?.fallback).toBe(false);
  });

  it('re-measures a missing cache file even without --force', async () => {
    await rm(join(home, 'bezels', 'ipad-test', 'silver.png'));
    const repaired = await installBezels({ from: src, home, devices: ['ipad-test'] });
    expect(repaired.installed.map((e) => e.id)).toEqual(['ipad-test']);
    await stat(join(home, 'bezels', 'ipad-test', 'silver.png'));
  });
});

describe('installBezels guards', () => {
  it('refuses a known model whose screen size differs from sources.ts (error-level skip, nothing written)', async () => {
    const home = await freshHome();
    const dir = join(tmp.dir, 'changed');
    await writePng(dir, 'iPhone 17 Pro Max - Silver - Portrait.png', PHONE);
    const result = await installBezels({ from: dir, home });
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([
      { file: 'iPhone 17 Pro Max - Silver - Portrait.png', level: 'error', reason: expect.stringContaining('sources.ts') },
    ]);
    expect(result.index.entries).toEqual([]);
    const index = await readBezelIndex(join(home, 'bezels'));
    expect(index?.entries).toEqual([]);
  });

  it('reports an empty source folder as an error', async () => {
    const dir = join(tmp.dir, 'empty');
    await mkdir(dir, { recursive: true });
    const result = await installBezels({ from: dir, home: await freshHome() });
    expect(result.skipped).toEqual([{ file: dir, level: 'error', reason: 'no PNG files found' }]);
  });

  it('sorts index entries by id, portrait before landscape, then sources.ts variant order', async () => {
    const home = await freshHome();
    const result = await installBezels({ from: src, home, landscape: true });
    expect(result.index.entries.map((e) => `${e.id}/${e.orientation}`)).toEqual([
      'ipad-test/portrait',
      'iphone-test/portrait',
      'iphone-test/landscape',
    ]);
  });

  it('moves an unreadable index.json aside and rebuilds it; list names the bad file', async () => {
    const home = await freshHome();
    const indexPath = join(home, 'bezels', 'index.json');
    await mkdir(join(home, 'bezels'), { recursive: true });
    await writeFile(indexPath, '{');
    const list = await runS1s(['bezels', 'list', '--json'], { env: { S1S_HOME: home } });
    expect(list.code).toBe(1);
    const error = parseJsonLine<{ ok: boolean; error: { code: string; hint: string } }>(list);
    expect(error.error.code).toBe('bezel-missing');
    expect(error.error.hint).toContain('s1s bezels install --force');

    const logs: string[] = [];
    const result = await installBezels({ from: src, home, log: (line) => logs.push(line) });
    expect(result.installed.map((e) => e.id).sort()).toEqual(['ipad-test', 'iphone-test']);
    expect(logs.some((line) => line.includes('index.json.bak'))).toBe(true);
    expect(await readFile(`${indexPath}.bak`, 'utf8')).toBe('{');
    expect((await readBezelIndex(join(home, 'bezels')))?.entries).toHaveLength(2);
  });

  it('skips a PNG that cannot be measured (error-level) and still indexes the good ones', async () => {
    const home = await freshHome();
    const dir = join(tmp.dir, 'mixed');
    await writePng(dir, 'iPad Test - Silver - Portrait.png', PAD);
    await mkdir(join(dir, 'iPhone Test'), { recursive: true });
    await writeFile(join(dir, 'iPhone Test', 'iPhone Test - Red - Portrait.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await sharp({ create: { width: 40, height: 80, channels: 3, background: '#ff00ff' } }).png().toFile(join(dir, 'Foo Phone - Blue - Portrait.png'));
    const result = await installBezels({ from: dir, home });
    expect(result.installed.map((e) => e.id)).toEqual(['ipad-test']);
    const errors = result.skipped.filter((s) => s.level === 'error').map((s) => s.file).sort();
    expect(errors).toEqual(['Foo Phone - Blue - Portrait.png', 'iPhone Test/iPhone Test - Red - Portrait.png']);
    for (const skipped of result.skipped.filter((s) => s.level === 'error')) expect(skipped.reason.length).toBeGreaterThan(0);
    expect((await readBezelIndex(join(home, 'bezels')))?.entries.map((e) => e.id)).toEqual(['ipad-test']);
    expect(await stat(join(home, 'bezels', 'ipad-test', 'silver.png'))).toBeTruthy();

    const inspect = await runS1s(['bezels', 'inspect', dir, '--json'], { env: { S1S_HOME: home } });
    expect(inspect.code, inspect.stderr).toBe(0);
    const json = parseJsonLine<{ files: Array<{ file: string; width: number | null; error: string | null }> }>(inspect);
    const bad = json.files.find((f) => f.file.endsWith('Red - Portrait.png'));
    expect(bad).toMatchObject({ width: null, error: expect.stringContaining('') });
    expect(bad?.error?.length).toBeGreaterThan(0);
    expect(json.files.find((f) => f.file.startsWith('iPad'))).toMatchObject({ width: 580, error: null });
  });

  it('merges new entries into an existing index without dropping others', async () => {
    const home = await freshHome();
    const first = await installBezels({ from: src, home, devices: ['ipad-test'] });
    expect(first.index.entries.map((e) => e.id)).toEqual(['ipad-test']);
    const second = await installBezels({ from: src, home, devices: ['iphone-test'] });
    expect(second.index.entries.map((e) => e.id)).toEqual(['ipad-test', 'iphone-test']);
    expect(second.kept).toEqual([]);
  });
});

describe('s1s bezels CLI', () => {
  let home: string;
  beforeEach(async () => {
    home = await freshHome();
  });

  it('list --json on an empty cache is ok with no entries', async () => {
    const run = await runS1s(['bezels', 'list', '--json'], { env: { S1S_HOME: home } });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine(run);
    expect(json['ok']).toBe(true);
    expect(json['entries']).toEqual([]);
    expect(json['indexPath']).toBe(join(home, 'bezels', 'index.json'));
  });

  it('install --from <dir> --json installs, then list --json maps presets', async () => {
    const run = await runS1s(['bezels', 'install', '--from', src, '--json'], { env: { S1S_HOME: home } });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<{ ok: boolean; installed: BezelEntry[]; entries: BezelEntry[]; indexPath: string; skipped: unknown[] }>(run);
    expect(json.ok).toBe(true);
    expect(json.installed.map((e) => e.id).sort()).toEqual(['ipad-test', 'iphone-test']);
    expect(json.entries).toHaveLength(2);
    expect(json.indexPath).toBe(join(home, 'bezels', 'index.json'));

    const list = await runS1s(['bezels', 'list', '--json'], { env: { S1S_HOME: home } });
    expect(list.code, list.stderr).toBe(0);
    const listed = parseJsonLine<{ entries: BezelEntry[]; presets: Record<string, string | null> }>(list);
    expect(listed.entries.map((e) => e.file).sort()).toEqual(['ipad-test/silver.png', 'iphone-test/deep-blue.png']);
    // Synthetic ids are not what the presets ask for, so every preset stays unmatched.
    expect(listed.presets['iphone-6.9']).toBeNull();
    expect(listed.presets['ipad-13']).toBeNull();

    const human = await runS1s(['bezels', 'list'], { env: { S1S_HOME: home } });
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('iphone-test');
    expect(human.stdout).toContain('No bezel for:');
  });

  it('install exits 1 when a known model no longer matches sources.ts', async () => {
    const dir = join(tmp.dir, 'changed-cli');
    await writePng(dir, 'iPad Pro (M5) 13" - Silver - Portrait.png', PAD);
    const run = await runS1s(['bezels', 'install', '--from', dir, '--json'], { env: { S1S_HOME: home } });
    expect(run.code).toBe(1);
    const json = parseJsonLine<{ ok: boolean; skipped: Array<{ level: string; file: string }> }>(run);
    expect(json.ok).toBe(false);
    expect(json.skipped[0]).toMatchObject({ level: 'error', file: 'iPad Pro (M5) 13" - Silver - Portrait.png' });
  });

  it('inspect <path> on a missing path names the positional, not --from', async () => {
    const run = await runS1s(['bezels', 'inspect', '/nonexistent/bezels', '--json'], { env: { S1S_HOME: home } });
    expect(run.code).toBe(2);
    const json = parseJsonLine<{ error: { code: string; message: string; hint: string } }>(run);
    expect(json.error.code).toBe('usage');
    expect(json.error.message).toBe('<dmg-url|path> /nonexistent/bezels does not exist.');
    expect(json.error.message).not.toContain('--from');
    expect(json.error.hint).toContain('.dmg');
  });

  it('install --device bogus is a usage error (exit 2)', async () => {
    const run = await runS1s(['bezels', 'install', '--device', 'bogus', '--json'], { env: { S1S_HOME: home } });
    expect(run.code).toBe(2);
    const json = parseJsonLine<{ ok: boolean; error: { code: string; hint: string } }>(run);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('usage');
    expect(json.error.hint).toContain('--from');
  });

  it('inspect <dir> --json lists every PNG with its proposed id and whether sources.ts knows it', async () => {
    const run = await runS1s(['bezels', 'inspect', src, '--json'], { env: { S1S_HOME: home } });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<{ source: string; files: Array<Record<string, unknown>> }>(run);
    expect(json.source).toBe(src);
    const byFile = Object.fromEntries(json.files.map((f) => [f['file'], f]));
    expect(byFile['iPhone Test/iPhone Test - Deep Blue - Portrait.png']).toMatchObject({
      width: 370,
      height: 750,
      hasAlpha: true,
      id: 'iphone-test',
      variant: 'deep-blue',
      orientation: 'portrait',
      known: false,
    });
    expect(byFile['Bezel-Test@2x.png']).toMatchObject({ id: null, variant: null, orientation: null, known: false });
    expect(json.files.some((f) => String(f['file']).startsWith('.'))).toBe(false);
  });
});
