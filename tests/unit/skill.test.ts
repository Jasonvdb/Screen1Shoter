// Static invariants of the agent skill (AGENTS.md "Skill rules"). The skill
// is a product, so its shape is enforced by `pnpm check`, not by a pre-commit
// habit: frontmatter parses and is complete, the description fits the
// 1000-character budget, SKILL.md's body stays under the 500-line cap, every
// linked reference exists, no emoji or co-author text creeps in, and every
// `s1s <command>` the skill names is registered in the CLI.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../fixtures/helpers.ts';

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
});
