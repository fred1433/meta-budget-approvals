import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../engine/world.js';
import { evaluateFatigue } from '../engine/policy.js';
import { DATA } from '../engine/syntheticData.js';
import { SNAPSHOT } from '../engine/publicSnapshot.js';
import { periodMetrics } from '../engine/metrics.js';

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
