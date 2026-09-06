// The built-in template registry (src/web/templates/index.tsx) and the
// DOM-free metadata (src/config/template-meta.ts) must agree: same set of
// implemented ids, same family declarations, same compliance flag. Node
// validates screens.ts against the metadata, so a drift here would let a
// screen pass loadProject and then fail in the browser (or the reverse).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, implementedTemplateIds, templateMeta } from '../../src/config/template-meta.ts';
import type { DeviceFamily } from '../../src/config/types.ts';
import { loadProject } from '../../src/core/project.ts';
import { REPO_ROOT, catchS1sError, makeTempDir, writeTempProject } from '../fixtures/helpers.ts';

const WEB_TEMPLATES = join(REPO_ROOT, 'src', 'web', 'templates');

/** The part of TemplateModule (src/runtime/index.ts) this test reads; not imported so the Node tsconfig stays DOM-free. */
interface TemplateModule {
  id: string;
  families: DeviceFamily[];
  compliant?: boolean;
  Component: unknown;
}

/** Ids listed in BUILTIN_TEMPLATE_MODULES, resolved through the file's default imports. */
async function registeredIds(): Promise<string[]> {
  const source = await readFile(join(WEB_TEMPLATES, 'index.tsx'), 'utf8');
  const byLocalName = new Map<string, string>();
  for (const match of source.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w-]+)\.tsx'/g)) {
    byLocalName.set(match[1] ?? '', match[2] ?? '');
  }
  const list = /BUILTIN_TEMPLATE_MODULES[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return list
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => {
      const id = byLocalName.get(name);
      if (id === undefined) throw new Error(`index.tsx registers "${name}" without a default import from ./<id>.tsx`);
      return id;
    });
}

async function loadTemplate(id: string): Promise<TemplateModule> {
  const mod = (await import(`../../src/web/templates/${id}.tsx`)) as { default: TemplateModule };
  return mod.default;
}

describe('template registry vs template-meta', () => {
  it('registers exactly the implemented ids', async () => {
    const registered = await registeredIds();
    expect([...registered].sort()).toEqual([...implementedTemplateIds()].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('every implemented module declares the id, families and compliance of its metadata', async () => {
    for (const meta of BUILTIN_TEMPLATES.filter((t) => t.implemented)) {
      const module = await loadTemplate(meta.id);
      expect(module.id, meta.id).toBe(meta.id);
      expect(module.families, meta.id).toEqual(meta.families);
      expect(module.compliant ?? true, meta.id).toBe(meta.compliant);
      expect(typeof module.Component, meta.id).toBe('function');
    }
  });

  it('W2 templates: two-device is iPhone + iPad, feature-grid is iPad only', () => {
    expect(templateMeta('two-device')).toMatchObject({ implemented: true, phase: 'W2', families: ['iphone', 'ipad'] });
    expect(templateMeta('feature-grid')).toMatchObject({ implemented: true, phase: 'W2', families: ['ipad'] });
    for (const id of ['bleed-bottom', 'tilted', 'watch-caption']) expect(templateMeta(id)?.implemented, id).toBe(false);
  });
});

describe('loadProject and the W2 templates', () => {
  it('rejects feature-grid as the base template of an iPhone + iPad screen', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['iphone-6.9', 'ipad-13'], screens: [{ id: 'grid', template: 'feature-grid' }] },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('template "feature-grid" has no iphone layout');
    } finally {
      await tmp.cleanup();
    }
  });

  it('accepts feature-grid through overrides.ipad and two-device with two captures', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9', 'ipad-13'],
          screens: [
            { id: 'grid', template: 'hero-top-text', overrides: { ipad: { template: 'feature-grid' } } },
            { id: 'pair', template: 'two-device', capture: ['home', 'detail'] },
          ],
        },
      });
      const project = await loadProject({ projectDir: dir });
      expect(project.screens.screens.map((s) => s.id)).toEqual(['grid', 'pair']);
    } finally {
      await tmp.cleanup();
    }
  });

  it('rejects a capture count the template cannot use (two-device with one, hero-top-text with two)', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9'],
          screens: [
            { id: 'compare', template: 'two-device' },
            { id: 'home', template: 'hero-top-text', capture: ['home', 'detail'] },
          ],
        },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('screen "compare": template "two-device" needs capture: [a, b] (got 1)');
      expect(error.message).toContain('screen "home": template "hero-top-text" needs capture: "<name>" (got 2)');
    } finally {
      await tmp.cleanup();
    }
  });
});
