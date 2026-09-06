// `s1s render`: render one locale through src/render/render.ts and report.
// Exit 1 on any failed item or error-level warning; `--strict` also fails on
// warn-level warnings (the renderer promotes them, this command double-checks).
import { relative } from 'node:path';
import type { Command } from 'commander';
import {
  ALL_SIZE_IDS,
  countByLevel,
  formatOrdinal,
  isSizeId,
  type RenderReport,
  type RenderReportItem,
  type WarningLevel,
} from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import { reportPath, reviewPath } from '../../core/paths.ts';
import type { Project } from '../../core/project.ts';
import { renderProject, type RenderOptions } from '../../render/render.ts';
import { defineAction, log, parseList, parsePositiveInt, table, type CommandOutput, type GlobalOpts } from '../output.ts';
import { openProject } from './link.ts';

interface RenderCliOptions {
  locale?: string;
  sizes?: string[];
  screens?: string[];
  jobs: number;
  dryRun?: boolean;
  /** commander sets `sheet: false` for --no-sheet. */
  sheet: boolean;
  strict?: boolean;
  allowPlaceholder?: boolean;
}

function warningSummary(item: RenderReportItem): string {
  const counts = countByLevel(item.warnings);
  const parts = (['error', 'warn', 'info'] as const satisfies readonly WarningLevel[])
    .filter((level) => counts[level] > 0)
    .map((level) => `${counts[level]} ${level}`);
  return parts.length > 0 ? parts.join(', ') : '-';
}

function itemName(item: RenderReportItem): string {
  return `${formatOrdinal(item.ordinal)}-${item.screenId}`;
}

/** Failure reason of an item, if any. */
function itemError(item: RenderReportItem): string | null {
  return item.error !== undefined && item.error.length > 0 ? item.error : null;
}

function progressLine(item: RenderReportItem): string {
  const error = itemError(item);
  const tail = error ? `  ${error.length > 120 ? `${error.slice(0, 117)}...` : error}` : '';
  return `${item.status.padEnd(11)} ${item.sizeId.padEnd(10)} ${itemName(item)}  ${warningSummary(item)}${tail}`;
}

export function renderText(project: Project, report: RenderReport): string {
  const rows = report.items.map((item) => [
    item.sizeId,
    itemName(item),
    item.template,
    item.status,
    warningSummary(item),
    item.outputs[0] ? relative(project.dir, item.outputs[0]) : '-',
  ]);
  const lines = [table(['size', 'screen', 'template', 'status', 'warnings', 'output'], rows)];
  const c = report.counts;
  lines.push('', `${report.dryRun ? 'Dry run: ' : ''}${c.rendered} rendered, ${c.failed} failed, ${c.skipped} skipped; ${c.errors} errors, ${c.warns} warns, ${c.infos} infos.`);

  const problems = report.items.flatMap((item) => {
    const label = `${item.sizeId} ${itemName(item)}`;
    const error = itemError(item);
    return [
      ...(error ? [`${label}: failed: ${error}`] : []),
      ...item.warnings.filter((w) => w.level !== 'info').map((w) => `${label}: ${w.level} ${w.code}: ${w.message}`),
    ];
  });
  if (problems.length > 0) lines.push('', 'Problems:', ...problems.map((p) => `  - ${p}`));
  if (!report.dryRun) {
    lines.push('', `Report: ${reportPath(project, report.locale)}`, `Review: ${reviewPath(project, report.locale)}`);
    // Only what this run wrote: stale sheets are deleted by renderProject.
    if (report.sheets.length > 0) lines.push(`Sheets: ${report.sheets.map((s) => s.path).join(', ')}`);
  }
  return lines.join('\n');
}

async function renderCommand(globals: GlobalOpts, opts: RenderCliOptions): Promise<CommandOutput> {
  for (const id of opts.sizes ?? []) {
    if (!isSizeId(id)) throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
  }
  const project = await openProject(globals);
  const locale = opts.locale ?? project.sourceLocale;

  const renderOpts: RenderOptions = {
    locale,
    jobs: opts.jobs,
    dryRun: opts.dryRun === true,
    sheet: opts.sheet,
    strict: opts.strict === true,
    allowPlaceholder: opts.allowPlaceholder === true,
    onProgress: (item) => log(progressLine(item)),
  };
  if (opts.sizes && opts.sizes.length > 0) renderOpts.sizes = opts.sizes;
  if (opts.screens && opts.screens.length > 0) renderOpts.screens = opts.screens;

  const report = await renderProject(project, renderOpts);
  const strictFail = opts.strict === true && report.counts.warns > 0;
  const ok = report.ok && !strictFail;
  return {
    data: { ok, report, sheets: report.sheets },
    text: renderText(project, report),
    exitCode: ok ? 0 : 1,
  };
}

export function registerRender(program: Command): void {
  defineAction<RenderCliOptions>(
    program
      .command('render')
      .description('Render one locale to out/<locale>/<APP_DISPLAY_TYPE>/NN-<id>.png (plus previews, report.json, review.md)')
      .option('--locale <locale>', 'locale to render (default: the source locale)')
      .option('--sizes <list>', 'comma-separated size ids (default: the project sizes)', parseList)
      .option('--screens <list>', 'comma-separated screen ids or ordinals (default: all)', parseList)
      .option('--jobs <n>', 'pages rendered in parallel', parsePositiveInt, 4)
      .option('--dry-run', 'plan the matrix and check inputs; write nothing')
      .option('--no-sheet', 'skip the contact sheet')
      .option('--strict', 'treat warn-level warnings as errors')
      .option('--allow-placeholder', 'render missing captures as placeholders (warn instead of error)'),
    ({ globals, opts }) => renderCommand(globals, opts),
  );
}
