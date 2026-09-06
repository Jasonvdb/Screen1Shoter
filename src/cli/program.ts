// Builds the `s1s` commander program: the root options every command reads
// through `defineAction`, and every command of the surface.
//
// Kept apart from main.ts (which runs on import) so tests can build the
// program and inspect every registered command.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { toolRoot } from '../core/paths.ts';
import { registerBezels } from './commands/bezels.ts';
import { registerCapture } from './commands/capture.ts';
import { registerDev } from './commands/dev.ts';
import { registerDoctor } from './commands/doctor.ts';
import { registerExport } from './commands/export.ts';
import { registerInit } from './commands/init.ts';
import { registerLink } from './commands/link.ts';
import { registerRender } from './commands/render.ts';
import { registerSheet } from './commands/sheet.ts';
import { registerSim } from './commands/sim.ts';
import { registerStatus } from './commands/status.ts';
import { registerValidate } from './commands/validate.ts';

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
  registerStatus(program);
  registerExport(program);
  registerValidate(program);
  return program;
}

/** Every command in the tree (groups and their subcommands), depth first. */
export function allCommands(cmd: Command): Command[] {
  return cmd.commands.flatMap((child) => [child, ...allCommands(child)]);
}
