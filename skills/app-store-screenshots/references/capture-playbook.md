# Capture playbook

How to get marketing-grade simulator captures out of any iOS app: a small
temporary code patch that puts the app into a "screenshot mode", a fresh
simulator prepared to Apple's status-bar convention, one launch per device,
navigation to each planned screen, a pixel-exact screenshot recorded by
`s1s capture`, and a rating of every capture before you compose anything.

Paths are relative to the app repo. The tool is invoked as `s1s`. Every step
has a shell path; XcodeBuildMCP tools are named as alternatives where they help.

Sections:

1. Safety rules
2. The temporary demo-data patch
3. Simulator prep checklist
4. Build, install, launch
5. Navigate to each screen
6. Capture
7. Rate every capture
8. Record the navigation steps
9. Watch captures
10. Next device and teardown
11. Troubleshooting

---

## 1. Safety rules

Read these before the first launch. They protect production services and the
user's working tree.

- Read `AGENTS.md` and `CLAUDE.md` in the app repo first. Many repos require
  approval before any simulator launch because a launch can contact
  analytics, CloudKit, HealthKit or a backend. Ask the user before the first
  launch (gate G0 in SKILL.md). Never launch on silence.
- Record the working tree before you touch anything:

  ```sh
  git status --short > screenshots/captures/git-status-before.txt
  git rev-parse HEAD
  ```

  Record the commit as `manifest.demoData.baseCommit` and the file as
  `manifest.demoData.baselineFile: "captures/git-status-before.txt"`. P7 and
  the localize playbook compare against this file, never against memory.
  Pre-existing dirt stays untouched. Never run `git clean`, `git stash` on
  the user's changes, or `git add -A`.
- Use fresh, dedicated simulators with no iCloud account signed in. Name them
  `S1S-<App>-<Device>` so the name is unique in `xcrun simctl list`.
- Disable every network side effect inside the screenshot flag (section 2):
  analytics, crash reporting, CloudKit sync, push registration, remote config.
  Do not rely on the simulator being offline.
- HealthKit cannot be pre-granted. `xcrun simctl privacy` has no HealthKit
  service, so an app that gates on HealthKit authorization must bypass the
  check inside the screenshot flag (return "authorized" from its own wrapper).
  The same applies to any permission not listed by `xcrun simctl privacy`.
- One live simulator (or one paired phone + watch) at a time. XcodeBuildMCP
  drives a single default simulator, and two booted iOS sims double memory
  and confuse name lookups. Shut a device down before you boot the next one.
- Simulator UDIDs recorded in repo config files such as
  `.xcodebuildmcp/config.yaml` go stale when Xcode updates runtimes. Do not
  edit those files. Create your own sims and point the session at them with
  `session_set_defaults` (Claude Code) or explicit `--udid` / `<udid>` args.

---

## 2. The temporary demo-data patch

Real app UI with real data converts. Empty states, onboarding, permission
prompts and paywalls do not. The fix is a small, centralised, `#if DEBUG`
code change that the app reads from an environment variable at launch. It
lives on a throwaway branch, is exported as a patch for re-shoots, and is
reverted after the captures.

### 2.1 Create the branch

Check first; a killed session may have left the branch behind:

```sh
git branch --show-current; git branch --list s1s/demo-data; ls screenshots/captures/demo-data.patch 2>/dev/null
```

- Branch exists: `git switch s1s/demo-data` and continue at section 3.
- Branch missing but the patch exists: section 2.5.
- Neither: record the baseline (section 1), then `git switch -c s1s/demo-data`.

### 2.2 What a good screenshot flag does

Add one file, for example `Debug/ScreenshotMode.swift` (put it where the
app's DEBUG-only helpers live; in a synchronized-group project a new file
under an existing folder compiles with no pbxproj edit, so keep it
platform-neutral or wrap platform code in `#if os(iOS)`).

