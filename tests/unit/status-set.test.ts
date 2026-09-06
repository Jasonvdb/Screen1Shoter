// `s1s status --set` rewrites the manifest, so the guard in front of it has to
// mean something: naming every size of the locale selects the same images as
// naming none, and that needs --yes just as much. `--from` is real narrowing:
// it picks the rows by the status they hold, which is what the copy playbook
// asks for on a mixed locale. Runs the real CLI, because the guards live in
// the command.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageState, ProjectManifest, SizeId } from '../../src/config/types.ts';
import { makeTempDir, must, runS1s, writeTempProject, type TempDir } from '../fixtures/helpers.ts';

const LOCALE = 'en-US';
const SIZE: SizeId = 'iphone-6.9';

/** Two images; `generated` each unless the test asks for something else. */
async function makeProject(root: string, images?: Record<string, ImageState>): Promise<string> {
  const projectDir = join(root, 'screenshots');
  const screens: Record<string, ImageState> = images ?? {
    home: { status: 'generated' },
    detail: { status: 'generated' },
  };
  const manifest: ProjectManifest = {
    version: 1,
    app: {
      name: 'Basic',
      bundleId: 'com.example.basic',
      deviceFamilies: ['iphone'],
      sourceLocale: LOCALE,
      appLocales: [LOCALE],
      metadataDir: 'metadata/screenshots',
    },
    sizes: {},
    screens: [],
    locales: { [LOCALE]: { copyStatus: 'approved', captureSource: 'own', devices: { [SIZE]: { screens } } } },
    runs: [],
  };
  await writeTempProject(projectDir, {
    screens: { sizes: [SIZE], screens: [{ id: 'home' }, { id: 'detail' }] },
    copies: { [LOCALE]: { locale: LOCALE, screens: { home: { headline: 'Home' }, detail: { headline: 'Detail' } } } },
    manifest,
  });
  return projectDir;
}

async function readWritten(projectDir: string): Promise<ProjectManifest> {
  return JSON.parse(await readFile(join(projectDir, 'manifest.json'), 'utf8')) as ProjectManifest;
}

async function stateOf(projectDir: string, screenId: string): Promise<ImageState> {
  const devices = must((await readWritten(projectDir)).locales[LOCALE], 'locale').devices;
  return must(must(devices[SIZE], 'device').screens[screenId], screenId);
}

async function statusOf(projectDir: string, screenId: string): Promise<string> {
  return (await stateOf(projectDir, screenId)).status;
}

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir('s1s-status-set-');
});
afterEach(() => tmp.cleanup());

describe('s1s status --set', () => {
  it('needs --yes when --sizes names every size of the locale', async () => {
    const projectDir = await makeProject(tmp.dir);
    const args = ['status', '--project', projectDir, '--locale', LOCALE, '--sizes', SIZE, '--set', 'image-approved'];

    const refused = await runS1s(args);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--yes');
    expect(await statusOf(projectDir, 'home')).toBe('generated');

    // Exit 1 here is the reconcile verdict (no rendered files in the fixture),
    // not a refusal: exit 2 is the guard.
    const applied = await runS1s([...args, '--yes']);
    expect(applied.code).not.toBe(2);
    expect(await statusOf(projectDir, 'home')).toBe('image-approved');
    expect(await statusOf(projectDir, 'detail')).toBe('image-approved');
  });

  it('applies a selection that really is narrower without --yes', async () => {
    const projectDir = await makeProject(tmp.dir);
    const run = await runS1s([
      'status',
      '--project',
      projectDir,
      '--locale',
      LOCALE,
      '--screens',
      'home',
      '--set',
      'image-approved',
    ]);

    expect(run.code).not.toBe(2);
    expect(await statusOf(projectDir, 'home')).toBe('image-approved');
    expect(await statusOf(projectDir, 'detail')).toBe('generated');
  });

  it('appends exactly one runs entry', async () => {
    const projectDir = await makeProject(tmp.dir);
    const run = await runS1s([
      'status',
      '--project',
      projectDir,
      '--locale',
      LOCALE,
      '--screens',
      'home',
      '--set',
      'image-approved',
    ]);

    expect(run.code).not.toBe(2);
    const runs = (await readWritten(projectDir)).runs;
    expect(runs).toHaveLength(1);
    const entry = must(runs[0], 'runs entry');
    expect(entry.command).toContain('status --set image-approved');
    expect(entry.command).toContain(`--locale ${LOCALE}`);
    expect(entry.ok).toBe(true);
    expect(Date.parse(must(entry.finishedAt, 'finishedAt'))).not.toBeNaN();
  });
});

