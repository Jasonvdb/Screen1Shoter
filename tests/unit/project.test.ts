// loadProject on a temp project: templates/index.tsx counts as the template
// entry (same list the Vite plugin uses), and `reload` re-evaluates an edited
// screens.ts in the same process.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEMPLATE_ENTRIES, findTemplatesEntry, loadProject } from '../../src/core/project.ts';
import { catchS1sError, makeTempDir, type TempDir } from '../fixtures/helpers.ts';

const CONFIG = join(import.meta.dirname, '..', '..', 'src', 'config', 'index.ts');

function screensSource(extra = ''): string {
  return [
    `import { defineScreens } from '${CONFIG}';`,
    `export default defineScreens({ sizes: ['iphone-6.9'], screens: [{ id: 'home' }${extra}] });`,
    '',
  ].join('\n');
}

const THEME = `import { defineTheme } from '${CONFIG}';\nexport default defineTheme({ background: '#000000', accent: '#ff0000', text: '#ffffff' });\n`;

describe('loadProject', () => {
  let tmp: TempDir;
  let dir: string;

  beforeEach(async () => {
    tmp = await makeTempDir();
    dir = join(tmp.dir, 'screenshots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'screens.ts'), screensSource());
    await writeFile(join(dir, 'theme.ts'), THEME);
  });
  afterEach(() => tmp.cleanup());

  it('accepts templates/index.tsx as the template entry, like the Vite plugin', async () => {
    expect(TEMPLATE_ENTRIES).toEqual(['templates/index.ts', 'templates/index.tsx']);
    expect(findTemplatesEntry(dir)).toBeNull();
    await writeFile(join(dir, 'screens.ts'), screensSource(", { id: 'custom', template: 'hooked' }"));
    const error = await catchS1sError(loadProject({ projectDir: dir }));
    expect(error.code).toBe('config-invalid');
    expect(error.message).toContain('unknown template "hooked"');

    await mkdir(join(dir, 'templates'));
    await writeFile(join(dir, 'templates', 'index.tsx'), 'export default [];\n');
    const project = await loadProject({ projectDir: dir });
    expect(project.templatesPath).toBe(join(dir, 'templates', 'index.tsx'));
    expect(findTemplatesEntry(dir)).toBe(project.templatesPath);
  });

  it('reload: true picks up an edited screens.ts within one process', async () => {
    const first = await loadProject({ projectDir: dir, reload: true });
    expect(first.screens.screens.map((s) => s.id)).toEqual(['home']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(join(dir, 'screens.ts'), screensSource(", { id: 'brandnew' }"));
    const second = await loadProject({ projectDir: dir, reload: true });
    expect(second.screens.screens.map((s) => s.id)).toEqual(['home', 'brandnew']);
  });
});
