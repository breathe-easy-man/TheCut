# theCut UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild theCut's interface from the approved Claude Design canvas — four screens (Today, Meals, Progress, Settings), a new token system and bundled typeface, and the interactions the canvas draws that the app does not yet have — without changing the data model.

**Architecture:** `www/index.html` (1,195 lines today) splits into `index.html` / `styles.css` / `app.js` / `tracker-core.js` + `www/fonts/`. All new pure logic lands in `tracker-core.js` with assertions in `test/tracker-core.test.mjs`; `app.js` owns the DOM and nothing else. No bundler — Capacitor copies `www/` wholesale, so these are plain files loaded by `<script src>` and `<link rel=stylesheet>`. Existing element ids are preserved wherever the element survives the redesign, so the render functions change shape rather than being rewritten.

**Tech Stack:** Capacitor 6 (Android), plain ES5-style browser JS (no build step, no framework), CSS custom properties, `node --test`-free plain assertions via `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-16-thecut-ui-redesign-design.md` — read it in full before Task 1. It is the argument behind every task here; this plan is only the sequencing.

**Canvas:** `design/Daily Tracker Redesign.dc.html` — the visual source of truth, four artboards. Inline styles on the artboards ARE the spec for spacing and weight. Open it in a browser via its sibling `support.js`, or read the markup directly. `design/screenshots/meals.jpg` shows Today and Meals as rendered.

---

## Global Constraints

Every task's requirements implicitly include this section. These are the six invariants from spec §14 plus the project rules from `CLAUDE.md`.

- **`daily-tracker-data` and the backup blob stay byte-compatible.** An export from the original standalone Daily Tracker page must still restore into this app. The localStorage key is `daily-tracker-data` (`KEY`, `www/index.html:483`) and the blob shape is `{ logs: cache, settings }`.
- **The maintenance snapshot rule holds.** A finished day keeps `day.maintenance` and `day.proteinTarget`. The assertions in `test/tracker-core.test.mjs` pin this — if a change makes them fail, the change is wrong, not the test.
- **`syncWidget()` stays hung off `save()`** (`www/index.html:591`), so every mutation routes through one writer and the widget cannot drift. The widget is out of scope for this work — no file under `android/` is touched by any task in this plan.
- **`CapacitorHttp: true` stays enabled** in `capacitor.config.json`. It is what lets the WebView reach `api.anthropic.com` without CORS. A CORS error means checking this flag, never adding a proxy.
- **The API key stays out of `exportable()`** (`www/index.html:583`) and out of logs.
- **No colour is written inline.** Every colour goes in the `:root` token block or it will not survive dark mode.
- **`color-scheme: light dark` on `:root` is load-bearing** — without it the native date picker and number spinners render as white boxes on a dark card.
- **Dark mode is system-only.** The canvas's Appearance switch is deliberately dropped (spec D2): overriding `uiMode` desyncs the widget's over-target colour, which would force native work.
- **No `rm` or `mv`.** If a file needs deleting or moving, prepare the exact command and hand it to the user to run. This overrides any habit of tidying up.
- **Commits are autonomous; pushes are not.** Never `git push` without asking the user, every time.
- **No device.** No agent may claim a UI behaviour works. Verification is `npm test`, a clean `assembleDebug`, and proof the change reached the APK.

### The build check

Every task ends with this, run from the repo root. It is the only verification available without hardware.

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep -E 'assets/public/(index.html|styles.css|app.js|tracker-core.js|fonts/)'
```

Forgetting `npx cap sync android` silently ships the previous `www/`. The `unzip -l` line is what proves it did not.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `www/index.html` | markup shell only — four pages, bottom nav, sheet host, FAB. No `<style>`, no inline `<script>`. | split out of the current 1,195-line file |
| `www/styles.css` | the token block, then components in the order the screens use them | new |
| `www/app.js` | DOM wiring, event handlers, render functions, Capacitor glue | new (the current inline IIFE, `www/index.html:480-1193`) |
| `www/tracker-core.js` | pure logic — extended with the five functions in §13, nothing DOM-aware | modified |
| `www/fonts/ibm-plex-sans-{400,600,700}.woff2` | bundled typeface, no network fetch on cold start | new, fetched by the user (Task 2) |
| `test/tracker-core.test.mjs` | assertions for every pure function | extended |

`index.html` loads, in this order: `capacitor.js`, `tracker-core.js`, `app.js`, with `styles.css` in `<head>`. `app.js` must stay inside an IIFE — it relies on module-scope state (`cache`, `settings`, `currentDate`, `currentTab`, `stepState`) that must not become global.

---

## Task Order and Parallelism

Task 1 and Task 2 are independent of each other and can run at the same time. Tasks 3–6 all depend on Task 2 (the file split must exist before screens are rebuilt) and must be serialised against each other only because they share `www/app.js`, `www/index.html` and `www/styles.css` — run them one at a time. Task 7 depends on Task 1 (for `shouldFinalize` / `weightAsOf`) and Task 3 (which deletes the Finish-day row's markup).

```
Task 1 (tracker-core) ─────────────────────────┐
Task 2 (split + tokens + font) ── 3 ── 4 ── 5 ── 6 ── 7
```

---

### Task 1: New pure functions in `tracker-core.js`

**Files:**
- Modify: `www/tracker-core.js` (add before the `root.TrackerCore = {...}` export block at the end)
- Test: `test/tracker-core.test.mjs` (append)

**Interfaces:**
- Consumes: the existing internal helpers `num(v, fallback)` and `round1(n)` in the same file.
- Produces, all exported on `TrackerCore`:
  - `quickAdds(days, n, todayStr)` → `[{name: string, cal: number, protein: number}]`
  - `weightSeries(days, range, todayStr)` → `{points: [{date, kg}], trend: {from, to}|null, min: number, max: number}`
  - `dayStrip(days, date, todayStr)` → 7 × `{date, label, dayNum, status}` where `status` ∈ `'finished'|'today'|'empty'`
  - `weightAsOf(days, date)` → `number` (0 when nothing is logged on or before `date`)
  - `shouldFinalize(day, dateStr, todayStr)` → `boolean`

**Two deviations from spec §13, both deliberate — do not "fix" them back:**

1. **`todayStr` is a parameter, not read from the clock.** Spec §13 writes `quickAdds(days, n)`, `weightSeries(days, range)` and `dayStrip(days, date)`. A function that calls `new Date()` is not pure and its tests rot at midnight. Every function here that needs "today" takes it as an argument, matching `shouldFinalize(day, dateStr, todayStr)`, which the spec already writes that way. `app.js` passes its existing `todayStr()`.
2. **`weightAsOf(days, date)` returns 0 rather than the settings weight when nothing is logged.** Spec §12 says it falls back to the settings weight — that fallback already exists inside `bodyweight()`, which every consumer reaches through `snapshotFor(settings, weight)`. Returning 0 lets `bodyweight()` apply `settings.bodyweight` exactly as `latestWeight()` (`www/index.html:570`) does today. Adding a `settings` parameter would duplicate that rule in two places.

- [ ] **Step 1: Write the failing tests**

Append to `test/tracker-core.test.mjs`:

```js
/* ---- quick add ---- */

