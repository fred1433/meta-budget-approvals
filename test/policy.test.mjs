import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../engine/world.js';
import { evaluateFatigue } from '../engine/policy.js';
import { DATA } from '../engine/syntheticData.js';
import { SNAPSHOT } from '../engine/publicSnapshot.js';
import { periodMetrics, completeDays } from '../engine/metrics.js';

test('Crystal Cross ad set: increase 100 to 110, every condition met', () => {
  const p = createWorld().propose('SIM-AS-101');
  assert.equal(p.verdict, 'increase');
  assert.ok(p.conditions.every((c) => c.ok));
  assert.ok(p.metrics.newCustomerCost <= DATA.scenario.targets.new_customer_cost_cents);
});

test('BOGO ad set: held despite a favourable Meta ROAS, because of new-customer cost', () => {
  const p = createWorld().propose('SIM-AS-102');
  assert.equal(p.verdict, 'hold');
  assert.ok(p.metrics.roasMeta > 3, 'Meta ROAS looks good');
  assert.ok(p.metrics.shopify.returningShare > 0.5, 'mostly returning customers');
  const failing = p.conditions.filter((c) => !c.ok).map((c) => c.id);
  assert.deepEqual(failing, ['new_customer_cost']);
  assert.equal(p.toCents, p.fromCents);
});

test('new customer = first order in the known store history (customerOrderIndex 1), not "absent from the week"', () => {
  const m = periodMetrics('SIM-AS-102', DATA.scenario.week.from, DATA.scenario.week.to);
  const linked = DATA.orders.filter((o) => (o.journey.first.utm_content === 'SIM-AS-102' || o.journey.last.utm_content === 'SIM-AS-102'));
  assert.ok(linked.some((o) => o.customerOrderIndex > 1));
  assert.equal(m.shopify.newCustomers + m.shopify.returning, m.shopify.linked);
});

test('Inner Light video: suspected fatigue asks for review, never a pause', () => {
  const f = evaluateFatigue('SIM-AS-103');
  assert.equal(f.verdict, 'suspected_review');
  assert.ok(f.for.length >= 2);
  assert.ok(f.against.length >= 2, 'evidence against is shown too');
  assert.equal(f.purchaseLevel, 'insufficient');
  assert.ok(f.ev.hookRate.num[0] > 0 && f.ev.hookRate.den[0] > 0, 'hook rate keeps numerator and denominator');
});

test('fatigue with too few impressions = insufficient data', () => {
  const thin = { ...DATA, daily: DATA.daily.map((r) => (r.adset_id === 'SIM-AS-103' ? { ...r, impressions: 1000 } : r)) };
  assert.equal(evaluateFatigue('SIM-AS-103', thin).verdict, 'insufficient_data');
});

test('no simulated performance before an ad’s public start date', () => {
  for (const a of DATA.adsets) {
    const started = SNAPSHOT.ads[a.library_id].started;
    const first = DATA.daily.filter((r) => r.adset_id === a.id).map((r) => r.date).sort()[0];
    assert.ok(first > started, `${a.id} data starts ${first}, ad started ${started}`);
  }
});

test('no synthetic order is dated after the scenario clock', () => {
  const now = Date.parse(DATA.scenario.now_utc);
  assert.ok(DATA.orders.every((o) => Date.parse(o.created_utc) <= now));
});

test('scenario assumes no budget sharing and budgets on ad sets', () => {
  assert.equal(DATA.account.budget_sharing, false);
  assert.ok(DATA.adsets.every((a) => a.budget_level === 'ad set'));
});

test('completeness counts distinct dates per ad set and needs every ad set and both syncs', () => {
  assert.equal(completeDays().length, 7);
  const dup = { ...DATA, daily: [...DATA.daily, { ...DATA.daily.find((r) => r.adset_id === 'SIM-AS-101' && r.date === '2026-10-30') }] };
  assert.equal(periodMetrics('SIM-AS-101', '2026-10-27', '2026-11-02', dup).days, 7, 'a duplicated date is not an extra day');
  const missing = { ...DATA, daily: DATA.daily.filter((r) => !(r.adset_id === 'SIM-AS-103' && r.date === '2026-10-29')) };
  assert.equal(completeDays(missing).length, 6, 'one ad set without a row that day makes the day incomplete');
  const lag = { ...DATA, scenario: { ...DATA.scenario, sync: { ...DATA.scenario.sync, shopify: { complete_through: '2026-11-01' } } } };
  assert.equal(completeDays(lag).length, 6, 'Shopify sync behind by a day');
});

test('fatigue: the ad\u2019s first week is flagged as possibly still in learning', () => {
  assert.ok(evaluateFatigue('SIM-AS-103').against.some((x) => /may still have been in learning/.test(x)));
});
