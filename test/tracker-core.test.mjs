/* node test/tracker-core.test.mjs — no framework, exits non-zero on failure. */
import assert from 'node:assert/strict';
import '../www/tracker-core.js';

const C = globalThis.TrackerCore;
const S = C.withDefaults({});

/* ---- day one matches the numbers the tracker was hardcoded with ---- */

assert.equal(C.maintenanceCal(S, 99.7), 2950, 'maintenance at the starting weight');
assert.equal(C.proteinTarget(S, 99.7), 190, 'protein at the starting weight');
assert.deepEqual(C.targetFor({ dayType: 'rest', steps: '', meals: [] }, S, 99.7),
                 { cal: 2550, protein: 190 }, 'rest-day target');
assert.deepEqual(C.targetFor({ dayType: 'training', steps: '', meals: [] }, S, 99.7),
                 { cal: 2750, protein: 190 }, 'training-day target');

/* ---- targets follow the weight down ---- */

assert.equal(C.maintenanceCal(S, 90), 2663, 'maintenance falls with bodyweight');
assert.equal(C.bodyweight({ ...S, useLatestWeight: false, bodyweight: 95 }, 90), 95,
             'a manual bodyweight ignores the logged one');
assert.equal(C.bodyweight(S, 0), 99.7, 'no logged weight falls back to the setting');

/* ---- overrides win over the per-kg figures ---- */

assert.equal(C.maintenanceCal({ ...S, maintenanceOverride: 3100 }, 90), 3100);
assert.equal(C.proteinTarget({ ...S, proteinOverride: 220 }, 90), 220);

/* ---- steps ---- */

const day = (o) => ({ dayType: 'rest', steps: '', meals: [], ...o });
assert.equal(C.stepBonus(day({ steps: 2500 }), S), 0, 'baseline steps = no adjustment');
assert.equal(C.stepBonus(day({ steps: 12500 }), S), 450, 'above baseline raises the target');
assert.equal(C.stepBonus(day({ steps: 1500 }), S), -45, 'below baseline lowers it');
assert.equal(C.stepBonus(day({ steps: '' }), S), 0, 'unlogged steps are not a -112 penalty');
assert.equal(C.targetFor(day({ dayType: 'training', steps: 12500 }), S, 99.7).cal, 3200);

/* ---- a finished day is never re-scored by later settings ---- */
/* This is the one that matters: without the snapshot, losing weight lowers maintenance and
   every past deficit shrinks with it, so the fat-loss bar runs backwards while you succeed. */

const finished = day({ meals: [{ cal: 2000, protein: 150 }], maintenance: 2950, proteinTarget: 190 });
assert.equal(C.deficitFor(finished, S, 99.7), 950, 'deficit on the day it was logged');
assert.equal(C.deficitFor(finished, S, 90), 950, 'same deficit after dropping 10 kg');
assert.equal(C.targetFor(finished, S, 90).cal, 2550, 'and the same target');

const unfinished = day({ meals: [{ cal: 2000, protein: 150 }] });
assert.equal(C.deficitFor(unfinished, S, 90), 663, 'an unfinished day floats with current settings');

const snap = C.snapshotFor(S, 99.7);
assert.deepEqual(snap, { maintenance: 2950, proteinTarget: 190 });

/* ---- totals ---- */

assert.deepEqual(C.totals(day({ meals: [{ cal: 500, protein: 40 }, { cal: 620, protein: 12.5 }] })),
                 { cal: 1120, protein: 52.5 });
assert.deepEqual(C.totals(day({})), { cal: 0, protein: 0 });

/* ---- 0 is a real setting, '' is not ---- */

assert.equal(C.num(0, 45), 0, 'zero must survive');
assert.equal(C.num('', 45), 45);
assert.equal(C.num(null, 45), 45);
assert.equal(C.num('abc', 45), 45);
assert.equal(C.stepBonus(day({ steps: 12500 }), { ...S, calPer1000Steps: 0 }), 0,
             'a zero step bonus is honoured, not replaced by the default 45');

/* ---- the meal-photo request ---- */

const req = C.mealRequest('QUJD', 'image/jpeg');
assert.equal(req.model, 'claude-opus-5');
assert.equal(req.output_config.format.type, 'json_schema');
assert.equal(req.output_config.effort, 'low');
assert.deepEqual(req.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });

