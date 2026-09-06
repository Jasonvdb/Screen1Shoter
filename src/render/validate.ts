// `s1s validate`: an offline re-check of an exported metadata/screenshots tree
// against the rules App Store Connect enforces at upload time.
//
// It reads the real pixels with sharp (a file name never proves its size) and
// collects problems instead of throwing, so one run lists every fixable thing
// at once. Only a structural failure (an unreadable directory, an unknown size
// id) raises S1sError. Two of the rules are ours rather than Apple's: the
// all-or-nothing rule across locales, and the duplicate-dims trap that makes
// `asc screenshots upload` fan out the same pixels into two sets.
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  ALL_SIZE_IDS,
  dimsEqual,
  displayTypesShareDims,
  exportOrdinal,
  formatDims,
  isAcceptedDims,
  isSizeId,
  presetByDisplayType,
  presetsFor,
} from '../config/index.ts';
import type { AppDisplayType, Dims, SizePreset } from '../config/types.ts';
import { S1sError } from '../core/errors.ts';
import { errorMessage, isEnoent } from '../core/fs.ts';
import { assertLocaleSegment, exportDir, metadataDir } from '../core/paths.ts';
import type { Project } from '../core/project.ts';

export type ValidateCode =
  | 'file-name'
  | 'file-gap'
  | 'set-empty'
  | 'set-too-many'
  | 'dims-unaccepted'
  | 'dims-mixed'
  | 'has-alpha'
  | 'not-an-image'
  | 'locale-incomplete'
  | 'duplicate-dims';

export interface ValidateProblem {
  code: ValidateCode;
  level: 'warn' | 'error';
  message: string;
  /** Absolute path, when the problem is about one file. */
  file?: string;
  /**
   * 'tree' marks a problem the cross-locale rules found. Those compare every
   * locale folder, so such a problem can name a locale outside `--locale`.
   */
  scope?: 'tree';
}

export interface ValidateSet {
  locale: string;
  displayType: AppDisplayType;
  /** Absolute. */
  dir: string;
  /** Absolute, sorted; every non-dot entry of the folder. */
  files: string[];
  /** Files that would upload: `NN.png` / `NN.jpg` / `NN.jpeg` names only. */
  count: number;
  /** The set's uniform size; null when mixed or empty. */
  dims: Dims | null;
  problems: ValidateProblem[];
}

export interface ValidateOptions {
  /** Absolute or app-relative override of manifest.app.metadataDir. */
  metadataDir?: string;
  /**
   * Default: every locale folder present. It narrows the sets in the report
   * and their per-file problems only; the all-or-nothing rule across locales
   * always compares every locale folder in the tree.
   */
  locale?: string;
  /** Size ids; restricts which display types are checked. */
  sizes?: string[];
}

export interface ValidateReport {
  version: 1;
  generatedAt: string;
  metadataDir: string;
  /** The locales reported in detail: `--locale` narrows this to one. */
  locales: string[];
  /** Every locale folder found, narrowed or not; what the cross-locale rules compared. */
  scanned: string[];
  sets: ValidateSet[];
  /** Every set problem plus the cross-set ones, flattened. */
  problems: ValidateProblem[];
  /** No error-level problems. */
  ok: boolean;
}

/** App Store Connect takes 1 to 10 screenshots per set. */
export const MIN_SET_FILES = 1;
export const MAX_SET_FILES = 10;

/** Files worth opening with sharp; a name outside this is not an image at all. */
const IMAGE_EXT_RE = /\.(png|jpe?g)$/i;

function problem(
  code: ValidateCode,
  level: ValidateProblem['level'],
  message: string,
  file?: string,
): ValidateProblem {
  return { code, level, message, ...(file === undefined ? {} : { file }) };
}

/** Display types to check, or null for every one this tool knows. */
function allowedDisplayTypes(sizes: readonly string[] | undefined): ReadonlySet<AppDisplayType> | null {
  if (!sizes || sizes.length === 0) return null;
  for (const id of sizes) {
    if (!isSizeId(id)) {
      throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
    }
  }
  return new Set(presetsFor(sizes).map((preset) => preset.displayType));
}

/**
 * Directory entries by name, or null when the directory does not exist. A
 * symlink to a directory counts as one: `readdir` reports it as neither file
 * nor directory, while `asc screenshots upload` follows it and uploads what
 * is behind it.
 */
