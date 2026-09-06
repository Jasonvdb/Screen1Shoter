// `s1s doctor`: the checks that read the filesystem, the manifest and PATH.
//
// `runDoctor` is the only entry point the command exports, so every case here
// runs the whole sweep and picks one check out of it. Two environment
// overrides keep that cheap and machine-independent: PATH points at a temp bin
// dir (so `asc` is exactly what the test puts there, and `xcode-select` is
// absent), and PLAYWRIGHT_BROWSERS_PATH at an empty dir (so the Chromium probe
// fails in a millisecond instead of launching a browser per case). Neither
// touches the checks under test; HOME moves the `cli link` check onto a temp
// home so it never reports on this machine's real ~/.local/bin.
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor, type Check } from '../../src/cli/commands/doctor.ts';
import { defaultManifestApp, emptyManifest, writeManifest } from '../../src/core/manifest.ts';
import { toolRoot } from '../../src/core/paths.ts';
import { makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

const OVERRIDDEN = ['HOME', 'PATH', 'PLAYWRIGHT_BROWSERS_PATH'] as const;

let tmp: TempDir;
/** Empty by default; the asc cases drop a stub executable in here. */
let binDir: string;
/** A directory with no `screens.ts` above or below it, for the project-free cases. */
let elsewhere: string;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  saved = Object.fromEntries(OVERRIDDEN.map((key) => [key, process.env[key]]));
  tmp = await makeTempDir('s1s-doctor-');
  binDir = join(tmp.dir, 'bin');
  elsewhere = join(tmp.dir, 'elsewhere');
  await mkdir(binDir, { recursive: true });
  await mkdir(elsewhere, { recursive: true });
  process.env['HOME'] = join(tmp.dir, 'home');
  process.env['PATH'] = binDir;
  process.env['PLAYWRIGHT_BROWSERS_PATH'] = join(tmp.dir, 'no-browsers');
});

afterEach(async () => {
  for (const key of OVERRIDDEN) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await tmp.cleanup();
});

async function doctorCheck(id: string, projectDir: string): Promise<Check> {
  const checks = await runDoctor({ projectDir });
  return must(
    checks.find((check) => check.id === id),
    `doctor check "${id}"`,
  );
}

/** A shell stub on PATH, so `asc` never means this machine's real asc. */
async function stubExecutable(name: string, script: string): Promise<string> {
  const path = join(binDir, name);
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

describe('doctor: the whole sweep', () => {
  it('reports every check once, and only fail sets the exit-worthy state', async () => {
    const checks = await runDoctor({ projectDir: elsewhere });
    const ids = checks.map((check) => check.id);
    expect(ids).toEqual(['tool', 'node', 'tsx', 'playwright', 'sharp', 'bezels', 'asc', 'simctl', 'metadata dir', 'cli link']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const check of checks) {
      expect(['ok', 'warn', 'fail'], `${check.id} status`).toContain(check.status);
      expect(check.detail, `${check.id} detail`).not.toBe('');
      if (check.status !== 'ok') expect(check.hint, `${check.id} hint`).toBeTruthy();
    }
  });

  it('every check that is not ok carries an actionable hint', async () => {
    const checks = await runDoctor({ projectDir: elsewhere });
    const hintless = checks.filter((check) => check.status !== 'ok' && (check.hint ?? '') === '');
    expect(hintless.map((check) => check.id)).toEqual([]);
  });
});

describe('doctor: metadata dir', () => {
  let appDir: string;
  let projectDir: string;
  let manifestPath: string;

  /** Writes a manifest whose `app.metadataDir` is `metadataDir`. */
  async function writeAppManifest(metadataDir: string): Promise<void> {
    await writeManifest(manifestPath, emptyManifest(defaultManifestApp(manifestPath, { metadataDir })));
  }

  beforeEach(async () => {
    appDir = join(tmp.dir, 'App');
    projectDir = join(appDir, 'screenshots');
    manifestPath = join(projectDir, 'manifest.json');
    await mkdir(projectDir, { recursive: true });
    // findProjectDir only asks whether screens.ts exists; doctor never loads it.
    await writeFile(join(projectDir, 'screens.ts'), '// project marker\n');
    await writeAppManifest('metadata/screenshots');
  });

  it('is not checked at all when there is no screenshots project here', async () => {
    const check = await doctorCheck('metadata dir', elsewhere);
    expect(check.status).toBe('ok');
    expect(check.detail).toBe('not checked: no screenshots project here');
    expect(check.hint).toBeUndefined();
  });

  it('warns when the directory does not exist yet, because `s1s export` creates it', async () => {
    const check = await doctorCheck('metadata dir', appDir);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`${join(appDir, 'metadata', 'screenshots')} does not exist`);
    expect(check.hint).toContain('s1s export');
  });

  it('fails when a file sits where the directory belongs', async () => {
    await mkdir(join(appDir, 'metadata'), { recursive: true });
    await writeFile(join(appDir, 'metadata', 'screenshots'), 'not a directory\n');
    const check = await doctorCheck('metadata dir', appDir);
    expect(check.status).toBe('fail');
    expect(check.detail).toBe(`${join(appDir, 'metadata', 'screenshots')} is not a directory`);
    expect(check.hint).toContain('folder');
  });

  it('warns when the directory holds no locale folder (loose files do not count)', async () => {
    const dir = join(appDir, 'metadata', 'screenshots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'README.md'), 'not a locale\n');
    const check = await doctorCheck('metadata dir', appDir);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`${dir} is empty`);
    expect(check.hint).toContain('s1s export --locale');
  });

  it('is ok once locale folders exist, and names them', async () => {
    const dir = join(appDir, 'metadata', 'screenshots');
    await mkdir(join(dir, 'en-US', 'APP_IPHONE_69'), { recursive: true });
    await mkdir(join(dir, 'de-DE'), { recursive: true });
    const check = await doctorCheck('metadata dir', appDir);
    expect(check.status).toBe('ok');
    expect(check.detail).toContain(dir);
    expect(check.detail).toContain('en-US');
    expect(check.detail).toContain('de-DE');
    expect(check.hint).toBeUndefined();
  });

  it('reads the folder from app.metadataDir, not from a hard-coded path', async () => {
    await writeAppManifest('store/shots');
    await mkdir(join(appDir, 'store', 'shots', 'en-US'), { recursive: true });
    const check = await doctorCheck('metadata dir', appDir);
    expect(check.status).toBe('ok');
    expect(check.detail).toBe(`${join(appDir, 'store', 'shots')} (en-US)`);
  });

  it('warns instead of throwing when the manifest cannot be read', async () => {
    await writeFile(manifestPath, '{ not json\n');
    const check = await doctorCheck('metadata dir', appDir);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`cannot read ${manifestPath}`);
    expect(check.hint).toContain('app.metadataDir');
  });
});

