// `s1s bezels inspect | install | list`: Apple product bezels cached under
// S1S_HOME/bezels (never in a repo). See src/core/bezels/install.ts.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import sharp from 'sharp';
import { SIZE_PRESETS } from '../../config/presets.ts';
import type { BezelEntry, BezelIndex, Rect, SizeId } from '../../config/types.ts';
import { bezelIndexPath, findBezel, readBezelIndex } from '../../core/bezels/index.ts';
import { cacheDirs, downloadDmg, installBezels, listPngs, openSource, type InstallResult } from '../../core/bezels/install.ts';
import { BEZEL_SOURCE_IDS, isBezelSourceId, normaliseBezelFilename } from '../../core/bezels/sources.ts';
import { errorMessage } from '../../core/fs.ts';
import { bullets, log, parseList, runAction, table, type CommandOutput } from '../output.ts';

interface InstallFlags {
  device?: string[];
  all?: boolean;
  from?: string;
  keepDmg?: boolean;
  force?: boolean;
  landscape?: boolean;
}

const rectText = (r: Rect | undefined): string => (r ? `(${r.x},${r.y}) ${r.width}x${r.height}` : '-');

/** Preset ids whose bezel lookup lands on this entry's id, "(fallback)" when it is not the preset's own bezel (as the --json `presets` map says). */
function usedBy(index: BezelIndex, entry: BezelEntry): string[] {
  const out: string[] = [];
  for (const id of Object.keys(SIZE_PRESETS) as SizeId[]) {
    const match = findBezel(index, SIZE_PRESETS[id]);
    if (match?.entry.id === entry.id) out.push(`${id}${match.fallback ? ' (fallback)' : ''}`);
  }
  return out;
}

function entryRows(index: BezelIndex, entries: readonly BezelEntry[]): string[][] {
  return entries.map((e) => [
    e.id,
    e.variant,
    e.orientation,
    `${e.imageSize.width}x${e.imageSize.height}`,
    rectText(e.screenRect),
    e.screenAspect.toFixed(4),
    String(e.cornerRadius),
    rectText(e.islandRect),
    e.pxPerPt === undefined ? '-' : String(e.pxPerPt),
    usedBy(index, e).join(',') || '-',
  ]);
}

const ENTRY_HEADERS = ['id', 'variant', 'orient', 'image', 'screen (x,y) wxh', 'aspect', 'radius', 'island', 'px/pt', 'used by'];

// --- inspect -----------------------------------------------------------------

interface InspectedPng {
  file: string;
  /** null when sharp could not read the file (see `error`). */
  width: number | null;
  height: number | null;
  hasAlpha: boolean;
  density: number | null;
  id: string | null;
  variant: string | null;
  orientation: string | null;
  known: boolean;
  error: string | null;
}

async function inspectPng(path: string, rel: string): Promise<InspectedPng> {
  const name = normaliseBezelFilename(rel);
  const base: InspectedPng = {
    file: rel,
    width: null,
    height: null,
    hasAlpha: false,
    density: null,
    id: name?.id ?? null,
    variant: name?.variant ?? null,
    orientation: name?.orientation ?? null,
    known: name ? isBezelSourceId(name.id) : false,
    error: null,
  };
  try {
    const meta = await sharp(path, { limitInputPixels: false }).metadata();
    return {
      ...base,
      width: meta.width,
      height: meta.height,
      hasAlpha: meta.hasAlpha === true,
      density: typeof meta.density === 'number' ? meta.density : null,
    };
  } catch (err) {
    return { ...base, error: errorMessage(err) };
  }
}

/** A URL is downloaded to S1S_HOME/dmg and, like `install`, deleted afterwards unless --keep-dmg; a local path is never touched. */
async function inspectCommand(target: string, flags: { keepDmg?: boolean }): Promise<CommandOutput> {
  const dirs = cacheDirs();
  let source = target;
  let downloaded: string | null = null;
  if (/^https?:\/\//.test(target)) {
    downloaded = join(dirs.dmg, decodeURIComponent(target.split('/').pop() || 'bezels.dmg'));
    await downloadDmg(target, downloaded, 0, log);
    source = downloaded;
  }
  const root = await openSource(source, dirs, log, '<dmg-url|path>');
  const files: InspectedPng[] = [];
  try {
    for (const rel of await listPngs(root.dir)) files.push(await inspectPng(join(root.dir, rel), rel));
  } finally {
    await root.cleanup();
    if (downloaded !== null && !flags.keepDmg) {
      await rm(downloaded, { force: true });
      log(`Deleted ${downloaded} (pass --keep-dmg to keep it)`);
    }
  }
  const rows = files.map((f) => [
    f.file,
    f.width === null || f.height === null ? '-' : `${f.width}x${f.height}`,
    f.hasAlpha ? 'yes' : 'no',
    f.density === null ? '-' : String(f.density),
    f.id ?? '(ignored)',
    f.variant ?? '-',
    f.orientation ?? '-',
    f.id === null ? '-' : f.known ? 'yes' : 'no (new model)',
    f.error ?? '',
  ]);
  const text = [
    `${root.label}: ${files.length} PNG file(s)`,
    table(['file', 'size', 'alpha', 'dpi', 'id', 'variant', 'orientation', 'in sources.ts', 'error'], rows),
  ].join('\n');
  return { data: { source: root.label, files }, text };
}

