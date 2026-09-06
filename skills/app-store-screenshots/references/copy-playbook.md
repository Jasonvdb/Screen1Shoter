# Copy playbook

Use this playbook in Phase 1 (discovery and copy) and again in Phase 6 (per locale). It tells you how to find the benefits, write the headlines, rate the captures, pick the brand colour, and keep the set consistent.

Text is real text. The renderer draws every headline from `screenshots/copy/<locale>.json` with the app's fonts. There are no image prompts. This replaces the image-model generation of the old `aso-appstore-screenshots` skill; the methodology below is ported from it verbatim where marked.

Outputs of this playbook:

- `screenshots/plan.md`: benefits, order, template per screen, brand colour, appearance, keyword decisions.
- `screenshots/copy/<locale>.json`: the copy (shape in "Copy file shape").
- `screenshots/manifest.json`: `screens[]` (`id`, `order`, `benefit`, `template`, `sizes`) and `locales.<locale>.copyStatus`.

Paths are relative to the app repo.

---

## 1. Benefit discovery (most critical phase)

This phase sets the foundation for everything. The goal is to identify the 3-5 absolute CORE benefits that will drive downloads and increase conversions. Do not rush this.

Run this section only when `manifest.json` has no `screens[]` with a `benefit`, or when the user asks to redo discovery.

### Step 1: Analyze the codebase

Explore the project codebase thoroughly. Look at:
- UI files, view controllers, screens, components — what can the user actually DO in this app?
- Models and data structures — what domain does this app operate in?
- Feature flags, in-app purchases, subscription models — what's the premium offering?
- Onboarding flows — what does the app highlight first?
- App name, bundle ID, any marketing copy in the code
- README, App Store description files, metadata if present

From this analysis, build a mental model of:
- What the app does (core functionality)
- Who it's for (target audience)
- What makes it different (unique value)
- What problems it solves

Shell path:

```bash
ls; cat README.md 2>/dev/null | head -80
grep -rl "struct .*View" --include=*.swift . | grep -v -E "Tests|Preview" | head -60
grep -rn -E "ProductID|Entitlement|subscription|paywall" --include=*.swift . | head -20
ls metadata 2>/dev/null && cat metadata/app-info/en-US.json 2>/dev/null
```

### Step 2: Ask the user clarifying questions

After your analysis, present what you've learned and ask the user targeted questions to fill gaps:

- "Based on the code, this appears to be [X]. Is that right?"
- "Who is your target audience? (age, interests, skill level)"
- "What niche does this app serve?"
- "What's the #1 reason someone downloads this app?"
- "Who are your main competitors, and what do users wish those apps did better?"
- "What do your best reviews say? What do users love most?"

Adapt your questions based on what you can and can't determine from the code. Don't ask questions the code already answers.

Ask in chat, or with `AskUserQuestion` where it exists. Never answer these questions for the user.

### Step 3: ASO keyword pass (new)

Read the App Store listing before you write a single headline. The listing is the source of truth for terminology.

Sources, in order:

1. `metadata/app-info/<locale>.json`: `name`, `subtitle`.
2. `metadata/version/<latest>/<locale>.json`: `keywords`, `description`, `promotionalText` when present.
3. `metadata/app-info/<locale>.json` and the landing page (when the repo has one) for the tagline.

```bash
ls metadata/version | sort -V | tail -1
cat metadata/app-info/en-US.json
cat metadata/version/$(ls metadata/version | sort -V | tail -1)/en-US.json
```

When `metadata/` is missing, offer to pull it first. Do not guess the listing.

```bash
asc metadata pull --app "<APP_ID>" --version "<VERSION>" --dir ./metadata
```

Rules:

- At most ONE keyword per headline, and only where it reads naturally. "Time Every Lap" is good; "GPS Lap Timer Tracker" is a keyword pile.
- Listing terminology wins. If the listing says "moto", the headline says "moto", not "ride". If the listing says "workout", do not write "session".
- Screenshot text is not indexed by App Store search. The keyword pass keeps the message consistent with the listing so the searcher recognises what they searched for. It does not replace the `keywords` field.
- Offer the `asc-aso-audit` skill when the listing itself looks weak (empty subtitle, keyword waste). Fix the listing first; screenshots inherit it.

Write the chosen terms into `screenshots/plan.md` under "Keyword decisions" with one line per term: the term, the source field, the headline that carries it.

