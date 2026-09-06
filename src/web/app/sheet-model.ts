// Pure model of a contact sheet: which tiles it shows, their labels and
// severity, and the pixel layout at device scale factor 1. DOM-free so
// SheetPage.tsx (browser), src/render/sheet.ts (viewport size, summary) and
// tests/unit/sheet.test.ts share one definition.
import { getPreset, isSizeId, renderTarget } from '../../config/presets.ts';
import { formatOrdinal, renderFileName } from '../../config/resolve.ts';
import type { RenderReport, RenderReportItem, SizeId, SizePreset, Warning, WarningLevel } from '../../config/types.ts';
import { countByLevel } from '../../config/warnings.ts';

export const SHEET_DEFAULTS = { scale: 0.25, columns: 5 } as const;

/** Page background; sheet.ts flattens the screenshot against it. */
export const SHEET_BACKGROUND = '#111111';

/** Fixed chrome around the tiles (CSS px at device scale factor 1); SheetPage.tsx sizes its elements from these. */
export const SHEET_CHROME = { padding: 16, gap: 12, header: 28, caption: 40, border: 2 } as const;

export interface SheetParams {
  /** Tile size as a fraction of the output PNG, in (0, 1]. */
  scale: number;
  /** Tiles per row, >= 1. */
  columns: number;
}

/** Clamps to a scale in (0, 1] and an integer column count >= 1; anything else falls back to the defaults. */
export function normaliseSheetParams(input: { scale?: number | undefined; columns?: number | undefined }): SheetParams {
  const { scale, columns } = input;
  return {
    scale: scale !== undefined && Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : SHEET_DEFAULTS.scale,
    columns: columns !== undefined && Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : SHEET_DEFAULTS.columns,
  };
}

/** `?scale=0.25&columns=5` from the sheet route (URLSearchParams or anything with `get`). */
export function parseSheetParams(params: { get(name: string): string | null }): SheetParams {
  const number = (key: string): number | undefined => {
    const raw = params.get(key);
    return raw === null || raw.trim() === '' ? undefined : Number(raw);
  };
  return normaliseSheetParams({ scale: number('scale'), columns: number('columns') });
}

export interface SheetLayout extends SheetParams {
  tileWidth: number;
  tileHeight: number;
  /** Tile plus its border. */
  cellWidth: number;
  /** Caption plus tile plus border. */
  cellHeight: number;
  rows: number;
  /** Full sheet size, the expected PNG dimensions. */
  width: number;
  height: number;
}

/** Layout for `tileCount` tiles of one preset. Columns never exceed the tile count (no empty trailing cells). */
export function sheetLayout(preset: SizePreset, params: SheetParams, tileCount: number): SheetLayout {
  const { padding, gap, header, caption, border } = SHEET_CHROME;
  const columns = Math.max(1, Math.min(params.columns, tileCount));
  const rows = Math.max(1, Math.ceil(tileCount / columns));
  const tileWidth = Math.max(1, Math.round(preset.px.width * params.scale));
  const tileHeight = Math.max(1, Math.round(preset.px.height * params.scale));
  const cellWidth = tileWidth + 2 * border;
  const cellHeight = caption + tileHeight + 2 * border;
  return {
    scale: params.scale,
    columns,
    tileWidth,
    tileHeight,
    cellWidth,
    cellHeight,
    rows,
    width: 2 * padding + columns * cellWidth + (columns - 1) * gap,
    height: 2 * padding + header + rows * cellHeight + (rows - 1) * gap,
  };
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export type TileStatus = 'rendered' | 'failed' | 'missing';
export type TileLevel = 'error' | 'warn' | 'ok';

/** Border colour per severity (red on error-level, amber on warn). */
export const TILE_COLOURS: Record<TileLevel, string> = { error: '#ef4444', warn: '#f59e0b', ok: '#3f3f46' };

export interface SheetTile {
  key: string;
  ordinal: number;
  /** '01' */
  label: string;
  screenId: string;
  template: string;
  status: TileStatus;
  /** '/project/out/<locale>/<displayType>/NN-<id>.png' for a rendered item; null otherwise. */
  imageUrl: string | null;
  warnings: Warning[];
  counts: Record<WarningLevel, number>;
  level: TileLevel;
  /** 'ok' or '1 error, 2 warn, 1 info'. */
  summary: string;
  /** Failure reason of a failed item. */
  error: string | null;
}

export function tileStatus(item: Pick<RenderReportItem, 'status'>): TileStatus {
  if (item.status === 'rendered' || item.status === 'passthrough') return 'rendered';
  return item.status === 'failed' ? 'failed' : 'missing';
}

/** Browser URL of an item's first output; the plugin serves <project>/* under /project/. */
export function tileImageUrl(item: RenderReportItem): string | null {
  const displayType = item.displayTypes[0];
  if (displayType === undefined || tileStatus(item) !== 'rendered') return null;
  const parts = [item.locale, displayType, renderFileName(item.ordinal, item.screenId)];
  return `/project/out/${parts.map(encodeURIComponent).join('/')}`;
}

export function warningSummary(counts: Record<WarningLevel, number>): string {
  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.info) parts.push(`${counts.info} info`);
  return parts.length > 0 ? parts.join(', ') : 'ok';
}

