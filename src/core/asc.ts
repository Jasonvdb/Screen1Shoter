// Detection of the `asc` CLI and its offline screenshot validation. Upload
// itself stays a printed command the user or the skill runs deliberately;
// `src/render/export.ts` builds those lines, because their shape depends on
// what the export found (asc-upload.md sections 7 and 8).
import { S1sError } from './errors.ts';
import { formatCommand, run, which } from './exec.ts';

export interface AscInfo {
  path: string;
  /** '1.2.2' or null when `asc --version` fails. */
  version: string | null;
}

/** null when asc is not on PATH. */
export async function findAsc(): Promise<AscInfo | null> {
  const path = await which('asc');
  if (!path) return null;
  const result = await run(path, ['--version'], { timeoutMs: 10_000 });
  const version = result.code === 0 ? (result.stdout.trim().split(/\s+/)[0] ?? null) : null;
  return { path, version };
}

export interface AscValidateOptions {
  /** Directory holding NN.png files for one display type. */
  path: string;
  /** e.g. 'IPHONE_69' (SizePreset.deviceTypeToken). */
  deviceType: string;
  cwd?: string;
}

export interface AscValidateResult {
  ok: boolean;
  command: string;
  /** Parsed JSON report when asc printed one, else the raw stdout. */
  report: unknown;
  stderr: string;
}

/** `asc screenshots validate --path <dir> --device-type <TOKEN> --output json`. */
export async function ascValidateScreenshots(opts: AscValidateOptions): Promise<AscValidateResult> {
  const asc = await which('asc');
  if (!asc) {
    throw new S1sError('tool-missing', 'asc is not installed or not on PATH', {
      hint: 'Install the asc CLI to validate and upload screenshots, or skip with --no-asc.',
    });
  }
  const args = ['screenshots', 'validate', '--path', opts.path, '--device-type', opts.deviceType, '--output', 'json'];
  const result = await run(asc, args, { timeoutMs: 120_000, ...(opts.cwd ? { cwd: opts.cwd } : {}) });
  let report: unknown = result.stdout.trim();
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Not JSON (older asc or an error banner): keep the raw text.
  }
  return { ok: result.code === 0, command: formatCommand('asc', args), report, stderr: result.stderr.trim() };
}
