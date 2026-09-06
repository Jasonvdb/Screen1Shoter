// /#/gallery (dev): every screen of one locale x size as scaled iframes of the
// render routes, with locale and size switchers.
import { useEffect, useRef, useState } from 'react';
import { renderRoute } from '../../config/resolve.ts';
import type { Dims, Warning } from '../../config/types.ts';
import { countByLevel } from '../../config/warnings.ts';
import { screenDataChecks } from '../runtime/checks.ts';
import { localesOf, renderPresets, resolveFor, screensFor, useProjectData } from '../runtime/project.ts';

export interface ScaledFrameProps {
  url: string;
  pt: Dims;
  scale: number;
  /** Called once the iframe's own __S1S_READY is true (same-origin). */
  onReady?: ((win: Window) => void) | undefined;
}

/** An iframe at the canvas size, scaled down with a CSS transform. */
export function ScaledFrame({ url, pt, scale, onReady }: ScaledFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded || !onReady) return;
    const win = ref.current?.contentWindow;
    if (!win) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      if (win.__S1S_READY) {
        window.clearInterval(timer);
        onReady(win);
      } else if (performance.now() - startedAt > 120_000) {
        window.clearInterval(timer);
        console.warn(`s1s: ${url} did not become ready within 120 s`);
        onReady(win);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [loaded, onReady, url]);

  return (
    <div style={{ width: Math.round(pt.width * scale), height: Math.round(pt.height * scale), overflow: 'hidden', position: 'relative' }}>
      <iframe
        ref={ref}
        src={url}
        title={url}
        width={pt.width}
        height={pt.height}
        onLoad={() => setLoaded(true)}
        style={{ border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', display: 'block' }}
      />
    </div>
  );
}

export function warningBadge(warnings: Warning[]): string {
  const counts = countByLevel(warnings);
  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.info) parts.push(`${counts.info} info`);
  return parts.join(', ');
}

export function GalleryPage() {
  const project = useProjectData();
  const [locale, setLocale] = useState<string | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);

  if (project.status === 'loading') return <div className="s1s-shell">Loading project...</div>;
  if (project.status === 'error') return <div className="s1s-shell s1s-error">{project.error}</div>;
  const { data } = project;

  const locales = localesOf(data);
  const presets = renderPresets(data);
  const activeLocale = locale ?? data.json.sourceLocale;
  const preset = presets.find((p) => p.id === sizeId) ?? presets[0];
  if (!preset) return <div className="s1s-shell s1s-error">No sizes configured.</div>;

  const scale = 520 / preset.pt.height;
  const screens = screensFor(data, preset);

  return (
    <div className="s1s-shell">
      <header className="s1s-toolbar">
        <strong>Screen1Shoter</strong>
        <label>
          Locale{' '}
          <select value={activeLocale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Size{' '}
          <select value={preset.id} onChange={(e) => setSizeId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.px.width}x{p.px.height})
              </option>
            ))}
          </select>
        </label>
        <span className="s1s-muted">
          {screens.length} screen{screens.length === 1 ? '' : 's'} · mode {data.json.mode}
        </span>
      </header>
      <div className="s1s-grid">
        {screens.map((def, i) => {
          const resolved = resolveFor(data, activeLocale, preset, def);
          const url = renderRoute(activeLocale, preset.id, def.id);
          const warnings = screenDataChecks(resolved, preset);
          return (
            <figure key={`${activeLocale}/${preset.id}/${def.id}`} className="s1s-cell">
              <figcaption>
                <span>
                  <strong>{String(i + 1).padStart(2, '0')}</strong> {def.id}
                </span>
                <span className="s1s-muted">{resolved.template}</span>
                {warnings.length > 0 ? <span className="s1s-warn">{warningBadge(warnings)}</span> : null}
                <a href={url} target="_blank" rel="noreferrer">
                  open
                </a>
              </figcaption>
              <ScaledFrame url={url} pt={preset.pt} scale={scale} />
            </figure>
          );
        })}
      </div>
    </div>
  );
}