### Step 4: Draft the core benefits

Based on your analysis and the user's input, draft 3-5 core benefits. Each benefit MUST:

1. **Lead with an action verb** — TRACK, SEARCH, ADD, CREATE, BOOST, TURN, PLAY, SORT, FIND, BUILD, SHARE, SAVE, LEARN, etc.
2. **Focus on what the USER gets**, not what the app does technically
3. **Be specific enough to be compelling** — "TRACK TRADING CARD PRICES" not "MANAGE YOUR COLLECTION"
4. **Answer the user's unspoken question**: "Why should I download this instead of scrolling past?"

The examples above are in upper case because the old skill rendered every headline in caps. Write the copy in natural case ("Track Trading Card Prices"). The theme applies the case at render time (see "Casing").

Present the benefits to the user in this format:

```
Here are the core benefits I'd recommend for your screenshots:

1. [ACTION VERB] + [BENEFIT] — [why this drives downloads]
2. [ACTION VERB] + [BENEFIT] — [why this drives downloads]
3. [ACTION VERB] + [BENEFIT] — [why this drives downloads]
...
```

### Story arc

Order the benefits so the set tells a story when swiped:

| Position | Job | Example (lap-timer app) |
|---|---|---|
| 1 | The single biggest reason to download | Every Ride on the Map |
| 2-3 | The core loop: what the user does every time | Automatic Lap Timing; Replay Laps in 3D |
| 4-6 | Differentiators against the competitors named in Step 2 | Build a Track History; Set a Start Line |
| last | Platform breadth or social proof | Phone or Watch. Your Call. / "4.8 stars from 2,000 riders" |

Five to eight screens is the normal range. Apple accepts one to ten per set. Fewer strong screens beat more weak ones.

### Step 5: Collaborate and refine

DO NOT proceed until the user explicitly confirms the benefits. This is an iterative process:

- Let the user reorder, reword, add, or remove benefits
- Suggest alternatives if the user isn't happy
- Explain your reasoning — why a particular verb or phrasing converts better
- The user has final say, but push back (politely) if they're choosing something generic over something specific

This is gate G1. Never proceed on silence.

### Step 6: Save the plan

Write `screenshots/plan.md` (benefits in order, template per screen, brand colour, appearance, keyword decisions, user preferences such as "user prefers 'Track' over 'Monitor'"). Write `screens[]` into `screenshots/manifest.json` with `id`, `order`, `benefit`, `template`, `sizes`. Write `screenshots/copy/en-US.json`. Set `locales.en-US.copyStatus` to `approved`. Set status `copy-approved` only on images still at `pending`; leave `captured` and higher untouched (`copy-approved` is not a legal backward target). A changed headline shows up as a new render hash on the next `s1s render`.

```bash
s1s render --locale en-US --sizes iphone-6.9,ipad-13 --dry-run --allow-placeholder --json   # validates copy JSON shape and the screens config
```

`s1s status --set copy-approved --locale en-US` (lands in W5) will do the status write; until then edit `manifest.json` directly.

Offer an `ios:` commit of `screenshots/plan.md`, `screenshots/copy/`, `screenshots/manifest.json`.

---

## 2. Copy structure for real text

Every screen's copy has these fields. The template decides which ones it shows.

| Field | Rule |
|---|---|
| `headline` | 2-5 words. Verb first. One idea. |
| `highlight` | Exactly one word or short phrase from the headline, coloured with `theme.highlight`. Must appear in the headline verbatim (first case-insensitive match wins). |
| `subline` | 8 words or fewer. Says how, or names the payoff. No second verb-first headline. |
| `badge` | Optional. 1-2 words: "New", "Free", "Apple Watch". No keywords, no prices. |
| `callouts` | `feature-grid` (iPad) only. Up to 3 entries; each `title` 1-3 words, `body` 8 words or fewer. A fourth callout is an `overflow` error. |
| `layoutNotes` | Never rendered. Tell the translator or the next agent why the lines break where they do. |

Line breaks are part of the copy. Write them with the copy, not after the render:

- `headline: "Set a Start Line"` lets the renderer wrap. Wrapped headlines get at most 2 lines.
- `headline: ["Every Ride", "on the Map"]` fixes the break. Explicit lines are never re-wrapped, so the renderer shrinks the font until every line fits.
- Prefer explicit lines when a wrap would split a verb from its object or leave one word alone on a line.
- Sublines may take explicit lines too (`subline: string[]`).

