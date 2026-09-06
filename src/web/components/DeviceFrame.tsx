// A capture inside an Apple bezel. The outer box has deviceRect's aspect; the
// capture <img> sits at screenRect (as fractions of deviceRect) grown by one
// bezel px, clipped by cornerRadius; the bezel image is drawn on top so its
// opaque Dynamic Island covers the capture. No bezel -> GenericBezel plus a
// data-s1s-bezel-fallback flag (checks.ts turns it into a warning).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { CaptureSource, Dims, SizePreset, Theme } from '../../config/types.ts';
import { frameBox, frameLayout, type FrameCrop } from '../hooks/bezel.ts';
import { useBezel } from '../hooks/useBezel.ts';
import { placeholderCapture, useCapture } from '../hooks/useCapture.ts';
import { acquire } from '../runtime/ready.ts';
import { GenericBezel } from './GenericBezel.tsx';
import { MissingCapture } from './MissingCapture.tsx';

export type { FrameGeometry } from '../hooks/bezel.ts';

/** 'slot' fills the flex slot the frame sits in; a box (CSS px) sizes it directly (both sides = contain). */
export type DeviceFit = 'slot' | { width?: number | undefined; height?: number | undefined };

export interface DeviceFrameProps {
  /** `captures[0]` fills the screen; pass a one-element slice to show another capture. */
  captures: readonly CaptureSource[];
  preset: SizePreset;
  theme: Theme;
  /** Bezel id to try first. Default preset.bezel, then preset.bezelFallbacks. */
  bezelId?: string | undefined;
  /** Colour variant. Default theme.bezelVariant ('auto' = first installed). */
  variant?: string | undefined;
  /** Default 'slot'. */
  fit?: DeviceFit | undefined;
  /** Slot mode: caps in CSS px and vertical placement inside the slot. */
  maxWidth?: number | undefined;
  maxHeight?: number | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  /** 'bottom': the device keeps its width and is clipped at the box's bottom edge (opt-in templates). */
  crop?: FrameCrop | undefined;
  /** Degrees; opt-in templates only. */
  rotate?: number | undefined;
  /** Mark intentional overflow so checks skip this frame. */
  allowBleed?: boolean | undefined;
  /** Replaces the `s1s capture ...` line of the missing-capture panel (templates that need a screens.ts change instead). */
  captureHint?: string | undefined;
  /** Applied to the device box. */
  style?: CSSProperties | undefined;
}

const COLLAPSED_WHY = 'DeviceFrame has no room: give its parent a definite height (flex column) or pass fit={{ width }}';

