# W6 de-DE localization dry run

A full pass of `references/localize-playbook.md` on a sandbox copy of the
MotoFit screenshots project, done before anyone needs German, to prove the
localization path works and to test whether the playbooks are followable.

- Sandbox: `<scratch>/de-de-dryrun/screenshots` (a copy of MotoFit's
  `screenshots/` with `node_modules` symlinked to this checkout; the main
  agent made the copy before the run). Nothing in
  `/Users/jason/Documents/Repositories/MotoFit` was read or written during
  the run itself, and its working tree is unchanged.
- Tool: `s1s` 0.1.0 from this checkout (`~/.local/bin/s1s`), `asc` 1.2.2.
- No source file of this repo was changed. No `asc screenshots upload` ran,
  not even `--dry-run`.

**Result: the path works.** German copy rendered at the first attempt on
every size with zero error- and zero warn-level warnings, exported, and
passed `s1s validate` across two locales. **One defect makes the result
unshippable as it stands:** `theme.headlineCase: 'title'` applies English
title case to German, so every German headline renders with a capitalised
preposition or verb ("Auf Der Karte", "In 3D", "Einmal Setzen"). See
tool defect T1.

---

## 1. What ran, and what came back

| # | Step | Command | Outcome |
|---|---|---|---|
| 1 | Learn the app | read `plan.md`, `screens.ts`, `theme.ts`, `copy/en-US.json`, `manifest.json` | 6 iPhone screens, 4 of them on iPad, 4 watch passthrough screens; one template (`hero-top-text`); `manifest.app.appLocales` = `["en-US"]` |
| 2 | Read the playbooks | `localize-playbook.md`, `copy-playbook.md` | followed section by section; defects listed in section 5 |
| 3a | Capture mode | `manifest.app.appLocales` | `reuse:en-US` (the app ships no German), per the playbook's table |
| 3b | Brief | wrote `screenshots/copy/brief.md` | glossary, register (du), expansion budget, the reuse warning quoted verbatim |
| 3c | Copy | wrote `screenshots/copy/de-DE.json` | 6 screens, every headline an explicit 2-line array |
| 4 | Declare the locale | `screens.ts` `locales: ['en-US', 'de-DE']`; `manifest.locales["de-DE"] = { copyStatus, captureSource: "reuse:en-US", devices: {} }` | both accepted; the manifest snippet in the playbook works verbatim |
| 4b | Pre-G5 copy check | `s1s render --locale de-DE --dry-run --allow-placeholder --json` | `ok: true`, 14 skipped, 0 errors, 14 infos. Proved it catches real holes: deleting one screen key and adding a stray one gave 1 error `copy-missing` + 1 info `copy-unused`, `ok: false`, **exit 1** |
| 5 | Capture fallback | as above | 14x info `capture-fallback-locale`, e.g. `Capture "track-map" for de-DE uses the en-US file captures/en-US/iphone/track-map.png`. Nothing failed |
| 6 | Render, round 1 | `s1s render --locale de-DE --json` (all three sizes) | **14 rendered, 0 failed, 0 errors, 0 warns, 14 infos** in 5.5 s. No overflow, no clipping, no `text-min-size`. **1 render round of the 4 allowed; rounds 2-4 were not needed** |
| 7a | Contact sheets | `s1s sheet --locale de-DE` | 3 sheets: iphone-6.9 1750x1594 (6 tiles), ipad-13 2148x792 (4), watch-s10 500x228 (4) |
| 7b | Judge them | Read all three sheets, plus the en-US sheet for comparison | German fits; line breaks land where the copy file says; the highlight word is the intended one on all 6 screens. **The casing is wrong on all 6** (T1). Detail in section 3 |
| 8a | Export the source locale | `s1s export --locale en-US` | 14 files written. Needed first: the sandbox had `out/` and `metadata/` empty even though the manifest said `exported` (see playbook defect P8) |
| 8b | Export iPhone only | `s1s export --locale de-DE --sizes iphone-6.9` | 6 files, `asc` ok, warn `export-unapproved` (exported anyway), 2x warn `manifest-incomplete` |
| 8c | **All-or-nothing test** | `s1s validate` (no `--locale`) | **2 errors, exit 1** - see section 4 |
| 8d | Finish the locale | `s1s export --locale de-DE` | 14 files, `asc` ok on all three display types |
| 8e | Re-validate | `s1s validate` (no `--locale`) | 6 sets in 2 locales, 0 errors, 0 warnings, "Ready to upload", exit 0 |
| 9 | asc, read-only | `asc screenshots validate --path metadata/screenshots/de-DE/<folder> --device-type <token>` x3 | `errorCount: 0, warningCount: 0` on all three; 6/4/4 files at 1320x2868 / 2064x2752 / 416x496. **No upload command of any kind was run** |

