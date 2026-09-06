# Apple rules: sizes, sets, bezels, simulators

Facts an agent needs before it plans, captures, renders or exports App Store
screenshots. Every number below comes from `asc screenshots sizes --all
--output json` (asc 1.2.2, 2026-09-02), from Apple's screenshot specification,
or from the measured bezel files recorded in the Screen1Shoter repo
(`docs/bezels.md`, `src/config/presets.ts`). Re-run the `asc` command when in
doubt; do not type sizes from memory.

Paths are relative to the app repo. The tool is `s1s`.

## 1. Screenshot size table

Get the live table at any time:

```sh
asc screenshots sizes --all --output json
```

Portrait sizes only; App Store Connect also accepts every size rotated
(landscape). One set holds one display type for one locale. Every PNG in a set
must have the same pixel size (see section 3).

| Display type (export folder) | asc `--device-type` | `s1s` preset | Accepted portrait px | Required? |
|---|---|---|---|---|
| `APP_IPHONE_69` | `IPHONE_69` | `iphone-6.9` | 1320x2868, 1290x2796, 1260x2736 | Required for iPhone apps unless a 6.5" set exists |
| `APP_IPHONE_67` | `IPHONE_67` | `iphone-6.7` (alias of `iphone-6.9`) | 1320x2868, 1290x2796, 1260x2736 | Optional; same pixels as 6.9" |
| `APP_IPHONE_65` | `IPHONE_65` | `iphone-6.5` | 1284x2778, 1242x2688 | Optional; satisfies the iPhone requirement if 6.9" is absent |
| `APP_IPHONE_61` | `IPHONE_61` | `iphone-6.1` | 1206x2622, 1179x2556 | Optional |
| `APP_IPAD_PRO_3GEN_129` ("iPad 13-inch" in App Store Connect) | `IPAD_PRO_3GEN_129` | `ipad-13` | 2064x2752, 2048x2732 | Required if the app runs on iPad |
| `APP_IPAD_PRO_129` (2nd-gen 12.9") | `IPAD_PRO_129` (not verified) | none | 2064x2752, 2048x2732 | Optional; legacy slot, same pixels as the 13" set |
| `APP_IPAD_PRO_3GEN_11` | `IPAD_PRO_3GEN_11` | `ipad-11` | 1668x2420, 1668x2388, 1640x2360, 1488x2266 | Optional |
| `APP_WATCH_SERIES_10` | `WATCH_SERIES_10` | `watch-s10` | 416x496 | Required if the app has a watchOS app (any one watch set satisfies it) |
| `APP_WATCH_ULTRA` | `WATCH_ULTRA` | `watch-ultra` | 422x514, 410x502 | Optional; satisfies the watchOS requirement on its own |
| `APP_WATCH_SERIES_7` | `WATCH_SERIES_7` (not verified) | none | 396x484 | Optional |
| `APP_WATCH_SERIES_4` | `WATCH_SERIES_4` (not verified) | none | 368x448 | Optional |
| `APP_WATCH_SERIES_3` | `WATCH_SERIES_3` (not verified) | none | 312x390 | Optional |
| `APP_DESKTOP` (Mac) | `DESKTOP` (not verified; Mac uploads also need `--platform MAC_OS`) | none | 1280x800, 1440x900, 2560x1600, 2880x1800 | Required if the app ships on the Mac App Store |

Notes:

- Tokens marked "not verified" follow the pattern of dropping the `APP_`
  prefix. `IPHONE_69`, `IPHONE_67`, `IPHONE_65`, `IPHONE_61`,
  `IPAD_PRO_3GEN_129`, `IPAD_PRO_3GEN_11`, `WATCH_SERIES_10` and
  `WATCH_ULTRA` are the values `s1s` and the verified `asc` calls use
  (`WATCH_ULTRA` confirmed on 2026-09-03 with `asc screenshots validate --path
  <dir> --device-type WATCH_ULTRA`: `errorCount: 0`).
- `s1s` renders the eight presets in the third column. It writes 1320x2868
  for `iphone-6.9`, 1284x2778 for `iphone-6.5`, 1206x2622 for `iphone-6.1`,
  2064x2752 for `ipad-13`, 1668x2420 for `ipad-11`, and copies the watch
  capture as is (416x496 for `watch-s10`, 422x514 for `watch-ultra`). It never
  resizes a render to another accepted size.
- `iphone-6.7` is an alias. `s1s render` renders it once with the 6.9" layout
  and `s1s export` copies the same PNGs into both
  `APP_IPHONE_69/` and `APP_IPHONE_67/`. Only add the alias when the user
  asks for a 6.7" set.
- Display types with no preset (12.9" 2nd gen, older watches, Mac, Apple TV,
  Vision Pro) are outside the tool. Also outside the tool: the legacy iPhone
  classes `APP_IPHONE_35/40/47/55/58`, the legacy iPad classes
  `APP_IPAD_97/105`, and every `IMESSAGE_*` type that
  `asc screenshots sizes --all` lists. Leave existing folders of those types
  under `metadata/screenshots/` untouched; never upload to them from this
  workflow. If the app needs one, tell the user and stop; do not resize a
  render with `sips`.
- The default project sizes are `iphone-6.9,ipad-13`. Add `watch-s10` with
  `s1s init --watch` or `--sizes iphone-6.9,ipad-13,watch-s10`.

## 2. Required versus optional sets

- iPhone apps: one 6.9" set is required. A 6.5" set can stand in for it.
  Apple scales the largest set down for smaller iPhones, so more iPhone sets
  are optional.
- iPad: if `TARGETED_DEVICE_FAMILY` contains `2` (the app runs on iPad, not
  only in compatibility mode), a 13" iPad set is required.
- watchOS: if the project has a watch target, one watch set is required. Any
  one watch display type satisfies it; `s1s` can produce two of them,
  `APP_WATCH_SERIES_10` (`watch-s10`, 416x496) and `APP_WATCH_ULTRA`
  (`watch-ultra`, 422x514). Ship the one that matches the watch the app's
  audience wears, and ask the user before shipping both - the two sets are
  separate uploads with separate copy to keep in step.
- Mac: a Mac App Store listing needs an `APP_DESKTOP` set. The tool does not
  produce it.
- Localized sets are optional per locale. App Store Connect falls back to the
  primary locale's screenshots for a locale without its own set. The skill
  still treats a locale as all-or-nothing: either every device set the source
  locale has, or none. `s1s validate` checks that across the whole export
  tree; `--locale` narrows the table it prints, never this rule.

Decide the device families in Phase 0 from the pbxproj and record them in
`screenshots/manifest.json` under `app.deviceFamilies`.

## 3. Rules for one set

Each rule below is enforced by App Store Connect at upload time. `s1s
validate` checks the same rules offline, and `asc screenshots validate`
checks them before upload.

| Rule | Detail |
|---|---|
| Count | 1 to 10 screenshots per set |
| Format | PNG or JPEG. `s1s` writes PNG |
| Alpha | No alpha channel. `sips -g hasAlpha` must print `no` |
| Colour | RGB, sRGB. `s1s render` flattens onto `theme.background` and removes alpha. `s1s validate` reports a greyscale or CMYK file as a warn-level `not-an-image`, not an error |
| Pixel size | Exactly one of the accepted sizes for the display type |
| Uniform size | Every file in one set has the same pixel size. Do not mix 1320x2868 and 1290x2796 |
| Orientation | Portrait or landscape allowed; keep one orientation per set |
| Order | The upload order is the file-name order: `01.png`, `02.png`, ... `10.png`, contiguous from `01` |
| File names | `metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/NN.png`, `NN` two digits |

Check a folder by hand:

```sh
for f in metadata/screenshots/en-US/APP_IPHONE_69/*.png; do
  sips -g pixelWidth -g pixelHeight -g hasAlpha "$f"
done
asc screenshots validate --path metadata/screenshots/en-US/APP_IPHONE_69 --device-type IPHONE_69
```

Trap: `asc screenshots upload --path metadata/screenshots` fans out over the
locale folders under `--path`. Two sibling folders with identical pixel sizes
(`APP_IPHONE_69` and `APP_IPHONE_67`, or `APP_IPAD_PRO_3GEN_129` and
`APP_IPAD_PRO_129`) upload the same pixels twice. `s1s export` and
`s1s validate` both warn about this; upload one `--device-type` at a time. See `asc-upload.md`.

## 4. Points versus pixels

The renderer lays out in CSS px = Apple points and multiplies by the device
scale. A capture from the matching simulator has exactly the output pixel
size, so it drops into the bezel 1:1.

| Preset | Points (viewport) | Scale | Pixels (output) | Simulator that produces the same pixels |
|---|---|---|---|---|
| `iphone-6.9` | 440x956 | @3x | 1320x2868 | iPhone 17 Pro Max |
| `iphone-6.5` | 428x926 | @3x | 1284x2778 | iPhone 14 Plus |
| `iphone-6.1` | 402x874 | @3x | 1206x2622 | iPhone 17 Pro |
| `ipad-13` | 1032x1376 | @2x | 2064x2752 | iPad Pro 13-inch (M5) |
| `ipad-11` | 834x1210 | @2x | 1668x2420 | iPad Pro 11-inch (M5) |
| `watch-s10` | 416x496 | @1x in the tool (passthrough) | 416x496 | Apple Watch Series 11 (46mm) |
| `watch-ultra` | 422x514 | @1x in the tool (passthrough) | 422x514 | Apple Watch Ultra 3 (49mm) |

Consequences:

- Write template sizes in pt (CSS px). A 32 px headline on `iphone-6.9` is
  96 device pixels tall.
- Length budgets scale with the viewport, not with the pixel count. The
  iPhone viewports share an aspect of 0.460 to 0.462, so one iPhone layout
  serves every iPhone preset. iPad (0.75) is a separate layout branch.
- `s1s capture` accepts an exact match of the capture size. A file with the
  same aspect within 1% is stored with a `capture-dims` warning. Anything
  else is an error that names the expected simulator.
- Both watch presets skip the browser. The capture is copied unframed, so the
  raw file must already be exactly the preset's size: 416x496 for `watch-s10`,
  422x514 for `watch-ultra`. An Ultra or Ultra 2 capture is 410x502, the same
  aspect within 1%, so it is stored with a `capture-dims` warning and
  resampled rather than refused.

## 5. Apple marketing rules for product bezels

Apple's marketing guidelines for product images (and the Apple Design
Resources licence attached to the bezel DMGs) set these rules. App Review
does not always enforce them, but the skill's default templates follow them.

