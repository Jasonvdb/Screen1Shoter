// Auto-fitted headline with theme.headlineCase and an optional highlighted
// substring. Explicit lines (string[]) render with white-space: pre.
import { useRef, type CSSProperties } from 'react';
import type { HeadlineCase, Theme } from '../../config/types.ts';
import { useFitText } from '../hooks/useFitText.ts';

const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'vs', 'via', 'as',
]);

function upperFirst(word: string, locale: string): string {
  const first = [...word][0];
  if (!first) return word;
  return first.toLocaleUpperCase(locale) + word.slice(first.length);
}

function titleCaseLine(line: string, locale: string): string {
  const words = line.split(' ');
  return words
    .map((word, i) => {
      if (word === '') return word;
      const bare = word.replace(/[^\p{L}]/gu, '').toLowerCase();
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(bare)) return word;
      return word
        .split('-')
        .map((part) => upperFirst(part, locale))
        .join('-');
    })
    .join(' ');
}

/** Title: capitalise each word except small words mid-line; never lowercases (GPS stays GPS). */
export function applyCase(text: string, mode: HeadlineCase, locale: string): string {
  switch (mode) {
    case 'upper':
      return text.toLocaleUpperCase(locale);
    case 'sentence':
      return upperFirst(text, locale);
    case 'title':
      return text
        .split('\n')
        .map((line) => titleCaseLine(line, locale))
        .join('\n');
  }
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Splits `text` around the first case-insensitive occurrence of `highlight`. */
export function splitHighlight(text: string, highlight: string | undefined): TextPart[] {
  if (!highlight) return [{ text, hit: false }];
  const index = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (index < 0) return [{ text, hit: false }];
  const end = index + highlight.length;
  const parts: TextPart[] = [];
  if (index > 0) parts.push({ text: text.slice(0, index), hit: false });
  parts.push({ text: text.slice(index, end), hit: true });
  if (end < text.length) parts.push({ text: text.slice(end), hit: false });
  return parts;
}

export interface HeadlineProps {
  text: string | string[];
  highlight?: string | undefined;
  theme: Theme;
  locale: string;
  minPt: number;
  maxPt: number;
  /** Wrapped text only; explicit lines are never re-wrapped. Default 2. */
  maxLines?: number | undefined;
  lineHeight?: number | undefined;
  align?: 'left' | 'center' | undefined;
  style?: CSSProperties | undefined;
}

export function Headline({ text, highlight, theme, locale, minPt, maxPt, maxLines, lineHeight, align, style }: HeadlineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const explicit = Array.isArray(text);
  const cased = applyCase(explicit ? text.join('\n') : text, theme.headlineCase, locale);
  const lh = lineHeight ?? 1.06;
  useFitText(ref, cased, {
    minPt,
    maxPt,
    mode: explicit ? 'pre' : 'wrap',
    maxLines: explicit ? undefined : (maxLines ?? 2),
    lineHeight: lh,
  });
  const parts = splitHighlight(cased, highlight);
  const highlightColor = theme.highlight ?? theme.accent;
  return (
    <div
      ref={ref}
      data-s1s-id="headline"
      data-s1s-check=""
      style={{
        display: 'block',
        width: '100%',
        fontFamily: theme.fonts.headline,
        fontWeight: theme.headlineWeight,
        lineHeight: lh,
        letterSpacing: '-0.02em',
        whiteSpace: explicit ? 'pre' : 'normal',
        textWrap: explicit ? 'nowrap' : 'balance',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        hyphens: 'manual',
        textAlign: align ?? 'center',
        color: theme.text,
        ...style,
      }}
    >
      {parts.map((part, i) =>
        part.hit ? (
          <span key={i} data-s1s-id="highlight" style={{ color: highlightColor }}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}
