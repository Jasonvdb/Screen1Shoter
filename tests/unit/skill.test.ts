// Static invariants of the agent skill (AGENTS.md "Skill rules"). The skill
// is a product, so its shape is enforced by `pnpm check`, not by a pre-commit
// habit: frontmatter parses and is complete, the description fits the
// 1000-character budget, SKILL.md's body stays under the 500-line cap, every
// linked reference exists, no emoji or co-author text creeps in, and every
// `s1s <command>` the skill names -- with every `--flag` it writes after that
// command -- is registered in the CLI.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { allCommands, buildProgram } from '../../src/cli/program.ts';
import { REPO_ROOT, must } from '../fixtures/helpers.ts';

const SKILL_DIR = join(REPO_ROOT, 'skills', 'app-store-screenshots');
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');

/** Frontmatter keys the skill must carry (plan "Part B", AGENTS.md). */
const REQUIRED_KEYS = ['name', 'description', 'user-invocable', 'argument-hint', 'allowed-tools'] as const;

const MAX_DESCRIPTION_CHARS = 1000;
const MAX_BODY_LINES = 500;

/** Every markdown file that ships with the skill, repo-relative for readable failures. */
function skillMarkdownFiles(): string[] {
  const refs = readdirSync(join(SKILL_DIR, 'references'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(SKILL_DIR, 'references', name));
  return [SKILL_MD, join(SKILL_DIR, 'README.md'), ...refs].sort();
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

interface Frontmatter {
  keys: Map<string, string>;
  bodyLines: number;
}

/**
 * Splits `---` frontmatter from the body. The frontmatter is flat `key: value`
 * only, which is all a skill header may contain; anything else is a failure.
 */
function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('SKILL.md must start with a `---` frontmatter delimiter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('SKILL.md frontmatter has no closing `---`');
  const keys = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (line.trim().length === 0) continue;
    const at = line.indexOf(':');
    if (at <= 0 || /^\s/.test(line)) throw new Error(`frontmatter line is not a flat "key: value": ${line}`);
    const key = line.slice(0, at).trim();
    if (keys.has(key)) throw new Error(`duplicate frontmatter key: ${key}`);
    keys.set(key, line.slice(at + 1).trim().replace(/^"(.*)"$/, '$1'));
  }
  return { keys, bodyLines: lines.length - (end + 1) };
}

/** Root and group command names registered with commander, plus the W5 stubs. */
function registeredCommands(): Set<string> {
  const dir = join(REPO_ROOT, 'src', 'cli', 'commands');
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => read(join(dir, name)));
  sources.push(read(join(REPO_ROOT, 'src', 'cli', 'main.ts')));
  sources.push(read(join(REPO_ROOT, 'src', 'cli', 'program.ts')));
  const names = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(/\.command\('([a-z][a-z0-9-]*)'\)/g)) names.add(m[1] as string);
    for (const m of source.matchAll(/name: '([a-z][a-z0-9-]*)', description:/g)) names.add(m[1] as string);
  }
  return names;
}

describe('skill frontmatter', () => {
  const front = parseFrontmatter(read(SKILL_MD));

  it('parses and carries every required key', () => {
    for (const key of REQUIRED_KEYS) {
      expect(front.keys.get(key), `frontmatter key ${key}`).toBeTruthy();
    }
  });

  it(`description stays under ${MAX_DESCRIPTION_CHARS} characters`, () => {
    const description = front.keys.get('description') ?? '';
    expect(description.length, `description is ${description.length} chars`).toBeLessThan(MAX_DESCRIPTION_CHARS);
  });

  it('names the three skills it replaces so old habits map over', () => {
    const description = front.keys.get('description') ?? '';
    for (const old of ['aso-appstore-screenshots', 'asc-localize-screenshots', 'localize-app-store-screenshots']) {
      expect(description).toContain(old);
    }
  });
});

describe('SKILL.md size', () => {
  it(`body stays at or under ${MAX_BODY_LINES} lines`, () => {
    const { bodyLines } = parseFrontmatter(read(SKILL_MD));
    expect(bodyLines, `body is ${bodyLines} lines; move material into references/`).toBeLessThanOrEqual(MAX_BODY_LINES);
  });
});

