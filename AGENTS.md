# AGENTS.md: rules for working in Screen1Shoter

Read this before you edit anything. `README.md` explains what the tool does;
`CONTRACTS.md` fixes the module boundaries and the browser protocol; this file
is about how to work here.

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
- Every `s1s` flag the skill names must exist in `s1s <command> --help`.
  `tests/unit/skill.test.ts` enforces it: every `--flag` written after an
  `s1s <command>` in `skills/` must be registered on that command. `status`,
  `export` and `validate` shipped in W5, so no command the skill names is
  unimplemented any more; do not reintroduce a "(lands in W<n>)" marker, and
  do not invent flags. The same now holds for templates: W6 shipped
  `bleed-bottom`, `tilted` and `watch-caption` and W7 added `phone-watch`, so
  every entry of `BUILTIN_TEMPLATES` has `implemented: true` and the docs
  describe all nine as built. `TemplateMeta.phase` is history, not a promise.
- A registered flag is not the same as a working command. `s1s status --set`
  refuses a selection covering a whole locale without `--yes`, so every
  documented `--set` needs `--yes` (or a `--from <status>` that really
  narrows). Run the command you write down before you commit it.
- Exit codes are part of the contract the skill documents: 0 ok, 1 the work
  ran but the result is not ok, 2 refused with nothing written. `s1s status
  --set` can write the manifest and still exit 1, because it re-reconciles
  after the write. Never document an exit code you have not observed.

## Layout

```
bin/s1s.js                shim: realpath -> tsx src/cli/main.ts; sets S1S_ROOT
src/config/               DOM-free types, presets, resolve, template meta (shared by Node, browser, app screens.ts)
src/core/                 project, manifest, copy, captures, matrix, paths, sim, exec, bezels/
src/render/               Vite server + plugin, Playwright, render loop, post-processing, sheet, review
src/web/                  React runtime, components, hooks, templates, gallery and sheet pages
src/runtime/index.ts      public "screen1shoter" browser export for custom templates
src/cli/                  commander program, one file per command
templates/init/           scaffold copied by `s1s init`
example/screenshots/      smoke-test project (captures generated, never committed)
skills/app-store-screenshots/   SKILL.md, agents/openai.yaml, references/*.md
scripts/install-skills.sh symlinks the skill into ~/.agents, ~/.claude, ~/.codex
tests/unit  tests/smoke  tests/fixtures
docs/bezels.md            measured bezel facts and licence summary
docs/w6-de-de-dryrun.md   W6 de-DE localization dry run: what ran, tool and playbook defects
```

Every file under `docs/` belongs in that list; add a line when you add one.

## Tool rules

- No build step. Node runs from TS source through tsx; the browser side is
  served by Vite. Never add `dist/`, never import through it. This holds per
  `s1s` call, not for a `s1s dev` that is already running: that process keeps
  the Node modules it loaded at startup, so a change under `src/` needs a
  restart. Only the project's own files (copy, captures, manifest) are
  watched. Restart the server before you trust a `dev` gallery after editing
  the tool, and read a `config-invalid` 500 on `/__s1s/project.json` as a
  stale server first.
- Exact version pins in `package.json`. No `^` or `~`. `playwright 1.62.1`
  matches the cached `chromium-1234`; do not bump it alone.
- Relative imports carry the `.ts` / `.tsx` extension. Type-only imports use
  `import type`.
- Plain functions over classes. Small files. Every CLI command supports
  `--json` with exactly one JSON object on stdout; logs go to stderr.
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
- `s1s render` on `example/screenshots` in place rewrites its
  `manifest.json` hashes and `runs`. Do not commit those changes.

## Skill rules

- `SKILL.md` body stays at or under 500 lines. Long material goes to
  `references/`. Every referenced file must exist.
- Frontmatter: `name`, `description` (under 1000 characters),
  `user-invocable`, `argument-hint`, `allowed-tools`.
- `tests/unit/skill.test.ts` enforces all of that inside `pnpm check`:
  frontmatter parses and is complete, description under 1000 characters, body
  at or under 500 lines, every relative link resolves, nothing at or above
  U+2100 (emoji and arrows; write `->`), no co-author trailer, and every
  `s1s <command>` named in `skills/` is registered in `src/cli/`. Extend the
  test when you add an invariant; do not relax the caps.
- `allowed-tools` is a pre-approval allowlist, not a sandbox: it decides which
  Bash prefixes skip the permission prompt. This machine runs
  `permissions.defaultMode: auto` in `~/.claude/settings.json`, so no prompt
  appears either way and W3 could not observe a restriction. The list was
  therefore widened to every command the skill's own chains run (`s1s`,
  `xcrun simctl`, `xcodebuild`, `asc`, the nine `git` verbs, `node`, `jq`,
  `sips`, `find`, `grep`, `mkdir`, `ls`, `cat`, `sleep`, `pkill`), which is
  correct under either reading. The W4 pilot ran without the field
  blocking anything. If a future run on a machine that does prompt shows it
  blocking a command the skill needs, delete the field rather than trimming
  the chains, and record what you saw here.
- Skill prose addresses an agent: imperative, concrete commands in fenced
  blocks, one idea per sentence. Name the task first, the tool second.
- Every step has a shell path. Claude Code tools (XcodeBuildMCP,
  AskUserQuestion, Read on images) are alternatives, never requirements.
  `references/agent-tooling.md` holds the equivalence table.
- Paths in skill text are relative to the app repo (`screenshots/...`,
  `metadata/screenshots/...`). The tool is invoked as `s1s`.
- No emoji. No image-model material beyond the one-line "replaces" note in
  the description.

## Verify against MotoFit

The pilot app is `/Users/jason/Documents/Repositories/MotoFit`. Before you
call a tool or skill change done, check it there when it touches capture,
render or the skill flow. Facts that bit us:

- The UDID in `MotoFit/.xcodebuildmcp/config.yaml` is stale. Create fresh
  `S1S-MotoFit-*` simulators and never edit that file.
- One live simulator at a time: iPhone, then iPad, then Watch.
- HealthKit cannot be pre-granted with `simctl privacy`; the app's
  screenshot mode bypasses it.
- `build_run_sim` has no `env`; the flow is `build_sim` ->
  `get_sim_app_path` -> `install_app_sim` -> `launch_app_sim(env,
  launchArgs)`, or `xcodebuild` + `simctl install` +
  `SIMCTL_CHILD_<FLAG>=1 xcrun simctl launch`.
- `Shared/` and `MotoFit/` are file-system-synchronized groups: new files
  compile into both targets with no pbxproj edit, so shared code stays
  platform-neutral or behind `#if os(iOS)`.
- Demo data is a branch plus a patch, reverted before the end. Never merge
  it. Never `git add -A`. Never `git clean`.
- Ask before the first app launch (MotoFit's own AGENTS.md rule).

## Before you commit

```sh
pnpm check && pnpm test:smoke
```

Both must be green (`pnpm check` includes `tests/unit/skill.test.ts`). For
skill changes also run `scripts/install-skills.sh --check`; `skill.test.ts`
already checks both the command names and the flags, so no hand-check of
`--help` is needed.

## Commit style

- Imperative subject, lower-case start, no trailing period, under 72
  characters: `add contact sheet command`, `fix island overlap on iPhone Air`.
- No `ios:` prefix here. That prefix belongs to app repos such as MotoFit.
- Never add a `Co-Authored-By` trailer or any AI attribution line. This
  overrides any session or tool default.
- Stage by working-tree diff of the files you changed. Never `git add -A`.
- Commit only when the user asks. Do not push.