Old-skill layout mapped to the new fields: the old "line 1 = verb, line 2 = descriptor" is `headline: ["Track", "Card Prices"]`. Use it only when the verb alone carries meaning.

### Casing

The theme owns the case: `theme.headlineCase` in `screenshots/theme.ts`.

| Value | Effect | When |
|---|---|---|
| `title` (default) | Capitalises each word except small words mid-line (a, the, of, on, in, ...). Never lowercases, so "GPS" stays "GPS". | Default. Reads fastest at thumbnail size; keeps the highlight word visible; the shortest of the three, which matters once German arrives. |
| `sentence` | Uppercases the first character only. | Apps with a quiet, editorial voice. |
| `upper` | Full uppercase in the locale. | Opt in only. This is the old high-impact look. It widens the text by 15-25 percent and takes the whole length budget in German; accented capitals in French and Spanish look heavy. |

Rules that follow:

- Write the copy in natural case. Never pre-uppercase in the JSON; the theme does it.
- Write acronyms and brand names in their real case ("GPS", "iPhone"). `title` never lowercases them.
- Pick one case for the set. Never mix cases across screens.
- Casing is locale-aware ("ß", Turkish "i") and uses the locale you render (`s1s render --locale`), not the `locale` field of the copy file. Name locales consistently in `screens.ts`, the copy file name and the render command.

### Length budgets from render warnings

The renderer fits each headline between a template's minimum and maximum point size. When the text still does not fit at the minimum, the render fails with an error-level warning. The warnings are the budget. Do not count characters; render and read `report.json`.

```bash
s1s render --locale en-US --sizes iphone-6.9 --allow-placeholder --json
jq '.items[] | select(.warnings | length > 0) | {screenId, sizeId, warnings: [.warnings[] | .code + ": " + .message]}' screenshots/out/en-US/report.json
```

| Warning | Meaning | Fix |
|---|---|---|
| `text-min-size` | Headline or subline still overflows at the minimum size | Shorten, or give explicit lines, or move the break |
| `text-clipped` | Text cut by its container | Same as above; check `layoutNotes` |
| `overflow` | Too many callouts, or a slot overflowed | Remove a callout; shorten |
| `copy-missing` | No copy for a screen id (or `copyKey`) | Add the screen to the copy file |
| `copy-unused` (info) | Copy for a screen that no longer exists | Delete the stale entry or fix the id |

`--allow-placeholder` lets you check the copy before any capture exists (missing captures become hatched panels with a warn-level note instead of an error). It does not cover `watch-s10`: a passthrough size has no placeholder, so that screen still reports `failed` ("passthrough sizes have no placeholder"). Add `--sizes iphone-6.9,ipad-13` while you work on copy without watch captures.

Keep headroom for locales. Typical expansion against en-US:

| Locale | Expansion | Consequence |
|---|---|---|
| de | +30 percent | Headlines that fit en-US at the minimum size will fail in German |
| fr, es, pt | +20 percent | Explicit line breaks usually move |
| it, nl | +15 percent | |
| ja, zh, ko | -30 percent | Wraps disappear; re-check the highlight word |

Rule: if an en-US headline needed explicit lines to fit, plan for the German headline to lose a word. Choose en-US words with a short German or French equivalent where two options exist ("Map" over "Cartography").

### Locale number, punctuation and typography rules

Ported from LegalDraftAI `specs/iOS_ADDING_A_NEW_LANGUAGE.md`, Section F (the German live pass). These recur for every language; check every one per locale.

Numbers:

- Decimal separator follows the locale. A rating "4.91" is "4,91" in de, fr, es, it, pt, nl. It looks like a plain number; translators miss it.
- Thousands separators follow the locale: "80,000+" is "80.000+" in de, "80 000+" in fr (with a narrow no-break space), "80.000+" in es. Never ship an English thousands comma in a localized headline.
- Units and symbols: put a no-break space (U+00A0) between a number and its unit or symbol in de, fr, es, it, pt ("25 km/h", "40 %", "1,2 mi"). Never let the unit wrap to its own line. Convert units when the app converts them (mph to km/h) and say so in `layoutNotes`.
- Times and dates in copy follow the locale's format (24-hour in de/fr).