/* ---- reading Claude back: nothing is trusted until it parses ---- */

const ok = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });

assert.deepEqual(
  C.parseMealResponse(ok({ name: 'Chicken + rice', calories: 620, protein_g: 48.2, confidence: 'high' })),
  { name: 'Chicken + rice', cal: 620, protein: 48.2, confidence: 'high' });

assert.deepEqual(
  C.parseMealResponse(ok({ name: 'No food detected', calories: 0, protein_g: 0, confidence: 'high' })),
  { name: 'No food detected', cal: 0, protein: 0, confidence: 'high' },
  'a zero-calorie answer is a real answer, not a failure');

assert.equal(C.parseMealResponse(ok({ name: 'x', calories: 612.6, protein_g: 40, confidence: 'low' })).cal, 613,
             'a float calorie count is rounded, not rejected');

const throws = (body, re) => assert.throws(() => C.parseMealResponse(body), re);
throws({ error: { message: 'invalid x-api-key' } }, /invalid x-api-key/);
throws({ type: 'error', error: { type: 'overloaded_error' } }, /Claude returned an error/);
throws({ content: [], stop_reason: 'refusal' }, /declined/);
throws({ content: [{ type: 'text', text: '{}' }], stop_reason: 'max_tokens' }, /ran out of room/);
throws({ content: [] }, /nothing back/);
throws({ content: [{ type: 'text', text: 'Sure! Here you go:' }] }, /Could not read the estimate/);
throws(ok({ name: 'x', calories: -50, protein_g: 10 }), /made no sense/);
throws(ok({ name: 'x', calories: 500, protein_g: null }), /made no sense/);
throws(null, /Empty response/);

console.log('tracker-core: all assertions passed');

/* ---- the widget blob ---- */

const today = day({ dayType: 'rest', steps: '', meals: [{ cal: 1840, protein: 142 }] });
const counted = [
  day({ meals: [{ cal: 2000, protein: 150 }], maintenance: 2950, proteinTarget: 190 }),
  day({ meals: [{ cal: 2100, protein: 180 }], maintenance: 2950, proteinTarget: 190 })
];
const blob = C.widgetBlob(today, counted, S, 99.7, '2026-09-16');

assert.equal(blob.date, '2026-09-16');
assert.equal(blob.bars.length, 3, 'three bars, in the order the layout draws them');
assert.deepEqual(blob.bars.map(b => b.label), ['FAT LOST', 'CALORIES', 'PROTEIN']);

/* 950 + 850 = 1800 kcal banked = 0.23 kg of the 3 kg goal */
assert.equal(blob.bars[0].value, '0.23 / 3 kg');
assert.equal(blob.bars[0].pct, 8);
assert.equal(blob.bars[1].value, '1840 / 2550');
assert.equal(blob.bars[1].pct, 72);
assert.equal(blob.bars[1].over, false);
assert.equal(blob.bars[2].value, '142 / 190 g');
assert.equal(blob.bars[2].pct, 75);

/* Over target turns the calorie figure red in the widget; the bar just sits full. */
const overDay = day({ meals: [{ cal: 3000, protein: 142 }] });
const ob = C.widgetBlob(overDay, counted, S, 99.7, '2026-09-16');
assert.equal(ob.bars[1].over, true, 'eating past the target is flagged');
assert.equal(ob.bars[1].pct, 100, 'and the bar caps rather than overflowing');

/* An empty day still produces a renderable blob — the widget must never show NaN. */
const empty = C.widgetBlob(day({}), [], S, 99.7, '2026-09-16');
assert.equal(empty.bars[0].pct, 0);
assert.equal(empty.bars[1].value, '0 / 2550');
assert.ok(empty.bars.every(b => Number.isFinite(b.pct)), 'every pct is a real number');

/* A zero goal must not divide by zero. */
const zeroGoal = C.widgetBlob(today, counted, { ...S, goalKg: 0 }, 99.7, '2026-09-16');
assert.ok(Number.isFinite(zeroGoal.bars[0].pct));

assert.equal(C.pct(5, 0), 0, 'no target means no bar, not Infinity');
assert.equal(C.pct(50, 100), 50);
assert.equal(C.pct(-5, 100), 0, 'a negative never draws backwards');
assert.equal(C.pct(500, 100), 100);