| Rule | Meaning for a screenshot |
|---|---|
| Use the bezel as delivered | No recolouring, no re-drawn frame, no extra glow. `s1s` composes the untouched PNG over the capture |
| No cropping | The whole device stays inside the canvas. The `bleed-bottom` template breaks this |
| No tilting or rotation | Device upright, 0 degrees. The `tilted` template breaks this |
| No added shadows, reflections or perspective | Apple's PNGs have no shadow; do not add `box-shadow` around `DeviceFrame` |
| Copy beside the device, not on it | Headline and subline sit above or below the device, never overlapping the screen or the frame |
| Latest-generation devices | iPhone 17 family and iPad Pro (M5) bezels. Do not use an older frame for a new listing |
| Real app UI | The screen shows an actual simulator capture of the shipping app. No mock-ups, no invented UI, no generated artwork in place of the app |
| Minimum size | Keep the device large enough that the UI is readable. The default templates keep the device at 82% (iPhone) to 84% (iPad) of the canvas width, which is well above Apple's minimum |
| Status bar | 9:41, full Wi-Fi and signal, full battery. `s1s sim status-bar <udid|name>` sets it |

Template choice that follows from the rules:

| Template | Compliant | Use when |
|---|---|---|
| `hero-top-text` | yes | Default. Copy on top, whole upright device below |
| `text-bottom` | yes | Same, with the copy under the device |
| `two-device` | yes | Two captures, two upright devices, overlapped; the front one lower |
| `feature-grid` | yes | iPad only: device left, up to three callout cards right |
| `raw` | yes | Unframed capture filling the canvas. Default for watch |
| `watch-caption` | yes | Watch capture plus a short caption. Opt-in: ask before you use it instead of `raw` |
| `phone-watch` | yes | An Apple Watch standing in front of the phone or iPad, so a shopper on those tabs sees the watch app. One screen of a set, not the whole set |
| `bleed-bottom` | no | Device cropped at the bottom edge. Opt-in only when the user asks |
| `tilted` | no | Device rotated a few degrees (`props.rotate`, default -8). Opt-in only when the user asks |

