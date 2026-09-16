# theCut — UI redesign

**Date:** 2026-09-16
**Status:** approved, not yet implemented
**Source of truth:** `design/Daily Tracker Redesign.dc.html` (Claude Design canvas export, 4 artboards)

---

## 1. Goal

Rebuild the app's interface from the canvas: four screens (Today, Meals, Progress, Settings),
a new token system and typeface, and the interactions the canvas draws that the app does not
yet have. The data model does not change.

`design/` holds the export. The `.dc.html` opens in a browser via its sibling `support.js`.
`design/uploads/draw-*.png` are the three redline sketches that produced the final Today
artboard, in order: the date header dropped, `Training day` became a `Workout done` toggle,
and the toggle resolved into the Workout tile in the stats row.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Build everything in the canvas, including new behaviour | A half-applied design is worse than either end of it |
| D2 | Dark mode follows the system only; the canvas's Appearance switch is dropped | Overriding `uiMode` desyncs the widget's over-target colour (`CLAUDE.md`, Widget). Not worth native work for a preference nobody changes |
| D3 | The FAB opens the camera | Matches the widget's camera button; makes the fastest path one tap. Typing lives on Meals |
| D4 | Split `www/` into four files | The redesign roughly doubles the CSS; one 1,800-line file is not editable reliably |
| D5 | Quick-add = 4 most-logged meals over 30 days | Falls back to most-recent-distinct when history is thin |
| D6 | Finish-day toggle deleted; days finish automatically | See §12 |

## 3. File structure

No bundler. Capacitor copies `www/` wholesale, so these are plain files.

| File | Role |
|---|---|
| `www/index.html` | markup shell — four pages, bottom nav, sheet host |
| `www/styles.css` | token block, then components |
| `www/app.js` | DOM wiring, event handlers, render |
| `www/tracker-core.js` | pure logic — unchanged role, extended per §13 |
| `www/fonts/` | IBM Plex Sans woff2, two weights |

`tracker-core.js` keeps its contract: everything pure lives there and is tested; `app.js` owns
the DOM and nothing else. `index.html` gains `<link rel="stylesheet" href="styles.css">` and
`<script src="app.js">` after `tracker-core.js`.

## 4. Tokens

Light values are taken from the canvas. Dark is **derived**, not inverted — the canvas is
light-only. Every colour belongs in this block; nothing else in the stylesheet learns which
theme is running. `color-scheme: light dark` on `:root` stays — without it the native date
picker and number spinners render as white boxes on a dark card.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#ffffff` | `#0a0c0f` | page ground |
| `--surface` | `#ffffff` | `#14171b` | cards, screens |
| `--surface-2` | `#f9fafb` | `#1a1e23` | tiles, inputs |
| `--border` | `#e5e7eb` | `#2c3138` | card and list borders |
| `--border-faint` | `#f3f4f6` | `#23272e` | row dividers, bar tracks |
| `--text` | `#111827` | `#e9e9ec` | primary |
| `--muted` | `#6b7280` | `#a2a8b0` | labels, secondary |
| `--dim` | `#9ca3af` | `#7b8087` | hints, inactive nav |
| `--accent` | `#f97316` | `#fb923c` | calories, FAB, active nav, links |
| `--accent-tint` | `#fff7ed` | `#2a1c0e` | quick-add +, editing card |
| `--accent-tint-fg` | `#c2410c` | `#fbbf77` | text on tint |
| `--ok` | `#10b981` | `#16c88a` | under target, finished dots |
| `--over` | `#ef4444` | `#f87171` | over target, swipe delete |
| `--ink-fill` | `#111827` | `#e9e9ec` | selected day pill, protein bar, Save |
| `--ink-fill-fg` | `#ffffff` | `#0a0c0f` | text on `--ink-fill` |
| `--hero-bg` | `#111827` | `#1a1e23` | Progress hero card |
| `--hero-fg` | `#ffffff` | `#e9e9ec` | text on hero |
| `--hero-muted` | `#9ca3af` | `#8a9099` | secondary text on hero |
| `--danger-text` | `#b91c1c` | `#f87171` | Erase all data |
| `--danger-border` | `#fecaca` | `#5a2222` | its border |
| `--ok-bg` / `--ok-text` | `#f0fdf4` / `#166534` | `#0f2a1b` / `#6ee7a8` | backup status strip |