console.log('widget blob: all assertions passed');

/* ---- automatic step counting ---- */
/* The sensor counts from boot, so every case here is about turning a cumulative number into
   "steps today" without losing any across a midnight or a reboot. */

const D1 = '2026-09-16', D2 = '2026-09-17';

/* First ever reading banks a baseline and claims no steps for it. */
let st = C.stepTally(null, 5000, D1);
assert.deepEqual(st, { day: D1, base: 5000, carried: 0, last: 5000, steps: 0 },
                 'the counter was already at 5000 before the app looked; none of it is today');

/* Walking accrues against that baseline. */
st = C.stepTally(st, 5300, D1);
assert.equal(st.steps, 300);
st = C.stepTally(st, 8000, D1);
assert.equal(st.steps, 3000);

/* A new day re-baselines rather than carrying yesterday's total. */
const day2 = C.stepTally(st, 8200, D2);
assert.equal(day2.steps, 0, 'a new day starts at zero');
assert.equal(day2.base, 8200);
st = C.stepTally(day2, 9000, D2);
assert.equal(st.steps, 800);

/* A reboot resets the hardware counter. The morning must survive it. */
let r = C.stepTally(null, 1000, D1);
r = C.stepTally(r, 4000, D1);
assert.equal(r.steps, 3000, 'three thousand before the reboot');
r = C.stepTally(r, 50, D1);              // counter restarted, now far below the last reading
assert.equal(r.steps, 3050, 'banked, not lost, and not negative');
r = C.stepTally(r, 900, D1);
assert.equal(r.steps, 3900, 'and it keeps accruing after the reboot');

/* Two reboots in one day still accumulate. */
r = C.stepTally(r, 10, D1);
assert.equal(r.steps, 3910);
r = C.stepTally(r, 200, D1);
assert.equal(r.steps, 4100);

/* A repeated identical reading is not a reboot and adds nothing. */
let same = C.stepTally(null, 700, D1);
same = C.stepTally(same, 1200, D1);
const before = same.steps;
same = C.stepTally(same, 1200, D1);
assert.equal(same.steps, before, 'polling twice must not double-count');

/* Junk from the sensor must never produce NaN or a negative tally. */
assert.equal(C.stepTally(null, undefined, D1).steps, 0);
assert.equal(C.stepTally(null, -20, D1).base, 0, 'a negative reading floors at zero');
const frac = C.stepTally(null, 10.9, D1);
assert.equal(frac.base, 10, 'the sensor hands back a float; steps are whole');
assert.ok(Number.isFinite(C.stepTally({ day: D1 }, 500, D1).steps), 'a half-written state still resolves');

console.log('step counting: all assertions passed');

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

/* ---- meal slot (Meals row's "Breakfast · 08:10" label) ---- */

assert.equal(C.mealSlot(8), 'Breakfast');
assert.equal(C.mealSlot(5), 'Breakfast', 'the boundary hour belongs to the slot starting there');
assert.equal(C.mealSlot(13), 'Lunch');
assert.equal(C.mealSlot(16), 'Snack', 'mid-afternoon has no slot of its own');
assert.equal(C.mealSlot(19), 'Dinner');
assert.equal(C.mealSlot(2), 'Snack', 'the small hours fall back to snack, not a fifth label');
assert.equal(C.mealSlot(''), 'Snack', 'a bad hour degrades to snack rather than throwing');

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

/* ---- weight delta (Today's Weight tile) ---- */

assert.equal(C.weightDelta(wDays, D(12)), -0.4,
             'the previous LOGGED weight, D10, not the calendar day before (D11 has none)');
assert.equal(C.weightDelta(wDays, D(5)), null, 'the first ever entry has nothing before it');
assert.equal(C.weightDelta(wDays, D(11)), null, 'this day has no weight of its own to show a delta for');
assert.equal(C.weightDelta({}, D(12)), null, 'no history at all');
assert.equal(C.weightDelta({ [D(12)]: { weight: 99 } }, D(12)), null,
             'exactly one logged weight ever, on the day itself: still nothing to compare to');
