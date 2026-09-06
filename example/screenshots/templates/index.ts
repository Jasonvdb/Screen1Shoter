// Custom templates for this project (optional). Export an array of
// TemplateModule objects. An id equal to a built-in template overrides it.
//
// Put JSX templates in .tsx files next to this one and list them here. The
// runtime wraps every template in the Canvas (theme background, size and
// the data-s1s-canvas id), so a template returns plain content. A complete
// example (a .tsx file, type-checked in the tool's own test suite):
//
//   import { DeviceFrame, Headline, defineTemplate, layoutScale } from 'screen1shoter';
//
//   export default [
//     defineTemplate({
//       id: 'my-template',
//       families: ['iphone', 'ipad'],
//       Component: ({ screen, preset, theme, copy }) => {
//         const s = layoutScale(preset); // 1 at 440 pt (iPhone) / 1032 pt (iPad)
//         return (
//           // A flex column with a definite height: DeviceFrame fills the slot the text leaves.
//           <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 40 * s, gap: 20 * s }}>
//             <Headline text={copy?.headline ?? ''} theme={theme} locale={screen.locale} minPt={28 * s} maxPt={46 * s} />
//             <DeviceFrame captures={screen.captures} preset={preset} theme={theme} maxWidth={preset.pt.width * 0.8} />
//           </div>
//         );
//       },
//     }),
//   ];
import type { TemplateModule } from 'screen1shoter';

export default [] as TemplateModule[];
