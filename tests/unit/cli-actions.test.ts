// Guards the commander wiring of every `s1s` command.
//
// Commander calls an action handler as `(...positionalArgs, options, command)`.
// A handler written as `(target, mode, cmd) => runAction(cmd, ...)` on a command
// with TWO positional arguments therefore gets the options object in `cmd`, and
// the first `cmd.optsWithGlobals()` fails at run time with
// "cmd.optsWithGlobals is not a function" (`s1s sim appearance <udid> dark`).
//
// The fix is structural: actions are registered through defineAction /
// defineRawAction, which close over the command instead of counting callback
// parameters. These tests hold that line for every command, present and future.
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { defineAction, hasDefinedAction, type CommandOutput } from '../../src/cli/output.ts';
import { allCommands, buildProgram } from '../../src/cli/program.ts';

/** Commands that actually run something (groups such as `sim` only dispatch). */
function leafCommands(program: Command): Command[] {
  return allCommands(program).filter((cmd) => cmd.commands.length === 0);
}

function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let node: Command | null = cmd; node; node = node.parent) names.unshift(node.name());
  return names.join(' ');
}

describe('every registered command', () => {
  const program = buildProgram();

  it('has at least the commands of the documented surface', () => {
    const paths = allCommands(program).map(commandPath);
    for (const expected of [
      's1s init', 's1s link', 's1s doctor', 's1s dev', 's1s render', 's1s sheet', 's1s capture',
      's1s sim list', 's1s sim status-bar', 's1s sim appearance',
      's1s bezels inspect', 's1s bezels install', 's1s bezels list',
      's1s status', 's1s export', 's1s validate',
    ]) {
      expect(paths, paths.join(', ')).toContain(expected);
    }
  });

  it.each(leafCommands(program).map((cmd) => [commandPath(cmd), cmd] as const))(
    '%s resolves its merged options without throwing',
    (path, cmd) => {
      expect(() => cmd.optsWithGlobals(), path).not.toThrow();
      expect(() => cmd.opts(), path).not.toThrow();
    },
  );

  it.each(leafCommands(program).map((cmd) => [commandPath(cmd), cmd] as const))(
    '%s registers its action through defineAction (never a hand-counted callback)',
    (path, cmd) => {
      expect(hasDefinedAction(cmd), `${path}: use defineAction/defineRawAction so the handler never depends on commander's callback arity`).toBe(true);
    },
  );
});

describe('defineAction against commander', () => {
  /** Two positional arguments: the arity that broke `s1s sim appearance`. */
  async function runTwoArgCommand(argv: string[]): Promise<{ args: readonly unknown[]; opts: { loud?: boolean }; json?: boolean; project?: string; isCommand: boolean }> {
    const program = new Command('root').option('--project <dir>').option('--json').exitOverride();
    let seen: { args: readonly unknown[]; opts: { loud?: boolean }; json?: boolean; project?: string; isCommand: boolean } | null = null;
    defineAction<{ loud?: boolean }, [string, string]>(
      program.command('pair').argument('<one>').argument('<two>').option('--loud'),
      async (ctx): Promise<CommandOutput> => {
        seen = {
          args: ctx.args,
          opts: ctx.opts,
          ...(ctx.globals.json === undefined ? {} : { json: ctx.globals.json }),
          ...(ctx.globals.project === undefined ? {} : { project: ctx.globals.project }),
          isCommand: typeof ctx.cmd.optsWithGlobals === 'function',
        };
        return { data: {}, text: '' };
      },
    );
    // defineAction prints the CommandOutput; keep the test's stdout clean.
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await program.parseAsync(argv, { from: 'user' });
    } finally {
      write.mockRestore();
    }
    if (seen === null) throw new Error('the action never ran');
    return seen;
  }

  it('passes the Command itself, its positionals and its own options', async () => {
    const seen = await runTwoArgCommand(['--json', '--project', '/tmp/app', 'pair', 'a', 'b', '--loud']);
    expect(seen.isCommand).toBe(true);
    expect(seen.args).toEqual(['a', 'b']);
    expect(seen.opts).toEqual({ loud: true });
    expect(seen.json).toBe(true);
    expect(seen.project).toBe('/tmp/app');
  });

  it('works with no options and no globals set', async () => {
    const seen = await runTwoArgCommand(['pair', 'x', 'y']);
    expect(seen.isCommand).toBe(true);
    expect(seen.args).toEqual(['x', 'y']);
    expect(seen.opts).toEqual({});
    expect(seen.json).toBeUndefined();
  });
});
