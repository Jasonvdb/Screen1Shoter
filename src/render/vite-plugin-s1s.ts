// Vite plugin that connects the browser runtime to one app project:
//   - virtual:s1s-screens / -theme / -templates -> the project's TS files
//   - GET /__s1s/project.json                    -> ProjectJson (fonts/ included)
//   - /project/* and /bezels/*                   -> static files, no caching
//   - window.__S1S_MODE (+ animation kill switch in render mode) in index.html
//   - dev mode: full reload when copy, captures, fonts or the manifest change
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { HtmlTagDescriptor, Plugin, ViteDevServer } from 'vite';
import { ALL_SIZE_IDS, presetsFor } from '../config/presets.ts';
import type { BezelIndex, LocaleCopy, ProjectFont, ProjectJson } from '../config/types.ts';
import { captureMap, listCaptureLocales } from '../core/captures.ts';
import { listCopyLocales, loadCopy } from '../core/copy.ts';
import { isS1sError } from '../core/errors.ts';
import { findTemplatesEntry, loadProject, type Project } from '../core/project.ts';
import { FONT_EXTENSIONS, parseFontFile } from '../web/runtime/fonts.ts';
import type { S1sServerOptions } from './server.ts';

const VIRTUAL_FILES: Record<string, string> = {
  'virtual:s1s-screens': 'screens.ts',
  'virtual:s1s-theme': 'theme.ts',
};
const TEMPLATES_ID = 'virtual:s1s-templates';
const EMPTY_TEMPLATES_ID = `\0${TEMPLATES_ID}`;

/** Every project module the browser evaluates; render mode compiles them up front. */
export const PROJECT_MODULE_IDS: readonly string[] = [...Object.keys(VIRTUAL_FILES), TEMPLATES_ID];

/** Project sub-paths whose changes need a full reload in dev mode (Node re-reads them for project.json). */
const RELOAD_PATHS = ['copy', 'captures', 'fonts', 'assets', 'manifest.json', 'screens.ts', 'theme.ts'];

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

type Next = (err?: unknown) => void;

