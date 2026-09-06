import { defineTheme, PORTABLE_FONT } from '../../../../src/config/index.ts';

export default defineTheme({
  background: '#0b0f14',
  accent: '#b5ff3d',
  text: '#ffffff',
  textMuted: '#9aa4b2',
  fonts: { headline: PORTABLE_FONT, body: PORTABLE_FONT, portable: true },
  headlineCase: 'title',
  bezelVariant: 'auto',
});