```swift
#if DEBUG
import Foundation

enum ScreenshotMode {
    static let isEnabled = ProcessInfo.processInfo.environment["S1S_SCREENSHOTS"] == "1"
        || CommandLine.arguments.contains("-s1s-screenshots")
    static let seed = UInt64(ProcessInfo.processInfo.environment["S1S_SEED"] ?? "") ?? 20260902
    /// Optional: open one screen directly (shell agents have no tap).
    static let scene = ProcessInfo.processInfo.environment["S1S_SCENE"]

    static func bootstrap() {
        // 1. Skip onboarding, paywalls, tips and permission prompts.
        // 2. Mark every permission the UI checks as granted (HealthKit, notifications).
        // 3. Seed deterministic, rich demo data from `seed`.
        // 4. Pin "now" so relative dates and charts are stable.
    }
}
#endif
```

The env names are per app. This playbook uses `S1S_SCREENSHOTS`, `S1S_SEED`,
`S1S_SCENE` and `S1S_WATCH_SCENE`. MotoFit, the pilot app, reads
`MOTOFIT_SCREENSHOT_MODE`, `MOTOFIT_SCREENSHOT_SEED` and
`MOTOFIT_WATCH_SCREENSHOT_SCENE` instead. Record the bare variable name the
app reads in `manifest.demoData.envFlag` and substitute it in every launch
line below (`SIMCTL_CHILD_<envFlag>=1`).

The flag should, in this order of importance:

1. Skip onboarding, paywall, sign-in, tips, "what's new" and rating prompts
   by setting the same flags the app persists after a real user passes them.
2. Bypass permission checks the UI gates on (HealthKit, notifications). For
   services `xcrun simctl privacy` supports (location, photos, contacts,
   motion, microphone, calendar), grant them from the shell instead (section 3).
3. Seed deterministic, rich data from a fixed seed: realistic names, full
   lists (6+ rows), charts with a trend, recent dates snapped to plausible
   days, values that look like a real power user. Use a splitmix64 or similar
   seeded RNG, never `Int.random`.
4. Disable analytics, crash reporting, CloudKit, push and remote config at
   the composition root (the `App.init` or `AppDelegate` entry point) before
   they configure. Unconfigured SDKs usually drop calls silently, which is
   what you want.
5. Use in-memory stores. For SwiftData:
   `ModelConfiguration(isStoredInMemoryOnly: true, cloudKitDatabase: .none)`.
   For Core Data use an in-memory store type. For custom stores return a
   fixture-backed implementation from the factory.
6. Pin the date. Route "now" through one function the fixture can override,
   or pick fixture dates relative to the launch date so they are always
   recent.
7. Hide debug UI: developer menus, "seeded data" banners, build labels,
   `[debug: ...]` markers, network status chips.
8. Prefer wiring `S1S_SCENE` to a direct route (`S1S_SCENE=detail-42` opens
   the detail screen). It makes every screen reachable from the shell with
   no taps and makes re-shoots replayable.

Keep the diff small and centralised. Every hook is one `if
ScreenshotMode.isEnabled { ... }` at an existing call site plus the fixture
file. Do not refactor. Do not touch release code paths outside `#if DEBUG`.
Do not comment out production checks; add a bypass beside them.

### 2.3 Build-check and format

Compile against a device-independent destination; the dedicated simulator
does not exist yet. The real build against `$UDID` happens in section 4.

Pick the DerivedData path first. `build/` must be gitignored: an untracked
`build/` fails the P7 pass condition, so when it is not ignored, build outside
the repo. Shell variables do not survive between Bash calls, so repeat the two
`DD` lines at the head of every chain that builds.

```sh
DD=build/DerivedData
git check-ignore -q build || DD="$HOME/Library/Caches/s1s/DerivedData/<App>"
xcodebuild -project <App>.xcodeproj -scheme <Scheme> -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DD" build 2>&1 | tail -20
```

Run the repo's formatter on the new files only. Check `git diff --stat` shows
no unrelated reformatting.

### 2.4 Commit and export the patch

Stage the patch files by name (never `-A`), make a WIP commit that cannot
be mistaken for real work, then export the diff:

```sh
git add Debug/ScreenshotMode.swift Debug/ScreenshotFixtures.swift <App>/<App>App.swift <other touched files>
git commit -m "TEMP: screenshot demo data (do not merge)"
mkdir -p screenshots/captures
git diff main...HEAD > screenshots/captures/demo-data.patch
git apply --check --reverse screenshots/captures/demo-data.patch   # sanity: applies to this tree
```

