// Project fonts: <project>/fonts/*.woff2|woff|ttf|otf become @font-face rules.
//
// The file name is the only face description app repos ship, so it is parsed
// here: `Family-Weight[Italic].ext` (Satoshi-BoldItalic.woff2 -> Satoshi, 700,
// italic) or a variable font `Family[-Variable].ext` (InterVariable.woff2 ->
// Inter, weight range 100 900). Nothing recognised after a separator means the
// whole stem is the family at 400 normal, so an unusual name still registers.
//
// DOM-free on purpose: the Vite plugin lists the files under Node
// (listProjectFonts), main.tsx injects the stylesheet in the browser, and
// tests/unit/project-fonts.test.ts exercises both from Node.
import type { ProjectFont } from '../../config/types.ts';

const FORMATS: Record<string, ProjectFont['format']> = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
};

/** Extensions the fonts directory scan accepts, lower-case and dotted. */
export const FONT_EXTENSIONS: readonly string[] = Object.keys(FORMATS);

const WEIGHTS: Record<string, string> = {
  thin: '100',
  hairline: '100',
  extralight: '200',
  ultralight: '200',
  light: '300',
  regular: '400',
  normal: '400',
  book: '400',
  medium: '500',
  semibold: '600',
  demibold: '600',
  bold: '700',
  extrabold: '800',
  ultrabold: '800',
  black: '900',
  heavy: '900',
};

/** A variable file covers the whole axis, and CSS wants the range, not a value. */
export const VARIABLE_WEIGHT = '100 900';

const VARIABLE_RE = /^(.+?)[-_ ]?variable[-_ ]?(italic)?$/i;

interface Face {
  weight: string;
  style: ProjectFont['style'];
}

/** 'BoldItalic' -> 700 italic, 'Italic' -> 400 italic; undefined when it names no weight. */
function faceOf(suffix: string): Face | undefined {
  const italic = /italic$/i.test(suffix);
  const word = (italic ? suffix.slice(0, -'italic'.length) : suffix).replace(/[-_ ]/g, '').toLowerCase();
  const style: ProjectFont['style'] = italic ? 'italic' : 'normal';
  if (word === '') return italic ? { weight: '400', style } : undefined;
  const weight = WEIGHTS[word];
  return weight === undefined ? undefined : { weight, style };
}

/** Interior '-' and '_' positions, left to right. */
function separators(stem: string): number[] {
  const out: number[] = [];
  for (let i = 1; i < stem.length - 1; i += 1) {
    const ch = stem[i];
    if (ch === '-' || ch === '_') out.push(i);
  }
  return out;
}

/** One entry per font file, or null when the extension is not a font. */
export function parseFontFile(file: string): ProjectFont | null {
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;
  const format = FORMATS[file.slice(dot).toLowerCase()];
  if (format === undefined) return null;
  const stem = file.slice(0, dot);

  const variable = VARIABLE_RE.exec(stem);
  if (variable?.[1] !== undefined) {
    const style: ProjectFont['style'] = variable[2] === undefined ? 'normal' : 'italic';
    return { file, family: variable[1], weight: VARIABLE_WEIGHT, style, format };
  }

  // Left to right, so 'SF-Pro-Display-Bold' keeps the family 'SF-Pro-Display'
  // and 'Satoshi-Bold-Italic' still resolves to one bold italic face.
  for (const at of separators(stem)) {
    const face = faceOf(stem.slice(at + 1));
    if (face) return { file, family: stem.slice(0, at), weight: face.weight, style: face.style, format };
  }
  return { file, family: stem, weight: '400', style: 'normal', format };
}

/** '/project/fonts/<file>', segments percent-encoded like Background.tsx's assetUrl. */
export function projectFontUrl(file: string): string {
  return `/project/${`fonts/${file}`.split('/').map(encodeURIComponent).join('/')}`;
}

function cssString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * One @font-face per file, in the order given. Two files describing the same
 * face (a .woff next to its .woff2) both register and the later rule wins, so
 * the scan's alphabetical order leaves the .woff2 in charge.
 */
export function projectFontCss(fonts: readonly ProjectFont[]): string {
  return fonts
    .map((font) =>
      [
        '@font-face {',
        `  font-family: ${cssString(font.family)};`,
        `  src: url(${cssString(projectFontUrl(font.file))}) format(${cssString(font.format)});`,
        `  font-weight: ${font.weight};`,
        `  font-style: ${font.style};`,
        // The settle loop force-loads every family through document.fonts.load()
        // before the screenshot, so blocking never costs a frame of fallback.
        '  font-display: block;',
        '}',
      ].join('\n'),
    )
    .join('\n\n');
}

/** Distinct families in file order — the extra stacks the settle loop force-loads. */
export function projectFontFamilies(fonts: readonly ProjectFont[]): string[] {
  return [...new Set(fonts.map((font) => font.family))];
}
