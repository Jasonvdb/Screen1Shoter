// defineTheme: defaults, and `fonts.portable` forcing the bundled Inter stack.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY_FONT, DEFAULT_HEADLINE_FONT, PORTABLE_FONT, defineTheme, resolveFonts } from '../../src/config/types.ts';

const base = { background: '#000000', accent: '#ff0000', text: '#ffffff' };

describe('defineTheme fonts', () => {
  it('uses the system-first default stacks when fonts are omitted', () => {
    const theme = defineTheme(base);
    expect(theme.fonts).toEqual({ headline: DEFAULT_HEADLINE_FONT, body: DEFAULT_BODY_FONT });
  });

  it('keeps custom stacks when portable is not set', () => {
    const fonts = { headline: '"SF Pro Display", sans-serif', body: '"SF Pro Text", sans-serif' };
    expect(defineTheme({ ...base, fonts }).fonts).toEqual(fonts);
  });

  it('portable: true replaces both stacks with the bundled Inter (identical output on every machine)', () => {
    const fonts = { headline: '"SF Pro Display", sans-serif', body: '"SF Pro Text", sans-serif', portable: true };
    const theme = defineTheme({ ...base, fonts });
    expect(theme.fonts).toEqual({ headline: PORTABLE_FONT, body: PORTABLE_FONT, portable: true });
    expect(resolveFonts(fonts)).toEqual(theme.fonts);
  });
});
