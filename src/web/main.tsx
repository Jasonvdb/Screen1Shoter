// Browser entry. Hash router: /#/render/<locale>/<sizeId>/<screenId>,
// /#/gallery, /#/sheet/<locale>/<sizeId>. Installs window.__S1S, the readiness
// flag and the project's own @font-face rules before React mounts.
import '@fontsource-variable/inter';
import './styles/fonts.css';
import './styles/base.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PORTABLE_FONT } from '../config/types.ts';
import { GalleryPage } from './app/GalleryPage.tsx';
import { RenderPage } from './app/RenderPage.tsx';
import { parseRoute, routeLang, type Route } from './app/route.ts';
import { SheetPage } from './app/SheetPage.tsx';
import { domChecks, noncompliantTemplate } from './runtime/checks.ts';
import { projectFontCss, projectFontFamilies } from './runtime/fonts.ts';
import { loadProjectData, projectTheme } from './runtime/project.ts';
import { acquire, markRouteChange, scheduleSettle } from './runtime/ready.ts';

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

const THEME_STACKS = [projectTheme.fonts.headline, projectTheme.fonts.body, PORTABLE_FONT];

// Filled in by installProjectFonts(), before the mount: the document language
// of every route that names no locale of its own.
let sourceLocale = 'en';

// Grows once, in installProjectFonts(), before React mounts; read at call time
// so a settle scheduled from the Navigation API also force-loads the project
// families. ensureFonts() de-duplicates, so re-scheduling costs nothing.
let fontStacks: readonly string[] = THEME_STACKS;

/**
 * Registers <project>/fonts/* as @font-face rules and adds their families to
 * the force-loaded set: a theme naming a project family must render with it,
 * not with a fallback. A file that 404s still declares its family, so the
 * canvas measurement in checks.ts reports `font-fallback` instead of hanging.
 * A readiness token covers the fetch, so no settle can conclude meanwhile.
 */
async function installProjectFonts(): Promise<void> {
  const release = acquire('project-fonts');
  try {
    const { json } = await loadProjectData();
    sourceLocale = json.sourceLocale || sourceLocale;
    if (json.fonts.length === 0) return;
    const style = document.createElement('style');
    style.setAttribute('data-s1s', 'project-fonts');
    style.textContent = projectFontCss(json.fonts);
    document.head.appendChild(style);
    fontStacks = [...THEME_STACKS, ...projectFontFamilies(json.fonts)];
  } catch {
    // project.json is unreachable; the ErrorPanel reports that and the theme's
    // own stacks still render. Never block the mount on it.
  } finally {
    release();
  }
}

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
    document.documentElement.lang = routeLang(route, sourceLocale);
    document.body.style.background = route.kind === 'render' ? projectTheme.background : '';
    scheduleSettle(fontStacks);
  }, [key, route.kind]);

  switch (route.kind) {
    case 'render':
      return <RenderPage key={key} locale={route.locale} sizeId={route.sizeId} screenId={route.screenId} />;
    case 'sheet':
      return <SheetPage key={key} locale={route.locale} sizeId={route.sizeId} params={route.params} />;
    case 'gallery':
      return <GalleryPage params={route.params} />;
    default:
      return <HomePage />;
  }
}

async function bootstrap(): Promise<void> {
  const mode: 'render' | 'dev' = window.__S1S_MODE === 'render' ? 'render' : 'dev';
  window.__S1S_MODE = mode;
  window.__S1S_READY = false;
  window.__S1S = { check: () => domChecks(document), noncompliant: () => noncompliantTemplate(document) };
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
  navigation?.addEventListener('navigate', () => scheduleSettle(fontStacks));

  // Before the mount: the first paint must already have the project faces.
  await installProjectFonts();

  const container = document.getElementById('root');
  if (!container) throw new Error('s1s: #root missing in index.html');
  createRoot(container).render(<App />);
}

void bootstrap();