Cards in this design are defined by a **border, not a fill** — white on white with
`1px solid var(--border)`. So `--bg` is the artboard white, not the `#eef0f3` seen around the
artboards, which is the canvas backdrop and belongs to no screen. In dark the two separate:
`--bg` sits below `--surface`.

`--ink-fill` inverts in dark rather than staying dark: `#111827` on a `#14171b` surface is
invisible. The Progress hero is the exception — it becomes an *elevated* surface instead of an
inverted one, because a near-black card on a near-black page has no edge.

**Scale.** Card radius 20, list 16, tile 14, input 10–14, pill 999. Content padding
`56px 20px 110px`. Bottom nav 84px with `padding: 12px 8px 24px` and `backdrop-filter: blur(12px)`.
FAB 56px at `right: 20px; bottom: 96px`. Bars: calories 10px, protein 6px, hero 8px.

**Type.** Calorie figure 40/700/`-.03em`; screen title 28/700/`-.02em`; protein 24/700; tile
figure 20/700; body 14; secondary 13; small 12; tiny 11. Eyebrow labels 12/600/`.08em` uppercase,
section labels 12/600/`.06em` uppercase. `font-feature-settings: 'tnum'` globally so figures
don't jitter as they change.

## 5. Typeface

IBM Plex Sans, **bundled** — the canvas loads it from `fonts.googleapis.com`, which would be a
network fetch on every cold start in an otherwise offline app. Ship woff2 for 400, 600 and 700 in `www/fonts/`, declared
with local `@font-face` and `font-display: swap`, over a `system-ui, sans-serif` fallback stack.
Adds roughly 90 KB to the APK.

## 6. Navigation

The top `.tabs` row and `<h1>theCut</h1>` are both removed — every artboard labels itself in its
own header. Bottom nav, four items, active item in `--accent`. `selectTab` gains `'meals'`.
The `storageMode` line becomes a thin banner rather than a subtitle under a title that no longer
exists.

## 7. Today

**Day strip.** Seven days, each a weekday abbreviation, date, and a status dot: `--ok` finished,
`--accent` today or in progress, `--border` no data. The selected day is an `--ink-fill` pill.
It scrolls horizontally past seven. It replaces Prev / date input / Next.

Because the strip is relative, it cannot be the only way to reach an arbitrary date — tapping
the **Meals** screen's date title opens a date picker (§8).

**Hero card.** Calories at 40px with `N left` and a 10px `--accent` bar; protein at 24px with a
6px `--ink-fill` bar; then three tiles:

- **Workout** — replaces the two-button Training/Rest toggle. `--accent` with `✓` and "Done"
  when `dayType === 'training'`; `--surface-2` with `—` and "Tap if done" when rest. Tapping
  flips `day.dayType`, which moves the calorie target by `trainingBump`.
- **Steps** — the figure and `+N cal to target` from `stepBonus()`. Tapping reveals the manual
  override that `day.stepsManual` already supports.
- **Weight** — the figure, kg, and the delta against the previous logged weight. Tapping reveals
  the input.

**Meals preview.** Quick-add chips (§8), the last three meals, and `See all` → Meals tab.

**FAB** opens the camera for a photo estimate, which prefills the Meals composer (D3).

The Finish-day row is gone (§12).

## 8. Meals

**Header.** Eyebrow, date title, day totals right-aligned. The date title opens a date picker —
this is the app's only arbitrary-date navigation.

