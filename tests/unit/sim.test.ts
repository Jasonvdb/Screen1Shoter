// Pure parts of src/core/sim.ts against a captured `simctl list devices
// --json` shape, the exact status-bar override flags from the plan, and the
// watchOS short-circuit in statusBar with xcrun stubbed out.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run, runOk } from '../../src/core/exec.ts';
import { STATUS_BAR_FLAGS, parseSimctlDevices, pickSim, statusBar, type SimDevice } from '../../src/core/sim.ts';

vi.mock('../../src/core/exec.ts', () => ({
  run: vi.fn(),
  runOk: vi.fn(),
  which: vi.fn(async () => null),
  formatCommand: (cmd: string, args: readonly string[]) => [cmd, ...args].join(' '),
}));

const IPHONE_SHUTDOWN = '0A6C8D3E-1111-4E0B-9C7A-000000000001';
const IPHONE_BOOTED = '0A6C8D3E-2222-4E0B-9C7A-000000000002';
const IPHONE_UNAVAILABLE = '0A6C8D3E-3333-4E0B-9C7A-000000000003';
const WATCH = '747E740D-B06D-4318-AABE-ECB00EDCF388';

/** Trimmed from `xcrun simctl list devices --json` (Xcode 26). */
const SIMCTL_JSON = {
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
      {
        lastBootedAt: '2026-09-01T08:00:00Z',
        dataPath: '/Users/x/Library/Developer/CoreSimulator/Devices/1/data',
        udid: IPHONE_SHUTDOWN,
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max',
        state: 'Shutdown',
        name: 'iPhone 17 Pro Max',
      },
      {
        udid: IPHONE_BOOTED,
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max',
        state: 'Booted',
        name: 'iPhone 17 Pro Max',
      },
      {
        udid: IPHONE_UNAVAILABLE,
        isAvailable: false,
        availabilityError: 'runtime profile not found',
        state: 'Shutdown',
        name: 'iPhone 17 Pro',
      },
      { name: 'no udid, ignored', state: 'Shutdown' },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-26-5': [
      {
        udid: WATCH,
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-11-46mm',
        state: 'Shutdown',
        name: 'Apple Watch Series 11 (46mm)',
      },
    ],
    'com.apple.CoreSimulator.SimRuntime.tvOS-26-5': 'not an array, ignored',
  },
};

describe('parseSimctlDevices', () => {
  it('flattens runtimes into devices with runtime labels, platforms and availability', () => {
    const sims = parseSimctlDevices(SIMCTL_JSON);
    expect(sims.map((s) => [s.name, s.state, s.runtime, s.platform, s.isAvailable])).toEqual([
      ['iPhone 17 Pro Max', 'Shutdown', 'iOS 26.5', 'iOS', true],
      ['iPhone 17 Pro Max', 'Booted', 'iOS 26.5', 'iOS', true],
      ['iPhone 17 Pro', 'Shutdown', 'iOS 26.5', 'iOS', false],
      ['Apple Watch Series 11 (46mm)', 'Shutdown', 'watchOS 26.5', 'watchOS', true],
    ]);
    expect(sims.map((s) => s.udid)).toEqual([IPHONE_SHUTDOWN, IPHONE_BOOTED, IPHONE_UNAVAILABLE, WATCH]);
  });

  it('defaults isAvailable to true and labels unknown runtimes as other', () => {
    const sims = parseSimctlDevices({
      devices: { 'com.apple.CoreSimulator.SimRuntime.xrOS-3-0': [{ udid: 'X', name: 'Vision', state: 'Shutdown' }] },
    });
    expect(sims).toEqual([{ udid: 'X', name: 'Vision', state: 'Shutdown', runtime: 'xrOS 3.0', isAvailable: true, platform: 'other' }]);
  });

  it('returns [] for shapes it does not understand', () => {
    expect(parseSimctlDevices(null)).toEqual([]);
    expect(parseSimctlDevices({})).toEqual([]);
    expect(parseSimctlDevices({ devices: 'nope' })).toEqual([]);
    expect(parseSimctlDevices('[]')).toEqual([]);
  });
});

