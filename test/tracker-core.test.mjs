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
