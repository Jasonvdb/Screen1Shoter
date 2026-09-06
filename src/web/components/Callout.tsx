// Feature card: numbered accent marker, auto-fitted title, optional
// auto-fitted body. Used by feature-grid (iPad) and exported for custom
// templates. Card colours derive from theme.text with color-mix so the card
// reads on light and dark backgrounds alike.
import { useRef, type CSSProperties } from 'react';
import type { CalloutCopy, Theme } from '../../config/types.ts';
import { useFitText } from '../hooks/useFitText.ts';
import { readableOn } from './Badge.tsx';

interface FontRange {
  min: number;
  max: number;
}

/** Every number in CSS px (the template scales its layout table first). */
export interface CalloutSizes {
  /** Wrapped title, up to TITLE_LINES lines. */
  title: FontRange;
  /** Wrapped body, up to BODY_LINES lines. */
  body: FontRange;
  /** Diameter of the numbered marker. */
  marker: number;
  padding: number;
  /** Gap between marker, title and body. */
  gap: number;
  radius: number;
}

export const TITLE_LINES = 2;
export const BODY_LINES = 3;

export interface CalloutProps {
  callout: CalloutCopy;
  /** 0-based; the marker shows index + 1. */
  index: number;
  theme: Theme;
  sizes: CalloutSizes;
  style?: CSSProperties | undefined;
}

export function Callout({ callout, index, theme, sizes, style }: CalloutProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const body = callout.body ?? '';
  useFitText(titleRef, callout.title, { minPt: sizes.title.min, maxPt: sizes.title.max, mode: 'wrap', maxLines: TITLE_LINES, lineHeight: 1.15 });
  useFitText(bodyRef, body, { minPt: sizes.body.min, maxPt: sizes.body.max, mode: 'wrap', maxLines: BODY_LINES, lineHeight: 1.3 });

  return (
    <div
      data-s1s-id="callout"
      data-s1s-check=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: sizes.gap,
        padding: sizes.padding,
        borderRadius: sizes.radius,
        background: `color-mix(in srgb, ${theme.text} 7%, transparent)`,
        border: `1px solid color-mix(in srgb, ${theme.text} 12%, transparent)`,
        boxShadow: theme.shadow,
        boxSizing: 'border-box',
        width: '100%',
        ...style,
      }}
    >
      <div
        data-s1s-id="callout-marker"
        style={{
          flex: 'none',
          width: sizes.marker,
          height: sizes.marker,
          borderRadius: 999,
          background: theme.accent,
          color: readableOn(theme.accent),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: theme.fonts.body,
          fontWeight: 700,
          fontSize: Math.round(sizes.marker * 0.5),
          lineHeight: 1,
        }}
      >
        {index + 1}
      </div>
      <div
        ref={titleRef}
        data-s1s-id="callout-title"
        style={{
          display: 'block',
          width: '100%',
          fontFamily: theme.fonts.headline,
          fontWeight: theme.headlineWeight,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          textWrap: 'balance',
          overflowWrap: 'normal',
          color: theme.text,
        }}
      >
        {callout.title}
      </div>
      {body ? (
        <div
          ref={bodyRef}
          data-s1s-id="callout-body"
          style={{
            display: 'block',
            width: '100%',
            fontFamily: theme.fonts.body,
            fontWeight: 400,
            lineHeight: 1.3,
            textWrap: 'pretty',
            overflowWrap: 'normal',
            color: theme.textMuted,
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}
