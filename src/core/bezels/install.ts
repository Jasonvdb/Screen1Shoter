// Bezel install pipeline: download Apple's DMG (or take `--from` a DMG /
// a folder of PNGs) -> hdiutil attach with the SLA accepted on stdin -> walk
// the PNGs -> normalise names -> measure -> trim to the device + 2 px ->
// write S1S_HOME/bezels/<id>/<variant>.png -> detach -> delete the DMG ->
// write index.json. Everything lands under S1S_HOME, never in a repo.
import { createWriteStream, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { SIZE_PRESETS } from '../../config/presets.ts';
import type { BezelEntry, BezelIndex } from '../../config/types.ts';
import { S1sError, isS1sError } from '../errors.ts';
import { formatCommand, run } from '../exec.ts';
import { errorMessage, pathExists } from '../fs.ts';
import { S1S_HOME } from '../paths.ts';
import { bezelEntryFile, bezelEntryKey, bezelIndexPath, readBezelIndex, upsertBezelEntries, writeBezelIndex } from './index.ts';
import { measureBezel, shiftMeasurement, trimRect, writeTrimmedBezel, type BezelMeasurement } from './measure.ts';
import {
  BEZEL_DMGS,
  BEZEL_SOURCES,
  BEZEL_SOURCE_IDS,
  dmgsFor,
  isBezelSourceId,
  normaliseBezelFilename,
  type BezelDmgId,
  type BezelFileName,
} from './sources.ts';

export interface CacheDirs {
  home: string;
  bezels: string;
  dmg: string;
  mnt: string;
}

/** Cache layout under `home` (default S1S_HOME). */
export function cacheDirs(home: string = S1S_HOME): CacheDirs {
  const root = resolve(home);
  return { home: root, bezels: join(root, 'bezels'), dmg: join(root, 'dmg'), mnt: join(root, 'mnt') };
}

export type Logger = (line: string) => void;

export interface InstallOptions {
  /** Bezel ids to install (`--device`). */
  devices?: string[];
  /** Every model with a BezelSource entry (`--all`). */
  all?: boolean;
  /** A DMG path or a directory of PNGs instead of downloading. */
  from?: string;
  keepDmg?: boolean;
  /** Re-measure and rewrite entries that are already installed. */
  force?: boolean;
  /** Also install landscape files. */
  landscape?: boolean;
  /** Cache root; default S1S_HOME. */
  home?: string;
  log?: Logger;
}

export interface SkippedFile {
  file: string;
  reason: string;
  /** 'error' marks a file that should have installed (a changed DMG); the command exits 1. */
  level: 'info' | 'error';
}

export interface DmgReport {
  id: BezelDmgId;
  path: string;
  downloaded: boolean;
  deleted: boolean;
}

export interface InstallResult {
  indexPath: string;
  index: BezelIndex;
  /** Entries measured and written in this run. */
  installed: BezelEntry[];
  /** Entries already present and left alone (no --force). */
  kept: BezelEntry[];
  skipped: SkippedFile[];
  dmgs: DmgReport[];
  /** Set when a download failed and the existing index already covers the request. */
  offline?: string;
}

/** Bezels the presets ask for by default: every `preset.bezel` with a source. */
export function defaultBezelIds(): string[] {
  const ids: string[] = [];
  for (const preset of Object.values(SIZE_PRESETS)) {
    if (isBezelSourceId(preset.bezel) && !ids.includes(preset.bezel)) ids.push(preset.bezel);
  }
  return ids;
}

/** Requested ids, or null for "everything the source contains" (`--from` without `--device`). */
export function requestedIds(opts: Pick<InstallOptions, 'devices' | 'all' | 'from'>): string[] | null {
  if (opts.all) return [...BEZEL_SOURCE_IDS];
  if (opts.devices && opts.devices.length > 0) {
    const unknown = opts.devices.filter((id) => !isBezelSourceId(id));
    if (unknown.length > 0 && !opts.from) {
      throw new S1sError('usage', `Unknown bezel id(s): ${unknown.join(', ')}. Known: ${BEZEL_SOURCE_IDS.join(', ')}.`, {
        hint: 'Use `--from <dir>` to install PNGs of a model that has no download entry yet.',
      });
    }
    return [...new Set(opts.devices)];
  }
  return opts.from ? null : defaultBezelIds();
}

/** True when a download can be skipped: the local file already has the size the server reports. */
export function isDownloadComplete(localBytes: number | null, expectedBytes: number, contentLength: number | null): boolean {
  if (localBytes === null || localBytes <= 0) return false;
  return localBytes === expectedBytes || (contentLength !== null && localBytes === contentLength);
}

// ---------------------------------------------------------------------------
// Download and mount
// ---------------------------------------------------------------------------

const noop: Logger = () => undefined;

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function remoteSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    const length = Number(res.headers.get('content-length'));
    return res.ok && Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

function downloadHint(url: string, dest: string): string {
  return `Download it yourself: curl -L -o "${dest}" "${url}" then run \`s1s bezels install --from "${dest}"\`.`;
}

/** Streams `url` to `dest` through a .part file. Returns false when the cached file was complete. */
export async function downloadDmg(url: string, dest: string, expectedBytes: number, log: Logger = noop): Promise<boolean> {
  const local = await fileSize(dest);
  if (isDownloadComplete(local, expectedBytes, local === null ? null : await remoteSize(url))) {
    log(`Using cached ${dest}`);
    return false;
  }
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  log(`Downloading ${url}`);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
  } catch (err) {
    throw new S1sError('bezel-missing', `Download of ${url} failed: ${errorMessage(err)}`, { hint: downloadHint(url, dest) });
  }
  if (!res.ok || !res.body) {
    throw new S1sError('bezel-missing', `Download of ${url} failed: HTTP ${res.status}`, { hint: downloadHint(url, dest) });
  }
  const total = Number(res.headers.get('content-length')) || expectedBytes;
  let received = 0;
  let nextMark = 0.1;
  const progress = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (total > 0 && received / total >= nextMark) {
        log(`  ${Math.round((received / total) * 100)}% of ${Math.round(total / 1_048_576)} MB`);
        nextMark += 0.1;
      }
      controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body.pipeThrough(progress) as WebReadableStream<Uint8Array>), createWriteStream(part));
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw new S1sError('bezel-missing', `Download of ${url} failed: ${errorMessage(err)}`, { hint: downloadHint(url, dest) });
  }
  return true;
}

