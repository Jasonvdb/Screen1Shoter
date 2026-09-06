# Agent tooling: Claude Code tools and their shell equivalents

The skill names the task, not the tool. This file maps every task in the
workflow to two paths: the Claude Code path (XcodeBuildMCP, `Read` on images,
`AskUserQuestion`) and the shell path (`xcodebuild`, `xcrun simctl`, `s1s`,
`sips`, `jq`). Use the Claude Code column when those tools exist in your
session. Use the shell column otherwise. Both columns end in the same files
on disk and the same fields in `screenshots/manifest.json`.

Rules that hold in both columns:

- `s1s` is the only entry point for project state. Capture with
  `s1s capture`, render with `s1s render`, never write render or capture
  fields into the manifest by hand.
- Every command runs from the app repo root. Paths below are relative to it.
- One live simulator at a time (a paired phone plus watch counts as one).
- `s1s status` reconciles locally only: it never contacts App Store Connect,
  so `asc screenshots list` stays authoritative for what is shipped.

---

## 1. Invoke the skill

| Agent | Invocation | Notes |
|---|---|---|
| Claude Code | `/app-store-screenshots [argument]` | Slash command; the skill is linked at `~/.claude/skills/app-store-screenshots`. |
| Codex | `$app-store-screenshots [argument]` | Linked at `~/.codex/skills/app-store-screenshots`. |
| Cursor | Open `SKILL.md` from `~/.agents/skills/app-store-screenshots` or `~/.claude/skills/...` and follow it. | Cursor reads both stores. |

Arguments: `status | plan | capture | compose | review | export | upload |
<locale> | cleanup`. No argument means: reconcile, then continue at the first
incomplete phase. Install or refresh the links with
`scripts/install-skills.sh` from the Screen1Shoter checkout; check with
`scripts/install-skills.sh --check`.

---

## 2. Task table

Read a row left to right: the task, the Claude Code path, the shell path.
`$UDID` is the simulator you created in P2 (SKILL.md section 7, step 4),
resolved by its unique name at the head of every chain (section 3).
`<bundle>` is `app.bundleId` from the manifest. `S1S_SCREENSHOTS` and
`S1S_SEED` are the env names the demo-data patch reads
(`manifest.demoData.envFlag`); `launch_app_sim` adds the `SIMCTL_CHILD_`
prefix for you, `xcrun simctl launch` does not.

