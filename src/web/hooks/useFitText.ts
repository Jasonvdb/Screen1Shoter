// Auto-fit text: the largest integer font size in [minPt, maxPt] at which the
// element does not overflow. Explicit lines ('pre') only check the width;
// wrapped text also checks the line count. The search itself is `chooseSize`
// in fit.ts (pure, unit-tested); this hook drives it against a live element
// and records the data-s1s-* attributes the renderer reads.
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { acquire } from '../runtime/ready.ts';
import { chooseSize } from './fit.ts';

export { chooseSize } from './fit.ts';
export type { ChooseSizeInput, ChooseSizeResult } from './fit.ts';

export interface FitOptions {
  minPt: number;
  maxPt: number;
  /** 'pre' = explicit lines (white-space: pre); 'wrap' = free text with maxLines. */
  mode: 'pre' | 'wrap';
  maxLines?: number | undefined;
  /** Unitless line-height of the element; used to count wrapped lines. */
  lineHeight: number;
  /** Optional ceiling for the element's scrollHeight in CSS px. */
  maxHeight?: number | undefined;
}

function fitsAt(el: HTMLElement, pt: number, opts: FitOptions): boolean {
  el.style.fontSize = `${pt}px`;
  if (el.scrollWidth - el.clientWidth > 1) return false;
  const height = el.scrollHeight;
  if (opts.mode === 'wrap' && opts.maxLines !== undefined) {
    const lines = Math.round(height / (pt * opts.lineHeight));
    if (lines > opts.maxLines) return false;
  }
  if (opts.maxHeight !== undefined && height > opts.maxHeight + 1) return false;
  // Inside a fixed-height text slot, the whole slot (badge + headline +
  // subline) must fit; siblings measured earlier keep their size.
  const slot = el.closest<HTMLElement>('[data-s1s-slot]');
  if (slot && slot.scrollHeight - slot.clientHeight > 1) return false;
  return true;
}

/**
 * Fit the text in `ref` (a block element with a definite width). Sets the
 * inline font-size and data-s1s-fitted / data-s1s-overflow; holds
 * data-s1s-fitting and a readiness token while measuring. Re-runs when the
 * element's width changes or a font finishes loading.
 */
export function useFitText(ref: RefObject<HTMLElement | null>, text: string, opts: FitOptions): void {
  const [tick, setTick] = useState(0);
  const { minPt, maxPt, mode, maxLines, lineHeight, maxHeight } = opts;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const release = acquire('fit-text');
    el.setAttribute('data-s1s-fitting', '');
    const options: FitOptions = { minPt, maxPt, mode, maxLines, lineHeight, maxHeight };
    const result = chooseSize({ minPt, maxPt, fits: (pt) => fitsAt(el, pt, options) });
    el.style.fontSize = `${result.pt}px`;
    el.setAttribute('data-s1s-fitted', String(result.pt));
    if (result.overflow) el.setAttribute('data-s1s-overflow', 'text-min-size');
    else el.removeAttribute('data-s1s-overflow');
    el.removeAttribute('data-s1s-fitting');
    release();
  }, [ref, text, minPt, maxPt, mode, maxLines, lineHeight, maxHeight, tick]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      setTick((t) => t + 1);
    });
    observer.observe(el);
    const onFonts = () => setTick((t) => t + 1);
    document.fonts.addEventListener('loadingdone', onFonts);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', onFonts);
    };
  }, [ref]);
}
