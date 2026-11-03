import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dollarsToCents, centsParam } from '../engine/money.js';
import { prepareBudgetUpdate, prepareRead, API_VERSION } from '../engine/metaAdapter.js';
import { hoursInLocalDay, bucketByLocalDate } from '../engine/time.js';
import { DATA } from '../engine/syntheticData.js';

test('daily_budget is sent in cents, as an integer string', () => {
  assert.equal(centsParam(dollarsToCents(110)), '11000');
  assert.equal(dollarsToCents(0.1 + 0.2), 30);
  assert.throws(() => centsParam(110.5));
  assert.throws(() => centsParam(0));
  assert.throws(() => dollarsToCents(1.234));
});

test('the adapter prepares requests for an explicit API version, budget only on ad set or campaign', () => {
  assert.equal(API_VERSION, 'v26.0');
  const r = prepareBudgetUpdate('SIM-AS-101', 11000);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://graph.facebook.com/v26.0/SIM-AS-101');
  assert.deepEqual(r.body, { daily_budget: '11000' });
  assert.deepEqual(prepareBudgetUpdate('SIM-AS-101', 11000, { validateOnly: true }).body.execution_options, ['validate_only']);
  assert.throws(() => prepareBudgetUpdate('x', 11000, { level: 'ad' }), /not on an ad/);
  assert.match(prepareRead('SIM-AS-101').query.fields, /daily_budget/);
});

test('Nov 1, 2026 has 25 hours in New York and days are cut in the account time zone', () => {
  assert.equal(hoursInLocalDay('2026-11-01'), 25);
  assert.equal(hoursInLocalDay('2026-10-31'), 24);
  const b = bucketByLocalDate(DATA.hourly_spend.rows);
  assert.equal(b['2026-11-01'].rows, 25);
  for (const [d, v] of Object.entries(b)) {
    const daily = DATA.daily.find((r) => r.date === d && r.adset_id === 'SIM-AS-101');
    assert.equal(v.total, daily.spend_cents, `hourly spend for ${d} adds up to the daily row`);
  }
  // Cutting by UTC date would give different totals: the bug this test guards against.
  const utc = {};
  for (const r of DATA.hourly_spend.rows) { const d = r.ts_utc.slice(0, 10); utc[d] = (utc[d] ?? 0) + r.spend_cents; }
  assert.notEqual(utc['2026-11-01'], b['2026-11-01'].total);
});

test('one simulated day spends above budget, inside Meta’s 75% daily flexibility', () => {
  const over = DATA.daily.find((r) => r.adset_id === 'SIM-AS-101' && r.date === '2026-10-31');
  assert.ok(over.spend_cents > 10000 && over.spend_cents <= 17500);
});

test('every calendar week (Sunday to Saturday) stays within 7 x the daily budget', () => {
  for (const a of DATA.adsets) {
    const weeks = {};
    for (const r of DATA.daily.filter((x) => x.adset_id === a.id)) {
      const t = Date.parse(r.date + 'T12:00:00Z');
      const sunday = new Date(t - new Date(t).getUTCDay() * 86400000).toISOString().slice(0, 10);
      weeks[sunday] = (weeks[sunday] ?? 0) + r.spend_cents;
    }
    for (const [w, sum] of Object.entries(weeks)) assert.ok(sum <= 7 * a.daily_budget_cents, `${a.id} week of ${w}: ${sum} > ${7 * a.daily_budget_cents}`);
  }
});
