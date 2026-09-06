// Browser entry. Hash router: /#/render/<locale>/<sizeId>/<screenId>,
// /#/gallery, /#/sheet/<locale>/<sizeId>. Installs window.__S1S and the
// readiness flag before React mounts.
import '@fontsource-variable/inter';
import './styles/fonts.css';
import './styles/base.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PORTABLE_FONT } from '../config/types.ts';
import { GalleryPage } from './app/GalleryPage.tsx';
import { RenderPage } from './app/RenderPage.tsx';
import { SheetPage } from './app/SheetPage.tsx';
import { domChecks } from './runtime/checks.ts';
import { projectTheme } from './runtime/project.ts';
import { markRouteChange, scheduleSettle } from './runtime/ready.ts';

export type Route =
  | { kind: 'render'; locale: string; sizeId: string; screenId: string }
  | { kind: 'gallery' }
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
  if (head === 'gallery') return { kind: 'gallery' };
  return { kind: 'home' };
}

function useRoute(): { route: Route; key: string } {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => {
      markRouteChange();
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return { route: parseRoute(hash), key: hash };
}

const FONT_STACKS = [projectTheme.fonts.headline, projectTheme.fonts.body, PORTABLE_FONT];

function HomePage() {
  return (
    <div className="s1s-shell">
      <h1>Screen1Shoter</h1>
      <p>
        <a href="#/gallery">Open the gallery</a>
      </p>
      <p className="s1s-muted">Render route: #/render/&lt;locale&gt;/&lt;sizeId&gt;/&lt;screenId&gt;</p>
    </div>
  );
}

function App() {
  const { route, key } = useRoute();

  // Runs after the page's own effects: tokens are held before the settle loop starts.
  useEffect(() => {
    document.body.style.background = route.kind === 'render' ? projectTheme.background : '';
    scheduleSettle(FONT_STACKS);
  }, [key, route.kind]);

  switch (route.kind) {
    case 'render':
      return <RenderPage key={key} locale={route.locale} sizeId={route.sizeId} screenId={route.screenId} />;
    case 'sheet':
      return <SheetPage key={key} locale={route.locale} sizeId={route.sizeId} params={route.params} />;
    case 'gallery':
      return <GalleryPage />;
    default:
      return <HomePage />;
  }
}

function bootstrap(): void {
  const mode: 'render' | 'dev' = window.__S1S_MODE === 'render' ? 'render' : 'dev';
  window.__S1S_MODE = mode;
  window.__S1S_READY = false;
  window.__S1S = { check: () => domChecks(document) };
  document.documentElement.dataset['s1sMode'] = mode;

  if (mode === 'render') {
    const style = document.createElement('style');
    style.setAttribute('data-s1s', 'render');
    style.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; }';
    document.head.appendChild(style);
  }

  // The Navigation API fires synchronously, before the async hashchange event:
  // the flag drops before Playwright can poll it after page.goto(...#/render/...).
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('navigate', () => scheduleSettle(FONT_STACKS));

  const container = document.getElementById('root');
  if (!container) throw new Error('s1s: #root missing in index.html');
  createRoot(container).render(<App />);
}

bootstrap();