Gate handling: there is no human in this dry run, so G5 (copy approval) and
G6 (image approval) were recorded, not asked. `copy/de-DE.json` was set
`approved: true` and `manifest.locales["de-DE"].copyStatus` to `approved`
only to exercise the writes.

---

## 2. The de-DE copy, for a German reviewer

Register: **du**. Object noun: **Moto** (the app's own word; `Motos` tab,
`All Motos` header, app name). Every headline is an explicit two-line array,
so the break is the copy's decision and not the fitter's. Full reasoning per
screen is in the `layoutNotes` of `screenshots/copy/de-DE.json`; the glossary
and its sources are in `screenshots/copy/brief.md`.

| # | id | en-US headline | de-DE headline (as written) | highlight | de-DE subline |
|---|---|---|---|---|---|
| 1 | `track-map` | Log Every Moto | Jedes Moto / auf der Karte | Moto | GPS-Route, Puls und Kalorien |
| 2 | `lap-times` | Time Every Lap | Rundenzeiten / automatisch | Rundenzeiten | Motocross-Zeitmessung, beste Runde markiert |
| 3 | `replay-3d` | Replay in 3D | Deine Linie / in 3D | 3D | Tempo und Puls, Runde für Runde |
| 4 | `track-history` | Compare Every Moto | Jedes Moto / vergleichen | vergleichen | Alle Motos, nach Strecke sortiert |
| 5 | `start-line` | Set the Start Line | Startlinie / einmal setzen | Startlinie | Danach zählt jede Runde von selbst |
| 6 | `share-moto` | Share the Moto | Dein Moto / teilen | teilen | Route, Runden und Puls in einem Bild |

Screen 2 keeps the en-US badge `Apple Watch` unchanged. Screens 5 and 6 are
iPhone only, exactly as in en-US. The four watch screens carry no copy
(`raw` template) in either locale.

Transcreation decisions a reviewer should check first:

- **Nominal, not verb-first.** The English set is verb-first ("Log", "Time",
  "Compare", "Share"). German leads with the object noun and puts the verb or
  the adverb on line 2, which is what the localize playbook prescribes and
  what puts the highlight word alone on its own line.
- **`Linie` for the 3D replay.** A literal "Replay in 3D" would have been the
  same string in both locales and would read untranslated. `die Linie` is the
  rider's own word for the line he rode, and it is exactly what the flyover
  draws.
- **`Karte` = map, `Bild` = share card.** Two senses of `Karte` in one set is
  the terminology drift the copy playbook forbids, so screen 6 says `Bild`.
- **`Strecke` = the circuit, `Route` = the GPS trace.** The same split, made
  once, for the same reason.
- **`Puls`, not `Herzfrequenz`; `Tempo`, not `Geschwindigkeit`.** Both save
  the subline and both are the words a rider uses.
- **`Startlinie`, not `Startgatter`.** The frame shows the app's virtual
  crossing line and the button next to it says `Edit Start Line`.
