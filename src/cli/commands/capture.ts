// `s1s capture`: screenshot a simulator into captures/<locale>/<family>/<name>.png,
// verify the pixel size against the project's presets, and record path,
// sha256 and px in the manifest for every screen that uses the capture.
//
// Size rule (captureDimsWarning): exact `captureDims` = ok; same aspect
// within 1% = warning (the render reports the same warn-level capture-dims);
// anything else = error. The screenshot lands in a temp file first, so a
// wrong-size shot never replaces an existing good capture.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { Option, type Command } from 'commander';
import {
  CAPTURE_NAME_RE,
  captureDimsWarning,
  captureRelPath,
  formatDims,
  formatOrdinal,
  getPreset,
  resolveScreen,
  screenAppliesTo,
  type CaptureResolver,
  type DeviceFamily,
  type Dims,
  type ImageState,
  type ImageStatus,
  type ScreenDef,
  type SizeId,
  type SizePreset,
} from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import { pathExists } from '../../core/fs.ts';
import { imageState, updateImage, writeManifest } from '../../core/manifest.ts';
import { capturePath } from '../../core/paths.ts';
import type { Project } from '../../core/project.ts';
import { findSim, screenshot } from '../../core/sim.ts';
import { bullets, defineAction, type CommandOutput, type GlobalOpts } from '../output.ts';
import { openProject } from './link.ts';

interface CaptureOptions {
  udid: string;
  name: string;
  device: DeviceFamily;
  locale?: string;
}

interface UpdatedScreen {
  sizeId: SizeId;
  screenId: string;
  ordinal: number;
  status: ImageStatus;
}

const FAMILIES: readonly DeviceFamily[] = ['iphone', 'ipad', 'watch'];

