// Warnings derived in the browser.
//
// `domChecks` reads data-s1s-* attributes and geometry from the live DOM and
// backs `window.__S1S.check()`. `screenDataChecks` / `copyUnusedChecks` derive
// capture and copy warnings from resolved data; Node emits the same codes for
// the render report, so `check()` deliberately returns DOM warnings only.
import { captureRelPath, missingCaptureElement } from '../../config/resolve.ts';
import type { LocaleCopy, ResolvedScreen, ScreensConfig, SizePreset, Warning, WarningCode } from '../../config/types.ts';
import { captureDimsWarning, makeWarning } from '../../config/warnings.ts';
import { fontFamiliesOf } from './ready.ts';

const EPS = 1;
const OVERFLOW_CODES: ReadonlySet<string> = new Set(['text-min-size', 'text-clipped', 'overflow']);

function overflowCode(raw: string | undefined): WarningCode {
  return raw !== undefined && OVERFLOW_CODES.has(raw) ? (raw as WarningCode) : 'overflow';
}

function hint(el: Element): string {
  const id = el.getAttribute('data-s1s-id');
  return id ? `[data-s1s-id="${id}"]` : el.tagName.toLowerCase();
}

function snippet(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function outside(inner: DOMRect, outer: DOMRect): boolean {
  return (
    inner.left < outer.left - EPS ||
    inner.top < outer.top - EPS ||
    inner.right > outer.right + EPS ||
    inner.bottom > outer.bottom + EPS
  );
}

function bleeds(el: Element): boolean {
  return el.closest('[data-s1s-allow-bleed]') !== null;
}

/** Warnings from the DOM: overflow flags, geometry, broken images, bezel and font fallbacks. */
export function domChecks(root: ParentNode = document): Warning[] {
  const out: Warning[] = [];

  for (const el of root.querySelectorAll<HTMLElement>('[data-s1s-overflow]')) {
    if (bleeds(el)) continue;
    const code = overflowCode(el.getAttribute('data-s1s-overflow') ?? undefined);
    const fitted = el.getAttribute('data-s1s-fitted');
    const detail = fitted ? ` at the minimum size ${fitted}pt` : '';
    // data-s1s-overflow-why: a component's own explanation (a collapsed slot, too many callouts).
    const why = el.getAttribute('data-s1s-overflow-why');
    out.push(makeWarning(code, why ? `${hint(el)}: ${why}` : `${hint(el)} overflows${detail}: "${snippet(el)}"`, hint(el)));
  }

  const canvas = root.querySelector<HTMLElement>('[data-s1s-canvas]');
  if (canvas) {
    const bounds = canvas.getBoundingClientRect();
    for (const el of canvas.querySelectorAll<HTMLElement>('[data-s1s-check]')) {
      if (bleeds(el) || el.hasAttribute('data-s1s-overflow')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (outside(rect, bounds)) {
        out.push(makeWarning('overflow', `${hint(el)} leaves the canvas`, hint(el)));
      }
    }
    for (const slot of canvas.querySelectorAll<HTMLElement>('[data-s1s-slot]')) {
      const slotRect = slot.getBoundingClientRect();
      for (const el of slot.querySelectorAll<HTMLElement>('[data-s1s-fitted]')) {
        if (bleeds(el) || el.hasAttribute('data-s1s-overflow')) continue;
        if (outside(el.getBoundingClientRect(), slotRect)) {
          out.push(makeWarning('text-clipped', `${hint(el)} leaves its text slot: "${snippet(el)}"`, hint(el)));
        }
      }
    }
    out.push(...fontChecks(canvas));
  }

  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!src) continue;
    if (img.hasAttribute('data-s1s-img-error') || (img.complete && img.naturalWidth === 0)) {
      out.push(makeWarning('image-missing', `Image failed to load: ${src}`, hint(img)));
    }
  }

  for (const el of root.querySelectorAll<HTMLElement>('[data-s1s-bezel-fallback]')) {
    const wanted = el.getAttribute('data-s1s-bezel-fallback') ?? '?';
    const actual = el.getAttribute('data-s1s-bezel') ?? 'generic';
    const used = actual === 'generic' ? 'drew a generic CSS frame' : `used ${actual} instead`;
    out.push(makeWarning('bezel-fallback', `No bezel installed for "${wanted}"; ${used}. Run: s1s bezels install`, hint(el)));
  }

  // Defence in depth: whatever the Node side resolved, a placeholder in the
  // DOM means the PNG shows the hatched panel. Same element as Node's warning
  // so mergeWarnings() de-duplicates the two.
  for (const el of root.querySelectorAll<HTMLElement>('[data-s1s-capture-missing]')) {
    const ref = el.getAttribute('data-s1s-capture-missing') ?? '?';
    out.push(makeWarning('capture-missing', `Rendered a placeholder for capture "${ref}": ${snippet(el)}`, missingCaptureElement(ref)));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Fonts: does the theme's stack resolve to a named family on this machine?
// document.fonts.check() returns true for unknown families, so measure instead.
// ---------------------------------------------------------------------------

const SAMPLE = 'mmmmmmmmmmlliWwQq0123';
const GENERICS = ['monospace', 'serif', 'sans-serif'];

function quote(family: string): string {
  return /^[\w-]+$/.test(family) ? family : `"${family.replace(/"/g, '\\"')}"`;
}

/** true/false when measurable; null when the canvas could not parse the family. */
function familyAvailable(family: string): boolean | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  let parsed = false;
  for (const generic of GENERICS) {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(SAMPLE).width;
    const before = ctx.font;
    ctx.font = `72px ${quote(family)}, ${generic}`;
    if (ctx.font === before) continue;
    parsed = true;
    if (ctx.measureText(SAMPLE).width !== base) return true;
  }
  return parsed ? false : null;
}

/** false only when every named family in the stack is measurably missing. */
export function stackAvailable(stack: string): boolean {
  const families = fontFamiliesOf(stack);
  if (families.length === 0) return true;
  const results = families.map(familyAvailable);
  if (results.includes(true)) return true;
  return results.includes(null);
}

function fontChecks(canvas: HTMLElement): Warning[] {
  const out: Warning[] = [];
  const stacks: Array<[string, string | null]> = [
    ['headline', canvas.getAttribute('data-s1s-font-headline')],
    ['body', canvas.getAttribute('data-s1s-font-body')],
  ];
  for (const [role, stack] of stacks) {
    if (!stack || stackAvailable(stack)) continue;
    out.push(
      makeWarning(
        'font-fallback',
        `The ${role} font stack "${stack}" has no installed family; text rendered with a generic fallback.`,
        `[data-s1s-id="${role}"]`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data-derived warnings (mirrors the Node side; used by the gallery and sheet)
// ---------------------------------------------------------------------------

export function screenDataChecks(screen: ResolvedScreen, preset: SizePreset): Warning[] {
  const out: Warning[] = [];
  if (screen.copy === undefined) {
    out.push(makeWarning('copy-missing', `No copy for "${screen.copyKey}" in ${screen.locale}`));
  }
  for (const capture of screen.captures) {
    const expected = captureRelPath(capture.locale, capture.family, capture.requested);
    if (capture.fallback === 'placeholder') {
      out.push(makeWarning('capture-missing', `Missing capture ${expected}`, missingCaptureElement(capture.requested)));
      continue;
    }
    if (capture.fallback === 'source-locale') {
      out.push(makeWarning('capture-fallback-locale', `${expected} not found; using ${capture.resolvedPath ?? '?'}`));
    }
    if (capture.dims) {
      const dims = captureDimsWarning(capture.dims, preset, capture.resolvedPath ?? expected);
      if (dims) out.push(dims);
    }
  }
  return out;
}

export function copyUnusedChecks(copy: LocaleCopy, screens: ScreensConfig): Warning[] {
  const used = new Set(screens.screens.map((screen) => screen.copyKey ?? screen.id));
  return Object.keys(copy.screens)
    .filter((key) => !used.has(key))
    .map((key) => makeWarning('copy-unused', `copy/${copy.locale}.json has "${key}" but no screen uses it`));
}
