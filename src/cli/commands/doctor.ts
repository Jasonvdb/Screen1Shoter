// `s1s doctor`: environment checks. `fail` = rendering cannot work;
// `warn` = a later phase (bezels, capture, upload) needs attention.
import { lstat, readFile, readdir, readlink, stat as statPath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import type { BezelIndex } from '../../config/index.ts';
import { isS1sError } from '../../core/errors.ts';
import { run, which } from '../../core/exec.ts';
import { readManifest } from '../../core/manifest.ts';
import { S1S_HOME, bezelDir, metadataDir, toolRoot } from '../../core/paths.ts';
import { findProjectDir } from '../../core/project.ts';
import { ensureDeveloperDir, listSims } from '../../core/sim.ts';
import { bullets, defineAction, table, type CommandOutput, type GlobalOpts } from '../output.ts';
import { cliLinkPath } from './link.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  id: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

const make = (id: string, status: CheckStatus, detail: string, hint?: string): Check =>
  hint === undefined ? { id, status, detail } : { id, status, detail, hint };
const ok = (id: string, detail: string): Check => make(id, 'ok', detail);
const warn = (id: string, detail: string, hint?: string): Check => make(id, 'warn', detail, hint);
const fail = (id: string, detail: string, hint?: string): Check => make(id, 'fail', detail, hint);
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Version of a direct dependency. Reads the file directly when `exports` hides package.json (sharp). */
async function packageVersion(name: string): Promise<string | null> {
  try {
    const require = createRequire(join(toolRoot(), 'package.json'));
    const pkg = require(`${name}/package.json`) as { version?: string };
    return pkg.version ?? null;
  } catch {
    try {
      const raw = await readFile(join(toolRoot(), 'node_modules', name, 'package.json'), 'utf8');
      return (JSON.parse(raw) as { version?: string }).version ?? null;
    } catch {
      return null;
    }
  }
}

function checkNode(): Check {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  return major === 24 ? ok('node', `v${version}`) : fail('node', `v${version}`, 'Screen1Shoter needs Node 24.x (package.json engines).');
}

async function checkTsx(): Promise<Check> {
  const version = await packageVersion('tsx');
  return version ? ok('tsx', version) : fail('tsx', 'not installed', `Run \`pnpm install\` in ${toolRoot()}.`);
}

/**
 * Probes the exact code path `s1s render` uses (`chromium.launch({ headless:
 * true })`, which runs the headless shell build), not `executablePath()`,
 * which names the full Chromium build and can disagree in both directions.
 */
async function checkPlaywright(): Promise<Check> {
  const version = await packageVersion('playwright');
  if (!version) return fail('playwright', 'not installed', `Run \`pnpm install\` in ${toolRoot()}.`);
  const installHint = `Run \`pnpm exec playwright install chromium\` in ${toolRoot()}.`;
  try {
    // Dynamic: a missing playwright must not break the CLI at import time.
    const { launchBrowser } = await import('../../render/browser.ts');
    const browser = await launchBrowser();
    try {
      return ok('playwright', `${version}, Chromium ${browser.version()} launches headless`);
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const detail = message(err).split('\n')[0] ?? 'launch failed';
    return fail('playwright', `${version}, ${detail}`, installHint);
  }
}

async function checkSharp(): Promise<Check> {
  try {
    const sharp = (await import('sharp')).default;
    return ok('sharp', `${(await packageVersion('sharp')) ?? '?'}, libvips ${sharp.versions.vips}`);
  } catch (err) {
    return fail('sharp', message(err), `Run \`pnpm rebuild sharp\` in ${toolRoot()}.`);
  }
}

async function checkBezels(): Promise<Check> {
  const indexPath = join(bezelDir(), 'index.json');
  try {
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as BezelIndex;
    const ids = [...new Set(index.entries.map((e) => e.id))];
    return ok('bezels', `${index.entries.length} file(s): ${ids.join(', ') || 'none'}`);
  } catch {
    return warn('bezels', `no index at ${indexPath}`, 'Run `s1s bezels install`; until then renders use a generic frame (bezel-fallback).');
  }
}

async function checkAsc(): Promise<Check> {
  const path = await which('asc');
  if (!path) return warn('asc', 'not on PATH', 'Install the asc CLI to validate and upload screenshots (export phase).');
  const result = await run('asc', ['--version'], { timeoutMs: 10_000 }).catch(() => null);
  const version = result && result.code === 0 ? result.stdout.trim().split('\n')[0] : null;
  return ok('asc', version ? `${version} (${path})` : path);
}

async function checkSimctl(): Promise<Check> {
  const xcodeHint = 'Install Xcode and run `xcode-select -s /Applications/Xcode.app` (needed for capture).';
  try {
    // `xcode-select -p` first: it never prompts, whereas `xcrun` without an
    // active developer directory opens the macOS install dialog and blocks.
    await ensureDeveloperDir();
  } catch (err) {
    return warn('simctl', message(err), isS1sError(err) && err.hint ? err.hint : xcodeHint);
  }
  try {
    const sims = await listSims();
    const available = sims.filter((s) => s.isAvailable).length;
    const booted = sims.filter((s) => s.state === 'Booted').length;
    return ok('simctl', `${available} simulators available, ${booted} booted`);
  } catch (err) {
    return warn('simctl', message(err), xcodeHint);
  }
}

/**
 * Export target: `s1s export` writes metadata/screenshots/<locale>/... and
 * `asc` uploads from there. Missing is fine (export creates it); a file in the
 * way, or a dir with no locale folders yet, is worth saying out loud.
 */
async function checkMetadataDir(projectDir: string | null): Promise<Check> {
  // Environment-only run (no app repo here): nothing to check, not a problem.
  if (projectDir === null) return ok('metadata dir', 'not checked: no screenshots project here');
  const manifest = await readManifest(join(projectDir, 'manifest.json')).catch(() => null);
  if (manifest === null) return warn('metadata dir', `cannot read ${join(projectDir, 'manifest.json')}`, 'Fix the manifest JSON; `s1s export` reads app.metadataDir from it.');
  const dir = metadataDir({ appDir: dirname(projectDir), manifest });
  const info = await statPath(dir).catch(() => null);
  if (!info) return warn('metadata dir', `${dir} does not exist`, '`s1s export` creates it; until then there is nothing for `asc screenshots upload` to read.');
  if (!info.isDirectory()) return fail('metadata dir', `${dir} is not a directory`, 'Move the file aside: `s1s export` needs that path to be a folder.');
  const locales = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
  return locales.length > 0
    ? ok('metadata dir', `${dir} (${locales.join(', ')})`)
    : warn('metadata dir', `${dir} is empty`, 'Run `s1s export --locale <locale>` to fill it.');
}

async function checkCliLink(): Promise<Check> {
  const linkPath = cliLinkPath();
  const expected = join(toolRoot(), 'bin', 's1s.js');
  const stat = await lstat(linkPath).catch(() => null);
  if (!stat) return warn('cli link', `${linkPath} missing`, 'Run `s1s link --cli` (or `pnpm link-cli` in the checkout).');
  if (!stat.isSymbolicLink()) return warn('cli link', `${linkPath} is not a symlink`, 'Move it aside and run `s1s link --cli`.');
  const target = await readlink(linkPath);
  if (target !== expected) return warn('cli link', `${linkPath} -> ${target}; this checkout is ${expected}`, 'Run `s1s link --cli` to repoint it.');
  const binDir = dirname(linkPath);
  const onPath = (process.env['PATH'] ?? '').split(':').includes(binDir);
  return onPath ? ok('cli link', `${linkPath} -> ${target}`) : warn('cli link', `${linkPath} ok, but ${binDir} is not on PATH`, `Add ${binDir} to PATH in your shell profile.`);
}

export async function runDoctor(opts: { projectDir?: string } = {}): Promise<Check[]> {
  const projectDir = findProjectDir(opts.projectDir ?? process.cwd());
  return [
    ok('tool', `${toolRoot()} (S1S_HOME ${S1S_HOME})`),
    checkNode(),
    await checkTsx(),
    await checkPlaywright(),
    await checkSharp(),
    await checkBezels(),
    await checkAsc(),
    await checkSimctl(),
    await checkMetadataDir(projectDir),
    await checkCliLink(),
  ];
}

async function doctorCommand(globals: GlobalOpts): Promise<CommandOutput> {
  const checks = await runDoctor(globals.project !== undefined ? { projectDir: globals.project } : {});
  const failed = checks.filter((c) => c.status === 'fail');
  const hints = checks.filter((c) => c.hint !== undefined).map((c) => `${c.id}: ${c.hint}`);
  const lines = [table(['check', 'status', 'detail'], checks.map((c) => [c.id, c.status, c.detail]))];
  if (hints.length > 0) lines.push('', 'Hints:', bullets(hints));
  lines.push('', failed.length === 0 ? 'Ready to render.' : `${failed.length} check(s) failed.`);
  return {
    data: { ok: failed.length === 0, checks },
    text: lines.join('\n'),
    exitCode: failed.length === 0 ? 0 : 1,
  };
}

export function registerDoctor(program: Command): void {
  defineAction(
    program
      .command('doctor')
      .description('Check node, tsx, Playwright + Chromium, sharp, bezels, asc, simctl, the metadata dir and the CLI link'),
    ({ globals }) => doctorCommand(globals),
  );
}
