# Localize playbook (Phase 6)

Localize an approved source-locale screenshot set into one target locale.
Text is real text in this pipeline, so a locale is a copy file, optional
locale captures and a re-render. There is no per-image regeneration. Run this
playbook once per target locale, iPhone first, then iPad, then watch.

Replaces the image-model localize skills (`localize-app-store-screenshots`,
`asc-localize-screenshots`); their copy and shipping rules live on here.

All paths are relative to the app repo. `<locale>` is the App Store Connect
locale (`de-DE`, `fr-FR`, `ja`). `$APP` is the numeric App Store Connect app
id. `en-US` in the examples stands for `manifest.app.sourceLocale`.

## Contents

1. Preconditions
2. Capture mode: own captures or reuse
3. App-context brief and glossary (`screenshots/copy/brief.md`)
4. Transcreate copy and layout together (`screenshots/copy/<locale>.json`)
5. Gate G5: copy approval
6. Own captures: re-apply the demo patch and replay the steps
7. Render the locale and check the expansion
8. Gate G6: image approval
9. Export, validate, all-or-nothing upload, verify (gate G7)
10. Reconcile on resume
11. Lessons that still apply
12. Commit

## 1. Preconditions

Do not draft copy before every check below passes.

1. The source locale is complete. Every source screen is at least
   `image-approved` in `screenshots/manifest.json`. Localizing a set that is
   still moving means doing the work twice.
2. The target locale is named. Never assume a default. If the user gave none,
   ask (AskUserQuestion in Claude Code, a plain question elsewhere).
3. The target locale exists on the editable version - a precondition for
   shipping, not for starting. Sections 2 to 8 need no store access at all
   (the de-DE dry run completed every one of them with no App Store Connect
   credentials), so run this check when you can, and repeat it in section 9
   where the ids are re-resolved anyway. Do it now when store access is
   available: a locale the store will not take is work you should not start.
   Resolve the version and its localizations; never hardcode ids:

   ```bash
   asc versions list --app "$APP" --output json \
     | jq -r '.data[] | select(.attributes.platform=="IOS")
              | "\(.id)\t\(.attributes.versionString)\t\(.attributes.appStoreState)"'
   ```

   Pick the one IOS entry whose `appStoreState` is `PREPARE_FOR_SUBMISSION`
   or `DEVELOPER_REJECTED`. `WAITING_FOR_REVIEW`, `IN_REVIEW` and
   `READY_FOR_SALE` are frozen: they are "not ready for sale" but still reject
   uploads. If no entry is editable, stop and tell the user. Then:

   ```bash
   asc localizations list --version "$VERSION_ID" --output json \
     | jq -r '.data[] | "\(.attributes.locale)\t\(.id)"'
   ```

   The target locale must be in this list before section 9 can upload. If it
   is not, the listing metadata is not localized yet: tell the user, point
   them at `asc-localize-metadata`, and either stop or agree to draft the
   copy now and ship later. Record `versionId`, `versionString` and
   `versionLocalizationId` under `manifest.locales.<locale>` when you have
   them. Section 3 step 5 assumes you may find no target-locale listing
   metadata; that branch is real.
4. Rendering and upload are separate. Steps 1 to 8 need no store access.
   Only step 9 needs the editable version. Re-resolve the ids in step 9; they
   change per version and per run.

## 2. Capture mode: own captures or reuse

Decide once per locale and write the decision down before any copy work.

Check whether the app ships the language:

```bash
grep -o '"[a-z]\{2\}\(-[A-Za-z]\+\)\?" *:' <path-to>/Localizable.xcstrings | sort -u   # xcstrings
grep -n knownRegions -A 8 <App>.xcodeproj/project.pbxproj                                 # legacy
```

`manifest.app.appLocales` should already hold the answer from Phase 0.
Confirm it against the project files above.

