# Template catalog

Templates are React components that place one App Store screenshot on a canvas.
`s1s render` picks the template named in `screenshots/screens.ts`, fills it with
the copy from `screenshots/copy/<locale>.json` and the captures from
`screenshots/captures/<locale>/<family>/`, and renders it to an exact-pixel PNG.
Pick the template per screen from this catalog, then write `screens.ts`,
`theme.ts` and the copy file as shown at the end.

All paths in this file are relative to the app repo. The CLI is `s1s`.

## Quick reference

| Template | Families | Captures | Copy fields used | Apple rules | Status |
|---|---|---|---|---|---|
| `hero-top-text` | iphone, ipad | 1 | headline, highlight, subline, badge | compliant | built (default for iPhone and iPad) |
| `text-bottom` | iphone, ipad | 1 | headline, highlight, subline, badge | compliant | built |
| `two-device` | iphone, ipad | 2 (`capture: [a, b]`) | headline, highlight, subline, badge | compliant | built |
| `feature-grid` | ipad only | 1 | headline, highlight, subline, badge, callouts (1-3) | compliant | built |
| `raw` | iphone, ipad, watch | 1 | none | compliant (plain UI, no bezel) | built (default for watch) |
| `bleed-bottom` | iphone, ipad | 1 | headline, highlight, subline, badge | NOT compliant | built, opt-in |
| `tilted` | iphone, ipad | 1 | headline, highlight, subline, badge | NOT compliant | built, opt-in |
| `watch-caption` | watch | 1 | headline, highlight | compliant | built, opt-in |
| `phone-watch` | iphone, ipad | 2 (`capture: [phone, 'watch-s10:watch']`, or `watch-ultra:` for an Ultra) | headline, highlight, subline, badge | compliant | built |

Every built-in template above is implemented and renders today. Check the list
on the machine before you rely on it:

```sh
s1s render --dry-run --allow-placeholder --json   # validates screens.ts, theme.ts and copy
```

A `screens.ts` that names an id no built-in and no `templates/index.ts` module
provides fails with `config-invalid` (`unknown template "<id>" and no
templates/index.ts / templates/index.tsx`). A built-in used on a family it has
no layout for fails the same way (`has no <family> layout (families: ...)`).

## How every built-in template works

Read this section once. Each template section below only lists what differs.

