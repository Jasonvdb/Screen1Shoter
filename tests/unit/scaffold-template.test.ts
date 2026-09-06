// The custom-template example quoted in the scaffold (templates/init and
// example/) must be the type-checked file tests/fixtures/scaffold-template.tsx,
// line for line, so the comment can never document props that do not exist.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../fixtures/helpers.ts';

const SCAFFOLDS = ['templates/init/templates/index.ts', 'example/screenshots/templates/index.ts'];

/** The example: every `//   ` comment line between the intro and the real code. */
function quotedExample(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => line.startsWith('//   ') || line === '//')
    .map((line) => line.replace(/^\/\/ {0,3}/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .split('\n');
}

/** The fixture without its leading comment block. */
function fixtureBody(source: string): string[] {
  return source.replace(/^(\/\/.*\n)+/, '').trimEnd().split('\n');
}

describe('scaffold template example', () => {
  it('matches tests/fixtures/scaffold-template.tsx in both scaffolds', async () => {
    const fixture = fixtureBody(await readFile(join(REPO_ROOT, 'tests', 'fixtures', 'scaffold-template.tsx'), 'utf8'));
    expect(fixture[0]).toContain("from 'screen1shoter'");
    expect(fixture.some((line) => line.includes('<DeviceFrame captures={screen.captures}'))).toBe(true);
    for (const rel of SCAFFOLDS) {
      const quoted = quotedExample(await readFile(join(REPO_ROOT, rel), 'utf8'));
      expect(quoted, rel).toEqual(fixture);
    }
  });
});