| App ships the language | `manifest.locales.<locale>.captureSource` | Captures |
|---|---|---|
| yes | `"own"` | New captures with the app running in the target language (section 6). Every visible in-app string then matches the marketing copy. |
| no | `"reuse:en-US"` | The renderer reads `screenshots/captures/en-US/...` for this locale and reports an info-level `capture-fallback-locale` warning per screen. No simulator work. Leave the field on `"own"` and the same fall back is reported at warn level instead, because nobody asked for it. |

For `reuse:` write this warning into `screenshots/copy/brief.md` and say it
to the user at G5:

> The app UI in the device frames stays in en-US because the app does not
> ship <language>. Only the marketing copy is localized. Apple reviews the
> screenshots as content; a mixed-language image is accepted but looks
> weaker than a fully localized one.

Never pick `reuse:` for a language the app ships. A German caption over an
English app screen looks broken. The only strings that may stay untranslated
in an own-capture set are brand names, format tokens (PDF, GPX), the `9:41`
clock and language-neutral glyphs.

Write the manifest entry now:

```json
"locales": {
  "de-DE": { "copyStatus": "pending", "captureSource": "reuse:en-US", "devices": {} }
}
```

When the reuse target is the source locale the renderer would find the same
files anyway through its own source-locale fallback, so the entry is a record
of intent rather than a switch: measured with the whole `de-DE` node deleted,
the render resolved the identical en-US files and emitted the identical info
warnings. It is load-bearing only when you reuse a locale that is not the
source locale (`reuse:de-DE` for `de-AT`). Write it regardless: the reconcile
table and `s1s status` read it, and `own` versus `reuse:` is the difference
between a missing capture and a deliberate one.

Add the locale to `locales` in `screenshots/screens.ts` too (the first entry
stays the source locale). `s1s render --locale <locale>` works without it (it
loads `copy/<locale>.json` directly), and the dev gallery's locale switcher
unions the `screens.ts` list with the copy files. Manifest locales feed only
the capture map, so a locale that exists only in `manifest.locales` never
appears in the gallery. Keep all three in step: `screens.ts` is the declared
set the reviewer reads.

## 3. App-context brief and glossary

Write `screenshots/copy/brief.md` before the first line of target copy.
Caption quality depends on this step. Spend real effort here.

1. Read all existing App Store metadata for the source locale and, when it
   exists, the target locale. Prefer the committed files under
   `metadata/app-info/` and `metadata/version/<versionString>/`. If they are
   missing or stale, pull into a scratch directory so no local edit is
   clobbered:

   ```bash
   mkdir -p screenshots/out && asc metadata pull --app "$APP" --version "$VERSION_STRING" --dir screenshots/out/asc-meta-read
   ```

   Read name, subtitle, promotional text, description, keywords and "what's
   new" in both locales. These give the positioning, the value props worth
   echoing, and the approved terminology. If the listing says "drafts", a
   caption must not say "documents". Note live social-proof numbers so badge
   copy stays accurate.
2. Read the source copy, `screenshots/copy/en-US.json`, and
   `screenshots/plan.md`. They carry the benefit per screen and the marketing
   order.
3. Read the app's own target-language strings when the app ships the
   language (`Localizable.xcstrings`, or the compiled
   `<app>.app/<lang>.lproj/Localizable.strings` via `plutil -convert json`).
   Every core noun in a caption must be the word the app uses on screen.
4. Skim the repo README, the landing page and the App Store category for
   purpose, audience and tone. Tone decides register (German du/Sie).
5. If the target locale already has listing metadata, mirror its terminology
   and tone so captions and description read as one voice. If it does not,
   decide the target term for each core noun once and reuse it everywhere.

Shape of `screenshots/copy/brief.md`:

```markdown
# <App> localization brief: <locale>

## App in one paragraph
What it does, for whom, in what tone (formal/informal register).

## Capture mode
own | reuse:en-US, and why. (Paste the reuse warning here when it applies.)
Under reuse: every caption sits above a source-language UI, so name the
source-language labels the reader will see in the frame beside each caption
noun. A caption noun that maps onto no visible label reads as a different
app.

## Glossary (source -> target, where it comes from)
| en-US | <locale> | Source |
|---|---|---|
| lap | Runde | Localizable.xcstrings `lap.title` |
| track | Strecke | metadata/version/1.0.0/<locale>.json description |

## Numbers, dates, units
Thousands separator, decimal mark, date order, units the app shows in this locale.

## Social proof and claims that must stay accurate
"60.000+ Nutzer" (listing says 60,000+ as of <date>).

## Expansion budget
Typical: de +30 %, fr/es/pt +20 %, ja/zh/ko -30 % versus en-US.
```

Commit the brief with the copy file at G5.

## 4. Transcreate copy and layout together

Write `screenshots/copy/<locale>.json` with one entry per source screen key.
Draft all screens up front; this step is read-only text work and may be
parallelized. Rendering and review later are sequential.

Rules:

- Transcreate; do not translate. Match the marketing intent of the source
  line and the app's terminology from the brief. A literal rendering of an
  English verb-first headline is often not idiomatic.
- Keep the four headline rules from the copy playbook: verb-first where the
  language allows it, 2 to 5 words, one benefit, one highlight word. Subline
  8 words or fewer.
- Decide copy and layout together. The target language is often longer.
  Write the exact lines as an array so the line breaks are yours, not the
  fitter's. Lead with the emphasis word (usually the key noun) so the
  highlight lands on its own line. Short lines beat one long line.
- `highlight` must be an exact substring of the joined headline. Pick the
  word the reader should keep; in German that is often the noun that now
  leads the line. In a compounding language check that the highlight is not
  a prefix of a longer word earlier in the headline (`"Runde"` inside
  `"Rundenzeiten"` colours half a compound, because the first substring
  match wins). Highlight the whole compound instead.
- Write each headline in the case the language wants. The theme no longer
  re-cases it. See the note under the example below.
- Apply the locale's number and punctuation conventions in the copy itself:
  German `60.000+` and a decimal comma, French narrow space before `:` and
  `!`, Japanese full-width punctuation. The renderer prints exactly what the
  file says; there is no model to drift back to `60,000+`.
- Never render a core concept with two different words across the set.
- Put the reasoning in `layoutNotes`. The field is never rendered; it is for
  the next agent and the reviewer.
- Re-decide line breaks per device family. iPad canvases are wider. Use
  `locales.<locale>` overrides in `screens.ts` only when a template or prop
  must change for the locale; copy line breaks belong in the copy file.

Example (illustrative values):

```json
{
  "locale": "de-DE",
  "approved": false,
  "shared": { "appName": "MotoFit" },
  "screens": {
    "map": {
      "headline": ["Jede Runde", "auf der Karte"],
      "highlight": "Runde",
      "subline": "GPS-Strecke jeder Fahrt, automatisch",
      "layoutNotes": "Noun leads so the highlight sits alone on line 1. DE is ~30% longer than 'Every Ride on the Map'; two short lines instead of one."
    },
    "laps": {
      "headline": ["Rundenzeiten", "automatisch"],
      "highlight": "automatisch",
      "subline": "Startlinie setzen, Rest passiert allein",
      "badge": "Neu"
    }
  }
}
```

`theme.headlineCase: 'title'`, the documented default, applies English title
case only when the render locale is English; in every other language it renders
as `sentence`, so the example above renders as "Jede Runde / auf der Karte".
The copy therefore carries the case: write each line as the language wants it
and check on the contact sheet that the rendered case is the case the JSON
says. Only `'upper'` still transforms every locale.

Keep `approved: false` until G5. Check the file parses and every key maps
to a screen before you show it to the user:

```bash
s1s render --locale de-DE --dry-run --allow-placeholder --json | jq '{ok, counts: .report.counts, warnings: [.report.items[].warnings[]? | select(.code=="copy-missing" or .code=="copy-unused")]}'
```

`copy-missing` names a screen without an entry; `copy-unused` names a stray
key. Fix both before G5.

## 5. Gate G5: copy approval

Present the full copy table for the locale in one message: screen id, source
headline, target lines, highlight word, subline, badge, and the capture-mode
line from section 2. Ask for explicit approval. Never proceed on silence.

On approval:

1. Set `"approved": true` in `screenshots/copy/<locale>.json`.
2. Set `manifest.locales.<locale>.copyStatus` to `"approved"`.
3. Run `s1s status --set copy-approved --locale <locale> --from pending --yes`.
   `--from pending` leaves higher statuses untouched; without it one
   `captured` image refuses the whole write, because `captured ->
   copy-approved` is a refused transition (exit 2, nothing written). A
   size x screen the manifest has no node for counts as `pending`, so the same
   command creates it.

   `--from pending` matches nothing once the locale has been rendered, which
   section 4 encourages you to do. The command then prints the status table
   and `OK`, exits 0, and writes nothing; only the stderr line `no image of
   <locale> is pending; nothing was written.` says so. If you rendered before
   G5, the copy approval lives in `copy/<locale>.json` (`"approved": true`)
   and `manifest.locales.<locale>.copyStatus`; check
   `s1s status --locale <locale> --json` and re-run the `--set` only while
   rows are still at `pending`.
4. Offer a commit (section 12).

## 6. Own captures: re-apply the demo patch and replay the steps

Skip this section when `captureSource` is `reuse:<source>`.

The demo-data patch and the per-screen navigation steps from Phase 2 are the
replay script. Do not improvise new demo data for a locale; the numbers and
names in the captures must match the source set.

1. Re-enter the demo-data branch. The Phase 2 branch usually still exists
   (SKILL.md keeps it until P7); recreate it from the patch only when it is
   gone. The baseline recording is `screenshots/captures/git-status-before.txt`
   from Phase 2 (`manifest.demoData.baselineFile`); record it now only if the
   file is missing:

   ```bash
   test -f screenshots/captures/git-status-before.txt || git status --short > screenshots/captures/git-status-before.txt
   git switch s1s/demo-data 2>/dev/null || { git switch -c s1s/demo-data main && git apply --check screenshots/captures/demo-data.patch && git apply screenshots/captures/demo-data.patch; }
   ```

   Only when the branch was newly created, stage the patched files by name
   and make the WIP commit. List them first, then name each one: a rename in
   the patch breaks any one-liner that parses the diff. Never `git add -A`.

   ```bash
   git status --short                       # exactly the files the patch touched
   git add -- <path> <path> ...             # copy the paths from the line above
   git commit -m "TEMP: screenshot demo data (do not merge)"
   ```

   Set `manifest.demoData.appliedAt`. If `git apply --check` fails, the app
   moved since Phase 2; stop and report the rejected hunks rather than
   patching by hand.
2. Boot the same simulator class the source captures used
   (`manifest.sizes.<size>.simulator`). One live simulator at a time: shut
   everything down first. Stale UDIDs are common and shell variables do not
   survive between agent calls: resolve the `S1S-<App>-*` sim by name at the
   head of every chain (create it as in the capture playbook when the name
   does not resolve).

   ```bash
   xcrun simctl shutdown all
   UDID=$(s1s sim list --json | jq -r '.devices[] | select(.name=="S1S-<App>-iPhone17ProMax") | .udid' | head -1)
   xcrun simctl boot "$UDID" && xcrun simctl bootstatus "$UDID" -b
   s1s sim appearance "$UDID" dark        # the appearance the source set used
   s1s sim status-bar "$UDID"
   ```