Use the real default branch name if it is not `main`. Keep the watch scenes
in a separate `screenshots/captures/watch-demo.patch` when the watch app has
its own fixture file (section 9).

Record it in `screenshots/manifest.json` under `demoData` (the agent owns
these fields):

```json
"demoData": {
  "patch": "captures/demo-data.patch",
  "branch": "s1s/demo-data",
  "baseCommit": "<git rev-parse main>",
  "envFlag": "S1S_SCREENSHOTS",
  "launchArg": "-s1s-screenshots",
  "appliedAt": "2026-09-02T09:41:00Z"
}
```

### 2.5 Re-shoot later

Reuse the branch when it still exists; otherwise recreate it from the patch
and make the WIP commit again (section 2.4):

```sh
git switch s1s/demo-data 2>/dev/null || { git switch -c s1s/demo-data main && git apply --check screenshots/captures/demo-data.patch && git apply screenshots/captures/demo-data.patch; }
```

If `git apply --check` fails, the app moved since the patch was made: stop and
report the rejected hunks. Set `manifest.demoData.appliedAt`, then continue
at section 3. The revert procedure is in SKILL.md Phase 7
(cleanup); do not skip it.

---

## 3. Simulator prep checklist

Create the devices once per app. Pick device types and runtimes from
`xcrun simctl list devicetypes` and `xcrun simctl list runtimes`; the ids
below are the ones on this machine at the time of writing.

```sh
IPHONE=$(xcrun simctl create "S1S-<App>-iPhone17ProMax" \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max \
  com.apple.CoreSimulator.SimRuntime.iOS-26-5)
IPAD=$(xcrun simctl create "S1S-<App>-iPadPro13-M5" \
  com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB \
  com.apple.CoreSimulator.SimRuntime.iOS-26-5)
# watch apps only:
WATCH=$(xcrun simctl create "S1S-<App>-Watch11-46" \
  com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-11-46mm \
  com.apple.CoreSimulator.SimRuntime.watchOS-26-5)
xcrun simctl pair "$WATCH" "$IPHONE"
echo "$IPHONE $IPAD $WATCH"
```

`s1s capture` records the UDID it used in `sizes.<sizeId>.udid`; never type
it by hand, and never reuse a UDID from an old config file without checking
`xcrun simctl list devices | grep <udid>`. Shell variables do not survive
between agent Bash calls, and the manifest field is empty before the first
capture, so resolve the sim by its unique name at the head of every chain:

```sh
IPHONE=$(s1s sim list --json | jq -r '.devices[] | select(.name=="S1S-<App>-iPhone17ProMax") | .udid' | head -1)
```

Run `xcrun simctl shutdown all` before you create or boot a device: one live
simulator at a time, and a same-named twin breaks name lookups. When the
name already resolves, skip `xcrun simctl create` and reuse that device.

Per iOS simulator, in this order, one device at a time:

```sh
UDID=$IPHONE                                  # then $IPAD
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b            # blocks until booted
# Region, ONCE per simulator: the region decides 12- vs 24-hour clock, and the
# status-bar override is formatted by the region, not by --time. A simulator
# created on a 24-hour region draws "09:41" and, on iPad, a date beside it.
xcrun simctl spawn "$UDID" defaults write -g AppleLocale -string en_US
xcrun simctl spawn "$UDID" defaults write -g AppleICUForce24HourTime -bool false
xcrun simctl shutdown "$UDID" && xcrun simctl boot "$UDID" && xcrun simctl bootstatus "$UDID" -b
xcrun simctl ui "$UDID" appearance dark       # or light; one appearance for the whole set
s1s sim status-bar "$UDID"                    # 9:41, Wi-Fi, full bars, full battery
xcrun simctl location "$UDID" set 37.3349,-122.0090   # only if a screen shows a map or location
xcrun simctl privacy "$UDID" grant location <bundle-id>       # per service the app asks for
xcrun simctl privacy "$UDID" grant photos <bundle-id>
```

Notes:

- REGION IS NOT THE APP'S LOCALE. Launching the app with `-AppleLocale en_US`
  changes what the app formats; it does not change what SpringBoard draws in
  the status bar. Check a capture's clock: Apple's marketing status bar reads
  `9:41` with no leading zero. `09:41` means the simulator region is a
  24-hour one and the two `defaults write` lines above are missing. It is a
  per-simulator setting and it survives reboots, so set it once when you
  create the device.
