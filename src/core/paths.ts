// Filesystem locations: the tool checkout, the user cache (~/.screen1shoter)
// and every per-project output path. Every returned path is absolute.
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRelPath } from '../config/resolve.ts';
import type { AppDisplayType, CaptureRef, DeviceFamily, SizeId } from '../config/types.ts';
import type { Project } from './project.ts';

function homeFromEnv(): string {
  const override = process.env['S1S_HOME'];
  return override && override.length > 0 ? resolve(override) : join(homedir(), '.screen1shoter');
}

/** Cache dir for bezels and DMGs. `S1S_HOME` overrides it (tests, CI). */
export const S1S_HOME: string = homeFromEnv();

/** Checkout root: `S1S_ROOT` (set by bin/s1s.js) or derived from this file's location. */
export function toolRoot(): string {
  const fromEnv = process.env['S1S_ROOT'];
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function bezelDir(): string {
  return join(S1S_HOME, 'bezels');
}

export function dmgDir(): string {
  return join(S1S_HOME, 'dmg');
}

type ProjectDir = Pick<Project, 'dir'>;

/** <project>/out/<locale> */
export function outDir(project: ProjectDir, locale: string): string {
  return join(project.dir, 'out', locale);
}

/** <project>/out/<locale>/<APP_DISPLAY_TYPE> */
export function sizeOutDir(project: ProjectDir, locale: string, displayType: AppDisplayType): string {
  return join(outDir(project, locale), displayType);
}

/** <project>/out/<locale>/<APP_DISPLAY_TYPE>/preview */
export function previewDir(project: ProjectDir, locale: string, displayType: AppDisplayType): string {
  return join(sizeOutDir(project, locale, displayType), 'preview');
}

export function reportPath(project: ProjectDir, locale: string): string {
  return join(outDir(project, locale), 'report.json');
}

export function reviewPath(project: ProjectDir, locale: string): string {
  return join(outDir(project, locale), 'review.md');
}

export function sheetPath(project: ProjectDir, locale: string, sizeId: SizeId): string {
  return join(outDir(project, locale), `sheet-${sizeId}.png`);
}

/** <project>/captures/<locale>/<family>/<ref>.png */
export function capturePath(project: ProjectDir, locale: string, family: DeviceFamily, ref: CaptureRef): string {
  return join(project.dir, captureRelPath(locale, family, ref));
}

/** <app>/<manifest.app.metadataDir> (default metadata/screenshots) */
export function metadataDir(project: Pick<Project, 'appDir' | 'manifest'>): string {
  return resolve(project.appDir, project.manifest.app.metadataDir || 'metadata/screenshots');
}
