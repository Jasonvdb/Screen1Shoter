# Screen1Shoter

App Store screenshots from React templates. Screens are TSX, previewed in a
browser and rendered by headless Chromium to exact-pixel PNGs (1320x2868 for
iPhone 6.9", 2064x2752 for iPad 13", 416x496 raw for Apple Watch). Real iOS
Simulator captures sit in Apple's product bezels; text is real text, so a new
size or locale is a re-render, not a new image.

The repo ships two products that share one contract:

- the `s1s` CLI (renderer, bezels, simulator helpers, export pipeline), and
- the `app-store-screenshots` agent skill (`skills/app-store-screenshots/`)
  that drives `s1s` end to end inside Claude Code, Codex or Cursor.

`AGENTS.md` holds the rules for anyone (human or agent) editing this repo.

## Status

| Phase | Scope | State |
|---|---|---|
| W1 | Renderer, CLI, core render loop (`init`, `link`, `doctor`, `dev`, `render`, `capture`, `sim`) | done |
| W2 | Apple bezels, contact sheets, iPad and watch sizes, `two-device` and `feature-grid` templates | done |
| W3 | Agent skill `app-store-screenshots`, `scripts/install-skills.sh`, repo docs | done |
| W4 | MotoFit pilot: demo-data patch, captures, first complete en-US set | planned |
| W5 | `s1s export`, `s1s validate`, `s1s status`, `asc` integration | done |
| W6 | Localization path, opt-in templates, retire the three old screenshot skills | planned |

## Prerequisites

- Node 24 (`engines.node`), pnpm 10.33 (`packageManager`).
- Xcode with the iOS Simulator for `s1s capture` and `s1s sim` (rendering
  itself needs no Xcode).
- Playwright's Chromium: `pnpm exec playwright install chromium` if
  `s1s doctor` reports it missing.
- `asc` (App Store Connect CLI) only for validation against the store and for
  uploads; `s1s doctor` reports whether it is on PATH.

## Install

```sh
pnpm install
pnpm link-cli        # ~/.local/bin/s1s -> <checkout>/bin/s1s.js
s1s doctor           # node, tsx, Playwright + Chromium, sharp, bezels, asc, simctl, cli link
```

No build step: `s1s` runs the TypeScript sources through tsx, and the browser
side is served by Vite. Editing the tool takes effect on the next call.

## Use in an app repo

```sh
s1s bezels install                                          # once per machine: Apple bezels into ~/.screen1shoter/bezels
cd <app>
s1s init --app-name "My App" --bundle-id com.example.app     # scaffolds <app>/screenshots
s1s render --locale en-US --allow-placeholder               # layout work before any capture exists
s1s sim list && s1s sim status-bar "iPhone 17 Pro Max"
s1s capture --udid "iPhone 17 Pro Max" --name home --device iphone
s1s render --locale en-US                                   # out/en-US/<APP_DISPLAY_TYPE>/NN-<id>.png
s1s dev --open                                              # gallery with HMR
```

Outputs are exact `preset.px`, RGB, no alpha, with 1/3-scale previews,
`report.json`, `review.md` and one contact sheet per size
(`sheet-<sizeId>.png`, every rendered screen in one image) under
`screenshots/out/<locale>/`. A `render --screens <subset>` keeps the other
screens of the previous report in `report.json`, `review.md` and the sheets.
Apple Watch (`watch-s10`) is a passthrough: the 416x496 capture is copied
unframed.

Per-app files live in `<app>/screenshots/`: `screens.ts`, `theme.ts`,
`copy/<locale>.json`, `captures/<locale>/<family>/<name>.png`,
`manifest.json`, optional `templates/` and `fonts/`, and the ignored `out/`.
Exports go to `<app>/metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png`,
the layout `asc screenshots upload` reads.

## Commands

| Command | Does |
|---|---|
| `s1s init [--app-name] [--bundle-id] [--app-id] [--locales] [--sizes] [--watch] [--force] [--overwrite-authored]` | Scaffold `<app>/screenshots` (screens.ts, theme.ts, copy, manifest, captures) and link it |
| `s1s link [--cli]` | `--cli`: put `s1s` on PATH; without: link the project's node_modules to this checkout |
| `s1s doctor` | Environment checks: node, tsx, Playwright + Chromium, sharp, bezels, `asc`, simctl, the metadata dir and the CLI link |
| `s1s dev [--locale] [--port] [--open]` | Vite dev server with the `/#/gallery` page |
| `s1s render [--locale] [--sizes] [--screens] [--jobs 4] [--dry-run] [--no-sheet] [--strict] [--allow-placeholder]` | Render one locale: PNGs, previews, report.json (with `sheets`), review.md, contact sheets, manifest render fields |
| `s1s sheet [--locale] [--sizes] [--scale 0.25] [--columns 5]` | Contact sheet per size from the last render (`render` runs it automatically; `--no-sheet` skips it) |
| `s1s capture --udid <udid\|name> --name <id> --device iphone\|ipad\|watch [--locale]` | Screenshot a simulator into `captures/<locale>/<family>/<name>.png`, verify its pixel size and record it in the manifest |
| `s1s sim list [--all]` | List simulators over `xcrun simctl` |
| `s1s sim status-bar <udid\|name> [--time 9:41] [--clear]` | App Store status bar: 9:41, Wi-Fi, full signal, charged battery (watchOS: reported as unsupported, not an error) |
| `s1s sim appearance <udid\|name> light\|dark` | Switch the simulator UI appearance |
| `s1s bezels install [--device ids] [--all] [--from dmg\|dir] [--keep-dmg] [--force] [--landscape]` | Download Apple's bezel DMGs, measure the PNGs and cache them under `~/.screen1shoter/bezels` (`S1S_HOME` overrides) |
| `s1s bezels list` | Show installed bezels with their screen geometry and which preset uses each one |
| `s1s bezels inspect <dmg-url\|path> [--keep-dmg]` | List the PNGs a DMG (or folder) contains with sizes and proposed id/variant |
| `s1s status [--json] [--set <status> --locale --sizes --screens --from <status>] [--yes]` | Reconcile table: screens.ts vs the manifest vs the PNGs on disk, plus orphaned manifest entries and stray exports (the store is never contacted); `--set` applies a guarded, all-or-nothing status transition, `--from` restricts it to the images at one status, `--yes` confirms a `--set` that covers a whole locale; `--set uploaded` also writes `uploadedAt` and clears `wasUploaded` |
| `s1s export --locale <l> [--sizes] [--metadata-dir metadata/screenshots] [--prune] [--dry-run] [--no-asc]` | Refuse on an incomplete or error-level render; copy to `metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png` when the hash differs; `--prune` deletes every `NN.png\|jpg\|jpeg` in the folder this run did not write (others are listed as `stale`); warn on sibling `APP_*` folders with identical dims; run `asc screenshots validate` per size when `asc` is present; print one `asc screenshots upload --version-localization ... --dry-run` command per display type (plus the fan-out form when no duplicate dims) |
| `s1s validate [--metadata-dir] [--locale] [--sizes] [--json]` | Offline check of the export folder: filenames `NN.png\|jpg\|jpeg` contiguous from 01, 1 to 10 per set, dims in `acceptedDims`, no alpha, RGB, uniform dims per set, all-or-nothing across locales, duplicate-dims trap; exit 1 on failure. `--locale` narrows the table (`locales`), never the cross-locale rule: every folder in `scanned` is still compared |

