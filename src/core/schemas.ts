// zod schemas for every input the Node side reads. Files that people and
// agents edit by hand (manifest.json, copy/*.json, bezels/index.json) are
// loose: unknown keys survive a read + write round trip. screens.ts and
// theme.ts are strict so a typo surfaces as an error instead of a no-op.
import { z } from 'zod';
import { ALL_SIZE_IDS, SIZE_PRESETS } from '../config/presets.ts';
import { CAPTURE_NAME_RE, CAPTURE_REF_RE, parseCaptureRef } from '../config/resolve.ts';
import { IMAGE_STATUSES } from '../config/types.ts';
import type {
  AppDisplayType,
  BezelIndex,
  DeviceFamily,
  LocaleCopy,
  ProjectManifest,
  ScreensConfig,
  Theme,
  WarningCode,
} from '../config/types.ts';
import { WARNING_LEVELS } from '../config/warnings.ts';
import { S1sError, type S1sErrorCode } from './errors.ts';

export const DEVICE_FAMILIES: readonly DeviceFamily[] = ['iphone', 'ipad', 'watch'];
const DISPLAY_TYPES = [...new Set(Object.values(SIZE_PRESETS).map((p) => p.displayType))] as AppDisplayType[];
const WARNING_CODES = Object.keys(WARNING_LEVELS) as WarningCode[];

export const deviceFamilySchema = z.enum(DEVICE_FAMILIES);
export const sizeIdSchema = z.enum(ALL_SIZE_IDS);
const overrideKeySchema = z.enum([...DEVICE_FAMILIES, ...ALL_SIZE_IDS]);

const positiveInt = z.number().int().positive();
export const dimsSchema = z.looseObject({ width: positiveInt, height: positiveInt });
const rectSchema = z.looseObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

// ---------------------------------------------------------------------------
// screens.ts
// ---------------------------------------------------------------------------

const FILE_SAFE_HINT = 'letters, digits, ".", "_" or "-" (what `s1s capture --name` accepts)';
// A ref may name another size first (`watch-s10:watch-lap`) so one canvas can
// show a second device; the regex allows the prefix and the refine rejects a
// prefix that names no preset, which would otherwise read as part of the name.
const captureRefSchema = z
  .string()
  .regex(CAPTURE_REF_RE, `capture name must be file-safe, optionally "<sizeId>:" first: ${FILE_SAFE_HINT}`)
  .refine((ref) => !parseCaptureRef(ref).unknownSize, {
    message: 'capture ref names a size that does not exist; use `s1s doctor` or drop the "<sizeId>:" prefix',
  });
const captureRefsSchema = z.union([captureRefSchema, z.array(captureRefSchema).min(1)]);
const propsSchema = z.record(z.string(), z.unknown());

export const screenOverrideSchema = z.strictObject({
  template: z.string().min(1).exactOptional(),
  capture: captureRefsSchema.exactOptional(),
  props: propsSchema.exactOptional(),
});

export const screenDefSchema = z.strictObject({
  id: z.string().regex(CAPTURE_NAME_RE, `screen id must be file-safe: ${FILE_SAFE_HINT}`),
  template: z.string().min(1).exactOptional(),
  capture: z
    .union([captureRefSchema, z.array(captureRefSchema).min(1), z.partialRecord(deviceFamilySchema, captureRefsSchema)])
    .exactOptional(),
  copyKey: z.string().min(1).exactOptional(),
  props: propsSchema.exactOptional(),
  overrides: z.partialRecord(overrideKeySchema, screenOverrideSchema).exactOptional(),
  locales: z.record(z.string(), screenOverrideSchema).exactOptional(),
  only: z.array(overrideKeySchema).exactOptional(),
  notes: z.string().exactOptional(),
});

export const screensConfigSchema: z.ZodType<ScreensConfig> = z.strictObject({
  screens: z.array(screenDefSchema),
  sizes: z.array(sizeIdSchema).min(1).exactOptional(),
  locales: z.array(z.string().min(1)).min(1).exactOptional(),
  panorama: z
    .strictObject({ image: z.string().min(1), screens: z.array(z.string()).exactOptional() })
    .exactOptional(),
});

// ---------------------------------------------------------------------------
// theme.ts
// ---------------------------------------------------------------------------

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be an sRGB hex colour such as #1c1c1e');

export const themeSchema: z.ZodType<Theme> = z.strictObject({
  background: hexColor,
  accent: hexColor,
  text: hexColor,
  textMuted: hexColor,
  highlight: hexColor.exactOptional(),
  fonts: z.strictObject({
    headline: z.string().min(1),
    body: z.string().min(1),
    portable: z.boolean().exactOptional(),
  }),
  headlineWeight: z.number().int().min(100).max(1000),
  headlineCase: z.enum(['title', 'sentence', 'upper']),
  bezelVariant: z.string().min(1),
  radius: z.number().min(0),
  shadow: z.string().exactOptional(),
});

// ---------------------------------------------------------------------------
// copy/<locale>.json
// ---------------------------------------------------------------------------

const textSchema = z.union([z.string(), z.array(z.string())], 'must be a string or an array of lines');

export const calloutCopySchema = z.looseObject({ title: z.string(), body: z.string().exactOptional() });

