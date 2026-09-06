// copy/<locale>.json loading: path helper, zod validation (copy-invalid),
// missing file (copy-missing), locale listing, and unused-key detection.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LocaleCopy, ScreensConfig } from '../../src/config/types.ts';
import { copyPath, listCopyLocales, loadCopy, localeCopySchema, unusedCopyKeys } from '../../src/core/copy.ts';
import { catchS1sError, fixtureProjectDir, makeTempDir, must, type TempDir } from '../fixtures/helpers.ts';

const basic = fixtureProjectDir('project-basic');

describe('copyPath', () => {
  it('is <projectDir>/copy/<locale>.json', () => {
    expect(copyPath('/app/screenshots', 'en-US')).toBe(join('/app/screenshots', 'copy', 'en-US.json'));
    expect(copyPath(basic, 'de-DE')).toBe(join(basic, 'copy', 'de-DE.json'));
  });
});

describe('loadCopy', () => {
  it('parses the fixture en-US copy', async () => {
    const copy = await loadCopy(basic, 'en-US');
    expect(copy.locale).toBe('en-US');
    expect(copy.approved).toBe(true);
    expect(must(copy.screens['home']).headline).toBe('See Every Ride');
    expect(must(copy.screens['details']).headline).toEqual(['Time Every Lap', 'Automatically']);
    expect(must(copy.screens['tablet-split']).callouts).toHaveLength(2);
    expect(copy.shared).toEqual({ appName: 'Basic' });
  });

  it('rejects a missing locale with S1sError copy-missing (no silent fallback to another locale)', async () => {
    const err = await catchS1sError(loadCopy(basic, 'de-DE'));
    expect(err.code).toBe('copy-missing');
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain('de-DE');
  });

  describe('with a temp project', () => {
    let tmp: TempDir;
    beforeEach(async () => {
      tmp = await makeTempDir();
      await mkdir(join(tmp.dir, 'copy'), { recursive: true });
    });
    afterEach(() => tmp.cleanup());

    it('rejects malformed JSON with copy-invalid', async () => {
      await writeFile(copyPath(tmp.dir, 'en-US'), '{ "locale": ', 'utf8');
      const err = await catchS1sError(loadCopy(tmp.dir, 'en-US'));
      expect(err.code).toBe('copy-invalid');
      expect(err.message).toContain('en-US.json');
    });

    it('rejects a wrong shape with copy-invalid', async () => {
      await writeFile(copyPath(tmp.dir, 'en-US'), JSON.stringify({ locale: 'en-US', screens: { home: { headline: 42 } } }), 'utf8');
      expect((await catchS1sError(loadCopy(tmp.dir, 'en-US'))).code).toBe('copy-invalid');
    });

    it('keeps extra template fields on a screen', async () => {
      await writeFile(
        copyPath(tmp.dir, 'fr-FR'),
        JSON.stringify({ locale: 'fr-FR', screens: { home: { headline: 'Bonjour', cta: 'Commencer' } } }),
        'utf8',
      );
      const copy = await loadCopy(tmp.dir, 'fr-FR');
      expect(must(copy.screens['home'])['cta']).toBe('Commencer');
    });
  });
});

describe('localeCopySchema', () => {
  it('accepts the minimal shape and string-or-lines headlines', () => {
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: {} }).success).toBe(true);
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: { a: { headline: 'One' } } }).success).toBe(true);
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: { a: { headline: ['One', 'Two'], subline: ['x', 'y'] } } }).success).toBe(true);
    expect(
      localeCopySchema.safeParse({
        locale: 'en-US',
        approved: false,
        screens: { a: { headline: 'One', highlight: 'One', badge: 'New', callouts: [{ title: 't' }, { title: 't', body: 'b' }], layoutNotes: 'n' } },
        shared: { appName: 'X' },
      }).success,
    ).toBe(true);
  });

  it('rejects missing locale, missing screens, non-string headline, and bad callouts', () => {
    expect(localeCopySchema.safeParse({ screens: {} }).success).toBe(false);
    expect(localeCopySchema.safeParse({ locale: 'en-US' }).success).toBe(false);
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: { a: {} } }).success).toBe(false);
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: { a: { headline: 42 } } }).success).toBe(false);
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: { a: { headline: 'x', callouts: [{ body: 'no title' }] } } }).success).toBe(false);
    expect(localeCopySchema.safeParse({ locale: 'en-US', screens: { a: { headline: 'x', highlight: 1 } } }).success).toBe(false);
  });

  it('keeps unknown template fields on a screen', () => {
    const parsed = localeCopySchema.safeParse({ locale: 'en-US', screens: { a: { headline: 'x', cta: 'Go', stats: [1, 2] } } });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(must(parsed.data.screens['a'])['cta']).toBe('Go');
      expect(must(parsed.data.screens['a'])['stats']).toEqual([1, 2]);
    }
  });
});

describe('listCopyLocales', () => {
  it('lists the fixture locale', async () => {
    expect(await listCopyLocales(basic)).toEqual(['en-US']);
  });

  it('lists every *.json in copy/ and ignores other files; empty when the dir is missing', async () => {
    const tmp = await makeTempDir();
    try {
      expect(await listCopyLocales(tmp.dir)).toEqual([]);
      await mkdir(join(tmp.dir, 'copy'));
      await writeFile(join(tmp.dir, 'copy', 'en-US.json'), '{}');
      await writeFile(join(tmp.dir, 'copy', 'de-DE.json'), '{}');
      await writeFile(join(tmp.dir, 'copy', 'brief.md'), '# glossary');
      expect((await listCopyLocales(tmp.dir)).sort()).toEqual(['de-DE', 'en-US']);
    } finally {
      await tmp.cleanup();
    }
  });
});

describe('unusedCopyKeys', () => {
  const screens: ScreensConfig = {
    screens: [{ id: 'home' }, { id: 'detail', copyKey: 'details' }, { id: 'pocket', only: ['iphone'] }],
  };

  it('returns copy keys no screen references (by copyKey or id)', () => {
    const copy: LocaleCopy = {
      locale: 'en-US',
      screens: { home: { headline: 'a' }, details: { headline: 'b' }, legacy: { headline: 'c' }, detail: { headline: 'd' } },
      shared: { appName: 'X' },
    };
    expect(unusedCopyKeys(copy, screens).sort()).toEqual(['detail', 'legacy']);
  });

  it('is empty when every key is used or when screens have no copy yet', () => {
    expect(unusedCopyKeys({ locale: 'en-US', screens: { home: { headline: 'a' }, details: { headline: 'b' }, pocket: { headline: 'c' } } }, screens)).toEqual([]);
    expect(unusedCopyKeys({ locale: 'en-US', screens: {} }, screens)).toEqual([]);
  });
});