- **Numbers.** The set quotes no number in either locale, so the German
  number rules (decimal comma, thousands point, no-break space before a unit)
  do not bite. They are recorded in the brief for whatever is added later.
  Note that the frames themselves stay imperial and 12-hour, because the
  captures are en-US.

What the German set does **not** do, and should before it ships: the app UI
inside every frame is English. That is the `reuse:` bargain and it is
recorded in the brief and in the G5 warning text; a real run must say it to
the user before approval.

---

## 3. What the sheets show

`out/de-DE/sheet-iphone-6.9.png`, `sheet-ipad-13.png`, `sheet-watch-s10.png`
(and `out/en-US/sheet-iphone-6.9.png`, rendered for the side-by-side
comparison section 7 of the playbook asks for).

Good:

- Nothing is clipped and nothing shrank to `minPt`. Every German headline
  holds two lines at what looks like the same size across the set, so the
  German carousel is, if anything, more uniform than the en-US one (which
  mixes one-line and two-line headlines).
- Every subline holds one line on both iPhone and iPad. The en-US set needs
  two lines on screens 2 and 6; German does not.
- The highlight lands on the intended word on all six screens and is the
  lime `#99E361` in every case, including the two-token `in 3D`.
- Umlauts and `ß` render in the default SF Pro stack with no `font-fallback`
  warning (`zählt`, `für`, `über`).
- The watch renders are byte-identical to the en-US ones (`cmp` on all four),
  which is what a passthrough reuse should produce.

Bad, and the reason this set cannot ship as rendered:

| Screen | JSON says | Renders as | Correct German |
|---|---|---|---|
| 1 | `Jedes Moto` / `auf der Karte` | Jedes Moto / **Auf Der Karte** | auf der Karte |
| 2 | `Rundenzeiten` / `automatisch` | Rundenzeiten / **Automatisch** | automatisch |
| 3 | `Deine Linie` / `in 3D` | Deine Linie / **In 3D** | in 3D |
| 4 | `Jedes Moto` / `vergleichen` | Jedes Moto / **Vergleichen** | vergleichen |
| 5 | `Startlinie` / `einmal setzen` | Startlinie / **Einmal Setzen** | einmal setzen |
| 6 | `Dein Moto` / `teilen` | Dein Moto / **Teilen** | teilen |

This is tool defect T1, not a copy choice. German capitalises nouns, not
every word; a German reader sees six frames of it and reads the set as
machine-translated. The copy file is written correctly and is left
uncorrected on purpose, so the defect stays visible.

---

## 4. Warnings that survived

After the final render and export, the de-DE set carries exactly three kinds
of warning. Nothing at error level.

| Code | Level | Count | Why it survives |
|---|---|---|---|
| `capture-fallback-locale` | info | 14 (one per rendered item) | **Expected and correct.** `captureSource: "reuse:en-US"`, so every frame reads `captures/en-US/<family>/<ref>.png`. This is the fallback the task asked for, and it is informational rather than fatal, as designed. |
| `export-unapproved` | warn | 1 (`APP_IPHONE_69`, 6 screens) | An artefact of an experiment in this dry run, and the tool behaving correctly. Re-rendering the six iPhone screens under a different `headlineCase` changed their hashes, which correctly demoted them from `exported` back to `generated`; the next `s1s export` then flagged them as not image-approved and exported them anyway. In a real run G6 comes first and this does not appear. |
| `manifest-incomplete` | warn | 2 | No `versionLocalizationId` and no `versionString` under `manifest.locales["de-DE"]`. Correct: this run deliberately resolved no App Store Connect ids, because step 9 of the task forbids any upload. A real run fills them at playbook section 1. |

Step 7 of the task asks for the previews of any screen still warned. No
screen carries a warn- or error-level warning of its own, so there was
nothing to open beyond the three contact sheets and the en-US sheet.

The all-or-nothing test, recorded verbatim. With en-US exported for all three
display types and de-DE exported for iPhone only, `s1s validate` with **no**
`--locale`:

```
locale  display type           files  dims       problems
------  ---------------------  -----  ---------  --------
de-DE   APP_IPHONE_69          6      1320x2868  ok
en-US   APP_IPAD_PRO_3GEN_129  4      2064x2752  ok
en-US   APP_IPHONE_69          6      1320x2868  ok
en-US   APP_WATCH_SERIES_10    4      416x496    ok

4 sets in 2 locales under <sandbox>/metadata/screenshots; 2 errors, 0 warnings.

Errors:
  - locale-incomplete: APP_IPAD_PRO_3GEN_129 exists in en-US but not in de-DE; uploads are all-or-nothing per display type.
  - locale-incomplete: APP_WATCH_SERIES_10 exists in en-US but not in de-DE; uploads are all-or-nothing per display type.
```

Exit code 1. After `s1s export --locale de-DE` completed the locale: 6 sets,
0 errors, 0 warnings, "Ready to upload", exit 0.

The `--locale` narrowing behaviour the contract promises also holds. With
de-DE's watch folder removed, both `s1s validate --locale de-DE` and
`s1s validate --locale en-US` still reported the same `locale-incomplete`
error, each with a sentence naming the sibling locale outside the filter, and
both exited 1. The `--json` form carries `scope: "tree"` on that problem.

---

## 5. Defects found in the TOOL

### T1 (blocking for any non-English locale) English title case is applied to every locale

`src/web/components/Headline.tsx:7` defines `SMALL_WORDS` as an English list
(`a, an, the, and, or, ... with, vs, via, as`). `titleCaseLine`
(`src/web/components/Headline.tsx:17-30`) capitalises every word that is not
in that list, and `applyCase` (`:33-42`) runs it per line for
`headlineCase: 'title'`, which is the documented default and what MotoFit's
`theme.ts` sets. No German, French, Spanish or Italian function word is in
the list, and German capitalises nouns only, so every German headline comes
out wrong (table in section 3). Explicit line arrays make it worse: each line
is cased on its own, so the first word of line 2 is always capitalised even
mid-sentence.

Evidence and a measured workaround: setting `headlineCase: 'sentence'` in
`theme.ts` and re-rendering both locales gives **correct German on all six
screens** and **byte-identical en-US renders** - all six en-US iPhone hashes
matched the `title` run exactly, because the en-US copy is already written in
title case in the JSON and `sentence` never lowercases. So for this project
the fix is free. That is a project-level workaround, not the tool fix.

Suggested tool fix: apply English title case only when the render locale's
primary subtag is `en`, and fall back to `sentence` behaviour otherwise; or
make the small-word list part of the theme. Whichever is chosen,
`applyCase` already receives the render locale, so the information is there.
The default must stop corrupting the first non-English locale that arrives.

### T2 `captureSource: "own"` with no locale captures is indistinguishable from `reuse:`

`captureWarnings` (`src/core/captures.ts:142`) never sees
`manifest.locales.<locale>.captureSource`, so the `capture-fallback-locale`
warning it builds at `src/core/captures.ts:153-158` is info level in both
capture modes.

Reproduced: with `manifest.locales["de-DE"].captureSource` flipped to `"own"`
and zero files under `captures/de-DE/`, `s1s render --locale de-DE` still
rendered 14 of 14 items, reported only the 14 info warnings, and **exited 0**.
The localize playbook's own table calls this case "a defect for `own`", but
no command reports it as one. An agent that trusts the exit code ships an
English-captured set labelled as a German own-capture set.

Suggested fix: pass the locale's `captureSource` into `captureWarnings` and
promote `capture-fallback-locale` to error (or warn) when the mode is `own`.

### T3 A reuse hit that is not the source locale is still labelled `source-locale`

