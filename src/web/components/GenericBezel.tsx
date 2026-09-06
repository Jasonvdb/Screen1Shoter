// CSS stand-in for an Apple bezel when none is installed. Its geometry
// (genericGeometry in hooks/bezel.ts) has the shape of a BezelEntry in pt, so
// DeviceFrame positions the capture the same way; the frame is a border so the
// screen stays a hole and the capture shows through.
import type { FrameGeometry } from '../hooks/bezel.ts';

export { genericGeometry } from '../hooks/bezel.ts';

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
