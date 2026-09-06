// `s1s init`: scaffold <app>/screenshots from templates/init, then link it.
//
// Template rules (templates/init stays valid TypeScript / JSON):
// - `{{token}}` anywhere in a text file is replaced (appName, bundleId, ...).
// - A line ending in `// {{token}}` has its value replaced:
//     sizes: ['iphone-6.9', 'ipad-13'], // {{sizes}}
// - Lines between `// {{watch:start}}` and `// {{watch:end}}` are removed
//   without --watch; the markers themselves are removed with it.
// - copy/en-US.json and manifest.json are parsed and filled in code.
// - captures/en-US/... and copy/en-US.json are renamed to the source locale.
//
// Re-running on an existing project needs --force. It then merges
// manifest.json (statuses, runs, udids and capture plans survive), keeps the
// authored files (screens.ts, theme.ts, copy/*.json, templates/**) unless
// --overwrite-authored is given, and overwrites the rest of the scaffold.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import {
  ALL_SIZE_IDS,
  DEFAULT_SIZES,
  getPreset,
  isSizeId,
  type DeviceFamily,
  type LocaleCopy,
  type ManifestApp,
  type ManifestLocale,
  type ManifestScreen,
  type ManifestSize,
  type ProjectManifest,
  type SizeId,
} from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import { readManifest } from '../../core/manifest.ts';
import { toolRoot } from '../../core/paths.ts';
import { bullets, defineAction, parseList, type CommandOutput, type GlobalOpts } from '../output.ts';
import { linkProject } from './link.ts';

interface InitOptions {
  appName?: string;
  bundleId?: string;
  appId?: string;
  locales?: string[];
  sizes?: string[];
  watch?: boolean;
  force?: boolean;
  overwriteAuthored?: boolean;
}

/** Which app facts were given on the command line; they win over an existing manifest on --force. */
export interface GivenFlags {
  appName: boolean;
  bundleId: boolean;
  appId: boolean;
}

export interface InitVars {
  appName: string;
  bundleId: string;
  appId?: string;
  /** First entry is the source locale. */
  locales: string[];
  sourceLocale: string;
  sizes: SizeId[];
  watch: boolean;
  given: GivenFlags;
}

/** Files the agent or user edits after init. --force keeps them unless --overwrite-authored. */
const AUTHORED = /^(?:screens\.ts|theme\.ts|copy\/[^/]+\.json|templates\/.+)$/;
const MANIFEST = 'manifest.json';

/** Mirrors templates/init/screens.ts. Keep both in sync. */
const EXAMPLE_SCREENS: ReadonlyArray<{ id: string; template?: string; families: DeviceFamily[] }> = [
  { id: 'home', template: 'hero-top-text', families: ['iphone', 'ipad'] },
  { id: 'detail', template: 'text-bottom', families: ['iphone', 'ipad'] },
  { id: 'share', template: 'hero-top-text', families: ['iphone', 'ipad'] },
  { id: 'watch-stats', families: ['watch'] },
];
const WATCH_SCREEN = 'watch-stats';
const TEMPLATE_LOCALE = 'en-US';
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** `--project <app>` or `--project <app>/screenshots`; default <cwd>/screenshots. */
export function initTargetDir(globals: GlobalOpts): string {
  const base = globals.project ? resolve(globals.project) : process.cwd();
  return basename(base) === 'screenshots' ? base : join(base, 'screenshots');
}

export function buildInitVars(dir: string, opts: InitOptions): InitVars {
  const appName = opts.appName?.trim() || basename(dirname(dir));
  const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

  const locales = opts.locales && opts.locales.length > 0 ? opts.locales : [TEMPLATE_LOCALE];
  for (const locale of locales) {
    if (!LOCALE_RE.test(locale)) {
      throw new S1sError('usage', `Invalid locale "${locale}". Use App Store codes such as en-US, de-DE or zh-Hans.`);
    }
  }

  const sizes: SizeId[] = [];
  for (const id of opts.sizes && opts.sizes.length > 0 ? opts.sizes : DEFAULT_SIZES) {
    if (!isSizeId(id)) {
      throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
    }
    if (!sizes.includes(id)) sizes.push(id);
  }
  const watch = opts.watch === true || sizes.some((id) => getPreset(id).family === 'watch');
  if (watch && !sizes.includes('watch-s10')) sizes.push('watch-s10');

  const vars: InitVars = {
    appName,
    bundleId: opts.bundleId?.trim() || `com.example.${slug}`,
    locales,
    sourceLocale: locales[0] ?? TEMPLATE_LOCALE,
    sizes,
    watch,
    given: { appName: Boolean(opts.appName?.trim()), bundleId: Boolean(opts.bundleId?.trim()), appId: Boolean(opts.appId?.trim()) },
  };
  if (opts.appId?.trim()) vars.appId = opts.appId.trim();
  return vars;
}