assert.equal(C.weightDelta({ [D(10)]: { weight: 99 }, [D(12)]: { weight: 99 } }, D(12)), 0,
             'a genuinely unchanged weight is 0, not null and not hidden');
assert.equal(C.weightDelta({ [D(1)]: { weight: 82 }, [D(12)]: { weight: 80 } }, D(12)), -2,
             'a loss on a cut reads negative, not inverted, however wide the gap');

/* ---- should finalize ---- */

const withMeal = { meals: [meal('x', 500, 30)] };
assert.equal(C.shouldFinalize(withMeal, D(11), D(12)), true, 'a past day with a meal finishes');
assert.equal(C.shouldFinalize(withMeal, D(12), D(12)), false, 'today never finishes');
assert.equal(C.shouldFinalize(withMeal, D(13), D(12)), false, 'nor does a future day');
assert.equal(C.shouldFinalize({ meals: [], weight: 99 }, D(11), D(12)), false,
             'a day with no meals is skipped, not scored as a full-maintenance deficit');
assert.equal(C.shouldFinalize({ ...withMeal, done: true }, D(11), D(12)), false, 'already finished');
assert.equal(C.shouldFinalize(null, D(11), D(12)), false);

/* ---- the rolling workout split (Today's Workout tile) ---- */

/* A training day only advances the rotation if something was actually logged on it — see
   "the something-logged condition" below. train() therefore carries a meal; trainEmpty() is the
   scheduled-but-never-trained day. */
const train = (n) => ({ [D(n)]: { dayType: 'training', meals: [{ cal: 600, protein: 45 }] } });
const trainEmpty = (n) => ({ [D(n)]: { dayType: 'training', meals: [] } });
const rest = (n) => ({ [D(n)]: { dayType: 'rest', meals: [] } });

assert.deepEqual(C.MUSCLE_GROUPS, ['Biceps & back', 'Delts & chest', 'Legs', 'Core'],
                 'the four slots, in rotation order');

assert.equal(C.workoutSplit({}, D(12)), 'Biceps & back', 'an empty history starts at the first slot');
assert.equal(C.workoutSplit(null, D(12)), 'Biceps & back', 'no history object at all');

/* One prior workout puts today on slot two, and so on round the cycle. */
assert.equal(C.workoutSplit({ ...train(8) }, D(12)), 'Delts & chest', 'one prior workout');
assert.equal(C.workoutSplit({ ...train(8), ...train(9) }, D(12)), 'Legs', 'two');
assert.equal(C.workoutSplit({ ...train(8), ...train(9), ...train(10) }, D(12)), 'Core', 'three');
assert.equal(C.workoutSplit({ ...train(8), ...train(9), ...train(10), ...train(11) }, D(12)),
             'Biceps & back', 'the fourth workout wraps back to the first slot');

/* The rotation follows training, not the calendar: a gap does not skip a group. */
assert.equal(C.workoutSplit({ ...train(1), ...train(2) }, D(30)), 'Legs',
             'a 28-day gap still resumes at the next slot, not further along');
assert.equal(C.workoutSplit({ ...train(8), ...rest(9), ...rest(10), ...rest(11) }, D(12)),
             'Delts & chest', 'rest days do not advance the rotation');
assert.equal(C.workoutSplit({ ...train(8), [D(9)]: { meals: [] } }, D(12)), 'Delts & chest',
             'a day with no dayType at all does not advance it either');

/* Today's own mark must not move its label — otherwise tapping Done would rename the tile. */
const upTo11 = { ...train(8), ...train(9), ...train(10) };
assert.equal(C.workoutSplit({ ...upTo11, ...train(12) }, D(12)),
             C.workoutSplit(upTo11, D(12)),
             'marking today done does not change which group today is');

/* A past day reads as the group it actually was, not as today's position. */
assert.equal(C.workoutSplit({ ...train(8), ...train(9), ...train(10) }, D(9)), 'Delts & chest',
             'a past day is judged by the workouts before IT, not before today');

/* Days strictly after the date are ignored, however they are marked. */
assert.equal(C.workoutSplit({ ...train(20), ...train(21) }, D(12)), 'Biceps & back',
             'later workouts do not count toward an earlier day');

/* ---- the weekly training schedule (Settings) ---- */

