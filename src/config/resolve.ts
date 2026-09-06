// Pure resolution of a ScreenDef for one preset and locale:
//   base < overrides[family] < overrides[sizeId] < locales[locale]
// Runs in Node (matrix) and in the browser (render/gallery pages) with a
// CaptureResolver injected by each side.
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

export function resolveScreen(
  screen: ScreenDef,
  preset: SizePreset,
  locale: string,
  copy: LocaleCopy | undefined,
  captureResolver: CaptureResolver,
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

  const copyKey = screen.copyKey ?? screen.id;
  const resolved: ResolvedScreen = {
    id: screen.id,
    locale,
    sizeId: preset.id,
    family,
    template,
    copyKey,
    copy: copy?.screens[copyKey],
    captures: captures.map((ref) => captureResolver(ref, preset, locale)),
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

/** Key for ProjectJson.captures and capture caches. */
export function captureKey(locale: string, family: DeviceFamily, ref: CaptureRef): string {
  return `${locale}/${family}/${ref}`;
}

/** Project-relative posix path of a capture file. */
export function captureRelPath(locale: string, family: DeviceFamily, ref: CaptureRef): string {
  return `captures/${locale}/${family}/${ref}.png`;
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