const meal = (name, cal, protein) => ({ name, cal, protein });
const D = (n) => '2026-09-' + String(n).padStart(2, '0');

const qaDays = {
  [D(10)]: { meals: [meal('Oats', 400, 20), meal('Chicken rice', 700, 55)] },
  [D(11)]: { meals: [meal('oats  ', 420, 21)] },
  [D(12)]: { meals: [meal('Oats', 410, 22), meal('Chicken Rice', 720, 56), meal('Shake', 200, 40)] }
};

const qa = C.quickAdds(qaDays, 4, D(12));
assert.equal(qa[0].name, 'Oats', 'the most-logged name comes first');
assert.equal(qa[0].cal, 410, 'and carries its most recent figures, not its first');
assert.equal(qa[0].protein, 22);
assert.equal(qa[1].name, 'Chicken Rice', 'case and trailing space do not split a name');
assert.equal(qa.length, 3, 'three distinct names logged, three chips');
assert.equal(C.quickAdds(qaDays, 2, D(12)).length, 2, 'n caps the list');
assert.deepEqual(C.quickAdds({}, 4, D(12)), [], 'no history, no chips');

/* Outside the 30-day window a name stops counting, but thin history still fills the list. */
const qaOld = {
  '2026-01-05': { meals: [meal('Old soup', 300, 10)] },
  [D(12)]: { meals: [meal('Shake', 200, 40)] }
};
const qaFallback = C.quickAdds(qaOld, 4, D(12));
assert.equal(qaFallback[0].name, 'Shake', 'the recent name ranks first');
assert.equal(qaFallback[1].name, 'Old soup', 'and an older one fills the gap rather than leaving it empty');

/* A future day must never be counted. */
assert.equal(C.quickAdds({ [D(20)]: { meals: [meal('Tomorrow', 1, 1)] } }, 4, D(12)).length, 0);

/* ---- weight series ---- */

const wDays = {
  [D(5)]:  { weight: 100.4 },
  [D(6)]:  { weight: 100 },
  [D(8)]:  { weight: 99.4 },
  [D(10)]: { weight: 99 },
  [D(12)]: { weight: 98.6 },
  [D(11)]: { meals: [] }
};

const wAll = C.weightSeries(wDays, 'all', D(12));
assert.equal(wAll.points.length, 5, 'only days with a weight become points');
assert.deepEqual(wAll.points[0], { date: D(5), kg: 100.4 }, 'points run oldest first');
assert.equal(wAll.min, 98.6);
assert.equal(wAll.max, 100.4);
assert.ok(wAll.trend.from > wAll.trend.to, 'the trend falls over a cut');

/* The 7d window is the last seven days INCLUSIVE — Sep 6 to Sep 12 — so Sep 5 drops off
   and Sep 6 does not. Off-by-one here would silently widen every window by a day. */
const w7 = C.weightSeries(wDays, '7d', D(12));
assert.equal(w7.points.length, 4, 'the seventh day back is still in the window');
assert.equal(w7.points[0].date, D(6), 'the eighth is not');

assert.deepEqual(C.weightSeries({}, 'all', D(12)),
                 { points: [], trend: null, min: 0, max: 0 }, 'an empty chart must not be NaN');
assert.equal(C.weightSeries({ [D(12)]: { weight: 99 } }, 'all', D(12)).trend, null,
             'one point is not a trend');

/* A flat run has a trend, and it is flat — not a divide-by-zero. */
const flat = C.weightSeries({ [D(10)]: { weight: 99 }, [D(12)]: { weight: 99 } }, 'all', D(12));
assert.equal(flat.trend.from, 99);
assert.equal(flat.trend.to, 99);

/* ---- day strip ---- */

const strip = C.dayStrip({ [D(10)]: { done: true }, [D(12)]: { meals: [meal('x', 1, 1)] } }, D(12), D(12));
assert.equal(strip.length, 7, 'seven days');
assert.equal(strip[6].date, D(12), 'the selected day is last');
assert.equal(strip[0].date, D(6), 'the window is the six days before it');
assert.equal(strip[6].status, 'today');
assert.equal(strip[4].status, 'finished', 'a finished day shows finished');
assert.equal(strip[5].status, 'empty', 'a day with nothing on it shows empty');
assert.equal(strip[6].label, 'Sat');
assert.equal(strip[6].dayNum, 12);

/* Selecting an older day re-anchors the strip, and today is then off it. */
const past = C.dayStrip({ [D(10)]: { done: true } }, D(10), D(12));
assert.equal(past[6].date, D(10));
assert.equal(past[6].status, 'finished', 'the selected past day is not mislabelled today');

/* ---- weight as of a date ---- */

assert.equal(C.weightAsOf(wDays, D(12)), 98.6, 'the latest weight on or before the date');
assert.equal(C.weightAsOf(wDays, D(9)), 99.4, 'not a later one');
assert.equal(C.weightAsOf(wDays, D(1)), 0, 'nothing logged yet falls through to the settings weight');
assert.equal(C.maintenanceCal(S, C.weightAsOf(wDays, D(1))), 2950,
             'and bodyweight() supplies that fallback, as it does for latestWeight()');

/* ---- should finalize ---- */

const withMeal = { meals: [meal('x', 500, 30)] };
assert.equal(C.shouldFinalize(withMeal, D(11), D(12)), true, 'a past day with a meal finishes');
assert.equal(C.shouldFinalize(withMeal, D(12), D(12)), false, 'today never finishes');
assert.equal(C.shouldFinalize(withMeal, D(13), D(12)), false, 'nor does a future day');
assert.equal(C.shouldFinalize({ meals: [], weight: 99 }, D(11), D(12)), false,
             'a day with no meals is skipped, not scored as a full-maintenance deficit');
