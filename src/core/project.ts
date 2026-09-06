// Locates and loads <app>/screenshots/: screens.ts and theme.ts through a
// dynamic import (tsx / Vitest transform the TypeScript), copy files and the
// manifest through zod. Everything the renderer and the CLI need hangs off
// the returned Project.
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SIZES, SIZE_PRESETS, isSizeId, presetsFor, renderTarget } from '../config/presets.ts';
import { resolveScreen, screenAppliesTo } from '../config/resolve.ts';
import { implementedTemplateIds, templateMeta } from '../config/template-meta.ts';
import type {
  CaptureResolver,
  DeviceFamily,
  LocaleCopy,
  ProjectManifest,
  ScreensConfig,
  SizeId,
  SizePreset,
  Theme,
} from '../config/types.ts';
import { copyPath as copyPathFor, listCopyLocales, loadCopy } from './copy.ts';
import { S1sError } from './errors.ts';
import { errorMessage } from './fs.ts';
import { readManifest } from './manifest.ts';
import { isPassthroughItem } from './matrix.ts';
import { parseWith, screensConfigSchema, themeSchema } from './schemas.ts';

export interface Project {
  /** <app>/screenshots */
  dir: string;
  /** dirname(dir) */
  appDir: string;
  screensPath: string;
  themePath: string;
  manifestPath: string;
  /** First existing TEMPLATE_ENTRIES file (dir/templates/index.ts or .tsx), else null. */
  templatesPath: string | null;
  screens: ScreensConfig;
  theme: Theme;
  manifest: ProjectManifest;
  /** screens.sizes ?? DEFAULT_SIZES */
  sizes: SizeId[];
  /** screens.locales ?? ['en-US'] */
  locales: string[];
  /** manifest.app.sourceLocale || locales[0] */
  sourceLocale: string;
  /** Every locale with a valid copy file, loaded up front. */
  copies: Record<string, LocaleCopy>;
  /** Copy files that exist but failed validation ('copy-invalid'), by locale. */
  copyErrors: Record<string, S1sError>;
  /** Cached; loads from disk when not yet cached; S1sError('copy-missing' | 'copy-invalid'). */
  copyFor(locale: string): Promise<LocaleCopy>;
  /** dir/copy/<locale>.json */
  copyPath(locale: string): string;
}

/**
 * `cwd` itself when it holds screens.ts; else `<cwd>/screenshots`; else the
 * nearest ancestor with `screenshots/screens.ts`. null when nothing matches.
 */
export function findProjectDir(cwd: string): string | null {
  const start = resolve(cwd);
  if (existsSync(join(start, 'screens.ts'))) return start;
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'screenshots', 'screens.ts'))) return join(dir, 'screenshots');
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Project template entry candidates, in priority order. Shared with the Vite
 * plugin (virtual:s1s-templates) so Node and the browser agree on the file.
 */
export const TEMPLATE_ENTRIES = ['templates/index.ts', 'templates/index.tsx'] as const;

/** Absolute path of the project's template entry, or null when there is none. */
export function findTemplatesEntry(dir: string): string | null {
  for (const entry of TEMPLATE_ENTRIES) {
    const path = join(dir, entry);
    if (existsSync(path)) return path;
  }
  return null;
}