const tsArray = (items: readonly string[]): string => `[${items.map((s) => `'${s}'`).join(', ')}]`;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function renderText(text: string, vars: InitVars): string {
  const values: Record<string, string> = {
    appName: vars.appName,
    bundleId: vars.bundleId,
    sourceLocale: vars.sourceLocale,
    sizes: tsArray(vars.sizes),
    locales: tsArray(vars.locales),
  };
  let out = vars.watch
    ? text.replace(/^[ \t]*\/\/ \{\{watch:(?:start|end)\}\}[ \t]*\n/gm, '')
    : text.replace(/^[ \t]*\/\/ \{\{watch:start\}\}[ \t]*\n[\s\S]*?^[ \t]*\/\/ \{\{watch:end\}\}[ \t]*\n/gm, '');
  out = out.replace(/^([ \t]*[\w$]+:[ \t]*).*\/\/ \{\{(\w+)\}\}[ \t]*$/gm, (line: string, head: string, token: string) => {
    const value = values[token];
    return value === undefined ? line : `${head}${value},`;
  });
  return out.replace(/\{\{(\w+)\}\}/g, (match: string, token: string) => values[token] ?? match);
}

function renderCopy(text: string, vars: InitVars): string {
  const copy = JSON.parse(text) as LocaleCopy;
  copy.locale = vars.sourceLocale;
  copy.shared = { ...copy.shared, appName: vars.appName };
  if (!vars.watch) delete copy.screens[WATCH_SCREEN];
  return json(copy);
}

/** The manifest a fresh init writes, from the template file and the vars. */
export function buildManifest(text: string, vars: InitVars): ProjectManifest {
  const base = JSON.parse(text) as ProjectManifest;
  const presets = vars.sizes.map(getPreset);
  const families = [...new Set(presets.map((p) => p.family))];

  const sizes: Partial<Record<SizeId, ManifestSize>> = {};
  for (const p of presets) {
    sizes[p.id] = {
      displayType: p.displayType,
      token: p.deviceTypeToken,
      px: p.px,
      simulator: p.simulatorName,
      framed: !p.passthrough,
    };
  }

  const screens: ManifestScreen[] = EXAMPLE_SCREENS.filter((s) => vars.watch || s.id !== WATCH_SCREEN).map((s, i) => {
    const screen: ManifestScreen = {
      id: s.id,
      order: i + 1,
      sizes: vars.sizes.filter((id) => s.families.includes(getPreset(id).family)),
    };
    if (s.template !== undefined) screen.template = s.template;
    return screen;
  });

  const locales: Record<string, ManifestLocale> = {};
  for (const locale of vars.locales) {
    locales[locale] = {
      copyStatus: locale === vars.sourceLocale ? 'draft' : 'pending',
      captureSource: 'own',
      devices: {},
    };
  }

  const app: ManifestApp = {
    name: vars.appName,
    bundleId: vars.bundleId,
    ...(vars.appId !== undefined ? { appId: vars.appId } : {}),
    deviceFamilies: families,
    sourceLocale: vars.sourceLocale,
    appLocales: vars.locales,
    metadataDir: base.app.metadataDir,
  };
  const now = new Date().toISOString();
  return {
    ...base,
    app,
    sizes,
    screens,
    locales,
    runs: [{ command: 's1s init', startedAt: now, finishedAt: now, ok: true }],
  };
}

function union<T>(a: readonly T[], b: readonly T[]): T[] {
  return [...new Set([...a, ...b])];
}

/**
 * --force on an existing manifest: the agent's state survives. `existing`
 * wins for statuses, runs, capture plans, simulator udids and app facts not
 * given on the command line; `fresh` adds new sizes and locales (and its
 * example screens when `addScreens`, i.e. when screens.ts was rewritten).
 */
