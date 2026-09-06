// Text block on top, the device below at the full canvas width so the bottom
// canvas edge cuts it off. The app UI reads much larger than in
// hero-top-text, which is the point — and also why Apple's marketing
// guidelines dislike it: `compliant: false` makes RenderPage tag the canvas
// data-s1s-noncompliant and review.md list the screen.
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { TextBlock, textAlignOf, type TextLayout } from './two-device.tsx';

/** Numbers in pt at the family's reference width (440 iPhone, 1032 iPad). */
export interface BleedBottomLayout extends TextLayout {
  /** Horizontal padding of the text block only; the device spans the canvas. */
  padX: number;
  padTop: number;
  /** Gap between the text block and the device. */
  gap: number;
  /** Device width as a fraction of the canvas width; 1 = edge to edge. */
  deviceWidth: number;
}

export type BleedFamily = 'iphone' | 'ipad';

export const LAYOUT: Record<BleedFamily, BleedBottomLayout> = {
  iphone: {
    padX: 30,
    padTop: 54,
    textHeight: 172,
    gap: 24,
    textGap: 10,
    headline: { min: 28, max: 46, maxLines: 2 },
    subline: { min: 15, max: 21, maxLines: 2 },
    badge: 12,
    deviceWidth: 1,
  },
  ipad: {
    padX: 80,
    padTop: 76,
    textHeight: 258,
    gap: 34,
    textGap: 14,
    headline: { min: 40, max: 72, maxLines: 2 },
    subline: { min: 22, max: 32, maxLines: 2 },
    badge: 17,
    deviceWidth: 1,
  },
};

export function bleedFamily(props: TemplateProps): BleedFamily {
  return props.preset.family === 'ipad' ? 'ipad' : 'iphone';
}

/** `props.deviceWidth` as a fraction of the canvas width; anything outside (0, 1] falls back to 1. */
export function deviceWidthOf(props: TemplateProps, fallback: number): number {
  const value = props.screen.props['deviceWidth'];
  return typeof value === 'number' && value > 0 && value <= 1 ? value : fallback;
}

function BleedBottomScreen(props: TemplateProps) {
  const { screen, preset, theme } = props;
  const layout = LAYOUT[bleedFamily(props)];
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const deviceWidth = deviceWidthOf(props, layout.deviceWidth);

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
          // No bottom or device-side padding: the device runs into both the
          // side and the bottom edge.
          padding: `${px(layout.padTop)}px 0 0`,
        }}
      >
        <div style={{ flex: 'none', padding: `0 ${px(layout.padX)}px` }}>
          <TextBlock props={props} layout={layout} align={textAlignOf(props)} />
        </div>
        {/* crop 'bottom' keeps the frame's width and clips it at the slot's
            bottom (= the canvas edge); allowBleed tells checks.ts that the
            device leaving the frame box is intended, not an overflow bug.
            align 'end' is what keeps the bleed: below about deviceWidth 0.78
            the frame is shorter than the slot, and a top-pinned one would
            float above a band of flat background. */}
        <DeviceFrame
          captures={screen.captures}
          preset={preset}
          theme={theme}
          crop="bottom"
          allowBleed
          maxWidth={Math.round(deviceWidth * preset.pt.width)}
          align="end"
        />
      </div>
    </>
  );
}

const bleedBottom: TemplateModule = {
  id: 'bleed-bottom',
  families: ['iphone', 'ipad'],
  compliant: false,
  Component: (props) => <BleedBottomScreen {...props} />,
};

export default bleedBottom;
