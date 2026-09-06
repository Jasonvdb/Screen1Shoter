// Metadata for the built-in templates. DOM-free so Node can validate
// screens.ts and the CLI can list templates without loading React.
//
// `implemented` mirrors src/web/templates/<id>.tsx: a unit test asserts the
// two agree, so a phase that adds a template must flip the flag here.
import type { DeviceFamily } from './types.ts';

export type TemplatePhase = 'W1' | 'W2' | 'W6';

export interface TemplateMeta {
  id: string;
  /** Families the template has a layout for. */
  families: DeviceFamily[];
  /** How the iPad branch differs from the iPhone one, when it does. */
  ipadVariant?: string;
  /** false = breaks Apple's marketing guidelines (opt-in; noted in review.md). */
  compliant: boolean;
  /** true once src/web/templates/<id>.tsx exists and is registered. */
  implemented: boolean;
  /** Phase that ships (or shipped) the template. */
  phase: TemplatePhase;
  description: string;
}

export const BUILTIN_TEMPLATES: readonly TemplateMeta[] = [
  {
    id: 'hero-top-text',
    families: ['iphone', 'ipad'],
    ipadVariant: 'Device width up to 84% (iPhone 82%); text block keeps two lines.',
    compliant: true,
    implemented: true,
    phase: 'W1',
    description: 'Headline and subline on top, whole upright device below. Default.',
  },
  {
    id: 'text-bottom',
    families: ['iphone', 'ipad'],
    compliant: true,
    implemented: true,
    phase: 'W1',
    description: 'Whole upright device on top, headline and subline below.',
  },
  {
    id: 'two-device',
    families: ['iphone', 'ipad'],
    ipadVariant: 'Devices side by side at equal scale; text above.',
    compliant: true,
    implemented: false,
    phase: 'W2',
    description: 'Two captures in two upright devices, text on top.',
  },
  {
    id: 'feature-grid',
    families: ['iphone', 'ipad'],
    ipadVariant: 'Device on the left, up to three callout cards on the right.',
    compliant: true,
    implemented: false,
    phase: 'W2',
    description: 'Device plus callout cards listing features.',
  },
  {
    id: 'raw',
    families: ['iphone', 'ipad', 'watch'],
    compliant: true,
    implemented: true,
    phase: 'W1',
    description: 'Unframed capture filling the canvas. Default for watch.',
  },
  {
    id: 'bleed-bottom',
    families: ['iphone', 'ipad'],
    compliant: false,
    implemented: false,
    phase: 'W6',
    description: 'Device cropped at the canvas bottom edge. Opt-in.',
  },
  {
    id: 'tilted',
    families: ['iphone', 'ipad'],
    compliant: false,
    implemented: false,
    phase: 'W6',
    description: 'Device rotated a few degrees. Opt-in.',
  },
  {
    id: 'watch-caption',
    families: ['watch'],
    compliant: true,
    implemented: false,
    phase: 'W6',
    description: 'Watch capture with a short caption. Opt-in.',
  },
];

export const DEFAULT_TEMPLATE: Record<DeviceFamily, string> = {
  iphone: 'hero-top-text',
  ipad: 'hero-top-text',
  watch: 'raw',
};

export function templateMeta(id: string): TemplateMeta | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

export function isBuiltinTemplate(id: string): boolean {
  return templateMeta(id) !== undefined;
}

/** Ids the browser can render today, in registry order. */
export function implementedTemplateIds(): string[] {
  return BUILTIN_TEMPLATES.filter((t) => t.implemented).map((t) => t.id);
}
