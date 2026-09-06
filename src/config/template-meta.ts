// Metadata for the built-in templates. DOM-free so Node can validate
// screens.ts and the CLI can list templates without loading React.
//
// `implemented` mirrors src/web/templates/<id>.tsx: a unit test asserts the
// two agree, so a phase that adds a template must flip the flag here.
import type { DeviceFamily } from './types.ts';

export type TemplatePhase = 'W1' | 'W2' | 'W6' | 'W7';

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
  /** Captures a screen must list (`capture: [a, b]`); default 1. loadProject rejects other counts. */
  captures?: number;
  /** Most `copy.callouts` entries the template shows; more is an overflow error (Node and browser). */
  callouts?: number;
}

/** Shared with src/web/templates/phone-watch.tsx so the module and the metadata stay identical. */
export const PHONE_WATCH_IPAD_VARIANT =
  "Watch at 30% of the iPad's width (iPhone 44%) with a smaller overhang, so it stays a companion beside a 13-inch canvas instead of a second subject.";

/** Shared with src/web/templates/two-device.tsx so the module and the metadata stay identical. */
export const TWO_DEVICE_IPAD_VARIANT =
  'Same stack with iPad proportions: 60%-wide devices, the front one 120 pt lower (iPhone: 56% and 88 pt, clear of the Dynamic Island). props.arrangement: "side" puts them side by side at equal scale.';

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
    ipadVariant: TWO_DEVICE_IPAD_VARIANT,
    compliant: true,
    implemented: true,
    phase: 'W2',
    description: 'Two captures (capture: [a, b]) in two upright devices overlapped, the front one lower; text on top.',
    captures: 2,
  },
  {
    id: 'feature-grid',
    families: ['ipad'],
    compliant: true,
    implemented: true,
    phase: 'W2',
    description: 'iPad only: device on the left, up to three callout cards (copy.callouts) on the right. Use overrides.ipad.',
    callouts: 3,
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
    implemented: true,
    phase: 'W6',
    description: 'Device cropped at the canvas bottom edge. Opt-in.',
  },
  {
    id: 'tilted',
    families: ['iphone', 'ipad'],
    compliant: false,
    implemented: true,
    phase: 'W6',
    description: 'Device rotated a few degrees. Opt-in.',
  },
  {
    id: 'watch-caption',
    families: ['watch'],
    compliant: true,
    implemented: true,
    phase: 'W6',
    description: 'Watch capture with a short caption. Opt-in.',
  },
  {
    id: 'phone-watch',
    families: ['iphone', 'ipad'],
    ipadVariant: PHONE_WATCH_IPAD_VARIANT,
    compliant: true,
    implemented: true,
    phase: 'W7',
    description:
      "hero-top-text plus an Apple Watch standing in front of the device's lower right corner, so a phone or iPad shopper sees the watch app. " +
      "Needs capture: [<phone>, 'watch-s10:<watch>']; props.watchVariant names the case and band.",
    captures: 2,
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
