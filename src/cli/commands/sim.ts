// `s1s sim list | status-bar | appearance | pose`: thin wrappers over
// src/core/sim.ts and src/core/pose.ts.
import { Argument, type Command } from 'commander';
import { S1sError } from '../../core/errors.ts';
import { POSES, setPose, type Pose } from '../../core/pose.ts';
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

interface PoseFlags {
  settle: string;
}

async function poseCommand(target: string, pose: Pose, opts: PoseFlags): Promise<CommandOutput> {
  const device = await findSim(target);
  if (device.state !== 'Booted') {
    throw new S1sError('usage', `${device.name} is ${device.state}; boot it first.`, { hint: `xcrun simctl boot ${device.udid}` });
  }
  const settleMs = Number.parseInt(opts.settle, 10);
  await setPose(device.udid, pose, Number.isFinite(settleMs) && settleMs >= 0 ? settleMs : 4000);
  return {
    data: { udid: device.udid, name: device.name, pose },
    text: `Pose ${pose} on ${device.name} (${device.udid}).`,
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

  defineAction<PoseFlags, [string, Pose]>(
    sim
      .command('pose')
      .description("Fold or unfold an iPhone Duo simulator by pressing Device Hub's pose button (Accessibility, no mouse)")
      .argument('<udid|name>', 'simulator udid or exact device name')
      .addArgument(new Argument('<pose>', 'closed shows the outer display, open the inner one').choices([...POSES]))
      .option('--settle <ms>', 'wait after the press so the next screenshot sees the new display', '4000'),
    ({ args: [target, pose], opts }) => poseCommand(target, pose, opts),
  );
}
