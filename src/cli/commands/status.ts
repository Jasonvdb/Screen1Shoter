// `s1s status`: the reconcile table (manifest versus files on disk versus
// screens.ts), and the one guarded way to move statuses by hand.
//
// The store is never contacted: reading it needs credentials and network, so
// an 'uploaded' row says so instead. `--set` is all-or-nothing - every
// transition is checked before anything is written - and a selection that
// covers a whole locale needs `--yes`. `--from <status>` narrows the write to
// the rows that hold that status, which is the only way to say what
// references/copy-playbook.md asks for on a mixed locale.
import { relative } from 'node:path';
import type { Command } from 'commander';
import { ALL_SIZE_IDS, IMAGE_STATUSES, formatOrdinal, isSizeId, type ImageStatus } from '../../config/index.ts';
import { S1sError } from '../../core/errors.ts';
import { appendRun, imageState, writeManifest } from '../../core/manifest.ts';
import type { Project } from '../../core/project.ts';
import {
  STORE_NOT_CONSULTED,
  reconcile,
  setStatus,
  type ImageRef,
  type ReconcileOptions,
  type ReconcileReport,
  type ReconcileRow,
} from '../../core/reconcile.ts';
import { bullets, defineAction, log, parseList, table, type CommandOutput, type GlobalOpts } from '../output.ts';
import { openProject } from './link.ts';

interface StatusCliOptions {
  locale?: string;
  sizes?: string[];
  screens?: string[];
  set?: string;
  from?: string;
  yes?: boolean;
}

/** 'en-US iphone-6.9 01-home' (orphans have no ordinal). */
function rowName(row: ReconcileRow): string {
  const screen = row.ordinal > 0 ? `${formatOrdinal(row.ordinal)}-${row.screenId}` : row.screenId;
  return `${row.locale} ${row.sizeId} ${screen}`;
}

/** The render column shows staleness, which is a third state the file check cannot express. */
function renderCell(row: ReconcileRow): string {
  return row.renderStale ? 'stale' : row.render;
}

function summaryLine(report: ReconcileReport): string {
  const counts = Object.entries(report.summary).map(([status, count]) => `${count} ${status}`);
  const parts = [`${report.rows.length} row${report.rows.length === 1 ? '' : 's'}${counts.length > 0 ? ` (${counts.join(', ')})` : ''}`];
  if (report.orphans.length > 0) parts.push(`${report.orphans.length} orphan${report.orphans.length === 1 ? '' : 's'}`);
  if (report.strayExports.length > 0) parts.push(`${report.strayExports.length} stray export${report.strayExports.length === 1 ? '' : 's'}`);
  return `${parts.join(', ')} - ${report.ok ? 'OK' : 'NOT OK'}`;
}

export function statusText(project: Project, report: ReconcileReport): string {
  const rows = report.rows.map((row) => [
    row.locale,
    row.sizeId,
    row.ordinal > 0 ? formatOrdinal(row.ordinal) : '--',
    row.screenId,
    row.status,
    row.capture,
    renderCell(row),
    row.export,
  ]);
  const lines = [table(['locale', 'size', 'NN', 'screen', 'status', 'capture', 'render', 'export'], rows)];

  if (report.orphans.length > 0) {
    lines.push('', 'Orphans (in the manifest, not in screens.ts):');
    lines.push(bullets(report.orphans.map((row) => `${rowName(row)} (${row.status}): ${row.notes.join('; ')}`)));
  }
  if (report.strayExports.length > 0) {
    lines.push('', 'Stray exports (no manifest entry claims them):');
    lines.push(bullets(report.strayExports.map((path) => relative(project.appDir, path))));
  }

  const notes = report.rows.flatMap((row) =>
    row.notes.filter((note) => note !== STORE_NOT_CONSULTED).map((note) => `${rowName(row)}: ${note}`),
  );
  if (notes.length > 0) lines.push('', 'Notes:', bullets(notes));

  const uploaded = report.rows.filter((row) => row.status === 'uploaded').length;
  if (uploaded > 0) lines.push('', `${uploaded} uploaded row(s): ${STORE_NOT_CONSULTED}.`);

  lines.push('', summaryLine(report));
  return lines.join('\n');
}

function reconcileOptions(opts: StatusCliOptions): ReconcileOptions {
  return {
    ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
    ...(opts.sizes && opts.sizes.length > 0 ? { sizes: opts.sizes } : {}),
    ...(opts.screens && opts.screens.length > 0 ? { screens: opts.screens } : {}),
  };
}

/** `--set` and `--from` must each name an ImageStatus; anything else lists them. */
function parseStatus(flag: string, value: string): ImageStatus {
  const status = IMAGE_STATUSES.find((known) => known === value);
  if (status === undefined) {
    throw new S1sError('usage', `Unknown status "${value}" for ${flag}. Valid statuses: ${IMAGE_STATUSES.join(', ')}.`);
  }
  return status;
}

function setCommandLine(target: ImageStatus, opts: StatusCliOptions): string {
  const sizes = opts.sizes?.length ? ` --sizes ${opts.sizes.join(',')}` : '';
  const screens = opts.screens?.length ? ` --screens ${opts.screens.join(',')}` : '';
  const from = opts.from !== undefined ? ` --from ${opts.from}` : '';
  return `status --set ${target} --locale ${opts.locale ?? ''}${sizes}${screens}${from}`;
}

function refOf(row: ReconcileRow): ImageRef {
  return { locale: row.locale, sizeId: row.sizeId, screenId: row.screenId };
}

/**
 * Rows this `--set` really rewrites. A row already at the target is usually a
 * no-op, except for the re-upload that clears `wasUploaded`: there the status
 * does not move but the flag and `uploadedAt` must still be written.
 */
