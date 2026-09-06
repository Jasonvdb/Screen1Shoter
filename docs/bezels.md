# Apple product bezels: facts from the W2 Stage A spike

Measured on 2026-09-02 from the two DMGs below with `hdiutil`, `sips` and a
sharp script (raw RGBA scan). `src/core/bezels/sources.ts` encodes these facts;
this file is the human record so nobody has to re-download to check a number.

## DMGs

| DMG | URL | Size (bytes) | Cached at |
|---|---|---|---|
| iPhone 17 family | `https://devimages-cdn.apple.com/design/resources/download/Bezel-iPhone-17.dmg` | 265,205,982 | `~/.screen1shoter/dmg/Bezel-iPhone-17.dmg` |
| iPad Pro (M5) | `https://devimages-cdn.apple.com/design/resources/download/Bezel-iPad-Pro-(M5).dmg` | 6,787,021 | `~/.screen1shoter/dmg/Bezel-iPad-Pro-(M5).dmg` |

- No login. `curl -L -o <file> "<url>"` works; quote the URL (parentheses).
  The server reports `Content-Length`, so a file with the exact size above can
  be kept instead of re-downloaded.
- Both are `UDIF read-only compressed (zlib)`, Apple partition scheme, one
  HFS volume. `file` says "zlib compressed data".
- The iPhone DMG is large because of 30 PSDs of 17-44 MB each; its PNGs total
  about 14 MB. The iPad DMG has 8 PSDs of about 2 MB.

### SLA behaviour

`hdiutil attach` prints the full "APPLE INC. LICENSE AGREEMENT FOR APPLE DESIGN
RESOURCES" (248 lines, ends with `LYL142 06/21/2023`) and waits for
`Y`/`N` on stdin. With stdin piped (`echo Y | hdiutil attach ...`) it accepts
without a visible prompt line and exits 0. Both DMGs carry the same licence
(`Apple Design Resources License.rtf`, 14,462 bytes, byte-identical).

Command used (exit 0 both times):

```sh
echo Y | hdiutil attach -nobrowse -readonly -noverify -noautoopen -mountpoint <dir> <dmg>
hdiutil detach <dir>
```

`hdiutil attach` prints the device lines after the licence text, e.g.
`/dev/disk18s2  Apple_HFS  <mountpoint>`.

Licence summary (from the text, not legal advice): the resources are licensed
for creating mock-ups of user interfaces for software that runs on Apple
platforms, including showing them in screenshots and images of such mock-ups,
subject to Apple's Human Interface Guidelines. Do not redistribute the files:
keep the cache in `S1S_HOME`, never in a repo.

## Mount layout

iPhone DMG (`Bezel-iPhone-17.dmg`), one sub-folder per model:

```
.DropDMGBackground/Bezel-iPhone17@2x.png      1409x1009, no alpha (Finder window background; ignore)
.DS_Store, PNG/.DS_Store, PNG/iPhone Air/.DS_Store
Apple Design Resources License.rtf
Photoshop/<model>/<model> - <Colour> - <Portrait|Landscape>.psd   (30 files, ignore)
PNG/iPhone 17 Pro Max/iPhone 17 Pro Max - {Cosmic Orange, Deep Blue, Silver} - {Portrait, Landscape}.png
PNG/iPhone 17 Pro/iPhone 17 Pro - {Cosmic Orange, Deep Blue, Silver} - {Portrait, Landscape}.png
PNG/iPhone 17/iPhone 17 - {Black, Lavender, Mist Blue, Sage, White} - {Portrait, Landscape}.png
PNG/iPhone Air/iPhone Air - {Cloud White, Light Gold, Sky Blue, Space Black} - {Portrait, Landscape}.png
```

iPad DMG (`Bezel-iPad-Pro-(M5).dmg`), flat:

```
.DropDMGBackground/Bezel-iPadPro@2x.png       1409x1009, no alpha (ignore)
.DS_Store
Apple Design Resources License.rtf
Photoshop/iPad Pro (M5) {11", 13"} - {Silver, Space Black} - {Portrait, Landscape}.psd   (8 files, ignore)
PNG/iPad Pro (M5) 11" - {Silver, Space Black} - {Portrait, Landscape}.png
PNG/iPad Pro (M5) 13" - {Silver, Space Black} - {Portrait, Landscape}.png
```

The inch mark is the ASCII double quote (0x22). File dates inside the iPad
image are 2026-04-14.

### File-name rule

