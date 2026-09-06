// The screenshot canvas: exactly preset.pt CSS px (= Apple points), a size
// container so templates can use cqw/cqh, and the theme as CSS variables.
import { Component, type CSSProperties, type ReactNode } from 'react';
import type { DeviceFamily, SizePreset, Theme } from '../../config/types.ts';
import { ErrorPanel } from './ErrorPanel.tsx';

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * React error boundaries must be classes (there is no hook form). A throwing
 * template renders an ErrorPanel inside the canvas instead of unmounting the
 * whole root, so the renderer attributes the failure to this screen at once
 * and the next screen on the same page still works.
 */
class TemplateBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const stack = (error.stack ?? '').split('\n').slice(1, 3).join('\n');
    return <ErrorPanel title="Template error" message={stack ? `${error.message}\n${stack}` : error.message} />;
  }
}

/** Reference canvas width per family; layouts are authored at this width and scaled. */
export const REF_WIDTH: Record<DeviceFamily, number> = { iphone: 440, ipad: 1032, watch: 416 };

/** Multiplier for layout numbers authored at REF_WIDTH (iphone-6.5 -> 0.97). */
export function layoutScale(preset: SizePreset): number {
  return preset.pt.width / REF_WIDTH[preset.family];
}

function themeVars(preset: SizePreset, theme: Theme): Record<string, string> {
  return {
    '--s1s-w': `${preset.pt.width}px`,
    '--s1s-h': `${preset.pt.height}px`,
    '--s1s-scale': String(preset.scale),
    '--s1s-family': preset.family,
    '--s1s-bg': theme.background,
    '--s1s-accent': theme.accent,
    '--s1s-text': theme.text,
    '--s1s-text-muted': theme.textMuted,
    '--s1s-highlight': theme.highlight ?? theme.accent,
    '--s1s-radius': `${theme.radius}px`,
    '--s1s-font-headline': theme.fonts.headline,
    '--s1s-font-body': theme.fonts.body,
    '--s1s-headline-weight': String(theme.headlineWeight),
  };
}

export interface CanvasProps {
  preset: SizePreset;
  theme: Theme;
  /** `<locale>/<sizeId>/<screenId>`; written to data-s1s-canvas. */
  id: string;
  /** Template id when the template is not guideline-compliant. */
  noncompliant?: string | undefined;
  children: ReactNode;
}

export function Canvas({ preset, theme, id, noncompliant, children }: CanvasProps) {
  const base: CSSProperties = {
    position: 'relative',
    width: preset.pt.width,
    height: preset.pt.height,
    overflow: 'hidden',
    containerType: 'size',
    background: theme.background,
    color: theme.text,
    fontFamily: theme.fonts.body,
    fontSize: 16,
    lineHeight: 1.3,
  };
  const style: CSSProperties = Object.assign({}, base, themeVars(preset, theme));
  return (
    <div
      data-s1s-canvas={id}
      data-s1s-family={preset.family}
      data-s1s-noncompliant={noncompliant}
      data-s1s-font-headline={theme.fonts.headline}
      data-s1s-font-body={theme.fonts.body}
      style={style}
    >
      <TemplateBoundary>{children}</TemplateBoundary>
    </div>
  );
}