All nine are implemented. Non-compliant templates tag the canvas
`data-s1s-noncompliant` and are listed in
`screenshots/out/<locale>/review.md`; nothing is blocked, so the render and
the export still succeed and the guideline risk is the user's. Never switch a
screen to one of them without the user's approval, and record the decision in
`screenshots/plan.md`. See `template-catalog.md` for props.

## 6. Watch screenshots are unframed

Apple Watch screenshots go to App Store Connect without a bezel. The
`watch-s10` and `watch-ultra` presets are passthroughs for the default `raw`
template: `s1s
render` copies `screenshots/captures/<locale>/watch/<id>.png` to
`out/<locale>/APP_WATCH_SERIES_10/NN-<id>.png` unchanged and checks that it is
416x496 with no alpha (`watch-ultra` does the same into
`out/<locale>/APP_WATCH_ULTRA/` at 422x514). A watch screen on `watch-caption`
has copy to paint, so
it goes through Chromium instead; the capture is still unframed and still must
be exactly the preset's size. Apply the marketing rules inside the app instead: real
UI, marketing-grade values, a plausible clock. `xcrun simctl status_bar` does
not support watchOS, so `s1s sim status-bar` reports `supported: false` and
the real simulator clock stays. Accept it, or set the fixture time inside the
watch app's screenshot mode.

