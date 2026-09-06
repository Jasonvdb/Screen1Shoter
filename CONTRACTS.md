# Screen1Shoter contracts (W1 Stage A, extended in W2)

This file is the boundary the five Stage B implementers build against. The
files listed under "Frozen" exist and type-check; everything else is described
by signature only. Do not change a frozen signature. If you must, write the
change and the reason in your `notesForIntegrator` and keep your code compiling
against the frozen version.

Plan: `~/.claude/plans/i-want-to-build-transient-rabbit.md` (Part A, W1).

## 0. Ground rules

- Node 24, pnpm 10.33, ESM, TypeScript 7.0.2 strict (`tsconfig.base.json`:
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`).
- No build step. Node code runs from source through tsx (`bin/s1s.js`);
  browser code is served by Vite; tests run through Vitest. Per call: a
  long-running `s1s dev` holds the Node modules it started with, so changing
  `src/` needs a restart before that server agrees with it.
- Exact pins only. `playwright 1.62.1` is fixed (matches the cached
  `chromium-1234`); do not bump it.
- Design unit: CSS px = Apple points. Playwright `viewport = preset.pt`,
  `deviceScaleFactor = preset.scale`, `screenshot({ scale: 'device' })`.
  Output PNG must be exactly `preset.px`, 3 channels, no alpha.
- Plain functions over classes (the one class is `S1sError`). Small files.
- Every CLI command supports `--json`.
- `node --version` here is v24.15.0; `tsx` also runs the CLI, so no
  `import.meta.dirname` polyfills are needed.

## 1. Import-extension convention

Relative imports inside this repo always carry the `.ts` (or `.tsx`) extension:

```ts
import { getPreset } from '../config/presets.ts';
import { Canvas } from '../components/Canvas.tsx';
import type { Theme } from '../config/types.ts';
```

- tsc: allowed by `allowImportingTsExtensions` (we never emit).
- Runtime: tsx, Vite, Vitest and Node 24's own type stripping all resolve
  `.ts` specifiers as written. No `.js`-rewriting anywhere.
- Type-only imports must use `import type` (`verbatimModuleSyntax`).
- Package self-references and app projects use the package name:
  `import { defineScreens } from 'screen1shoter/config'` (browser templates:
  `from 'screen1shoter'`). `package.json#exports` maps both to `.ts` sources.
- Tests import sources relatively: `import { presetsFor } from
  '../../src/config/presets.ts'`. Never import through `dist/` (there is none).

## 2. Repo layout and scripts

```
package.json            scripts: typecheck, test (unit), test:smoke, check, link-cli, s1s
pnpm-workspace.yaml     onlyBuiltDependencies: [esbuild, sharp]
tsconfig.base.json      shared strict options
tsconfig.json           Node side: src/cli src/core src/render src/config tests vitest.config.ts
tsconfig.web.json       browser side: src/web src/runtime src/config (DOM, react-jsx, Bundler)
vitest.config.ts        projects "unit" (tests/unit/**/*.test.ts) and "smoke" (tests/smoke/**/*.smoke.test.ts, 300 s timeouts)
bin/s1s.js              shim: realpath -> async spawn node <tsx/cli> src/cli/main.ts argv; sets S1S_ROOT=<checkout>; forwards SIGINT/SIGTERM/SIGHUP to the child
src/config/             FROZEN: types.ts presets.ts resolve.ts template-meta.ts warnings.ts index.ts
src/core/errors.ts      FROZEN: S1sError
src/runtime/index.ts    stub re-exporting src/config (web implementer extends)
src/web/s1s-globals.d.ts virtual modules + window globals (web implementer may narrow)
```

`pnpm check` = both tsc configs + unit tests. `pnpm test:smoke` runs the
Playwright smoke test. `pnpm s1s -- <args>` runs the CLI from the checkout.

## 3. `src/config` (frozen) — what you can rely on

Exports (all from `src/config/index.ts`, also `screen1shoter/config`):

types.ts
: `DeviceFamily`, `SizeId`, `AppDisplayType`, `Dims`, `Rect`, `SizePreset`,
  `CaptureRef`, `CaptureSpec`, `ScreenOverride`, `ScreenDef`, `PanoramaConfig`,
  `ScreensConfig`, `defineScreens`, `HeadlineCase`, `ThemeFonts`, `Theme`,
  `ThemeInput`, `defineTheme`, `DEFAULT_HEADLINE_FONT`, `DEFAULT_BODY_FONT`,
  `PORTABLE_FONT`, `CalloutCopy`, `ScreenCopy`, `LocaleCopy`,
  `CaptureFallback`, `CaptureSource`, `CaptureResolver`, `ResolvedScreen`,
  `BezelEntry`, `BezelIndex`, `WarningCode`, `WarningLevel`, `Warning`,
  `RenderOutput`, `RenderItem`, `RenderItemStatus`, `RenderReportItem`
  (`error?: string` on failed items, added in Stage C), `RenderReport`, `ImageStatus`, `IMAGE_STATUSES`, `CaptureRating`,
  `ManifestApp`, `ManifestSize`, `ManifestDemoData`, `ManifestCapturePlan`,
  `ManifestScreen`, `ImageState`, `ManifestLocaleDevice`, `CopyStatus`,
  `ManifestLocale`, `ManifestRun`, `ProjectManifest`, `ProjectJson`.

presets.ts
: `SIZE_PRESETS`, `ALL_SIZE_IDS`, `DEFAULT_SIZES` (`iphone-6.9`, `ipad-13`),
  `isSizeId`, `getPreset` (throws on unknown), `presetsFor(ids?)`
  (default sizes when empty; de-duplicated; aliases kept), `presetsByFamily`,
  `renderTarget(preset)` (follows `aliasOf`), `displayFolder(preset)`,
  `dimsEqual`, `formatDims`, `isAcceptedDims`, `presetByDisplayType`,
  `acceptedDimsForDisplayType` (covers legacy folders such as
  `APP_IPAD_PRO_129`), `displayTypesShareDims` (the duplicate-dims rule,
  used by both `s1s export` and `s1s validate`).

panorama.ts
: `PanoramaSlice`, `PanoramaBackground`, `panoramaOrder(config)` (the screen
  ids that share the panorama, in order; every screen when `panorama.screens`
  is absent), `panoramaSlice(config, screenId)` (null when the screen takes
  no slice), `panoramaBackground(slice)` (the `props.background` value).

resolve.ts
: `screenAppliesTo(screen, preset)`, `ResolveOptions`, `resolveScreen(screen,
  preset, locale, copy, captureResolver, opts?)` — `opts.config` passes the
  whole `ScreensConfig` so a project-level `panorama` is cut into this
  screen's slice and injected into `props.background`; an explicit
  `props.background` wins. Callers that only probe (capture planning,
  template checks) omit it. `CAPTURE_REF_RE`, `CaptureRefParts`,
  `parseCaptureRef(ref)`, `captureRefPreset(ref, preset)`,
  `captureKey(locale, family, ref)`,
  `captureRelPath(locale, family, ref)` (both drop a size prefix, so two refs
  naming one file share a key and a path), `formatOrdinal(n)` ('01'),
  `renderFileName(n, id)` ('01-home.png'), `exportFileName(n)` ('01.png'),
  `EXPORT_FILE_RE` / `exportOrdinal(name)` (the one matcher for a set file,
  shared by `--prune` and `s1s validate`),
  `renderRoute(locale, sizeId, screenId)`, `sheetRoute(locale, sizeId)`.

template-meta.ts
: `TemplateMeta` (`captures?` = captures a screen must list, `callouts?` =
  most `copy.callouts` shown; `loadProject` rejects a wrong capture count,
  the renderer and the browser flag extra callouts as `overflow` on
  `[data-s1s-id="callouts"]`), `BUILTIN_TEMPLATES`, `DEFAULT_TEMPLATE`
  (iphone/ipad `hero-top-text`, watch `raw`), `templateMeta(id)`,
  `isBuiltinTemplate(id)`.

warnings.ts
: `WARNING_LEVELS` (default level per code), `makeWarning(code, message,
  element?)`, `promoteWarnings(warnings, strict)`, `hasErrors`, `countByLevel`.

Presets (verified against `asc screenshots sizes --all`):

| id | family | displayType | token | px | pt @ scale | capture sim | notes |
|---|---|---|---|---|---|---|---|
| iphone-6.9 | iphone | APP_IPHONE_69 | IPHONE_69 | 1320x2868 | 440x956 @3 | iPhone 17 Pro Max | default |
| iphone-6.7 | iphone | APP_IPHONE_67 | IPHONE_67 | 1320x2868 | 440x956 @3 | iPhone 17 Pro Max | aliasOf iphone-6.9 |
| iphone-6.5 | iphone | APP_IPHONE_65 | IPHONE_65 | 1284x2778 | 428x926 @3 | iPhone 14 Plus | |
| iphone-6.1 | iphone | APP_IPHONE_61 | IPHONE_61 | 1206x2622 | 402x874 @3 | iPhone 17 Pro | |
| ipad-13 | ipad | APP_IPAD_PRO_3GEN_129 | IPAD_PRO_3GEN_129 | 2064x2752 | 1032x1376 @2 | iPad Pro 13-inch (M5) | default |
| ipad-11 | ipad | APP_IPAD_PRO_3GEN_11 | IPAD_PRO_3GEN_11 | 1668x2420 | 834x1210 @2 | iPad Pro 11-inch (M5) | |
| watch-s10 | watch | APP_WATCH_SERIES_10 | WATCH_SERIES_10 | 416x496 | 416x496 @1 | Apple Watch Series 11 (46mm) | passthrough |

Resolution order in `resolveScreen`: base < `overrides[family]` <
`overrides[sizeId]` < `locales[locale]`. `template` and `capture` replace;
`props` shallow-merge. Default capture is `[screen.id]`. `copy` is
`copy.screens[copyKey ?? id]` or `undefined` (renderer emits `copy-missing`).
Aliases render once as `renderTarget(preset)`; overrides keyed by an alias id
are therefore never consulted.

`CaptureSource.resolvedPath` is project-relative posix
(`captures/<usedLocale>/<family>/<ref>.png`) or `null` for a placeholder.
Node joins it with `project.dir`; the browser loads `/project/<resolvedPath>`.

Screen config files: `screens.ts` -> `export default defineScreens({...})`,
`theme.ts` -> `export default defineTheme({...})`,
`templates/index.ts` or `templates/index.tsx` (optional, `TEMPLATE_ENTRIES` in
`src/core/project.ts`) -> `export default [ ...TemplateModule ]`.

## 4. Node API (implementer 1: core; implementer 2: render)

All paths absolute unless stated. All async functions return Promises. Throw
`S1sError` (`src/core/errors.ts`) for expected failures; never `process.exit`
outside `src/cli`.

### src/core/project.ts
```ts
export interface Project {
  dir: string;                 // <app>/screenshots
  appDir: string;              // dirname(dir)
  screensPath: string;         // dir/screens.ts
  themePath: string;           // dir/theme.ts
  manifestPath: string;        // dir/manifest.json
  templatesPath: string | null;// first existing TEMPLATE_ENTRIES file (index.ts / index.tsx)
  screens: ScreensConfig;
  theme: Theme;
  manifest: ProjectManifest;
  sizes: SizeId[];             // screens.sizes ?? DEFAULT_SIZES
  locales: string[];           // screens.locales ?? ['en-US']
  sourceLocale: string;        // manifest.app.sourceLocale ?? locales[0]
  copyFor(locale: string): Promise<LocaleCopy>;  // cached; S1sError('copy-missing')
  copyPath(locale: string): string;              // dir/copy/<locale>.json
}
export function findProjectDir(cwd: string): string | null;
  // cwd itself if it holds screens.ts; else cwd/screenshots; else walk up
  // checking <ancestor>/screenshots/screens.ts. null when nothing found.
export async function loadProject(opts?: { cwd?: string; projectDir?: string }): Promise<Project>;
  // imports screens.ts/theme.ts via dynamic import (tsx/Vitest transform .ts),
  // zod-validates ScreensConfig, Theme and the manifest.
```

### src/core/manifest.ts
```ts
export function emptyManifest(app: ManifestApp): ProjectManifest;
export async function readManifest(path: string): Promise<ProjectManifest>;   // zod; S1sError('manifest-invalid')
export async function writeManifest(path: string, manifest: ProjectManifest): Promise<void>; // atomic, 2-space JSON, trailing newline
export function imageState(m: ProjectManifest, locale: string, sizeId: SizeId, screenId: string): ImageState | undefined;
export function updateImage(m: ProjectManifest, ref: { locale: string; sizeId: SizeId; screenId: string }, patch: Partial<ImageState>, opts?: { drop?: readonly DroppableImageField[] }): ProjectManifest; // drop removes fields (a failed render clears render/renderHash/renderedAt)
  // returns a new manifest; creates locale/device/screen nodes (status 'pending') as needed
export function canTransition(from: ImageStatus, to: ImageStatus): boolean;   // forward one or more steps, or back to 'pending'/'captured'/'generated'
export function appendRun(m: ProjectManifest, run: ManifestRun): ProjectManifest; // keeps the newest MAX_MANIFEST_RUNS (50)
export const MAX_MANIFEST_RUNS: number;
export const manifestSchema: z.ZodType<ProjectManifest>;
```
Render bookkeeping rule (render.ts calls `updateImage`): on hash change set
`render`, `renderHash`, `renderedAt`, `renderWarnings`, status `generated`
(and `wasUploaded: true` if the previous status was `uploaded`); on an
unchanged hash keep the status.

### src/core/copy.ts
```ts
export function copyPath(projectDir: string, locale: string): string;
export async function loadCopy(projectDir: string, locale: string): Promise<LocaleCopy>;   // zod; S1sError('copy-missing' | 'copy-invalid')
export async function listCopyLocales(projectDir: string): Promise<string[]>;
export function unusedCopyKeys(copy: LocaleCopy, screens: ScreensConfig): string[];       // -> 'copy-unused' warnings
export const localeCopySchema: z.ZodType<LocaleCopy>;
```

### src/core/captures.ts
```ts
export function readPngDims(path: string): Dims | null;   // sync IHDR parse, null if missing/not PNG
export function resolveCapture(project: Project, ref: CaptureRef, preset: SizePreset, locale: string): CaptureSource;
  // 1) manifest.locales[locale].captureSource === 'reuse:<l>' -> look in <l>, fallback 'reuse'
  // 2) captures/<locale>/<family>/<ref>.png            -> fallback 'none'
  // 3) captures/<sourceLocale>/<family>/<ref>.png      -> 'source-locale'
  // 4) none                                            -> 'placeholder', resolvedPath null, dims null
export function captureResolverFor(project: Project): CaptureResolver;
export function captureMap(project: Project, locales: string[], presets: SizePreset[]): Record<string, CaptureSource>; // keyed by captureKey()
export function captureWarnings(source: CaptureSource, preset: SizePreset, opts: { allowPlaceholder: boolean }): Warning[];
  // capture-missing (error; warn with allowPlaceholder; element = missingCaptureElement(ref)),
  // capture-fallback-locale: info for fallback 'reuse' (the author asked for those pixels),
  //   warn for 'source-locale' (nobody asked; the locale silently shipped English UI),
  // capture-dims via captureDimsWarning(): warn when the aspect matches within 1% (resampled), error otherwise (names the simulator)
```
Note: the task brief wrote `resolveCapture(project, screen, preset, locale)`;
the contract takes a single `CaptureRef` because a screen may reference
several captures (`two-device`). `resolveScreen` maps every ref through it.

**Cross-size capture refs (W7).** A `CaptureRef` is a file-safe name, optionally
prefixed with a size: `'watch-s10:watch-lap'`. `resolveScreen` resolves each ref
against `captureRefPreset(ref, preset)` rather than the preset being rendered,
so the prefix decides both the family directory the file is read from and the
dimensions `captureWarnings` checks it against; `render.ts` passes the same
preset to `captureWarnings`. Without this a watch capture on an iPhone canvas
would be looked for at `captures/<l>/iphone/watch-lap.png` and, if found, fail
the 1320x2868 check. `parseCaptureRef` reports `unknownSize: true` for a prefix
that names no preset and `screenDefSchema` refuses it, so a typo is a
`screens.ts` error rather than part of a file name. `phone-watch` is the only
built-in that needs it.

### src/core/matrix.ts
```ts
export interface MatrixOptions { locale: string; sizes?: string[]; screens?: string[] /* ids or ordinals '3' */; }
export function buildMatrix(project: Project, opts: MatrixOptions): RenderItem[];
  // presets = presetsFor(opts.sizes ?? project.sizes); group aliases under renderTarget();
  // per render preset: screens filtered by screenAppliesTo, ordinal = 1-based position in that filtered list;
  // item.outputs has one RenderOutput per requested size sharing the render target;
  // item.url = renderRoute(locale, preset.id, screen.id);
  // passthrough = isPassthroughItem(target, resolved.template, project.templatesPath !== null),
  //   i.e. preset.passthrough && template === 'raw' && the project ships no templates/index.ts.
  //   Only `raw` draws nothing, so only `raw` may skip the browser; a project template may
  //   replace the built-in `raw` id and Node cannot evaluate that file, so any project with
  //   its own templates takes the browser path on the watch too.
export function isPassthroughItem(preset: SizePreset, templateId: string, hasProjectTemplates: boolean): boolean;
```

### src/core/paths.ts
```ts
export const S1S_HOME: string;                                   // process.env.S1S_HOME ?? ~/.screen1shoter
export function toolRoot(): string;                              // checkout root (S1S_ROOT env or from import.meta.url)
export function bezelDir(): string;                              // S1S_HOME/bezels
export function dmgDir(): string;                                // S1S_HOME/dmg
export function outDir(project: Project, locale: string): string;                         // dir/out/<locale>
export function sizeOutDir(project: Project, locale: string, displayType: AppDisplayType): string; // out/<locale>/<displayType>
export function previewDir(project: Project, locale: string, displayType: AppDisplayType): string; // out/<locale>/<displayType>/preview
export function reportPath(project: Project, locale: string): string;    // out/<locale>/report.json
export function reviewPath(project: Project, locale: string): string;    // out/<locale>/review.md
export function sheetPath(project: Project, locale: string, sizeId: SizeId): string; // out/<locale>/sheet-<sizeId>.png
export function capturePath(project: Project, locale: string, family: DeviceFamily, ref: CaptureRef): string;
export function metadataDir(project: Project): string;           // appDir/<manifest.app.metadataDir>
export function exportDir(metadataRoot: string, locale: string, displayType: AppDisplayType): string; // <root>/<locale>/<APP_DISPLAY_TYPE>
export function toPosix(path: string): string;                   // the one spelling manifest paths are written in
export function assertLocaleSegment(locale: string): void;       // S1sError('usage') on '', '.', '..' or any separator
```

`assertLocaleSegment` is the one guard every command that joins `--locale`
onto the export root calls first (`s1s export`, `s1s validate`): `--locale
../../shared` would otherwise resolve out of the root, where `s1s export
--prune` deletes what it finds.

### src/core/exec.ts and src/core/sim.ts
```ts
export interface RunResult { code: number; stdout: string; stderr: string }
export async function run(cmd: string, args: string[], opts?: { stdin?: string; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<RunResult>;
export async function runOk(cmd: string, args: string[], opts?: ...): Promise<RunResult>;   // S1sError('tool-missing' | 'sim-failed') on ENOENT / non-zero
export async function which(cmd: string): Promise<string | null>;
export function formatCommand(cmd: string, args: readonly string[]): string; // the one shell-safe rendering, used by messages and by the commands `s1s export` prints

export interface SimDevice { udid: string; name: string; state: string; runtime: string; isAvailable: boolean; platform: 'iOS' | 'watchOS' | 'other' }
export async function listSims(): Promise<SimDevice[]>;                       // xcrun simctl list devices --json
export async function findSim(nameOrUdid: string): Promise<SimDevice>;         // exact udid, else exact name among booted first
export async function statusBar(udid: string, opts: { time?: string; clear?: boolean }): Promise<{ supported: boolean }>; // watchOS -> supported false, no throw
export async function appearance(udid: string, mode: 'light' | 'dark'): Promise<void>;
export async function screenshot(udid: string, outPath: string): Promise<Dims>;  // xcrun simctl io <udid> screenshot --type png
```

`formatCommand` quotes by allowlist (`[A-Za-z0-9_@%+=:,./-]`), not by a
blocklist of shell metacharacters. `s1s export` prints commands the user
pastes into a shell, and a placeholder such as `<APP_ID>` must come out as
`'<APP_ID>'` or the paste reads it as a redirection.

### src/render/server.ts and src/render/vite-plugin-s1s.ts
```ts
export interface S1sServerOptions { projectDir: string; bezelDir: string; mode: 'render' | 'dev'; locale?: string; port?: number; host?: string; open?: boolean }
// render mode compiles virtual:s1s-screens/-theme/-templates up front (config-invalid on a syntax error); `locale` joins the capture map
export interface S1sServer { url: string; port: number; close(): Promise<void> }
export async function createS1sServer(opts: S1sServerOptions): Promise<S1sServer>;
  // Vite root = <tool>/src/web; server.fs.allow = [toolRoot, projectDir, bezelDir];
  // render mode: hmr { overlay: false }, watch null, forwardConsole false (Vite 8 always injects /@vite/client, so `hmr: false` floods the page console);
  //   optimizeDeps { noDiscovery: true, include: ['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime'] }; separate cacheDir per mode.
  // resolve.dedupe ['react','react-dom']; alias 'screen1shoter' -> <tool>/src/runtime/index.ts, 'screen1shoter/config' -> <tool>/src/config/index.ts.
export function s1sPlugin(opts: S1sServerOptions): Plugin;   // virtual modules, /__s1s/project.json, /project/*, /bezels/*, __S1S_MODE injection, full-reload watcher (dev)
```

### src/render/browser.ts, render.ts, post.ts, review.ts
```ts
export const CHROMIUM_ARGS: string[]; // --force-color-profile=srgb --disable-lcd-text --font-render-hinting=none --hide-scrollbars
export async function launchBrowser(): Promise<Browser>;
export async function contextFor(browser: Browser, preset: SizePreset): Promise<BrowserContext>; // viewport pt, DSF scale, reducedMotion, clock 09:41, seeded Math.random via addInitScript

export interface RenderOptions {
  locale: string; sizes?: string[]; screens?: string[]; jobs?: number /* 4 */;
  dryRun?: boolean; sheet?: boolean /* true */; strict?: boolean; allowPlaceholder?: boolean;
  serverUrl?: string;          // reuse a running server (tests / dev)
  onProgress?: (item: RenderReportItem) => void;
}
export async function renderProject(project: Project, opts: RenderOptions): Promise<RenderReport>;
  // writes PNGs, previews, report.json, review.md, contact sheets (sheet.ts, unless sheet === false), updates manifest via updateImage + writeManifest.
  // per item: goto url -> waitForFunction(() => window.__S1S_READY) -> warnings = [...node warnings, ...await page.evaluate(() => window.__S1S.check())]
  //   -> screenshot({ scale: 'device', animations: 'disabled', fullPage: false }) -> postProcess -> write every output -> writePreview.

export async function postProcess(buffer: Buffer, preset: SizePreset, theme: Theme): Promise<{ png: Buffer; hash: string; dims: Dims }>;
  // sharp metadata must equal preset.px else S1sError('dims-mismatch'); flatten({ background: theme.background }).removeAlpha().png(); assert channels === 3; hash = sha1 hex
export async function writePreview(png: Buffer, previewPath: string, scale?: number /* 1/3 */): Promise<void>;

export function reviewMarkdown(project: Project, report: RenderReport): string;
export async function writeReview(project: Project, report: RenderReport): Promise<string>; // returns reviewPath
```

### src/core/reconcile.ts (W5)
```ts
export type FileState = 'present' | 'missing' | 'none';   // 'none' = not expected
export interface ReconcileRow { locale; sizeId; displayType; screenId; ordinal /* 0 = orphan */; status; capture: FileState; render: FileState; export: FileState; renderStale: boolean; notes: string[] }
export interface ReconcileReport { version: 1; generatedAt; locales; rows; orphans: ReconcileRow[]; strayExports: string[]; summary: Record<string, number>; ok: boolean }
export interface ReconcileOptions { locale?: string; sizes?: string[]; screens?: string[] }
export const STORE_NOT_CONSULTED: string;                 // the note every 'uploaded' row carries
export async function reconcile(project: Project, opts?: ReconcileOptions): Promise<ReconcileReport>;
export interface ImageRef { locale: string; sizeId: SizeId; screenId: string }
export interface SetStatusOptions { now?: string }   // the ISO time 'uploaded' records; injectable for tests
export function setStatus(manifest: ProjectManifest, refs: readonly ImageRef[], target: ImageStatus, opts?: SetStatusOptions): ProjectManifest;
  // pure; checks canTransition for every ref before applying any, else S1sError('usage') naming each row
  // target 'uploaded' also writes uploadedAt (one timestamp for the call) and drops wasUploaded
```
Local only: App Store Connect is authoritative for shipped state, so nothing
here talks to the network. `render` is compared by sha1 (`renderHash`); a
manifest `capture`/`render`/`export` path is always resolved against
`project.dir`. Orphans (manifest entries whose screen or size left
`screens.ts`) are reported but do not flip `ok`, and `--sizes`/`--screens`
narrowing never manufactures one.

### src/render/export.ts (W5)
```ts
export type ExportAction = 'written' | 'unchanged' | 'skipped';  // 'skipped' is reserved; the rules never produce it
export interface ExportFile { sizeId; displayType; screenId; ordinal; from; to; sha256; action }
export interface ExportOptions { locale: string; sizes?: string[]; metadataDir?: string; prune?: boolean; dryRun?: boolean; asc?: boolean /* true */; onProgress?: (file: ExportFile) => void }
export interface ExportReport { version: 1; generatedAt; locale; metadataDir; sizes; dryRun; files; pruned: string[]; stale: string[]; warnings: Warning[]; asc: AscValidateResult[] | null; uploadCommands: string[]; fanOutCommands: string[]; ok: boolean }
export async function exportProject(project: Project, opts: ExportOptions): Promise<ExportReport>;
export function applyExportManifest(project, locale, files): ProjectManifest;  // pure; status 'exported' where canTransition allows, else 'uploaded' + wasUploaded: true when the store copy is repointed
```
`out/<locale>/report.json` is the only source of truth for what exists, so an
alias size lands in both display-type folders without re-deriving anything.
The run is refused (`export-blocked`) on a failed item, an error-level
warning, a missing PNG or a dry-run render report. `--prune` deletes every
`EXPORT_FILE_RE` name in the folder this run did not write (a leftover
ordinal, a `00.png`, the same ordinal in another extension); dot-files, other
names and subfolders are left alone. Without `--prune` those same files are
reported in `stale`, because they still upload. `report.asc` holds one result
per display type in the order the display types appear in `files`.
`uploadCommands` is the per-localization form of asc-upload.md section 7 (one
`--path` folder per display type, every command `--dry-run`, never
`--replace`); `fanOutCommands` is the section 8 form and is empty when this
run warned about `duplicate-dims`.

### src/render/validate.ts (W5)
```ts
export type ValidateCode = 'file-name' | 'file-gap' | 'set-empty' | 'set-too-many' | 'dims-unaccepted' | 'dims-mixed' | 'has-alpha' | 'not-an-image' | 'locale-incomplete' | 'duplicate-dims';
export interface ValidateProblem { code: ValidateCode; level: 'warn' | 'error'; message: string; file?: string; scope?: 'tree' /* found by a cross-locale rule; may name a locale outside --locale */ }
export interface ValidateSet { locale; displayType; dir; files: string[]; count; dims: Dims | null; problems }
export interface ValidateOptions { metadataDir?: string; locale?: string /* narrows the report, never the cross-locale rule */; sizes?: string[] }
export interface ValidateReport { version: 1; generatedAt; metadataDir; locales /* reported in detail */; scanned /* every locale folder found */; sets; problems; ok }
export const MIN_SET_FILES = 1, MAX_SET_FILES = 10;
export async function validateExport(project: Project, opts?: ValidateOptions): Promise<ValidateReport>;
export function duplicateDimsMessage(locale, a, b, dims): string;  // shared with export.ts
```
Offline; pixel size and alpha always come from `sharp`, never from the file
name. Problems are collected, never thrown: it throws only `validate-failed`
(unreadable directory) and `usage` (unknown size id). Dot-files are skipped
everywhere. `locale-incomplete` is an error for a missing display type and a
warn for a differing file count; `duplicate-dims` is a warn. A file that is
not RGB/sRGB is a warn-level `not-an-image` (the code doubles as the
colour-space check; an unreadable file is the error-level form).
`--locale` narrows `locales`, the sets and their per-file problems only: the
all-or-nothing rule always compares every folder in `scanned`, reading a
sibling's folder names and file counts without opening a pixel, and marks
what it finds `scope: 'tree'`.

### src/cli (implementer 4)
- `src/cli/main.ts` parses argv and is the target of `bin/s1s.js`;
  `src/cli/program.ts` builds the commander program (`buildProgram()`,
  `allCommands()`). `process.env.S1S_ROOT` is the checkout root.
- Every command registers its action with `defineAction` (or `defineRawAction`
  for `s1s dev`, which owns its own output) from `src/cli/output.ts`. Commander
  calls an action handler as `(...positionalArgs, options, command)`, so a
  hand-written callback with one parameter too few silently receives the
  options object where it expects the Command; `defineAction` closes over the
  command and reads `args`/`opts`/`globals` off it instead. Never call
  `.action()` directly (tests/unit/cli-actions.test.ts enforces this).
- `src/cli/output.ts`: `emit(result, { json })` prints one JSON object
  (`{ ok: true, ...data }`) to stdout in `--json` mode, human text otherwise.
  Progress and logs go to stderr. Errors: `{ ok: false, error: { code,
  message, hint } }`, exit `S1sError.exitCode` (1 failure, 2 usage).
- Exit codes: 0 ok; 1 failure or error-level warnings; 2 usage.
- Commands: `init`, `link [--cli]`, `doctor`, `dev`, `render`, `sheet`,
  `capture`, `sim list|status-bar|appearance`, `bezels inspect|install|list`,
  `status`, `export`, `validate`. All are real; there is no stub mechanism.
  `status.ts`, `export.ts` and `validate.ts` also export their text renderer
  (`statusText`, `exportText`, `validateText`) so tests can pin the output.
- `link --cli` creates `~/.local/bin/s1s -> <S1S_ROOT>/bin/s1s.js`
  (replace an existing symlink, refuse to clobber a regular file). `link`
  without flags creates `<project>/node_modules/screen1shoter -> <S1S_ROOT>`
  plus `react`, `react-dom` symlinks so the app's editor resolves imports.

## 5. Browser protocol (implementer 3: web; consumed by render)

Routes (hash router, no server routing):
- `/#/render/<locale>/<sizeId>/<screenId>` — exactly one `Canvas` at
  `preset.pt`, positioned at (0,0), `body { margin: 0; background: theme.background }`,
  no other DOM. `sizeId` is always a render target, never an alias.
- `/#/gallery` — every screen x size as scaled iframes of render routes with
  locale and size switchers (dev only).
- `/#/sheet/<locale>/<sizeId>?scale=&columns=` — contact sheet: reads
  `/project/out/<locale>/report.json` and tiles the finished PNGs (see §6b).

Virtual modules (provided by `s1sPlugin`):
- `virtual:s1s-screens` — default export `ScreensConfig` (`<project>/screens.ts`).
- `virtual:s1s-theme` — default export `Theme` (`<project>/theme.ts`).
- `virtual:s1s-templates` — default export `TemplateModule[]` from
  `<project>/templates/index.ts` (or `index.tsx`), or `[]` when neither exists.

Data endpoint: `GET /__s1s/project.json` -> `ProjectJson` (see types.ts):
locale copies, manifest, presets in use, capture map keyed by
`captureKey(locale, family, ref)`, bezel index or null, and
`fonts: ProjectFont[]` (one entry per file under `<project>/fonts/`; the
browser turns each into an @font-face served from `/project/fonts/<file>`).

Static:
- `/project/*` -> `<project>/*` (captures, fonts, assets). Capture URL =
  `'/project/' + captureSource.resolvedPath`.
- `/bezels/*` -> bezel cache dir (`/bezels/index.json`, `/bezels/<id>/<variant>.png`).
- Bundled Inter: `src/web/main.tsx` does `import '@fontsource-variable/inter';`
  (Vite serves the woff2 from node_modules); no font files are copied. Project
  fonts under `<project>/fonts/` are reachable as `/project/fonts/*`.

Window globals (declared in `src/web/s1s-globals.d.ts`):
- `window.__S1S_MODE: 'render' | 'dev'` — injected by the plugin into
  `index.html` before any module script.
- `window.__S1S_READY: boolean` — set `false` on every route change; set
  `true` only when: route data loaded, `document.fonts.ready` resolved, every
  `<img>` in the canvas decoded (or errored and reported), no element carries
  `data-s1s-fitting`, and two consecutive animation frames passed idle.
- `window.__S1S.check(): Warning[]` — derives warnings from the DOM:
  `[data-s1s-overflow]` -> code from the attribute value (`text-min-size` |
  `text-clipped` | `overflow`) unless inside `[data-s1s-allow-bleed]`;
  broken `<img>` -> `image-missing`; `GenericBezel` fallback ->
  `bezel-fallback`; font check -> `font-fallback`; `[data-s1s-capture-missing]`
  -> `capture-missing` (element `missingCaptureElement(ref)`). Capture and
  copy warnings also come from Node; the renderer merges both lists with
  `mergeWarnings` (same code + element = one warning).
- `window.__S1S.noncompliant(): string | null` — the template id of a canvas
  tagged `data-s1s-noncompliant`, else null. Compliance is a fact, not a
  warning, so it stays out of `check()`; the renderer stores it as
  `RenderReportItem.noncompliant` and review.md lists the offending screens.
  It reads the browser registry, so a project template that declares
  `compliant: false` is listed too — `templateMeta()` only knows built-ins,
  and is the fallback for passthrough and dry-run items.
- `[data-s1s-id="error"]` (ErrorPanel: unknown template, project.json
  failure, a template throw caught by the Canvas boundary) satisfies the
  readiness wait; the renderer then fails the item with the panel text.
- `window.__s1sSeed(route)` (render mode init script) re-seeds Math.random;
  RenderPage calls it at the start of every render pass.
- A failed item drops `render`/`renderHash`/`renderedAt` in the manifest,
  deletes its PNG + preview, and records an error-level `render-failed`
  warning in `renderWarnings`.

Data attributes:
- `data-s1s-canvas="<locale>/<sizeId>/<screenId>"` on the canvas root.
- `data-s1s-fitting` present while `useFitText` is measuring.
- `data-s1s-fitted="<pt>"` on a fitted text element when done.
- `data-s1s-overflow="text-min-size|text-clipped|overflow"` on an element
  that still overflows at `minPt`.
- `data-s1s-allow-bleed` on a container whose overflow is intentional.
- `data-s1s-noncompliant="<template id>"` on the canvas when the template is
  not guideline-compliant (`bleed-bottom`, `tilted`); review.md lists these.
  `phone-watch` is compliant: both devices are whole, upright and un-cropped,
  and Apple's rule bans cropping and tilting a product image, not standing two
  products together.
- `data-s1s-bezel="<id>/<variant>"` (or `"generic"`) on every `DeviceFrame`
  root (`data-s1s-id="device"`), `data-s1s-bezel-fallback="<wanted id>"` when
  a substitute id or the generic frame was used (`checks.ts` -> `bezel-fallback`,
  message names the substitute), `data-s1s-sheet` on the finished sheet page.

Template module shape (define in `src/runtime/index.ts`):
```ts
export interface TemplateProps { screen: ResolvedScreen; preset: SizePreset; theme: Theme; copy: ScreenCopy | undefined; mode: 'render' | 'dev' }
export interface TemplateModule { id: string; families: DeviceFamily[]; ipadVariant?: string; compliant?: boolean; Component: (props: TemplateProps) => ReactElement }
```
Render mode injects `* { animation: none !important; transition: none !important }`.

## 6. Output layout (per project, per locale)

```
screenshots/out/<locale>/
  <APP_DISPLAY_TYPE>/NN-<id>.png            exact preset.px, RGB, no alpha  (renderFileName)
  <APP_DISPLAY_TYPE>/preview/NN-<id>.png    1/3 scale
  report.json                               RenderReport
  review.md                                 human review notes (warnings, non-compliant templates)
  sheet-<sizeId>.png                        contact sheet (every screen of the size, RGB, no alpha)
screenshots/captures/<locale>/<family>/<ref>.png
screenshots/copy/<locale>.json              LocaleCopy
screenshots/manifest.json                   ProjectManifest
<app>/metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png   (export, W5; exportFileName)
```
An alias size (`iphone-6.7`) is rendered once and written to both display
type folders. `NN` is 1-based, two digits, contiguous per size.

## 6a. Bezels (W2)

Cache: `S1S_HOME/bezels/<id>/<variant>[-landscape].png` + `index.json`
(`BezelIndex`), DMGs under `S1S_HOME/dmg`, mounts under `S1S_HOME/mnt`. Never
inside the repo. `/bezels/*` serves the cache dir to the browser.

```ts
// src/core/bezels/sources.ts (Stage A facts; docs/bezels.md is the human record)
export const BEZEL_DMGS, BEZEL_SOURCES, BEZEL_SOURCE_IDS; export function isBezelSourceId, dmgsFor(ids), normaliseBezelFilename(path), sourceForFile(path);
  // ids: iphone-17-pro-max iphone-17-pro iphone-17 iphone-air ipad-pro-13-m5 ipad-pro-11-m5
  //      apple-watch-series-11-46mm apple-watch-series-11-42mm (W7); variants[0] is the 'auto' colour.
  // normaliseBezelFilename reads two shapes: `<model> - <Colour> - <Portrait|Landscape>.png`
  //   and, when the second part is a case size, `<model> - <NNmm> - <Case> + <Band>.png`
  //   (Apple Watch: no orientation part, portrait only, the whole case-plus-band string is the variant).
  //   `measuredVariant` names the file `portrait` was measured on: a watch band changes deviceRect,
  //   though never the case or its cut-out, and only screenRect guards an install.
// src/core/bezels/measure.ts (sharp raw RGBA; unit-tested on a synthetic bezel)
export function measureBezel(path): Promise<BezelMeasurement>;   // deviceRect (alpha > 12 bbox), screenRect, cornerRadius, islandRect?, pxPerPt (matching preset's scale, else dpi/72)
  // screenRect's height is the union of contiguous column scans at 20%, 50% and 80% of the width, and
  //   cornerProfile scans inward from the screen centre (or just left of an island). One probe cannot serve
  //   both shapes: 20% clears an iPhone's Dynamic Island, the centre clears an Apple Watch's corners, whose
  //   radius is 24% of the screen width. findIsland then drops a box that spans its whole search window or
  //   is under 1% of the screen deep - that is the pair of corner arcs, not a pill.
  // W7 note: these three rules leave every iPhone and iPad measurement byte-identical; they only fix the watch.
export function writeTrimmedBezel(...)                            // deviceRect + TRIM_PAD (2 px)
// src/core/bezels/install.ts
export async function installBezels(opts: { devices?, all?, from?, keepDmg?, force?, landscape?, home?, log? }): Promise<InstallResult>;
  // download (.part + Content-Length skip) -> hdiutil attach -> measure -> trim -> upsert index -> detach -> delete DMG unless keepDmg.
  // A known id whose measured screen differs from sources.ts by > 1 px is skipped at error level (exit 1).
// src/core/bezels/index.ts
export async function readBezelIndex(dir?), writeBezelIndex(index, dir?); export function findBezel(index, preset, variant = 'auto'): BezelMatch | null;
  // portrait entries only; preset.bezel then preset.bezelFallbacks; entries sorted id, portrait first, then sources.ts variant order so 'auto' = variants[0]
```

Install robustness: an unreadable `index.json` is moved to `index.json.bak`
and rebuilt (read-only consumers such as `list` still throw `bezel-missing`
with that hint); one PNG that fails to measure is an error-level `skipped`
entry, not an abort, and the index is written in a `finally` so entries
measured before an abort stay indexed. `mountDmg` detaches on SIGINT/SIGTERM
and re-raises the signal.

CLI: `s1s bezels inspect <dmg-url|path> [--keep-dmg]` (a URL is downloaded to
`S1S_HOME/dmg` and deleted afterwards unless `--keep-dmg`), `s1s bezels
install [--device ids] [--all] [--from dmg|dir] [--keep-dmg] [--force]
[--landscape]`, `s1s bezels list` (all `--json`; the text table's "used by"
column marks fallbacks like the `--json` `presets` map). Browser: `src/web/hooks/bezel.ts` (`selectBezel`,
`frameLayout`, `SCREEN_GROW` = 1 bezel px) is DOM-free and mirrors
`findBezel`; `useBezel(preset, theme, { bezelId?, variant? })` fetches
`/bezels/index.json` once per page under a readiness token.
`DeviceFrame({ captures, preset, theme, bezelId?, variant?, fit?: 'slot' |
{ width?, height? }, maxWidth?, maxHeight?, align?, crop?, rotate?,
allowBleed?, captureHint?, style? })` resolves its own bezel: capture box = screenRect
fractions of deviceRect grown by 1 bezel px, `border-radius` from
cornerRadius, bezel `<img>` on top (the opaque island covers the capture),
decoded under a `bezel-image` token. `fitInto` (the pure core of `FitBox`,
in `src/web/components/fit-box.ts`) computes the same box as `frameBox` in
slot mode, so a template that measures a device row itself puts the device
exactly where one that hands the row to `DeviceFrame` does; `phone-watch`
relies on that. `useCapture` holds its `capture` token
only while its `<img>` is mounted; a frame whose slot collapsed to zero
mounts nothing and flags the slot `data-s1s-overflow="overflow"` (with a
`data-s1s-overflow-why` explanation `checks.ts` prints), so the page still
becomes ready. Verified on the real iPhone 17 Pro Max
(screen (56,48) 1320x2868, aspect 0.4603, radius 189, island (529,91)
374x108, px/pt 3), iPad Pro 13 M5 ((92,96) 2064x2752, 0.75, radius 58,
no island, px/pt 2) and Apple Watch S11 46mm ((72,192) 416x496, 0.8387,
radius 101, no island, px/pt 1; the PNG includes the band, so `deviceRect`
differs per strap while the cut-out does not).

## 6b. Contact sheet (W2)

```ts
// src/render/sheet.ts
export interface SheetOptions { locale: string; sizes?: string[]; scale?: number /* 0.25 of the OUTPUT px */; columns?: number /* 5 */; serverUrl?: string; report?: RenderReport; onProgress? }
export async function sheetProject(project, opts: SheetOptions): Promise<SheetResult>;  // one out/<locale>/sheet-<sizeId>.png per size in report.json
// src/web/app/sheet-model.ts (DOM-free, shared by SheetPage, sheet.ts and tests): SHEET_DEFAULTS, normaliseSheetParams, sheetLayout(preset, params, tileCount) -> exact page dims, sheetTiles, sheetSummary
```

`SheetPage` (`/#/sheet/<locale>/<sizeId>`) shows the finished PNGs as `<img>`
tiles with ordinal, id, template and warning summary (red border on
error/failed, amber on warn/skipped, hatched panel for failed or missing
files). `sheet.ts` opens it at DSF 1 with the viewport = `sheetLayout()`
dims, waits for `__S1S_READY` + `[data-s1s-sheet]`, screenshots fullPage,
flattens, removes alpha and asserts the dims. `renderProject` deletes
`out/<locale>/sheet-<sizeId>.png` for every size of the run, then calls
`sheetProject` after `writeReview` unless `sheet === false`; a sheet failure
is one stderr line and does not fail the render. `RenderReport.sheets`
(`RenderSheet[]`: sizeId, displayType, path, dims, tiles) lists what this run
wrote (report.json is rewritten with it); the CLI prints `Sheets:` and the
`--json` `sheets` field from that list only, never from files on disk.
A `--screens` render carries the untouched items of the previous
`out/<locale>/report.json` (same locale, keys not in this run) into the
report.json, review.md and sheets it writes, so they keep describing the
whole set while the returned `RenderReport` (and the CLI output) lists this
run only; sheets are written for this run's sizes only.

## 7. Tests (implementer 5)

- Unit tests live in `tests/unit/*.test.ts`, import sources relatively with
  `.ts`, and use only `src/config` plus the Node signatures above. Where a
  Stage B module is not yet present, write the test against the signature
  here; the integrator wires it. Fixtures go in `tests/fixtures/`.
- Smoke tests (`pnpm test:smoke`, no network): `render.smoke.test.ts`
  renders a copy of `example/` for `iphone-6.9` + `ipad-13` with synthetic
  magenta bezels in a temp `S1S_HOME` (`tests/fixtures/make-bezel.ts`, geometry
  from `sources.ts`) and asserts exact dims, no alpha, no failures or
  bezel-fallback, the capture fills the rounded screen (no canvas background
  inside the screen shape), the island covers the capture, sheets match
  `sheetLayout()`, identical hashes on re-render; plus watch passthrough
  (416x496, byte-identical pixels) and a feature-grid iPad render.
  `bezels.smoke.test.ts` runs `s1s bezels inspect|install|list --json`
  against a synthetic DMG folder tree.
- `vitest run --project unit` passes with zero test files (`passWithNoTests`).

## 8. File ownership (Stage B)

| Implementer | Owns (create/edit) | Must not touch |
|---|---|---|
| 1 core | `src/core/**` except `errors.ts` (`project.ts manifest.ts copy.ts captures.ts matrix.ts paths.ts sim.ts exec.ts`, `schemas.ts` for zod) | everything else |
| 2 render | `src/render/**` (`server.ts vite-plugin-s1s.ts browser.ts render.ts post.ts review.ts`) | `src/web`, `src/core` |
| 3 web | `src/web/**` (index.html, main.tsx, app/, runtime/, styles/, components/, hooks/, templates/ `hero-top-text` `text-bottom` `raw`), `src/runtime/index.ts`, may narrow `src/web/s1s-globals.d.ts` | `src/render`, `src/core` |
| 4 cli | `src/cli/**`, `templates/init/**`, `example/screenshots/**`, `README.md` usage section | `src/core`, `src/render`, `src/web` |
| 5 tests | `tests/**` | `src/**` |
| frozen (Stage A) | `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest.config.ts`, `bin/s1s.js`, `src/config/**`, `src/core/errors.ts`, `CONTRACTS.md` | — |

Shared edits (a new dependency, a changed signature, a new `WarningCode`,
a new `S1sErrorCode`) are not made in place: describe them in your
`notesForIntegrator` and code against the frozen version. The integrator
applies them once in Stage C.

## 9. Stage C state and open decisions

Integrated in W1 Stage C: `pnpm check` green (typecheck both configs, 114
unit tests); `s1s init`, `s1s doctor`, `s1s dev` (stops on SIGINT to the
shim) and `s1s render` on `example/` (exact 1320x2868 / 2064x2752, 3
channels, no alpha, previews, report.json, review.md, identical hashes on
re-render) all verified.

Decisions taken:
- `RenderReportItem.error?: string` is part of the type (was runtime-only).
- `bin/s1s.js` spawns asynchronously and forwards signals.
- Capture reuse splits into two `CaptureFallback` values, because one is a
  decision and the other is an accident. A declared manifest
  `captureSource: 'reuse:<l>'` reports `fallback: 'reuse'` at info level. An
  undeclared drop to the source locale reports `fallback: 'source-locale'` at
  warn level: nobody asked for those pixels, so the locale is about to ship
  the source language's UI. review.md shows the origin either way.
- `copy-missing` is not emitted for template `raw` (no copy rendered).
- Project-level `copy-unused` infos are attached to the first item of the
  report and filtered out of manifest `renderWarnings`.
- `readManifest(path, fallbackApp?)` returns a default manifest for a
  missing file; all manifest schemas are loose (unknown keys survive).
- `TemplateMeta.implemented` / `phase` (template-meta.ts): every built-in is
  implemented as of W6, so the `loadProject` rejection path ("planned for
  <phase>") is unreachable today. It stays as the guard for a future phase
  that lands metadata before its `src/web/templates/*.tsx` file.
  `tests/unit/template-meta.test.ts` asserts the flag mirrors that directory;
  `phase` is now history, not a gate.
- Render bookkeeping (`buildReport`, `applyManifest`, `MAX_MANIFEST_RUNS`)
  lives in `src/render/bookkeeping.ts`, browser-free and unit-tested;
  `applyManifest` returns the new manifest. `src/core/sim.ts` exports the
  pure `parseSimctlDevices` and `pickSim` behind `listSims` / `findSim`.
- `tests/unit/cli.test.ts` spawns `bin/s1s.js` and pins the `--json` shape
  and exit codes; `s1s init` prints `s1s render --allow-placeholder` as the
  first render step.

Integrated in W2 Stage C: `pnpm check` (295 unit tests) and `pnpm test:smoke`
(17 tests) green; real bezels installed from the cached DMGs
(`s1s bezels install --device iphone-17-pro-max,ipad-pro-13-m5 --keep-dmg`);
`s1s render` on `example/` yields 10 items (5 screens x 2 sizes) with zero
warnings, exact px, no alpha, clean screen corners and two contact sheets;
watch passthrough verified on a temp project. Decisions: `hero-top-text` /
`text-bottom` render `DeviceFrame` in slot mode (no `FitBox`); the bezel
index is always rewritten on install so entries follow sources.ts variant
order; the smoke gap check scans the rounded screen shape, not its bounding
box (the box corners lie outside the body on a 189 px radius).

W2 review fixes (Stage C review round): `useCapture` holds its token only
while an `<img>` is mounted and `DeviceFrame` flags a collapsed slot instead
of deadlocking; `installBezels` rebuilds a corrupt index (`.bak`), skips one
unmeasurable PNG per file and writes the index in a `finally`; `mountDmg`
detaches on SIGINT/SIGTERM; `openSource` errors name the argument
(`<dmg-url|path>` for inspect); index entries sort portrait first;
`s1s bezels --json` without a subcommand lists `inspect, install, list`;
`mergeWarnings` also de-duplicates among browser warnings; `two-device`
stacks on both families (`LAYOUT` in `two-device-layout.ts`, unit-tested
against sources.ts: island and status bar clear, back device >= 50 %
visible, pair fills the row; `props.arrangement: 'side'` keeps the old iPad
layout); `TemplateMeta.captures` / `callouts` drive `loadProject`
(`needs capture: [a, b] (got 1)`) and an `overflow` warning for extra
callouts; `RenderReport.sheets` lists the sheets this run wrote and stale
sheets are deleted first; the scaffold's template example is the
type-checked `tests/fixtures/scaffold-template.tsx`.

Still open (not blocking W2):
- A substitute bezel (e.g. `iphone-6.1` framed with the Pro Max bezel) still
  emits a warn-level `bezel-fallback`; decide whether that should be info.
- `sheet.ts` starts its own Vite server + Chromium after the render (about
  1 s); sharing the render's would mean refactoring `renderBrowserItems`.
- A failed contact sheet does not fail `s1s render` (stderr line only).
- `templates/init/screens.ts` documents `two-device` / `feature-grid` in a
  comment only; the scaffold has no live feature-grid screen (init copy has
  no callouts and `init.test.ts` pins 4 screens / 7 items).
- (closed) `loadProject({ reload: true })` re-imports `screens.ts` /
  `theme.ts` with an mtime query under tsx; dev mode uses it for every
  `/__s1s/project.json` request and full-reloads the page when either file
  changes.
- `S1sErrorCode` has no generic `command-failed`; `runOk` defaults to
  `sim-failed` and callers pass `errorCode`.
- `asc screenshots validate --device-type IPHONE_69` reports
  `apiDisplayType: APP_IPHONE_67` on this machine; check the upload mapping
  with `--dry-run` before W5 relies on `APP_IPHONE_69`.
- Custom project templates that import CJS-only npm packages fail in render
  mode (`optimizeDeps.noDiscovery`); document "react + screen1shoter only" or
  extend `REACT_DEPS` in `src/render/server.ts`.
- `@types/node` is pinned to 24.13.3 (matches Node 24.x), not the newest
  26.x line; everything else is the latest version on the registry as of
  2026-09-02.

Integrated in W5 Stage C: `pnpm check` (386 unit tests) and `pnpm test:smoke`
(19 tests) green; `s1s status`, `s1s export --no-asc` and `s1s validate`
verified end to end on a scratch copy of `example/` (render -> export of
`iphone-6.9` + `iphone-6.7` -> validate -> status), including the
`--set` guards and `--dry-run`. Decisions and the duplicates collapsed:
- `WarningCode` gained `export-unapproved`, `duplicate-dims` and
  `manifest-incomplete` (all warn). `s1s export` had been borrowing
  `copy-unused` and `overflow` for them.
- The duplicate-dims rule has one spelling: the predicate
  `displayTypesShareDims` in `presets.ts` and the message
  `duplicateDimsMessage` in `validate.ts`, which `export.ts` imports.
  `s1s export` warns from the folder listing (before the sibling's pixels
  are known), `s1s validate` reports from the real dims of both sets.
- One export-file matcher (`EXPORT_FILE_RE` / `exportOrdinal` in
  `resolve.ts`), one display-type lookup (`presetByDisplayType`), one
  `exportDir`, one `toPosix` (`paths.ts`), one `sha1File` (`fs.ts`).
- `appendRun` caps `runs` itself; `MAX_MANIFEST_RUNS` moved from
  `render/bookkeeping.ts` to `core/manifest.ts`, which also stops
  `src/cli/commands/status.ts` reaching into `src/render` for a constant.
- `ImageState.export` is project-relative posix, exactly like `capture` and
  `render`; `reconcile` resolves it against `project.dir` only.
- `s1s doctor` gained a `metadata dir` check and now reads `--project`.
- `reconcile` adds the rows it emits to the covered set, so
  `s1s status --sizes iphone-6.7` on a project whose `screens.sizes` omits
  that alias no longer lists the same image as both a row and an orphan.
