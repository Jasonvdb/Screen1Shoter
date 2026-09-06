// Two captures in two upright devices, text block on top. Both families
// overlap the devices with the front one lower ('stack'): the offset clears
// the back device's Dynamic Island and status bar, and at least half of the
// back device stays visible. `props.arrangement: 'side'` puts them side by
// side at equal scale instead. Needs `capture: [a, b]` in screens.ts
// (loadProject enforces it); the browser still renders a hint panel for a
// missing second capture. `TextBlock` (badge, headline, subline in a
// fixed-height slot) is shared with feature-grid.
import type { CSSProperties } from 'react';
import { TWO_DEVICE_IPAD_VARIANT } from '../../config/template-meta.ts';
import type { CaptureSource, SizePreset, Theme } from '../../config/types.ts';
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { Badge } from '../components/Badge.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { Caption } from '../components/Caption.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { FitBox } from '../components/FitBox.tsx';
import { Headline } from '../components/Headline.tsx';
import { useBezel, type ReadyBezel } from '../hooks/useBezel.ts';
import { placeholderCapture } from '../hooks/useCapture.ts';
import { LAYOUT, stackGeometry, type Arrangement, type TextLayout, type TwoDeviceFamily, type TwoDeviceLayout } from './two-device-layout.ts';

export { LAYOUT } from './two-device-layout.ts';
export type { Arrangement, TextLayout, TwoDeviceFamily, TwoDeviceLayout } from './two-device-layout.ts';

export type TextAlign = 'left' | 'center';

/** `props.align: 'left'` left-aligns the text block; default centred. */
export function textAlignOf(props: TemplateProps): TextAlign {
  return props.screen.props['align'] === 'left' ? 'left' : 'center';
}

export interface TextBlockProps {
  props: TemplateProps;
  layout: TextLayout;
  align: TextAlign;
}

