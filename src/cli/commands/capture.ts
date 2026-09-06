// `s1s capture`: screenshot a simulator into captures/<locale>/<family>/<name>.png,
// verify the pixel size against the project's presets, and record path,
// sha256 and px in the manifest for every screen that uses the capture.
//
// Size rule (captureDimsWarning): exact `captureDims` = ok; same aspect
// within 1% = warning (the render reports the same warn-level capture-dims);
// anything else = error. The screenshot lands in a temp file first, so a
// wrong-size shot never replaces an existing good capture.
//
// --name takes the same two spellings screens.ts does: a bare name, checked
// against the project's sizes of --device, or `<sizeId>:<name>`, checked
// against that one size. The prefixed form is how a capture of a device the
// project does not export gets shot at all: phone-watch draws a watch on an
// iPhone canvas, so `watch-ultra:watch-lap` is a 422x514 file that no iPhone
// or iPad size would accept. Which size the file is checked against and which
// screens then reference it are two different questions: the checking size is
// the ref's own, while the screens are found across every size the project
// renders, because those are the canvases the capture appears on.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { Option, type Command } from 'commander';
import {
  ALL_SIZE_IDS,
  CAPTURE_REF_RE,
  captureDimsWarning,
  captureRelPath,
  formatDims,
  formatOrdinal,
  getPreset,
  parseCaptureRef,
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
  /** Optional only when --name carries a `<sizeId>:` prefix, which names the family itself. */
  device?: DeviceFamily;
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

export interface ScreenUse {
  preset: SizePreset;
  screen: ScreenDef;
  ordinal: number;
  /** The file is this screen's own device, so it owns the ImageState capture fields. */
  primary: boolean;
}

/**
 * Screens whose captures name this file, across every size the project
 * renders, each with its ordinal in that size's set.
 *
 * Matching is by family plus file name rather than by the ref as written,
 * because `watch-lap` and `watch-s10:watch-lap` are two spellings of one file
 * (`captureKey` treats them as one) and either may appear in screens.ts. The
 * family guard is what keeps them apart from a same-named capture of another
 * device, whose ref resolves to a different directory.
 *
 * `primary` marks the uses where the file is the screen's own device: the
 * capture family matches the family being rendered. A phone-watch screen has
 * two captures, and an ImageState has one `capture` field, so only the primary
 * may fill it. Recording the watch file as the capture of an iPhone screen
 * would tell `s1s status` the iPhone capture is a 422x514 watch shot.
 */
export function screensUsingFile(project: Project, locale: string, family: DeviceFamily, name: string): ScreenUse[] {
  const out: ScreenUse[] = [];
  for (const sizeId of project.sizes) {
    const preset = getPreset(sizeId);
    const applicable = project.screens.screens.filter((s) => screenAppliesTo(s, preset));
    applicable.forEach((screen, index) => {
      const resolved = resolveScreen(screen, preset, locale, undefined, probeResolver);
      const uses = resolved.captures.some((c) => c.family === family && parseCaptureRef(c.requested).name === name);
      if (uses) out.push({ preset, screen, ordinal: index + 1, primary: preset.family === family });
    });
  }
  return out;
}

async function captureCommand(globals: GlobalOpts, opts: CaptureOptions): Promise<CommandOutput> {
  const ref = opts.name;
  if (!CAPTURE_REF_RE.test(ref)) {
    throw new S1sError(
      'usage',
      `Invalid capture name "${ref}". Use letters, digits, ".", "_" or "-", optionally after a "<sizeId>:" prefix (the rule screens.ts applies too).`,
    );
  }
  const { sizeId, name, unknownSize } = parseCaptureRef(ref);
  if (unknownSize) {
    throw new S1sError('usage', `"${ref}" is prefixed with a size that does not exist.`, {
      hint: `Sizes: ${ALL_SIZE_IDS.join(', ')}.`,
    });
  }
  // A prefixed ref names its own size, and that size need not be one the
  // project exports: `watch-ultra:watch-lap` is legitimate in a project whose
  // `sizes` are iphone-6.9 and ipad-13, because phone-watch draws the watch on
  // those canvases. Its preset then decides both the family (so the directory)
  // and the pixel size the shot is checked against.
  const refPreset = sizeId === null ? null : getPreset(sizeId);
  if (refPreset !== null && opts.device !== undefined && opts.device !== refPreset.family) {
    throw new S1sError('usage', `--name names ${refPreset.id}, a ${refPreset.family} size, but --device is ${opts.device}.`, {
      hint: `Drop --device, or pass --device ${refPreset.family}.`,
    });
  }
  const family = refPreset?.family ?? opts.device;
  if (family === undefined) {
    throw new S1sError('usage', 'A bare --name needs --device to say which family it belongs to.', {
      hint: `Pass --device ${FAMILIES.join('|')}, or name the size in --name as "<sizeId>:${ref}".`,
    });
  }
  const project = await openProject(globals);
  const locale = opts.locale ?? project.sourceLocale;
  const presets = refPreset !== null ? [refPreset] : project.sizes.map(getPreset).filter((p) => p.family === family);
  if (presets.length === 0) {
    throw new S1sError('usage', `This project has no ${family} size (sizes: ${project.sizes.join(', ')}).`, {
      hint: 'Add the size to `sizes` in screens.ts first, or name the size in --name as "<sizeId>:<name>".',
    });
  }

  const device = await findSim(opts.udid);
  const outPath = capturePath(project, locale, family, ref);
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
    throw new S1sError('capture-invalid', `${device.name} produced ${formatDims(dims)}; ${family} sizes expect ${expected}. ${kept}`, {
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
  const relPath = captureRelPath(locale, family, ref);
  let manifest = structuredClone(project.manifest);
  const updated: UpdatedScreen[] = [];
  // The simulator is recorded against the size that was actually shot, which
  // for a prefixed ref is a size outside `sizes`; `manifest.sizes` is a partial
  // map, so the extra key simply records what took the picture.
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
  }
  const uses = screensUsingFile(project, locale, family, name);
  for (const { preset, screen, ordinal } of uses.filter((u) => u.primary)) {
    const current = imageState(manifest, locale, preset.id, screen.id)?.status ?? 'pending';
    const patch: Partial<ImageState> = { capture: relPath, captureSha256: sha256, capturePx: dims };
    if (current === 'pending' || current === 'copy-approved') patch.status = 'captured';
    manifest = updateImage(manifest, { locale, sizeId: preset.id, screenId: screen.id }, patch);
    updated.push({ sizeId: preset.id, screenId: screen.id, ordinal, status: patch.status ?? current });
  }
  await writeManifest(project.manifestPath, manifest);
  const secondary = uses.filter((u) => !u.primary).map((u) => `${u.preset.id} ${formatOrdinal(u.ordinal)}-${u.screen.id}`);

  const lines = [
    `Captured ${ref} (${family}, ${locale}): ${relative(project.dir, outPath)} ${formatDims(dims)}`,
    `Simulator: ${device.name} (${device.udid})`,
    `Sizes: ${matched.map((p) => p.id).join(', ')}`,
  ];
  if (updated.length > 0) {
    lines.push(`Screens updated:\n${bullets(updated.map((u) => `${u.sizeId} ${formatOrdinal(u.ordinal)}-${u.screenId} (${u.status})`))}`);
  } else if (secondary.length === 0) {
    lines.push(`No screen in screens.ts uses capture "${name}" for ${family}; file kept, manifest screens unchanged.`);
  }
  if (secondary.length > 0) {
    lines.push(
      `Drawn as a second device on:\n${bullets(secondary)}\nTheir own capture entries are unchanged; re-render those screens to pick this file up.`,
    );
  }
  if (warnings.length > 0) lines.push(`Warnings:\n${bullets(warnings)}`);

  return {
    data: {
      path: outPath,
      relPath,
      dims,
      sha256,
      locale,
      family,
      simulator: { udid: device.udid, name: device.name },
      sizes: matched.map((p) => p.id),
      screens: updated,
      secondaryScreens: secondary,
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
      .requiredOption('--name <ref>', 'capture name, or "<sizeId>:<name>" as written in screens.ts (the prefix names the device)')
      .addOption(new Option('--device <family>', 'device family; optional when --name carries a "<sizeId>:" prefix').choices([...FAMILIES]))
      .option('--locale <locale>', 'locale folder (default: the source locale)'),
    ({ globals, opts }) => captureCommand(globals, opts),
  );
}
