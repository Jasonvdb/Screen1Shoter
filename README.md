# Screen1Shoter

App Store screenshots from React templates. Screens are TSX, previewed in a
browser and rendered by headless Chromium to exact-pixel PNGs (1320x2868 for
iPhone 6.9", 2064x2752 for iPad 13", 416x496 raw for Apple Watch). Real iOS
Simulator captures sit in Apple's product bezels; text is real text, so a new
size or locale is a re-render, not a new image.

## Status

Phase W1: renderer, CLI and core loop. Bezels, contact sheets, export,
validate and status arrive in later phases (see "Commands").

## Prerequisites

- Node 24 (`engines.node`), pnpm 10.33 (`packageManager`).
- Xcode with the iOS Simulator for `s1s capture` and `s1s sim` (rendering
  itself needs no Xcode).
- Playwright's Chromium: `pnpm exec playwright install chromium` if
  `s1s doctor` reports it missing.

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
cd <app>
s1s init --app-name "My App" --bundle-id com.example.app     # scaffolds <app>/screenshots
s1s render --locale en-US --allow-placeholder               # layout work before any capture exists
s1s sim list && s1s sim status-bar "iPhone 17 Pro Max"
s1s capture --udid "iPhone 17 Pro Max" --name home --device iphone
s1s render --locale en-US                                   # out/en-US/<APP_DISPLAY_TYPE>/NN-<id>.png
s1s dev --open                                              # gallery with HMR
```

Outputs are exact `preset.px`, RGB, no alpha, with 1/3-scale previews,
`report.json` and `review.md` under `screenshots/out/<locale>/`.

## Commands

| Command | Does |
|---|---|
| `s1s init` | Scaffold `<app>/screenshots` (screens.ts, theme.ts, copy, manifest, captures) and link it |
| `s1s link [--cli]` | `--cli`: put `s1s` on PATH; without: link the project's node_modules to this checkout |
| `s1s doctor` | Environment checks |
| `s1s dev` | Vite dev server with the `/#/gallery` page |
| `s1s render` | Render one locale: PNGs, previews, report.json, review.md, manifest render fields |
| `s1s capture` | Screenshot a simulator into `captures/<locale>/<family>/<name>.png` and record it |
| `s1s sim list \| status-bar \| appearance` | Simulator helpers over `xcrun simctl` |
| `s1s bezels`, `s1s sheet` | Later phase (W2): Apple bezels, contact sheets |
| `s1s status`, `s1s export`, `s1s validate` | Later phase (W5): reconcile, export to `metadata/screenshots`, offline validation |

Every command accepts `--json`: stdout is exactly one JSON object
(`{ ok: true, ... }` or `{ ok: false, error: { code, message, hint } }`);
progress and logs go to stderr. Exit codes: 0 ok, 1 failure or error-level
warnings, 2 usage.

## Develop the tool

```sh
pnpm check         # tsc (node + web) and unit tests
pnpm test:smoke    # renders a copy of example/ through Chromium
pnpm s1s -- render --project example/screenshots --dry-run --json
```

See `example/screenshots/README.md` for the example project and
`CONTRACTS.md` for the module boundaries and the browser protocol.
