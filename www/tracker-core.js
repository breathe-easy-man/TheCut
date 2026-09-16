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

  root.TrackerCore = {
    DEFAULTS: DEFAULTS,
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
    parseMealResponse: parseMealResponse
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
