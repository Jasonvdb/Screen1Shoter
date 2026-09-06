// `s1s dev`: Vite dev server with HMR and the gallery page. Prints the URL
// (JSON in --json mode) and stays up until SIGINT/SIGTERM.
import type { Command } from 'commander';
import { run } from '../../core/exec.ts';
import { bezelDir } from '../../core/paths.ts';
import { createS1sServer, type S1sServerOptions } from '../../render/server.ts';
import { emit, emitError, globalsOf, log, parsePositiveInt } from '../output.ts';
import { openProject } from './link.ts';

interface DevOptions {
  locale?: string;
  port?: number;
  open?: boolean;
}

export function galleryUrl(serverUrl: string, locale?: string): string {
  const base = serverUrl.replace(/\/$/, '');
  return `${base}/#/gallery${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`;
}

function waitForShutdown(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => resolve(signal));
  });
}

async function devCommand(opts: DevOptions, cmd: Command): Promise<void> {
  const globals = globalsOf(cmd);
  const json = globals.json ?? false;
  try {
    const project = await openProject(globals);
    const serverOpts: S1sServerOptions = { projectDir: project.dir, bezelDir: bezelDir(), mode: 'dev' };
    if (opts.port !== undefined) serverOpts.port = opts.port;
    const server = await createS1sServer(serverOpts);
    const url = galleryUrl(server.url, opts.locale ?? project.sourceLocale);
    emit(
      {
        data: { url, port: server.port, projectDir: project.dir },
        text: `Gallery: ${url}\nProject: ${project.dir}\nPress Ctrl+C to stop.`,
      },
      { json },
    );
    if (opts.open === true) {
      await run('open', [url]).catch((err: unknown) => log(`could not open the browser: ${err instanceof Error ? err.message : String(err)}`));
    }
    const signal = await waitForShutdown();
    log(`${signal}: stopping the dev server`);
    await server.close();
  } catch (err) {
    process.exitCode = emitError(err, { json });
  }
}

export function registerDev(program: Command): void {
  program
    .command('dev')
    .description('Start the Vite dev server with the gallery (every screen x size, HMR)')
    .option('--locale <locale>', 'locale to show first (default: the source locale)')
    .option('--port <n>', 'port (default: Vite picks 5173 or the next free port)', parsePositiveInt)
    .option('--open', 'open the gallery in the default browser')
    .action((opts: DevOptions, cmd: Command) => devCommand(opts, cmd));
}
