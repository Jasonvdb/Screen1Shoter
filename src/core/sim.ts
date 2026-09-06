// `xcrun simctl` wrappers: list, find, status bar (9:41, full bars, charged),
// appearance, and screenshot with a pixel-size check against the preset.
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { Dims, SizePreset, Warning } from '../config/types.ts';
import { captureDimsWarning } from '../config/warnings.ts';
import { S1sError } from './errors.ts';
import { run, runOk } from './exec.ts';
import { errorMessage, sha256File } from './fs.ts';

export interface SimDevice {
  udid: string;
  name: string;
  /** 'Booted' | 'Shutdown' | ... */
  state: string;
  /** 'iOS 26.5', 'watchOS 26.5' */
  runtime: string;
  isAvailable: boolean;
  platform: 'iOS' | 'watchOS' | 'other';
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

const XCRUN_HINT = 'Install Xcode and run `xcode-select -s /Applications/Xcode.app` (or `xcode-select --install`).';
const RUNTIME_PREFIX = 'com.apple.CoreSimulator.SimRuntime.';

let developerDir: Promise<string> | null = null;

/**
 * Active developer directory from `xcode-select -p`, which never prompts.
 * Every `xcrun` call goes through this first: without an active directory
 * `xcrun` opens the macOS "install the command line developer tools" dialog
 * and blocks a non-interactive command. Cached per process.
 */
export function ensureDeveloperDir(): Promise<string> {
  developerDir ??= (async () => {
    const result = await run('xcode-select', ['-p'], { timeoutMs: 10_000 });
    if (result.code === 127) {
      throw new S1sError('tool-missing', 'xcode-select is not installed or not on PATH', { hint: XCRUN_HINT });
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().split('\n')[0] ?? '';
      throw new S1sError('tool-missing', `No active developer directory (xcode-select -p failed${detail ? `: ${detail}` : ''})`, {
        hint: XCRUN_HINT,
      });
    }
    return result.stdout.trim();
  })();
  developerDir.catch(() => {
    developerDir = null;
  });
  return developerDir;
}

/** `xcrun <args>` after the developer-dir guard; never opens a GUI prompt. */
async function xcrun(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  await ensureDeveloperDir();
  return run('xcrun', args);
}

async function xcrunOk(args: string[], hint: string): Promise<{ stdout: string }> {
  await ensureDeveloperDir();
  return runOk('xcrun', args, { hint });
}

/** 'com.apple.CoreSimulator.SimRuntime.iOS-26-5' -> 'iOS 26.5' */
function runtimeLabel(id: string): string {
  const short = id.startsWith(RUNTIME_PREFIX) ? id.slice(RUNTIME_PREFIX.length) : id;
  const [os, ...version] = short.split('-');
  return version.length > 0 ? `${os} ${version.join('.')}` : short;
}

function platformOf(runtimeId: string): SimDevice['platform'] {
  if (runtimeId.includes('.iOS-')) return 'iOS';
  if (runtimeId.includes('.watchOS-')) return 'watchOS';
  return 'other';
}

function isSimctlDevice(value: unknown): value is SimctlDevice {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d['udid'] === 'string' && typeof d['name'] === 'string' && typeof d['state'] === 'string';
}

/** Pure part of `listSims`: the parsed `simctl list devices --json` object flattened across runtimes. */
export function parseSimctlDevices(json: unknown): SimDevice[] {
  const devicesByRuntime = (json as { devices?: unknown } | null)?.devices;
  if (typeof devicesByRuntime !== 'object' || devicesByRuntime === null) return [];
  const sims: SimDevice[] = [];
  for (const [runtimeId, devices] of Object.entries(devicesByRuntime as Record<string, unknown>)) {
    if (!Array.isArray(devices)) continue;
    for (const device of devices) {
      if (!isSimctlDevice(device)) continue;
      sims.push({
        udid: device.udid,
        name: device.name,
        state: device.state,
        runtime: runtimeLabel(runtimeId),
        isAvailable: device.isAvailable ?? true,
        platform: platformOf(runtimeId),
      });
    }
  }
  return sims;
}

/** `xcrun simctl list devices --json` flattened across runtimes. */
export async function listSims(): Promise<SimDevice[]> {
  const result = await xcrunOk(['simctl', 'list', 'devices', '--json'], XCRUN_HINT);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new S1sError('sim-failed', `simctl list returned invalid JSON: ${errorMessage(err)}`);
  }
  return parseSimctlDevices(parsed);
}

