# Upload screenshots with `asc`

Reference for phase P5 (gate G4, source locale) and phase P6 (gate G7, each
extra locale). Every command here was checked against `asc` 1.2.2 help output.
Upload only after the human approves at G4/G7. Never upload on silence.

All paths are relative to the app repo root. Run every command from that root:
`asc` writes its upload reports to `./.asc/reports/`, and the export folder is
`metadata/screenshots/`.

Ignore the reports before the first upload. `s1s init` writes
`screenshots/.gitignore` (`out/`, `node_modules/`, `.s1s/`) and nothing at the
repo root, so `.asc/reports/` would otherwise show up as untracked work and
break the P7 pass condition:

```sh
grep -qxF '.asc/reports/' .gitignore 2>/dev/null || printf '\n.asc/reports/\n' >> .gitignore
```

Offer that one-line `.gitignore` change with the upload commit; do not commit
it silently.

Replaces: the upload sections of `aso-appstore-screenshots`,
`asc-localize-screenshots` and `localize-app-store-screenshots` (image-model
skills); the `asc` commands are the same, the inputs now come from `s1s export`.

## 1. Preconditions

Check all of these before you resolve any id.

1. The export exists and passes the offline check:

   ```sh
   s1s export --locale en-US
   s1s validate --locale en-US
   ```

   `s1s export` refuses to run on incomplete or error-level renders, copies
   `NN.png` into `metadata/screenshots/<locale>/<APP_DISPLAY_TYPE>/`, runs
   `asc screenshots validate` per size when `asc` is installed (`--no-asc`
   skips that), and prints one upload command per display type: the
   per-localization form of section 7, already carrying `--dry-run`. It prints
   the section 8 fan-out form as well, but only when the tree has no
   duplicate-dims siblings. Pass `--dry-run` to see the file list first,
   `--prune` to delete every `NN.png|jpg|jpeg` in the folder this run did not
   write (a leftover ordinal, a `00.png`, the same ordinal in another
   extension); without `--prune` those files are reported as `stale` and still
   upload. `s1s validate` is offline: names `^\d{2}\.(png|jpe?g)$` contiguous
   from `01`, 1-10 files, accepted dims, no alpha, RGB, uniform dims per set,
   all-or-nothing across locales, and the duplicate-dims trap (section 6).
   `--locale` narrows the table only: the all-or-nothing rule always compares
   every locale folder, so a narrowed run can report a sibling locale by name.
   `--sizes` is different: it narrows the rule as well, because a display type
   you excluded cannot be compared across locales. Run `s1s validate` with no
   `--sizes` before an upload, or a locale missing a whole device set passes.
   Exit 1 means fix before upload.

2. `asc` is authenticated:

   ```sh
   asc auth status
   ```

   If this fails, stop and ask the human to run `asc auth login`. Do not put
   API keys in the manifest or in chat.

3. The set is complete for every device you will upload (section 10).

## 2. Resolve the app id

Use, in this order: `app.appId` in `screenshots/manifest.json`, the
`ASC_APP_ID` environment variable, or a lookup by bundle id:

```sh
BUNDLE_ID=$(jq -r '.app.bundleId' screenshots/manifest.json)
asc apps list --bundle-id "$BUNDLE_ID" --output json \
  | jq -r '.data[] | "\(.id)\t\(.attributes.bundleId)\t\(.attributes.name)"'
APP_ID="<id from the line above>"
```

Write the id back so the next run skips this step (`app.appId` in
`screenshots/manifest.json`, agent-owned field). Every `asc` command below
accepts `--app "$APP_ID"` or reads `ASC_APP_ID`.

## 3. Resolve the editable version

Screenshots attach to one App Store version. The upload succeeds only while
that version is editable. Treat exactly two states as editable:
`PREPARE_FOR_SUBMISSION` and `DEVELOPER_REJECTED`.

```sh
asc versions list --app "$APP_ID" --platform IOS \
  --state PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED --output json \
  | jq -r '.data[] | "\(.id)\t\(.attributes.versionString)\t\(.attributes.appStoreState)"'
VERSION_ID="<id from the line above>"
VERSION="<versionString from the line above>"
```

- Zero lines: stop. Tell the human that no editable iOS version exists. They
  must create the next version in App Store Connect or reopen the current one.
  Do not upload against `READY_FOR_SALE`, `WAITING_FOR_REVIEW`, `IN_REVIEW` or
  any other state.
- More than one line: ask the human which version to target.
- Record `versionId` and `versionString` under `locales.<locale>` in the
  manifest. Re-resolve on every run; ids change per version.

To see every version and state, drop the `--state` filter:

