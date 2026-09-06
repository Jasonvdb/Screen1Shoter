// Public "screen1shoter" browser entry for custom templates.
//
// App projects import from here (`import { defineTemplate, Canvas } from
// 'screen1shoter'`) via the Vite alias in src/render/server.ts. Everything in
// src/config is re-exported so a template never needs a second import.
import type { ReactElement } from 'react';
import type { DeviceFamily, ResolvedScreen, ScreenCopy, SizePreset, Theme } from '../config/index.ts';

export * from '../config/index.ts';

export interface TemplateProps {
  screen: ResolvedScreen;
  preset: SizePreset;
  theme: Theme;
  copy: ScreenCopy | undefined;
  mode: 'render' | 'dev';
}

export interface TemplateModule {
  id: string;
  families: DeviceFamily[];
  ipadVariant?: string;
  /** false = breaks Apple's marketing guidelines; the canvas is tagged data-s1s-noncompliant. */
  compliant?: boolean;
  Component: (props: TemplateProps) => ReactElement;
}

/** Identity helper that type-checks a project template module. */
export function defineTemplate(module: TemplateModule): TemplateModule {
  return module;
}

// Component library and hooks.
export { Canvas, layoutScale, REF_WIDTH } from '../web/components/Canvas.tsx';
export { Background, backgroundSpecFrom } from '../web/components/Background.tsx';
export type { BackgroundSpec } from '../web/components/Background.tsx';
export { FitBox, fitInto } from '../web/components/FitBox.tsx';
export { DeviceFrame } from '../web/components/DeviceFrame.tsx';
export type { FrameGeometry } from '../web/components/DeviceFrame.tsx';
export { GenericBezel, genericGeometry } from '../web/components/GenericBezel.tsx';
export { Headline, applyCase, splitHighlight } from '../web/components/Headline.tsx';
export { Caption } from '../web/components/Caption.tsx';
export { Badge, readableOn } from '../web/components/Badge.tsx';
export { Callout, TITLE_LINES, BODY_LINES } from '../web/components/Callout.tsx';
export type { CalloutProps, CalloutSizes } from '../web/components/Callout.tsx';
export { MissingCapture } from '../web/components/MissingCapture.tsx';
export { useFitText } from '../web/hooks/useFitText.ts';
export { chooseSize } from '../web/hooks/fit.ts';
export type { FitOptions } from '../web/hooks/useFitText.ts';
export type { ChooseSizeInput, ChooseSizeResult } from '../web/hooks/fit.ts';
export { useBezel } from '../web/hooks/useBezel.ts';
export type { BezelLookup } from '../web/hooks/useBezel.ts';
export { useCapture, captureUrl, placeholderCapture } from '../web/hooks/useCapture.ts';
export { acquire, ensureFonts, fontFamiliesOf } from '../web/runtime/ready.ts';