async function listDir(dir: string): Promise<{ name: string; isDirectory: boolean }[] | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const named = await Promise.all(
      entries
        // Dot-files (.DS_Store and friends) are macOS noise, never an export.
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => ({
          name: entry.name,
          isDirectory:
            entry.isDirectory() ||
            (entry.isSymbolicLink() && (await stat(join(dir, entry.name)).catch(() => null))?.isDirectory() === true),
        })),
    );
    return named.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (isEnoent(err)) return null;
    throw new S1sError('validate-failed', `Cannot read ${dir}: ${errorMessage(err)}`, {
      hint: 'Check that the path is a readable directory, then run `s1s validate` again.',
    });
  }
}

interface Probed {
  dims: Dims;
  hasAlpha: boolean;
  /** sharp's colour-space name ('srgb', 'b-w', 'cmyk', ...). */
  space: string;
  channels: number;
}

/** Colour spaces App Store Connect reads as RGB (apple-rules.md section 3). */
const RGB_SPACES: ReadonlySet<string> = new Set(['srgb', 'rgb', 'rgb16', 'scrgb']);

/** Pixel facts from the file itself, or the reason sharp could not read it. */
async function probe(path: string): Promise<Probed | { error: string }> {
  try {
    const meta = await sharp(path).metadata();
    // hasAlpha is the field App Store Connect rejects on: a fully opaque
    // alpha channel is still an alpha channel.
    return { dims: { width: meta.width, height: meta.height }, hasAlpha: meta.hasAlpha, space: meta.space, channels: meta.channels };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

function isProbed(result: Probed | { error: string }): result is Probed {
  return !('error' in result);
}

/**
 * '01, 02, 05' for a problem message. Not `formatOrdinal` from config: these
 * are the ordinals read off the files, so `00.png` (which this rule exists to
 * report) reaches here as 0, outside the 1..99 that names a real screenshot.
 */
function formatOrdinals(ordinals: readonly number[]): string {
  return ordinals.map((n) => String(n).padStart(2, '0')).join(', ');
}

/**
 * File names must be 01..NN with no gaps, no 00 and no ordinal claimed twice
 * (01.png next to 01.jpg would upload in an order nobody chose).
 */
function ordinalProblems(label: string, named: readonly { name: string; ordinal: number }[]): ValidateProblem[] {
  if (named.length === 0) return [];
  const problems: ValidateProblem[] = [];
  const byOrdinal = new Map<number, string[]>();
  for (const file of named) {
    byOrdinal.set(file.ordinal, [...(byOrdinal.get(file.ordinal) ?? []), file.name]);
  }
  for (const [ordinal, names] of [...byOrdinal].sort((a, b) => a[0] - b[0])) {
    if (names.length > 1) {
      problems.push(problem('file-gap', 'error', `${label}: ordinal ${formatOrdinals([ordinal])} is used by ${names.join(' and ')}; one file per ordinal.`));
    }
  }
  const found = [...byOrdinal.keys()].sort((a, b) => a - b);
  const expected = found.map((_, index) => index + 1);
  if (found.join() !== expected.join()) {
    problems.push(problem('file-gap', 'error', `${label}: ordinals must run from 01 with no gaps; found ${formatOrdinals(found)}, expected ${formatOrdinals(expected)}.`));
  }
  return problems;
}

async function checkSet(locale: string, preset: SizePreset, dir: string): Promise<ValidateSet> {
  const displayType = preset.displayType;
  const label = `${locale}/${displayType}`;
  const entries = (await listDir(dir)) ?? [];
  const problems: ValidateProblem[] = [];
  const fileNames: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      problems.push(problem('file-name', 'error', `${label}/${entry.name} is a directory; a set holds only NN.png or NN.jpg files.`, join(dir, entry.name)));
      continue;
    }
    fileNames.push(entry.name);
  }

  const named: { name: string; ordinal: number }[] = [];
  for (const name of fileNames) {
    const ordinal = exportOrdinal(name);
    if (ordinal !== null) {
      named.push({ name, ordinal });
    } else {
      problems.push(problem('file-name', 'error', `${label}/${name} is not named NN.png, NN.jpg or NN.jpeg (two digits, lower-case extension).`, join(dir, name)));
    }
  }

  // The 1-to-10 rule is about the files that upload, so a stray notes.txt
  // (already a file-name error) must not inflate the count.
  if (named.length < MIN_SET_FILES) {
    problems.push(problem('set-empty', 'error', `${label} holds no files; a set holds ${MIN_SET_FILES} to ${MAX_SET_FILES} screenshots.`));
  } else if (named.length > MAX_SET_FILES) {
    problems.push(problem('set-too-many', 'error', `${label} holds ${named.length} files; App Store Connect takes at most ${MAX_SET_FILES} per set.`));
  }
  problems.push(...ordinalProblems(label, named));

  const seen: Dims[] = [];
  for (const name of fileNames) {
    const path = join(dir, name);
    if (!IMAGE_EXT_RE.test(name)) continue; // already reported as file-name
    const result = await probe(path);
    if (!isProbed(result)) {
      problems.push(problem('not-an-image', 'error', `${label}/${name} is not a readable image: ${result.error}`, path));
      continue;
    }
    if (result.hasAlpha) {
      problems.push(problem('has-alpha', 'error', `${label}/${name} has an alpha channel; App Store Connect rejects it even when every pixel is opaque.`, path));
    }
    if (!RGB_SPACES.has(result.space) || result.channels < 3) {
      // apple-rules.md section 3 asks for RGB / sRGB. Nothing here proves App
      // Store Connect rejects a greyscale file, so this is a warn.
      problems.push(problem('not-an-image', 'warn', `${label}/${name} is ${result.space} with ${result.channels} channel(s); App Store Connect expects RGB or sRGB.`, path));
    }
    if (!isAcceptedDims(preset, result.dims)) {
      const rotated: Dims = { width: result.dims.height, height: result.dims.width };
      if (isAcceptedDims(preset, rotated)) {
        // Every accepted size is also accepted rotated (apple-rules.md
        // section 2); one orientation per set is enforced by dims-mixed.
        problems.push(problem('dims-unaccepted', 'warn', `${label}/${name} is ${formatDims(result.dims)}, the landscape form of ${formatDims(rotated)}; App Store Connect accepts a rotated size, but every file in the set must keep that one orientation.`, path));
      } else {
        const accepted = preset.acceptedDims.map(formatDims).join(', ');
        problems.push(problem('dims-unaccepted', 'error', `${label}/${name} is ${formatDims(result.dims)}; ${displayType} accepts ${accepted} (portrait or rotated).`, path));
      }
    }
    if (!seen.some((dims) => dimsEqual(dims, result.dims))) seen.push(result.dims);
  }

  const first = seen[0];
  const dims = seen.length === 1 && first ? first : null;
  if (seen.length > 1) {
    problems.push(problem('dims-mixed', 'error', `${label} mixes ${seen.map(formatDims).join(' and ')}; every file in one set must have the same pixel size.`));
  }

  return {
    locale,
    displayType,
    dir,
    files: fileNames.map((name) => join(dir, name)),
    count: named.length,
    dims,
    problems,
  };
}

