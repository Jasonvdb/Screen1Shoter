// Maps capture names to files under captures/<locale>/<family>/ with the
// fallback chain: manifest reuse locale -> own locale -> source locale ->
// placeholder. Dimensions come from a cheap IHDR read, not from sharp.
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { captureKey, captureRelPath, missingCaptureElement, resolveScreen, screenAppliesTo } from '../config/resolve.ts';
import type {
  CaptureFallback,
  CaptureRef,
  CaptureResolver,
  CaptureSource,
  DeviceFamily,
  Dims,
  SizePreset,
  Warning,
} from '../config/types.ts';
import { captureDimsWarning, makeWarning } from '../config/warnings.ts';
import type { Project } from './project.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width/height from the PNG IHDR chunk. null when missing or not a PNG. */
export function readPngDims(path: string): Dims | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const head = Buffer.alloc(24);
    const read = readSync(fd, head, 0, 24, 0);
    if (read < 24) return null;
    if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    if (head.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  } finally {
    closeSync(fd);
  }
}

/** Locale named by `captureSource: 'reuse:<l>'`, or null for 'own' / self-reference. */
export function reuseLocaleFor(project: Pick<Project, 'manifest'>, locale: string): string | null {
  const source = project.manifest.locales[locale]?.captureSource;
  if (!source || !source.startsWith('reuse:')) return null;
  const target = source.slice('reuse:'.length);
  return target !== '' && target !== locale ? target : null;
}

interface Candidate {
  locale: string;
  fallback: CaptureFallback;
}

function candidates(project: Pick<Project, 'manifest' | 'sourceLocale'>, locale: string): Candidate[] {
  const list: Candidate[] = [];
  const reuse = reuseLocaleFor(project, locale);
  // A declared `reuse:<l>` is its own reason: `reuse:de-DE` for de-AT never
  // touches the source locale, so recording 'source-locale' would be a lie.
  if (reuse) list.push({ locale: reuse, fallback: 'reuse' });
  list.push({ locale, fallback: 'none' });
  if (project.sourceLocale !== locale && project.sourceLocale !== reuse) {
    list.push({ locale: project.sourceLocale, fallback: 'source-locale' });
  }
  return list;
}

/**
 * Finds the file for one capture name. A declared `reuse:<l>` file is reported
 * as fallback 'reuse', a silent fall back to the source locale as
 * 'source-locale', so review.md shows both where the pixels came from and
 * whether anyone asked for that. A file that exists but is not a valid PNG is
 * returned with `dims: null` (-> 'capture-dims' error).
 */
export function resolveCapture(
  project: Pick<Project, 'dir' | 'manifest' | 'sourceLocale'>,
  ref: CaptureRef,
  preset: SizePreset,
  locale: string,
): CaptureSource {
  const family: DeviceFamily = preset.family;
  for (const candidate of candidates(project, locale)) {
    const resolvedPath = captureRelPath(candidate.locale, family, ref);
    const absolute = join(project.dir, resolvedPath);
    if (!existsSync(absolute)) continue;
    return {
      requested: ref,
      family,
      locale,
      resolvedPath,
      usedLocale: candidate.locale,
      fallback: candidate.fallback,
      dims: readPngDims(absolute),
    };
  }
  return { requested: ref, family, locale, resolvedPath: null, usedLocale: locale, fallback: 'placeholder', dims: null };
}

export function captureResolverFor(project: Pick<Project, 'dir' | 'manifest' | 'sourceLocale'>): CaptureResolver {
  return (ref, preset, locale) => resolveCapture(project, ref, preset, locale);
}

const LOCALE_DIR = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** Locale directories under captures/, sorted. [] when captures/ does not exist. */
export async function listCaptureLocales(projectDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(projectDir, 'captures'), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && LOCALE_DIR.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every capture the given locales x presets reference, keyed by captureKey(). */
export function captureMap(project: Project, locales: string[], presets: SizePreset[]): Record<string, CaptureSource> {
  const resolver = captureResolverFor(project);
  const map: Record<string, CaptureSource> = {};
  for (const locale of locales) {
    const copy = project.copies[locale];
    for (const preset of presets) {
      for (const screen of project.screens.screens) {
        if (!screenAppliesTo(screen, preset)) continue;
        const resolved = resolveScreen(screen, preset, locale, copy, resolver);
        for (const source of resolved.captures) {
          map[captureKey(locale, source.family, source.requested)] = source;
        }
      }
    }
  }
  return map;
}

/**
 * capture-missing (error; warn with allowPlaceholder), capture-fallback-locale
 * (info for a declared `reuse:<l>`, warn for an unasked-for source-locale
 * file), capture-dims per `captureDimsWarning` (warn for a same-aspect file
 * that will be resampled, error for a wrong device or an unreadable PNG).
 */
export function captureWarnings(source: CaptureSource, preset: SizePreset, opts: { allowPlaceholder: boolean }): Warning[] {
  const expectedPath = captureRelPath(source.locale, source.family, source.requested);
  if (source.fallback === 'placeholder' || source.resolvedPath === null) {
    const warning = makeWarning(
      'capture-missing',
      `Capture "${source.requested}" is missing for ${source.locale}/${source.family}: expected ${expectedPath}`,
      missingCaptureElement(source.requested),
    );
    return [opts.allowPlaceholder ? { ...warning, level: 'warn' } : warning];
  }
  const warnings: Warning[] = [];
  if (source.fallback === 'reuse') {
    warnings.push(
      makeWarning(
        'capture-fallback-locale',
        `Capture "${source.requested}" for ${source.locale} uses the ${source.usedLocale} file ${source.resolvedPath}`,
      ),
    );
  } else if (source.fallback === 'source-locale') {
    // Nobody asked for this one: no `reuse:` names it, so the capture step
    // simply never ran for this locale and source-locale pixels would ship
    // inside a translated set. Warn, not info: a declared reuse is 'reuse'.
    warnings.push({
      ...makeWarning(
        'capture-fallback-locale',
        `Capture "${source.requested}" for ${source.locale} has no file at ${expectedPath}; ` +
          `falling back to the ${source.usedLocale} file ${source.resolvedPath}. ` +
          `Run \`s1s capture --locale ${source.locale}\`, or declare locales.${source.locale}.captureSource "reuse:${source.usedLocale}".`,
      ),
      level: 'warn',
    });
  }
  if (source.dims === null) {
    warnings.push(makeWarning('capture-dims', `${source.resolvedPath} is not a readable PNG`));
  } else {
    const dims = captureDimsWarning(source.dims, preset, source.resolvedPath);
    if (dims) warnings.push(dims);
  }
  return warnings;
}
