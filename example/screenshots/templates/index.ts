// Custom templates for this project (optional). Export an array of
// TemplateModule objects. An id equal to a built-in template overrides it.
//
// Put JSX templates in .tsx files next to this one and list them here. The
// runtime wraps every template in the Canvas (theme background, size and
// the data-s1s-canvas id), so a template returns plain content:
//
//   import { DeviceFrame, FitBox, Headline, defineTemplate, layoutScale, useBezel } from 'screen1shoter';
//   export default [
//     defineTemplate({
//       id: 'my-template',
//       families: ['iphone', 'ipad'],
//       Component: ({ screen, preset, theme, copy }) => {
//         const s = layoutScale(preset); // 1 at 440 pt (iPhone) / 1032 pt (iPad)
//         const bezel = useBezel(preset, theme);
//         return (
//           <>
//             <Headline text={copy?.headline ?? ''} theme={theme} locale={screen.locale} minPt={28 * s} maxPt={46 * s} />
//             {bezel.status === 'ready' && screen.captures[0] ? (
//               <FitBox aspect={bezel.geometry.deviceRect.width / bezel.geometry.deviceRect.height} maxWidth={preset.pt.width * 0.8}>
//                 {(size) => <DeviceFrame capture={screen.captures[0]} bezel={bezel} width={size.width} />}
//               </FitBox>
//             ) : null}
//           </>
//         );
//       },
//     }),
//   ];
import type { TemplateModule } from 'screen1shoter';

export default [] as TemplateModule[];
