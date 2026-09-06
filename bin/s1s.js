#!/usr/bin/env node
// ESM shim for the `s1s` CLI. Resolves its own real path (so a symlink such as
// ~/.local/bin/s1s -> <checkout>/bin/s1s.js still finds the checkout), then
// runs src/cli/main.ts through the checkout's own tsx. No build step.
//
// The child is spawned asynchronously and SIGINT/SIGTERM/SIGHUP are forwarded
// to it, so a signal sent to this shim alone (not the whole process group)
// still stops a long-running command such as `s1s dev`.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
const require = createRequire(join(root, 'package.json'));

let tsxCli;
try {
  tsxCli = require.resolve('tsx/cli');
} catch {
  console.error(`s1s: tsx is not installed. Run \`pnpm install\` in ${root}`);
  process.exit(1);
}

const main = join(root, 'src', 'cli', 'main.ts');
const child = spawn(process.execPath, [tsxCli, main, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, S1S_ROOT: root },
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error(`s1s: failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (status, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(status ?? 1);
});