- `s1s sim status-bar <udid|name> [--time 9:41] [--clear]` wraps
  `xcrun simctl status_bar override`. Run it after every boot; the override
  does not survive a shutdown. It passes `--batteryState discharging
  --batteryLevel 100` on purpose: `charged` draws a lightning bolt through the
  battery, which is not Apple's marketing status bar. `s1s sim appearance <udid|name> light|dark`
  is the same as the `simctl ui` line.
- `xcrun simctl privacy` services: `calendar`, `contacts`, `location`,
  `location-always`, `photos`, `photos-add`, `media-library`, `microphone`,
  `motion`, `reminders`, `siri`, or `all`. No HealthKit, no notifications:
  bypass those in the flag. A grant can terminate a running app, so grant
  before you launch.
- Open the Simulator window if you want to watch (`open -a Simulator`), but
  captures do not need it.
- Claude Code alternative: `boot_sim` and `session_set_defaults` with the
  UDID, then the `simctl` lines above through Bash. There is no MCP tool for
  status bar, privacy or location.

---

## 4. Build, install, launch

Build Debug once per device family, install the `.app`, then launch with
the flag in the environment and the locale as launch arguments.

### Shell path

```sh
DD=build/DerivedData
git check-ignore -q build || DD="$HOME/Library/Caches/s1s/DerivedData/<App>"
xcodebuild -project <App>.xcodeproj -scheme <Scheme> -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DD" build 2>&1 | tail -5
APP=$(find "$DD/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)
xcrun simctl install "$UDID" "$APP"
SIMCTL_CHILD_S1S_SCREENSHOTS=1 SIMCTL_CHILD_S1S_SEED=20260902 \
  xcrun simctl launch --terminate-running-process "$UDID" <bundle-id> \
  -AppleLocale en_US -AppleLanguages "(en)"
```

- `simctl launch` forwards environment variables that carry the
  `SIMCTL_CHILD_` prefix; the app sees `S1S_SCREENSHOTS=1`.
- `-AppleLanguages "(en)"` needs the parentheses. For German:
  `-AppleLocale de_DE -AppleLanguages "(de)"`. This overrides the app
  language only; system dialogs stay in the simulator's language.
- `--terminate-running-process` makes the launch idempotent. Relaunch with a
  different `SIMCTL_CHILD_S1S_SCENE=<id>` to jump between screens.
- Use `-workspace <App>.xcworkspace` instead of `-project` when one exists.
- `git check-ignore -q build || DD="$HOME/Library/Caches/s1s/DerivedData/<App>"` --
  when `build/` is not ignored, use that path as `-derivedDataPath` and as the
  `APP=`/`WAPP=` search root in every block below, including the watch chain in
  section 9.

### Claude Code path (XcodeBuildMCP)

`build_run_sim` has no `env` parameter, so it cannot set the flag. Use the
four-step chain instead:

1. `session_set_defaults` with `projectPath`/`workspacePath`, `scheme`,
   `simulatorId` = the UDID from section 3.
2. `build_sim` (compile only).
3. `get_sim_app_path` with `platform: "iOS Simulator"`.
4. `install_app_sim` with that `appPath`.
5. `launch_app_sim` with
   `env: { "S1S_SCREENSHOTS": "1", "S1S_SEED": "20260902" }` (the tool adds
   the `SIMCTL_CHILD_` prefix) and
   `launchArgs: ["-AppleLocale", "en_US", "-AppleLanguages", "(en)"]`.

Cold-boot latency: a first launch on a fresh sim can take 30-60 s before
the first screen settles (framework caches, anonymous auth if not
bypassed). Wait; do not relaunch in a loop.

---

## 5. Navigate to each screen

The plan (`screenshots/plan.md`, manifest `screens[]`) names each screen and
its data state. Reach it, let it settle, then capture.

### Claude Code path

- `snapshot_ui` is the source of truth. It returns the accessibility tree
  with `elementRef` targets and exact on-screen strings. Call it after every
  navigation, scroll or sheet change; refs expire.
