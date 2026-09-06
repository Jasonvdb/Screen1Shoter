// Template registry: built-ins plus the project's templates/index.ts
// (virtual:s1s-templates). A project template with a built-in id replaces it.
import projectTemplates from 'virtual:s1s-templates';
import type { TemplateModule } from '../../runtime/index.ts';
import featureGrid from './feature-grid.tsx';
import heroTopText from './hero-top-text.tsx';
import raw from './raw.tsx';
import textBottom from './text-bottom.tsx';
import twoDevice from './two-device.tsx';

export const BUILTIN_TEMPLATE_MODULES: readonly TemplateModule[] = [heroTopText, textBottom, twoDevice, featureGrid, raw];

export function isTemplateModule(value: unknown): value is TemplateModule {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && Array.isArray(v['families']) && typeof v['Component'] === 'function';
}

const registry = new Map<string, TemplateModule>();
for (const template of BUILTIN_TEMPLATE_MODULES) registry.set(template.id, template);

// The project file is user-authored: a wrong export shape must not throw at
// module init (that would kill the page); it is logged and ignored, and the
// screen then reports "Unknown template" instead.
const candidates: readonly unknown[] = Array.isArray(projectTemplates) ? projectTemplates : [];
if (!Array.isArray(projectTemplates)) {
  console.error(
    `s1s: templates/index.ts must \`export default [...]\` (an array of defineTemplate() modules); got ${typeof projectTemplates}. Project templates ignored.`,
  );
}

let invalid = 0;
for (const candidate of candidates) {
  if (isTemplateModule(candidate)) registry.set(candidate.id, candidate);
  else invalid += 1;
}
if (invalid > 0) {
  console.warn(`s1s: ignored ${invalid} invalid entr${invalid === 1 ? 'y' : 'ies'} in templates/index.ts (need { id, families, Component })`);
}

export function getTemplate(id: string): TemplateModule | undefined {
  return registry.get(id);
}

export function templateIds(): string[] {
  return [...registry.keys()];
}
