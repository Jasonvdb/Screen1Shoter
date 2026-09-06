---
name: app-store-screenshots
description: Create, localize, export and upload App Store screenshots for an iOS, iPadOS or watchOS app with the s1s CLI (Screen1Shoter). Real Simulator captures sit in Apple product bezels, copy is real text in React templates, headless Chromium renders exact-pixel PNGs, exports land in metadata/screenshots, uploads go through asc, and all state lives in screenshots/manifest.json so any session can resume. Replaces aso-appstore-screenshots, asc-localize-screenshots and localize-app-store-screenshots. Use when the user says App Store screenshots, store screenshots, screenshot set, marketing screenshots, screenshot copy or captions, benefit headlines, localize or translate screenshots, add a screenshot language, upload screenshots to App Store Connect, iPhone 6.9 or iPad 13 or watch screenshot sizes, screenshot status, or resume the screenshot workflow.
user-invocable: true
argument-hint: "[status | plan | capture | compose | review | export | upload | <locale> | cleanup]"
allowed-tools: Bash(s1s:*), Bash(xcrun simctl:*), Bash(xcodebuild:*), Bash(asc:*), Bash(git status:*), Bash(git diff:*), Bash(git switch:*), Bash(git add:*), Bash(git commit:*), Bash(git branch:*), Bash(git apply:*), Bash(git rev-parse:*), Bash(git check-ignore:*), Bash(node:*), Bash(jq:*), Bash(sips:*), Bash(find:*), Bash(grep:*), Bash(mkdir:*), Bash(ls:*), Bash(cat:*), Bash(sleep:*), Bash(pkill:*), Read, Write, Edit, Grep, Glob, AskUserQuestion
---

# App Store screenshots with s1s

## 1. Scope

You produce the complete App Store screenshot set for the app in the current repo: discover
benefits, write copy, capture the real app in the Simulator, compose TSX screens, render
exact-pixel PNGs, get human approval, export to `metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png`,
and, only on request, upload with `asc`. Localization is the same phases re-run with a locale.
The tool is `s1s` (Screen1Shoter). Run `s1s <command> --help` when unsure about a flag; for a
nested command both `s1s <group> <cmd> --help` and `s1s <group> help <cmd>` print its flags.
Default sizes: `iphone-6.9` (1320x2868, `APP_IPHONE_69`) and `ipad-13` (2064x2752,
`APP_IPAD_PRO_3GEN_129`); `watch-s10` (416x496 raw) when the app has a watch target.
All paths below are relative to the app repo. Run every command from the app repo root.

## 2. Golden rules

- State lives in `screenshots/manifest.json` and in files under `screenshots/`, never in your
  memory. Reconcile before you act.
- Never proceed on silence at a gate. Ask, wait for the answer, then continue.
- Every step has a shell path. Claude Code tools (XcodeBuildMCP, AskUserQuestion, Read on
  images) are alternatives, never requirements. See section 13.
- Never Read a full-size render. Read the contact sheet first, then only warned previews.
- Never resize, crop or retouch a PNG by hand. Fix the source (copy, `screens.ts`, `theme.ts`,
  capture) and re-render. `s1s` guarantees exact pixels, RGB, no alpha.
- Demo data is temporary: a branch plus a patch, all `#if DEBUG` and env-gated, reverted before
  the end. Never merge it. Never `git add -A`. Never `git clean`.
- One live simulator at a time. Use fresh dedicated sims with unique names. Never trust a
  stored UDID; resolve the sim by name at the head of every command chain.
- Follow Apple's rules: full upright official bezel, copy beside the device, latest devices,
  real app UI, 9:41 status bar, 1 to 10 images per set, no alpha.
- Uploads are opt-in, per device set, all-or-nothing across locales, only to an editable
  version, `--dry-run` first.
- Commits use the `ios:` prefix, carry no trailer, and are offered at gates, never made silently.

## 3. Files and state