const ALIGN: Record<NonNullable<DeviceFrameProps['align']>, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/** Measures the flex slot the frame fills (same protocol as FitBox: token held while measuring). */
function useSlot(enabled: boolean): { ref: RefObject<HTMLDivElement | null>; slot: Dims | null } {
  const ref = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<Dims | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const release = acquire('device-slot');
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSlot((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    release();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, slot };
}

/** Holds a readiness token until the bezel PNG is decoded; a broken file is flagged like any other image. */
function useDecoded(ref: RefObject<HTMLImageElement | null>, url: string | null): void {
  useEffect(() => {
    const img = ref.current;
    if (!url || !img) return;
    const release = acquire('bezel-image');
    let alive = true;
    img
      .decode()
      .catch(() => {
        if (alive) img.setAttribute('data-s1s-img-error', url);
      })
      .finally(release);
    return () => {
      alive = false;
      release();
    };
  }, [ref, url]);
}

function available(fit: DeviceFit, slot: Dims | null, maxWidth?: number, maxHeight?: number): Dims | null {
  if (fit !== 'slot' && (fit.width !== undefined || fit.height !== undefined)) {
    return { width: fit.width ?? Number.POSITIVE_INFINITY, height: fit.height ?? Number.POSITIVE_INFINITY };
  }
  if (!slot) return null;
  return {
    width: Math.min(slot.width, maxWidth ?? Number.POSITIVE_INFINITY),
    height: Math.min(slot.height, maxHeight ?? Number.POSITIVE_INFINITY),
  };
}

export function DeviceFrame({
  captures,
  preset,
  theme,
  bezelId,
  variant,
  fit = 'slot',
  maxWidth,
  maxHeight,
  align = 'center',
  crop = 'none',
  rotate,
  allowBleed,
  captureHint,
  style,
}: DeviceFrameProps) {
  const slotMode = fit === 'slot' || (fit.width === undefined && fit.height === undefined);
  const bezel = useBezel(preset, theme, { bezelId, variant });
  const { ref: slotRef, slot } = useSlot(slotMode);
  const capture = captures[0] ?? placeholderCapture('capture', preset.family, '');
  const cap = useCapture(capture);
  const bezelRef = useRef<HTMLImageElement>(null);
  const bezelUrl = bezel.status === 'ready' ? bezel.url : null;
  useDecoded(bezelRef, bezelUrl);

  // A collapsed slot (non-flex parent, no definite height) is a template
  // bug: flag it so checks.ts reports it, and mount nothing so the page still
  // becomes ready (useCapture holds its token only while an <img> exists).
  const wrap = (node: ReactNode, collapsed = false) => {
    const flag = collapsed
      ? { 'data-s1s-overflow': 'overflow', 'data-s1s-overflow-why': `${COLLAPSED_WHY} (${JSON.stringify(fit)})` }
      : {};
    return slotMode ? (
      <div
        ref={slotRef}
        data-s1s-id="device-slot"
        {...flag}
        style={{
          flex: '1 1 0px',
          minWidth: 0,
          minHeight: 0,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: ALIGN[align],
        }}
      >
        {node}
      </div>
    ) : collapsed ? (
      <div data-s1s-id="device" {...flag} style={{ width: 0, height: 0, ...style }} />
    ) : (
      node
    );
  };

  if (bezel.status !== 'ready') return wrap(null);
  const avail = available(fit, slot, maxWidth, maxHeight);
  if (!avail) return wrap(null);
  const box = frameBox(bezel.geometry, avail, crop);
  if (box.width <= 0) return wrap(null, true);
  const layout = frameLayout(bezel.geometry, box.width);
  const { entry, geometry } = bezel;

  const frame: CSSProperties = {
    position: 'relative',
    flex: 'none',
    width: box.width,
    height: box.height,
    overflow: crop === 'bottom' ? 'hidden' : 'visible',
    ...(rotate ? { transform: `rotate(${rotate}deg)`, transformOrigin: 'center' } : {}),
    ...style,
  };

  const screen: CSSProperties = {
    position: 'absolute',
    left: layout.screen.x,
    top: layout.screen.y,
    width: layout.screen.width,
    height: layout.screen.height,
    borderRadius: layout.screen.radius,
    overflow: 'hidden',
    background: '#000',
    zIndex: 1,
  };

  return wrap(
    <div
      data-s1s-id="device"
      data-s1s-check=""
      data-s1s-bezel={entry ? `${entry.id}/${entry.variant}` : 'generic'}
      data-s1s-bezel-fallback={bezel.fallback === 'none' ? undefined : bezel.wantedId}
      data-s1s-allow-bleed={allowBleed ? '' : undefined}
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
        {cap.url === null || cap.failed ? <MissingCapture source={capture} failed={cap.failed} hint={captureHint} /> : null}
      </div>
      {bezelUrl ? (
        <img
          ref={bezelRef}
          src={bezelUrl}
          alt=""
          style={{
            position: 'absolute',
            left: layout.image.x,
            top: layout.image.y,
            width: layout.image.width,
            height: layout.image.height,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
          <GenericBezel geometry={geometry} k={layout.k} />
        </div>
      )}
    </div>,
  );
}
