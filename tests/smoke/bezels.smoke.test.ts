// The bezel pipeline end to end without the network: a temp folder laid out
// like a mounted Apple DMG (synthetic PNGs at Apple's full size and file
// names, plus the decoy files a real image carries) goes through
// `s1s bezels inspect`, `s1s bezels install --from` and `s1s bezels list`
// with S1S_HOME pointing at a temp cache. Every measured number is checked
// against src/core/bezels/sources.ts (the Stage A facts).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPreset } from '../../src/config/presets.ts';
import type { BezelEntry, BezelIndex, Rect } from '../../src/config/types.ts';
import { findBezel, readBezelIndex } from '../../src/core/bezels/index.ts';
import { TRIM_PAD } from '../../src/core/bezels/measure.ts';
import { BEZEL_SOURCES, type BezelSourceId } from '../../src/core/bezels/sources.ts';
import { makeTempDir, must, parseJsonLine, pngInfo, runS1s, type TempDir } from '../fixtures/helpers.ts';
import { syntheticSourceEntry, writeSyntheticDmgTree, type SyntheticDmgTree } from '../fixtures/make-bezel.ts';

// The watch is here for its file name, which spends the orientation slot on the
// strap, and for its geometry, whose corner radius reaches past the probes the
// phone and iPad shapes need.
const IDS = ['iphone-17-pro-max', 'ipad-pro-13-m5', 'apple-watch-series-11-46mm'] as const satisfies readonly BezelSourceId[];

interface InspectedFile {
  file: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  id: string | null;
  variant: string | null;
  orientation: string | null;
  known: boolean;
}
interface InspectJson {
  ok: boolean;
  files: InspectedFile[];
}
interface InstallJson {
  ok: boolean;
  installed: BezelEntry[];
  kept: BezelEntry[];
  skipped: Array<{ file: string; reason: string; level: 'info' | 'error' }>;
  indexPath: string;
  entries: BezelEntry[];
  error?: { code: string; message: string };
}
interface ListJson {
  ok: boolean;
  indexPath: string;
  entries: BezelEntry[];
  presets: Record<string, string | null>;
}

/** `rect` moved so that deviceRect starts at (TRIM_PAD, TRIM_PAD), as the installer trims it. */
function trimmed(id: BezelSourceId, rect: Rect): Rect {
  const { deviceRect } = BEZEL_SOURCES[id].portrait;
  return { x: rect.x - deviceRect.x + TRIM_PAD, y: rect.y - deviceRect.y + TRIM_PAD, width: rect.width, height: rect.height };
}

function expectRectNear(actual: Rect | undefined, expected: Rect, tolerance: number, what: string): void {
  const got = must(actual, what);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(got[key] - expected[key]), `${what}.${key}: got ${got[key]}, expected ${expected[key]}`).toBeLessThanOrEqual(tolerance);
  }
}