- `tap` one `elementRef` from the latest snapshot. Refs from text-only rows
  are not tappable; find the row's button or cell.
- `swipe` needs `withinElementRef` (the scroll view) plus `direction`; use
  `distance` 0.3-0.7 for a partial scroll. `drag` exists but current
  simulators reject it ("does not support touch move events"); use `swipe`
  for signature pads and sliders too.
- `type_text` types through a US keyboard: ASCII only, no umlauts or
  accents. Seed localized strings through the fixture instead of typing them.
- `snapshot_ui` text can contain accessibility artifacts (split words,
  VoiceOver descriptions of icon-only buttons). Trust the capture for what
  is rendered.
- `screenshot` from XcodeBuildMCP is for looking, not for the set: it does
  not verify pixel size or update the manifest. Capture with `s1s capture`.

### Shell path (Codex, Cursor, no tap tool)

Shell agents have no native tap. Plan the patch so taps are not needed:

- `S1S_SCENE=<screen-id>` in the flag routes straight to the screen
  (section 2.2). Relaunch per screen with the env var changed.
- Deep links: `xcrun simctl openurl "$UDID" "<scheme>://<route>"` when the
  app registers a URL scheme.
- Preferences: `xcrun simctl spawn "$UDID" defaults write <bundle-id> <key> <value>`
  before launch, for flags the app already reads (selected tab, last opened
  item, dismissed tips).
- A DEBUG-only navigation menu that the flag exposes, driven by the same
  env var.
- `xcrun simctl terminate "$UDID" <bundle-id>` before a relaunch with new
  state.

Where XcodeBuildMCP exists in the shell agent's environment, use it; the
tools are the same.

### Let the screen settle

- Map tiles and satellite imagery load over the network: wait at least 4 s
  after the map appears, capture, and check the preview for grey tiles.
  Retry with a longer wait or a small scroll-back to force a redraw.
- 3D scenes, SceneKit, Lottie and flyovers: wait about 3 s for the first
  frame, put the animation at the frame you want (pause control if the UI
  has one), then capture.
- Keyboards: dismiss them unless the screen is about typing.
- Toasts, tips, pull-to-refresh spinners and skeleton loaders must be gone.
- Scroll position: scroll to the top unless the plan says otherwise, and
  make sure no row is half cut at the bottom edge of the content area
  (partially cut rows are fine only at the device edge).

---

## 6. Capture

`s1s capture` screenshots the booted simulator, checks the pixel size against
the project's sizes for that family, writes
`screenshots/captures/<locale>/<family>/<name>.png`, and records path, sha256
and pixel size in `screenshots/manifest.json` for every screen in
`screens.ts` that references the name.

```sh
s1s capture --udid "$UDID" --name <screen-id> --device iphone --locale en-US
s1s capture --udid "$UDID" --name <screen-id> --device ipad  --locale en-US
s1s capture --udid "$WATCH" --name <scene-id> --device watch --locale en-US
```

- `--udid` accepts the UDID or the exact simulator name; a booted device
  wins a name tie. Prefer the UDID.
- `--name` is the capture name: the screen id, or the capture ref set in
  `screens.ts` (`capture: 'detail-top'`, or an array for two-device
  templates). Names are file-safe: letters, digits, `.`, `_`, `-`.
- `--locale` defaults to the source locale. Own-locale captures for a
  localized set go to `captures/<locale>/...`; the renderer falls back to the
  source locale's file when a locale has none and reports `capture-fallback-locale`
  (info when `locales.<locale>.captureSource` declares the reuse, warn when it does not).
- Add `--json` for a machine-readable result (`dims`, `sha256`, `screens`
  updated, `warnings`).
- The screenshot lands in a temp file first. A wrong size never overwrites a
  good capture: exact `captureDims` = ok; same aspect within 1% = written
  with a warning (renders repeat the warning); anything else = error naming
  the expected simulator, nothing written.
- A capture that no screen references is kept on disk with a note; check
  `screens.ts` if you expected a manifest update.

Raw fallback when `s1s` is unavailable on this machine:

```sh
mkdir -p screenshots/captures/en-US/iphone
xcrun simctl io "$UDID" screenshot --type=png --mask=ignored screenshots/captures/en-US/iphone/<screen-id>.png
sips -g pixelWidth -g pixelHeight screenshots/captures/en-US/iphone/<screen-id>.png
```