```
screenshots/                      # source of truth, committed
  manifest.json                   # one file, all locales; CLI writes file fields, you write statuses
  plan.md                         # benefits, order, template, capture route per screen
  screens.ts  theme.ts            # data + theme (Node and browser both read them)
  templates/index.ts              # optional custom TSX templates
  copy/<locale>.json              # headline, highlight, subline, badge, callouts, layoutNotes
  copy/brief.md                   # localization brief and glossary (P6)
  fonts/*.woff2  assets/*.png     # optional: auto-registered @font-face files; background/panorama images
  captures/<locale>/<family>/<name>.png   # Simulator captures (iphone | ipad | watch)
  captures/demo-data.patch        # temporary demo-data diff for re-shoots
  captures/git-status-before.txt  # git status recorded before the demo-data branch (P2, P7)
  out/<locale>/                   # ignored: renders, previews, report.json, review.md, sheet-<size>.png
  out/preview/                    # ignored: sips previews of captures
metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png   # export, what asc uploads
```

Image status, per locale x size x screen, forward by any number of steps, or back only to
`pending`, `captured` or `generated`; never back to `copy-approved`, `image-approved` or
`exported`:
`pending -> copy-approved -> captured -> generated -> image-approved -> exported -> uploaded`.
`s1s capture` sets `captured` from `pending` or `copy-approved` and keeps any higher status;
`s1s render` sets `generated` on a hash change (from any status, including `uploaded`);
`s1s export` sets `exported`. You set `copy-approved`, `image-approved` and `uploaded` with
`s1s status --set <status> --locale <l> [--sizes] [--screens] [--from <status>] --yes`, plus
`captureRating`, `captureNotes` and `screens[].capture.steps`. A render or export that moves an
image the store holds sets `wasUploaded: true`; `s1s status --set uploaded` clears it.
`runs[]` is CLI-owned; never append to it. Field-by-field contract and the hand-edit recipes:
[references/manifest-schema.md](references/manifest-schema.md).

## 4. Start here

The argument is the text the user typed after the skill name (Claude Code
`/app-store-screenshots <arg>`, Codex `$app-store-screenshots <arg>`). When your host passes no
argument, or you were pointed at this file directly, treat it as empty: reconcile, then continue
at the first incomplete phase. Route on the argument:

| Argument | Action |
|---|---|
| (none) | Reconcile, print the table, continue at the first incomplete phase |
| `status` | Reconcile, print the table, stop |
| `plan` | P1 |
| `capture` | P2 |
| `compose` | P3 |
| `review` | P4 |
| `export` | P5 export and validate only; stop at "ready to upload" |
| `upload` | P5 upload gate G4 |
| `<locale>` such as `de-DE` | P6 for that locale |
| `cleanup` | P7 |

Recall and reconcile, always, before anything else:

1. Run `s1s status --json`. It reconciles `screens.ts`, the manifest and the files on disk,
   and lists orphaned manifest entries and stray exports. It never contacts the store. To
   list files by hand use `find`, not shell globs: one unmatched glob aborts the whole
   command in zsh.

```sh
s1s status --json; echo "exit $?"
cat screenshots/manifest.json
find screenshots/captures screenshots/out metadata/screenshots -name '*.png' 2>/dev/null | sort
find screenshots/captures -name '*.tmp.png' 2>/dev/null        # leftovers of a killed capture; delete them
git branch --show-current; git branch --list s1s/demo-data
git status --porcelain | wc -l; git status --porcelain -- screenshots metadata/screenshots
xcrun simctl list devices booted
```

2. For each locale x size x screen compare three signals: manifest status, capture and render
   PNG on disk, export PNG on disk. Optional fourth signal, only when `app.appId` and
   `locales.<l>.versionLocalizationId` exist:
   `asc screenshots list --version-localization <id> --output json`. The store is authoritative
   for what shipped: an image the store holds is `uploaded` unless `wasUploaded` is true or the
   export sha differs from `exportSha256`; then report it as shipped-but-stale and route to
   review, export, re-upload, clear `wasUploaded`.
