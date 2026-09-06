// s1s validate: the offline half of `asc screenshots validate`, run over
// metadata/screenshots/<locale>/<displayType>/. It enforces the rules in
// references/apple-rules.md section 3 (names NN.png contiguous from 01, 1-10
// files, accepted and uniform dims, no alpha channel), the all-or-nothing
// rule across locales, and the duplicate-dims trap that doubles a fan-out
// upload.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateText } from '../../src/cli/commands/validate.ts';
import type { AppDisplayType, Dims, SizeId } from '../../src/config/types.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import {
  validateExport,
  type ValidateCode,
  type ValidateProblem,
  type ValidateReport,
  type ValidateSet,
} from '../../src/render/validate.ts';
import { makeTempDir, must, pngInfo, writeTempProject, type TempDir } from '../fixtures/helpers.ts';
import { makeAlphaPng, makeFlatPng, writeExportSet } from '../fixtures/make-set.ts';

const IPHONE_69: Dims = { width: 1320, height: 2868 };
/** The other size App Store Connect accepts for APP_IPHONE_69: legal alone, illegal mixed in. */
const IPHONE_69_ALT: Dims = { width: 1290, height: 2796 };
const IPAD_13: Dims = { width: 2064, height: 2752 };
const WATCH: Dims = { width: 416, height: 496 };

