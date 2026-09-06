// Render bookkeeping, browser-free: the RenderReport counts and the manifest
// rule from CONTRACTS.md. render.ts calls these after the pixels are done;
// the unit tests call them with synthetic report items.
import { relative } from 'node:path';
import type {
  ImageState,
  ManifestRun,
  ProjectManifest,
  RenderItem,
  RenderReport,
  RenderReportItem,
  SizeId,
  Warning,
} from '../config/types.ts';
import { countByLevel, makeWarning } from '../config/warnings.ts';
import { appendRun, imageState, updateImage } from '../core/manifest.ts';
import type { Project } from '../core/project.ts';

/** `manifest.runs` keeps the newest entries only. */
export const MAX_MANIFEST_RUNS = 50;

/** The RenderOptions fields the bookkeeping needs. */
export interface BookkeepingOptions {
  locale: string;
  sizes?: string[];
  screens?: string[];
  dryRun?: boolean;
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

export function buildReport(
  project: Pick<Project, 'dir'>,
  opts: BookkeepingOptions,
  sizes: SizeId[],
  items: RenderReportItem[],
): RenderReport {
  const counts = { rendered: 0, failed: 0, skipped: 0, errors: 0, warns: 0, infos: 0 };
  for (const item of items) {
    if (item.status === 'rendered' || item.status === 'passthrough') counts.rendered += 1;
    else if (item.status === 'failed') counts.failed += 1;
    else counts.skipped += 1;
    const levels = countByLevel(item.warnings);
    counts.errors += levels.error;
    counts.warns += levels.warn;
    counts.infos += levels.info;
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectDir: project.dir,
    locale: opts.locale,
    sizes,
    dryRun: opts.dryRun ?? false,
    items,
    counts,
    ok: counts.failed === 0 && counts.errors === 0,
  };
}

/** Manifest warnings for one item: project-level copy-unused infos stay in report.json only. */
export function manifestWarnings(result: RenderReportItem): Warning[] {
  return result.warnings.filter((w) => w.code !== 'copy-unused');
}

/** The `runs` entry one render appends. */
export function renderRun(opts: BookkeepingOptions, report: RenderReport, startedAt: string, finishedAt: string): ManifestRun {
  const sizes = opts.sizes?.length ? ` --sizes ${opts.sizes.join(',')}` : '';
  const screens = opts.screens?.length ? ` --screens ${opts.screens.join(',')}` : '';
  return {
    command: `render --locale ${opts.locale}${sizes}${screens}`,
    startedAt,
    finishedAt,
    ok: report.ok,
    notes: `${report.counts.rendered} rendered, ${report.counts.failed} failed, ${report.counts.errors} errors`,
  };
}

/**
 * Render bookkeeping rule from CONTRACTS.md: on a hash change set render,
 * renderHash, renderedAt, renderWarnings and status 'generated' (flagging
 * wasUploaded when the previous status was 'uploaded'); on an unchanged hash
 * keep the status and only refresh the warnings. A failed item drops its
 * render fields and records an error-level 'render-failed' warning. Returns
 * the new manifest with the run appended (capped at MAX_MANIFEST_RUNS).
 */
export function applyManifest(
  project: Pick<Project, 'dir' | 'manifest'>,
  opts: BookkeepingOptions,
  items: readonly RenderItem[],
  results: readonly RenderReportItem[],
  report: RenderReport,
  startedAt: string,
): ProjectManifest {
  let manifest = project.manifest;
  const now = new Date().toISOString();
  results.forEach((result, index) => {
    const item = items[index];
    if (!item) return;
    if (result.status === 'failed') {
      const failure = makeWarning('render-failed', result.error ?? 'render failed');
      for (const output of item.outputs) {
        const ref = { locale: item.locale, sizeId: output.sizeId, screenId: item.screen.id };
        manifest = updateImage(
          manifest,
          ref,
          { renderWarnings: [...manifestWarnings(result), failure] },
          { drop: ['render', 'renderHash', 'renderedAt'] },
        );
      }
      return;
    }
    if (result.hash === null) return;
    for (const output of item.outputs) {
      const ref = { locale: item.locale, sizeId: output.sizeId, screenId: item.screen.id };
      const previous = imageState(manifest, ref.locale, ref.sizeId, ref.screenId);
      const patch: Partial<ImageState> = {
        render: toPosix(relative(project.dir, output.outPath)),
        renderWarnings: manifestWarnings(result),
      };
      if (previous?.renderHash !== result.hash) {
        patch.renderHash = result.hash;
        patch.renderedAt = now;
        patch.status = 'generated';
        if (previous?.status === 'uploaded') patch.wasUploaded = true;
      }
      manifest = updateImage(manifest, ref, patch);
    }
  });
  manifest = appendRun(manifest, renderRun(opts, report, startedAt, now));
  if (manifest.runs.length > MAX_MANIFEST_RUNS) manifest = { ...manifest, runs: manifest.runs.slice(-MAX_MANIFEST_RUNS) };
  return manifest;
}
