// CLI plumbing shared by every command: global options, human or JSON output,
// error reporting and exit codes.
//
// Rules (CONTRACTS.md section 4, "src/cli"):
// - stdout carries the result: one JSON object in --json mode
//   ({ ok: true, ...data } or { ok: false, error: { code, message, hint } }),
//   human text otherwise. Progress and logs go to stderr.
// - Exit codes: 0 ok; 1 failure (or error-level warnings); 2 usage.
import { InvalidArgumentError, type Command } from 'commander';
import { isS1sError } from '../core/errors.ts';

/** Options defined on the root program; every subcommand reads them. */
export interface GlobalOpts {
  /** App repo dir or its screenshots/ dir. Default: search from the cwd. */
  project?: string;
  json?: boolean;
}

export interface CommandOutput {
  /** Merged into `{ ok: true, ...data }` in --json mode. A `data.ok` key wins. */
  data: Record<string, unknown>;
  /** Human-readable text for the default mode. May be empty. */
  text: string;
  /** Process exit code; 0 when omitted. */
  exitCode?: number;
}

export function globalsOf(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals<GlobalOpts>();
}

/** Prints a command result to stdout and records its exit code. */
export function emit(out: CommandOutput, opts: { json: boolean }): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...out.data })}\n`);
  } else if (out.text.length > 0) {
    process.stdout.write(out.text.endsWith('\n') ? out.text : `${out.text}\n`);
  }
  if (out.exitCode) process.exitCode = out.exitCode;
}

/** Prints an error (JSON on stdout, or text on stderr) and returns the exit code. */
export function emitError(err: unknown, opts: { json: boolean }): number {
  const { code, message, hint, exitCode } = describeError(err);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message, hint } })}\n`);
  } else {
    process.stderr.write(`s1s: ${message}\n`);
    if (hint) process.stderr.write(`  hint: ${hint}\n`);
  }
  if (process.env['S1S_DEBUG'] && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  return exitCode;
}

function describeError(err: unknown): { code: string; message: string; hint: string | null; exitCode: number } {
  if (isS1sError(err)) {
    return { code: err.code, message: err.message, hint: err.hint ?? null, exitCode: err.exitCode };
  }
  if (err instanceof Error) return { code: 'internal', message: err.message, hint: null, exitCode: 1 };
  return { code: 'internal', message: String(err), hint: null, exitCode: 1 };
}

/**
 * Runs a command handler with the merged global options, prints its output
 * and maps thrown errors to `{ ok: false }` plus an exit code.
 */
export async function runAction(
  cmd: Command,
  handler: (globals: GlobalOpts) => Promise<CommandOutput>,
): Promise<void> {
  const globals = globalsOf(cmd);
  const json = globals.json ?? false;
  try {
    emit(await handler(globals), { json });
  } catch (err) {
    process.exitCode = emitError(err, { json });
  }
}

/** Progress line on stderr (safe in --json mode). */
export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Fixed-width text table. Empty `rows` prints only the header. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/** Indented bullet list; returns '' for an empty list. */
export function bullets(items: readonly string[], indent = '  '): string {
  return items.map((item) => `${indent}- ${item}`).join('\n');
}

// --- commander argument parsers ---------------------------------------------

/** `a,b, c` -> ['a', 'b', 'c']; repeated flags accumulate. */
export function parseList(value: string, previous?: string[]): string[] {
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...(previous ?? []), ...items];
}

/** Positive integer option (`--jobs 4`, `--port 5173`). */
export function parsePositiveInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== value.trim()) {
    throw new InvalidArgumentError(`expected a positive integer, got "${value}"`);
  }
  return n;
}
