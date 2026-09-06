// `s1s link`: symlinks that make the no-build-step layout work.
//
// - `link --cli`: ~/.local/bin/s1s -> <checkout>/bin/s1s.js (global command).
// - `link`: <project>/node_modules/{screen1shoter, react, react-dom,
//   @types/react, @types/react-dom} -> this checkout, so Node (tsx) resolves
//   `screen1shoter/config` from screens.ts and the app's editor resolves
//   template imports. Idempotent; never clobbers a real file or directory.
//
// Also home of `openProject`: every command that loads a project links it
// first, so `s1s render` works on a freshly cloned project.
import { chmod, lstat, mkdir, readlink, realpath, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { S1sError } from '../../core/errors.ts';
import { toolRoot } from '../../core/paths.ts';
import { findProjectDir, loadProject, type Project } from '../../core/project.ts';
import { bullets, defineAction, type CommandOutput, type GlobalOpts } from '../output.ts';

interface LinkFlags {
  cli?: boolean;
}

export type LinkStatus = 'created' | 'updated' | 'unchanged' | 'kept';

export interface LinkResult {
  path: string;
  target: string;
  status: LinkStatus;
  /** Set when status is 'kept': why the existing entry was left alone. */
  note?: string;
}

/** Packages linked into <project>/node_modules besides `screen1shoter` itself. */
export const PROJECT_LINKS = ['react', 'react-dom', '@types/react', '@types/react-dom'] as const;

export function cliLinkPath(): string {
  return join(homedir(), '.local', 'bin', 's1s');
}

async function ensureSymlink(
  linkPath: string,
  target: string,
  opts: { onFile: 'throw' | 'keep' },
): Promise<LinkResult> {
  await mkdir(dirname(linkPath), { recursive: true });
  const existing = await lstat(linkPath).catch(() => null);
  if (existing && !existing.isSymbolicLink()) {
    if (opts.onFile === 'throw') {
      throw new S1sError('usage', `${linkPath} exists and is not a symlink; refusing to overwrite it.`, {
        hint: 'Move it aside, then run `s1s link --cli` again.',
        exitCode: 1,
      });
    }
    return { path: linkPath, target, status: 'kept', note: 'exists and is not a symlink' };
  }
  if (existing) {
    const current = await readlink(linkPath);
    if (current === target) return { path: linkPath, target, status: 'unchanged' };
    await rm(linkPath);
    await symlink(target, linkPath);
    return { path: linkPath, target, status: 'updated' };
  }
  await symlink(target, linkPath);
  return { path: linkPath, target, status: 'created' };
}

/** Creates ~/.local/bin/s1s -> <checkout>/bin/s1s.js and makes the shim executable. */
export async function linkCli(): Promise<LinkResult & { onPath: boolean }> {
  const target = join(toolRoot(), 'bin', 's1s.js');
  await chmod(target, 0o755);
  const result = await ensureSymlink(cliLinkPath(), target, { onFile: 'throw' });
  const binDir = dirname(cliLinkPath());
  const onPath = (process.env['PATH'] ?? '').split(':').includes(binDir);
  return { ...result, onPath };
}

/** Links <project>/node_modules to this checkout. Safe to call repeatedly. */
export async function linkProject(projectDir: string): Promise<LinkResult[]> {
  const root = toolRoot();
  const nodeModules = join(projectDir, 'node_modules');
  const results = [await ensureSymlink(join(nodeModules, 'screen1shoter'), root, { onFile: 'keep' })];
  for (const name of PROJECT_LINKS) {
    results.push(await ensureSymlink(join(nodeModules, name), join(root, 'node_modules', name), { onFile: 'keep' }));
  }
  return results;
}

/**
 * true only when node_modules/screen1shoter is a symlink to this checkout
 * (by link text or real path). A dangling link, or a link into another
 * checkout, counts as not linked so openProject repairs it.
 */
export async function isProjectLinked(projectDir: string): Promise<boolean> {
  const linkPath = join(projectDir, 'node_modules', 'screen1shoter');
  const stat = await lstat(linkPath).catch(() => null);
  if (!stat?.isSymbolicLink()) return false;
  const root = toolRoot();
  const target = await readlink(linkPath);
  if (resolve(dirname(linkPath), target) === root) return true;
  const [linked, real] = await Promise.all([realpath(linkPath).catch(() => null), realpath(root).catch(() => null)]);
  return linked !== null && linked === real;
}

/** Locates the project dir for `--project` (or the cwd) without loading it. */
export function projectDirFrom(globals: GlobalOpts): string {
  const start = globals.project ? resolve(globals.project) : process.cwd();
  const found = findProjectDir(start);
  if (found) return found;
  throw new S1sError('project-not-found', `No screenshots project (screens.ts) found from ${start}.`, {
    hint: globals.project
      ? 'Pass --project <app> or --project <app>/screenshots, or run `s1s init` there first.'
      : 'Run from the app repo or its screenshots/ dir, pass --project, or run `s1s init`.',
  });
}

/**
 * Links (when missing, dangling or pointing at another checkout) and loads
 * the project addressed by the global options. A repair is reported on
 * stderr; a real directory in node_modules is kept as it is.
 */
export async function openProject(globals: GlobalOpts): Promise<Project> {
  const dir = projectDirFrom(globals);
  if (!(await isProjectLinked(dir))) {
    const repaired = (await linkProject(dir)).filter((r) => r.status === 'updated');
    if (repaired.length > 0) {
      process.stderr.write(`s1s: relinked ${repaired.map((r) => r.path).join(', ')} -> ${toolRoot()}\n`);
    }
  }
  return loadProject({ projectDir: dir });
}

function describeLinks(results: readonly LinkResult[]): string[] {
  return results.map((r) => `${r.status.padEnd(9)} ${r.path} -> ${r.target}${r.note ? ` (${r.note})` : ''}`);
}

async function linkCliOutput(): Promise<CommandOutput> {
  const result = await linkCli();
  const lines = describeLinks([result]);
  if (!result.onPath) {
    lines.push(`note: ${dirname(result.path)} is not on PATH; add it to your shell profile.`);
  }
  return {
    data: { link: result, onPath: result.onPath },
    text: lines.join('\n'),
  };
}

async function linkProjectOutput(globals: GlobalOpts): Promise<CommandOutput> {
  const dir = projectDirFrom(globals);
  const links = await linkProject(dir);
  return {
    data: { projectDir: dir, links },
    text: `Linked ${dir}/node_modules\n${bullets(describeLinks(links))}`,
  };
}

export function registerLink(program: Command): void {
  defineAction<LinkFlags>(
    program
      .command('link')
      .description('Create symlinks: --cli puts `s1s` on PATH; without it, link the project node_modules to this checkout')
      .option('--cli', 'create ~/.local/bin/s1s -> <checkout>/bin/s1s.js'),
    ({ globals, opts }) => (opts.cli ? linkCliOutput() : linkProjectOutput(globals)),
  );
}