3. Compute the effective status with the decision table in
   [references/manifest-schema.md](references/manifest-schema.md) section 7. Report it; do not
   write the manifest until the human confirms the resume point. For a `reuse:<l>` locale check
   `captures/<l>/`, never `captures/<locale>/`. A missing render at `image-approved` or above
   means re-render (`out/` is gitignored): an unchanged hash keeps the status, a changed hash
   sets `generated`. Never upgrade on files alone except `uploaded` from the store.
4. Print the progress table, the demo-patch state (`demoData.appliedAt`, `revertedAt`, the
   current branch, whether branch `s1s/demo-data` exists), the booted sims and the dirty-file
   count:

```
locale  size        screens  pending  copy-ok  captured  generated  img-ok  exported  uploaded
en-US   iphone-6.9  6        0        0        0         6          0       0         0
en-US   ipad-13     5        0        0        5         0          0       0         0
demo patch: applied 2026-09-02T10:12Z, not reverted, on main, branch s1s/demo-data present
sims booted: none
git: 3 dirty files (2 outside screenshots/)
```

5. Confirm the resume point with the user in one question. Then continue. Skip this step for
   the `status` argument: print the table and stop.

## 5. P0 Preflight (gate G0)

Check the machine, then collect app facts.

```sh
s1s doctor && s1s bezels install && s1s bezels list
cat .xcodebuildmcp/config.yaml 2>/dev/null
xcodebuild -list -json 2>/dev/null | head -80
PBX=$(find . -maxdepth 3 -name project.pbxproj -not -path '*/node_modules/*' | head -1); echo "$PBX"
grep -h -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*' "$PBX" | sort -u
grep -h -o 'TARGETED_DEVICE_FAMILY = [^;]*' "$PBX" | sort -u
grep -A12 'knownRegions' "$PBX" | head -20
grep -c 'SDKROOT = watchos' "$PBX"                               # > 0 means a watch target
xcodebuild -list -json 2>/dev/null | jq -r '.project.targets[]'   # target names; watch targets usually say so
find . -name '*.xcstrings' -not -path '*/build/*' -not -path '*/node_modules/*' | head
find metadata -maxdepth 2 2>/dev/null | head -40
grep -n -i 'launch\|simulator\|approval' AGENTS.md CLAUDE.md 2>/dev/null
asc apps list 2>/dev/null
```

Decide: device families (`TARGETED_DEVICE_FAMILY` 1 = iPhone, 2 = iPad), app locales
(`knownRegions` plus `.xcstrings` languages), App Store app id, scheme, bundle ids,
launch-approval rules in AGENTS.md or CLAUDE.md. Watch rule: any target with
`SDKROOT = watchos`, or a `*.watchkitapp` bundle id in the `PRODUCT_BUNDLE_IDENTIFIER` grep,
means `--watch` on `s1s init` (size `watch-s10`) and `app.watchBundleId` in the manifest.
If `screenshots/` is missing, scaffold it:

```sh
s1s init --app-name "<Name>" --bundle-id <bundle> --app-id <ascAppId> --locales en-US --sizes iphone-6.9,ipad-13
# add --watch for a watch target; add --force to update an existing project without touching authored files
```

Write to the manifest: `app{name,bundleId,watchBundleId,appId,project,scheme,deviceFamilies,
sourceLocale,appLocales,metadataDir,preflightAt}` and `sizes` for each planned size.
G0: show the facts and the planned size set. Ask for approval to launch the app in a Simulator
later (repo rules often require it because a launch can reach live services). Stop until
answered. On yes write `demoData.launchApprovedAt` (ISO) and `demoData.launchApprovedBy: "user"`;
later phases launch only when these keys exist and ask again only when they are absent.

## 6. P1 Discovery and copy (gate G1)

Follow [references/copy-playbook.md](references/copy-playbook.md) end to end: benefit discovery
questions, verb-first headline formula, story arc, brand colour, one appearance, the new ASO
keyword pass. Inputs:

