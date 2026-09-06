// Full-canvas background layer: solid colour, two-stop gradient, an image from
// the project dir, or one slice of a panorama shared across consecutive
// screens (resolveScreen injects the slice into props.background).
import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { acquire } from '../runtime/ready.ts';

export type BackgroundSpec =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle?: number }
  | { type: 'image'; src: string; fit?: 'cover' | 'contain'; position?: string }
  | { type: 'panorama'; src: string; index: number; count: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** Validates `screen.props.background`; anything unrecognised falls back to a solid colour. */
export function backgroundSpecFrom(value: unknown, fallback: string): BackgroundSpec {
  if (typeof value === 'string') return { type: 'solid', color: value };
  if (isRecord(value)) {
    const from = str(value['from']);
    const to = str(value['to']);
    const src = str(value['src']);
    if (value['type'] === 'gradient' && from && to) {
      const spec: BackgroundSpec = { type: 'gradient', from, to };
      if (typeof value['angle'] === 'number') spec.angle = value['angle'];
      return spec;
    }
    if (value['type'] === 'panorama' && src) {
      const index = int(value['index']);
      const count = int(value['count']);
      // A slice outside its own panorama would shift the seam, so refuse it
      // rather than render the wrong part of the image.
      if (index !== undefined && count !== undefined && count >= 1 && index >= 0 && index < count) {
        return { type: 'panorama', src, index, count };
      }
    }
    if (value['type'] === 'image' && src) {
      const spec: BackgroundSpec = { type: 'image', src };
      if (value['fit'] === 'contain') spec.fit = 'contain';
      const position = str(value['position']);
      if (position) spec.position = position;
      return spec;
    }
    const color = str(value['color']);
    if (color) return { type: 'solid', color };
  }
  return { type: 'solid', color: fallback };
}

function assetUrl(src: string): string {
  if (/^(https?:|data:|\/)/.test(src)) return src;
  return `/project/${src.split('/').map(encodeURIComponent).join('/')}`;
}

const LAYER: CSSProperties = { position: 'absolute', inset: 0, zIndex: 0 };

/**
 * A background image is nothing else's business: no DeviceFrame or useCapture
 * holds a token for it, so without this the settle loop can report the page
 * ready in the frame between mounting the <img> and decoding it. Mirrors
 * useCapture: the token lives only while a mounted element is in flight.
 *
 * A file that fails to load stays in the DOM with an empty alt, so the canvas
 * shows the theme background underneath and checks.ts reports `image-missing`.
 */
function BackgroundImage({ src, style }: { src: string; style: CSSProperties }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [settledSrc, setSettledSrc] = useState<string | null>(null);
  const settled = settledSrc === src;

  useLayoutEffect(() => {
    if (settled || !img) return;
    if (img.complete) {
      setSettledSrc(src);
      return;
    }
    return acquire('background');
  }, [src, settled, img]);

  const done = () => setSettledSrc(src);
  return <img ref={setImg} src={src} alt="" style={style} onLoad={done} onError={done} />;
}

export function Background({ spec }: { spec: BackgroundSpec }) {
  if (spec.type === 'gradient') {
    const angle = spec.angle ?? 180;
    return <div data-s1s-id="background" style={{ ...LAYER, background: `linear-gradient(${angle}deg, ${spec.from}, ${spec.to})` }} />;
  }
  if (spec.type === 'panorama') {
    // The whole image is cover-cropped into a strip `count` canvases wide, then
    // slid left by `index` canvases: neighbouring screens meet with no seam.
    return (
      <div data-s1s-id="background" style={{ ...LAYER, overflow: 'hidden' }}>
        <BackgroundImage
          src={assetUrl(spec.src)}
          style={{
            position: 'absolute',
            top: 0,
            left: `${-spec.index * 100}%`,
            width: `${spec.count * 100}%`,
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
          }}
        />
      </div>
    );
  }
  if (spec.type === 'image') {
    return (
      <div data-s1s-id="background" style={LAYER}>
        <BackgroundImage
          src={assetUrl(spec.src)}
          style={{ width: '100%', height: '100%', objectFit: spec.fit ?? 'cover', objectPosition: spec.position ?? 'center' }}
        />
      </div>
    );
  }
  return <div data-s1s-id="background" style={{ ...LAYER, background: spec.color }} />;
}