3. Build and install as in the capture playbook, then launch in the target
   language. `manifest.demoData.launchApprovedAt` must exist (gate G0);
   when it is absent, ask before this launch. Language and locale are launch
   arguments; the demo flag is an environment variable prefixed
   `SIMCTL_CHILD_` (`manifest.demoData.envFlag` holds the bare name):

   ```bash
   SIMCTL_CHILD_<envFlag>=1 xcrun simctl launch --terminate-running-process "$UDID" <bundleId> \
     -AppleLanguages "(de)" -AppleLocale de_DE
   ```

   XcodeBuildMCP alternative: `build_sim`, `get_sim_app_path`,
   `install_app_sim`, then `launch_app_sim` with `env: { <envFlag>: "1" }`
   and `launchArgs: ["-AppleLanguages", "(de)", "-AppleLocale", "de_DE"]`.
   `build_run_sim` has no `env`, so do not use it here. Permissions that
   `simctl privacy` cannot pre-grant (HealthKit) must already be bypassed in
   the patch; the source captures proved that.
4. Confirm the UI is in the target language before the first capture (look
   at a tab title). If it is still English, the app does not ship the
   language or the language code is wrong; fix the decision in section 2.
5. Per screen, in `manifest.screens[].order`, replay
   `manifest.screens[].capture.steps` exactly, then capture into the locale
   folder:

   ```bash
   s1s capture --udid "$UDID" --name <screen-id> --device iphone --locale de-DE
   ```

   The command verifies the pixel size, records path, sha256 and px under
   `manifest.locales.de-DE.devices.<size>.screens.<id>`, and moves
   `copy-approved` to `captured`. A retake of a screen already at `generated`
   or above keeps its status: set it back to `captured` right after the
   capture, or re-render it in the same step. Rate each capture with the
   Great / Usable / Retake rubric from the capture playbook and write
   `captureRating`. Retake anything below Usable before moving on.
6. Repeat for iPad, then watch. A watch capture is passthrough (raw
   416x496); only recapture it when the watch app ships the language.
7. Tear down and prove the tree is clean:

   ```bash
   xcrun simctl shutdown all
   git switch main
   git status --short | diff screenshots/captures/git-status-before.txt -   # only screenshots/ and metadata/screenshots/ lines may differ
   ```

   Keep the branch for the next locale; SKILL.md P7 deletes it and sets
   `manifest.demoData.revertedAt`. Never `git clean`, never `git add -A`.

## 7. Render the locale and check the expansion

First make sure the source locale you will compare against exists on disk:

```bash
test -f screenshots/out/en-US/sheet-iphone-6.9.png || s1s render --locale en-US
```

`screenshots/.gitignore` ignores `out/`, so the source-locale renders and
sheets are usually absent in a fresh checkout even when the manifest says
`exported`. Re-render the source locale first; unchanged copy gives unchanged
hashes, so nothing is re-approved. To rebuild only the sheets from an existing
`report.json`, run `s1s sheet --locale <locale>`.

Then render iPhone first, then iPad. Text is fitted per screen; longer copy
shrinks until it fits or until `minPt`, at which point the renderer reports
`text-min-size` and exits 1.

```bash
s1s render --locale de-DE --sizes iphone-6.9; echo "exit $?"
jq '.counts, [.items[] | select(.warnings|length>0) | {screenId, warnings: [.warnings[] | {code, level, message}]}]' screenshots/out/de-DE/report.json
```

`report.json` is the raw report. The `--json` output of `s1s render` wraps
it as `{ ok, report, sheets }`, so query `.report.counts` there.

Expect the expansion from the brief: German about +30 %, French, Spanish and
Portuguese about +20 %, Japanese, Chinese and Korean about -30 %. A screen
whose headline shrank far below its en-US sibling reads as a different
design; compare `screenshots/out/de-DE/sheet-iphone-6.9.png` against
`screenshots/out/en-US/sheet-iphone-6.9.png` side by side. `report.json`
carries no fitted point size, so this comparison has no headless form: judge
it by eye off the two contact sheets, or read `data-s1s-fitted` on the
headline element in `s1s dev`.