assert.equal(C.shouldFinalize({ ...withMeal, done: true }, D(11), D(12)), false, 'already finished');
assert.equal(C.shouldFinalize(null, D(11), D(12)), false);

console.log('redesign core: all assertions passed');
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/kevins/projects/personal/theCut && npm test
```

Expected: FAIL — `TypeError: C.quickAdds is not a function`.

- [ ] **Step 3: Implement the functions**

Insert into `www/tracker-core.js`, immediately before the `root.TrackerCore = {` export block:

```js
  /* ---- dates (UTC so a DST boundary cannot shift a day) ---- */

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function addDays(dateStr, delta) {
    var p = String(dateStr).split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  function dayDiff(a, b) {
    return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
  }

  function normName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /* The four most-logged meal names over the last 30 days, each carrying its most recent
     figures. Ties break towards the more recent name, which is also what makes the thin-history
     case work: with one log each, "most logged" degrades into "most recent" for free. If the
     window still cannot fill n, older history is walked backwards to top it up — a new user
     should not meet four empty tiles. */
  function quickAdds(days, n, todayStr) {
    var want = num(n, 4), cutoff = todayStr ? addDays(todayStr, -29) : null;
    var byName = {}, order = [], dates = Object.keys(days || {}).sort(), i, j;

    for (i = 0; i < dates.length; i++) {
      if (cutoff && dates[i] < cutoff) continue;
      if (todayStr && dates[i] > todayStr) continue;
      var meals = (days[dates[i]] && days[dates[i]].meals) || [];
      for (j = 0; j < meals.length; j++) {
        var key = normName(meals[j].name);
        if (!key) continue;
        if (!byName[key]) { byName[key] = { count: 0 }; order.push(key); }
        var e = byName[key];
        e.count++;
        /* oldest-first iteration means the last write wins: the most recent spelling and figures */
        e.name = String(meals[j].name).trim();
        e.cal = Math.round(num(meals[j].cal, 0));
        e.protein = round1(num(meals[j].protein, 0));
        e.seen = dates[i];
      }
    }

    var list = [];
    for (i = 0; i < order.length; i++) list.push(byName[order[i]]);
    list.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.seen < b.seen ? 1 : (a.seen > b.seen ? -1 : 0);
    });

    var out = [], have = {};
    for (i = 0; i < list.length && out.length < want; i++) {
      have[normName(list[i].name)] = 1;
      out.push({ name: list[i].name, cal: list[i].cal, protein: list[i].protein });
    }

    /* thin history: reach back past the window, most recent first */
    for (i = dates.length - 1; i >= 0 && out.length < want; i--) {
      if (todayStr && dates[i] > todayStr) continue;
      var old = (days[dates[i]] && days[dates[i]].meals) || [];
      for (j = old.length - 1; j >= 0 && out.length < want; j--) {
        var k = normName(old[j].name);
        if (!k || have[k]) continue;
        have[k] = 1;
        out.push({
          name: String(old[j].name).trim(),
          cal: Math.round(num(old[j].cal, 0)),
          protein: round1(num(old[j].protein, 0))
        });
      }
    }
    return out;
  }

  /* Logged weights in the window, plus a least-squares trend line given as its two endpoints.
     x is the day offset from the first point, not the array index, so a gap in logging tilts
     the line the way it actually happened. */
  function weightSeries(days, range, todayStr) {
    var cutoff = null;
    if (range === '7d') cutoff = addDays(todayStr, -6);
    else if (range === '30d') cutoff = addDays(todayStr, -29);

    var dates = Object.keys(days || {}).sort(), pts = [], i;
    for (i = 0; i < dates.length; i++) {
      var w = num(days[dates[i]] && days[dates[i]].weight, 0);
      if (!(w > 0)) continue;
      if (cutoff && dates[i] < cutoff) continue;
      if (todayStr && dates[i] > todayStr) continue;
      pts.push({ date: dates[i], kg: w });
    }

    var min = 0, max = 0, trend = null;
    if (pts.length) {
      min = max = pts[0].kg;
      for (i = 1; i < pts.length; i++) {
        if (pts[i].kg < min) min = pts[i].kg;
        if (pts[i].kg > max) max = pts[i].kg;
      }
    }

    if (pts.length >= 2) {
      var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0, x;
      for (i = 0; i < n; i++) {
        x = dayDiff(pts[0].date, pts[i].date);
        sx += x; sy += pts[i].kg; sxx += x * x; sxy += x * pts[i].kg;
      }
      var den = n * sxx - sx * sx;
      if (den !== 0) {
        var slope = (n * sxy - sx * sy) / den;
        var intercept = (sy - slope * sx) / n;
        var span = dayDiff(pts[0].date, pts[n - 1].date);
        trend = { from: round1(intercept), to: round1(intercept + slope * span) };
      }
    }

    return { points: pts, trend: trend, min: min, max: max };
  }

  /* Seven days ending on the selected one, so picking an older date re-anchors the strip
     instead of scrolling away from the selection. */
  function dayStrip(days, date, todayStr) {
    var out = [], start = addDays(date, -6), i;
    for (i = 0; i < 7; i++) {
      var d = addDays(start, i);
      var day = (days || {})[d];
      var dt = new Date(d + 'T00:00:00Z');
      var status = 'empty';
      if (d === todayStr) status = 'today';
      else if (day && day.done) status = 'finished';
      out.push({ date: d, label: WEEKDAYS[dt.getUTCDay()], dayNum: dt.getUTCDate(), status: status });
    }
    return out;
  }

  /* The weight a past day should be judged against. 0 means none was logged by then, which
     bodyweight() turns into the settings weight — the same fallback latestWeight() relies on. */
  function weightAsOf(days, date) {
    var dates = Object.keys(days || {}).sort(), best = 0, i;
    for (i = 0; i < dates.length; i++) {
      if (dates[i] > date) break;
      var w = num(days[dates[i]].weight, 0);
      if (w > 0) best = w;
    }
    return best;
  }

  /* A day finishes once it is strictly past and has at least one meal. A day with no meals is
     never finished: scoring it would invent a full day of deficit for a weekend away. */
  function shouldFinalize(day, dateStr, todayStr) {
    if (!day || day.done === true) return false;
    if (!(String(dateStr) < String(todayStr))) return false;
    return !!(day.meals && day.meals.length);
  }
