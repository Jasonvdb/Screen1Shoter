# Manifest schema: `screenshots/manifest.json`

One file per app repo holds the state of every screenshot: every locale,
every size, every screen. The CLI (`s1s`) and the agent both write it. This
document is the contract between them. Source of truth in the tool:
`src/config/types.ts` (types), `src/core/schemas.ts` (zod, loose),
`src/core/manifest.ts` (read, write, transitions).

Paths in this file are relative to the app repo unless stated. Paths stored
inside the manifest are relative to `screenshots/` (posix, forward slashes).

## 1. Files around the manifest

| File | Who writes it | Purpose |
|---|---|---|
| `screenshots/manifest.json` | CLI + agent | State: app facts, sizes, demo-data patch, screen plan, per-image status |
| `screenshots/screens.ts` | agent | Render matrix: screen ids, order, templates, captures. The order here sets the `NN` ordinal |
| `screenshots/theme.ts` | agent | Colours, fonts, bezel variant |
| `screenshots/copy/<locale>.json` | agent | Text per screen per locale (section 8) |
| `screenshots/captures/<locale>/<family>/<name>.png` | `s1s capture` | Simulator screenshots |
| `screenshots/out/<locale>/...` | `s1s render`, `s1s sheet` | Renders, previews, `report.json`, `review.md`, `sheet-<sizeId>.png`. Gitignored |
| `metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png` | `s1s export` | Upload layout for `asc` |
| `screenshots/captures/demo-data.patch` | agent | Temporary demo-data diff for re-shoots |

`screens.ts` decides what renders. The manifest records what happened. When
they disagree, `screens.ts` wins for the matrix and the ordinal; the manifest
wins for status.

## 2. Full annotated example

The real file is plain JSON with no comments. The `//` notes below explain
each field. Every top-level collection may be empty; the CLI fills defaults
on read (`sizes: {}`, `screens: []`, `locales: {}`, `runs: []`).