```sh
asc versions list --app "$APP_ID" --platform IOS --output json \
  | jq -r '.data[] | "\(.id)\t\(.attributes.versionString)\t\(.attributes.appStoreState)"'
```

## 4. Resolve the version-localization ids

One id per locale, scoped to the version from section 3:

```sh
asc localizations list --version "$VERSION_ID" --paginate --output json \
  | jq -r '.data[] | "\(.attributes.locale)\t\(.id)"'
LOC_ID="<id for the locale you upload>"
```

- The locale names must match the export folders (`en-US`, `de-DE`).
- A locale with no line has no localization on this version. Stop: the
  metadata localization must exist first (create it with the
  `asc-localize-metadata` flow), then re-run this step.
- Record `versionLocalizationId` under `locales.<locale>` in the manifest.

## 5. Folder name vs `--device-type` token

The export folder carries the App Store Connect display type with its `APP_`
prefix. The upload and validate flag takes the same name without the prefix.

| `s1s` size id | Export folder (display type) | `--device-type` token | Export px |
|---|---|---|---|
| `iphone-6.9` | `APP_IPHONE_69` | `IPHONE_69` | 1320x2868 |
| `iphone-6.7` | `APP_IPHONE_67` | `IPHONE_67` | 1320x2868 |
| `iphone-6.5` | `APP_IPHONE_65` | `IPHONE_65` | 1284x2778 |
| `ipad-13` | `APP_IPAD_PRO_3GEN_129` | `IPAD_PRO_3GEN_129` | 2064x2752 |
| `watch-s10` | `APP_WATCH_SERIES_10` | `WATCH_SERIES_10` | 416x496 |

Read the token for a size from the manifest instead of retyping it:

```sh
jq -r '.sizes | to_entries[] | "\(.key)\t\(.value.displayType)\t\(.value.token)"' screenshots/manifest.json
```

Known mapping quirk in `asc` 1.2.2: `asc screenshots validate --device-type
IPHONE_69` reports `"apiDisplayType": "APP_IPHONE_67"`. `APP_IPHONE_69` and
`APP_IPHONE_67` accept identical dims, so the store may list the 6.9" set as
`APP_IPHONE_67`. Keep the export folder `APP_IPHONE_69`; when you verify
(section 9), print the display types the store returns and match on those.
Confirm the mapping with `--dry-run` before the first real 6.9" upload.

Full accepted-dims matrix, if you need it:

```sh
asc screenshots sizes --all --output table
```

## 6. Validate per device folder

Run this for every folder you will upload. It is offline and mirrors the
upload file order. Fix every `error` before any upload.

```sh
LOCALE=en-US
asc screenshots validate --path "metadata/screenshots/$LOCALE/APP_IPHONE_69" --device-type IPHONE_69 --pretty
asc screenshots validate --path "metadata/screenshots/$LOCALE/APP_IPAD_PRO_3GEN_129" --device-type IPAD_PRO_3GEN_129 --pretty
```

Watch apps add:

```sh
asc screenshots validate --path "metadata/screenshots/$LOCALE/APP_WATCH_SERIES_10" --device-type WATCH_SERIES_10 --pretty
```

The output lists `errorCount`, `warningCount` and one entry per file with its
`order`, `width`, `height` and `status`. `order` is the upload order and the
store display order.

Duplicate-dims trap: two sibling folders with identical dims (for example
`APP_IPHONE_69` and `APP_IPHONE_67`, both 1320x2868) are fine for the
per-localization upload in section 7, because `--path` names one folder. They
are a problem for the fan-out upload in section 8, which selects files by
dims. `s1s export` and `s1s validate` warn about this.

## 7. Upload per device (per-localization form)

Default form. One command uploads one folder into one localization set.
Always run `--dry-run` first, read the result, then run the real command with
`--replace`.

```sh
LOCALE=en-US
FOLDER=APP_IPHONE_69
TOKEN=IPHONE_69

asc screenshots upload --version-localization "$LOC_ID" \
  --path "metadata/screenshots/$LOCALE/$FOLDER" --device-type "$TOKEN" --dry-run --pretty
```

Check in the dry-run output that the listed files are exactly the `NN.png`
files of that folder, in order, and that the target display type is the one
you expect. Then upload:

```sh
asc screenshots upload --version-localization "$LOC_ID" \
  --path "metadata/screenshots/$LOCALE/$FOLDER" --device-type "$TOKEN" --replace --pretty
```

- `--replace` deletes every screenshot in the target set first, then uploads.
  This is what keeps order and dims uniform. Use it for every full-set upload.
- `--skip-existing` skips files whose MD5 already exists in the set. Use it
  only to add a single missing file to an otherwise verified set. It never
  reorders.
