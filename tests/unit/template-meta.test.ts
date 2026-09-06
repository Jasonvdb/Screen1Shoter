// BUILTIN_TEMPLATES.implemented must mirror src/web/templates/<id>.tsx: a
// phase that adds a template file has to flip the flag, and loadProject decides
// whether a screens.ts is renderable before Chromium starts.
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

  // W6 shipped the last three ids, so nothing is planned today. The rule stands
  // for whatever a later phase adds; the loadProject guard it feeds stays in
  // src/core/project.ts for the same reason.
  it('planned templates name their phase', () => {
    for (const meta of BUILTIN_TEMPLATES.filter((t) => !t.implemented)) expect(['W2', 'W6']).toContain(meta.phase);
  });
});

describe('loadProject and the opt-in W6 templates', () => {
  it('loads a screen naming a template W6 shipped', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['ipad-13'], screens: [{ id: 'bleed', template: 'bleed-bottom' }] },
      });
      const project = await loadProject({ projectDir: dir });
      expect(project.screens.screens[0]?.template).toBe('bleed-bottom');
    } finally {
      await tmp.cleanup();
    }
  });

  // The same loop that used to reject a planned template still guards the
  // families list, which is what the W6 ids actually narrow (watch-caption is
  // watch-only, and its capture never reaches an iPad canvas).
  it('names the families when a screen puts a template on the wrong one', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['ipad-13'], screens: [{ id: 'caption', template: 'watch-caption' }] },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('template "watch-caption" has no ipad layout (families: watch)');
    } finally {
      await tmp.cleanup();
    }
  });
});
