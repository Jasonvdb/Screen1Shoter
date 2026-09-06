// Full-canvas background layer: solid colour, two-stop gradient, or an image
// from the project dir. Panorama (a slice per screen) is a later phase.
import type { CSSProperties } from 'react';

export type BackgroundSpec =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle?: number }
  | { type: 'image'; src: string; fit?: 'cover' | 'contain'; position?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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

export function Background({ spec }: { spec: BackgroundSpec }) {
  if (spec.type === 'gradient') {
    const angle = spec.angle ?? 180;
    return <div data-s1s-id="background" style={{ ...LAYER, background: `linear-gradient(${angle}deg, ${spec.from}, ${spec.to})` }} />;
  }
  if (spec.type === 'image') {
    return (
      <div data-s1s-id="background" style={LAYER}>
        <img
          src={assetUrl(spec.src)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: spec.fit ?? 'cover', objectPosition: spec.position ?? 'center' }}
        />
      </div>
    );
  }
  return <div data-s1s-id="background" style={{ ...LAYER, background: spec.color }} />;
}
