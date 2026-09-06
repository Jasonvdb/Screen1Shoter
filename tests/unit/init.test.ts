// `s1s init --force`: the merged manifest keeps the agent's state, and the
// scaffold leaves authored files alone.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectManifest } from '../../src/config/types.ts';
import { buildInitVars, buildManifest, initProject, mergeManifest, type InitVars } from '../../src/cli/commands/init.ts';
import { linkProject } from '../../src/cli/commands/link.ts';
import { readManifest } from '../../src/core/manifest.ts';
import { buildMatrix } from '../../src/core/matrix.ts';
import { loadProject } from '../../src/core/project.ts';
import { catchS1sError, makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

const TEMPLATE = join(import.meta.dirname, '..', '..', 'templates', 'init', 'manifest.json');

async function fresh(vars: InitVars): Promise<ProjectManifest> {
  return buildManifest(await readFile(TEMPLATE, 'utf8'), vars);
}

describe('mergeManifest', () => {
  it('keeps statuses, runs, udids and capture plans; adds new sizes, locales and (when asked) screens', async () => {
    const dir = '/tmp/app/screenshots';
    const before = await fresh(buildInitVars(dir, { appName: 'Moto', bundleId: 'moto.fit', appId: '123' }));
    before.sizes['iphone-6.9'] = { ...must(before.sizes['iphone-6.9']), simulator: 'S1S iPhone', udid: 'UDID-1' };
    before.screens[0] = { ...must(before.screens[0]), capture: { steps: ['tap Motos'] } };
    before.locales['en-US'] = {
      copyStatus: 'approved',
      captureSource: 'own',
      devices: { 'iphone-6.9': { screens: { home: { status: 'image-approved', capture: 'captures/en-US/iphone/home.png' } } } },
    };
    before.runs.push({ command: 'render --locale en-US', startedAt: 't1', ok: true });
    before.demoData = { branch: 's1s/demo-data' };

    const after = await fresh(buildInitVars(dir, { watch: true, locales: ['en-US', 'de-DE'] }));
    const merged = mergeManifest(before, after, { appName: false, bundleId: false, appId: false }, { addScreens: true });

    expect(merged.app.name).toBe('Moto');
    expect(merged.app.bundleId).toBe('moto.fit');
    expect(merged.app.appId).toBe('123');
    expect(merged.app.deviceFamilies).toEqual(['iphone', 'ipad', 'watch']);
    expect(merged.app.appLocales).toEqual(['en-US', 'de-DE']);
    expect(merged.sizes['iphone-6.9']).toMatchObject({ simulator: 'S1S iPhone', udid: 'UDID-1' });
    expect(merged.sizes['watch-s10']?.displayType).toBe('APP_WATCH_SERIES_10');
    expect(merged.screens.map((s) => [s.id, s.order])).toEqual([['home', 1], ['detail', 2], ['share', 3], ['watch-stats', 4]]);
    expect(merged.screens[0]?.capture).toEqual({ steps: ['tap Motos'] });
    expect(merged.locales['en-US']?.devices['iphone-6.9']?.screens['home']?.status).toBe('image-approved');
    expect(merged.locales['de-DE']?.copyStatus).toBe('pending');
    expect(merged.runs.map((r) => r.command)).toEqual(['s1s init', 'render --locale en-US', 's1s init']);
    expect(merged.demoData).toEqual({ branch: 's1s/demo-data' });
  });

  it('explicit flags win over the existing app facts; screens are not added when screens.ts was kept', async () => {
    const dir = '/tmp/app/screenshots';
    const before = await fresh(buildInitVars(dir, { appName: 'Old', bundleId: 'old.id' }));
    before.screens = [{ id: 'mine', order: 1, sizes: ['iphone-6.9'] }];
    const after = await fresh(buildInitVars(dir, { appName: 'New', bundleId: 'new.id' }));
    const merged = mergeManifest(before, after, { appName: true, bundleId: true, appId: false }, { addScreens: false });
    expect(merged.app).toMatchObject({ name: 'New', bundleId: 'new.id' });
    expect(merged.screens.map((s) => s.id)).toEqual(['mine']);
  });
});

describe('initProject', () => {
  let tmp: TempDir;
  let dir: string;

  beforeEach(async () => {
    tmp = await makeTempDir();
    dir = join(tmp.dir, 'App', 'screenshots');
    await mkdir(dir, { recursive: true });
  });
  afterEach(() => tmp.cleanup());

  it('refuses an existing project with project-exists (exit 1), and --force keeps authored files and manifest state', async () => {
    const vars = buildInitVars(dir, {});
    const first = await initProject(dir, vars, { force: false });
    expect(first.written).toContain('manifest.json');
    expect(first.merged).toEqual([]);

    const refused = await catchS1sError(initProject(dir, vars, { force: false }));
    expect(refused.code).toBe('project-exists');
    expect(refused.exitCode).toBe(1);

    await writeFile(join(dir, 'screens.ts'), '// authored\n');
    const manifest = await readManifest(join(dir, 'manifest.json'));
    manifest.locales['en-US'] = { copyStatus: 'draft', captureSource: 'own', devices: { 'iphone-6.9': { screens: { home: { status: 'captured' } } } } };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));

    const forced = await initProject(dir, buildInitVars(dir, { watch: true }), { force: true });
    expect(forced.skipped.map((s) => s.path)).toEqual(['copy/en-US.json', 'screens.ts']); // --watch renders a different copy file too
    expect(forced.merged).toEqual(['manifest.json']);
    expect(await readFile(join(dir, 'screens.ts'), 'utf8')).toBe('// authored\n');
    const after = await readManifest(join(dir, 'manifest.json'));
    expect(after.locales['en-US']?.devices['iphone-6.9']?.screens['home']?.status).toBe('captured');
    expect(after.sizes['watch-s10']).toBeDefined();
    expect(after.screens.map((s) => s.id)).toEqual(['home', 'detail', 'share']);

    const replaced = await initProject(dir, buildInitVars(dir, { watch: true }), { force: true, overwriteAuthored: true });
    expect(replaced.skipped).toEqual([]);
    expect(replaced.overwritten).toContain('screens.ts');
    expect(await readFile(join(dir, 'screens.ts'), 'utf8')).toContain('defineScreens');
  });
});