describe('s1s status --set --from', () => {
  it('selects only rows at that status', async () => {
    const projectDir = await makeProject(tmp.dir, {
      home: { status: 'generated' },
      detail: { status: 'captured' },
    });

    // 'captured' -> 'image-approved' is a legal step, so only --from keeps
    // 'detail' out of this write.
    const run = await runS1s([
      'status',
      '--project',
      projectDir,
      '--locale',
      LOCALE,
      '--set',
      'image-approved',
      '--from',
      'generated',
    ]);

    expect(run.code).not.toBe(2);
    expect(await statusOf(projectDir, 'home')).toBe('image-approved');
    expect(await statusOf(projectDir, 'detail')).toBe('captured');
  });

  it('an unknown --from value is a usage error', async () => {
    const projectDir = await makeProject(tmp.dir);
    const run = await runS1s([
      'status',
      '--project',
      projectDir,
      '--locale',
      LOCALE,
      '--set',
      'image-approved',
      '--from',
      'nosuch',
    ]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('nosuch');
    expect(run.stderr).toContain('copy-approved');
    expect(await statusOf(projectDir, 'home')).toBe('generated');
  });

  // references/copy-playbook.md: "Set status copy-approved only on images
  // still at pending". Without --from the command refuses the whole locale,
  // because 'captured' cannot go back to 'copy-approved'.
  it('applies --set copy-approved --from pending on a mixed-status locale', async () => {
    const projectDir = await makeProject(tmp.dir, {
      home: { status: 'pending' },
      detail: { status: 'captured' },
    });
    const args = ['status', '--project', projectDir, '--locale', LOCALE, '--set', 'copy-approved'];

    const refused = await runS1s(args);
    expect(refused.code).toBe(2);
    expect(await statusOf(projectDir, 'home')).toBe('pending');

    // One of the two rows is selected, so this is narrower than the locale
    // and needs no --yes.
    const applied = await runS1s([...args, '--from', 'pending']);
    expect(applied.code).not.toBe(2);
    expect(await statusOf(projectDir, 'home')).toBe('copy-approved');
    expect(await statusOf(projectDir, 'detail')).toBe('captured');
  });

  it('still needs --yes when --from leaves every image of the locale selected', async () => {
    const projectDir = await makeProject(tmp.dir);
    const args = ['status', '--project', projectDir, '--locale', LOCALE, '--set', 'image-approved', '--from', 'generated'];

    const refused = await runS1s(args);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--yes');
    expect(await statusOf(projectDir, 'home')).toBe('generated');

    const applied = await runS1s([...args, '--yes']);
    expect(applied.code).not.toBe(2);
    expect(await statusOf(projectDir, 'home')).toBe('image-approved');
    expect(await statusOf(projectDir, 'detail')).toBe('image-approved');
  });
});

describe('s1s status --set uploaded', () => {
  it('writes uploadedAt and clears wasUploaded', async () => {
    const projectDir = await makeProject(tmp.dir, {
      home: { status: 'exported', wasUploaded: true },
      detail: { status: 'generated' },
    });

    const run = await runS1s([
      'status',
      '--project',
      projectDir,
      '--locale',
      LOCALE,
      '--screens',
      'home',
      '--set',
      'uploaded',
    ]);

    expect(run.code).not.toBe(2);
    const home = await stateOf(projectDir, 'home');
    expect(home.status).toBe('uploaded');
    expect(Date.parse(must(home.uploadedAt, 'uploadedAt'))).not.toBeNaN();
    expect(home.wasUploaded).toBeUndefined();
    // The unselected image keeps everything it had.
    expect(await stateOf(projectDir, 'detail')).toEqual({ status: 'generated' });
  });

  // The "shipped but stale" recovery: the image is already `uploaded`, so the
  // status does not move, but the re-upload still has to clear the flag.
  it('clears wasUploaded on an image that is already uploaded', async () => {
    const projectDir = await makeProject(tmp.dir, {
      home: { status: 'uploaded', uploadedAt: '2026-01-01T00:00:00.000Z', wasUploaded: true },
      detail: { status: 'generated' },
    });

    const run = await runS1s([
      'status',
      '--project',
      projectDir,
      '--locale',
      LOCALE,
      '--screens',
      'home',
      '--set',
      'uploaded',
    ]);

    expect(run.code).not.toBe(2);
    const home = await stateOf(projectDir, 'home');
    expect(home.wasUploaded).toBeUndefined();
    expect(home.uploadedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });
});
