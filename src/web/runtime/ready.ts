// Readiness tracking for the headless renderer.
//
// `window.__S1S_READY` becomes true only when: fonts are loaded, every <img>
// on the page is decoded (or marked broken), no pending token is held (text
// fitters, FitBox measuring, bezel/project fetches) and two consecutive
// animation frames passed without registry activity. Any activity resets it.
//
// No DOM access at module load: this file is also imported by the pure
// `chooseSize` unit test under Node.

type Release = () => void;

const pending = new Map<symbol, string>();
let version = 0;
let settleToken = 0;

function setReady(value: boolean): void {
  if (typeof window !== 'undefined') window.__S1S_READY = value;
}

/** Hold a token while async work is in flight. Returns the release function. */
export function acquire(label: string): Release {
  const token = Symbol(label);
  pending.set(token, label);
  version += 1;
  setReady(false);
  return () => {
    if (pending.delete(token)) version += 1;
  };
}

/** Bump the activity counter without holding a token (a fitter that finished synchronously). */
export function notifyActivity(): void {
  version += 1;
  setReady(false);
}

export function pendingLabels(): string[] {
  return [...pending.values()];
}

/** Called on every route change, before React re-renders. */
export function markRouteChange(): void {
  settleToken += 1;
  setReady(false);
}

/** Start (or restart) the settle loop for the current route. */
export function scheduleSettle(fontStacks: readonly string[]): void {
  settleToken += 1;
  setReady(false);
  void settle(settleToken, fontStacks);
}

async function settle(token: number, fontStacks: readonly string[]): Promise<void> {
  const startedAt = performance.now();
  let warned = false;
  await ensureFonts(fontStacks.flatMap(fontFamiliesOf));
  for (;;) {
    if (token !== settleToken) return;
    const seen = version;
    await document.fonts.ready;
    await decodeImages(document);
    const idle = await idleFrames(2, seen);
    if (
      idle &&
      pending.size === 0 &&
      version === seen &&
      document.fonts.status === 'loaded' &&
      document.querySelector('[data-s1s-fitting]') === null
    ) {
      break;
    }
    if (!warned && performance.now() - startedAt > 10_000) {
      warned = true;
      console.warn('s1s: still settling after 10 s; pending:', pendingLabels());
    }
  }
  if (token === settleToken) setReady(true);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function idleFrames(count: number, seen: number): Promise<boolean> {
  for (let i = 0; i < count; i += 1) {
    await nextFrame();
    if (version !== seen || pending.size > 0) return false;
  }
  return true;
}

/** Decode every <img> under root; broken ones get data-s1s-img-error. */
export async function decodeImages(root: ParentNode): Promise<void> {
  const images = [...root.querySelectorAll('img')].filter((img) => img.getAttribute('src'));
  await Promise.all(
    images.map(async (img) => {
      if (img.hasAttribute('data-s1s-img-error')) return;
      try {
        await img.decode();
      } catch {
        img.setAttribute('data-s1s-img-error', img.currentSrc || img.src);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  'inherit',
  'initial',
  'unset',
]);

/** Named (non-generic) families of a CSS font-family stack, unquoted. */
export function fontFamiliesOf(stack: string): string[] {
  return stack
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').trim())
    .filter((name) => name.length > 0 && !GENERIC_FAMILIES.has(name.toLowerCase()));
}

const requested = new Set<string>();

/** Force-load the given families (regardless of font-display) and wait for the font set. */
export async function ensureFonts(families: readonly string[]): Promise<void> {
  const fresh = families.filter((family) => !requested.has(family));
  for (const family of fresh) requested.add(family);
  await Promise.all(
    fresh.flatMap((family) =>
      ['400', '700'].map((weight) => document.fonts.load(`${weight} 16px "${family}"`).catch(() => [])),
    ),
  );
  await document.fonts.ready;
}
