// Whole upright device on top, text block below.
import type { TemplateModule } from '../../runtime/index.ts';
import { FramedScreen, framedFamily, type FramedFamily, type FramedLayout } from './hero-top-text.tsx';

export const LAYOUT: Record<FramedFamily, FramedLayout> = {
  iphone: {
    padX: 30,
    padTop: 36,
    padBottom: 40,
    textHeight: 172,
    gap: 22,
    textGap: 10,
    headline: { min: 28, max: 46, maxLines: 2 },
    subline: { min: 15, max: 21, maxLines: 2 },
    badge: 12,
    deviceMaxWidth: 0.82,
  },
  ipad: {
    padX: 80,
    padTop: 56,
    padBottom: 60,
    textHeight: 258,
    gap: 30,
    textGap: 14,
    headline: { min: 40, max: 72, maxLines: 2 },
    subline: { min: 22, max: 32, maxLines: 2 },
    badge: 17,
    deviceMaxWidth: 0.84,
  },
};

const textBottom: TemplateModule = {
  id: 'text-bottom',
  families: ['iphone', 'ipad'],
  compliant: true,
  Component: (props) => <FramedScreen props={props} layout={LAYOUT[framedFamily(props)]} order="device-first" />,
};

export default textBottom;