export interface MountedDmg {
  dir: string;
  detach: () => Promise<void>;
}

const HDIUTIL_HINT = 'Mount the DMG in Finder, accept the licence, and run `s1s bezels install --from "/Volumes/<name>/PNG"`.';

async function isNonEmptyDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0;
  } catch {
    return false;
  }
}

/** `hdiutil attach` with the Apple Design Resources licence accepted ("Y" on stdin). */
export async function mountDmg(dmgPath: string, mntRoot: string, log: Logger = noop): Promise<MountedDmg> {
  const dir = join(mntRoot, basename(dmgPath, extname(dmgPath)).replace(/[^A-Za-z0-9._-]+/g, '-'));
  await mkdir(dir, { recursive: true });
  if (await isNonEmptyDir(dir)) {
    log(`Detaching a stale mount at ${dir}`);
    await run('hdiutil', ['detach', '-force', dir], { timeoutMs: 60_000 });
  }
  const args = ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', dir, dmgPath];
  log(`Mounting ${dmgPath}`);
  const result = await run('hdiutil', args, { stdin: 'Y\n', timeoutMs: 300_000 });
  if (result.code === 127) throw new S1sError('tool-missing', 'hdiutil is not available (macOS only)', { hint: HDIUTIL_HINT });
  if (result.code !== 0) {
    const detail = result.stderr.trim().split('\n').slice(-2).join(' | ');
    await rmdir(dir).catch(() => undefined);
    throw new S1sError('bezel-missing', `${formatCommand('hdiutil', args)} failed (exit ${result.code})${detail ? `: ${detail}` : ''}`, {
      hint: HDIUTIL_HINT,
    });
  }
  // Ctrl+C would exit without running any `finally`: detach synchronously,
  // then re-raise the signal so the exit code stays the conventional one.
  const onSignal = (signal: NodeJS.Signals): void => {
    forget();
    spawnSync('hdiutil', ['detach', '-force', dir], { stdio: 'ignore', timeout: 60_000 });
    try {
      rmdirSync(dir);
    } catch {
      // still mounted or already gone: nothing more to do on the way out
    }
    process.kill(process.pid, signal);
  };
  const forget = (): void => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return {
    dir,
    detach: async () => {
      forget();
      const detached = await run('hdiutil', ['detach', '-force', dir], { timeoutMs: 60_000 });
      if (detached.code !== 0) log(`warning: hdiutil detach ${dir} exited ${detached.code}`);
      await rmdir(dir).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Walk, measure, write
// ---------------------------------------------------------------------------

/** PNG files under `root`, relative posix paths, dot-files and dot-dirs skipped, sorted. */
export async function listPngs(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(relative(root, path).split('\\').join('/'));
    }
  };
  await walk(root);
  return out.sort();
}

export interface BezelSourceRoot {
  /** Directory that holds the PNGs (a mount point or a user folder). */
  dir: string;
  label: string;
  cleanup: () => Promise<void>;
}

const SOURCE_HINT = 'Pass a .dmg file or a directory of bezel PNGs.';

/**
 * Opens a bezel source: a DMG is mounted (never deleted), a directory is used
 * as is. `label` names the argument in usage errors (`--from` for install,
 * the positional for inspect).
 */
export async function openSource(from: string, dirs: CacheDirs, log: Logger = noop, label = '--from'): Promise<BezelSourceRoot> {
  const path = resolve(from);
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new S1sError('usage', `${label} ${path} does not exist.`, { hint: SOURCE_HINT });
  }
  if (info.isDirectory()) return { dir: path, label: path, cleanup: async () => undefined };
  if (extname(path).toLowerCase() !== '.dmg') {
    throw new S1sError('usage', `${label} ${path} is neither a directory nor a .dmg file.`, { hint: SOURCE_HINT });
  }
  const mounted = await mountDmg(path, dirs.mnt, log);
  return { dir: mounted.dir, label: path, cleanup: mounted.detach };
}