- Canvas. The canvas is `preset.pt` CSS px (440x956 for iPhone 6.9", 1032x1376
  for iPad 13"). Playwright renders it at `preset.scale` (3 or 2) to the exact
  App Store pixel size. Layout numbers below are pt at the reference width
  (440 iPhone, 1032 iPad) and scale with the canvas width (`iphone-6.5` gets
  0.97 of them).
- Text block. Badge, headline and subline sit in a slot of fixed height
  (172 pt on iPhone, 258 pt on iPad). The fixed height gives every screen of a
  set the same device size. Text auto-fits: the largest integer size in the
  template's range that fits its lines. Text that still overflows at the
  minimum size is an error-level `text-min-size` warning. Text that leaves its
  slot is an error-level `text-clipped` warning. Fix both in the copy (shorter
  words, explicit line breaks), not in the template.
- Headline. `headline` is a string (auto-wrapped, at most 2 lines) or an array
  of lines (rendered as written, never re-wrapped). `theme.headlineCase`
  applies before rendering. `highlight` colours the first case-insensitive
  match of that substring with `theme.highlight` (default: `theme.accent`).
  A `highlight` that does not occur in the headline is silently ignored, so
  check the sheet.
- Subline. Optional. String (auto-wrapped, at most 2 lines) or array of lines.
  Body font, `theme.textMuted`.
- Badge. Optional short label ("New", "Pro"). Uppercase pill in
  `theme.accent` with black or white text, whichever reads better.
- Device. `DeviceFrame` puts the capture into the Apple bezel of the preset
  (`iphone-17-pro-max` for `iphone-6.9`, `ipad-pro-13-m5` for `ipad-13`),
  clipped to the screen corner radius, with the bezel image on top so the
  Dynamic Island covers the capture. The capture must be the exact simulator
  size (1320x2868, 2064x2752); a same-aspect capture at another scale is a
  warn-level `capture-dims`, anything else an error that names the right
  simulator. A missing capture renders a hatched panel that prints the
  `s1s capture ...` command and fails the render unless you pass
  `--allow-placeholder`. A passthrough item (`raw` on `watch-s10`) has no
  placeholder: it fails even with the flag, so exclude it with `--sizes` until
  the watch capture exists. Without an installed bezel a generic CSS frame is
  drawn and a warn-level `bezel-fallback` is reported: run
  `s1s bezels install`.
- Props shared by every framed template (`hero-top-text`, `text-bottom`,
  `two-device`, `feature-grid`, `bleed-bottom`, `tilted`):
  - `align: 'center' | 'left'` (default `center`): alignment of the text block.
  - `background`: a hex string, `{ type: 'gradient', from, to, angle? }`
    (angle in degrees, default 180) or `{ type: 'image', src, fit?, position? }`
    (`src` relative to `screenshots/`, for example `assets/bg.png`). Default:
    `theme.background`. Anything unrecognised falls back to the solid theme
    colour. `raw` and `watch-caption` take `background` too, except on a
    passthrough watch screen, where no template runs at all. A project-level
    `panorama` fills `background` for you ("Panorama backgrounds" below); an
    explicit `background` on the screen wins over it.
- Props resolve base < `overrides.<family>` < `overrides.<sizeId>` <
  `locales.<locale>`. `template` and `capture` replace; `props` shallow-merge.
- Copy resolves from `copy.screens[copyKey ?? id]`. No entry is an error-level
  `copy-missing` (except for `raw`). An entry no screen uses is an info-level
  `copy-unused`.

## hero-top-text

When to use: the default. Use it for screen 1 (the biggest reason to download)
and for most feature screens. Text on top reads first in the App Store
carousel; the whole upright device sits below.

Layout: text block top, device below, filling the remaining height, centred.

| Family | Padding (top / sides / bottom) | Text slot | Headline | Subline | Badge | Device width |
|---|---|---|---|---|---|---|
| iphone | 54 / 30 / 30 pt | 172 pt | 28-46 pt, 2 lines | 15-21 pt, 2 lines | 12 pt | up to 82 % of the canvas |
| ipad | 76 / 80 / 44 pt | 258 pt | 40-72 pt, 2 lines | 22-32 pt, 2 lines | 17 pt | up to 84 % of the canvas |

Required captures: one. Default name = screen id (`captures/<locale>/iphone/<id>.png`).

Copy fields: `headline`, `highlight`, `subline`, `badge`. `callouts` are ignored.

Props: `align`, `background`, `deviceMaxWidth` (fraction 0-1 of the canvas
width, default 0.82 iPhone / 0.84 iPad; keep it identical on every screen of a
set).

iPad: same layout with iPad proportions and the larger text ranges. The iPad
capture is 3:4, so the device is short and wide; the text block keeps two lines.

Apple rules: compliant. Whole bezel, upright, copy beside (above) the device.

Example:

```ts
{ id: 'home', template: 'hero-top-text', notes: 'Screen 1: the biggest reason to download.' }
```

## text-bottom

When to use: to vary the rhythm of a set (for example screens 2 and 4), or when
the important UI is at the top of the capture and must sit near the top of the
screenshot.

Layout: device on top, aligned to the bottom of its slot; text block below.

| Family | Padding (top / sides / bottom) | Text slot | Headline | Subline | Badge | Device width |
|---|---|---|---|---|---|---|
| iphone | 36 / 30 / 40 pt | 172 pt | 28-46 pt, 2 lines | 15-21 pt, 2 lines | 12 pt | up to 82 % |
| ipad | 56 / 80 / 60 pt | 258 pt | 40-72 pt, 2 lines | 22-32 pt, 2 lines | 17 pt | up to 84 % |

Required captures: one (default name = screen id).

Copy fields: `headline`, `highlight`, `subline`, `badge`.

Props: `align`, `background`, `deviceMaxWidth` (same defaults as `hero-top-text`).

iPad: same as `hero-top-text`, flipped.

Apple rules: compliant.

Do not alternate `hero-top-text` and `text-bottom` on every screen: adjacent
screens in the carousel then look misaligned. Group them (for example 1-3 top,
4-5 bottom) or keep one template per set.

## two-device

When to use: one benefit that needs two screens to tell (list and detail,
before and after, phone and watch companion view on the same family). At most
once per set; it takes more attention than a single device.

Layout: text block on top; two upright devices below. Default arrangement
`stack`: the devices overlap, the front one lower so the back device's Dynamic
Island and status bar stay visible and at least half of the back device shows.

| Family | Padding (top / sides / bottom) | Text slot | Stack: device width, front offset | Side: pair width, gap |
|---|---|---|---|---|
| iphone | 54 / 30 / 30 pt | 172 pt | 56 % of the canvas each, front 88 pt lower | 100 % of the content width, gap 8 % of a device width |
| ipad | 76 / 40 / 44 pt | 258 pt | 60 % each, front 120 pt lower | same |

Required captures: exactly two, listed in `screens.ts`:

```ts
{ id: 'compare', template: 'two-device', capture: ['home', 'detail'] }
```

`s1s render` refuses any other count (`needs capture: [a, b] (got 1)`). The
first capture goes left and behind; the second goes right and in front. Both
captures come from the same simulator as the screen's family. A missing second
capture shows a hint panel that names the `screens.ts` change, not a capture
command.

Copy fields: `headline`, `highlight`, `subline`, `badge`.

Props:
- `arrangement: 'stack' | 'side'` (default `stack`). `side` puts the devices
  side by side at equal scale, smaller.
- `front: 'right' | 'left'` (default `right`): which device is in front and lower.
- `align`, `background`.

iPad: same stack with iPad proportions (60 % wide devices, front one 120 pt
lower). `side` on iPad gives two 3:4 tablets next to each other; each is small,
so prefer `stack`.

Apple rules: compliant. Both bezels are whole and upright; overlap is allowed.

## phone-watch

When to use: the app has a watch app and the iPhone or iPad set has to say so.
The watch set only appears on the Watch tab of the listing, so a shopper
browsing on a phone never sees it; this puts the watch on a frame they will
see. At most once per set, on the screen whose subject is the same on both
devices, so the watch backs the headline instead of decorating it.

Layout: `hero-top-text` exactly - same padding, same fixed text block, same
device width and position - with an Apple Watch standing in front of the
device's lower right corner. That is the point of the template: a set can put
`phone-watch` on one screen and `hero-top-text` on the rest and the copy band
and the bezels still line up across the carousel. Aim the watch at the least
load-bearing corner of the capture.

| Family | Watch width | Overhang right / below (of the device width) |
|---|---|---|
| iphone | 44 % of the device width | 7 % / 3 % |
| ipad | 30 % | 5 % / 2.5 % |

True relative scale would be 60 % on iPhone (an Apple Watch 46 mm with bands
is 76 mm tall against a 163 mm iPhone 17 Pro Max) and buries a third of the
phone; 44 % keeps the watch face readable and the phone the subject. An
overhang that would push the watch off the canvas is clamped inward rather than
clipped, so the watch never shrinks and never trips the canvas check.

Required captures: exactly two. The second names the watch size, because it
lives under `captures/<locale>/watch/` and is 416x496, not a phone capture:

```ts
{
  id: 'lap-times',
  template: 'phone-watch',
  capture: ['lap-times', 'watch-s10:watch-lap'],
  props: { watchVariant: 'aluminum-jet-black-sport-band-black' },
}
```

A `<sizeId>:` prefix on any capture ref sends it to that size's preset, which
decides both the directory it is read from and the dimensions it is checked
against. Without the prefix the ref would be looked up as a phone capture and
reported missing. A prefix naming no preset is a `screens.ts` error, not a file
name. A missing second capture shows a hint panel naming the `screens.ts`
change, not a capture command.

### Choosing the watch model

The prefix also picks which Apple Watch is drawn, through that size's
`preset.bezel`. Pick the model the app's own audience wears: a training,
outdoor or dive app reads as an Ultra app, a general-purpose app as a
Series watch.

| Want | Write | Capture needed |
|---|---|---|
| Series 11, 46 mm (default) | `capture: [phone, 'watch-s10:<watch>']` | 416x496, "Apple Watch Series 11 (46mm)" |
| Ultra 3, 49 mm, with a matching capture | `capture: [phone, 'watch-ultra:<watch>']` | 422x514, "Apple Watch Ultra 3 (49mm)" |
| Another frame, same capture | `props: { watchBezel: '<bezel id>' }` | whatever the ref already asks for |

Use the prefix when the app can be captured on that watch: the capture then
fills its own cut-out 1:1. Use `props.watchBezel` when the project has one
watch capture and wants a different model beside the phone; the capture is
drawn `object-fit: cover`, so the small aspect difference crops about 2 %
off the bottom rather than stretching the app UI. Frames available today:
`apple-watch-series-11-46mm`, `apple-watch-series-11-42mm`,
`apple-watch-ultra-3`.

Needs the watch bezel. `s1s bezels install` covers the Series 11
(`Bezel-Apple-Watch-Series-11-2025.dmg`, in the defaults). The Ultra 3 frame is
NOT in the defaults, because only a screen that names it draws it: run
`s1s bezels install --device apple-watch-ultra-3` (314 MB) once. Without the
frame the watch falls back to the Series 11 (or, with none installed, the
generic CSS frame) and `report.json` carries a `bezel-fallback` warning naming
the id that was missing - which is also what a mistyped `watchBezel` looks
like. `s1s bezels list` prints what is installed.

Copy fields: `headline`, `highlight`, `subline`, `badge`. Drop a badge that
names the platform the frame now shows - "Apple Watch" beside a picture of an
Apple Watch is clutter, and removing it lifts the headline back to the top of
the text block where the other screens start theirs.

Props:
- `watchVariant`: the case and band, e.g. `'aluminum-jet-black-sport-band-black'`.
  A watch shares no colour name with a phone, so a project's single
  `theme.bezelVariant` never matches one and the fallback is whichever variant
  installed first. Name it. `s1s bezels list` prints what is installed.
- `watchBezel`: the frame only, e.g. `'apple-watch-ultra-3'`. The capture keeps
  the size its ref asks for. Leave it out to use the watch size's own bezel.
- `align`, `background`, `deviceMaxWidth` (all as `hero-top-text`).

iPad: 30 % watch with a smaller overhang, so it reads as a companion beside a
13-inch canvas rather than a second subject. Note that an Apple Watch pairs
with an iPhone, not an iPad; the frame says "there is a watch app", which is
true, but ask the user before putting it in an iPad set.

Apple rules: compliant. Both devices are whole, upright and un-cropped in their
real Apple bezels and the copy stays beside them. Apple's rule bans cropping
and tilting a product image, not standing two products together.

## feature-grid

When to use: iPad only, for a "three things at once" screen. Use it as an
override of an iPhone screen so the iPhone set keeps a single device and the
iPad set uses its width.

Layout: text block on top; below it the device on the left (56 % of the canvas
width) and up to three numbered callout cards on the right, vertically centred.

| Family | Padding (top / sides / bottom) | Text slot | Card title | Card body | Marker | Card padding / gap |
|---|---|---|---|---|---|---|
| ipad | 76 / 56 / 56 pt | 258 pt | 20-28 pt, 2 lines | 15-20 pt, 3 lines | 36 pt | 28 pt / 24 pt between cards |

Required captures: one (default name = screen id).

Copy fields: `headline`, `highlight`, `subline`, `badge`, and `callouts`: an
array of 1-3 `{ title, body? }`. Zero callouts renders a hatched
"Missing callouts" card and fails the render (error-level `overflow`). More
than three is the same error on the callout column. The iPhone template of the
same screen ignores `callouts`.

Props:
- `side: 'left' | 'right'` (default `left`): which side the device is on.
- `deviceMaxWidth` (fraction, default 0.56): device column width.
- `align`, `background`.

Card styling comes from the theme: marker in `theme.accent`, title in the
headline font and weight, body in `theme.textMuted`, corner radius
`theme.radius`, shadow `theme.shadow`. The card fill is 7 % of `theme.text`
over the background, so it reads on light and dark themes.

iPad: this is the only family. Declare it as an override:

```ts
{
  id: 'features',
  template: 'hero-top-text',                   // iPhone
  overrides: { ipad: { template: 'feature-grid' } },
}
```

Apple rules: compliant.

## raw

When to use: the Apple Watch set (Apple's watch screenshots are unframed
416x496 captures), and full-bleed iPhone or iPad UI shots that need no
marketing copy.

Layout: the capture fills the canvas (`object-fit: cover`, anchored top
centre). No text is rendered.

Watch: `raw` is a passthrough. `s1s render` copies
`captures/<locale>/watch/<id>.png` to the output unchanged and never opens the
browser. The capture must be exactly 416x496 (Apple Watch Series 11 46mm
simulator). Marketing values in the watch UI must come from the app's
screenshot mode, not from a template.

Required captures: one (default name = screen id).

Copy fields: none. `raw` never emits `copy-missing`; keep a copy entry only
when the same key feeds a `watch-caption` screen (switching a watch screen to
`watch-caption` needs one).

Props:
- `fit: 'cover' | 'contain'` (default `cover`). `contain` letterboxes a capture
  that does not match the canvas aspect; the gaps show `background`.
- `background`. Neither prop reaches the watch: `raw` on `watch-s10` is a
  passthrough, so the capture is copied and no template runs. Use
  `watch-caption` if a watch screen needs a background.

iPhone and iPad: the capture (1320x2868 or 2064x2752) equals the canvas, so it
fills it exactly with no scaling.

Apple rules: compliant. A plain screenshot has no bezel to misuse; Apple's
bezel rules apply only to framed images.

## bleed-bottom

Opt-in. NOT compliant with Apple's marketing guidelines: the device is cropped
at the bottom canvas edge. Never choose it yourself; ask the user first and
record the answer in `screenshots/plan.md`.

When to use: only when the user asks for the app UI to read larger than
`hero-top-text` allows, and accepts the guideline risk. Use it for the whole
set or not at all; one cropped device between five whole ones looks like a
render bug.

Layout: text block on top; below it the device at the full canvas width,
running off both sides and off the bottom edge. There is no bottom or side
padding around the device. The frame is clipped at the canvas edge
(`DeviceFrame crop="bottom" allowBleed`), so the bleed is not an `overflow`
error.

| Family | Padding (top / text sides) | Text slot | Headline | Subline | Badge | Gap text to device |
|---|---|---|---|---|---|---|
| iphone | 54 / 30 pt | 172 pt | 28-46 pt, 2 lines | 15-21 pt, 2 lines | 12 pt | 24 pt |
| ipad | 76 / 80 pt | 258 pt | 40-72 pt, 2 lines | 22-32 pt, 2 lines | 17 pt | 34 pt |

Required captures: one (default name = screen id).

Copy fields: `headline`, `highlight`, `subline`, `badge`.

Props:
- `deviceWidth` (fraction of the canvas width, greater than 0 and at most 1;
  default 1 = edge to edge). Anything outside that range falls back to 1.
  Keep one value across the set.
- `align`, `background`.

iPad: same layout with iPad proportions and the larger text ranges.

## tilted

Opt-in. NOT compliant: Apple asks for upright devices. Same rule as
`bleed-bottom` - ask the user, record it in `plan.md`.

When to use: only on request, for a set that wants a magazine look. The whole
device stays inside the canvas: the renderer shrinks it until its rotated
bounding box fits the slot, so a bigger tilt means a smaller device.

Layout: text block on top; the whole device below, rotated around its centre.

| Family | Padding (top / sides / bottom) | Text slot | Headline | Subline | Badge | Device width before the tilt |
|---|---|---|---|---|---|---|
| iphone | 54 / 30 / 30 pt | 172 pt | 28-46 pt, 2 lines | 15-21 pt, 2 lines | 12 pt | up to 82 % of the canvas |
| ipad | 76 / 80 / 44 pt | 258 pt | 40-72 pt, 2 lines | 22-32 pt, 2 lines | 17 pt | up to 84 % of the canvas |

Required captures: one (default name = screen id).

Copy fields: `headline`, `highlight`, `subline`, `badge`.

Props:
- `rotate` (degrees, default -8; negative leans the device to the left).
  Clamped to -20..20; a non-number falls back to -8. Past about 12 degrees
  the shrink is obvious, so keep it small and identical across the set.
- `align`, `background`. There is no `deviceMaxWidth` prop here; the tilt
  drives the size.

Example:

```ts
{ id: 'replay', template: 'tilted', props: { rotate: -6 } }
```

## watch-caption

Opt-in, and the only compliant one of the three. It is the alternative to
`raw` for the watch set when the watch screens need words.

When to use: a watch set whose captures do not explain themselves. Ask first:
`raw` is the default and Apple's own watch screenshots carry no marketing
copy. Use it for every watch screen of the set or for none.

Layout: the unframed 416x496 capture (there is no watch bezel) in a rounded
box, with a fixed-height caption slot above or below it. The canvas is a
46 mm watch face, so the caption budget is two to four words.

| Family | Padding (top / sides / bottom) | Caption slot | Headline | Capture corner radius | Gap |
|---|---|---|---|---|---|
| watch | 14 / 14 / 16 pt | 92 pt | 16-34 pt, 2 lines | 40 pt | 12 pt |

Required captures: one, exactly 416x496 (default name = screen id).

Copy fields: `headline` and `highlight` only. `subline`, `badge` and
`callouts` are ignored: nothing else survives at this size. A screen with no
copy entry renders `[copy missing: <copyKey>]`, so give every
`watch-caption` screen an entry.

Props:
- `captionSide: 'top' | 'bottom'` (default `bottom`).
- `fit: 'cover' | 'contain'` (default `cover`). The capture box is wider than
  a 416x496 capture, so the default scales the capture to the box width and
  cuts roughly the bottom fifth of the watch screen away. Use `contain` when
  the bottom of the screen carries a button row or a number; the capture is
  then letterboxed inside the box instead.
- `background`.

This template is NOT a passthrough. `raw` on `watch-s10` copies the capture
and never opens the browser; `watch-caption` has copy to paint, so the watch
screen goes through Chromium like every other size. One consequence is
useful: a passthrough item has no placeholder and fails even with
`--allow-placeholder`, while a `watch-caption` screen renders a hatched
placeholder like any iPhone screen, so watch layout work can start before the
watch capture exists.

Example:

```ts
{ id: 'watch-stats', template: 'watch-caption', only: ['watch'], props: { captionSide: 'top' } }
```

## Non-compliant templates: what the tool does

`bleed-bottom` and `tilted` tag the canvas `data-s1s-noncompliant="<id>"`, and
`screenshots/out/<locale>/review.md` gets a "Non-compliant templates" section
naming every such template the run used. Nothing is blocked: the render still
exits 0 and the export still runs. Apple reviews marketing images against its
guidelines, so a non-compliant set is the user's risk. Never switch a screen
to one of them without the user's approval, and write the decision into
`screenshots/plan.md`.

## Panorama backgrounds

One wide image cut into a slice per screen, so consecutive screenshots join up
in the App Store carousel. It is a project-level setting in `screens.ts`, not
a per-screen prop:

```ts
export default defineScreens({
  panorama: { image: 'assets/pano.png', screens: ['map', 'laps', 'replay'] },
  screens: [ /* ... */ ],
});
```

- `image` is a path relative to `screenshots/` (the project dir). Put the file
  under `screenshots/assets/`.
- `screens` lists the ids that take a slice, in carousel order. Omit it and
  every screen in `screens.ts` order takes one. An id `screens.ts` does not
  define is dropped from the list, because counting it would shift every later
  slice.
- The slice count is the length of that list. Screen `i` shows the strip from
  `i / count` to `(i + 1) / count` of the image width.
- The image is `cover`-cropped into a strip `count` canvases wide, then slid
  left by `i` canvases. Make it `count` times as wide as one canvas and the
  same height, so nothing is cropped: `count x 1320` by `2868` for iPhone 6.9".
  One image serves every size, so pick an aspect that survives both an iPhone
  and an iPad crop, or give the iPad set its own screens.
- Precedence: the panorama is a project-wide default for `props.background`.
  An explicit `props.background` on the screen, or on any `overrides.<family>`
  / `overrides.<sizeId>` / `locales.<locale>` layer, wins, and that screen
  drops out of the seam. This is how you exclude one screen without touching
  `panorama.screens`.
- Sizes are cut independently but from the same list, so the slice order is
  identical on iPhone and iPad. A screen the panorama would list but `only`
  keeps off a family, or that the watch copies through as a passthrough,
  would consume its index without ever being drawn there. `s1s render`
  refuses that config (`config-invalid`) instead of shipping a broken seam:
  list `panorama.screens` explicitly, or give that family its own list.
- `panorama.screens` ids are checked too. An id `screens.ts` does not define,
  or one listed twice, is `config-invalid`: either would silently re-cut every
  slice.
- A missing or unreadable image file is an error-level `image-missing` on
  every screen of the panorama (the render exits 1) and the theme background
  shows through. Check the contact sheet: the seam is the only thing that
  proves the slices line up.

Every template that draws a `Background` honours it (all the built-ins do).

## Writing screens.ts and theme.ts

Both files are data only. Import from `screen1shoter/config`; never import
`react`, `screen1shoter` or a `.tsx` file there (`s1s render` refuses it).

### screens.ts: a complete worked example

Six iPhone screens, five on iPad, one watch screen. Ids are file-safe
(`[A-Za-z0-9][A-Za-z0-9._-]*`) because they are also capture and output names.

```ts
// screenshots/screens.ts
import { defineScreens } from 'screen1shoter/config';

export default defineScreens({
  sizes: ['iphone-6.9', 'ipad-13', 'watch-s10'],
  locales: ['en-US', 'de-DE'],               // first entry is the source locale
  screens: [
    {
      id: 'map',
      template: 'hero-top-text',             // screen 1: the biggest reason to download
      only: ['iphone', 'ipad'],
      notes: 'WorkoutDetailView, hero ride, map tiles loaded.',
    },
    {
      id: 'laps',
      template: 'hero-top-text',
      only: ['iphone', 'ipad'],
      capture: { iphone: 'laps', ipad: 'laps-wide' },   // a different capture name per family
      notes: 'Same view scrolled to the lap table.',
    },
    {
      id: 'replay',
      template: 'text-bottom',               // the important UI is at the top of the capture
      only: ['iphone', 'ipad'],
      props: { background: { type: 'gradient', from: '#0B0F19', to: '#141C33', angle: 180 } },
      overrides: {
        'iphone-6.5': { props: { deviceMaxWidth: 0.8 } },   // size override beats the family override
      },
    },
    {
      id: 'history',
      template: 'hero-top-text',
      overrides: {
        ipad: { template: 'feature-grid', props: { side: 'right' } },   // iPad: device + 1-3 callouts
      },
      only: ['iphone', 'ipad'],
    },
    {
      id: 'compare',
      template: 'two-device',
      capture: ['history', 'laps'],          // exactly two captures, both of this family
      props: { front: 'right' },
      only: ['iphone', 'ipad'],
    },
    {
      id: 'watch-banner',
      template: 'hero-top-text',
      copyKey: 'watch-banner',               // default is the id; set it only to share copy between screens
      only: ['iphone'],                      // no iPad shot for this one
      locales: {
        'de-DE': { capture: 'watch-banner-de' },   // a locale-specific capture name
      },
    },
    {
      id: 'watch-stats',
      only: ['watch'],                       // template defaults to 'raw' for watch
      notes: 'MOTOFIT_WATCH_SCREENSHOT_SCENE=mkt-stats-heart, 416x496.',
    },
  ],
});
```

Rules the example shows:

- `sizes` lists size ids. Default is `['iphone-6.9', 'ipad-13']`. `iphone-6.7`
  is an alias of `iphone-6.9` (rendered once, exported twice); never key
  `overrides` or `only` by an alias id.
- `only` restricts a screen to families or size ids. Each family gets its own
  ordinal sequence, so dropping a screen on iPad renumbers the iPad set only.
- `capture` is a name, an array of names (`two-device`, `phone-watch`), or a
  map per family. A name may be prefixed with a size (`'watch-s10:watch-lap'`)
  to read a capture belonging to another device.
  Omit it to use the id. Names resolve to
  `captures/<locale>/<family>/<name>.png`, then to the `reuse:<l>` locale's
  file (info-level `capture-fallback-locale`), then to the source locale's
  (warn-level: nobody declared that reuse), then to a placeholder.
- `overrides` keys are families (`iphone`, `ipad`, `watch`) or size ids
  (`iphone-6.5`). `locales` keys are locale codes and apply last.
- `props` shallow-merge across layers; `template` and `capture` replace.
- `notes` is for people and agents; it is never rendered.
- `panorama` (a wide background sliced across the listed screens) is a
  sibling of `screens`, not a screen field. It fills `props.background` for
  every screen it lists; see "Panorama backgrounds" above.

Validate after every edit:

```sh
s1s render --dry-run --allow-placeholder --json   # config errors, capture counts, unknown templates
s1s render --allow-placeholder       # layout work before captures exist (hatched panels)
```

### theme.ts: a complete worked example

```ts
// screenshots/theme.ts
import { defineTheme } from 'screen1shoter/config';

export default defineTheme({
  background: '#0B0F19',       // sRGB hex only; also flattens any alpha in post-processing
  accent: '#FF6B00',           // badge, callout markers, default highlight colour
  text: '#FFFFFF',             // headline, callout titles
  textMuted: '#A9B1C6',        // subline, callout bodies (default: text)
  highlight: '#FFB86B',        // colour of the `highlight` word (default: accent)
  fonts: {
    headline: '-apple-system, "SF Pro Display", "Inter Variable", "Inter", system-ui, sans-serif',
    body: '-apple-system, "SF Pro Text", "Inter Variable", "Inter", system-ui, sans-serif',
    portable: false,           // true = both stacks become the bundled Inter (identical pixels on every machine)
  },
  headlineWeight: 700,         // 100-1000
  headlineCase: 'title',       // 'title' (default) | 'sentence' | 'upper'
  bezelVariant: 'deep-blue',   // 'auto' (default) = first installed colour of the model
  radius: 16,                  // pt; cards, badges, callouts
  shadow: '0 8px 24px rgba(0,0,0,0.25)',   // callout cards; omit for none
});
```

Field notes:

- Only `background`, `accent` and `text` are required. Every colour must be a
  3- or 6-digit hex; `rgb()` and names fail validation.
- `headlineCase: 'title'` capitalises every word except small words mid-line
  (a, an, the, of, to, in, on, at, by, with, ...) and never lowercases, so
  "GPS" stays "GPS". That list is English, so outside an English render locale
  `'title'` renders as `'sentence'`. `'sentence'` capitalises the first character only.
  `'upper'` uppercases everything. Write the copy in the case you want to see
  for `sentence`; `title` and `upper` transform it. Choose one for the set;
  it is a theme field, not a per-screen one.
- `fonts`: the default stacks use SF Pro on a Mac and the bundled Inter
  elsewhere. Set `portable: true` when renders must be byte-identical across
  machines or CI (it replaces both stacks with the bundled Inter and so
  overrides any project font). A named family that is not installed and is not
  a project font produces a warn-level `font-fallback`. Drop the font files
  into `screenshots/fonts/` to ship a brand face with the repo; see "Project
  fonts" below.
- `bezelVariant`: the colour slug of the installed bezel. Installed variants:
  `s1s bezels list`. Known slugs: iPhone 17 Pro Max and Pro `deep-blue`,
  `cosmic-orange`, `silver`; iPhone 17 `black`, `white`, `lavender`,
  `mist-blue`, `sage`; iPhone Air `space-black`, `cloud-white`, `light-gold`,
  `sky-blue`; iPad Pro (M5) `space-black`, `silver`. One variant applies to
  every family; a slug the iPad does not have falls back to its first colour.
  Pick a variant that contrasts with `background` (a black iPad on `#000` has
  no edge).

### Project fonts: screenshots/fonts/

Font files the app repo ships are registered automatically. There is no field
to fill in: put the files in `screenshots/fonts/` and name them well.

```
screenshots/fonts/
  Satoshi-Regular.woff2
  Satoshi-Bold.woff2
  Satoshi-BoldItalic.woff2
  OFL.txt                      # ignored, not a font
  sources/Satoshi-Black.woff2  # ignored: subdirectories are not scanned
```

Rules the scan follows:

- Only files directly under `screenshots/fonts/`. Subdirectories are ignored.
  A missing `fonts/` directory (or a file of that name) is simply "no project
  fonts", never an error.
- Extensions: `.woff2`, `.woff`, `.ttf`, `.otf` (case-insensitive). Anything
  else is skipped.
- The file name is the whole face description. `Family-Weight[Italic].ext`:
  the scan splits at the first `-` or `_` whose remainder names a weight, so
  `SF-Pro-Display-Bold.woff2` is family `SF-Pro-Display` at 700, and
  `Satoshi-Bold-Italic.woff2` is `Satoshi` 700 italic.
- Weight words, in any case: `thin`/`hairline` 100, `extralight`/`ultralight`
  200, `light` 300, `regular`/`normal`/`book` 400, `medium` 500,
  `semibold`/`demibold` 600, `bold` 700, `extrabold`/`ultrabold` 800,
  `black`/`heavy` 900. A bare `Italic` suffix is 400 italic.
- A variable font is `Family[-|_ ]Variable[-Italic].ext`
  (`InterVariable.woff2`, `Inter-Variable.ttf`): the family is what precedes
  `Variable`, and the weight becomes the range `100 900`.
- A name that describes no face is the family itself at 400 normal, so
  `Cabinet-Grotesk.woff2` registers family `Cabinet-Grotesk` and
  `Satoshi.woff` registers `Satoshi`. Nothing is ever rejected for its name.
- Files are read in sorted order and one `@font-face` is written per file, so
  a `.woff` next to its `.woff2` both register and the `.woff2` rule wins.

Then name the family in the theme, exactly as the file name spells it:

```ts
fonts: {
  headline: '"Satoshi", -apple-system, system-ui, sans-serif',
  body: '"Satoshi", -apple-system, system-ui, sans-serif',
},
```

- `theme.fonts.headline` and `theme.fonts.body` are plain CSS stacks; a
  project font is just another family name in them. Keep a real fallback after
  it.
- `theme.headlineWeight` must be a weight the files provide (or any value
  inside a variable font's range). A weight with no file is synthesised by the
  browser and looks wrong.
- `portable: true` overrides both stacks with the bundled Inter, so it and a
  project font are mutually exclusive. Project fonts are the portable option
  when the files are committed: every machine then renders the same pixels.
- The renderer force-loads every project family before it declares the page
  ready, so no render can catch a fallback mid-swap. A file that fails to load
  still declares its family, and the render reports the warn-level
  `font-fallback` for that stack.
- `s1s dev` reloads the page when anything under `screenshots/fonts/` changes.

### copy/<locale>.json: the fields templates read

The copy playbook owns the words. The shape templates read:

```json
{
  "locale": "en-US",
  "approved": false,
  "shared": { "appName": "MotoFit" },
  "screens": {
    "map":     { "headline": "See Every Ride on the Map", "highlight": "Every Ride", "subline": "GPS tracks with your start line" },
    "laps":    { "headline": ["Automatic", "Lap Timing"], "highlight": "Lap Timing", "subline": "Best lap and average, every session" },
    "replay":  { "headline": "Replay Laps in 3D", "highlight": "3D", "badge": "New" },
    "history": {
      "headline": "Build a Track History",
      "highlight": "History",
      "subline": "Every track you have ridden, in one place",
      "callouts": [
        { "title": "Tracks", "body": "Each track keeps its own laps and bests." },
        { "title": "Start lines", "body": "Set once, timed on every visit." },
        { "title": "Trends", "body": "Watch your best lap fall week by week." }
      ],
      "layoutNotes": "callouts are for feature-grid on iPad; the iPhone hero ignores them"
    },
    "compare":      { "headline": "From Ride to Record", "highlight": "Record" },
    "watch-banner": { "headline": ["Phone or Watch.", "Your Call."], "highlight": "Your Call." },
    "watch-stats":  { "headline": "On Your Wrist", "layoutNotes": "raw renders no text" }
  }
}
```

An array headline fixes the line breaks; write them with the copy so the
translator decides them too. Extra fields in a screen entry are allowed and
reach custom templates through `copy` (see below).

### Adding a custom template

Use a custom template when a built-in cannot express the layout. Keep it to
React plus the `screen1shoter` runtime; a custom template that imports a
CommonJS npm package fails in render mode.

1. Create the module next to the entry file:

```tsx
// screenshots/templates/hero-left.tsx
import { Background, backgroundSpecFrom, Badge, Caption, DeviceFrame, Headline, defineTemplate, layoutScale } from 'screen1shoter';

export default defineTemplate({
  id: 'hero-left',                       // a built-in id here replaces that built-in
  families: ['iphone', 'ipad'],
  compliant: true,                       // false tags the canvas data-s1s-noncompliant
  Component: ({ screen, preset, theme, copy, mode }) => {
    const s = layoutScale(preset);       // 1 at 440 pt (iPhone) / 1032 pt (iPad)
    const px = (v: number) => Math.round(v * s);
    const tagline = typeof copy?.['tagline'] === 'string' ? copy['tagline'] : undefined;   // an extra copy field
    return (
      <>
        <Background spec={backgroundSpecFrom(screen.props['background'], theme.background)} />
        {/* A flex column with a definite height: DeviceFrame fills the slot the text leaves. */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', padding: px(40), gap: px(20) }}>
          <div data-s1s-slot="" style={{ flex: 'none', height: px(172), display: 'flex', flexDirection: 'column', gap: px(10), alignItems: 'flex-start' }}>
            {copy?.badge ? <Badge text={copy.badge} theme={theme} fontSize={px(12)} /> : null}
            <Headline text={copy?.headline ?? ''} highlight={copy?.highlight} theme={theme} locale={screen.locale} minPt={px(28)} maxPt={px(46)} align="left" />
            {tagline ? <Caption text={tagline} theme={theme} minPt={px(15)} maxPt={px(21)} align="left" /> : null}
          </div>
          <DeviceFrame captures={screen.captures} preset={preset} theme={theme} maxWidth={Math.round(preset.pt.width * 0.82)} align="start" />
        </div>
      </>
    );
  },
});
```

2. Register it in the entry file (`templates/index.ts` or `index.tsx`; the
   first that exists wins):

```ts
// screenshots/templates/index.ts
import type { TemplateModule } from 'screen1shoter';
import heroLeft from './hero-left.tsx';

export default [heroLeft] as TemplateModule[];
```

3. Use it: `{ id: 'map', template: 'hero-left' }`. Check with
   `s1s render --dry-run --allow-placeholder --json`, then look at it in `s1s dev --open`.

What the runtime gives a template (`TemplateProps`): `screen`
(`ResolvedScreen`: `id`, `locale`, `sizeId`, `family`, `template`, `copyKey`,
`captures[]`, `props`, `notes`), `preset` (`SizePreset`: `pt`, `px`, `scale`,
`family`, bezel ids), `theme`, `copy` (the screen's entry or `undefined`) and
`mode` (`'render' | 'dev'`).

Main exports of `screen1shoter` for templates: `Canvas`, `layoutScale`,
`REF_WIDTH`, `Background`, `backgroundSpecFrom`, `FitBox`, `fitInto`,
`DeviceFrame`, `GenericBezel`, `genericGeometry`, `Headline`, `applyCase`,
`splitHighlight`, `Caption`, `Badge`, `readableOn`, `Callout`, `TITLE_LINES`,
`BODY_LINES`, `MissingCapture`, `useFitText`, `chooseSize`, `useBezel`,
`useCapture`, `captureUrl`, `placeholderCapture`, `acquire` (hold
`__S1S_READY` while an asset loads), `ensureFonts`, `fontFamiliesOf`, the
types `BackgroundSpec`, `FrameGeometry`, `CalloutProps`, `CalloutSizes`,
`FitOptions`, `ChooseSizeInput`, `ChooseSizeResult`, `BezelLookup`, plus every
type and helper of `screen1shoter/config`. The full list is
`src/runtime/index.ts` in the Screen1Shoter checkout.

Rules for a custom template:

- Return content only. The runtime wraps it in `Canvas` (size, theme
  background, CSS variables `--s1s-w`, `--s1s-h`, `--s1s-accent`, ...).
- Give `DeviceFrame` room: a flex column with a definite height, or
  `fit={{ width }}`. A collapsed slot is flagged as an `overflow` error with
  the reason in the warning.
- Use `Headline` and `Caption` for text so auto-fit and the overflow checks
  apply. For other text call `useFitText(ref, text, { minPt, maxPt, mode:
  'wrap' | 'pre', maxLines, lineHeight })` yourself. Wrap the text block in an
  element with `data-s1s-slot=""` so `text-clipped` is detected.
- Never place copy on top of the device, never crop or rotate the frame unless
  `compliant: false` is set on purpose. `DeviceFrame` has `crop: 'bottom'`,
  `rotate` and `allowBleed` for opt-in layouts only.
- Node does not know a custom template's family or capture count: guard
  `screen.captures[1]` yourself and use `placeholderCapture(id, family,
  locale)` for a missing one so the page still becomes ready.
- No animations, no `Math.random` without a seed (render mode seeds it), no
  network. Everything must be ready before `window.__S1S_READY`.
- Run `s1s link` in the app repo once so the editor resolves `screen1shoter`,
  `react` and the JSX types (`screenshots/tsconfig.json` is scaffolded by
  `s1s init`).

### Consistency checklist for a set

Run through this before you mark a set `image-approved`. Look at
`screenshots/out/<locale>/sheet-<sizeId>.png` first; open a 1/3-scale preview
under `screenshots/out/<locale>/<APP_DISPLAY_TYPE>/preview/` only for a screen
with a warning.

- One story arc: screen 1 is the biggest reason to download, 2-3 the core
  loop, 4-6 differentiators, the last one platform breadth or social proof.
- One primary template. `hero-top-text` for most screens; `text-bottom` in a
  block, not alternating; `two-device`, `feature-grid` and `phone-watch` at
  most once each. `phone-watch` is the exception that costs nothing: it keeps
  hero-top-text's text block and device box, so it does not break the set.
- Same device size on every screen of a size: identical `deviceMaxWidth`
  (or none) and the same template family, so the bezels line up in the
  carousel.
- Same background treatment on every screen. A gradient or image background
  is an opt-in the user asked for, recorded in `plan.md` and applied to
  every screen of the set (copy-playbook section 6).
- Same `headlineCase`, one `highlight` word or phrase per headline, the
  highlight present in the headline text, badge on at most one or two screens.
- Headlines 2-5 words, verb-first; sublines 8 words or fewer; no
  `text-min-size` or `text-clipped` warning in `report.json`.
- Captures: one appearance (dark or light) for the whole set, status bar
  9:41 with full signal and battery, same locale as the copy, no placeholder
  panels, no `capture-dims` warning, no personal data.
- iPad set mirrors the iPhone order. Drop a screen with `only`, never reorder.
  `feature-grid` callouts exist (1-3) wherever the iPad override uses it.
- Watch set: `raw` (or `watch-caption` on every watch screen when the user
  asked for captions, never a mix), 416x496 captures, marketing-grade values
  from the app's screenshot mode. When the app has a watch app, ask whether one
  iPhone and iPad frame should carry it too (`phone-watch`): the watch set is
  behind a listing tab most shoppers never open.
- `capture` refs that name another size (`'watch-s10:watch-lap'`) point at a
  file that really exists under that size's family directory, and the size in
  the prefix is the watch the frame should show.
- No `bezel-fallback` warning on a `phone-watch` screen: that is what a
  `props.watchBezel` typo or an Ultra frame nobody installed looks like.
- Panorama, when the set uses one: the seam lines up on the contact sheet, no
  screen of the run silently kept its own `background`, and the slice order
  matches the export order (`NN`).
- No non-compliant template unless `plan.md` records the user's decision.
- `report.json` says `ok: true`; `review.md` lists no failures and no
  "Non-compliant templates" section you did not expect.