export function tileLevel(status: TileStatus, counts: Record<WarningLevel, number>): TileLevel {
  if (status === 'failed' || counts.error > 0) return 'error';
  if (status === 'missing' || counts.warn > 0) return 'warn';
  return 'ok';
}

export function sheetTile(item: RenderReportItem): SheetTile {
  const status = tileStatus(item);
  const counts = countByLevel(item.warnings);
  return {
    key: item.key,
    ordinal: item.ordinal,
    label: formatOrdinal(item.ordinal),
    screenId: item.screenId,
    template: item.template,
    status,
    imageUrl: tileImageUrl(item),
    warnings: item.warnings,
    counts,
    level: tileLevel(status, counts),
    summary: warningSummary(counts),
    error: status === 'failed' ? (item.error ?? 'render failed') : null,
  };
}

/** Tiles of one size (an alias resolves to its render target), in ordinal order. Unknown size -> []. */
export function sheetTiles(report: Pick<RenderReport, 'items'>, sizeId: string): SheetTile[] {
  if (!isSizeId(sizeId)) return [];
  const target = renderTarget(getPreset(sizeId)).id;
  return report.items
    .filter((item) => item.sizeId === target)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(sheetTile);
}

export interface SheetSummary {
  tiles: number;
  rendered: number;
  failed: number;
  errors: number;
  warns: number;
  infos: number;
}

export function sheetSummary(tiles: readonly SheetTile[]): SheetSummary {
  const summary: SheetSummary = { tiles: tiles.length, rendered: 0, failed: 0, errors: 0, warns: 0, infos: 0 };
  for (const tile of tiles) {
    if (tile.status === 'rendered') summary.rendered += 1;
    if (tile.status === 'failed') summary.failed += 1;
    summary.errors += tile.counts.error;
    summary.warns += tile.counts.warn;
    summary.infos += tile.counts.info;
  }
  return summary;
}

/** 'ok', or '1 failed, 2 errors, 3 warns' for the header line. */
export function summaryText(summary: SheetSummary): string {
  const parts: string[] = [];
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.errors) parts.push(`${summary.errors} error${summary.errors === 1 ? '' : 's'}`);
  if (summary.warns) parts.push(`${summary.warns} warn`);
  if (summary.infos) parts.push(`${summary.infos} info`);
  return parts.length > 0 ? parts.join(', ') : 'ok';
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/** Render-target sizes that have at least one item in the report, in report order. */
export function reportSizes(report: Pick<RenderReport, 'items'>): SizeId[] {
  const seen = new Set<SizeId>();
  for (const item of report.items) seen.add(item.sizeId);
  return [...seen];
}

/**
 * Sizes to sheet: `requested` with aliases collapsed onto their render
 * targets, or every size in the report. Requested ids without an item in
 * the report (or unknown ids) come back in `absent` so the caller can
 * explain what to render first.
 */
export function sheetSizes(report: Pick<RenderReport, 'items'>, requested?: readonly string[]): { sizes: SizeId[]; absent: string[] } {
  const present = reportSizes(report);
  if (requested === undefined || requested.length === 0) return { sizes: present, absent: [] };
  const sizes: SizeId[] = [];
  const absent: string[] = [];
  for (const id of requested) {
    if (!isSizeId(id)) {
      absent.push(id);
      continue;
    }
    const target = renderTarget(getPreset(id)).id;
    if (!present.includes(target)) {
      absent.push(id);
      continue;
    }
    if (!sizes.includes(target)) sizes.push(target);
  }
  return { sizes, absent };
}
