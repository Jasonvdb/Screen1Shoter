// Shared, DOM-free types for Screen1Shoter.
//
// Imported by the Node side (CLI, renderer), the browser runtime, and every app
// project's `screenshots/screens.ts` / `theme.ts` (via "screen1shoter/config").
// Keep this file free of runtime dependencies and browser or Node globals.

// ---------------------------------------------------------------------------
// Devices and sizes
// ---------------------------------------------------------------------------

export type DeviceFamily = 'iphone' | 'ipad' | 'watch';

export type SizeId =
  | 'iphone-6.9'
  | 'iphone-6.7'
  | 'iphone-6.5'
  | 'iphone-6.1'
  | 'ipad-13'
  | 'ipad-11'
  | 'watch-s10';

/** App Store Connect display type; also the export folder name. */
export type AppDisplayType =
  | 'APP_IPHONE_69'
  | 'APP_IPHONE_67'
  | 'APP_IPHONE_65'
  | 'APP_IPHONE_61'
  | 'APP_IPAD_PRO_3GEN_129'
  | 'APP_IPAD_PRO_3GEN_11'
  | 'APP_WATCH_SERIES_10';

export interface Dims {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SizePreset {
  id: SizeId;
  family: DeviceFamily;
  /** Export folder under metadata/screenshots/<locale>/ and out/<locale>/. */
  displayType: AppDisplayType;
  /** Value for `asc screenshots upload --device-type`. */
  deviceTypeToken: string;
  /** Exact output PNG size. Always equals pt * scale. */
  px: Dims;
  /** Browser viewport in CSS px (= Apple points). */
  pt: Dims;
  /** Playwright deviceScaleFactor. */
  scale: number;
  /** Every portrait size App Store Connect accepts for `displayType`. */
  acceptedDims: Dims[];
  /** Preferred bezel id in the bezel cache (see BezelEntry.id). */
  bezel: string;
  /** Bezel ids to try, in order, when `bezel` is not installed. */
  bezelFallbacks: string[];
  /** Expected size of a simulator screenshot for this preset. */
  captureDims: Dims;
  /** `xcrun simctl` device name that produces `captureDims`. */
  simulatorName: string;
  /** The capture is copied to the output unchanged; the browser is skipped. */
  passthrough?: boolean;
  /** Renders once as the target preset; exports to this preset's own folder. */
  aliasOf?: SizeId;
}

// ---------------------------------------------------------------------------
// screens.ts
// ---------------------------------------------------------------------------

/** Capture name: file basename (no extension) under captures/<locale>/<family>/. */
export type CaptureRef = string;

/**
 * One capture, several captures (multi-device templates), or a per-family map.
 * When omitted the screen id is used as the capture name.
 */
export type CaptureSpec =
  | CaptureRef
  | CaptureRef[]
  | Partial<Record<DeviceFamily, CaptureRef | CaptureRef[]>>;

/** Fields a family, size or locale override may replace. */
export interface ScreenOverride {
  template?: string;
  capture?: CaptureRef | CaptureRef[];
  props?: Record<string, unknown>;
}

export interface ScreenDef {
  /** Stable id: used for copy lookup, capture name, and output file names. */
  id: string;
  /** Template id (built-in or from templates/index.ts). Default per family. */
  template?: string;
  capture?: CaptureSpec;
  /** Key in copy/<locale>.json `screens`. Default: id. */
  copyKey?: string;
  /** Template-specific props. Shallow-merged with overrides. */
  props?: Record<string, unknown>;
  /** Keyed by family ('iphone') or size id ('iphone-6.9'). Size wins over family. */
  overrides?: Partial<Record<DeviceFamily | SizeId, ScreenOverride>>;
  /** Keyed by locale ('de-DE'). Applied last. */
  locales?: Record<string, ScreenOverride>;
  /** Restrict the screen to these families and/or size ids. */
  only?: Array<DeviceFamily | SizeId>;
  notes?: string;
}

/** A wide background image shared across consecutive screens. */
export interface PanoramaConfig {
  /** Path relative to the project dir, e.g. 'assets/panorama.png'. */
  image: string;
  /** Screen ids that take a slice, in order. Default: every screen. */
  screens?: string[];
}

export interface ScreensConfig {
  screens: ScreenDef[];
  /** Size ids to render. Default: DEFAULT_SIZES (iphone-6.9, ipad-13). */
  sizes?: SizeId[];
  /** Locales with copy files. Default: ['en-US']. First entry is the source locale. */
  locales?: string[];
  panorama?: PanoramaConfig;
}

export function defineScreens(config: ScreensConfig): ScreensConfig {
  return config;
}

// ---------------------------------------------------------------------------
// theme.ts
// ---------------------------------------------------------------------------

export type HeadlineCase = 'title' | 'sentence' | 'upper';

export interface ThemeFonts {
  /** CSS font-family stack for headlines. */
  headline: string;
  /** CSS font-family stack for body text. */
  body: string;
  /** Force the bundled Inter font (identical output on every machine). */
  portable?: boolean;
}

export interface Theme {
  /** sRGB hex. Also used to flatten alpha in post-processing. */
  background: string;
  accent: string;
  text: string;
  textMuted: string;
  highlight?: string;
  fonts: ThemeFonts;
  headlineWeight: number;
  headlineCase: HeadlineCase;
  /** Bezel colour variant id (e.g. 'deep-blue'); 'auto' = first installed. */
  bezelVariant: string;
  /** Corner radius in pt for cards, badges and callouts. */
  radius: number;
  /** CSS box-shadow for cards; undefined = none. */
  shadow?: string;
}

/** Required colours plus any Theme field to override the defaults. */
export type ThemeInput = Pick<Theme, 'background' | 'accent' | 'text'> & Partial<Theme>;

export const DEFAULT_HEADLINE_FONT =
  '-apple-system, "SF Pro Display", "Inter Variable", "Inter", system-ui, sans-serif';
export const DEFAULT_BODY_FONT =
  '-apple-system, "SF Pro Text", "Inter Variable", "Inter", system-ui, sans-serif';
export const PORTABLE_FONT = '"Inter Variable", "Inter", system-ui, sans-serif';

/** `portable: true` replaces both stacks with the bundled Inter so every machine renders the same pixels. */
export function resolveFonts(input: ThemeFonts | undefined): ThemeFonts {
  if (input === undefined) return { headline: DEFAULT_HEADLINE_FONT, body: DEFAULT_BODY_FONT };
  return input.portable ? { ...input, headline: PORTABLE_FONT, body: PORTABLE_FONT } : input;
}

export function defineTheme(input: ThemeInput): Theme {
  const fonts = resolveFonts(input.fonts);
  const theme: Theme = {
    background: input.background,
    accent: input.accent,
    text: input.text,
    textMuted: input.textMuted ?? input.text,
    highlight: input.highlight ?? input.accent,
    fonts,
    headlineWeight: input.headlineWeight ?? 700,
    headlineCase: input.headlineCase ?? 'title',
    bezelVariant: input.bezelVariant ?? 'auto',
    radius: input.radius ?? 16,
  };
  if (input.shadow !== undefined) theme.shadow = input.shadow;
  return theme;
}

// ---------------------------------------------------------------------------
// copy/<locale>.json
// ---------------------------------------------------------------------------

export interface CalloutCopy {
  title: string;
  body?: string;
}

export interface ScreenCopy {
  /** A string, or explicit lines (each rendered with white-space: pre). */
  headline: string | string[];
  /** Substring of the headline to colour with theme.highlight. */
  highlight?: string;
  subline?: string | string[];
  badge?: string;
  callouts?: CalloutCopy[];
  /** Free-form note for translators / the agent. Never rendered. */
  layoutNotes?: string;
  /** Extra fields consumed by custom templates. */
  [templateField: string]: unknown;
}

export interface LocaleCopy {
  locale: string;
  approved?: boolean;
  screens: Record<string, ScreenCopy>;
  /** Strings shared by several screens (app name, tagline). */
  shared?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Resolution (screens.ts x preset x locale x copy)
// ---------------------------------------------------------------------------

export type CaptureFallback = 'none' | 'source-locale' | 'placeholder';

export interface CaptureSource {
  requested: CaptureRef;
  family: DeviceFamily;
  /** Locale the file was requested for. */
  locale: string;
  /**
   * Project-relative posix path of the file that will be used, e.g.
   * 'captures/en-US/iphone/home.png'. Node joins it with the project dir;
   * the browser loads '/project/' + resolvedPath. null = placeholder.
   */
  resolvedPath: string | null;
  /** Locale whose file was used ('en-US' after a source-locale fallback). */
  usedLocale: string;
  fallback: CaptureFallback;
  /** Pixel size of the file, or null when it is missing. */
  dims: Dims | null;
}

/** Maps a capture name to a file for a given preset and locale. */
export type CaptureResolver = (ref: CaptureRef, preset: SizePreset, locale: string) => CaptureSource;

export interface ResolvedScreen {
  id: string;
  locale: string;
  sizeId: SizeId;
  family: DeviceFamily;
  template: string;
  copyKey: string;
  /** undefined -> a `copy-missing` warning. */
  copy: ScreenCopy | undefined;
  captures: CaptureSource[];
  props: Record<string, unknown>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Bezels (~/.screen1shoter/bezels/index.json)
// ---------------------------------------------------------------------------

export interface BezelEntry {
  /** e.g. 'iphone-17-pro-max' */
  id: string;
  /** e.g. 'deep-blue' */
  variant: string;
  /** Path relative to the bezel dir: '<id>/<variant>.png'. */
  file: string;
  imageSize: Dims;
  /** Opaque device outline (alpha > 12) inside the trimmed image. */
  deviceRect: Rect;
  /** Transparent screen cut-out. */
  screenRect: Rect;
  cornerRadius: number;
  /** Opaque Dynamic Island inside the screen, when present. */
  islandRect?: Rect;
  orientation: 'portrait' | 'landscape';
  /** screenRect.width / screenRect.height */
  screenAspect: number;
  /** Bezel pixels per Apple point, from the matching preset. */
  pxPerPt?: number;
}

export interface BezelIndex {
  version: 1;
  updatedAt: string;
  entries: BezelEntry[];
}

// ---------------------------------------------------------------------------
// Warnings and render reports
// ---------------------------------------------------------------------------

export type WarningCode =
  | 'capture-missing'
  | 'capture-fallback-locale'
  | 'capture-dims'
  | 'text-min-size'
  | 'text-clipped'
  | 'overflow'
  | 'image-missing'
  | 'copy-missing'
  | 'copy-unused'
  | 'bezel-fallback'
  | 'font-fallback'
  /** The render item failed (browser error, timeout, post-processing); stored in the manifest. */
  | 'render-failed';

export type WarningLevel = 'info' | 'warn' | 'error';

export interface Warning {
  code: WarningCode;
  level: WarningLevel;
  message: string;
  /** CSS selector or data-attribute hint for the offending element. */
  element?: string;
}

/** One file written for a render item (aliases produce several). */
export interface RenderOutput {
  /** The size id as requested (may be an alias such as 'iphone-6.7'). */
  sizeId: SizeId;
  displayType: AppDisplayType;
  /** Absolute: out/<locale>/<displayType>/NN-<id>.png */
  outPath: string;
  /** Absolute: out/<locale>/<displayType>/preview/NN-<id>.png */
  previewPath: string;
}

export interface RenderItem {
  /** `${locale}/${preset.id}/${screen.id}` */
  key: string;
  locale: string;
  /** The preset actually rendered (never an alias). */
  preset: SizePreset;
  /** 1-based position within the set for this preset. */
  ordinal: number;
  screen: ResolvedScreen;
  /** Hash route, path only: `/#/render/<locale>/<sizeId>/<screenId>`. */
  url: string;
  outputs: RenderOutput[];
  /** Watch: copy the capture, skip the browser. */
  passthrough: boolean;
}

export type RenderItemStatus = 'rendered' | 'passthrough' | 'skipped' | 'failed';

export interface RenderReportItem {
  key: string;
  locale: string;
  sizeId: SizeId;
  displayTypes: AppDisplayType[];
  screenId: string;
  ordinal: number;
  template: string;
  status: RenderItemStatus;
  /** Absolute paths written (every display-type copy). */
  outputs: string[];
  preview: string | null;
  /** sha1 hex of the final PNG bytes. */
  hash: string | null;
  dims: Dims | null;
  warnings: Warning[];
  durationMs: number;
  /** Failure reason; present only when status is 'failed'. */
  error?: string;
}

export interface RenderReport {
  version: 1;
  generatedAt: string;
  projectDir: string;
  locale: string;
  sizes: SizeId[];
  dryRun: boolean;
  items: RenderReportItem[];
  counts: {
    rendered: number;
    failed: number;
    skipped: number;
    errors: number;
    warns: number;
    infos: number;
  };
  /** false when any item failed or carries an error-level warning. */
  ok: boolean;
  /** Contact sheets this run wrote (empty for dry runs, --no-sheet, or a failed sheet step). */
  sheets: RenderSheet[];
}

/** One out/<locale>/sheet-<sizeId>.png written by the render (or `s1s sheet`). */
export interface RenderSheet {
  sizeId: SizeId;
  displayType: AppDisplayType;
  /** Absolute path. */
  path: string;
  dims: Dims;
  /** Screens tiled on the sheet. */
  tiles: number;
}

// ---------------------------------------------------------------------------
// screenshots/manifest.json (one file, all locales)
// ---------------------------------------------------------------------------

export type ImageStatus =
  | 'pending'
  | 'copy-approved'
  | 'captured'
  | 'generated'
  | 'image-approved'
  | 'exported'
  | 'uploaded';

export const IMAGE_STATUSES: readonly ImageStatus[] = [
  'pending',
  'copy-approved',
  'captured',
  'generated',
  'image-approved',
  'exported',
  'uploaded',
];

export type CaptureRating = 'great' | 'usable' | 'retake';

export interface ManifestApp {
  name: string;
  bundleId: string;
  watchBundleId?: string;
  /** App Store Connect app id. */
  appId?: string;
  /** .xcodeproj / .xcworkspace path relative to the app repo. */
  project?: string;
  scheme?: string;
  deviceFamilies: DeviceFamily[];
  sourceLocale: string;
  /** Locales the app itself ships (drives own-capture vs reuse). */
  appLocales: string[];
  /** Relative to the app repo. Default 'metadata/screenshots'. */
  metadataDir: string;
}

export interface ManifestSize {
  displayType: AppDisplayType;
  token: string;
  px: Dims;
  simulator: string;
  udid?: string;
  framed: boolean;
}

export interface ManifestDemoData {
  patch?: string;
  branch?: string;
  baseCommit?: string;
  envFlag?: string;
  launchArg?: string;
  appliedAt?: string;
  revertedAt?: string;
}

export interface ManifestCapturePlan {
  steps: string[];
  deepLink?: string;
  dataState?: string;
  notes?: string;
}

export interface ManifestScreen {
  id: string;
  order: number;
  benefit?: string;
  template?: string;
  sizes: SizeId[];
  capture?: ManifestCapturePlan;
}

/** State of one image: locale x size x screen. CLI owns file fields, the agent owns status/rating/notes. */
export interface ImageState {
  status: ImageStatus;
  capture?: string;
  captureSha256?: string;
  capturePx?: Dims;
  captureRating?: CaptureRating;
  captureNotes?: string;
  render?: string;
  renderHash?: string;
  renderWarnings?: Warning[];
  renderedAt?: string;
  export?: string;
  exportSha256?: string;
  storeFileName?: string;
  uploadedAt?: string;
  /** Set when the render hash changed after an upload. */
  wasUploaded?: boolean;
}

export interface ManifestLocaleDevice {
  screens: Record<string, ImageState>;
}

export type CopyStatus = 'pending' | 'draft' | 'approved';

export interface ManifestLocale {
  copyStatus: CopyStatus;
  /** 'own' = captured in this locale; 'reuse:<locale>' = reuse another locale's captures. */
  captureSource: 'own' | `reuse:${string}`;
  versionId?: string;
  versionString?: string;
  versionLocalizationId?: string;
  devices: Partial<Record<SizeId, ManifestLocaleDevice>>;
}

export interface ManifestRun {
  command: string;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  notes?: string;
}

export interface ProjectManifest {
  version: 1;
  app: ManifestApp;
  sizes: Partial<Record<SizeId, ManifestSize>>;
  demoData?: ManifestDemoData;
  screens: ManifestScreen[];
  locales: Record<string, ManifestLocale>;
  runs: ManifestRun[];
}

// ---------------------------------------------------------------------------
// /__s1s/project.json (served by the Vite plugin to the browser)
// ---------------------------------------------------------------------------

export interface ProjectJson {
  version: 1;
  mode: 'render' | 'dev';
  projectDir: string;
  sizes: SizeId[];
  locales: string[];
  sourceLocale: string;
  /** Every locale that has a copy file. */
  copies: Record<string, LocaleCopy>;
  manifest: ProjectManifest;
  /** Keyed by captureKey(locale, family, ref). */
  captures: Record<string, CaptureSource>;
  bezels: BezelIndex | null;
}
