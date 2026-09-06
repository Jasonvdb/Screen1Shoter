// review.md: a compact, human- and agent-readable summary of one render run.
// Everything here is derived from the RenderReport; the file is regenerated
// on every render and lives next to report.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { templateMeta } from '../config/template-meta.ts';
import type { RenderReport, RenderReportItem, Warning } from '../config/types.ts';
import { countByLevel } from '../config/warnings.ts';
import { reviewPath, toPosix } from '../core/paths.ts';
import type { Project } from '../core/project.ts';

function rel(project: Project, path: string | null): string {
  return path === null ? '-' : toPosix(relative(project.dir, path));
}

function warningCell(warnings: readonly Warning[]): string {
  const counts = countByLevel(warnings);
  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} error`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.info) parts.push(`${counts.info} info`);
  return parts.length ? parts.join(', ') : 'none';
}

function statusCell(item: RenderReportItem): string {
  return item.status === 'failed' ? 'FAILED' : item.status;
}

function groupBySize(items: readonly RenderReportItem[]): Map<string, RenderReportItem[]> {
  const groups = new Map<string, RenderReportItem[]>();
  for (const item of items) {
    const list = groups.get(item.sizeId) ?? [];
    list.push(item);
    groups.set(item.sizeId, list);
  }
  return groups;
}

export function reviewMarkdown(project: Project, report: RenderReport): string {
  const items = report.items;
  const lines: string[] = [];
  const appName = project.manifest.app.name || 'app';
  lines.push(`# Screenshot review: ${appName} (${report.locale})`);
  lines.push('');
  lines.push(
    `Generated ${report.generatedAt}${report.dryRun ? ' (dry run)' : ''}. Sizes: ${report.sizes.join(', ')}. ` +
      `Result: ${report.ok ? 'OK' : 'NOT OK'} (${report.counts.rendered} rendered, ${report.counts.failed} failed, ` +
      `${report.counts.skipped} skipped; ${report.counts.errors} errors, ${report.counts.warns} warnings, ${report.counts.infos} infos).`,
  );
  lines.push('');

  for (const [sizeId, group] of groupBySize(items)) {
    const displayTypes = [...new Set(group.flatMap((i) => i.displayTypes))].join(', ');
    lines.push(`## ${sizeId} (${displayTypes})`);
    lines.push('');
    lines.push('| # | Screen | Template | Status | Warnings | Preview |');
    lines.push('|---|---|---|---|---|---|');
    for (const item of group) {
      lines.push(
        `| ${String(item.ordinal).padStart(2, '0')} | ${item.screenId} | ${item.template} | ${statusCell(item)} | ` +
          `${warningCell(item.warnings)} | ${rel(project, item.preview)} |`,
      );
    }
    lines.push('');
  }

  const failed = items.filter((i) => i.status === 'failed');
  if (failed.length) {
    lines.push('## Failures');
    lines.push('');
    for (const item of failed) lines.push(`- ${item.key}: ${item.error ?? 'unknown error'}`);
    lines.push('');
  }

  const withWarnings = items.filter((i) => i.warnings.length > 0);
  if (withWarnings.length) {
    lines.push('## Warnings');
    lines.push('');
    for (const item of withWarnings) {
      lines.push(`### ${item.key}`);
      lines.push('');
      for (const w of item.warnings) {
        lines.push(`- [${w.level}] ${w.code}: ${w.message}${w.element ? ` (${w.element})` : ''}`);
      }
      lines.push('');
    }
  }

  const nonCompliant = [...new Set(items.map((i) => i.template))].filter((id) => templateMeta(id)?.compliant === false);
  if (nonCompliant.length) {
    lines.push('## Non-compliant templates');
    lines.push('');
    lines.push(
      `These templates break Apple's marketing guidelines (cropped or tilted devices): ${nonCompliant.join(', ')}. ` +
        'Use them only when you accept that risk.',
    );
    lines.push('');
  }

  lines.push('## Next steps');
  lines.push('');
  if (report.dryRun) {
    lines.push('- This was a dry run. Run `s1s render` without `--dry-run` to write PNGs.');
  } else if (!report.ok) {
    lines.push('- Fix every error above (captures, copy, overflow), then run `s1s render` again.');
  } else {
    lines.push(`- Look at the contact sheets (out/${report.locale}/sheet-<sizeId>.png, every screen of a size in one image), then the previews listed above (one third scale).`);
    lines.push('- Mark screens `image-approved` with `s1s status --set image-approved ...` before `s1s export`.');
  }
  lines.push('');
  return lines.join('\n');
}

/** Writes review.md for the report's locale and returns its path. */
export async function writeReview(project: Project, report: RenderReport): Promise<string> {
  const path = reviewPath(project, report.locale);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, reviewMarkdown(project, report), 'utf8');
  return path;
}
