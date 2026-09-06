// Entry point of the `s1s` CLI (bin/s1s.js runs this through tsx with
// S1S_ROOT set to the checkout). Builds the commander program, registers the
// W1 commands plus "not implemented" stubs for later phases, and maps
// commander usage errors to exit code 2.
//
// This module runs on import; test the CLI by spawning bin/s1s.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
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
import { emitError, runAction } from './output.ts';

/** Commands from later phases. Registered so `--help` shows the full surface. */
const LATER_COMMANDS: ReadonlyArray<{ name: string; description: string; phase: string }> = [
  { name: 'status', description: 'Reconcile the manifest, files on disk and the store', phase: 'W5' },
  { name: 'export', description: 'Copy renders into metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png', phase: 'W5' },
  { name: 'validate', description: 'Check an export folder offline against App Store Connect rules', phase: 'W5' },
];

function registerStub(program: Command, stub: { name: string; description: string; phase: string }): void {
  program
    .command(stub.name)
    .description(`${stub.description} (not implemented yet: ${stub.phase})`)
    .allowUnknownOption()
    .allowExcessArguments()
    .action((_opts: unknown, cmd: Command) =>
      runAction(cmd, async () => {
        throw new S1sError('usage', `\`s1s ${stub.name}\` is not implemented yet (planned for ${stub.phase}).`);
      }),
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

function buildProgram(): Command {
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

/** `s1s --json` lists the root commands; `s1s bezels --json` lists the group's subcommands. */
function missingCommandError(program: Command, argv: readonly string[]): { code: string; message: string; hint: string } {
  const first = argv.slice(2).find((arg) => !arg.startsWith('-'));
  const group = program.commands.find((c) => c.name() === first && c.commands.length > 0);
  const names = (cmd: Command): string => cmd.commands.map((c) => c.name()).join(', ');
  if (group) {
    return { code: 'usage', message: `No subcommand given for \`s1s ${group.name()}\`. Commands: ${names(group)}.`, hint: `Run \`s1s ${group.name()} --help\`.` };
  }
  return { code: 'usage', message: `No command given. Commands: ${names(program)}.`, hint: 'Run `s1s --help`.' };
}

async function main(argv: readonly string[]): Promise<void> {
  const json = argv.includes('--json');
  const program = buildProgram();
  try {
    await program.parseAsync([...argv]);
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help, --version and `help <cmd>` exit 0; commander already printed them.
      if (err.exitCode === 0) return;
      // Usage errors: commander printed the message (or the help) to stderr.
      if (json) {
        // No (sub)command: commander's own message is the opaque "(outputHelp)".
        const error = err.code === 'commander.help' ? missingCommandError(program, argv) : { code: 'usage', message: err.message.trim(), hint: 'Run `s1s --help`.' };
        process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
      }
      process.exitCode = 2;
      return;
    }
    process.exitCode = emitError(err, { json });
  }
}

await main(process.argv);