// --- install -----------------------------------------------------------------

function installText(result: InstallResult): string {
  const lines: string[] = [];
  if (result.offline) lines.push(`Offline: ${result.offline}`);
  for (const dmg of result.dmgs) {
    lines.push(`${dmg.id}: ${dmg.downloaded ? 'downloaded' : 'cached'} ${dmg.path}${dmg.deleted ? ' (deleted)' : ' (kept)'}`);
  }
  if (result.installed.length > 0) {
    lines.push(`Installed ${result.installed.length} bezel(s) into ${join(result.indexPath, '..')}:`);
    lines.push(table(ENTRY_HEADERS, entryRows(result.index, result.installed)));
  }
  if (result.kept.length > 0) {
    lines.push(`Kept ${result.kept.length} already installed (pass --force to re-measure): ${result.kept.map((e) => `${e.id}/${e.variant}`).join(', ')}`);
  }
  const errors = result.skipped.filter((s) => s.level === 'error');
  if (errors.length > 0) lines.push('Problems:', bullets(errors.map((s) => `${s.file}: ${s.reason}`)));
  const infos = result.skipped.filter((s) => s.level === 'info');
  if (infos.length > 0) lines.push(`Skipped ${infos.length} file(s) (landscape, other models, non-bezel files).`);
  if (result.installed.length === 0 && result.kept.length === 0) lines.push('Nothing installed.');
  lines.push(`Index: ${result.indexPath} (${result.index.entries.length} entries)`);
  return lines.join('\n');
}

async function installCommand(flags: InstallFlags): Promise<CommandOutput> {
  const result = await installBezels({
    ...(flags.device ? { devices: flags.device } : {}),
    ...(flags.all ? { all: true } : {}),
    ...(flags.from ? { from: flags.from } : {}),
    ...(flags.keepDmg ? { keepDmg: true } : {}),
    ...(flags.force ? { force: true } : {}),
    ...(flags.landscape ? { landscape: true } : {}),
    log,
  });
  const failed = result.skipped.some((s) => s.level === 'error') || (result.installed.length === 0 && result.kept.length === 0);
  const { index, ...rest } = result;
  return {
    data: { ...rest, ok: !failed, entries: index.entries },
    text: installText(result),
    exitCode: failed ? 1 : 0,
  };
}

// --- list --------------------------------------------------------------------

async function listCommand(): Promise<CommandOutput> {
  const index = await readBezelIndex();
  const indexPath = bezelIndexPath();
  if (!index || index.entries.length === 0) {
    return {
      data: { indexPath, updatedAt: index?.updatedAt ?? null, entries: [], presets: {} },
      text: `No bezels installed (${indexPath}). Run \`s1s bezels install\`; renders use a generic frame until then.`,
    };
  }
  const presets: Record<string, string | null> = {};
  for (const id of Object.keys(SIZE_PRESETS) as SizeId[]) {
    const match = findBezel(index, SIZE_PRESETS[id]);
    presets[id] = match ? `${match.entry.id}/${match.entry.variant}${match.fallback ? ' (fallback)' : ''}` : null;
  }
  const missing = Object.entries(presets)
    .filter(([id, value]) => value === null && !SIZE_PRESETS[id as SizeId].passthrough)
    .map(([id]) => id);
  const lines = [table(ENTRY_HEADERS, entryRows(index, index.entries)), `Index: ${indexPath} (updated ${index.updatedAt})`];
  if (missing.length > 0) lines.push(`No bezel for: ${missing.join(', ')} (generic frame + bezel-fallback warning).`);
  return { data: { indexPath, updatedAt: index.updatedAt, entries: index.entries, presets }, text: lines.join('\n') };
}

export function registerBezels(program: Command): void {
  const bezels = program.command('bezels').description('Install and list Apple product bezels (cached under S1S_HOME/bezels)');

  bezels
    .command('inspect')
    .description('Mount a bezel DMG (or read a folder) and print every PNG with its size and proposed id/variant')
    .argument('<dmg-url|path>', 'Apple DMG URL, a local .dmg, or a directory of PNGs')
    .option('--keep-dmg', 'keep a downloaded DMG under S1S_HOME/dmg after inspecting')
    .action((target: string, opts: { keepDmg?: boolean }, cmd: Command) => runAction(cmd, () => inspectCommand(target, opts)));

  bezels
    .command('install')
    .description(`Download, measure and cache bezels (default: the presets' bezels; ids: ${BEZEL_SOURCE_IDS.join(', ')})`)
    .option('--device <ids>', 'comma-separated bezel ids', parseList)
    .option('--all', 'every model in the known DMGs')
    .option('--from <path>', 'a downloaded .dmg or a directory of PNGs instead of downloading')
    .option('--keep-dmg', 'keep the DMG under S1S_HOME/dmg after installing')
    .option('--force', 're-measure bezels that are already installed')
    .option('--landscape', 'also install landscape files')
    .action((opts: InstallFlags, cmd: Command) => runAction(cmd, () => installCommand(opts)));

  bezels
    .command('list')
    .description('Show the installed bezels and which preset uses each one')
    .action((_opts: unknown, cmd: Command) => runAction(cmd, () => listCommand()));
}