export const screenCopySchema = z.looseObject({
  headline: textSchema,
  highlight: z.string().exactOptional(),
  subline: textSchema.exactOptional(),
  badge: z.string().exactOptional(),
  callouts: z.array(calloutCopySchema).exactOptional(),
  layoutNotes: z.string().exactOptional(),
});

export const localeCopySchema: z.ZodType<LocaleCopy> = z.looseObject({
  locale: z.string().min(1),
  approved: z.boolean().exactOptional(),
  screens: z.record(z.string(), screenCopySchema),
  shared: z.record(z.string(), z.string()).exactOptional(),
});

// ---------------------------------------------------------------------------
// manifest.json (all loose; missing collections default to empty)
// ---------------------------------------------------------------------------

const optionalString = z.string().exactOptional();

export const warningSchema = z.looseObject({
  code: z.enum(WARNING_CODES),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  element: optionalString,
});

export const imageStateSchema = z.looseObject({
  status: z.enum(IMAGE_STATUSES).default('pending'),
  capture: optionalString,
  captureSha256: optionalString,
  capturePx: dimsSchema.exactOptional(),
  captureRating: z.enum(['great', 'usable', 'retake']).exactOptional(),
  captureNotes: optionalString,
  render: optionalString,
  renderHash: optionalString,
  renderWarnings: z.array(warningSchema).exactOptional(),
  renderedAt: optionalString,
  export: optionalString,
  exportSha256: optionalString,
  storeFileName: optionalString,
  uploadedAt: optionalString,
  wasUploaded: z.boolean().exactOptional(),
});

const manifestLocaleDeviceSchema = z.looseObject({
  screens: z.record(z.string(), imageStateSchema).default({}),
});

export const manifestLocaleSchema = z.looseObject({
  copyStatus: z.enum(['pending', 'draft', 'approved']).default('pending'),
  captureSource: z.union([z.literal('own'), z.templateLiteral(['reuse:', z.string()])]).default('own'),
  versionId: optionalString,
  versionString: optionalString,
  versionLocalizationId: optionalString,
  devices: z.partialRecord(sizeIdSchema, manifestLocaleDeviceSchema).default({}),
});

export const manifestAppSchema = z.looseObject({
  name: z.string(),
  bundleId: z.string(),
  watchBundleId: optionalString,
  appId: optionalString,
  project: optionalString,
  scheme: optionalString,
  deviceFamilies: z.array(deviceFamilySchema).default([]),
  /** '' = unset; Project falls back to the first configured locale. */
  sourceLocale: z.string().default(''),
  appLocales: z.array(z.string()).default([]),
  metadataDir: z.string().default('metadata/screenshots'),
});

export const manifestSizeSchema = z.looseObject({
  displayType: z.enum(DISPLAY_TYPES),
  token: z.string(),
  px: dimsSchema,
  simulator: z.string(),
  udid: optionalString,
  framed: z.boolean(),
});

const manifestDemoDataSchema = z.looseObject({
  patch: optionalString,
  branch: optionalString,
  baseCommit: optionalString,
  envFlag: optionalString,
  launchArg: optionalString,
  appliedAt: optionalString,
  revertedAt: optionalString,
});

const manifestCapturePlanSchema = z.looseObject({
  steps: z.array(z.string()).default([]),
  deepLink: optionalString,
  dataState: optionalString,
  notes: optionalString,
});

const manifestScreenSchema = z.looseObject({
  id: z.string(),
  order: z.number().int(),
  benefit: optionalString,
  template: optionalString,
  sizes: z.array(sizeIdSchema).default([]),
  capture: manifestCapturePlanSchema.exactOptional(),
});

const manifestRunSchema = z.looseObject({
  command: z.string(),
  startedAt: z.string(),
  finishedAt: optionalString,
  ok: z.boolean().exactOptional(),
  notes: optionalString,
});

export const manifestSchema: z.ZodType<ProjectManifest> = z.looseObject({
  version: z.literal(1),
  app: manifestAppSchema,
  sizes: z.partialRecord(sizeIdSchema, manifestSizeSchema).default({}),
  demoData: manifestDemoDataSchema.exactOptional(),
  screens: z.array(manifestScreenSchema).default([]),
  locales: z.record(z.string(), manifestLocaleSchema).default({}),
  runs: z.array(manifestRunSchema).default([]),
});

// ---------------------------------------------------------------------------
// ~/.screen1shoter/bezels/index.json
// ---------------------------------------------------------------------------

export const bezelEntrySchema = z.looseObject({
  id: z.string(),
  variant: z.string(),
  file: z.string(),
  imageSize: dimsSchema,
  deviceRect: rectSchema,
  screenRect: rectSchema,
  cornerRadius: z.number(),
  islandRect: rectSchema.exactOptional(),
  orientation: z.enum(['portrait', 'landscape']),
  screenAspect: z.number(),
  pxPerPt: z.number().exactOptional(),
});

export const bezelIndexSchema: z.ZodType<BezelIndex> = z.looseObject({
  version: z.literal(1),
  updatedAt: z.string(),
  entries: z.array(bezelEntrySchema),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "screens.0.id: expected string; theme.radius: too small" */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** safeParse + S1sError with a readable issue list. `label` names the file. */
export function parseWith<T>(schema: z.ZodType<T>, value: unknown, code: S1sErrorCode, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new S1sError(code, `${label}: ${formatIssues(result.error)}`);
  return result.data;
}
