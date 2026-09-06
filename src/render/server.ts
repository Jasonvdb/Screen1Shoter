// Vite dev server wrapper. Root is the tool's src/web; the app project and
// the bezel cache are reached through fs.allow, virtual modules and the
// static middleware in vite-plugin-s1s.ts. Render mode is silent, watch-free
// and listens on an ephemeral port; dev mode keeps HMR and full-reloads on
// copy/capture/manifest changes.
import { realpath } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer, type Logger, type LogLevel, type ServerOptions, type ViteDevServer } from 'vite';
import { S1sError } from '../core/errors.ts';
import { toolRoot } from '../core/paths.ts';
import type { Project } from '../core/project.ts';
import { PROJECT_MODULE_IDS, s1sPlugin } from './vite-plugin-s1s.ts';

export interface S1sServerOptions {
  projectDir: string;
  bezelDir: string;
  mode: 'render' | 'dev';
  /** Render mode: the locale being rendered. Its captures are resolved for the browser even without a copy file. */
  locale?: string;
  /** Dev mode only; render mode always uses an ephemeral port. Default 5173. */
  port?: number;
  /** Default '127.0.0.1'. */
  host?: string;
  /** Dev mode: open /#/gallery in the default browser. */
  open?: boolean;
  /** Already-loaded project to serve in render mode (avoids a second import). */
  project?: Project;
  /** Test hook: Vite root. Default <tool>/src/web. */
  webRoot?: string;
}

export interface S1sServer {
  /** Origin with a trailing slash, e.g. 'http://127.0.0.1:51234/'. */
  url: string;
  port: number;
  close(): Promise<void>;
}

const REACT_DEPS = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

/** Everything Vite has to say goes to stderr so `--json` stdout stays clean. */
function stderrLogger(level: LogLevel): Logger {
  const rank: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3 };
  const threshold = rank[level];
  const seen = new Set<string>();
  const write = (kind: LogLevel, msg: string): void => {
    if (rank[kind] > threshold) return;
    process.stderr.write(`[vite] ${msg}\n`);
  };
  const logger: Logger = {
    hasWarned: false,
    info: (msg) => write('info', msg),
    warn: (msg) => {
      logger.hasWarned = true;
      write('warn', msg);
    },
    warnOnce: (msg) => {
      if (seen.has(msg)) return;
      seen.add(msg);
      logger.hasWarned = true;
      write('warn', msg);
    },
    error: (msg) => write('error', msg),
    clearScreen: () => {},
    hasErrorLogged: () => false,
  };
  return logger;
}

async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * Render mode: compile the project's entry modules once before any page
 * loads, so a syntax error in screens.ts / theme.ts / templates/index.ts
 * fails here as config-invalid instead of as a 90 s browser timeout.
 */
async function preflightProjectModules(server: ViteDevServer): Promise<void> {
  for (const id of PROJECT_MODULE_IDS) {
    try {
      await server.transformRequest(id);
    } catch (error) {
      // Rolldown colours its code frame; strip the ANSI codes for --json and logs.
      const message = (error instanceof Error ? error.message : String(error)).replace(/\[[0-9;]*m/g, '');
      throw new S1sError('config-invalid', `Vite cannot compile ${id}: ${message}`, {
        hint: 'Fix the file named above; custom templates may import only react and screen1shoter.',
      });
    }
  }
}

/** Allowed directories plus their real paths (pnpm and symlinked checkouts). */
async function fsAllow(tool: string, opts: S1sServerOptions): Promise<string[]> {
  const dirs = [tool, join(tool, 'node_modules'), opts.projectDir, opts.bezelDir];
  const all = await Promise.all(dirs.flatMap((dir) => [dir, realpathOrSelf(dir)]));
  return [...new Set(all)];
}

export async function createS1sServer(opts: S1sServerOptions): Promise<S1sServer> {
  const tool = toolRoot();
  const root = opts.webRoot ?? join(tool, 'src', 'web');
  const render = opts.mode === 'render';
  const host = opts.host ?? '127.0.0.1';
  const logLevel: LogLevel = render ? 'warn' : 'info';

  const serverOptions: ServerOptions = {
    host,
    port: render ? 0 : (opts.port ?? 5173),
    strictPort: render ? true : opts.port !== undefined,
    open: !render && opts.open === true ? '/#/gallery' : false,
    fs: { strict: true, allow: await fsAllow(tool, opts) },
  };
  if (render) {
    // Vite 8 always loads /@vite/client (CSS imports depend on it) and the
    // client always opens a WebSocket. Keeping the socket alive but watching
    // nothing gives a quiet, update-free page; hmr:false would only produce
    // connection errors in the page console.
    serverOptions.hmr = { overlay: false };
    serverOptions.watch = null;
    serverOptions.forwardConsole = false;
  } else {
    serverOptions.watch = {
      ignored: ['out', '.s1s', 'node_modules'].map((dir) => join(opts.projectDir, dir, '**')),
    };
  }

  const server = await createServer({
    configFile: false,
    root,
    base: '/',
    mode: 'development',
    appType: 'spa',
    // One cache per mode: the optimizeDeps config differs, and sharing a
    // cache would re-bundle React on every render <-> dev switch.
    cacheDir: join(tool, 'node_modules', '.vite', render ? 's1s-render' : 's1s-dev'),
    logLevel,
    customLogger: stderrLogger(logLevel),
    clearScreen: false,
    plugins: [react(), s1sPlugin(opts)],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        // Longest match first: a bare-string alias for 'screen1shoter' would
        // also swallow 'screen1shoter/config'.
        { find: /^screen1shoter\/config$/, replacement: join(tool, 'src', 'config', 'index.ts') },
        { find: /^screen1shoter$/, replacement: join(tool, 'src', 'runtime', 'index.ts') },
      ],
    },
    optimizeDeps: render ? { noDiscovery: true, include: REACT_DEPS } : { include: REACT_DEPS },
    server: serverOptions,
  });

  try {
    await server.listen();
    if (render) await preflightProjectModules(server);
  } catch (error) {
    await server.close().catch(() => {});
    throw error;
  }

  const address = server.httpServer?.address() as AddressInfo | string | null;
  const port = typeof address === 'object' && address !== null ? address.port : (opts.port ?? 0);
  const url = server.resolvedUrls?.local[0] ?? `http://${host}:${port}/`;
  return {
    url: url.endsWith('/') ? url : `${url}/`,
    port,
    close: () => server.close(),
  };
}
