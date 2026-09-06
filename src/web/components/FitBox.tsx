// Fills its flex slot, measures it, and gives the child the largest box with
// a fixed aspect ratio that fits (optionally capped by maxWidth/maxHeight).
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Dims } from '../../config/types.ts';
import { acquire } from '../runtime/ready.ts';

export interface FitBoxProps {
  /** width / height of the child. */
  aspect: number;
  maxWidth?: number | undefined;
  maxHeight?: number | undefined;
  /** Vertical placement inside the slot. */
  align?: 'start' | 'center' | 'end' | undefined;
  style?: CSSProperties | undefined;
  children: (size: Dims) => ReactNode;
}

/** Largest integer-width box with `aspect` inside `slot`, capped by the maxima. */
export function fitInto(slot: Dims, aspect: number, maxWidth?: number, maxHeight?: number): Dims {
  let width = Math.min(slot.width, maxWidth ?? Number.POSITIVE_INFINITY);
  const height = Math.min(slot.height, maxHeight ?? Number.POSITIVE_INFINITY);
  if (width / aspect > height) width = height * aspect;
  width = Math.max(0, Math.floor(width));
  return { width, height: width / aspect };
}

const ALIGN: Record<NonNullable<FitBoxProps['align']>, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

export function FitBox({ aspect, maxWidth, maxHeight, align = 'center', style, children }: FitBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<Dims | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const release = acquire('fitbox');
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSlot((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    release();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const size = slot ? fitInto(slot, aspect, maxWidth, maxHeight) : null;
  return (
    <div
      ref={ref}
      data-s1s-id="fitbox"
      style={{
        flex: '1 1 0px',
        minWidth: 0,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: ALIGN[align],
        ...style,
      }}
    >
      {size && size.width > 0 ? (
        <div style={{ flex: 'none', position: 'relative', width: size.width, height: size.height }}>{children(size)}</div>
      ) : null}
    </div>
  );
}