```sh
find metadata/app-info metadata/version -maxdepth 2 2>/dev/null
cat metadata/version/*/en-US.json 2>/dev/null | head -80
# missing metadata: offer `asc metadata pull` or the asc-aso-audit skill before writing copy
grep -rn -i 'struct .*View\b' --include='*.swift' . | grep -v -i 'test\|preview' | head -60
```

Plan 5 to 8 screens. For each: `id`, order, benefit, template (see
[references/template-catalog.md](references/template-catalog.md)), capture route, data state.
Write:

- `screenshots/plan.md`: a table with order, id, benefit, headline, highlight, subline,
  template, capture route, plus brand colour and appearance.
- `screenshots/copy/en-US.json`: `screens.<id>.{headline,highlight,subline,badge,layoutNotes}`.
  Write explicit line breaks as an array headline. `approved: false` until G1.
- `screenshots/screens.ts`: the same ids in the same order, `sizes`, `locales`, `only` for
  screens that skip a family.
- manifest `screens[] { id, order, benefit, template, sizes, capture: { steps: [], dataState } }`
  and `locales.en-US { copyStatus: "draft", captureSource: "own", devices: {} }`.

G1: show the plan table and every headline. Ask for approval, apply push-back edits, repeat until
approved. Then set `copy.approved = true`, `copyStatus: "approved"`, and run
`s1s status --set copy-approved --locale en-US --from pending --yes`; higher statuses stay put
(a changed headline shows up as a new render hash on the next `s1s render`). Offer a commit:
`ios: plan App Store screenshots and copy`.

## 7. P2 Capture (gate G2)

Full recipe, navigation-steps convention, watch scenes and troubleshooting:
[references/capture-playbook.md](references/capture-playbook.md). Shell variables do not
survive between Bash calls: put the `IPHONE=$(...)` line from step 4 at the head of every
chain. The chain:

1. Decide from the reconcile output:
   - Branch `s1s/demo-data` exists: `git switch s1s/demo-data`, continue at step 4.
   - Branch missing, `screenshots/captures/demo-data.patch` exists: re-apply it with
     capture-playbook section 2.5 including its WIP commit, then continue at step 4.
   - Neither: record the baseline, then branch:

```sh
mkdir -p screenshots/captures && git status --short > screenshots/captures/git-status-before.txt && git rev-parse HEAD
git switch -c s1s/demo-data
```

   Write manifest `demoData { branch: "s1s/demo-data", baseCommit, baselineFile:
   "captures/git-status-before.txt" }` now; P7 compares against the file.
2. Add the demo-data patch: a `ScreenshotMode.swift` (enabled by an env flag, for example
   `S1S_SCREENSHOTS=1`; the name is per app and goes into `demoData.envFlag` as the bare
   variable name) plus minimal call sites at app start and in the data layer. All of it
   `#if DEBUG` and gated on the flag. Rules learned the hard way:
   - Files in a file-system-synchronized group compile into every target that owns the folder.
     Keep shared code platform-neutral or wrap it in `#if os(iOS)`.
   - HealthKit cannot be pre-granted with `simctl privacy`. Bypass the authorization check in
     screenshot mode and serve fixture data.
   - Use in-memory or seeded stores; never let demo data reach iCloud or CloudKit.
   - Location, photos, contacts, calendar, reminders, motion, microphone and Siri can be
     granted with `xcrun simctl privacy`. Camera, notifications and HealthKit cannot; bypass
     them inside the screenshot flag.
3. Pick the DerivedData path, build-check against a device-independent destination, then save
   the patch and a WIP commit on the branch (the real build against the sim happens in step 5):

```sh
DD=build/DerivedData
git check-ignore -q build || DD="$HOME/Library/Caches/s1s/DerivedData/<App>"
xcodebuild -project <App>.xcodeproj -scheme <Scheme> -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DD" build 2>&1 | tail -5
git add <the new and edited demo-data files>      # by name, never -A
git commit -m "TEMP: screenshot demo data (do not merge)"
git diff main...HEAD > screenshots/captures/demo-data.patch
```

   Repeat the two `DD` lines at the head of every chain that builds, here and in step 5, and use
   `$DD` as the `APP=$(find ...)` root: an untracked `build/` fails the P7 pass condition.
   Write manifest `demoData { patch, envFlag, launchArg, appliedAt }`.
