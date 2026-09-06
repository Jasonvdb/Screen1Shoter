// `s1s sheet`: contact sheet PNGs from an existing render (out/<locale>/
// report.json plus the PNGs it lists). `s1s render` runs this automatically
// unless --no-sheet; this command re-runs it with other --scale / --columns.
import { relative } from 'node:path';
import { InvalidArgumentError, type Command } from 'commander';
import { ALL_SIZE_IDS, isSizeId } from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import type { Project } from '../../core/project.ts';
import { sheetProject, type SheetOptions, type SheetResult } from '../../render/sheet.ts';
import { SHEET_DEFAULTS, summaryText } from '../../web/app/sheet-model.ts';
import { defineAction, log, parseList, parsePositiveInt, table, type CommandOutput, type GlobalOpts } from '../output.ts';
import { openProject } from './link.ts';

interface SheetCliOptions {
  locale?: string;
  sizes?: string[];
  scale: number;
  columns: number;
}

/** Fraction in (0, 1] (`--scale 0.25`). */
export function parseScale(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw new InvalidArgumentError(`expected a number in (0, 1], got "${value}"`);
  return n;
}

export function sheetText(project: Project, result: SheetResult): string {
  const rows = result.sheets.map((s) => [
    s.sizeId,
    relative(project.dir, s.path),
    `${s.dims.width}x${s.dims.height}`,
    `${s.tiles} (${s.columns}x${s.rows})`,
    summaryText(s.summary),
  ]);
  return [
    table(['size', 'sheet', 'px', 'tiles', 'warnings'], rows),
    '',
    `${result.sheets.length} sheet${result.sheets.length === 1 ? '' : 's'} at scale ${result.scale}, ${result.columns} columns, from ${result.reportPath}`,
  ].join('\n');
}

async function sheetCommand(globals: GlobalOpts, opts: SheetCliOptions): Promise<CommandOutput> {
  for (const id of opts.sizes ?? []) {
    if (!isSizeId(id)) throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
  }
  const project = await openProject(globals);
  const locale = opts.locale ?? project.sourceLocale;
  const sheetOpts: SheetOptions = {
    locale,
    scale: opts.scale,
    columns: opts.columns,
    onProgress: (sheet) => log(`sheet ${sheet.sizeId.padEnd(10)} ${sheet.dims.width}x${sheet.dims.height}  ${summaryText(sheet.summary)}`),
  };
  if (opts.sizes && opts.sizes.length > 0) sheetOpts.sizes = opts.sizes;
  const result = await sheetProject(project, sheetOpts);
  return { data: { ...result }, text: sheetText(project, result) };
}

export function registerSheet(program: Command): void {
  defineAction<SheetCliOptions>(
    program
      .command('sheet')
      .description('Write a contact sheet per size from the last render: out/<locale>/sheet-<sizeId>.png')
      .option('--locale <locale>', 'locale whose out/<locale>/report.json to lay out (default: the source locale)')
      .option('--sizes <list>', 'comma-separated size ids (default: every size in the report)', parseList)
      .option('--scale <fraction>', 'tile size as a fraction of the output PNG', parseScale, SHEET_DEFAULTS.scale)
      .option('--columns <n>', 'tiles per row', parsePositiveInt, SHEET_DEFAULTS.columns),
    ({ globals, opts }) => sheetCommand(globals, opts),
  );
}