**Quick add.** Four tiles in a 2×2 grid, each showing name, `cal · Ng`, and a `+` in
`--accent-tint`. Source is `quickAdds()` (§13): the four most-logged meals over the last 30 days,
matched on normalised name, each showing that name's most recent calorie and protein figures.
Under ~4 distinct names it falls back to most-recent-distinct. Tapping adds the meal to the
selected day immediately.

**Logged today.** One row per meal: name, `meal · time`, calories, protein. Swiping left reveals
a `--over` Delete panel. Tapping opens the inline edit card from the canvas — `--accent-tint`
background, name input, cal and g inputs, Cancel / Save. A caption reads
"Swipe left to delete · tap to edit".

**Composer** docks above the nav: name, cal, g, and an `--accent` submit button.

## 9. Progress

**Hero** (`--hero-bg`): estimated fat lost against the goal at 40px, projected days remaining,
an 8px `--accent` bar, and the existing sentence about counted days and average deficit.

**Three stat tiles:** days counted, average deficit, average protein. All already computed.

**Weight card.** A 7d / 30d / All segmented control, an SVG polyline of logged weights with a
dashed least-squares trend line, three horizontal gridlines, a dot on the latest point, and
first/last date labels. Y-axis autoscales to the range in view with padding. Caption: daily
swings are water; the trend is what matters.

**Recent days.** Date, calories against target, and a signed delta coloured `--ok` under or
`--over` over. Today carries an `In progress` chip and a `—` delta.

Backup and restore **leave this screen** for the Settings sheet, per the canvas.

## 10. Settings

The canvas shows four summary rows where the app has eleven inputs, so **each row expands in
place** to reveal its controls. Nothing is lost.

| Row | Summary shown | Expands to |
|---|---|---|
| Training day | `2,750 cal · 190g` | — |
| Rest day | `2,550 cal · 190g` | — |
| Maintenance | `2,950 cal` | weight source switch, weight, maint per-kg, maint override, protein per-kg, protein override, rest deficit, training bump |
| Step adjustment | `+45 cal / 1,000 above 2,500` | step baseline, cal per 1,000, auto-steps switch and its hint |
| Fat loss goal | `3.0 kg` | goal input |
| Photo estimates | set / not set | API key field |
| Backup & restore | `›` | sheet (§11) |
| Move a day | `›` | sheet (§11) |

Training day and Rest day are derived displays of the Maintenance group, not separate inputs.
**Photo estimates** is not in the canvas — the API key needs a home and this is it. The key stays
out of the backup blob (`exportable()`) and out of logs.

The Appearance row is dropped (D2).

## 11. Bottom sheet

One component: backdrop at `rgba(17,24,39,.45)`, panel with `28px 28px 0 0` radius, a grab
handle, a title row with a round close button. Used twice — Backup & restore and Move a day —
which is what justifies it being a component rather than two blocks of markup.

**Backup & restore** holds the status strip (`--ok-bg`), Copy my data / Restore data, the paste
textarea, and Erase all data in `--danger-text`. **Move a day** holds the date picker and the
move action, moving everything on the selected day to the chosen date.

## 12. Automatic day finishing

The rule already exists at `www/index.html:678`, inside `backfillDoneFlags()`, as a one-time
migration for days logged before the flag did:

```js
d.done = (k < t) && d.meals && d.meals.length > 0;
```

This promotes it to standing behaviour and deletes the manual control.

**Removed:** `.done-row`, `#doneToggle`, `#doneHint`, the change handler at `www/index.html:968`,
and `backfillDoneFlags()` itself, folded into its replacement.

**`finalizeDays()`** runs on launch and on resume — the two moments `stepTally` already reads the
sensor, so there is still no background service and no battery cost of its own. For every cached
day strictly before today, holding at least one meal, with `done !== true`: set `done = true` and
write `day.maintenance` / `day.proteinTarget`.

- **A day with no meals is never finished.** It is skipped, not scored as a full-maintenance
  deficit. Without this a weekend away would invent most of a kilo of fat loss.