const TSX_IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+\.tsx)['"]/;
const RUNTIME_IMPORT = /from\s*['"](screen1shoter|react|react-dom(?:\/[^'"]*)?)['"]/;

/** screens.ts / theme.ts must stay data-only so Node can import them. */
async function assertDataOnly(path: string): Promise<void> {
  const source = await readFile(path, 'utf8');
  const tsx = TSX_IMPORT.exec(source);
  if (tsx) {
    throw new S1sError('config-invalid', `${path} imports "${tsx[1]}". Config files must not import .tsx files.`, {
      hint: 'Keep screens.ts and theme.ts data-only; put custom templates in templates/index.ts.',
    });
  }
  const runtime = RUNTIME_IMPORT.exec(source);
  if (runtime) {
    throw new S1sError('config-invalid', `${path} imports "${runtime[1]}", which needs a browser.`, {
      hint: "Import defineScreens / defineTheme from 'screen1shoter/config' instead.",
    });
  }
}

/**
 * Node's ESM cache keeps the first import of a file for the life of the
 * process. `reload` appends the file's mtime as a query so an edited
 * screens.ts / theme.ts is re-evaluated (tsx resolves query-suffixed file
 * URLs); an unchanged file keeps hitting the cache.
 */
async function moduleUrl(path: string, reload: boolean): Promise<string> {
  const href = pathToFileURL(path).href;
  if (!reload) return href;
  const { mtimeMs } = await stat(path);
  return `${href}?t=${mtimeMs}`;
}

async function importDefault(path: string, factory: string, reload: boolean): Promise<unknown> {
  await assertDataOnly(path);
  let mod: unknown;
  try {
    mod = await import(await moduleUrl(path, reload));
  } catch (err) {
    const message = errorMessage(err);
    const code = (err as NodeJS.ErrnoException).code;
    let hint: string | undefined;
    if (code === 'ERR_MODULE_NOT_FOUND' && message.includes('screen1shoter')) {
      hint = 'Run `s1s link` in the project so node_modules/screen1shoter resolves.';
    } else if (code === 'ERR_MODULE_NOT_FOUND') {
      hint = 'Relative imports must carry their .ts extension.';
    }
    throw new S1sError('config-invalid', `Cannot load ${path}: ${message}`, hint ? { hint } : {});
  }
  const value = (mod as { default?: unknown }).default;
  if (value === undefined) {
    throw new S1sError('config-invalid', `${path} has no default export`, {
      hint: `Use \`export default ${factory}({ ... })\`.`,
    });
  }
  return value;
}

const placeholderResolver: CaptureResolver = (ref, preset, locale) => ({
  requested: ref,
  family: preset.family,
  locale,
  resolvedPath: null,
  usedLocale: locale,
  fallback: 'placeholder',
  dims: null,
});

function uniqueTargets(sizes: readonly SizeId[]): SizePreset[] {
  const seen = new Set<SizeId>();
  const out: SizePreset[] = [];
  for (const preset of presetsFor(sizes).map(renderTarget)) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

/**
 * The panorama is one image cut into `count` equal slices, `count` being the
 * length of the panorama order. Every listed screen therefore has to be
 * rendered on every target, or the slices a family actually ships are
 * non-adjacent and the seam breaks. Node is the only layer that has both the
 * screen list and the presets, so the two checks live here.
 */
function panoramaProblems(
  config: ScreensConfig,
  targets: readonly SizePreset[],
  locales: readonly string[],
  hasProjectTemplates: boolean,
): string[] {
  const panorama = config.panorama;
  if (panorama === undefined) return [];
  const problems: string[] = [];
  const known = config.screens.map((screen) => screen.id);
  const listed = panorama.screens;

  if (listed !== undefined) {
    const seen = new Set<string>();
    for (const id of listed) {
      if (!known.includes(id)) {
        problems.push(`panorama.screens names unknown screen "${id}"; known: ${known.join(', ')}`);
      } else if (seen.has(id)) {
        problems.push(`panorama.screens lists "${id}" twice; every screen takes exactly one slice`);
      }
      seen.add(id);
    }
    return problems;
  }

  // No explicit list: every screen takes a slice, so every screen must reach
  // every target. `only` and the watch passthrough are the two ways it cannot.
  const hint = 'list panorama.screens explicitly, or give that family its own list';
  for (const screen of config.screens) {
    let reported = false;
    for (const preset of targets) {
      if (reported) break;
      if (!screenAppliesTo(screen, preset)) {
        problems.push(`panorama: screen "${screen.id}" is kept off ${preset.family} by \`only\`, so its slice is never drawn there; ${hint}`);
        break;
      }
      // The template can change per locale, and only `raw` takes the
      // passthrough shortcut, so every locale has to be asked.
      for (const locale of locales) {
        const { template } = resolveScreen(screen, preset, locale, undefined, placeholderResolver);
        if (!isPassthroughItem(preset, template, hasProjectTemplates)) continue;
        problems.push(`panorama: screen "${screen.id}" is a passthrough item on ${preset.family} (template "${template}"), so its slice is never drawn; ${hint}`);
        reported = true;
        break;
      }
    }
  }
  return problems;
}

/** Cross-field checks zod cannot express: ids, alias keys, template availability, the panorama. */
function validateScreens(config: ScreensConfig, screensPath: string, templatesPath: string | null, locales: string[]): void {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const screen of config.screens) {
    if (ids.has(screen.id)) problems.push(`duplicate screen id "${screen.id}"`);
    ids.add(screen.id);
    for (const key of [...Object.keys(screen.overrides ?? {}), ...(screen.only ?? [])]) {
      const alias = isSizeId(key) ? SIZE_PRESETS[key].aliasOf : undefined;
      if (alias) problems.push(`screen "${screen.id}": "${key}" renders as "${alias}"; key overrides/only by "${alias}"`);
    }
  }
  const targets = uniqueTargets(config.sizes ?? DEFAULT_SIZES);
  problems.push(...panoramaProblems(config, targets, locales, templatesPath !== null));
  const seen = new Set<string>();
  for (const screen of config.screens) {
    for (const preset of targets) {
      if (!screenAppliesTo(screen, preset)) continue;
      for (const locale of locales) {
        const { template, captures } = resolveScreen(screen, preset, locale, undefined, placeholderResolver);
        const meta = templateMeta(template);
        const problemKey = meta ? `${screen.id}/${preset.family}/${template}` : `${screen.id}/${template}`;
        if (seen.has(problemKey)) continue;
        seen.add(problemKey);
        if (!meta) {
          if (templatesPath === null) {
            problems.push(`screen "${screen.id}": unknown template "${template}" and no ${TEMPLATE_ENTRIES.join(' / ')}`);
          }
          continue;
        }
        if (!meta.implemented) {
          problems.push(
            `screen "${screen.id}": template "${template}" is planned for ${meta.phase}; available now: ${implementedTemplateIds().join(', ')}`,
          );
          continue;
        }
        if (!meta.families.includes(preset.family)) {
          problems.push(
            `screen "${screen.id}": template "${template}" has no ${preset.family} layout (families: ${meta.families.join(', ')})`,
          );
        }
        const wanted = meta.captures ?? 1;
        if (captures.length !== wanted) {
          const shape = wanted === 1 ? 'capture: "<name>"' : `capture: [${Array.from({ length: wanted }, (_, i) => String.fromCharCode(97 + i)).join(', ')}]`;
          problems.push(`screen "${screen.id}": template "${template}" needs ${shape} (got ${captures.length})`);
        }
      }
    }
  }
  if (problems.length > 0) throw new S1sError('config-invalid', `${screensPath}: ${problems.join('; ')}`);
}

function familiesOf(sizes: readonly SizeId[]): DeviceFamily[] {
  return [...new Set(sizes.map((id) => SIZE_PRESETS[id].family))];
}

export interface LoadProjectOptions {
  cwd?: string;
  projectDir?: string;
  /** Re-evaluate screens.ts / theme.ts when they changed on disk (long-running `s1s dev`). */
  reload?: boolean;
}

export async function loadProject(opts: LoadProjectOptions = {}): Promise<Project> {
  const cwd = opts.cwd ?? process.cwd();
  const dir = opts.projectDir ? resolve(opts.projectDir) : findProjectDir(cwd);
  if (dir === null) {
    throw new S1sError('project-not-found', `No screenshots/screens.ts found in ${cwd} or its parents`, {
      hint: 'Run `s1s init` in the app repo, or pass --project <dir>.',
    });
  }
  const screensPath = join(dir, 'screens.ts');
  const themePath = join(dir, 'theme.ts');
  const manifestPath = join(dir, 'manifest.json');
  const templatesPath = findTemplatesEntry(dir);
  const reload = opts.reload ?? false;
  if (!existsSync(screensPath)) {
    throw new S1sError('project-not-found', `${screensPath} does not exist`, { hint: 'Run `s1s init` to scaffold it.' });
  }
  if (!existsSync(themePath)) {
    throw new S1sError('config-invalid', `${themePath} does not exist`, {
      hint: "Create theme.ts with `export default defineTheme({ background, accent, text })` from 'screen1shoter/config'.",
    });
  }

  const screens = parseWith(screensConfigSchema, await importDefault(screensPath, 'defineScreens', reload), 'config-invalid', screensPath);
  const theme = parseWith(themeSchema, await importDefault(themePath, 'defineTheme', reload), 'config-invalid', themePath);

  const sizes: SizeId[] = screens.sizes ? [...screens.sizes] : [...DEFAULT_SIZES];
  const locales: string[] = screens.locales ? [...screens.locales] : ['en-US'];
  validateScreens(screens, screensPath, templatesPath, locales);

  const appDir = dirname(dir);
  const manifest = await readManifest(manifestPath, {
    name: basename(appDir),
    deviceFamilies: familiesOf(sizes),
    sourceLocale: locales[0] ?? 'en-US',
    appLocales: locales,
  });
  const sourceLocale = manifest.app.sourceLocale || locales[0] || 'en-US';

  const copies: Record<string, LocaleCopy> = {};
  const copyErrors: Record<string, S1sError> = {};
  for (const locale of await listCopyLocales(dir)) {
    try {
      copies[locale] = await loadCopy(dir, locale);
    } catch (err) {
      if (!(err instanceof S1sError)) throw err;
      copyErrors[locale] = err;
    }
  }

  return {
    dir,
    appDir,
    screensPath,
    themePath,
    manifestPath,
    templatesPath,
    screens,
    theme,
    manifest,
    sizes,
    locales,
    sourceLocale,
    copies,
    copyErrors,
    copyPath: (locale) => copyPathFor(dir, locale),
    async copyFor(locale) {
      const cached = copies[locale];
      if (cached) return cached;
      const failed = copyErrors[locale];
      if (failed) throw failed;
      const loaded = await loadCopy(dir, locale);
      copies[locale] = loaded;
      return loaded;
    },
  };
}