4. One live simulator at a time. Shut everything down, then reuse the dedicated sim by its
   unique name or create it (no iCloud account). Never reuse a UDID from a config file; they
   go stale. Read `xcrun simctl list runtimes` when the runtime id below differs.

```sh
xcrun simctl shutdown all
IPHONE=$(s1s sim list --json | jq -r '.devices[] | select(.name=="S1S-<App>-iPhone17ProMax") | .udid' | head -1)
[ -n "$IPHONE" ] || IPHONE=$(xcrun simctl create "S1S-<App>-iPhone17ProMax" "iPhone 17 Pro Max" com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcrun simctl boot "$IPHONE" && xcrun simctl bootstatus "$IPHONE" -b
s1s sim appearance "$IPHONE" dark && s1s sim status-bar "$IPHONE"
xcrun simctl privacy "$IPHONE" grant location <bundle>        # only what the screens need
xcrun simctl location "$IPHONE" set <lat>,<lon>                # only for map screens
```

5. Build for the sim, install and launch with the flag (`demoData.launchApprovedAt` must exist;
   otherwise ask G0 first). Repeat the `DD` lines from step 3:

```sh
DD=build/DerivedData
git check-ignore -q build || DD="$HOME/Library/Caches/s1s/DerivedData/<App>"
IPHONE=$(s1s sim list --json | jq -r '.devices[] | select(.name=="S1S-<App>-iPhone17ProMax") | .udid' | head -1)
xcodebuild -project <App>.xcodeproj -scheme <Scheme> -configuration Debug -destination "platform=iOS Simulator,id=$IPHONE" -derivedDataPath "$DD" build 2>&1 | tail -5
APP=$(find "$DD/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)
xcrun simctl install "$IPHONE" "$APP"
SIMCTL_CHILD_S1S_SCREENSHOTS=1 xcrun simctl launch --terminate-running-process "$IPHONE" <bundle> -AppleLocale en_US -AppleLanguages "(en)"
```

   XcodeBuildMCP path: `build_sim` -> `get_sim_app_path` -> `install_app_sim` ->
   `launch_app_sim` with `env` and `launchArgs`. `build_run_sim` has no `env`; do not use it here.
6. Per screen: navigate (accessibility ids with `snapshot_ui` and `tap`, or a debug menu, deep
   link or `defaults write`), wait for maps and animations, then capture and preview:

```sh
IPHONE=$(s1s sim list --json | jq -r '.devices[] | select(.name=="S1S-<App>-iPhone17ProMax") | .udid' | head -1)
s1s capture --udid "$IPHONE" --name <id> --device iphone --locale en-US
mkdir -p screenshots/out/preview && sips -Z 900 --out screenshots/out/preview/<id>.png screenshots/captures/en-US/iphone/<id>.png
```

   `s1s capture` verifies the pixel size, records path, sha256 and px, and sets `captured` from
   `pending` or `copy-approved`. A retake of a screen at `generated` or above keeps its status:
   set it back to `captured` right after the capture (allowed transition), or re-render it in
   the same step before anything else.
   Rate each preview Great, Usable or Retake with the rubric in the copy playbook; write
   `captureRating`, `captureNotes` and the exact `screens[].capture.steps` to the manifest.
7. Shut down before the next family: `xcrun simctl shutdown "$IPHONE"`. Repeat 4 to 6 with the
   iPad (`--device ipad`, sim "iPad Pro 13-inch (M5)"), then the watch (`--device watch`, sim
   "Apple Watch Series 11 (46mm)", watch scheme, scene env var per screen). `s1s sim status-bar`
   reports "unsupported" on watchOS; that is not a failure.
8. Return to main; the branch stays until P7 for re-shoots:

```sh
git switch main && git status --short | diff screenshots/captures/git-status-before.txt -     # only screenshots/ lines may differ
```

