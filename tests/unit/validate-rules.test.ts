// The Apple rules `s1s validate` reads off the tree itself: which folders it
// looks into (a symlinked locale, a legacy sibling), what counts as a file of
// the set, and which sizes and colour spaces App Store Connect takes. Every
// case here is a tree `asc screenshots upload` walks but `s1s validate` used
// to describe wrongly. references/apple-rules.md sections 2, 3 and 6.
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateText } from '../../src/cli/commands/validate.ts';
import type { AppDisplayType, Dims, SizeId } from '../../src/config/types.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { validateExport, type ValidateCode, type ValidateProblem, type ValidateReport } from '../../src/render/validate.ts';
import { makeTempDir, must, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import { makeFlatPng, writeExportSet } from '../fixtures/make-set.ts';

const IPHONE_69: Dims = { width: 1320, height: 2868 };
const IPAD_13: Dims = { width: 2064, height: 2752 };

async function makeValidateProject(root: string, sizes: SizeId[]): Promise<Project> {
  const projectDir = join(root, 'screenshots');
  await writeTempProject(projectDir, { screens: { sizes, screens: [{ id: 'home' }] } });
  return loadProject({ projectDir });
}

/** <root>/metadata/screenshots/<locale>/<displayType> */
function setDir(root: string, locale: string, displayType: string): string {
  return join(root, 'metadata', 'screenshots', locale, displayType);
}

/** A greyscale PNG: one channel, no alpha, the right pixel size. */
async function makeGreyPng(outPath: string, dims: Dims): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const raw = Buffer.alloc(dims.width * dims.height, 120);
  // Without the colourspace pin sharp re-encodes the pipeline as sRGB.
  await sharp(raw, { raw: { width: dims.width, height: dims.height, channels: 1 } })
    .pipelineColourspace('b-w')
    .toColourspace('b-w')
    .png()
    .toFile(outPath);
  return outPath;
}

function problemsWith(report: ValidateReport, code: ValidateCode): ValidateProblem[] {
  return report.problems.filter((problem) => problem.code === code);
}

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-validate-rules-');
});
afterEach(() => tmp.cleanup());

describe('validateExport: which folders it reads', () => {
  it('warns about a legacy sibling folder that holds the same pixels', async () => {
    const project = await makeValidateProject(tmp.dir, ['ipad-13']);
    await makeFlatPng(join(setDir(tmp.dir, 'en-US', 'APP_IPAD_PRO_3GEN_129'), '01.png'), IPAD_13, [40, 60, 90]);
    const legacy = setDir(tmp.dir, 'en-US', 'APP_IPAD_PRO_129');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, '01.png'), 'the 12.9 inch folder App Store Connect still lists');

    const report = await validateExport(project, {});
    const duplicate = problemsWith(report, 'duplicate-dims');
    expect(duplicate).toHaveLength(1);
    expect(must(duplicate[0], 'duplicate-dims').message).toContain('APP_IPAD_PRO_129');
    expect(must(duplicate[0], 'duplicate-dims').level).toBe('warn');
  });

  it('checks a symlinked locale folder instead of calling it a stray file', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_IPHONE_69');
    await writeExportSet(dir, ['01.png', '02.png'], IPHONE_69);
    await symlink(join(tmp.dir, 'metadata', 'screenshots', 'en-US'), join(tmp.dir, 'metadata', 'screenshots', 'ja-JP'));

    const report = await validateExport(project, {});
    expect(report.locales.sort()).toEqual(['en-US', 'ja-JP']);
    expect(report.sets.map((set) => set.locale).sort()).toEqual(['en-US', 'ja-JP']);
    expect(problemsWith(report, 'file-name')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('accepts a locale folder with no set at all (all-or-nothing means "or none")', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), ['01.png'], IPHONE_69);
    await mkdir(join(tmp.dir, 'metadata', 'screenshots', 'fr-FR'), { recursive: true });

    const report = await validateExport(project, {});
    expect(problemsWith(report, 'locale-incomplete')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('still reports the duplicate-dims trap when --sizes narrows the report', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), ['01.png'], IPHONE_69);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_67'), ['01.png'], IPHONE_69);

    const narrowed = await validateExport(project, { sizes: ['iphone-6.9'] });
    expect(narrowed.sets.map((set) => set.displayType)).toEqual(['APP_IPHONE_69']);
    expect(problemsWith(narrowed, 'duplicate-dims')).toHaveLength(1);
    expect(validateText(narrowed)).not.toContain('Ready to upload.');
  });

  it('reports a missing metadata dir as one error, not a throw', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);

    // Nothing was exported yet: the folder `s1s export` writes does not exist.
    const report = await validateExport(project, {});
    expect(report.metadataDir).toBe(join(tmp.dir, 'metadata', 'screenshots'));
    expect(report.locales).toEqual([]);
    expect(report.scanned).toEqual([]);
    expect(report.sets).toEqual([]);
    expect(report.problems.map((problem) => problem.code)).toEqual(['set-empty']);
    const missing = must(report.problems[0], 'set-empty');
    expect(missing.level).toBe('error');
    expect(missing.message).toContain(report.metadataDir);
    expect(missing.message).toContain('s1s export');
    expect(report.ok).toBe(false);
    expect(validateText(report)).toContain('0 sets');
  });

  it('rejects a locale that is a path', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), ['01.png'], IPHONE_69);
    await expect(validateExport(project, { locale: '../..' })).rejects.toThrow(/one folder name/);
  });
});

