// Small file helpers shared by the core modules. Nothing here knows about
// projects or presets; it only hides Node error-code plumbing.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Parses a JSON file. Resolves `undefined` when the file does not exist;
 * rethrows read errors and JSON syntax errors unchanged.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
  return JSON.parse(text) as unknown;
}

/** Writes 2-space JSON with a trailing newline through a temp file + rename. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
