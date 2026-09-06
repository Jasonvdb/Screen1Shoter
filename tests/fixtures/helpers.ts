// Small helpers shared by the unit tests. No vitest import here so the file
// can also serve the smoke test later.
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { LocaleCopy, ProjectManifest, ScreensConfig, ThemeInput } from '../../src/config/types.ts';
import { isS1sError, type S1sError } from '../../src/core/errors.ts';

const execFileAsync = promisify(execFile);

export const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

export type FixtureName = 'project-basic' | 'project-bare';

/** `<fixtures>/<name>` — plays the role of the app repo root. */
export function fixtureAppDir(name: FixtureName): string {
  return join(FIXTURES_DIR, name);
}

/** `<fixtures>/<name>/screenshots` — the project dir loadProject expects. */
export function fixtureProjectDir(name: FixtureName): string {
  return join(fixtureAppDir(name), 'screenshots');
}

/** Narrows `T | undefined | null` with a readable failure. */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}

export interface TempDir {
  dir: string;
  cleanup: () => Promise<void>;
}

export async function makeTempDir(prefix = 's1s-test-'): Promise<TempDir> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Awaits a promise that must reject with an S1sError and returns the error so
 * the test can assert on `code`, `hint` and `exitCode`. (Vitest's
 * `rejects.toMatchObject` does not compare Error instances to plain objects.)
 */
export async function catchS1sError(promise: Promise<unknown>): Promise<S1sError> {
  let result: unknown;
  try {
    result = await promise;
  } catch (err) {
    if (isS1sError(err)) return err;
    throw new Error(`Expected an S1sError but got: ${String(err)}`);
  }
  throw new Error(`Expected an S1sError but the promise resolved with ${JSON.stringify(result)}`);
}

// ---------------------------------------------------------------------------
// Temp projects
// ---------------------------------------------------------------------------

/** Checkout root (tests/fixtures/../..). */
export const REPO_ROOT = join(FIXTURES_DIR, '..', '..');

/** Absolute path fixture files import instead of 'screen1shoter/config'. */
export const CONFIG_ENTRY = join(REPO_ROOT, 'src', 'config', 'index.ts');

/** The relative import the checked-in fixture projects use. */
const FIXTURE_CONFIG_IMPORT = '../../../../src/config/index.ts';

/**
 * Copies `<fixtures>/<name>/screenshots` to `destDir` and rewrites the
 * relative config import to an absolute one, so the copy loads from anywhere.
 */
export async function copyFixtureProject(name: FixtureName, destDir: string): Promise<string> {
  await cp(fixtureProjectDir(name), destDir, {
    recursive: true,
    filter: (src) => !/(?:^|\/)(?:node_modules|out)(?:\/|$)/.test(src),
  });
  for (const file of ['screens.ts', 'theme.ts']) {
    const path = join(destDir, file);
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.split(FIXTURE_CONFIG_IMPORT).join(CONFIG_ENTRY));
  }
  return destDir;
}

export interface TempProjectFiles {
  screens: ScreensConfig;
  /** Default: a dark theme. */
  theme?: ThemeInput;
  /** Copy files by locale. Default: none. */
  copies?: Record<string, LocaleCopy>;
  manifest?: ProjectManifest;
}

/** Writes a data-only project (screens.ts, theme.ts, copy/, manifest.json) into `dir`. */
export async function writeTempProject(dir: string, files: TempProjectFiles): Promise<string> {
  await mkdir(join(dir, 'copy'), { recursive: true });
  const theme: ThemeInput = files.theme ?? { background: '#101014', accent: '#6c8cff', text: '#ffffff' };
  await writeFile(
    join(dir, 'screens.ts'),
    `import { defineScreens } from '${CONFIG_ENTRY}';\nexport default defineScreens(${JSON.stringify(files.screens)});\n`,
  );
  await writeFile(
    join(dir, 'theme.ts'),
    `import { defineTheme } from '${CONFIG_ENTRY}';\nexport default defineTheme(${JSON.stringify(theme)});\n`,
  );
  for (const [locale, copy] of Object.entries(files.copies ?? {})) {
    await writeFile(join(dir, 'copy', `${locale}.json`), `${JSON.stringify(copy, null, 2)}\n`);
  }
  if (files.manifest) await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(files.manifest, null, 2)}\n`);
  return dir;
}

/** Copies example/screenshots (without out/, node_modules/, captures/) to `destDir`. */
export async function copyExampleProject(destDir: string): Promise<string> {
  await cp(join(REPO_ROOT, 'example', 'screenshots'), destDir, {
    recursive: true,
    filter: (src) => !/(?:^|\/)(?:node_modules|out|captures)(?:\/|$)/.test(src),
  });
  return destDir;
}

// ---------------------------------------------------------------------------
// CLI and PNG helpers (smoke tests)
// ---------------------------------------------------------------------------

export const S1S_BIN = join(REPO_ROOT, 'bin', 's1s.js');

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliRunOptions {
  cwd?: string;
  /** Extra environment on top of process.env (e.g. S1S_HOME). */
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** Spawns `node bin/s1s.js <args>`; never throws, the exit code is in the result. */
export async function runS1s(args: readonly string[], opts: CliRunOptions = {}): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [S1S_BIN, ...args], {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      maxBuffer: 16 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 120_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string; stderr?: string };
    const code = typeof failed.code === 'number' ? failed.code : -1;
    return { code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

/** Parses `--json` stdout, which must be exactly one line. Throws with stdout/stderr when it is not. */
export function parseJsonLine<T = Record<string, unknown>>(run: CliRun): T {
  const lines = run.stdout.split('\n').filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(`Expected one JSON line on stdout, got ${lines.length}.\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  }
  return JSON.parse(lines[0] ?? '') as T;
}

export interface PngInfo {
  width: number;
  height: number;
  channels: number;
  hasAlpha: boolean;
}

/** Width, height, channel count and alpha flag of a PNG on disk. */
export async function pngInfo(path: string): Promise<PngInfo> {
  const meta = await sharp(path).metadata();
  return { width: meta.width, height: meta.height, channels: meta.channels, hasAlpha: meta.hasAlpha === true };
}

/** '#0B0F19' -> [11, 15, 25]. Accepts 3- and 6-digit forms. */
export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