- **Today never finishes**, so it keeps floating with current settings and editing a goal still
  previews its effect — behaviour `CLAUDE.md` calls deliberate.
- **No unfinish path is needed.** The snapshot freezes *targets*, not intake, so editing a meal
  on a finished day still recomputes that day's deficit correctly. That is what made the toggle
  removable rather than merely hidden.
- **Midnight with the app open** is handled by the resume pass; a day only finalises once it is
  strictly in the past.

### Snapshot correctness

`backfillDoneFlags` snapshots with `snapshotFor(settings, latestWeight())` — *today's* weight.
Acceptable for a one-time migration, wrong as standing behaviour: four days away and all four
freeze against this morning's weigh-in. `finalizeDays()` instead snapshots each day against
`weightAsOf(days, date)` — the latest weight logged on or before that day, falling back to the
settings weight. This makes automatic finishing strictly more accurate than the manual toggle,
which snapshotted whenever the user happened to tap it.

### Migration

First launch after this ships finishes every past day the user never toggled. `days counted`,
average deficit and fat-lost all move once. Expected; not a bug.

## 13. New pure functions

All in `tracker-core.js`, all with assertions in `test/tracker-core.test.mjs` (plain `node`,
no framework, non-zero exit on failure).

| Function | Returns | Notes |
|---|---|---|
| `quickAdds(days, n)` | `[{name, cal, protein}]` | most-logged over 30 days, normalised name, latest figures; falls back to most-recent-distinct |
| `weightSeries(days, range)` | `{points, trend, min, max}` | `range` ∈ `7d` / `30d` / `all`; trend is least-squares |
| `dayStrip(days, date)` | 7 × `{date, label, dayNum, status}` | `status` ∈ `finished` / `today` / `empty` |
| `weightAsOf(days, date)` | number | latest weight ≤ date, else settings weight |
| `shouldFinalize(day, dateStr, todayStr)` | boolean | strictly past, ≥ 1 meal, not already done |

`finalizeDays()` itself lives in `app.js` because it writes to the cache; the rule it applies is
`shouldFinalize()`, which is pure and tested directly.

## 14. Invariants

These are the things a redesign could break silently.

1. **`daily-tracker-data` and the backup blob stay byte-compatible.** An export from the
   original Daily Tracker page must still restore. This is why the app exists.
2. **The maintenance snapshot rule holds.** The existing assertions pin it; if a change makes
   them fail, the change is wrong, not the test.
3. **`syncWidget()` stays hung off `save()`**, so every mutation routes through one writer and
   the widget cannot drift. The widget itself is untouched by this work.
4. **`CapacitorHttp: true` stays enabled** — it is what lets the WebView reach
   `api.anthropic.com` without CORS. A CORS error means checking this flag, not adding a proxy.
5. **The API key stays out of `exportable()`** and out of logs.
6. **No colour is written inline.** New colours go in the token block or they will not survive
   dark mode.

## 15. Out of scope

Carbs (the app tracks none; adding them means the meal model, the AI schema, Settings and the
widget together). Widget changes. Health Connect or any fix to the step-attribution ceiling.
A signed release build.

## 16. Risks and verification

- **No device or emulator is available to the agent.** Verify as before: `npm test`, then
  `npx cap sync android`, then `./gradlew assembleDebug`, then confirm the change is actually in
  the APK — `unzip -p android/app/build/outputs/apk/debug/app-debug.apk assets/public/index.html`.
  With the file split, also check `styles.css` and `app.js` are in `assets/public/`.
- **Swipe-to-delete is the fiddliest part.** Pointer events with a `translateX` transform, ~60px
  threshold, and it must only engage once `|dx| > |dy|` or it will fight vertical scrolling.
- **The settings expand-in-place rows** are where inputs are most likely to be dropped. Check all
  eleven survive against §10 before calling it done.
- The font adds ~90 KB.
