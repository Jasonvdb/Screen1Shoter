// src/core/pose.ts with every process stubbed: the button names Device Hub
// shows, the arguments the helper gets, and how its exit codes read.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../../src/core/exec.ts';
import { POSES, POSE_BUTTON, POSE_HELPER_SOURCE, setPose } from '../../src/core/pose.ts';
import { catchS1sError } from '../fixtures/helpers.ts';

vi.mock('../../src/core/exec.ts', () => ({
  run: vi.fn(),
  runOk: vi.fn(),
  which: vi.fn(async () => null),
  formatCommand: (cmd: string, args: readonly string[]) => [cmd, ...args].join(' '),
}));

// The compiled helper is "already there", so no swiftc runs.
vi.mock('../../src/core/fs.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/fs.ts')>()),
  pathExists: vi.fn(async () => true),
}));

const UDID = 'F022191A-256E-4022-96A8-D9A77542B077';

function stub(helperExit: number): void {
  vi.mocked(run).mockImplementation(async (cmd) => {
    if (cmd === 'xcode-select') return { code: 0, stdout: '/Applications/Xcode.app/Contents/Developer\n', stderr: '' };
    if (cmd === 'pgrep') return { code: 0, stdout: '45838\n', stderr: '' };
    return { code: helperExit, stdout: '', stderr: '' };
  });
}

describe('setPose', () => {
  beforeEach(() => vi.mocked(run).mockReset());

  it('names every pose by the AXDescription of its Device Hub button', () => {
    expect(POSES).toEqual(['closed', 'partially-open', 'open', 'rotate-right']);
    expect(Object.values(POSE_BUTTON)).toEqual(['Closed', 'Partially Open', 'Open', 'Rotate Right']);
    // The helper finds the row by Device Hub's identifier and never moves the mouse.
    expect(POSE_HELPER_SOURCE).toContain('"TableRow.Device." + udid');
    expect(POSE_HELPER_SOURCE).toContain('AXManualAccessibility');
    expect(POSE_HELPER_SOURCE).not.toMatch(/CGEvent/);
  });

  it('passes the Device Hub pid, the udid and the button to the helper', async () => {
    stub(0);
    await setPose(UDID, 'partially-open', 0);
    const helperCall = vi.mocked(run).mock.calls.find(([cmd]) => cmd.includes('devicehub-pose-'));
    expect(helperCall?.[1]).toEqual(['45838', UDID, 'Partially Open']);
  });

  it('turns a missing Accessibility grant into sim-failed with the settings hint', async () => {
    stub(3);
    const error = await catchS1sError(setPose(UDID, 'open', 0));
    expect(error.code).toBe('sim-failed');
    expect(error.message).toContain('not allowed to use Accessibility');
    expect(error.hint).toContain('Device Control and Data Access');
  });

  it('says when the device window has no pose button', async () => {
    stub(5);
    const error = await catchS1sError(setPose(UDID, 'closed', 0));
    expect(error.message).toContain('no such button');
  });
});