export function mergeManifest(
  existing: ProjectManifest,
  fresh: ProjectManifest,
  given: GivenFlags,
  opts: { addScreens: boolean },
): ProjectManifest {
  const app: ManifestApp = {
    ...existing.app,
    ...fresh.app,
    name: given.appName || !existing.app.name ? fresh.app.name : existing.app.name,
    bundleId: given.bundleId || !existing.app.bundleId ? fresh.app.bundleId : existing.app.bundleId,
    sourceLocale: existing.app.sourceLocale || fresh.app.sourceLocale,
    deviceFamilies: union(existing.app.deviceFamilies, fresh.app.deviceFamilies),
    appLocales: union(existing.app.appLocales, fresh.app.appLocales),
  };
  const appId = given.appId ? fresh.app.appId : (existing.app.appId ?? fresh.app.appId);
  if (appId === undefined) delete app.appId;
  else app.appId = appId;

  const sizes: Partial<Record<SizeId, ManifestSize>> = { ...existing.sizes };
  for (const [id, size] of Object.entries(fresh.sizes) as Array<[SizeId, ManifestSize]>) {
    const prev = existing.sizes[id];
    sizes[id] = prev?.udid !== undefined ? { ...size, simulator: prev.simulator, udid: prev.udid } : { ...prev, ...size };
  }

  const screens: ManifestScreen[] = [...existing.screens];
  if (opts.addScreens) {
    const ids = new Set(screens.map((s) => s.id));
    let order = screens.reduce((max, s) => Math.max(max, s.order), 0);
    for (const screen of fresh.screens) {
      if (ids.has(screen.id)) continue;
      order += 1;
      screens.push({ ...screen, order });
    }
  }

  return {
    ...existing,
    app,
    sizes,
    screens,
    locales: { ...fresh.locales, ...existing.locales },
    runs: [...existing.runs, ...fresh.runs],
  };
}

function renderFile(rel: string, text: string, vars: InitVars): string {
  if (rel === `copy/${TEMPLATE_LOCALE}.json`) return renderCopy(text, vars);
  if (rel === MANIFEST) return json(buildManifest(text, vars));
  return renderText(text, vars);
}

/** Destination (project-relative, posix) for a template file, or null to skip it. */
function destinationFor(rel: string, vars: InitVars): string | null {
  const captures = `captures/${TEMPLATE_LOCALE}/`;
  if (!vars.watch && rel.startsWith(`${captures}watch/`)) return null;
  if (rel.startsWith(captures)) return `captures/${vars.sourceLocale}/${rel.slice(captures.length)}`;
  if (rel === `copy/${TEMPLATE_LOCALE}.json`) return `copy/${vars.sourceLocale}.json`;
  return rel;
}

async function listTemplateFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

export interface InitResult {
  /** Every project-relative file written (new or replaced). */
  written: string[];
  /** Existing files whose content changed. */
  overwritten: string[];
  /** Authored files left alone because they differ from the template. */
  skipped: Array<{ path: string; reason: string }>;
  /** ['manifest.json'] when an existing manifest was merged instead of replaced. */
  merged: string[];
  templateDir: string;
}

export interface InitProjectOptions {
  force: boolean;
  /** With --force: replace screens.ts, theme.ts, copy/*.json and templates/** even when edited. */
  overwriteAuthored?: boolean;
}

export async function initProject(dir: string, vars: InitVars, opts: InitProjectOptions): Promise<InitResult> {
  const templateDir = join(toolRoot(), 'templates', 'init');
  const plan: Array<{ src: string; dest: string; rel: string; out: string }> = [];
  for (const rel of await listTemplateFiles(templateDir)) {
    const dest = destinationFor(rel, vars);
    if (dest !== null) plan.push({ src: join(templateDir, rel), dest: join(dir, dest), rel, out: dest });
  }

  const existing = new Set<string>();
  for (const item of plan) {
    if (await stat(item.dest).then(() => true, () => false)) existing.add(item.out);
  }
  if (existing.size > 0 && !opts.force) {
    const list = [...existing];
    throw new S1sError('project-exists', `${dir} already contains ${list.length} file(s) that s1s init writes: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ', ...' : ''}.`, {
      hint: 'Pass --force to update the scaffold: manifest.json is merged, screens.ts / theme.ts / copy / templates are kept unless --overwrite-authored, other template files are overwritten.',
    });
  }

  const result: InitResult = { written: [], overwritten: [], skipped: [], merged: [], templateDir };
  const write = async (item: (typeof plan)[number], content: string): Promise<void> => {
    const exists = existing.has(item.out);
    const changed = !exists || (await readFile(item.dest, 'utf8')) !== content;
    await mkdir(dirname(item.dest), { recursive: true });
    await writeFile(item.dest, content);
    result.written.push(item.out);
    if (exists && changed) result.overwritten.push(item.out);
  };

  for (const item of plan) {
    if (item.rel === MANIFEST) continue;
    const content = renderFile(item.rel, await readFile(item.src, 'utf8'), vars);
    if (existing.has(item.out) && AUTHORED.test(item.out) && !opts.overwriteAuthored) {
      if ((await readFile(item.dest, 'utf8')) !== content) {
        result.skipped.push({ path: item.out, reason: 'authored file differs from the template; pass --overwrite-authored to replace it' });
        continue;
      }
    }
    await write(item, content);
  }

  const manifestItem = plan.find((item) => item.rel === MANIFEST);
  if (manifestItem) {
    const fresh = buildManifest(await readFile(manifestItem.src, 'utf8'), vars);
    if (existing.has(manifestItem.out)) {
      const current = await readManifest(manifestItem.dest);
      const addScreens = result.written.includes('screens.ts');
      await write(manifestItem, json(mergeManifest(current, fresh, vars.given, { addScreens })));
      result.merged.push(manifestItem.out);
    } else {
      await write(manifestItem, json(fresh));
    }
  }
  return result;
}