| Task | Claude Code (XcodeBuildMCP) | Shell (Codex, Cursor, any agent) |
|---|---|---|
| Check which project, scheme and simulator the session targets | `session_show_defaults` (call it once before the first build in a session) | `cat .xcodebuildmcp/config.yaml; xcodebuild -list -json \| head -60` |
| Point the session at the fresh simulator | `session_set_defaults` with `projectPath` (or `workspacePath`), `scheme`, `configuration: "Debug"`, `simulatorId: "$UDID"`, `bundleId`. Do not pass `persist: true`. | Not needed. Pass `$UDID` to every `xcrun simctl` call and `-destination "platform=iOS Simulator,id=$UDID"` to `xcodebuild`. |
| List simulators | `list_sims` | `s1s sim list` or `xcrun simctl list devices available` |
| Create a fresh simulator | No tool; use the shell. | `UDID=$(xcrun simctl create "S1S-<App>-iPhone17ProMax" "iPhone 17 Pro Max" com.apple.CoreSimulator.SimRuntime.iOS-26-5)` |
| Boot the simulator | `boot_sim` (uses the session default) | `xcrun simctl boot "$UDID" && xcrun simctl bootstatus "$UDID" -b` |
| Open the Simulator window (optional, for a human watching) | `open_sim` | `open -a Simulator` |
| Set light or dark appearance | No tool; use the shell. | `s1s sim appearance "$UDID" dark` (wraps `xcrun simctl ui "$UDID" appearance dark`) |
| Set the 9:41 status bar | No tool; use the shell. | `s1s sim status-bar "$UDID"` (wraps `xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100 --operatorName ""`) |
| Grant a permission before launch | No tool; use the shell. | `xcrun simctl privacy "$UDID" grant location <bundle>`. Services: `location`, `location-always`, `photos`, `photos-add`, `media-library`, `motion`, `contacts`, `contacts-limited`, `calendar`, `reminders`, `microphone`, `siri`. Camera, HealthKit and notifications are not grantable; bypass them in the screenshot flag. |
| Set a simulated location | No tool in the default workflow; use the shell. | `xcrun simctl location "$UDID" set 34.1932,-117.3918` |
| Build the Debug app for the simulator | `build_sim` (compile only; no launch) | `xcodebuild -project <App>.xcodeproj -scheme <Scheme> -configuration Debug -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath build/DerivedData build 2>&1 \| tail -5` |
| Find the built `.app` | `get_sim_app_path` with `platform: "iOS Simulator"` (`"watchOS Simulator"` for the watch scheme) | `APP=$(find build/DerivedData/Build/Products/Debug-iphonesimulator -maxdepth 1 -name '*.app' \| head -1)` |
| Install the app | `install_app_sim` with `appPath` | `xcrun simctl install "$UDID" "$APP"` |
| Launch with the screenshot flag, seed and locale | `launch_app_sim` with `env: { "S1S_SCREENSHOTS": "1", "S1S_SEED": "20260902" }` and `launchArgs: ["-AppleLocale", "en_US", "-AppleLanguages", "(en)"]`. Never `build_run_sim`: it has no `env`. | `SIMCTL_CHILD_S1S_SCREENSHOTS=1 SIMCTL_CHILD_S1S_SEED=20260902 xcrun simctl launch --terminate-running-process "$UDID" <bundle> -AppleLocale en_US -AppleLanguages "(en)"` |
| Jump to a screen without tapping | `launch_app_sim` again with `env` including `"S1S_SCENE": "<screen-id>"` | Relaunch with `SIMCTL_CHILD_S1S_SCENE=<screen-id>` added, or `xcrun simctl openurl "$UDID" "<scheme>://<route>"`, or `xcrun simctl spawn "$UDID" defaults write <bundle> <key> <value>` before launch |
| Stop the app | `stop_app_sim` | `xcrun simctl terminate "$UDID" <bundle>` |
| Find UI elements and their identifiers | `snapshot_ui` (accessibility tree with `elementRef` targets; refresh after every navigation) | No native equivalent. Read the SwiftUI source for `accessibilityIdentifier` and plan scenes, deep links or a DEBUG menu instead. |
| Tap a control | `tap` with an `elementRef` from the latest snapshot | No native tap. Use `S1S_SCENE`, deep links or `defaults write` (row above). |
| Scroll a list | `swipe` with `withinElementRef` (the scroll view), `direction`, `distance` 0.3 to 0.7 | No native swipe. Give the scene a `scrollTo` in the patch, or capture the top of the screen only. |
| Type text | `type_text` with `elementRef` and ASCII `text` | No native typing. Seed the value in the fixture. |
| Press a hardware key | `key_press` with `keyCode` (40 Return, 42 Backspace, 43 Tab, 44 Space) | No equivalent. Avoid keyboards in screenshots. |
| Wait until a screen has settled | `wait_for_ui` with `predicate: "settled"` or `predicate: "exists"` plus `identifier` | `sleep 4` after launch or navigation; longer for map tiles (see the capture playbook) |
| Look at the screen (not for the set) | `screenshot` with `returnFormat: "path"`, then `Read` the path | `xcrun simctl io "$UDID" screenshot --type=png /tmp/look.png`, then view it (section 4) |
| Capture for the set | Same as the shell: run `s1s capture` through Bash. `screenshot` does not verify pixel size and does not update the manifest. | `s1s capture --udid "$UDID" --name <screen-id> --device iphone --locale en-US` |
| Make a preview of a capture | `sips -Z 900 screenshots/captures/en-US/iphone/<id>.png --out screenshots/out/preview/<id>.png`, then `Read` the preview | Same `sips` command, then view it (section 4). Always pass `--out`; without it `sips` overwrites the capture. |
| Read the render results | `Read screenshots/out/en-US/sheet-iphone-6.9.png`, then `Read screenshots/out/en-US/review.md`, then only warned previews under `screenshots/out/en-US/APP_IPHONE_69/preview/` | `cat screenshots/out/en-US/review.md` plus the `jq` recipes in section 4; view the sheet if you can |
| Show the human the live gallery | `s1s dev --locale en-US --open` in a background Bash call; report the URL | Same; report the URL and stop at the gate |
| Ask the human at a gate | `AskUserQuestion` with the options listed in SKILL.md for that gate | Print the question and the options as the last line of your turn. Stop. Never proceed on silence. |
| Stop the live gallery | Kill the background Bash shell by its id | `pkill -f 's1s dev' \|\| true` |
| Shut the simulator down | No tool; use the shell. | `xcrun simctl shutdown "$UDID"` (then `xcrun simctl delete "$UDID"` only when the user agrees) |
| Reconcile state | `s1s status --json` (local only; pair with `asc screenshots list` for the shipped state) | Same |
| Export and validate | `s1s export --locale en-US && s1s validate --locale en-US` | Same |

