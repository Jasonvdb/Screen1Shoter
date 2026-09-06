// Watch only: the unframed capture (there is no watch bezel) with a short
// caption from copy.headline. Unlike `raw`, this needs a browser render, so a
// screen using it is not a passthrough item.
//
// The canvas is 416x496 — a 46 mm watch face — so the text budget is about
// two to four words on at most two lines. Only copy.headline is shown; a
// subline would not survive at this size.
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { Headline } from '../components/Headline.tsx';
import { MissingCapture } from '../components/MissingCapture.tsx';
import { placeholderCapture, useCapture } from '../hooks/useCapture.ts';

/** Numbers in pt at the watch reference width (416). */
export interface WatchCaptionLayout {
  padX: number;
  padTop: number;
  padBottom: number;
  /** Gap between the capture and the caption. */
  gap: number;
  /** Fixed height of the caption slot so every screen in a set crops the same. */
  captionHeight: number;
  headline: { min: number; max: number; maxLines: number };
  /** Corner radius of the capture box. */
  captureRadius: number;
}

export const LAYOUT: Record<'watch', WatchCaptionLayout> = {
  watch: {
    padX: 14,
    padTop: 14,
    padBottom: 16,
    gap: 12,
    captionHeight: 92,
    headline: { min: 16, max: 34, maxLines: 2 },
    captureRadius: 40,
  },
};

/** `props.captionSide: 'top' | 'bottom'`; default below the capture. */
export function captionSideOf(props: TemplateProps): 'top' | 'bottom' {
  return props.screen.props['captionSide'] === 'top' ? 'top' : 'bottom';
}

/**
 * `props.fit: 'cover' | 'contain'`; same escape hatch as `raw`. The capture
 * box is wider than a 416x496 capture, so the default 'cover' fills it by
 * cutting the bottom of the watch screen away: a screen whose bottom row
 * carries a button or a number needs 'contain'.
 */
export function captureFitOf(props: TemplateProps): 'cover' | 'contain' {
  return props.screen.props['fit'] === 'contain' ? 'contain' : 'cover';
}

function WatchCaptionScreen(props: TemplateProps) {
  const { screen, preset, theme, copy } = props;
  const layout = LAYOUT.watch;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const capture = screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale);
  const cap = useCapture(capture);

  const image = (
    <div
      data-s1s-id="capture"
      style={{
        flex: '1 1 0px',
        minHeight: 0,
        position: 'relative',
        borderRadius: px(layout.captureRadius),
        overflow: 'hidden',
        background: '#000',
      }}
    >
      {cap.url ? (
        <img
          ref={cap.ref}
          src={cap.url}
          alt=""
          onLoad={cap.onLoad}
          onError={cap.onError}
          style={{ width: '100%', height: '100%', objectFit: captureFitOf(props), objectPosition: 'top center' }}
        />
      ) : null}
      {cap.url === null || cap.failed ? <MissingCapture source={capture} failed={cap.failed} /> : null}
    </div>
  );

  const caption = (
    <div
      data-s1s-slot=""
      data-s1s-id="text"
      style={{
        flex: 'none',
        height: px(layout.captionHeight),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <Headline
        text={copy?.headline ?? `[copy missing: ${screen.copyKey}]`}
        highlight={copy?.highlight}
        theme={theme}
        locale={screen.locale}
        minPt={px(layout.headline.min)}
        maxPt={px(layout.headline.max)}
        maxLines={layout.headline.maxLines}
        align="center"
      />
    </div>
  );

  const side = captionSideOf(props);
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
        {side === 'top' ? caption : image}
        {side === 'top' ? image : caption}
      </div>
    </>
  );
}

const watchCaption: TemplateModule = {
  id: 'watch-caption',
  families: ['watch'],
  compliant: true,
  Component: (props) => <WatchCaptionScreen {...props} />,
};

export default watchCaption;