function log(message: string): void {
  process.stderr.write(`[s1s] ${message}\n`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isInside(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

function reply(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

/** Minimal static handler mounted with connect's `use(route, fn)`: req.url is the remainder. */
function serveDir(dir: string) {
  const root = resolve(dir);
  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', 'http://s1s.local').pathname);
    } catch {
      reply(res, 400, 'Bad request');
      return;
    }
    if (rel.includes('\0')) {
      reply(res, 400, 'Bad request');
      return;
    }
    const abs = resolve(root, `.${rel}`);
    if (!isInside(root, abs)) {
      reply(res, 403, 'Forbidden');
      return;
    }
    let size: number;
    try {
      const info = await stat(abs);
      if (!info.isFile()) throw new Error('not a file');
      size = info.size;
    } catch {
      reply(res, 404, 'Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(abs);
    stream.on('error', () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
  };
}

async function readBezelIndex(bezelDir: string): Promise<BezelIndex | null> {
  const path = join(bezelDir, 'index.json');
  if (!(await fileExists(path))) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version === 1) {
      return parsed as BezelIndex;
    }
    log(`ignoring ${path}: unexpected shape`);
  } catch (error) {
    log(`ignoring ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

/**
 * Font files directly under `<project>/fonts/`, sorted by name. A missing or
 * unreadable directory is simply "no project fonts", never an error: the
 * browser then keeps the theme's own stacks.
 */
export async function listProjectFonts(projectDir: string): Promise<ProjectFont[]> {
  let names: string[];
  try {
    const entries = await readdir(join(projectDir, 'fonts'), { withFileTypes: true });
    names = entries
      .filter((e) => e.isFile() && FONT_EXTENSIONS.includes(extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => parseFontFile(name) ?? []);
}

async function buildProjectJson(project: Project, opts: S1sServerOptions, bezelDir: string): Promise<ProjectJson> {
  const copyLocales = await listCopyLocales(project.dir);
  const copies: Record<string, LocaleCopy> = {};
  for (const locale of copyLocales) {
    try {
      copies[locale] = await loadCopy(project.dir, locale);
    } catch (error) {
      // A broken copy for another locale must not block this one; the render
      // locale itself was validated by renderProject / the CLI beforehand.
      log(`skipping copy/${locale}.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const requested = opts.locale === undefined ? [] : [opts.locale];
  const locales = [...new Set([...project.locales, ...copyLocales, ...requested])];
  // The browser resolves captures through this map only, so it must cover
  // every locale a render or gallery route can ask for: the configured and
  // copy locales, the requested render locale, and every locale that has a
  // captures/ or manifest entry. Node resolves the same way from disk.
  const captureLocales = [
    ...new Set([...locales, ...Object.keys(project.manifest.locales), ...(await listCaptureLocales(project.dir))]),
  ];
  return {
    version: 1,
    mode: opts.mode,
    projectDir: project.dir,
    sizes: project.sizes,
    locales,
    sourceLocale: project.sourceLocale,
    copies,
    manifest: project.manifest,
    // Every family, not just project.sizes: a `--sizes` override may render a
    // family the project does not list, and the map is keyed by family.
    captures: captureMap(project, captureLocales, presetsFor(ALL_SIZE_IDS)),
    bezels: await readBezelIndex(bezelDir),
    fonts: await listProjectFonts(project.dir),
  };
}

function headTags(mode: 'render' | 'dev'): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [
    { tag: 'script', children: `window.__S1S_MODE = ${JSON.stringify(mode)};`, injectTo: 'head-prepend' },
  ];
  if (mode === 'render') {
    tags.push({
      tag: 'style',
      attrs: { 'data-s1s-render': '' },
      children: '* { animation: none !important; transition: none !important; caret-color: transparent !important; }',
      injectTo: 'head',
    });
  }
  return tags;
}

function installReloadWatcher(server: ViteDevServer, projectDir: string): void {
  const watched = RELOAD_PATHS.map((p) => join(projectDir, p));
  server.watcher.add(projectDir);
  let timer: NodeJS.Timeout | null = null;
  const onChange = (file: string): void => {
    if (!watched.some((w) => isInside(w, file))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      log(`reload: ${file.slice(projectDir.length + 1)}`);
      server.ws.send({ type: 'full-reload', path: '*' });
    }, 100);
  };
  server.watcher.on('add', onChange);
  server.watcher.on('change', onChange);
  server.watcher.on('unlink', onChange);
}

export function s1sPlugin(opts: S1sServerOptions): Plugin {
  const projectDir = resolve(opts.projectDir);
  const bezelDir = resolve(opts.bezelDir);
  let cachedProject: Project | undefined = opts.project;

  const getProject = async (): Promise<Project> => {
    // Dev mode re-reads everything on every request, screens.ts / theme.ts
    // included (mtime-keyed re-import), so project.json matches what the
    // browser gets through Vite.
    if (opts.mode === 'dev') return loadProject({ projectDir, reload: true });
    cachedProject ??= await loadProject({ projectDir });
    return cachedProject;
  };

  return {
    name: 's1s',
    enforce: 'pre',

    resolveId(id) {
      const file = VIRTUAL_FILES[id];
      if (file !== undefined) return join(projectDir, file);
      if (id === TEMPLATES_ID) return findTemplatesEntry(projectDir) ?? EMPTY_TEMPLATES_ID;
      return null;
    },

    load(id) {
      if (id === EMPTY_TEMPLATES_ID) return 'export default [];\n';
      return null;
    },

    transformIndexHtml() {
      return headTags(opts.mode);
    },

    configureServer(server) {
      server.middlewares.use('/__s1s/project.json', (_req, res) => {
        getProject()
          .then((project) => buildProjectJson(project, opts, bezelDir))
          .then((json) => sendJson(res, 200, json))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            const code = isS1sError(error) ? error.code : 'render-failed';
            log(`project.json failed: ${message}`);
            sendJson(res, 500, { ok: false, error: { code, message } });
          });
      });
      server.middlewares.use('/project', (req, res, next) => {
        void serveDir(projectDir)(req, res, next);
      });
      server.middlewares.use('/bezels', (req, res, next) => {
        void serveDir(bezelDir)(req, res, next);
      });
      if (opts.mode === 'dev') installReloadWatcher(server, projectDir);
    },
  };
}
