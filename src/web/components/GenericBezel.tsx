// CSS stand-in for an Apple bezel when none is installed. Geometry is in the
// same shape as a BezelEntry (pt units) so DeviceFrame positions the capture
// identically; the frame is drawn with a border so the screen stays a hole.
import type { DeviceFamily, Dims, Rect } from '../../config/types.ts';
import type { FrameGeometry } from './DeviceFrame.tsx';

interface GenericSpec {
  border: number;
  screenRadius: number;
  island?: { width: number; height: number; top: number };
}

const SPEC: Record<DeviceFamily, GenericSpec> = {
  iphone: { border: 14, screenRadius: 62, island: { width: 126, height: 37, top: 11 } },
  ipad: { border: 44, screenRadius: 18 },
  watch: { border: 20, screenRadius: 84 },
};

/** Frame geometry for a family whose screen is `screen` (pt). */
export function genericGeometry(family: DeviceFamily, screen: Dims): FrameGeometry {
  const spec = SPEC[family];
  const imageSize: Dims = { width: screen.width + 2 * spec.border, height: screen.height + 2 * spec.border };
  const geometry: FrameGeometry = {
    imageSize,
    deviceRect: { x: 0, y: 0, width: imageSize.width, height: imageSize.height },
    screenRect: { x: spec.border, y: spec.border, width: screen.width, height: screen.height },
    cornerRadius: spec.screenRadius,
  };
  if (spec.island) {
    const island: Rect = {
      x: spec.border + (screen.width - spec.island.width) / 2,
      y: spec.border + spec.island.top,
      width: spec.island.width,
      height: spec.island.height,
    };
    geometry.islandRect = island;
  }
  return geometry;
}

/** Draws the frame for `geometry` scaled by `k` (CSS px per geometry unit), origin at deviceRect. */
export function GenericBezel({ geometry, k }: { geometry: FrameGeometry; k: number }) {
  const { deviceRect, screenRect, cornerRadius, islandRect } = geometry;
  const border = (screenRect.x - deviceRect.x) * k;
  const outerRadius = (cornerRadius + (screenRect.x - deviceRect.x)) * k;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: deviceRect.width * k,
        height: deviceRect.height * k,
        boxSizing: 'border-box',
        border: `${border}px solid #1c1c1e`,
        borderRadius: outerRadius,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16), 0 0 0 1px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
      }}
    >
      {islandRect ? (
        <div
          style={{
            position: 'absolute',
            left: (islandRect.x - screenRect.x) * k,
            top: (islandRect.y - screenRect.y) * k,
            width: islandRect.width * k,
            height: islandRect.height * k,
            borderRadius: 999,
            background: '#000',
          }}
        />
      ) : null}
    </div>
  );
}