The `s1s` rows are identical on purpose. The tool is the shared surface; the
MCP tools only replace the Xcode and Simulator interaction around it.

`s1s dev` is long-running. It does not exit with the session and it holds a
port, so a second run of the skill starts another server on the next free
port. Stop it in P7 (SKILL.md section 12) with the "Stop the live gallery"
row above.

---

## 3. Permission batching

There is no permission allowlist on this machine. Every Bash call can prompt.
Reduce prompts like this:

- Prefer `s1s` subcommands over raw `xcrun simctl` where one exists
  (`s1s sim status-bar`, `s1s sim appearance`, `s1s sim list`, `s1s capture`).
  SKILL.md declares `Bash(s1s:*)` in `allowed-tools`, so those calls can be
  approved as a family.
- Join one logical step into one Bash call with `&&`. A failure stops the
  chain, so later commands never run on a broken state:

```sh
xcrun simctl boot "$UDID" && xcrun simctl bootstatus "$UDID" -b && s1s sim appearance "$UDID" dark && s1s sim status-bar "$UDID" && xcrun simctl privacy "$UDID" grant location <bundle>
```

```sh
s1s capture --udid "$UDID" --name <id> --device iphone --locale en-US && mkdir -p screenshots/out/preview && sips -Z 900 screenshots/captures/en-US/iphone/<id>.png --out screenshots/out/preview/<id>.png
```

- Keep a long-running command alone in its own call and run it in the
  background: `s1s dev`, `xcodebuild ... build` when it takes minutes.
- Export a shell variable and reuse it in the same call only; the shell does
  not persist between calls. Put this line at the head of every chain; it
  works before the first capture, when `sizes.<id>.udid` is still empty:

```sh
UDID=$(s1s sim list --json | jq -r '.devices[] | select(.name=="S1S-<App>-iPhone17ProMax") | .udid' | head -1)
```

  Alternatively pass the unique sim name to `--udid` and `<udid|name>`
  everywhere. `sizes.<id>.udid` in the manifest is CLI-written and only a
  hint.
- One unmatched glob aborts a whole zsh command (`no matches found`), and
  `2>/dev/null` hides the message. Use `find` to list files that may not
  exist: `find screenshots/captures screenshots/out metadata/screenshots -name '*.png' 2>/dev/null | sort`.
- Git is the exception. Run `git add <paths>`, `git commit -m ...`,
  `git status` and `git push` as four separate Bash calls, never joined with
  `&&`. This matches the user's `/commit` convention and its permission
  matching. Stage by path; never `git add -A`.
- Read-only checks (`git status --porcelain`, `git diff --stat`,
  `xcrun simctl list`) are safe to join with other read-only commands.

---

## 4. If you cannot view images

Codex has `view_image`; Claude Code has `Read` on PNG paths. Cursor and
plain shell agents may have neither. Do this when you cannot look at a PNG:

1. Treat the warnings as the authority. They come from the renderer, not from
   eyesight. Read them from `screenshots/out/<locale>/review.md` or query
   the JSON:

```sh
s1s render --locale en-US; echo "exit $?"
jq '.counts' screenshots/out/en-US/report.json
jq -r '.items[] | select((.warnings | length) > 0) | "\(.key) \(.status) " + (.warnings | map("\(.level):\(.code)") | join(","))' screenshots/out/en-US/report.json
jq -r '.items[] | select(.status == "failed") | "\(.key): \(.error)"' screenshots/out/en-US/report.json
```

   Exit 0 with `counts.errors == 0` means every screen fits and every capture
   was found. `text-min-size`, `text-clipped` and `overflow` mean copy or
   layout must change; `capture-missing`, `capture-dims` mean a capture must
   be redone; `image-missing` means a `background` or `panorama` file is
   absent; a warn-level `capture-fallback-locale` means the locale has no
   capture of its own and nobody declared a `reuse:` (an info-level one is a
   declared reuse and is expected); `bezel-fallback` means `s1s bezels install` has not run and
   `font-fallback` means the theme's font stack resolves to nothing on this
   machine (install the family, or ship the files in `screenshots/fonts/`).
2. Check pixel facts with `sips`, which needs no image viewer:

```sh
sips -g pixelWidth -g pixelHeight -g hasAlpha screenshots/out/en-US/APP_IPHONE_69/*.png
sips -g pixelWidth -g pixelHeight screenshots/captures/en-US/iphone/*.png
```