- The command exits non-zero on failed files and writes a failure artifact
  under `.asc/reports/screenshots-upload/`. Resume it instead of re-uploading
  everything:

  ```sh
  ls -t .asc/reports/screenshots-upload/
  asc screenshots upload --resume ".asc/reports/screenshots-upload/<failures-file>.json"
  ```

  If `--replace` was interrupted, the set can be empty or partial. Verify
  (section 9), then run the full `--replace` command again if needed.

Repeat for each device folder: iPhone, then iPad, then Watch. Verify each set
before you start the next.

## 8. Upload many locales in one run (fan-out form)

Use this only when several locales are all complete for one device and the
export tree has no duplicate-dims siblings. `--path` points at the export
root; its immediate children must be locale directories. `asc` scans each
locale subtree recursively and uploads only the files that match the
`--device-type` dims into that locale's set.

```sh
asc screenshots upload --app "$APP_ID" --version "$VERSION" \
  --path metadata/screenshots --device-type IPHONE_69 --dry-run --pretty
```

Read the dry-run per locale: file count must equal the folder's file count.
Then:

```sh
asc screenshots upload --app "$APP_ID" --version "$VERSION" \
  --path metadata/screenshots --device-type IPHONE_69 --replace --pretty
```

`--version-id "$VERSION_ID"` works in place of `--version "$VERSION"`.
`--platform` defaults to `IOS`.

Double-upload trap: because the fan-out selects by dims, a locale that has
both `metadata/screenshots/<locale>/APP_IPHONE_69/` and
`.../APP_IPHONE_67/` (identical 1320x2868) sends both folders into one set.
That doubles the count and can exceed the 10-file limit or ship duplicates.
The dry-run shows the doubled file list. If you see it, either delete the
folder you do not ship or use the per-localization form in section 7.

## 9. Verify the store

List the localization and parse the nested shape. The result is under
`sets[].screenshots[]`, not `data[]`. First print what the store holds:

```sh
asc screenshots list --version-localization "$LOC_ID" --output json \
  | jq -r '.sets[] | "\(.set.attributes.screenshotDisplayType)\t\(.screenshots | length)"'
```

Then check one set. Use the display type the store printed above
(`APP_IPHONE_69` or, with the section 5 quirk, `APP_IPHONE_67`):

```sh
DISPLAY_TYPE=APP_IPHONE_69
asc screenshots list --version-localization "$LOC_ID" --output json \
  | jq -r --arg dt "$DISPLAY_TYPE" '.sets[]
      | select(.set.attributes.screenshotDisplayType == $dt)
      | .screenshots[]
      | "\(.attributes.fileName)\t\(.attributes.assetDeliveryState.state)"'
```

Pass criteria, all required:

- One line per exported file, `01.png` .. `NN.png`, in order.
- Every line ends in `COMPLETE`. `UPLOAD_COMPLETE` or `AWAITING_UPLOAD` means
  the store is still processing; wait 30 seconds and list again. `FAILED`
  means re-upload that file (section 7, `--skip-existing`) or the whole set
  (`--replace`).
- The count equals the export count:

  ```sh
  ls "metadata/screenshots/$LOCALE/$FOLDER"/*.png | wc -l
  ```

Machine check for the same thing (exit 0 = pass):

```sh
EXPECTED=$(ls "metadata/screenshots/$LOCALE/$FOLDER"/*.png | wc -l | tr -d ' ')
asc screenshots list --version-localization "$LOC_ID" --output json \
  | jq -e --arg dt "$DISPLAY_TYPE" --argjson n "$EXPECTED" '
      [.sets[] | select(.set.attributes.screenshotDisplayType == $dt) | .screenshots[]]
      | length == $n and all(.attributes.assetDeliveryState.state == "COMPLETE")'
```

After a pass, record the result in the manifest. `s1s export` already wrote
`storeFileName` (`NN.png`); this command writes status `uploaded` and
`uploadedAt` (one ISO time for the call) and clears `wasUploaded` on any image
that carried it:

```sh
s1s status --set uploaded --locale "$LOCALE" --sizes iphone-6.9 --yes
```

`--yes` is required whenever the selection still covers every image of the
locale, which `--sizes` alone does on a one-size project. Keep it: it costs
nothing when the guard does not fire.

Then offer a commit with the `ios:` prefix, no trailer. The store is the
authority for shipped state: on the next run `s1s status` reconciles the
manifest against this list, and an image whose render hash changed after an
upload carries `wasUploaded: true` until it is uploaded again.

## 10. All-or-nothing per device

Apple does not fall back per slot. A locale's set for one display type ships
exactly as uploaded. A half-localized set goes live half-localized.

