import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, scene } from '../engine/reconcile.js';
import { DATA } from '../engine/syntheticData.js';
import { localDate } from '../engine/time.js';

test('gap lines add up to the gap, and an unexplained line exists', () => {
  const r = reconcile();
  const sum = r.lines.reduce((s, l) => s + l.value, 0);
  assert.equal(sum, r.gap);
  const un = r.lines.find((l) => l.status === 'unexplained');
  assert.ok(un);
  assert.equal(un.value, DATA.meta_unmatched.reduce((s, u) => s + u.value_cents, 0), 'remainder is exactly what no source can explain');
});

test('each source carries its own read time', () => {
  const r = reconcile();
  assert.ok(r.meta.readAt && r.shopify.readAt && r.shopifyMeta.readAt);
});

test('the scene: click, email return, purchase, return dated on processing', () => {
  const s = scene();
  assert.equal(localDate(Date.parse(s.click_utc)), '2026-10-28');
  assert.equal(s.order.journey.first.source, 'meta');
  assert.equal(s.order.journey.last.source, 'email');
  assert.equal(localDate(Date.parse(s.order_utc)), '2026-10-30');
  assert.equal(localDate(Date.parse(s.ret.processed_utc)), '2026-11-02');
  const r = reconcile();
  assert.ok(r.shopify.returns >= s.ret.amount_cents, 'the return is counted in the week it was processed');
});

test('Shopify net sales = gross - discounts - returns (taxes and shipping apart)', () => {
  const s = reconcile().shopify;
  assert.equal(s.netSales, s.gross - s.discounts - s.returns);
});