Warning codes and the fix that is yours to make:

| Code | Level | Fix |
|---|---|---|
| `text-min-size`, `text-clipped`, `overflow` | error | Re-break the lines, shorten the subline, or drop a filler word. Do not change meaning without asking. |
| `capture-fallback-locale` | info | A declared `reuse:<l>`: expected, and the message names the locale the pixels came from. |
| `capture-fallback-locale` | warn | No `reuse:` declares it, so section 6 was skipped for that screen: the locale would ship source-locale pixels. Capture it, or set `locales.<locale>.captureSource` to `"reuse:<l>"` if the reuse is deliberate. |
| `capture-missing` | error | Section 6 skipped a screen. Capture it. |
| `copy-missing` | error | Add the screen entry to `copy/<locale>.json`; the render fails until it exists. |
| `copy-unused` | info | Delete the stray key or fix the id. |
| `font-fallback` | warn | The theme font stack has no installed family. Set `theme.fonts.headline`/`body` to a family the machine has (one theme for every locale), drop the face files into `screenshots/fonts/` so they ship with the repo (template-catalog.md, "Project fonts"), or set `portable: true` for the bundled Inter. Common for ja, zh, ko, ar, he, where the family must also carry the script's glyphs. |

Autonomous fixes are limited to line breaks, a same-style template swap, and
a theme font scale change of at most 10 %. Three rounds per screen, then
ask. Look at the contact sheet first, then only the previews of warned
screens:

```bash
ls screenshots/out/de-DE/sheet-*.png screenshots/out/de-DE/APP_IPHONE_69/preview/
```

Read the sheet (Claude Code: Read the PNG; other agents: open
`s1s dev --locale de-DE --open` or hand the sheet path to the human). Check
that the rendered text equals the JSON, the highlight word is the intended
one, no line wraps where the array says it must not, and numbers carry the
locale's separators. Then render `ipad-13` and repeat. Watch renders are a
copy of the capture; validate dims only.

Every successful render sets `status` to `generated` for the changed
screens. A screen already `uploaded` whose hash changes gets `wasUploaded:
true`; `s1s status` reports it as a row note, and it must go through G6 and
G7 again.

## 8. Gate G6: image approval

Give the human three things: the `s1s dev --locale de-DE --open` URL, the
sheet paths, and `screenshots/out/de-DE/review.md`. Ask for approval per
device set. On approval set every screen of that set to `image-approved`.
Never advance a set on silence, and never call a set approved while any of
its screens carries an error-level warning.

## 9. Export, validate, all-or-nothing upload, verify (gate G7)

Ship per device, all screens of that device at once. Apple does not fall
back a single slot to the primary language: once a locale has its own set
for a device, that exact set ships, half-translated or not. A locale whose
iPhone set is done but whose iPad set is not may upload iPhone only; the
iPad set then keeps showing the primary-language images. Adding a language
in App Store Connect copies the primary-language screenshots in silently, so
audit every device set of the locale before release; the copy is a trap,
not a safety net.

