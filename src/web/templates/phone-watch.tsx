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
// Which Apple Watch stands there follows from that same prefix: the watch
// size's `preset.bezel`. `watch-ultra:<watch>` asks for an Ultra 3 frame and a
// real 422x514 Ultra capture to go in it. To keep one watch capture and change
// only the frame, name the bezel instead: `props.watchBezel:
// 'apple-watch-ultra-3'`. The capture is drawn `object-fit: cover`, so a frame
// whose cut-out has a slightly different aspect crops the capture rather than
// stretching the app UI. `s1s bezels list` shows what is installed, and the
// Ultra bezel is not part of the default install: run
// `s1s bezels install --device apple-watch-ultra-3` once.
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
import { WATCH, watchBox, watchSizeId } from './phone-watch-layout.ts';

export { DEFAULT_WATCH_SIZE_ID, EDGE_MARGIN, WATCH, watchBox, watchSizeId } from './phone-watch-layout.ts';
export type { PhoneWatchFamily, WatchBox, WatchPlacement } from './phone-watch-layout.ts';

function stringProp(props: TemplateProps, name: string): string | undefined {
  const value = props.screen.props[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * `props.watchVariant` names the case and band, e.g.
 * 'aluminum-jet-black-sport-band-black'. A watch shares no colour name with a
 * phone, so a project's single `theme.bezelVariant` never matches one and the
 * fallback is whichever variant installed first; name it here instead.
 * `s1s bezels list` prints the installed variants.
 */
export function watchVariantOf(props: TemplateProps): string | undefined {
  return stringProp(props, 'watchVariant');
}

/**
 * `props.watchBezel` names the frame only: any watch bezel id from
 * `s1s bezels list`, such as 'apple-watch-ultra-3' for a fitness app or
 * 'apple-watch-series-11-42mm' for the smaller case. The capture keeps the
 * size its ref asks for. Leaving it out uses the watch size's own
 * `preset.bezel`, and naming an id that is not installed falls back to that
 * with a `bezel-fallback` warning saying which id was missing.
 */
export function watchBezelOf(props: TemplateProps): string | undefined {
  return stringProp(props, 'watchBezel');
}

function PhoneWatchScreen(props: TemplateProps) {
  const { screen, preset, theme } = props;
  const family = framedFamily(props);
  const layout = LAYOUT[family];
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);

  // The prefix on the second capture ref picks the watch size, and with it
  // the frame; props.watchBezel overrides the frame alone.
  const watchPreset = SIZE_PRESETS[watchSizeId(screen.captures[1]?.requested)];
  const watchVariant = watchVariantOf(props);
  const watchBezelId = watchBezelOf(props);
  // Geometry only; each DeviceFrame picks the same bezel itself.
  const phoneBezel = useBezel(preset, theme);
  const watchBezel = useBezel(watchPreset, theme, { bezelId: watchBezelId, variant: watchVariant ?? 'auto' });

  const captures: [CaptureSource, CaptureSource] = [
    screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale),
    screen.captures[1] ?? placeholderCapture(`${screen.id}-watch`, 'watch', screen.locale),
  ];
  // No second capture listed: `s1s capture --name <id>-watch` would write a
  // file nobody reads, and the fix is a screens.ts edit.
  const watchHint =
    screen.captures[1] === undefined
      ? `add capture: ['${screen.captures[0]?.requested ?? screen.id}', '${watchPreset.id}:<watch capture>'] to screens.ts`
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
                bezelId={watchBezelId}
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
