// `s1s capture` has to answer two separate questions about one file, and W8
// pulled them apart:
//
//   - which size's pixel count is the shot checked against? The one the
//     `--name` prefix names, so a 422x514 Apple Watch Ultra shot is accepted by
//     a project whose `sizes` are only iphone-6.9 and ipad-13.
//   - which screens then reference the file? Every size the project renders,
//     because a phone-watch screen draws a watch on an iPhone canvas.
//
// Only the screens whose OWN family the file belongs to may fill the single
// `capture` field of an ImageState. Recording a watch shot as the capture of an
// iPhone screen would tell `s1s status` the iPhone capture is 422x514.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { screensUsingFile } from '../../src/cli/commands/capture.ts';
import type { ScreensConfig } from '../../src/config/types.ts';
import { loadProject, type Project } from '../../src/core/project.ts';
import { makeTempDir, writeTempProject, type TempDir } from '../fixtures/helpers.ts';

const LOCALE = 'en-US';

const SCREENS: ScreensConfig = {
  sizes: ['iphone-6.9', 'ipad-13', 'watch-s10'],
  locales: [LOCALE],
  screens: [
    // A plain screen first, so lap-times' ordinal below is really its position.
    { id: 'track-map', template: 'hero-top-text', only: ['iphone', 'ipad'] },
    // The phone-watch screen: its own capture plus a watch drawn beside it.
    { id: 'lap-times', template: 'phone-watch', capture: ['lap-times', 'watch-ultra:watch-lap-ultra'], only: ['iphone', 'ipad'] },
    // The watch set, which spells its capture with the other prefix form.
    { id: 'watch-lap', template: 'raw', capture: ['watch-s10:watch-lap'], only: ['watch-s10'] },
  ],
};

let tmp: TempDir | undefined;

async function openFixture(): Promise<Project> {
  tmp = await makeTempDir('s1s-capture-cmd-');
  const dir = join(tmp.dir, 'screenshots');
  await writeTempProject(dir, { screens: SCREENS });
  return loadProject({ projectDir: dir });
}

afterEach(async () => {
  await tmp?.cleanup();
  tmp = undefined;
});

describe('screensUsingFile', () => {
  it('reports a cross-size watch capture as a second device on both phone canvases', async () => {
    const project = await openFixture();
    const uses = screensUsingFile(project, LOCALE, 'watch', 'watch-lap-ultra');
    expect(uses.map((u) => `${u.preset.id}/${u.screen.id}/${u.ordinal}`)).toEqual(['iphone-6.9/lap-times/2', 'ipad-13/lap-times/2']);
    // The file is a watch shot on an iPhone/iPad canvas, so it owns no capture field.
    expect(uses.every((u) => u.primary)).toBe(false);
    expect(uses.some((u) => u.primary)).toBe(false);
  });

  it('reports a screen\'s own capture as primary, so it fills the manifest', async () => {
    const project = await openFixture();
    const uses = screensUsingFile(project, LOCALE, 'iphone', 'lap-times');
    expect(uses.map((u) => u.preset.id)).toEqual(['iphone-6.9']);
    expect(uses[0]?.primary).toBe(true);
  });

  it('matches a bare name and a prefixed ref as one file', async () => {
    const project = await openFixture();
    // screens.ts spells it 'watch-s10:watch-lap'; `--name watch-lap` is the same file.
    const uses = screensUsingFile(project, LOCALE, 'watch', 'watch-lap');
    expect(uses.map((u) => `${u.preset.id}/${u.screen.id}`)).toEqual(['watch-s10/watch-lap']);
    expect(uses[0]?.primary).toBe(true);
  });

  it('keeps families apart, so a same-named capture of another device does not match', async () => {
    const project = await openFixture();
    // 'lap-times' exists under iphone and ipad, never under watch.
    expect(screensUsingFile(project, LOCALE, 'watch', 'lap-times')).toEqual([]);
    // And the iPad canvas has its own file of that name.
    expect(screensUsingFile(project, LOCALE, 'ipad', 'lap-times').map((u) => u.preset.id)).toEqual(['ipad-13']);
  });

  it('returns nothing for a file no screen names', async () => {
    const project = await openFixture();
    expect(screensUsingFile(project, LOCALE, 'watch', 'watch-nothing')).toEqual([]);
  });
});