`--mask=ignored` keeps the full rectangular framebuffer (the bezel cut-out
does the rounding later). Run `s1s capture` again later so the manifest gets
the sha and size; or note the file in `captureNotes` so the fixer knows.

### Expected pixel sizes

| Size id | Simulator | Capture px | Output px | Framed |
|---|---|---|---|---|
| `iphone-6.9` (and alias `iphone-6.7`) | iPhone 17 Pro Max | 1320 x 2868 | 1320 x 2868 | yes |
| `iphone-6.5` | iPhone 14 Plus | 1284 x 2778 | 1284 x 2778 | yes |
| `iphone-6.1` | iPhone 17 Pro | 1206 x 2622 | 1206 x 2622 | yes |
| `ipad-13` | iPad Pro 13-inch (M5) | 2064 x 2752 | 2064 x 2752 | yes |
| `ipad-11` | iPad Pro 11-inch (M5) | 1668 x 2420 | 1668 x 2420 | yes |
| `watch-s10` | Apple Watch Series 11 (46mm) | 416 x 496 | 416 x 496 | no (raw) |
| `watch-ultra` | Apple Watch Ultra 3 (49mm) | 422 x 514 | 422 x 514 | no (raw) |

The capture must come from the listed simulator (or one with the same
screen). A different iPhone size renders resampled with a `capture-dims`
warning; a different aspect is refused.

### Naming and layout

```
screenshots/captures/<locale>/<family>/<name>.png
screenshots/captures/en-US/iphone/home.png
screenshots/captures/en-US/ipad/home.png
screenshots/captures/en-US/watch/mkt-stats.png
screenshots/captures/de-DE/iphone/home.png        # own-locale capture
screenshots/captures/demo-data.patch
screenshots/captures/watch-demo.patch
screenshots/captures/git-status-before.txt
```

Captures are committed with the project (they are the source for every
render and re-render). `screenshots/out/` is not.

---

## 7. Rate every capture

Apply the Great / Usable / Retake rubric from `copy-playbook.md` to every
capture before composing. Look at a downscaled preview, never the full-size
PNG (a 1320 x 2868 or 2064 x 2752 image is too large to inspect inline and
wastes context).

```sh
mkdir -p screenshots/out/preview
sips -Z 900 screenshots/captures/en-US/iphone/<name>.png --out screenshots/out/preview/<name>.png
```

Always pass `--out`. `sips -Z` without `--out` resizes the capture in place
and destroys it. Then view `screenshots/out/preview/<name>.png` (Read in
Claude Code; any image viewer otherwise). An agent that cannot view images
reports the file list and asks the human to rate.

Rate each capture and write the verdict into the manifest image state
(`locales.<locale>.devices.<sizeId>.screens.<id>.captureRating` =
`great | usable | retake`, plus `captureNotes`):

- Great: rich, realistic data; the benefit is visible at thumbnail size;
  clean 9:41 status bar; no chrome that distracts.
- Usable: correct screen and state, minor flaws that the frame or crop
  hides.
- Retake: any of the common problems below.

Common problems (retake):

- Empty states, placeholder data, "no results", "Test Item 1".
- Too little content (a list with 1-2 rows, a chart with one point).
- Debug UI, console text, developer indicators, seeded-data banners.
- Status bar clutter: carrier name, low battery, a time other than 9:41.
- Grey map tiles, unloaded images, skeleton loaders, spinners.
- Keyboards, toasts, tips, alerts or system prompts in the way.
- Onboarding, sign-in, settings, paywall screens (almost never material).
- Dark/light mismatch with the rest of the set.
- Text that only makes sense at full size; no visual hierarchy.

Fix a retake at the source (fixture data, scroll position, wait time), then
capture again with the same `--name`; the manifest sha updates. A screen that
is already `generated` or higher keeps its status on a retake: set it back to
`captured` right away (an allowed transition), or re-render it before you do
anything else, so no stale render survives a killed session.

---

## 8. Record the navigation steps

A re-shoot (new locale, new app version, retake) must be replayable without
rediscovery. After each capture, record how you got there in
`screenshots/manifest.json` `screens[].capture`:

```json
{
  "id": "ride-detail",
  "order": 1,
  "benefit": "Every ride on the map",
  "template": "hero-top-text",
  "sizes": ["iphone-6.9", "ipad-13"],
  "capture": {
    "steps": [
      "Launch with S1S_SCREENSHOTS=1 S1S_SEED=20260902.",
      "Tap tab 'Rides'.",
      "Tap first row (hero ride, most recent Sunday).",
      "Wait 4 s for map tiles.",
      "Capture at top scroll position."
    ],
    "deepLink": "S1S_SCENE=ride-detail",
    "dataState": "Seeded roster; hero ride = 14 laps at Glen Helen",
    "notes": "iPad: same steps; drop the dashboard shot on iPad."
  }
}
```

Conventions:

- `steps`: short imperative strings, one action each, in order. Name UI
  elements by their visible label or accessibility id, not by coordinates.
  Include waits and scroll positions.
- `deepLink`: the env scene, URL scheme or `defaults write` that skips the
  taps, when one exists.
- `dataState`: what the fixture must show for this screen (counts, the
  highlighted item, the selected date).
- `notes`: per-device differences, known flakiness, what to avoid.

The steps are also the checklist for the human when they retake a screen by
hand.

---

## 9. Watch captures

Apple Watch screenshots are raw and unframed. Two sizes are available and one
watch set satisfies Apple, so pick the watch the app's audience wears:
416 x 496 from the Series 11 46mm simulator (`watch-s10`, folder
`APP_WATCH_SERIES_10`) or 422 x 514 from the Ultra 3 (`watch-ultra`, folder
`APP_WATCH_ULTRA`). The renderer
copies the capture through unchanged, so the capture is the final image:
compose the marketing state inside the watch app.

A watch capture also feeds `phone-watch`, which stands the watch beside the
phone on one iPhone or iPad frame. That frame follows the size prefix on the
capture ref, so a `watch-ultra:` capture arrives in an Ultra 3 bezel; see
`template-catalog.md`.

Patch: give the watch app a scene switch driven by an env var, in its own
DEBUG-only file (`watch-demo.patch`). Each scene is a full screen with
fixture values chosen to read as marketing (a round number, a personal best,
a mid-workout state). Watch mode must also skip analytics and CloudKit.

```sh
xcrun simctl boot "$IPHONE" && xcrun simctl bootstatus "$IPHONE" -b     # the paired phone
xcrun simctl boot "$WATCH"  && xcrun simctl bootstatus "$WATCH" -b
DD=build/DerivedData
git check-ignore -q build || DD="$HOME/Library/Caches/s1s/DerivedData/<App>"
xcodebuild -project <App>.xcodeproj -scheme "<Watch Scheme>" -configuration Debug \
  -destination "platform=watchOS Simulator,id=$WATCH" \
  -derivedDataPath "$DD" build 2>&1 | tail -5
WAPP=$(find "$DD/Build/Products/Debug-watchsimulator" -maxdepth 1 -name '*.app' | head -1)
xcrun simctl install "$WATCH" "$WAPP"
SIMCTL_CHILD_S1S_WATCH_SCENE=<scene-id> \
  xcrun simctl launch --terminate-running-process "$WATCH" <watch-bundle-id>
sleep 3
s1s capture --udid "$WATCH" --name <scene-id> --device watch --locale en-US
```

- The watch app has its own bundle id (`manifest.app.watchBundleId`), often
  `<bundle-id>.watchkitapp`. `get_sim_app_path` with
  `platform: "watchOS Simulator"` finds the built `.app` in Claude Code.
- An embedded watch app also installs onto the paired watch when the iOS
  app is installed on the paired phone and both are booted; installing the
  watch build directly is more reliable for launching with env vars.
- Pairing is required for iOS screens that show a paired-watch state and
  for the embedded install. The paired phone plus watch counts as one live
  device set.