1. Export and validate:

   ```bash
   s1s export --locale de-DE --sizes iphone-6.9
   s1s validate --locale de-DE --sizes iphone-6.9
   ```

   Never copy PNGs into `metadata/screenshots/` by hand; `s1s export` owns
   that folder. `export` writes under `manifest.app.metadataDir` and
   `validate` reads the same root; both take `--metadata-dir <dir>` (absolute,
   or relative to the app repo) to point somewhere else. Use it only when the
   repo keeps its export tree outside the manifest's `metadataDir`, and give
   both commands the same value or `validate` checks the wrong folder.
   `export` refuses an
   incomplete or error-carrying set (`export-blocked`, exit 1) but not an
   unapproved one: a set that has not been through G6 gets the warn-level
   `export-unapproved` and is exported anyway, so G6 is yours to enforce. It
   copies changed
   renders to `metadata/screenshots/de-DE/APP_IPHONE_69/NN.png`, warns about
   sibling `APP_*` folders with identical dims (the asc fan-out double-upload
   trap), sets `exported`, runs `asc screenshots validate` per size when
   `asc` is present, and prints the per-localization upload command of
   `asc-upload.md` section 7 for each display type, already carrying
   `--dry-run` (the section 8 fan-out form follows only when no sibling
   folder shares the dims). `validate` checks the folder offline: `NN.png`
   contiguous from `01`, 1 to 10 files, dims in the accepted list, no alpha,
   RGB, uniform dims per set, and all-or-nothing across locales. `--locale
   de-DE` narrows the table only: the all-or-nothing rule still compares
   every locale folder, so this run can report that en-US has a display type
   de-DE is missing. Never touch another locale's folder; the source locale
   is immutable.
2. Stop at "ready to upload" unless the user asked for the upload. This is
   gate G7: show the exact command, the version string and the device set,
   and get a yes.
3. Upload with a dry run first, then for real with `--replace` so order and
   dims stay uniform. Use the per-localization form (one folder into one
   set) from `asc-upload.md` section 7; `$LOC_TARGET` is the target locale's
   `versionLocalizationId`:

   ```bash
   asc screenshots upload --version-localization "$LOC_TARGET" \
     --path metadata/screenshots/de-DE/APP_IPHONE_69 --device-type IPHONE_69 --dry-run --pretty
   asc screenshots upload --version-localization "$LOC_TARGET" \
     --path metadata/screenshots/de-DE/APP_IPHONE_69 --device-type IPHONE_69 --replace --pretty
   ```

   The fan-out form (`--app --version --path metadata/screenshots`) touches
   every locale directory under the export root; use it only when several
   locales are all complete for the device and no sibling `APP_*` folder
   shares the dims (`asc-upload.md` section 8). The `--device-type` token
   drops the `APP_` prefix of the folder name (`APP_IPHONE_69` folder,
   `IPHONE_69` token; `APP_IPAD_PRO_3GEN_129`, `IPAD_PRO_3GEN_129`;
   `APP_WATCH_SERIES_10`, `WATCH_SERIES_10`).
4. Verify. The list is nested under `sets[].screenshots[]`, not `data[]`:

   ```bash
   asc screenshots list --version-localization "$LOC_TARGET" --output json \
     | jq -r '.sets[] | select(.set.attributes.screenshotDisplayType=="APP_IPHONE_69")
              | .screenshots[] | "\(.attributes.fileName)\t\(.attributes.assetDeliveryState.state)"'
   ```

   Every `NN.png` must be present with state `COMPLETE`. Re-upload any that
   is not. Then record it in the manifest:

   ```bash
   s1s status --set uploaded --locale de-DE --sizes iphone-6.9 --yes
   ```

   That sets the status, writes `uploadedAt` and clears `wasUploaded`;
   `storeFileName` came from `s1s export`. Read the exit code as a statement
   about the table, not about the write: `s1s status` exits 1 whenever the
   reconcile is NOT OK, and it re-reconciles after a `--set`, so a write that
   moved a row past the files it has on disk succeeds and still exits 1. The
   stderr line `set N image(s) to <status> in ...` is what tells you the write
   happened. Exit 2 means the command refused and wrote nothing. Full table:
   `agent-tooling.md` section 5.
5. Repeat steps 1 to 4 for `ipad-13`, then `watch-s10` when present.

## 10. Reconcile on resume

Every run starts by reconciling `screenshots/manifest.json` with the files on
disk. `s1s status --json` does that; it never contacts the store, so pair it
with the `asc screenshots list` query above when you need the shipped state.
Per locale, per device, per screen:

| Manifest status | Render in `out/` | Export in `metadata/` | Store COMPLETE | Action |
|---|---|---|---|---|
| `uploaded` | any | yes | yes | Done. Skip. |
| `uploaded`, `wasUploaded: true` | yes | any | yes | The render changed after upload. Back to G6 for this screen, then re-export and re-upload the whole device set. |
| `uploaded` | any | yes | no | Trust the store (version recreated?). Set `exported`, re-upload the set, re-verify. |
| `exported` | yes | yes | no | Resume at G7 (upload). |
| `image-approved` | yes | no | no | Resume at export. |
| `generated` | yes | no | no | Resume at G6 review. |
| `captured` | no | no | no | Resume at render. |
| `copy-approved` | no | no | no | `own`: resume at capture. `reuse:`: resume at render. |
| `pending` or missing entry | no | no | no | Resume at copy drafting; treat a missing entry as `pending`. |

Rules:

- The store is authoritative for "shipped". A store `COMPLETE` asset with a
  lower manifest status advances the manifest to `uploaded` unless
  `wasUploaded` is true or the local export sha differs from `exportSha256`;
  then the image is shipped-but-stale: review, export, re-upload, then
  `s1s status --set uploaded`, which clears `wasUploaded`. `s1s status`
  prints the stale rows as notes, so you need not read the JSON for them.
- Never re-transcreate or re-render a screen at `image-approved` or above
  unless its inputs changed. Resume at the next incomplete step.
- Missing render or export files at a high status mean `out/` was cleaned or
  the export was never committed: re-render or re-export, keep the status
  history, and do not ask the user to re-approve unchanged hashes.
- Finish the whole iPhone set before iPad. Print the progress table at the
  start of every run and confirm the resume point with the user.

## 11. Lessons that still apply

1. Decide copy with layout. Long target text poured into a source layout
   shrinks until it looks like a different design. Short per-line chunks;
   lead with the emphasis noun so the highlight lands on its own line.
2. Numbers and punctuation are locale rules, not a translation detail:
   `60.000+`, decimal comma, date order, unit spacing. Write them into the
   copy file and check them on the sheet.
3. The app's real strings beat any invented translation. Look every visible
   UI term up; never let a caption use a noun the app itself does not use.
4. The iPad canvas is wider. Re-decide line breaks per family; the iPhone
   array is a starting point, not the answer.
5. `asc screenshots list` nests results under `sets[].screenshots[]`, not
   `data[]`. `asc versions list` uses `.data[]`. The gotcha is specific to
   `screenshots list`.
6. Folder versus token: export folders carry `APP_`; `--device-type` drops it.
7. Target-locale screenshots attach to one editable version's localization.
   Resolve app, version and localization ids on every run.
8. Ship all-or-nothing per device. A half-localized set goes live
   half-localized.
9. Adding a language copies the primary screenshots in. Audit each device set
   of the new locale in the store before release.
10. Filename order (`01`, `02`, ...) is store display order. Keep `NN` the
    same across locales.
11. No screen needs a special no-text path here: a screen without copy
    renders the same in every locale, and reuse of the source captures is a
    manifest setting, not a manual copy of files.
12. Keep the source locale immutable. Add the target locale's files; leave
    every other locale folder byte-unchanged.
13. Frozen versions reject uploads, and being "not `READY_FOR_SALE`" is not
    the same as editable.

## 12. Commit

Offer a commit at G5 (brief, copy, manifest), after own captures
(captures, manifest), after export (`metadata/screenshots/<locale>/`,
manifest) and after upload (manifest). Stage by path, never `-A`. Subject
format, no trailer of any kind:

```
ios: add de-DE App Store screenshots (iPhone 6.9", iPad 13")
```

Use `ios: add de-DE screenshot copy` for the G5 commit and
`ios: upload de-DE App Store screenshots` after upload. If the repo keeps a
"new language" checklist, append any language-general trap found in this
run so the next locale benefits.
