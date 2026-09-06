// Screens of this App Store set. Data only: Node reads it for the render
// matrix, the browser reads it for the templates.
//
// Each screen needs a capture at captures/<locale>/<family>/<id>.png (or the
// name given in `capture`) and copy in copy/<locale>.json under `screens.<id>`.
// The order here is the App Store order (the NN prefix of the output files).
import { defineScreens } from 'screen1shoter/config';

export default defineScreens({
  sizes: ['iphone-6.9', 'ipad-13'],
  locales: ['en-US'],
  screens: [
    {
      id: 'home',
      template: 'hero-top-text',
      only: ['iphone', 'ipad'],
      notes: 'The biggest reason to download. Headline on top, whole device below.',
    },
    {
      id: 'detail',
      template: 'text-bottom',
      only: ['iphone', 'ipad'],
      notes: 'The core loop. Device on top, headline below.',
    },
    {
      id: 'share',
      template: 'hero-top-text',
      only: ['iphone', 'ipad'],
      notes: 'A differentiator. Uses the optional badge from the copy.',
    },
    {
      id: 'features',
      template: 'hero-top-text',
      overrides: { ipad: { template: 'feature-grid' } },
      only: ['iphone', 'ipad'],
      notes: 'Three benefits at once. iPhone: hero-top-text; iPad: feature-grid with the callout cards from the copy.',
    },
    {
      id: 'compare',
      template: 'two-device',
      capture: ['home', 'detail'],
      only: ['iphone', 'ipad'],
      notes: 'Two captures in one frame pair (reuses home and detail), overlapped with the front device lower; props.arrangement: "side" would put them side by side.',
    },
  ],
});