/** Screenshot into a sibling temp file; the caller renames it over the real path only when the size is accepted. */
async function screenshotToTemp(udid: string, outPath: string): Promise<{ tmpPath: string; dims: Dims }> {
  const tmpPath = `${outPath}.${process.pid}.tmp.png`;
  try {
    return { tmpPath, dims: await screenshot(udid, tmpPath) };
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

/** Resolver that never touches the disk; only `requested` is inspected. */
const probeResolver: CaptureResolver = (ref, preset, locale) => ({
  requested: ref,
  family: preset.family,
  locale,
  resolvedPath: null,
  usedLocale: locale,
  fallback: 'placeholder',
  dims: null,
});

/** Screens (with their ordinal for this preset) whose capture list names `ref`. */
function screensUsing(project: Project, preset: SizePreset, locale: string, ref: string): Array<{ screen: ScreenDef; ordinal: number }> {
  const applicable = project.screens.screens.filter((s) => screenAppliesTo(s, preset));
  const out: Array<{ screen: ScreenDef; ordinal: number }> = [];
  applicable.forEach((screen, index) => {
    const resolved = resolveScreen(screen, preset, locale, undefined, probeResolver);
    if (resolved.captures.some((c) => c.requested === ref)) out.push({ screen, ordinal: index + 1 });
  });
  return out;
}

async function captureCommand(globals: GlobalOpts, opts: CaptureOptions): Promise<CommandOutput> {
  if (!CAPTURE_NAME_RE.test(opts.name)) {
    throw new S1sError('usage', `Invalid capture name "${opts.name}". Use letters, digits, ".", "_" or "-" (the rule screens.ts applies too).`);
  }
  const project = await openProject(globals);
  const locale = opts.locale ?? project.sourceLocale;
  const presets = project.sizes.map(getPreset).filter((p) => p.family === opts.device);
  if (presets.length === 0) {
    throw new S1sError('usage', `This project has no ${opts.device} size (sizes: ${project.sizes.join(', ')}).`, {
      hint: 'Add the size to `sizes` in screens.ts first.',
    });
  }

  const device = await findSim(opts.udid);
  const outPath = capturePath(project, locale, opts.device, opts.name);
  await mkdir(dirname(outPath), { recursive: true });
  const { tmpPath, dims } = await screenshotToTemp(device.udid, outPath);

  const exact = presets.filter((p) => captureDimsWarning(dims, p) === null);
  const matched = exact.length > 0 ? exact : presets.filter((p) => captureDimsWarning(dims, p)?.level === 'warn');
  if (matched.length === 0) {
    await rm(tmpPath, { force: true });
    const expected = presets.map((p) => `${formatDims(p.captureDims)} (${p.simulatorName})`).join(', ');
    const kept = (await pathExists(outPath))
      ? `The existing ${relative(project.dir, outPath)} and its manifest entry are unchanged.`
      : 'Nothing was written.';
    throw new S1sError('capture-invalid', `${device.name} produced ${formatDims(dims)}; ${opts.device} sizes expect ${expected}. ${kept}`, {
      hint: `Capture on the "${presets[0]?.simulatorName}" simulator.`,
    });
  }
  await rename(tmpPath, outPath);
  const warnings: string[] = [];
  if (exact.length === 0) {
    for (const preset of matched) {
      const warning = captureDimsWarning(dims, preset);
      if (warning) warnings.push(`${warning.message} Renders report the same warn-level capture-dims.`);
    }
  }

  const sha256 = createHash('sha256').update(await readFile(outPath)).digest('hex');
  const relPath = captureRelPath(locale, opts.device, opts.name);
  let manifest = structuredClone(project.manifest);
  const updated: UpdatedScreen[] = [];
  for (const preset of matched) {
    manifest.sizes[preset.id] = {
      ...manifest.sizes[preset.id],
      displayType: preset.displayType,
      token: preset.deviceTypeToken,
      px: preset.px,
      simulator: device.name,
      udid: device.udid,
      framed: !preset.passthrough,
    };
    for (const { screen, ordinal } of screensUsing(project, preset, locale, opts.name)) {
      const current = imageState(manifest, locale, preset.id, screen.id)?.status ?? 'pending';
      const patch: Partial<ImageState> = { capture: relPath, captureSha256: sha256, capturePx: dims };
      if (current === 'pending' || current === 'copy-approved') patch.status = 'captured';
      manifest = updateImage(manifest, { locale, sizeId: preset.id, screenId: screen.id }, patch);
      updated.push({ sizeId: preset.id, screenId: screen.id, ordinal, status: patch.status ?? current });
    }
  }
  await writeManifest(project.manifestPath, manifest);

  const lines = [
    `Captured ${opts.name} (${opts.device}, ${locale}): ${relative(project.dir, outPath)} ${formatDims(dims)}`,
    `Simulator: ${device.name} (${device.udid})`,
    `Sizes: ${matched.map((p) => p.id).join(', ')}`,
  ];
  lines.push(
    updated.length > 0
      ? `Screens updated:\n${bullets(updated.map((u) => `${u.sizeId} ${formatOrdinal(u.ordinal)}-${u.screenId} (${u.status})`))}`
      : `No screen in screens.ts uses capture "${opts.name}" for ${opts.device}; file kept, manifest screens unchanged.`,
  );
  if (warnings.length > 0) lines.push(`Warnings:\n${bullets(warnings)}`);

  return {
    data: {
      path: outPath,
      relPath,
      dims,
      sha256,
      locale,
      family: opts.device,
      simulator: { udid: device.udid, name: device.name },
      sizes: matched.map((p) => p.id),
      screens: updated,
      exact: exact.length > 0,
      warnings,
    },
    text: lines.join('\n'),
  };
}

export function registerCapture(program: Command): void {
  defineAction<CaptureOptions>(
    program
      .command('capture')
      .description('Screenshot a simulator into captures/<locale>/<family>/<name>.png and record it in the manifest')
      .requiredOption('--udid <udid|name>', 'simulator udid or exact device name')
      .requiredOption('--name <id>', 'capture name (screen id, or the capture ref used in screens.ts)')
      .addOption(new Option('--device <family>', 'device family').choices([...FAMILIES]).makeOptionMandatory())
      .option('--locale <locale>', 'locale folder (default: the source locale)'),
    ({ globals, opts }) => captureCommand(globals, opts),
  );
}
