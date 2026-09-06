// A capture inside an Apple bezel. The capture <img> is placed by the bezel's
// screenRect (as fractions of deviceRect), grown by one bezel pixel to hide
// seams, rounded by cornerRadius; the bezel image sits on top so its opaque
// Dynamic Island covers the capture. No bezel -> GenericBezel + fallback flag.
import type { CSSProperties } from 'react';
import type { CaptureSource, Dims, Rect } from '../../config/types.ts';
import type { ReadyBezel } from '../hooks/useBezel.ts';
import { useCapture } from '../hooks/useCapture.ts';
import { GenericBezel } from './GenericBezel.tsx';
import { MissingCapture } from './MissingCapture.tsx';

/** The subset of BezelEntry the frame needs; GenericBezel produces the same shape in pt. */
export interface FrameGeometry {
  imageSize: Dims;
  deviceRect: Rect;
  screenRect: Rect;
  cornerRadius: number;
  islandRect?: Rect;
}

export interface DeviceFrameProps {
  capture: CaptureSource;
  bezel: ReadyBezel;
  /** Width of the device outline (deviceRect) in CSS px. */
  width: number;
  /** Degrees; opt-in templates only. */
  rotate?: number | undefined;
  /** Mark intentional overflow so checks skip this frame. */
  allowBleed?: boolean | undefined;
  style?: CSSProperties | undefined;
}

const GROW = 1; // bezel px added around the screen cut-out

export function DeviceFrame({ capture, bezel, width, rotate, allowBleed, style }: DeviceFrameProps) {
  const { geometry, url: bezelUrl } = bezel;
  const { deviceRect, screenRect, imageSize, cornerRadius } = geometry;
  const k = width / deviceRect.width;
  const height = deviceRect.height * k;
  const cap = useCapture(capture);

  const screen: CSSProperties = {
    position: 'absolute',
    left: (screenRect.x - deviceRect.x - GROW) * k,
    top: (screenRect.y - deviceRect.y - GROW) * k,
    width: (screenRect.width + 2 * GROW) * k,
    height: (screenRect.height + 2 * GROW) * k,
    borderRadius: (cornerRadius + GROW) * k,
    overflow: 'hidden',
    background: '#000',
    zIndex: 1,
  };

  const frame: CSSProperties = {
    position: 'relative',
    width,
    height,
    ...(rotate ? { transform: `rotate(${rotate}deg)`, transformOrigin: 'center' } : {}),
    ...style,
  };

  return (
    <div
      data-s1s-id="device"
      data-s1s-check=""
      data-s1s-allow-bleed={allowBleed ? '' : undefined}
      data-s1s-bezel-fallback={bezelUrl ? undefined : bezel.wantedId}
      style={frame}
    >
      <div style={screen}>
        {cap.url ? (
          <img
            ref={cap.ref}
            src={cap.url}
            alt=""
            onLoad={cap.onLoad}
            onError={cap.onError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
          />
        ) : null}
        {cap.url === null || cap.failed ? <MissingCapture source={capture} failed={cap.failed} /> : null}
      </div>
      {bezelUrl ? (
        <img
          src={bezelUrl}
          alt=""
          style={{
            position: 'absolute',
            left: -deviceRect.x * k,
            top: -deviceRect.y * k,
            width: imageSize.width * k,
            height: imageSize.height * k,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
          <GenericBezel geometry={geometry} k={k} />
        </div>
      )}
    </div>
  );
}