G2: list every capture with rating and notes. Ask for approval or retakes. Offer a commit:
`ios: add screenshot captures and demo-data patch`.

## 8. P3 Compose and render

Edit `screenshots/screens.ts` (template per screen, `overrides` per family, `capture` names, `only`,
and the project-level `panorama` when the user asked for one) and `screenshots/theme.ts` (background,
accent, text, highlight, fonts, headlineCase, bezelVariant). All eight built-in templates render
today; `bleed-bottom`, `tilted` and `watch-caption` are opt-in and need the user's yes. Brand font
files in `screenshots/fonts/` register themselves. Render one size at a time and fix before moving on:

```sh
s1s render --locale en-US --sizes iphone-6.9; echo "exit $?"
jq '.counts' screenshots/out/en-US/report.json
```

Then look, in this order:

1. Look at the sheet `screenshots/out/en-US/sheet-iphone-6.9.png` (one image, every screen):
   Read in Claude Code, `view_image` in Codex; otherwise `cat screenshots/out/en-US/review.md`
   and the jq lines in [references/agent-tooling.md](references/agent-tooling.md) section 4.
2. Read `screenshots/out/en-US/review.md`; the warnings there are authoritative. The codes
   you will see most: `text-min-size`, `text-clipped`, `overflow`, `capture-missing`,
   `capture-dims`, `image-missing` (a `background` or `panorama` file), `copy-missing`,
   `bezel-fallback`, `font-fallback`, plus `capture-fallback-locale` and `copy-unused`.
   [references/agent-tooling.md](references/agent-tooling.md) section 4 carries the full list.
3. Look only at warned or suspicious previews: `screenshots/out/en-US/APP_IPHONE_69/preview/NN-<id>.png`.

Checklist: no overflow, good line breaks, contrast, bezel alignment, 9:41 status bar, one
highlight word, headline case and weight consistent, same background treatment across the set,
locale text equals the JSON, watch unframed 416x496.
Autonomous fixes, at most 3 rounds per screen, only these three: explicit line breaks (array
`headline` or `subline`), a same-style template swap (`hero-top-text` <-> `text-bottom`), and
`props.deviceMaxWidth` on that screen when the set keeps one value per size. There is no
font-scale field; headline sizes are fixed per template. Any other change (a shorter word, a
dropped word, the brand colour, the appearance, a capture, the meaning) needs the user.
Repeat with `--sizes ipad-13`, then `--sizes watch-s10` (passthrough: only dims are checked).
Finish with a full run and require exit 0:

```sh
s1s render --locale en-US && s1s sheet --locale en-US
```

The CLI sets `generated`. Do not edit render fields by hand.

## 9. P4 Review (gate G3)

Give the human three things: the live gallery, the sheets and the review file.

```sh
s1s dev --locale en-US --open   # long-running; background it, report the URL, stop it in P7
ls screenshots/out/en-US/sheet-*.png screenshots/out/en-US/review.md
```

G3: ask for approval per size, or for changes. On changes go back to P3. On approval run
`s1s status --set image-approved --locale en-US --sizes iphone-6.9,ipad-13 --yes`. The write is
all-or-nothing: one image that cannot make the transition refuses the whole command (exit 2) and
leaves the manifest untouched; `--yes` confirms a selection that covers the whole locale. Exit 1
means the write landed but the reconcile after it is NOT OK; read the table, do not re-run.
Offer a commit: `ios: add App Store screenshot sources for en-US`.

## 10. P5 Export, validate, upload (gate G4)

Export and validate every approved size; the default end of the skill is "ready to upload":

```sh
s1s export --locale en-US && s1s validate --locale en-US
asc screenshots validate --path metadata/screenshots/en-US/APP_IPHONE_69 --device-type IPHONE_69
asc screenshots validate --path metadata/screenshots/en-US/APP_IPAD_PRO_3GEN_129 --device-type IPAD_PRO_3GEN_129
asc screenshots validate --path metadata/screenshots/en-US/APP_WATCH_SERIES_10 --device-type WATCH_SERIES_10   # watch only
```

