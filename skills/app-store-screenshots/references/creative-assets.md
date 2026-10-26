# Creative assets: product page header and search results

Reference for the creative asset step of P5 (SKILL.md section 10). iOS 27 and
iPadOS 27 added two optional placements that sit outside the screenshot set:

- **Product page header**: "the first visual element people will see when
  they land on your app" (WWDC26 session 205). Sources disagree on whether the
  name and Get button sit on it or below it; check App Store Connect Preview.
- **Search results asset**: one image that replaces the row of three
  screenshots (or the app preview) under the app's row in organic search.

Both live in the App Store Connect **Asset Library**. Apple reviews an asset
once; an approved asset can then be placed, swapped and reused (version page,
custom product pages, product page optimization, Apple Ads) without another
review. Without an asset the store falls back to in-app events, app previews
and screenshots. Shoppers on iOS 26 or older still see the screenshots, so the
screenshot set stays the primary work.

Facts below are dated 2026-10-26. "Apple" marks Apple's own pages, the App
Store Connect API (`asc asset-library specs`) and Apple's templates.
"Practice" marks ASO practitioners; treat it as opinion, not measurement.

## 1. Sizes s1s renders

| Size id | Folder | Pixels | Ratio | Format | Fills | Art Safe Area (px) |
|---|---|---|---|---|---|---|
| `creative-universal` | `CREATIVE_UNIVERSAL` | 5244x2950 | 16:9 | PNG only | header and search | x 1921, y 660, 1402x962 |
| `creative-header` | `CREATIVE_HEADER` | 3840x1646 | 21:9 | PNG only | header | x 1097, y 493, 1646x661 |
| `creative-search` | `CREATIVE_SEARCH` | 3840x2560 | 3:2 | PNG or JPEG | search results | x 836, y 765, 2168x1030 |

Apple facts:

- Sizes, formats, the 500 MB limit and "no alpha channel" come from Apple's
  image specs (`asc asset-library specs`). The API lists the header-only
  3840x1646 file as PNG only, though the Help page also names JPEG; s1s
  always writes PNG.
- Search results take any 3:2 from 1920x1280 to 3840x2560; s1s renders the
  largest.
