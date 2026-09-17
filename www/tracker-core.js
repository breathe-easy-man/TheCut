/* Shared by www/index.html and test/tracker-core.test.mjs — keep it dependency-free and
 * browser-safe. Everything here is pure: no DOM, no storage, no fetch.
 *
 * The defaults are calibrated so that day one matches the numbers the tracker was hardcoded
 * with before goals became configurable: at 99.7 kg, 29.59 cal/kg = 2950 maintenance and
 * 1.91 g/kg = 190 g protein. Change the weight and everything follows; change a per-kg
 * figure and it stops following. Nothing silently re-scores the history either way — see
 * maintenanceFor().
 */
(function (root) {

  var DEFAULTS = {
    goalKg:              3,
    bodyweight:          99.7,
    useLatestWeight:     true,
    maintenancePerKg:    29.59,   /* 2950 / 99.7 */
    maintenanceOverride: '',      /* non-empty wins over the per-kg figure */
    proteinPerKg:        1.91,    /* 190 / 99.7 */
    proteinOverride:     '',
    restDeficit:         400,     /* maintenance - rest-day target: 2950 - 2550 */
    trainingBump:        200,     /* training-day target - rest-day target: 2750 - 2550 */
    stepBaseline:        2500,
    calPer1000Steps:     45,
    autoSteps:           false,   /* off until asked for: turning it on is what prompts for the permission */
    trainingDays:        '',      /* weekly schedule; empty = the pre-schedule behaviour, every day rest */
    apiKey:              ''
  };

  var KCAL_PER_KG_FAT = 7700;

  /* '' and null must fall back, but 0 is a legitimate setting (a 0 training bump, say), so
     this cannot be written as `Number(v) || fallback`. */
  function num(v, fallback) {
    if (v === '' || v === null || v === undefined) return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function withDefaults(s) {
    var out = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) out[k] = DEFAULTS[k];
    for (k in (s || {})) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    return out;
  }

  function bodyweight(settings, latestWeight) {
    if (settings.useLatestWeight && latestWeight) {
      var w = num(latestWeight, 0);
      if (w > 0) return w;
    }
    return num(settings.bodyweight, DEFAULTS.bodyweight);
  }

  function maintenanceCal(settings, latestWeight) {
    var o = num(settings.maintenanceOverride, 0);
    if (o > 0) return Math.round(o);
    return Math.round(bodyweight(settings, latestWeight) * num(settings.maintenancePerKg, DEFAULTS.maintenancePerKg));
  }

  function proteinTarget(settings, latestWeight) {
    var o = num(settings.proteinOverride, 0);
    if (o > 0) return Math.round(o);
    return Math.round(bodyweight(settings, latestWeight) * num(settings.proteinPerKg, DEFAULTS.proteinPerKg));
  }

  function stepBonus(day, settings) {
    var s = num(day.steps, 0);
    if (!s) return 0;
    return Math.round(((s - num(settings.stepBaseline, DEFAULTS.stepBaseline)) / 1000)
                      * num(settings.calPer1000Steps, DEFAULTS.calPer1000Steps));
  }

  /* A day that has been marked finished keeps the maintenance and protein figures it was judged
     against. Without the snapshot, losing 10 kg would lower today's maintenance and retroactively
     shrink the deficit on every past day — the fat-loss bar would run backwards while you were
     succeeding. Unfinished days float with current settings so editing goals still previews. */
  function maintenanceFor(day, settings, latestWeight) {
    return day.maintenance ? Number(day.maintenance) : maintenanceCal(settings, latestWeight);
  }

  function proteinTargetFor(day, settings, latestWeight) {
    return day.proteinTarget ? Number(day.proteinTarget) : proteinTarget(settings, latestWeight);
  }

  function snapshotFor(settings, latestWeight) {
    return { maintenance: maintenanceCal(settings, latestWeight), proteinTarget: proteinTarget(settings, latestWeight) };
  }

  function targetFor(day, settings, latestWeight) {
    var rest = maintenanceFor(day, settings, latestWeight) - num(settings.restDeficit, DEFAULTS.restDeficit);
    var base = rest + (day.dayType === 'training' ? num(settings.trainingBump, DEFAULTS.trainingBump) : 0);
    return {
      cal: base + stepBonus(day, settings),
      protein: proteinTargetFor(day, settings, latestWeight)
    };
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function totals(day) {
    var cal = 0, protein = 0, meals = (day && day.meals) || [];
    for (var i = 0; i < meals.length; i++) {
      cal += num(meals[i].cal, 0);
      protein += num(meals[i].protein, 0);
    }
    return { cal: cal, protein: round1(protein) };
  }

  function deficitFor(day, settings, latestWeight) {
    return (maintenanceFor(day, settings, latestWeight) + stepBonus(day, settings)) - totals(day).cal;
  }

  /* ---- automatic step counting ---- */

  /* TYPE_STEP_COUNTER reports steps since the phone last booted, not steps today, so a day's
     tally is a delta against the first reading taken that day.
     A reboot resets the hardware counter to zero, which shows up as a reading LOWER than the
     last one seen. When that happens the steps counted before the reboot are banked into
     `carried` and a fresh baseline starts — without that, a reboot at lunchtime would wipe the
     morning, or worse, produce a negative delta and a bar running backwards.

     state: { day, base, carried, last }; returns the same shape plus `steps`. */
  function stepTally(state, value, dayStr) {
    var v = Math.max(0, Math.floor(num(value, 0)));
    var s = state || {};

    if (s.day !== dayStr) {
      /* First reading of a new day: today starts here, whatever the counter happens to say. */
      return { day: dayStr, base: v, carried: 0, last: v, steps: 0 };
    }

    var base = num(s.base, 0), carried = num(s.carried, 0), last = num(s.last, v);

    if (v < last) {
      carried = carried + Math.max(0, last - base);
      base = 0;
    }
    return { day: dayStr, base: base, carried: carried, last: v, steps: carried + Math.max(0, v - base) };
  }

  /* ---- home-screen widget ---- */

  /* A percentage for a bar, clamped: a bar cannot be more than full, and a missing or zero
     target must not produce Infinity or NaN and blank the widget. */
  function pct(value, max) {
    if (!(num(max, 0) > 0)) return 0;
    return Math.max(0, Math.min(100, Math.round((num(value, 0) / num(max, 0)) * 100)));
  }

  function fatLost(countedDays, settings, latestWeight) {
    var deficit = 0;
    for (var i = 0; i < countedDays.length; i++) {
      deficit += deficitFor(countedDays[i], settings, latestWeight);
    }
    return { deficit: deficit, kg: deficit / KCAL_PER_KG_FAT };
  }

  /* What the widget renders. Built here rather than in the provider so the numbers are the same
     ones the app shows and the same ones this file's tests cover — the Java side only draws. */
  function widgetBlob(day, countedDays, settings, latestWeight, dateStr) {
    var t = totals(day);
    var target = targetFor(day, settings, latestWeight);
    var goal = num(settings.goalKg, 3) || 3;
    var kg = fatLost(countedDays, settings, latestWeight).kg;
    return {
      date: dateStr,
      bars: [
        { label: 'FAT LOST', value: kg.toFixed(2) + ' / ' + goal + ' kg',
          pct: pct(kg, goal), over: false },
        { label: 'CALORIES', value: t.cal + ' / ' + target.cal,
          pct: pct(t.cal, target.cal), over: t.cal > target.cal },
        { label: 'PROTEIN', value: t.protein + ' / ' + target.protein + ' g',
          pct: pct(t.protein, target.protein), over: false }
      ]
    };
  }

  /* ---- meal photo ---- */

  var MEAL_PROMPT =
    'This is a photo of a meal. Estimate the total calories and total protein for the food ' +
    'actually visible in the portion shown, not a generic serving size. If several items are on ' +
    'the plate, add them together. Name the meal briefly, the way someone would write it in a ' +
    'food diary. If the photo shows no food at all, return 0 for both numbers and the name ' +
    '"No food detected".';

  /* output_config.format makes Claude return exactly this object as the one text block. */
  function mealRequest(base64, mediaType) {
    return {
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              name:       { type: 'string' },
              calories:   { type: 'integer' },
              protein_g:  { type: 'number' },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
            },
            required: ['name', 'calories', 'protein_g', 'confidence'],
            additionalProperties: false
          }
        }
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: MEAL_PROMPT }
        ]
      }]
    };
  }

  /* An API error, a refusal and a truncated answer all arrive as a perfectly ordinary object, so
     nothing is trusted until it has parsed and the numbers are real. Throws a message fit to show
     the user; the caller leaves the form empty and lets them type it in by hand. */
  function parseMealResponse(body) {
    if (!body || typeof body !== 'object') throw new Error('Empty response from Claude.');
    if (body.error) throw new Error(body.error.message || 'Claude returned an error.');
    if (body.stop_reason === 'refusal') throw new Error('Claude declined to read that photo.');
    if (body.stop_reason === 'max_tokens') throw new Error('Claude ran out of room. Try again.');

    var blocks = body.content || [], text = null;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === 'text' && blocks[i].text) { text = blocks[i].text; break; }
    }
    if (!text) throw new Error('Claude sent nothing back to read.');

    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error('Could not read the estimate. Enter it by hand.'); }

    var cal = num(parsed.calories, -1);
    var pro = num(parsed.protein_g, -1);
    if (!(cal >= 0) || !(pro >= 0)) throw new Error('Claude sent back numbers that made no sense.');

    return {
      name:       String(parsed.name || 'Meal').slice(0, 80),
      cal:        Math.round(cal),
      protein:    round1(pro),
      confidence: parsed.confidence || 'low'
    };
  }

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

  /* The meal object carries no meal-type field (the shape is a storage contract — see
     CLAUDE.md), so the Meals row's "Breakfast · 08:10" label is derived entirely from the
     hour a meal was logged, which the existing `id` (a Date.now() timestamp) already gives us
     for free. Four buckets, not a clock-precise taxonomy: this only labels a row, it never
     feeds a calculation. */
  function mealSlot(hour) {
    hour = num(hour, 0);
    if (hour >= 5 && hour < 11) return 'Breakfast';
    if (hour >= 11 && hour < 15) return 'Lunch';
    if (hour >= 18 && hour < 22) return 'Dinner';
    return 'Snack';
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

  /* The change since the most recent EARLIER logged weight — not the calendar day before, the
     most recent date before this one that actually has a weight, however big the gap. null
     when this day has no weight of its own, or none was logged before it (the first entry ever,
     or an empty history) — the Weight tile then shows the figure with no delta line rather than
     a misleading +0.0 against the settings fallback. A genuine unchanged weight still returns 0,
     not null. Reuses weightSeries() with no range cutoff and this date as the upper bound, so
     the last point (if any) is this day and the one before it is the previous log. */
  function weightDelta(days, date) {
    var pts = weightSeries(days, null, date).points;
    if (pts.length < 2 || pts[pts.length - 1].date !== date) return null;
    return round1(pts[pts.length - 1].kg - pts[pts.length - 2].kg);
  }

  /* A day finishes once it is strictly past and has at least one meal. A day with no meals is
     never finished: scoring it would invent a full day of deficit for a weekend away. */
  function shouldFinalize(day, dateStr, todayStr) {
    if (!day || day.done === true) return false;
    if (!(String(dateStr) < String(todayStr))) return false;
    return !!(day.meals && day.meals.length);
  }

  /* The rolling split, in rotation order. Four slots, so each group comes round every fourth
     workout — roughly 1.75 sessions a week, which beats training a group once a week. */
  var MUSCLE_GROUPS = ['Biceps & back', 'Delts & chest', 'Legs', 'Core'];

  /* Which group a given day belongs to. The rotation advances per WORKOUT, not per calendar day:
     a day off does not burn a slot, so missing Wednesday postpones legs rather than skipping them.
     Derived from history rather than stored on the day — unlike maintenance/proteinTarget, a label
     feeds no arithmetic, so recomputing it cannot corrupt a past day's deficit, and keeping it out
     of the day object leaves the backup blob byte-compatible with the original tracker.
     Counts strictly earlier training days, so marking today done never renames today's tile. */
  function workoutSplit(days, date) {
    var dates = Object.keys(days || {}).sort(), n = 0, i;
    for (i = 0; i < dates.length; i++) {
      if (dates[i] >= date) break;
      if (days[dates[i]].dayType === 'training') n++;
    }
    return MUSCLE_GROUPS[n % MUSCLE_GROUPS.length];
  }

  /* Which weekdays are training days, as Date#getDay indices: "1,2,4,5" is Mon/Tue/Thu/Fri.
     A string rather than an array because withDefaults() copies by reference, and one shared
     mutable default array would be edited in place by every caller that touched it. Empty is
     the default and means no schedule at all — exactly the behaviour the app had before this
     setting existed, so nobody's history changes shape by upgrading.
     The caller decides WHICH days this may stamp; see defaultDay() in app.js, which applies it
     to today and later only. Retro-stamping a past day would invent a workout that never
     happened, moving both its calorie target and the muscle rotation. */
  function isTrainingDay(settings, dateStr) {
    var raw = String((settings || {}).trainingDays || '').replace(/\s/g, '');
    if (!raw || !dateStr) return false;
    var p = String(dateStr).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return false;
    /* Split, never indexOf on the raw string: "15" would otherwise match a schedule of "1,5". */
    return raw.split(',').indexOf(String(d.getDay())) !== -1;
  }

  root.TrackerCore = {
    DEFAULTS: DEFAULTS,
    MUSCLE_GROUPS: MUSCLE_GROUPS,
    workoutSplit: workoutSplit,
    isTrainingDay: isTrainingDay,
    KCAL_PER_KG_FAT: KCAL_PER_KG_FAT,
    num: num,
    withDefaults: withDefaults,
    bodyweight: bodyweight,
    maintenanceCal: maintenanceCal,
    proteinTarget: proteinTarget,
    stepBonus: stepBonus,
    maintenanceFor: maintenanceFor,
    proteinTargetFor: proteinTargetFor,
    snapshotFor: snapshotFor,
    targetFor: targetFor,
    totals: totals,
    deficitFor: deficitFor,
    round1: round1,
    stepTally: stepTally,
    pct: pct,
    fatLost: fatLost,
    widgetBlob: widgetBlob,
    mealRequest: mealRequest,
    parseMealResponse: parseMealResponse,
    quickAdds: quickAdds,
    mealSlot: mealSlot,
    weightSeries: weightSeries,
    dayStrip: dayStrip,
    weightAsOf: weightAsOf,
    weightDelta: weightDelta,
    shouldFinalize: shouldFinalize
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
