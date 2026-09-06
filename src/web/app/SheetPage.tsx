// /#/sheet/<locale>/<sizeId>[?scale=0.25&columns=5]: contact sheet of one size.
// Each cell polls its iframe for __S1S_READY, then reads its DOM warnings.
// The page's own __S1S_READY turns true once every cell has reported.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreset, isSizeId } from '../../config/presets.ts';
import { renderRoute } from '../../config/resolve.ts';
import type { Warning } from '../../config/types.ts';
import { countByLevel, mergeWarnings } from '../../config/warnings.ts';
import { screenDataChecks } from '../runtime/checks.ts';
import { resolveFor, screensFor, useProjectData } from '../runtime/project.ts';
import { acquire } from '../runtime/ready.ts';
import { ScaledFrame, warningBadge } from './GalleryPage.tsx';

export interface SheetPageProps {
  locale: string;
  sizeId: string;
  params: URLSearchParams;
}

function numberParam(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function SheetPage({ locale, sizeId, params }: SheetPageProps) {
  const project = useProjectData();
  const scale = numberParam(params, 'scale', 0.25);
  const columns = Math.round(numberParam(params, 'columns', 5));
  const [results, setResults] = useState<Record<string, Warning[]>>({});
  const releaseRef = useRef<(() => void) | null>(null);

  const ready = project.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    releaseRef.current = acquire('sheet');
    return () => {
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [ready]);

  const report = useCallback((id: string, warnings: Warning[]) => {
    setResults((prev) => (prev[id] ? prev : { ...prev, [id]: warnings }));
  }, []);

  const total = ready && isSizeId(sizeId) ? screensFor(project.data, getPreset(sizeId)).length : -1;
  const done = total >= 0 && Object.keys(results).length >= total;
  useEffect(() => {
    if (!done) return;
    releaseRef.current?.();
    releaseRef.current = null;
  }, [done]);

  if (project.status === 'loading') return <div className="s1s-shell">Loading project...</div>;
  if (project.status === 'error') return <div className="s1s-shell s1s-error">{project.error}</div>;
  if (!isSizeId(sizeId)) return <div className="s1s-shell s1s-error">Unknown size {sizeId}</div>;
  const { data } = project;
  const preset = getPreset(sizeId);
  const screens = screensFor(data, preset);
  const cellWidth = Math.round(preset.pt.width * scale);

  return (
    <div className="s1s-shell s1s-sheet">
      <header className="s1s-toolbar">
        <strong>{data.json.manifest.app.name}</strong>
        <span>
          {locale} · {preset.id} · {preset.px.width}x{preset.px.height}
        </span>
        <span className="s1s-muted">
          {Object.keys(results).length}/{screens.length} ready
        </span>
      </header>
      <div className="s1s-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, ${cellWidth}px)` }}>
        {screens.map((def, i) => {
          const resolved = resolveFor(data, locale, preset, def);
          const url = renderRoute(locale, preset.id, def.id);
          const dataWarnings = screenDataChecks(resolved, preset);
          const warnings = results[def.id];
          const counts = warnings ? countByLevel(warnings) : null;
          const border = counts ? (counts.error > 0 ? '#ef4444' : counts.warn > 0 ? '#f59e0b' : '#3f3f46') : '#27272a';
          return (
            <figure key={def.id} className="s1s-cell" style={{ borderColor: border }}>
              <figcaption>
                <span>
                  <strong>{String(i + 1).padStart(2, '0')}</strong> {def.id}
                </span>
                <span className="s1s-muted">{resolved.template}</span>
                <span className={counts && counts.error > 0 ? 's1s-error' : 's1s-warn'}>
                  {warnings ? warningBadge(warnings) || 'ok' : '...'}
                </span>
              </figcaption>
              <ScaledFrame
                url={url}
                pt={preset.pt}
                scale={scale}
                onReady={(win) => report(def.id, mergeWarnings(dataWarnings, win.__S1S.check()))}
              />
            </figure>
          );
        })}
      </div>
    </div>
  );
}