3. Start `s1s dev --locale en-US` (background) and give the human the
   gallery URL plus the sheet paths. Ask the human to rate captures
   (Great, Usable, Retake) and to approve renders at G2, G3 and G6. Write
   their verdicts into the manifest (`captureRating`, `captureNotes`,
   `image-approved`). Do not guess a rating.
4. Never resize, crop or "fix" a PNG blind. Change copy, `screens.ts`,
   `theme.ts` or the capture, then re-render.
5. Say in your gate message that you did not view the images. The human
   then knows to look closer.

With `view_image` (Codex) or `Read` (Claude Code), follow the visual QA order
in SKILL.md section 8: sheet first, then `review.md`, then only warned
previews. Never open a full-size render; a 1320 x 2868 PNG wastes context.

---

## 5. Exit codes

Every `s1s` command uses the same three codes: **0** ok, **1** the work ran
but the result is not ok, **2** the command refused and did nothing (usage).
Always `echo "exit $?"` and read the code with the output; several commands
print a full, healthy-looking table and still exit 1.

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `s1s status` | the reconcile is OK: every row has the files its status claims | the reconcile is NOT OK (a row claims `generated` with no render, `exported` with no export file, a stale render hash). Orphans and stray exports do not flip it | bad flag, unknown size, unknown status, `--set` without `--locale`, `--from` without `--set` |
| `s1s status --set` | the write happened (or `--from` matched nothing) and the resulting reconcile is OK | **the write happened** and the reconcile that follows it is NOT OK | refused, nothing written: a transition no image may make, a `--set` covering the whole locale without `--yes`, a selection that matches no image |
| `s1s export` | files copied (or nothing to copy); warnings may still be present | `export-blocked`, a failed `asc screenshots validate`, or an error-level warning | bad flag or unknown size |
| `s1s validate` | every set passes; the text ends `Ready to upload.` | any error-level problem, including "no export folder" and the cross-locale all-or-nothing rule | bad flag or unknown size |
| `s1s render` | rendered with no error-level warning | an item failed or any error-level warning (`--strict` promotes warn to error) | bad flag or unknown size |

The `status --set` row is the trap. The command re-reconciles after the write
and reports the state the write produced, so `--set exported` before the files
exist writes the manifest, prints `NOT OK` and exits 1. The stderr line
`set N image(s) to <status> in screenshots/manifest.json` is the only proof
the write landed; a refusal prints `Nothing was written.` instead. Never
retry a `--set` on exit 1 without reading `s1s status` first.

`--json` shapes, all under one envelope:

- Success is `{ ok: true, ... }`; failure is
  `{ ok: false, error: { code, message, hint } }`. The codes these commands
  raise: `export-blocked` (no render report, a dry-run report, an incomplete
  set, a failed item or an error-level warning), `validate-failed`,
  `config-invalid`, `copy-missing`, `manifest-invalid` and `usage`.
- `s1s render --json` prints `{ ok, report, sheets }`; `counts` and `items`
  live under `.report`. `screenshots/out/<locale>/report.json` is the raw
  report with `counts` and `items` at the top level.
- `s1s status` gives `rows[]`, `orphans[]`, `strayExports[]` and `summary`
  (status name to count); every row carries `status`, the `capture` / `render`
  / `export` file states, `renderStale` and `notes[]`. A `--set` run adds
  `set: "<status>"`.
- `s1s export` gives the `ExportReport`: `files[]` (each with `action`
  `written` / `unchanged` / `skipped`), `pruned[]`, `stale[]`, `warnings[]`,
  `asc`, `uploadCommands[]` and `fanOutCommands[]`.
- `s1s validate` gives `sets[]` and a flattened `problems[]`, each problem
  carrying `code`, `level` and often `file`, plus `metadataDir`, `locales`
  and `scanned`.

Both `s1s export` and `s1s validate` take `--metadata-dir <dir>` to work on
an export root other than `manifest.app.metadataDir`. It is absolute or
relative to the app repo root, and the two commands must be given the same
value or `validate` checks a folder the export never wrote.

---

## 6. XcodeBuildMCP parameter cheat sheet

Exact parameter names, so calls succeed on the first try.