`<model> - <Colour> - <Portrait|Landscape>.png`, separator ` - ` (space,
hyphen, space). `normaliseBezelFilename` lowercases, drops `"`/`(`/`)`, turns
runs of other characters into `-`, then applies `FILENAME_OVERRIDES`
(`ipad-pro-m5-13` -> `ipad-pro-13-m5`, `ipad-pro-m5-11` -> `ipad-pro-11-m5`;
Apple writes the chip before the size, presets write the size first) or the
generic `ipad-<family>-<chip>-<size>` reorder. Anything without exactly three
parts, a `.png` extension or a known orientation is `null` (`.DS_Store`, PSDs,
the `.DropDMGBackground` image).

## Pixel facts (portrait PNGs)

All PNGs: 8-bit RGBA (`sips hasAlpha: yes`, sharp `channels: 4`), sRGB. iPhone
files are 216 dpi (= 3 px per point), iPad files 144 dpi (= 2 px per point).
The screen cut-out is exactly the App Store screenshot size of the matching
preset, so captures drop in 1:1 with no resampling.

| id | Portrait file size | deviceRect (alpha > 12) | screenRect (alpha <= 12) | screenAspect | islandRect | screen corner rows | CSS cornerRadius (measure.ts) |
|---|---|---|---|---|---|---|---|
| iphone-17-pro-max | 1470x3000 | (21,20) 1428x2959 | (75,66) 1320x2868 | 0.4603 | (548,109) 374x108 | 241 | 189 |
| iphone-17-pro | 1350x2760 | (16,21) 1318x2717 | (72,69) 1206x2622 | 0.4600 | (488,112) 374x108 | 237 | 186 |
| iphone-17 | 1350x2760 | (19,26) 1311x2708 | (72,69) 1206x2622 | 0.4600 | (488,111) 374x109 | 255 | 189 |
| iphone-air | 1380x2880 | (5,25) 1370x2829 | (60,72) 1260x2736 | 0.4605 | (503,133) 374x108 | 234 | 189 |
| ipad-pro-13-m5 | 2300x3000 | (28,30) 2249x2936 | (118,124) 2064x2752 | 0.7500 | none | 63 | 58 |
| ipad-pro-11-m5 | 1880x2640 | (15,15) 1854x2606 | (106,110) 1668x2420 | 0.6893 | none | 64 | 58 |

`cornerRadius` is what `measure.ts` (`radiusFromProfile`) computes on the
real file and what `s1s bezels install` writes to `index.json`;
`sources.ts` records the same number (Pro Max 189, Pro 186, both iPads 58,
from the installed index). `iphone-17` and `iphone-air` have not been
through `install` yet; their 189 is the hand-fit from the spike. The
hand-fit maximum without a gap (table under "Screen corners") is 1-3 px
larger; both values leave no gap and no leak.

Rects are `(x,y) width x height` in image pixels. Landscape files are the same
image rotated (iPhone 17 Pro Max landscape: 3000x1470, screen (66,75)
2868x1320, island on the left). Points: 1320x2868 = 440x956 @3, 1206x2622 =
402x874 @3, 1260x2736 = 420x912 @3, 2064x2752 = 1032x1376 @2, 1668x2420 =
834x1210 @2.

Colour variants share the alpha channel: the three iPhone 17 Pro Max colours
and both iPad colours gave identical rects, identical semi-transparent pixel
counts and identical corner profiles. Measure once per id and reuse.

Body colour samples (RGB at the left bezel strip, mid height): Pro Max Deep
Blue 14,19,33; Silver 85,85,83; Cosmic Orange 113,39,16; iPhone 17 Black
46,46,46; iPhone Air Space Black 34,35,37; iPad (both colours) 0,0,0 because
the front bezel is black and the colour is only the outer rim.

## Alpha behaviour

- Screen interior: alpha 0 everywhere except the island and the corner
  regions. iPad 13": 5,662,165 of 5,662,172 checked pixels are exactly 0 (the
  7 others are edge anti-aliasing with alpha 1-12). Centre pixel alpha 0 on
  every file.
