// BUILTIN_TEMPLATES.implemented must mirror src/web/templates/<id>.tsx: a
// phase that adds a template file has to flip the flag, and a screens.ts that
// names a planned template fails at load time, not after Chromium starts.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE, implementedTemplateIds, templateMeta } from '../../src/config/template-meta.ts';
import { loadProject } from '../../src/core/project.ts';
import { REPO_ROOT, catchS1sError, makeTempDir, writeTempProject } from '../fixtures/helpers.ts';

const WEB_TEMPLATES = join(REPO_ROOT, 'src', 'web', 'templates');

describe('BUILTIN_TEMPLATES.implemented', () => {
  it('equals the set of src/web/templates/*.tsx files (index.tsx excluded)', async () => {
    const files = (await readdir(WEB_TEMPLATES))
      .filter((name) => name.endsWith('.tsx') && name !== 'index.tsx')
      .map((name) => name.replace(/\.tsx$/, ''))
      .sort();
    expect(files).toEqual([...implementedTemplateIds()].sort());
  });

  it('every default template is implemented', () => {
    for (const id of Object.values(DEFAULT_TEMPLATE)) expect(templateMeta(id)?.implemented).toBe(true);
  });

  it('planned templates name their phase', () => {
    for (const meta of BUILTIN_TEMPLATES.filter((t) => !t.implemented)) expect(['W2', 'W6']).toContain(meta.phase);
  });
});

describe('loadProject rejects planned templates', () => {
  it('names the phase and the templates available now', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['ipad-13'], screens: [{ id: 'grid', template: 'feature-grid' }] },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('template "feature-grid" is planned for W2; available now: hero-top-text, text-bottom, raw');
    } finally {
      await tmp.cleanup();
    }
  });
});
