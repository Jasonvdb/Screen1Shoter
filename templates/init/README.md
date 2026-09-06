# {{appName}} App Store screenshots

Source of the App Store screenshots for {{appName}}. Rendered with
Screen1Shoter (`s1s`): React templates in headless Chromium, exact-pixel PNGs,
real simulator captures in Apple's product bezels.

## Layout

| Path | What |
|---|---|
| `screens.ts` | Screen list, order, template per screen, sizes and locales |
| `theme.ts` | Brand colours, fonts, headline case, bezel variant |
| `copy/<locale>.json` | Headline, highlight word, subline, badge per screen |
| `captures/<locale>/<family>/<id>.png` | Simulator screenshots (`s1s capture`) |
| `templates/` | Optional custom templates (TSX) |
| `manifest.json` | State per locale x size x screen; the CLI and the agent share it |
| `out/` | Renders, previews, `report.json`, `review.md`, contact sheets (ignored) |

## Phases

0. Preflight: `s1s doctor`, then `s1s bezels install`.
1. Plan and copy: edit `screens.ts` and `copy/{{sourceLocale}}.json`.
2. Capture: `s1s sim list`, `s1s sim status-bar <udid>`, `s1s sim appearance <udid> dark`,
   then `s1s capture --udid <udid|name> --name <id> --device iphone|ipad|watch`.
3. Compose and render: `s1s render --locale {{sourceLocale}} --allow-placeholder` while captures
   are still missing (hatched placeholders, exit 0), then `s1s render --locale {{sourceLocale}}`;
   preview with `s1s dev --open`.
4. Review: `out/{{sourceLocale}}/review.md`, `out/{{sourceLocale}}/sheet-<size>.png`; fix and re-render.
5. Export, validate, upload: `s1s export --locale {{sourceLocale}}`, `s1s validate --locale {{sourceLocale}}`,
   then the printed `asc screenshots upload ...` command.
6. Localize: add `copy/<locale>.json`, capture or reuse, `s1s render --locale <locale>`, export, validate, upload.

Add `--json` to any command for machine-readable output. Exit codes: 0 ok,
1 failure or error-level warnings, 2 usage.