```jsonc
{
  "version": 1,                                   // always 1

  // ---- app: facts about the app repo. init writes it; the agent completes it (P0).
  "app": {
    "name": "MotoFit",                            // display name
    "bundleId": "moto.fit",                       // iOS bundle id (launch, privacy grants)
    "watchBundleId": "moto.fit.watchkitapp",      // optional: watch app bundle id
    "appId": "6743000000",                        // optional: App Store Connect app id (asc --app)
    "project": "MotoFit.xcodeproj",               // optional: .xcodeproj / .xcworkspace, relative to the app repo
    "scheme": "MotoFit",                          // optional: build scheme
    "deviceFamilies": ["iphone", "ipad", "watch"],// families the app ships
    "sourceLocale": "en-US",                      // locale the copy is written in first; capture fallback target
    "appLocales": ["en-US"],                      // locales the app itself ships (own captures possible)
    "metadataDir": "metadata/screenshots",        // export root, relative to the app repo
    "preflightAt": "2026-09-02T08:05:00.000Z"     // agent, free-form: P0 preflight finished
  },

  // ---- sizes: one entry per size id in screens.ts `sizes`. init writes it; capture updates simulator + udid.
  "sizes": {
    "iphone-6.9": {
      "displayType": "APP_IPHONE_69",             // export folder name
      "token": "IPHONE_69",                       // asc screenshots upload --device-type
      "px": { "width": 1320, "height": 2868 },    // exact output PNG size
      "simulator": "iPhone 17 Pro Max",           // simctl device name that produces captureDims
      "udid": "3F1B2C0D-0000-4000-8000-000000000001", // set by s1s capture; stale after simctl delete
      "framed": true                              // false = passthrough (watch)
    },
    "ipad-13": {
      "displayType": "APP_IPAD_PRO_3GEN_129",
      "token": "IPAD_PRO_3GEN_129",
      "px": { "width": 2064, "height": 2752 },
      "simulator": "iPad Pro 13-inch (M5)",
      "framed": true
    },
    "watch-s10": {
      "displayType": "APP_WATCH_SERIES_10",
      "token": "WATCH_SERIES_10",
      "px": { "width": 416, "height": 496 },
      "simulator": "Apple Watch Series 11 (46mm)",
      "framed": false
    }
  },

  // ---- demoData: the temporary code change that fakes marketing data. Agent-owned.
  "demoData": {
    "patch": "captures/demo-data.patch",          // relative to screenshots/
    "branch": "s1s/demo-data",                    // throwaway branch, never merged
    "baseCommit": "3ea67a5",                      // main commit the patch applies to
    "envFlag": "S1S_SCREENSHOTS",                 // bare env var name; launch with SIMCTL_CHILD_<envFlag>=1
    "launchArg": "-s1s-screenshots",              // launch argument alternative
    "baselineFile": "captures/git-status-before.txt", // git status --short recorded before the branch (P2)
    "launchApprovedAt": "2026-09-02T09:05:00.000Z",   // gate G0: the user approved launching the app in a sim
    "launchApprovedBy": "user",
    "appliedAt": "2026-09-02T09:10:00.000Z",      // set when the branch is created
    "revertedAt": "2026-09-02T14:30:00.000Z"      // set by P7 cleanup; absent = patch may still be applied
  },

  // ---- screens: the plan. Agent-owned. Mirrors screens.ts; order = App Store position.
  "screens": [
    {
      "id": "map",                                // = screens.ts id = copy key = capture name
      "order": 1,                                 // 1-based; keep equal to the position in screens.ts
      "benefit": "See every ride on a real map",  // the benefit the screen sells (P1)
      "template": "hero-top-text",                // informational; screens.ts decides
      "sizes": ["iphone-6.9", "ipad-13"],         // sizes this screen renders for
      "capture": {                                // how to reach the screen in the simulator (P2)
        "steps": [
          "Launch with S1S_SCREENSHOTS=1",
          "Tap tab 'Motos'",
          "Tap first row 'Glen Helen - Sunday'",
          "Wait 4 s for map tiles"
        ],
        "deepLink": "motofit://workout/hero",     // optional: shortcut instead of steps
        "dataState": "seed 20260902, hero ride",  // optional: which fixture the shot needs
        "notes": "Retake if any tile is grey"     // optional
      }
    },
    {
      "id": "watch-stats",
      "order": 1,                                 // order restarts per family: watch has its own set
      "benefit": "Live lap stats on the wrist",
      "sizes": ["watch-s10"],
      "capture": { "steps": ["Launch watch app with S1S_WATCH_SCENE=mkt-stats-heart"] }
    }
  ],

  // ---- locales: per locale, per size, per screen state. Mixed ownership (section 5).
  "locales": {
    "en-US": {
      "copyStatus": "approved",                   // pending | draft | approved (agent; G1 sets approved)
      "captureSource": "own",                     // own | reuse:<locale> (agent)
      "versionId": "9f2c1c8e-...",                // ASC app store version id (agent, P5)
      "versionString": "1.0.0",                   // ASC version string (agent, P5)
      "versionLocalizationId": "b41d0c6a-...",    // ASC version localization id (agent, P5)
      "devices": {
        "iphone-6.9": {                           // keyed by size id, not display type
          "screens": {
            "map": {                              // ImageState: one image
              "status": "uploaded",               // section 4
              "capture": "captures/en-US/iphone/map.png",           // s1s capture
              "captureSha256": "e3b0c442...",                       // s1s capture
              "capturePx": { "width": 1320, "height": 2868 },       // s1s capture
              "captureRating": "great",           // agent: great | usable | retake
              "captureNotes": "Hero ride, tiles loaded", // agent, free text
              "render": "out/en-US/APP_IPHONE_69/01-map.png",       // s1s render
              "renderHash": "2416a730bdcb7cbd720681ffe008e9567154b678", // s1s render, sha1 of the PNG
              "renderWarnings": [],               // s1s render; error-level entries block export
              "renderedAt": "2026-09-02T11:02:14.000Z",             // s1s render
              "export": "../metadata/screenshots/en-US/APP_IPHONE_69/01.png", // s1s export; see section 3
              "exportSha256": "a1b2c3...",        // s1s export
              "storeFileName": "01.png",          // s1s export; correct it from asc screenshots list if they differ
              "uploadedAt": "2026-09-02T13:40:00.000Z", // s1s status --set uploaded
              "wasUploaded": true                 // s1s render or s1s export moved an uploaded image; re-upload needed
            }
          }
        },
        "ipad-13": { "screens": { "map": { "status": "generated", "render": "out/en-US/APP_IPAD_PRO_3GEN_129/01-map.png", "renderHash": "bef37bb3...", "renderWarnings": [], "renderedAt": "2026-09-02T11:02:20.000Z" } } },
        "watch-s10": { "screens": { "watch-stats": { "status": "captured", "capture": "captures/en-US/watch/watch-stats.png", "captureSha256": "9c1d...", "capturePx": { "width": 416, "height": 496 } } } }
      }
    },
    "de-DE": {
      "copyStatus": "draft",
      "captureSource": "reuse:en-US",             // app does not ship German: render de-DE copy over en-US captures
      "devices": {}
    }
  },

  // ---- runs: command log. CLI appends (init, render); keeps the newest 50.
  "runs": [
    { "command": "s1s init", "startedAt": "2026-09-02T08:00:00.000Z", "finishedAt": "2026-09-02T08:00:00.000Z", "ok": true },
    { "command": "render --locale en-US --sizes iphone-6.9", "startedAt": "2026-09-02T11:02:10.000Z", "finishedAt": "2026-09-02T11:02:14.000Z", "ok": true, "notes": "6 rendered, 0 failed, 0 errors" }
  ]
}
```