- THE WATCH CLOCK CANNOT BE PINNED, and rendering it inside the scene does
  not work either. `xcrun simctl status_bar <watch udid> override --time`
  answers "Status bar overrides not supported on this platform"
  (NSPOSIXErrorDomain 45), and watchOS composites its own clock ABOVE the
  app's window: an in-app `.overlay(alignment: .topTrailing)` that painted an
  opaque plate plus "10:09" over the measured clock rect (x 297-383, y 38-62
  at 416 x 496) was still covered by the system digits, and a
  `ToolbarItem(placement: .topBarTrailing)` never appeared at all. Both were
  tried and reverted on MotoFit in W4c; do not spend the afternoon again.
  Until s1s can paint the time onto the passthrough PNG, the mitigation is to
  shoot every watch scene inside ONE clock minute so at least the set agrees
  with itself: wait for a minute boundary, then run one shell loop of
  launch -> `sleep 3.5` -> `s1s capture` per scene, no agent round trips in
  between. A drag or tap in the middle of that loop makes it impossible, so
  prefer `.defaultScrollAnchor` in the scene over a scripted drag.
- No Apple Watch bezel exists in `BEZEL_SOURCES`, and the watch preset is
  passthrough, so a watch capture cannot be composed inside an iPhone or iPad
  canvas. If the set needs to show the watch to phone shoppers, the only
  lever today is a `badge` on a phone screen.
- Relaunch with a different scene id per capture. Screens in `screens.ts`
  for the watch use template `raw` with `capture: '<scene-id>'`.

---

## 10. Next device and teardown

Work through devices in this order: iPhone, then iPad, then watch. Between
devices:

```sh
xcrun simctl shutdown "$UDID"
```

Boot the next one and repeat section 3 (status bar and appearance are per
boot) and section 4 (a Debug build is per family; the iPad uses the iOS
build). Reuse the recorded `capture.steps`.

When every capture is rated Great or Usable:

1. Shut down all sims: `xcrun simctl shutdown all`.
2. Commit the captures, patch files and manifest on the app's main branch
   as part of the `screenshots/` commit (SKILL.md offers this after G2), with
   the repo's commit prefix and no trailer lines.
3. Revert the demo-data branch per SKILL.md Phase 7: switch to main, confirm
   `git apply --check screenshots/captures/demo-data.patch` passes, delete
   the branch, confirm `git status --short` differs from
   `screenshots/captures/git-status-before.txt` only by `screenshots/`.
   Set `demoData.revertedAt` in the manifest.

Do not delete the `S1S-*` simulators until the set is uploaded; a re-shoot
is cheap while they exist.

---

## 11. Troubleshooting

- `install_app_sim` fails with "405" or "Shutdown": the device name matched
  two simulators (OS twins). Use the UDID, or names unique in
  `xcrun simctl list devices`.
- `s1s capture` error "produced WxH; expects ...": wrong simulator for the
  size, or a landscape/zoomed display setting. Boot the listed simulator.
  Check `xcrun simctl io "$UDID" enumerate` shows one internal display.
- The app shows onboarding or an empty list: the flag did not reach the
  process. Check the env var name matches the patch, the `SIMCTL_CHILD_`
  prefix is present, and the app was relaunched with
  `--terminate-running-process` (an already running app keeps its old
  environment). Confirm the Debug build was installed, not a Release build.
- Grey map tiles: network or tile cache; wait longer, pan slightly, capture
  again. If the sim has no network, check the Mac's connection; the simulator
  shares it.
- `snapshot_ui` returns `SNAPSHOT_EXPIRED` or `MISSING`: take a new snapshot;
  taking a screenshot in between invalidates refs.
- Permission dialog appears at launch: grant it from the shell before launch
  (`xcrun simctl privacy ... grant`), or bypass in the flag for services
  simctl does not support (HealthKit, notifications). Close the dialog with
  a tap only as a last resort; it may come back on relaunch.
- Status bar shows the real time after a relaunch: rerun
  `s1s sim status-bar "$UDID"`; the override is lost on shutdown, not on
  app relaunch.
- Stale UDID from a config file: `xcrun simctl list devices | grep <udid>`
  returns nothing. Create fresh sims (section 3) and use those.
- Debug build unlocks paid tiers automatically in some apps: good for
  screenshots; note in `captureNotes` that the paywall itself was not
  capturable.
- Dark mode not applied: `xcrun simctl ui "$UDID" appearance` prints the
  current value; set it before launching the app, then relaunch.