describe('skill markdown hygiene', () => {
  it('every relative markdown link resolves on disk', () => {
    const missing: string[] = [];
    for (const file of skillMarkdownFiles()) {
      for (const m of read(file).matchAll(/\]\(([^)]+)\)/g)) {
        const target = (m[1] as string).split('#')[0] as string;
        if (target.length === 0 || /^[a-z][a-z0-9+.-]*:/.test(target)) continue;
        const abs = resolve(dirname(file), target);
        try {
          readFileSync(abs);
        } catch {
          missing.push(`${relative(REPO_ROOT, file)} -> ${target}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('carries no emoji or symbol characters (nothing at or above U+2100)', () => {
    const offenders: string[] = [];
    for (const file of skillMarkdownFiles()) {
      for (const char of new Set(read(file))) {
        if ((char.codePointAt(0) ?? 0) >= 0x2100) {
          offenders.push(`${relative(REPO_ROOT, file)}: U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The skill tells the agent never to write one, so match the trailer itself
  // (a line that starts with it), not every mention of the words.
  it('carries no co-author or AI attribution trailer', () => {
    for (const file of skillMarkdownFiles()) {
      expect(read(file), relative(REPO_ROOT, file)).not.toMatch(/^\s*Co-Authored-By:/im);
      expect(read(file), relative(REPO_ROOT, file)).not.toMatch(/Generated with \[Claude Code\]/i);
    }
  });
});

describe('skill and CLI stay in step', () => {
  // Only scan code: fenced blocks and inline code spans. Prose legitimately
  // says things like "until s1s can paint the time", where "can" is English,
  // not a subcommand, and matching it produced a false failure.
  const codeOnly = (markdown: string): string => {
    const chunks: string[] = [];
    for (const m of markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) chunks.push(m[1] as string);
    const prose = markdown.replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const m of prose.matchAll(/`([^`\n]+)`/g)) chunks.push(m[1] as string);
    return chunks.join('\n');
  };

  it('every `s1s <command>` the skill names is registered in the CLI', () => {
    const registered = registeredCommands();
    const unknown = new Set<string>();
    for (const file of skillMarkdownFiles()) {
      for (const m of codeOnly(read(file)).matchAll(/\bs1s ([a-z][a-z0-9-]*)/g)) {
        const name = m[1] as string;
        if (!registered.has(name)) unknown.add(`${relative(REPO_ROOT, file)}: s1s ${name}`);
      }
    }
    expect([...unknown].sort()).toEqual([]);
  });

  it('finds the commands it expects, so the scan itself is not vacuous', () => {
    const registered = registeredCommands();
    for (const name of ['init', 'render', 'capture', 'sim', 'bezels', 'status', 'export', 'validate']) {
      expect(registered, `command ${name}`).toContain(name);
    }
  });

  // Names alone are not enough: a documented flag the CLI does not register
  // makes the agent's command abort with a usage error. The commands come from
  // the real program, so a flag added or dropped in src/cli moves this test
  // with it.
  const longFlagsOf = (cmd: Command): Set<string> =>
    // `--no-asc` and `--no-sheet` are registered under exactly that name, so a
    // negation needs no special case here.
    new Set(cmd.options.map((option) => option.long).filter((long): long is string => long !== undefined));

  /** 'sim list' for a subcommand, 'render' for a root command. */
  const fullName = (cmd: Command): string => {
    const names: string[] = [];
    for (let node: Command | null = cmd; node !== null && node.parent !== null; node = node.parent) names.unshift(node.name());
    return names.join(' ');
  };

  // Where a shell command ends: everything after it belongs to another tool
  // (`s1s sim list --json | jq -r ...`) or to a comment.
  const SHELL_BREAK = /[|;&>#)]/;

  /**
   * `--locale <locale>` ends in a `>` that is a hole for the reader to fill,
   * not a redirection. Blank those out (same length, so the cut index still
   * points into the original text) before looking for the end of the command,
   * or every flag written after the first placeholder goes unscanned.
   */
  const maskPlaceholders = (text: string): string => text.replace(/<[^<>\s]*>/g, (hole) => '_'.repeat(hole.length));

  interface Invocation {
    /** Repo-relative markdown file the invocation was read from. */
    file: string;
    /** The deepest command the tokens address, e.g. `sim list`. */
    name: string;
    command: Command;
    /** Long flags written after the command, `--flag=value` reduced to `--flag`. */
    flags: string[];
    text: string;
  }

  /** Every `s1s <command> ...` written in skill code, with the flags it passes. */
  function invocations(program: Command): Invocation[] {
    const found: Invocation[] = [];
    for (const file of skillMarkdownFiles()) {
      const lines = codeOnly(read(file)).split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const m of (lines[i] as string).matchAll(/\bs1s ([a-z][a-z0-9-]*)/g)) {
          const root = program.commands.find((cmd) => cmd.name() === m[1]);
          if (root === undefined) continue; // unknown names are the previous test's business
          let command: Command = root;

          // A trailing backslash carries the flags onto the next line.
          let text = (lines[i] as string).slice(m.index);
          for (let j = i; /\\\s*$/.test(text) && j + 1 < lines.length; j++) {
            text = `${text.replace(/\\\s*$/, ' ')}${lines[j + 1] as string}`;
          }
          const cut = maskPlaceholders(text).search(SHELL_BREAK);
          const tokens = (cut < 0 ? text : text.slice(0, cut)).split(/\s+/).filter((token) => token.length > 0);

          let rest = tokens.slice(2);
          for (;;) {
            const sub = command.commands.find((cmd) => cmd.name() === rest[0]);
            if (sub === undefined) break;
            command = sub;
            rest = rest.slice(1);
          }
          found.push({
            file: relative(REPO_ROOT, file),
            name: fullName(command),
            command,
            flags: rest.filter((token) => token.startsWith('--') && token !== '--').map((token) => token.split('=')[0] as string),
            text: text.trim(),
          });
        }
      }
    }
    return found;
  }

  it('every `--flag` the skill writes after an `s1s <command>` is registered on that command', () => {
    const program = buildProgram();
    // The root options are accepted after any command; so is --help.
    const global = new Set(['--help', ...longFlagsOf(program)]);
    const unknown = new Set<string>();
    for (const invocation of invocations(program)) {
      const registered = longFlagsOf(invocation.command);
      for (const flag of invocation.flags) {
        if (global.has(flag) || registered.has(flag)) continue;
        unknown.add(`${invocation.file}: \`s1s ${invocation.name}\` has no ${flag} -- ${invocation.text}`);
      }
    }
    expect([...unknown].sort()).toEqual([]);
  });

  // The gap that shipped in W5 was a missing flag, not an unknown one: every
  // `--set` the skill wrote was spelled with registered flags and still aborted
  // with exit 2, because `applySet` demands `--yes` for a selection that covers
  // a whole locale. `--from <status>` does not excuse it - on a fresh project
  // every image is at `pending`, so `--from pending` still selects every row.
  // A mention with no `--locale` is prose about the command, not a command.
  const runnableSets = (program: Command): Invocation[] =>
    invocations(program).filter((i) => i.name === 'status' && i.flags.includes('--set') && i.flags.includes('--locale'));

  it('every runnable `s1s status --set` the skill writes carries --yes', () => {
    const refused = runnableSets(buildProgram())
      .filter((invocation) => !invocation.flags.includes('--yes'))
      .map((invocation) => `${invocation.file}: ${invocation.text}`);
    expect(refused.sort()).toEqual([]);
  });

  it('the --yes scan sees the `--set` commands the playbooks actually give', () => {
    const found = runnableSets(buildProgram());
    // Phase 5 (copy approval), phase 6 (image approval) and the upload verify
    // step each give one, in SKILL.md and in a reference beside it.
    expect(new Set(found.map((invocation) => invocation.file)).size).toBeGreaterThanOrEqual(4);
    for (const status of ['copy-approved', 'image-approved', 'uploaded']) {
      expect(found.some((invocation) => invocation.text.includes(`--set ${status}`)), `--set ${status}`).toBe(true);
    }
  });

  it('the flag scan resolves real commands and sees the flags the playbooks use', () => {
    const program = buildProgram();
    const registered = new Set(allCommands(program).map(fullName));
    const seen = new Map<string, Set<string>>();
    for (const invocation of invocations(program)) {
      const flags = seen.get(invocation.name) ?? new Set<string>();
      for (const flag of invocation.flags) flags.add(flag);
      seen.set(invocation.name, flags);
    }
    expect([...seen.keys()].filter((name) => !registered.has(name)).sort()).toEqual([]);
    for (const [name, flag] of [['render', '--allow-placeholder'], ['status', '--set'], ['sim list', '--json'], ['export', '--locale'], ['capture', '--udid']] as const) {
      expect(must(seen.get(name), `flags scanned for \`s1s ${name}\``), `\`s1s ${name}\``).toContain(flag);
    }
  });
});
