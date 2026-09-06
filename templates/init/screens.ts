// Screens of this App Store set. Data only: Node reads it for the render
// matrix, the browser reads it for the templates.
//
// Each screen needs a capture at captures/<locale>/<family>/<id>.png (or the
// name given in `capture`) and copy in copy/<locale>.json under `screens.<id>`.
// The order here is the App Store order (the NN prefix of the output files).
import { defineScreens } from 'screen1shoter/config';

export default defineScreens({
  sizes: ['iphone-6.9', 'ipad-13'], // {{sizes}}
  locales: ['en-US'], // {{locales}}
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
    // More built-in templates (worked examples in example/screenshots/screens.ts):
    //   two-device:   `template: 'two-device', capture: ['home', 'detail']` (two captures, one frame pair).
    //   feature-grid: iPad only. Keep an iPhone template as the base and switch per family:
    //                 `overrides: { ipad: { template: 'feature-grid' } }`; the copy entry needs
    //                 1-3 `callouts: [{ title, body }]`.
    // {{watch:start}}
    {
      id: 'watch-stats',
      only: ['watch'],
      notes: 'Raw 416x496 watch capture: no frame, no text (template "raw").',
    },
    // {{watch:end}}
  ],
});
