// screenshots/manifest.json: default when missing, atomic write, zod read,
// updateImage bookkeeping that never drops agent-owned or unknown fields,
// and guarded status transitions.
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IMAGE_STATUSES,
  type ImageState,
  type ManifestApp,
  type ProjectManifest,
} from '../../src/config/types.ts';
import {
  canTransition,
  emptyManifest,
  imageState,
  manifestSchema,
  readManifest,
  updateImage,
  writeManifest,
} from '../../src/core/manifest.ts';
import { catchS1sError, fixtureProjectDir, makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

const app: ManifestApp = {
  name: 'Basic',
  bundleId: 'com.example.basic',
  deviceFamilies: ['iphone', 'ipad'],
  sourceLocale: 'en-US',
  appLocales: ['en-US'],
  metadataDir: 'metadata/screenshots',
};

const home = { locale: 'en-US', sizeId: 'iphone-6.9', screenId: 'home' } as const;

/** A populated manifest with agent-owned fields and unknown extras. */
function populated(): ProjectManifest {
  const m = emptyManifest(app);
  m.locales['en-US'] = {
    copyStatus: 'approved',
    captureSource: 'own',
    devices: {
      'iphone-6.9': {
        screens: {
          home: { status: 'captured', capture: 'captures/en-US/iphone/home.png', captureRating: 'great', agentNote: 'keep me' } as ImageState,
          detail: { status: 'copy-approved' },
        },
      },
      'ipad-13': { screens: { home: { status: 'uploaded', uploadedAt: '2026-09-01T10:00:00Z', renderHash: 'old' } } },
    },
  };
  m.locales['de-DE'] = { copyStatus: 'draft', captureSource: 'reuse:en-US', devices: {} };
  (m as ProjectManifest & { notes: string }).notes = 'top-level agent field';
  return m;
}

describe('emptyManifest', () => {
  it('has version 1, the app, and empty collections; validates against the schema', () => {
    const m = emptyManifest(app);
    expect(m).toEqual({ version: 1, app, sizes: {}, screens: [], locales: {}, runs: [] });
    expect(manifestSchema.safeParse(m).success).toBe(true);
  });
});

describe('readManifest / writeManifest', () => {
  let tmp: TempDir;
  let path: string;

  beforeEach(async () => {
    tmp = await makeTempDir();
    path = join(tmp.dir, 'manifest.json');
  });
  afterEach(() => tmp.cleanup());

  it('writes 2-space JSON with a trailing newline and leaves no temp file behind', async () => {
    const m = populated();
    await writeManifest(path, m);
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify(m, null, 2)}\n`);
    expect(await readdir(tmp.dir)).toEqual(['manifest.json']);
  });

  it('round-trips, keeping unknown fields the agent may add', async () => {
    const m = populated();
    await writeManifest(path, m);
    const back = await readManifest(path);
    expect(back).toEqual(m);
    expect((back as ProjectManifest & { notes?: string }).notes).toBe('top-level agent field');
    const state = must(imageState(back, 'en-US', 'iphone-6.9', 'home'));
    expect((state as ImageState & { agentNote?: string }).agentNote).toBe('keep me');
  });

  it('rejects malformed JSON with S1sError manifest-invalid naming the file', async () => {
    await writeFile(path, '{ not json', 'utf8');
    const err = await catchS1sError(readManifest(path));
    expect(err.code).toBe('manifest-invalid');
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain('manifest.json');
  });

  it('rejects a wrong shape with S1sError manifest-invalid', async () => {
    await writeFile(path, JSON.stringify({ version: 2, app, sizes: {}, screens: [], locales: {}, runs: [] }), 'utf8');
    expect((await catchS1sError(readManifest(path))).code).toBe('manifest-invalid');

    await writeFile(path, JSON.stringify({ version: 1, sizes: {}, screens: [], locales: {}, runs: [] }), 'utf8');
    expect((await catchS1sError(readManifest(path))).code).toBe('manifest-invalid');

    const badStatus = populated();
    (must(must(must(badStatus.locales['en-US']).devices['iphone-6.9']).screens['home']) as { status: string }).status = 'shipped';
    await writeFile(path, JSON.stringify(badStatus), 'utf8');
    expect((await catchS1sError(readManifest(path))).code).toBe('manifest-invalid');
  });
});

describe('default manifest when manifest.json is missing', () => {
  it('loadProject falls back to an empty manifest and does not write a file', async () => {
    // Dynamic import so the rest of this suite runs even before project.ts lands.
    const { loadProject } = await import('../../src/core/project.ts');
    const projectDir = fixtureProjectDir('project-bare');
    const manifestPath = join(projectDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(false);

    const project = await loadProject({ projectDir });
    expect(project.manifestPath).toBe(manifestPath);
    expect(project.manifest.version).toBe(1);
    expect(project.manifest.screens).toEqual([]);
    expect(project.manifest.locales).toEqual({});
    expect(project.manifest.runs).toEqual([]);
    expect(project.manifest.sizes).toEqual({});
    expect(project.manifest.app.sourceLocale).toBe('en-US');
    expect(project.sourceLocale).toBe('en-US');
    expect(manifestSchema.safeParse(project.manifest).success).toBe(true);
    expect(existsSync(manifestPath)).toBe(false);
  });
});

describe('imageState', () => {
  it('returns undefined for unknown locale, size or screen', () => {
    const m = populated();
    expect(imageState(m, 'fr-FR', 'iphone-6.9', 'home')).toBeUndefined();
    expect(imageState(m, 'en-US', 'iphone-6.5', 'home')).toBeUndefined();
    expect(imageState(m, 'en-US', 'iphone-6.9', 'nope')).toBeUndefined();
    expect(imageState(m, 'de-DE', 'iphone-6.9', 'home')).toBeUndefined();
  });

  it('returns the stored state', () => {
    expect(imageState(populated(), 'en-US', 'iphone-6.9', 'detail')).toEqual({ status: 'copy-approved' });
  });
});

describe('updateImage', () => {
  it('creates locale, device and screen nodes with status pending and stays schema-valid', () => {
    const m = emptyManifest(app);
    const next = updateImage(m, home, { capture: 'captures/en-US/iphone/home.png' });
    expect(imageState(next, 'en-US', 'iphone-6.9', 'home')).toEqual({
      status: 'pending',
      capture: 'captures/en-US/iphone/home.png',
    });
    expect(manifestSchema.safeParse(next).success).toBe(true);
    const locale = must(next.locales['en-US']);
    expect(typeof locale.copyStatus).toBe('string');
    expect(typeof locale.captureSource).toBe('string');
  });

  it('applies the patch on top of the existing state and keeps every other field', () => {
    const m = populated();
    const next = updateImage(m, home, { status: 'generated', render: 'out/en-US/APP_IPHONE_69/01-home.png', renderHash: 'abc' });
    expect(imageState(next, 'en-US', 'iphone-6.9', 'home')).toEqual({
      status: 'generated',
      capture: 'captures/en-US/iphone/home.png',
      captureRating: 'great',
      agentNote: 'keep me',
      render: 'out/en-US/APP_IPHONE_69/01-home.png',
      renderHash: 'abc',
    });
  });

  it('keeps the status when the patch does not set one', () => {
    const next = updateImage(populated(), home, { renderWarnings: [] });
    expect(must(imageState(next, 'en-US', 'iphone-6.9', 'home')).status).toBe('captured');
  });

  it('returns a new manifest and leaves the input untouched', () => {
    const m = populated();
    const before = JSON.stringify(m);
    const next = updateImage(m, home, { status: 'generated' });
    expect(next).not.toBe(m);
    expect(JSON.stringify(m)).toBe(before);
    expect(must(imageState(m, 'en-US', 'iphone-6.9', 'home')).status).toBe('captured');
  });

  it('does not touch sibling screens, devices, locales, or top-level fields', () => {
    const m = populated();
    const next = updateImage(m, home, { status: 'generated' });
    expect(imageState(next, 'en-US', 'iphone-6.9', 'detail')).toEqual(imageState(m, 'en-US', 'iphone-6.9', 'detail'));
    expect(next.locales['en-US']?.devices['ipad-13']).toEqual(m.locales['en-US']?.devices['ipad-13']);
    expect(next.locales['de-DE']).toEqual(m.locales['de-DE']);
    expect(must(next.locales['en-US']).copyStatus).toBe('approved');
    expect(must(next.locales['en-US']).captureSource).toBe('own');
    expect((next as ProjectManifest & { notes?: string }).notes).toBe('top-level agent field');
    expect(next.app).toEqual(m.app);
  });

  it('supports the render bookkeeping rule: an uploaded image whose render changed is flagged', () => {
    const ref = { locale: 'en-US', sizeId: 'ipad-13', screenId: 'home' } as const;
    const m = populated();
    const previous = must(imageState(m, 'en-US', 'ipad-13', 'home'));
    const next = updateImage(m, ref, {
      status: 'generated',
      renderHash: 'new',
      renderedAt: '2026-09-02T09:41:00Z',
      ...(previous.status === 'uploaded' ? { wasUploaded: true } : {}),
    });
    expect(imageState(next, 'en-US', 'ipad-13', 'home')).toEqual({
      status: 'generated',
      uploadedAt: '2026-09-01T10:00:00Z',
      renderHash: 'new',
      renderedAt: '2026-09-02T09:41:00Z',
      wasUploaded: true,
    });
  });
});

describe('canTransition', () => {
  it('orders statuses pending -> copy-approved -> captured -> generated -> image-approved -> exported -> uploaded', () => {
    expect([...IMAGE_STATUSES]).toEqual(['pending', 'copy-approved', 'captured', 'generated', 'image-approved', 'exported', 'uploaded']);
  });

  it('allows any forward step and only pending/captured/generated as backward targets', () => {
    for (const [i, from] of IMAGE_STATUSES.entries()) {
      for (const [j, to] of IMAGE_STATUSES.entries()) {
        if (i === j) continue;
        const forward = j > i;
        const rollback = to === 'pending' || to === 'captured' || to === 'generated';
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(forward || rollback);
      }
    }
  });

  it('spot checks', () => {
    expect(canTransition('pending', 'uploaded')).toBe(true);
    expect(canTransition('generated', 'image-approved')).toBe(true);
    expect(canTransition('uploaded', 'generated')).toBe(true);
    expect(canTransition('uploaded', 'pending')).toBe(true);
    expect(canTransition('uploaded', 'exported')).toBe(false);
    expect(canTransition('uploaded', 'image-approved')).toBe(false);
    expect(canTransition('exported', 'copy-approved')).toBe(false);
    expect(canTransition('captured', 'copy-approved')).toBe(false);
  });
});

describe('updateImage drop', () => {
  it('removes render fields after a failed render while keeping the rest of the state', () => {
    const m = updateImage(populated(), home, { render: 'out/x.png', renderHash: 'abc', renderedAt: 't0', renderWarnings: [] });
    const failure: ImageState['renderWarnings'] = [{ code: 'render-failed', level: 'error', message: 'timeout' }];
    const next = updateImage(m, home, { renderWarnings: failure }, { drop: ['render', 'renderHash', 'renderedAt'] });
    const state = must(imageState(next, 'en-US', 'iphone-6.9', 'home'));
    expect(state).not.toHaveProperty('render');
    expect(state).not.toHaveProperty('renderHash');
    expect(state).not.toHaveProperty('renderedAt');
    expect(state.renderWarnings).toEqual(failure);
    expect(state.status).toBe('captured');
    expect(state.captureRating).toBe('great');
    expect((state as ImageState & { agentNote?: string }).agentNote).toBe('keep me');
    expect(manifestSchema.safeParse(next).success).toBe(true);
  });
});
