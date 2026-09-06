// The hash grammar the browser entry runs on (src/web/app/route.ts). Two
// things the renderer and `s1s dev` depend on and nothing else checked:
// `#/gallery?locale=de-DE` must reach GalleryPage (the `--locale` flag prints
// that URL), and every route that names a locale must yield it as the document
// language, because Chromium cases and breaks lines per <html lang>.
import { describe, expect, it } from 'vitest';
import { parseRoute, routeLang, type Route } from '../../src/web/app/route.ts';

function must<T extends Route['kind']>(route: Route, kind: T): Extract<Route, { kind: T }> {
  expect(route.kind).toBe(kind);
  return route as Extract<Route, { kind: T }>;
}

describe('parseRoute', () => {
  it('reads the render route and decodes each segment', () => {
    expect(parseRoute('#/render/en-US/iphone-6.9/home')).toEqual({
      kind: 'render',
      locale: 'en-US',
      sizeId: 'iphone-6.9',
      screenId: 'home',
    });
    expect(parseRoute('#/render/de-DE/ipad-13/tablet%2Dsplit')).toMatchObject({ screenId: 'tablet-split' });
  });

  it('carries the gallery query, so `s1s dev --locale de-DE` selects that locale', () => {
    const route = must(parseRoute('#/gallery?locale=de-DE'), 'gallery');
    expect(route.params.get('locale')).toBe('de-DE');
  });

  it('gives a bare gallery route empty params', () => {
    expect([...must(parseRoute('#/gallery'), 'gallery').params]).toEqual([]);
  });

  it('keeps the sheet route and its params', () => {
    const route = must(parseRoute('#/sheet/en-US/ipad-13?scale=0.1&columns=2'), 'sheet');
    expect([route.locale, route.sizeId]).toEqual(['en-US', 'ipad-13']);
    expect(route.params.get('columns')).toBe('2');
  });

  it('falls back to home for anything else, an incomplete render route included', () => {
    for (const hash of ['', '#/', '#/nope', '#/render/en-US/iphone-6.9']) {
      expect(parseRoute(hash).kind, hash).toBe('home');
    }
  });
});

describe('routeLang', () => {
  it('uses the route locale wherever the route names one', () => {
    expect(routeLang(parseRoute('#/render/de-DE/iphone-6.9/home'), 'en-US')).toBe('de-DE');
    expect(routeLang(parseRoute('#/sheet/tr-TR/iphone-6.9'), 'en-US')).toBe('tr-TR');
  });

  it('falls back to the project source locale for the gallery and the home page', () => {
    expect(routeLang(parseRoute('#/gallery?locale=de-DE'), 'en-US')).toBe('en-US');
    expect(routeLang(parseRoute('#/'), 'en-US')).toBe('en-US');
  });
});