Capture a watch screen:

```sh
s1s capture --udid "Apple Watch Series 11 (46mm)" --name mkt-stats-heart --device watch
```

## 7. Bezel facts

Source: Apple Design Resources, "Product Bezels". No login. Each DMG holds
PNGs (used) and PSDs (ignored) and shows a licence on mount.

| DMG | URL | Size | Bezel ids inside |
|---|---|---|---|
| iPhone 17 family | `https://devimages-cdn.apple.com/design/resources/download/Bezel-iPhone-17.dmg` | 265 MB | `iphone-17-pro-max`, `iphone-17-pro`, `iphone-17`, `iphone-air` |
| iPad Pro (M5) | `https://devimages-cdn.apple.com/design/resources/download/Bezel-iPad-Pro-(M5).dmg` | 6.8 MB | `ipad-pro-13-m5`, `ipad-pro-11-m5` |
| Apple Watch Series 11 | `https://devimages-cdn.apple.com/design/resources/download/Bezel-Apple-Watch-Series-11-2025.dmg` | 341 MB | `apple-watch-series-11-46mm`, `apple-watch-series-11-42mm` |
| Apple Watch Ultra 3 | `https://devimages-cdn.apple.com/design/resources/download/Bezel-Apple-Watch-Ultra-3-2025.dmg` | 314 MB | `apple-watch-ultra-3` |

A watch SET needs no bezel: both watch presets are passthroughs that copy the
capture unframed. The watch bezels exist for `phone-watch`, which stands one
beside the phone or iPad. `s1s bezels install` with no `--device` installs
every frame a preset names EXCEPT `apple-watch-ultra-3`, which is marked
optional so a project that never asks for it does not pay 314 MB; get it with
`s1s bezels install --device apple-watch-ultra-3`.

Other Apple DMGs (`Bezel-iPhone-16.dmg`, `Bezel-iPad-Air-(M4).dmg`,
`Bezel-Apple-Watch-Ultra-2-2024.dmg` and the Mac, Studio Display and Apple TV
frames) exist but are not wired into the tool.

Cache location: `~/.screen1shoter/bezels/<id>/<variant>.png` plus
`~/.screen1shoter/bezels/index.json`. `S1S_HOME` overrides `~/.screen1shoter`.
DMGs download to `~/.screen1shoter/dmg/` and are deleted after install
unless `--keep-dmg` is set. Never copy bezel PNGs into an app repo or into
the tool package: the licence allows mock-ups of Apple-platform software,
not redistribution.

Install the bezels the presets need (once per machine):

```sh
s1s bezels install
s1s bezels list
```

Options: `--device <ids>` for a subset, `--all` for every model in the known
DMGs, `--from <path>` for a downloaded DMG or a folder of PNGs (offline
machines), `--keep-dmg`, `--force` to re-measure, `--landscape` to also
install landscape files. `s1s bezels inspect <dmg-url|path>` lists the PNGs a
DMG contains without installing. `s1s doctor` reports a missing index.

Measured geometry of the installed portrait bezels (image pixels):

| Bezel id | Preset | Screen cut-out | Screen aspect | Dynamic Island | Corner radius | Variants (`theme.bezelVariant`) |
|---|---|---|---|---|---|---|
| `iphone-17-pro-max` | `iphone-6.9`, `iphone-6.7`, `iphone-6.5` | 1320x2868 | 0.4603 | 374x108 | 189 | `deep-blue` (auto), `cosmic-orange`, `silver` |
| `iphone-17-pro` | `iphone-6.1` | 1206x2622 | 0.4600 | 374x108 | 186 | `deep-blue` (auto), `cosmic-orange`, `silver` |
| `iphone-17` | fallback | 1206x2622 | 0.4600 | 374x109 | 189 | `black` (auto), `white`, `lavender`, `mist-blue`, `sage` |
| `iphone-air` | none | 1260x2736 | 0.4605 | 374x108 | 189 | `space-black` (auto), `cloud-white`, `light-gold`, `sky-blue` |
| `ipad-pro-13-m5` | `ipad-13` | 2064x2752 | 0.7500 | none | 58 | `space-black` (auto), `silver` |
| `ipad-pro-11-m5` | `ipad-11` | 1668x2420 | 0.6893 | none | 58 | `space-black` (auto), `silver` |