function toEntry(name: BezelFileName, m: BezelMeasurement): BezelEntry {
  const entry: BezelEntry = {
    id: name.id,
    variant: name.variant,
    file: bezelEntryFile(name),
    imageSize: m.imageSize,
    deviceRect: m.deviceRect,
    screenRect: m.screenRect,
    cornerRadius: m.cornerRadius,
    orientation: name.orientation,
    screenAspect: m.screenAspect,
  };
  if (m.islandRect) entry.islandRect = m.islandRect;
  if (m.pxPerPt !== undefined) entry.pxPerPt = m.pxPerPt;
  return entry;
}

/** A known model whose screen size moved by more than 1 px means the DMG changed: refuse rather than misalign captures. */
function checkAgainstSource(name: BezelFileName, m: BezelMeasurement): string | null {
  if (name.orientation !== 'portrait' || !isBezelSourceId(name.id)) return null;
  const expected = BEZEL_SOURCES[name.id].portrait.screenRect;
  const dw = Math.abs(m.screenRect.width - expected.width);
  const dh = Math.abs(m.screenRect.height - expected.height);
  if (dw <= 1 && dh <= 1) return null;
  return `screen ${m.screenRect.width}x${m.screenRect.height} differs from the recorded ${expected.width}x${expected.height}; update src/core/bezels/sources.ts`;
}

/**
 * Measures one PNG, trims it into the cache and returns its index entry.
 * `guard` may veto the measurement with a reason (returned instead of an entry, nothing written).
 */
export async function installBezelFile(
  srcPath: string,
  name: BezelFileName,
  bezelsDir: string,
  guard: (m: BezelMeasurement) => string | null = () => null,
): Promise<BezelEntry | string> {
  const measured = await measureBezel(srcPath);
  const veto = guard(measured);
  if (veto !== null) return veto;
  const trim = trimRect(measured);
  const dest = join(bezelsDir, bezelEntryFile(name));
  await mkdir(dirname(dest), { recursive: true });
  await writeTrimmedBezel(srcPath, dest, trim);
  return toEntry(name, shiftMeasurement(measured, trim));
}

interface Plan {
  wanted: string[] | null;
  existing: BezelIndex | null;
}

async function installFromRoot(root: BezelSourceRoot, plan: Plan, opts: InstallOptions, dirs: CacheDirs, result: InstallResult): Promise<void> {
  const log = opts.log ?? noop;
  const existingByKey = new Map((plan.existing?.entries ?? []).map((e) => [bezelEntryKey(e), e]));
  const files = await listPngs(root.dir);
  if (files.length === 0) result.skipped.push({ file: root.label, reason: 'no PNG files found', level: 'error' });
  for (const rel of files) {
    const name = normaliseBezelFilename(rel);
    if (!name) {
      result.skipped.push({ file: rel, reason: 'not a "<model> - <Colour> - <Portrait|Landscape>.png" file', level: 'info' });
      continue;
    }
    if (plan.wanted && !plan.wanted.includes(name.id)) {
      result.skipped.push({ file: rel, reason: `${name.id} not requested`, level: 'info' });
      continue;
    }
    if (name.orientation === 'landscape' && !opts.landscape) {
      result.skipped.push({ file: rel, reason: 'landscape (pass --landscape to install it)', level: 'info' });
      continue;
    }
    const key = bezelEntryKey(name);
    const present = existingByKey.get(key);
    if (present && !opts.force && (await pathExists(join(dirs.bezels, present.file)))) {
      result.kept.push(present);
      continue;
    }
    log(`Measuring ${rel}`);
    // One bad PNG (corrupt, opaque, not a bezel) must not abort the rest.
    try {
      const entry = await installBezelFile(join(root.dir, rel), name, dirs.bezels, (m) => checkAgainstSource(name, m));
      if (typeof entry === 'string') result.skipped.push({ file: rel, reason: entry, level: 'error' });
      else result.installed.push(entry);
    } catch (err) {
      result.skipped.push({ file: rel, reason: errorMessage(err), level: 'error' });
    }
  }
}

