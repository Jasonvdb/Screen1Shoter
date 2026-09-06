// Auto-fitted secondary text (subline) in the body font and muted colour.
import { useRef, type CSSProperties } from 'react';
import type { Theme } from '../../config/types.ts';
import { useFitText } from '../hooks/useFitText.ts';

export interface CaptionProps {
  text: string | string[];
  theme: Theme;
  minPt: number;
  maxPt: number;
  /** Wrapped text only. Default 2. */
  maxLines?: number | undefined;
  lineHeight?: number | undefined;
  align?: 'left' | 'center' | undefined;
  color?: string | undefined;
  style?: CSSProperties | undefined;
}

export function Caption({ text, theme, minPt, maxPt, maxLines, lineHeight, align, color, style }: CaptionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const explicit = Array.isArray(text);
  const content = explicit ? text.join('\n') : text;
  const lh = lineHeight ?? 1.3;
  useFitText(ref, content, {
    minPt,
    maxPt,
    mode: explicit ? 'pre' : 'wrap',
    maxLines: explicit ? undefined : (maxLines ?? 2),
    lineHeight: lh,
  });
  return (
    <div
      ref={ref}
      data-s1s-id="subline"
      data-s1s-check=""
      style={{
        display: 'block',
        width: '100%',
        fontFamily: theme.fonts.body,
        fontWeight: 500,
        lineHeight: lh,
        whiteSpace: explicit ? 'pre' : 'normal',
        textWrap: explicit ? 'nowrap' : 'balance',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        textAlign: align ?? 'center',
        color: color ?? theme.textMuted,
        ...style,
      }}
    >
      {content}
    </div>
  );
}
