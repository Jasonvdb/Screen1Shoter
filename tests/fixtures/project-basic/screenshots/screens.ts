// Fixture project: three iPhone screens (6.9" + 6.7" alias), three iPad
// screens and one watch passthrough screen. Real projects import from
// 'screen1shoter/config'; inside this repo the tests import relatively.
import { defineScreens } from '../../../../src/config/index.ts';

export default defineScreens({
  sizes: ['iphone-6.9', 'iphone-6.7', 'ipad-13', 'watch-s10'],
  locales: ['en-US'],
  screens: [
    {
      id: 'home',
      only: ['iphone', 'ipad'],
      notes: 'Hero shot.',
    },
    {
      id: 'detail',
      only: ['iphone', 'ipad'],
      template: 'text-bottom',
      capture: { iphone: 'detail-phone', ipad: 'detail-pad' },
      copyKey: 'details',
      props: { align: 'left', accentBar: true },
      overrides: {
        iphone: { props: { align: 'center' } },
        'iphone-6.9': { props: { accentBar: false } },
      },
      locales: {
        'de-DE': { props: { align: 'right' } },
      },
    },
    {
      id: 'pocket',
      only: ['iphone'],
    },
    {
      id: 'tablet-split',
      only: ['ipad'],
      // 'feature-grid' once W2 ships it; text-bottom keeps the fixture renderable.
      template: 'text-bottom',
    },
    {
      id: 'glance',
      only: ['watch'],
    },
  ],
});
