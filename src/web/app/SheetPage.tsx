// /#/sheet/<locale>/<sizeId>[?scale=0.25&columns=5]: contact sheet of one
// rendered size. Tiles are the finished PNGs from out/<locale>/<displayType>/
// (served under /project/), labels and severities come from report.json, so
// the sheet shows exactly what `s1s render` wrote, failed items included.
// src/render/sheet.ts screenshots this page at device scale factor 1; every
// pixel size below comes from sheet-model.ts so Node can predict the output.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getPreset, isSizeId } from '../../config/presets.ts';
import type { RenderReport } from '../../config/types.ts';
import { ErrorPanel } from '../components/ErrorPanel.tsx';
import { acquire } from '../runtime/ready.ts';
import {
  SHEET_BACKGROUND,
  SHEET_CHROME,
  TILE_COLOURS,
  parseSheetParams,
  sheetLayout,
  sheetSummary,
  sheetTiles,
  summaryText,
  type SheetLayout,
  type SheetTile,
} from './sheet-model.ts';

export interface SheetPageProps {
  locale: string;
  sizeId: string;
  params: URLSearchParams;
}

type ReportState = { status: 'loading' } | { status: 'ready'; report: RenderReport } | { status: 'error'; error: string };

/** report.json of one locale, as the Vite plugin serves it. */
export function reportUrl(locale: string): string {
  return `/project/out/${encodeURIComponent(locale)}/report.json`;
}

async function fetchReport(locale: string): Promise<RenderReport> {
  const url = reportUrl(locale);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}. Run \`s1s render --locale ${locale}\` first.`);
  }
  const json = (await res.json()) as Partial<RenderReport>;
  if (json.version !== 1 || !Array.isArray(json.items)) throw new Error(`${url} is not a render report`);
  return json as RenderReport;
}

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const TEXT = '#e5e5e5';
const MUTED = '#a1a1aa';
const LEVEL_TEXT: Record<SheetTile['level'], string> = { error: '#f87171', warn: '#fbbf24', ok: MUTED };

/** Broken output images (deleted after the report was written) fall back to the panel underneath. */
const HIDE_BROKEN = '[data-s1s-sheet] img[data-s1s-img-error] { visibility: hidden; }';

function Placeholder({ tile }: { tile: SheetTile }) {
  const title = tile.status === 'failed' ? 'Render failed' : tile.status === 'missing' ? 'Not rendered' : 'PNG missing on disk';
  const detail = tile.status === 'failed' ? (tile.error ?? '') : tile.status === 'missing' ? 'status: skipped' : (tile.imageUrl ?? '');
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '6%',
    textAlign: 'center',
    color: tile.status === 'failed' ? '#fecaca' : 'rgba(255,255,255,0.85)',
    background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 10px, rgba(255,255,255,0.12) 10px 20px), #2a2a2e',
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 1.4,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  };
  return (
    <div data-s1s-sheet-placeholder={tile.status} style={style}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
      <div style={{ opacity: 0.8 }}>{detail}</div>
    </div>
  );
}

function Tile({ tile, layout }: { tile: SheetTile; layout: SheetLayout }) {
  const { caption, border } = SHEET_CHROME;
  return (
    <figure
      data-s1s-sheet-tile={tile.screenId}
      data-s1s-sheet-level={tile.level}
      style={{
        margin: 0,
        width: layout.cellWidth,
        height: layout.cellHeight,
        border: `${border}px solid ${TILE_COLOURS[tile.level]}`,
        background: '#18181b',
        overflow: 'hidden',
      }}
    >
      <figcaption style={{ height: caption, padding: '4px 8px', fontSize: 12, lineHeight: '16px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <strong>{tile.label}</strong> {tile.screenId} <span style={{ color: MUTED }}>{tile.template}</span>
        </div>
        <div style={{ color: LEVEL_TEXT[tile.level], overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tile.status === 'failed' ? 'failed' : tile.status === 'missing' ? 'not rendered' : tile.summary}
        </div>
      </figcaption>
      <div style={{ position: 'relative', width: layout.tileWidth, height: layout.tileHeight, overflow: 'hidden' }}>
        <Placeholder tile={tile} />
        {tile.imageUrl ? (
          <img
            src={tile.imageUrl}
            alt=""
            width={layout.tileWidth}
            height={layout.tileHeight}
            style={{ position: 'absolute', inset: 0, display: 'block', width: layout.tileWidth, height: layout.tileHeight }}
          />
        ) : null}
      </div>
    </figure>
  );
}

export function SheetPage({ locale, sizeId, params }: SheetPageProps) {
  const [state, setState] = useState<ReportState>({ status: 'loading' });
  const releaseRef = useRef<(() => void) | null>(null);

  // Hold the readiness token from mount until the tiles are in the DOM, so
  // the settle loop decodes every <img> before __S1S_READY turns true.
  useEffect(() => {
    releaseRef.current = acquire('sheet');
    let alive = true;
    fetchReport(locale)
      .then((report) => alive && setState({ status: 'ready', report }))
      .catch((error: unknown) => alive && setState({ status: 'error', error: String(error) }));
    return () => {
      alive = false;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [locale]);
  useEffect(() => {
    if (state.status === 'loading') return;
    releaseRef.current?.();
    releaseRef.current = null;
  }, [state.status]);

  if (state.status === 'loading') return null;
  if (state.status === 'error') return <ErrorPanel title="Contact sheet: report.json failed to load" message={state.error} />;
  if (!isSizeId(sizeId)) return <ErrorPanel title="Contact sheet: unknown size" message={sizeId} />;

  const preset = getPreset(sizeId);
  const tiles = sheetTiles(state.report, sizeId);
  if (tiles.length === 0) {
    return <ErrorPanel title="Contact sheet: nothing to show" message={`${reportUrl(locale)} has no items for ${sizeId}. Run \`s1s render --locale ${locale} --sizes ${sizeId}\`.`} />;
  }
  const layout = sheetLayout(preset, parseSheetParams(params), tiles.length);
  const summary = sheetSummary(tiles);
  const { padding, gap, header } = SHEET_CHROME;

  return (
    <div
      data-s1s-sheet={`${locale}/${sizeId}`}
      data-s1s-sheet-tiles={tiles.length}
      style={{
        position: 'relative',
        width: layout.width,
        height: layout.height,
        padding,
        background: SHEET_BACKGROUND,
        color: TEXT,
        fontFamily: '-apple-system, system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <style>{HIDE_BROKEN}</style>
      <header style={{ height: header, lineHeight: `${header}px`, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <strong>{locale}</strong> · {preset.id} · {preset.displayType} · {preset.px.width}x{preset.px.height} · {tiles.length} screen
        {tiles.length === 1 ? '' : 's'} · <span style={{ color: LEVEL_TEXT[summary.failed || summary.errors ? 'error' : summary.warns ? 'warn' : 'ok'] }}>{summaryText(summary)}</span>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${layout.columns}, ${layout.cellWidth}px)`, gap }}>
        {tiles.map((tile) => (
          <Tile key={tile.key} tile={tile} layout={layout} />
        ))}
      </div>
    </div>
  );
}
