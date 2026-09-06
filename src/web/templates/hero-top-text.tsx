// Default template: text block on top, whole upright device below.
// `FramedScreen` is shared with text-bottom (same layout, flipped order).
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { Badge } from '../components/Badge.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { Caption } from '../components/Caption.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { FitBox } from '../components/FitBox.tsx';
import { Headline } from '../components/Headline.tsx';
import { useBezel } from '../hooks/useBezel.ts';
import { placeholderCapture } from '../hooks/useCapture.ts';

interface FontRange {
  min: number;
  max: number;
  maxLines: number;
}

/** Numbers in pt at the family's reference width (440 iPhone, 1032 iPad); ratios are unitless. */
export interface FramedLayout {
  padX: number;
  padTop: number;
  padBottom: number;
  /** Fixed height of the text block so every screen in a set gets the same device size. */
  textHeight: number;
  /** Gap between the text block and the device. */
  gap: number;
  /** Gap between badge, headline and subline. */
  textGap: number;
  headline: FontRange;
  subline: FontRange;
  badge: number;
  /** Device width as a fraction of the canvas width. */
  deviceMaxWidth: number;
}

export type FramedFamily = 'iphone' | 'ipad';

export const LAYOUT: Record<FramedFamily, FramedLayout> = {
  iphone: {
    padX: 30,
    padTop: 54,
    padBottom: 30,
    textHeight: 172,
    gap: 20,
    textGap: 10,
    headline: { min: 28, max: 46, maxLines: 2 },
    subline: { min: 15, max: 21, maxLines: 2 },
    badge: 12,
    deviceMaxWidth: 0.82,
  },
  ipad: {
    padX: 80,
    padTop: 76,
    padBottom: 44,
    textHeight: 258,
    gap: 30,
    textGap: 14,
    headline: { min: 40, max: 72, maxLines: 2 },
    subline: { min: 22, max: 32, maxLines: 2 },
    badge: 17,
    deviceMaxWidth: 0.84,
  },
};

export function framedFamily(props: TemplateProps): FramedFamily {
  return props.preset.family === 'ipad' ? 'ipad' : 'iphone';
}

export interface FramedScreenProps {
  props: TemplateProps;
  layout: FramedLayout;
  order: 'text-first' | 'device-first';
}

/** Column layout: [text, device] or [device, text]; the device fills what the text leaves. */
export function FramedScreen({ props, layout, order }: FramedScreenProps) {
  const { screen, preset, theme, copy } = props;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const bezel = useBezel(preset, theme);
  const capture = screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale);
  const align = screen.props['align'] === 'left' ? 'left' : 'center';
  const maxWidthProp = screen.props['deviceMaxWidth'];
  const deviceMaxWidth = typeof maxWidthProp === 'number' && maxWidthProp > 0 && maxWidthProp <= 1 ? maxWidthProp : layout.deviceMaxWidth;

  const text = (
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

  const device =
    bezel.status === 'ready' ? (
      <FitBox
        aspect={bezel.geometry.deviceRect.width / bezel.geometry.deviceRect.height}
        maxWidth={Math.round(deviceMaxWidth * preset.pt.width)}
        align={order === 'text-first' ? 'start' : 'end'}
      >
        {(size) => <DeviceFrame capture={capture} bezel={bezel} width={size.width} />}
      </FitBox>
    ) : (
      <div style={{ flex: '1 1 0px' }} />
    );

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
        {order === 'text-first' ? text : device}
        {order === 'text-first' ? device : text}
      </div>
    </>
  );
}

const heroTopText: TemplateModule = {
  id: 'hero-top-text',
  families: ['iphone', 'ipad'],
  ipadVariant: 'Device width up to 84% (iPhone 82%); text block keeps two lines.',
  compliant: true,
  Component: (props) => <FramedScreen props={props} layout={LAYOUT[framedFamily(props)]} order="text-first" />,
};

export default heroTopText;