describe('validateExport: what it says about the files', () => {
  it('counts only the files that upload, not a stray notes.txt', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_IPHONE_69');
    await writeExportSet(dir, ['01.png'], IPHONE_69);
    await writeFile(join(dir, 'notes.txt'), 'hand notes');

    const report = await validateExport(project, {});
    expect(must(report.sets[0], 'set').count).toBe(1);
    // The stray is still an error, it just does not count towards 1-to-10.
    expect(problemsWith(report, 'file-name')).toHaveLength(1);
  });

  it('warns, and does not fail, on a greyscale image of the right size', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    await makeGreyPng(join(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), '01.png'), IPHONE_69);

    const report = await validateExport(project, {});
    const colour = problemsWith(report, 'not-an-image');
    expect(colour).toHaveLength(1);
    expect(must(colour[0], 'colour problem').level).toBe('warn');
    expect(must(colour[0], 'colour problem').message).toContain('RGB');
    expect(report.ok).toBe(true);
  });

  it('accepts a landscape set as a warn, not a dims-unaccepted error', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const landscape: Dims = { width: IPHONE_69.height, height: IPHONE_69.width };
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), ['01.png', '02.png'], landscape);

    const report = await validateExport(project, {});
    const dims = problemsWith(report, 'dims-unaccepted');
    expect(dims).toHaveLength(2);
    expect(dims.every((problem) => problem.level === 'warn')).toBe(true);
    expect(must(dims[0], 'dims problem').message).toContain('landscape');
    expect(report.ok).toBe(true);
  });

  it('mixes portrait and landscape into a dims-mixed error', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_IPHONE_69');
    await makeFlatPng(join(dir, '01.png'), IPHONE_69, [10, 20, 30]);
    await makeFlatPng(join(dir, '02.png'), { width: IPHONE_69.height, height: IPHONE_69.width }, [10, 20, 30]);

    const report = await validateExport(project, {});
    expect(problemsWith(report, 'dims-mixed')).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it('shows no size rather than "mixed" for a set whose files are all unreadable', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.1']);
    const dir: string = setDir(tmp.dir, 'en-US', 'APP_IPHONE_61' satisfies AppDisplayType);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '01.png'), 'not a PNG at all');
    await writeFile(join(dir, '02.png'), 'not a PNG either');

    const report = await validateExport(project, {});
    expect(problemsWith(report, 'not-an-image')).toHaveLength(2);
    expect(problemsWith(report, 'dims-mixed')).toEqual([]);
    expect(validateText(report)).not.toContain('mixed');
  });
});