| Tool | Parameters that matter here |
|---|---|
| `session_show_defaults` | none |
| `session_set_defaults` | `projectPath` or `workspacePath` (one of them), `scheme`, `configuration`, `simulatorId` (UDID) or `simulatorName`, `bundleId`, `derivedDataPath`, `env` (defaults for launches), `persist` (leave unset) |
| `build_sim` | none needed; `extraArgs` for extra `xcodebuild` flags |
| `get_sim_app_path` | `platform`: `"iOS Simulator"` or `"watchOS Simulator"` |
| `install_app_sim` | `appPath` |
| `launch_app_sim` | `env` (object; prefix added), `launchArgs` (array of strings) |
| `stop_app_sim` | none (uses the session `bundleId`) |
| `boot_sim` | none (uses the session simulator) |
| `snapshot_ui` | optional `sinceScreenHash` |
| `wait_for_ui` | `predicate` (`exists`, `gone`, `settled`, `textContains`, ...), plus `identifier`, `label`, `role` or `text`; `timeoutMs` |
| `tap` | `elementRef`; optional `preDelay`, `postDelay` in seconds |
| `swipe` | `withinElementRef` (required, not `elementRef`), `direction`, `distance` (0 to 1) |
| `type_text` | `elementRef`, `text` (ASCII), optional `replaceExisting` |
| `key_press` | `keyCode` (HID code) |
| `screenshot` | `returnFormat`: `"path"` |

The watch scheme is a separate session: call `session_set_defaults` again
with the watch scheme and `simulatorId` of the watch, then repeat build,
app path (`"watchOS Simulator"`), install, launch with
`env: { "S1S_WATCH_SCENE": "<scene-id>" }` per screen (the exact name is
whatever the watch patch reads; see the capture playbook).

---

## 7. Gotchas

- Stale UDIDs. `.xcodebuildmcp/config.yaml` stores `simulatorId`; it goes
  stale when Xcode updates runtimes, and the file may be committed. Check
  with `xcrun simctl list devices | grep <udid>`. If nothing prints, the
  device is gone. Create fresh `S1S-<App>-*` sims and use those.
- Do not edit `.xcodebuildmcp/config.yaml`. Point the session at your sim
  with `session_set_defaults` (`simulatorId`, no `persist`). The change lives
  in the session only, so the repo file stays as the user wrote it.
- `build_run_sim` cannot pass environment variables. The flag never reaches
  the app and you capture real data. Use `build_sim` -> `get_sim_app_path`
  -> `install_app_sim` -> `launch_app_sim(env, launchArgs)`.
- An already running app keeps its old environment. Relaunch with
  `--terminate-running-process` (shell) or `stop_app_sim` then
  `launch_app_sim` (Claude Code) after every env change.
- `type_text` is ASCII only (US keyboard). Umlauts, accents and CJK fail or
  come out wrong. Put localized values into the fixture data instead.
- `drag` exists as a tool but current simulators reject it ("does not support
  touch move events"). Use `swipe` with `withinElementRef` for scrolling,
  sliders and signature pads. Try `drag` only after `swipe` fails, and never
  send raw coordinates to any tool.
- `snapshot_ui` refs expire after navigation, scrolling, a sheet change or a
  `screenshot` call. Take a new snapshot before the next `tap`.
- `screenshot` (MCP) is for looking. It does not check `captureDims`, it
  does not write the manifest, and its output size can differ from the
  App Store size. Only `s1s capture` produces a capture for the set.
- `sips -Z` without `--out` overwrites the source file. Always pass `--out`.
- `xcrun simctl status_bar` is unsupported on watchOS. `s1s sim status-bar`
  reports it and exits 0; accept the real clock on the watch.
- HealthKit cannot be pre-granted (`xcrun simctl privacy` has no such
  service). Bypass the authorization check inside the screenshot flag.
- Two booted iOS simulators double memory use and break name lookups
  (`--udid "iPhone 17 Pro Max"` then matches two devices). Shut one down
  before booting the next; prefer the UDID over the name.
- Xcode file-system-synchronized groups compile every file under the folder
  into every target that owns it. A `Shared/Debug/ScreenshotMode.swift`
  lands in the iOS and the watch target. Keep it platform-neutral or wrap
  iOS-only code in `#if os(iOS)`.
- Files under `screenshots/out/` and `build/` are ignored. Never stage them.
  `git check-ignore build screenshots/out` prints both when the ignore rules
  are right.
- Shell variables do not survive between Bash calls. Resolve `$UDID` by sim
  name at the start of every chain (section 3).
- Exit codes and the `--json` shapes are in section 5. The one to remember:
  `s1s status --set` can write the manifest and still exit 1, because it
  reports the reconcile the write produced.
- Project fonts are per project, not per machine. A `font-fallback` on a
  theme that names a brand family means the files are not in
  `screenshots/fonts/` (or are misnamed), not that the machine is missing a
  system font.