Never copy PNGs into `metadata/screenshots/` by hand; `s1s export` owns that folder. It refuses an
incomplete set or one with error-level warnings, writes `NN.png` only when the hash changed, warns
about sibling `APP_*` folders with identical dims (asc fan-out uploads them twice), sets `exported`
(an image already `uploaded` keeps it and gets `wasUploaded: true`), and prints the section 7
upload command per display type with `--dry-run`. An unapproved set is not refused: it warns
`export-unapproved` and exports anyway, so G3 is yours to enforce. `--prune` deletes every
`NN.png|jpg|jpeg` the run did not write (else they are listed as `stale` and still upload),
`--dry-run` shows the plan, `--no-asc` skips the asc validation, `--metadata-dir <dir>` (also on
`s1s validate`, same value for both) points at an export root other than `app.metadataDir`.
`s1s validate` checks names `01..NN`, 1 to 10 files, accepted dims, no alpha, RGB, uniform dims,
and all-or-nothing over every locale folder (`--locale` narrows the table, never that rule). Size
and format rules: [references/apple-rules.md](references/apple-rules.md).
Offer a commit: `ios: export en-US App Store screenshots`.

Upload only when the user asks (argument `upload` or an explicit request), one device set per
gate. Exact commands, the editable-version rule and the verify query:
[references/asc-upload.md](references/asc-upload.md). Order of operations:

1. Resolve the app id, the version in `PREPARE_FOR_SUBMISSION` or `DEVELOPER_REJECTED`, and the
   version localization id `$LOC_ID`. Write `versionId`, `versionString`,
   `versionLocalizationId` to `locales.<l>`.
2. Dry-run the per-localization form (one folder into one set):
   `asc screenshots upload --version-localization "$LOC_ID" --path metadata/screenshots/en-US/APP_IPHONE_69 --device-type IPHONE_69 --dry-run --pretty`.
   The fan-out form (`--app --version --path metadata/screenshots`) is only for several
   complete locales at once and only when no sibling `APP_*` folder shares the dims
   (asc-upload.md section 8).
3. G4: show the dry-run summary. Ask. On yes, run the same command with `--replace` instead
   of `--dry-run`.
4. Verify with `asc screenshots list --version-localization "$LOC_ID" --output json` and
   compare `sets[].screenshots[]` file names and count. Then
   `s1s status --set uploaded --locale en-US --sizes iphone-6.9 --yes`: it writes `uploadedAt`,
   sets `uploaded` and clears `wasUploaded`. `s1s export` already wrote `storeFileName`.
5. Repeat for `IPAD_PRO_3GEN_129`, then `WATCH_SERIES_10`. Offer a commit:
   `ios: upload en-US App Store screenshots`.

## 11. P6 Localize `<locale>` (gates G5, G6, G7)

Procedure, brief template, glossary rules, expansion budgets and number rules:
[references/localize-playbook.md](references/localize-playbook.md). Steps:

1. Decide the capture source. If the locale is in `app.appLocales`: `captureSource: "own"`.
   Otherwise `captureSource: "reuse:en-US"`; write the warning into `plan.md` and tell the user
   that the UI in the images stays English.
2. Write `screenshots/copy/brief.md`: tone, audience, glossary that mirrors the terminology in
   `metadata/version/<v>/<locale>.json` and `metadata/app-info`. Read the store metadata first.
3. Transcreate `screenshots/copy/<locale>.json` from `en-US.json`. Keep one highlight word.
   Decide line breaks with the copy (array headlines). Add the locale to `locales` in
   `screens.ts` and `locales.<locale>` to the manifest with `copyStatus: "draft"`.
   `theme.headlineCase: 'title'` renders as sentence case outside English, so the copy
   carries the case: write each line as the language wants it.
4. G5: show en-US and `<locale>` side by side. Ask. On approval set `copyStatus: "approved"`,
   `approved: true`, then `s1s status --set copy-approved --locale <locale> --from pending --yes`.