What this means when you compose:

- The screen cut-out equals the preset's output size, so a capture from the
  matching simulator fits with no resampling.
- `iphone-6.5` (1284x2778) renders inside the 17 Pro Max bezel. The frame
  scales the capture to cover the cut-out (`object-fit: cover`, anchored at
  the top). The aspects differ by about 0.4%, so a few pixel rows at the
  bottom of the capture are hidden. Keep nothing important on the last rows.
- The Dynamic Island is opaque black in the PNG. The frame draws the bezel
  over the capture, so the island hides that part of the capture. Do not
  place anything the copy depends on under the island.
- Colour variants share one alpha channel, so switching `theme.bezelVariant`
  never changes alignment.
- No installed bezel: the render falls back to a generic CSS frame and
  reports a `bezel-fallback` warning. Treat that as a blocker for export;
  run `s1s bezels install` and re-render.

## 8. Simulator to preset to folder to token

Use this mapping for `s1s capture --device`, `s1s render --sizes`, the export
folder and the `asc` upload flag. `s1s capture` verifies the pixel size and
names the expected simulator on a mismatch. Keep one live simulator at a
time: shut down the iPhone before you boot the iPad, and the iPad before the
watch.

| `xcrun simctl` device name | Capture px | `--device` family | `s1s` preset | Framed | Export folder | `asc --device-type` |
|---|---|---|---|---|---|---|
| iPhone 17 Pro Max | 1320x2868 | `iphone` | `iphone-6.9` (and alias `iphone-6.7`) | yes, `iphone-17-pro-max` | `APP_IPHONE_69` (and `APP_IPHONE_67`) | `IPHONE_69` (and `IPHONE_67`) |
| iPhone 14 Plus | 1284x2778 | `iphone` | `iphone-6.5` | yes, `iphone-17-pro-max` | `APP_IPHONE_65` | `IPHONE_65` |
| iPhone 17 Pro | 1206x2622 | `iphone` | `iphone-6.1` | yes, `iphone-17-pro` | `APP_IPHONE_61` | `IPHONE_61` |
| iPad Pro 13-inch (M5) | 2064x2752 | `ipad` | `ipad-13` | yes, `ipad-pro-13-m5` | `APP_IPAD_PRO_3GEN_129` | `IPAD_PRO_3GEN_129` |
| iPad Pro 11-inch (M5) | 1668x2420 | `ipad` | `ipad-11` | yes, `ipad-pro-11-m5` | `APP_IPAD_PRO_3GEN_11` | `IPAD_PRO_3GEN_11` |
| Apple Watch Series 11 (46mm) | 416x496 | `watch` | `watch-s10` | no (raw) | `APP_WATCH_SERIES_10` | `WATCH_SERIES_10` |

Captures land in `screenshots/captures/<locale>/<family>/<name>.png`; one
capture per family serves every preset of that family unless
`screens.ts` overrides it per size.

Find the simulators, then capture:

```sh
s1s sim list
xcrun simctl boot "<udid>" && xcrun simctl bootstatus "<udid>" -b
s1s sim status-bar "<udid>"
s1s sim appearance "<udid>" dark
s1s capture --udid "<udid>" --name home --device iphone --locale en-US
```

Do not trust a UDID written in a repo file (`.xcodebuildmcp/config.yaml`
often holds a stale one). Create fresh simulators with `xcrun simctl create`
and read the UDID from `s1s sim list --json`. The manifest records the chosen
UDID per size under `sizes.<preset>.udid`.

Then render and export:

```sh
s1s render --locale en-US --sizes iphone-6.9,ipad-13,watch-s10 --json
s1s export --locale en-US
s1s validate --locale en-US
asc screenshots validate --path metadata/screenshots/en-US/APP_IPHONE_69 --device-type IPHONE_69
```

## 9. Quick pre-flight checklist

Before export, confirm all of these for every locale and set:

1. Pixel size is one accepted size for the folder, the same for every file.
2. `hasAlpha: no` on every PNG.
3. Files are `01.png` to at most `10.png`, contiguous.
4. Framed sets use a current Apple bezel, upright, uncropped, with copy
   beside the device.
5. Watch files are raw 416x496 captures.
6. No sibling folder in the same locale has identical pixel sizes unless
   the user wants the duplicate set.
7. `screenshots/out/<locale>/review.md` lists no non-compliant templates
   the user has not approved.
