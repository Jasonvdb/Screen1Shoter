// Child-process helpers. `run` never rejects for a failing command: a missing
// binary is reported as exit code 127 (like a shell) so probes can inspect it.
// `runOk` turns failures into S1sError for the common "must succeed" case.
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { S1sError, type S1sErrorCode } from './errors.ts';
import { isFile } from './fs.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Shell-style rendering of a command for messages, logs and the commands
 * `s1s export` prints for the user to paste. An allowlist, not a blocklist:
 * a placeholder such as `<APP_ID>` must come out quoted, or pasting the
 * printed line into a shell reads it as a redirection instead of a hole to
 * fill in.
 */
export function formatCommand(cmd: string, args: readonly string[]): string {
  const safe = /^[A-Za-z0-9_@%+=:,./-]+$/;
  const quote = (s: string): string => (safe.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [cmd, ...args].map(quote).join(' ');
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise(result);
    };

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin?.on('error', () => undefined);
    if (opts.stdin !== undefined) child.stdin?.write(opts.stdin);
    child.stdin?.end();

    child.on('error', (err: NodeJS.ErrnoException) => {
      settle({ code: err.code === 'ENOENT' ? 127 : 126, stdout: '', stderr: `${cmd}: ${err.message}` });
    });
    child.on('close', (code) => {
      let err = Buffer.concat(stderr).toString('utf8');
      if (timedOut) err += `${err.endsWith('\n') || err === '' ? '' : '\n'}${cmd} timed out after ${opts.timeoutMs} ms\n`;
      settle({ code: code ?? (timedOut ? 124 : 1), stdout: Buffer.concat(stdout).toString('utf8'), stderr: err });
    });
  });
}

/**
 * Like `run` but throws: 'tool-missing' when the binary is not found,
 * `errorCode` (default 'sim-failed') on any non-zero exit.
 */
export async function runOk(
  cmd: string,
  args: string[],
  opts: RunOptions & { errorCode?: S1sErrorCode; hint?: string } = {},
): Promise<RunResult> {
  const result = await run(cmd, args, opts);
  if (result.code === 127) {
    throw new S1sError('tool-missing', `${cmd} is not installed or not on PATH`, opts.hint ? { hint: opts.hint } : {});
  }
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-3).join(' | ');
    const message = `${formatCommand(cmd, args)} failed (exit ${result.code})${detail ? `: ${detail}` : ''}`;
    throw new S1sError(opts.errorCode ?? 'sim-failed', message, opts.hint ? { hint: opts.hint } : {});
  }
  return result;
}

/** Absolute path of an executable on PATH, or null. Pure Node, no subprocess. */
export async function which(cmd: string): Promise<string | null> {
  if (cmd.includes('/')) {
    const abs = resolve(cmd);
    return (await isExecutable(abs)) ? abs : null;
  }
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, cmd);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  if (!(await isFile(path))) return false;
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