/** Ids of a DMG that the existing index already provides in portrait. */
function coveredByIndex(index: BezelIndex | null, ids: readonly string[]): boolean {
  if (!index) return false;
  return ids.every((id) => index.entries.some((e) => e.id === id && e.orientation === 'portrait'));
}

/** The existing index, or null after moving an unreadable one aside (this run rebuilds it). */
async function existingIndex(dirs: CacheDirs, log: Logger): Promise<BezelIndex | null> {
  try {
    return await readBezelIndex(dirs.bezels);
  } catch (err) {
    if (!isS1sError(err)) throw err;
    const path = bezelIndexPath(dirs.bezels);
    log(`warning: ${err.message}; moving it to index.json.bak and rebuilding`);
    await rename(path, `${path}.bak`);
    return null;
  }
}

export async function installBezels(opts: InstallOptions = {}): Promise<InstallResult> {
  const log = opts.log ?? noop;
  const dirs = cacheDirs(opts.home);
  const plan: Plan = { wanted: requestedIds(opts), existing: await existingIndex(dirs, log) };
  const result: InstallResult = {
    indexPath: join(dirs.bezels, 'index.json'),
    index: plan.existing ?? { version: 1, updatedAt: new Date().toISOString(), entries: [] },
    installed: [],
    kept: [],
    skipped: [],
    dmgs: [],
  };
  await mkdir(dirs.bezels, { recursive: true });

  try {
    await installSources(plan, opts, dirs, result, log);
  } finally {
    // Always rewrite, even after an abort: entries measured so far stay
    // indexed, and a kept-only run still normalises the entry order.
    result.index = upsertBezelEntries(plan.existing, result.installed);
    await writeBezelIndex(result.index, dirs.bezels);
  }
  return result;
}

async function installSources(plan: Plan, opts: InstallOptions, dirs: CacheDirs, result: InstallResult, log: Logger): Promise<void> {
  if (opts.from) {
    const root = await openSource(opts.from, dirs, log);
    try {
      await installFromRoot(root, plan, opts, dirs, result);
    } finally {
      await root.cleanup();
    }
  } else {
    for (const dmgId of dmgsFor(plan.wanted ?? [])) {
      const dmg = BEZEL_DMGS[dmgId];
      const dmgPath = join(dirs.dmg, dmg.dmgName);
      const idsInDmg = (plan.wanted ?? []).filter((id) => isBezelSourceId(id) && BEZEL_SOURCES[id].dmg === dmgId);
      let downloaded: boolean;
      try {
        downloaded = await downloadDmg(dmg.url, dmgPath, dmg.bytes, log);
      } catch (err) {
        if (!opts.force && coveredByIndex(plan.existing, idsInDmg)) {
          result.offline = `${errorMessage(err)} Using the existing index for ${idsInDmg.join(', ')}.`;
          log(result.offline);
          for (const entry of plan.existing?.entries ?? []) if (idsInDmg.includes(entry.id)) result.kept.push(entry);
          continue;
        }
        throw err;
      }
      const report: DmgReport = { id: dmgId, path: dmgPath, downloaded, deleted: false };
      result.dmgs.push(report);
      const mounted = await mountDmg(dmgPath, dirs.mnt, log);
      try {
        await installFromRoot({ dir: join(mounted.dir, dmg.pngDir), label: dmgPath, cleanup: mounted.detach }, plan, opts, dirs, result);
      } finally {
        await mounted.detach();
      }
      if (!opts.keepDmg) {
        await rm(dmgPath, { force: true });
        report.deleted = true;
        log(`Deleted ${dmgPath} (pass --keep-dmg to keep it)`);
      }
    }
  }
}
