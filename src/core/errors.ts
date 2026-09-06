// The one error type every CLI command reports. `--json` prints
// { ok: false, error: { code, message, hint } } and exits with `exitCode`.
export type S1sErrorCode =
  | 'project-not-found'
  | 'project-exists'
  | 'config-invalid'
  | 'copy-missing'
  | 'copy-invalid'
  | 'manifest-invalid'
  | 'capture-invalid'
  | 'render-failed'
  | 'dims-mismatch'
  | 'bezel-missing'
  | 'export-blocked'
  | 'validate-failed'
  | 'sim-failed'
  | 'tool-missing'
  | 'usage';

export class S1sError extends Error {
  readonly code: S1sErrorCode;
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(code: S1sErrorCode, message: string, options: { hint?: string; exitCode?: number } = {}) {
    super(message);
    this.name = 'S1sError';
    this.code = code;
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? (code === 'usage' ? 2 : 1);
  }
}

export function isS1sError(value: unknown): value is S1sError {
  return value instanceof S1sError;
}