Every command accepts `--json`: stdout is exactly one JSON object
(`{ ok: true, ... }` or `{ ok: false, error: { code, message, hint } }`);
progress and logs go to stderr. `--project <dir>` points at an app repo or its
`screenshots/` dir; the default is a search up from the cwd. Exit codes: 0 ok,
1 failure or error-level warnings, 2 usage.

## Sizes

| id | displayType | px | capture simulator | notes |
|---|---|---|---|---|
| `iphone-6.9` | `APP_IPHONE_69` | 1320x2868 | iPhone 17 Pro Max | default |
| `iphone-6.7` | `APP_IPHONE_67` | 1320x2868 | iPhone 17 Pro Max | alias of `iphone-6.9`, rendered once, exported twice |
| `iphone-6.5` | `APP_IPHONE_65` | 1284x2778 | iPhone 14 Plus | |
| `iphone-6.1` | `APP_IPHONE_61` | 1206x2622 | iPhone 17 Pro | |
| `ipad-13` | `APP_IPAD_PRO_3GEN_129` | 2064x2752 | iPad Pro 13-inch (M5) | default |
| `ipad-11` | `APP_IPAD_PRO_3GEN_11` | 1668x2420 | iPad Pro 11-inch (M5) | |
| `watch-s10` | `APP_WATCH_SERIES_10` | 416x496 | Apple Watch Series 11 (46mm) | passthrough, unframed |

The full table with points, scale and accepted dimensions is in
`CONTRACTS.md` section 3.

## Bezels

`s1s bezels install` fetches Apple's "Bezel-iPhone-17.dmg" (265 MB) and
"Bezel-iPad-Pro-(M5).dmg", mounts them with `hdiutil`, measures every portrait
PNG (device box, screen cut-out, corner radius, Dynamic Island) and writes
trimmed copies plus `index.json` to `~/.screen1shoter/bezels/<id>/<variant>.png`.
The DMG is deleted after install (and after `bezels inspect <url>`); pass
`--keep-dmg` to keep it under `~/.screen1shoter/dmg`, where a complete file
is reused instead of downloaded again.
Without an installed bezel a render falls back to a generic CSS frame and
reports a `bezel-fallback` warning. `theme.bezelVariant` picks the colour
(`'auto'` = the first variant of the model, e.g. `deep-blue`, `space-black`).
Measured facts and the licence summary are in `docs/bezels.md`. The bezel
PNGs stay in the cache; never commit them.

## Skill

`skills/app-store-screenshots/` is the agent skill that drives the whole
workflow: benefit discovery and copy, temporary demo data, simulator
captures, TSX composition, render and visual QA, human review, export,
optional upload with `asc`, localization and cleanup. Its state lives in the
app repo's `screenshots/manifest.json`, so any session can resume.

Install the skill once per machine from this checkout:

```sh
scripts/install-skills.sh            # symlinks into ~/.agents/skills, ~/.claude/skills, ~/.codex/skills
scripts/install-skills.sh --check    # report link state, change nothing
scripts/install-skills.sh --retire   # archive the three old image-model skills (asks y/N; run it in W6)
scripts/install-skills.sh --uninstall
```

The script is idempotent and never overwrites a real directory. The skill
needs `s1s` on PATH (`pnpm link-cli`, then `s1s doctor`).

Invoke it as `/app-store-screenshots [status | plan | capture | compose |
review | export | upload | <locale> | cleanup]` in Claude Code or
`$app-store-screenshots` in Codex. `SKILL.md` is the entry point (under 500
lines); long material lives in `references/`. See
`skills/app-store-screenshots/README.md` for the phase table.

## Develop the tool

```sh
pnpm check         # tsc (node + web) and unit tests
pnpm test:smoke    # renders a copy of example/ through Chromium
pnpm s1s -- render --project example/screenshots --dry-run --json
```

Run `pnpm check && pnpm test:smoke` before every commit. See
`example/screenshots/README.md` for the example project, `CONTRACTS.md` for
the module boundaries and the browser protocol, and `AGENTS.md` for the repo
rules.