## 3. Field reference

Optional fields are marked `?`. Unknown fields anywhere are kept by the CLI
(loose schema). Strings marked "ISO" are `new Date().toISOString()` values.

### `app`

| Field | Type | Owner | Notes |
|---|---|---|---|
| `name` | string | init, agent | Display name |
| `bundleId` | string | init, agent | `s1s init --bundle-id`; default `com.example.<slug>` |
| `watchBundleId?` | string | agent | Watch app bundle id |
| `appId?` | string | init, agent | ASC app id; `s1s init --app-id` |
| `project?`, `scheme?` | string | agent | Build facts from P0 |
| `deviceFamilies` | `("iphone"\|"ipad"\|"watch")[]` | init, agent | Derived from the sizes at init |
| `sourceLocale` | string | init | First `--locales` entry. `''` means "first locale in screens.ts" |
| `appLocales` | string[] | init, agent | Locales the app ships; drives `captureSource` |
| `metadataDir` | string | init | Default `metadata/screenshots` |
| `preflightAt?` | ISO | agent | Free-form key kept by the loose schema: P0 preflight finished. The agent never writes `runs[]` |

### `sizes.<sizeId>`

Keys are size ids: `iphone-6.9`, `iphone-6.7` (alias of 6.9, own export
folder), `iphone-6.5`, `iphone-6.1`, `ipad-13`, `ipad-11`, `watch-s10`,
`watch-ultra`.

| Field | Type | Owner | Notes |
|---|---|---|---|
| `displayType` | `APP_IPHONE_69` ... | init, capture | Export folder |
| `token` | string | init, capture | `asc ... --device-type` value |
| `px` | `{width,height}` | init, capture | Exact PNG size |
| `simulator` | string | init, capture | Preset name at init; the real device name after `s1s capture` |
| `udid?` | string | capture | Set by `s1s capture`; absent before the first capture. Treat as a hint: it goes stale when the sim is deleted. Resolve the sim by its unique name (`s1s sim list --json`) instead |
| `framed` | boolean | init, capture | `false` for either watch passthrough |

Preset facts (from `src/config/presets.ts`):

| Size id | Display type | Token | px | Capture simulator |
|---|---|---|---|---|
| `iphone-6.9` | `APP_IPHONE_69` | `IPHONE_69` | 1320x2868 | iPhone 17 Pro Max |
| `iphone-6.7` | `APP_IPHONE_67` | `IPHONE_67` | 1320x2868 (alias, rendered once) | iPhone 17 Pro Max |
| `iphone-6.5` | `APP_IPHONE_65` | `IPHONE_65` | 1284x2778 | iPhone 14 Plus |
| `iphone-6.1` | `APP_IPHONE_61` | `IPHONE_61` | 1206x2622 | iPhone 17 Pro |
| `ipad-13` | `APP_IPAD_PRO_3GEN_129` | `IPAD_PRO_3GEN_129` | 2064x2752 | iPad Pro 13-inch (M5) |
| `ipad-11` | `APP_IPAD_PRO_3GEN_11` | `IPAD_PRO_3GEN_11` | 1668x2420 | iPad Pro 11-inch (M5) |
| `watch-s10` | `APP_WATCH_SERIES_10` | `WATCH_SERIES_10` | 416x496 (passthrough) | Apple Watch Series 11 (46mm) |
| `watch-ultra` | `APP_WATCH_ULTRA` | `WATCH_ULTRA` | 422x514 (passthrough) | Apple Watch Ultra 3 (49mm) |

### `demoData?`