/* 2026-09-14 is a Monday, so D(14+n) walks Mon..Sun. */
const sched = (v) => C.withDefaults({ trainingDays: v });

assert.equal(C.DEFAULTS.trainingDays, '',
             'no schedule out of the box: every new day still opens as rest, as it always has');
assert.equal(C.isTrainingDay(S, D(14)), false, 'the empty default trains on no day');
assert.equal(C.isTrainingDay(sched(''), D(17)), false);

/* getDay() indices: Sun=0 .. Sat=6. Mon/Tue/Thu/Fri = a four-day week. */
const fourDay = sched('1,2,4,5');
assert.equal(C.isTrainingDay(fourDay, D(14)), true,  'Monday');
assert.equal(C.isTrainingDay(fourDay, D(15)), true,  'Tuesday');
assert.equal(C.isTrainingDay(fourDay, D(16)), false, 'Wednesday is off');
assert.equal(C.isTrainingDay(fourDay, D(17)), true,  'Thursday');
assert.equal(C.isTrainingDay(fourDay, D(18)), true,  'Friday');
assert.equal(C.isTrainingDay(fourDay, D(19)), false, 'Saturday is off');
assert.equal(C.isTrainingDay(fourDay, D(20)), false, 'Sunday is off');

/* Sunday is 0, which is falsy — the parse must not drop it. */
assert.equal(C.isTrainingDay(sched('0'), D(20)), true, 'a Sunday-only schedule trains on Sunday');
assert.equal(C.isTrainingDay(sched('0'), D(14)), false, 'and on nothing else');

/* Substring matching would make '1' hit day 11 and '2' hit 12; there are only seven days,
   but a sloppy indexOf on the raw string would also let '15' match a schedule of '1,5'. */
assert.equal(C.isTrainingDay(sched('1,5'), D(15)), false,
             'a Tuesday is not a training day under a Mon+Fri schedule');

/* Every day selected, and the order it was written in must not matter. */
assert.equal(C.isTrainingDay(sched('0,1,2,3,4,5,6'), D(16)), true, 'a seven-day schedule');
assert.equal(C.isTrainingDay(sched('5,1'), D(14)), true, 'unsorted input still matches Monday');

/* Junk in storage falls back to resting rather than throwing or training every day. */
assert.equal(C.isTrainingDay(sched(null), D(14)), false, 'null');
assert.equal(C.isTrainingDay(sched('   '), D(14)), false, 'whitespace');
assert.equal(C.isTrainingDay(sched('9'), D(14)), false, 'an index no weekday can produce');
assert.equal(C.isTrainingDay(sched('1,2'), ''), false, 'no date at all');

/* ---- the something-logged condition on the rotation ---- */

/* A weekly schedule stamps dayType 'training' on a day the moment it is opened, trained or not.
   Counting those would advance the rotation on days the user never trained, which is exactly the
   date-anchored cycle the per-workout design exists to avoid. */
assert.equal(C.workoutSplit({ ...trainEmpty(8) }, D(12)), 'Biceps & back',
             'a scheduled training day with nothing logged does not burn a slot');
assert.equal(C.workoutSplit({ ...train(8), ...trainEmpty(9), ...trainEmpty(10) }, D(12)),
             'Delts & chest',
             'two skipped scheduled days hold the rotation where the last real workout left it');

/* Steps or a weight are logging too — a workout is not only a meal. */
assert.equal(C.workoutSplit({ [D(8)]: { dayType: 'training', meals: [], steps: 9000 } }, D(12)),
             'Delts & chest', 'steps count as having trained');
assert.equal(C.workoutSplit({ [D(8)]: { dayType: 'training', meals: [], weight: 99.2 } }, D(12)),
             'Delts & chest', 'a logged weight counts too');
assert.equal(C.workoutSplit({ [D(8)]: { dayType: 'training', meals: [], steps: '' , weight: '' } }, D(12)),
             'Biceps & back', 'empty strings are not entries');

/* A rest day with a full log still must not advance it — the condition is AND, not OR. */
assert.equal(C.workoutSplit({ [D(8)]: { dayType: 'rest', meals: [{ cal: 600 }] } }, D(12)),
             'Biceps & back', 'logging on a rest day does not advance the rotation');

console.log('redesign core: all assertions passed');
