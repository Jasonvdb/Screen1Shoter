// Project fonts: <project>/fonts/* -> ProjectJson.fonts -> @font-face rules.
//
// Three pure pieces, all DOM-free so they run under Node:
//   parseFontFile(name)      file name -> family, weight, style, format
//   listProjectFonts(dir)    the directory scan (Vite plugin, Node fs)
//   projectFontCss(fonts)    the stylesheet main.tsx injects before mounting
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjectFonts } from '../../src/render/vite-plugin-s1s.ts';
import {
  FONT_EXTENSIONS,
  VARIABLE_WEIGHT,
  parseFontFile,
  projectFontCss,
  projectFontFamilies,
  projectFontUrl,
} from '../../src/web/runtime/fonts.ts';
import { makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

describe('parseFontFile', () => {
  it('reads Family-Weight from the regular convention', () => {
    expect(parseFontFile('Satoshi-Regular.woff2')).toEqual({
      file: 'Satoshi-Regular.woff2',
      family: 'Satoshi',
      weight: '400',
      style: 'normal',
      format: 'woff2',
    });
  });

  it('maps the weight words to numbers', () => {
    const weightOf = (name: string): string => must(parseFontFile(name)).weight;
    expect(weightOf('Satoshi-Thin.woff2')).toBe('100');
    expect(weightOf('Satoshi-ExtraLight.woff2')).toBe('200');
    expect(weightOf('Satoshi-Light.woff2')).toBe('300');
    expect(weightOf('Satoshi-Medium.woff2')).toBe('500');
    expect(weightOf('Satoshi-SemiBold.woff2')).toBe('600');
    expect(weightOf('Satoshi-Bold.woff2')).toBe('700');
    expect(weightOf('Satoshi-ExtraBold.woff2')).toBe('800');
    expect(weightOf('Satoshi-Black.woff2')).toBe('900');
  });

  it('reads the italic suffix, with and without a weight', () => {
    expect(parseFontFile('Satoshi-BoldItalic.woff2')).toMatchObject({
      family: 'Satoshi',
      weight: '700',
      style: 'italic',
    });
    expect(parseFontFile('Satoshi-Italic.otf')).toMatchObject({
      family: 'Satoshi',
      weight: '400',
      style: 'italic',
      format: 'opentype',
    });
  });

  it('gives a variable font the whole weight range, glued or separated', () => {
    expect(parseFontFile('InterVariable.woff2')).toMatchObject({
      family: 'Inter',
      weight: VARIABLE_WEIGHT,
      style: 'normal',
    });
    expect(parseFontFile('Inter-Variable.ttf')).toMatchObject({
      family: 'Inter',
      weight: '100 900',
      style: 'normal',
      format: 'truetype',
    });
    expect(parseFontFile('InterVariable-Italic.woff2')).toMatchObject({
      family: 'Inter',
      weight: '100 900',
      style: 'italic',
    });
  });

  it('keeps the whole stem as the family when the suffix names no weight', () => {
    expect(parseFontFile('Cabinet-Grotesk.woff2')).toMatchObject({
      family: 'Cabinet-Grotesk',
      weight: '400',
      style: 'normal',
    });
    expect(parseFontFile('Satoshi.woff')).toMatchObject({ family: 'Satoshi', weight: '400', format: 'woff' });
  });

  it('splits at the first separator that names a face, not the last', () => {
    expect(parseFontFile('SF-Pro-Display-Bold.woff2')).toMatchObject({ family: 'SF-Pro-Display', weight: '700' });
    expect(parseFontFile('Satoshi-Bold-Italic.woff2')).toMatchObject({
      family: 'Satoshi',
      weight: '700',
      style: 'italic',
    });
  });

  it('rejects anything that is not a font file', () => {
    expect(parseFontFile('LICENSE.txt')).toBeNull();
    expect(parseFontFile('Satoshi-Bold.png')).toBeNull();
    expect(parseFontFile('Satoshi-Bold')).toBeNull();
    expect(parseFontFile('.woff2')).toBeNull();
  });
});

describe('listProjectFonts', () => {
  let temp: TempDir;

  beforeEach(async () => {
    temp = await makeTempDir('s1s-fonts-');
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it('returns an empty list when the fonts directory is absent', async () => {
    await expect(listProjectFonts(temp.dir)).resolves.toEqual([]);
  });

  it('returns an empty list when fonts is a file, not a directory', async () => {
    await writeFile(join(temp.dir, 'fonts'), 'not a directory\n');
    await expect(listProjectFonts(temp.dir)).resolves.toEqual([]);
  });

  it('lists every font file, sorted, ignoring other files and subdirectories', async () => {
    const dir = join(temp.dir, 'fonts');
    await mkdir(join(dir, 'sources'), { recursive: true });
    for (const name of ['Satoshi-Bold.woff2', 'Satoshi-Regular.woff2', 'Satoshi-Regular.woff', 'OFL.txt']) {
      await writeFile(join(dir, name), '');
    }
    await writeFile(join(dir, 'sources', 'Satoshi-Black.woff2'), '');

    const fonts = await listProjectFonts(temp.dir);
    // The .woff sorts before its .woff2, so the .woff2 rule is declared last and wins.
    expect(fonts.map((font) => font.file)).toEqual([
      'Satoshi-Bold.woff2',
      'Satoshi-Regular.woff',
      'Satoshi-Regular.woff2',
    ]);
    expect(projectFontFamilies(fonts)).toEqual(['Satoshi']);
  });

  it('accepts every extension it advertises', async () => {
    const dir = join(temp.dir, 'fonts');
    await mkdir(dir, { recursive: true });
    for (const ext of FONT_EXTENSIONS) await writeFile(join(dir, `Satoshi-Bold${ext}`), '');

    const fonts = await listProjectFonts(temp.dir);
    expect(fonts).toHaveLength(FONT_EXTENSIONS.length);
    expect(fonts.map((font) => font.format).sort()).toEqual(['opentype', 'truetype', 'woff', 'woff2']);
  });
});

describe('projectFontCss', () => {
  it('writes one well-formed @font-face per font', () => {
    const fonts = [must(parseFontFile('Satoshi-BoldItalic.woff2')), must(parseFontFile('InterVariable.woff2'))];
    const css = projectFontCss(fonts);

    expect(css).toContain("@font-face {\n  font-family: 'Satoshi';");
    expect(css).toContain("src: url('/project/fonts/Satoshi-BoldItalic.woff2') format('woff2');");
    expect(css).toContain('font-weight: 700;');
    expect(css).toContain('font-style: italic;');
    expect(css).toContain('font-weight: 100 900;');
    expect(css.match(/@font-face \{/g)).toHaveLength(2);
    expect(css.match(/font-display: block;/g)).toHaveLength(2);
    // Every block is closed: as many '{' as '}'.
    expect(css.match(/\{/g)).toHaveLength(must(css.match(/\}/g)).length);
  });

  it('percent-encodes the url and escapes the family name', () => {
    expect(projectFontUrl("Cabinet Grotesk's #2.woff2")).toBe('/project/fonts/Cabinet%20Grotesk\'s%20%232.woff2');

    const css = projectFontCss([must(parseFontFile("Cabinet Grotesk's-Bold.woff2"))]);
    expect(css).toContain("font-family: 'Cabinet Grotesk\\'s';");
    expect(css).toContain("url('/project/fonts/Cabinet%20Grotesk\\'s-Bold.woff2')");
  });

  it('is empty for a project with no fonts', () => {
    expect(projectFontCss([])).toBe('');
    expect(projectFontFamilies([])).toEqual([]);
  });
});