- Upload a device set only when every screen of that set for that locale is
  `exported` (or `image-approved` with the export on disk).
- Never upload a subset to "get started". Wait for the complete set.
- Uploading a locale creates its own set. Once a locale has a set, that set
  replaces the primary-language fallback for that display type. Adding a
  locale in App Store Connect also copies the primary-language screenshots in
  silently, so audit each locale's sets (section 9) before release.
- Every locale that ships must have the same display types uploaded. `s1s
  validate` checks this across locales offline.
- Order equals filename order. Keep `NN` the same across locales.
- 1-10 files per set, PNG or JPEG, no alpha, uniform dims within a set.

Recovery: to remove one bad file from a set, take its id from the list and
delete it, then re-upload the set with `--replace` so the order stays correct.

```sh
asc screenshots list --version-localization "$LOC_ID" --output json \
  | jq -r --arg dt "$DISPLAY_TYPE" '.sets[]
      | select(.set.attributes.screenshotDisplayType == $dt)
      | .screenshots[] | "\(.id)\t\(.attributes.fileName)"'
asc screenshots delete --id "<SCREENSHOT_ID>" --confirm
```

To pull what the store currently holds (for a reconciliation or an audit):

```sh
asc screenshots download --version-localization "$LOC_ID" --output-dir screenshots/out/store/"$LOCALE"
```

Download into `screenshots/out/`, never into `metadata/screenshots/`; the
export folder is the source of truth on disk.

## 11. `asc` experimental screenshot commands (not used)

`asc screenshots` also ships an experimental local pipeline: `run` (a JSON
capture plan), `capture` (simulator screenshot), `frame` (its own device
frames, no iPad frames), `review-generate` / `review-open` /
`review-approve` (HTML side-by-side review and `approved.json`), `plan` and
`apply` (upload from approved review artifacts), and `list-frame-devices`.
`s1s` replaces all of these: captures come from `s1s capture`, frames from
Apple's bezels in `s1s render`, review from `s1s sheet`, `s1s dev` and
`review.md`, and the upload plan from `s1s export`. Do not mix the two
pipelines; use only `validate`, `upload`, `list`, `sizes`, `download` and
`delete` from `asc screenshots`.

## 12. Copy-paste sequence for one locale

```sh
# from the app repo root
LOCALE=en-US
APP_ID=$(jq -r '.app.appId // empty' screenshots/manifest.json)
[ -n "$APP_ID" ] || { echo "set app.appId in screenshots/manifest.json (section 2)"; exit 1; }

# editable version
asc versions list --app "$APP_ID" --platform IOS \
  --state PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED --output json \
  | jq -r '.data[] | "\(.id)\t\(.attributes.versionString)\t\(.attributes.appStoreState)"'
VERSION_ID="<paste>"

# localization id
asc localizations list --version "$VERSION_ID" --paginate --output json \
  | jq -r --arg l "$LOCALE" '.data[] | select(.attributes.locale == $l) | .id'
LOC_ID="<paste>"

# per device: validate, dry-run, upload, verify
for PAIR in APP_IPHONE_69:IPHONE_69 APP_IPAD_PRO_3GEN_129:IPAD_PRO_3GEN_129; do
  FOLDER=${PAIR%%:*}; TOKEN=${PAIR##*:}
  asc screenshots validate --path "metadata/screenshots/$LOCALE/$FOLDER" --device-type "$TOKEN" --pretty
  asc screenshots upload --version-localization "$LOC_ID" \
    --path "metadata/screenshots/$LOCALE/$FOLDER" --device-type "$TOKEN" --dry-run --pretty
done
```

Stop here and show the human the dry-run output (gate G4/G7). On approval:

```sh
for PAIR in APP_IPHONE_69:IPHONE_69 APP_IPAD_PRO_3GEN_129:IPAD_PRO_3GEN_129; do
  FOLDER=${PAIR%%:*}; TOKEN=${PAIR##*:}
  asc screenshots upload --version-localization "$LOC_ID" \
    --path "metadata/screenshots/$LOCALE/$FOLDER" --device-type "$TOKEN" --replace --pretty
done
asc screenshots list --version-localization "$LOC_ID" --output json \
  | jq -r '.sets[] | .set.attributes.screenshotDisplayType as $dt
      | .screenshots[] | "\($dt)\t\(.attributes.fileName)\t\(.attributes.assetDeliveryState.state)"'
```

Add `APP_WATCH_SERIES_10:WATCH_SERIES_10` to both loops for a watch app. Every
line must end in `COMPLETE` and the per-type counts must match the export.
Then run `s1s status --set uploaded --locale "$LOCALE" --sizes iphone-6.9,ipad-13 --yes`
and offer the `ios:` commit.
