// The hero-top-text layout with an Apple Watch standing in front of the
// phone's lower right corner: the pairing shot that tells an iPhone or iPad
// shopper the app has a watch app, on a carousel frame they will actually see.
//
// Needs `capture: [<phone>, 'watch-s10:<watch>']` in screens.ts. The prefix is
// what sends the second ref to the watch preset, so it is read from
// captures/<locale>/watch/ and checked against 416x496 rather than the
// phone's own dimensions; without it the ref would look for a phone-sized file
// in the watch directory.
//
// Compliance: both devices are whole, upright and un-cropped inside their real
// Apple bezels and the copy stays beside them, so this is a compliant
// template. Apple's rule bans cropping and tilting a product image, not
// standing two products together, which is what its own material does.
import { SIZE_PRESETS } from '../../config/presets.ts';
import { PHONE_WATCH_IPAD_VARIANT } from '../../config/template-meta.ts';
import type { CaptureSource } from '../../config/types.ts';
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { FitBox } from '../components/FitBox.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { deviceAspect } from '../hooks/bezel.ts';
import { useBezel } from '../hooks/useBezel.ts';
import { placeholderCapture } from '../hooks/useCapture.ts';
import { FramedColumn, FramedText, framedAlign, framedDeviceMaxWidth, framedFamily, LAYOUT } from './hero-top-text.tsx';
import { WATCH, watchBox } from './phone-watch-layout.ts';

export { EDGE_MARGIN, WATCH, watchBox } from './phone-watch-layout.ts';
export type { PhoneWatchFamily, WatchBox, WatchPlacement } from './phone-watch-layout.ts';

export const WATCH_PRESET_ID = 'watch-s10';


/**
 * `props.watchVariant` names the case and band, e.g.
 * 'aluminum-jet-black-sport-band-black'. A watch shares no colour name with a
 * phone, so a project's single `theme.bezelVariant` never matches one and the
 * fallback is whichever variant installed first; name it here instead.
 * `s1s bezels list` prints the installed variants.
 */
export function watchVariantOf(props: TemplateProps): string | undefined {
  const value = props.screen.props['watchVariant'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function PhoneWatchScreen(props: TemplateProps) {
  const { screen, preset, theme } = props;
  const family = framedFamily(props);
  const layout = LAYOUT[family];
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);

  const watchPreset = SIZE_PRESETS[WATCH_PRESET_ID];
  const watchVariant = watchVariantOf(props);
  // Geometry only; each DeviceFrame picks the same bezel itself.
  const phoneBezel = useBezel(preset, theme);
  const watchBezel = useBezel(watchPreset, theme, { variant: watchVariant ?? 'auto' });

  const captures: [CaptureSource, CaptureSource] = [
    screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale),
    screen.captures[1] ?? placeholderCapture(`${screen.id}-watch`, 'watch', screen.locale),
  ];
  // No second capture listed: `s1s capture --name <id>-watch` would write a
  // file nobody reads, and the fix is a screens.ts edit.
  const watchHint =
    screen.captures[1] === undefined
      ? `add capture: ['${screen.captures[0]?.requested ?? screen.id}', '${WATCH_PRESET_ID}:<watch capture>'] to screens.ts`
      : undefined;

  // The phone box must be the one hero-top-text would produce, so the row is
  // measured the same way: FitBox's fitInto and DeviceFrame's frameBox agree.
  const phoneTop = px(layout.padTop) + px(layout.textHeight) + px(layout.gap);
  const maxWidth = Math.round(framedDeviceMaxWidth(props, layout) * preset.pt.width);

  let devices = <div style={{ flex: '1 1 0px' }} />;
  if (phoneBezel.status === 'ready' && watchBezel.status === 'ready') {
    const watchAspect = deviceAspect(watchBezel.geometry);
    devices = (
      <FitBox aspect={deviceAspect(phoneBezel.geometry)} maxWidth={maxWidth} align="start">
        {(size) => {
          const box = watchBox(WATCH[family], size, phoneTop, preset.pt, watchAspect);
          return (
            <div data-s1s-id="devices" style={{ position: 'absolute', inset: 0 }}>
              <DeviceFrame captures={[captures[0]]} preset={preset} theme={theme} fit={{ width: size.width }} />
              <DeviceFrame
                captures={[captures[1]]}
                preset={watchPreset}
                theme={theme}
                variant={watchVariant ?? 'auto'}
                fit={{ width: box.width }}
                captureHint={watchHint}
                style={{ position: 'absolute', left: box.left, top: box.top, zIndex: 3 }}
              />
            </div>
          );
        }}
      </FitBox>
    );
  }

  return (
    <FramedColumn props={props} layout={layout}>
      <FramedText props={props} layout={layout} align={framedAlign(props)} />
      {devices}
    </FramedColumn>
  );
}

const phoneWatch: TemplateModule = {
  id: 'phone-watch',
  families: ['iphone', 'ipad'],
  ipadVariant: PHONE_WATCH_IPAD_VARIANT,
  compliant: true,
  Component: (props) => <PhoneWatchScreen {...props} />,
};

export default phoneWatch;