Punctuation and typography:

- Use the single ellipsis character "…" attached to the word (no space, no "..."). German had both styles mixed; sweep for `...` before approval.
- Use the locale's quote marks: „…“ for de, « … » with no-break spaces for fr, “…” for en. Never straight quotes in rendered copy.
- Check compound hyphenation in brand-noun compounds ("App-Store-Bewertung", Durchkopplung) so German compounds do not split badly across a wrap.
- Apostrophes are typographic (’), not the ASCII tick.
- Long-word languages (de, fi) need a wrap-or-shorten pass. A German compound that does not fit on one line cannot be hyphenated by the renderer (`hyphens: manual`); shorten it or break the phrase elsewhere.

Terminology (Section F.4, "cross-key terminology pass, not just per-string translation"):

- One term per concept, app-wide. German drifted: "Rechtsordnung" vs "Gerichtsstand" for jurisdiction, signieren / unterschreiben / Unterschrift for "sign", Vertrag / Dokument / Entwurf for the same object. Maintain a tiny UI terminology glossary and enforce it so the new language picks one term and uses it on every screen. The screenshots use the same term the app UI and the listing use.
- Make these glossary decisions UP FRONT, before translating a single headline: (1) the paid-tier name (German uses the brand name "Pro" everywhere, never the declined adjective); (2) the main object noun (the German library-item noun is "Dokument" for all library actions, with "Vertrag" reserved for content features and "Entwurf" for revisions); (3) the upgrade-CTA pattern (benefit-first "Mit Pro …" sentences, never a calque like "Führen Sie ein Upgrade durch"); (4) the register: du or Sie. Match the app's own strings; a screenshot that says "du" above an app that says "Sie" reads as a different product.
- Write the decisions into `screenshots/copy/brief.md` (the localize playbook owns that file) and quote the app's `.xcstrings` or the existing `metadata/<locale>` wording as the source for each.

Verification per locale:

```bash
grep -n -E '\.\.\.|[0-9]\.[0-9]|[0-9],[0-9]{3}|"' screenshots/copy/de-DE.json
```

Read every hit. A `"` inside a headline value is a straight quote; a `4.9` in a comma-decimal locale is wrong; a `2,000` is an English thousands separator.

---

## 3. Copy file shape

One file per locale: `screenshots/copy/<locale>.json`. The screen keys match `screens[].id` in `screenshots/screens.ts` (or `copyKey` when set).

```json
{
  "locale": "en-US",
  "approved": true,
  "shared": {
    "appName": "MotoFit",
    "tagline": "Phone or Watch. Track Every Moto."
  },
  "screens": {
    "map": {
      "headline": ["Every Ride", "on the Map"],
      "highlight": "Map",
      "subline": "Your route, your laps, your track",
      "layoutNotes": "Break before 'on' so the verb phrase stays together. Keep 'Map' as the highlight; it carries the listing keyword 'GPS ride tracker'."
    },
    "laps": {
      "headline": "Automatic Lap Timing",
      "highlight": "Automatic",
      "subline": "Best lap highlighted, no button to press"
    },
    "replay": {
      "headline": "Replay Laps in 3D",
      "highlight": "3D",
      "subline": "Fly the line you rode",
      "badge": "New"
    },
    "history": {
      "headline": "Build a Track History",
      "highlight": "History",
      "subline": "Every moto, every track, in one list",
      "callouts": [
        { "title": "Per Track", "body": "See every session at Glen Helen" },
        { "title": "Best Laps", "body": "Personal bests stay pinned" },
        { "title": "Totals", "body": "Ride time across the season" }
      ],
      "layoutNotes": "Callouts render only on iPad via the feature-grid override in screens.ts."
    },
    "watch-stats": {
      "headline": "On Your Wrist",
      "layoutNotes": "The raw watch template renders no text. Kept for the watch-caption template."
    }
  }
}
```

Field notes:

- `headline` is a string or an array of lines. `subline` too.
- `highlight` is a substring of the headline as written in the JSON. The renderer matches case-insensitively after casing.
- `callouts` appear only on templates that declare them (`feature-grid`, iPad). Other templates ignore them; the renderer does not warn.
- `shared` holds strings several screens use. Custom templates read them; built-in templates do not.
- `approved` is a human flag. Set it true only after G1 (source locale) or G5 (other locales).
- Unknown extra fields survive a round trip and reach custom templates.

