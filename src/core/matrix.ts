// Turns a project into the list of render items for one locale: aliases are
// grouped under their render target (rendered once, written to every
// requested display-type folder) and ordinals are 1-based per render preset.
import { join } from 'node:path';
import { presetsFor, renderTarget } from '../config/presets.ts';
import { formatOrdinal, renderFileName, renderRoute, resolveScreen, screenAppliesTo } from '../config/resolve.ts';
import type { LocaleCopy, RenderItem, RenderOutput, SizeId, SizePreset } from '../config/types.ts';
import { captureResolverFor } from './captures.ts';
import { S1sError } from './errors.ts';
import { previewDir, sizeOutDir } from './paths.ts';
import type { Project } from './project.ts';

export interface MatrixOptions {
  locale: string;
  /** Size ids; default project.sizes. Aliases allowed. */
  sizes?: string[];
  /** Screen ids or ordinals ('3', '03'); default every screen. */
  screens?: string[];
  /** Copy to resolve against; default project.copies[locale]. */
  copy?: LocaleCopy;
}

interface RenderGroup {
  target: SizePreset;
  requested: SizePreset[];
}

/** Groups requested presets by render target, keeping first-seen order. */
export function renderGroups(sizes: readonly string[]): RenderGroup[] {
  let presets: SizePreset[];
  try {
    presets = presetsFor(sizes);
  } catch (err) {
    throw new S1sError('usage', err instanceof Error ? err.message : String(err));
  }
  const groups = new Map<SizeId, RenderGroup>();
  for (const preset of presets) {
    const target = renderTarget(preset);
    const group = groups.get(target.id) ?? { target, requested: [] };
    group.requested.push(preset);
    groups.set(target.id, group);
  }
  return [...groups.values()];
}

function matchesSelection(selection: Set<string> | null, screenId: string, ordinal: number): boolean {
  if (!selection) return true;
  return selection.has(screenId) || selection.has(String(ordinal)) || selection.has(formatOrdinal(ordinal));
}

export function buildMatrix(project: Project, opts: MatrixOptions): RenderItem[] {
  const { locale } = opts;
  const copyError = project.copyErrors[locale];
  if (!opts.copy && copyError) throw copyError;
  const copy = opts.copy ?? project.copies[locale];
  const resolver = captureResolverFor(project);
  const selection = opts.screens && opts.screens.length > 0 ? new Set(opts.screens) : null;
  const matched = new Set<string>();
  const items: RenderItem[] = [];

  for (const { target, requested } of renderGroups(opts.sizes ?? project.sizes)) {
    const applicable = project.screens.screens.filter((screen) => screenAppliesTo(screen, target));
    applicable.forEach((screen, index) => {
      const ordinal = index + 1;
      if (!matchesSelection(selection, screen.id, ordinal)) return;
      for (const sel of [screen.id, String(ordinal), formatOrdinal(ordinal)]) matched.add(sel);
      const fileName = renderFileName(ordinal, screen.id);
      const outputs: RenderOutput[] = requested.map((preset) => ({
        sizeId: preset.id,
        displayType: preset.displayType,
        outPath: join(sizeOutDir(project, locale, preset.displayType), fileName),
        previewPath: join(previewDir(project, locale, preset.displayType), fileName),
      }));
      items.push({
        key: `${locale}/${target.id}/${screen.id}`,
        locale,
        preset: target,
        ordinal,
        screen: resolveScreen(screen, target, locale, copy, resolver),
        url: renderRoute(locale, target.id, screen.id),
        outputs,
        passthrough: target.passthrough === true,
      });
    });
  }

  if (selection) {
    const unknown = [...selection].filter((sel) => !matched.has(sel));
    if (unknown.length > 0) {
      const known = project.screens.screens.map((s) => s.id).join(', ');
      throw new S1sError('usage', `Unknown screen selector(s): ${unknown.join(', ')}`, {
        hint: `Use a screen id (${known}) or a 1-based ordinal.`,
      });
    }
  }
  return items;
}
