// `s1s validate`: offline check of metadata/screenshots against the rules
// App Store Connect enforces at upload time. Nothing is written and nothing is
// uploaded; the only output is the table, the problem list and the exit code
// (1 when any problem is error-level), so it is safe to run before every
// `asc screenshots upload`.
import type { Command } from 'commander';
import { ALL_SIZE_IDS, formatDims, isSizeId } from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import {
  validateExport,
  type ValidateOptions,
  type ValidateProblem,
  type ValidateReport,
  type ValidateSet,
} from '../../render/validate.ts';
import { bullets, defineAction, parseList, table, type CommandOutput, type GlobalOpts } from '../output.ts';
import { openProject } from './link.ts';

interface ValidateCliOptions {
  metadataDir?: string;
  locale?: string;
  sizes?: string[];
}

/** '1320x2868', 'mixed' (only when the sizes really differ) or '-'. */
function dimsCell(set: ValidateSet): string {
  if (set.dims) return formatDims(set.dims);
  return set.problems.some((problem) => problem.code === 'dims-mixed') ? 'mixed' : '-';
}

function problemCell(problems: readonly ValidateProblem[]): string {
  const errors = problems.filter((p) => p.level === 'error').length;
  const warns = problems.length - errors;
  const parts = [errors > 0 ? `${errors} error` : null, warns > 0 ? `${warns} warn` : null].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'ok';
}

/** One problem line; the file, when there is one, is shown inside the message. */
function problemLine(problem: ValidateProblem): string {
  return `${problem.code}: ${problem.message}`;
}

export function validateText(report: ValidateReport): string {
  const rows = report.sets.map((set) => [
    set.locale,
    set.displayType,
    String(set.count),
    dimsCell(set),
    problemCell(set.problems),
  ]);
  const lines = [table(['locale', 'display type', 'files', 'dims', 'problems'], rows)];

  if (report.scanned.length > report.locales.length) {
    // A narrowed run still reports cross-locale problems, which name locales
    // outside --locale; without this line those names look like a bug.
    lines.push(
      `--locale narrowed the table to ${report.locales.length > 0 ? report.locales.join(', ') : 'no locale'}; the cross-locale rules still compared every locale folder: ${report.scanned.join(', ')}.`,
    );
  }

  const errors = report.problems.filter((p) => p.level === 'error');
  const warns = report.problems.filter((p) => p.level === 'warn');
  lines.push(
    '',
    `${report.sets.length} set${report.sets.length === 1 ? '' : 's'} in ${report.locales.length} locale${report.locales.length === 1 ? '' : 's'} under ${report.metadataDir}; ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warns.length} warning${warns.length === 1 ? '' : 's'}.`,
  );
  if (errors.length > 0) lines.push('', 'Errors:', bullets(errors.map(problemLine)));
  if (warns.length > 0) lines.push('', 'Warnings:', bullets(warns.map(problemLine)));
  if (report.ok && warns.length === 0) lines.push('', 'Ready to upload.');
  return lines.join('\n');
}

async function validateCommand(globals: GlobalOpts, opts: ValidateCliOptions): Promise<CommandOutput> {
  for (const id of opts.sizes ?? []) {
    if (!isSizeId(id)) throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
  }
  const project = await openProject(globals);
  const validateOpts: ValidateOptions = {};
  if (opts.metadataDir !== undefined) validateOpts.metadataDir = opts.metadataDir;
  if (opts.locale !== undefined) validateOpts.locale = opts.locale;
  if (opts.sizes && opts.sizes.length > 0) validateOpts.sizes = opts.sizes;

  const report = await validateExport(project, validateOpts);
  return { data: { ...report }, text: validateText(report), exitCode: report.ok ? 0 : 1 };
}

export function registerValidate(program: Command): void {
  defineAction<ValidateCliOptions>(
    program
      .command('validate')
      .description('Check an export folder offline against App Store Connect rules (names, order, count, dims, alpha)')
      .option('--metadata-dir <dir>', 'export dir to check (default: manifest.app.metadataDir)')
      .option('--locale <locale>', 'locale to report in detail (default: all); the all-or-nothing rule always compares every locale folder')
      .option('--sizes <list>', 'comma-separated size ids (default: every display type present)', parseList),
    ({ globals, opts }) => validateCommand(globals, opts),
  );
}
