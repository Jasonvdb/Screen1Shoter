// Playwright Chromium setup tuned for deterministic pixels: sRGB, grayscale
// antialiasing, no hinting, no scrollbars, reduced motion, a fixed clock and
// a Math.random seeded from the route. One context per size preset.
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { SizePreset } from '../config/types.ts';
import { S1sError } from '../core/errors.ts';

export const CHROMIUM_ARGS: string[] = [
  '--force-color-profile=srgb',
  '--disable-lcd-text',
  '--font-render-hinting=none',
  '--hide-scrollbars',
];

/** Apple's marketing time. Applied through context.clock so Date is stable. */
export const FIXED_TIME = '2025-09-09T09:41:00Z';

// Installs a mulberry32 PRNG over Math.random, seeded with the FNV-1a hash of
// the route: at document start, before every in-document navigation (the
// Navigation API `navigate` event fires before React sees the hashchange; the
// hashchange listener is a fallback), and through window.__s1sSeed(route) at
// the start of every RenderPage render pass. The values a template draws are
// therefore a pure function of `<locale>/<size>/<screen>`, whatever the render
// order, the page slot or the modules loaded before. Plain JS: it runs in the page.
const SEED_SCRIPT = `(() => {
  const fnv1a = (text) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };
  const install = (seed) => {
    let s = seed >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const reseed = (hash) => install(fnv1a(hash));
  reseed(location.hash);
  // RenderPage calls this at the start of every render pass, so the sequence
  // a template sees starts from the same point whatever ran before it.
  Object.defineProperty(window, '__s1sSeed', { value: reseed, configurable: true });
  const navigation = window.navigation;
  if (navigation && typeof navigation.addEventListener === 'function') {
    navigation.addEventListener('navigate', (event) => {
      try {
        reseed(new URL(event.destination.url).hash);
      } catch {
        reseed(location.hash);
      }
    });
  }
  window.addEventListener('hashchange', () => reseed(location.hash));
})();`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  } catch (error) {
    throw new S1sError('tool-missing', `Could not launch Chromium: ${errorMessage(error)}`, {
      hint: 'Run `pnpm exec playwright install chromium` inside the Screen1Shoter checkout, then `s1s doctor`.',
    });
  }
}

export interface ContextOptions {
  /** BCP 47 locale for Intl formatting inside templates. Default 'en-US'. */
  locale?: string;
}

/**
 * Viewport = preset.pt, deviceScaleFactor = preset.scale, so a
 * `scale: 'device'` screenshot is exactly preset.px.
 */
export async function contextFor(browser: Browser, preset: SizePreset, opts: ContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: preset.pt.width, height: preset.pt.height },
    deviceScaleFactor: preset.scale,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    timezoneId: 'UTC',
    locale: opts.locale ?? 'en-US',
    serviceWorkers: 'block',
  });
  try {
    await context.clock.setFixedTime(FIXED_TIME);
  } catch {
    // Older Playwright builds without clock support: templates fall back to
    // the real clock. The plan's 09:41 status bar comes from the capture, not
    // from the browser, so this is cosmetic.
  }
  await context.addInitScript(SEED_SCRIPT);
  return context;
}

/**
 * Node-side twin of the in-page seed: FNV-1a of the hash route, e.g.
 * seedFor('#/render/en-US/iphone-6.9/home'). Kept for tests and tooling.
 */
export function seedFor(hash: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < hash.length; i += 1) {
    value ^= hash.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}