/**
 * What the cross-locale rules need from a locale: which display-type folders it
 * holds and how many files each would upload. A locale inside `--locale` fills
 * this in from its checked sets; a sibling gets the cheap scan below.
 */
interface LocaleShape {
  locale: string;
  sets: { displayType: AppDisplayType; count: number }[];
}

/**
 * The folder-and-count view of a locale outside `--locale`. Its pixels are that
 * locale's own business, so nothing here opens a file with sharp; the rule only
 * asks which display types exist and how many files would upload.
 */
async function scanShape(root: string, locale: string): Promise<LocaleShape> {
  const sets: LocaleShape['sets'] = [];
  for (const entry of (await listDir(join(root, locale))) ?? []) {
    if (!entry.isDirectory) continue;
    const preset = presetByDisplayType(entry.name);
    if (!preset) continue;
    const files = (await listDir(exportDir(root, locale, preset.displayType))) ?? [];
    const count = files.filter((file) => !file.isDirectory && exportOrdinal(file.name) !== null).length;
    sets.push({ displayType: preset.displayType, count });
  }
  return { locale, sets };
}

/**
 * `--locale de-DE` narrows the table, never the all-or-nothing rule, so a
 * narrowed run can report a problem that names en-US. Say inside the message
 * why a locale nobody asked about is there.
 */