const NAMES = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(2, '0')}.png`);

async function makeValidateProject(root: string, sizes: SizeId[]): Promise<Project> {
  const projectDir = join(root, 'screenshots');
  await writeTempProject(projectDir, { screens: { sizes, screens: [{ id: 'home' }] } });
  return loadProject({ projectDir });
}

/** <root>/metadata/screenshots/<locale>/<displayType> */
function setDir(root: string, locale: string, displayType: AppDisplayType): string {
  return join(root, 'metadata', 'screenshots', locale, displayType);
}

const codes = (problems: readonly ValidateProblem[]): ValidateCode[] => problems.map((problem) => problem.code);

function problemWith(report: ValidateReport, code: ValidateCode): ValidateProblem {
  return must(report.problems.find((problem) => problem.code === code), code);
}

function setFor(report: ValidateReport, locale: string, displayType: AppDisplayType): ValidateSet {
  return must(
    report.sets.find((set) => set.locale === locale && set.displayType === displayType),
    `${locale}/${displayType}`,
  );
}

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-validate-');
});
afterEach(() => tmp.cleanup());

describe('validateExport', () => {
  it('passes a set of three 1320x2868 RGB PNGs', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_IPHONE_69');
    const files = await writeExportSet(dir, NAMES(3), IPHONE_69);

    const report = await validateExport(project, {});
    expect(report.version).toBe(1);
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
    expect(report.metadataDir).toBe(join(tmp.dir, 'metadata', 'screenshots'));
    expect(report.locales).toEqual(['en-US']);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.sets).toHaveLength(1);

    const set = setFor(report, 'en-US', 'APP_IPHONE_69');
    expect(set.dir).toBe(dir);
    expect(set.count).toBe(3);
    expect(set.dims).toEqual(IPHONE_69);
    expect(set.files).toEqual([...files].sort());
    expect(set.problems).toEqual([]);
  });

  it('reports a gap in the numbering', async () => {
    const project = await makeValidateProject(tmp.dir, ['watch-s10']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_WATCH_SERIES_10'), ['01.png', '02.png', '04.png'], WATCH);

    const report = await validateExport(project, {});
    const problem = problemWith(report, 'file-gap');
    expect(problem.level).toBe('error');
    expect(report.ok).toBe(false);
    expect(setFor(report, 'en-US', 'APP_WATCH_SERIES_10').count).toBe(3);
  });

  it('reports a file name that is not NN.png', async () => {
    const project = await makeValidateProject(tmp.dir, ['watch-s10']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_WATCH_SERIES_10');
    await writeExportSet(dir, ['01.png', '02.png'], WATCH);
    await makeFlatPng(join(dir, 'home.png'), WATCH, [64, 64, 64]);

    const report = await validateExport(project, {});
    const problem = problemWith(report, 'file-name');
    expect(problem.level).toBe('error');
    expect(problem.file).toBe(join(dir, 'home.png'));
    expect(report.ok).toBe(false);
  });

  it('reports 11 files in one set', async () => {
    const project = await makeValidateProject(tmp.dir, ['watch-s10']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_WATCH_SERIES_10'), NAMES(11), WATCH);

    const report = await validateExport(project, {});
    expect(setFor(report, 'en-US', 'APP_WATCH_SERIES_10').count).toBe(11);
    expect(problemWith(report, 'set-too-many').level).toBe('error');
    expect(codes(report.problems)).not.toContain('file-gap');
    expect(report.ok).toBe(false);
  });

  it('reports an empty set', async () => {
    const project = await makeValidateProject(tmp.dir, ['watch-s10']);
    await mkdir(setDir(tmp.dir, 'en-US', 'APP_WATCH_SERIES_10'), { recursive: true });

    const report = await validateExport(project, {});
    expect(report.sets).toHaveLength(1);
    const set = setFor(report, 'en-US', 'APP_WATCH_SERIES_10');
    expect(set.count).toBe(0);
    expect(set.files).toEqual([]);
    expect(set.dims).toBeNull();
    expect(problemWith(report, 'set-empty').level).toBe('error');
    expect(report.ok).toBe(false);
  });

  it('rejects an alpha channel even when every pixel is opaque', async () => {
    const project = await makeValidateProject(tmp.dir, ['watch-s10']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_WATCH_SERIES_10');
    const opaque = await makeAlphaPng(join(dir, '01.png'), WATCH);
    await writeExportSet(dir, ['02.png'], WATCH);

    // The fixture must really be the awkward case: 4 channels, nothing transparent.
    const info = await pngInfo(opaque);
    expect(info).toMatchObject({ width: 416, height: 496, channels: 4, hasAlpha: true });

    const report = await validateExport(project, {});
    expect(codes(report.problems)).toEqual(['has-alpha']);
    const problem = problemWith(report, 'has-alpha');
    expect(problem.level).toBe('error');
    expect(problem.file).toBe(opaque);
    expect(report.ok).toBe(false);
  });

  it('rejects a pixel size the display type does not accept', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_IPHONE_69');
    const files = await writeExportSet(dir, NAMES(3), { width: 640, height: 1200 });

    const report = await validateExport(project, {});
    const problem = problemWith(report, 'dims-unaccepted');
    expect(problem.level).toBe('error');
    expect(files).toContain(must(problem.file, 'problem file'));
    expect(setFor(report, 'en-US', 'APP_IPHONE_69').dims).toEqual({ width: 640, height: 1200 });
    expect(report.ok).toBe(false);
  });

  it('rejects two accepted sizes mixed inside one set', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9']);
    const dir = setDir(tmp.dir, 'en-US', 'APP_IPHONE_69');
    await writeExportSet(dir, ['01.png', '03.png'], IPHONE_69);
    await makeFlatPng(join(dir, '02.png'), IPHONE_69_ALT, [90, 20, 40]);

    const report = await validateExport(project, {});
    expect(codes(report.problems)).toContain('dims-mixed');
    expect(codes(report.problems)).not.toContain('dims-unaccepted');
    expect(problemWith(report, 'dims-mixed').level).toBe('error');
    expect(setFor(report, 'en-US', 'APP_IPHONE_69').dims).toBeNull();
    expect(report.ok).toBe(false);
  });

  it('reports a locale that is missing a display type another locale has', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9', 'watch-s10']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), NAMES(3), IPHONE_69);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_WATCH_SERIES_10'), NAMES(2), WATCH);
    await writeExportSet(setDir(tmp.dir, 'de-DE', 'APP_WATCH_SERIES_10'), NAMES(2), WATCH);

    const report = await validateExport(project, {});
    expect([...report.locales].sort()).toEqual(['de-DE', 'en-US']);
    expect(report.sets).toHaveLength(3);
    expect(codes(report.problems)).toEqual(['locale-incomplete']);

    const problem = problemWith(report, 'locale-incomplete');
    expect(problem.level).toBe('error');
    expect(problem.message).toContain('de-DE');
    expect(problem.message).toContain('en-US');
    expect(problem.message).toContain('APP_IPHONE_69');
    expect(report.ok).toBe(false);
  });

  it('reports locale-incomplete even when --locale names one locale', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9', 'ipad-13']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), NAMES(3), IPHONE_69);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPAD_PRO_3GEN_129'), NAMES(3), IPAD_13);
    await writeExportSet(setDir(tmp.dir, 'de-DE', 'APP_IPHONE_69'), NAMES(3), IPHONE_69);

    const whole = await validateExport(project, {});
    expect(codes(whole.problems)).toEqual(['locale-incomplete']);
    expect(whole.ok).toBe(false);

    // The localize playbook runs exactly this form when it adds a language, so
    // it is the one run that must catch the half-finished new locale.
    const narrowed = await validateExport(project, { locale: 'de-DE' });
    expect(narrowed.locales).toEqual(['de-DE']);
    expect(narrowed.scanned).toEqual(['de-DE', 'en-US']);
    expect(narrowed.ok).toBe(false);

    const problem = problemWith(narrowed, 'locale-incomplete');
    expect(problem.level).toBe('error');
    expect(problem.scope).toBe('tree');
    expect(problem.message).toContain('APP_IPAD_PRO_3GEN_129');
    // The message names en-US, so it has to say why a de-DE run mentions it.
    expect(problem.message).toContain('sibling locale');
    expect(problem.message).toContain('--locale de-DE');

    // The narrowing still holds for everything that is not a cross-locale rule.
    expect(narrowed.sets.map((set) => set.locale)).toEqual(['de-DE']);
    expect(narrowed.sets.map((set) => set.displayType)).toEqual(['APP_IPHONE_69']);
    const text = validateText(narrowed);
    expect(text).toContain('every locale folder');
    expect(text).toContain('en-US');
  });

  it('reports a sibling locale that is behind, run from the complete locale', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9', 'ipad-13']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), NAMES(3), IPHONE_69);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPAD_PRO_3GEN_129'), NAMES(3), IPAD_13);
    await writeExportSet(setDir(tmp.dir, 'de-DE', 'APP_IPHONE_69'), NAMES(3), IPHONE_69);

    const narrowed = await validateExport(project, { locale: 'en-US' });
    const problem = problemWith(narrowed, 'locale-incomplete');
    expect(problem.message).toContain('de-DE');
    expect(problem.message).toContain('sibling locale');
    expect(narrowed.ok).toBe(false);
  });

  it('warns about sibling folders with identical dims and names the upload fan-out', async () => {
    const project = await makeValidateProject(tmp.dir, ['iphone-6.9', 'iphone-6.7']);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_69'), NAMES(3), IPHONE_69);
    await writeExportSet(setDir(tmp.dir, 'en-US', 'APP_IPHONE_67'), NAMES(3), IPHONE_69);

    const report = await validateExport(project, {});
    expect(report.sets).toHaveLength(2);
    expect(codes(report.problems)).toEqual(['duplicate-dims']);
    const problem = problemWith(report, 'duplicate-dims');
    expect(problem.level).toBe('warn');
    expect(problem.message).toContain('APP_IPHONE_69');
    expect(problem.message).toContain('APP_IPHONE_67');
    expect(problem.message).toMatch(/fans?[- ]?out/i);
    // A warning is not a blocker: the user may ship both sets deliberately.
    expect(report.ok).toBe(true);

    // --sizes narrows the sets in the report, never the trap: the fan-out
    // upload it warns about walks the whole tree.
    const narrowed = await validateExport(project, { sizes: ['iphone-6.9'] });
    expect(narrowed.sets).toHaveLength(1);
    expect(setFor(narrowed, 'en-US', 'APP_IPHONE_69').count).toBe(3);
    expect(codes(narrowed.problems)).toEqual(['duplicate-dims']);
    expect(narrowed.ok).toBe(true);
  });
});
