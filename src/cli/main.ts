// Entry point of the `s1s` CLI (bin/s1s.js runs this through tsx with
// S1S_ROOT set to the checkout). Parses argv with the program from
// program.ts and maps commander usage errors to exit code 2.
//
// This module runs on import; test the CLI by spawning bin/s1s.js, or build
// the program with `buildProgram()` from program.ts.
import { CommanderError, type Command } from 'commander';
import { emitError } from './output.ts';
import { buildProgram } from './program.ts';

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