```

Then add to the `root.TrackerCore = {` block, after `parseMealResponse: parseMealResponse`:

```js
    quickAdds: quickAdds,
    weightSeries: weightSeries,
    dayStrip: dayStrip,
    weightAsOf: weightAsOf,
    shouldFinalize: shouldFinalize
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/kevins/projects/personal/theCut && npm test
```

Expected: PASS, ending with `redesign core: all assertions passed`. The pre-existing suites must still print their own lines — if the maintenance-snapshot assertions fail, the change is wrong, not the test.

- [ ] **Step 5: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/tracker-core.js test/tracker-core.test.mjs
git commit -m "Add the pure functions the redesign needs"
```

---

### Task 2: Split `www/`, install the tokens and the bundled typeface

No behaviour changes. This task is mechanical on purpose: the screens are rebuilt against a file layout that already works, so a break here is obviously a split error rather than a design error.

**Files:**
- Modify: `www/index.html` — strip `<style>` (lines 8-245) and the inline `<script>` (lines 480-1193); add the stylesheet link and `<script src="app.js">`
- Create: `www/styles.css`
- Create: `www/app.js`
- Create: `www/fonts/ibm-plex-sans-{400,600,700}.woff2` (fetched by the user, see Step 1)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `www/styles.css` with the complete token block from spec §4 under `:root` and `@media (prefers-color-scheme: dark)`; `www/app.js` exporting nothing (IIFE), with every function from the current inline script intact and unrenamed.

- [ ] **Step 1: Fetch the typeface**

The sandbox denies this download. Ask the user to run it, then confirm the three files exist before continuing:

```bash
cd ~/projects/personal/theCut && mkdir -p www/fonts && for w in 400 600 700; do curl -sSfo "www/fonts/ibm-plex-sans-$w.woff2" "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.1.0/files/ibm-plex-sans-latin-$w-normal.woff2"; done && ls -la www/fonts
```

Expected: three files, roughly 25–35 KB each. If the user prefers a different source, any latin-subset IBM Plex Sans woff2 at weights 400/600/700 works — the filenames above are what `styles.css` references.

- [ ] **Step 2: Move the stylesheet out**

Copy the entire contents of `www/index.html` lines 9-244 (everything between `<style>` and `</style>`) into a new `www/styles.css`, unchanged. Then in `www/index.html`, replace lines 8-245 with:

```html
  <link rel="stylesheet" href="styles.css">
```

- [ ] **Step 3: Move the script out**

Copy `www/index.html` lines 481-1192 — the IIFE body, *without* the surrounding `<script>` tags — into a new `www/app.js`, unchanged, keeping the `(function () { ... })();` wrapper. Then in `www/index.html`, replace lines 480-1193 with:

```html
  <script src="app.js"></script>
```

It must sit after `<script src="tracker-core.js"></script>` (line 479) — `app.js` reads `window.TrackerCore` at IIFE entry.

- [ ] **Step 4: Verify the split changed nothing**

```bash
cd /home/kevins/projects/personal/theCut
npm test
node -e "new Function(require('fs').readFileSync('www/app.js','utf8'))" && echo "app.js parses"
grep -c 'function' www/app.js
```

Expected: tests pass, `app.js parses`, and a function count matching the original inline script. `node -e` only parses — it cannot run the DOM code, which is the point.

- [ ] **Step 5: Replace the token block**

In `www/styles.css`, replace the existing `:root` block and its `@media (prefers-color-scheme: dark)` counterpart with the tokens from spec §4. Every token in that table, both columns, no others. The old names (`--cal`, `--protein`, `--goal`, `--ink`, `--ink-fg`, `--track`, `--text-mid`, `--text-muted`, `--text-dim`, `--text-faint`, `--surface-3`, `--border-soft`, `--switch-off`, `--pending`, `--warn-*`, `--danger`) are replaced by the new set, so existing rules referencing them must be updated as each screen is rebuilt in Tasks 3–6. Until then some old rules will reference tokens that no longer exist and render unstyled — that is expected and is why this task's acceptance is the build, not the look.

Keep `color-scheme: light dark` on `:root`.

Add at the top of `styles.css`, above the token block:

```css
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('fonts/ibm-plex-sans-400.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('fonts/ibm-plex-sans-600.woff2') format('woff2');
  font-weight: 600; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('fonts/ibm-plex-sans-700.woff2') format('woff2');
  font-weight: 700; font-style: normal; font-display: swap;
}
```

and set on `body` (replacing whatever font stack is there now):

```css
body {
  font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  font-feature-settings: 'tnum';
}
```

`tnum` is global so figures do not jitter as they change.

- [ ] **Step 6: Run the build check**

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep -E 'assets/public/(index.html|styles.css|app.js|tracker-core.js|fonts/)'
```

Expected: BUILD SUCCESSFUL, and the `unzip -l` output lists `index.html`, `styles.css`, `app.js`, `tracker-core.js` and three files under `assets/public/fonts/`. If `styles.css` or `app.js` are missing, `cap sync` did not run.

- [ ] **Step 7: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/ 
git commit -m "Split www into markup, styles and script; add tokens and the bundled typeface"
```

---

### Task 3: Bottom navigation and the Today screen

**Files:**
- Modify: `www/index.html` — remove `<h1>theCut</h1>` (line 257) and the `.tabs` row (lines 260-264); rebuild `#page-day` (lines 268-335); add `#page-meals`; add the bottom nav and the FAB
- Modify: `www/styles.css` — nav, day strip, hero card, stat tiles, FAB
- Modify: `www/app.js` — `selectTab`, `renderDay`, day-strip wiring, FAB handler

**Interfaces:**
- Consumes: `TrackerCore.dayStrip(days, date, todayStr)` from Task 1.
- Produces: `#page-meals` as an empty shell for Task 4; `selectTab(name)` accepting `'day' | 'meals' | 'progress' | 'settings'`; `renderDayStrip()` called from `renderDay()`.

- [ ] **Step 1: Replace the header and tabs with the bottom nav**

Delete `<h1>theCut</h1>` and the `.tabs` div. Every artboard labels itself in its own header, so the app title has no home. Move `#storageMode` (line 258) to a thin banner directly under the page content — keep the id, `renderWarn()` and the boot sequence at `app.js` both write it.

Add, as the last children of `#app`:

```html
  <button id="fab" class="fab" aria-label="Photo estimate">📷</button>
  <nav class="nav">
    <button data-tab="day" class="active"><span class="nav-ico">◎</span>Today</button>
    <button data-tab="meals"><span class="nav-ico">☰</span>Meals</button>
    <button data-tab="progress"><span class="nav-ico">◪</span>Progress</button>
    <button data-tab="settings"><span class="nav-ico">⚙</span>Settings</button>
  </nav>
```

Take the icons and their exact glyphs from the canvas's nav row rather than the placeholders above — read `design/Daily Tracker Redesign.dc.html` around the four nav rows (they repeat once per artboard, near lines 111-114 and 174-177).

The delegated tab handler at `app.js` (currently attached to `.tabs`, line 947 of the original) moves to `.nav`; it already reads `data-tab`, so only the selector changes. `selectTab` (line 935) toggles `#page-<name>`, which keeps working once `#page-meals` exists.

- [ ] **Step 2: Add the empty Meals page**

Immediately after `#page-day`, so Task 4 has somewhere to build:

```html
  <section class="page" id="page-meals"></section>
```

- [ ] **Step 3: Replace the date row with the day strip**

Delete `#prevDay`, `#dateInput`, `#nextDay`, `#dayLabel`, `#todayBtn` (lines 270-275) and their handlers (`app.js` lines 952-956 of the original), plus the `.date-row`, `.navbtn`, `#dateInput` and `.today-btn` rules in `styles.css`. Arbitrary-date navigation moves to the Meals header (Task 4) — the strip is relative and cannot reach an arbitrary date, so that replacement is not optional.

Add in their place:

```html
  <div class="strip" id="dayStrip"></div>
```

and in `app.js`, called from `renderDay()`:

```js
  function renderDayStrip() {
    var el = document.getElementById('dayStrip');
    var items = C.dayStrip(cache, currentDate, todayStr()), html = '', i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      html += '<button class="strip-day' + (it.date === currentDate ? ' sel' : '') + '" data-date="' + it.date + '">'
            +   '<span class="sd-label">' + it.label + '</span>'
            +   '<span class="sd-num">' + it.dayNum + '</span>'
            +   '<span class="sd-dot ' + it.status + '"></span>'
            + '</button>';
    }
    el.innerHTML = html;
  }
```

with one delegated handler, attached once beside the other listeners:

```js
  document.getElementById('dayStrip').addEventListener('click', function (e) {
    var b = e.target.closest('[data-date]');
    if (!b) return;
    currentDate = b.getAttribute('data-date');
    render();
  });
```

Dot colours are `--ok` for `finished`, `--accent` for `today`, `--border` for `empty`; the selected pill is `--ink-fill` on `--ink-fill-fg`. The strip scrolls horizontally (`overflow-x: auto`) so it survives more than seven entries.

- [ ] **Step 4: Rebuild the hero card and the three tiles**

Keep every id `renderDay()` already writes — `#calNums`, `#calBar`, `#calRemaining`, `#proNums`, `#proBar`, `#proRemaining`, `#stepsInput`, `#weightInput`, `#stepHint`, `#mealList`. Restyle the markup around them per the canvas: calories 40/700 with the `N left` line and a 10px `--accent` bar, protein 24/700 with a 6px `--ink-fill` bar.

Replace the `.day-toggle` two-button Training/Rest control (lines 120-125 in CSS, the delegated handler at line 959) with the Workout tile:

```html
  <button class="tile" id="workoutTile">
    <span class="tile-fig" id="workoutMark">—</span>
    <span class="tile-lbl">Workout</span>
    <span class="tile-sub" id="workoutSub">Tap if done</span>
  </button>
```

Its handler flips `day.dayType` between `'training'` and `'rest'`, then `save(); render();` — the same two lines the old toggle ran. `renderDay()` sets `#workoutMark` to `✓` and `#workoutSub` to `Done` with the tile in `--accent` when `dayType === 'training'`, `—` / `Tap if done` on `--surface-2` otherwise.

Steps and Weight become the other two tiles. Both keep their existing inputs, hidden until the tile is tapped:

```html
  <button class="tile" id="stepsTile">
    <span class="tile-fig" id="stepsFig">0</span>
    <span class="tile-lbl">Steps</span>
    <span class="tile-sub" id="stepsBonus">+0 cal to target</span>
  </button>
```

with `#stepsInput` and `#weightInput` moved into a reveal row below the tile row, toggled with `el.hidden`. `#stepsInput`'s change handler (original line 991, including the `stepsManual` branch and the conditional `syncSteps()`) and `#weightInput`'s (line 998) move unchanged — only their position in the markup changes.

- [ ] **Step 5: Delete the Finish-day row**

Remove `.done-row` markup (lines 283-290), the `#doneToggle` change handler (line 968) and the `.done-row` / `.switch` / `.slider` CSS (lines 128-146). Leave `backfillDoneFlags()` alone for now — Task 7 replaces it, and deleting it here would leave days unfinished in between.

- [ ] **Step 6: Add the meals preview and the FAB**

Under the hero: the quick-add chips host (`<div id="quickAdds" class="qa-grid"></div>` — populated in Task 4, empty here), the last three meals from `#mealList`, and a `See all` button that calls `selectTab('meals')`.

The FAB calls the existing `takePhoto('CAMERA')` (original line 1048). It is the same entry point the widget's camera button uses, so no new code path:

```js
  document.getElementById('fab').addEventListener('click', function () { takePhoto('CAMERA'); });
```

- [ ] **Step 7: Run the build check**

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -p app/build/outputs/apk/debug/app-debug.apk assets/public/index.html | grep -c 'dayStrip\|page-meals\|id="fab"'
```

Expected: tests pass, BUILD SUCCESSFUL, and a count of 3 — proof the new markup reached the APK rather than a stale copy of `www/`.

- [ ] **Step 8: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/
git commit -m "Rebuild Today on the bottom nav, day strip and stat tiles"
```

---

### Task 4: The Meals screen

**Files:**
- Modify: `www/index.html` — fill `#page-meals`
- Modify: `www/styles.css` — quick-add grid, meal rows, swipe panel, inline edit card, docked composer
- Modify: `www/app.js` — `renderMeals()`, quick-add, swipe-to-delete, inline edit

**Interfaces:**
- Consumes: `TrackerCore.quickAdds(days, n, todayStr)` from Task 1; `selectTab('meals')` from Task 3.
- Produces: `renderMeals()`, called from `render()`'s dispatch (original line 916).

- [ ] **Step 1: Build the header with the date picker**

Eyebrow, date title, day totals right-aligned. The date title is the app's only arbitrary-date navigation now that `#dateInput` is gone:

```html
  <header class="mh">
    <div class="eyebrow">Meals</div>
    <button class="mh-date" id="mealsDate">Saturday 12</button>
    <div class="mh-totals" id="mealsTotals">0 cal · 0 g</div>
  </header>
  <input type="date" id="mealsDatePicker" class="visually-hidden">
```

`#mealsDate` calls `document.getElementById('mealsDatePicker').showPicker()` where available, falling back to `.click()`. Its `change` handler sets `currentDate` and calls `render()` — the same two lines the deleted `#dateInput` handler ran.

- [ ] **Step 2: Build quick add**

Four tiles in a 2×2 grid, each name, `cal · Ng`, and a `+` on `--accent-tint` with `--accent-tint-fg` text:

```js
  function renderQuickAdds() {
    var host = document.getElementById('quickAdds');
    var items = C.quickAdds(cache, 4, todayStr()), html = '', i;
    for (i = 0; i < items.length; i++) {
      html += '<button class="qa" data-qa="' + i + '">'
            +   '<span class="qa-name"></span><span class="qa-nums"></span><span class="qa-plus">+</span>'
            + '</button>';
    }
    host.innerHTML = html;
    var btns = host.querySelectorAll('.qa');
    for (i = 0; i < btns.length; i++) {
      btns[i].querySelector('.qa-name').textContent = items[i].name;
      btns[i].querySelector('.qa-nums').textContent = items[i].cal + ' cal · ' + items[i].protein + 'g';
    }
    host.quickAddItems = items;
  }
```

Names are written with `textContent`, never string-concatenated into `innerHTML` — a meal name comes from Claude or from typing and must not be able to inject markup.

Tapping adds that meal to the selected day immediately, through the same push the `#addBtn` handler uses (original line 1018), then `save(); render();`.

Call `renderQuickAdds()` from both `renderDay()` and `renderMeals()` — the grid appears on both screens.

- [ ] **Step 3: Build the logged-meals list with swipe-to-delete**

One row per meal: name, `meal · time`, calories, protein. Caption under the list: `Swipe left to delete · tap to edit`.

Swipe is the fiddliest part of the whole redesign (spec §16). Pointer events on the row, a `translateX` transform, a ~60px threshold, and it must not engage until the gesture is clearly horizontal or it will fight the page scroll:

```js
  function wireSwipe(row) {
    var x0 = 0, y0 = 0, dx = 0, axis = null, id = null;
    row.addEventListener('pointerdown', function (e) {
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; axis = null;
      row.classList.add('dragging');
    });
    row.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      var mx = e.clientX - x0, my = e.clientY - y0;
      if (!axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (axis === 'x') row.setPointerCapture(id);
      }
      if (axis !== 'x') return;
      e.preventDefault();
      dx = Math.min(0, mx);                      /* left only */
      row.style.transform = 'translateX(' + dx + 'px)';
    });
    function end() {
      row.classList.remove('dragging');
      if (axis === 'x' && dx < -60) row.classList.add('revealed');
      else row.classList.remove('revealed');
      row.style.transform = '';
      axis = null; id = null;
    }
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  }
```

`.revealed` slides the row to expose a `--over` Delete panel behind it; the panel's button reuses the existing `[data-remove]` delete path (original delegated handler, line 982) so there is one deletion route, not two. `touch-action: pan-y` on the row is what lets the browser keep vertical scrolling while this handler claims horizontal.

- [ ] **Step 4: Build the inline edit card**

Tapping a row (without a swipe in progress) swaps it for the canvas's edit card: `--accent-tint` background, name input, cal and g inputs, Cancel / Save. Save writes back into the same meal object and calls `save(); render();`. Cancel re-renders. Only one row may be in edit at a time — hold the editing index in a module-scope `editing` variable, as `analysing` (original line 1040) already does for the photo flow.

- [ ] **Step 5: Dock the composer**

Name, cal, g and an `--accent` submit button, docked above the nav. Keep ids `#mealName`, `#mealCal`, `#mealProtein`, `#addBtn`, `#aiStatus` — `takePhoto()` writes all five (original lines 1069-1098) and must keep working unchanged, since the FAB now prefills this form from the Today screen.

- [ ] **Step 6: Run the build check**

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -p app/build/outputs/apk/debug/app-debug.apk assets/public/app.js | grep -c 'renderQuickAdds\|wireSwipe'
```

Expected: tests pass, BUILD SUCCESSFUL, count of 2 or more.

- [ ] **Step 7: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/
git commit -m "Add the Meals screen with quick add, swipe delete and inline edit"
```

---

### Task 5: The Progress screen

**Files:**
- Modify: `www/index.html` — rebuild `#page-progress` (lines 337-393)
- Modify: `www/styles.css` — hero card, stat tiles, chart, recent-days list, segmented control
- Modify: `www/app.js` — `renderProgress()`, `renderWeightChart()`

**Interfaces:**
- Consumes: `TrackerCore.weightSeries(days, range, todayStr)` from Task 1.
- Produces: `renderWeightChart()`; a module-scope `weightRange` defaulting to `'30d'`.

- [ ] **Step 1: Build the hero**

`--hero-bg` card: estimated fat lost against the goal at 40/700, projected days remaining, an 8px `--accent` bar, and the existing counted-days/average-deficit sentence. Keep `#goalNums`, `#goalBar`, `#goalEta` and `#pendingNote` — `renderProgress()` (original line 792) already writes all four, so this is markup and CSS only.

- [ ] **Step 2: Build the three stat tiles**

Days counted, average deficit, average protein — `#statDays`, `#statDeficit`, `#statProtein`, all already computed and written. Restyle only.

- [ ] **Step 3: Build the weight card**

A 7d / 30d / All segmented control over an inline SVG:

```js
  var weightRange = '30d';

  function renderWeightChart() {
    var s = C.weightSeries(cache, weightRange, todayStr());
    var box = document.getElementById('weightChart');
    if (s.points.length < 2) {
      box.innerHTML = '<div class="empty">Log a weight on two days to see the trend.</div>';
      return;
    }
    var W = 320, H = 120, P = 8;
    var pad = Math.max(0.4, (s.max - s.min) * 0.15);       /* never a zero-height range */
    var lo = s.min - pad, hi = s.max + pad;
    var n = s.points.length;
    var x = function (i) { return P + (i / (n - 1)) * (W - 2 * P); };
    var y = function (kg) { return H - P - ((kg - lo) / (hi - lo)) * (H - 2 * P); };

    var d = '', i;
    for (i = 0; i < n; i++) d += (i ? ' ' : '') + x(i).toFixed(1) + ',' + y(s.points[i].kg).toFixed(1);

    var grid = '';
    for (i = 0; i < 3; i++) {
      var gy = (P + (i / 2) * (H - 2 * P)).toFixed(1);
      grid += '<line x1="' + P + '" y1="' + gy + '" x2="' + (W - P) + '" y2="' + gy + '" class="cg"/>';
    }

    box.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="wchart">' +
        grid +
        '<line class="ct" x1="' + x(0) + '" y1="' + y(s.trend.from) + '" x2="' + x(n - 1) + '" y2="' + y(s.trend.to) + '"/>' +
        '<polyline class="cl" points="' + d + '"/>' +
        '<circle class="cd" cx="' + x(n - 1) + '" cy="' + y(s.points[n - 1].kg) + '" r="3.5"/>' +
      '</svg>' +
      '<div class="wdates"><span></span><span></span></div>';

    var ds = box.querySelectorAll('.wdates span');
    ds[0].textContent = s.points[0].date;
    ds[1].textContent = s.points[n - 1].date;
  }
```

`.ct` is the dashed trend line (`stroke-dasharray: 4 4`), `.cl` the polyline, `.cg` the gridlines, `.cd` the dot on the latest point. All four take their stroke from tokens — no inline colour. `vector-effect: non-scaling-stroke` on the strokes, because `preserveAspectRatio="none"` would otherwise stretch them.

The segmented control sets `weightRange` and calls `renderWeightChart()`. Caption under the card: daily swings are water, the trend is what matters.

- [ ] **Step 4: Build recent days**

Date, calories against target, and a signed delta coloured `--ok` under target or `--over` over. Today carries an `In progress` chip and a `—` delta. This replaces the `<table>`/`#histBody` markup (lines 370-377) with list rows; `renderProgress()` builds the same rows it builds today, so change the markup it emits, not the data it reads.

- [ ] **Step 5: Move backup and restore out**

Delete `#exportBtn`, `#importBtn`, `#importArea`, `#ioHint`, `#resetBtn` and the `.io-row` / `#importArea` / `.danger` CSS from this screen. Their four handlers (original lines 1143, 1153, 1175 and the move-day block at 1125) move to the Settings sheet in Task 6 — cut them to a scratch buffer and paste them there in the same task run, or Task 6 will have to reconstruct them.

- [ ] **Step 6: Run the build check**

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -p app/build/outputs/apk/debug/app-debug.apk assets/public/app.js | grep -c 'renderWeightChart'
```

Expected: tests pass, BUILD SUCCESSFUL, count ≥ 1.

- [ ] **Step 7: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/
git commit -m "Rebuild Progress with the hero, weight chart and recent days"
```

---

### Task 6: Settings and the bottom sheet

**Files:**
- Modify: `www/index.html` — rebuild `#page-settings` (lines 395-475); add the sheet host
- Modify: `www/styles.css` — expanding rows, sheet, backdrop
- Modify: `www/app.js` — `renderSettings()`, row expansion, `openSheet()` / `closeSheet()`

**Interfaces:**
- Consumes: the handlers cut from Progress in Task 5.
- Produces: `openSheet(id)` / `closeSheet()`.

**The input count:** spec §10 says the app has eleven inputs. There are **twelve**. Eleven carry `data-set` in the Goals card — `setUseLatest`, `setWeight`, `setMaintPerKg`, `setMaintOverride`, `setProteinPerKg`, `setProteinOverride`, `setRestDeficit`, `setTrainingBump`, `setStepBaseline`, `setCalPer1000`, `setAutoSteps` — and `setApiKey` is a twelfth in the separate "Meal photo AI" card, which §10's table already gives its own row ("Photo estimates"). All twelve must survive, with their ids, because the single delegated `change` handler on `#page-settings` (original line 1006) reads `data-set` and `renderSettings()` (line 869) writes every one by id.

- [ ] **Step 1: Build the expanding rows**

Eight rows per spec §10. Each is a summary button plus a hidden panel holding the real inputs:

```html
  <div class="srow" data-row="maintenance">
    <button class="srow-head">
      <span class="srow-name">Maintenance</span>
      <span class="srow-val" id="sumMaintenance">2,950 cal</span>
    </button>
    <div class="srow-body" hidden><!-- the eight existing inputs, ids unchanged --></div>
  </div>
```

Visibility toggles with `el.hidden`, never `style.display`. Training day and Rest day are **derived displays**, not inputs — their rows show `#sumTraining` / `#sumRest` and expand to nothing; `renderSettings()` computes them from `C.targetFor()` exactly as `#derived` does today.

Row → contents, from spec §10:

| Row | Summary id | Panel holds |
|---|---|---|
| Training day | `#sumTraining` | — |
| Rest day | `#sumRest` | — |
| Maintenance | `#sumMaintenance` | `setUseLatest`, `setWeight`, `weightHint`, `setMaintPerKg`, `setMaintOverride`, `setProteinPerKg`, `setProteinOverride`, `setRestDeficit`, `setTrainingBump` |
| Step adjustment | `#sumSteps` | `setStepBaseline`, `setCalPer1000`, `setAutoSteps`, `autoStepsHint` |
| Fat loss goal | `#sumGoal` | `goalInput` (moved here from Progress) |
| Photo estimates | `#sumApiKey` | `setApiKey` |
| Backup & restore | `›` | opens the sheet |
| Move a day | `›` | opens the sheet |

`#goalInput` keeps its id and its handler (original line 1001).

- [ ] **Step 2: Build the sheet**

One component, used twice — which is the whole justification for it being a component:

```html
  <div class="sheet-host" id="sheetHost" hidden>
    <div class="sheet-backdrop" id="sheetBackdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <div class="sheet-head"><h2 id="sheetTitle"></h2><button class="sheet-x" id="sheetClose">×</button></div>
      <div class="sheet-body" id="sheetBackup" hidden><!-- status strip, Copy my data, Restore data, textarea, Erase all data --></div>
      <div class="sheet-body" id="sheetMove" hidden><!-- date picker + move action --></div>
    </div>
  </div>
```

```js
  function openSheet(id) {
    document.getElementById('sheetBackup').hidden = id !== 'sheetBackup';
    document.getElementById('sheetMove').hidden = id !== 'sheetMove';
    document.getElementById('sheetTitle').textContent = id === 'sheetBackup' ? 'Backup & restore' : 'Move a day';
    document.getElementById('sheetHost').hidden = false;
  }
  function closeSheet() { document.getElementById('sheetHost').hidden = true; }
```

Backdrop is `rgba(17,24,39,.45)`, panel radius `28px 28px 0 0`. Both the backdrop and `#sheetClose` call `closeSheet()`.

- [ ] **Step 3: Move the backup, restore and move-day markup in**

Paste `#exportBtn`, `#importBtn`, `#importArea`, `#ioHint`, `#resetBtn` into `#sheetBackup` and `#moveTarget`, `#moveBtn`, `#moveHint` into `#sheetMove`, ids unchanged, with their handlers from Task 5's Step 5 restored verbatim. The status strip uses `--ok-bg` / `--ok-text`; Erase all data uses `--danger-text` on `--danger-border`.

`exportable()` still strips `apiKey` — do not touch it.

- [ ] **Step 4: Verify every input survived**

```bash
cd /home/kevins/projects/personal/theCut
grep -o 'data-set="[a-zA-Z0-9]*"' www/index.html | sort | uniq | wc -l
grep -c 'id="setApiKey"' www/index.html
for id in setUseLatest setWeight setMaintPerKg setMaintOverride setProteinPerKg setProteinOverride setRestDeficit setTrainingBump setStepBaseline setCalPer1000 setAutoSteps setApiKey goalInput weightHint autoStepsHint; do grep -q "id=\"$id\"" www/index.html || echo "MISSING: $id"; done
```

Expected: `12`, then `1`, then no `MISSING:` lines. This is the check spec §16 calls for — the expanding rows are where an input is most likely to be silently dropped.

- [ ] **Step 5: Run the build check**

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -p app/build/outputs/apk/debug/app-debug.apk assets/public/index.html | grep -c 'sheetHost\|srow-head'
```

Expected: tests pass, BUILD SUCCESSFUL, count ≥ 2.

- [ ] **Step 6: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/
git commit -m "Rebuild Settings as expanding rows over a shared bottom sheet"
```

---

### Task 7: Automatic day finishing

Spec §12. Mostly a deletion: the rule already exists as a one-time migration and is promoted to standing behaviour.

**Files:**
- Modify: `www/app.js` — replace `backfillDoneFlags()` (original line 674) with `finalizeDays()`
- Test: `test/tracker-core.test.mjs` — already covers `shouldFinalize` and `weightAsOf` from Task 1

**Interfaces:**
- Consumes: `TrackerCore.shouldFinalize(day, dateStr, todayStr)` and `TrackerCore.weightAsOf(days, date)` from Task 1.
- Produces: `finalizeDays()`, called from the boot sequence and the `visibilitychange` resume handler.

- [ ] **Step 1: Write `finalizeDays()`**

Replace `backfillDoneFlags()` entirely:

```js
  /* Every day strictly in the past that holds at least one meal is finished and snapshotted.
     The snapshot uses the weight logged on or before that day, not today's — four days away
     would otherwise freeze all four against one morning's weigh-in. That makes automatic
     finishing strictly more accurate than the toggle it replaces, which snapshotted whenever
     the user happened to tap it. */
  function finalizeDays() {
    var t = todayStr(), dates = Object.keys(cache), changed = false, i;
    for (i = 0; i < dates.length; i++) {
      var d = dates[i], day = cache[d];
      if (!C.shouldFinalize(day, d, t)) continue;
      var snap = C.snapshotFor(settings, C.weightAsOf(cache, d));
      day.done = true;
      day.maintenance = snap.maintenance;
      day.proteinTarget = snap.proteinTarget;
      changed = true;
    }
    if (changed) save();
  }
```

- [ ] **Step 2: Wire it to launch and resume**

In the boot sequence (original lines 1182-1191), replace `backfillDoneFlags()` with `finalizeDays()`. In the `visibilitychange` handler (original line 1116), add `finalizeDays()` to the visible branch, before `syncSteps()` — these are the two moments the sensor is already read, so midnight with the app open is handled without a background service.

The `#importBtn` handler (original line 1153) also calls `backfillDoneFlags()` after a restore; point it at `finalizeDays()`.

- [ ] **Step 3: Verify no caller was left behind**

```bash
cd /home/kevins/projects/personal/theCut
grep -n 'backfillDoneFlags\|doneToggle\|done-row\|doneHint' www/app.js www/index.html www/styles.css
grep -c 'finalizeDays' www/app.js
```

Expected: the first command prints nothing; the second prints 4 (the definition plus three call sites). Any surviving `backfillDoneFlags` reference is a crash on launch.

- [ ] **Step 4: Run the build check**

```bash
cd /home/kevins/projects/personal/theCut
npm test
export ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleDebug
unzip -p app/build/outputs/apk/debug/app-debug.apk assets/public/app.js | grep -c 'finalizeDays'
```

Expected: tests pass, BUILD SUCCESSFUL, count of 4.

- [ ] **Step 5: Commit**

```bash
cd /home/kevins/projects/personal/theCut
git add www/
git commit -m "Finish past days automatically and drop the manual toggle"
```

---

## After the plan

**Tell the user before they install:** the first launch after Task 7 finishes every past day they never toggled, so `days counted`, average deficit and fat lost all move once. Expected, not a bug (spec §12, Migration).

**Still unverifiable without hardware,** in order of risk — every one of these needs the user on a real phone:

1. Swipe-to-delete in a WebView (pointer capture vs. page scroll).
2. The settings expanding rows — whether all twelve inputs are reachable and writable, not just present in the markup.
3. The weight chart's autoscale with sparse data.
4. The FAB's camera round-trip, which shares `takePhoto()` with the widget button.

**Out of scope, per spec §15:** carbs, any widget change, Health Connect or the step-attribution ceiling, a signed release build.

**Unpushed:** `a5a7e5a` and `a8c1573` are still local, plus everything this plan commits. Ask before pushing, every time.