describe('s1s bezels on a synthetic DMG tree (smoke)', () => {
  let tmp: TempDir;
  let home: string;
  let dmgRoot: string;
  let tree: SyntheticDmgTree;
  let env: Record<string, string>;

  beforeAll(async () => {
    tmp = await makeTempDir('s1s-bezels-');
    home = join(tmp.dir, 'home');
    dmgRoot = join(tmp.dir, 'mount');
    env = { S1S_HOME: home };
    tree = await writeSyntheticDmgTree(dmgRoot, IDS);
  });
  afterAll(async () => {
    await tmp.cleanup();
  });

  it('lists nothing before the first install and does not fail', async () => {
    const run = await runS1s(['bezels', 'list', '--json'], { env });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<ListJson>(run);
    expect(json.ok).toBe(true);
    expect(json.entries).toEqual([]);
    expect(json.indexPath).toBe(join(home, 'bezels', 'index.json'));
  });

  it('inspect maps every Apple file name to an id and ignores the decoys', async () => {
    const run = await runS1s(['bezels', 'inspect', dmgRoot, '--json'], { env });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<InspectJson>(run);
    const byFile = new Map(json.files.map((f) => [f.file, f]));
    for (const rel of [...tree.portrait, ...tree.landscape]) {
      const seen = must(byFile.get(rel.replace(/^PNG\//, '')) ?? byFile.get(rel), rel);
      expect(seen.known, rel).toBe(true);
      expect(seen.hasAlpha, rel).toBe(true);
      expect(seen.orientation, rel).toBe(tree.portrait.includes(rel) ? 'portrait' : 'landscape');
    }
    const proMax = must(json.files.find((f) => f.id === 'iphone-17-pro-max' && f.orientation === 'portrait'));
    expect([proMax.width, proMax.height]).toEqual([1470, 3000]);
    expect(proMax.variant).toBe('deep-blue');
    const ipad = must(json.files.find((f) => f.id === 'ipad-pro-13-m5' && f.orientation === 'portrait'));
    expect([ipad.width, ipad.height]).toEqual([2300, 3000]);
    expect(ipad.variant).toBe('space-black');
    // Dot-folders and non-PNG files never show up; nothing is mis-read as a bezel.
    for (const decoy of tree.decoys) expect(json.files.map((f) => f.file), decoy).not.toContain(decoy);
    expect(json.files.filter((f) => f.id === null)).toEqual([]);
  });

  it('install --from measures the portrait files into S1S_HOME/bezels and skips landscape', async () => {
    const run = await runS1s(['bezels', 'install', '--from', dmgRoot, '--json'], { env });
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const json = parseJsonLine<InstallJson>(run);
    expect(json.ok, JSON.stringify(json.error ?? json.skipped)).toBe(true);
    expect(json.installed.map((e) => `${e.id}/${e.variant}/${e.orientation}`).sort()).toEqual(
      [
        'iphone-17-pro-max/deep-blue/portrait',
        'ipad-pro-13-m5/space-black/portrait',
        'apple-watch-series-11-46mm/titanium-gold-magnetic-link-sage-gray/portrait',
      ].sort(),
    );
    expect(json.kept).toEqual([]);
    expect(json.skipped.filter((s) => s.level === 'error')).toEqual([]);
    const skippedFiles = json.skipped.map((s) => s.file.replace(/^PNG\//, ''));
    for (const rel of tree.landscape) expect(skippedFiles, rel).toContain(rel.replace(/^PNG\//, ''));
    expect(json.indexPath).toBe(join(home, 'bezels', 'index.json'));
    expect(existsSync(json.indexPath)).toBe(true);
    // The cache lives under S1S_HOME only.
    expect(json.installed.every((e) => !e.file.startsWith('/'))).toBe(true);

    for (const id of IDS) {
      const expected = syntheticSourceEntry(id);
      const facts = BEZEL_SOURCES[id].portrait;
      const entry = must(json.installed.find((e) => e.id === id), id);
      // Trimmed to deviceRect + TRIM_PAD on every side.
      expect(entry.imageSize, `${id}: imageSize`).toEqual({
        width: facts.deviceRect.width + 2 * TRIM_PAD,
        height: facts.deviceRect.height + 2 * TRIM_PAD,
      });
      expectRectNear(entry.deviceRect, trimmed(id, facts.deviceRect), 0, `${id}: deviceRect`);
      expectRectNear(entry.screenRect, trimmed(id, facts.screenRect), 1, `${id}: screenRect`);
      expect(entry.screenAspect, `${id}: aspect`).toBeCloseTo(expected.screenAspect, 3);
      expect(Math.abs(entry.cornerRadius - facts.cornerRadius), `${id}: radius ${entry.cornerRadius} vs ${facts.cornerRadius}`).toBeLessThanOrEqual(3);
      expect(entry.pxPerPt, `${id}: pxPerPt`).toBe(BEZEL_SOURCES[id].pxPerPt);
      if (facts.islandRect) {
        expectRectNear(entry.islandRect, trimmed(id, facts.islandRect), 1, `${id}: islandRect`);
      } else {
        expect(entry.islandRect, `${id}: iPad has no island`).toBeUndefined();
      }
      const file = join(home, 'bezels', entry.file);
      expect(entry.file).toBe(`${id}/${expected.variant}.png`);
      expect(await pngInfo(file), file).toMatchObject({ width: entry.imageSize.width, height: entry.imageSize.height, hasAlpha: true });
    }
    expect(must(json.installed.find((e) => e.id === 'iphone-17-pro-max')).screenAspect.toFixed(4)).toBe('0.4603');
    expect(must(json.installed.find((e) => e.id === 'ipad-pro-13-m5')).screenAspect.toFixed(4)).toBe('0.7500');
    expect(must(json.installed.find((e) => e.id === 'apple-watch-series-11-46mm')).screenAspect.toFixed(4)).toBe('0.8387');
  });

  it('a second install keeps the entries instead of re-measuring', async () => {
    const run = await runS1s(['bezels', 'install', '--from', dmgRoot, '--json'], { env });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<InstallJson>(run);
    expect(json.ok).toBe(true);
    expect(json.installed).toEqual([]);
    expect(json.kept.map((e) => e.id).sort()).toEqual([...IDS].sort());
    expect(json.entries).toHaveLength(IDS.length);
  });

  it('list shows which preset uses which bezel', async () => {
    const run = await runS1s(['bezels', 'list', '--json'], { env });
    expect(run.code, run.stderr).toBe(0);
    const json = parseJsonLine<ListJson>(run);
    expect(json.ok).toBe(true);
    expect(json.entries.map((e) => e.id).sort()).toEqual([...IDS].sort());
    expect(json.presets['iphone-6.9']).toBe('iphone-17-pro-max/deep-blue');
    expect(json.presets['iphone-6.7']).toBe('iphone-17-pro-max/deep-blue');
    expect(json.presets['ipad-13']).toBe('ipad-pro-13-m5/space-black');
    // iphone-6.1 wants iphone-17-pro; the Pro Max is on its fallback list.
    expect(json.presets['iphone-6.1']).toBe('iphone-17-pro-max/deep-blue (fallback)');
    expect(json.presets['ipad-11']).toBeNull();
    expect(json.presets['watch-s10']).toBe('apple-watch-series-11-46mm/titanium-gold-magnetic-link-sage-gray');
  });

  it('the written index parses and resolves the default presets without a fallback', async () => {
    const index: BezelIndex = must(await readBezelIndex(join(home, 'bezels')), 'index');
    expect(index.version).toBe(1);
    for (const sizeId of ['iphone-6.9', 'ipad-13'] as const) {
      const match = must(findBezel(index, getPreset(sizeId)), sizeId);
      expect(match.fallback, sizeId).toBe(false);
      expect(match.entry.id).toBe(getPreset(sizeId).bezel);
    }
  });

  it('install --device with an id the folder does not hold installs nothing and exits 1', async () => {
    const run = await runS1s(['bezels', 'install', '--from', dmgRoot, '--device', 'iphone-air', '--json'], { env });
    expect(run.code).toBe(1);
    const json = parseJsonLine<InstallJson>(run);
    expect(json.ok).toBe(false);
    expect(json.installed).toEqual([]);
    expect(json.kept).toEqual([]);
  });
});