All fields optional strings, all agent-owned: `patch`, `branch`,
`baseCommit`, `envFlag`, `launchArg`, `appliedAt` (ISO), `revertedAt` (ISO).
`envFlag` is the bare variable name the app reads (`S1S_SCREENSHOTS`,
`MOTOFIT_SCREENSHOT_MODE`); the `=1` value belongs to the launch line only
(`SIMCTL_CHILD_<envFlag>=1 xcrun simctl launch ...`).
`revertedAt` absent while `appliedAt` is set means the working tree may still
carry the patch. Check `git status --porcelain` before any capture or cleanup.

Free-form keys the skill adds next to these (the loose schema keeps them):

| Key | Type | Set by | Meaning |
|---|---|---|---|
| `baselineFile` | string | P2 step 1 | Path (relative to `screenshots/`) of the `git status --short` recording made before the branch, normally `captures/git-status-before.txt`. P7 diffs against it |
| `launchApprovedAt` | ISO | G0 | The user approved launching the app in a Simulator. P2 and P6 launch only when it exists and ask again only when it is absent |
| `launchApprovedBy` | string | G0 | `"user"` |
| `watchPatch` | string | P2 | A second patch (watch-only scenes), for example `captures/watch-demo.patch` |

### `screens[]`

| Field | Type | Owner | Notes |
|---|---|---|---|
| `id` | string | agent | File-safe: `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Same id as in `screens.ts` |
| `order` | integer | agent | 1-based App Store position. Keep in step with `screens.ts` order |
| `benefit?` | string | agent | The user benefit this screen proves |
| `template?` | string | agent | Informational copy of the `screens.ts` template |
| `sizes` | size id[] | agent | Sizes the screen renders for |
| `capture?` | object | agent | `steps: string[]` (default `[]`), `deepLink?`, `dataState?`, `notes?` |

The ordinal `NN` in file names comes from the position of the screen among
the screens that apply to a size in `screens.ts` (`only` filters count). It
does not come from `order`. Keep the two equal so the manifest reads right.

### `locales.<locale>`

| Field | Type | Owner | Notes |
|---|---|---|---|
| `copyStatus` | `pending` \| `draft` \| `approved` | agent | Default `pending`. init sets the source locale to `draft`. G1/G5 set `approved` |
| `captureSource` | `own` \| `reuse:<locale>` | agent | `reuse:<l>` makes the render and `s1s capture` fallback look in `captures/<l>/` first. Default `own` |
| `versionId?` | string | agent | ASC app store version id (`asc versions list`) |
| `versionString?` | string | agent | For example `1.0.0` |
| `versionLocalizationId?` | string | agent | ASC version localization id for this locale (`asc screenshots list --version-localization`) |
| `devices` | map by size id | mixed | `devices.<sizeId>.screens.<screenId>` is an `ImageState` |

Capture fallback chain used by the render, in order: the `reuse:<l>` locale
(fallback `reuse`, info warning `capture-fallback-locale`), the own locale
(fallback `none`), the source locale (fallback `source-locale`, warn-level
`capture-fallback-locale`: nobody asked for those pixels, so the capture step
was skipped for this locale), placeholder (fallback `placeholder`,
`capture-missing`: error, or warn with `--allow-placeholder`).

### `ImageState` (`locales.<l>.devices.<size>.screens.<id>`)

| Field | Type | Owner | Set by |
|---|---|---|---|
| `status` | enum, section 4 | shared | `s1s capture` (to `captured`), `s1s render` (to `generated`), `s1s export` (to `exported`), `s1s status --set` for the agent-owned rest |
| `capture?` | string | CLI | `s1s capture`: `captures/<locale>/<family>/<name>.png` |
| `captureSha256?` | string | CLI | `s1s capture` |
| `capturePx?` | `{width,height}` | CLI | `s1s capture` |
| `captureRating?` | `great` \| `usable` \| `retake` | agent | Rubric result from the capture playbook |
| `captureNotes?` | string | agent | Free text |
| `render?` | string | CLI | `s1s render`: `out/<locale>/<APP_DISPLAY_TYPE>/NN-<id>.png` |
| `renderHash?` | string | CLI | sha1 of the final PNG bytes |
| `renderWarnings?` | `Warning[]` | CLI | `{code, level, message, element?}`. Project-level `copy-unused` infos are kept out of here |
| `renderedAt?` | ISO | CLI | Set when the hash changes |
| `export?` | string | CLI | `s1s export`: posix, relative to `screenshots/`, so `../metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png` |
| `exportSha256?` | string | CLI | sha256 of the exported file |
| `storeFileName?` | string | CLI | `s1s export` writes the name it wrote (`NN.png`); the agent may correct it from `asc screenshots list` |
| `uploadedAt?` | ISO | CLI | `s1s status --set uploaded`, once per call, after you verified the upload |
| `wasUploaded?` | boolean | CLI | `s1s render` sets `true` when the hash changes on an `uploaded` image; `s1s export` sets it when it repoints one (new store file name or new bytes). `s1s status --set uploaded` clears it |

Warning codes and default levels: `capture-missing` error,
`capture-fallback-locale` info for a declared `reuse:<l>` and warn for an
undeclared fall back to the source locale, `capture-dims` error (warn when only the
scale differs), `text-min-size` error, `text-clipped` error, `overflow`
error, `image-missing` error, `copy-missing` error, `copy-unused` info,
`bezel-fallback` warn, `font-fallback` warn, `render-failed` error,
`export-unapproved` warn, `duplicate-dims` warn, `manifest-incomplete` warn
(the last three come from `s1s export`, not the renderer).
`s1s render --strict` promotes warn to error.

`s1s validate` reports its own codes, which never reach the manifest: they
describe the export folder, not an image's state. Error level: `file-name`
(not `NN.png`), `file-gap` (ordinals not contiguous from `01`), `set-empty`,
`set-too-many` (over 10), `dims-unaccepted`, `dims-mixed`, `has-alpha`,
`not-an-image` (unreadable; also warn level for a non-RGB file),
`locale-incomplete` (a display type one locale has and another does not).
Warn level: `duplicate-dims` (the upload fan-out trap, section 6 of
`asc-upload.md`).

Alias sizes: when `screens.ts` lists both `iphone-6.9` and `iphone-6.7`, the
render happens once and the manifest gets one `ImageState` per size id.

### `runs[]`

`{ command, startedAt, finishedAt?, ok?, notes? }`. Appended by `s1s init`,
`s1s render`, `s1s export` and `s1s status --set`. Capped at the newest 50, so an entry can vanish and cannot
serve as durable state. Read it to learn what ran last; never edit or append
to it. The agent records its own milestones in agent-owned fields instead:
`app.preflightAt` (P0), `demoData.appliedAt`, `demoData.launchApprovedAt`,
`demoData.revertedAt` (P7).

## 4. Status enum and transitions

```
pending -> copy-approved -> captured -> generated -> image-approved -> exported -> uploaded
```

| Status | Meaning | Who sets it |
|---|---|---|
| `pending` | Planned only | init (implicitly: no node yet), agent |
| `copy-approved` | Copy for this screen and locale passed G1/G5 | agent |
| `captured` | A capture with the right pixel size exists | `s1s capture` (only from `pending` or `copy-approved`) |
| `generated` | A render exists; hash recorded | `s1s render` (on hash change, from any status) |
| `image-approved` | Human approved the render (G3/G6) | agent |
| `exported` | Copied to `metadata/screenshots/...` | `s1s export` |
| `uploaded` | Verified in App Store Connect | agent, after `asc screenshots list` confirms |

Transition rule (`canTransition(from, to)` in `src/core/manifest.ts`):

- Forward by any number of steps is allowed, including `to === from`.
- Backward is allowed only to `pending`, `captured` or `generated`.
- Backward to `copy-approved`, `image-approved` or `exported` is refused.

Examples: `uploaded -> generated` ok (re-render after a change);
`uploaded -> exported` refused; `captured -> copy-approved` refused;
`pending -> uploaded` allowed (reuse-as-is of a shipped image).

What the CLI does to `status` on its own:

| Command | Effect on `status` |
|---|---|
| `s1s capture` | `pending`/`copy-approved` -> `captured`. Any later status is kept, so a retake of a `generated` or higher image leaves a stale render that reconcile cannot detect: set the status back to `captured` yourself right after the capture, or re-render at once |
| `s1s render` | Hash changed -> `generated`, plus `wasUploaded: true` if it was `uploaded`. Hash unchanged -> status kept, `renderWarnings` refreshed. Failed item -> status kept, `render`/`renderHash`/`renderedAt` dropped, `render-failed` warning added |
| `s1s export` | -> `exported` for every image it copies. An image already `uploaded` keeps that status and gets `wasUploaded: true` when the file name or the bytes changed. Refuses when a set is incomplete or carries error-level warnings |
| `s1s status --set` | Agent-driven, guarded by `canTransition`; all-or-nothing over the selected images. `--from <status>` narrows it to the images at one status; `--yes` is required when the selection covers the whole locale. `--set uploaded` also writes `uploadedAt` and clears `wasUploaded`. Appends one `runs[]` entry |

`copy-approved`, `image-approved` and `uploaded` are the agent's record of a
human decision or of a verified upload; the agent decides, `s1s status --set`
writes.

## 5. Ownership: CLI versus agent

CLI-owned. Never type these by hand; re-run the command instead:

- `sizes.<id>.{displayType, token, px, simulator, udid, framed}` (init, capture)
- `ImageState.{capture, captureSha256, capturePx}` (capture)
- `ImageState.{render, renderHash, renderWarnings, renderedAt, wasUploaded}` (render)
- `ImageState.{export, exportSha256, storeFileName}` (export)
- `runs[]`

Agent-owned. Edit these with small JSON edits:

- `app.*` facts the init flags did not cover (`watchBundleId`, `project`, `scheme`, `appId`, `preflightAt`)
- `demoData.*` including the free-form keys `baselineFile`, `launchApprovedAt`, `launchApprovedBy`, `watchPatch`
- `screens[]` including `capture.steps`
- `locales.<l>.{copyStatus, captureSource, versionId, versionString, versionLocalizationId}`
- `ImageState.{status, captureRating, captureNotes, storeFileName}`

`uploadedAt` and clearing `wasUploaded` are CLI-owned too, but the agent
decides when: both happen inside `s1s status --set uploaded`.

Shared: `status` (section 4). The agent-owned values (`copy-approved`,
`image-approved`, `uploaded`, or a rollback to `pending`/`captured`/
`generated`) go through `s1s status --set`, which has shipped; hand-edit the
JSON only when the CLI is unavailable.

## 6. Edit the manifest safely

Rules:

1. Read the file, change one path, write the whole object back. Never
   rebuild the file from memory.
2. Keep every key you do not understand. The CLI relies on unknown keys
   surviving, and so do later phases.
3. Never edit while `s1s render` or `s1s capture` is running. The CLI reads
   the manifest at start and writes it atomically at the end; a concurrent
   hand edit is lost.
4. Write 2-space JSON with a trailing newline, the same format the CLI writes,
   so diffs stay small.
5. After an edit, confirm it parses:
   `s1s render --dry-run --allow-placeholder --json >/dev/null`. Exit 0 means the
   manifest, `screens.ts`, `theme.ts` and the copy all parse; a non-zero exit
   prints the failing path under `error.code`. Keep `--allow-placeholder`: without
   it every screen without a capture yet reports `capture-missing` and exits 1.

The JSON path of one image is
`locales.<locale>.devices.<sizeId>.screens.<screenId>` (size id such as
`iphone-6.9`, never the display type). Shell path (Node is always present
because `s1s` needs it). Set a status and a rating on one image:

```sh
node -e '
const fs = require("fs"); const p = "screenshots/manifest.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
const s = ((((m.locales ??= {})["en-US"] ??= {copyStatus:"pending",captureSource:"own",devices:{}}).devices["iphone-6.9"] ??= {screens:{}}).screens["map"] ??= {status:"pending"});
s.status = "image-approved"; s.captureRating = "great";
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");'
```

Mark a locale's copy approved:

```sh
node -e '
const fs = require("fs"); const p = "screenshots/manifest.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.locales["en-US"].copyStatus = "approved";
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");'
```

`jq` works the same way when installed:

```sh
jq '.locales["en-US"].devices["iphone-6.9"].screens["map"].status = "image-approved"' screenshots/manifest.json > screenshots/manifest.json.tmp \
  && mv screenshots/manifest.json.tmp screenshots/manifest.json
