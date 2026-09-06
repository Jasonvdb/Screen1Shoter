// Text block on top, the whole device below rotated a few degrees
// (`props.rotate`, default -8, clamped to +-MAX_TILT). A rotated box needs
// more room than an upright one, so the device is shrunk until its rotated
// bounds fit the slot: it never clips and never leaves the canvas.
// `compliant: false` — Apple asks for upright devices — so RenderPage tags
// the canvas data-s1s-noncompliant and review.md lists the screen.
import type { Dims } from '../../config/types.ts';
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { FitBox } from '../components/FitBox.tsx';
import { deviceAspect } from '../hooks/bezel.ts';
import { useBezel } from '../hooks/useBezel.ts';
import { TextBlock, textAlignOf, type TextLayout } from './two-device.tsx';

/** Beyond this the device reads as a mistake rather than a style. */
export const MAX_TILT = 20;

/** Numbers in pt at the family's reference width (440 iPhone, 1032 iPad). */
export interface TiltedLayout extends TextLayout {
  padX: number;
  padTop: number;
  padBottom: number;
  /** Gap between the text block and the device. */
  gap: number;
  /** Device width as a fraction of the canvas width, before the tilt shrinks it. */
  deviceMaxWidth: number;
  /** Default tilt in degrees; negative leans the device to the left. */
  rotate: number;
}

export type TiltedFamily = 'iphone' | 'ipad';

export const LAYOUT: Record<TiltedFamily, TiltedLayout> = {
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
    rotate: -8,
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
    rotate: -8,
  },
};

export function tiltedFamily(props: TemplateProps): TiltedFamily {
  return props.preset.family === 'ipad' ? 'ipad' : 'iphone';
}

/** `props.rotate` in degrees, clamped to +-MAX_TILT; anything else falls back to the layout default. */
export function clampTilt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, value));
}

/** Axis-aligned bounds of `box` rotated by `degrees` around its centre. */
export function rotatedBounds(box: Dims, degrees: number): Dims {
  const rad = (Math.abs(degrees) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    width: box.width * cos + box.height * sin,
    height: box.width * sin + box.height * cos,
  };
}

/**
 * The largest `aspect`-shaped box whose rotated bounds still fit `avail`.
 * Solves `avail` >= rotatedBounds({ aspect * h, h }) for h, then floors the
 * width so the result can only shrink (DeviceFrame floors it too).
 */
export function fitRotated(avail: Dims, aspect: number, degrees: number): Dims {
  if (!(aspect > 0) || !Number.isFinite(avail.width) || !Number.isFinite(avail.height)) return { width: 0, height: 0 };
  const unit = rotatedBounds({ width: aspect, height: 1 }, degrees);
  const height = Math.min(avail.width / unit.width, avail.height / unit.height);
  const width = Math.max(0, Math.floor(aspect * height));
  return { width, height: width / aspect };
}

function TiltedScreen(props: TemplateProps) {
  const { screen, preset, theme } = props;
  const layout = LAYOUT[tiltedFamily(props)];
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const tilt = clampTilt(screen.props['rotate'], layout.rotate);
  // Geometry only: DeviceFrame picks the same bezel itself.
  const bezel = useBezel(preset, theme);

  let device = <div style={{ flex: '1 1 0px' }} />;
  if (bezel.status === 'ready') {
    const aspect = deviceAspect(bezel.geometry);
    const maxDeviceWidth = Math.round(layout.deviceMaxWidth * preset.pt.width);
    const bounds = rotatedBounds({ width: maxDeviceWidth, height: maxDeviceWidth / aspect }, tilt);
    device = (
      <FitBox aspect={bounds.width / bounds.height} maxWidth={Math.ceil(bounds.width)} align="center">
        {(size) => (
          // The rotation is around the device's centre, so centring the
          // upright box inside the bounds box centres the rotated one too.
          <div
            data-s1s-id="devices"
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <DeviceFrame
              captures={screen.captures}
              preset={preset}
              theme={theme}
              fit={{ width: fitRotated(size, aspect, tilt).width }}
              rotate={tilt}
            />
          </div>
        )}
      </FitBox>
    );
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
        {device}
      </div>
    </>
  );
}

const tilted: TemplateModule = {
  id: 'tilted',
  families: ['iphone', 'ipad'],
  compliant: false,
  Component: (props) => <TiltedScreen {...props} />,
};

export default tilted;