describe('doctor: asc', () => {
  it('warns when asc is not on PATH, and says which phase needs it', async () => {
    const check = await doctorCheck('asc', elsewhere);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe('not on PATH');
    expect(check.hint).toContain('asc');
  });

  it('reports the version and the resolved path when asc answers --version', async () => {
    const path = await stubExecutable('asc', '#!/bin/sh\necho "asc 1.2.2"\necho "second line ignored"\n');
    const check = await doctorCheck('asc', elsewhere);
    expect(check.status).toBe('ok');
    expect(check.detail).toBe(`asc 1.2.2 (${path})`);
    expect(check.hint).toBeUndefined();
  });

  it('is still ok, path only, when asc is installed but --version fails', async () => {
    const path = await stubExecutable('asc', '#!/bin/sh\nexit 3\n');
    const check = await doctorCheck('asc', elsewhere);
    expect(check.status).toBe('ok');
    expect(check.detail).toBe(path);
  });
});

describe('doctor: cli link', () => {
  const expected = (): string => join(toolRoot(), 'bin', 's1s.js');
  let linkPath: string;
  let localBin: string;

  beforeEach(async () => {
    localBin = join(must(process.env['HOME'], 'HOME'), '.local', 'bin');
    linkPath = join(localBin, 's1s');
    await mkdir(localBin, { recursive: true });
  });

  it('warns when the link is missing', async () => {
    const check = await doctorCheck('cli link', elsewhere);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`${linkPath} missing`);
    expect(check.hint).toContain('s1s link --cli');
  });

  it('warns when something that is not a symlink sits there', async () => {
    await writeFile(linkPath, '#!/bin/sh\n');
    const check = await doctorCheck('cli link', elsewhere);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`${linkPath} is not a symlink`);
    expect(check.hint).toContain('Move it aside');
  });

  it('warns when the link points at another checkout, and names both sides', async () => {
    await symlink('/other/checkout/bin/s1s.js', linkPath);
    const check = await doctorCheck('cli link', elsewhere);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`${linkPath} -> /other/checkout/bin/s1s.js; this checkout is ${expected()}`);
    expect(check.hint).toContain('repoint');
  });

  it('warns when the link is right but its directory is not on PATH', async () => {
    await symlink(expected(), linkPath);
    const check = await doctorCheck('cli link', elsewhere);
    expect(check.status).toBe('warn');
    expect(check.detail).toBe(`${linkPath} ok, but ${localBin} is not on PATH`);
    expect(check.hint).toContain(localBin);
  });

  it('is ok when the link points here and its directory is on PATH', async () => {
    await symlink(expected(), linkPath);
    process.env['PATH'] = `${binDir}:${localBin}`;
    const check = await doctorCheck('cli link', elsewhere);
    expect(check.status).toBe('ok');
    expect(check.detail).toBe(`${linkPath} -> ${expected()}`);
    expect(check.hint).toBeUndefined();
  });
});
