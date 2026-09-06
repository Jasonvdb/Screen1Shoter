// `s1s export`: copy the last render into metadata/screenshots/<locale>/
// <APP_DISPLAY_TYPE>/NN.png and print the `asc screenshots upload` commands
// that follow. Refuses on anything the store would reject; the human approval
// gate stays advisory (a warning, not a block).
import { dirname, relative } from 'node:path';
import type { Command } from 'commander';
import { ALL_SIZE_IDS, formatOrdinal, isSizeId } from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import type { Project } from '../../core/project.ts';
import { exportProject, type ExportFile, type ExportOptions, type ExportReport } from '../../render/export.ts';
import { bullets, defineAction, log, parseList, table, type CommandOutput, type GlobalOpts } from '../output.ts';
import { openProject } from './link.ts';

interface ExportCliOptions {
  locale?: string;
  sizes?: string[];
  metadataDir?: string;
  prune?: boolean;
  dryRun?: boolean;
  /** commander sets `asc: false` for --no-asc. */
  asc: boolean;
}

/** One table row per display type, in the order the files were written. */
interface ExportRow {
  sizeId: string;
  displayType: string;
  dir: string;
  count: number;
  written: number;
  unchanged: number;
}

export function exportRows(report: ExportReport): ExportRow[] {
  const rows = new Map<string, ExportRow>();
  for (const file of report.files) {
    const row = rows.get(file.displayType) ?? { sizeId: file.sizeId, displayType: file.displayType, dir: dirname(file.to), count: 0, written: 0, unchanged: 0 };
    row.count += 1;
    if (file.action === 'written') row.written += 1;
    else if (file.action === 'unchanged') row.unchanged += 1;
    rows.set(file.displayType, row);
  }
  return [...rows.values()];
}

/**
 * The `issues` array `asc screenshots validate --output json` prints. Read
 * defensively: an older asc (or an error banner) leaves `report` as raw text.
 */
function ascIssues(report: unknown): string[] {
  if (typeof report !== 'object' || report === null) return [];
  const issues = (report as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  const lines: string[] = [];
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const fields = issue as Record<string, unknown>;
    const severity = typeof fields['severity'] === 'string' ? fields['severity'] : 'error';
    const file = typeof fields['fileName'] === 'string' ? `${fields['fileName']}: ` : '';
    const message = typeof fields['message'] === 'string' ? fields['message'] : JSON.stringify(issue);
    lines.push(`${severity} ${file}${message}`);
  }
  return lines;
}

function progressLine(project: Project, file: ExportFile, dryRun: boolean): string {
  const action = dryRun ? `would ${file.action === 'unchanged' ? 'keep' : 'write'}` : file.action;
  return `${action.padEnd(11)} ${file.displayType.padEnd(22)} ${formatOrdinal(file.ordinal)}-${file.screenId} -> ${relative(project.appDir, file.to)}`;
}

export function exportText(project: Project, report: ExportReport): string {
  const rows = exportRows(report);
  // report.asc holds one result per display type, in the same order.
  const ascFor = (index: number): string => {
    if (report.asc === null) return '-';
    const result = report.asc[index];
    return result === undefined ? '-' : result.ok ? 'ok' : 'FAILED';
  };
  const lines = [
    table(
      ['size', 'folder', 'files', 'written/unchanged', 'asc'],
      rows.map((row, index) => [
        row.sizeId,
        relative(project.appDir, row.dir),
        String(row.count),
        `${row.written}/${row.unchanged}`,
        ascFor(index),
      ]),
    ),
  ];
  const verb = report.dryRun ? 'would export' : 'exported';
  lines.push('', `${report.files.length} file(s) ${verb} to ${report.metadataDir}${report.dryRun ? ' (dry run: nothing written)' : ''}.`);

  if (report.pruned.length > 0) {
    lines.push('', `${report.dryRun ? 'Would prune' : 'Pruned'}:`, bullets(report.pruned.map((p) => relative(project.appDir, p))));
  }
  if (report.stale.length > 0) {
    lines.push(
      '',
      'Already in the upload folder, not written by this export (they still upload; re-run with --prune to delete them):',
      bullets(report.stale.map((p) => relative(project.appDir, p))),
    );
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:', bullets(report.warnings.map((w) => `${w.level} ${w.code}: ${w.message}`)));
  }
  const failed = (report.asc ?? []).filter((result) => !result.ok);
  if (failed.length > 0) {
    lines.push('', 'asc validation failed:');
    for (const result of failed) {
      const issues = ascIssues(result.report);
      lines.push(`  ${result.command}`, bullets(issues.length > 0 ? issues : [result.stderr || 'asc exited non-zero'], '    '));
    }
  }
  if (report.uploadCommands.length > 0) {
    lines.push(
      '',
      'Next, from the app repo root (asc-upload.md section 7). Read each dry run,',
      'then re-run the same command with --replace in place of --dry-run:',
      bullets(report.uploadCommands),
    );
  }
  if (report.fanOutCommands.length > 0) {
    lines.push(
      '',
      'Only when several locales are complete for one device, one run uploads them all',
      '(asc-upload.md section 8; --replace in place of --dry-run after you read it):',
      bullets(report.fanOutCommands),
    );
  }
  return lines.join('\n');
}

async function exportCommand(globals: GlobalOpts, opts: ExportCliOptions): Promise<CommandOutput> {
  for (const id of opts.sizes ?? []) {
    if (!isSizeId(id)) throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
  }
  const project = await openProject(globals);
  const locale = opts.locale ?? project.sourceLocale;

  const exportOpts: ExportOptions = {
    locale,
    prune: opts.prune === true,
    dryRun: opts.dryRun === true,
    asc: opts.asc,
    onProgress: (file) => log(progressLine(project, file, opts.dryRun === true)),
  };
  if (opts.sizes && opts.sizes.length > 0) exportOpts.sizes = opts.sizes;
  if (opts.metadataDir) exportOpts.metadataDir = opts.metadataDir;

  const report = await exportProject(project, exportOpts);
  return { data: { ...report }, text: exportText(project, report), exitCode: report.ok ? 0 : 1 };
}

export function registerExport(program: Command): void {
  defineAction<ExportCliOptions>(
    program
      .command('export')
      .description('Copy renders into metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png')
      .option('--locale <locale>', 'locale to export (default: the source locale)')
      .option('--sizes <list>', 'comma-separated size ids (default: every size in the render report)', parseList)
      .option('--metadata-dir <dir>', 'export root, absolute or relative to the app repo (default: manifest app.metadataDir)')
      .option('--prune', 'delete every NN.png / NN.jpg / NN.jpeg in each folder this export did not write')
      .option('--dry-run', 'plan the export; write nothing (no files, no manifest)')
      .option('--no-asc', 'skip `asc screenshots validate` even when asc is installed'),
    ({ globals, opts }) => exportCommand(globals, opts),
  );
}
