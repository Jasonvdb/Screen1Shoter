// The agent-facing contract, verified by spawning bin/s1s.js: every command
// supports --json, errors print { ok: false, error: { code, message, hint } }
// as exactly one stdout line, and exit codes are 0 ok / 1 failure / 2 usage.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeExampleCaptures } from '../../example/screenshots/make-captures.ts';
import { REPO_ROOT, copyExampleProject, fixtureProjectDir, makeTempDir, type TempDir } from '../fixtures/helpers.ts';

const execFileAsync = promisify(execFile);
const BIN = join(REPO_ROOT, 'bin', 's1s.js');

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function s1s(args: string[], cwd = REPO_ROOT): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], { cwd, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

/** stdout must be exactly one JSON line in --json mode (progress stays on stderr). */
function oneJsonLine(run: CliRun): Record<string, unknown> {
  const lines = run.stdout.split('\n').filter((line) => line.length > 0);
  expect(lines, run.stdout).toHaveLength(1);
  expect(run.stdout.endsWith('\n')).toBe(true);
  return JSON.parse(lines[0] ?? '') as Record<string, unknown>;
}

type ErrorJson = { ok: false; error: { code: string; message: string; hint: string | null } };

describe('s1s --json contract', () => {
  it('no command: exit 2 with a usage error object', async () => {
    const run = await s1s(['--json']);
    expect(run.code).toBe(2);
    const json = oneJsonLine(run) as ErrorJson;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('usage');
    expect(json.error.message).toContain('No command given');
    expect(json.error.hint).toBe('Run `s1s --help`.');
  });

  it('a later-phase stub (sheet): exit 2 with the same shape', async () => {
    const run = await s1s(['sheet', '--json']);
    expect(run.code).toBe(2);
    const json = oneJsonLine(run) as ErrorJson;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('usage');
    expect(json.error.message).toContain('not implemented');
  });

  it('render on a missing project: exit 1, project-not-found with a hint', async () => {
    const run = await s1s(['render', '--project', '/nonexistent/app', '--json']);
    expect(run.code).toBe(1);
    const json = oneJsonLine(run) as ErrorJson;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('project-not-found');
    expect(typeof json.error.hint).toBe('string');
    expect(json.error.hint?.length).toBeGreaterThan(0);
  });

  it('render --dry-run with missing captures: exit 1, ok false, report.dryRun true', async () => {
    const run = await s1s(['render', '--project', fixtureProjectDir('project-basic'), '--dry-run', '--sizes', 'ipad-13', '--json']);
    expect(run.code).toBe(1);
    const json = oneJsonLine(run) as { ok: boolean; report: { dryRun: boolean; items: Array<{ warnings: Array<{ code: string }> }> } };
    expect(json.ok).toBe(false);
    expect(json.report.dryRun).toBe(true);
    expect(json.report.items).toHaveLength(3);
    for (const item of json.report.items) expect(item.warnings.map((w) => w.code)).toContain('capture-missing');
  });

  it('--version: exit 0 and the package.json version', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
    const run = await s1s(['--version']);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`${pkg.version}\n`);
  });

  it('a usage error without --json prints text on stderr and nothing on stdout', async () => {
    const run = await s1s(['render', '--project', '/nonexistent/app']);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('s1s: ');
    expect(run.stderr).toContain('hint:');
  });
});

describe('s1s render --dry-run on a copy of example/', () => {
  let tmp: TempDir;
  let dir: string;

  beforeAll(async () => {
    tmp = await makeTempDir('s1s-cli-');
    dir = await copyExampleProject(join(tmp.dir, 'Example', 'screenshots'));
    await writeExampleCaptures(dir);
  });
  afterAll(() => tmp.cleanup());

  it('exit 0, ok true, six planned items and no error-level warnings', async () => {
    const run = await s1s(['render', '--project', dir, '--dry-run', '--json']);
    expect(run.code, run.stderr).toBe(0);
    const json = oneJsonLine(run) as { ok: boolean; report: { dryRun: boolean; items: unknown[]; counts: { errors: number } } };
    expect(json.ok).toBe(true);
    expect(json.report.dryRun).toBe(true);
    expect(json.report.items).toHaveLength(6);
    expect(json.report.counts.errors).toBe(0);
  });
});