function siblingNote(mentioned: readonly string[], requested: string | undefined): string {
  if (requested === undefined) return '';
  const outside = [...new Set(mentioned)].filter((locale) => locale !== requested);
  if (outside.length === 0) return '';
  const one = outside.length === 1;
  return (
    ` ${outside.join(', ')} ${one ? 'is a sibling locale' : 'are sibling locales'} outside --locale ${requested}: ` +
    'this rule is about the whole export tree, so s1s compared every locale folder.'
  );
}

/**
 * Uploads are all-or-nothing per display type: a locale that is missing a set
 * its siblings have is nearly always an unfinished export, and a set whose
 * file count differs from the other locales' is nearly always a forgotten
 * screen (App Store Connect itself accepts both, hence the warn level).
 *
 * `shapes` is every locale folder in the tree, never the `--locale` subset: the
 * incomplete locale is usually the one the user did not name.
 */
function localeProblems(shapes: readonly LocaleShape[], requested: string | undefined): ValidateProblem[] {
  const byType = new Map<AppDisplayType, { locale: string; count: number }[]>();
  for (const shape of shapes) {
    for (const set of shape.sets) {
      byType.set(set.displayType, [...(byType.get(set.displayType) ?? []), { locale: shape.locale, count: set.count }]);
    }
  }

  // A locale with no set at all is the documented "or none" half of the
  // all-or-nothing rule (apple-rules.md section 2), not an unfinished export.
  const populated = new Set(shapes.filter((shape) => shape.sets.length > 0).map((shape) => shape.locale));
  const problems: ValidateProblem[] = [];
  for (const [displayType, typeSets] of byType) {
    const present = typeSets.map((set) => set.locale);
    for (const { locale } of shapes) {
      if (present.includes(locale) || !populated.has(locale)) continue;
      problems.push({
        code: 'locale-incomplete',
        level: 'error',
        message:
          `${displayType} exists in ${present.join(', ')} but not in ${locale}; uploads are all-or-nothing per display type.` +
          siblingNote([...present, locale], requested),
        scope: 'tree',
      });
    }
    const counts = [...new Set(typeSets.map((set) => set.count))];
    if (counts.length > 1) {
      const detail = typeSets.map((set) => `${set.locale}: ${set.count}`).join(', ');
      problems.push({
        code: 'locale-incomplete',
        level: 'warn',
        message:
          `${displayType} has a different number of files per locale (${detail}). App Store Connect stores one set per locale, so this uploads, but a mismatched set is nearly always a screen someone forgot to render.` +
          siblingNote(present, requested),
        scope: 'tree',
      });
    }
  }
  return problems;
}

/**
 * The one wording of the duplicate-dims trap, shared with `s1s export`
 * (src/render/export.ts warns before the files exist, this file reports it
 * from the files themselves). references/apple-rules.md section 3.
 */
export function duplicateDimsMessage(locale: string, a: string, b: string, dims: Dims): string {
  return (
    `${locale}: ${a} and ${b} both hold ${formatDims(dims)} files. ` +
    '`asc screenshots upload --path <metadata dir>` fans out over the tree and selects files by pixel size, ' +
    'so the same pixels upload into both sets: the count doubles and can exceed the 10-file limit. ' +
    'Upload one --device-type at a time (asc-upload.md section 7), or delete the set you do not ship.'
  );
}

/** Sibling sets in one locale whose real pixels are equal and whose folders both accept them. */
function duplicateDimsProblems(sets: readonly ValidateSet[]): ValidateProblem[] {
  const problems: ValidateProblem[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      if (!a || !b || a.locale !== b.locale) continue;
      const dims = a.dims;
      if (!dims || !b.dims || !dimsEqual(dims, b.dims)) continue;
      if (!displayTypesShareDims(a.displayType, b.displayType)) continue;
      problems.push(problem('duplicate-dims', 'warn', duplicateDimsMessage(a.locale, a.displayType, b.displayType, dims)));
    }
  }
  return problems;
}

/**
 * The same trap against a folder no preset writes: the legacy
 * `APP_IPAD_PRO_129` beside `APP_IPAD_PRO_3GEN_129` holds the same pixels and
 * `presetByDisplayType` returns nothing for it, so it never becomes a set.
 * `s1s export` warns about that pair from the folder listing; this is the
 * validate side of it (references/apple-rules.md section 3).
 */