function nextSteps(vars: InitVars): string[] {
  const iphone = vars.sizes.map(getPreset).find((p) => p.family === 'iphone');
  const sim = iphone?.simulatorName ?? 'iPhone 17 Pro Max';
  return [
    's1s doctor',
    `s1s sim list   # find the "${sim}" udid, then: s1s sim status-bar <udid>`,
    `s1s capture --udid "${sim}" --name home --device iphone`,
    `s1s render --locale ${vars.sourceLocale} --allow-placeholder   # until captures exist; drop the flag once they do`,
    's1s dev --open',
  ];
}

async function initCommand(globals: GlobalOpts, opts: InitOptions): Promise<CommandOutput> {
  const dir = initTargetDir(globals);
  const vars = buildInitVars(dir, opts);
  if (opts.overwriteAuthored === true && opts.force !== true) {
    throw new S1sError('usage', '--overwrite-authored needs --force.');
  }
  const result = await initProject(dir, vars, { force: opts.force === true, overwriteAuthored: opts.overwriteAuthored === true });
  const links = await linkProject(dir);
  const steps = nextSteps(vars);
  const updated = result.overwritten.length > 0 || result.merged.length > 0 || result.skipped.length > 0;
  const lines = [`${updated ? 'Updated' : 'Created'} screenshots project: ${dir}`, bullets(result.written)];
  if (result.merged.length > 0) lines.push(`Merged (state kept): ${result.merged.join(', ')}`);
  if (result.overwritten.length > 0) lines.push(`Overwritten: ${result.overwritten.join(', ')}`);
  if (result.skipped.length > 0) lines.push('Kept (authored):', bullets(result.skipped.map((s) => `${s.path}: ${s.reason}`)));
  lines.push(`Linked node_modules (${links.length} entries) to ${toolRoot()}`, 'Next steps:', ...steps.map((s, i) => `  ${i + 1}. ${s}`));
  return {
    data: {
      projectDir: dir,
      appName: vars.appName,
      bundleId: vars.bundleId,
      appId: vars.appId ?? null,
      locales: vars.locales,
      sizes: vars.sizes,
      files: result.written,
      overwritten: result.overwritten,
      skipped: result.skipped,
      merged: result.merged,
      links,
      next: steps,
    },
    text: lines.join('\n'),
  };
}

export function registerInit(program: Command): void {
  defineAction<InitOptions>(
    program
      .command('init')
      .description('Scaffold <app>/screenshots (screens.ts, theme.ts, copy, manifest, captures) and link it')
      .option('--app-name <name>', 'app display name (default: the app dir name)')
      .option('--bundle-id <id>', 'bundle identifier (default: com.example.<app>)')
      .option('--app-id <id>', 'App Store Connect app id')
      .option('--locales <list>', 'comma-separated locales; the first is the source (default: en-US)', parseList)
      .option('--sizes <list>', `comma-separated size ids (default: ${DEFAULT_SIZES.join(',')})`, parseList)
      .option('--watch', 'add watch-s10 and a raw watch example screen')
      .option('--force', 'update an existing project: merge manifest.json, keep authored files, overwrite the rest')
      .option('--overwrite-authored', 'with --force: also replace screens.ts, theme.ts, copy/*.json and templates/**'),
    ({ globals, opts }) => initCommand(globals, opts),
  );
}