- Body: alpha 255. The `alpha == 255` box is 1 px inside the `alpha > 12` box
  on every side: edges are anti-aliased over one pixel (mid-row profile from
  the left `[212, 255]` on the Pro Max, `[247, 255]` on the iPad 13").
- No drop shadow, no glow, no soft edge: the `alpha > 0` box equals the
  `alpha > 12` box (iPad 13" landscape differs by one row of alpha 1-12); zero
  pixels with alpha > 0 exist more than 3 px outside the device box; total
  semi-transparent pixels are about 9-14k per file, all on the two edges.
- Dynamic Island (iPhone only): opaque pill, RGB 0,0,0, alpha 255 inside
  (372x106 fully opaque run inside a 374x108 bounding box, 1 px anti-aliased
  edge), horizontally centred in the screen to the pixel, top edge 43 px below
  the screen top on the Pro / Pro Max, 42 px on iPhone 17, 61 px on iPhone
  Air. Drawing the bezel over the capture hides the capture under the island.
- Outside the body the image is alpha 0 (the PNG canvas is 20-30 px larger
  than the device on each side; 5 px on the iPhone Air's left/right).

### Screen corners

The iPad screen corner is close to a circle: 63 rows, first-row offset 59, a
circle of r = 61 fits with 1.0 px RMS. The iPhone screen corners are
superellipses: the first-row offset is 222-246 px, the offset drops below 1 px
only after 234-255 rows, and the best circle fit has 16-26 px RMS error. The
diagonal crossing (row j where offset <= j) is at row 55-56 on every iPhone and
row 18 on both iPads.

Important for `DeviceFrame`: on the iPhone files the bounding-box corner of
the screen, e.g. pixel (75,66) on the Pro Max, lies OUTSIDE the phone body
(the outer body corner is rounder than the screen corner; opaque body starts
at x = 292 on row 20 and at y = 115 in column 75). A capture placed at
`screenRect` with square corners would therefore show beyond the bezel. The
capture must be clipped. A CSS circle of radius R (bezel px) is safe when it
neither leaves a background gap at the diagonal nor leaks past the body:

| id | smallest R without leak | largest R without gap (hand-fit; `cornerRadius` in sources.ts is the measured value, see above) |
|---|---|---|
| iphone-17-pro-max | 82 | 190 |
| iphone-17-pro | 75 | 189 |
| iphone-17 | 83 | 189 |
| iphone-air | 78 | 189 |
| ipad-pro-13-m5 | 1 | 60 |
| ipad-pro-11-m5 | 1 | 60 |

Rule of thumb that reproduces these: `cornerRadius = round(diagonalRow /
(1 - 1/sqrt(2)))` = 3.414 x the diagonal row (56 -> 191, 18 -> 61). Do not use
the number of rows the corner spans (241) as the radius: it is far too large
and leaves a visible background crescent in every corner. A pixel-exact
alternative is a screen mask made at install time by flood-filling alpha <= 12
from the screen centre (the opaque ring encloses it), grown by 1 px, and used
as `mask-image` on the capture.

Measurement method (for `measure.ts`): `deviceRect` = bbox of alpha > 12;
row scan at mid height from the centre outward until alpha > 64 gives the
screen x-range; column scan at x = 20% into that range (misses the island)
gives the y-range; `screenRect` = bbox of alpha <= 12 inside that box (it came
out equal to the scan box on every file); `islandRect` = bbox of alpha > 12
inside the top 15% of the screen restricted to the middle 60% of its width (the
full-width band picks up the corners); corner profile scanned from x = 20%
inward toward the corner, not from the bbox corner outward (which starts
outside the body on iPhones). Landscape files put the island at mid height on
the left, so the mid-row scan hits it; scan landscape files at 20% height or
rotate the portrait measurement.

## Apple marketing rules (summary, from the plan)

- Use Apple's product bezels as delivered: no cropping, tilting, added
  shadows, reflections or recolouring.
- Marketing copy sits beside the device, not on top of it.
- Show current-generation devices and real app UI.
- App Store screenshots: exact pixel sizes per display type, PNG/JPEG, no
  alpha, 1-10 per set (`asc screenshots sizes --all`).
- The bezel licence limits use to mock-ups of Apple-platform software and
  requires HIG compliance; keep the PNGs out of repos and out of the tool
  package (cache under `S1S_HOME`).

## Install notes for later phases

- Walk `PNG/` recursively; ignore everything `normaliseBezelFilename` returns
  `null` for.
- Trim to `deviceRect` grown by 2 px; the cut-out then starts at
  `screenRect.x - deviceRect.x + 2`.
- `pxPerPt` = dpi / 72 (216 -> 3, 144 -> 2), equal to the preset scale.
- Assert the measured `screenRect` size against `BEZEL_SOURCES[id].portrait`
  (+-1 px) so a changed DMG fails loudly instead of misaligning captures.
- Delete a DMG after `install` (and after `inspect <url>` downloaded it)
  unless `--keep-dmg` is set; a kept file of the exact size above is reused.