async function legacyDuplicateDims(
  localeDir: string,
  locale: string,
  unknownDirs: readonly string[],
  sets: readonly ValidateSet[],
): Promise<ValidateProblem[]> {
  const problems: ValidateProblem[] = [];
  for (const name of unknownDirs) {
    for (const set of sets) {
      if (!displayTypesShareDims(set.displayType, name)) continue;
      const dims = set.dims ?? presetByDisplayType(set.displayType)?.px;
      if (!dims) continue;
      const held = await readdir(join(localeDir, name)).catch(() => [] as string[]);
      if (!held.some((file) => exportOrdinal(file) !== null)) continue;
      problems.push(problem('duplicate-dims', 'warn', duplicateDimsMessage(locale, set.displayType, name, dims)));
    }
  }
  return problems;
}

/**
 * Checks an export tree without touching the network or the manifest. Returns
 * `ok: false` for anything App Store Connect would reject; throws only when
 * the tree itself cannot be read or an option is wrong.
 */
export async function validateExport(project: Project, opts: ValidateOptions = {}): Promise<ValidateReport> {
  const allowed = allowedDisplayTypes(opts.sizes);
  const dir = opts.metadataDir ? resolve(project.appDir, opts.metadataDir) : metadataDir(project);
  const generatedAt = new Date().toISOString();

  const localeEntries = await listDir(dir);
  if (localeEntries === null) {
    const missing = problem('set-empty', 'error', `No export folder at ${dir}; run \`s1s export\` before \`s1s validate\`.`);
    return { version: 1, generatedAt, metadataDir: dir, locales: [], scanned: [], sets: [], problems: [missing], ok: false };
  }

  const scanned = localeEntries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
  const problems: ValidateProblem[] = [];
  for (const entry of localeEntries) {
    if (!entry.isDirectory) {
      problems.push(problem('file-name', 'warn', `${entry.name} is a stray file in the export dir, which holds one folder per locale.`, join(dir, entry.name)));
    }
  }

  let locales = scanned;
  if (opts.locale !== undefined) {
    assertLocaleSegment(opts.locale);
    locales = scanned.includes(opts.locale) ? [opts.locale] : [];
    if (locales.length === 0) {
      problems.push(problem('locale-incomplete', 'error', `Locale ${opts.locale} has no folder under ${dir}.`));
    }
  }

  // Every set of a reported locale is built, `--sizes` only narrows what is
  // reported: the duplicate-dims trap is a property of the whole tree, and the
  // fan-out upload it describes ignores --sizes.
  const allSets: ValidateSet[] = [];
  const shapes: LocaleShape[] = [];
  for (const locale of scanned) {
    // A sibling outside --locale is compared, not inspected: its own file names,
    // pixels and stray files are the business of the run that names it.
    if (!locales.includes(locale)) {
      shapes.push(await scanShape(dir, locale));
      continue;
    }
    const localeDir = join(dir, locale);
    const unknownDirs: string[] = [];
    const localeSets: ValidateSet[] = [];
    for (const entry of (await listDir(localeDir)) ?? []) {
      const path = join(localeDir, entry.name);
      if (!entry.isDirectory) {
        problems.push(problem('file-name', 'warn', `${locale}/${entry.name} is a stray file; a locale holds one folder per display type.`, path));
        continue;
      }
      const preset = presetByDisplayType(entry.name);
      if (!preset) {
        problems.push(problem('file-name', 'warn', `${locale}/${entry.name} is not a display type this tool knows; s1s left it alone.`, path));
        unknownDirs.push(entry.name);
        continue;
      }
      localeSets.push(await checkSet(locale, preset, exportDir(dir, locale, preset.displayType)));
    }
    problems.push(...(await legacyDuplicateDims(localeDir, locale, unknownDirs, localeSets)));
    allSets.push(...localeSets);
    shapes.push({ locale, sets: localeSets.map((set) => ({ displayType: set.displayType, count: set.count })) });
  }
  const sets = allowed ? allSets.filter((set) => allowed.has(set.displayType)) : allSets;
  const compared = allowed
    ? shapes.map((shape) => ({ ...shape, sets: shape.sets.filter((set) => allowed.has(set.displayType)) }))
    : shapes;

  const crossSet = [...localeProblems(compared, opts.locale), ...duplicateDimsProblems(allSets)];
  const all = [...problems, ...sets.flatMap((set) => set.problems), ...crossSet];
  return {
    version: 1,
    generatedAt,
    metadataDir: dir,
    locales,
    scanned,
    sets,
    problems: all,
    ok: !all.some((p) => p.level === 'error'),
  };
}
