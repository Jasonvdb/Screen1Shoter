// Small accent pill (e.g. "NEW", "PRO").
import type { CSSProperties } from 'react';
import type { Theme } from '../../config/types.ts';

function channel(hex: string, at: number, size: number): number {
  const raw = hex.slice(at, at + size);
  return parseInt(size === 1 ? raw + raw : raw, 16) / 255;
}

/** Black or white, whichever reads better on the given sRGB hex colour. */
export function readableOn(hex: string): '#000' | '#fff' {
  const clean = hex.replace('#', '');
  const size = clean.length === 3 ? 1 : clean.length === 6 ? 2 : 0;
  if (size === 0) return '#fff';
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = toLinear(channel(clean, 0, size));
  const g = toLinear(channel(clean, size, size));
  const b = toLinear(channel(clean, 2 * size, size));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#000' : '#fff';
}

export interface BadgeProps {
  text: string;
  theme: Theme;
  fontSize: number;
  style?: CSSProperties | undefined;
}

export function Badge({ text, theme, fontSize, style }: BadgeProps) {
  return (
    <span
      data-s1s-id="badge"
      data-s1s-check=""
      style={{
        display: 'inline-block',
        flex: 'none',
        padding: '0.45em 1em',
        borderRadius: 999,
        background: theme.accent,
        color: readableOn(theme.accent),
        fontFamily: theme.fonts.body,
        fontWeight: 700,
        fontSize,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {text}
    </span>
  );
}
