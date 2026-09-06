# app-store-screenshots

An agent skill that drives `s1s` (Screen1Shoter) to produce a complete App
Store screenshot set for the iOS, iPadOS or watchOS app in the current repo.
It works in Claude Code, Codex and Cursor.

## What it does

The skill walks an agent through eight phases and stops at a human gate
between them:

| Phase | Work | Gate |
|---|---|---|
| P0 | `s1s doctor`, `s1s bezels install`, app facts, `s1s init` | G0 first-launch approval |
| P1 | Benefit discovery, copy, `screenshots/plan.md`, `copy/en-US.json` | G1 plan and copy |
| P2 | Temporary demo-data branch and patch, fresh simulators, `s1s capture` | G2 captures |
| P3 | `screens.ts`, `theme.ts`, `s1s render`, `s1s sheet`, visual QA loop | - |
| P4 | Human review of the gallery, sheet and `review.md` | G3 renders |
| P5 | `s1s export`, `s1s validate`, `asc screenshots validate`, optional upload | G4 upload per device set |
| P6 | Same phases per locale: brief, transcreate, capture or reuse, render, export | G5, G6, G7 |
| P7 | Revert the demo-data branch, shut down simulators, verify `git status` | - |

All state lives in `screenshots/manifest.json` in the app repo, so any session
can resume where the last one stopped. Exports land in
`metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png`, the layout that
`asc screenshots upload` consumes.

The skill replaces `aso-appstore-screenshots`, `asc-localize-screenshots` and
`localize-app-store-screenshots` (image-model workflows).

## Install

Run the install script from this checkout once per machine:

```sh
scripts/install-skills.sh            # create or refresh the symlinks
scripts/install-skills.sh --check    # report link state, change nothing
scripts/install-skills.sh --retire   # archive the three old skills (asks y/N)
scripts/install-skills.sh --uninstall
```

`--retire` has not been run. Run it once a real end-to-end pilot (captures,
human gates, an actual upload) proves the replacement; the de-DE dry run in
`docs/w6-de-de-dryrun.md` recorded the gates rather than asking them, so it is
not that proof. The three old skills stay installed until then, so the
fallback is still there.

It creates these links and never overwrites a real directory:

```
~/.agents/skills/app-store-screenshots -> <checkout>/skills/app-store-screenshots
~/.claude/skills/app-store-screenshots -> ../../.agents/skills/app-store-screenshots
~/.codex/skills/app-store-screenshots  -> <checkout>/skills/app-store-screenshots
```

The script is idempotent: run it twice and the links stay the same. The
skill needs `s1s` on PATH (`pnpm install && pnpm link-cli` in this checkout,
then `s1s doctor`).

## Invoke

```
/app-store-screenshots                  # Claude Code: reconcile, then continue
/app-store-screenshots status           # print the progress table and stop
/app-store-screenshots de-DE            # localize into de-DE
$app-store-screenshots                  # Codex
```

Arguments: `status | plan | capture | compose | review | export | upload | <locale> | cleanup`.

## Files

```
SKILL.md                          # rules, routing, phases, gates, command chains (agent entry point)
README.md                         # this file
agents/openai.yaml                # Codex display metadata
references/
  copy-playbook.md                # benefit discovery, headline formula, Great/Usable/Retake rubric
  capture-playbook.md             # demo-data patch recipe, simulator prep, navigation steps, watch
  localize-playbook.md            # brief and glossary, transcreation, per-locale capture, all-or-nothing upload
  asc-upload.md                   # verified asc commands, editable-version gate, verification jq
  template-catalog.md             # templates, when to use them, props
  apple-rules.md                  # size table, bezel and marketing rules, no alpha, 1 to 10 per set
  manifest-schema.md              # screenshots/manifest.json contract shared by CLI and skill
  agent-tooling.md                # Claude Code tool to shell command equivalence table
```

The install script lives at `scripts/install-skills.sh` in the repo root.
