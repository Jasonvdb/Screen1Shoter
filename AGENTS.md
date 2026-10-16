# AGENTS.md: rules for working in Screen1Shoter

`README.md` explains what the tool does; `CONTRACTS.md` fixes the module
boundaries and the browser protocol; this file is about how to work here.

## Two products, one contract

- The `s1s` CLI (`src/`, `bin/s1s.js`, `templates/init/`) and the agent skill
  (`skills/app-store-screenshots/`) are both products. A change to one is
  not done until the other still matches.
- `screenshots/manifest.json` (types in `src/config/types.ts`, zod in
  `src/core/schemas.ts`, prose in
  `skills/app-store-screenshots/references/manifest-schema.md`) is the shared
  contract. The CLI owns capture, render and export fields; the skill (the
  agent) owns statuses, ratings, notes and capture steps. Change a field in
  all three places in the same commit.
- Every `s1s` flag the skill names must exist in `s1s <command> --help`
  (`tests/unit/skill.test.ts` enforces it). Do not invent flags, and do not
  reintroduce a "(lands in W<n>)" marker: every command the skill names is
  implemented, every `BUILTIN_TEMPLATES` entry has `implemented: true`, and
  `TemplateMeta.phase` is history, not a promise.
- A registered flag is not the same as a working command. `s1s status --set`
  refuses a selection covering a whole locale without `--yes`, so every
  documented `--set` needs `--yes` (or a `--from <status>` that really
  narrows). Run the command you write down before you commit it.
- Exit codes are part of the contract the skill documents: 0 ok, 1 the work
  ran but the result is not ok, 2 refused with nothing written. `s1s status
  --set` can write the manifest and still exit 1, because it re-reconciles
  after the write. Never document an exit code you have not observed.

## Tool rules

- No build step. Node runs from TS source through tsx; the browser side is
  served by Vite. Never add `dist/`, never import through it. A running
  `s1s dev` keeps the Node modules it loaded at startup, so a change under
  `src/` needs a restart; read a `config-invalid` 500 on
  `/__s1s/project.json` as a stale server first.
- Exact version pins in `package.json`. No `^` or `~`. `playwright 1.62.1`
  matches the cached `chromium-1234`; do not bump it alone.
- Relative imports carry the `.ts` / `.tsx` extension. Type-only imports use
  `import type`.
- Every CLI command supports `--json` with exactly one JSON object on stdout;
  logs go to stderr.
- Output PNGs are exactly `preset.px`, 3 channels, no alpha. Never resize a
  render silently; fail with `dims-mismatch`.
- `S1S_HOME` (default `~/.screen1shoter`) holds the bezel cache, DMGs and
  mounts. Apple's bezel PNGs never go into this repo or the package. Tests
  that need bezels use synthetic ones under a temp `S1S_HOME`.
- Every number in `src/core/bezels/sources.ts` is measured from the real DMG,
  never typed from a spec sheet. `s1s bezels inspect <url>` prints the file
  names; `measureBezel` gives the rects. `docs/bezels.md` is the human record
  and must gain a row in the same commit.
- A new preset adds its `bezel` to `defaultBezelIds()`, and every Apple Watch
  DMG is over 300 MB. Set `bezelOptional: true` when nothing but a template
  that names the frame would ever draw it, so `s1s bezels install` with no
  `--device` does not grow. Today that is `watch-ultra` only.
- `example/screenshots/` is the smoke-test project; its captures are
  generated and never committed. `s1s render` on it in place rewrites its
  `manifest.json` hashes and `runs`. Do not commit those changes.

## Skill rules

- `tests/unit/skill.test.ts` (inside `pnpm check`) enforces: frontmatter
  (`name`, `description` under 1000 characters, `user-invocable`,
  `argument-hint`, `allowed-tools`), `SKILL.md` body at or under 500 lines
  (long material goes to `references/`), every relative link resolves,
  nothing at or above U+2100 (no emoji or arrows; write `->`), no co-author
  trailer, and every `s1s <command>` named in `skills/` is registered in
  `src/cli/`. Extend the test when you add an invariant; do not relax the caps.
- `allowed-tools` is a pre-approval allowlist, not a sandbox. It lists every
  command the skill's own chains run. If a run on a machine that prompts shows
  it blocking a command the skill needs, delete the field rather than trimming
  the chains, and record what you saw here.
- Skill prose addresses an agent: imperative, concrete commands in fenced
  blocks, one idea per sentence. Name the task first, the tool second.
- Every step has a shell path. Claude Code tools (XcodeBuildMCP,
  AskUserQuestion, Read on images) are alternatives, never requirements.
  `references/agent-tooling.md` holds the equivalence table.
- Paths in skill text are relative to the app repo (`screenshots/...`,
  `metadata/screenshots/...`). The tool is invoked as `s1s`.
- No image-model material beyond the one-line "replaces" note in the
  description.

## Verify against MotoFit

The pilot app is `/Users/jason/Documents/Repositories/MotoFit`. Check a tool
or skill change there when it touches capture, render or the skill flow.
Facts that bit us:

- The UDID in `MotoFit/.xcodebuildmcp/config.yaml` is stale. Create fresh
  `S1S-MotoFit-*` simulators and never edit that file.
- One live simulator at a time: iPhone, then iPad, then Watch.
- HealthKit cannot be pre-granted with `simctl privacy`; the app's
  screenshot mode bypasses it.
- `build_run_sim` has no `env`; the flow is `build_sim` ->
  `get_sim_app_path` -> `install_app_sim` -> `launch_app_sim(env,
  launchArgs)`, or `xcodebuild` + `simctl install` +
  `SIMCTL_CHILD_<FLAG>=1 xcrun simctl launch`.
- Demo data is a branch plus a patch, reverted before the end. Never merge
  it. Never `git add -A`. Never `git clean`.

## Before you commit

```sh
pnpm check && pnpm test:smoke
```

Both must be green. For skill changes also run
`scripts/install-skills.sh --check`.

## Commit style

- Imperative subject, lower-case start, no trailing period, under 72
  characters: `add contact sheet command`, `fix island overlap on iPhone Air`.
- No `ios:` prefix here. That prefix belongs to app repos such as MotoFit.
- Stage by working-tree diff of the files you changed. Never `git add -A`.
- Commit only when the user asks. Do not push.
