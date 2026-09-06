// Brand colours and type for every screen. Colours must be sRGB hex; the
// background also flattens any transparency in post-processing.
import { defineTheme } from 'screen1shoter/config';

export default defineTheme({
  background: '#0B0F19',
  accent: '#6C8CFF',
  text: '#FFFFFF',
  textMuted: '#A9B1C6',
  headlineCase: 'title', // 'title' | 'sentence' | 'upper'
  // highlight: '#6C8CFF',   // colour of the `highlight` word (default: accent)
  // headlineWeight: 700,
  // bezelVariant: 'auto',   // e.g. 'deep-blue'; 'auto' = first installed variant
  // radius: 16,             // pt, for cards and badges
  // fonts: { headline: '"SF Pro Display", sans-serif', body: '"SF Pro Text", sans-serif', portable: true },
});