Validate the file shape before you render:

```bash
s1s render --locale en-US --dry-run --allow-placeholder --json
```

---

## 4. Capture assessment (Phase 2, per capture)

Rate captures as soon as they land in `screenshots/captures/<locale>/<family>/<id>.png`. Look at a scaled preview, never the full-size PNG:

```bash
mkdir -p screenshots/out/preview
sips -Z 900 screenshots/captures/en-US/iphone/map.png --out screenshots/out/preview/map.png
```

Read the preview with your image viewer (Claude Code: `Read` on the PNG). If you cannot view images, ask the human to rate the capture with the rubric below, and record their verdict.

### Assess each capture

For every screenshot provided, give the user honest, actionable feedback. Rate each screenshot as **Great**, **Usable**, or **Retake**. For each one, explain:

- **What it shows**: Which screen/feature is this?
- **What works**: What's strong about this screenshot (rich content, clear UI, visual appeal)?
- **What doesn't work**: Be direct about problems — is it an empty state? Is the content sparse or generic? Is key information cut off? Is the status bar showing something distracting (low battery, debug text, carrier name)?
- **Verdict**: Great / Usable / Retake

**Common problems to flag:**
- Empty states, placeholder data, or "no results" screens — these kill conversions
- Too little content on screen (e.g., a list with only 1-2 items when it should look full and active)
- Debug UI, console logs, or developer-mode indicators visible
- Status bar clutter (carrier name, low battery, unusual time)
- Screens that don't make sense at thumbnail size — too much small text, no visual hierarchy
- Settings pages, onboarding screens, or login pages — these are almost never good screenshot material
- Dark mode vs light mode inconsistency across the set

Record the verdict in `manifest.json` as `captureRating` (`great` | `usable` | `retake`) and the reasoning as `captureNotes` on the image state (`locales.<locale>.devices.<size>.screens.<id>`).

### Coach on retakes

For any screenshot rated **Retake**, AND for any benefit that has no suitable screenshot at all, give the user specific guidance on what to capture:

- Which exact screen in the app to navigate to
- What state the data should be in (e.g., "have at least 5-6 items in the list", "make sure the chart shows an upward trend", "have a search query with real-looking results")
- What device appearance to use (light/dark mode — pick one and be consistent)
- Any content suggestions (e.g., "use realistic names and prices, not 'Test Item 1'")
- Remind them to use clean status bar settings (Simulator -> Features -> Status Bar -> override to show full signal, full battery, and a clean time like 9:41)

Be opinionated. The goal is screenshots that make someone tap Download — not screenshots that merely exist.

In this workflow the agent usually takes the capture itself. Turn the coaching into a demo-data change (capture playbook) and a `capture.steps` entry on the screen, then re-capture:

```bash
s1s sim status-bar "<UDID>"
s1s capture --udid "<UDID>" --name map --device iphone --locale en-US
```

### Pair captures with benefits

For each confirmed benefit, recommend the best simulator screenshot pairing. Only pair screenshots rated **Great** or **Usable**. Consider:

- **Relevance**: Does this screenshot directly demonstrate the benefit? A "TRACK PRICES" benefit needs a screen showing prices, not settings.
- **Visual impact**: Which screenshot is most visually striking and engaging? Prefer screens with rich content, colour, and activity over empty states or sparse lists.
- **Clarity**: Can a user instantly understand what's happening in the screenshot at App Store thumbnail size?
- **Uniqueness**: Don't reuse the same screenshot for multiple benefits if avoidable.

Present the pairings to the user:

```
Here's how I'd pair your screenshots with each benefit:

1. [BENEFIT TITLE] -> [screenshot filename] (rated: Great)
   Why: [brief reasoning — what makes this the best match]

2. [BENEFIT TITLE] -> [screenshot filename] (rated: Usable)
   Why: [brief reasoning]
   Could be even better if: [optional improvement suggestion]

...
```

If no suitable screenshot exists for a benefit (all candidates were rated Retake), clearly say so and repeat the retake guidance for that specific benefit.

### Confirm pairings

Let the user review and swap pairings before proceeding. Do NOT move to rendering until pairings are confirmed (gate G2). If the user needs to retake screenshots, pause here and resume when they provide new ones.

