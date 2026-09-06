// Pure resolution of a ScreenDef for one preset and locale:
//   base < overrides[family] < overrides[sizeId] < locales[locale]
// Runs in Node (matrix) and in the browser (render/gallery pages) with a
// CaptureResolver injected by each side.
import { panoramaBackground, panoramaSlice } from './panorama.ts';
import { SIZE_PRESETS, isSizeId } from './presets.ts';
import { DEFAULT_TEMPLATE } from './template-meta.ts';
import type {
  CaptureRef,
  CaptureResolver,
  CaptureSpec,
  DeviceFamily,
  LocaleCopy,
  ResolvedScreen,
  ScreenDef,
  ScreenOverride,
  ScreensConfig,
  SizeId,
  SizePreset,
} from './types.ts';

/** `only` filter: a screen applies when it names the preset's family or id. */
export function screenAppliesTo(screen: ScreenDef, preset: SizePreset): boolean {
  if (!screen.only || screen.only.length === 0) return true;
  return screen.only.includes(preset.family) || screen.only.includes(preset.id);
}

function toRefs(value: CaptureRef | CaptureRef[] | undefined): CaptureRef[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? [...value] : [value];
}

function baseCaptures(spec: CaptureSpec | undefined, family: DeviceFamily): CaptureRef[] | undefined {
  if (spec === undefined) return undefined;
  if (typeof spec === 'string' || Array.isArray(spec)) return toRefs(spec);
  return toRefs(spec[family]);
}

function overrideLayers(screen: ScreenDef, preset: SizePreset, locale: string): ScreenOverride[] {
  const layers: Array<ScreenOverride | undefined> = [
    screen.overrides?.[preset.family],
    screen.overrides?.[preset.id],
    screen.locales?.[locale],
  ];
  return layers.filter((layer): layer is ScreenOverride => layer !== undefined);
}

export interface ResolveOptions {
  /**
   * The whole config, so a project-level `panorama` can be cut into the slice
   * this screen shows. Omitted (matrix probes, capture planning) means no
   * panorama is injected.
   */
  config?: ScreensConfig | undefined;
}

export function resolveScreen(
  screen: ScreenDef,
  preset: SizePreset,
  locale: string,
  copy: LocaleCopy | undefined,
  captureResolver: CaptureResolver,
  opts?: ResolveOptions,
): ResolvedScreen {
  const family = preset.family;
  let template = screen.template ?? DEFAULT_TEMPLATE[family];
  let captures = baseCaptures(screen.capture, family) ?? [screen.id];
  let props: Record<string, unknown> = { ...screen.props };

  for (const layer of overrideLayers(screen, preset, locale)) {
    if (layer.template !== undefined) template = layer.template;
    const refs = toRefs(layer.capture);
    if (refs !== undefined) captures = refs;
    if (layer.props !== undefined) props = { ...props, ...layer.props };
  }

  // The panorama is a project-wide default. An explicit props.background on the
  // screen (or on any override layer) is what the author asked for for this one
  // screen, so it wins and the screen simply drops out of the seam.
  if (opts?.config !== undefined && props['background'] === undefined) {
    const slice = panoramaSlice(opts.config, screen.id);
    if (slice !== null) props = { ...props, background: panoramaBackground(slice) };
  }

  const copyKey = screen.copyKey ?? screen.id;
  const resolved: ResolvedScreen = {
    id: screen.id,
    locale,
    sizeId: preset.id,
    family,
    template,
    copyKey,
    copy: copy?.screens[copyKey],
    // A `<sizeId>:` prefix sends the ref to that size's preset, so the file is
    // looked up under its own family and checked against its own dimensions.
    captures: captures.map((ref) => captureResolver(ref, captureRefPreset(ref, preset), locale)),
    props,
  };
  if (screen.notes !== undefined) resolved.notes = screen.notes;
  return resolved;
}

/**
 * File-safe name for screen ids and capture refs: what `s1s capture --name`
 * accepts is exactly what screens.ts may reference (no spaces, no path parts).
 */