5. Own captures only: re-enter the branch as in P2 step 1 (existing branch, else re-apply the
   patch), `xcrun simctl shutdown all`, then one fresh sim at a time resolved by name.
   `demoData.launchApprovedAt` must exist; otherwise ask G0. Launch with
   `-AppleLanguages "(<lang>)" -AppleLocale <lang>_<REGION>`, replay every
   `screens[].capture.steps`, capture with `s1s capture --locale <locale>`, then
   `git switch main`. A retake of a screen at `generated` or above: set it back to `captured`
   right after the capture, or re-render it in the same step.
6. Render and fix as in P3; expect longer text (de +30%, fr, es, pt +20%, ja, zh, ko -30%):

```sh
s1s render --locale <locale>; echo "exit $?"
jq '.counts' screenshots/out/<locale>/report.json
```

   A capture reused through `captureSource: "reuse:<l>"` reports `capture-fallback-locale`
   at info level; that is expected. The same code at warn level means nobody declared the
   reuse and this locale simply has no capture: fix it, never ship it.
7. G6: gallery `s1s dev --locale <locale>` (background; stopped in P7), sheets,
   `screenshots/out/<locale>/review.md`. On approval run
   `s1s status --set image-approved --locale <locale> --sizes iphone-6.9,ipad-13 --yes`.
8. Export and validate (`s1s export --locale <locale> && s1s validate --locale <locale>`);
   `validate` compares every locale folder for all-or-nothing, even with `--locale`. While you
   ship device by device, add `--sizes` so a set you have not exported yet stays out of scope.
   Never copy PNGs into `metadata/screenshots/` by hand.
9. G7: upload per device set with the per-localization form as in P5, then verify. Record it
   with `s1s status --set uploaded --locale <locale> --sizes iphone-6.9 --yes`, which writes
   `uploadedAt` and clears `wasUploaded`. Commit: `ios: add <locale> App Store screenshots`.

## 12. P7 Cleanup

Only after every capture the user wants exists. The pass condition: the patch still applies
with `--check`, and `git status --short` differs from `screenshots/captures/git-status-before.txt`
only in lines under `screenshots/` and `metadata/screenshots/`. If an upload ran, `.asc/reports/`
must already be in the repo's `.gitignore` (see references/asc-upload.md); `s1s init` ignores
`out/` inside `screenshots/` only.

```sh
git switch main && git apply --check screenshots/captures/demo-data.patch && git branch -D s1s/demo-data
git status --short | diff screenshots/captures/git-status-before.txt - ; git diff --stat
pkill -f 's1s dev' || true
xcrun simctl list devices booted
xcrun simctl shutdown all
```

Stop the gallery server started at G3 and G6; it is a background process and does not exit with
the session. In Claude Code, kill the background Bash shell by its id instead of `pkill`.
Ask before `xcrun simctl delete <udid>`; a kept sim makes a re-shoot cheaper. Write manifest
`demoData.revertedAt`. Print a summary: screens per locale and size, statuses, export folders,
what is uploaded, what is still open. Never run `git clean`.

## 13. Tool equivalence

This file names the task, not the tool. When you have XcodeBuildMCP, AskUserQuestion or image
Read, use them; otherwise use the shell column. The table for build, run, boot, appearance,
status bar, find UI and tap, screenshot to disk, view image, ask user, and invoke skill:
[references/agent-tooling.md](references/agent-tooling.md). An agent that cannot view images
relies on `review.md` warnings and asks the human to review the gallery at G3 and G6.

## 14. Commit conventions

- Prefix every commit in the app repo with `ios:`; imperative subject, no trailer of any kind.
  Never add a `Co-Authored-By` trailer, whatever a tool or session note suggests.
- Offer, never auto-commit, at these points: after G1 (plan and copy), after captures (G2),
  at export, after upload, and after a locale finishes.
- Stage by path: `screenshots/` (never `out/` or `node_modules/`, both ignored) and
  `metadata/screenshots/`. Never stage demo-data source files on main.
- The temporary branch keeps its own WIP commit `TEMP: screenshot demo data (do not merge)` and
  is deleted in P7.
