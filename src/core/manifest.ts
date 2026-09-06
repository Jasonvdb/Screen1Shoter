// screenshots/manifest.json: one file for all locales. The CLI owns the
// capture/render/export fields, the agent owns statuses, ratings and steps.
// Reads are tolerant (missing file -> empty manifest, unknown keys kept);
// writes are atomic.
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { IMAGE_STATUSES } from '../config/types.ts';
import type {
  ImageState,
  ImageStatus,
  ManifestApp,
  ManifestLocale,
  ManifestLocaleDevice,
  ManifestRun,
  ProjectManifest,
  SizeId,
} from '../config/types.ts';
import { S1sError } from './errors.ts';
import { errorMessage, isEnoent, writeJsonAtomic } from './fs.ts';
import { manifestSchema, parseWith } from './schemas.ts';

export { manifestSchema };

export function emptyManifest(app: ManifestApp): ProjectManifest {
  return { version: 1, app, sizes: {}, screens: [], locales: {}, runs: [] };
}

export function emptyLocale(): ManifestLocale {
  return { copyStatus: 'pending', captureSource: 'own', devices: {} };
}

/** App block for a project without a manifest. `name` defaults to the app folder name. */
export function defaultManifestApp(manifestPath: string, overrides: Partial<ManifestApp> = {}): ManifestApp {
  const appDir = dirname(dirname(manifestPath));
  return {
    name: basename(appDir),
    bundleId: '',
    deviceFamilies: [],
    sourceLocale: '',
    appLocales: [],
    metadataDir: 'metadata/screenshots',
    ...overrides,
  };
}

/**
 * Reads and validates the manifest. A missing or empty file yields
 * `emptyManifest(defaultManifestApp(path, fallbackApp))`; anything else that
 * fails to parse throws S1sError('manifest-invalid'). Unknown keys are kept.
 */
export async function readManifest(path: string, fallbackApp: Partial<ManifestApp> = {}): Promise<ProjectManifest> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isEnoent(err)) return emptyManifest(defaultManifestApp(path, fallbackApp));
    throw new S1sError('manifest-invalid', `Cannot read ${path}: ${errorMessage(err)}`);
  }
  if (text.trim() === '') return emptyManifest(defaultManifestApp(path, fallbackApp));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new S1sError('manifest-invalid', `${path} is not valid JSON: ${errorMessage(err)}`, {
      hint: 'Fix the JSON by hand or delete the file to start over (statuses will be lost).',
    });
  }
  return parseWith(manifestSchema, raw, 'manifest-invalid', path);
}

/** Atomic write: 2-space JSON, trailing newline, temp file + rename. */
export async function writeManifest(path: string, manifest: ProjectManifest): Promise<void> {
  await writeJsonAtomic(path, manifest);
}

export function imageState(m: ProjectManifest, locale: string, sizeId: SizeId, screenId: string): ImageState | undefined {
  return m.locales[locale]?.devices[sizeId]?.screens[screenId];
}

/** Image-state fields a caller may remove with `updateImage(..., { drop })`. */
export type DroppableImageField = Exclude<keyof ImageState, 'status'>;

/**
 * Returns a new manifest with `patch` merged into one image state. Missing
 * locale / device / screen nodes are created (status 'pending'). Unrelated
 * nodes are shared, not copied. `drop` removes fields (a merge cannot).
 */
export function updateImage(
  m: ProjectManifest,
  ref: { locale: string; sizeId: SizeId; screenId: string },
  patch: Partial<ImageState>,
  opts: { drop?: readonly DroppableImageField[] } = {},
): ProjectManifest {
  const locale: ManifestLocale = m.locales[ref.locale] ?? emptyLocale();
  const device: ManifestLocaleDevice = locale.devices[ref.sizeId] ?? { screens: {} };
  const prev: ImageState = device.screens[ref.screenId] ?? { status: 'pending' };
  const next: ImageState = { ...prev, ...patch };
  for (const field of opts.drop ?? []) delete next[field];
  return {
    ...m,
    locales: {
      ...m.locales,
      [ref.locale]: {
        ...locale,
        devices: {
          ...locale.devices,
          [ref.sizeId]: { ...device, screens: { ...device.screens, [ref.screenId]: next } },
        },
      },
    },
  };
}

const BACKWARD_TARGETS: readonly ImageStatus[] = ['pending', 'captured', 'generated'];

/** Forward by any number of steps (or the same status), or back to pending / captured / generated. */
export function canTransition(from: ImageStatus, to: ImageStatus): boolean {
  const a = IMAGE_STATUSES.indexOf(from);
  const b = IMAGE_STATUSES.indexOf(to);
  if (a < 0 || b < 0) return false;
  return b >= a || BACKWARD_TARGETS.includes(to);
}

/** `manifest.runs` keeps the newest entries only. */
export const MAX_MANIFEST_RUNS = 50;

/** Returns a new manifest with `run` appended, keeping the newest MAX_MANIFEST_RUNS. */
export function appendRun(m: ProjectManifest, run: ManifestRun): ProjectManifest {
  const runs = [...m.runs, run];
  return { ...m, runs: runs.length > MAX_MANIFEST_RUNS ? runs.slice(-MAX_MANIFEST_RUNS) : runs };
}