- Only the universal 16:9 file can fill both placements ("Use header asset in
  search results" in App Store Connect works only for a universal asset).
- Video exists for both placements (21:9 header, 3:2 search, 5 to 30 s, 30 or
  60 fps, loops, muted). There is no universal video. s1s renders images only.
- The Art Safe Area is the rectangle named "ART SAFE AREA" in Apple's
  Photoshop and Sketch creative asset templates (identical in both,
  developer.apple.com/app-store/asset-best-practices). Every App Store layout
  keeps it. The universal one sits 334 px above centre: the header keeps the
  upper part of a 16:9 file.
- Each placement holds one asset per version localization (`maxCount: 1`).

## 2. What to put in each placement

Apple's guidance (asset best practices page, WWDC26 session 205):

- Header: "Focus on a single, clear idea." Design for a first-time visitor.
  Brand, seasonal offers, new content. Visually dense or cluttered assets
  dilute the impact.
- Search results: "State the obvious." The app's purpose must be clear at a
  glance. "Showcase the firsthand experience": the interface, content or
  gameplay.
- Both: a focal point in the centre, key elements inside the safe area, text
  only as a short phrase that adds to the visual (not a description of it),
  localized for every language. Current UI and imagery. A cohesive set with the
  icon and screenshots: one palette, one type, one tone.
- Never: prices or discounts, website URLs, the copyright symbol, awards or
  claims you cannot verify, Apple recognitions (Editor's Choice, App of the
  Day, Apple Design Award), other platforms or stores, objectionable content.
  Assets must suit a 4+ age rating even when the app does not. App Review
  guideline 2.3.14 (Oct 2026) makes these rules review criteria.

Practice (early: no conversion data exists yet, and only iOS 27 shoppers see
these assets):

- Make the search asset first. It is the first image a searcher sees, and a
  searcher wants to know at once whether the app does the job.
- Search: one large real screen and a 2 to 6 word headline. Not three small
  phones, not UI too small to read, not a copy of screenshot 1. On iPhone the
  card shows the whole 3:2 image at about 365 pt wide.
- Header: brand or mood art, the app name or one promise, little or no text.
  The icon, name and Get button are next to it, so feature lists add nothing.
- Universal: a logo, one hero object or one short line. Its safe area is under
  9% of the canvas, so UI shown there is tiny. Start universal when the team
  has time for one asset; move to a dedicated search asset once search brings
  installs.
- Expect no keyword ranking effect. No source shows that Apple indexes text in
  these assets. Keep the keyword captions in the screenshots (copy-playbook.md).
- Test one placement per product page optimization treatment, never header and
  screenshots together. A running test blocks placement changes
  (`EXPERIMENT_IN_PROGRESS`).
- Custom product pages can carry their own header and search asset per keyword
  theme. Apple has not confirmed that a page's search asset shows for its
  keywords; check it live before you build many.
- Localization: a text-free header works in every locale; make one search
  asset per language. German and Finnish run 30 to 40% longer than English.
- Submit early (reviews took 2 to 6 days at launch) and not bundled with an
  urgent build: a rejected item holds back the whole submission.

## 3. Creative direction first, then compose

These are marketing art, not a fourth screenshot. A header or universal asset
made of screenshots alone fails gate V. Work like an art director: brief,
concepts, key art, then layout.

### 3.1 Brief and three concepts (gate C, before any render)

Write `screenshots/creative-brief.md`: the one idea each placement carries,
the audience and their search intent (the target keywords), the brand
palette and type from `theme.ts`, what makes the app's result special, and
what the competitors' rows look like (`asc apps public search --term
"<keyword>"` lists them). Then pitch at least three distinct concepts per
placement, each one line plus its key art source, and let the human pick:

| Concept | Key art | Fits |
|---|---|---|
| Product hero | The thing the app makes, rendered big: `s1s model render` of a real output (3D, CAD, AR, games), a real photo, a real document | header, universal |
| Outcome | The result in the user's world: the finished object, the trip, the plan, before -> after | header, universal |
| Brand line | One bold promise in the brand type over brand art (gradient, texture, glow), maybe the icon | header, universal (text-light locales: none) |
| UI in action | One large real screen doing the job, plus 2 to 6 words | search |
| Collection | A row of three real outputs: range at a glance | header |

Rules for every concept: real content only (real outputs of the app, never
mock results); pick outputs the audience recognises at a glance, best the
ones the screenshots already show (the same Pi case in the header and in
screenshot 1 tells one story; an unknown industrial part tells none); one
focal subject, big (it fills most of the height), the
screenshot palette so the page reads as one set, and something a shopper
would not mistake for a competitor's row.

### 3.2 Key art sources

- `s1s model render <file.stl|obj|usdz> --out screenshots/assets/<name>.png`
  renders a 3D model with SceneKit to a transparent studio PNG, trimmed to
  the object: physically based material (`--color`, default the copper
  `#B86E26`; `--metalness`, `--roughness`), `--yaw` and `--pitch` for the
  angle, `--up z` for CAD exports, smooth curves with sharp edges, a soft
  studio light and rim. Pick parts with clean silhouettes; render several
  angles and Read them before you choose. The best source is the exact
  outputs the screenshots show: export them from the demo projects (or copy
  the stored files read-only, with the human's OK); an eval archive is a
  fallback. Several files of one assembly render together in their own
  coordinates: `s1s model render base.stl lid.stl --out ...`.
- A photo or artwork from the human (`screenshots/assets/`), used as
  `background: { type: 'image', src }` or as `art`.
- The app icon (`icon`), large, for a brand-line concept.
- Captures (`'iphone-6.9:<name>'`): the search asset's real UI, or a phone
  beside key art. Never the only subject of a header.
- Do not generate key art with an image model: it shows a result the app did
  not make.

### 3.3 Compose with `creative-hero`

A creative canvas has no simulator and no bezel of its own. Creative sizes
are opt-in: a screen renders on them only when its `only` names `creative` or
the size id. The SaySolid set, as an example:

```ts
// screenshots/screens.ts
sizes: ['iphone-6.9', 'ipad-13', 'creative-search', 'creative-header', 'creative-universal'],
screens: [
  // ...the screenshot screens...
  {
    id: 'store-search',                       // UI in action
    only: ['creative-search'],
    template: 'creative-hero',
    capture: ['iphone-6.9:describe'],
    props: { text: 'left', background: { type: 'gradient', from: '#1B3558', to: '#0B1626', angle: 160 } },
  },
  {
    id: 'store-header',                       // collection of real parts
    only: ['creative-header'],
    template: 'creative-hero',
    props: {
      text: 'none',
      art: ['assets/part-pedestal.png', 'assets/part-bell.png', 'assets/part-bracket.png'],
      glow: 'rgba(84, 132, 204, 0.42)',
      background: { type: 'gradient', from: '#1B3558', to: '#0B1626', angle: 160 },
    },
  },
  {
    id: 'store-universal',                    // product hero + promise
    only: ['creative-universal'],
    template: 'creative-hero',
    props: { text: 'top', art: ['assets/part-bracket.png'], glow: 'rgba(84, 132, 204, 0.42)' },
  },
],
```

Copy goes under the screen id in `copy/<locale>.json` (`headline`,
`highlight`, `subline`); 2 to 6 words. With `text: 'none'` the copy entry is
still required: its headline names the asset in the Asset Library.

| Prop | Values | Effect |
|---|---|---|
| `text` | `'left'` (default), `'top'`, `'none'` | Text column left of the subjects, text block above them, or no text. |
| `art` | path, or list of paths or `{ src, scale }` | Key art (transparent PNGs) in the row before any device; `scale` (0 to 1) shrinks one against the tallest. |
| `glow` | CSS colour | A soft spotlight behind the subjects. |
| `icon` | project-relative image | The app icon above the headline. |
| `background` | colour, gradient, image | Same spec as every template (template-catalog.md); a photo goes here. |

The layout rules: the text block lies inside the Art Safe Area. Subjects are
whole and side by side with a gap, never overlapped, up to 88% of the canvas
height. Devices also stay within the safe area's width, so no layout cuts off
UI. A row of key art alone may use the canvas width less 10% each side (an
iPhone cuts about 8% from each side of the header): its centre is the focal
point and its edges may pass the safe area, like the figure in Apple's
template sample. A phone beside a tablet stands at 80% of its height. Up to
three captures, each with a size prefix (`'iphone-6.9:describe'`).

What fits each canvas:

| Size | Works | Does not work |
|---|---|---|
| `creative-search` | `text: 'left'` + one phone | two or more devices beside text (`device-small`) |
| `creative-header` | `text: 'none'` + key art (one hero or a row of three), or key art + one device | screenshots only; text beside devices (the safe area is 823 pt wide) |
| `creative-universal` | `text: 'top'` + one hero object, or `text: 'none'` + key art | text beside a device (`device-small`); screenshots only |

When a concept needs a composition `creative-hero` cannot draw (an object
breaking out of a phone, a diagonal, a before -> after split), write a project
template in `screenshots/templates/index.ts` (template-catalog.md "Adding a
custom template"): keep the `data-s1s-safe-area` box, mark text
`data-s1s-safe` and each device box `data-s1s-device`, and the same checks run.

## 4. Render and validate (gate V, before G3)

Never show a creative asset to the human before it passes this step. A
preview at one third of the size hides cut-off devices, overlaps and UI too
small to read; the first SaySolid set shipped all three past a glance.

```sh
s1s render --locale en-US --sizes creative-search,creative-header; echo "exit $?"
jq -r '.items[] | select(.sizeId | startswith("creative")) | "\(.key) \(.status) " + (.warnings | map("\(.level):\(.code)") | join(","))' screenshots/out/en-US/report.json
find screenshots/out/en-US -path '*CREATIVE_*/store/*.png' | sort
```

The render writes two review views per asset under
`out/<locale>/CREATIVE_*/store/` (never uploaded):

- `NN-<id>-phone.png`: what an iPhone shows, @3x: the search card whole at
  about 365 pt, the header with about 8% cut from each side at 402 pt, the
  universal canvas whole. This is what a shopper sees.
- `NN-<id>-safe.png`: the Art Safe Area at full resolution, the part every
  App Store layout keeps.

Read both views of every asset, then go through this list and write the result
of each item down. Any fail: fix the source, re-render, run the whole list again.

1. Report: 0 errors and 0 warnings for the item. `device-overlap` (one device
   hides another), `device-small` (a device under half the canvas height),
   `overflow` (a device leaves the canvas), `safe-area` (text outside the safe
   area), `text-clipped`, `text-min-size`. Fix by fewer devices, `text: 'none'`
   or a shorter headline, never by hiding the warning.
2. Whole devices: in the phone view every frame shows all four corners and
   both sides; no device covers another; no capture is cut by its frame; 9:41
   status bar; no placeholder panel or debug UI.
3. Readable at store size: in the phone view you can read the headline, the
   app's title bar and the main content of each screen (the chat, the part,
   the readout). If you squint, it fails.
4. Safe crop: in the safe view the headline is complete (no letter cut) and
   the main subject is still recognisable on its own.
5. Composition: the subject fills at least half the canvas height; text and
   devices read as one centred group; no half of the canvas is empty; line
   breaks are natural (no "From a" orphan); one highlight.
6. Placement fit: search shows the real UI and the purpose in a few words;
   header carries one idea with key art and little or no text (screenshots
   alone fail); universal is one object or one line.
7. Concept: it is the concept the human picked at gate C, its key art is a
   real output of the app, and it would stand out in the competitors' row.
8. Apple rules: no price, discount, URL, the copyright symbol, awards, Apple
   recognitions or other platforms; content for ages 4+.

At G3 give the human the list with its results and the paths of the phone
views; ask for approval per asset. Then:

```sh
s1s status --set image-approved --locale en-US --sizes creative-search,creative-header --yes
s1s export --locale en-US --sizes creative-search,creative-header && s1s validate --locale en-US --sizes creative-search,creative-header
```

A `--sizes` render replaces the render report: render every size you export
in one run, or export right after each render. Export writes
`metadata/creative-assets/<locale>/CREATIVE_*/NN.png`, beside
`metadata/screenshots/` and never inside it, because `asc screenshots upload`
walks every folder under the screenshot root. `s1s validate` checks the exact
size, no alpha, RGB and PNG-only for the universal and header sizes. `asc
screenshots validate` does not know these files; do not run it on them.

## 5. Upload and place (gate G4)

Only on request, one placement at a time, after the human approves the
commands. Full commands: [asc-upload.md](asc-upload.md) section 13. In short:
upload each file to the Asset Library, then place the image in the version
localization. The universal asset takes both placements; a dedicated header
or search asset wins its slot over the universal one.

## 6. Sources

Apple:

- developer.apple.com/app-store/asset-best-practices/ (guidance, templates)
- developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/
- developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets/
- developer.apple.com/videos/play/wwdc2026/205/ (Enhance your presence on the App Store)
- `asc asset-library specs` (App Store Connect API image and video specs)

Practice (2026-09 to 2026-10): aso.dev/app-store-connect/placements,
blakecrosley.com/blog/app-store-product-page-marketing-2026,
objectgraph.com/blog/ios-27-app-store-header-and-search-results-art,
teroxai.com/blog/app-store-creative-assets-sizes-api,
neoads.substack.com/p/app-store-creative-assets,
asoagency.io/blogs/app-store-creative-assets-ios-27,
admiral.media/app-store-creative-assets,
applaunchflow.com/blog/app-store-search-result-assets,
adapty.io/blog/app-store-asset-library,
onlyapps.org/blog/app-store-header-search-results-assets,
ppc.land (guideline 2.3.14).