describe('pickSim', () => {
  const sims: SimDevice[] = parseSimctlDevices(SIMCTL_JSON);

  it('matches a udid case-insensitively, even when the device is unavailable', () => {
    expect(pickSim(sims, IPHONE_SHUTDOWN.toLowerCase())?.udid).toBe(IPHONE_SHUTDOWN);
    expect(pickSim(sims, ` ${IPHONE_UNAVAILABLE} `)?.udid).toBe(IPHONE_UNAVAILABLE);
  });

  it('prefers the booted device on a name tie', () => {
    expect(pickSim(sims, 'iPhone 17 Pro Max')?.udid).toBe(IPHONE_BOOTED);
    const shutdownOnly = sims.filter((s) => s.udid !== IPHONE_BOOTED);
    expect(pickSim(shutdownOnly, 'iPhone 17 Pro Max')?.udid).toBe(IPHONE_SHUTDOWN);
  });

  it('ignores unavailable devices by name and returns null for unknown names', () => {
    expect(pickSim(sims, 'iPhone 17 Pro')).toBeNull();
    expect(pickSim(sims, 'iphone 17 pro max')).toBeNull(); // names are exact
    expect(pickSim([], 'anything')).toBeNull();
  });
});

describe('STATUS_BAR_FLAGS', () => {
  it('is exactly the override list from the plan', () => {
    expect([...STATUS_BAR_FLAGS]).toEqual([
      '--dataNetwork', 'wifi',
      '--wifiMode', 'active',
      '--wifiBars', '3',
      '--cellularMode', 'active',
      '--cellularBars', '4',
      '--batteryState', 'discharging',
      '--batteryLevel', '100',
      '--operatorName', '',
    ]);
  });
});

describe('statusBar', () => {
  beforeEach(() => {
    vi.mocked(run).mockReset();
    vi.mocked(runOk).mockReset();
    vi.mocked(run).mockImplementation(async (cmd) => {
      if (cmd === 'xcode-select') return { code: 0, stdout: '/Applications/Xcode.app/Contents/Developer\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
    vi.mocked(runOk).mockImplementation(async (cmd, args) => {
      if (cmd === 'xcrun' && args[1] === 'list') return { code: 0, stdout: JSON.stringify(SIMCTL_JSON), stderr: '' };
      throw new Error(`unexpected runOk ${cmd} ${args.join(' ')}`);
    });
  });

  it('reports supported: false for a watchOS udid without calling simctl status_bar', async () => {
    expect(await statusBar(WATCH, { time: '9:41' })).toEqual({ supported: false });
    expect(await statusBar(WATCH.toLowerCase(), { clear: true })).toEqual({ supported: false });
    const statusBarCalls = vi.mocked(run).mock.calls.filter(([, args]) => args.includes('status_bar'));
    expect(statusBarCalls).toEqual([]);
  });

  it('overrides the clock plus the fixed flags for an iOS udid, and clears on request', async () => {
    expect(await statusBar(IPHONE_BOOTED, { time: '9:41' })).toEqual({ supported: true });
    expect(await statusBar(IPHONE_BOOTED, { clear: true })).toEqual({ supported: true });
    const statusBarCalls = vi.mocked(run).mock.calls.filter(([, args]) => args.includes('status_bar')).map(([, args]) => args);
    expect(statusBarCalls).toEqual([
      ['simctl', 'status_bar', IPHONE_BOOTED, 'override', '--time', '9:41', ...STATUS_BAR_FLAGS],
      ['simctl', 'status_bar', IPHONE_BOOTED, 'clear'],
    ]);
  });

  it('treats an "unsupported" simctl error as supported: false', async () => {
    vi.mocked(run).mockImplementation(async (cmd, args) => {
      if (cmd === 'xcode-select') return { code: 0, stdout: '/Applications/Xcode.app/Contents/Developer\n', stderr: '' };
      if (args.includes('status_bar')) return { code: 1, stdout: '', stderr: 'Status bar overrides are not supported on this device' };
      return { code: 0, stdout: '', stderr: '' };
    });
    expect(await statusBar(IPHONE_SHUTDOWN)).toEqual({ supported: false });
  });
});
