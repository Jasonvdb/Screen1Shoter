// Builds the `s1s` commander program: the root options every command reads
// through `defineAction`, the implemented commands, and "not implemented"
// stubs for later phases so `--help` shows the full surface.
//
// Kept apart from main.ts (which runs on import) so tests can build the
// program and inspect every registered command.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { S1sError } from '../core/errors.ts';
import { toolRoot } from '../core/paths.ts';
import { registerBezels } from './commands/bezels.ts';
import { registerCapture } from './commands/capture.ts';
import { registerDev } from './commands/dev.ts';
import { registerDoctor } from './commands/doctor.ts';
import { registerInit } from './commands/init.ts';
import { registerLink } from './commands/link.ts';
import { registerRender } from './commands/render.ts';
import { registerSheet } from './commands/sheet.ts';
import { registerSim } from './commands/sim.ts';
import { defineAction } from './output.ts';

/** Commands from later phases. Registered so `--help` shows the full surface. */
const LATER_COMMANDS: ReadonlyArray<{ name: string; description: string; phase: string }> = [
  { name: 'status', description: 'Reconcile the manifest, files on disk and the store', phase: 'W5' },
  { name: 'export', description: 'Copy renders into metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png', phase: 'W5' },
  { name: 'validate', description: 'Check an export folder offline against App Store Connect rules', phase: 'W5' },
];

function registerStub(program: Command, stub: { name: string; description: string; phase: string }): void {
  defineAction(
    program
      .command(stub.name)
      .description(`${stub.description} (not implemented yet: ${stub.phase})`)
      .allowUnknownOption()
      .allowExcessArguments(),
    async () => {
      throw new S1sError('usage', `\`s1s ${stub.name}\` is not implemented yet (planned for ${stub.phase}).`);
    },
  );
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(toolRoot(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function buildProgram(): Command {
  const program = new Command('s1s')
    .description('App Store screenshots from React templates, rendered by headless Chromium to exact-pixel PNGs.')
    .version(readVersion(), '-V, --version', 'print the tool version')
    .option('--project <dir>', 'app repo dir or its screenshots/ dir (default: search up from the cwd)')
    .option('--json', 'print one JSON object on stdout; progress goes to stderr')
    .showHelpAfterError('(use --help for usage)')
    .exitOverride();

  registerInit(program);
  registerLink(program);
  registerDoctor(program);
  registerDev(program);
  registerRender(program);
  registerSheet(program);
  registerCapture(program);
  registerSim(program);
  registerBezels(program);
  for (const stub of LATER_COMMANDS) registerStub(program, stub);
  return program;
}

/** Every command in the tree (groups and their subcommands), depth first. */
export function allCommands(cmd: Command): Command[] {
  return cmd.commands.flatMap((child) => [child, ...allCommands(child)]);
}
