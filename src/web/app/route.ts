// The hash router's grammar, split out of main.tsx so it is DOM-free and
// unit-testable: /#/render/<locale>/<sizeId>/<screenId>,
// /#/gallery?locale=<locale>, /#/sheet/<locale>/<sizeId>?<params>.

export type Route =
  | { kind: 'render'; locale: string; sizeId: string; screenId: string }
  | { kind: 'gallery'; params: URLSearchParams }
  | { kind: 'sheet'; locale: string; sizeId: string; params: URLSearchParams }
  | { kind: 'home' };

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decode);
  const [head, a, b, c] = parts;
  if (head === 'render' && a !== undefined && b !== undefined && c !== undefined) {
    return { kind: 'render', locale: a, sizeId: b, screenId: c };
  }
  if (head === 'sheet' && a !== undefined && b !== undefined) {
    return { kind: 'sheet', locale: a, sizeId: b, params: new URLSearchParams(query) };
  }
  // `s1s dev --locale de-DE` links here; the gallery seeds its locale switcher
  // from the query, so the flag really selects what the human reviews.
  if (head === 'gallery') return { kind: 'gallery', params: new URLSearchParams(query) };
  return { kind: 'home' };
}

/**
 * Language for `<html lang>`. Chromium applies `text-transform: uppercase`
 * and `text-wrap: balance` per document language, so a route that names a
 * locale must say so before anything is measured or painted.
 */
export function routeLang(route: Route, sourceLocale: string): string {
  return route.kind === 'render' || route.kind === 'sheet' ? route.locale : sourceLocale;
}