function changedRows(project: Project, rows: readonly ReconcileRow[], target: ImageStatus): ReconcileRow[] {
  return rows.filter((row) => {
    if (row.status !== target) return true;
    if (target !== 'uploaded') return false;
    return imageState(project.manifest, row.locale, row.sizeId, row.screenId)?.wasUploaded === true;
  });
}

/** One line of the list a refused `--set` prints. */
function changeLine(row: ReconcileRow, target: ImageStatus): string {
  const move = row.status === target ? `${target} (clears wasUploaded)` : `${row.status} -> ${target}`;
  return `  ${rowName(row)}: ${move}`;
}

async function applySet(
  project: Project,
  report: ReconcileReport,
  target: ImageStatus,
  from: ImageStatus | null,
  opts: StatusCliOptions,
): Promise<ReconcileReport> {
  const startedAt = new Date().toISOString();
  if (report.rows.length === 0) {
    throw new S1sError('usage', `No images match --locale ${opts.locale ?? ''}${opts.sizes ? ` --sizes ${opts.sizes.join(',')}` : ''}${opts.screens ? ` --screens ${opts.screens.join(',')}` : ''}.`, {
      hint: 'Run `s1s status` without --set to see the rows this project has.',
    });
  }
  // `--from` is the one selector that reads the status instead of screens.ts.
  // Nothing to do is a no-op, not a refusal: `--set copy-approved --from
  // pending` is written to be run again on a locale that has moved on.
  const selection = from === null ? report.rows : report.rows.filter((row) => row.status === from);
  if (selection.length === 0) {
    log(`no image of ${opts.locale ?? ''} is ${from}; nothing was written.`);
    return report;
  }
  // Every selected row is checked before any of them is applied: a bad row
  // must not leave the manifest half updated.
  const updated = setStatus(project.manifest, selection.map(refOf), target);

  const changes = changedRows(project, selection, target);
  if (changes.length === 0) return report;

  // A --set that rewrites the whole locale needs --yes. Typing --sizes or
  // --screens is not narrowing by itself: naming every size selects the same
  // images as naming none, so the rows are counted, not the flags. `--from`
  // is counted the same way: it usually leaves fewer rows, but on a locale
  // that is uniformly at that status it still covers everything.
  const narrowed = (opts.sizes?.length ?? 0) > 0 || (opts.screens?.length ?? 0) > 0 || from !== null;
  const wholeLocale =
    !narrowed ||
    selection.length >=
      (await reconcile(project, opts.locale === undefined ? {} : { locale: opts.locale })).rows.length;
  if (wholeLocale && opts.yes !== true) {
    log(`--set ${target} would change ${changes.length} of ${selection.length} selected image(s) in ${opts.locale ?? ''}:`);
    for (const row of changes) log(changeLine(row, target));
    throw new S1sError('usage', `--set ${target} covers every image of ${opts.locale ?? ''} (${changes.length} change(s)); re-run with --yes to apply it. Nothing was written.`, {
      hint: 'Or narrow the selection with --sizes / --screens / --from <status>.',
    });
  }

  const manifest = appendRun(updated, {
    command: setCommandLine(target, opts),
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: true,
    notes: `${changes.length} image(s) set to ${target}`,
  });
  await writeManifest(project.manifestPath, manifest);
  log(`set ${changes.length} image(s) to ${target} in ${relative(project.appDir, project.manifestPath)}`);

  // Report the state the write produced, not the one it replaced.
  return reconcile({ ...project, manifest }, reconcileOptions(opts));
}

async function statusCommand(globals: GlobalOpts, opts: StatusCliOptions): Promise<CommandOutput> {
  for (const id of opts.sizes ?? []) {
    if (!isSizeId(id)) throw new S1sError('usage', `Unknown size "${id}". Known sizes: ${ALL_SIZE_IDS.join(', ')}.`);
  }
  if (opts.set !== undefined && opts.locale === undefined) {
    throw new S1sError('usage', '`s1s status --set <status>` needs --locale <locale>.', {
      hint: 'Statuses are per locale; pass --locale and, to narrow further, --sizes / --screens / --from.',
    });
  }
  if (opts.from !== undefined && opts.set === undefined) {
    throw new S1sError('usage', '`--from <status>` narrows a `--set`, so it needs --set <status>.', {
      hint: 'Run `s1s status --locale <locale>` to see the statuses the rows hold.',
    });
  }
  const target = opts.set === undefined ? null : parseStatus('--set', opts.set);
  const from = opts.from === undefined ? null : parseStatus('--from', opts.from);

  const project = await openProject(globals);
  let report = await reconcile(project, reconcileOptions(opts));
  if (target !== null) report = await applySet(project, report, target, from, opts);

  return {
    data: { ...report, ...(target !== null ? { set: target } : {}) },
    text: statusText(project, report),
    exitCode: report.ok ? 0 : 1,
  };
}

export function registerStatus(program: Command): void {
  defineAction<StatusCliOptions>(
    program
      .command('status')
      .description('Reconcile the manifest, the files on disk and screens.ts (the store is never contacted)')
      .option('--locale <locale>', 'locale to report on (default: every locale)')
      .option('--sizes <list>', 'comma-separated size ids (default: the project sizes)', parseList)
      .option('--screens <list>', 'comma-separated screen ids or ordinals (default: all)', parseList)
      .option('--set <status>', `write this status to the selected images (${IMAGE_STATUSES.join(', ')}); needs --locale`)
      .option('--from <status>', 'with --set: only images currently at this status')
      .option('--yes', 'confirm a --set that covers every image of the locale'),
    ({ globals, opts }) => statusCommand(globals, opts),
  );
}