The pairing is stored as the `capture` field on the screen in `screenshots/screens.ts` (default: the screen id). A screen that shows two captures lists both: `capture: ['laps', 'replay']` on a `two-device` template.

---

## 5. Determine Brand Colour (Automatic)

Do NOT ask the user to pick a background colour. Instead, determine the best one automatically:

1. **Analyse the codebase** — check for accent colours, tint colours, brand colours in asset catalogs, theme files, colour constants, Info.plist
2. **Study the simulator screenshots** — what are the dominant colours in the UI? What colour palette does the app use?
3. **Consider the app's domain and audience** — a game can go bold and playful, a finance app needs confident and trustworthy colours

**Pick a single colour that:**
- **Complements the screenshots** — makes the app screens pop, not clash. If the app UI is mostly white/light, use a bold saturated background for contrast.
- **Stops the scroll** — vibrant, bold, saturated. Muted or pastel colours get lost in the App Store.
- **Suits the app's personality** — match the energy of the app
- **Avoids pitfalls** — no white/light grey (disappears against App Store), avoid colours too close to the app UI's dominant colour

Present your choice with brief reasoning (e.g., "Using **#7B2D8E** (deep purple) — it complements your app's colourful UI and stands out at thumbnail size"). The user can override if they want, but don't present it as a question.

Shell path for step 1:

```bash
grep -rn -i -E "accentColor|tint|brand|primary" --include=*.swift . | grep -i color | head -20
find . -path "*.xcassets/*Color*" -name "Contents.json" | head; cat "$(find . -path '*.xcassets/AccentColor.colorset/Contents.json' | head -1)" 2>/dev/null
```

Write the colour into `screenshots/theme.ts` as `background` (sRGB hex; it also flattens any transparency). Pick `accent` and `highlight` from the app's tint. Set `text` and `textMuted` for contrast against `background` (white text on a dark or saturated background in nearly every case). Record the colour and reason in `screenshots/plan.md`.

---

## 6. Set consistency

**Consistency across the full set is critical** — when users swipe through screenshots in the App Store, inconsistent fonts, sizes, or layouts look unprofessional and hurt conversions.

Typography MUST be uniform across ALL screenshots in the set: same font, same weight, same case on every screenshot. The background MUST be consistent across ALL screenshots in the set: the same solid brand colour on every screenshot. Do NOT add glows, gradients, radial patterns, or light effects. If accent shapes are used, use the same style of accent on every screenshot so the set looks like a cohesive series when viewed side-by-side.

The renderer supports gradient and image backgrounds; treat them as an opt-in the user asks for, recorded in `plan.md`, applied to every screen of the set.

The tool enforces most of this for you: one `theme.ts` drives every screen, and a template's layout constants are shared by every screen that uses it. What you still control:

- One appearance (light or dark) for every capture in a set. Never mix.
- One template family per set. `hero-top-text` for all, or `text-bottom` for all; a single `two-device` or `feature-grid` screen for variety is fine, three is not.
- One case (`theme.headlineCase`) and one highlight colour.
- Headlines of similar length. One 2-word headline next to five 5-word headlines renders at a visibly larger size. Read the contact sheet (`screenshots/out/<locale>/sheet-<size>.png`) and equalise.
- One highlight word per screen, in the same position style (last word, or the verb) across the set.
- Same status bar (9:41, full signal, charged) on every capture: `s1s sim status-bar <udid>` before every session.
- The same set of screens, in the same order, on iPhone and iPad, minus screens that make no sense on iPad.

---

## KEY PRINCIPLES

- **Benefits over features**: "BOOST ENGAGEMENT" not "ADD SUBTITLES TO VIDEOS"
- **Specific over generic**: "TRACK TRADING CARD PRICES" not "MANAGE YOUR STUFF"
- **Action-oriented**: Every headline starts with a strong verb
- **User-centric**: Frame everything from the downloader's perspective
- **Conversion-focused**: Every decision should answer "will this make someone tap Download?"
- The first screenshot is the most important — it must communicate the single biggest reason to download
- Screenshots should tell a story when swiped through — each one reveals a new compelling reason
- Always pair the most visually impactful simulator screenshot with the most important benefit
- Never use an empty state, loading screen, or settings page as a screenshot — show the app at its best