```

Bulk transitions (all-or-nothing: one illegal step refuses the whole command):

```sh
s1s status --set image-approved --locale en-US --sizes iphone-6.9,ipad-13 --screens map,laps --yes
s1s status --set uploaded --locale en-US --sizes iphone-6.9 --yes
s1s status --set copy-approved --locale en-US --from pending --yes
```

`--set` applies `canTransition` to every selected image and refuses the whole
call when one transition is not allowed. `--from <status>` selects only the
images already at that status, which is how you move part of a mixed locale
without the refusal; a `--from` that matches nothing is a no-op, not an error.
`--yes` is required when the selection still covers every image of the locale
(naming every size is not narrowing), so keep it on a documented command: it
does nothing when the guard does not fire. Use the `node -e` form above only
when `s1s` is unavailable. In Claude Code the Edit tool on the JSON file is an
alternative for a single value; keep the edit to the one line.

Record ASC ids after resolving the version (P5):

```sh
node -e '
const fs = require("fs"); const p = "screenshots/manifest.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
Object.assign(m.locales["en-US"], { versionId: process.argv[1], versionString: process.argv[2], versionLocalizationId: process.argv[3] });
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");' "$VERSION_ID" "1.0.0" "$LOC_ID"
```

## 7. Reconcile: manifest versus disk versus store

Run this at the start of every session and before any gate. Preferred
implementation: `s1s status --json`.

Signals per image (locale x size x screen):

| Signal | How to read it | Truth for |
|---|---|---|
| M: manifest `status` | `ImageState.status` | The agent's last decision |
| C: capture on disk | `test -f screenshots/<capture>`; `shasum -a 256` equals `captureSha256`. For a `captureSource: reuse:<l>` locale check `captures/<l>/...`; `captures/<locale>/` is never populated and the `ImageState` has no `capture` field | Whether a render can run without placeholders |
| R: render on disk | `test -f screenshots/<render>`; `out/<locale>/report.json` item `hash` equals `renderHash` and `warnings` has no `error` | Whether the image is reviewable |
| E: export on disk | `test -f metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png`; sha256 equals `exportSha256` | Whether `asc` can upload |
| S: store | `asc screenshots list --version-localization <id> --output json`, `sets[].screenshots[]` with matching `fileName` (= `storeFileName`) and display type | What is shipped. Authoritative |

Decision table. The effective status is the lowest signal that holds; the
action repairs the first gap. `-` means "not checked" or "absent".

| M | C | R | E | S | Effective | Action |
|---|---|---|---|---|---|---|
| `pending` | - | - | - | - | pending | P1: write copy, then G1 |
| `copy-approved` | absent | - | - | - | copy-approved | P2: capture |
| any >= `captured` | absent | - | - | - | copy-approved at best | Re-capture (`git apply` the demo patch, replay `capture.steps`); the render will fall back to the source locale or a placeholder |
| `captured` | ok | absent | - | - | captured | P3: `s1s render` |
| `generated` | ok | absent or hash differs | - | - | captured | `s1s render` again; `out/` is gitignored, so a fresh clone always lands here |
| `generated` | ok | ok, error warnings | - | - | generated (blocked) | Fix copy/template; export refuses error-level warnings |
| `generated` | ok | ok | - | - | generated | P4: G3 review, then `image-approved` |
| >= `image-approved` | ok | absent | - | - | status kept | `s1s render` again (`out/` is gitignored): an unchanged hash keeps the status, a changed hash sets `generated` and goes back to review |
| `image-approved` | ok | ok | absent | - | image-approved | P5: `s1s export` |
| `exported` | ok | ok | ok | absent | exported | Upload on request (G4) |
| `exported` | ok | ok | sha differs | - | image-approved | `s1s export` again; if `renderHash` also changed, back to review |
| `uploaded` | ok | ok | ok | present | uploaded | Done. Skip the image |
| `uploaded` | - | - | - | absent | exported | Store lost or wrong version: re-upload after confirming the version is editable |
| `uploaded` + `wasUploaded: true` | ok | ok | - | present | generated | Render or export moved after upload (`s1s status` prints this as a row note): review, export, re-upload, then `s1s status --set uploaded` |
| any | - | - | present | present | store-only | Manifest is behind (state lost or hand-rolled export): record `storeFileName`, then `s1s status --set uploaded` (forward, allowed) for `uploadedAt` and the status; keep the store file |

Additional per-locale checks:

- `copyStatus` must be `approved` before any image of that locale goes past
  `copy-approved`. If images are `generated` but `copyStatus` is `draft`, the
  copy was never gated: run G1/G5 before review.
- `captureSource: reuse:<l>` and the `<l>` locale has no captures: the
  reuse locale is the one to shoot first.
- All-or-nothing per device set across locales: a size that is `uploaded`
  in `en-US` but `pending` in `de-DE` is a store inconsistency, not a partial
  success. Report it.
- `demoData.appliedAt` set and `revertedAt` absent: check
  `git status --porcelain` and `git branch --list s1s/demo-data` before doing
  anything else.

Store is authoritative for shipped images. Disk is authoritative for
captures and renders. The manifest is authoritative for approvals and
ratings. When the manifest claims more than disk or store show, downgrade in
the report and say why; do not rewrite the manifest until the human confirms
the resume point.

Where `s1s status --json` comes from: it reads `screens.ts` and the
manifest and stats the capture, render and export paths. It never contacts
App Store Connect, so an `uploaded` row says so and `asc screenshots list`
stays authoritative for the shipped state. It prints one row per image, plus
manifest entries `screens.ts` no longer knows (orphans) and exported files no
entry claims (`strayExports`). It compares the recorded `renderHash` and
`exportSha256` against the bytes on disk, so a file edited since it was
recorded shows up as a note rather than as a healthy row.

## 8. Copy contract: `screenshots/copy/<locale>.json`

One file per locale. Validated on every render (`copy-invalid` stops the
run). Loose: extra keys pass through to templates.

```json
{
  "locale": "en-US",
  "approved": false,
  "shared": {
    "appName": "MotoFit",
    "tagline": "Track Every Moto"
  },
  "screens": {
    "map": {
      "headline": "Every Ride on the Map",
      "highlight": "Map",
      "subline": "GPS route, start line and laps",
      "layoutNotes": "One line on iPhone; the iPad template widens the text block."
    },
    "laps": {
      "headline": ["Automatic", "Lap Timing"],
      "highlight": "Lap Timing",
      "subline": "Best lap highlighted",
      "badge": "New"
    },
    "features": {
      "headline": "Built for Track Days",
      "callouts": [
        { "title": "Start Line", "body": "Set it once per track" },
        { "title": "3D Replay" }
      ]
    },
    "watch-stats": {
      "headline": "On Your Wrist",
      "layoutNotes": "Template raw renders no text. Kept for watch-caption."
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `locale` | string | Must equal the file name |
| `approved?` | boolean | Convenience flag for humans. The gate the CLI and the reconcile use is `manifest.locales.<l>.copyStatus`; keep both in step |
| `shared?` | map string -> string | Strings several screens use (app name, tagline) |
| `screens.<key>` | `ScreenCopy` | Key = screen id, or `copyKey` from `screens.ts` when set |
| `screens.<key>.headline` | string or string[] | An array fixes the line breaks (each line `white-space: pre`). 2-5 words, verb-first |
| `highlight?` | string | Substring of the headline coloured with `theme.highlight`. One word |
| `subline?` | string or string[] | 8 words or fewer |
| `badge?` | string | Short label (for example `New`) |
| `callouts?` | `{title, body?}[]` | 1-3 entries; `feature-grid` on iPad uses them |
| `layoutNotes?` | string | Never rendered. Notes for translators and the agent |
| other keys | any | Template-specific fields for custom templates |

Rules the render enforces:

- A screen without a `screens.<key>` entry gets a `copy-missing` error, except
  when its template is `raw` (watch passthrough renders no text).
- A `screens.<key>` entry that no screen uses gives a `copy-unused` info in
  `report.json` (not in the manifest).
- There is no copy fallback across locales. A missing `copy/<locale>.json`
  stops `s1s render --locale <locale>` with `copy-missing`. Copy is always
  per locale, even when captures are reused.
- Text length is checked by the render, not by the schema: `text-min-size`,
  `text-clipped` and `overflow` warnings name the element. Fix the copy or the
  line breaks, then re-render.

Write the copy file the same way as the manifest: parse, change one key,
write 2-space JSON with a trailing newline.

## 9. Quick checks

```sh
# parse both files and print the status of every image
node -e '
const m = JSON.parse(require("fs").readFileSync("screenshots/manifest.json","utf8"));
for (const [l, loc] of Object.entries(m.locales ?? {}))
  for (const [size, dev] of Object.entries(loc.devices ?? {}))
    for (const [id, s] of Object.entries(dev.screens ?? {}))
      console.log([l, size, id, s.status, s.captureRating ?? "-", s.wasUploaded ? "CHANGED-AFTER-UPLOAD" : ""].join("\t"));'

# count error-level render warnings in the manifest
node -e '
const m = JSON.parse(require("fs").readFileSync("screenshots/manifest.json","utf8"));
let n = 0;
for (const loc of Object.values(m.locales ?? {})) for (const dev of Object.values(loc.devices ?? {}))
  for (const s of Object.values(dev.screens ?? {})) n += (s.renderWarnings ?? []).filter(w => w.level === "error").length;
console.log(n, "error warnings");'

# confirm the manifest still validates
s1s render --dry-run --allow-placeholder --json >/dev/null && echo manifest ok
```