`src/core/captures.ts:61` pushes `{ locale: reuse, fallback: 'source-locale' }`
for any `reuse:<l>` target, including one that is not
`manifest.app.sourceLocale`. The human-readable message names the real locale,
so today this is cosmetic; it becomes wrong data the first time a project does
`reuse:de-DE` for `de-AT`. A `CaptureFallback` value of `'reuse'` (or
`'other-locale'`) would carry the truth.

### T4 The render page hard-codes `lang="en"`

`src/web/index.html:2` is `<html lang="en">` and nothing sets
`document.documentElement.lang` from the render locale. Two consequences:

- `Badge` casing is CSS `text-transform: uppercase`
  (`src/web/components/Badge.tsx:46`), which is language-sensitive in the
  browser and therefore runs under English rules for every locale. The copy
  playbook's claim that "casing is locale-aware (ß, Turkish i)" is true of
  `applyCase`, which takes an explicit locale, and false of the badge.
- Wrapped (non-array) headlines and every subline use `text-wrap: balance`
  and the browser's line-breaking, both chosen under `lang="en"`.

Neither bit this set (the badge is the brand string "Apple Watch" and every
German headline is an explicit array), but both will bite a locale that
relies on the fitter.

### Not defects, recorded because they were checked

- `s1s validate` exit codes are correct: 1 whenever an error-level problem is
  reported, with or without `--locale`. An earlier reading of 0 in this run
  was a shell artefact (`s1s ... | tail` reports `tail`'s status).
- The render bookkeeping is right: a re-render whose hash changed demoted six
  `exported` images back to `generated`, and the next export flagged them.
- `s1s render --json` is the only command that nests its report under
  `.report`; `export`, `validate`, `sheet` and `status` put their fields at
  the top level. The localize playbook already warns about the render case.
- `asc screenshots validate --device-type IPHONE_69` still reports
  `apiDisplayType: APP_IPHONE_67`, the quirk `CONTRACTS.md` section 9 already
  records. It did not stop anything here.

---

## 6. Defects found in the PLAYBOOKS

Ordered by how much damage each one does to the next locale.

### P1 `localize-playbook.md` section 4: the worked example is broken by the default theme

The example writes

```json
"headline": ["Jede Runde", "auf der Karte"],
```

Under `theme.headlineCase: 'title'`, the documented default, that renders as
`Jede Runde / Auf Der Karte`. The playbook's single German example teaches the
exact output T1 corrupts, and an agent copying it will believe the result is
what the playbook intended.

Change: keep the example and add, immediately under it:

> `theme.headlineCase: 'title'` applies English title case to every locale
> and capitalises the first word of every explicit line, so this example
> renders as "Jede Runde / Auf Der Karte". Set `headlineCase: 'sentence'` in
> `screenshots/theme.ts` before rendering any non-English locale, and check
> on the contact sheet that the rendered case is the case the JSON says.
> Changing it is a theme change: re-render the source locale in the same
> pass and confirm its hashes did not move.

### P2 `copy-playbook.md` section "Casing": the table recommends `title` **because** of German

The `title` row currently reads:

> Default. Reads fastest at thumbnail size; keeps the highlight word visible;
> the shortest of the three, which matters once German arrives.

"which matters once German arrives" is backwards: `title` is the one value
that mangles German. Replace that row's "When" cell with:

> Default for English-only sets. Reads fastest at thumbnail size and keeps
> the highlight word visible. Do NOT keep it once a non-English locale is
> planned: the small-word list is English, so `title` capitalises German,
> French and Spanish function words ("Auf Der Karte", "In 3D"). Switch the
> set to `sentence` before the first localized render.

and add to the rules below the table:

> - `sentence` never lowercases, so a set whose copy is already written in
>   title case renders byte-identically after the switch. Verify by
>   re-rendering the source locale and comparing the hashes in `report.json`.

### P3 `copy-playbook.md` "Verification per locale": the grep is unusable

```bash
grep -n -E '\.\.\.|[0-9]\.[0-9]|[0-9],[0-9]{3}|"' screenshots/copy/de-DE.json
```

Every line of a JSON file contains a `"`. On this 79-line file the command
matched 56 lines, most of them `layoutNotes` prose, which is never rendered.
The instruction "Read every hit" cannot be followed.

Change it to a command that looks only at the fields that get rendered:

```bash
jq -r '[.shared[]?, (.screens[] | (.headline | if type=="array" then .[] else . end),
        (.subline // empty | if type=="array" then .[] else . end), (.badge // empty))] | .[]' \
  screenshots/copy/de-DE.json | grep -n -E '\.\.\.|"|'"'"'|[0-9]\.[0-9]|[0-9],[0-9]{3}'
```

with the same "read every hit" sentence after it. (On this file it printed
nothing, which is the answer the check is supposed to give.)

### P4 `localize-playbook.md` section 2 overstates what the manifest entry does

The playbook says to write `captureSource: "reuse:en-US"` "so
`s1s render --locale <locale>` resolves captures correctly from the first dry
run". Measured: with the whole `manifest.locales["de-DE"]` node deleted, the
render resolved the identical en-US files and emitted the identical 14 info
warnings, because `resolveCapture` falls back to `manifest.app.sourceLocale`
on its own (`CONTRACTS.md` section 4, rule 3).

Change the sentence to:

> Write the manifest entry now. When the reuse target is the source locale
> the renderer would find the same files anyway through its source-locale
> fallback, so the entry is a record of intent rather than a switch; it is
> load-bearing only when you reuse a locale that is not the source locale
> (`reuse:de-DE` for `de-AT`). Write it regardless: the reconcile table and
> `s1s status` read it, and `own` versus `reuse:` is the difference between a
> missing capture and a deliberate one.

### P5 `localize-playbook.md` section 2: the dev-gallery union is described wrongly

> "the dev gallery unions the `screens.ts` list with the copy files and the
> manifest locales"

`localesOf` (`src/web/runtime/project.ts:102-105`) unions
`ProjectJson.locales` with the copy-file keys, and `ProjectJson.locales` is
`project.locales + copy locales + the requested render locale`
(`src/render/vite-plugin-s1s.ts:180`). Manifest locales feed only the capture
map (`:186`). A locale that exists only in `manifest.locales` does not appear
in the gallery switcher. Drop "and the manifest locales" from the sentence.

### P6 `localize-playbook.md` section 5 step 3: the G5 status command is a silent no-op after a render

`s1s status --set copy-approved --locale de-DE --from pending --yes` assumes
no image has moved past `pending`. But section 4 of the same playbook tells
you to render (dry run) before G5, and any agent that wants to know whether
the German fits renders for real before asking a human to approve copy. Once
that has happened every image is `generated`, `--from pending` matches
nothing, and the command prints the full status table and "OK" and exits 0
without writing anything. Nothing tells the reader the write did not happen.

Add after the command:

> `--from pending` matches nothing once the locale has been rendered, and the
> command then exits 0 without writing. If you rendered before G5, the copy
> approval lives in `copy/<locale>.json` (`"approved": true`) and
> `manifest.locales.<locale>.copyStatus`; check
> `s1s status --locale <locale> --json` and only re-run the `--set` when rows
> are still at `pending`.

### P7 `localize-playbook.md` section 7: `capture-fallback-locale` is called "a defect for `own`" with no way to detect it

The warning-code table says the info is "Expected for `reuse:`; a defect for
`own` (a capture is missing for this locale)". The tool emits the identical
info warning in both modes and exits 0 (tool defect T2), so a reader
following the table has nothing to act on.

Add to that row's Fix cell, until T2 is fixed:

> The renderer cannot tell the two modes apart, so check by hand:
> `test -d screenshots/captures/<locale> && ls screenshots/captures/<locale>/*`.
> On `own`, any `capture-fallback-locale` at all means section 6 was skipped
> for that screen.

### P8 `localize-playbook.md` section 7 compares against a source-locale sheet that is not in the repo

Section 7 says to compare `screenshots/out/de-DE/sheet-iphone-6.9.png`
against `screenshots/out/en-US/sheet-iphone-6.9.png`. `screenshots/.gitignore`
ignores `out/`, so in any fresh checkout - which is exactly the situation this
dry run started from, with the manifest saying `exported` and `out/` and
`metadata/` both absent - the en-US sheet does not exist and the comparison
the section asks for is impossible. `s1s sheet` is never named in this
playbook either.

Add at the head of section 7:

```bash
test -f screenshots/out/en-US/sheet-iphone-6.9.png || s1s render --locale en-US
```

> `out/` is git-ignored, so the source-locale renders and sheets are usually
> absent in a fresh checkout even when the manifest says `exported`. Re-render
> the source locale first; hashes do not move, so nothing is re-approved. To
> rebuild only the sheets from an existing `report.json`, use
> `s1s sheet --locale <locale>`.

### P9 `localize-playbook.md` section 7 asks for a comparison the JSON cannot support

> "In the dev gallery the fitted size is on the headline element as
> `data-s1s-fitted`."

`report.json` carries no fitted point size, so the "a screen whose headline
shrank far below its en-US sibling" check has no headless form: the only way
to get the number is to open the dev server. Either say so plainly ("this
check needs `s1s dev`; there is no field for it in `report.json`") or add the
fitted size to `RenderReportItem`. In this run the comparison had to be made
by eye off the two contact sheets.

### P10 Neither playbook warns that a German compound swallows the highlight

`splitHighlight` (`src/web/components/Headline.tsx:53-63`) takes the **first**
case-insensitive substring match. `copy-playbook.md` section 2 does say "first
case-insensitive match wins", but the consequence is invisible until a
compounding language arrives: `highlight: "Runde"` against a headline
containing `Rundenzeiten` colours the first five letters of the compound and
leaves `nzeiten` in white. Add one line to the localize playbook's transcreation
rules:

> In compounding languages check that the highlight is not a prefix of a
> longer word earlier in the headline (`"Runde"` inside `"Rundenzeiten"`
> colours half a compound). Highlight the whole compound instead.

### P11 `localize-playbook.md` section 1 precondition 3 contradicts section 3.5

Precondition 3 makes you stop unless the target locale is already a
localization on the editable version. Section 3 step 5 then says "If the
target locale already has listing metadata, mirror its terminology ... If it
does not, decide the target term for each core noun once" - a branch
precondition 3 has already made unreachable. Either soften precondition 3
(the store check belongs to section 9, which is where the ids are re-resolved
anyway, and sections 1-8 need no store access by the playbook's own
statement) or delete the second half of 3.5. This dry run could not resolve
any store ids at all and still completed sections 2 to 8, which suggests the
precondition is in the wrong place.

### Smaller wording notes

- Section 9 step 1 says `export` "refuses an incomplete or error-carrying
  set". It does not refuse an **unapproved** set: it warns
  `export-unapproved` and exports anyway. Worth one clause, because the
  sentence reads as though G6 is enforced.
- Section 3's `screenshots/copy/brief.md` template has no row for the fact
  that decided this run's whole terminology strategy: with `reuse:`, every
  German caption sits above an English UI, so caption nouns must map onto the
  English labels visible in the frame. Add a line to the "Capture mode"
  section of the template.

---

## 7. State the sandbox was left in

`copy/de-DE.json` (approved), `copy/brief.md`, `screens.ts` with
`locales: ['en-US', 'de-DE']`, `manifest.json` with the de-DE locale node and
14 images at `exported`, `out/de-DE/` and `out/en-US/` fully rendered with
sheets and `review.md`, and `metadata/screenshots/{de-DE,en-US}/` holding 28
export files that `s1s validate` passes with 0 problems. `theme.ts` is back
to `headlineCase: 'title'` - the T1 workaround was measured and reverted, so
the defect stays reproducible.