/** Badge, headline and subline in a fixed-height slot; `[copy missing]` when the copy is absent. */
export function TextBlock({ props, layout, align }: TextBlockProps) {
  const { screen, preset, theme, copy } = props;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  return (
    <div
      data-s1s-slot=""
      data-s1s-id="text"
      style={{
        flex: 'none',
        height: px(layout.textHeight),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: px(layout.textGap),
        textAlign: align,
      }}
    >
      {copy?.badge ? <Badge text={copy.badge} theme={theme} fontSize={px(layout.badge)} /> : null}
      <Headline
        text={copy?.headline ?? `[copy missing: ${screen.copyKey}]`}
        highlight={copy?.highlight}
        theme={theme}
        locale={screen.locale}
        minPt={px(layout.headline.min)}
        maxPt={px(layout.headline.max)}
        maxLines={layout.headline.maxLines}
        align={align}
      />
      {copy?.subline ? (
        <Caption
          text={copy.subline}
          theme={theme}
          minPt={px(layout.subline.min)}
          maxPt={px(layout.subline.max)}
          maxLines={layout.subline.maxLines}
          align={align}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// two-device
// ---------------------------------------------------------------------------

export function twoDeviceFamily(props: TemplateProps): TwoDeviceFamily {
  return props.preset.family === 'ipad' ? 'ipad' : 'iphone';
}

/** `props.arrangement: 'side' | 'stack'`; default from the family layout. */
export function arrangementOf(props: TemplateProps, layout: TwoDeviceLayout): Arrangement {
  const value = props.screen.props['arrangement'];
  return value === 'side' || value === 'stack' ? value : layout.arrangement;
}

interface PairProps {
  bezel: ReadyBezel;
  captures: [CaptureSource, CaptureSource];
  layout: TwoDeviceLayout;
  preset: SizePreset;
  theme: Theme;
  /** Shown in the second frame when screens.ts lists only one capture. */
  secondHint: string | undefined;
}

/** Two devices in a row; the pair is one fixed-aspect box so both scale together. */
function SideBySide({ bezel, captures, layout, preset, theme, secondHint }: PairProps) {
  const { deviceRect } = bezel.geometry;
  const aspect = deviceRect.width / deviceRect.height;
  const units = 2 + layout.deviceGap; // pair width in device widths
  return (
    <FitBox aspect={units * aspect} maxWidth={Math.round(layout.pairWidth * preset.pt.width)} align="center">
      {(size) => {
        const width = Math.floor(size.width / units);
        return (
          <div data-s1s-id="devices" style={{ display: 'flex', justifyContent: 'space-between', width: size.width, height: size.height }}>
            <DeviceFrame captures={[captures[0]]} preset={preset} theme={theme} fit={{ width }} />
            <DeviceFrame captures={[captures[1]]} preset={preset} theme={theme} fit={{ width }} captureHint={secondHint} />
          </div>
        );
      }}
    </FitBox>
  );
}

/** Overlapped devices spanning the content width; the front one is offset down. */
function Stacked({ bezel, captures, layout, preset, theme, secondHint, front, s }: PairProps & { front: 'left' | 'right'; s: number }) {
  const { deviceRect } = bezel.geometry;
  const { pairWidth, deviceWidth, shiftX, offsetY, pairHeight } = stackGeometry(layout, preset.pt, s, deviceRect.width / deviceRect.height);
  return (
    <FitBox aspect={pairWidth / pairHeight} maxWidth={pairWidth} align="start">
      {(size) => {
        const r = size.width / pairWidth; // 1 unless the slot is too short
        const width = Math.floor(deviceWidth * r);
        const place = (side: 'left' | 'right'): CSSProperties => ({
          position: 'absolute',
          left: side === 'left' ? 0 : Math.round(shiftX * r),
          top: side === front ? Math.round(offsetY * r) : 0,
          zIndex: side === front ? 2 : 1,
        });
        return (
          <div data-s1s-id="devices" style={{ position: 'absolute', inset: 0 }}>
            <DeviceFrame captures={[captures[0]]} preset={preset} theme={theme} fit={{ width }} style={place('left')} />
            <DeviceFrame captures={[captures[1]]} preset={preset} theme={theme} fit={{ width }} style={place('right')} captureHint={secondHint} />
          </div>
        );
      }}
    </FitBox>
  );
}

function TwoDeviceScreen(props: TemplateProps) {
  const { screen, preset, theme } = props;
  const layout = LAYOUT[twoDeviceFamily(props)];
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  // Geometry only: DeviceFrame picks the same bezel itself.
  const bezel = useBezel(preset, theme);
  const front = screen.props['front'] === 'left' ? 'left' : 'right';
  const captures: [CaptureSource, CaptureSource] = [
    screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale),
    screen.captures[1] ?? placeholderCapture(`${screen.id}-2`, preset.family, screen.locale),
  ];
  // No second capture listed: `s1s capture --name compare-2` would write a file nobody reads.
  const secondHint =
    screen.captures[1] === undefined ? `add capture: ['${screen.captures[0]?.requested ?? screen.id}', '<other>'] to screens.ts` : undefined;

  let devices = <div style={{ flex: '1 1 0px' }} />;
  if (bezel.status === 'ready') {
    const pair = { bezel, captures, layout, preset, theme, secondHint };
    devices = arrangementOf(props, layout) === 'side' ? <SideBySide {...pair} /> : <Stacked {...pair} front={front} s={s} />;
  }

  return (
    <>
      <Background spec={backgroundSpecFrom(screen.props['background'], theme.background)} />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: px(layout.gap),
          padding: `${px(layout.padTop)}px ${px(layout.padX)}px ${px(layout.padBottom)}px`,
        }}
      >
        <TextBlock props={props} layout={layout} align={textAlignOf(props)} />
        {devices}
      </div>
    </>
  );
}

const twoDevice: TemplateModule = {
  id: 'two-device',
  families: ['iphone', 'ipad'],
  ipadVariant: TWO_DEVICE_IPAD_VARIANT,
  compliant: true,
  Component: (props) => <TwoDeviceScreen {...props} />,
};

export default twoDevice;
