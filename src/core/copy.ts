// copy/<locale>.json: headlines and sublines per screen. Validated with zod;
// missing and unused screen keys are reported as warnings.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { LocaleCopy, ScreensConfig, Warning } from '../config/types.ts';
import { makeWarning } from '../config/warnings.ts';
import { S1sError } from './errors.ts';
import { errorMessage, isEnoent } from './fs.ts';
import { localeCopySchema, parseWith } from './schemas.ts';

export { localeCopySchema };

/** 'en-US.json', 'zh-Hans.json', 'ja.json' — anything else in copy/ is ignored. */
const LOCALE_FILE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/;

export function copyPath(projectDir: string, locale: string): string {
  return join(projectDir, 'copy', `${locale}.json`);
}

export async function loadCopy(projectDir: string, locale: string): Promise<LocaleCopy> {
  const path = copyPath(projectDir, locale);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isEnoent(err)) {
      throw new S1sError('copy-missing', `No copy for locale ${locale}: ${path} does not exist`, {
        hint: `Create it with { "locale": "${locale}", "screens": { "<screen id>": { "headline": "..." } } }`,
      });
    }
    throw new S1sError('copy-invalid', `Cannot read ${path}: ${errorMessage(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new S1sError('copy-invalid', `${path} is not valid JSON: ${errorMessage(err)}`);
  }
  const copy = parseWith(localeCopySchema, raw, 'copy-invalid', path);
  if (copy.locale !== locale) {
    throw new S1sError('copy-invalid', `${path}: "locale" is "${copy.locale}" but the file name says "${locale}"`);
  }
  return copy;
}

/** Locales that have a copy file, sorted. [] when copy/ does not exist. */
export async function listCopyLocales(projectDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(join(projectDir, 'copy'));
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  return entries
    .filter((name) => LOCALE_FILE.test(name))
    .map((name) => basename(name, '.json'))
    .sort();
}

/** Copy keys the screens reference (copyKey ?? id), in screen order. */
export function usedCopyKeys(screens: ScreensConfig): string[] {
  return [...new Set(screens.screens.map((s) => s.copyKey ?? s.id))];
}

/** Keys present in the copy file that no screen uses -> 'copy-unused'. */
export function unusedCopyKeys(copy: LocaleCopy, screens: ScreensConfig): string[] {
  const used = new Set(usedCopyKeys(screens));
  return Object.keys(copy.screens).filter((key) => !used.has(key));
}

/** Keys the screens need that the copy file lacks -> 'copy-missing'. */
export function missingCopyKeys(copy: LocaleCopy, screens: ScreensConfig): string[] {
  return usedCopyKeys(screens).filter((key) => !Object.hasOwn(copy.screens, key));
}

/**
 * Project-level copy warnings. Note the renderer also emits a per-item
 * 'copy-missing' when a resolved screen has no copy; use this for status
 * views and pre-flight checks.
 */
export function copyWarnings(copy: LocaleCopy, screens: ScreensConfig): Warning[] {
  const warnings: Warning[] = [];
  for (const key of missingCopyKeys(copy, screens)) {
    warnings.push(makeWarning('copy-missing', `copy/${copy.locale}.json has no entry for screen "${key}"`));
  }
  for (const key of unusedCopyKeys(copy, screens)) {
    warnings.push(makeWarning('copy-unused', `copy/${copy.locale}.json entry "${key}" matches no screen`));
  }
  return warnings;
}
