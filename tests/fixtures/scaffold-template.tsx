// The template example quoted in templates/init/templates/index.ts and
// example/screenshots/templates/index.ts. tsconfig.web.json type-checks this
// file; tests/unit/scaffold-template.test.ts asserts the two comment blocks
// quote it verbatim, so the scaffold can never document an API that does not
// exist.
import { DeviceFrame, Headline, defineTemplate, layoutScale } from 'screen1shoter';

export default [
  defineTemplate({
    id: 'my-template',
    families: ['iphone', 'ipad'],
    Component: ({ screen, preset, theme, copy }) => {
      const s = layoutScale(preset); // 1 at 440 pt (iPhone) / 1032 pt (iPad)
      return (
        // A flex column with a definite height: DeviceFrame fills the slot the text leaves.
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 40 * s, gap: 20 * s }}>
          <Headline text={copy?.headline ?? ''} theme={theme} locale={screen.locale} minPt={28 * s} maxPt={46 * s} />
          <DeviceFrame captures={screen.captures} preset={preset} theme={theme} maxWidth={preset.pt.width * 0.8} />
        </div>
      );
    },
  }),
];
