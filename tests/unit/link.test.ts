// isProjectLinked: only a symlink to this checkout counts; missing, dangling
// and foreign links are repaired by linkProject.
import { mkdir, readlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProjectLinked, linkProject } from '../../src/cli/commands/link.ts';
import { toolRoot } from '../../src/core/paths.ts';
import { makeTempDir, type TempDir } from '../fixtures/helpers.ts';

describe('isProjectLinked', () => {
  let tmp: TempDir;
  let link: string;

  beforeEach(async () => {
    tmp = await makeTempDir();
    link = join(tmp.dir, 'node_modules', 'screen1shoter');
    await mkdir(join(tmp.dir, 'node_modules'), { recursive: true });
  });
  afterEach(() => tmp.cleanup());

  it('is false when the link is missing, dangling or points at another checkout; true after linkProject', async () => {
    expect(await isProjectLinked(tmp.dir)).toBe(false);

    await symlink('/nonexistent/checkout', link);
    expect(await isProjectLinked(tmp.dir)).toBe(false);
    const repaired = await linkProject(tmp.dir);
    expect(repaired[0]?.status).toBe('updated');
    expect(await readlink(link)).toBe(toolRoot());
    expect(await isProjectLinked(tmp.dir)).toBe(true);

    const other = join(tmp.dir, 'other-checkout');
    await mkdir(other);
    const { rm } = await import('node:fs/promises');
    await rm(link);
    await symlink(other, link);
    expect(await isProjectLinked(tmp.dir)).toBe(false);
  });

  it('keeps a real directory in place', async () => {
    await mkdir(link);
    expect(await isProjectLinked(tmp.dir)).toBe(false);
    const results = await linkProject(tmp.dir);
    expect(results[0]?.status).toBe('kept');
  });
});
