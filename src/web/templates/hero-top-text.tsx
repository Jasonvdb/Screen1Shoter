// Default template: text block on top, whole upright device below; on a
// landscape canvas the text column stands left of the device (`FramedRow`).
// `FramedScreen` and `FramedRow` are shared with text-bottom (flipped order).
import type { ReactNode } from 'react';
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { Badge } from '../components/Badge.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { Caption } from '../components/Caption.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { Headline } from '../components/Headline.tsx';
import { presetOrientation } from '../../config/presets.ts';
import { LAYOUT, ROW_LAYOUT, type FramedFamily, type FramedLayout, type FramedRowLayout } from './framed-layout.ts';

export { LAYOUT, ROW_LAYOUT } from './framed-layout.ts';
export type { FontRange, FramedFamily, FramedLayout, FramedRowLayout } from './framed-layout.ts';

/** iPhone Duo's portrait canvases have an iPad's shape, so they take the iPad layout. */
export function framedFamily(props: TemplateProps): FramedFamily {
  return props.preset.family === 'ipad' || props.preset.family === 'duo' ? 'ipad' : 'iphone';
}

export function isLandscape(props: TemplateProps): boolean {
  return presetOrientation(props.preset) === 'landscape';
}

export type FramedAlign = 'left' | 'center';

/** `props.align: 'left'` left-aligns the text block; default centred. */
export function framedAlign(props: TemplateProps): FramedAlign {
  return props.screen.props['align'] === 'left' ? 'left' : 'center';
}

/** `props.deviceMaxWidth` (0-1) overrides the family default. */
export function framedDeviceMaxWidth(props: TemplateProps, layout: FramedLayout): number {
  const value = props.screen.props['deviceMaxWidth'];
  return typeof value === 'number' && value > 0 && value <= 1 ? value : layout.deviceMaxWidth;
}

/**
 * Badge, headline and subline in a fixed-height slot, or in a fixed-width
 * column centred on the device when the layout is a row. Shared with
 * phone-watch so a set can mix the two templates and keep one copy band at one y.
 */
export function FramedText({ props, layout, align }: { props: TemplateProps; layout: FramedLayout | FramedRowLayout; align: FramedAlign }) {
  const { screen, theme, copy, preset } = props;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const box = 'textWidth' in layout ? { width: px(layout.textWidth) } : { height: px(layout.textHeight) };
  return (
    <div
      data-s1s-slot=""
      data-s1s-id="text"
      style={{
        flex: 'none',
        ...box,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'textWidth' in layout ? 'center' : 'flex-start',
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

/** Background plus the padded flex column every framed template shares. */
export function FramedColumn({ props, layout, children }: { props: TemplateProps; layout: FramedLayout; children: ReactNode }) {
  const { screen, preset, theme } = props;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
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
        {children}
      </div>
    </>
  );
}

export interface FramedScreenProps {
  props: TemplateProps;
  layout: FramedLayout;
  order: 'text-first' | 'device-first';
}

/** Column layout: [text, device] or [device, text]; the device fills what the text leaves. */
export function FramedScreen({ props, layout, order }: FramedScreenProps) {
  const { screen, preset, theme } = props;
  const align = framedAlign(props);
  const text = <FramedText props={props} layout={layout} align={align} />;

  // Slot mode: the frame fills the column left by the text block, capped in width.
  const device = (
    <DeviceFrame
      captures={screen.captures}
      preset={preset}
      theme={theme}
      maxWidth={Math.round(framedDeviceMaxWidth(props, layout) * preset.pt.width)}
      align={order === 'text-first' ? 'start' : 'end'}
    />
  );

  return (
    <FramedColumn props={props} layout={layout}>
      {order === 'text-first' ? text : device}
      {order === 'text-first' ? device : text}
    </FramedColumn>
  );
}

/** Row layout of a landscape canvas: [text, device] or [device, text]; the device fills what the text column leaves. */
export function FramedRow({ props, order }: { props: TemplateProps; order: FramedScreenProps['order'] }) {
  const { screen, preset, theme } = props;
  const layout = ROW_LAYOUT;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const text = <FramedText props={props} layout={layout} align={framedAlign(props)} />;
  const device = <DeviceFrame captures={screen.captures} preset={preset} theme={theme} />;
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
          flexDirection: 'row',
          gap: px(layout.gap),
          padding: `${px(layout.padY)}px ${px(layout.padX)}px`,
        }}
      >
        {order === 'text-first' ? text : device}
        {order === 'text-first' ? device : text}
      </div>
    </>
  );
}

const heroTopText: TemplateModule = {
  id: 'hero-top-text',
  families: ['iphone', 'ipad', 'duo'],
  ipadVariant: 'Device width up to 84% (iPhone 82%); text block keeps two lines. A portrait iPhone Duo set uses the iPad layout; a landscape one puts the text column left of the device.',
  compliant: true,
  Component: (props) =>
    isLandscape(props) ? (
      <FramedRow props={props} order="text-first" />
    ) : (
      <FramedScreen props={props} layout={LAYOUT[framedFamily(props)]} order="text-first" />
    ),
};

export default heroTopText;