export const CAPTURE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A capture reference: a bare name, or `<sizeId>:<name>` for a capture that
 * belongs to another size. The prefixed form is how one canvas shows another
 * device (phone-watch puts a watch capture on an iPhone frame); without it the
 * ref would resolve under the rendering family and look for a 1320x2868 file
 * in captures/<locale>/watch/.
 */
export const CAPTURE_REF_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*:)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface CaptureRefParts {
  /** Size named by the prefix, or null for a bare name. */
  sizeId: SizeId | null;
  /** The name on disk: `captures/<locale>/<family>/<name>.png`. */
  name: string;
  /** True when a prefix was written but names no known size. */
  unknownSize: boolean;
}

/** Splits `<sizeId>:<name>`. An unknown prefix stays part of nothing: the name wins and the caller reports it. */
export function parseCaptureRef(ref: CaptureRef): CaptureRefParts {
  const colon = ref.indexOf(':');
  if (colon < 0) return { sizeId: null, name: ref, unknownSize: false };
  const prefix = ref.slice(0, colon);
  const name = ref.slice(colon + 1);
  if (isSizeId(prefix)) return { sizeId: prefix, name, unknownSize: false };
  return { sizeId: null, name, unknownSize: true };
}

/**
 * The preset a ref resolves against: the one it names, else the one being
 * rendered. This is what decides the capture's family (so its directory) and
 * the dimensions it is checked against.
 */
export function captureRefPreset(ref: CaptureRef, preset: SizePreset): SizePreset {
  const { sizeId } = parseCaptureRef(ref);
  return sizeId === null ? preset : SIZE_PRESETS[sizeId];
}

/** Key for ProjectJson.captures and capture caches. Two refs naming one file share a key. */
export function captureKey(locale: string, family: DeviceFamily, ref: CaptureRef): string {
  return `${locale}/${family}/${parseCaptureRef(ref).name}`;
}

/** Project-relative posix path of a capture file. */
export function captureRelPath(locale: string, family: DeviceFamily, ref: CaptureRef): string {
  return `captures/${locale}/${family}/${parseCaptureRef(ref).name}.png`;
}

/** Selector of the browser placeholder for a capture; Node and browser 'capture-missing' warnings share it. */
export function missingCaptureElement(ref: CaptureRef): string {
  return `[data-s1s-capture-missing="${ref}"]`;
}

/** 1 -> '01'. App Store sets hold at most 10 screenshots, so two digits suffice. */
export function formatOrdinal(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 99) {
    throw new Error(`Ordinal out of range: ${ordinal}`);
  }
  return String(ordinal).padStart(2, '0');
}

/** File name inside out/<locale>/<displayType>/: 'NN-<id>.png'. */
export function renderFileName(ordinal: number, screenId: string): string {
  return `${formatOrdinal(ordinal)}-${screenId}.png`;
}

/** File name inside metadata/screenshots/<locale>/<displayType>/: 'NN.png'. */
export function exportFileName(ordinal: number): string {
  return `${formatOrdinal(ordinal)}.png`;
}

/**
 * The only names an export set may hold: '01.png', '07.jpg', '10.jpeg'.
 * `s1s export --prune` deletes by it and `s1s validate` rejects by it, so the
 * two commands must never disagree about what a set file is called.
 */
export const EXPORT_FILE_RE = /^(\d{2})\.(png|jpe?g)$/;

/** Ordinal of an export file name ('03.png' -> 3), or null when it is not one. */
export function exportOrdinal(name: string): number | null {
  const digits = EXPORT_FILE_RE.exec(name)?.[1];
  return digits === undefined ? null : Number.parseInt(digits, 10);
}

/** Hash route for one render item. */
export function renderRoute(locale: string, sizeId: string, screenId: string): string {
  return `/#/render/${encodeURIComponent(locale)}/${encodeURIComponent(sizeId)}/${encodeURIComponent(screenId)}`;
}

/** Hash route for the contact sheet of one size. */
export function sheetRoute(locale: string, sizeId: string): string {
  return `/#/sheet/${encodeURIComponent(locale)}/${encodeURIComponent(sizeId)}`;
}
