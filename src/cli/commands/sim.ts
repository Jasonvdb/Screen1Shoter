// `s1s sim list | status-bar | appearance`: thin wrappers over src/core/sim.ts.
import { Argument, type Command } from 'commander';
import { appearance, findSim, listSims, statusBar } from '../../core/sim.ts';
import { defineAction, table, type CommandOutput, type NoOpts } from '../output.ts';

type Appearance = 'light' | 'dark';
const APPEARANCES: readonly Appearance[] = ['light', 'dark'];

interface ListFlags {
  all?: boolean;
}

interface StatusBarFlags {
  time: string;
  clear?: boolean;
}

async function listCommand(opts: ListFlags): Promise<CommandOutput> {
  const devices = (await listSims()).filter((d) => opts.all === true || d.isAvailable);
  const rows = devices.map((d) => [d.name, d.state, d.runtime, d.udid]);
  return {
    data: { devices },
    text: devices.length > 0 ? table(['name', 'state', 'runtime', 'udid'], rows) : 'No simulators found.',
  };
}

async function statusBarCommand(target: string, opts: StatusBarFlags): Promise<CommandOutput> {
  const device = await findSim(target);
  const clear = opts.clear === true;
  const { supported } = await statusBar(device.udid, clear ? { clear: true } : { time: opts.time });
  const change = clear ? 'cleared' : `set to ${opts.time}`;
  const text = supported
    ? `Status bar ${change} on ${device.name} (${device.udid}).`
    : `Status bar overrides are not supported on ${device.name} (${device.platform}); nothing changed.`;
  return {
    data: { udid: device.udid, name: device.name, platform: device.platform, supported, cleared: clear, time: clear ? null : opts.time },
    text,
  };
}

async function appearanceCommand(target: string, mode: Appearance): Promise<CommandOutput> {
  const device = await findSim(target);
  await appearance(device.udid, mode);
  return {
    data: { udid: device.udid, name: device.name, mode },
    text: `Appearance set to ${mode} on ${device.name} (${device.udid}).`,
  };
}

export function registerSim(program: Command): void {
  const sim = program.command('sim').description('Simulator helpers built on `xcrun simctl`');

  defineAction<ListFlags>(
    sim
      .command('list')
      .description('List simulators (available ones by default)')
      .option('--all', 'include unavailable devices'),
    ({ opts }) => listCommand(opts),
  );

  defineAction<StatusBarFlags, [string]>(
    sim
      .command('status-bar')
      .description('Set the App Store status bar: 9:41, Wi-Fi, full signal, full battery (no charging bolt)')
      .argument('<udid|name>', 'simulator udid or exact device name')
      .option('--time <text>', 'clock text', '9:41')
      .option('--clear', 'remove the override'),
    ({ args: [target], opts }) => statusBarCommand(target, opts),
  );

  defineAction<NoOpts, [string, Appearance]>(
    sim
      .command('appearance')
      .description('Switch the simulator UI to light or dark')
      .argument('<udid|name>', 'simulator udid or exact device name')
      .addArgument(new Argument('<mode>', 'light or dark').choices([...APPEARANCES])),
    ({ args: [target, mode] }) => appearanceCommand(target, mode),
  );
}
