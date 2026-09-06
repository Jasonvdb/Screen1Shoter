# Example screenshots project

A minimal `s1s` project: three screens (`hero-top-text`, `text-bottom`,
`hero-top-text`) for `iphone-6.9` and `ipad-13`, English copy, dark theme.
The smoke test copies this directory to a temp dir and renders it; the
integrator renders it in place. It mirrors what `s1s init` scaffolds.

Captures are not committed. Generate placeholder captures (solid colour,
"9:41" bar, screen id and size) with sharp:

```sh
pnpm exec tsx example/screenshots/make-captures.ts            # into this dir
pnpm exec tsx example/screenshots/make-captures.ts /tmp/proj  # into a copy
```

Then render from the checkout:

```sh
pnpm s1s render --project example/screenshots
pnpm s1s render --project example/screenshots --sizes iphone-6.9 --json
pnpm s1s dev --project example/screenshots --open
```

Outputs land in `out/en-US/<APP_DISPLAY_TYPE>/NN-<id>.png` (1320x2868 and
2064x2752, RGB, no alpha) with 1/3-scale previews, `report.json` and
`review.md`.

`manifest.json` is checked in as `s1s init` writes it. Every in-place render
rewrites its render hashes, timestamps and `runs`, so a render here dirties
the working tree; do not commit those changes. `pnpm test:smoke`
(`tests/smoke/render.smoke.test.ts`) copies this directory to a temp dir,
generates the captures and renders there, so it leaves the checkout clean.