describe('initProject scaffold loads', () => {
  let tmp: TempDir;
  let dir: string;

  beforeEach(async () => {
    tmp = await makeTempDir();
    dir = join(tmp.dir, 'App', 'screenshots');
    await mkdir(dir, { recursive: true });
  });
  afterEach(() => tmp.cleanup());

  it('default scaffold: two sizes, one locale, three screens, six render items, copy parses', async () => {
    await initProject(dir, buildInitVars(dir, {}), { force: false });
    await linkProject(dir);
    const project = await loadProject({ projectDir: dir });
    expect(project.sizes).toEqual(['iphone-6.9', 'ipad-13']);
    expect(project.locales).toEqual(['en-US']);
    expect(project.sourceLocale).toBe('en-US');
    expect(project.screens.screens.map((s) => s.id)).toEqual(['home', 'detail', 'share']);
    expect(project.templatesPath).toBe(join(dir, 'templates', 'index.ts'));
    expect(Object.keys(project.manifest.sizes)).toEqual(project.sizes);
    expect(project.manifest.app.name).toBe('App');
    expect(buildMatrix(project, { locale: 'en-US' })).toHaveLength(6);
    const copy = await project.copyFor('en-US');
    expect(Object.keys(copy.screens)).toEqual(['home', 'detail', 'share']);
    expect(copy.shared?.['appName']).toBe('App');
    expect(project.copyErrors).toEqual({});
  });

  it('--watch --locales en-US,de-DE --sizes iphone-6.9,ipad-13,watch-s10: four screens, seven items', async () => {
    const vars = buildInitVars(dir, { watch: true, locales: ['en-US', 'de-DE'], sizes: ['iphone-6.9', 'ipad-13', 'watch-s10'] });
    await initProject(dir, vars, { force: false });
    await linkProject(dir);
    const project = await loadProject({ projectDir: dir });
    expect(project.sizes).toEqual(['iphone-6.9', 'ipad-13', 'watch-s10']);
    expect(project.locales).toEqual(['en-US', 'de-DE']);
    expect(project.screens.screens.map((s) => s.id)).toEqual(['home', 'detail', 'share', 'watch-stats']);
    expect(Object.keys(project.manifest.sizes)).toEqual(project.sizes);
    expect(Object.keys(project.manifest.locales)).toEqual(['en-US', 'de-DE']);
    expect(project.manifest.app.deviceFamilies).toEqual(['iphone', 'ipad', 'watch']);
    const items = buildMatrix(project, { locale: 'en-US' });
    expect(items).toHaveLength(7);
    expect(must(items.find((i) => i.preset.id === 'watch-s10')).screen.template).toBe('raw');
    expect(Object.keys((await project.copyFor('en-US')).screens)).toEqual(['home', 'detail', 'share', 'watch-stats']);
    // de-DE has no copy yet: buildMatrix still works (copy undefined -> copy-missing at render time).
    expect(buildMatrix(project, { locale: 'de-DE' })).toHaveLength(7);
  });
});