/** Pure part of `findSim`: exact UDID (case-insensitive), else exact available name; a booted device wins ties. */
export function pickSim(sims: readonly SimDevice[], nameOrUdid: string): SimDevice | null {
  const wanted = nameOrUdid.trim();
  const byUdid = sims.find((s) => s.udid.toLowerCase() === wanted.toLowerCase());
  if (byUdid) return byUdid;
  const byName = sims.filter((s) => s.name === wanted && s.isAvailable);
  return byName.find((s) => s.state === 'Booted') ?? byName[0] ?? null;
}

/** `pickSim` over `listSims`; throws 'sim-failed' listing the available names. */
export async function findSim(nameOrUdid: string): Promise<SimDevice> {
  const sims = await listSims();
  const wanted = nameOrUdid.trim();
  const pick = pickSim(sims, wanted);
  if (pick) return pick;
  const names = [...new Set(sims.filter((s) => s.isAvailable).map((s) => s.name))].sort();
  throw new S1sError('sim-failed', `No simulator matches "${wanted}"`, {
    hint: names.length > 0 ? `Available: ${names.join(', ')}` : 'No simulators found; create one in Xcode or with `xcrun simctl create`.',
  });
}

/** Override flags after `--time`: wifi + cellular full, charged, no carrier name. */
export const STATUS_BAR_FLAGS: readonly string[] = [
  '--dataNetwork', 'wifi',
  '--wifiMode', 'active',
  '--wifiBars', '3',
  '--cellularMode', 'active',
  '--cellularBars', '4',
  '--batteryState', 'charged',
  '--batteryLevel', '100',
  '--operatorName', '',
];

/**
 * `simctl status_bar <udid> override --time 9:41 ...` (or `clear`). watchOS
 * simulators have no status bar override; they report `supported: false`.
 */
export async function statusBar(udid: string, opts: { time?: string; clear?: boolean } = {}): Promise<{ supported: boolean }> {
  const device = (await listSims()).find((s) => s.udid.toLowerCase() === udid.toLowerCase());
  if (device?.platform === 'watchOS') return { supported: false };
  const args = opts.clear
    ? ['simctl', 'status_bar', udid, 'clear']
    : ['simctl', 'status_bar', udid, 'override', '--time', opts.time ?? '9:41', ...STATUS_BAR_FLAGS];
  const result = await xcrun(args);
  if (result.code === 0) return { supported: true };
  if (result.code === 127) throw new S1sError('tool-missing', 'xcrun is not installed or not on PATH', { hint: XCRUN_HINT });
  if (/not supported|unsupported/i.test(result.stderr)) return { supported: false };
  throw new S1sError('sim-failed', `xcrun simctl status_bar failed (exit ${result.code}): ${result.stderr.trim()}`, {
    hint: 'The simulator must be booted: `xcrun simctl boot <udid>`.',
  });
}

export async function appearance(udid: string, mode: 'light' | 'dark'): Promise<void> {
  await xcrunOk(['simctl', 'ui', udid, 'appearance', mode], 'The simulator must be booted: `xcrun simctl boot <udid>`.');
}

/** Pixel size of an image file via sharp. S1sError('capture-invalid') when unreadable. */
export async function imageDims(path: string): Promise<Dims> {
  try {
    const meta = await sharp(path).metadata();
    if (!meta.width || !meta.height) throw new Error('no size in metadata');
    return { width: meta.width, height: meta.height };
  } catch (err) {
    throw new S1sError('capture-invalid', `Cannot read image size of ${path}: ${errorMessage(err)}`);
  }
}

/** `simctl io <udid> screenshot --type=png --mask=ignored <outPath>`; returns the pixel size. */
export async function screenshot(udid: string, outPath: string): Promise<Dims> {
  await mkdir(dirname(outPath), { recursive: true });
  await xcrunOk(
    ['simctl', 'io', udid, 'screenshot', '--type=png', '--mask=ignored', outPath],
    'The simulator must be booted and the app in the foreground.',
  );
  return imageDims(outPath);
}

export interface CaptureResult {
  dims: Dims;
  sha256: string;
  warning: Warning | null;
}

/** screenshot + sha256 + the shared capture-dims rule in one call. */
export async function captureScreenshot(udid: string, outPath: string, preset: SizePreset): Promise<CaptureResult> {
  const dims = await screenshot(udid, outPath);
  return { dims, sha256: await sha256File(outPath), warning: captureDimsWarning(dims, preset) };
}
